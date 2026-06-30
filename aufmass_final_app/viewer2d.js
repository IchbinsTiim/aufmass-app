'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Gerüst 2D-Ansicht  –  VOB/C DIN 18451 inspired scaffolding floor-plan
   ══════════════════════════════════════════════════════════════════════════

   Data model:
   • Each section has an explicit start position (x0, y0) so sections can
     branch from any junction – enabling balconies, angled wings, etc.
   • Corner pieces are rendered wherever two sections share a junction point
     and their outward normals form an exterior angle.
   ══════════════════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────────────

const PX_PER_M     = 100;
const HANDLE_R     = 18;
const SNAP_STEP    = 0.25;
const FIELD_PRESETS = [0.73, 1.09, 1.57, 2.07, 2.57, 3.07];

// ── Feld-Kategorien ────────────────────────────────────────────────────────
// Jedes Feld gehört zu einer Kategorie (Gerüst + alle Positionen aus der
// Aufmaß-App). Jede Kategorie hat eine eigene Farbe (Wiedererkennung im Plan)
// und die für sie relevanten Maße. Die Maßwerte werden direkt am Bay gespeichert
// (bay[key]); die Feldlänge (bay.len) gilt für alle Kategorien.
const MEASURE_DEFS = {
  hL:      { label: 'Höhe links',       unit: 'm',    sym: '↥', dec: 2 },
  hR:      { label: 'Höhe rechts',      unit: 'm',    sym: '↥', dec: 2 },
  breite:  { label: 'Breite / Auslage', unit: 'm',    sym: 'B', dec: 2 },
  flaeche: { label: 'Fläche',           unit: 'm²',   sym: '▦', dec: 2 },
  anzahl:  { label: 'Anzahl',           unit: 'Stk.', sym: '×', dec: 0 }
};

const FIELD_CATEGORIES = [
  { key: 'geruest',      label: 'Gerüst',           fill: '#deeeff', stroke: '#2c6fa8', measures: ['hL', 'hR'] },
  { key: 'konsole',      label: 'Konsole',          fill: '#ffe9cc', stroke: '#cc7a00', measures: ['breite', 'hL', 'hR'] },
  { key: 'gelaender',    label: 'Geländer',         fill: '#e3f6e3', stroke: '#2f9e44', measures: ['hL', 'hR'] },
  { key: 'treppenturm',  label: 'Treppenturm',      fill: '#ece1fb', stroke: '#8e44ec', measures: ['hL', 'hR'] },
  { key: 'geruesttreppe',label: 'Gerüsttreppe',     fill: '#e0e7ff', stroke: '#4659c9', measures: ['hL', 'hR'] },
  { key: 'netz',         label: 'Netz',             fill: '#eceff1', stroke: '#5a6b7a', measures: ['flaeche'] },
  { key: 'dachfang',     label: 'Dachfang',         fill: '#fff3c4', stroke: '#b08900', measures: ['hL', 'hR'] },
  { key: 'verbreiterung',label: 'Verbreiterung',    fill: '#d8f3f0', stroke: '#0f9b8e', measures: ['breite', 'hL', 'hR'] },
  { key: 'ueberbrueckung',label: 'Überbrückung',    fill: '#f3e1d8', stroke: '#a5612c', measures: ['hL', 'hR'] },
  { key: 'bekleidung',   label: 'Bekleidung',       fill: '#f6e2ef', stroke: '#a52c7e', measures: ['flaeche'] },
  { key: 'schutzdach',   label: 'Schutzdach',       fill: '#fde2e2', stroke: '#c0392b', measures: ['flaeche', 'hL', 'hR'] },
  { key: 'aufzug',       label: 'Aufzug',           fill: '#e2ecf6', stroke: '#1f5f9e', measures: ['hL', 'hR', 'anzahl'] },
  { key: 'lampen',       label: 'Lampen',           fill: '#fff6cc', stroke: '#b59a00', measures: ['anzahl'] },
  { key: 'bautenschutz', label: 'Bautenschutzmatte',fill: '#e7e2d8', stroke: '#7a6a2c', measures: ['flaeche'] },
  { key: 'fleece',       label: 'Fleece',           fill: '#eae2f6', stroke: '#6a2ca5', measures: ['flaeche'] }
];
const CAT_BY_KEY = Object.fromEntries(FIELD_CATEGORIES.map(c => [c.key, c]));
function catOf(bay) { return CAT_BY_KEY[bay && bay.category] || FIELD_CATEGORIES[0]; }

const DIR_META = {
  N: { dx:  0, dy: -1, label: 'N ↑' },
  E: { dx:  1, dy:  0, label: 'O →' },
  S: { dx:  0, dy:  1, label: 'S ↓' },
  W: { dx: -1, dy:  0, label: 'W ←' }
};

// Cardinal direction ↔ rotation angle (degrees, clockwise from East / +x, y-down).
const DIR_TO_ANGLE = { E: 0, S: 90, W: 180, N: 270 };

// Rotation snap tolerance (degrees) – field rastet bei 0/90/180/270 ein.
const ROT_SNAP_DEG = 7;
const ROT_SNAP_ANGLES = [0, 90, 180, 270];

// ── State ──────────────────────────────────────────────────────────────────

let _sId = 0, _bId = 0;
let state = {
  project:  '',
  depth:    0.73,
  sections: []
  // section: { id, name, dir, bays:[{id,len}], x0, y0 }
};

let drag           = null;
let rafPending     = false;
let addCtx         = null;   // null = FAB,  { x, y } = from junction
let pendingDir     = 'S';
let pendingLen     = null;
let addCtxDirFixed = false;  // true when direction already chosen via directional button
let selectedSi     = null;   // index of currently selected section (shows + buttons)
let snapEnabled    = true;   // magnetic grid snapping on/off
let pdfMode        = false;  // when true: render clean plan (no handles)

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  // category = Feld-Kategorie (Gerüst/Konsole/…). hL/hR = Höhe am linken/rechten
  // Stiel. breite/flaeche/anzahl = kategorie-spezifische Maße (null = nicht erfasst).
  return {
    id: ++_bId, len: +parseFloat(len).toFixed(2),
    category: 'geruest',
    hL: null, hR: null, breite: null, flaeche: null, anzahl: null,
    notiz: ''
  };
}

function mkSection(dir = 'S', x0 = 0, y0 = 0) {
  const id = ++_sId;
  return { id, name: `A${id}`, dir, angle: DIR_TO_ANGLE[dir] ?? 90, bays: [], x0, y0 };
}

// ── Geometry helpers ───────────────────────────────────────────────────────

function outVec(dir) { return { dx: dir.dy, dy: -dir.dx }; }

// ── Section rotation ─────────────────────────────────────────────────────────
// Eine Sektion besitzt einen stufenlosen Winkel `angle` (Grad). Die kardinale
// `dir`-Eigenschaft bleibt für Labels & Hinzufügen erhalten und folgt dem Winkel.

function normDeg(deg) { return ((deg % 360) + 360) % 360; }

/** Aktueller Winkel einer Sektion in Grad (Fallback auf kardinale Richtung). */
function secAngle(sec) {
  return sec.angle != null ? sec.angle : (DIR_TO_ANGLE[sec.dir] ?? 90);
}

/** Einheits-Laufrichtung der Sektion aus ihrem Winkel. */
function secVec(sec) {
  const r = secAngle(sec) * Math.PI / 180;
  return { dx: Math.cos(r), dy: Math.sin(r) };
}

/** Label-Drehung, die der Laufrichtung folgt, aber lesbar (nicht kopfüber) bleibt. */
function uprightDeg(deg) {
  let la = normDeg(deg);
  if (la >= 90 && la < 270) la -= 180;
  return la;
}

/** Nächstgelegene kardinale Richtung zu einem Winkel. */
function nearestCardinal(deg) {
  const idx = Math.round(normDeg(deg) / 90) % 4;     // 0→E,1→S,2→W,3→N
  return ['E', 'S', 'W', 'N'][idx];
}

/** Winkel auf 0/90/180/270 einrasten (innerhalb Toleranz), sonst frei lassen. */
function snapAngle(deg) {
  const a = normDeg(deg);
  for (const c of ROT_SNAP_ANGLES) {
    if (Math.abs(a - c) <= ROT_SNAP_DEG || Math.abs(a - 360) <= ROT_SNAP_DEG) {
      return Math.abs(a - 360) <= ROT_SNAP_DEG ? 0 : c;
    }
  }
  return a;
}

/** Setzt den Winkel einer Sektion und hält die kardinale `dir` synchron. */
function setSectionAngle(sec, deg) {
  const a = normDeg(deg);
  sec.angle = a;
  sec.dir   = nearestCardinal(a);
}

function snapLen(len) {
  if (!snapEnabled) return Math.max(0.25, +len.toFixed(2));
  const g = Math.round(len / SNAP_STEP) * SNAP_STEP;
  for (const s of FIELD_PRESETS) {
    if (Math.abs(g - s) <= 0.13) return s;
  }
  return Math.max(0.25, +g.toFixed(2));
}

/* ──────────────────────────────────────────────────────────────────────────
   SNAP-ENGINE  –  präzises, CAD-artiges Andocken
   ──────────────────────────────────────────────────────────────────────────
   Prinzip:
   • Jedes Feld ist ein achsparalleles Rechteck mit 4 Eckpunkten.
   • Beim Verschieben einer Sektion werden ALLE 4 Ecken jedes ihrer Felder
     gegen ALLE Ecken aller anderen Felder geprüft.
   • Das nächstgelegene (Quell-Ecke → Ziel-Ecke)-Paar innerhalb des
     Magnetradius bestimmt die Andockposition – pixelgenau.
   • Kandidaten, die eine Überlappung erzeugen würden, werden übersprungen.
   • Während des Ziehens wird die Andockposition als Vorschau angezeigt;
     erst beim Loslassen rastet das Feld endgültig ein.
   ────────────────────────────────────────────────────────────────────────── */

// Magnetstärke: Andockradius in BILDSCHIRM-Pixeln (zoom-unabhängig, iPad-tauglich).
const SNAP_SCREEN_PX = 24;

// Aktive Andock-Vorschau während des Verschiebens (null = keine).
//   { polys:[[p,p,p,p],…], anchor:{x,y} }
let movePreview = null;

/** Bildschirm→Welt-Skala (Welt-px je Bildschirm-px) für zoom-stabile Magnetstärke. */
function worldPerScreenPx() {
  const svg  = document.getElementById('planSvg');
  const rect = svg.getBoundingClientRect();
  const vb   = svg.viewBox.baseVal;
  if (!rect.width || !vb.width) return 1;
  return vb.width / rect.width;
}

/** Die vier Eck-Polygone aller Felder einer Sektion an Position (x0,y0). */
function sectionBayPolys(sec, x0, y0) {
  const dir   = secVec(sec);
  const out   = outVec(dir);
  const depth = state.depth * PX_PER_M;
  let x = x0, y = y0;
  const polys = [];
  sec.bays.forEach(b => {
    const pxLen = b.len * PX_PER_M;
    const p0 = { x, y };
    const p1 = { x: x + dir.dx * pxLen, y: y + dir.dy * pxLen };
    const p2 = { x: p1.x + out.dx * depth, y: p1.y + out.dy * depth };
    const p3 = { x: p0.x + out.dx * depth, y: p0.y + out.dy * depth };
    polys.push([p0, p1, p2, p3]);
    x = p1.x; y = p1.y;
  });
  return polys;
}

/** Alle vier Eckpunkte jedes Feldes – als Offsets relativ zu (x0,y0). */
function sectionLocalAnchors(sec) {
  const seen = new Set(), anchors = [];
  sectionBayPolys(sec, 0, 0).forEach(poly => poly.forEach(p => {
    const k = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (seen.has(k)) return;
    seen.add(k);
    anchors.push({ dx: p.x, dy: p.y });
  }));
  return anchors;
}

/** Alle gültigen Andock-Zielpunkte: Eckpunkte aller ANDEREN Sektionen. */
function collectTargetAnchors(excludeSi) {
  const seen = new Set(), anchors = [];
  state.sections.forEach((s, i) => {
    if (i === excludeSi || s.bays.length === 0) return;
    sectionBayPolys(s, s.x0, s.y0).forEach(poly => poly.forEach(p => {
      const k = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(k)) return;
      seen.add(k);
      anchors.push({ x: p.x, y: p.y });
    }));
  });
  return anchors;
}

/** Überlappen zwei achsparallele Feld-Rechtecke mit positiver Fläche?
    Gemeinsame Kanten/Ecken (Fläche 0) gelten NICHT als Überlappung. */
function polysOverlap(a, b, eps = 1.0) {
  const ax0 = Math.min(a[0].x, a[1].x, a[2].x, a[3].x);
  const ax1 = Math.max(a[0].x, a[1].x, a[2].x, a[3].x);
  const ay0 = Math.min(a[0].y, a[1].y, a[2].y, a[3].y);
  const ay1 = Math.max(a[0].y, a[1].y, a[2].y, a[3].y);
  const bx0 = Math.min(b[0].x, b[1].x, b[2].x, b[3].x);
  const bx1 = Math.max(b[0].x, b[1].x, b[2].x, b[3].x);
  const by0 = Math.min(b[0].y, b[1].y, b[2].y, b[3].y);
  const by1 = Math.max(b[0].y, b[1].y, b[2].y, b[3].y);
  return ax0 < bx1 - eps && bx0 < ax1 - eps &&
         ay0 < by1 - eps && by0 < ay1 - eps;
}

/** Würde die Sektion an (x0,y0) irgendein fremdes Feld überlappen? */
function sectionOverlaps(sec, x0, y0, excludeSi) {
  const mine = sectionBayPolys(sec, x0, y0);
  for (let i = 0; i < state.sections.length; i++) {
    if (i === excludeSi || state.sections[i].bays.length === 0) continue;
    const other = sectionBayPolys(state.sections[i], state.sections[i].x0, state.sections[i].y0);
    for (const m of mine) for (const o of other) if (polysOverlap(m, o)) return true;
  }
  return false;
}

/**
 * Beste gültige Andockposition für die gezogene Sektion.
 * Prüft alle (Quell-Ecke → Ziel-Ecke)-Paare, sortiert nach Nähe und nimmt
 * das erste Paar, das KEINE Überlappung erzeugt → eindeutiges, pixelgenaues
 * Einrasten an genau einer gültigen Position.
 * @returns {{x0:number, y0:number, anchor:{x,y}}} | null
 */
function findSnap(sec, rawX, rawY, excludeSi, threshold) {
  const locals  = drag.localAnchors  || sectionLocalAnchors(sec);
  const targets = drag.targetAnchors || collectTargetAnchors(excludeSi);
  const thr2 = threshold * threshold;

  const cands = [];
  for (const la of locals) {
    for (const ta of targets) {
      const d2 = (rawX + la.dx - ta.x) ** 2 + (rawY + la.dy - ta.y) ** 2;
      if (d2 <= thr2) cands.push({ d2, x0: ta.x - la.dx, y0: ta.y - la.dy, anchor: ta });
    }
  }
  cands.sort((p, q) => p.d2 - q.d2);
  for (const c of cands) {
    if (!sectionOverlaps(sec, c.x0, c.y0, excludeSi)) {
      return { x0: c.x0, y0: c.y0, anchor: c.anchor };
    }
  }
  return null;
}

/** Rohposition aufs 0,25-m-Grundraster runden (sanfte Ausrichtung). */
function gridSnapPos(x, y) {
  const g = SNAP_STEP * PX_PER_M;
  return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
}

function screenToSvg(clientX, clientY) {
  const svg  = document.getElementById('planSvg');
  const rect = svg.getBoundingClientRect();
  const vb   = svg.viewBox.baseVal;
  return {
    x: vb.x + (clientX - rect.left) * (vb.width  / rect.width),
    y: vb.y + (clientY - rect.top)  * (vb.height / rect.height)
  };
}

/** Returns the SVG endpoint (x, y) of a section. */
function sectionEnd(sec) {
  const dir = secVec(sec);
  let x = sec.x0, y = sec.y0;
  sec.bays.forEach(b => {
    x += dir.dx * b.len * PX_PER_M;
    y += dir.dy * b.len * PX_PER_M;
  });
  return { x, y };
}

/** Rounded key for deduplicating junction positions. */
function jKey(x, y) { return `${Math.round(x)},${Math.round(y)}`; }

// ── Layout computation ─────────────────────────────────────────────────────

function computeLayout() {
  const depth  = state.depth * PX_PER_M;
  const els    = [];

  state.sections.forEach((sec, si) => {
    const dir    = secVec(sec);
    const out    = outVec(dir);
    const ang    = secAngle(sec);
    let x = sec.x0, y = sec.y0;
    const startX = x, startY = y;

    // ── Start junction (tagged with si — only shown when section selected) ──
    els.push({ type: 'junctionBtn', x, y, si });

    // ── Bays ────────────────────────────────────────────────────────────
    sec.bays.forEach((bay, bi) => {
      const pxLen = bay.len * PX_PER_M;
      const p0 = { x, y };
      const p1 = { x: x + dir.dx * pxLen,   y: y + dir.dy * pxLen };
      const p2 = { x: p1.x + out.dx * depth, y: p1.y + out.dy * depth };
      const p3 = { x: p0.x + out.dx * depth, y: p0.y + out.dy * depth };
      const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
      const cy = (p0.y + p1.y + p2.y + p3.y) / 4;

      els.push({
        type: 'bay', pts: [p0, p1, p2, p3], cx, cy, len: bay.len,
        si, bi, dir: sec.dir, ang,
        handleX: (p1.x + p2.x) / 2,
        handleY: (p1.y + p2.y) / 2
      });

      x += dir.dx * pxLen;
      y += dir.dy * pxLen;

      els.push({ type: 'junctionBtn', x, y, si });
    });

    // ── Wall line ───────────────────────────────────────────────────────
    if (sec.bays.length > 0) {
      els.push({ type: 'wallLine', x1: startX, y1: startY, x2: x, y2: y });

      // Move handle at wall-line midpoint
      els.push({
        type: 'moveHandle',
        x: (startX + x) / 2,
        y: (startY + y) / 2,
        si
      });

      // Rotation handle – sitzt jenseits des Sektionsendes in Laufrichtung
      const rotOff = HANDLE_R * 3.4;
      els.push({
        type: 'rotateHandle',
        x: x + dir.dx * rotOff,
        y: y + dir.dy * rotOff,
        si, ang
      });
    }
  });

  // ── Corner pieces between connected sections ────────────────────────────
  state.sections.forEach((sec, si) => {
    const end = sectionEnd(sec);
    const out = outVec(secVec(sec));
    state.sections.forEach((next, ni) => {
      if (ni === si) return;
      if (Math.abs(next.x0 - end.x) < 2 && Math.abs(next.y0 - end.y) < 2) {
        const nOut  = outVec(secVec(next));
        const cross = out.dx * nOut.dy - out.dy * nOut.dx;
        if (cross > 0) {
          const c0 = { x: end.x, y: end.y };
          const c1 = { x: end.x + out.dx * depth, y: end.y + out.dy * depth };
          const c2 = { x: c1.x + nOut.dx * depth, y: c1.y + nOut.dy * depth };
          const c3 = { x: end.x + nOut.dx * depth, y: end.y + nOut.dy * depth };
          els.push({ type: 'corner', pts: [c0, c1, c2, c3] });
        }
      }
    });
  });

  return els;
}

// ── SVG helpers ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function ptsStr(pts) {
  return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// ── Main SVG render ────────────────────────────────────────────────────────

function renderSvg() {
  const g    = document.getElementById('planGroup');
  const svg  = document.getElementById('planSvg');
  const hint = document.getElementById('emptyHint');
  g.innerHTML = '';

  const hasBays = state.sections.some(s => s.bays.length > 0);
  if (!hasBays) {
    svg.setAttribute('viewBox', '0 0 400 300');
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');

  const depth = state.depth * PX_PER_M;
  const els   = computeLayout();

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const track = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  els.forEach(el => {
    if (el.pts) el.pts.forEach(p => track(p.x, p.y));
    if (el.type === 'wallLine')     { track(el.x1, el.y1); track(el.x2, el.y2); }
    if (el.x !== undefined)         track(el.x, el.y !== undefined ? el.y : 0);
  });

  const PAD = pdfMode ? depth * 1.8 + 20 : depth * 3.5 + HANDLE_R * 5;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const vw = maxX - minX, vh = maxY - minY;
  svg.setAttribute('viewBox', `${minX.toFixed(1)} ${minY.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);

  const gbg = document.getElementById('gridBg');
  gbg.setAttribute('x', minX); gbg.setAttribute('y', minY);
  gbg.setAttribute('width', vw); gbg.setAttribute('height', vh);

  const bayFontSize  = Math.max(depth * 0.38, 9);
  const infoFontSize = Math.max(depth * 0.28, 7);

  // 1. Corner pieces
  els.filter(e => e.type === 'corner').forEach(el =>
    g.appendChild(svgEl('polygon', {
      points: ptsStr(el.pts), fill: '#b5d4f0',
      stroke: '#2c6fa8', 'stroke-width': 2
    }))
  );

  // 2. Bay rectangles (farbcodiert nach Kategorie)
  els.filter(e => e.type === 'bay').forEach(el => {
    const bayData    = state.sections[el.si].bays[el.bi];
    const cat        = catOf(bayData);
    const isSelected = el.si === selectedSi;
    const poly = svgEl('polygon', {
      points: ptsStr(el.pts),
      fill: cat.fill,
      stroke: isSelected ? '#0a2f58' : cat.stroke,
      'stroke-width': isSelected ? 3.5 : 2,
      cursor: 'pointer'
    });
    poly.addEventListener('click', ev => {
      ev.stopPropagation();
      selectedSi = el.si;
      renderSvg();
      openEditSheet(el.si, el.bi);
    });
    g.appendChild(poly);

    const labelRot = uprightDeg(el.ang);

    // ── Geometrie für Maß-Beschriftungen ──────────────────────────────────
    // Maße werden IMMER an der bildschirm-unteren Kante des Feldes angezeigt:
    // bei waagerechtem Feld unten, bei senkrechtem (90° gedreht) Feld rechts –
    // konsistent, egal wie das Feld gedreht ist.
    const [p0, p1, p2, p3] = el.pts;          // p0,p1 = Innenkante (Wand), p3,p2 = Außenkante
    const runHoriz  = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);
    const innerMidY = (p0.y + p1.y) / 2, outerMidY = (p2.y + p3.y) / 2;
    const innerMidX = (p0.x + p1.x) / 2, outerMidX = (p2.x + p3.x) / 2;
    const useOuter  = runHoriz ? (outerMidY >= innerMidY) : (outerMidX >= innerMidX);
    const A = useOuter ? p3 : p0;             // gewählte Kante: Anfang (Startseite)
    const B = useOuter ? p2 : p1;             //                  Ende  (Endseite)
    const ecx = (p0.x + p1.x + p2.x + p3.x) / 4, ecy = (p0.y + p1.y + p2.y + p3.y) / 4;
    const emx = (A.x + B.x) / 2,                 emy = (A.y + B.y) / 2;
    let inx = ecx - emx, iny = ecy - emy;             // Unterkante → Mitte
    const ilen = Math.hypot(inx, iny) || 1; inx /= ilen; iny /= ilen;
    const inset = depth * 0.24;
    const hPos = f => ({ x: A.x + (B.x - A.x) * f + inx * inset, y: A.y + (B.y - A.y) * f + iny * inset });

    // Außen-Richtung (Innenkante/Wand → Mitte → Außenkante). Der orange Move-Griff
    // sitzt auf der Innenkanten-Mitte, daher das Kategorie-Label dorthin NICHT legen.
    const innerEmX = (p0.x + p1.x) / 2, innerEmY = (p0.y + p1.y) / 2;
    let outx = ecx - innerEmX, outy = ecy - innerEmY;
    const olen = Math.hypot(outx, outy) || 1; outx /= olen; outy /= olen;

    const drawEdge = (pos, str, color, font) => {
      const t = svgEl('text', {
        x: pos.x, y: pos.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': font, 'font-family': 'system-ui, sans-serif',
        fill: color, 'font-weight': '700', 'pointer-events': 'none',
        transform: labelRot ? `rotate(${labelRot.toFixed(1)},${pos.x},${pos.y})` : ''
      });
      t.textContent = str;
      g.appendChild(t);
    };

    // Feldlänge mittig.
    const txt = svgEl('text', {
      x: ecx, y: ecy,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': bayFontSize, 'font-family': 'system-ui, sans-serif',
      fill: '#0a2f58', 'font-weight': '700',
      transform: labelRot ? `rotate(${labelRot.toFixed(1)},${ecx},${ecy})` : '',
      'pointer-events': 'none'
    });
    txt.textContent = el.len.toFixed(2);
    g.appendChild(txt);

    // Höhen an den beiden Enden der Unterkante (nur Kategorien mit Höhen).
    const hFont = Math.max(depth * 0.24, 7);
    const hasHeights = cat.measures.includes('hL') && cat.measures.includes('hR');
    if (hasHeights) {
      if (bayData.hL != null) drawEdge(hPos(0.12), '↥ ' + bayData.hL.toFixed(2), '#1f7a3d', hFont);
      if (bayData.hR != null) drawEdge(hPos(0.88), '↥ ' + bayData.hR.toFixed(2), '#1f7a3d', hFont);
    }

    // Kategorie + Nicht-Höhen-Maße – zur Außenkante hin versetzt (über der Länge),
    // damit nichts mit Move-Griff oder Höhen kollidiert.
    const extras = [];
    cat.measures.forEach(k => {
      if (k === 'hL' || k === 'hR') return;
      const v = bayData[k];
      if (v == null) return;
      const md = MEASURE_DEFS[k];
      extras.push(md.sym + ' ' + v.toFixed(md.dec) + ' ' + md.unit);
    });
    const catStr  = [cat.label, ...extras].join('   ·   ');
    const catPos  = { x: ecx + outx * depth * 0.30, y: ecy + outy * depth * 0.30 };
    drawEdge(catPos, catStr, cat.stroke, Math.max(depth * 0.20, 7));
  });

  // 3. Wall lines (schlanke Wandkante – zeigt die Gebäudeseite an)
  els.filter(e => e.type === 'wallLine').forEach(el =>
    g.appendChild(svgEl('line', {
      x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
      stroke: '#5a6b7a', 'stroke-width': 1.5, 'stroke-linecap': 'round'
    }))
  );

  // 5b. Move handles (orange ✥) — always visible, even in PDF mode use pdfMode to skip
  if (!pdfMode) {
    const MOVE_R = Math.round(HANDLE_R * 1.25);
    els.filter(e => e.type === 'moveHandle').forEach(el => {
      const isActive = drag && drag.type === 'move' && drag.si === el.si;

      const hit = svgEl('circle', {
        cx: el.x, cy: el.y, r: MOVE_R * 1.7,
        fill: 'rgba(0,0,0,0.001)', style: 'cursor:move', 'data-si': el.si
      });
      hit.addEventListener('pointerdown', onMoveHandleDown);
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: el.x, cy: el.y, r: MOVE_R,
        fill: isActive ? '#c85000' : '#ff8800',
        stroke: '#fff', 'stroke-width': 2.5, 'pointer-events': 'none'
      }));

      const sym = svgEl('text', {
        x: el.x, y: el.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': Math.round(MOVE_R * 1.1),
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      sym.textContent = '✥';
      g.appendChild(sym);
    });

    // Rotation handles (purple ↻) — nur für die ausgewählte Sektion
    const ROT_R     = Math.round(HANDLE_R * 0.85);
    const movingNow0 = drag && (drag.type === 'move' || drag.type === 'resize');
    els.filter(e => e.type === 'rotateHandle' && e.si === selectedSi && !movingNow0).forEach(el => {
      const isActive = drag && drag.type === 'rotate' && drag.si === el.si;

      // Verbindungslinie vom Sektionsende zum Drehgriff
      const sec = state.sections[el.si];
      const end = sectionEnd(sec);
      g.appendChild(svgEl('line', {
        x1: end.x, y1: end.y, x2: el.x, y2: el.y,
        stroke: '#8e44ec', 'stroke-width': 2, 'stroke-dasharray': '4 4',
        'pointer-events': 'none'
      }));

      const hit = svgEl('circle', {
        cx: el.x, cy: el.y, r: ROT_R * 2.8,
        fill: 'rgba(0,0,0,0.001)', style: 'cursor:grab', 'data-si': el.si
      });
      hit.addEventListener('pointerdown', onRotateHandleDown);
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: el.x, cy: el.y, r: ROT_R,
        fill: isActive ? '#6c2bd9' : '#8e44ec',
        stroke: '#fff', 'stroke-width': 2.5, 'pointer-events': 'none'
      }));

      const sym = svgEl('text', {
        x: el.x, y: el.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': Math.round(ROT_R * 1.15),
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      sym.textContent = '↻';
      g.appendChild(sym);

      // Winkel-Tooltip während des Drehens
      if (isActive) {
        const deg = Math.round(secAngle(sec));
        const bx = el.x, by = el.y - ROT_R * 2.6;
        g.appendChild(svgEl('rect', { x: bx - 30, y: by - 14, width: 60, height: 28, rx: 7, fill: '#6c2bd9', 'pointer-events': 'none' }));
        const bt = svgEl('text', { x: bx, y: by, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 14, 'font-family': 'system-ui, sans-serif', fill: '#fff', 'font-weight': '700', 'pointer-events': 'none' });
        bt.textContent = deg + '°';
        g.appendChild(bt);
      }
    });
  }

  if (pdfMode) { return; }   // PDF: kein Maßstabsbalken (auf Wunsch entfernt)

  // 5. Blaue Schnell-Hinzufügen-Buttons (links / rechts) am ausgewählten Feld.
  //    Ein Klick fügt sofort ein weiteres Feld (Standard 2,57 m) in dieselbe
  //    Laufrichtung an – ohne Dialog. Ersetzt die früheren blauen Zieh-Griffe.
  const busyAdd = drag && (drag.type === 'move' || drag.type === 'rotate' || drag.type === 'resize');
  const selSec  = selectedSi !== null ? state.sections[selectedSi] : null;
  if (selSec && selSec.bays.length && !busyAdd) {
    const dir = secVec(selSec);
    const out = outVec(dir);
    const end = sectionEnd(selSec);
    const EXT_R = Math.round(HANDLE_R * 1.05);
    const axOff = HANDLE_R * 1.7;
    const addPts = [
      { x: selSec.x0 + out.dx * depth / 2 - dir.dx * axOff,
        y: selSec.y0 + out.dy * depth / 2 - dir.dy * axOff, side: 'back' },
      { x: end.x      + out.dx * depth / 2 + dir.dx * axOff,
        y: end.y      + out.dy * depth / 2 + dir.dy * axOff, side: 'fwd'  }
    ];
    addPts.forEach(pt => {
      // Klickfläche: rgba mit minimaler Deckkraft fängt Pointer-Events zuverlässig
      // (transparent-fill ist auf manchen Touch-Geräten unzuverlässig).
      const hit = svgEl('circle', {
        cx: pt.x, cy: pt.y, r: EXT_R * 2.4,
        fill: 'rgba(0,0,0,0.001)', style: 'cursor:pointer', 'data-side': pt.side
      });
      const fireAdd = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        quickExtend(selectedSi, pt.side);
      };
      hit.addEventListener('click', fireAdd);
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: pt.x, cy: pt.y, r: EXT_R,
        fill: '#007aff', stroke: '#fff', 'stroke-width': 2.5, 'pointer-events': 'none'
      }));

      const plus = svgEl('text', {
        x: pt.x, y: pt.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': Math.round(EXT_R * 1.25),
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      plus.textContent = '+';
      g.appendChild(plus);
    });
  }

  // (Die früheren grünen „+"-Buttons an den Verbindungsstellen wurden entfernt.
  //  Neue Felder werden über die blauen „+"-Punkte links/rechts hinzugefügt.)

  // 7. Andock-Vorschau (während des Verschiebens)
  drawMovePreview(g);

  // 8. Scale bar
  drawScaleBar(g, minX, minY, vw, vh, infoFontSize);
}

/** Grün gestrichelte Vorschau am Andockziel + hervorgehobener Andockpunkt. */
function drawMovePreview(g) {
  if (!movePreview) return;

  movePreview.polys.forEach(poly => {
    g.appendChild(svgEl('polygon', {
      points: ptsStr(poly),
      fill: 'rgba(52,199,89,0.16)',
      stroke: '#28a745', 'stroke-width': 3,
      'stroke-dasharray': '9 6', 'stroke-linejoin': 'round',
      'pointer-events': 'none'
    }));
  });

  const a = movePreview.anchor;
  g.appendChild(svgEl('circle', {
    cx: a.x, cy: a.y, r: 14,
    fill: 'rgba(40,167,69,0.20)', stroke: '#28a745', 'stroke-width': 3,
    'pointer-events': 'none'
  }));
  g.appendChild(svgEl('circle', {
    cx: a.x, cy: a.y, r: 5, fill: '#28a745',
    stroke: '#fff', 'stroke-width': 1.5, 'pointer-events': 'none'
  }));
}

function drawScaleBar(g, minX, minY, vw, vh, fontSize) {
  const barLen = 5 * PX_PER_M;
  const bx = minX + vw * 0.04;
  const by = minY + vh - (vh * 0.05);
  const tickH = 8;
  g.appendChild(svgEl('rect', { x: bx - 8, y: by - fontSize - 6, width: barLen + 16, height: fontSize + tickH + 12, fill: 'rgba(255,255,255,0.82)', rx: 4 }));
  g.appendChild(svgEl('line', { x1: bx, y1: by, x2: bx + barLen, y2: by, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx, y1: by - tickH, x2: bx, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx + barLen, y1: by - tickH, x2: bx + barLen, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));
  const lbl = svgEl('text', { x: bx + barLen / 2, y: by - tickH - 2, 'text-anchor': 'middle', 'font-size': fontSize, 'font-family': 'system-ui, sans-serif', fill: '#333', 'font-weight': '600' });
  lbl.textContent = '5,00 m';
  g.appendChild(lbl);
}

// ── Drag handlers ──────────────────────────────────────────────────────────

/**
 * Schnell-Hinzufügen über die blauen +-Buttons: hängt ein eigenständiges,
 * einzeln verschiebbares Feld (Standard 2,57 m) in Laufrichtung an das
 * ausgewählte Feld an – vorwärts (`fwd`) oder rückwärts (`back`).
 */
function quickExtend(si, side) {
  const sec = state.sections[si];
  if (!sec || !sec.bays.length) return;
  const len   = 2.57;
  const dir   = secVec(sec);
  const pxLen = len * PX_PER_M;

  let x0, y0;
  if (side === 'fwd') {
    const end = sectionEnd(sec);
    x0 = end.x; y0 = end.y;
  } else {
    x0 = sec.x0 - dir.dx * pxLen;
    y0 = sec.y0 - dir.dy * pxLen;
  }

  const ns = mkSection(sec.dir, x0, y0);
  setSectionAngle(ns, secAngle(sec));
  ns.bays.push(mkBay(len));
  state.sections.push(ns);
  selectedSi = state.sections.length - 1;   // neues Feld direkt auswählen
  renderAll();
}

function onRotateHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const si  = parseInt(e.currentTarget.dataset.si);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  selectedSi = si;
  drag = {
    type: 'rotate', si,
    startAngle: secAngle(state.sections[si]),
    moved: false
  };
}

function onMoveHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const si  = parseInt(e.currentTarget.dataset.si);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  selectedSi = si;
  const sec = state.sections[si];
  drag = {
    type: 'move', si,
    startX0: sec.x0,
    startY0: sec.y0,
    startPt: screenToSvg(e.clientX, e.clientY),
    moved:   false,
    snap:    null,
    // Andockpunkte einmalig vorberechnen → flüssig & ohne Verzögerung beim Ziehen
    localAnchors:  sectionLocalAnchors(sec),
    targetAnchors: collectTargetAnchors(si)
  };
  movePreview = null;
}

function onSvgPointerMove(e) {
  if (!drag) return;
  const pt = screenToSvg(e.clientX, e.clientY);

  if (drag.type === 'rotate') {
    const sec = state.sections[drag.si];
    // Winkel vom Sektionsanfang zum Finger – Sektion zeigt zum Finger
    let deg = Math.atan2(pt.y - sec.y0, pt.x - sec.x0) * 180 / Math.PI;
    if (snapEnabled) deg = snapAngle(deg);   // bei Magnet aus → frei drehbar
    setSectionAngle(sec, deg);
    drag.moved = true;
    syncRotSheet(sec);
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { renderSvg(); rafPending = false; }); }
    return;
  }

  if (drag.type === 'move') {
    const dx = pt.x - drag.startPt.x;
    const dy = pt.y - drag.startPt.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    const sec = state.sections[drag.si];
    let rawX = drag.startX0 + dx, rawY = drag.startY0 + dy;

    if (snapEnabled) {
      // sanftes Grundraster, dann nächstgelegene gültige Andockstelle suchen
      const g = gridSnapPos(rawX, rawY);
      rawX = g.x; rawY = g.y;
      const threshold = SNAP_SCREEN_PX * worldPerScreenPx();
      drag.snap = findSnap(sec, rawX, rawY, drag.si, threshold);
      movePreview = drag.snap
        ? { polys: sectionBayPolys(sec, drag.snap.x0, drag.snap.y0), anchor: drag.snap.anchor }
        : null;
    } else {
      drag.snap = null;
      movePreview = null;
    }

    // Feld folgt frei dem Finger; das endgültige Einrasten passiert erst beim Loslassen.
    sec.x0 = rawX; sec.y0 = rawY;

    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { renderSvg(); rafPending = false; }); }
    return;
  }

  const dPx = (pt.x - drag.startPt.x) * drag.dir.dx
            + (pt.y - drag.startPt.y) * drag.dir.dy;
  if (Math.abs(dPx) > 5) drag.moved = true;
  const newLen = snapLen(drag.startLen + dPx / PX_PER_M);
  if (newLen !== state.sections[drag.si].bays[drag.bi].len) {
    state.sections[drag.si].bays[drag.bi].len = newLen;
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { renderSvg(); rafPending = false; }); }
  }
}

function onSvgPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.type === 'rotate') {
    renderAll();
    return;
  }
  if (d.type === 'move') {
    const sec = state.sections[d.si];
    if (d.moved) {
      if (d.snap) {
        // pixelgenau an der hervorgehobenen Andockstelle einrasten
        sec.x0 = d.snap.x0; sec.y0 = d.snap.y0;
      } else if (sectionOverlaps(sec, sec.x0, sec.y0, d.si)) {
        // freie Platzierung würde überlappen → zurück an die Ausgangsposition
        sec.x0 = d.startX0; sec.y0 = d.startY0;
      }
    }
    movePreview = null;
    renderAll();
    return;
  }
  if (!d.moved) openEditSheet(d.si, d.bi);
  else renderAll();
}

// ── Add field sheet (direction + size) ────────────────────────────────────

function openAddSheet() {
  closeSheet();
  pendingLen = null;

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', () => { addCtx = null; closeSheet(); });

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  sheet.innerHTML = `
    <div class="sheet-header">Feld hinzufügen${addCtxDirFixed ? ' &ndash; ' + DIR_META[pendingDir].label : ''}</div>

    ${!addCtxDirFixed ? `
    <div class="sheet-section-label">Richtung</div>
    <div class="sheet-dir-row" id="sheetDirRow">
      ${Object.entries(DIR_META).map(([d, m]) =>
        `<button class="dir-big-btn${pendingDir === d ? ' active' : ''}" data-dir="${d}">${m.label}</button>`
      ).join('')}
    </div>
    ` : ''}

    <div class="sheet-section-label">Feldlänge</div>
    <div class="sheet-std-btns" id="sheetSizeBtns">
      ${FIELD_PRESETS.map(l =>
        `<button class="std-btn" data-len="${l}">${l.toFixed(2)}&thinsp;m</button>`
      ).join('')}
    </div>
    <div class="sheet-adj-row">
      <button class="adj-btn" id="sheetMinus">−</button>
      <input type="number" class="sheet-inp" id="sheetCustomInp"
             placeholder="Eigenes Maß" min="0.25" step="0.01" inputmode="decimal" />
      <button class="adj-btn" id="sheetPlus">+</button>
    </div>

    <div class="sheet-actions">
      <button class="sheet-del" id="sheetCancelBtn">Abbrechen</button>
      <button class="sheet-ok" id="sheetAddBtn" disabled>Hinzufügen</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  // Direction buttons
  sheet.querySelectorAll('.dir-big-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDir = btn.dataset.dir;
      sheet.querySelectorAll('.dir-big-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.dir === pendingDir)
      );
    });
  });

  const addBtn    = document.getElementById('sheetAddBtn');
  const customInp = document.getElementById('sheetCustomInp');

  const selectLen = len => {
    pendingLen = len;
    customInp.value = len.toFixed(2);
    sheet.querySelectorAll('.std-btn').forEach(b =>
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.len) - len) < 0.001)
    );
    addBtn.disabled = false;
  };

  sheet.querySelectorAll('.std-btn').forEach(btn =>
    btn.addEventListener('click', () => selectLen(parseFloat(btn.dataset.len)))
  );

  document.getElementById('sheetMinus').addEventListener('click', () => {
    const v = parseFloat(customInp.value) || 2.57;
    selectLen(Math.max(0.25, +(v - 0.25).toFixed(2)));
  });
  document.getElementById('sheetPlus').addEventListener('click', () => {
    const v = parseFloat(customInp.value) || 2.57;
    selectLen(+(v + 0.25).toFixed(2));
  });
  customInp.addEventListener('input', () => {
    const v = parseFloat(customInp.value);
    if (v >= 0.25) {
      pendingLen = +v.toFixed(2);
      sheet.querySelectorAll('.std-btn').forEach(b =>
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.len) - pendingLen) < 0.001)
      );
      addBtn.disabled = false;
    }
  });

  addBtn.addEventListener('click', () => {
    if (!pendingLen) return;
    commitAddField(pendingDir, pendingLen);
    closeSheet();
  });
  document.getElementById('sheetCancelBtn').addEventListener('click', () => {
    addCtx = null;
    closeSheet();
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
}

/**
 * Fügt ein neues Feld hinzu. Jedes Feld ist eine EIGENSTÄNDIGE Sektion mit
 * genau einem Bay – es gibt keine fest verbundenen Gruppen mehr, jedes Feld
 * lässt sich einzeln verschieben, drehen und löschen.
 */
function commitAddField(dir, len) {
  const newBay = mkBay(len);
  const d = DIR_META[dir];
  const pxLen = len * PX_PER_M;

  let startX, startY;

  if (addCtx) {
    startX = addCtx.x; startY = addCtx.y;

    // Zeigt die Richtung in ein Feld, das hier STARTET? → neues Feld davor setzen
    const matchStart = state.sections.find(s =>
      s.dir === dir &&
      Math.abs(s.x0 - addCtx.x) < 2 && Math.abs(s.y0 - addCtx.y) < 2
    );
    if (matchStart) { startX = addCtx.x - d.dx * pxLen; startY = addCtx.y - d.dy * pxLen; }

  } else if (state.sections.length === 0) {
    startX = 0; startY = 0;

  } else {
    // FAB: am Ende des zuletzt angelegten Feldes anhängen (eigenständig)
    const end = sectionEnd(state.sections[state.sections.length - 1]);
    startX = end.x; startY = end.y;
  }

  const sec = mkSection(dir, startX, startY);
  sec.bays.push(newBay);
  state.sections.push(sec);
  selectedSi = state.sections.length - 1;
  addCtx = null;
  renderAll();
}

// ── Edit field sheet (existing bay) ───────────────────────────────────────

function openEditSheet(si, bi) {
  closeSheet();
  const sec = state.sections[si];
  const bay = sec && sec.bays[bi];
  if (!sec || !bay) return;

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', () => { renderAll(); closeSheet(); });

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = `Feld ${sec.name}`;

  // Direction row (always shown – essential on iPhone where side panel is hidden)
  const dirRow = document.createElement('div');
  dirRow.className = 'sheet-dir-row';
  Object.entries(DIR_META).forEach(([dk, dm]) => {
    const btn = document.createElement('button');
    btn.className = 'dir-big-btn' + (sec.dir === dk ? ' active' : '');
    btn.dataset.dir = dk;
    btn.textContent = dm.label;
    btn.addEventListener('click', () => {
      setSectionAngle(sec, DIR_TO_ANGLE[dk]);
      dirRow.querySelectorAll('.dir-big-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.dir === dk)
      );
      syncRotSheet(sec);
      renderSvg();
    });
    dirRow.appendChild(btn);
  });

  // Standard size buttons
  const stdDiv = document.createElement('div');
  stdDiv.className = 'sheet-std-btns';
  FIELD_PRESETS.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'std-btn' + (Math.abs(bay.len - l) < 0.001 ? ' active' : '');
    btn.textContent = l.toFixed(2) + ' m';
    btn.addEventListener('click', () => { bay.len = l; renderAll(); closeSheet(); });
    stdDiv.appendChild(btn);
  });

  // +/- row
  const adjRow = document.createElement('div');
  adjRow.className = 'sheet-adj-row';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'adj-btn'; minusBtn.textContent = '−';

  const inp = document.createElement('input');
  inp.type = 'number'; inp.className = 'sheet-inp';
  inp.value = bay.len.toFixed(2); inp.min = '0.25'; inp.step = '0.25'; inp.inputMode = 'decimal';

  const plusBtn = document.createElement('button');
  plusBtn.className = 'adj-btn'; plusBtn.textContent = '+';

  const syncInp = () => { inp.value = bay.len.toFixed(2); renderSvg(); };
  minusBtn.addEventListener('click', () => { bay.len = Math.max(0.25, +(bay.len - 0.25).toFixed(2)); syncInp(); });
  plusBtn.addEventListener('click',  () => { bay.len = +(bay.len + 0.25).toFixed(2); syncInp(); });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (v >= 0.25) { bay.len = +v.toFixed(2); renderSvg(); }
  });

  adjRow.appendChild(minusBtn); adjRow.appendChild(inp); adjRow.appendChild(plusBtn);

  // ── Drehung (Rotation) ──────────────────────────────────────────────────
  const rotLabel = document.createElement('div');
  rotLabel.className = 'sheet-section-label sheet-rot-label';
  rotLabel.innerHTML = `Drehung <span id="rotReadout" class="rot-readout">${Math.round(secAngle(sec))}°</span>`;

  const rotRow = document.createElement('div');
  rotRow.className = 'sheet-rot-row';

  const rotMinus = document.createElement('button');
  rotMinus.className = 'rot-step'; rotMinus.type = 'button'; rotMinus.textContent = '↺';
  rotMinus.title = '15° gegen den Uhrzeigersinn';

  const rotSlider = document.createElement('input');
  rotSlider.type = 'range'; rotSlider.className = 'rot-slider'; rotSlider.id = 'rotSlider';
  rotSlider.min = '0'; rotSlider.max = '359'; rotSlider.step = '1';
  rotSlider.value = String(Math.round(secAngle(sec)));

  const rotPlus = document.createElement('button');
  rotPlus.className = 'rot-step'; rotPlus.type = 'button'; rotPlus.textContent = '↻';
  rotPlus.title = '15° im Uhrzeigersinn';

  const applyRot = deg => {
    if (snapEnabled) deg = snapAngle(deg);
    setSectionAngle(sec, deg);
    syncRotSheet(sec);
    renderSvg();
  };
  rotSlider.addEventListener('input', () => applyRot(parseFloat(rotSlider.value)));
  rotMinus.addEventListener('click', () => applyRot(secAngle(sec) - 15));
  rotPlus.addEventListener('click',  () => applyRot(secAngle(sec) + 15));

  rotRow.appendChild(rotMinus); rotRow.appendChild(rotSlider); rotRow.appendChild(rotPlus);

  // Drei feste Drehoptionen (90° / 180° / 270°): drehen das Feld in festen
  // Schritten weiter und rasten sauber auf ein Vielfaches von 90° ein. Die freie
  // Drehung bleibt über Schieberegler/Drehgriff möglich (Snapping wie beim Magnet).
  const rotPresets = document.createElement('div');
  rotPresets.className = 'sheet-rot-presets';
  const rotateBy = step => {
    let a = normDeg(secAngle(sec) + step);
    a = (Math.round(a / 90) * 90) % 360;   // sauber auf 90°-Schritt einrasten
    setSectionAngle(sec, a);
    syncRotSheet(sec);
    renderSvg();
  };
  [90, 180, 270].forEach(step => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rot-preset';
    b.textContent = '↻ ' + step + '°';
    b.title = 'Feld um ' + step + '° drehen';
    b.addEventListener('click', () => rotateBy(step));
    rotPresets.appendChild(b);
  });

  // ── Kategorie ───────────────────────────────────────────────────────────
  const catLabel = document.createElement('div');
  catLabel.className = 'sheet-section-label';
  catLabel.textContent = 'Kategorie';

  const catSel = document.createElement('select');
  catSel.className = 'sheet-cat-select';
  FIELD_CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = c.label;
    if ((bay.category || 'geruest') === c.key) o.selected = true;
    catSel.appendChild(o);
  });

  // ── Maße (kategorie-spezifisch) ─────────────────────────────────────────
  const measLabel = document.createElement('div');
  measLabel.className = 'sheet-section-label';
  measLabel.textContent = 'Maße';

  const measWrap = document.createElement('div');
  measWrap.className = 'sheet-measures';

  const buildMeasures = () => {
    measWrap.innerHTML = '';
    const cat = catOf(bay);
    const hasHeights = cat.measures.includes('hL') && cat.measures.includes('hR');

    if (hasHeights) {
      const hRow = document.createElement('div');
      hRow.className = 'sheet-height-row';

      const makeHeightField = (labelTxt, key) => {
        const field = document.createElement('div');
        field.className = 'height-field';
        const lab = document.createElement('span');
        lab.className = 'height-label';
        lab.textContent = labelTxt;
        const hInp = document.createElement('input');
        hInp.type = 'number'; hInp.className = 'height-inp';
        hInp.placeholder = '–'; hInp.min = '0'; hInp.step = '0.05'; hInp.inputMode = 'decimal';
        hInp.value = bay[key] == null ? '' : bay[key].toFixed(2);
        hInp.addEventListener('input', () => {
          const v = parseFloat(hInp.value);
          bay[key] = (isNaN(v) || v < 0) ? null : +v.toFixed(2);
          renderSvg();
        });
        field.appendChild(lab); field.appendChild(hInp);
        return { field, input: hInp };
      };

      const left  = makeHeightField('Höhe links',  'hL');
      const right = makeHeightField('Höhe rechts', 'hR');

      const eqBtn = document.createElement('button');
      eqBtn.className = 'height-eq'; eqBtn.type = 'button';
      eqBtn.title = 'Beide Höhen gleich setzen';
      eqBtn.textContent = '=';
      eqBtn.addEventListener('click', () => {
        const src = bay.hL != null ? bay.hL : bay.hR;
        if (src == null) return;
        bay.hL = src; bay.hR = src;
        left.input.value  = src.toFixed(2);
        right.input.value = src.toFixed(2);
        renderSvg();
      });

      hRow.appendChild(left.field); hRow.appendChild(eqBtn); hRow.appendChild(right.field);
      measWrap.appendChild(hRow);
    }

    // Weitere Einzelmaße (Breite / Fläche / Anzahl)
    cat.measures.forEach(k => {
      if (k === 'hL' || k === 'hR') return;
      const md = MEASURE_DEFS[k];
      const field = document.createElement('div');
      field.className = 'measure-field';
      const lab = document.createElement('span');
      lab.className = 'measure-label';
      lab.textContent = md.label + ' (' + md.unit + ')';
      const mInp = document.createElement('input');
      mInp.type = 'number'; mInp.className = 'measure-inp';
      mInp.placeholder = '–'; mInp.min = '0';
      mInp.step = (k === 'anzahl') ? '1' : '0.05';
      mInp.inputMode = (k === 'anzahl') ? 'numeric' : 'decimal';
      mInp.value = bay[k] == null ? '' : bay[k].toFixed(md.dec);
      mInp.addEventListener('input', () => {
        const v = parseFloat(mInp.value);
        bay[k] = (isNaN(v) || v < 0) ? null : +v.toFixed(md.dec);
        renderSvg();
      });
      field.appendChild(lab); field.appendChild(mInp);
      measWrap.appendChild(field);
    });
  };

  catSel.addEventListener('change', () => {
    bay.category = catSel.value;
    buildMeasures();
    renderSvg();
  });
  buildMeasures();

  // Actions
  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';

  const delBtn = document.createElement('button');
  delBtn.className = 'sheet-del'; delBtn.textContent = 'Feld löschen';
  delBtn.addEventListener('click', () => {
    sec.bays.splice(bi, 1);
    if (sec.bays.length === 0) state.sections.splice(si, 1);
    renderAll(); closeSheet();
  });

  const addAfterBtn = document.createElement('button');
  addAfterBtn.className = 'sheet-add'; addAfterBtn.textContent = '+ Feld danach';
  addAfterBtn.addEventListener('click', () => {
    const end = sectionEnd(sec);
    const ns = mkSection(sec.dir, end.x, end.y);
    setSectionAngle(ns, secAngle(sec));
    ns.bays.push(mkBay(bay.len));
    state.sections.splice(si + 1, 0, ns);
    selectedSi = si + 1;
    renderAll(); closeSheet();
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'sheet-ok'; okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });

  actRow.appendChild(delBtn); actRow.appendChild(addAfterBtn); actRow.appendChild(okBtn);

  sheet.appendChild(hdr);
  sheet.appendChild(catLabel);
  sheet.appendChild(catSel);
  sheet.appendChild(dirRow);
  sheet.appendChild(stdDiv);
  sheet.appendChild(adjRow);
  sheet.appendChild(rotLabel);
  sheet.appendChild(rotRow);
  sheet.appendChild(rotPresets);
  sheet.appendChild(measLabel);
  sheet.appendChild(measWrap);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/** Hält Drehregler/Anzeige und Richtungs-Buttons der offenen Bearbeitung synchron. */
function syncRotSheet(sec) {
  const sheet = document.getElementById('bottomSheet');
  if (!sheet) return;
  const deg = Math.round(secAngle(sec));
  const sl = sheet.querySelector('#rotSlider');
  const rd = sheet.querySelector('#rotReadout');
  if (sl && document.activeElement !== sl) sl.value = String(deg);
  if (rd) rd.textContent = deg + '°';
  sheet.querySelectorAll('.dir-big-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.dir === sec.dir)
  );
}

function closeSheet() {
  addCtxDirFixed = false;
  document.getElementById('sheetOverlay')?.remove();
  const s = document.getElementById('bottomSheet');
  if (!s) return;
  s.classList.remove('open');
  setTimeout(() => s.remove(), 230);
}

// ── Side panel ─────────────────────────────────────────────────────────────

function renderSections() {
  const container = document.getElementById('sectionsContainer');
  const hint      = document.getElementById('noSectionsHint');
  container.innerHTML = '';

  if (!state.sections.length) { hint.classList.remove('hidden'); return; }
  hint.classList.add('hidden');

  state.sections.forEach((sec, si) => {
    const card = document.createElement('div');
    card.className = 'section-card';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'sec-hdr';

    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'sec-name'; nameIn.value = sec.name;
    nameIn.addEventListener('input', e => { sec.name = e.target.value; renderSvg(); });

    const rmSec = document.createElement('button');
    rmSec.className = 'remove-btn small'; rmSec.textContent = '×';
    rmSec.addEventListener('click', () => { state.sections.splice(si, 1); renderAll(); });

    hdr.appendChild(nameIn); hdr.appendChild(rmSec);

    // Direction
    const dirRow = document.createElement('div');
    dirRow.className = 'dir-row';
    Object.keys(DIR_META).forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'dir-btn' + (sec.dir === d ? ' active' : '');
      btn.textContent = DIR_META[d].label;
      btn.addEventListener('click', () => { setSectionAngle(sec, DIR_TO_ANGLE[d]); renderAll(); });
      dirRow.appendChild(btn);
    });

    // Total
    const totEl = document.createElement('div');
    totEl.className = 'sec-total';
    const total = sec.bays.reduce((s, b) => s + b.len, 0);
    const angDeg = Math.round(secAngle(sec));
    const angTxt = ROT_SNAP_ANGLES.includes(angDeg) ? '' : `  ·  ${angDeg}°`;
    totEl.textContent = `${DIR_META[sec.dir].label}${angTxt}  ·  ${total.toFixed(2)} m  (${sec.bays.length} Felder)`;

    // Bay list
    const baysDiv = document.createElement('div');
    baysDiv.className = 'bays-div';
    sec.bays.forEach((bay, bi) => {
      const cat = catOf(bay);
      const row = document.createElement('div');
      row.className = 'bay-row';
      // Farbiger Kategorie-Streifen links → Kategorie auf einen Blick erkennbar
      row.style.borderLeft = `4px solid ${cat.stroke}`;

      // Zeile 1: Nummer · Kategorie-Auswahl · Löschen
      const top = document.createElement('div');
      top.className = 'bay-row-top';

      const num = document.createElement('span');
      num.className = 'bay-num'; num.textContent = `F${bi + 1}`;

      const catSel = document.createElement('select');
      catSel.className = 'bay-cat-select';
      catSel.style.color = cat.stroke;
      FIELD_CATEGORIES.forEach(c => {
        const o = document.createElement('option');
        o.value = c.key; o.textContent = c.label;
        if ((bay.category || 'geruest') === c.key) o.selected = true;
        catSel.appendChild(o);
      });
      catSel.addEventListener('change', () => { bay.category = catSel.value; renderAll(); });

      const rmBay = document.createElement('button');
      rmBay.className = 'remove-btn small'; rmBay.textContent = '×';
      rmBay.addEventListener('click', () => { sec.bays.splice(bi, 1); renderAll(); });

      top.appendChild(num); top.appendChild(catSel); top.appendChild(rmBay);

      // Zeile 2: Längen-Eingabe · Schnellwahl
      const bottom = document.createElement('div');
      bottom.className = 'bay-row-bottom';

      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'bay-inp';
      inp.value = bay.len.toFixed(2); inp.min = '0.01'; inp.step = '0.01';
      inp.addEventListener('input', e => { bay.len = +parseFloat(e.target.value || 0).toFixed(2); renderSvg(); });

      const qd = document.createElement('div');
      qd.className = 'quick-btns';
      FIELD_PRESETS.forEach(l => {
        const qb = document.createElement('button');
        qb.className = 'quick-btn'; qb.textContent = l.toFixed(2);
        qb.addEventListener('click', () => { bay.len = l; inp.value = l.toFixed(2); renderSvg(); });
        qd.appendChild(qb);
      });

      bottom.appendChild(inp); bottom.appendChild(qd);

      row.appendChild(top); row.appendChild(bottom);
      baysDiv.appendChild(row);
    });

    // Add bay button
    const addBayBtn = document.createElement('button');
    addBayBtn.className = 'add-bay'; addBayBtn.textContent = '+ Feld';
    addBayBtn.addEventListener('click', () => {
      const end = sectionEnd(sec);
      const ns = mkSection(sec.dir, end.x, end.y);
      setSectionAngle(ns, secAngle(sec));
      ns.bays.push(mkBay(sec.bays[sec.bays.length - 1]?.len ?? 2.57));
      state.sections.splice(si + 1, 0, ns);
      selectedSi = si + 1;
      renderAll();
    });

    card.appendChild(hdr); card.appendChild(dirRow); card.appendChild(totEl);
    card.appendChild(baysDiv); card.appendChild(addBayBtn);
    container.appendChild(card);
  });
}

function renderAll() { renderSections(); renderSvg(); }

// ── Preset layouts ─────────────────────────────────────────────────────────

/**
 * Baut eine Kette aus EIGENSTÄNDIGEN Feldern (je Feld eine Single-Bay-Sektion).
 * Jedes Feld bleibt einzeln verschieb- und löschbar; Eckstücke entstehen
 * automatisch dort, wo zwei Felder einen Außenwinkel bilden.
 * @param {Array<{dir:string,len:number,name?:string}>} defs
 */
function buildFieldChain(defs) {
  selectedSi = null; _sId = 0; _bId = 0;
  let x = 0, y = 0;
  state.sections = defs.map(def => {
    const s = mkSection(def.dir, x, y);
    if (def.name) s.name = def.name;
    s.bays.push(mkBay(def.len));
    const e = sectionEnd(s); x = e.x; y = e.y;
    return s;
  });
  renderAll();
}

/** Erzeugt Feld-Definitionen für eine Wand aus mehreren Längen. */
function wall(dir, lens, prefix) {
  return lens.map((l, i) => ({ dir, len: l, name: `${prefix} ${i + 1}` }));
}

function applyLShape() {
  buildFieldChain([
    ...wall('S', [2.57, 2.57, 2.57, 2.57, 3.07], 'Ost'),
    ...wall('W', [3.07, 3.07], 'Süd')
  ]);
}

function applyUShape() {
  buildFieldChain([
    ...wall('S', [2.57, 2.57, 3.07], 'Ost'),
    ...wall('W', [3.07, 2.57, 3.07], 'Süd'),
    ...wall('N', [3.07, 2.57, 2.57], 'West')
  ]);
}

function applyRect() {
  buildFieldChain([
    ...wall('S', [3.07, 2.57, 2.57, 3.07], 'Vorne'),
    ...wall('W', [3.07, 2.57, 2.57, 3.07], 'Rechts'),
    ...wall('N', [3.07, 2.57, 2.57, 3.07], 'Hinten'),
    ...wall('E', [3.07, 2.57, 2.57, 3.07], 'Links')
  ]);
}

// ── Save / Load ────────────────────────────────────────────────────────────

function savePlan() {
  const payload = JSON.stringify({ version: 2, state, _sId, _bId });
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.project || 'gerüstplan'}_2d.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function triggerLoad() { document.getElementById('loadFileInput').click(); }

function onLoadFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      const s = d.state || d;
      state.project  = s.project  || '';
      state.depth    = s.depth    || 0.73;
      // Migrate v1 saves (no x0/y0): reconstruct chain positions
      let cx = 0, cy = 0;
      state.sections = (s.sections || []).map(sec => {
        if (sec.x0 == null) {
          const result = { ...sec, x0: cx, y0: cy };
          const dir = DIR_META[sec.dir];
          sec.bays.forEach(b => { cx += dir.dx * b.len * PX_PER_M; cy += dir.dy * b.len * PX_PER_M; });
          return result;
        }
        return { ...sec };
      });
      _sId = d._sId || state.sections.length;
      _bId = d._bId || state.sections.flatMap(x => x.bays).length;
      document.getElementById('projectName').value = state.project;
      document.getElementById('scaffDepth').value  = state.depth;
      renderAll();
    } catch { alert('Fehler beim Laden: Ungültige Datei.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── PDF Export ─────────────────────────────────────────────────────────────

async function exportPdf() {
  const prevSelected = selectedSi;
  selectedSi = null;
  pdfMode    = true;
  renderSvg();
  try {

  const { jsPDF } = window.jspdf;
  const svg = document.getElementById('planSvg');
  const vb  = svg.viewBox.baseVal;
  const svgW = vb.width || 800, svgH = vb.height || 600;
  const scale = 3;
  const cW = Math.round(svgW * scale), cH = Math.round(svgH * scale);

  const serializer = new XMLSerializer();
  let svgStr = serializer.serializeToString(svg);
  svgStr = svgStr.replace(/(<svg[^>]*?)(\s*\bwidth\s*=\s*["'][^"']*["'])?(\s*\bheight\s*=\s*["'][^"']*["'])?/,
    `$1 width="${cW}" height="${cH}"`);

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const img  = new Image(cW, cH);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

  const canvas = document.createElement('canvas');
  canvas.width = cW; canvas.height = cH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cW, cH);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  const imgData = canvas.toDataURL('image/png');
  const orient  = cW > cH ? 'landscape' : 'portrait';
  const doc     = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
  const pdfW    = orient === 'landscape' ? 297 : 210;
  const pdfH    = orient === 'landscape' ? 210 : 297;
  const margin  = 10, titleH = 20;
  const availW  = pdfW - 2 * margin, availH = pdfH - margin - titleH - margin;
  const ratio   = Math.min(availW / (cW / (96 / 25.4)), availH / (cH / (96 / 25.4)));
  const imgW    = (cW / (96 / 25.4)) * ratio;
  const imgH    = (cH / (96 / 25.4)) * ratio;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(state.project || 'Gerüst 2D-Ansicht', margin, margin + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const totalLen = state.sections
    .reduce((a, s) => a + s.bays.reduce((b, x) => b + x.len, 0), 0);
  doc.text(`Gerüsttiefe: ${state.depth.toFixed(2)} m   |   Gesamtlänge: ${totalLen.toFixed(2)} m`, margin, margin + 12);
  doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, margin, margin + 17);
    doc.addImage(imgData, 'PNG', margin, margin + titleH, imgW, imgH);

    // ── Kategorie-Legende / Positionsübersicht ────────────────────────────
    // Aggregierte Auswertung je Kategorie. Nur ergänzen, wenn mehr als eine
    // Kategorie verwendet wird (sonst bleibt der Plan einseitig).
    const catAgg = {};
    state.sections.forEach(s => s.bays.forEach(b => {
      const c = catOf(b);
      const a = catAgg[c.key] || (catAgg[c.key] = { cat: c, n: 0, len: 0, flaeche: 0, anzahl: 0 });
      a.n++; a.len += b.len;
      if (b.flaeche) a.flaeche += b.flaeche;
      if (b.anzahl)  a.anzahl  += b.anzahl;
    }));
    const aggList = Object.values(catAgg);
    if (aggList.length > 1) {
      const hx = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text('Positionen nach Kategorie', margin, margin + 6);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      let ly = margin + 18;
      aggList.forEach(a => {
        if (ly > pdfH - margin) { doc.addPage(); ly = margin + 10; }
        const [fr, fg, fb] = hx(a.cat.fill);
        const [sr, sg, sb] = hx(a.cat.stroke);
        doc.setFillColor(fr, fg, fb); doc.setDrawColor(sr, sg, sb);
        doc.rect(margin, ly - 4, 5, 5, 'FD');
        let txt = `${a.cat.label}:  ${a.n} Feld${a.n !== 1 ? 'er' : ''}  ·  Länge ${a.len.toFixed(2)} m`;
        if (a.flaeche) txt += `  ·  ${a.flaeche.toFixed(2)} m²`;
        if (a.anzahl)  txt += `  ·  ${a.anzahl} Stk.`;
        doc.setTextColor(20, 20, 20);
        doc.text(txt, margin + 8, ly);
        ly += 8;
      });
    }

    doc.save(`${(state.project || 'gerüstplan').replace(/\s+/g, '_')}_2d.pdf`);
  } finally {
    pdfMode    = false;
    selectedSi = prevSelected;
    renderSvg();
  }
}

// ── Device mode ────────────────────────────────────────────────────────────

function getMode() { return localStorage.getItem('av_deviceMode'); }

function applyMode(m) {
  document.body.dataset.mode = m;
  localStorage.setItem('av_deviceMode', m);
  const btn = document.getElementById('deviceToggleBtn');
  if (btn) btn.textContent = m === 'iphone' ? '📱' : '⬜';
}

function showDevicePicker(onPicked) {
  const ov = document.createElement('div');
  ov.id = 'deviceOverlay';
  ov.innerHTML = `
    <div class="device-picker">
      <div class="device-picker-title">Gerät wählen</div>
      <div class="device-picker-sub">Wie verwenden Sie diese App?</div>
      <div class="device-picker-btns">
        <button class="dev-btn" data-m="ipad">
          <span class="dv-icon">⬜</span>
          <span class="dv-label">iPad</span>
          <span class="dv-desc">Mit Seitenleiste</span>
        </button>
        <button class="dev-btn" data-m="iphone">
          <span class="dv-icon">📱</span>
          <span class="dv-label">iPhone</span>
          <span class="dv-desc">Vollbild-Plan</span>
        </button>
      </div>
      <div class="device-picker-note">Einstellung wird gespeichert – jederzeit per 📱 ändern</div>
    </div>
  `;
  ov.querySelectorAll('.dev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyMode(btn.dataset.m);
      ov.remove();
      if (onPicked) onPicked();
    });
  });
  document.body.appendChild(ov);
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    addCtx = null;
    openAddSheet();
  });
  document.getElementById('emptyAddBtn').addEventListener('click', () => {
    addCtx = null;
    openAddSheet();
  });

  document.getElementById('lShapeBtn').addEventListener('click', applyLShape);
  document.getElementById('uShapeBtn').addEventListener('click', applyUShape);
  document.getElementById('rectBtn').addEventListener('click', applyRect);

  document.getElementById('projectName').addEventListener('input', e => {
    state.project = e.target.value;
  });
  document.getElementById('scaffDepth').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.depth = v; renderSvg(); }
  });

  document.getElementById('savePlanBtn').addEventListener('click', savePlan);
  document.getElementById('loadPlanBtn').addEventListener('click', triggerLoad);
  document.getElementById('loadFileInput').addEventListener('change', onLoadFile);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);

  document.getElementById('deviceToggleBtn').addEventListener('click', () => {
    showDevicePicker(() => renderAll());
  });

  document.getElementById('snapToggleBtn').addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    const btn = document.getElementById('snapToggleBtn');
    btn.classList.toggle('snap-off', !snapEnabled);
    btn.title = snapEnabled ? 'Magnetraster: An – tippen zum Ausschalten' : 'Magnetraster: Aus – tippen zum Einschalten';
  });

  const svg = document.getElementById('planSvg');
  svg.addEventListener('pointermove',   onSvgPointerMove);
  svg.addEventListener('pointerup',     onSvgPointerUp);
  svg.addEventListener('pointercancel', onSvgPointerUp);
  // Tap empty canvas → deselect section (hides + buttons)
  const deselect = () => { if (selectedSi !== null) { selectedSi = null; renderSvg(); } };
  svg.addEventListener('click',       deselect);
  svg.addEventListener('pointerdown', e => { if (e.target === svg || e.target.id === 'gridBg') deselect(); });

  // Device mode: restore saved preference or show picker
  const savedMode = getMode();
  if (savedMode) {
    applyMode(savedMode);
  } else {
    const guess = window.innerWidth <= 430 ? 'iphone' : 'ipad';
    applyMode(guess);
    showDevicePicker(() => renderAll());
  }

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
