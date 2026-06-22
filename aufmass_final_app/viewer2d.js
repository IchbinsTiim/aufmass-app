'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Gerüst 2D-Ansicht  –  VOB/C DIN 18451 inspired scaffolding floor-plan
   ══════════════════════════════════════════════════════════════════════════

   Convention (SVG coordinate system, y points DOWN):
   • Sections are traced CLOCKWISE around the building exterior.
   • Scaffolding appears to the RIGHT of the direction of travel.
   • outward normal = (dir.dy, −dir.dx)  ← 90° CW rotation of the dir vector.

   Standard field widths per VOB/C DIN 18451: 2.07 m, 2.57 m, 3.07 m.
   Default scaffold depth (Gerüsttiefe): 0.73 m (Systemgerüst, 1-Feld-Breite).
   ══════════════════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────────────

const PX_PER_M  = 100;
const HANDLE_R  = 18;    // visible drag handle radius (SVG units)
const SNAP_STEP = 0.25;  // snap grid in metres

const DIR_META = {
  N: { dx:  0, dy: -1, label: 'N ↑' },
  E: { dx:  1, dy:  0, label: 'O →' },
  S: { dx:  0, dy:  1, label: 'S ↓' },
  W: { dx: -1, dy:  0, label: 'W ←' }
};

const STD_LENGTHS = [2.07, 2.57, 3.07];

// ── State ──────────────────────────────────────────────────────────────────

let _sId = 0, _bId = 0;
let state = { project: '', depth: 0.73, sections: [] };
let drag  = null;
let rafPending = false;

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  return { id: ++_bId, len: +parseFloat(len).toFixed(2) };
}

function mkSection(dir = 'S', name) {
  const id = ++_sId;
  return { id, name: name || `Abschnitt ${id}`, dir, bays: [mkBay()] };
}

// ── Geometry ───────────────────────────────────────────────────────────────

function outVec(dir) {
  return { dx: dir.dy, dy: -dir.dx };
}

function snapLen(len) {
  const g = Math.round(len / SNAP_STEP) * SNAP_STEP;
  for (const s of STD_LENGTHS) {
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

function computeLayout() {
  const depth = state.depth * PX_PER_M;
  const els   = [];
  let cx = 0, cy = 0;

  state.sections.forEach((sec, si) => {
    const dir = DIR_META[sec.dir];
    const out = outVec(dir);
    let x = cx, y = cy;
    const wallStart = { x, y };
    const isVert = sec.dir === 'N' || sec.dir === 'S';

    // ── Bay rectangles ──────────────────────────────────────────────────
    sec.bays.forEach((bay, bi) => {
      if (!(bay.len > 0)) return;
      const pxLen = bay.len * PX_PER_M;

      const p0 = { x, y };
      const p1 = { x: x + dir.dx * pxLen,            y: y + dir.dy * pxLen };
      const p2 = { x: p1.x + out.dx * depth,          y: p1.y + out.dy * depth };
      const p3 = { x: p0.x + out.dx * depth,          y: p0.y + out.dy * depth };

      const mcx = (p0.x + p1.x + p2.x + p3.x) / 4;
      const mcy = (p0.y + p1.y + p2.y + p3.y) / 4;

      els.push({
        type: 'bay', pts: [p0, p1, p2, p3],
        cx: mcx, cy: mcy, len: bay.len,
        si, bi, dir: sec.dir, secId: sec.id, bayId: bay.id
      });

      // Drag handle at mid-point of far-end edge (p1–p2)
      els.push({
        type: 'handle',
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
        len: bay.len, si, bi, isVert
      });

      x += dir.dx * pxLen;
      y += dir.dy * pxLen;
    });

    // ── Building wall line ──────────────────────────────────────────────
    els.push({ type: 'wallLine', x1: wallStart.x, y1: wallStart.y, x2: x, y2: y });

    // ── Section total label ─────────────────────────────────────────────
    const totalLen = sec.bays.reduce((s, b) => s + b.len, 0);
    if (totalLen > 0) {
      const offScale = depth + 14;
      const lx = (wallStart.x + x) / 2 + out.dx * offScale;
      const ly = (wallStart.y + y) / 2 + out.dy * offScale;
      els.push({
        type: 'sectionLabel', x: lx, y: ly,
        text: `${sec.name}: ${totalLen.toFixed(2)} m`,
        rotate: isVert ? -90 : 0
      });
    }

    // ── Corner piece between this and the next section ──────────────────
    const next = state.sections[si + 1];
    if (next) {
      const nDir = DIR_META[next.dir];
      const nOut = outVec(nDir);
      const cross = out.dx * nOut.dy - out.dy * nOut.dx;
      if (cross > 0) {
        const c0 = { x, y };
        const c1 = { x: x + out.dx  * depth,    y: y + out.dy  * depth };
        const c2 = { x: c1.x + nOut.dx * depth, y: c1.y + nOut.dy * depth };
        const c3 = { x: x + nOut.dx * depth,    y: y + nOut.dy * depth };
        els.push({ type: 'corner', pts: [c0, c1, c2, c3] });
      }
    }

    // ── Corner dot ─────────────────────────────────────────────────────
    els.push({ type: 'dot', x: cx, y: cy });
    cx = x;
    cy = y;
  });

  if (state.sections.length) els.push({ type: 'dot', x: cx, y: cy });

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

// ── Main render ────────────────────────────────────────────────────────────

function renderSvg() {
  const g    = document.getElementById('planGroup');
  const svg  = document.getElementById('planSvg');
  const hint = document.getElementById('emptyHint');
  g.innerHTML = '';

  const hasBays = state.sections.some(s => s.bays.some(b => b.len > 0));
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
  const trackPt = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  els.forEach(el => {
    if (el.pts)               el.pts.forEach(p => trackPt(p.x, p.y));
    if (el.type === 'wallLine')     { trackPt(el.x1, el.y1); trackPt(el.x2, el.y2); }
    if (el.type === 'dot')          trackPt(el.x, el.y);
    if (el.type === 'sectionLabel') trackPt(el.x, el.y);
    if (el.type === 'handle')       trackPt(el.x, el.y);
  });

  const PAD = depth * 3.5 + HANDLE_R * 3;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const vw = maxX - minX, vh = maxY - minY;
  svg.setAttribute('viewBox', `${minX.toFixed(1)} ${minY.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);

  const gbg = document.getElementById('gridBg');
  gbg.setAttribute('x', minX); gbg.setAttribute('y', minY);
  gbg.setAttribute('width', vw); gbg.setAttribute('height', vh);

  const bayFontSize  = Math.max(depth * 0.38, 9);
  const infoFontSize = Math.max(depth * 0.28, 7);

  // 1. Corner pieces (behind bays)
  els.filter(e => e.type === 'corner').forEach(el => {
    g.appendChild(svgEl('polygon', {
      points: ptsStr(el.pts), fill: '#b5d4f0',
      stroke: '#2c6fa8', 'stroke-width': 2
    }));
  });

  // 2. Bay rectangles
  els.filter(e => e.type === 'bay').forEach(el => {
    const poly = svgEl('polygon', {
      points: ptsStr(el.pts), fill: '#deeeff',
      stroke: '#2c6fa8', 'stroke-width': 2, cursor: 'pointer'
    });
    poly.addEventListener('click', () => openSheet(el.si, el.bi));
    g.appendChild(poly);

    const isVert = el.dir === 'N' || el.dir === 'S';
    const txt = svgEl('text', {
      x: el.cx, y: el.cy,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': bayFontSize, 'font-family': 'system-ui, sans-serif',
      fill: '#0a2f58', 'font-weight': '700',
      transform: isVert ? `rotate(-90,${el.cx},${el.cy})` : '',
      'pointer-events': 'none'
    });
    txt.textContent = el.len.toFixed(2);
    g.appendChild(txt);
  });

  // 3. Building facade lines
  els.filter(e => e.type === 'wallLine').forEach(el => {
    g.appendChild(svgEl('line', {
      x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
      stroke: '#111', 'stroke-width': 3.5, 'stroke-linecap': 'square'
    }));
  });

  // 4. Corner dots
  const dotR = Math.max(depth * 0.11, 4);
  els.filter(e => e.type === 'dot').forEach(el => {
    g.appendChild(svgEl('circle', {
      cx: el.x, cy: el.y, r: dotR,
      fill: '#2c6fa8', stroke: '#fff', 'stroke-width': 1.5
    }));
  });

  // 5. Section total labels
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

  // 6. Drag handles (topmost layer)
  els.filter(e => e.type === 'handle').forEach(el => {
    const isActive = drag && drag.si === el.si && drag.bi === el.bi;

    // Large transparent hit area – easy finger target
    const hit = svgEl('circle', {
      cx: el.x, cy: el.y,
      r: HANDLE_R * 2.2,
      fill: 'transparent',
      'data-si': el.si,
      'data-bi': el.bi,
      style: 'cursor:grab'
    });
    hit.addEventListener('pointerdown', onHandleDown);
    g.appendChild(hit);

    // Visible circle
    g.appendChild(svgEl('circle', {
      cx: el.x, cy: el.y, r: HANDLE_R,
      fill: isActive ? '#005bb5' : '#007aff',
      stroke: '#fff', 'stroke-width': 2.5,
      'pointer-events': 'none'
    }));

    // Arrow symbol
    const arrow = svgEl('text', {
      x: el.x, y: el.y,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': Math.round(HANDLE_R * 1.05),
      'font-family': 'system-ui, sans-serif',
      fill: '#fff', 'font-weight': '700',
      'pointer-events': 'none'
    });
    arrow.textContent = el.isVert ? '↕' : '↔';
    g.appendChild(arrow);

    // Measurement bubble during active drag
    if (isActive) {
      const len = state.sections[el.si].bays[el.bi].len;
      const bx = el.x + (el.isVert ?  HANDLE_R * 2.8 : 0);
      const by = el.y + (el.isVert ?  0 : -HANDLE_R * 2.8);
      const br = svgEl('rect', {
        x: bx - 34, y: by - 15,
        width: 68, height: 30, rx: 7,
        fill: '#111', opacity: '0.88',
        'pointer-events': 'none'
      });
      const bt = svgEl('text', {
        x: bx, y: by,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 15, 'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700',
        'pointer-events': 'none'
      });
      bt.textContent = len.toFixed(2) + ' m';
      g.appendChild(br);
      g.appendChild(bt);
    }
  });

  // 7. Scale bar
  drawScaleBar(g, minX, minY, vw, vh, infoFontSize);
}

function drawScaleBar(g, minX, minY, vw, vh, fontSize) {
  const barLen = 5 * PX_PER_M;
  const bx = minX + vw * 0.04;
  const by = minY + vh - (vh * 0.05);
  const tickH = 8;

  g.appendChild(svgEl('rect', {
    x: bx - 8, y: by - fontSize - 6,
    width: barLen + 16, height: fontSize + tickH + 12,
    fill: 'rgba(255,255,255,0.75)', rx: 4
  }));
  g.appendChild(svgEl('line', { x1: bx, y1: by, x2: bx + barLen, y2: by, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx, y1: by - tickH, x2: bx, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx + barLen, y1: by - tickH, x2: bx + barLen, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));

  const lbl = svgEl('text', {
    x: bx + barLen / 2, y: by - tickH - 2,
    'text-anchor': 'middle', 'font-size': fontSize,
    'font-family': 'system-ui, sans-serif', fill: '#333', 'font-weight': '600'
  });
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

  // Capture on SVG so re-renders (g.innerHTML='') don't break the pointer capture
  svg.setPointerCapture(e.pointerId);

  drag = {
    si, bi,
    startLen: state.sections[si].bays[bi].len,
    startPt:  screenToSvg(e.clientX, e.clientY),
    dir:      DIR_META[state.sections[si].dir],
    moved:    false
  };
}

function onSvgPointerMove(e) {
  if (!drag) return;

  const pt  = screenToSvg(e.clientX, e.clientY);
  const dPx = (pt.x - drag.startPt.x) * drag.dir.dx
            + (pt.y - drag.startPt.y) * drag.dir.dy;

  if (Math.abs(dPx) > 5) drag.moved = true;

  const newLen = snapLen(drag.startLen + dPx / PX_PER_M);
  if (newLen !== state.sections[drag.si].bays[drag.bi].len) {
    state.sections[drag.si].bays[drag.bi].len = newLen;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { renderSvg(); rafPending = false; });
    }
  }
}

function onSvgPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;

  if (!d.moved) {
    openSheet(d.si, d.bi);
  } else {
    renderAll();
  }
}

// ── Bottom sheet ───────────────────────────────────────────────────────────

function openSheet(si, bi) {
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

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = `Feld ${bi + 1} – ${sec.name}`;

  // Standard size buttons
  const stdDiv = document.createElement('div');
  stdDiv.className = 'sheet-std-btns';
  STD_LENGTHS.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'std-btn' + (Math.abs(bay.len - l) < 0.001 ? ' active' : '');
    btn.textContent = l.toFixed(2) + ' m';
    btn.addEventListener('click', () => {
      bay.len = l;
      renderAll();
      closeSheet();
    });
    stdDiv.appendChild(btn);
  });

  // +/- adjustment row
  const adjRow = document.createElement('div');
  adjRow.className = 'sheet-adj-row';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'adj-btn';
  minusBtn.textContent = '−';

  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'sheet-inp';
  inp.value = bay.len.toFixed(2);
  inp.min = '0.25';
  inp.step = '0.25';
  inp.inputMode = 'decimal';

  const plusBtn = document.createElement('button');
  plusBtn.className = 'adj-btn';
  plusBtn.textContent = '+';

  const syncInp = () => { inp.value = bay.len.toFixed(2); renderSvg(); };

  minusBtn.addEventListener('click', () => {
    bay.len = Math.max(0.25, +(bay.len - 0.25).toFixed(2));
    syncInp();
  });
  plusBtn.addEventListener('click', () => {
    bay.len = +(bay.len + 0.25).toFixed(2);
    syncInp();
  });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (v >= 0.25) { bay.len = +v.toFixed(2); renderSvg(); }
  });

  adjRow.appendChild(minusBtn);
  adjRow.appendChild(inp);
  adjRow.appendChild(plusBtn);

  // Action buttons
  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';

  const delBtn = document.createElement('button');
  delBtn.className = 'sheet-del';
  delBtn.textContent = 'Feld löschen';
  delBtn.addEventListener('click', () => {
    if (sec.bays.length > 1) {
      sec.bays.splice(bi, 1);
    }
    renderAll();
    closeSheet();
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'sheet-add';
  addBtn.textContent = '+ Feld danach';
  addBtn.addEventListener('click', () => {
    sec.bays.splice(bi + 1, 0, mkBay());
    renderAll();
    closeSheet();
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'sheet-ok';
  okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });

  actRow.appendChild(delBtn);
  actRow.appendChild(addBtn);
  actRow.appendChild(okBtn);

  sheet.appendChild(hdr);
  sheet.appendChild(stdDiv);
  sheet.appendChild(adjRow);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  requestAnimationFrame(() => sheet.classList.add('open'));
}

function closeSheet() {
  document.getElementById('sheetOverlay')?.remove();
  const s = document.getElementById('bottomSheet');
  if (!s) return;
  s.classList.remove('open');
  setTimeout(() => s.remove(), 230);
}

// ── Side panel (section editor) ────────────────────────────────────────────

function renderSections() {
  const container = document.getElementById('sectionsContainer');
  const hint      = document.getElementById('noSectionsHint');
  container.innerHTML = '';

  if (!state.sections.length) {
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');

  state.sections.forEach((sec, si) => {
    const card = document.createElement('div');
    card.className = 'section-card';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'sec-hdr';

    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'sec-name';
    nameIn.value = sec.name;
    nameIn.addEventListener('input', e => { sec.name = e.target.value; renderSvg(); });

    const rmSec = document.createElement('button');
    rmSec.className = 'remove-btn small';
    rmSec.textContent = '×';
    rmSec.title = 'Abschnitt entfernen';
    rmSec.addEventListener('click', () => { state.sections.splice(si, 1); renderAll(); });

    hdr.appendChild(nameIn);
    hdr.appendChild(rmSec);

    // Direction buttons
    const dirRow = document.createElement('div');
    dirRow.className = 'dir-row';
    Object.keys(DIR_META).forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'dir-btn' + (sec.dir === d ? ' active' : '');
      btn.textContent = DIR_META[d].label;
      btn.addEventListener('click', () => { sec.dir = d; renderAll(); });
      dirRow.appendChild(btn);
    });

    // Bay list
    const baysDiv = document.createElement('div');
    baysDiv.className = 'bays-div';

    const totEl = document.createElement('div');
    totEl.className = 'sec-total';
    const updateTotal = () => {
      const total = sec.bays.reduce((s, b) => s + b.len, 0);
      totEl.textContent = `Gesamt: ${total.toFixed(2)} m  (${sec.bays.length} Felder)`;
    };
    updateTotal();

    sec.bays.forEach((bay, bi) => {
      const row = document.createElement('div');
      row.className = 'bay-row';

      const num = document.createElement('span');
      num.className = 'bay-num';
      num.textContent = `F${bi + 1}`;

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'bay-inp';
      inp.value = bay.len.toFixed(2);
      inp.min = '0.01';
      inp.step = '0.01';
      inp.addEventListener('input', e => {
        bay.len = +parseFloat(e.target.value || 0).toFixed(2);
        updateTotal();
        renderSvg();
      });

      const qd = document.createElement('div');
      qd.className = 'quick-btns';
      STD_LENGTHS.forEach(l => {
        const qb = document.createElement('button');
        qb.className = 'quick-btn';
        qb.textContent = l.toFixed(2);
        qb.addEventListener('click', () => {
          bay.len = l;
          inp.value = l.toFixed(2);
          updateTotal();
          renderSvg();
        });
        qd.appendChild(qb);
      });

      const rmBay = document.createElement('button');
      rmBay.className = 'remove-btn small';
      rmBay.textContent = '×';
      rmBay.addEventListener('click', () => { sec.bays.splice(bi, 1); renderAll(); });

      row.appendChild(num);
      row.appendChild(inp);
      row.appendChild(qd);
      row.appendChild(rmBay);
      baysDiv.appendChild(row);
    });

    const addBayBtn = document.createElement('button');
    addBayBtn.className = 'add-bay';
    addBayBtn.textContent = '+ Feld';
    addBayBtn.addEventListener('click', () => { sec.bays.push(mkBay()); renderAll(); });

    card.appendChild(hdr);
    card.appendChild(dirRow);
    card.appendChild(totEl);
    card.appendChild(baysDiv);
    card.appendChild(addBayBtn);
    container.appendChild(card);
  });
}

function renderAll() {
  renderSections();
  renderSvg();
}

// ── Preset layouts ─────────────────────────────────────────────────────────

function applyLShape() {
  _sId = 0; _bId = 0;
  const s1 = mkSection('S', 'Ostseite');
  const s2 = mkSection('W', 'Südseite');
  s1.bays = [mkBay(2.52), mkBay(2.52), mkBay(2.52), mkBay(2.52), mkBay(3.07)];
  s2.bays = [mkBay(3.07), mkBay(3.07)];
  state.sections = [s1, s2];
  renderAll();
}

function applyUShape() {
  _sId = 0; _bId = 0;
  const s1 = mkSection('S', 'Ostseite');
  const s2 = mkSection('W', 'Südseite');
  const s3 = mkSection('N', 'Westseite');
  s1.bays = [mkBay(2.57), mkBay(2.57), mkBay(3.07)];
  s2.bays = [mkBay(3.07), mkBay(2.57), mkBay(3.07)];
  s3.bays = [mkBay(3.07), mkBay(2.57), mkBay(2.57)];
  state.sections = [s1, s2, s3];
  renderAll();
}

function applyRect() {
  _sId = 0; _bId = 0;
  const s1 = mkSection('S', 'Straßenseite');
  const s2 = mkSection('W', 'Rechte Seite');
  const s3 = mkSection('N', 'Rückseite');
  const s4 = mkSection('E', 'Linke Seite');
  [s1, s2, s3, s4].forEach(s => {
    s.bays = [mkBay(3.07), mkBay(2.57), mkBay(2.57), mkBay(3.07)];
  });
  state.sections = [s1, s2, s3, s4];
  renderAll();
}

// ── Save / Load ────────────────────────────────────────────────────────────

function savePlan() {
  const payload = JSON.stringify({ version: 1, state, _sId, _bId });
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.project || 'gerüstplan'}_2d.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function triggerLoad() {
  document.getElementById('loadFileInput').click();
}

function onLoadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      const s = d.state || d;
      state.project  = s.project  || '';
      state.depth    = s.depth    || 0.73;
      state.sections = s.sections || [];
      _sId = d._sId || state.sections.length;
      _bId = d._bId || state.sections.flatMap(x => x.bays).length;
      document.getElementById('projectName').value = state.project;
      document.getElementById('scaffDepth').value  = state.depth;
      renderAll();
    } catch {
      alert('Fehler beim Laden: Ungültige Datei.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── PDF Export ─────────────────────────────────────────────────────────────

async function exportPdf() {
  const { jsPDF } = window.jspdf;
  const svg = document.getElementById('planSvg');

  const vb   = svg.viewBox.baseVal;
  const svgW = vb.width  || 800;
  const svgH = vb.height || 600;

  const scale = 3;
  const cW = Math.round(svgW * scale);
  const cH = Math.round(svgH * scale);

  const serializer = new XMLSerializer();
  let svgStr = serializer.serializeToString(svg);
  svgStr = svgStr.replace(/(<svg[^>]*?)(\s*\bwidth\s*=\s*["'][^"']*["'])?(\s*\bheight\s*=\s*["'][^"']*["'])?/,
    `$1 width="${cW}" height="${cH}"`);

  const blob  = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url   = URL.createObjectURL(blob);

  const img = new Image(cW, cH);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

  const canvas = document.createElement('canvas');
  canvas.width  = cW;
  canvas.height = cH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cW, cH);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  const imgData = canvas.toDataURL('image/png');

  const orient = cW > cH ? 'landscape' : 'portrait';
  const doc    = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
  const pdfW   = orient === 'landscape' ? 297 : 210;
  const pdfH   = orient === 'landscape' ? 210 : 297;
  const margin = 10, titleH = 20;
  const availW = pdfW - 2 * margin;
  const availH = pdfH - margin - titleH - margin;

  const ratio = Math.min(availW / (cW / (96 / 25.4)), availH / (cH / (96 / 25.4)));
  const imgW  = (cW / (96 / 25.4)) * ratio;
  const imgH  = (cH / (96 / 25.4)) * ratio;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(state.project || 'Gerüst 2D-Ansicht', margin, margin + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const totals = state.sections.map(s => {
    const len = s.bays.reduce((a, b) => a + b.len, 0);
    return `${s.name}: ${len.toFixed(2)} m`;
  }).join('   |   ');
  doc.text(`Gerüsttiefe: ${state.depth.toFixed(2)} m   |   ${totals}`, margin, margin + 12);
  doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, margin, margin + 17);

  doc.addImage(imgData, 'PNG', margin, margin + titleH, imgW, imgH);
  doc.save(`${(state.project || 'gerüstplan').replace(/\s+/g, '_')}_2d.pdf`);
}

// ── Initialisation ─────────────────────────────────────────────────────────

function init() {
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    state.sections.push(mkSection());
    renderAll();
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

  // SVG-level pointer events for drag (survive re-renders via pointer capture)
  const svg = document.getElementById('planSvg');
  svg.addEventListener('pointermove',   onSvgPointerMove);
  svg.addEventListener('pointerup',     onSvgPointerUp);
  svg.addEventListener('pointercancel', onSvgPointerUp);

  applyLShape();
}

document.addEventListener('DOMContentLoaded', init);
