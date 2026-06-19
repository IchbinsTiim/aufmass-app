'use strict';

// ============================================================
//  Konstanten & Zustand
// ============================================================

const STORAGE_KEY = 'aufmass_projects_v2';

let projects = [];
let currentProjectId = null;

const ZUSATZ_ARTEN = [
  'Gerusttreppe','Verbreiterung','Konsole','Dachfanggerust',
  'Uberbruckung','Bekleidung','Schutzdach','Aufzug','Innengelander'
];
const ZUSATZ_EINHEITEN = ['m', 'm²', 'Stk.'];

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

const round2 = n => Math.round(n * 100) / 100;

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

// DIN 18451 Abschnitt-Berechnung
function berechneAbschnitt(laenge, hoeheBisBelag, einzelfeld) {
  const hoehe = round2((hoeheBisBelag || 0) + 2.0);
  const lEff  = round2(einzelfeld ? Math.max(laenge || 0, 2.5) : (laenge || 0));
  return { hoehe, laenge: lEff, flaeche: round2(lEff * hoehe) };
}

// Gesamt-Flache einer Karte (Summe aller Abschnitte)
function computeCardFlaeche(card) {
  let total = 0;
  card.querySelectorAll('.abschnitt-row').forEach(row => {
    const l  = parseNum(row.querySelector('.abschnitt-laenge')?.value);
    const h  = parseNum(row.querySelector('.abschnitt-hoehe')?.value);
    const ef = row.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    if (!isNaN(l) && !isNaN(h) && l > 0) {
      total += berechneAbschnitt(l, h, ef).flaeche;
    }
  });
  return total;
}

// Migration alter Projekte (hoehen/laengen → abschnitte)
function migrateSeite(seite) {
  if (seite.abschnitte) return seite;
  const hoehen = (seite.hoehen || []).filter(h => h.wert !== null && !isNaN(h.wert) && h.wert > 0);
  let hoeheBisBelag = null;
  if (hoehen.length > 0) {
    const avgH = hoehen.reduce((s, h) => {
      const ex = typeof h.extra === 'boolean' ? (h.extra ? 2 : 0) : (parseNum(h.extra) || 0);
      return s + ((h.wert || 0) + ex);
    }, 0) / hoehen.length;
    hoeheBisBelag = round2(Math.max(0, avgH - 2.0));
  }
  const laengen = (seite.laengen || []).filter(l => l.wert !== null && !isNaN(l.wert));
  const abschnitte = laengen.map(l => {
    const ex  = typeof l.extra === 'boolean' ? (l.extra ? 2 : 0) : (parseNum(l.extra) || 0);
    const eff = (l.wert || 0) + ex;
    return { bezeichnung: '', laenge: eff > 0 ? eff : null, hoeheBisBelag, einzelfeld: false };
  });
  if (abschnitte.length === 0) {
    abschnitte.push({ bezeichnung: '', laenge: null, hoeheBisBelag, einzelfeld: false });
  }
  return { ...seite, abschnitte };
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
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
  const listEl  = document.getElementById('projectList');
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
    const bauherr = proj.anschrift?.bauherr || '';
    const typeDisplay = (typ === 'sonder' && proj.geruesttypName)
      ? proj.geruesttypName : getTypeLabel(typ);
    const metaParts = [typeDisplay, seitenAnzahl + ' Seite' + (seitenAnzahl !== 1 ? 'n' : ''), fmtDate(proj.geaendert)];

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
    seiten: [],
    technik: {},
    logistik: {},
    zusatzpositionen: [],
    vorhaltungWochen: null,
    ortstermin: {}
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
  document.getElementById('fieldNummer').value  = a.nummer  || '';
  document.getElementById('fieldPlz').value     = a.plz     || '';
  document.getElementById('fieldOrt').value     = a.ort     || '';
  document.getElementById('fieldBauherr').value = a.bauherr || '';

  const typ = proj.geruesttyp || 'fassade';
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === typ);
  });
  document.getElementById('sonderNameRow').style.display = typ === 'sonder' ? '' : 'none';
  document.getElementById('fieldSonderName').value = proj.geruesttypName || '';

  loadTechnik(proj.technik);
  loadLogistik(proj.logistik);
  loadOrtstermin(proj.ortstermin);

  if (proj.vorhaltungWochen != null) {
    document.getElementById('fieldVorhaltungWochen').value = proj.vorhaltungWochen;
  } else {
    document.getElementById('fieldVorhaltungWochen').value = '';
  }

  renderSeiten((proj.seiten || []).map(migrateSeite));
  renderZusatzpositionen(proj.zusatzpositionen || []);
  updateSummary();
  showScreen('projectScreen');
}

// ============================================================
//  Daten sammeln
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

function collectTechnik() {
  const ankerVal = parseNum(document.getElementById('fieldAnkerAnzahl')?.value);
  return {
    lastklasse:        document.getElementById('fieldLastklasse')?.value        || '',
    breitenklasse:     document.getElementById('fieldBreitenklasse')?.value     || '',
    verwendungszweck:  document.getElementById('fieldVerwendungszweck')?.value  || '',
    verankerungsgrund: document.getElementById('fieldVerankerungsgrund')?.value || '',
    ankerAnzahl:       isNaN(ankerVal) ? null : ankerVal
  };
}

function loadTechnik(t) {
  if (!t) return;
  document.getElementById('fieldLastklasse').value        = t.lastklasse        || '';
  document.getElementById('fieldBreitenklasse').value     = t.breitenklasse     || '';
  document.getElementById('fieldVerwendungszweck').value  = t.verwendungszweck  || '';
  document.getElementById('fieldVerankerungsgrund').value = t.verankerungsgrund || '';
  document.getElementById('fieldAnkerAnzahl').value       = t.ankerAnzahl != null ? t.ankerAnzahl : '';
}

function setLogistikToggle(id, active) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.dataset.active = active ? '1' : '0';
  btn.classList.toggle('active', !!active);
}

function collectLogistik() {
  const anfahrtVal = parseNum(document.getElementById('fieldAnfahrtKm')?.value);
  return {
    anfahrtKm:              isNaN(anfahrtVal) ? null : anfahrtVal,
    untergrund:             document.getElementById('fieldUntergrund')?.value.trim()         || '',
    stellflaecheNotiz:      document.getElementById('fieldStellflaecheNotiz')?.value.trim()  || '',
    oeffentlicherGrund:     document.getElementById('toggleOeffentlich')?.dataset.active === '1',
    verkehrssicherung:      document.getElementById('toggleVerkehr')?.dataset.active    === '1',
    genehmigungErforderlich:document.getElementById('toggleGenehmigung')?.dataset.active === '1'
  };
}

function loadLogistik(l) {
  if (!l) return;
  document.getElementById('fieldAnfahrtKm').value         = l.anfahrtKm != null ? l.anfahrtKm : '';
  document.getElementById('fieldUntergrund').value        = l.untergrund        || '';
  document.getElementById('fieldStellflaecheNotiz').value = l.stellflaecheNotiz || '';
  setLogistikToggle('toggleOeffentlich', l.oeffentlicherGrund);
  setLogistikToggle('toggleVerkehr',     l.verkehrssicherung);
  setLogistikToggle('toggleGenehmigung', l.genehmigungErforderlich);
}

function collectOrtstermin() {
  return {
    datum: document.getElementById('fieldOrtsterminDatum')?.value || '',
    notiz: document.getElementById('fieldOrtsterminNotiz')?.value.trim() || ''
  };
}

function loadOrtstermin(o) {
  if (!o) return;
  document.getElementById('fieldOrtsterminDatum').value  = o.datum || '';
  document.getElementById('fieldOrtsterminNotiz').value  = o.notiz || '';
}

function collectZusatzpositionen() {
  const result = [];
  document.querySelectorAll('#zusatzContainer .zusatz-row').forEach(row => {
    const art      = row.querySelector('.zusatz-art')?.value      || '';
    const einheit  = row.querySelector('.zusatz-einheit')?.value  || 'm';
    const mengeVal = parseNum(row.querySelector('.zusatz-menge')?.value);
    const notiz    = row.querySelector('.zusatz-notiz')?.value.trim() || '';
    result.push({ art, einheit, menge: isNaN(mengeVal) ? null : mengeVal, notiz });
  });
  return result;
}

function collectSeiten() {
  const result = [];
  document.querySelectorAll('#seitenContainer .seite-card').forEach(card => {
    const sel    = card.querySelector('.seite-select');
    const manual = card.querySelector('.seite-manual-input');

    // Abschnitte
    const abschnitte = [];
    card.querySelectorAll('.abschnitt-row').forEach(row => {
      const bez     = row.querySelector('.abschnitt-bez')?.value.trim() || '';
      const laengeV = parseNum(row.querySelector('.abschnitt-laenge')?.value);
      const hoeheV  = parseNum(row.querySelector('.abschnitt-hoehe')?.value);
      const ef      = row.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
      abschnitte.push({
        bezeichnung:  bez,
        laenge:       isNaN(laengeV) ? null : laengeV,
        hoeheBisBelag: isNaN(hoeheV) ? null : hoeheV,
        einzelfeld:   ef
      });
    });

    // Konsolen
    const konsolen = [];
    card.querySelectorAll('.acc-konsole-list .acc-multi-row').forEach(row => {
      const activeTypBtn = row.querySelector('.konsole-btn.active');
      if (!activeTypBtn) return;
      const l1Btn  = row.querySelector('.accessory-l1-btn');
      const lenInp = row.querySelector('.accessory-length-input');
      const len    = lenInp ? parseNum(lenInp.value) : NaN;
      konsolen.push({
        typ:    activeTypBtn.dataset.typ,
        laenge: isNaN(len) ? null : len,
        autoL1: l1Btn ? l1Btn.dataset.active === '1' : false
      });
    });

    // Innengelander
    const innengelaender = [];
    card.querySelectorAll('.acc-ig-list .acc-multi-row').forEach(row => {
      const l1Btn  = row.querySelector('.accessory-l1-btn');
      const lenInp = row.querySelector('.accessory-length-input');
      const len    = lenInp ? parseNum(lenInp.value) : NaN;
      innengelaender.push({
        laenge: isNaN(len) ? null : len,
        autoL1: l1Btn ? l1Btn.dataset.active === '1' : false
      });
    });

    function collectSingleToggle(accKey) {
      const toggle = card.querySelector(`.accessory-toggle[data-acc="${accKey}"]`);
      if (!toggle || !toggle.classList.contains('active')) return null;
      const l1Btn  = card.querySelector(`.accessory-l1-btn[data-acc="${accKey}"]`);
      const lenInp = card.querySelector(`.accessory-length-input[data-acc="${accKey}"]`);
      const len    = lenInp ? parseNum(lenInp.value) : NaN;
      return { laenge: isNaN(len) ? null : len, autoL1: l1Btn ? l1Btn.dataset.active === '1' : false };
    }

    const ttToggle = card.querySelector('.accessory-toggle[data-acc="tt"]');
    const ttInp    = card.querySelector('.accessory-length-input[data-acc="tt"]');
    const ttVal    = ttInp ? parseNum(ttInp.value) : NaN;

    const ksInp  = card.querySelector('.ks-input');
    const ksVal  = ksInp ? parseNum(ksInp.value) : NaN;

    result.push({
      id:               card.dataset.sideId,
      name:             sel ? sel.value : '',
      manualName:       manual ? manual.value.trim() : '',
      abschnitte,
      konsolen,
      innengelaender,
      dachfang:          collectSingleToggle('df'),
      gittertraeger:     collectSingleToggle('gt'),
      fussgaengertunnel: collectSingleToggle('ft'),
      treppenturm: (ttToggle && ttToggle.classList.contains('active'))
        ? { hoehe: isNaN(ttVal) ? null : ttVal }
        : null,
      netze:    collectSingleToggle('ne'),
      ks:       isNaN(ksVal) ? null : ksVal,
      ksManual: ksInp ? !!ksInp._ksManual : false
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

  proj.anschrift        = collectAnschrift();
  proj.geruesttyp       = collectGeruesttyp();
  proj.geruesttypName   = document.getElementById('fieldSonderName').value.trim();
  proj.seiten           = collectSeiten();
  proj.technik          = collectTechnik();
  proj.logistik         = collectLogistik();
  proj.zusatzpositionen = collectZusatzpositionen();
  proj.ortstermin       = collectOrtstermin();

  const wochenVal = parseNum(document.getElementById('fieldVorhaltungWochen')?.value);
  proj.vorhaltungWochen = isNaN(wochenVal) ? null : wochenVal;

  proj.geaendert = new Date().toISOString().slice(0, 10);
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
  hint.classList.toggle('hidden', container.querySelectorAll('.seite-card').length > 0);
}

// ============================================================
//  Seite-Karte erstellen
// ============================================================

function createSeiteCard(seiteData) {
  const sideId = seiteData.id || genId('side');

  const card = document.createElement('div');
  card.className = 'seite-card';
  card.dataset.sideId = sideId;

  // Header
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

  // Body
  const body = document.createElement('div');
  body.className = 'seite-body';

  let accSectionRef = null;
  let ksInputRef    = null;

  const mainOnChange = () => {
    updateCardPreview(card, previewEl);
    updateSummary();
    if (accSectionRef && accSectionRef._syncL1) accSectionRef._syncL1();
    if (ksInputRef && !ksInputRef._ksManual) {
      const fl = computeCardFlaeche(card);
      ksInputRef.value = fl > 0 ? fl.toFixed(2) : '';
    }
  };

  // Name-Auswahl
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
    titleEl.textContent = nameSelect.value === '__manual__'
      ? (manualInput.value.trim() || 'Unbenannte Seite')
      : nameSelect.value;
  }

  nameSelect.addEventListener('change', () => {
    manualInput.style.display = nameSelect.value === '__manual__' ? '' : 'none';
    updateTitle();
    mainOnChange();
  });
  manualInput.addEventListener('input', () => { updateTitle(); mainOnChange(); });

  nameRow.appendChild(nameSelect);
  nameRow.appendChild(manualInput);

  // Abschnitte
  const abschnittSection = createAbschnittSection(seiteData, mainOnChange);

  // Zubehor
  accSectionRef = createAccessoriesSection(seiteData, card, mainOnChange);

  // KS
  const ksRow = document.createElement('div');
  ksRow.className = 'ks-row';

  const ksLabel = document.createElement('span');
  ksLabel.className = 'ks-label';
  ksLabel.textContent = 'KS';

  const ksInput = document.createElement('input');
  ksInput.type = 'number';
  ksInput.className = 'ks-input';
  ksInput.step = '0.01';
  ksInput.min = '0';
  ksInput.inputMode = 'decimal';
  ksInput.placeholder = '0,00';
  ksInput._ksManual = !!(seiteData.ksManual);
  if (seiteData.ks !== null && seiteData.ks !== undefined && !isNaN(seiteData.ks)) {
    ksInput.value = seiteData.ks;
  }
  ksInput.addEventListener('input', () => { ksInput._ksManual = true; });
  ksInputRef = ksInput;

  const ksUnit = document.createElement('span');
  ksUnit.className = 'ks-unit';
  ksUnit.textContent = 'm²';

  const ksResetBtn = document.createElement('button');
  ksResetBtn.type = 'button';
  ksResetBtn.className = 'ks-reset-btn';
  ksResetBtn.textContent = '= Fl.';
  ksResetBtn.addEventListener('click', () => {
    ksInput._ksManual = false;
    const fl = computeCardFlaeche(card);
    ksInput.value = fl > 0 ? fl.toFixed(2) : '';
  });

  ksRow.appendChild(ksLabel);
  ksRow.appendChild(ksInput);
  ksRow.appendChild(ksUnit);
  ksRow.appendChild(ksResetBtn);

  // Loschen
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
  body.appendChild(abschnittSection);
  body.appendChild(ksRow);
  body.appendChild(accSectionRef);
  body.appendChild(footer);

  card.appendChild(header);
  card.appendChild(body);

  header.addEventListener('click', () => {
    const isOpen = !body.classList.contains('collapsed');
    body.classList.toggle('collapsed', isOpen);
    chevron.classList.toggle('open', !isOpen);
  });

  // Initialer KS-Sync
  if (ksInputRef && !ksInputRef._ksManual) {
    const fl = computeCardFlaeche(card);
    if (fl > 0) ksInputRef.value = fl.toFixed(2);
  }

  updateCardPreview(card, previewEl);
  return card;
}

// ============================================================
//  Abschnitt-Sektion (DIN 18451)
// ============================================================

function createAbschnittSection(seiteData, onChange) {
  const section = document.createElement('div');
  section.className = 'abschnitt-section';

  const label = document.createElement('div');
  label.className = 'meas-section-label';
  label.textContent = 'Abschnitte (DIN 18451)';
  section.appendChild(label);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'abschnitt-rows';

  const initData = (seiteData.abschnitte && seiteData.abschnitte.length > 0)
    ? seiteData.abschnitte
    : [{ bezeichnung: '', laenge: null, hoeheBisBelag: null, einzelfeld: false }];

  initData.forEach(a => rowsContainer.appendChild(createAbschnittRow(a, rowsContainer, onChange)));

  section.appendChild(rowsContainer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'meas-add-btn';
  addBtn.textContent = '+ Abschnitt';
  addBtn.addEventListener('click', () => {
    rowsContainer.appendChild(
      createAbschnittRow({ bezeichnung: '', laenge: null, hoeheBisBelag: null, einzelfeld: false }, rowsContainer, onChange)
    );
    onChange();
  });
  section.appendChild(addBtn);

  return section;
}

function createAbschnittRow(data, container, onChange) {
  const row = document.createElement('div');
  row.className = 'abschnitt-row';

  // Zeile 1: Bezeichnung + Remove
  const topLine = document.createElement('div');
  topLine.className = 'abschnitt-top-line';

  const bezInp = document.createElement('input');
  bezInp.type = 'text';
  bezInp.className = 'abschnitt-bez';
  bezInp.placeholder = 'Bezeichnung (optional)';
  bezInp.value = data.bezeichnung || '';
  bezInp.addEventListener('input', onChange);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meas-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => {
    if (container.querySelectorAll('.abschnitt-row').length > 1) {
      row.remove();
      onChange();
    }
  });

  topLine.appendChild(bezInp);
  topLine.appendChild(removeBtn);

  // Zeile 2: Masse
  const midLine = document.createElement('div');
  midLine.className = 'abschnitt-measures';

  // Lange
  const laengeWrap = document.createElement('div');
  laengeWrap.className = 'abschnitt-field';
  const laengeLbl = document.createElement('span');
  laengeLbl.className = 'abschnitt-field-label';
  laengeLbl.textContent = 'Lange';
  const laengeInp = document.createElement('input');
  laengeInp.type = 'number';
  laengeInp.className = 'abschnitt-laenge';
  laengeInp.step = '0.01';
  laengeInp.min = '0';
  laengeInp.inputMode = 'decimal';
  laengeInp.placeholder = '0,00';
  if (data.laenge !== null && data.laenge !== undefined && !isNaN(data.laenge)) laengeInp.value = data.laenge;
  const laengeUnit = document.createElement('span');
  laengeUnit.className = 'abschnitt-field-unit';
  laengeUnit.textContent = 'm';
  laengeWrap.appendChild(laengeLbl);
  laengeWrap.appendChild(laengeInp);
  laengeWrap.appendChild(laengeUnit);

  // Hohe bis Belag
  const hoeheWrap = document.createElement('div');
  hoeheWrap.className = 'abschnitt-field';
  const hoeheLbl = document.createElement('span');
  hoeheLbl.className = 'abschnitt-field-label';
  hoeheLbl.textContent = 'H bis Belag';
  const hoeheInp = document.createElement('input');
  hoeheInp.type = 'number';
  hoeheInp.className = 'abschnitt-hoehe';
  hoeheInp.step = '0.01';
  hoeheInp.min = '0';
  hoeheInp.inputMode = 'decimal';
  hoeheInp.placeholder = '0,00';
  if (data.hoeheBisBelag !== null && data.hoeheBisBelag !== undefined && !isNaN(data.hoeheBisBelag)) hoeheInp.value = data.hoeheBisBelag;
  const hoeheUnit = document.createElement('span');
  hoeheUnit.className = 'abschnitt-field-unit';
  hoeheUnit.textContent = 'm';
  hoeheWrap.appendChild(hoeheLbl);
  hoeheWrap.appendChild(hoeheInp);
  hoeheWrap.appendChild(hoeheUnit);

  // Einzelfeld
  const efBtn = document.createElement('button');
  efBtn.type = 'button';
  efBtn.className = 'einzelfeld-btn' + (data.einzelfeld ? ' active' : '');
  efBtn.textContent = 'Einzelfeld';
  efBtn.addEventListener('click', () => {
    efBtn.classList.toggle('active');
    updateCalc();
    onChange();
  });

  midLine.appendChild(laengeWrap);
  midLine.appendChild(hoeheWrap);
  midLine.appendChild(efBtn);

  // Zeile 3: Berechnungsergebnis
  const calcLine = document.createElement('div');
  calcLine.className = 'abschnitt-calc';

  const calcSpan = document.createElement('span');
  calcLine.appendChild(calcSpan);

  function updateCalc() {
    const l  = parseNum(laengeInp.value);
    const h  = parseNum(hoeheInp.value);
    const ef = efBtn.classList.contains('active');
    if (!isNaN(l) && !isNaN(h) && l > 0) {
      const c = berechneAbschnitt(l, h, ef);
      const efHint = ef && l < 2.5 ? ' (mind. 2,50 m)' : '';
      calcSpan.textContent = 'Eff. H: ' + fmtNum(c.hoehe) + ' m· L: ' + fmtNum(c.laenge) + ' m' + efHint + '→ ' + fmtNum(c.flaeche) + ' m²';
    } else {
      calcSpan.textContent = '–';
    }
  }

  laengeInp.addEventListener('input', () => { updateCalc(); onChange(); });
  hoeheInp.addEventListener('input',  () => { updateCalc(); onChange(); });

  updateCalc();

  row.appendChild(topLine);
  row.appendChild(midLine);
  row.appendChild(calcLine);

  return row;
}

// ============================================================
//  Vorschau-Text
// ============================================================

function updateCardPreview(card, previewEl) {
  let totalFl = 0;
  card.querySelectorAll('.abschnitt-row').forEach(row => {
    const l  = parseNum(row.querySelector('.abschnitt-laenge')?.value);
    const h  = parseNum(row.querySelector('.abschnitt-hoehe')?.value);
    const ef = row.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    if (!isNaN(l) && !isNaN(h) && l > 0) totalFl += berechneAbschnitt(l, h, ef).flaeche;
  });
  previewEl.textContent = totalFl > 0 ? fmtNum(totalFl) + ' m²' : '';
}

function renumberSeitenBadges() {
  document.querySelectorAll('#seitenContainer .seite-card').forEach((card, i) => {
    const badge = card.querySelector('.seite-number');
    if (badge) badge.textContent = i + 1;
  });
}

// ============================================================
//  Neue Seite hinzufugen
// ============================================================

function addSide() {
  const container = document.getElementById('seitenContainer');
  const newSide = {
    id:             genId('side'),
    name:           'Strassenseite',
    manualName:     '',
    abschnitte:     [{ bezeichnung: '', laenge: null, hoeheBisBelag: null, einzelfeld: false }],
    konsolen:          [],
    innengelaender:    [],
    dachfang:          null,
    gittertraeger:     null,
    fussgaengertunnel: null,
    treppenturm:       null,
    netze:             null,
    ks:                null,
    ksManual:          false
  };
  const el = createSeiteCard(newSide);
  container.appendChild(el);
  renumberSeitenBadges();
  refreshNoSidesHint();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateSummary();
}

// ============================================================
//  Zusatzpositionen
// ============================================================

function renderZusatzpositionen(list) {
  const container = document.getElementById('zusatzContainer');
  container.innerHTML = '';
  (list || []).forEach(z => container.appendChild(createZusatzRow(z)));
  refreshNoZusatzHint();
}

function refreshNoZusatzHint() {
  const container = document.getElementById('zusatzContainer');
  const hint = document.getElementById('noZusatzHint');
  if (hint) hint.classList.toggle('hidden', container.querySelectorAll('.zusatz-row').length > 0);
}

function createZusatzRow(data) {
  const row = document.createElement('div');
  row.className = 'zusatz-row';

  // Art
  const artSel = document.createElement('select');
  artSel.className = 'zusatz-art';
  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '– Art wahlen –';
  artSel.appendChild(optEmpty);
  ZUSATZ_ARTEN.forEach(art => {
    const o = document.createElement('option');
    o.value = art;
    o.textContent = art;
    artSel.appendChild(o);
  });
  artSel.value = data?.art || '';

  // Einheit
  const einheitSel = document.createElement('select');
  einheitSel.className = 'zusatz-einheit';
  ZUSATZ_EINHEITEN.forEach(e => {
    const o = document.createElement('option');
    o.value = e;
    o.textContent = e;
    einheitSel.appendChild(o);
  });
  einheitSel.value = data?.einheit || 'm';

  // Menge
  const mengeInp = document.createElement('input');
  mengeInp.type = 'number';
  mengeInp.className = 'zusatz-menge';
  mengeInp.step = '0.01';
  mengeInp.min = '0';
  mengeInp.inputMode = 'decimal';
  mengeInp.placeholder = '0,00';
  if (data?.menge !== null && data?.menge !== undefined && !isNaN(data.menge)) mengeInp.value = data.menge;

  // Notiz
  const notizInp = document.createElement('input');
  notizInp.type = 'text';
  notizInp.className = 'zusatz-notiz';
  notizInp.placeholder = 'Notiz (optional)';
  notizInp.value = data?.notiz || '';

  // Remove
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meas-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => { row.remove(); refreshNoZusatzHint(); });

  const topLine = document.createElement('div');
  topLine.className = 'zusatz-top';
  topLine.appendChild(artSel);
  topLine.appendChild(einheitSel);
  topLine.appendChild(mengeInp);
  topLine.appendChild(removeBtn);

  const notizLine = document.createElement('div');
  notizLine.className = 'zusatz-notiz-row';
  notizLine.appendChild(notizInp);

  row.appendChild(topLine);
  row.appendChild(notizLine);

  return row;
}

// ============================================================
//  Hilfsfunktionen fur Zubehor-Abschnitt
// ============================================================

function makeAccLabel(text) {
  const el = document.createElement('span');
  el.className = 'acc-entry-label';
  el.textContent = text;
  return el;
}

function makeAddBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meas-add-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

// ============================================================
//  Zubehor-Abschnitt
// ============================================================

function createAccessoriesSection(seiteData, card, onChange) {
  const section = document.createElement('div');
  section.className = 'accessories-section';

  const title = document.createElement('div');
  title.className = 'accessories-title';
  title.textContent = 'Zubehor';
  section.appendChild(title);

  // Erste Abschnitt-Lange (fur "= L1")
  function getL1() {
    const firstRow = card.querySelector('.abschnitt-row');
    if (!firstRow) return null;
    const l  = parseNum(firstRow.querySelector('.abschnitt-laenge')?.value);
    const ef = firstRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    if (isNaN(l)) return null;
    return berechneAbschnitt(l, 0, ef).laenge;
  }

  function createInlineLength(accKey, initLaenge, initAutoL1, unitLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'acc-inline-length';

    const l1Btn = document.createElement('button');
    l1Btn.type = 'button';
    l1Btn.className = 'accessory-l1-btn' + (initAutoL1 ? ' active' : '');
    l1Btn.dataset.active = initAutoL1 ? '1' : '0';
    if (accKey) l1Btn.dataset.acc = accKey;
    l1Btn.textContent = '= L1';
    l1Btn.title = 'Lange von erstem Abschnitt ubernehmen';

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'accessory-length-input';
    if (accKey) inp.dataset.acc = accKey;
    inp.step = '0.01';
    inp.min = '0';
    inp.inputMode = 'decimal';
    inp.placeholder = '0,00';
    if (initLaenge !== null && initLaenge !== undefined && !isNaN(initLaenge)) inp.value = initLaenge;
    inp.disabled = initAutoL1;
    if (initAutoL1) { const v = getL1(); if (v !== null && !isNaN(v)) inp.value = v; }

    l1Btn.addEventListener('click', () => {
      const nowActive = l1Btn.dataset.active === '1';
      l1Btn.dataset.active = nowActive ? '0' : '1';
      l1Btn.classList.toggle('active', !nowActive);
      inp.disabled = !nowActive;
      if (!nowActive) { const v = getL1(); if (v !== null && !isNaN(v)) inp.value = v; }
      onChange();
    });
    inp.addEventListener('input', onChange);

    const unit = document.createElement('span');
    unit.className = 'accessory-length-unit';
    unit.textContent = unitLabel || 'm';

    wrap.appendChild(l1Btn);
    wrap.appendChild(inp);
    wrap.appendChild(unit);
    return wrap;
  }

  function createSingleAcc(accKey, labelText, initData) {
    const row = document.createElement('div');
    row.className = 'acc-single-row';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'accessory-toggle' + (initData ? ' active' : '');
    toggleBtn.dataset.acc = accKey;
    toggleBtn.textContent = labelText;

    const lenWrap = createInlineLength(accKey, initData ? initData.laenge : null, initData ? (initData.autoL1 || false) : false);
    lenWrap.style.display = initData ? '' : 'none';

    toggleBtn.addEventListener('click', () => {
      const wasActive = toggleBtn.classList.contains('active');
      toggleBtn.classList.toggle('active', !wasActive);
      lenWrap.style.display = wasActive ? 'none' : '';
      onChange();
    });

    row.appendChild(toggleBtn);
    row.appendChild(lenWrap);
    return row;
  }

  // Konsolen
  const konsoleTitleRow = document.createElement('div');
  konsoleTitleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';
  const konsoleLbl = document.createElement('span');
  konsoleLbl.className = 'accessories-title';
  konsoleLbl.textContent = 'Konsole';
  konsoleTitleRow.appendChild(konsoleLbl);

  const konsoleList = document.createElement('div');
  konsoleList.className = 'acc-multi-list acc-konsole-list';

  function addKonsoleRow(data) {
    const row = document.createElement('div');
    row.className = 'acc-multi-row';

    const typeBtns = document.createElement('div');
    typeBtns.className = 'acc-type-btns';
    ['0', '30', '50', '70', '109'].forEach(typ => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'konsole-btn' + (data && data.typ === typ ? ' active' : '');
      btn.dataset.typ = typ;
      btn.textContent = typ;
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        typeBtns.querySelectorAll('.konsole-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) btn.classList.add('active');
        onChange();
      });
      typeBtns.appendChild(btn);
    });

    const lenWrap = createInlineLength(null, data ? data.laenge : null, data ? (data.autoL1 || false) : false);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meas-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => { row.remove(); onChange(); });

    row.appendChild(typeBtns);
    row.appendChild(lenWrap);
    row.appendChild(removeBtn);
    konsoleList.appendChild(row);
  }

  const konsoleInit = Array.isArray(seiteData.konsolen)
    ? seiteData.konsolen
    : (seiteData.konsole ? [seiteData.konsole] : []);
  konsoleInit.forEach(k => addKonsoleRow(k));

  const addKonsoleBtn = makeAddBtn('+ Konsole', () => { addKonsoleRow(null); onChange(); });
  konsoleTitleRow.appendChild(addKonsoleBtn);
  section.appendChild(konsoleTitleRow);
  section.appendChild(konsoleList);

  // Innengelander
  const igTitleRow = document.createElement('div');
  igTitleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';
  const igLbl = document.createElement('span');
  igLbl.className = 'accessories-title';
  igLbl.textContent = 'Innengelander';
  igTitleRow.appendChild(igLbl);

  const igList = document.createElement('div');
  igList.className = 'acc-multi-list acc-ig-list';

  function addIgRow(data) {
    const row = document.createElement('div');
    row.className = 'acc-multi-row';
    row.appendChild(makeAccLabel('IG'));
    const lenWrap = createInlineLength(null, data ? data.laenge : null, data ? (data.autoL1 || false) : false);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meas-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => { row.remove(); onChange(); });
    row.appendChild(lenWrap);
    row.appendChild(removeBtn);
    igList.appendChild(row);
  }

  const igInit = Array.isArray(seiteData.innengelaender)
    ? seiteData.innengelaender
    : (seiteData.innengelaender ? [seiteData.innengelaender] : []);
  igInit.forEach(ig => addIgRow(ig));

  const addIgBtn = makeAddBtn('+ IG', () => { addIgRow(null); onChange(); });
  igTitleRow.appendChild(addIgBtn);
  section.appendChild(igTitleRow);
  section.appendChild(igList);

  // Einzelne Zubehor
  section.appendChild(createSingleAcc('df', 'Dachfang (DF)',          seiteData.dachfang          || null));
  section.appendChild(createSingleAcc('gt', 'Gittertrager (GT)',       seiteData.gittertraeger     || null));
  section.appendChild(createSingleAcc('ft', 'Fussgangertunnel (FT)',   seiteData.fussgaengertunnel || null));

  // Treppenturm (Hohe)
  const ttData = seiteData.treppenturm || null;
  const ttRow  = document.createElement('div');
  ttRow.className = 'acc-single-row';

  const ttBtn = document.createElement('button');
  ttBtn.type = 'button';
  ttBtn.className = 'accessory-toggle' + (ttData ? ' active' : '');
  ttBtn.dataset.acc = 'tt';
  ttBtn.textContent = 'Treppenturm (TT)';

  const ttWrap = document.createElement('div');
  ttWrap.className = 'acc-inline-length';
  ttWrap.style.display = ttData ? '' : 'none';

  const ttInp = document.createElement('input');
  ttInp.type = 'number';
  ttInp.className = 'accessory-length-input';
  ttInp.dataset.acc = 'tt';
  ttInp.step = '0.01';
  ttInp.min = '0';
  ttInp.inputMode = 'decimal';
  ttInp.placeholder = '0,00';
  if (ttData && ttData.hoehe !== null && !isNaN(ttData.hoehe)) ttInp.value = ttData.hoehe;
  ttInp.addEventListener('input', onChange);

  const ttUnit = document.createElement('span');
  ttUnit.className = 'accessory-length-unit';
  ttUnit.textContent = 'm (H)';

  ttWrap.appendChild(ttInp);
  ttWrap.appendChild(ttUnit);
  ttBtn.addEventListener('click', () => {
    const wasActive = ttBtn.classList.contains('active');
    ttBtn.classList.toggle('active', !wasActive);
    ttWrap.style.display = wasActive ? 'none' : '';
    onChange();
  });
  ttRow.appendChild(ttBtn);
  ttRow.appendChild(ttWrap);
  section.appendChild(ttRow);

  section.appendChild(createSingleAcc('ne', 'Netze (NE)', seiteData.netze || null));

  // L1-Sync
  section._syncL1 = function() {
    section.querySelectorAll('.accessory-l1-btn[data-active="1"]').forEach(l1Btn => {
      const wrap = l1Btn.closest('.acc-inline-length');
      if (!wrap) return;
      const inp = wrap.querySelector('.accessory-length-input');
      if (!inp) return;
      const v = getL1();
      if (v !== null && !isNaN(v)) inp.value = v;
    });
  };

  return section;
}

// ============================================================
//  Vorhaltung Kalkulation aktualisieren
// ============================================================

function updateVorhaltungCalc(totalFlaeche) {
  const calc = document.getElementById('fieldVorhaltungCalc');
  if (!calc) return;
  const wochen = parseNum(document.getElementById('fieldVorhaltungWochen')?.value);
  if (!isNaN(wochen) && wochen > 0 && totalFlaeche > 0) {
    calc.value = fmtNum(round2(totalFlaeche * wochen)) + ' m²·Wo.';
  } else {
    calc.value = '';
  }
}

// ============================================================
//  Zusammenfassung
// ============================================================

function updateSummary() {
  const el    = document.getElementById('summaryContent');
  const cards = document.querySelectorAll('#seitenContainer .seite-card');

  if (cards.length === 0) {
    el.innerHTML = '<p class="summary-empty">Noch keine Seiten erfasst.</p>';
    updateVorhaltungCalc(0);
    return;
  }

  let totalArea = 0;
  const rows = [];

  cards.forEach(card => {
    const sel    = card.querySelector('.seite-select');
    const manual = card.querySelector('.seite-manual-input');
    const name   = sel && sel.value === '__manual__'
      ? (manual ? manual.value.trim() || 'Unbenannte Seite' : 'Unbenannte Seite')
      : (sel ? sel.value : '');

    let seitenFlaeche = 0;
    const detailParts = [];

    card.querySelectorAll('.abschnitt-row').forEach(row => {
      const l   = parseNum(row.querySelector('.abschnitt-laenge')?.value);
      const h   = parseNum(row.querySelector('.abschnitt-hoehe')?.value);
      const ef  = row.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
      const bez = row.querySelector('.abschnitt-bez')?.value.trim() || '';
      if (!isNaN(l) && !isNaN(h) && l > 0) {
        const c = berechneAbschnitt(l, h, ef);
        seitenFlaeche += c.flaeche;
        const bezStr = bez ? bez + ': ' : '';
        const efStr  = ef && l < 2.5 ? ' (EF)' : '';
        detailParts.push(bezStr + fmtNum(c.laenge) + ' m × ' + fmtNum(c.hoehe) + ' m' + efStr + ' = ' + fmtNum(c.flaeche) + ' m²');
      }
    });

    totalArea += seitenFlaeche;

    // Zubehor
    card.querySelectorAll('.acc-konsole-list .acc-multi-row').forEach(row => {
      const activeTypBtn = row.querySelector('.konsole-btn.active');
      if (!activeTypBtn) return;
      const lenInp = row.querySelector('.accessory-length-input');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push('K ' + activeTypBtn.dataset.typ + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    });
    card.querySelectorAll('.acc-ig-list .acc-multi-row').forEach(row => {
      const lenInp = row.querySelector('.accessory-length-input');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push('IG' + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    });
    [{ acc: 'df', label: 'DF' }, { acc: 'gt', label: 'GT' }, { acc: 'ft', label: 'FT' }, { acc: 'ne', label: 'NE' }].forEach(({ acc, label }) => {
      const toggle = card.querySelector('.accessory-toggle[data-acc="' + acc + '"]');
      if (!toggle || !toggle.classList.contains('active')) return;
      const lenInp = card.querySelector('.accessory-length-input[data-acc="' + acc + '"]');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push(label + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m' : ''));
    });
    const ttToggle = card.querySelector('.accessory-toggle[data-acc="tt"]');
    if (ttToggle && ttToggle.classList.contains('active')) {
      const hoeheInp = card.querySelector('.accessory-length-input[data-acc="tt"]');
      const v = hoeheInp ? parseNum(hoeheInp.value) : NaN;
      detailParts.push('TT' + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' m (H)' : ''));
    }

    rows.push({ name, detailParts, flaeche: seitenFlaeche });
  });

  let html = '<table class="summary-table">';
  rows.forEach(row => {
    const detail = row.detailParts.join('<br>');
    html += `
      <tr>
        <td>
          <span class="summary-side-name">${row.name}</span>
          ${detail ? `<span class="summary-side-detail">${detail}</span>` : ''}
        </td>
        <td>${row.flaeche > 0 ? fmtNum(row.flaeche) + ' m²' : '–'}</td>
      </tr>`;
  });

  // Zusatzpositionen
  const zusatzRows = document.querySelectorAll('#zusatzContainer .zusatz-row');
  if (zusatzRows.length > 0) {
    html += `<tr><td colspan="2" style="padding-top:10px;font-size:0.72rem;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--color-border);">Zusatzpositionen</td></tr>`;
    zusatzRows.forEach(row => {
      const art     = row.querySelector('.zusatz-art')?.value   || '–';
      const einheit = row.querySelector('.zusatz-einheit')?.value || '';
      const menge   = parseNum(row.querySelector('.zusatz-menge')?.value);
      const notiz   = row.querySelector('.zusatz-notiz')?.value.trim();
      const mengeStr = !isNaN(menge) ? fmtNum(menge) + ' ' + einheit : '–';
      html += `<tr>
        <td><span class="summary-side-name" style="font-size:0.88rem">${art}</span>${notiz ? '<span class="summary-side-detail">' + notiz + '</span>' : ''}</td>
        <td>${mengeStr}</td>
      </tr>`;
    });
  }

  html += `
    <tr class="summary-total-row">
      <td>Gesamtflache</td>
      <td>${fmtNum(totalArea)} m²</td>
    </tr>`;

  const ankerAnzahl = parseNum(document.getElementById('fieldAnkerAnzahl')?.value);
  if (!isNaN(ankerAnzahl) && ankerAnzahl > 0) {
    html += `<tr><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">Ankeranzahl</td><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">${ankerAnzahl} Stk.</td></tr>`;
  }

  const wochen = parseNum(document.getElementById('fieldVorhaltungWochen')?.value);
  if (!isNaN(wochen) && wochen > 0 && totalArea > 0) {
    html += `<tr><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">Vorhaltung</td><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">${fmtNum(round2(totalArea * wochen))} m²·Wo.</td></tr>`;
  }

  html += '</table>';
  el.innerHTML = html;

  updateVorhaltungCalc(totalArea);
}

// ============================================================
//  PDF-Erstellung
// ============================================================

function generatePDF() {
  const anschrift      = collectAnschrift();
  const geruesttyp     = collectGeruesttyp();
  const seiten         = collectSeiten();
  const technik        = collectTechnik();
  const logistik       = collectLogistik();
  const zusatz         = collectZusatzpositionen();
  const ortstermin     = collectOrtstermin();
  const wochenVal      = parseNum(document.getElementById('fieldVorhaltungWochen')?.value);
  const vorhaltWochen  = isNaN(wochenVal) ? null : wochenVal;

  const sonderName = document.getElementById('fieldSonderName').value.trim();
  const geruesttypLabel = geruesttyp === 'sonder'
    ? (sonderName || 'Sonder-Gerust') : getTypeLabel(geruesttyp);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const LM = 14, PW = 182;
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

  if (addrLine)            { doc.text(addrLine, LM, y); y += 6; }
  if (anschrift.bauherr)   { doc.text('Bauherr: ' + anschrift.bauherr, LM, y); y += 6; }
  doc.text('Gerusttyp: ' + geruesttypLabel, LM, y); y += 6;
  doc.text('Datum: ' + new Date().toLocaleDateString('de-DE'), LM, y); y += 6;
  if (ortstermin.datum)    { doc.text('Ortstermin: ' + fmtDate(ortstermin.datum), LM, y); y += 6; }
  y += 4;

  let totalArea = 0;

  const totals = {
    konsolen: {}, ig: 0,
    df: { count: 0, laengeSum: 0 },
    gt: { count: 0, laengeSum: 0 },
    ft: { count: 0, laengeSum: 0 },
    tt: { count: 0, hoeheSum:  0 },
    ne: { count: 0, laengeSum: 0 }
  };

  seiten.forEach((seite, idx) => {
    if (y > 255) { doc.addPage(); y = 16; }

    const name = seite.name === '__manual__' ? seite.manualName : seite.name;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(name || ('Seite ' + (idx + 1)), LM, y);
    y += 6;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);

    let seitenFlaeche = 0;
    (seite.abschnitte || []).forEach(a => {
      if (!a.laenge || !a.hoeheBisBelag) return;
      const c = berechneAbschnitt(a.laenge, a.hoeheBisBelag, a.einzelfeld);
      seitenFlaeche += c.flaeche;
      if (y > 258) { doc.addPage(); y = 16; }
      const bezStr = a.bezeichnung ? a.bezeichnung + ': ' : '';
      const efStr  = a.einzelfeld ? ' (EF)' : '';
      doc.text(bezStr + fmtNum(c.laenge) + ' m x ' + fmtNum(c.hoehe) + ' m' + efStr + ' = ' + fmtNum(c.flaeche) + ' m²', LM + 4, y);
      y += 5;
    });
    totalArea += seitenFlaeche;

    if (seitenFlaeche > 0) {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.setFont(undefined, 'bold');
      doc.text('Seite gesamt: ' + fmtNum(seitenFlaeche) + ' m²', LM + 4, y);
      doc.setFont(undefined, 'normal');
      y += 5;
    }

    // Zubehor
    const accLines = [];
    if (Array.isArray(seite.konsolen)) {
      seite.konsolen.forEach(k => {
        accLines.push('K ' + k.typ + (k.laenge !== null && !isNaN(k.laenge) ? ': ' + fmtNum(k.laenge) + ' m' : ''));
        totals.konsolen[k.typ] = (totals.konsolen[k.typ] || 0) + 1;
      });
    }
    if (Array.isArray(seite.innengelaender)) {
      seite.innengelaender.forEach(ig => {
        accLines.push('IG' + (ig.laenge !== null && !isNaN(ig.laenge) ? ': ' + fmtNum(ig.laenge) + ' m' : ''));
      });
      totals.ig += seite.innengelaender.length;
    }
    if (seite.dachfang)          { const l = seite.dachfang.laenge;          accLines.push('DF' + (l !== null && !isNaN(l) ? ': ' + fmtNum(l) + ' m' : '')); totals.df.count++; totals.df.laengeSum += l || 0; }
    if (seite.gittertraeger)     { const l = seite.gittertraeger.laenge;     accLines.push('GT' + (l !== null && !isNaN(l) ? ': ' + fmtNum(l) + ' m' : '')); totals.gt.count++; totals.gt.laengeSum += l || 0; }
    if (seite.fussgaengertunnel) { const l = seite.fussgaengertunnel.laenge; accLines.push('FT' + (l !== null && !isNaN(l) ? ': ' + fmtNum(l) + ' m' : '')); totals.ft.count++; totals.ft.laengeSum += l || 0; }
    if (seite.treppenturm)       { const h = seite.treppenturm.hoehe;       accLines.push('TT' + (h !== null && !isNaN(h) ? ': ' + fmtNum(h) + ' m (H)' : '')); totals.tt.count++; totals.tt.hoeheSum += h || 0; }
    if (seite.netze)             { const l = seite.netze.laenge;             accLines.push('NE' + (l !== null && !isNaN(l) ? ': ' + fmtNum(l) + ' m' : '')); totals.ne.count++; totals.ne.laengeSum += l || 0; }

    if (accLines.length > 0) {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.text(accLines.join('   '), LM + 4, y);
      y += 5;
    }

    y += 3;
  });

  // Gesamtflache
  if (y > 258) { doc.addPage(); y = 16; }
  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Gesamtflache: ' + fmtNum(totalArea) + ' m²', LM, y);
  y += 8;

  if (vorhaltWochen && vorhaltWochen > 0 && totalArea > 0) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('Vorhaltung: ' + fmtNum(round2(totalArea * vorhaltWochen)) + ' m²·Wo. (' + vorhaltWochen + ' Wo.)', LM, y);
    y += 7;
  }

  // Zubehor-Ubersicht
  const hasAcc = Object.keys(totals.konsolen).length > 0 || totals.ig > 0 ||
    totals.df.count > 0 || totals.gt.count > 0 || totals.ft.count > 0 || totals.tt.count > 0 || totals.ne.count > 0;

  if (hasAcc) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setLineWidth(0.3);
    doc.line(LM, y, LM + PW, y);
    y += 7;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Zubehor-Gesamtubersicht', LM, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');

    const kTypen = Object.keys(totals.konsolen).sort((a, b) => Number(a) - Number(b));
    if (kTypen.length > 0) {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.text('Konsolen:  ' + kTypen.map(t => 'K ' + t + ': ' + totals.konsolen[t] + ' Stk.').join('   '), LM + 4, y); y += 6;
    }
    if (totals.ig > 0)         { if (y > 258) { doc.addPage(); y = 16; } doc.text('Innengelander:  ' + totals.ig + ' Stk.', LM + 4, y); y += 6; }
    if (totals.df.count > 0)   { if (y > 258) { doc.addPage(); y = 16; } doc.text('Dachfang:  ' + totals.df.count + ' Stk.' + (totals.df.laengeSum > 0 ? '  (gesamt ' + fmtNum(totals.df.laengeSum) + ' m)' : ''), LM + 4, y); y += 6; }
    if (totals.gt.count > 0)   { if (y > 258) { doc.addPage(); y = 16; } doc.text('Gittertrager:  ' + totals.gt.count + ' Stk.' + (totals.gt.laengeSum > 0 ? '  (gesamt ' + fmtNum(totals.gt.laengeSum) + ' m)' : ''), LM + 4, y); y += 6; }
    if (totals.ft.count > 0)   { if (y > 258) { doc.addPage(); y = 16; } doc.text('Fussgangertunnel:  ' + totals.ft.count + ' Stk.' + (totals.ft.laengeSum > 0 ? '  (gesamt ' + fmtNum(totals.ft.laengeSum) + ' m)' : ''), LM + 4, y); y += 6; }
    if (totals.tt.count > 0)   { if (y > 258) { doc.addPage(); y = 16; } doc.text('Treppenturm:  ' + totals.tt.count + ' Stk.' + (totals.tt.hoeheSum > 0 ? '  (gesamt ' + fmtNum(totals.tt.hoeheSum) + ' m H)' : ''), LM + 4, y); y += 6; }
    if (totals.ne.count > 0)   { if (y > 258) { doc.addPage(); y = 16; } doc.text('Netze:  ' + totals.ne.count + ' Stk.' + (totals.ne.laengeSum > 0 ? '  (gesamt ' + fmtNum(totals.ne.laengeSum) + ' m)' : ''), LM + 4, y); y += 6; }
  }

  // Zusatzpositionen
  if (zusatz.length > 0) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setLineWidth(0.3);
    doc.line(LM, y, LM + PW, y);
    y += 7;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Zusatzpositionen', LM, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    zusatz.forEach(z => {
      if (y > 258) { doc.addPage(); y = 16; }
      const mengeStr = z.menge !== null ? fmtNum(z.menge) + ' ' + z.einheit : '–';
      const notizStr = z.notiz ? '  – ' + z.notiz : '';
      doc.text((z.art || '–') + ':  ' + mengeStr + notizStr, LM + 4, y);
      y += 6;
    });
  }

  // Technik
  const techFields = [
    technik.lastklasse        ? 'Lastklasse: ' + technik.lastklasse : '',
    technik.breitenklasse     ? 'Breitenklasse: ' + technik.breitenklasse : '',
    technik.verwendungszweck  ? 'Verwendungszweck: ' + technik.verwendungszweck : '',
    technik.verankerungsgrund ? 'Verankerungsgrund: ' + technik.verankerungsgrund : '',
    technik.ankerAnzahl       ? 'Ankeranzahl: ' + technik.ankerAnzahl + ' Stk.' : ''
  ].filter(Boolean);

  if (techFields.length > 0) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setLineWidth(0.3);
    doc.line(LM, y, LM + PW, y);
    y += 7;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Technik (DIN 18451)', LM, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    techFields.forEach(f => {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.text(f, LM + 4, y); y += 6;
    });
  }

  // Logistik
  const logFields = [
    logistik.anfahrtKm        ? 'Anfahrt: ' + logistik.anfahrtKm + ' km' : '',
    logistik.untergrund        ? 'Untergrund: ' + logistik.untergrund : '',
    logistik.stellflaecheNotiz ? 'Stellflache: ' + logistik.stellflaecheNotiz : '',
    logistik.oeffentlicherGrund     ? 'Offentlicher Grund: Ja' : '',
    logistik.verkehrssicherung      ? 'Verkehrssicherung: erforderlich' : '',
    logistik.genehmigungErforderlich? 'Genehmigung: erforderlich' : ''
  ].filter(Boolean);

  if (logFields.length > 0) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setLineWidth(0.3);
    doc.line(LM, y, LM + PW, y);
    y += 7;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Baustelle / Logistik', LM, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    logFields.forEach(f => {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.text(f, LM + 4, y); y += 6;
    });
  }

  if (ortstermin.notiz) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont(undefined, 'bold');
    doc.text('Ortstermin-Notiz:', LM, y); y += 6;
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(ortstermin.notiz, PW - 4);
    lines.forEach(line => {
      if (y > 258) { doc.addPage(); y = 16; }
      doc.text(line, LM + 4, y); y += 5;
    });
  }

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
  proj.anschrift        = collectAnschrift();
  proj.geruesttyp       = collectGeruesttyp();
  proj.geruesttypName   = document.getElementById('fieldSonderName').value.trim();
  proj.seiten           = collectSeiten();
  proj.technik          = collectTechnik();
  proj.logistik         = collectLogistik();
  proj.zusatzpositionen = collectZusatzpositionen();
  proj.ortstermin       = collectOrtstermin();
  const wV = parseNum(document.getElementById('fieldVorhaltungWochen')?.value);
  proj.vorhaltungWochen = isNaN(wV) ? null : wV;
  proj.geaendert = new Date().toISOString().slice(0, 10);
  saveProjects();

  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
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
      if (!data.seiten) { alert('Unbekanntes Dateiformat.'); return; }
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

  document.getElementById('addZusatzBtn').addEventListener('click', () => {
    const container = document.getElementById('zusatzContainer');
    container.appendChild(createZusatzRow({}));
    refreshNoZusatzHint();
  });

  // Logistik-Toggles
  ['toggleOeffentlich', 'toggleVerkehr', 'toggleGenehmigung'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const nowActive = btn.dataset.active !== '1';
      btn.dataset.active = nowActive ? '1' : '0';
      btn.classList.toggle('active', nowActive);
    });
  });

  // Vorhaltung live-Kalkulation
  document.getElementById('fieldVorhaltungWochen')?.addEventListener('input', updateSummary);

  // Gerusttyp-Toggle
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sonderNameRow').style.display =
        btn.dataset.type === 'sonder' ? '' : 'none';
    });
  });

  // Anschrift Auto-Save
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
