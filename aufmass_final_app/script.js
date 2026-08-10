'use strict';

// ============================================================
//  Konstanten & Zustand
// ============================================================

const STORAGE_KEY = 'aufmass_projects_v2';
const FOLDERS_STORAGE_KEY = 'aufmass_folders_v1';
// Vom 2D-Zeichner (viewer2d.html) mitgenutzter Schlüssel: welches Projekt ist
// gerade geöffnet. So wissen beide Programme, welche Projektakte (inkl.
// 2D-Zeichnung) gerade bearbeitet wird, und teilen sich dieselbe Projektliste.
const CURRENT_PROJECT_STORAGE_KEY = 'aufmass_current_project_id';

// Backup-Erinnerung: alles liegt nur in localStorage (kein Cloud-Sync) – bei
// Gerätewechsel/-defekt wäre sonst alles weg. Erinnert sanft an einen
// Gesamt-Export, wenn länger keiner gemacht wurde.
const LAST_BACKUP_STORAGE_KEY      = 'aufmass_last_backup_ts';
const BACKUP_DISMISS_STORAGE_KEY   = 'aufmass_backup_reminder_dismissed_until';
const BACKUP_REMIND_AFTER_DAYS     = 7;
const BACKUP_SNOOZE_DAYS           = 3;

const PROJECT_STATUS = ['in_bearbeitung', 'abgeschlossen', 'archiviert'];
const PROJECT_STATUS_LABEL = {
  in_bearbeitung: 'In Bearbeitung',
  abgeschlossen:  'Abgeschlossen',
  archiviert:     'Archiviert'
};

let projects = [];
let folders = [];
let currentProjectId = null;

// Aktueller Filter-/Sortier-/Suchzustand der Projektübersicht (nur UI-Zustand,
// nicht persistiert).
let overviewState = {
  search: '',
  folderId: '',       // '' = alle, '__none__' = ohne Ordner, sonst Ordner-ID
  status: '',          // '' = alle
  sort: 'geaendert'    // 'geaendert' | 'name'
};

const ZUSATZ_ARTEN = [
  'Gerüsttreppe','Verbreiterung','Konsole','Dachfanggerüst',
  'Überbrückung','Bekleidung','Schutzdach','Aufzug','Innengeländer','Lampen',
  'Bautenschutzmatte','Fleece','Bauzaun','Käfig','Parkplatz','Genehmigung'
];
const ZUSATZ_EINHEITEN = ['m', 'm²', 'Stk.'];
// Sinnvolle Standard-Einheit je Positionsart (wird beim Wählen automatisch gesetzt)
const PREFERRED_EINHEIT = {
  'Bautenschutzmatte': 'm²', 'Fleece': 'm²', 'Bauzaun': 'm', 'Käfig': 'Stk.',
  // Parkplatz (Halteverbotszone) und Genehmigung werden nicht gemessen, sondern
  // pauschal je Stück erfasst (Anzahl Parkplätze / Anzahl Genehmigungen).
  // Details wie Zeitraum oder Behörde gehören in die Notiz der Zeile.
  'Parkplatz': 'Stk.', 'Genehmigung': 'Stk.'
};
// Positionsarten ohne Maßbezug: nur Anzahl + Notiz (Pauschal-/Stückpositionen)
const PAUSCHAL_ARTEN = ['Parkplatz', 'Genehmigung'];
// Ab dieser Gerüstlänge (m) ist ein zweiter Aufstieg/Treppenturm erforderlich –
// die App weist beim Überschreiten automatisch darauf hin.
const TREPPENTURM_WARN_LAENGE = 50;

// Konsolentypen (Breite in cm) + Sonder-Variante "Dachfang" (intern Konsole 0,50)
const KONSOLE_TYPES = ['0', '19', '30', '50', '70', '109'];
const KONSOLE_DACHFANG_TYP = '50df';

// Standard-Zuschlag der "+Xm"-Tasten bei den Maßen (Standard 2,00 m). Dient als
// Vorschlagswert beim erstmaligen Aktivieren einer Zuschlag-Taste – jedes Feld
// kann seinen eigenen (individuellen) Zuschlagswert erhalten und behalten.
const UEBERSTAND_STORAGE_KEY = 'aufmass_ueberstand_wert';
let ueberstandWert = 2;

function loadUeberstandWert() {
  const n = parseFloat(localStorage.getItem(UEBERSTAND_STORAGE_KEY));
  ueberstandWert = (!isNaN(n) && n > 0) ? n : 2;
}

function setUeberstandWert(v) {
  if (isNaN(v) || v <= 0) return;
  ueberstandWert = v;
  localStorage.setItem(UEBERSTAND_STORAGE_KEY, String(v));
  // Nur noch inaktive Zuschlag-Tasten zeigen den globalen Standardwert als
  // Vorschlag an. Bereits aktivierte (individuelle) Zuschläge bleiben unverändert.
  document.querySelectorAll('.plus2-btn:not(.active)').forEach(btn => {
    btn.textContent = '+' + fmtNum(ueberstandWert) + 'm';
  });
  updateSummary();
}

// ============================================================
//  localStorage
// ============================================================

// Ergänzt ältere Projekte (vor der Projektverwaltung mit Ordnern/Status/2D-
// Zeichnung) um die neuen Felder, ohne bestehende Daten zu verändern.
function migrateProjectMeta(p) {
  if (p.name === undefined)        p.name = '';
  if (p.status === undefined)      p.status = 'in_bearbeitung';
  if (p.folderId === undefined)    p.folderId = null;
  if (p.zeichnung2d === undefined) p.zeichnung2d = null;
  if (p.notizen === undefined)     p.notizen = '';
  if (p.archiviert !== undefined) { // sehr alte Übergangsdaten
    if (p.archiviert) p.status = 'archiviert';
    delete p.archiviert;
  }
  return p;
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    projects = raw ? JSON.parse(raw) : [];
    projects.forEach(migrateProjectMeta);
  } catch (_) {
    projects = [];
  }
}

function saveProjects() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function loadFolders() {
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    folders = raw ? JSON.parse(raw) : [];
  } catch (_) {
    folders = [];
  }
}

function saveFolders() {
  localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
}

function getCurrentProject() {
  return projects.find(p => p.id === currentProjectId) || null;
}

/** Anzeigename eines Projekts: expliziter Projektname, sonst Adresse, sonst "Neues Projekt". */
function getProjectName(project) {
  return (project.name && project.name.trim()) || getProjectLabel(project);
}

function getFolder(folderId) {
  return folders.find(f => f.id === folderId) || null;
}

/** Zählt Felder + Gesamtfläche (m²) der optional verknüpften 2D-Zeichnung. */
function get2dStats(project) {
  const z = project.zeichnung2d;
  if (!z || !Array.isArray(z.sections)) return { felder: 0, flaeche: 0 };
  let felder = 0, flaeche = 0;
  z.sections.forEach(sec => (sec.bays || []).forEach(bay => {
    felder++;
    const heights = [bay.hL, bay.hR].filter(h => h != null && !isNaN(h) && h > 0);
    if (heights.length && bay.len) flaeche += bay.len * Math.min(...heights);
  }));
  return { felder, flaeche: round2(flaeche) };
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

// Freitext (Notizen) sicher in die HTML-Zusammenfassung einsetzen
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTypeLabel(type) {
  if (type === 'dach') return 'Dach-Gerüst';
  if (type === 'sonder') return 'Sonder-Gerüst';
  return 'Fassaden-Gerüst';
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

// Ausgewaehlte Lage (Ebene) einer Konsolen- oder Innengelaender-Zeile ermitteln
function collectLage(row) {
  const freeInp = row.querySelector('.lage-free-input');
  const freeVal = freeInp ? freeInp.value.trim() : '';
  if (freeVal !== '') return freeVal;
  const activeLageBtn = row.querySelector('.lage-btn.active');
  return activeLageBtn ? activeLageBtn.dataset.lage : 'alle';
}

function lageLabel(lage) {
  if (!lage || lage === 'alle') return '';
  return lage + (lage === '1' ? ' Lage' : ' Lagen');
}

// Konkrete Lagen-Zahl (null bei "alle"/leer/ungueltig)
function lagenAnzahl(lage) {
  if (!lage || lage === 'alle') return null;
  const n = parseFloat(String(lage).replace(',', '.'));
  return (!isNaN(n) && n > 0) ? n : null;
}

// Laenge × Lagenzahl (ohne konkrete Lagenzahl bleibt die Laenge unveraendert)
function effektiveLaenge(laenge, lage) {
  if (laenge === null || laenge === undefined || isNaN(laenge)) return null;
  const n = lagenAnzahl(lage);
  return n ? laenge * n : laenge;
}

// Aktiven, individuellen Zuschlagwert (m) eines Zuschlag-Steuerelements (DOM)
// auslesen. 0 = Zuschlag nicht aktiv.
function readZuschlag(wrapEl) {
  if (!wrapEl) return 0;
  const btn = wrapEl.querySelector('.plus2-btn');
  if (!btn || !btn.classList.contains('active')) return 0;
  const inp = wrapEl.querySelector('.plus2-value-input');
  const v = inp ? parseNum(inp.value) : NaN;
  return (!isNaN(v) && v > 0) ? v : ueberstandWert;
}

// Konsolentyp (cm-Code, ggf. mit "df"-Suffix für Dachfang) → Meterangabe "0,30"
function konsoleTypMeter(typ) {
  const base = String(typ).replace(/[^0-9]/g, '');
  const n = parseFloat(base);
  return isNaN(n) ? base : (n / 100).toFixed(2).replace('.', ',');
}

// Anzeigetext für einen Konsolentyp. short=true → kompaktes App-Präfix ("K"/"DF"),
// sonst der volle PDF-Text ("Konsole 0,30" / "DF / Konsole 0,50").
function konsoleTypLabel(typ, short) {
  const isDachfang = String(typ).endsWith('df');
  const meter = konsoleTypMeter(typ);
  if (short) return (isDachfang ? 'DF ' : 'K ') + meter;
  return (isDachfang ? 'DF / Konsole ' : 'Konsole ') + meter;
}

function getSeiteName(seite) {
  if (seite.name === '__manual__') return seite.manualName || 'Unbenannte Seite';
  return seite.name || 'Unbenannte Seite';
}

// Flache eines Abschnitts (Summe aller Messpaare, optionales +2m je Wert)
// Giebel: Flache = L × (H1_Dachrinne + H2_Spitze) / 2
function berechneAbschnitt(abschnitt) {
  const ef       = abschnitt.einzelfeld || false;
  const isGiebel = abschnitt.giebel    || false;
  let flaeche = 0;
  for (const m of (abschnitt.messungen || [])) {
    let l = (m.laenge || 0) + (m.laengeZuschlag > 0 ? m.laengeZuschlag : 0);
    if (ef) l = Math.max(l, 2.5);
    if (l <= 0) continue;
    if (isGiebel) {
      const h1 = (m.hoehe  || 0) + (m.hoeheZuschlag  > 0 ? m.hoeheZuschlag  : 0);
      const h2 = (m.hoehe2 || 0) + (m.hoehe2Zuschlag > 0 ? m.hoehe2Zuschlag : 0);
      if (h2 >= h1 && h1 >= 0) flaeche += l * (h1 + h2) / 2;
    } else {
      const h = (m.hoehe || 0) + (m.hoeheZuschlag > 0 ? m.hoeheZuschlag : 0);
      if (h > 0) flaeche += l * h;
    }
  }
  return round2(flaeche);
}

// Gesamt-Flache einer Karte (Summe aller Abschnitte)
function computeCardFlaeche(card) {
  let total = 0;
  card.querySelectorAll('.abschnitt-row').forEach(abRow => {
    const ef       = abRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    const isGiebel = abRow.querySelector('.giebel-btn')?.classList.contains('active')    || false;
    abRow.querySelectorAll('.messung-row').forEach(mRow => {
      const l   = parseNum(mRow.querySelector('.messung-laenge')?.value);
      const lZ  = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
      let lEff  = (l || 0) + lZ;
      if (ef) lEff = Math.max(lEff, 2.5);
      if (isNaN(l) || lEff <= 0) return;
      if (isGiebel) {
        const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
        const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
        const h2  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
        const h2Z = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
        if (!isNaN(h) && !isNaN(h2)) {
          const h1Eff = (h  || 0) + hZ;
          const h2Eff = (h2 || 0) + h2Z;
          if (h2Eff >= h1Eff && h1Eff >= 0) total += lEff * (h1Eff + h2Eff) / 2;
        }
      } else {
        const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
        const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
        if (!isNaN(h)) {
          const hEff = (h || 0) + hZ;
          if (hEff > 0) total += lEff * hEff;
        }
      }
    });
  });
  return round2(total);
}

// Gesamtlänge einer Karte (Summe aller Messlängen inkl. Zuschlag über alle
// Abschnitte). Grundlage für den 50-m-Hinweis (Treppenturm): maßgeblich ist die
// Länge des Gerüstzugs, nicht die Fläche.
function computeCardLaenge(card) {
  let total = 0;
  card.querySelectorAll('.abschnitt-row').forEach(abRow => {
    const ef = abRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    abRow.querySelectorAll('.messung-row').forEach(mRow => {
      const l  = parseNum(mRow.querySelector('.messung-laenge')?.value);
      const lZ = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
      if (isNaN(l)) return;
      let lEff = (l || 0) + lZ;
      if (ef) lEff = Math.max(lEff, 2.5);
      if (lEff > 0) total += lEff;
    });
  });
  return round2(total);
}

// Gesamtlänge eines gespeicherten Abschnitts (für Zusammenfassung/PDF)
function abschnittLaenge(abschnitt) {
  const ef = abschnitt.einzelfeld || false;
  let total = 0;
  for (const m of (abschnitt.messungen || [])) {
    let l = (m.laenge || 0) + (m.laengeZuschlag > 0 ? m.laengeZuschlag : 0);
    if (ef) l = Math.max(l, 2.5);
    if (l > 0) total += l;
  }
  return round2(total);
}

// Warntext für den 50-m-Hinweis (Treppenturm) – oder '' wenn unkritisch
function treppenturmHinweis(laenge, was) {
  if (!(laenge > TREPPENTURM_WARN_LAENGE)) return '';
  return 'Gesamtlänge ' + was + ' ' + fmtNum(laenge) + ' m (über '
    + TREPPENTURM_WARN_LAENGE + ' m) – Treppenturm erforderlich';
}

// Größte eingetragene Höhe einer Karte (über alle Abschnitte/Messungen hinweg,
// inkl. Zuschlag und – bei Giebeln – der Spitzenhöhe H2). Dient als
// Vorschlagsgrundlage für Positionen, die sich an der Wandhöhe orientieren
// (z. B. Treppenturm: Höhe der Seite + Überstand).
function computeCardMaxHoehe(card) {
  let max = 0;
  card.querySelectorAll('.abschnitt-row').forEach(abRow => {
    const isGiebel = abRow.querySelector('.giebel-btn')?.classList.contains('active') || false;
    abRow.querySelectorAll('.messung-row').forEach(mRow => {
      const h  = parseNum(mRow.querySelector('.messung-hoehe')?.value);
      const hZ = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
      if (!isNaN(h)) { const hEff = (h || 0) + hZ; if (hEff > max) max = hEff; }
      if (isGiebel) {
        const h2  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
        const h2Z = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
        if (!isNaN(h2)) { const h2Eff = (h2 || 0) + h2Z; if (h2Eff > max) max = h2Eff; }
      }
    });
  });
  return round2(max);
}

// Migration eines alten Boolean-Zuschlags ("+2m"-Taste an/aus) auf den neuen
// individuellen, numerischen Zuschlagwert je Feld (Schema 2.2).
function migrateMessung(m) {
  const out = { ...m };
  if (out.laengeZuschlag === undefined) {
    out.laengeZuschlag = out.laengePlus2 ? ueberstandWert : null;
  }
  if (out.hoeheZuschlag === undefined) {
    out.hoeheZuschlag = out.hoehePlus2 ? ueberstandWert : null;
  }
  if (out.hoehe2Zuschlag === undefined) {
    out.hoehe2Zuschlag = out.hoehe2Plus2 ? ueberstandWert : null;
  }
  delete out.laengePlus2;
  delete out.hoehePlus2;
  delete out.hoehe2Plus2;
  return out;
}

// Migration alter Projekte → Schema 2.2 (messungen je Abschnitt, individueller Zuschlag)
function migrateSeite(seite) {
  // Bereits v2.1+ (hat messungen) → nur noch Zuschlag-Felder je Messung migrieren
  if (seite.abschnitte && seite.abschnitte.length > 0 && seite.abschnitte[0].messungen) {
    return {
      ...seite,
      abschnitte: seite.abschnitte.map(a => ({
        ...a,
        messungen: (a.messungen || []).map(migrateMessung)
      }))
    };
  }

  // v2.0: abschnitte mit laenge/hoeheBisBelag, aber noch ohne messungen
  if (seite.abschnitte && seite.abschnitte.length > 0) {
    return {
      ...seite,
      abschnitte: seite.abschnitte.map(a => ({
        id:          a.id || genId('ab'),
        bezeichnung: a.bezeichnung || '',
        einzelfeld:  a.einzelfeld  || false,
        messungen: [{
          id:             genId('m'),
          laenge:         a.laenge      ?? null,
          laengeZuschlag: null,
          hoehe:          a.hoeheBisBelag ?? null,
          hoeheZuschlag:  null
        }]
      }))
    };
  }

  // Altes Schema (v1.x): hoehen / laengen
  const hoehen  = (seite.hoehen  || []).filter(h => h.wert !== null && !isNaN(h.wert) && h.wert > 0);
  const laengen = (seite.laengen || []).filter(l => l.wert !== null && !isNaN(l.wert));
  let avgHoehe = null;
  if (hoehen.length > 0) {
    const sum = hoehen.reduce((s, h) => {
      const ex = typeof h.extra === 'boolean' ? (h.extra ? 2 : 0) : (parseNum(h.extra) || 0);
      return s + (h.wert || 0) + ex;
    }, 0);
    avgHoehe = round2(sum / hoehen.length);
  }
  const abschnitte = laengen.map(l => {
    const ex  = typeof l.extra === 'boolean' ? (l.extra ? 2 : 0) : (parseNum(l.extra) || 0);
    const eff = round2((l.wert || 0) + ex);
    return {
      id: genId('ab'), bezeichnung: '', einzelfeld: false,
      messungen: [{ id: genId('m'), laenge: eff > 0 ? eff : null, laengeZuschlag: null, hoehe: avgHoehe, hoeheZuschlag: null }]
    };
  });
  if (abschnitte.length === 0) {
    abschnitte.push({
      id: genId('ab'), bezeichnung: '', einzelfeld: false,
      messungen: [{ id: genId('m'), laenge: null, laengeZuschlag: null, hoehe: avgHoehe, hoeheZuschlag: null }]
    });
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
//  Startseite - Projektübersicht (Ordner, Suche, Filter, Vorschau)
// ============================================================

function matchesSearch(proj, q) {
  if (!q) return true;
  const hay = [
    getProjectName(proj),
    proj.anschrift?.bauherr || '',
    proj.anschrift?.strasse || '', proj.anschrift?.nummer || '',
    proj.anschrift?.plz || '', proj.anschrift?.ort || ''
  ].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function getFilteredSortedProjects() {
  let list = projects.filter(p => {
    if (overviewState.folderId === '__none__' && p.folderId) return false;
    if (overviewState.folderId && overviewState.folderId !== '__none__' && p.folderId !== overviewState.folderId) return false;
    if (overviewState.status && p.status !== overviewState.status) return false;
    if (!matchesSearch(p, overviewState.search)) return false;
    return true;
  });
  if (overviewState.sort === 'name') {
    list = list.sort((a, b) => getProjectName(a).localeCompare(getProjectName(b), 'de'));
  } else {
    list = list.sort((a, b) => (b.geaendert || '').localeCompare(a.geaendert || ''));
  }
  return list;
}

function renderFolderBar() {
  const bar = document.getElementById('folderBar');
  if (!bar) return;
  bar.innerHTML = '';

  const makeChip = (label, folderId, count) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'folder-chip' + (overviewState.folderId === folderId ? ' active' : '');
    btn.innerHTML = `${label} <span class="folder-chip-count">${count}</span>`;
    btn.addEventListener('click', () => {
      overviewState.folderId = folderId;
      renderProjectOverview();
    });
    return btn;
  };

  bar.appendChild(makeChip('Alle Projekte', '', projects.length));
  bar.appendChild(makeChip('Ohne Ordner', '__none__', projects.filter(p => !p.folderId).length));

  folders.forEach(f => {
    const count = projects.filter(p => p.folderId === f.id).length;
    const chip = makeChip(f.name, f.id, count);
    chip.addEventListener('dblclick', () => renameFolderPrompt(f.id));
    bar.appendChild(chip);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'folder-chip folder-chip-add';
  addBtn.textContent = '+ Ordner';
  addBtn.addEventListener('click', createFolderPrompt);
  bar.appendChild(addBtn);

  if (overviewState.folderId && overviewState.folderId !== '__none__') {
    const folder = getFolder(overviewState.folderId);
    if (folder) {
      const manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'folder-chip folder-chip-manage';
      manageBtn.title = 'Ordner umbenennen/löschen';
      manageBtn.textContent = '✎';
      manageBtn.addEventListener('click', () => openFolderManageMenu(folder, manageBtn));
      bar.appendChild(manageBtn);
    }
  }
}

function createFolderPrompt() {
  const name = prompt('Name des neuen Ordners (z. B. 2026, Firma Müller, Abgeschlossen):');
  if (!name || !name.trim()) return;
  folders.push({ id: genId('folder'), name: name.trim() });
  saveFolders();
  renderProjectOverview();
}

function renameFolderPrompt(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  const name = prompt('Ordner umbenennen:', folder.name);
  if (!name || !name.trim()) return;
  folder.name = name.trim();
  saveFolders();
  renderProjectOverview();
}

function deleteFolderPrompt(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  const count = projects.filter(p => p.folderId === folderId).length;
  const msg = count > 0
    ? `Ordner "${folder.name}" löschen? ${count} Projekt(e) darin werden in "Ohne Ordner" verschoben.`
    : `Ordner "${folder.name}" löschen?`;
  if (!confirm(msg)) return;
  projects.forEach(p => { if (p.folderId === folderId) p.folderId = null; });
  folders = folders.filter(f => f.id !== folderId);
  saveProjects();
  saveFolders();
  if (overviewState.folderId === folderId) overviewState.folderId = '';
  renderProjectOverview();
}

function closeFloatingMenu() {
  document.getElementById('floatingMenu')?.remove();
  document.getElementById('floatingMenuOverlay')?.remove();
}

/** Kleines, an einem Button verankertes Popup-Menü (Aktionen, ggf. mit
 *  Untermenüs) – touch-tauglich, ohne Abhängigkeit von Browser-Kontextmenüs. */
function openFloatingMenu(anchorEl, items) {
  closeFloatingMenu();

  const overlay = document.createElement('div');
  overlay.id = 'floatingMenuOverlay';
  overlay.className = 'floating-menu-overlay';
  overlay.addEventListener('click', closeFloatingMenu);

  const menu = document.createElement('div');
  menu.id = 'floatingMenu';
  menu.className = 'floating-menu';

  items.forEach(item => {
    if (item === '---') {
      const sep = document.createElement('div');
      sep.className = 'floating-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'floating-menu-item' + (item.danger ? ' danger' : '') + (item.active ? ' active' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeFloatingMenu(); item.onClick(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(overlay);
  document.body.appendChild(menu);

  const r = anchorEl.getBoundingClientRect();
  const menuW = 240;
  let left = r.right - menuW;
  if (left < 8) left = 8;
  if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
  let top = r.bottom + 6;
  menu.style.left = left + 'px';
  menu.style.top  = top + 'px';
  // Falls das Menü unten aus dem Bildschirm ragen würde: oberhalb öffnen
  requestAnimationFrame(() => {
    const mh = menu.getBoundingClientRect().height;
    if (top + mh > window.innerHeight - 8) {
      menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
    }
  });
}

function openFolderManageMenu(folder, anchorEl) {
  openFloatingMenu(anchorEl, [
    { label: 'Ordner umbenennen', onClick: () => renameFolderPrompt(folder.id) },
    { label: 'Ordner löschen', danger: true, onClick: () => deleteFolderPrompt(folder.id) }
  ]);
}

function openMoveToFolderMenu(proj, anchorEl) {
  const items = [
    { label: (!proj.folderId ? '✓ ' : '') + 'Ohne Ordner', active: !proj.folderId, onClick: () => moveProjectToFolder(proj.id, null) }
  ];
  folders.forEach(f => {
    items.push({
      label: (proj.folderId === f.id ? '✓ ' : '') + f.name,
      active: proj.folderId === f.id,
      onClick: () => moveProjectToFolder(proj.id, f.id)
    });
  });
  items.push('---');
  items.push({ label: '+ Neuer Ordner…', onClick: () => {
    const name = prompt('Name des neuen Ordners:');
    if (!name || !name.trim()) return;
    const folder = { id: genId('folder'), name: name.trim() };
    folders.push(folder);
    saveFolders();
    moveProjectToFolder(proj.id, folder.id);
  } });
  openFloatingMenu(anchorEl, items);
}

function moveProjectToFolder(projectId, folderId) {
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.folderId = folderId;
  saveProjects();
  renderProjectOverview();
  showToast(folderId ? 'In Ordner verschoben' : 'Ordner entfernt');
}

function openStatusMenu(proj, anchorEl) {
  openFloatingMenu(anchorEl, PROJECT_STATUS.map(s => ({
    label: (proj.status === s ? '✓ ' : '') + PROJECT_STATUS_LABEL[s],
    active: proj.status === s,
    onClick: () => {
      proj.status = s;
      proj.geaendert = new Date().toISOString().slice(0, 10);
      saveProjects();
      renderProjectOverview();
    }
  })));
}

function renameProjectPrompt(proj) {
  const name = prompt('Projekt umbenennen:', getProjectName(proj));
  if (name === null) return;
  proj.name = name.trim();
  proj.geaendert = new Date().toISOString().slice(0, 10);
  saveProjects();
  renderProjectOverview();
}

function duplicateProject(proj) {
  const copy = JSON.parse(JSON.stringify(proj));
  copy.id = genId('proj');
  copy.name = (getProjectName(proj) + ' (Kopie)').trim();
  const today = new Date().toISOString().slice(0, 10);
  copy.erstellt = today;
  copy.geaendert = today;
  copy.status = 'in_bearbeitung';
  projects.push(copy);
  saveProjects();
  renderProjectOverview();
  showToast('Projekt dupliziert');
}

function deleteProjectFromOverview(proj) {
  if (!confirm(`Projekt "${getProjectName(proj)}" wirklich löschen?`)) return;
  projects = projects.filter(p => p.id !== proj.id);
  saveProjects();
  if (localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) === proj.id) {
    localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }
  renderProjectOverview();
  showToast('Projekt gelöscht');
}

function openProjectActionMenu(proj, anchorEl) {
  openFloatingMenu(anchorEl, [
    { label: 'Öffnen', onClick: () => requestOpenProject(proj) },
    { label: 'Umbenennen', onClick: () => renameProjectPrompt(proj) },
    { label: 'Duplizieren', onClick: () => duplicateProject(proj) },
    { label: 'In Ordner verschieben…', onClick: () => openMoveToFolderMenu(proj, anchorEl) },
    { label: 'Status ändern…', onClick: () => openStatusMenu(proj, anchorEl) },
    '---',
    { label: 'Löschen', danger: true, onClick: () => deleteProjectFromOverview(proj) }
  ]);
}

function createProjectCard(proj) {
  const card = document.createElement('div');
  card.className = 'project-card2';
  const typ = proj.geruesttyp || 'fassade';
  const seitenAnzahl = (proj.seiten || []).length;
  const bauherr = proj.anschrift?.bauherr || '';
  const addrParts = [
    [proj.anschrift?.strasse, proj.anschrift?.nummer].filter(Boolean).join(' '),
    [proj.anschrift?.plz, proj.anschrift?.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  const stats2d = get2dStats(proj);
  const statsParts = [seitenAnzahl + ' Seite' + (seitenAnzahl !== 1 ? 'n' : '')];
  if (proj.zeichnung2d) {
    statsParts.push(stats2d.felder + ' Feld' + (stats2d.felder !== 1 ? 'er' : ''));
    statsParts.push(fmtNum(stats2d.flaeche) + ' m²');
  }
  const vzList = Array.isArray(proj.technik?.verwendungszweck) ? proj.technik.verwendungszweck : [];

  card.innerHTML = `
    <div class="project-card2-top">
      <span class="project-card2-badge ${typ}">${getTypeBadge(typ)}</span>
      <span class="project-card2-status status-${proj.status}">${PROJECT_STATUS_LABEL[proj.status] || ''}</span>
      <button type="button" class="project-card2-menu-btn" aria-label="Aktionen">⋯</button>
    </div>
    <div class="project-card2-name">${getProjectName(proj)}</div>
    ${bauherr ? `<div class="project-card2-line">${bauherr}</div>` : ''}
    ${addrParts ? `<div class="project-card2-line project-card2-addr">${addrParts}</div>` : ''}
    ${proj.anschrift?.telefon ? `<div class="project-card2-line">${proj.anschrift.telefon}</div>` : ''}
    ${vzList.length ? `<div class="project-card2-vz">${vzList.map(v => `<span class="project-card2-vz-tag">${v}</span>`).join('')}</div>` : ''}
    <div class="project-card2-stats">${statsParts.join(' · ')}</div>
    <div class="project-card2-dates">Erstellt ${fmtDate(proj.erstellt)} · Geändert ${fmtDate(proj.geaendert)}</div>
  `;

  card.querySelector('.project-card2-menu-btn').addEventListener('click', ev => {
    ev.stopPropagation();
    openProjectActionMenu(proj, ev.currentTarget);
  });
  card.addEventListener('click', () => requestOpenProject(proj));
  return card;
}

function renderProjectOverview() {
  const gridEl    = document.getElementById('projectGrid');
  const emptyEl   = document.getElementById('emptyState');
  const noResEl   = document.getElementById('noResultsState');
  if (!gridEl) return;

  renderFolderBar();
  renderBackupReminder();

  gridEl.innerHTML = '';

  if (projects.length === 0) {
    emptyEl.classList.remove('hidden');
    noResEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  const list = getFilteredSortedProjects();
  noResEl.classList.toggle('hidden', list.length > 0);

  list.forEach(proj => gridEl.appendChild(createProjectCard(proj)));
}

// ============================================================
//  Projekt erstellen / öffnen
// ============================================================

// Zentrale Stelle für "dieses Projekt jetzt öffnen": Auf Seiten mit
// eingebettetem Editor (index.html) öffnet das wie bisher direkt den
// Projekt-Editor. Der Hub (start.html) definiert stattdessen
// `window.onProjectOpenRequest`, um vorher zwischen Aufmaß und 2D-Aufmaß
// wählen zu lassen – ohne dass sich an index.html selbst etwas ändert.
function requestOpenProject(proj) {
  if (typeof window.onProjectOpenRequest === 'function') { window.onProjectOpenRequest(proj); return; }
  openProject(proj.id);
}

function createNewProject() {
  const today = new Date().toISOString().slice(0, 10);
  const proj = {
    id: genId('proj'),
    name: '',
    status: 'in_bearbeitung',
    folderId: (overviewState.folderId && overviewState.folderId !== '__none__') ? overviewState.folderId : null,
    erstellt: today,
    geaendert: today,
    anschrift: { strasse: '', nummer: '', plz: '', ort: '', bauherr: '', telefon: '' },
    geruesttyp: 'fassade',
    geruesttypName: '',
    seiten: [],
    technik: { lastklasse: '3', breitenklasse: 'W06' },
    logistik: {},
    zusatzpositionen: [],
    zeichnung2d: null
  };
  projects.push(proj);
  saveProjects();
  requestOpenProject(proj);
}

function openProject(projectId, opts) {
  currentProjectId = projectId;
  localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, projectId);
  const proj = getCurrentProject();
  if (!proj) return;

  document.getElementById('projectScreenTitle').textContent = getProjectName(proj);

  document.getElementById('fieldProjektname').value = proj.name || '';
  setProjectStatus(proj.status || 'in_bearbeitung');

  const a = proj.anschrift || {};
  document.getElementById('fieldStrasse').value = a.strasse || '';
  document.getElementById('fieldNummer').value  = a.nummer  || '';
  document.getElementById('fieldPlz').value     = a.plz     || '';
  document.getElementById('fieldOrt').value     = a.ort     || '';
  document.getElementById('fieldBauherr').value = a.bauherr || '';
  document.getElementById('fieldTelefon').value = a.telefon || '';

  const typ = proj.geruesttyp || 'fassade';
  document.querySelectorAll('#geruesttypSelector .type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === typ);
  });
  document.getElementById('sonderNameRow').style.display = typ === 'sonder' ? '' : 'none';
  document.getElementById('fieldSonderName').value = proj.geruesttypName || '';

  loadTechnik(proj.technik);
  loadLogistik(proj.logistik);

  const notizenEl = document.getElementById('fieldNotizen');
  if (notizenEl) notizenEl.value = proj.notizen || '';

  renderSeiten((proj.seiten || []).map(migrateSeite));
  renderZusatzpositionen(proj.zusatzpositionen || []);
  update2dSummary(proj);
  updateSummary();
  if (!opts || !opts.keepScreen) showScreen('projectScreen');
}

function setProjectStatus(status) {
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}

function collectProjectStatus() {
  const active = document.querySelector('.status-btn.active');
  return active ? active.dataset.status : 'in_bearbeitung';
}

/** Zeigt Kennzahlen der verknüpften 2D-Zeichnung (Felder/Fläche) im Projekt an. */
function update2dSummary(proj) {
  const el = document.getElementById('zeichnung2dSummary');
  if (!el) return;
  const stats = get2dStats(proj);
  if (!proj.zeichnung2d) {
    el.textContent = 'Noch keine 2D-Zeichnung vorhanden.';
  } else {
    el.textContent = `${stats.felder} Feld${stats.felder === 1 ? '' : 'er'} gezeichnet · Gesamtfläche ${fmtNum(stats.flaeche)} m²`;
  }
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
    bauherr:  document.getElementById('fieldBauherr').value.trim(),
    telefon:  document.getElementById('fieldTelefon').value.trim()
  };
}

function collectGeruesttyp() {
  const active = document.querySelector('#geruesttypSelector .type-btn.active');
  return active ? active.dataset.type : 'fassade';
}

function collectTechnik() {
  const ankerVal = parseNum(document.getElementById('fieldAnkerAnzahl')?.value);
  const verwendungszweck = Array.from(
    document.querySelectorAll('#verwendungszweckSelector .chip-btn.active')
  ).map(b => b.dataset.vz);
  return {
    lastklasse:        document.getElementById('fieldLastklasse')?.value        || '',
    breitenklasse:     document.getElementById('fieldBreitenklasse')?.value     || '',
    verwendungszweck,
    verankerungsgrund: document.getElementById('fieldVerankerungsgrund')?.value || '',
    ankerAnzahl:       isNaN(ankerVal) ? null : ankerVal
  };
}

function loadTechnik(t) {
  document.querySelectorAll('#verwendungszweckSelector .chip-btn').forEach(b => b.classList.remove('active'));
  if (!t) return;
  document.getElementById('fieldLastklasse').value        = t.lastklasse        || '';
  document.getElementById('fieldBreitenklasse').value     = t.breitenklasse     || '';
  // Alte Projekte speichern hier einen einzelnen String statt eines Arrays.
  const vzList = Array.isArray(t.verwendungszweck)
    ? t.verwendungszweck
    : (t.verwendungszweck ? [t.verwendungszweck] : []);
  document.querySelectorAll('#verwendungszweckSelector .chip-btn').forEach(b => {
    b.classList.toggle('active', vzList.includes(b.dataset.vz));
  });
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
  const anfahrtVal     = parseNum(document.getElementById('fieldAnfahrtKm')?.value);
  const transportVal   = parseNum(document.getElementById('fieldTransportM')?.value);
  const hoehenmeterVal = parseNum(document.getElementById('fieldHoehenmeter')?.value);
  const treppenVal     = parseNum(document.getElementById('fieldTreppen')?.value);
  return {
    anfahrtKm:              isNaN(anfahrtVal) ? null : anfahrtVal,
    untergrund:             document.getElementById('fieldUntergrund')?.value.trim()         || '',
    stellflaecheNotiz:      document.getElementById('fieldStellflaecheNotiz')?.value.trim()  || '',
    transportM:             isNaN(transportVal)   ? null : transportVal,
    hoehenmeter:            isNaN(hoehenmeterVal) ? null : hoehenmeterVal,
    treppen:                isNaN(treppenVal)     ? null : treppenVal,
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
  document.getElementById('fieldTransportM').value        = l.transportM   != null ? l.transportM   : '';
  document.getElementById('fieldHoehenmeter').value       = l.hoehenmeter  != null ? l.hoehenmeter  : '';
  document.getElementById('fieldTreppen').value           = l.treppen      != null ? l.treppen      : '';
  setLogistikToggle('toggleOeffentlich', l.oeffentlicherGrund);
  setLogistikToggle('toggleVerkehr',     l.verkehrssicherung);
  setLogistikToggle('toggleGenehmigung', l.genehmigungErforderlich);
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
    card.querySelectorAll('.abschnitt-row').forEach(abRow => {
      const bez    = abRow.querySelector('.abschnitt-bez')?.value.trim()   || '';
      const notiz  = abRow.querySelector('.abschnitt-notiz')?.value.trim() || '';
      const ef     = abRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
      const giebel = abRow.querySelector('.giebel-btn')?.classList.contains('active')    || false;
      const messungen = [];
      abRow.querySelectorAll('.messung-row').forEach(mRow => {
        const lV   = parseNum(mRow.querySelector('.messung-laenge')?.value);
        const hV   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
        const h2V  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
        const lZ   = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
        const hZ   = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
        const h2Z  = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
        messungen.push({
          id:             genId('m'),
          laenge:         isNaN(lV)  ? null : lV,
          laengeZuschlag: lZ > 0 ? lZ : null,
          hoehe:          isNaN(hV)  ? null : hV,
          hoeheZuschlag:  hZ > 0 ? hZ : null,
          hoehe2:         isNaN(h2V) ? null : h2V,
          hoehe2Zuschlag: h2Z > 0 ? h2Z : null
        });
      });
      abschnitte.push({ id: genId('ab'), bezeichnung: bez, notiz, einzelfeld: ef, giebel, messungen });
    });

    // Konsolen (mehrere Lagen je Seite moeglich)
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
        autoL1: l1Btn ? l1Btn.dataset.active === '1' : false,
        lage:   collectLage(row)
      });
    });

    // Innengeländer (mehrere Lagen je Seite moeglich)
    const innengelaender = [];
    card.querySelectorAll('.acc-ig-list .acc-multi-row').forEach(row => {
      const l1Btn  = row.querySelector('.accessory-l1-btn');
      const lenInp = row.querySelector('.accessory-length-input');
      const len    = lenInp ? parseNum(lenInp.value) : NaN;
      innengelaender.push({
        laenge: isNaN(len) ? null : len,
        autoL1: l1Btn ? l1Btn.dataset.active === '1' : false,
        lage:   collectLage(row)
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
    const ttL1Btn  = card.querySelector('.accessory-l1-btn[data-acc="tt"]');
    const ttVal    = ttInp ? parseNum(ttInp.value) : NaN;

    const ksInp  = card.querySelector('.ks-input');
    const ksVal  = ksInp ? parseNum(ksInp.value) : NaN;

    const wandabstandVal = parseNum(card.querySelector('.seite-wandabstand')?.value);
    const wdvsVal        = parseNum(card.querySelector('.seite-wdvs')?.value);

    result.push({
      id:               card.dataset.sideId,
      name:             sel ? sel.value : '',
      manualName:       manual ? manual.value.trim() : '',
      abschnitte,
      wandabstand:      isNaN(wandabstandVal) ? null : wandabstandVal,
      wdvs:             isNaN(wdvsVal) ? null : wdvsVal,
      konsolen,
      innengelaender,
      dachfang:          collectSingleToggle('df'),
      gittertraeger:     collectSingleToggle('gt'),
      fussgaengertunnel: collectSingleToggle('ft'),
      treppenturm: (ttToggle && ttToggle.classList.contains('active'))
        ? { hoehe: isNaN(ttVal) ? null : ttVal, autoL1: ttL1Btn ? ttL1Btn.dataset.active === '1' : false }
        : null,
      netze:    collectSingleToggle('ne'),
      ks:       isNaN(ksVal) ? null : ksVal,
      ksManual: ksInp ? !!ksInp._ksManual : false
    });
  });
  return result;
}

// ============================================================
//  Speichern / Löschen
// ============================================================

/** Liest den kompletten Formularzustand ein und schreibt ihn in das Projekt
 *  (mutiert proj direkt – die 2D-Zeichnung des 2D-Zeichners bleibt unberührt).
 *  Wird sowohl vom manuellen "Speichern" als auch vom Auto-Save genutzt. */
function collectProjectFromForm(proj) {
  proj.name              = document.getElementById('fieldProjektname').value.trim();
  proj.status            = collectProjectStatus();
  proj.anschrift         = collectAnschrift();
  proj.geruesttyp        = collectGeruesttyp();
  proj.geruesttypName    = document.getElementById('fieldSonderName').value.trim();
  proj.seiten            = collectSeiten();
  proj.technik           = collectTechnik();
  proj.logistik          = collectLogistik();
  proj.zusatzpositionen  = collectZusatzpositionen();
  proj.notizen           = document.getElementById('fieldNotizen')?.value.trim() || '';
  proj.geaendert = new Date().toISOString().slice(0, 10);
}

function saveCurrentProject() {
  const proj = getCurrentProject();
  if (!proj) return;
  collectProjectFromForm(proj);
  document.getElementById('projectScreenTitle').textContent = getProjectName(proj);
  saveProjects();
  showToast('Gespeichert');
}

// Automatisches Speichern: jede Änderung im Projektbildschirm wird gebündelt
// (700ms nach der letzten Änderung) automatisch übernommen – ohne Toast, ohne
// Tippen auf "Speichern". Beim Wiederöffnen eines Projekts steht so immer der
// zuletzt bearbeitete Stand zur Verfügung.
let autosaveTimer = null;
function scheduleAutosave() {
  if (!currentProjectId) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const proj = getCurrentProject();
    if (!proj) return;
    collectProjectFromForm(proj);
    document.getElementById('projectScreenTitle').textContent = getProjectName(proj);
    saveProjects();
  }, 700);
}

function flushAutosave() {
  if (!autosaveTimer) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const proj = getCurrentProject();
  if (!proj) return;
  collectProjectFromForm(proj);
  saveProjects();
}

function deleteCurrentProject() {
  if (!currentProjectId) return;
  if (!confirm('Dieses Projekt wirklich löschen?')) return;
  projects = projects.filter(p => p.id !== currentProjectId);
  saveProjects();
  if (localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) === currentProjectId) {
    localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }
  currentProjectId = null;
  renderProjectOverview();
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

  // 50-m-Hinweis für die gesamte Seite (Summe aller Abschnitte): ein
  // durchgehender Gerüstzug läuft meist über mehrere Abschnitte.
  const seiteWarn = document.createElement('div');
  seiteWarn.className = 'laenge-warn seite-warn';
  seiteWarn.style.display = 'none';

  function refreshSeiteWarn(silent) {
    const hinweis = treppenturmHinweis(computeCardLaenge(card), 'Seite');
    seiteWarn.textContent = hinweis ? '⚠ ' + hinweis : '';
    seiteWarn.style.display = hinweis ? '' : 'none';
    if (hinweis && !card._warn50 && !silent) {
      showToast('Seite über ' + TREPPENTURM_WARN_LAENGE + ' m – Treppenturm erforderlich');
    }
    card._warn50 = !!hinweis;
  }

  const mainOnChange = () => {
    updateCardPreview(card, previewEl);
    refreshSeiteWarn();
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
    { value: 'Straßenseite',  label: 'Straßenseite' },
    { value: 'Linker Giebel',  label: 'Linker Giebel' },
    { value: 'Rechter Giebel', label: 'Rechter Giebel' },
    { value: 'Rückseite',      label: 'Rückseite' },
    { value: 'Linke Traufe',   label: 'Linke Traufe' },
    { value: 'Rechte Traufe',  label: 'Rechte Traufe' },
    { value: '__manual__',     label: 'Andere...' }
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    nameSelect.appendChild(o);
  });
  const _legacyNames = { 'Strassenseite': 'Straßenseite', 'Ruckseite': 'Rückseite' };
  nameSelect.value = _legacyNames[seiteData.name] || seiteData.name || 'Straßenseite';
  if (!nameSelect.value) nameSelect.value = 'Straßenseite';

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

  // Wandabstand & WDVS
  function makeSideMetaField(labelText, unitText, inputClass, initVal) {
    const wrap = document.createElement('div');
    wrap.className = 'wand-wdvs-field';
    const lab = document.createElement('span');
    lab.className = 'wand-wdvs-label';
    lab.textContent = labelText;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = inputClass;
    inp.step = '0.01';
    inp.min = '0';
    inp.inputMode = 'decimal';
    inp.placeholder = '0,00';
    if (initVal !== null && initVal !== undefined && !isNaN(initVal)) inp.value = initVal;
    inp.addEventListener('input', mainOnChange);
    const unit = document.createElement('span');
    unit.className = 'wand-wdvs-unit';
    unit.textContent = unitText;
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    wrap.appendChild(unit);
    return wrap;
  }

  const wandWdvsRow = document.createElement('div');
  wandWdvsRow.className = 'wand-wdvs-row';
  wandWdvsRow.appendChild(makeSideMetaField('Wandabstand', 'm',  'seite-wandabstand', seiteData.wandabstand));
  wandWdvsRow.appendChild(makeSideMetaField('WDVS',        'cm', 'seite-wdvs',        seiteData.wdvs));

  // Abschnitte
  const abschnittSection = createAbschnittSection(seiteData, mainOnChange);

  // Zubehör
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

  // Löschen
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
  body.appendChild(wandWdvsRow);
  body.appendChild(abschnittSection);
  body.appendChild(seiteWarn);
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

  // Initialer Sync: KS-Feld sowie alle aktiven Auto-Positionen (Konsole/IG "= L1",
  // Treppenturm "= H+Ü", Netze "= Fläche") – muss erst NACH dem vollständigen
  // Zusammenbau der Karte laufen, da die Abschnitts-Messwerte bis dahin noch
  // nicht im DOM von `card` stehen.
  if (ksInputRef && !ksInputRef._ksManual) {
    const fl = computeCardFlaeche(card);
    if (fl > 0) ksInputRef.value = fl.toFixed(2);
  }
  if (accSectionRef && accSectionRef._syncL1) accSectionRef._syncL1();

  updateCardPreview(card, previewEl);
  refreshSeiteWarn(true);
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
  label.textContent = 'Abschnitte';
  section.appendChild(label);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'abschnitt-rows';

  const initData = (seiteData.abschnitte && seiteData.abschnitte.length > 0)
    ? seiteData.abschnitte
    : [{ bezeichnung: '', einzelfeld: false, giebel: false, messungen: [] }];

  initData.forEach(a => rowsContainer.appendChild(createAbschnittRow(a, rowsContainer, onChange)));

  section.appendChild(rowsContainer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'meas-add-btn';
  addBtn.textContent = '+ Abschnitt';
  addBtn.addEventListener('click', () => {
    rowsContainer.appendChild(
      createAbschnittRow({ bezeichnung: '', einzelfeld: false, giebel: false, messungen: [] }, rowsContainer, onChange)
    );
    onChange();
  });
  section.appendChild(addBtn);

  return section;
}

function createAbschnittRow(data, container, onChange) {
  const row = document.createElement('div');
  row.className = 'abschnitt-row';

  // Zeile 1: Bezeichnung + Einzelfeld + Remove
  const topLine = document.createElement('div');
  topLine.className = 'abschnitt-top-line';

  const bezInp = document.createElement('input');
  bezInp.type = 'text';
  bezInp.className = 'abschnitt-bez';
  bezInp.placeholder = 'Bezeichnung (optional)';
  bezInp.value = data.bezeichnung || '';
  bezInp.addEventListener('input', onChange);

  const efBtn = document.createElement('button');
  efBtn.type = 'button';
  efBtn.className = 'einzelfeld-btn' + (data.einzelfeld ? ' active' : '');
  efBtn.textContent = 'Einzelfeld';
  efBtn.addEventListener('click', () => {
    efBtn.classList.toggle('active');
    refreshAbschnittCalc();
    onChange();
  });

  const giebelBtn = document.createElement('button');
  giebelBtn.type = 'button';
  giebelBtn.className = 'giebel-btn' + (data.giebel ? ' active' : '');
  giebelBtn.title = 'Giebel: Rechteck + Dreieck  →  L × (H1 + H2) / 2';
  giebelBtn.textContent = 'Giebel';
  giebelBtn.addEventListener('click', () => {
    giebelBtn.classList.toggle('active');
    const isGiebel = giebelBtn.classList.contains('active');
    row.classList.toggle('giebel-active', isGiebel);
    messungenList.querySelectorAll('.messung-hoehe').forEach(el => {
      el.placeholder = isGiebel ? 'H1 (Rinne)' : 'H';
    });
    messungenList.querySelectorAll('.meas-field-h .meas-field-tag').forEach(tag => {
      tag.textContent = isGiebel ? 'H1' : 'H';
    });
    refreshAbschnittCalc();
    onChange();
  });

  const removeAbBtn = document.createElement('button');
  removeAbBtn.type = 'button';
  removeAbBtn.className = 'meas-remove-btn';
  removeAbBtn.innerHTML = '&times;';
  removeAbBtn.addEventListener('click', () => {
    if (container.querySelectorAll('.abschnitt-row').length > 1) {
      row.remove();
      onChange();
    }
  });

  topLine.appendChild(bezInp);
  topLine.appendChild(efBtn);
  topLine.appendChild(giebelBtn);
  topLine.appendChild(removeAbBtn);

  // Messpaare (H × L)
  const messungenList = document.createElement('div');
  messungenList.className = 'messungen-list';

  // 50-m-Hinweis (Treppenturm) für diesen Abschnitt
  const warnLine = document.createElement('div');
  warnLine.className = 'laenge-warn';
  warnLine.style.display = 'none';

  // Abschnitt-Summe
  const abTotalLine = document.createElement('div');
  abTotalLine.className = 'abschnitt-total';

  function refreshAbschnittCalc(silent) {
    const ef       = efBtn.classList.contains('active');
    const isGiebel = giebelBtn.classList.contains('active');
    let total = 0;
    let totalLaenge = 0;
    messungenList.querySelectorAll('.messung-row').forEach(mRow => {
      const l   = parseNum(mRow.querySelector('.messung-laenge')?.value);
      const lZ  = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
      const calcEl = mRow.querySelector('.messung-calc');
      let lEff = (l || 0) + lZ;
      if (ef) lEff = Math.max(lEff, 2.5);
      let f = 0;
      if (!isNaN(l) && lEff > 0) {
        totalLaenge += lEff;
        if (isGiebel) {
          const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
          const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
          const h2  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
          const h2Z = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
          if (!isNaN(h) && !isNaN(h2)) {
            const h1Eff = (h  || 0) + hZ;
            const h2Eff = (h2 || 0) + h2Z;
            if (h2Eff >= h1Eff && h1Eff >= 0) f = round2(lEff * (h1Eff + h2Eff) / 2);
          }
        } else {
          const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
          const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
          if (!isNaN(h)) {
            const hEff = (h || 0) + hZ;
            if (hEff > 0) f = round2(lEff * hEff);
          }
        }
      }
      total += f;
      if (calcEl) calcEl.textContent = f > 0 ? '= ' + fmtNum(f) + ' m²' : '';
    });
    total = round2(total);
    totalLaenge = round2(totalLaenge);
    abTotalLine.textContent = total > 0
      ? 'Σ L ' + fmtNum(totalLaenge) + ' m · ' + fmtNum(total) + ' m²'
      : (totalLaenge > 0 ? 'Σ L ' + fmtNum(totalLaenge) + ' m' : '');

    // Treppenturm-Hinweis, sobald der Abschnitt 50 m überschreitet
    const hinweis = treppenturmHinweis(totalLaenge, 'Abschnitt');
    warnLine.textContent = hinweis ? '⚠ ' + hinweis : '';
    warnLine.style.display = hinweis ? '' : 'none';
    if (hinweis && !row._warn50 && !silent) {
      showToast('Über ' + TREPPENTURM_WARN_LAENGE + ' m – Treppenturm erforderlich');
    }
    row._warn50 = !!hinweis;
  }

  // Höhenwerte der ersten Messzeile des Abschnitts – innerhalb eines Abschnitts
  // (z. B. Balkon) ändert sich in der Regel nur die Länge, die Höhe bleibt
  // gleich. Neue Zeilen übernehmen diese Höhe daher als Vorschlag.
  function getErsteHoehe() {
    const first = messungenList.querySelector('.messung-row');
    if (!first) return {};
    const h   = parseNum(first.querySelector('.messung-hoehe')?.value);
    const hZ  = readZuschlag(first.querySelector('.messung-hoehe-zuschlag'));
    const h2  = parseNum(first.querySelector('.messung-hoehe2')?.value);
    const h2Z = readZuschlag(first.querySelector('.messung-hoehe2-zuschlag'));
    return {
      hoehe:          isNaN(h)  ? null : h,
      hoeheZuschlag:  hZ  > 0 ? hZ  : null,
      hoehe2:         isNaN(h2) ? null : h2,
      hoehe2Zuschlag: h2Z > 0 ? h2Z : null
    };
  }

  // Kompletter Wertesatz einer Zeile (für „Position noch einmal erfassen")
  function readMessungRow(mRow) {
    const l   = parseNum(mRow.querySelector('.messung-laenge')?.value);
    const lZ  = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
    const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
    const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
    const h2  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
    const h2Z = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
    return {
      laenge:         isNaN(l)  ? null : l,
      laengeZuschlag: lZ  > 0 ? lZ  : null,
      hoehe:          isNaN(h)  ? null : h,
      hoeheZuschlag:  hZ  > 0 ? hZ  : null,
      hoehe2:         isNaN(h2) ? null : h2,
      hoehe2Zuschlag: h2Z > 0 ? h2Z : null
    };
  }

  function createMessungRow(mData) {
    const mRow = document.createElement('div');
    mRow.className = 'messung-row';

    const isGiebelNow = giebelBtn.classList.contains('active');

    const laengeInp = document.createElement('input');
    laengeInp.type = 'number';
    laengeInp.className = 'messung-laenge';
    laengeInp.step = '0.01';
    laengeInp.min = '0';
    laengeInp.inputMode = 'decimal';
    laengeInp.placeholder = 'L';
    if (mData?.laenge != null && !isNaN(mData.laenge)) laengeInp.value = mData.laenge;

    const laengeZuschlagCtrl = createZuschlagControl(mData?.laengeZuschlag, 'messung-laenge-zuschlag', () => {
      refreshAbschnittCalc();
      onChange();
    });

    const mulSign = document.createElement('span');
    mulSign.className = 'messung-mul';
    mulSign.textContent = '×';

    const hoeheInp = document.createElement('input');
    hoeheInp.type = 'number';
    hoeheInp.className = 'messung-hoehe';
    hoeheInp.step = '0.01';
    hoeheInp.min = '0';
    hoeheInp.inputMode = 'decimal';
    hoeheInp.placeholder = isGiebelNow ? 'H1 (Rinne)' : 'H';
    if (mData?.hoehe != null && !isNaN(mData.hoehe)) hoeheInp.value = mData.hoehe;

    const hoeheZuschlagCtrl = createZuschlagControl(mData?.hoeheZuschlag, 'messung-hoehe-zuschlag', () => {
      refreshAbschnittCalc();
      onChange();
    });

    // Giebel-spezifisch: H2 (Spitze)
    const giebelSep = document.createElement('span');
    giebelSep.className = 'giebel-sep giebel-part';
    giebelSep.textContent = '△';

    const hoehe2Inp = document.createElement('input');
    hoehe2Inp.type = 'number';
    hoehe2Inp.className = 'messung-hoehe2';
    hoehe2Inp.step = '0.01';
    hoehe2Inp.min = '0';
    hoehe2Inp.inputMode = 'decimal';
    hoehe2Inp.placeholder = 'H2 (Spitze)';
    if (mData?.hoehe2 != null && !isNaN(mData.hoehe2)) hoehe2Inp.value = mData.hoehe2;

    const hoehe2ZuschlagCtrl = createZuschlagControl(mData?.hoehe2Zuschlag, 'messung-hoehe2-zuschlag giebel-part', () => {
      refreshAbschnittCalc();
      onChange();
    });
    hoehe2Inp.addEventListener('input', () => { refreshAbschnittCalc(); onChange(); });

    const calcSpan = document.createElement('span');
    calcSpan.className = 'messung-calc';

    // „+" duplziert die Zeile mit allen Werten – für Positionen, die für den
    // Umlauf ein zweites Mal erfasst werden müssen. Nichts muss neu getippt
    // werden; die Kopie ist danach ganz normal einzeln änderbar.
    const dupMBtn = document.createElement('button');
    dupMBtn.type = 'button';
    dupMBtn.className = 'messung-dup-btn';
    dupMBtn.textContent = '+';
    dupMBtn.title = 'Position noch einmal erfassen (z. B. für den Umlauf)';
    dupMBtn.addEventListener('click', () => {
      const kopie = createMessungRow(readMessungRow(mRow));
      mRow.after(kopie);
      refreshAbschnittCalc();
      onChange();
      const inp = kopie.querySelector('.messung-laenge');
      if (inp) { inp.focus(); if (inp.select) inp.select(); }
    });

    const removeMBtn = document.createElement('button');
    removeMBtn.type = 'button';
    removeMBtn.className = 'meas-remove-btn';
    removeMBtn.innerHTML = '&times;';
    removeMBtn.addEventListener('click', () => {
      if (messungenList.querySelectorAll('.messung-row').length > 1) {
        mRow.remove();
        refreshAbschnittCalc();
        onChange();
      }
    });

    laengeInp.addEventListener('input', () => { refreshAbschnittCalc(); onChange(); });
    hoeheInp.addEventListener('input',  () => { refreshAbschnittCalc(); onChange(); });

    const laengeField = wrapMeasField('L', laengeInp);
    const hoeheField  = wrapMeasField(isGiebelNow ? 'H1' : 'H', hoeheInp);
    hoeheField.classList.add('meas-field-h');
    const hoehe2Field = wrapMeasField('H2', hoehe2Inp, 'giebel-part');

    // Reihenfolge: erst Höhe (bleibt im Abschnitt meist gleich), dann Länge
    mRow.appendChild(hoeheField);
    mRow.appendChild(hoeheZuschlagCtrl);
    mRow.appendChild(giebelSep);
    mRow.appendChild(hoehe2Field);
    mRow.appendChild(hoehe2ZuschlagCtrl);
    mRow.appendChild(mulSign);
    mRow.appendChild(laengeField);
    mRow.appendChild(laengeZuschlagCtrl);
    mRow.appendChild(calcSpan);
    mRow.appendChild(dupMBtn);
    mRow.appendChild(removeMBtn);
    return mRow;
  }

  const initMessungen = (data.messungen && data.messungen.length > 0)
    ? data.messungen
    : [{ laenge: null, laengeZuschlag: null, hoehe: null, hoeheZuschlag: null }];

  initMessungen.forEach(m => messungenList.appendChild(createMessungRow(m)));

  // Neue Zeilen übernehmen die Höhe der ersten Zeile des Abschnitts als
  // Vorschlag (nur die Länge muss noch eingetragen werden). Der Wert bleibt
  // ganz normal überschreibbar, falls die Höhe doch abweicht.
  const addMessBtn = document.createElement('button');
  addMessBtn.type = 'button';
  addMessBtn.className = 'meas-add-btn meas-add-btn-sm';
  addMessBtn.textContent = '+ Maß';
  addMessBtn.title = 'Weitere Messung – Höhe wird aus der ersten Zeile übernommen';
  addMessBtn.addEventListener('click', () => {
    const neu = createMessungRow(getErsteHoehe());
    messungenList.appendChild(neu);
    refreshAbschnittCalc();
    onChange();
    const inp = neu.querySelector('.messung-laenge');
    if (inp) inp.focus();
  });

  // Notiz zum Abschnitt (z. B. „nur bis OK Brüstung", „Zufahrt frei halten")
  const notizInp = document.createElement('input');
  notizInp.type = 'text';
  notizInp.className = 'abschnitt-notiz';
  notizInp.placeholder = 'Notiz zum Abschnitt (optional)';
  notizInp.value = data.notiz || '';
  notizInp.addEventListener('input', onChange);

  // Giebel-Startzustand anwenden
  if (data.giebel) row.classList.add('giebel-active');

  row.appendChild(topLine);
  row.appendChild(messungenList);
  row.appendChild(addMessBtn);
  row.appendChild(notizInp);
  row.appendChild(warnLine);
  row.appendChild(abTotalLine);

  refreshAbschnittCalc(true);
  return row;
}

// ============================================================
//  Vorschau-Text
// ============================================================

function updateCardPreview(card, previewEl) {
  const totalFl = computeCardFlaeche(card);
  previewEl.textContent = totalFl > 0 ? fmtNum(totalFl) + ' m²' : '';
}

function renumberSeitenBadges() {
  document.querySelectorAll('#seitenContainer .seite-card').forEach((card, i) => {
    const badge = card.querySelector('.seite-number');
    if (badge) badge.textContent = i + 1;
  });
}

// ============================================================
//  Neue Seite hinzufügen
// ============================================================

function addSide() {
  const container = document.getElementById('seitenContainer');
  const newSide = {
    id:             genId('side'),
    name:           'Straßenseite',
    manualName:     '',
    abschnitte:     [{ bezeichnung: '', einzelfeld: false, giebel: false, messungen: [] }],
    wandabstand:       null,
    wdvs:              null,
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
  optEmpty.textContent = '– Art wählen –';
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

  // Beim Wählen einer flächenbasierten Art automatisch die passende Einheit setzen
  artSel.addEventListener('change', () => {
    const pref = PREFERRED_EINHEIT[artSel.value];
    if (pref) einheitSel.value = pref;
    refreshArtHinweise();
    updateSummary();
  });
  einheitSel.addEventListener('change', updateSummary);

  // Menge
  const mengeInp = document.createElement('input');
  mengeInp.type = 'number';
  mengeInp.className = 'zusatz-menge';
  mengeInp.step = '0.01';
  mengeInp.min = '0';
  mengeInp.inputMode = 'decimal';
  mengeInp.placeholder = '0,00';
  if (data?.menge !== null && data?.menge !== undefined && !isNaN(data.menge)) mengeInp.value = data.menge;
  mengeInp.addEventListener('input', updateSummary);

  // Notiz
  const notizInp = document.createElement('input');
  notizInp.type = 'text';
  notizInp.className = 'zusatz-notiz';
  notizInp.placeholder = 'Notiz (optional)';
  notizInp.value = data?.notiz || '';
  notizInp.addEventListener('input', updateSummary);

  // Pauschal-/Stückpositionen (Parkplatz, Genehmigung) werden nicht gemessen –
  // dort zählt nur die Anzahl; Zeitraum/Behörde gehören in die Notiz.
  function refreshArtHinweise() {
    const pauschal = PAUSCHAL_ARTEN.includes(artSel.value);
    mengeInp.placeholder = pauschal ? 'Anzahl' : '0,00';
    notizInp.placeholder = artSel.value === 'Parkplatz'
      ? 'Notiz, z. B. Zeitraum / Halteverbotszone'
      : (artSel.value === 'Genehmigung' ? 'Notiz, z. B. Behörde / Art der Genehmigung' : 'Notiz (optional)');
  }

  // Remove
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meas-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => { row.remove(); refreshNoZusatzHint(); updateSummary(); });

  refreshArtHinweise();

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
//  Hilfsfunktionen für Zubehör-Abschnitt
// ============================================================

// Eindeutige L/H-Kennzeichnung direkt am Eingabefeld (kleines Badge oben links)
function wrapMeasField(labelText, input, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = 'meas-field' + (extraClass ? ' ' + extraClass : '');
  const tag = document.createElement('span');
  tag.className = 'meas-field-tag';
  tag.textContent = labelText;
  wrap.appendChild(tag);
  wrap.appendChild(input);
  wrap._tag = tag;
  return wrap;
}

// Individueller Zuschlag ("+Xm"-Taste) für ein einzelnes Maß-Feld (L/H/H2).
// Antippen aktiviert den Zuschlag mit dem globalen Standardwert; der Wert kann
// danach jederzeit individuell für genau dieses Feld überschrieben werden.
function createZuschlagControl(initValue, extraClass, onChange) {
  const wrap = document.createElement('span');
  wrap.className = 'zuschlag-ctrl' + (extraClass ? ' ' + extraClass : '');

  const isActive = initValue != null && !isNaN(initValue) && initValue > 0;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'plus2-btn' + (isActive ? ' active' : '');

  const valInp = document.createElement('input');
  valInp.type = 'number';
  valInp.className = 'plus2-value-input';
  valInp.step = '0.1';
  valInp.min = '0.1';
  valInp.inputMode = 'decimal';
  valInp.placeholder = 'm';
  if (isActive) valInp.value = initValue;

  function refreshVisual() {
    const active = btn.classList.contains('active');
    btn.textContent = active ? '+' : ('+' + fmtNum(ueberstandWert) + 'm');
    btn.title = active ? 'Zuschlag entfernen' : 'Zuschlag hinzufügen (individuell änderbar)';
    valInp.style.display = active ? '' : 'none';
  }
  refreshVisual();

  btn.addEventListener('click', () => {
    const wasActive = btn.classList.contains('active');
    btn.classList.toggle('active', !wasActive);
    if (!wasActive && !valInp.value) valInp.value = ueberstandWert;
    refreshVisual();
    if (onChange) onChange();
  });
  valInp.addEventListener('input', () => { if (onChange) onChange(); });
  valInp.addEventListener('click', e => e.stopPropagation());

  wrap.appendChild(btn);
  wrap.appendChild(valInp);
  return wrap;
}

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
//  Zubehör-Abschnitt
// ============================================================

function createAccessoriesSection(seiteData, card, onChange) {
  const section = document.createElement('div');
  section.className = 'accessories-section';

  const title = document.createElement('div');
  title.className = 'accessories-title';
  title.textContent = 'Positionen';
  section.appendChild(title);

  // Erste Abschnitt-Länge (für "= L1")
  function getL1() {
    const firstAbRow = card.querySelector('.abschnitt-row');
    if (!firstAbRow) return null;
    const firstMRow = firstAbRow.querySelector('.messung-row');
    if (!firstMRow) return null;
    const l   = parseNum(firstMRow.querySelector('.messung-laenge')?.value);
    const lZ  = readZuschlag(firstMRow.querySelector('.messung-laenge-zuschlag'));
    const ef  = firstAbRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
    if (isNaN(l)) return null;
    let lEff = (l || 0) + lZ;
    if (ef) lEff = Math.max(lEff, 2.5);
    return lEff > 0 ? round2(lEff) : null;
  }

  // `getAutoValue`/`autoLabel` erlauben abweichende Vorschlagsquellen statt der
  // Standard-Länge des ersten Abschnitts (L1) – z. B. Fläche der Seite (Netze)
  // oder Höhe + Überstand (Treppenturm). Ohne Angabe verhält sich die Funktion
  // wie bisher (Länge von L1).
  function createInlineLength(accKey, initLaenge, initAutoL1, unitLabel, autoLabel, getAutoValue) {
    autoLabel     = autoLabel || '= L1';
    getAutoValue  = getAutoValue || getL1;

    const wrap = document.createElement('div');
    wrap.className = 'acc-inline-length';

    const l1Btn = document.createElement('button');
    l1Btn.type = 'button';
    l1Btn.className = 'accessory-l1-btn' + (initAutoL1 ? ' active' : '');
    l1Btn.dataset.active = initAutoL1 ? '1' : '0';
    if (accKey) l1Btn.dataset.acc = accKey;
    l1Btn.textContent = autoLabel;
    l1Btn._getAutoValue = getAutoValue;
    l1Btn.title = autoLabel === '= L1' ? 'Länge vom ersten Abschnitt übernehmen' : 'Automatisch berechneten Vorschlagswert übernehmen';

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
    if (initAutoL1) { const v = getAutoValue(); if (v !== null && !isNaN(v)) inp.value = v; }

    l1Btn.addEventListener('click', () => {
      const nowActive = l1Btn.dataset.active === '1';
      l1Btn.dataset.active = nowActive ? '0' : '1';
      l1Btn.classList.toggle('active', !nowActive);
      inp.disabled = !nowActive;
      if (!nowActive) { const v = getAutoValue(); if (v !== null && !isNaN(v)) inp.value = v; }
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

  function createSingleAcc(accKey, labelText, initData, unitLabel, autoLabel, getAutoValue, defaultAuto, valueField) {
    valueField = valueField || 'laenge';
    const row = document.createElement('div');
    row.className = 'acc-single-row';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'accessory-toggle' + (initData ? ' active' : '');
    toggleBtn.dataset.acc = accKey;
    toggleBtn.textContent = labelText;

    // Neue (noch nie gespeicherte) Position: startet im übergebenen `defaultAuto`-
    // Modus (z. B. Netze/Treppenturm sofort mit Vorschlagswert). Bereits
    // gespeicherte Positionen behalten ihren zuletzt gewählten Auto/Manuell-Zustand.
    const initAutoL1 = initData
      ? (initData.autoL1 !== undefined ? initData.autoL1 : !!defaultAuto)
      : !!defaultAuto;
    const lenWrap = createInlineLength(accKey, initData ? initData[valueField] : null, initAutoL1, unitLabel, autoLabel, getAutoValue);
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

  // Lage/Ebene-Auswahl (wie im 2D-Programm): Alle / 1 Lage / 2 Lagen / freie Anzahl.
  // Gemeinsam genutzt von Konsolen- und Innengeländer-Zeilen.
  function createLageWrap(data, onLageChange) {
    const lageWrap = document.createElement('div');
    lageWrap.className = 'acc-lage-wrap';

    const lageBtns = document.createElement('div');
    lageBtns.className = 'acc-lage-btns';
    const currentLage   = (data && data.lage != null) ? String(data.lage) : 'alle';
    const isPresetLage  = ['alle', '1', '2', '3', '4', '5'].includes(currentLage);

    const lageFreeInp = document.createElement('input');
    lageFreeInp.type = 'number';
    lageFreeInp.className = 'lage-free-input';
    lageFreeInp.min = '1';
    lageFreeInp.step = '1';
    lageFreeInp.inputMode = 'numeric';
    lageFreeInp.placeholder = 'Anz.';
    if (!isPresetLage) lageFreeInp.value = currentLage;

    [['alle', 'Alle'], ['1', '1 Lage'], ['2', '2 Lagen'], ['3', '3 Lagen'], ['4', '4 Lagen'], ['5', '5 Lagen']].forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lage-btn' + (isPresetLage && currentLage === val ? ' active' : '');
      b.dataset.lage = val;
      b.textContent = lbl;
      b.addEventListener('click', () => {
        lageBtns.querySelectorAll('.lage-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        lageFreeInp.value = '';
        onLageChange();
      });
      lageBtns.appendChild(b);
    });

    lageFreeInp.addEventListener('input', () => {
      if (lageFreeInp.value.trim() !== '') {
        lageBtns.querySelectorAll('.lage-btn').forEach(x => x.classList.remove('active'));
      }
      onLageChange();
    });

    lageWrap.appendChild(lageBtns);
    lageWrap.appendChild(lageFreeInp);
    return lageWrap;
  }

  // Live-Anzeige "= X,XX m" (Laenge × Lagenzahl) einer Konsolen-/IG-Zeile
  function createLageCalc() {
    const calcEl = document.createElement('span');
    calcEl.className = 'acc-lage-calc';
    calcEl.style.display = 'none';
    return calcEl;
  }

  function updateLageCalc(row) {
    const calcEl = row.querySelector('.acc-lage-calc');
    if (!calcEl) return;
    const inp = row.querySelector('.accessory-length-input');
    const v   = inp ? parseNum(inp.value) : NaN;
    const lage = collectLage(row);
    const n    = lagenAnzahl(lage);
    if (!isNaN(v) && v > 0 && n && n !== 1) {
      calcEl.textContent = '= ' + fmtNum(round2(v * n)) + ' m';
      calcEl.style.display = '';
    } else {
      calcEl.textContent = '';
      calcEl.style.display = 'none';
    }
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

  const konsoleTotalEl = document.createElement('div');
  konsoleTotalEl.className = 'acc-multi-total';
  konsoleTotalEl.style.display = 'none';

  function refreshKonsoleTotal() {
    let total = 0, hasAny = false;
    konsoleList.querySelectorAll('.acc-multi-row').forEach(r => {
      const inp = r.querySelector('.accessory-length-input');
      const v = inp ? parseNum(inp.value) : NaN;
      updateLageCalc(r);
      if (!isNaN(v) && v > 0) { total += effektiveLaenge(v, collectLage(r)); hasAny = true; }
    });
    if (hasAny) {
      konsoleTotalEl.textContent = 'Gesamt: ' + fmtNum(round2(total)) + ' m';
      konsoleTotalEl.style.display = '';
    } else {
      konsoleTotalEl.textContent = '';
      konsoleTotalEl.style.display = 'none';
    }
  }

  konsoleList.addEventListener('input', refreshKonsoleTotal);
  konsoleList.addEventListener('click', () => requestAnimationFrame(refreshKonsoleTotal));

  function addKonsoleRow(data) {
    const row = document.createElement('div');
    row.className = 'acc-multi-row';

    const typeBtns = document.createElement('div');
    typeBtns.className = 'acc-type-btns';

    function makeKonsoleTypeBtn(typVal, label, isDachfangBtn, title) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'konsole-btn' + (isDachfangBtn ? ' konsole-btn-df' : '') + (data && data.typ === typVal ? ' active' : '');
      btn.dataset.typ = typVal;
      btn.textContent = label;
      if (title) btn.title = title;
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        typeBtns.querySelectorAll('.konsole-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) btn.classList.add('active');
        onChange();
      });
      return btn;
    }

    KONSOLE_TYPES.forEach(typ => {
      typeBtns.appendChild(makeKonsoleTypeBtn(typ, typ, false));
      // Bei Konsole 0,50 zusätzlich die Sonder-Variante "Dachfang" anbieten
      // (intern weiterhin Konsole 0,50, aber separat gekennzeichnet).
      if (typ === '50') {
        typeBtns.appendChild(makeKonsoleTypeBtn(KONSOLE_DACHFANG_TYP, 'DF', true, 'Dachfang (Konsole 0,50)'));
      }
    });

    const lenWrap  = createInlineLength(null, data ? data.laenge : null, data ? (data.autoL1 !== undefined ? data.autoL1 : true) : true);
    const lageWrap = createLageWrap(data, onChange);
    const calcEl   = createLageCalc();

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meas-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => { row.remove(); refreshKonsoleTotal(); onChange(); });

    row.appendChild(typeBtns);
    row.appendChild(lenWrap);
    row.appendChild(lageWrap);
    row.appendChild(calcEl);
    row.appendChild(removeBtn);
    konsoleList.appendChild(row);
  }

  const konsoleInit = Array.isArray(seiteData.konsolen)
    ? seiteData.konsolen
    : (seiteData.konsole ? [seiteData.konsole] : []);
  konsoleInit.forEach(k => addKonsoleRow(k));
  refreshKonsoleTotal();

  const addKonsoleBtn = makeAddBtn('+ Ebene', () => { addKonsoleRow(null); refreshKonsoleTotal(); onChange(); });
  konsoleTitleRow.appendChild(addKonsoleBtn);
  section.appendChild(konsoleTitleRow);
  section.appendChild(konsoleList);
  section.appendChild(konsoleTotalEl);

  // Innengeländer – UI 1:1 wie bei den Konsolen (Laenge + Lage/Ebene-Auswahl,
  // die Laenge wird bei konkreter Lagenzahl automatisch multipliziert)
  const igTitleRow = document.createElement('div');
  igTitleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';
  const igLbl = document.createElement('span');
  igLbl.className = 'accessories-title';
  igLbl.textContent = 'Innengeländer';
  igTitleRow.appendChild(igLbl);

  const igList = document.createElement('div');
  igList.className = 'acc-multi-list acc-ig-list';

  const igTotalEl = document.createElement('div');
  igTotalEl.className = 'acc-multi-total';
  igTotalEl.style.display = 'none';

  function refreshIgTotal() {
    let total = 0, hasAny = false;
    igList.querySelectorAll('.acc-multi-row').forEach(r => {
      const inp = r.querySelector('.accessory-length-input');
      const v = inp ? parseNum(inp.value) : NaN;
      updateLageCalc(r);
      if (!isNaN(v) && v > 0) { total += effektiveLaenge(v, collectLage(r)); hasAny = true; }
    });
    if (hasAny) {
      igTotalEl.textContent = 'Gesamt: ' + fmtNum(round2(total)) + ' m';
      igTotalEl.style.display = '';
    } else {
      igTotalEl.textContent = '';
      igTotalEl.style.display = 'none';
    }
  }

  igList.addEventListener('input', refreshIgTotal);
  igList.addEventListener('click', () => requestAnimationFrame(refreshIgTotal));

  function addIgRow(data) {
    const row = document.createElement('div');
    row.className = 'acc-multi-row';
    row.appendChild(makeAccLabel('IG'));

    const lenWrap  = createInlineLength(null, data ? data.laenge : null, data ? (data.autoL1 !== undefined ? data.autoL1 : true) : true);
    const lageWrap = createLageWrap(data, onChange);
    const calcEl   = createLageCalc();

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meas-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => { row.remove(); refreshIgTotal(); onChange(); });

    row.appendChild(lenWrap);
    row.appendChild(lageWrap);
    row.appendChild(calcEl);
    row.appendChild(removeBtn);
    igList.appendChild(row);
  }

  const igInit = Array.isArray(seiteData.innengelaender)
    ? seiteData.innengelaender
    : (seiteData.innengelaender ? [seiteData.innengelaender] : []);
  igInit.forEach(ig => addIgRow(ig));
  refreshIgTotal();

  const addIgBtn = makeAddBtn('+ IG', () => { addIgRow(null); refreshIgTotal(); onChange(); });
  igTitleRow.appendChild(addIgBtn);
  section.appendChild(igTitleRow);
  section.appendChild(igList);
  section.appendChild(igTotalEl);

  // Einzelne Zubehör
  section.appendChild(createSingleAcc('df', 'Dachfang (DF)',          seiteData.dachfang          || null));
  section.appendChild(createSingleAcc('gt', 'Gitterträger (GT)',       seiteData.gittertraeger     || null));
  section.appendChild(createSingleAcc('ft', 'Fußgängertunnel (FT)',   seiteData.fussgaengertunnel || null));

  // Treppenturm: Vorschlagshöhe = größte Höhe der Seite + Überstand (Standard
  // 2,00 m, wie bei den anderen "+Xm"-Zuschlägen einstellbar). Bei mehreren
  // Höhen auf der Seite wird die größte verwendet. Der Vorschlag bleibt jederzeit
  // manuell überschreibbar (Auto-Taste deaktivieren oder Wert direkt ändern).
  section.appendChild(createSingleAcc(
    'tt', 'Treppenturm (TT)', seiteData.treppenturm || null, 'm (H)',
    '= H+' + fmtNum(ueberstandWert) + 'm',
    () => { const h = computeCardMaxHoehe(card); return h > 0 ? round2(h + ueberstandWert) : null; },
    true,
    'hoehe'
  ));

  // Netze: Vorschlags-m² = Gerüstfläche der Seite (wie beim KS-Feld).
  section.appendChild(createSingleAcc(
    'ne', 'Netze (NE)', seiteData.netze || null, 'm²',
    '= Fläche',
    () => { const fl = computeCardFlaeche(card); return fl > 0 ? fl : null; },
    true
  ));

  // L1-Sync
  section._syncL1 = function() {
    section.querySelectorAll('.accessory-l1-btn[data-active="1"]').forEach(l1Btn => {
      const wrap = l1Btn.closest('.acc-inline-length');
      if (!wrap) return;
      const inp = wrap.querySelector('.accessory-length-input');
      if (!inp) return;
      const v = (l1Btn._getAutoValue || getL1)();
      if (v !== null && !isNaN(v)) inp.value = v;
    });
  };

  return section;
}

// ============================================================
//  Zusammenfassung
// ============================================================

function updateSummary() {
  const el    = document.getElementById('summaryContent');
  const cards = document.querySelectorAll('#seitenContainer .seite-card');

  if (cards.length === 0) {
    el.innerHTML = '<p class="summary-empty">Noch keine Seiten erfasst.</p>';
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

    const wandabstandVal = parseNum(card.querySelector('.seite-wandabstand')?.value);
    const wdvsVal        = parseNum(card.querySelector('.seite-wdvs')?.value);
    if (!isNaN(wandabstandVal) || !isNaN(wdvsVal)) {
      const metaParts = [];
      if (!isNaN(wandabstandVal)) metaParts.push('Wandabstand ' + fmtNum(wandabstandVal) + ' m');
      if (!isNaN(wdvsVal))        metaParts.push('WDVS ' + fmtNum(wdvsVal) + ' cm');
      detailParts.push(metaParts.join(' · '));
    }

    card.querySelectorAll('.abschnitt-row').forEach(abRow => {
      const ef       = abRow.querySelector('.einzelfeld-btn')?.classList.contains('active') || false;
      const isGiebel = abRow.querySelector('.giebel-btn')?.classList.contains('active')    || false;
      const bez      = abRow.querySelector('.abschnitt-bez')?.value.trim()   || '';
      const abNotiz  = abRow.querySelector('.abschnitt-notiz')?.value.trim() || '';
      let abFlaeche  = 0;
      abRow.querySelectorAll('.messung-row').forEach(mRow => {
        const l   = parseNum(mRow.querySelector('.messung-laenge')?.value);
        const lZ  = readZuschlag(mRow.querySelector('.messung-laenge-zuschlag'));
        let lEff  = (l || 0) + lZ;
        if (ef) lEff = Math.max(lEff, 2.5);
        if (isNaN(l) || lEff <= 0) return;
        const bezPfx = bez ? bez + ': ' : '';
        const efStr  = ef && (l || 0) < 2.5 ? ' (EF)' : '';
        if (isGiebel) {
          const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
          const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
          const h2  = parseNum(mRow.querySelector('.messung-hoehe2')?.value);
          const h2Z = readZuschlag(mRow.querySelector('.messung-hoehe2-zuschlag'));
          if (!isNaN(h) && !isNaN(h2)) {
            const h1Eff = (h  || 0) + hZ;
            const h2Eff = (h2 || 0) + h2Z;
            if (h2Eff >= h1Eff && h1Eff >= 0) {
              const pair = round2(lEff * (h1Eff + h2Eff) / 2);
              abFlaeche += pair;
              detailParts.push(bezPfx + '(H1 ' + fmtNum(h1Eff) + ' + H2 ' + fmtNum(h2Eff) + ') / 2 × ' + fmtNum(lEff) + ' m' + efStr + ' = ' + fmtNum(pair) + ' m² (Giebel)');
            }
          }
        } else {
          const h   = parseNum(mRow.querySelector('.messung-hoehe')?.value);
          const hZ  = readZuschlag(mRow.querySelector('.messung-hoehe-zuschlag'));
          if (!isNaN(h)) {
            const hEff = (h || 0) + hZ;
            if (hEff > 0) {
              const pair = round2(lEff * hEff);
              abFlaeche += pair;
              detailParts.push(bezPfx + fmtNum(hEff) + ' m × ' + fmtNum(lEff) + ' m' + efStr + ' = ' + fmtNum(pair) + ' m²');
            }
          }
        }
      });
      if (abNotiz) detailParts.push((bez ? bez + ': ' : '') + 'Notiz: ' + escHtml(abNotiz));
      seitenFlaeche += abFlaeche;
    });

    // 50-m-Hinweis (Treppenturm) für die gesamte Seite
    const seiteHinweis = treppenturmHinweis(computeCardLaenge(card), 'Seite');
    if (seiteHinweis) detailParts.push('<span class="summary-warn">⚠ ' + seiteHinweis + '</span>');

    totalArea += seitenFlaeche;

    // Zubehör
    card.querySelectorAll('.acc-konsole-list .acc-multi-row').forEach(row => {
      const activeTypBtn = row.querySelector('.konsole-btn.active');
      if (!activeTypBtn) return;
      const lenInp = row.querySelector('.accessory-length-input');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      const lage = collectLage(row);
      const lageStr = lageLabel(lage);
      const eff = (!isNaN(v) && v > 0) ? effektiveLaenge(v, lage) : null;
      detailParts.push(konsoleTypLabel(activeTypBtn.dataset.typ, true) + (lageStr ? ' (' + lageStr + ')' : '') + (eff !== null ? ': ' + fmtNum(round2(eff)) + ' m' : ''));
    });
    card.querySelectorAll('.acc-ig-list .acc-multi-row').forEach(row => {
      const lenInp = row.querySelector('.accessory-length-input');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      const lage = collectLage(row);
      const lageStr = lageLabel(lage);
      const eff = (!isNaN(v) && v > 0) ? effektiveLaenge(v, lage) : null;
      detailParts.push('IG' + (lageStr ? ' (' + lageStr + ')' : '') + (eff !== null ? ': ' + fmtNum(round2(eff)) + ' m' : ''));
    });
    [{ acc: 'df', label: 'DF', unit: 'm' }, { acc: 'gt', label: 'GT', unit: 'm' }, { acc: 'ft', label: 'FT', unit: 'm' }, { acc: 'ne', label: 'NE', unit: 'm²' }].forEach(({ acc, label, unit }) => {
      const toggle = card.querySelector('.accessory-toggle[data-acc="' + acc + '"]');
      if (!toggle || !toggle.classList.contains('active')) return;
      const lenInp = card.querySelector('.accessory-length-input[data-acc="' + acc + '"]');
      const v = lenInp ? parseNum(lenInp.value) : NaN;
      detailParts.push(label + (!isNaN(v) && v > 0 ? ': ' + fmtNum(v) + ' ' + unit : ''));
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
    html += `<tr><td colspan="2" style="padding-top:10px;font-size:0.72rem;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--color-border);">Positionen</td></tr>`;
    zusatzRows.forEach(row => {
      const art     = row.querySelector('.zusatz-art')?.value   || '–';
      const einheit = row.querySelector('.zusatz-einheit')?.value || '';
      const menge   = parseNum(row.querySelector('.zusatz-menge')?.value);
      const notiz   = row.querySelector('.zusatz-notiz')?.value.trim();
      const mengeStr = !isNaN(menge) ? fmtNum(menge) + ' ' + einheit : '–';
      html += `<tr>
        <td><span class="summary-side-name" style="font-size:0.88rem">${art}</span>${notiz ? '<span class="summary-side-detail">' + escHtml(notiz) + '</span>' : ''}</td>
        <td>${mengeStr}</td>
      </tr>`;
    });
  }

  html += `
    <tr class="summary-total-row">
      <td>Gesamtfläche</td>
      <td>${fmtNum(totalArea)} m²</td>
    </tr>`;

  const ankerAnzahl = parseNum(document.getElementById('fieldAnkerAnzahl')?.value);
  if (!isNaN(ankerAnzahl) && ankerAnzahl > 0) {
    html += `<tr><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">Ankeranzahl</td><td style="font-size:0.82rem;color:var(--color-text-secondary);padding-top:4px;">${ankerAnzahl} Stk.</td></tr>`;
  }

  // Transport / Laufaufwand (für die spätere Kalkulation im Büro)
  const lg = collectLogistik();
  const effortRows = [
    lg.transportM  != null ? ['Laufweg LKW → Objekt', fmtNum(lg.transportM) + ' m'] : null,
    lg.hoehenmeter != null ? ['Höhenmeter',           fmtNum(lg.hoehenmeter) + ' m'] : null,
    lg.treppen     != null ? ['Treppen / Stockwerke', String(lg.treppen)] : null
  ].filter(Boolean);
  if (effortRows.length > 0) {
    html += `<tr><td colspan="2" style="padding-top:10px;font-size:0.72rem;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--color-border);">Transport / Laufaufwand</td></tr>`;
    effortRows.forEach(([label, val]) => {
      html += `<tr><td><span class="summary-side-name" style="font-size:0.88rem">${label}</span></td><td>${val}</td></tr>`;
    });
  }

  html += '</table>';
  el.innerHTML = html;
}

// ============================================================
//  Anfahrt-Berechnung (Nominatim + OSRM)
// ============================================================

async function autoCalcAnfahrt() {
  const strasse = (document.getElementById('fieldStrasse').value || '').trim();
  const nummer  = (document.getElementById('fieldNummer').value  || '').trim();
  const plz     = (document.getElementById('fieldPlz').value     || '').trim();
  const ort     = (document.getElementById('fieldOrt').value     || '').trim();

  const strasseNr = [strasse, nummer].filter(Boolean).join(' ');
  const addrLine  = [strasseNr, plz, ort].filter(Boolean).join(', ');
  if (!addrLine || (!plz && !ort)) {
    showToast('Bitte zuerst Adresse eingeben.');
    return;
  }

  const btn = document.getElementById('calcAnfahrtBtn');
  btn.disabled = true;
  btn.textContent = '…';

  // MHP Arena Stuttgart, Mercedesstraße 87, 70372 Stuttgart
  const MHP_LAT = 48.7924;
  const MHP_LON = 9.2309;

  try {
    const geoUrl = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
      + encodeURIComponent(addrLine + ', Deutschland');
    const geoResp = await fetch(geoUrl, { headers: { 'Accept-Language': 'de' } });
    const geoData = await geoResp.json();

    if (!geoData.length) {
      showToast('Adresse nicht gefunden.');
      return;
    }

    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    const osrmUrl = 'https://router.project-osrm.org/route/v1/driving/'
      + lon + ',' + lat + ';' + MHP_LON + ',' + MHP_LAT + '?overview=false';
    const osrmResp = await fetch(osrmUrl);
    const osrmData = await osrmResp.json();

    if (osrmData.code !== 'Ok' || !osrmData.routes.length) {
      showToast('Route nicht berechenbar.');
      return;
    }

    const distKm = Math.ceil(osrmData.routes[0].distance / 1000);
    document.getElementById('fieldAnfahrtKm').value = distKm;
    showToast('Anfahrt: ' + distKm + ' km zur MHP Arena');
    saveProjects();
  } catch (e) {
    showToast('Fehler bei der Berechnung.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Auto';
  }
}

// ============================================================
//  PDF-Erstellung
// ============================================================

function generatePDF() {
  const anschrift  = collectAnschrift();
  const geruesttyp = collectGeruesttyp();
  const technik    = collectTechnik();
  const seiten     = collectSeiten();
  const logistik   = collectLogistik();
  const zusatz     = collectZusatzpositionen();

  const sonderName = document.getElementById('fieldSonderName').value.trim();
  const geruesttypLabel = geruesttyp === 'sonder'
    ? (sonderName || 'Sonder-Gerüst') : getTypeLabel(geruesttyp);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const LM  = 14;   // linker Rand
  const RM  = 196;  // rechter Rand
  const IND = 18;   // Einzug für Inhalte
  let y = 16;

  function chk(h = 8) {
    if (y + h > 272) { doc.addPage(); y = 16; }
  }

  function hline(w = 0.3) {
    chk(6);
    doc.setLineWidth(w);
    doc.line(LM, y, RM, y);
    y += 5;
  }

  function secHead(title) {
    chk(10);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(title.toUpperCase(), LM, y);
    doc.setFont(undefined, 'normal');
    y += 5;
  }

  function pdfRow(label, value) {
    chk(6);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(label, IND, y);
    if (value != null && value !== '') doc.text(String(value), RM, y, { align: 'right' });
    y += 6;
  }

  function pdfRowBold(label, value) {
    chk(7);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(label, IND, y);
    if (value != null && value !== '') doc.text(String(value), RM, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    y += 7;
  }

  // ── Kopfzeile ─────────────────────────────────────────────────
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text('Aufmaß-Bericht', LM, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(new Date().toLocaleDateString('de-DE'), RM, y, { align: 'right' });
  y += 7;

  hline(0.5);

  // Projektdaten
  const addrLine = [
    [anschrift.strasse, anschrift.nummer].filter(Boolean).join(' '),
    [anschrift.plz, anschrift.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  if (addrLine)           { doc.setFontSize(10); doc.text(addrLine, LM, y); y += 5; }
  if (anschrift.bauherr)  { doc.setFontSize(10); doc.text('Bauherr: ' + anschrift.bauherr, LM, y); y += 5; }
  if (anschrift.telefon)  { doc.setFontSize(10); doc.text('Telefon: ' + anschrift.telefon, LM, y); y += 5; }
  doc.setFontSize(10); doc.text(geruesttypLabel, LM, y); y += 5;
  if (technik.verwendungszweck.length) {
    doc.text('Verwendungszweck: ' + technik.verwendungszweck.join(', '), LM, y); y += 5;
  }
  y += 2;

  // ── Gerüstfläche ──────────────────────────────────────────────
  hline(0.4);
  secHead('Gerüstfläche');

  let totalArea = 0;
  const totals = { konsolen: {}, ig: {}, df: 0, gt: 0, ft: 0, tt: 0, ne: 0 };

  seiten.forEach((seite, idx) => {
    const name = seite.name === '__manual__' ? seite.manualName : seite.name;

    chk(10);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(name || ('Seite ' + (idx + 1)), IND, y);
    doc.setFont(undefined, 'normal');
    y += 6;

    if (seite.wandabstand != null || seite.wdvs != null) {
      const metaParts = [];
      if (seite.wandabstand != null) metaParts.push('Wandabstand ' + fmtNum(seite.wandabstand) + ' m');
      if (seite.wdvs != null)        metaParts.push('WDVS ' + fmtNum(seite.wdvs) + ' cm');
      chk(6);
      doc.setFontSize(9);
      doc.text(metaParts.join('   '), IND + 3, y);
      y += 5;
    }

    let seitenFlaeche = 0;
    let seitenLaenge  = 0;
    (seite.abschnitte || []).forEach(a => {
      const ef = a.einzelfeld || false;
      const isGiebel = a.giebel || false;
      seitenLaenge += abschnittLaenge(a);
      (a.messungen || []).forEach(m => {
        let lEff = (m.laenge || 0) + (m.laengeZuschlag > 0 ? m.laengeZuschlag : 0);
        if (ef) lEff = Math.max(lEff, 2.5);
        if (lEff <= 0) return;
        const bezStr = a.bezeichnung ? a.bezeichnung + ': ' : '';
        const efStr  = ef ? ' (EF)' : '';
        if (isGiebel) {
          const h1Eff = (m.hoehe  || 0) + (m.hoeheZuschlag  > 0 ? m.hoeheZuschlag  : 0);
          const h2Eff = (m.hoehe2 || 0) + (m.hoehe2Zuschlag > 0 ? m.hoehe2Zuschlag : 0);
          if (h2Eff < h1Eff || h1Eff < 0) return;
          const pair = round2(lEff * (h1Eff + h2Eff) / 2);
          seitenFlaeche += pair;
          chk(6);
          doc.setFontSize(9);
          doc.text(bezStr + '(H1 ' + fmtNum(h1Eff) + ' + H2 ' + fmtNum(h2Eff) + ') / 2 × ' + fmtNum(lEff) + ' m' + efStr, IND + 3, y);
          doc.text(fmtNum(pair) + ' m²', RM, y, { align: 'right' });
          y += 5;
        } else {
          const hEff = (m.hoehe || 0) + (m.hoeheZuschlag > 0 ? m.hoeheZuschlag : 0);
          if (hEff <= 0) return;
          const pair = round2(lEff * hEff);
          seitenFlaeche += pair;
          chk(6);
          doc.setFontSize(9);
          doc.text(bezStr + fmtNum(hEff) + ' m × ' + fmtNum(lEff) + ' m' + efStr, IND + 3, y);
          doc.text(fmtNum(pair) + ' m²', RM, y, { align: 'right' });
          y += 5;
        }
      });

      // Notiz zum Abschnitt
      if (a.notiz) {
        chk(6);
        doc.setFontSize(9);
        doc.setFont(undefined, 'italic');
        doc.splitTextToSize('Notiz: ' + a.notiz, RM - (IND + 3)).forEach(zeile => {
          chk(5);
          doc.text(zeile, IND + 3, y);
          y += 4.5;
        });
        doc.setFont(undefined, 'normal');
      }
    });

    if (seitenFlaeche > 0) {
      totalArea += seitenFlaeche;
      chk(6);
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.text(fmtNum(seitenFlaeche) + ' m²', RM, y, { align: 'right' });
      doc.setFont(undefined, 'normal');
      y += 5;
    }

    // Hinweis: ab 50 m Gerüstlänge ist ein Treppenturm erforderlich
    const seitenHinweis = treppenturmHinweis(round2(seitenLaenge), 'Seite');
    if (seitenHinweis) {
      chk(6);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.text('Hinweis: ' + seitenHinweis, IND + 3, y);
      doc.setFont(undefined, 'normal');
      y += 5;
    }

    // Zubehör-Totals sammeln. Konsolen werden ausschließlich nach Typ
    // zusammengefasst (unabhängig von Lage/Ebene und Seite), damit jeder
    // Konsolentyp (inkl. Dachfang-Variante von 0,50) nur einmal mit der
    // Gesamtanzahl in der Materialübersicht erscheint.
    if (Array.isArray(seite.konsolen)) {
      seite.konsolen.forEach(k => {
        if (k.laenge !== null && !isNaN(k.laenge)) {
          const key = k.typ;
          totals.konsolen[key] = (totals.konsolen[key] || 0) + effektiveLaenge(k.laenge, k.lage);
        }
      });
    }
    if (Array.isArray(seite.innengelaender)) {
      seite.innengelaender.forEach(ig => {
        if (ig.laenge !== null && !isNaN(ig.laenge)) {
          const key = ig.lage || 'alle';
          totals.ig[key] = (totals.ig[key] || 0) + effektiveLaenge(ig.laenge, ig.lage);
        }
      });
    }
    if (seite.dachfang          && seite.dachfang.laenge          != null) totals.df += seite.dachfang.laenge          || 0;
    if (seite.gittertraeger     && seite.gittertraeger.laenge     != null) totals.gt += seite.gittertraeger.laenge     || 0;
    if (seite.fussgaengertunnel && seite.fussgaengertunnel.laenge != null) totals.ft += seite.fussgaengertunnel.laenge || 0;
    if (seite.treppenturm       && seite.treppenturm.hoehe        != null) totals.tt += seite.treppenturm.hoehe        || 0;
    if (seite.netze             && seite.netze.laenge             != null) totals.ne += seite.netze.laenge             || 0;

    y += 2;
  });

  // Gesamtfläche
  chk(8);
  doc.setLineWidth(0.4);
  doc.line(LM, y, RM, y);
  y += 5;
  pdfRowBold('Gesamtfläche', fmtNum(totalArea) + ' m²');

  // ── Positionen ─────────────────────────────────────────────────
  // Konsolen: rein numerisch nach Typ sortiert, Dachfang-Variante (z. B. "50df")
  // direkt hinter der zugehörigen normalen Konsole (z. B. "50").
  const kKeys  = Object.keys(totals.konsolen).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  const igKeys = Object.keys(totals.ig).sort((a, b) => (a === 'alle' ? -1 : b === 'alle' ? 1 : Number(a) - Number(b)));
  const hasAcc = kKeys.length > 0 || igKeys.length > 0 || totals.df > 0 ||
    totals.gt > 0 || totals.ft > 0 || totals.tt > 0 || totals.ne > 0;

  if (hasAcc || zusatz.length > 0) {
    y += 1;
    hline(0.3);
    secHead('Positionen');
    kKeys.forEach(key => {
      pdfRow(konsoleTypLabel(key), fmtNum(round2(totals.konsolen[key])) + ' m');
    });
    igKeys.forEach(lage => {
      const lageStr = lageLabel(lage);
      pdfRow('Innengeländer' + (lageStr ? ' – ' + lageStr : ''), fmtNum(round2(totals.ig[lage])) + ' m');
    });
    if (totals.df > 0) pdfRow('Dachfang',        fmtNum(round2(totals.df)) + ' m');
    if (totals.gt > 0) pdfRow('Gitterträger',    fmtNum(round2(totals.gt)) + ' m');
    if (totals.ft > 0) pdfRow('Fußgängertunnel', fmtNum(round2(totals.ft)) + ' m');
    if (totals.tt > 0) pdfRow('Treppenturm',     fmtNum(round2(totals.tt)) + ' m (H)');
    if (totals.ne > 0) pdfRow('Netze',           fmtNum(round2(totals.ne)) + ' m²');
    zusatz.forEach(z => {
      const mengeStr = z.menge !== null ? fmtNum(z.menge) + ' ' + z.einheit : '–';
      const label    = (z.art || '–') + (z.notiz ? '  (' + z.notiz + ')' : '');
      pdfRow(label, mengeStr);
    });
  }

  // ── Baustelle / Logistik ──────────────────────────────────────
  const logParts = [
    logistik.anfahrtKm != null              ? ['Anfahrt',                  fmtNum(logistik.anfahrtKm) + ' km'] : null,
    logistik.untergrund                     ? ['Untergrund',               logistik.untergrund] : null,
    logistik.stellflaecheNotiz              ? ['Stellfläche',              logistik.stellflaecheNotiz] : null,
    logistik.oeffentlicherGrund             ? ['Öffentlicher Grund',       ''] : null,
    logistik.verkehrssicherung              ? ['Verkehrssicherung',        ''] : null,
    logistik.genehmigungErforderlich        ? ['Genehmigung erforderlich', ''] : null
  ].filter(Boolean);

  if (logParts.length > 0) {
    y += 1;
    hline(0.3);
    secHead('Baustelle / Logistik');
    logParts.forEach(([label, val]) => pdfRow(label, val));
  }

  // ── Transport / Laufaufwand (für die Kalkulation) ──────────────
  // Hinweis: "→" wird von der Standard-PDF-Schrift nicht unterstützt und
  // erscheint sonst als kaputte Zeichenfolge – daher hier "-" statt Pfeil.
  const transportParts = [
    logistik.transportM  != null ? ['Laufweg LKW - Objekt', fmtNum(logistik.transportM)  + ' m'] : null,
    logistik.hoehenmeter  != null ? ['Höhenmeter',           fmtNum(logistik.hoehenmeter) + ' m'] : null,
    logistik.treppen      != null ? ['Treppen / Stockwerke', String(logistik.treppen)] : null
  ].filter(Boolean);

  if (transportParts.length > 0) {
    y += 1;
    hline(0.3);
    secHead('Transport / Laufaufwand');
    transportParts.forEach(([label, val]) => pdfRow(label, val));
  }

  // ── Notizen / Allgemeine Informationen ────────────────────────
  const notizen = document.getElementById('fieldNotizen')?.value.trim() || '';
  if (notizen) {
    y += 1;
    hline(0.3);
    secHead('Notizen / Allgemeine Informationen');
    doc.setFontSize(10);
    // Absätze des Notizfeldes einzeln umbrechen, damit Zeilenumbrüche des
    // Anwenders erhalten bleiben.
    notizen.split(/\r?\n/).forEach(absatz => {
      if (absatz.trim() === '') { y += 3; return; }
      doc.splitTextToSize(absatz, RM - IND).forEach(zeile => {
        chk(6);
        doc.text(zeile, IND, y);
        y += 5;
      });
    });
  }

  const proj = getCurrentProject();
  const base = proj ? getProjectName(proj).replace(/[^a-zA-Z0-9\-_äöüÄÖÜß ]/g, '').trim() : 'Aufmaß';
  doc.save((base || 'Aufmaß') + '.pdf');
}

// ============================================================
//  JSON-Export / Import
// ============================================================

/** Exportiert ALLE Projekte + Ordner in einer Datei (Gesamt-Backup) – anders
 *  als exportJson(), das nur das gerade geöffnete Projekt sichert. Wird vom
 *  Backup-Reminder-Banner sowie optional manuell genutzt. */
function exportAllProjectsBackup() {
  const payload = { exportedAt: new Date().toISOString(), projects, folders };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'Aufmass_Backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_BACKUP_STORAGE_KEY, String(Date.now()));
  renderBackupReminder();
  showToast('Backup exportiert');
}

/** Zeigt/aktualisiert ein dezentes Hinweisbanner über der Projektübersicht,
 *  wenn länger kein Gesamt-Backup (JSON-Export aller Projekte) gemacht wurde.
 *  Rein additiv per JS erzeugt – keine Änderung an index.html/start.html nötig. */
function renderBackupReminder() {
  const host = document.getElementById('homeScreen');
  if (!host) return;
  const content = host.querySelector('main.screen-content');
  let banner = document.getElementById('backupReminderBanner');
  if (!content) return;

  const remove = () => { if (banner) banner.remove(); };

  if (projects.length === 0) return remove();

  const dismissedUntil = parseInt(localStorage.getItem(BACKUP_DISMISS_STORAGE_KEY) || '0', 10);
  if (Date.now() < dismissedUntil) return remove();

  const lastTsRaw = localStorage.getItem(LAST_BACKUP_STORAGE_KEY);
  const lastTs    = lastTsRaw ? parseInt(lastTsRaw, 10) : null;
  const days      = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : null;
  if (lastTs !== null && days < BACKUP_REMIND_AFTER_DAYS) return remove();

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'backupReminderBanner';
    banner.className = 'backup-reminder';
    content.prepend(banner);
  }
  const msg = lastTs === null
    ? 'Noch kein Backup erstellt.'
    : `Seit ${days} Tagen kein Backup.`;
  banner.innerHTML = `
    <span class="backup-reminder-text">💾 ${msg} Alle Projekte liegen nur auf diesem Gerät.</span>
    <span class="backup-reminder-actions">
      <button type="button" class="backup-reminder-export" id="backupReminderExportBtn">Jetzt exportieren</button>
      <button type="button" class="backup-reminder-dismiss" id="backupReminderDismissBtn" aria-label="Später erinnern">×</button>
    </span>`;
  banner.querySelector('#backupReminderExportBtn').addEventListener('click', exportAllProjectsBackup);
  banner.querySelector('#backupReminderDismissBtn').addEventListener('click', () => {
    localStorage.setItem(BACKUP_DISMISS_STORAGE_KEY, String(Date.now() + BACKUP_SNOOZE_DAYS * 86400000));
    banner.remove();
  });
}

function exportJson() {
  const proj = getCurrentProject();
  if (!proj) return;
  collectProjectFromForm(proj);
  saveProjects();

  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (getProjectName(proj).replace(/[^a-z0-9]/gi, '_') || 'Aufmaß') + '.json';
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
      migrateProjectMeta(data);
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

function goToOverview() {
  renderProjectOverview();
  showScreen('homeScreen');
}

function open2dViewer() {
  const proj = getCurrentProject();
  if (!proj) return;
  flushAutosave();
  localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, proj.id);
  window.location.href = 'viewer2d.html';
}

function initApp() {
  loadProjects();
  loadFolders();

  // Direkter Wiedereinstieg ins zuletzt bearbeitete Projekt (z. B. Rücksprung
  // aus dem 2D-Zeichner) – genau dort weitermachen, wo man aufgehört hat.
  const resumeId = new URLSearchParams(window.location.search).get('resume')
    ? localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY)
    : null;
  if (resumeId && projects.some(p => p.id === resumeId)) {
    openProject(resumeId);
  } else {
    renderProjectOverview();
    showScreen('homeScreen');
  }

  loadUeberstandWert();
  const ueberstandInp = document.getElementById('fieldUeberstandWert');
  if (ueberstandInp) {
    ueberstandInp.value = ueberstandWert;
    ueberstandInp.addEventListener('change', () => {
      const v = parseNum(ueberstandInp.value);
      if (isNaN(v) || v <= 0) {
        ueberstandInp.value = ueberstandWert;
        return;
      }
      setUeberstandWert(v);
      ueberstandInp.value = ueberstandWert;
    });
  }

  document.getElementById('newProjectBtn')?.addEventListener('click', createNewProject);

  // Die folgenden Elemente existieren nur auf Seiten mit eingebettetem
  // Projekt-Editor (#projectScreen, z. B. index.html). Auf reinen
  // Übersichtsseiten (z. B. start.html) fehlen sie – daher optional verknüpft,
  // ohne dass sich am bestehenden Verhalten dort etwas ändert, wo sie existieren.
  document.getElementById('backBtn')?.addEventListener('click', () => {
    flushAutosave();
    goToOverview();
  });

  document.getElementById('deleteProjectBtn')?.addEventListener('click', deleteCurrentProject);
  document.getElementById('addSideBtn')?.addEventListener('click', addSide);
  document.getElementById('addSideBtnBottom')?.addEventListener('click', addSide);
  document.getElementById('saveProjectBtn')?.addEventListener('click', saveCurrentProject);
  document.getElementById('exportPdfBtn')?.addEventListener('click', generatePDF);
  document.getElementById('calcAnfahrtBtn')?.addEventListener('click', autoCalcAnfahrt);
  document.getElementById('exportJsonBtn')?.addEventListener('click', exportJson);
  document.getElementById('importJsonBtn')?.addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput')?.addEventListener('change', handleImportFile);
  document.getElementById('open2dBtn')?.addEventListener('click', open2dViewer);

  document.getElementById('addZusatzBtn')?.addEventListener('click', () => {
    const container = document.getElementById('zusatzContainer');
    container.appendChild(createZusatzRow({}));
    refreshNoZusatzHint();
    updateSummary();
    scheduleAutosave();
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

  // Gerüsttyp-Toggle (nur innerhalb des Gerüsttyp-Auswahlblocks, nicht den
  // gleich gestylten, aber unabhängigen Status-Buttons)
  document.querySelectorAll('#geruesttypSelector .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#geruesttypSelector .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sonderNameRow').style.display =
        btn.dataset.type === 'sonder' ? '' : 'none';
    });
  });

  // Verwendungszweck: Mehrfachauswahl – jeder Chip lässt sich unabhängig
  // von den anderen ein-/ausschalten (oft mehrere Gewerke am selben Objekt).
  document.querySelectorAll('#verwendungszweckSelector .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Status-Toggle (Projekt-Status)
  document.querySelectorAll('#statusSelector .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#statusSelector .status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Automatisches Speichern: jede Eingabe/Änderung/jeder Tastendruck im
  // Projektbildschirm löst (gebündelt) einen Auto-Save aus – deckt Anschrift,
  // Technik, Logistik, Hausseiten, Positionen, Projektname & Status ab.
  const projectScreenEl = document.getElementById('projectScreen');
  if (projectScreenEl) {
    projectScreenEl.addEventListener('input',  scheduleAutosave);
    projectScreenEl.addEventListener('change', scheduleAutosave);
    projectScreenEl.addEventListener('click', e => {
      if (e.target.closest('button')) scheduleAutosave();
    });
  }

  // Projektübersicht: Suche, Status-Filter, Sortierung
  document.getElementById('searchInput')?.addEventListener('input', e => {
    overviewState.search = e.target.value;
    renderProjectOverview();
  });
  document.getElementById('statusFilterSelect')?.addEventListener('change', e => {
    overviewState.status = e.target.value;
    renderProjectOverview();
  });
  document.getElementById('sortSelect')?.addEventListener('change', e => {
    overviewState.sort = e.target.value;
    renderProjectOverview();
  });
}

document.addEventListener('DOMContentLoaded', initApp);
