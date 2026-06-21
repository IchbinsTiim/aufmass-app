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

const PX_PER_M = 100; // SVG pixels per meter (base scale)

const DIR_META = {
  N: { dx:  0, dy: -1, label: 'N ↑' },
  E: { dx:  1, dy:  0, label: 'O →' },
  S: { dx:  0, dy:  1, label: 'S ↓' },
  W: { dx: -1, dy:  0, label: 'W ←' }
};

// Standard Gerüstfeld-Längen nach DIN 18451 / Layher Allround / PERI UP
const STD_LENGTHS = [2.07, 2.57, 3.07];

// ── State ──────────────────────────────────────────────────────────────────

let _sId = 0;
let _bId = 0;

let state = {
  project:  '',
  depth:    0.73,   // Gerüsttiefe in m
  sections: []      // [{ id, name, dir:'N'|'E'|'S'|'W', bays:[{id, len}] }]
};

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  return { id: ++_bId, len: +parseFloat(len).toFixed(2) };
}

function mkSection(dir = 'S', name) {
  const id = ++_sId;
  return { id, name: name || `Abschnitt ${id}`, dir, bays: [mkBay()] };
}

// ── Geometry ───────────────────────────────────────────────────────────────

/** Right-perpendicular (clockwise 90°) of a direction vector — points outward. */
function outVec(dir) {
  return { dx: dir.dy, dy: -dir.dx };
}

/**
 * Build the list of renderable elements from state.
 * Returns: bay, corner, wallLine, sectionLabel, dot  objects.
 */
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
      const p1 = { x: x + dir.dx * pxLen,             y: y + dir.dy * pxLen };
      const p2 = { x: p1.x + out.dx * depth,           y: p1.y + out.dy * depth };
      const p3 = { x: p0.x + out.dx * depth,           y: p0.y + out.dy * depth };

      const mcx = (p0.x + p1.x + p2.x + p3.x) / 4;
      const mcy = (p0.y + p1.y + p2.y + p3.y) / 4;

      els.push({
        type: 'bay', pts: [p0, p1, p2, p3],
        cx: mcx, cy: mcy, len: bay.len,
        si, bi, dir: sec.dir, secId: sec.id, bayId: bay.id
      });

      x += dir.dx * pxLen;
      y += dir.dy * pxLen;
    });

    // ── Building wall line (facade) ─────────────────────────────────────
    els.push({ type: 'wallLine', x1: wallStart.x, y1: wallStart.y, x2: x, y2: y });

    // ── Section total label (outside the bays) ──────────────────────────
    const totalLen = sec.bays.reduce((s, b) => s + b.len, 0);
    if (totalLen > 0) {
      const offScale = depth + 14;
      const lx = (wallStart.x + x) / 2 + out.dx * offScale;
      const ly = (wallStart.y + y) / 2 + out.dy * offScale;
      els.push({
        type: 'sectionLabel',
        x: lx, y: ly,
        text: `${sec.name}: ${totalLen.toFixed(2)} m`,
        rotate: isVert ? -90 : 0
      });
    }

    // ── Corner piece between this and the next section ──────────────────
    const next = state.sections[si + 1];
    if (next) {
      const nDir = DIR_META[next.dir];
      const nOut = outVec(nDir);
      // Cross product: positive → exterior corner (gap to fill)
      const cross = out.dx * nOut.dy - out.dy * nOut.dx;
      if (cross > 0) {
        const c0 = { x, y };
        const c1 = { x: x + out.dx  * depth, y: y + out.dy  * depth };
        const c2 = { x: c1.x + nOut.dx * depth, y: c1.y + nOut.dy * depth };
        const c3 = { x: x + nOut.dx * depth, y: y + nOut.dy * depth };
        els.push({ type: 'corner', pts: [c0, c1, c2, c3] });
      }
    }

    // ── Corner dot at start of section ─────────────────────────────────
    els.push({ type: 'dot', x: cx, y: cy });

    cx = x;
    cy = y;
  });

  // Final dot at end of last section
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

  // ── Compute bounding box ──────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function trackPt(x, y) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  els.forEach(el => {
    if (el.pts) el.pts.forEach(p => trackPt(p.x, p.y));
    if (el.type === 'wallLine') { trackPt(el.x1, el.y1); trackPt(el.x2, el.y2); }
    if (el.type === 'dot')      { trackPt(el.x, el.y); }
    if (el.type === 'sectionLabel') { trackPt(el.x, el.y); }
  });

  const PAD = depth * 3.5;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const vw = maxX - minX;
  const vh = maxY - minY;
  svg.setAttribute('viewBox', `${minX.toFixed(1)} ${minY.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);

  // ── Grid background ───────────────────────────────────────────────────
  const gbg = document.getElementById('gridBg');
  gbg.setAttribute('x', minX); gbg.setAttribute('y', minY);
  gbg.setAttribute('width', vw); gbg.setAttribute('height', vh);

  // Font sizes relative to scale
  const bayFontSize  = Math.max(depth * 0.38, 9);
  const infoFontSize = Math.max(depth * 0.28, 7);

  // ── Render layers (back to front) ─────────────────────────────────────

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
    poly.addEventListener('click', () => openBayEditor(el));
    g.appendChild(poly);

    // Length label (rotated for vertical bays)
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

  // 3. Building facade lines (on top of bays)
  els.filter(e => e.type === 'wallLine').forEach(el => {
    g.appendChild(svgEl('line', {
      x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
      stroke: '#111', 'stroke-width': 3.5, 'stroke-linecap': 'square'
    }));
  });

  // 4. Corner dots at building corners
  const dotR = Math.max(depth * 0.11, 4);
  els.filter(e => e.type === 'dot').forEach(el => {
    g.appendChild(svgEl('circle', {
      cx: el.x, cy: el.y, r: dotR,
      fill: '#2c6fa8', stroke: '#fff', 'stroke-width': 1.5
    }));
  });

  // 5. Section total labels (outside scaffold, small)
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

  // 6. Scale bar (5 m)
  drawScaleBar(g, minX, minY, vw, vh, infoFontSize);
}

function drawScaleBar(g, minX, minY, vw, vh, fontSize) {
  const barMeters = 5;
  const barLen = barMeters * PX_PER_M;
  const bx = minX + vw * 0.04;
  const by = minY + vh - (vh * 0.05);
  const tickH = 8;

  const bg = svgEl('rect', {
    x: bx - 8, y: by - fontSize - 6,
    width: barLen + 16, height: fontSize + tickH + 12,
    fill: 'rgba(255,255,255,0.75)', rx: 4
  });
  g.appendChild(bg);

  g.appendChild(svgEl('line', { x1: bx, y1: by, x2: bx + barLen, y2: by, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx, y1: by - tickH, x2: bx, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));
  g.appendChild(svgEl('line', { x1: bx + barLen, y1: by - tickH, x2: bx + barLen, y2: by + tickH, stroke: '#333', 'stroke-width': 2 }));

  const lbl = svgEl('text', {
    x: bx + barLen / 2, y: by - tickH - 2,
    'text-anchor': 'middle', 'font-size': fontSize,
    'font-family': 'system-ui, sans-serif', fill: '#333', 'font-weight': '600'
  });
  lbl.textContent = `${barMeters},00 m`;
  g.appendChild(lbl);
}

// ── Bay editor popup ───────────────────────────────────────────────────────

function openBayEditor(el) {
  // Remove any existing popup
  document.getElementById('bayEditorOverlay')?.remove();
  document.getElementById('bayEditorPopup')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bayEditorOverlay';
  overlay.className = 'bay-popup-overlay';

  const popup = document.createElement('div');
  popup.id = 'bayEditorPopup';
  popup.className = 'bay-popup';

  popup.innerHTML = `
    <div class="bay-popup-header">Feld ${el.bi + 1} – ${
      state.sections[el.si] ? state.sections[el.si].name : `Abschnitt ${el.si + 1}`
    }</div>
    <label>Länge (m):
      <input type="number" id="popupLenInput" value="${el.len.toFixed(2)}"
             min="0.01" step="0.01" style="font-size:1.2rem;padding:0.5rem" />
    </label>
    <div class="popup-quick">
      ${STD_LENGTHS.map(l =>
        `<button class="quick-btn" data-len="${l}">${l.toFixed(2)}</button>`
      ).join('')}
    </div>
    <div class="popup-actions">
      <button id="popupOkBtn" class="primary">Übernehmen</button>
      <button id="popupCancelBtn" class="secondary">Abbrechen</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  const lenInput = document.getElementById('popupLenInput');
  lenInput.focus();
  lenInput.select();

  const apply = () => {
    const val = parseFloat(lenInput.value);
    if (val > 0) {
      state.sections[el.si].bays[el.bi].len = +val.toFixed(2);
      renderAll();
    }
    close();
  };

  const close = () => {
    overlay.remove();
    popup.remove();
  };

  popup.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      lenInput.value = btn.dataset.len;
      lenInput.focus();
    });
  });

  document.getElementById('popupOkBtn').addEventListener('click', apply);
  document.getElementById('popupCancelBtn').addEventListener('click', close);
  overlay.addEventListener('click', close);

  lenInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  apply();
    if (e.key === 'Escape') close();
  });
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

    // ── Header ──────────────────────────────────────────────────────────
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

    // ── Direction buttons ────────────────────────────────────────────────
    const dirRow = document.createElement('div');
    dirRow.className = 'dir-row';

    Object.keys(DIR_META).forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'dir-btn' + (sec.dir === d ? ' active' : '');
      btn.textContent = DIR_META[d].label;
      btn.addEventListener('click', () => { sec.dir = d; renderAll(); });
      dirRow.appendChild(btn);
    });

    // ── Bay list ─────────────────────────────────────────────────────────
    const baysDiv = document.createElement('div');
    baysDiv.className = 'bays-div';

    const updateTotal = () => {
      const total = sec.bays.reduce((s, b) => s + b.len, 0);
      totEl.textContent = `Gesamt: ${total.toFixed(2)} m  (${sec.bays.length} Felder)`;
    };

    const totEl = document.createElement('div');
    totEl.className = 'sec-total';
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

      // Standard-length quick buttons
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
      rmBay.title = 'Feld entfernen';
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
  // East face going South, South face going West – matches the reference sketch
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
      const s = d.state || d; // support legacy format
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

  const vb = svg.viewBox.baseVal;
  const svgW = vb.width  || 800;
  const svgH = vb.height || 600;

  // Render at 3× for print quality
  const scale = 3;
  const cW = Math.round(svgW * scale);
  const cH = Math.round(svgH * scale);

  // Serialise SVG and force explicit dimensions so browsers render it to canvas
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

  const orient  = cW > cH ? 'landscape' : 'portrait';
  const doc     = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
  const pdfW    = orient === 'landscape' ? 297 : 210;
  const pdfH    = orient === 'landscape' ? 210 : 297;
  const margin  = 10;
  const titleH  = 20;
  const availW  = pdfW - 2 * margin;
  const availH  = pdfH - margin - titleH - margin;

  // Scale image to fit
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

  // Default: L-shape from the reference sketch
  applyLShape();
}

document.addEventListener('DOMContentLoaded', init);
