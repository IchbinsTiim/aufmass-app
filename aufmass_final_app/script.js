'use strict';

// ============================================================
//  Konstanten & Zustand
// ============================================================

const STORAGE_KEY = 'aufmass_projects_v2';

let projects = [];
let currentProjectId = null;

// ============================================================
//  localStorage
// ============================================================

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    projects = raw ? JSON.parse(raw) : [];
  } catch (_) {
    projects = [];
  }
}

function saveProjects() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function getCurrentProject() {
  return projects.find(p => p.id === currentProjectId) || null;
}

// ============================================================
//  Hilfsfunktionen
// ============================================================

function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNum(n) {
  return n.toFixed(2).replace('.', ',');
}

function parseNum(str) {
  if (str === null || str === undefined || str === '') return NaN;
  return parseFloat(String(str).replace(',', '.'));
}

function getTypeLabel(type) {
  if (type === 'dach') return 'Dach-Gerust';
  if (type === 'sonder') return 'Sonder-Gerust';
  return 'Fassaden-Gerust';
}

function getTypeBadge(type) {
  if (type === 'dach') return 'Dach';
  if (type === 'sonder') return 'Son.';
  return 'Fass.';
}

function getProjectLabel(project) {
  const a = project.anschrift || {};
  const parts = [];
  if (a.strasse || a.nummer) {
    parts.push([a.strasse, a.nummer].filter(Boolean).join(' '));
  }
  if (a.plz || a.ort) {
    parts.push([a.plz, a.ort].filter(Boolean).join(' '));
  }
  return parts.join(', ') || 'Neues Projekt';
}

function getSeiteName(seite) {
  if (seite.name === '__manual__') return seite.manualName || 'Unbenannte Seite';
  return seite.name || 'Unbenannte Seite';
}

// ============================================================
//  Toast
// ============================================================

let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toastEl');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2000);
}

// ============================================================
//  Screen-Wechsel
// ============================================================

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ============================================================
//  Startseite – Projektliste
// ============================================================

function renderProjectList() {
  const listEl = document.getElementById('projectList');
  const emptyEl = document.getElementById('emptyState');
  listEl.innerHTML = '';

  if (projects.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  const sorted = [...projects].sort((a, b) =>
    (b.geaendert || '').localeCompare(a.geaendert || '')
  );

  sorted.forEach(proj => {
    const card = document.createElement('div');
    card.className = 'project-card';

    const typ = proj.geruesttyp || 'fassade';
    const seitenAnzahl = (proj.seiten || []).length;
    const bauherr = proj.anschrift && proj.anschrift.bauherr ? proj.anschrift.bauherr : '';
    const metaParts = [
      getTypeLabel(typ),
      seitenAnzahl + ' Seite' + (seitenAnzahl !== 1 ? 'n' : ''),
      fmtDate(proj.geaendert)
    ];

    card.innerHTML = `
      <div class="project-card-badge ${typ}">${getTypeBadge(typ)}</div>
      <div class="project-card-body">
        <div class="project-card-address">${getProjectLabel(proj)}</div>
        <div class="project-card-meta">${metaParts.join(' · ')}</div>
        ${bauherr ? `<div class="project-card-meta">${bauherr}</div>` : ''}
      </div>
      <div class="project-card-arrow">&rsaquo;</div>
    `;
    card.addEventListener('click', () => openProject(proj.id));
    listEl.appendChild(card);
  });
}

// ============================================================
//  Projekt erstellen / offnen
// ============================================================

function createNewProject() {
  const today = new Date().toISOString().slice(0, 10);
  const proj = {
    id: genId('proj'),
    erstellt: today,
    geaendert: today,
    anschrift: { strasse: '', nummer: '', plz: '', ort: '', bauherr: '' },
    geruesttyp: 'fassade',
    seiten: []
  };
  projects.push(proj);
  saveProjects();
  openProject(proj.id);
}

function openProject(projectId) {
  currentProjectId = projectId;
  const proj = getCurrentProject();
  if (!proj) return;

  // Titel
  document.getElementById('projectScreenTitle').textContent = getProjectLabel(proj);

  // Anschrift
  const a = proj.anschrift || {};
  document.getElementById('fieldStrasse').value = a.strasse || '';
  document.getElementById('fieldNummer').value = a.nummer || '';
  document.getElementById('fieldPlz').value = a.plz || '';
  document.getElementById('fieldOrt').value = a.ort || '';
  document.getElementById('fieldBauherr').value = a.bauherr || '';

  // Gerusttyp
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === (proj.geruesttyp || 'fassade'));
  });

  // Hausseiten
  renderSeiten(proj.seiten || []);

  // Zusammenfassung
  updateSummary();

  showScreen('projectScreen');
}

// ============================================================
//  Daten aus dem DOM sammeln
// ============================================================

function collectAnschrift() {
  return {
    strasse:  document.getElementById('fieldStrasse').value.trim(),
    nummer:   document.getElementById('fieldNummer').value.trim(),
    plz:      document.getElementById('fieldPlz').value.trim(),
    ort:      document.getElementById('fieldOrt').value.trim(),
    bauherr:  document.getElementById('fieldBauherr').value.trim()
  };
}

function collectGeruesttyp() {
  const active = document.querySelector('.type-btn.active');
  return active ? active.dataset.type : 'fassade';
}

function collectSeiten() {
  const result = [];
  document.querySelectorAll('#seitenContainer .seite-card').forEach(card => {
    const sel = card.querySelector('.seite-select');
    const manual = card.querySelector('.seite-manual-input');

    const hRows = card.querySelectorAll('.hoehen-rows .meas-row');
    const lRows = card.querySelectorAll('.laengen-rows .meas-row');

    const hoehen = [];
    hRows.forEach((row, i) => {
      const v = parseNum(row.querySelector('.meas-input').value);
      hoehen.push({ label: 'H' + (i + 1), wert: isNaN(v) ? null : v });
    });

    const laengen = [];
    lRows.forEach((row, i) => {
      const v = parseNum(row.querySelector('.meas-input').value);
      laengen.push({ label: 'L' + (i + 1), wert: isNaN(v) ? null : v });
    });

    result.push({
      id:         card.dataset.sideId,
      name:       sel ? sel.value : '',
      manualName: manual ? manual.value.trim() : '',
      hoehen,
      laengen
    });
  });
  return result;
}

// ============================================================
//  Speichern / Loschen
// ============================================================

function saveCurrentProject() {
  const proj = getCurrentProject();
  if (!proj) return;

  proj.anschrift  = collectAnschrift();
  proj.geruesttyp = collectGeruesttyp();
  proj.seiten     = collectSeiten();
  proj.geaendert  = new Date().toISOString().slice(0, 10);

  document.getElementById('projectScreenTitle').textContent = getProjectLabel(proj);
  saveProjects();
  showToast('Gespeichert');
}

function deleteCurrentProject() {
  if (!currentProjectId) return;
  if (!confirm('Dieses Projekt wirklich loschen?')) return;
  projects = projects.filter(p => p.id !== currentProjectId);
  saveProjects();
  currentProjectId = null;
  renderProjectList();
  showScreen('homeScreen');
}

// ============================================================
//  Hausseiten rendern
// ============================================================

function renderSeiten(seitenData) {
  const container = document.getElementById('seitenContainer');
  container.innerHTML = '';
  seitenData.forEach(seite => container.appendChild(createSeiteCard(seite)));
  renumberSeitenBadges();
  refreshNoSidesHint();
  updateSummary();
}

function refreshNoSidesHint() {
  const container = document.getElementById('seitenContainer');
  const hint = document.getElementById('noSidesHint');
  const hasSides = container.querySelectorAll('.seite-card').length > 0;
  hint.classList.toggle('hidden', hasSides);
}

// ============================================================
//  Seite-Karte erstellen
// ============================================================

function createSeiteCard(seiteData) {
  const sideId = seiteData.id || genId('side');

  const card = document.createElement('div');
  card.className = 'seite-card';
  card.dataset.sideId = sideId;

  // ---- Header ----
  const header = document.createElement('div');
  header.className = 'seite-header';

  const numBadge = document.createElement('div');
  numBadge.className = 'seite-number';
  numBadge.textContent = '?';

  const titleEl = document.createElement('div');
  titleEl.className = 'seite-title';
  titleEl.textContent = getSeiteName(seiteData);

  const previewEl = document.createElement('div');
  previewEl.className = 'seite-preview';

  const chevron = document.createElement('span');
  chevron.className = 'seite-chevron open';
  chevron.textContent = '›';

  header.appendChild(numBadge);
  header.appendChild(titleEl);
  header.appendChild(previewEl);
  header.appendChild(chevron);

  // ---- Body ----
  const body = document.createElement('div');
  body.className = 'seite-body';

  // --- Name-Auswahl ---
  const nameRow = document.createElement('div');
  nameRow.className = 'seite-name-row';

  const nameSelect = document.createElement('select');
  nameSelect.className = 'seite-select';

  [
    { value: 'Strassenseite',  label: 'Strassenseite' },
    { value: 'Linker Giebel',  label: 'Linker Giebel' },
    { value: 'Rechter Giebel', label: 'Rechter Giebel' },
    { value: 'Ruckseite',      label: 'Ruckseite' },
    { value: 'Linke Traufe',   label: 'Linke Traufe' },
    { value: 'Rechte Traufe',  label: 'Rechte Traufe' },
    { value: '__manual__',     label: 'Andere...' }
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    nameSelect.appendChild(o);
  });

  // Wert setzen (Fallback auf ersten Eintrag wenn nicht gefunden)
  nameSelect.value = seiteData.name || 'Strassenseite';
  if (!nameSelect.value) nameSelect.value = 'Strassenseite';

  const manualInput = document.createElement('input');
  manualInput.type = 'text';
  manualInput.className = 'seite-manual-input';
  manualInput.placeholder = 'Bezeichnung eingeben';
  manualInput.value = seiteData.manualName || '';
  manualInput.style.display = seiteData.name === '__manual__' ? '' : 'none';

  function updateTitle() {
    const name = nameSelect.value === '__manual__'
      ? (manualInput.value.trim() || 'Unbenannte Seite')
      : nameSelect.value;
    titleEl.textContent = name;
  }

  nameSelect.addEventListener('change', () => {
    manualInput.style.display = nameSelect.value === '__manual__' ? '' : 'none';
    updateTitle();
    updateCardPreview(card, previewEl);
    updateSummary();
  });

  manualInput.addEventListener('input', () => {
    updateTitle();
    updateCardPreview(card, previewEl);
    updateSummary();
  });

  nameRow.appendChild(nameSelect);
  nameRow.appendChild(manualInput);

  // --- Hohen ---
  const hoehenSection = createMeasSection(
    'Hohen',
    'H',
    'hoehen-rows',
    seiteData.hoehen && seiteData.hoehen.length > 0
      ? seiteData.hoehen
      : [{ label: 'H1', wert: null }],
    '+ Hohe hinzufugen',
    () => { updateCardPreview(card, previewEl); updateSummary(); }
  );

  // --- Langen ---
  const laengenSection = createMeasSection(
    'Langen',
    'L',
    'laengen-rows',
    seiteData.laengen && seiteData.laengen.length > 0
      ? seiteData.laengen
      : [{ label: 'L1', wert: null }],
    '+ Lange hinzufugen',
    () => { updateCardPreview(card, previewEl); updateSummary(); }
  );

  // --- Loschen ---
  const footer = document.createElement('div');
  footer.className = 'seite-footer';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger-ghost btn-sm';
  removeBtn.textContent = 'Seite entfernen';
  removeBtn.addEventListener('click', () => {
    card.remove();
    renumberSeitenBadges();
    refreshNoSidesHint();
    updateSummary();
  });
  footer.appendChild(removeBtn);

  body.appendChild(nameRow);
  body.appendChild(hoehenSection);
  body.appendChild(laengenSection);
  body.appendChild(footer);

  card.appendChild(header);
  card.appendChild(body);

  // Collapse Toggle
  header.addEventListener('click', () => {
    const isOpen = !body.classList.contains('collapsed');
    body.classList.toggle('collapsed', isOpen);
    chevron.classList.toggle('open', !isOpen);
  });

  // Initiale Vorschau
  updateCardPreview(card, previewEl);

  return card;
}

// ============================================================
//  Mess-Abschnitt erstellen (Hohen / Langen)
// ============================================================

function createMeasSection(labelText, prefix, rowsClass, initialData, addBtnText, onChange) {
  const section = document.createElement('div');
  section.className = 'meas-section';

  const label = document.createElement('div');
  label.className = 'meas-section-label';
  label.textContent = labelText;

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'meas-rows ' + rowsClass;

  initialData.forEach((item, i) => {
    rowsContainer.appendChild(
      createMeasRow(prefix + (i + 1), item.wert, rowsContainer, prefix, onChange)
    );
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'meas-add-btn';
  addBtn.textContent = addBtnText;
  addBtn.addEventListener('click', () => {
    const count = rowsContainer.querySelectorAll('.meas-row').length;
    rowsContainer.appendChild(
      createMeasRow(prefix + (count + 1), null, rowsContainer, prefix, onChange)
    );
    onChange();
  });

  section.appendChild(label);
  section.appendChild(rowsContainer);
  section.appendChild(addBtn);

  return section;
}

// ============================================================
//  Einzelne Messzeile erstellen
// ============================================================

function createMeasRow(labelText, value, rowsContainer, prefix, onChange) {
  const row = document.createElement('div');
  row.className = 'meas-row';

  const lbl = document.createElement('div');
  lbl.className = 'meas-row-label';
  lbl.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'meas-input';
  input.placeholder = '0,00';
  input.step = '0.01';
  input.min = '0';
  input.inputMode = 'decimal';
  if (value !== null && value !== undefined) input.value = value;
  input.addEventListener('input', onChange);

  const unit = document.createElement('div');
  unit.className = 'meas-unit';
  unit.textContent = 'm';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meas-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => {
    if (rowsContainer.querySelectorAll('.meas-row').length > 1) {
      row.remove();
      renumberRowLabels(rowsContainer, prefix);
      onChange();
    }
  });

  row.appendChild(lbl);
  row.appendChild(input);
  row.appendChild(unit);
  row.appendChild(removeBtn);

  return row;
}

function renumberRowLabels(container, prefix) {
  container.querySelectorAll('.meas-row').forEach((row, i) => {
    const lbl = row.querySelector('.meas-row-label');
    if (lbl) lbl.textContent = prefix + (i + 1);
  });
}

function renumberSeitenBadges() {
  document.querySelectorAll('#seitenContainer .seite-card').forEach((card, i) => {
    const badge = card.querySelector('.seite-number');
    if (badge) badge.textContent = i + 1;
  });
}

// ============================================================
//  Vorschau-Text in der Seite-Karte
// ============================================================

function updateCardPreview(card, previewEl) {
  const hInputs = card.querySelectorAll('.hoehen-rows .meas-input');
  const lInputs = card.querySelectorAll('.laengen-rows .meas-input');

  const parts = [];
  hInputs.forEach((inp, i) => {
    const v = parseNum(inp.value);
    if (!isNaN(v) && v > 0) parts.push('H' + (i + 1) + ': ' + fmtNum(v));
  });
  lInputs.forEach((inp, i) => {
    const v = parseNum(inp.value);
    if (!isNaN(v) && v > 0) parts.push('L' + (i + 1) + ': ' + fmtNum(v));
  });

  previewEl.textContent = parts.join('  ') || '';
}

// ============================================================
//  Neue Seite hinzufugen
// ============================================================

function addSide() {
  const container = document.getElementById('seitenContainer');
  const newSide = {
    id:         genId('side'),
    name:       'Strassenseite',
    manualName: '',
    hoehen:     [{ label: 'H1', wert: null }],
    laengen:    [{ label: 'L1', wert: null }]
  };
  const el = createSeiteCard(newSide);
  container.appendChild(el);
  renumberSeitenBadges();
  refreshNoSidesHint();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateSummary();
}

// ============================================================
//  Zusammenfassung
// ============================================================

function updateSummary() {
  const el = document.getElementById('summaryContent');
  const cards = document.querySelectorAll('#seitenContainer .seite-card');

  if (cards.length === 0) {
    el.innerHTML = '<p class="summary-empty">Noch keine Seiten erfasst.</p>';
    return;
  }

  let totalArea   = 0;
  let totalLength = 0;
  const rows = [];

  cards.forEach(card => {
    const sel    = card.querySelector('.seite-select');
    const manual = card.querySelector('.seite-manual-input');
    const name   = sel && sel.value === '__manual__'
      ? (manual ? manual.value.trim() || 'Unbenannte Seite' : 'Unbenannte Seite')
      : (sel ? sel.value : '');

    const hVals = [];
    card.querySelectorAll('.hoehen-rows .meas-input').forEach(inp => {
      const v = parseNum(inp.value);
      if (!isNaN(v) && v > 0) hVals.push(v);
    });

    const lVals = [];
    card.querySelectorAll('.laengen-rows .meas-input').forEach(inp => {
      const v = parseNum(inp.value);
      if (!isNaN(v) && v > 0) lVals.push(v);
    });

    const sumLen = lVals.reduce((a, b) => a + b, 0);
    let effH = 0;
    if (hVals.length === 1) {
      effH = hVals[0];
    } else if (hVals.length > 1) {
      // Mittelwert (typisch fur Giebel)
      effH = hVals.reduce((a, b) => a + b, 0) / hVals.length;
    }

    const area = sumLen * effH;
    totalArea   += area;
    totalLength += sumLen;

    const detailParts = [];
    hVals.forEach((v, i) => detailParts.push('H' + (i + 1) + ': ' + fmtNum(v) + ' m'));
    lVals.forEach((v, i) => detailParts.push('L' + (i + 1) + ': ' + fmtNum(v) + ' m'));
    let flaeche = '';
    if (area > 0) {
      flaeche = fmtNum(sumLen) + ' m × ' + fmtNum(effH) + ' m = ' + fmtNum(area) + ' m²';
    }

    rows.push({ name, detailParts, flaeche, area });
  });

  // HTML bauen
  let html = '<table class="summary-table">';

  rows.forEach(row => {
    const detail = row.detailParts.join(' &nbsp; ');
    html += `
      <tr>
        <td>
          <span class="summary-side-name">${row.name}</span>
          ${detail ? `<span class="summary-side-detail">${detail}</span>` : ''}
          ${row.flaeche ? `<span class="summary-side-detail">${row.flaeche}</span>` : ''}
        </td>
        <td>${row.area > 0 ? fmtNum(row.area) + ' m²' : '–'}</td>
      </tr>`;
  });

  html += `
    <tr class="summary-total-row">
      <td>Gesamtflache</td>
      <td>${fmtNum(totalArea)} m²</td>
    </tr>
    <tr>
      <td style="color: var(--color-text-secondary); font-size: 0.82rem; padding-top: 4px;">
        Gerustlange gesamt
      </td>
      <td style="font-size: 0.82rem; color: var(--color-text-secondary); padding-top: 4px;">
        ${fmtNum(totalLength)} m
      </td>
    </tr>
  `;

  html += '</table>';
  el.innerHTML = html;
}

// ============================================================
//  PDF-Erstellung
// ============================================================

function generatePDF() {
  const anschrift  = collectAnschrift();
  const geruesttyp = collectGeruesttyp();
  const seiten     = collectSeiten();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const LM = 14;
  const PW = 182;
  let y = 16;

  // Titel
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Aufmass-Bericht', LM, y);
  y += 10;

  // Trennlinie
  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;

  // Adresse & Meta
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');

  const addrLine = [
    [anschrift.strasse, anschrift.nummer].filter(Boolean).join(' '),
    [anschrift.plz, anschrift.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');

  if (addrLine) { doc.text(addrLine, LM, y); y += 6; }
  if (anschrift.bauherr) { doc.text('Bauherr: ' + anschrift.bauherr, LM, y); y += 6; }
  doc.text('Gerusttyp: ' + getTypeLabel(geruesttyp), LM, y); y += 6;
  doc.text('Datum: ' + new Date().toLocaleDateString('de-DE'), LM, y); y += 10;

  let totalArea = 0;

  seiten.forEach((seite, idx) => {
    if (y > 265) { doc.addPage(); y = 16; }

    const name = seite.name === '__manual__' ? seite.manualName : seite.name;

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text((name || ('Seite ' + (idx + 1))), LM, y);
    y += 6;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);

    const hVals = seite.hoehen.filter(h => h.wert !== null && !isNaN(h.wert) && h.wert > 0);
    const lVals = seite.laengen.filter(l => l.wert !== null && !isNaN(l.wert) && l.wert > 0);

    if (hVals.length > 0) {
      doc.text('Hohen:  ' + hVals.map((h, i) => 'H' + (i + 1) + ': ' + fmtNum(h.wert) + ' m').join('   '), LM + 4, y);
      y += 5;
    }
    if (lVals.length > 0) {
      doc.text('Langen: ' + lVals.map((l, i) => 'L' + (i + 1) + ': ' + fmtNum(l.wert) + ' m').join('   '), LM + 4, y);
      y += 5;
    }

    const sumLen = lVals.reduce((a, b) => a + b.wert, 0);
    let effH = 0;
    if (hVals.length === 1) effH = hVals[0].wert;
    else if (hVals.length > 1) effH = hVals.reduce((a, b) => a + b.wert, 0) / hVals.length;

    const area = sumLen * effH;
    totalArea += area;

    if (area > 0) {
      doc.text(
        'Flache: ' + fmtNum(sumLen) + ' m × ' + fmtNum(effH) + ' m = ' + fmtNum(area) + ' m²',
        LM + 4, y
      );
      y += 5;
    }
    y += 4;
  });

  // Gesamt
  if (y > 265) { doc.addPage(); y = 16; }
  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Gesamtflache: ' + fmtNum(totalArea) + ' m²', LM, y);

  // Dateiname
  const proj = getCurrentProject();
  const base = proj ? getProjectLabel(proj).replace(/[^a-zA-Z0-9\-_äöüÄÖÜß ]/g, '').trim() : 'Aufmass';
  doc.save((base || 'Aufmass') + '.pdf');
}

// ============================================================
//  JSON-Export / Import
// ============================================================

function exportJson() {
  const proj = getCurrentProject();
  if (!proj) return;

  proj.anschrift  = collectAnschrift();
  proj.geruesttyp = collectGeruesttyp();
  proj.seiten     = collectSeiten();
  proj.geaendert  = new Date().toISOString().slice(0, 10);
  saveProjects();

  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (getProjectLabel(proj).replace(/[^a-z0-9]/gi, '_') || 'Aufmass') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.seiten) {
        alert('Unbekanntes Dateiformat. Bitte eine Aufmass-JSON-Datei laden.');
        return;
      }
      const existing = projects.findIndex(p => p.id === data.id);
      if (existing >= 0) {
        projects[existing] = data;
      } else {
        data.id = genId('proj');
        projects.push(data);
      }
      saveProjects();
      openProject(data.id);
    } catch (err) {
      alert('Fehler beim Lesen der Datei: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ============================================================
//  Event-Listener & App-Start
// ============================================================

function initApp() {
  loadProjects();
  renderProjectList();
  showScreen('homeScreen');

  // --- Startseite ---
  document.getElementById('newProjectBtn').addEventListener('click', createNewProject);

  // --- Projekt-Screen ---
  document.getElementById('backBtn').addEventListener('click', () => {
    saveCurrentProject();
    renderProjectList();
    showScreen('homeScreen');
  });

  document.getElementById('deleteProjectBtn').addEventListener('click', deleteCurrentProject);
  document.getElementById('addSideBtn').addEventListener('click', addSide);
  document.getElementById('saveProjectBtn').addEventListener('click', saveCurrentProject);
  document.getElementById('exportPdfBtn').addEventListener('click', generatePDF);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
  document.getElementById('importJsonBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);

  // Gerusttyp-Toggle
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Anschrift: Titel live aktualisieren + Auto-Save
  ['fieldStrasse', 'fieldNummer', 'fieldPlz', 'fieldOrt', 'fieldBauherr'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const proj = getCurrentProject();
      if (!proj) return;
      proj.anschrift = collectAnschrift();
      proj.geaendert = new Date().toISOString().slice(0, 10);
      document.getElementById('projectScreenTitle').textContent = getProjectLabel(proj);
      saveProjects();
    });
  });
}

document.addEventListener('DOMContentLoaded', initApp);
