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

// Konvertiert altes boolean-extra in numerischen Zuschlag
function normalizeExtra(raw) {
  if (typeof raw === 'boolean') return raw ? 2 : 0;
  const n = parseNum(raw);
  return isNaN(n) ? 0 : Math.max(0, n);
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
//  Startseite - Projektliste
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
    const typeDisplay = (typ === 'sonder' && proj.geruesttypName)
      ? proj.geruesttypName
      : getTypeLabel(typ);
    const metaParts = [
      typeDisplay,
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
    geruesttypName: '',
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

  document.getElementById('projectScreenTitle').textContent = getProjectLabel(proj);

  const a = proj.anschrift || {};
  document.getElementById('fieldStrasse').value = a.strasse || '';
  document.getElementById('fieldNummer').value = a.nummer || '';
  document.getElementById('fieldPlz').value = a.plz || '';
  document.getElementById('fieldOrt').value = a.ort || '';
  document.getElementById('fieldBauherr').value = a.bauherr || '';

  const typ = proj.geruesttyp || 'fassade';
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === typ);
  });
  document.getElementById('sonderNameRow').style.display = typ === 'sonder' ? '' : 'none';
  document.getElementById('fieldSonderName').value = proj.geruesttypName || '';

  renderSeiten(proj.seiten || []);
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
      const inp = row.querySelector('.meas-input');
      const extraInp = row.querySelector('.meas-extra-input');
      const v = parseNum(inp ? inp.value : '');
      const extra = extraInp ? (parseNum(extraInp.value) || 0) : 0;
      hoehen.push({ label: 'H' + (i + 1), wert: isNaN(v) ? null : v, extra });
    });

    const laengen = [];
    lRows.forEach((row, i) => {
      const inp = row.querySelector('.meas-input');
      const extraInp = row.querySelector('.meas-extra-input');
      const v = parseNum(inp ? inp.value : '');
      const extra = extraInp ? (parseNum(extraInp.value) || 0) : 0;
      laengen.push({ label: 'L' + (i + 1), wert: isNaN(v) ? null : v, extra });
    });

    // Zubehor
    const konsoleActiveBtn = card.querySelector('.konsole-btn.active');
    const konsoleLenInp = card.querySelector('.accessory-length-input[data-acc="konsole"]');
    const konsoleL1Btn  = card.querySelector('.accessory-l1-btn[data-acc="konsole"]');
    const konsoleLen = konsoleLenInp ? parseNum(konsoleLenInp.value) : NaN;

    const igToggle = card.querySelector('.accessory-toggle[data-acc="ig"]');
    const igLenInp = card.querySelector('.accessory-length-input[data-acc="ig"]');
    const igL1Btn  = card.querySelector('.accessory-l1-btn[data-acc="ig"]');
    const igLen = igLenInp ? parseNum(igLenInp.value) : NaN;

    const dfToggle = card.querySelector('.accessory-toggle[data-acc="df"]');
    const dfLenInp = card.querySelector('.accessory-length-input[data-acc="df"]');
    const dfL1Btn  = card.querySelector('.accessory-l1-btn[data-acc="df"]');
    const dfLen = dfLenInp ? parseNum(dfLenInp.value) : NaN;

    result.push({
      id:         card.dataset.sideId,
      name:       sel ? sel.value : '',
      manualName: manual ? manual.value.trim() : '',
      hoehen,
      laengen,
      konsole: konsoleActiveBtn ? {
        typ:    konsoleActiveBtn.dataset.typ,
        laenge: isNaN(konsoleLen) ? null : konsoleLen,
        autoL1: konsoleL1Btn ? konsoleL1Btn.dataset.active === '1' : false
      } : null,
      innengelaender: (igToggle && igToggle.classList.contains('active')) ? {
        laenge: isNaN(igLen) ? null : igLen,
        autoL1: igL1Btn ? igL1Btn.dataset.active === '1' : false
      } : null,
      dachfang: (dfToggle && dfToggle.classList.contains('active')) ? {
        laenge: isNaN(dfLen) ? null : dfLen,
        autoL1: dfL1Btn ? dfL1Btn.dataset.active === '1' : false
      } : null
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

  proj.anschrift      = collectAnschrift();
  proj.geruesttyp     = collectGeruesttyp();
  proj.geruesttypName = document.getElementById('fieldSonderName').value.trim();
  proj.seiten         = collectSeiten();
  proj.geaendert      = new Date().toISOString().slice(0, 10);

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

  // Gemeinsames onChange - aktualisiert Vorschau, Zusammenfassung und L1-Sync
  let accSectionRef = null;
  const mainOnChange = () => {
    updateCardPreview(card, previewEl);
    updateSummary();
    if (accSectionRef && accSectionRef._syncL1) accSectionRef._syncL1();
  };

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
    mainOnChange();
  });

  manualInput.addEventListener('input', () => {
    updateTitle();
    mainOnChange();
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
      : [{ label: 'H1', wert: null, extra: 0 }],
    '+ Hohe hinzufugen',
    mainOnChange
  );

  // --- Langen ---
  const laengenSection = createMeasSection(
    'Langen',
    'L',
    'laengen-rows',
    seiteData.laengen && seiteData.laengen.length > 0
      ? seiteData.laengen
      : [{ label: 'L1', wert: null, extra: 0 }],
    '+ Lange hinzufugen',
    mainOnChange
  );

  // --- Zubehor ---
  accSectionRef = createAccessoriesSection(seiteData, card, mainOnChange);

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
  body.appendChild(accSectionRef);
  body.appendChild(footer);

  card.appendChild(header);
  card.appendChild(body);

  header.addEventListener('click', () => {
    const isOpen = !body.classList.contains('collapsed');
    body.classList.toggle('collapsed', isOpen);
    chevron.classList.toggle('open', !isOpen);
  });

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
    const extraDefault = normalizeExtra(item.extra);
    rowsContainer.appendChild(
      createMeasRow(prefix + (i + 1), item.wert, extraDefault, rowsContainer, prefix, onChange)
    );
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'meas-add-btn';
  addBtn.textContent = addBtnText;
  addBtn.addEventListener('click', () => {
    const count = rowsContainer.querySelectorAll('.meas-row').length;
    const type = collectGeruesttyp();
    const extra = type === 'fassade' || type === 'dach' ? 2 : 0;
    rowsContainer.appendChild(
      createMeasRow(prefix + (count + 1), null, extra, rowsContainer, prefix, onChange)
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

function createMeasRow(labelText, value, extraValue, rowsContainer, prefix, onChange) {
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

  // Zuschlag: editierbares Zahlenfeld (+ [Wert] m)
  const extraWrap = document.createElement('div');
  extraWrap.className = 'meas-extra-wrap';

  const extraPrefix = document.createElement('span');
  extraPrefix.className = 'meas-extra-prefix';
  extraPrefix.textContent = '+';

  const extraInput = document.createElement('input');
  extraInput.type = 'number';
  extraInput.className = 'meas-extra-input' + (extraValue > 0 ? ' active' : '');
  extraInput.step = '0.5';
  extraInput.min = '0';
  extraInput.inputMode = 'decimal';
  extraInput.placeholder = '0';
  extraInput.title = 'Zuschlag in Metern (0 = kein Zuschlag)';
  if (extraValue > 0) extraInput.value = extraValue;
  extraInput.addEventListener('input', () => {
    const val = parseNum(extraInput.value) || 0;
    extraInput.classList.toggle('active', val > 0);
    onChange();
  });

  const extraSuffix = document.createElement('span');
  extraSuffix.className = 'meas-extra-prefix';
  extraSuffix.textContent = 'm';

  extraWrap.appendChild(extraPrefix);
  extraWrap.appendChild(extraInput);
  extraWrap.appendChild(extraSuffix);

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
  row.appendChild(extraWrap);
  row.appendChild(removeBtn);

  return row;
}

// Effektiven Wert einer Messzeile ermitteln (Basiswert + Zuschlag)
function getMeasRowValue(row) {
  const inp = row.querySelector('.meas-input');
  const extraInp = row.querySelector('.meas-extra-input');
  const base = parseNum(inp ? inp.value : '');
  const extra = extraInp ? (parseNum(extraInp.value) || 0) : 0;
  if (isNaN(base)) return { base: null, extra, effective: null };
  return { base, extra, effective: base + extra };
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
  const hRows = card.querySelectorAll('.hoehen-rows .meas-row');
  const lRows = card.querySelectorAll('.laengen-rows .meas-row');

  const parts = [];
  hRows.forEach((row, i) => {
    const { effective } = getMeasRowValue(row);
    if (effective !== null && effective > 0) parts.push('H' + (i + 1) + ': ' + fmtNum(effective));
  });
  lRows.forEach((row, i) => {
    const { effective } = getMeasRowValue(row);
    if (effective !== null && effective > 0) parts.push('L' + (i + 1) + ': ' + fmtNum(effective));
  });

  previewEl.textContent = parts.join('  ') || '';
}

// ============================================================
//  Neue Seite hinzufugen
// ============================================================

function addSide() {
  const container = document.getElementById('seitenContainer');
  const type = collectGeruesttyp();
  const autoExtra = type === 'fassade' || type === 'dach' ? 2 : 0;
  const newSide = {
    id:             genId('side'),
    name:           'Strassenseite',
    manualName:     '',
    hoehen:         [{ label: 'H1', wert: null, extra: autoExtra }],
    laengen:        [{ label: 'L1', wert: null, extra: autoExtra }],
    konsole:        null,
    innengelaender: null,
    dachfang:       null
  };
  const el = createSeiteCard(newSide);
  container.appendChild(el);
  renumberSeitenBadges();
  refreshNoSidesHint();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateSummary();
}

// ============================================================
//  Zubehor-Abschnitt erstellen (Konsole / IG / DF)
// ============================================================

function createAccessoriesSection(seiteData, card, onChange) {
  const section = document.createElement('div');
  section.className = 'accessories-section';

  const title = document.createElement('div');
  title.className = 'accessories-title';
  title.textContent = 'Zubehor';
  section.appendChild(title);

  // Aktuellen L1-Effektivwert aus dieser Karte lesen
  function getL1() {
    const firstL = card.querySelector('.laengen-rows .meas-row');
    if (!firstL) return null;
    const { effective } = getMeasRowValue(firstL);
    return effective;
  }

  // Langenzeile mit [= L1]-Knopf erstellen
  function createLengthRow(accKey, initLaenge, initAutoL1) {
    const wrap = document.createElement('div');
    wrap.className = 'accessory-length-wrap';

    const l1Btn = document.createElement('button');
    l1Btn.type = 'button';
    l1Btn.className = 'accessory-l1-btn' + (initAutoL1 ? ' active' : '');
    l1Btn.dataset.active = initAutoL1 ? '1' : '0';
    l1Btn.dataset.acc = accKey;
    l1Btn.textContent = '= L1';
    l1Btn.title = 'Lange von L1 ubernehmen';

    const lenInp = document.createElement('input');
    lenInp.type = 'number';
    lenInp.className = 'accessory-length-input';
    lenInp.dataset.acc = accKey;
    lenInp.step = '0.01';
    lenInp.min = '0';
    lenInp.inputMode = 'decimal';
    lenInp.placeholder = '0,00';
    if (initLaenge !== null && initLaenge !== undefined && !isNaN(initLaenge)) {
      lenInp.value = initLaenge;
    }
    lenInp.disabled = initAutoL1;

    if (initAutoL1) {
      const v = getL1();
      if (v !== null && !isNaN(v)) lenInp.value = v;
    }

    l1Btn.addEventListener('click', () => {
      const nowActive = l1Btn.dataset.active === '1';
      l1Btn.dataset.active = nowActive ? '0' : '1';
      l1Btn.classList.toggle('active', !nowActive);
      lenInp.disabled = !nowActive;
      if (!nowActive) {
        const v = getL1();
        if (v !== null && !isNaN(v)) lenInp.value = v;
      }
      onChange();
    });

    lenInp.addEventListener('input', onChange);

    const unit = document.createElement('span');
    unit.className = 'accessory-length-unit';
    unit.textContent = 'm';

    wrap.appendChild(l1Btn);
    wrap.appendChild(lenInp);
    wrap.appendChild(unit);

    wrap._syncL1 = function() {
      if (l1Btn.dataset.active === '1') {
        const v = getL1();
        if (v !== null && !isNaN(v)) lenInp.value = v;
      }
    };

    return wrap;
  }

  // ---- Konsole ----
  const konsoleData = seiteData.konsole || null;

  const konsoleRow = document.createElement('div');
  konsoleRow.className = 'accessory-row';
  section.appendChild(konsoleRow);

  const konsoleLengthWrap = createLengthRow(
    'konsole',
    konsoleData ? konsoleData.laenge : null,
    konsoleData ? (konsoleData.autoL1 || false) : false
  );
  konsoleLengthWrap.style.display = konsoleData ? '' : 'none';
  section.appendChild(konsoleLengthWrap);

  ['0', '30', '50', '70', '109'].forEach(typ => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'konsole-btn' + (konsoleData && konsoleData.typ === typ ? ' active' : '');
    btn.dataset.typ = typ;
    btn.textContent = 'K ' + typ;
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      konsoleRow.querySelectorAll('.konsole-btn').forEach(b => b.classList.remove('active'));
      if (!wasActive) {
        btn.classList.add('active');
        konsoleLengthWrap.style.display = '';
      } else {
        konsoleLengthWrap.style.display = 'none';
      }
      onChange();
    });
    konsoleRow.appendChild(btn);
  });

  // ---- Innengeländer ----
  const igData = seiteData.innengelaender || null;

  const igRow = document.createElement('div');
  igRow.className = 'accessory-row';
  const igBtn = document.createElement('button');
  igBtn.type = 'button';
  igBtn.className = 'accessory-toggle' + (igData ? ' active' : '');
  igBtn.dataset.acc = 'ig';
  igBtn.textContent = 'Innengelaender (IG)';
  igRow.appendChild(igBtn);
  section.appendChild(igRow);

  const igLengthWrap = createLengthRow(
    'ig',
    igData ? igData.laenge : null,
    igData ? (igData.autoL1 || false) : false
  );
  igLengthWrap.style.display = igData ? '' : 'none';
  section.appendChild(igLengthWrap);

  igBtn.addEventListener('click', () => {
    const wasActive = igBtn.classList.contains('active');
    igBtn.classList.toggle('active', !wasActive);
    igLengthWrap.style.display = wasActive ? 'none' : '';
    onChange();
  });

  // ---- Dachfang ----
  const dfData = seiteData.dachfang || null;

  const dfRow = document.createElement('div');
  dfRow.className = 'accessory-row';
  const dfBtn = document.createElement('button');
  dfBtn.type = 'button';
  dfBtn.className = 'accessory-toggle' + (dfData ? ' active' : '');
  dfBtn.dataset.acc = 'df';
  dfBtn.textContent = 'Dachfang (DF)';
  dfRow.appendChild(dfBtn);
  section.appendChild(dfRow);

  const dfLengthWrap = createLengthRow(
    'df',
    dfData ? dfData.laenge : null,
    dfData ? (dfData.autoL1 || false) : false
  );
  dfLengthWrap.style.display = dfData ? '' : 'none';
  section.appendChild(dfLengthWrap);

  dfBtn.addEventListener('click', () => {
    const wasActive = dfBtn.classList.contains('active');
    dfBtn.classList.toggle('active', !wasActive);
    dfLengthWrap.style.display = wasActive ? 'none' : '';
    onChange();
  });

  // L1-Sync fur alle aktiven Zubehör-Langen aufrufen
  section._syncL1 = function() {
    konsoleLengthWrap._syncL1();
    igLengthWrap._syncL1();
    dfLengthWrap._syncL1();
  };

  return section;
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

    const hData = [];
    card.querySelectorAll('.hoehen-rows .meas-row').forEach((row, i) => {
      const { base, extra, effective } = getMeasRowValue(row);
      if (effective !== null && effective > 0) {
        hData.push({ label: 'H' + (i + 1), base, extra, effective });
      }
    });

    const lData = [];
    card.querySelectorAll('.laengen-rows .meas-row').forEach((row, i) => {
      const { base, extra, effective } = getMeasRowValue(row);
      if (effective !== null && effective > 0) {
        lData.push({ label: 'L' + (i + 1), base, extra, effective });
      }
    });

    const sumLen = lData.reduce((a, b) => a + b.effective, 0);
    let effH = 0;
    if (hData.length === 1) {
      effH = hData[0].effective;
    } else if (hData.length > 1) {
      effH = hData.reduce((a, b) => a + b.effective, 0) / hData.length;
    }

    const area = sumLen * effH;
    totalArea   += area;
    totalLength += sumLen;

    const detailParts = [];
    hData.forEach(h => {
      detailParts.push(h.extra > 0
        ? h.label + ': ' + fmtNum(h.base) + ' + ' + fmtNum(h.extra) + ' = ' + fmtNum(h.effective) + ' m'
        : h.label + ': ' + fmtNum(h.effective) + ' m');
    });
    lData.forEach(l => {
      detailParts.push(l.extra > 0
        ? l.label + ': ' + fmtNum(l.base) + ' + ' + fmtNum(l.extra) + ' = ' + fmtNum(l.effective) + ' m'
        : l.label + ': ' + fmtNum(l.effective) + ' m');
    });

    // Zubehor in Detailzeilen
    const konsoleBtn = card.querySelector('.konsole-btn.active');
    if (konsoleBtn) {
      const lenInp = card.querySelector('.accessory-length-input[data-acc="konsole"]');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push('Konsole ' + konsoleBtn.dataset.typ + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    }
    const igToggle = card.querySelector('.accessory-toggle[data-acc="ig"]');
    if (igToggle && igToggle.classList.contains('active')) {
      const lenInp = card.querySelector('.accessory-length-input[data-acc="ig"]');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push('IG' + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    }
    const dfToggle = card.querySelector('.accessory-toggle[data-acc="df"]');
    if (dfToggle && dfToggle.classList.contains('active')) {
      const lenInp = card.querySelector('.accessory-length-input[data-acc="df"]');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push('DF' + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    }

    const flaeche = area > 0
      ? fmtNum(sumLen) + ' m × ' + fmtNum(effH) + ' m = ' + fmtNum(area) + ' m²'
      : '';

    rows.push({ name, detailParts, flaeche, area });
  });

  let html = '<table class="summary-table">';

  rows.forEach(row => {
    const detail = row.detailParts.join('<br>');
    html += `
      <tr>
        <td>
          <span class="summary-side-name">${row.name}</span>
          ${detail ? `<span class="summary-side-detail">${detail}</span>` : ''}
          ${row.flaeche ? `<span class="summary-side-detail" style="margin-top:2px">${row.flaeche}</span>` : ''}
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

  const sonderName = document.getElementById('fieldSonderName').value.trim();
  const geruesttypLabel = geruesttyp === 'sonder'
    ? (sonderName || 'Sonder-Gerust')
    : getTypeLabel(geruesttyp);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const LM = 14;
  const PW = 182;
  let y = 16;

  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Aufmass-Bericht', LM, y);
  y += 10;

  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');

  const addrLine = [
    [anschrift.strasse, anschrift.nummer].filter(Boolean).join(' '),
    [anschrift.plz, anschrift.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');

  if (addrLine) { doc.text(addrLine, LM, y); y += 6; }
  if (anschrift.bauherr) { doc.text('Bauherr: ' + anschrift.bauherr, LM, y); y += 6; }
  doc.text('Gerusttyp: ' + geruesttypLabel, LM, y); y += 6;
  doc.text('Datum: ' + new Date().toLocaleDateString('de-DE'), LM, y); y += 10;

  let totalArea = 0;

  seiten.forEach((seite, idx) => {
    if (y > 260) { doc.addPage(); y = 16; }

    const name = seite.name === '__manual__' ? seite.manualName : seite.name;

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text((name || ('Seite ' + (idx + 1))), LM, y);
    y += 6;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);

    const hVals = seite.hoehen
      .filter(h => h.wert !== null && !isNaN(h.wert) && h.wert > 0)
      .map(h => {
        const extra = normalizeExtra(h.extra);
        return { ...h, extra, effective: h.wert + extra };
      });
    const lVals = seite.laengen
      .filter(l => l.wert !== null && !isNaN(l.wert) && l.wert > 0)
      .map(l => {
        const extra = normalizeExtra(l.extra);
        return { ...l, extra, effective: l.wert + extra };
      });

    if (hVals.length > 0) {
      const hStr = hVals.map((h, i) => {
        const s = 'H' + (i + 1) + ': ';
        return h.extra > 0
          ? s + fmtNum(h.wert) + ' + ' + fmtNum(h.extra) + ' = ' + fmtNum(h.effective) + ' m'
          : s + fmtNum(h.effective) + ' m';
      }).join('   ');
      doc.text('Hohen:  ' + hStr, LM + 4, y);
      y += 5;
    }
    if (lVals.length > 0) {
      const lStr = lVals.map((l, i) => {
        const s = 'L' + (i + 1) + ': ';
        return l.extra > 0
          ? s + fmtNum(l.wert) + ' + ' + fmtNum(l.extra) + ' = ' + fmtNum(l.effective) + ' m'
          : s + fmtNum(l.effective) + ' m';
      }).join('   ');
      doc.text('Langen: ' + lStr, LM + 4, y);
      y += 5;
    }

    const sumLen = lVals.reduce((a, b) => a + b.effective, 0);
    let effH = 0;
    if (hVals.length === 1) effH = hVals[0].effective;
    else if (hVals.length > 1) effH = hVals.reduce((a, b) => a + b.effective, 0) / hVals.length;

    const area = sumLen * effH;
    totalArea += area;

    if (area > 0) {
      doc.text(
        'Flache: ' + fmtNum(sumLen) + ' m × ' + fmtNum(effH) + ' m = ' + fmtNum(area) + ' m²',
        LM + 4, y
      );
      y += 5;
    }

    // Zubehor
    const accLines = [];
    if (seite.konsole) {
      const kLen = seite.konsole.laenge;
      accLines.push('Konsole ' + seite.konsole.typ +
        (kLen !== null && !isNaN(kLen) ? ': ' + fmtNum(kLen) + ' m' : ''));
    }
    if (seite.innengelaender) {
      const igLen = seite.innengelaender.laenge;
      accLines.push('Innengelaender' +
        (igLen !== null && !isNaN(igLen) ? ': ' + fmtNum(igLen) + ' m' : ''));
    }
    if (seite.dachfang) {
      const dfLen = seite.dachfang.laenge;
      accLines.push('Dachfang' +
        (dfLen !== null && !isNaN(dfLen) ? ': ' + fmtNum(dfLen) + ' m' : ''));
    }
    if (accLines.length > 0) {
      doc.text(accLines.join('   '), LM + 4, y);
      y += 5;
    }

    y += 4;
  });

  if (y > 265) { doc.addPage(); y = 16; }
  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Gesamtflache: ' + fmtNum(totalArea) + ' m²', LM, y);

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

  proj.anschrift      = collectAnschrift();
  proj.geruesttyp     = collectGeruesttyp();
  proj.geruesttypName = document.getElementById('fieldSonderName').value.trim();
  proj.seiten         = collectSeiten();
  proj.geaendert      = new Date().toISOString().slice(0, 10);
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

  document.getElementById('newProjectBtn').addEventListener('click', createNewProject);

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

  // Gerusttyp-Toggle + Sonder-Name ein-/ausblenden
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sonderNameRow').style.display =
        btn.dataset.type === 'sonder' ? '' : 'none';
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
