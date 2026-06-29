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

const DIR_META = {
  N: { dx:  0, dy: -1, label: 'N ↑' },
  E: { dx:  1, dy:  0, label: 'O →' },
  S: { dx:  0, dy:  1, label: 'S ↓' },
  W: { dx: -1, dy:  0, label: 'W ←' }
};

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

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  return { id: ++_bId, len: +parseFloat(len).toFixed(2) };
}

function mkSection(dir = 'S', x0 = 0, y0 = 0) {
  const id = ++_sId;
  return { id, name: `A${id}`, dir, bays: [], x0, y0 };
}

// ── Geometry helpers ───────────────────────────────────────────────────────

function outVec(dir) { return { dx: dir.dy, dy: -dir.dx }; }

function snapLen(len) {
  const g = Math.round(len / SNAP_STEP) * SNAP_STEP;
  for (const s of FIELD_PRESETS) {
    if (Math.abs(g - s) <= 0.13) return s;
  }
  return Math.max(0.25, +g.toFixed(2));
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
  const dir = DIR_META[sec.dir];
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
  const dotSet = new Set(); // deduplicate junction dots

  state.sections.forEach((sec, si) => {
    const dir    = DIR_META[sec.dir];
    const out    = outVec(dir);
    const isVert = sec.dir === 'N' || sec.dir === 'S';
    let x = sec.x0, y = sec.y0;
    const startX = x, startY = y;

    // ── Start junction ──────────────────────────────────────────────────
    const sk = jKey(x, y);
    if (!dotSet.has(sk)) { dotSet.add(sk); els.push({ type: 'junctionBtn', x, y }); }

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
        si, bi, dir: sec.dir, isVert,
        handleX: (p1.x + p2.x) / 2,
        handleY: (p1.y + p2.y) / 2
      });
      els.push({
        type: 'handle', x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
        len: bay.len, si, bi, isVert
      });

      x += dir.dx * pxLen;
      y += dir.dy * pxLen;

      const ek = jKey(x, y);
      if (!dotSet.has(ek)) { dotSet.add(ek); els.push({ type: 'junctionBtn', x, y }); }
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

      const totalLen = sec.bays.reduce((s, b) => s + b.len, 0);
      const offScale = depth + 14;
      els.push({
        type: 'sectionLabel',
        x: (startX + x) / 2 + out.dx * offScale,
        y: (startY + y) / 2 + out.dy * offScale,
        text: `${sec.name}: ${totalLen.toFixed(2)} m`,
        rotate: isVert ? -90 : 0
      });
    }
  });

  // ── Corner pieces between connected sections ────────────────────────────
  state.sections.forEach((sec, si) => {
    const end = sectionEnd(sec);
    const out = outVec(DIR_META[sec.dir]);
    state.sections.forEach((next, ni) => {
      if (ni === si) return;
      if (Math.abs(next.x0 - end.x) < 2 && Math.abs(next.y0 - end.y) < 2) {
        const nOut  = outVec(DIR_META[next.dir]);
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

  const PAD = depth * 3.5 + HANDLE_R * 5;
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

  // 2. Bay rectangles
  els.filter(e => e.type === 'bay').forEach(el => {
    const poly = svgEl('polygon', {
      points: ptsStr(el.pts), fill: '#deeeff',
      stroke: '#2c6fa8', 'stroke-width': 2, cursor: 'pointer'
    });
    poly.addEventListener('click', () => openEditSheet(el.si, el.bi));
    g.appendChild(poly);

    const txt = svgEl('text', {
      x: el.cx, y: el.cy,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': bayFontSize, 'font-family': 'system-ui, sans-serif',
      fill: '#0a2f58', 'font-weight': '700',
      transform: el.isVert ? `rotate(-90,${el.cx},${el.cy})` : '',
      'pointer-events': 'none'
    });
    txt.textContent = el.len.toFixed(2);
    g.appendChild(txt);
  });

  // 3. Wall lines
  els.filter(e => e.type === 'wallLine').forEach(el =>
    g.appendChild(svgEl('line', {
      x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
      stroke: '#111', 'stroke-width': 3.5, 'stroke-linecap': 'square'
    }))
  );

  // 4. Section labels
  els.filter(e => e.type === 'sectionLabel').forEach(el => {
    const txt = svgEl('text', {
      x: el.x, y: el.y,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': infoFontSize, 'font-family': 'system-ui, sans-serif',
      fill: '#444', 'pointer-events': 'none',
      transform: el.rotate ? `rotate(${el.rotate},${el.x},${el.y})` : ''
    });
    txt.textContent = el.text;
    g.appendChild(txt);
  });

  // 5. Drag handles (blue ↕/↔)
  els.filter(e => e.type === 'handle').forEach(el => {
    const isActive = drag && drag.si === el.si && drag.bi === el.bi;

    const hit = svgEl('circle', {
      cx: el.x, cy: el.y, r: HANDLE_R * 2.2, fill: 'transparent',
      style: 'cursor:grab', 'data-si': el.si, 'data-bi': el.bi
    });
    hit.addEventListener('pointerdown', onHandleDown);
    g.appendChild(hit);

    g.appendChild(svgEl('circle', {
      cx: el.x, cy: el.y, r: HANDLE_R,
      fill: isActive ? '#005bb5' : '#007aff',
      stroke: '#fff', 'stroke-width': 2.5, 'pointer-events': 'none'
    }));

    const arrow = svgEl('text', {
      x: el.x, y: el.y,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': Math.round(HANDLE_R * 1.05),
      'font-family': 'system-ui, sans-serif',
      fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
    });
    arrow.textContent = el.isVert ? '↕' : '↔';
    g.appendChild(arrow);

    if (isActive) {
      const len = state.sections[el.si].bays[el.bi].len;
      const bx = el.x + (el.isVert ?  HANDLE_R * 2.8 : 0);
      const by = el.y + (el.isVert ?  0 : -HANDLE_R * 2.8);
      g.appendChild(svgEl('rect', { x: bx - 34, y: by - 15, width: 68, height: 30, rx: 7, fill: '#111', opacity: '0.88', 'pointer-events': 'none' }));
      const bt = svgEl('text', { x: bx, y: by, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 15, 'font-family': 'system-ui, sans-serif', fill: '#fff', 'font-weight': '700', 'pointer-events': 'none' });
      bt.textContent = len.toFixed(2) + ' m';
      g.appendChild(bt);
    }
  });

  // 5b. Move handles (orange ✥ on wall-line midpoint — drag to reposition section)
  const MOVE_R = Math.round(HANDLE_R * 0.85);
  els.filter(e => e.type === 'moveHandle').forEach(el => {
    const isActive = drag && drag.type === 'move' && drag.si === el.si;

    const hit = svgEl('circle', {
      cx: el.x, cy: el.y, r: MOVE_R * 2.4, fill: 'transparent',
      style: 'cursor:move', 'data-si': el.si
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

  // 6. Junction "+" buttons — 4 directional handles per junction point
  const ADD_R = Math.round(HANDLE_R * 1.2);   // circle radius
  const JOFF  = Math.round(HANDLE_R * 3.0);   // offset from junction centre

  els.filter(e => e.type === 'junctionBtn').forEach(el => {
    // Small dot at the junction itself
    g.appendChild(svgEl('circle', {
      cx: el.x, cy: el.y, r: 5,
      fill: '#34c759', stroke: '#fff', 'stroke-width': 1.5, 'pointer-events': 'none'
    }));

    // One "+" button for each cardinal direction
    Object.entries(DIR_META).forEach(([dKey, d]) => {
      const bx = el.x + d.dx * JOFF;
      const by = el.y + d.dy * JOFF;

      const hit = svgEl('circle', {
        cx: bx, cy: by, r: ADD_R * 2.5, fill: 'transparent', style: 'cursor:pointer'
      });
      hit.addEventListener('click', ev => {
        ev.stopPropagation();
        addCtx         = { x: el.x, y: el.y };
        pendingDir     = dKey;
        addCtxDirFixed = true;
        openAddSheet();
      });
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: bx, cy: by, r: ADD_R,
        fill: '#34c759', stroke: '#fff', 'stroke-width': 2.5, 'pointer-events': 'none'
      }));

      const plus = svgEl('text', {
        x: bx, y: by,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': Math.round(ADD_R * 1.2),
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      plus.textContent = '+';
      g.appendChild(plus);
    });
  });

  // 7. Scale bar
  drawScaleBar(g, minX, minY, vw, vh, infoFontSize);
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

function onHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const si  = parseInt(e.currentTarget.dataset.si);
  const bi  = parseInt(e.currentTarget.dataset.bi);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  drag = {
    type: 'resize', si, bi,
    startLen: state.sections[si].bays[bi].len,
    startPt:  screenToSvg(e.clientX, e.clientY),
    dir:      DIR_META[state.sections[si].dir],
    moved:    false
  };
}

function onMoveHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const si  = parseInt(e.currentTarget.dataset.si);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  drag = {
    type: 'move', si,
    startX0: state.sections[si].x0,
    startY0: state.sections[si].y0,
    startPt: screenToSvg(e.clientX, e.clientY),
    moved:   false
  };
}

function onSvgPointerMove(e) {
  if (!drag) return;
  const pt = screenToSvg(e.clientX, e.clientY);

  if (drag.type === 'move') {
    const dx = pt.x - drag.startPt.x;
    const dy = pt.y - drag.startPt.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const snapPx = SNAP_STEP * PX_PER_M;
    state.sections[drag.si].x0 = Math.round((drag.startX0 + dx) / snapPx) * snapPx;
    state.sections[drag.si].y0 = Math.round((drag.startY0 + dy) / snapPx) * snapPx;
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
  if (d.type === 'move') {
    if (d.moved) renderAll();
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

/** Add a new bay at the current addCtx position (or last section's end). */
function commitAddField(dir, len) {
  const newBay = mkBay(len);
  const d = DIR_META[dir];
  const pxLen = len * PX_PER_M;

  if (addCtx) {
    const jx = addCtx.x, jy = addCtx.y;

    // Case 1: extend a section that ENDS here in the same direction
    const matchEnd = state.sections.find(s => {
      if (s.dir !== dir) return false;
      const e = sectionEnd(s);
      return Math.abs(e.x - jx) < 2 && Math.abs(e.y - jy) < 2;
    });
    if (matchEnd) {
      matchEnd.bays.push(newBay);
      addCtx = null;
      renderAll();
      return;
    }

    // Case 2: a section STARTS here in the same direction → place new field BEFORE it
    const matchStart = state.sections.find(s => {
      if (s.dir !== dir) return false;
      return Math.abs(s.x0 - jx) < 2 && Math.abs(s.y0 - jy) < 2;
    });
    const startX = matchStart ? jx - d.dx * pxLen : jx;
    const startY = matchStart ? jy - d.dy * pxLen : jy;

    const sec = mkSection(dir, startX, startY);
    sec.bays.push(newBay);
    state.sections.push(sec);
    addCtx = null;

  } else if (state.sections.length === 0) {
    // Very first field
    const sec = mkSection(dir, 0, 0);
    sec.bays.push(newBay);
    state.sections.push(sec);

  } else {
    // FAB: append to last section (same dir) or start new section at its end
    const last = state.sections[state.sections.length - 1];
    if (last.dir === dir) {
      last.bays.push(newBay);
    } else {
      const end = sectionEnd(last);
      const sec = mkSection(dir, end.x, end.y);
      sec.bays.push(newBay);
      state.sections.push(sec);
    }
  }

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
  hdr.textContent = `Feld ${bi + 1} – ${sec.name}`;

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
    sec.bays.splice(bi + 1, 0, mkBay(bay.len));
    renderAll(); closeSheet();
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'sheet-ok'; okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });

  actRow.appendChild(delBtn); actRow.appendChild(addAfterBtn); actRow.appendChild(okBtn);

  sheet.appendChild(hdr);
  sheet.appendChild(stdDiv);
  sheet.appendChild(adjRow);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
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
      btn.addEventListener('click', () => { sec.dir = d; renderAll(); });
      dirRow.appendChild(btn);
    });

    // Total
    const totEl = document.createElement('div');
    totEl.className = 'sec-total';
    const total = sec.bays.reduce((s, b) => s + b.len, 0);
    totEl.textContent = `${DIR_META[sec.dir].label}  ·  ${total.toFixed(2)} m  (${sec.bays.length} Felder)`;

    // Bay list
    const baysDiv = document.createElement('div');
    baysDiv.className = 'bays-div';
    sec.bays.forEach((bay, bi) => {
      const row = document.createElement('div');
      row.className = 'bay-row';

      const num = document.createElement('span');
      num.className = 'bay-num'; num.textContent = `F${bi + 1}`;

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

      const rmBay = document.createElement('button');
      rmBay.className = 'remove-btn small'; rmBay.textContent = '×';
      rmBay.addEventListener('click', () => { sec.bays.splice(bi, 1); renderAll(); });

      row.appendChild(num); row.appendChild(inp); row.appendChild(qd); row.appendChild(rmBay);
      baysDiv.appendChild(row);
    });

    // Add bay button
    const addBayBtn = document.createElement('button');
    addBayBtn.className = 'add-bay'; addBayBtn.textContent = '+ Feld';
    addBayBtn.addEventListener('click', () => {
      const end = sectionEnd(sec);
      addCtx = { x: end.x, y: end.y };
      pendingDir = sec.dir;
      openAddSheet();
    });

    card.appendChild(hdr); card.appendChild(dirRow); card.appendChild(totEl);
    card.appendChild(baysDiv); card.appendChild(addBayBtn);
    container.appendChild(card);
  });
}

function renderAll() { renderSections(); renderSvg(); }

// ── Preset layouts ─────────────────────────────────────────────────────────

function applyLShape() {
  _sId = 0; _bId = 0;
  const s1 = mkSection('S', 0, 0); s1.name = 'Ostseite';
  s1.bays = [mkBay(2.57), mkBay(2.57), mkBay(2.57), mkBay(2.57), mkBay(3.07)];
  const e1 = sectionEnd(s1);
  const s2 = mkSection('W', e1.x, e1.y); s2.name = 'Südseite';
  s2.bays = [mkBay(3.07), mkBay(3.07)];
  state.sections = [s1, s2]; renderAll();
}

function applyUShape() {
  _sId = 0; _bId = 0;
  const s1 = mkSection('S', 0, 0); s1.name = 'Ostseite';
  s1.bays = [mkBay(2.57), mkBay(2.57), mkBay(3.07)];
  const e1 = sectionEnd(s1);
  const s2 = mkSection('W', e1.x, e1.y); s2.name = 'Südseite';
  s2.bays = [mkBay(3.07), mkBay(2.57), mkBay(3.07)];
  const e2 = sectionEnd(s2);
  const s3 = mkSection('N', e2.x, e2.y); s3.name = 'Westseite';
  s3.bays = [mkBay(3.07), mkBay(2.57), mkBay(2.57)];
  state.sections = [s1, s2, s3]; renderAll();
}

function applyRect() {
  _sId = 0; _bId = 0;
  const dirs  = ['S', 'W', 'N', 'E'];
  const names = ['Straßenseite', 'Rechte Seite', 'Rückseite', 'Linke Seite'];
  let ex = 0, ey = 0;
  state.sections = dirs.map((d, i) => {
    const s = mkSection(d, ex, ey); s.name = names[i];
    s.bays = [mkBay(3.07), mkBay(2.57), mkBay(2.57), mkBay(3.07)];
    const e = sectionEnd(s); ex = e.x; ey = e.y;
    return s;
  });
  renderAll();
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
  const totals = state.sections.map(s => {
    const len = s.bays.reduce((a, b) => a + b.len, 0);
    return `${s.name}: ${len.toFixed(2)} m`;
  }).join('  |  ');
  doc.text(`Gerüsttiefe: ${state.depth.toFixed(2)} m   |   ${totals}`, margin, margin + 12);
  doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, margin, margin + 17);
  doc.addImage(imgData, 'PNG', margin, margin + titleH, imgW, imgH);
  doc.save(`${(state.project || 'gerüstplan').replace(/\s+/g, '_')}_2d.pdf`);
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

  const svg = document.getElementById('planSvg');
  svg.addEventListener('pointermove',   onSvgPointerMove);
  svg.addEventListener('pointerup',     onSvgPointerUp);
  svg.addEventListener('pointercancel', onSvgPointerUp);

  // Start empty
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
