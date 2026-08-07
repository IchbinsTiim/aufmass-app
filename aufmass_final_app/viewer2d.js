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

// ── Positionen pro Feld ─────────────────────────────────────────────────────
// Jedes Feld ist ein Gerüst-Feld (Länge + Höhen). Zusätzlich kann ein Feld
// mehrere Positionen besitzen (Konsole, Innengeländer, Netz, Dachfang …).
// Positionen werden in bay.positions[] gespeichert: { cat, ... }.

// Konsolentypen (Breite in m) – übernommen aus der ersten Aufmaß-App (0/19/30/50/70/109 cm).
const KONSOLE_TYPES = ['0,19', '0,30', '0,50', '0,70', '1,09'];

// Verfügbare Positions-Arten. `konsole:true` → mit Typ + Lagen, mehrfach möglich.
// `unit` = voreingestellte Mengeneinheit ('m' | 'm2' | 'stgm' | 'stk' | 'lagen');
// pro Position im Editor änderbar.
const POSITIONS = [
  { key: 'konsole',       label: 'Konsole',          short: 'K',    color: '#cc7a00', konsole: true },
  { key: 'innengelaender',label: 'Innengeländer',    short: 'IG',   color: '#2f9e44', unit: 'lagen' },
  { key: 'netz',          label: 'Netz',             short: 'Netz', color: '#5a6b7a', unit: 'm2' },
  { key: 'dachfang',      label: 'Dachfang',         short: 'DF',   color: '#b08900', unit: 'm' },
  { key: 'treppenturm',   label: 'Treppenturm',      short: 'TT',   color: '#8e44ec', unit: 'stgm' },
  { key: 'durchgang',     label: 'Tunnelrahmen',     short: 'TR',   color: '#1f5f9e', unit: 'stk' },
  { key: 'geruesttreppe', label: 'Gerüsttreppe',     short: 'GT',   color: '#4659c9', unit: 'stk' },
  { key: 'verbreiterung', label: 'Verbreiterung',    short: 'VB',   color: '#0f9b8e', unit: 'lagen' },
  { key: 'ueberbrueckung',label: 'Überbrückung',     short: 'ÜB',   color: '#a5612c', unit: 'stk' },
  { key: 'bekleidung',    label: 'Bekleidung',       short: 'BK',   color: '#a52c7e', unit: 'm' },
  { key: 'schutzdach',    label: 'Schutzdach',       short: 'SD',   color: '#c0392b', unit: 'm' },
  { key: 'aufzug',        label: 'Aufzug',           short: 'AZ',   color: '#1f5f9e', unit: 'stk' },
  { key: 'lampen',        label: 'Lampen',           short: 'LA',   color: '#b59a00', unit: 'stk' },
  { key: 'bautenschutz',  label: 'Bautenschutzmatte',short: 'BS',   color: '#7a6a2c', unit: 'm' },
  { key: 'fleece',        label: 'Fleece',           short: 'FL',   color: '#6a2ca5', unit: 'm' }
];
const POS_BY_KEY = Object.fromEntries(POSITIONS.map(p => [p.key, p]));

// Mengeneinheiten für (Nicht-Konsolen-)Positionen.
const UNIT_DEFS  = [['m', 'm'], ['m2', 'm²'], ['stgm', 'Stg. m'], ['stk', 'Stk'], ['lagen', 'Lagen']];
const UNIT_LABEL = { m: 'm', m2: 'm²', stgm: 'Stg. m', stk: 'Stk', lagen: 'Lagen' };

/** Voreingestellte Einheit einer Positionsart. */
function defaultUnit(cat) {
  const p = POS_BY_KEY[cat];
  return (p && p.unit) || 'stk';
}

/** Zahl ohne überflüssige Nullen, deutsches Dezimalkomma. */
function fmtQty(n) {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

/** Hat die Position einen vom Nutzer gesetzten Mengenwert? */
function hasOwnQty(pos) {
  return pos.qty != null && pos.qty !== '' && !isNaN(parseFloat(pos.qty));
}

/** Fläche eines Feldes (Länge × Gerüsttiefe) – generischer m²-Vorschlagswert
 *  für Positionen ohne feldspezifische Flächenformel. */
function bayArea(bayLen) {
  return bayLen != null ? +(bayLen * state.depth).toFixed(3) : null;
}

/** Gerüstfläche eines Feldes: Länge × kleinere der beiden eingetragenen Höhen
 *  (hL/hR). Ist nur eine Höhe gesetzt, wird diese verwendet; ist keine
 *  gesetzt, liefert das Feld 0 m² (fließt nicht in die Summe ein). */
function bayFlaecheM2(bay) {
  const heights = [bay.hL, bay.hR].filter(h => h != null && !isNaN(h) && h > 0);
  if (!heights.length || !bay.len) return 0;
  return bay.len * Math.min(...heights);
}

/** Vorschlagswert für Netz-m²: Länge × kleinere Höhe (wie Gerüstfläche).
 *  Ohne gesetzte Höhe gibt es keinen Vorschlag (null). */
function netzArea(bay) {
  const flaeche = bayFlaecheM2(bay);
  return flaeche > 0 ? +flaeche.toFixed(3) : null;
}

/** Gesamtgerüstfläche (m²) über alle Felder der Zeichnung. */
function computeTotalFlaeche() {
  let total = 0;
  state.sections.forEach(sec => sec.bays.forEach(bay => { total += bayFlaecheM2(bay); }));
  return +total.toFixed(2);
}

/** Aktualisiert die Live-Anzeige der Gesamtfläche im Toolbar. */
function updateAreaReadout() {
  const el = document.getElementById('areaReadout');
  if (!el) return;
  el.textContent = 'Gesamtfläche: ' + computeTotalFlaeche().toFixed(2).replace('.', ',') + ' m²';
}

/** Effektive Menge einer Position. Bei Einheit 'm' ohne eigenen Wert gilt
 *  standardmäßig die Feldlänge, bei 'm2' die Feldfläche (bei Netz: Länge ×
 *  kleinere Höhe, sonst Länge × Gerüsttiefe) – der Nutzer kann den Wert
 *  jederzeit überschreiben. */
function effQty(pos, bay) {
  if (hasOwnQty(pos)) return parseFloat(pos.qty);
  const bayLen = bay && bay.len;
  const u = pos.unit || defaultUnit(pos.cat);
  if (u === 'm'  && bayLen != null) return +bayLen;
  if (u === 'm2') return pos.cat === 'netz' ? netzArea(bay) : (bayLen != null ? bayArea(bayLen) : null);
  return null;
}

/** Lesbare Mengenangabe einer Position, z.B. "3 Lagen" / "12,5 m" / "4 Stk". */
function qtyLabel(pos, bay) {
  const v = effQty(pos, bay);
  if (v == null) return '';
  const u = pos.unit || defaultUnit(pos.cat);
  if (u === 'lagen') return v === 1 ? '1 Lage' : fmtQty(v) + ' Lagen';
  return fmtQty(v) + ' ' + (UNIT_LABEL[u] || u);
}

/** Lagen-Beschriftung: 'alle' | '1' | '2' | freie Zahl → lesbarer Text. */
function lagenLabel(lagen) {
  if (lagen == null || lagen === 'alle' || lagen === '') return 'alle Lagen';
  const n = parseInt(lagen, 10);
  if (isNaN(n)) return 'alle Lagen';
  return n === 1 ? '1 Lage' : n + ' Lagen';
}

/** Konkrete Lagen-Zahl (null bei "alle"/leer/ungültig). */
function lagenCount(lagen) {
  if (lagen == null || lagen === 'alle' || lagen === '') return null;
  const n = parseFloat(lagen);
  return isNaN(n) ? null : n;
}

/** Ist die Konsolen-Abrechnungsart einer Position "laufende Meter" (statt
 *  "pro Lage")? Fehlt das Feld (ältere Daten), gilt weiter "pro Lage". */
function isMeterBilling(pos) {
  return pos.billing === 'meter';
}

/** Errechnete laufende Meter. Konsolen "pro Lage" sowie andere Lagen-Mengen:
 *  Lagen × Feldlänge. Konsolen "in Metern": der eingetragene Meterwert, ohne
 *  eigenen Wert standardmäßig die Feldlänge. Sonst (m / Stk ohne Lagenzahl)
 *  → null. */
function posMeters(pos, bay) {
  const p = POS_BY_KEY[pos.cat];
  const bayLen = bay && bay.len;
  if (!p || !bayLen) return null;
  if (p.konsole && isMeterBilling(pos)) {
    const v = parseFloat(pos.meterValue);
    return !isNaN(v) && pos.meterValue !== '' && pos.meterValue != null ? v : bayLen;
  }
  let lagen;
  if (p.konsole) lagen = lagenCount(pos.lagen);
  else if ((pos.unit || defaultUnit(pos.cat)) === 'lagen') lagen = lagenCount(pos.qty);
  else return null;
  if (lagen == null) return null;
  return lagen * bayLen;
}

/** Vollständiger Positions-Name (für Sheet/Seitenpanel/PDF).
 *  Mit bay wird bei Lagen-Mengen die errechnete Meterzahl angehängt. */
function posTitle(pos, bay) {
  const p = POS_BY_KEY[pos.cat];
  if (!p) return '?';
  let base;
  if (p.konsole) {
    base = 'Konsole ' + (pos.typ || KONSOLE_TYPES[0]) + ' · '
      + (isMeterBilling(pos) ? 'lfd. Meter' : lagenLabel(pos.lagen));
  }
  else { const q = qtyLabel(pos, bay); base = q ? p.label + ' · ' + q : p.label; }
  const m = posMeters(pos, bay);
  if (m != null) base += ' = ' + fmtQty(m) + ' m';
  return base;
}

/** Kompakte Positions-Beschriftung für den Plan (Badge). */
function posBadge(pos, bay) {
  const p = POS_BY_KEY[pos.cat];
  if (!p) return '?';
  const m = posMeters(pos, bay);
  if (p.konsole) {
    const lg = isMeterBilling(pos) || pos.lagen == null || pos.lagen === 'alle' || pos.lagen === ''
      ? '' : '×' + (parseInt(pos.lagen, 10) || '');
    const base = 'K' + (pos.typ || '') + lg;
    return m != null ? base + ' ' + fmtQty(m) + 'm' : base;
  }
  if (m != null) return p.short + ' ' + fmtQty(m) + 'm';
  const v = effQty(pos, bay);
  if (v != null) {
    const u = pos.unit || defaultUnit(pos.cat);
    const suf = (u === 'm' || u === 'stgm') ? 'm' : (u === 'm2' ? 'm²' : '×');
    return p.short + ' ' + fmtQty(v) + suf;
  }
  return p.short;
}

/** Plausibilitätsprüfung: liefert eine Liste kurzer Warnhinweise für ein Feld
 *  (fehlende Höhe, Position ohne Menge/Lagen/Meter …). Blockiert nichts – die
 *  Hinweise sind rein informativ (siehe bayWarningBadge/Sidebar/Sheet). */
function bayWarnings(bay) {
  const warnings = [];
  if (bay.hL == null && bay.hR == null) warnings.push('Höhe fehlt');
  (bay.positions || []).forEach(pos => {
    const p = POS_BY_KEY[pos.cat];
    if (!p) return;
    if (p.konsole) {
      if (isMeterBilling(pos)) {
        // Meter-Abrechnung fällt ohne eigenen Wert automatisch auf die
        // Feldlänge zurück (siehe posMeters) – kein Hinweis nötig.
      } else if (pos.lagen == null || pos.lagen === '') {
        warnings.push('Konsole: Lagen oder Meter fehlt');
      }
    } else if (effQty(pos, bay) == null) {
      warnings.push(p.label + ': Menge fehlt');
    }
  });
  return warnings;
}

/** Gesamtzahl aller Warnhinweise über die ganze Zeichnung – für die
 *  Toolbar-Sammelanzeige. */
function computeTotalWarnings() {
  let total = 0;
  state.sections.forEach(sec => sec.bays.forEach(bay => { total += bayWarnings(bay).length; }));
  return total;
}

/** Aktualisiert die Hinweis-Sammelanzeige im Toolbar. */
function updateWarningsReadout() {
  const el = document.getElementById('warningsReadout');
  if (!el) return;
  const n = computeTotalWarnings();
  el.textContent = n ? '⚠ ' + n + ' Hinweis' + (n === 1 ? '' : 'e') : '';
  el.classList.toggle('hidden', !n);
}

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
let selectedBi     = null;   // index of currently selected bay within selectedSi (highlight + label)
let snapEnabled    = true;   // magnetic grid snapping on/off

// ── Rückgängig / Wiederholen ──────────────────────────────────────────────
// Snapshot-basiert statt pro-Aktion instrumentiert: bei jedem renderSvg()
// wird (außer während einer laufenden Zieh-/Pinch-Geste) geprüft, ob sich die
// eigentlichen Aufmaß-Daten (project/depth/sections) gegenüber dem letzten
// Snapshot geändert haben. Ein kurzes Debounce fasst schnelle Änderungsfolgen
// (z. B. Tippen in ein Zahlenfeld, Regler ziehen) zu einem Undo-Schritt
// zusammen. UI-Zustand (Auswahl, Zoom, Mehrfachauswahl) ist bewusst NICHT Teil
// des Snapshots – nur die tatsächlichen Daten sollen rückgängig machbar sein.
let undoStack              = [];
let redoStack               = [];
let lastUndoSnapshot        = null;
let undoSnapshotTimer       = null;
const UNDO_STACK_LIMIT       = 60;
const UNDO_SNAPSHOT_DEBOUNCE_MS = 600;

// Zwischenablage für "Position kopieren/einfügen": vollständige Positions-
// Konfiguration eines Feldes (Höhen + alle Kategorien/Mengen/Zuschläge), die
// per Klick auf beliebig viele andere Felder übertragen werden kann.
let copiedBayData = null;

// ── Mehrfachauswahl ──────────────────────────────────────────────────────────
// Ergänzt Kopieren/Einfügen (ganzes Feld → ein Ziel) um "eine Position auf
// viele Felder anwenden", ohne Höhen/andere Positionen der Ziel-Felder
// anzutasten – wichtig bei großen Objekten, wo z. B. ein Tunnelrahmen auf
// zehn verstreuten Feldern liegt, aber jedes Feld eigene Höhen/Konsolen hat.
let bulkMode        = false;
const bulkSelected  = new Set();   // Set von bay.id
let bulkKonsTyp     = KONSOLE_TYPES[0];
let bulkKonsLagen   = '1';
let bulkKonsBilling = 'lagen';
// Höhen, die per "Übernehmen" auf alle ausgewählten Felder übertragen werden.
let bulkHL          = null;
let bulkHR          = null;

// ── Projektverwaltung (gemeinsam mit der Aufmaß-Hauptapp) ───────────────────
// Wird der 2D-Zeichner aus einem Projekt heraus geöffnet, teilt er sich die
// Projektliste (inkl. Ordner/Status/Adresse) mit script.js/index.html: die
// Zeichnung wird direkt im Projektdatensatz gespeichert (zeichnung2d) statt
// nur als lose Datei.
const PROJECTS_STORAGE_KEY = 'aufmass_projects_v2';
const CURRENT_PROJECT_STORAGE_KEY = 'aufmass_current_project_id';
let linkedProjectId = null;
let autosave2dTimer = null;

function loadLinkedProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/** Lädt die Zeichnung des verknüpften Projekts (falls vorhanden) in `state`. */
function loadFromLinkedProject() {
  const id = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
  if (!id) return;
  const list = loadLinkedProjects();
  const proj = list.find(p => p.id === id);
  if (!proj) return;
  linkedProjectId = id;

  const projName = (proj.name && proj.name.trim()) ||
    [[proj.anschrift?.strasse, proj.anschrift?.nummer].filter(Boolean).join(' '),
     [proj.anschrift?.plz, proj.anschrift?.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  if (proj.zeichnung2d && Array.isArray(proj.zeichnung2d.sections)) {
    const z = proj.zeichnung2d;
    state.project  = projName || z.project || '';
    state.depth    = z.depth || 0.73;
    state.sections = z.sections;
    _sId = z._sId || state.sections.length;
    _bId = z._bId || state.sections.flatMap(s => s.bays).length;
  } else {
    state.project = projName || '';
  }
}

/** Schreibt die aktuelle Zeichnung (gebündelt) in das verknüpfte Projekt. */
function scheduleAutosave2d() {
  if (!linkedProjectId) return;
  if (autosave2dTimer) clearTimeout(autosave2dTimer);
  autosave2dTimer = setTimeout(() => {
    autosave2dTimer = null;
    const list = loadLinkedProjects();
    const idx = list.findIndex(p => p.id === linkedProjectId);
    if (idx < 0) return;
    list[idx].name = state.project || list[idx].name || '';
    list[idx].zeichnung2d = { depth: state.depth, sections: state.sections, _sId, _bId };
    list[idx].geaendert = new Date().toISOString().slice(0, 10);
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(list));
  }, 700);
}

// ── Projekt-Fotos ────────────────────────────────────────────────────────────
// Fotos (Baustelle, Aufbau, Details, Schäden) gehören zum Projekt, nicht zur
// Zeichnung – sie werden daher unabhängig von state.sections in IndexedDB
// gespeichert (deutlich höheres Speicherlimit als localStorage, wo die
// Projektliste selbst liegt). Jedes Projekt bekommt seine Fotos über den
// Index `projectId`; nur Foto-IDs müssten im Projekt-Datensatz verlinkt
// werden – aktuell reicht der direkte Bezug per projectId völlig aus.
const PHOTOS_DB_NAME  = 'av2d_photos_db';
const PHOTOS_STORE    = 'photos';
const PHOTO_MAX_DIM   = 1600;   // Pixel, lange Kante
const PHOTO_QUALITY   = 0.72;   // JPEG-Qualität
let _photosDbPromise  = null;

function openPhotosDB() {
  if (_photosDbPromise) return _photosDbPromise;
  _photosDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTOS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const store = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _photosDbPromise;
}

/** Verkleinert/komprimiert eine Bilddatei clientseitig (Canvas → JPEG), damit
 *  Fotos vom iPad (oft mehrere MB) nicht unnötig Speicher verbrauchen. */
function compressImageFile(file, maxDim = PHOTO_MAX_DIM, quality = PHOTO_QUALITY) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale); h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

/** Komprimiert + speichert ein Foto für ein Projekt, liefert den Datensatz. */
async function addProjectPhoto(projectId, file) {
  const { dataUrl, w, h } = await compressImageFile(file);
  const photo = {
    id: 'ph' + Date.now() + Math.floor(Math.random() * 1e6),
    projectId, dataUrl, w, h,
    createdAt: Date.now(), include: true
  };
  const db = await openPhotosDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    tx.objectStore(PHOTOS_STORE).add(photo);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
  return photo;
}

function listProjectPhotos(projectId) {
  return openPhotosDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(PHOTOS_STORE, 'readonly');
    const req = tx.objectStore(PHOTOS_STORE).index('projectId').getAll(IDBKeyRange.only(projectId));
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror   = () => reject(req.error);
  }));
}

function deleteProjectPhoto(id) {
  return openPhotosDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    tx.objectStore(PHOTOS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

function setPhotoIncluded(id, included) {
  return openPhotosDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    const req   = store.get(id);
    req.onsuccess = () => { const rec = req.result; if (rec) { rec.include = included; store.put(rec); } };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

// ── Toast ──────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toastEl');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Rückgängig / Wiederholen ────────────────────────────────────────────────

function serializeUndoState() {
  return JSON.stringify({ project: state.project, depth: state.depth, sections: state.sections });
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

/** Schließt eine ggf. noch "offene" Änderungsfolge ab (z. B. gerade eben
 *  getippte Zahl) und legt bei tatsächlicher Änderung einen Undo-Schritt an. */
function finalizeUndoSnapshot() {
  if (undoSnapshotTimer) { clearTimeout(undoSnapshotTimer); undoSnapshotTimer = null; }
  const current = serializeUndoState();
  if (lastUndoSnapshot === null) { lastUndoSnapshot = current; updateUndoRedoButtons(); return; }
  if (current === lastUndoSnapshot) return;
  undoStack.push(lastUndoSnapshot);
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  redoStack = [];
  lastUndoSnapshot = current;
  updateUndoRedoButtons();
}

/** Von renderSvg() bei (fast) jedem Aufruf angestoßen: plant einen Undo-
 *  Snapshot, sofern gerade keine Zieh-/Pinch-Geste läuft (sonst gäbe es pro
 *  Zwischenschritt einen eigenen Undo-Schritt). */
function scheduleUndoSnapshot() {
  if (drag || canvasGesture) return;
  if (undoSnapshotTimer) clearTimeout(undoSnapshotTimer);
  undoSnapshotTimer = setTimeout(finalizeUndoSnapshot, UNDO_SNAPSHOT_DEBOUNCE_MS);
}

function applyUndoState(json) {
  const data = JSON.parse(json);
  state.project  = data.project;
  state.depth    = data.depth;
  state.sections = data.sections;
  selectedSi = null; selectedBi = null;
  bulkSelected.clear();
  const nameInp  = document.getElementById('projectName');
  const depthInp = document.getElementById('scaffDepth');
  if (nameInp)  nameInp.value  = state.project;
  if (depthInp) depthInp.value = state.depth;
  lastUndoSnapshot = json;
  renderAll();
  updateUndoRedoButtons();
}

function performUndo() {
  finalizeUndoSnapshot();   // eine gerade noch laufende Änderung zuerst sichern
  if (!undoStack.length) return;
  redoStack.push(lastUndoSnapshot);
  applyUndoState(undoStack.pop());
  showToast('Rückgängig gemacht');
}

function performRedo() {
  if (!redoStack.length) return;
  undoStack.push(lastUndoSnapshot);
  applyUndoState(redoStack.pop());
  showToast('Wiederholt');
}

// ── Schütteln zum Rückgängigmachen (iOS: Bewegungssensor-Freigabe nötig) ───

let shakeUndoEnabled = false;
let lastShakeAccel   = null;
let lastShakeTime    = 0;
const SHAKE_THRESHOLD_MS = 1200;
const SHAKE_THRESHOLD_ACC = 26;

function handleDeviceMotionForShake(e) {
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc || acc.x == null) return;
  if (lastShakeAccel) {
    const delta = Math.abs(acc.x - lastShakeAccel.x) + Math.abs(acc.y - lastShakeAccel.y) + Math.abs(acc.z - lastShakeAccel.z);
    const now = Date.now();
    if (delta > SHAKE_THRESHOLD_ACC && now - lastShakeTime > SHAKE_THRESHOLD_MS) {
      lastShakeTime = now;
      performUndo();
    }
  }
  lastShakeAccel = acc;
}

function updateShakeBtn() {
  const btn = document.getElementById('shakeUndoBtn');
  if (!btn) return;
  btn.classList.toggle('active', shakeUndoEnabled);
  btn.title = shakeUndoEnabled
    ? 'Schütteln zum Rückgängigmachen: An (zum Ausschalten tippen)'
    : 'Schütteln zum Rückgängigmachen aktivieren';
}

function toggleShakeUndo() {
  if (shakeUndoEnabled) {
    shakeUndoEnabled = false;
    window.removeEventListener('devicemotion', handleDeviceMotionForShake);
    updateShakeBtn();
    showToast('Schütteln zum Rückgängigmachen deaktiviert');
    return;
  }
  const start = () => {
    shakeUndoEnabled = true;
    lastShakeAccel = null;
    window.addEventListener('devicemotion', handleDeviceMotionForShake);
    updateShakeBtn();
    showToast('Schütteln zum Rückgängigmachen aktiviert');
  };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS 13+: Zugriff auf Bewegungssensoren muss explizit per Nutzer-Geste angefragt werden.
    DeviceMotionEvent.requestPermission().then(res => {
      if (res === 'granted') start();
      else showToast('Zugriff auf Bewegungssensor abgelehnt');
    }).catch(() => showToast('Bewegungssensor nicht verfügbar'));
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    start();
  } else {
    showToast('Schütteln wird auf diesem Gerät nicht unterstützt');
  }
}

/** Kopiert Höhen + alle Positionen (Konsolen, Innengeländer, Netze, Dachfang
 *  usw. inkl. ihrer Mengen/Zuschläge) eines Feldes in die Zwischenablage. */
function copyBayPositions(bay) {
  copiedBayData = {
    hL: bay.hL,
    hR: bay.hR,
    positions: JSON.parse(JSON.stringify(bay.positions || []))
  };
  showToast('Position kopiert – bei anderen Feldern „Einfügen" antippen');
  renderSections();
}

/** Überträgt die kopierte Positions-Konfiguration auf ein anderes Feld. */
function pasteBayPositions(bay) {
  if (!copiedBayData) return;
  bay.hL = copiedBayData.hL;
  bay.hR = copiedBayData.hR;
  bay.positions = copiedBayData.positions.map(p => ({ ...p, id: ++_bId }));
  showToast('Position eingefügt');
}

// ── Favoriten / Vorlagen ─────────────────────────────────────────────────────
// Häufig verwendete Feld-Konfigurationen (Höhen + alle Positionen: Konsolen,
// Netz, Dachfang, Treppenturm …) unter einem Namen dauerhaft sichern und per
// Klick auf ein oder mehrere Felder anwenden – projektübergreifend in
// localStorage, unabhängig vom flüchtigen Kopieren/Einfügen.
const FAV_STORAGE_KEY = 'av_2d_favorites_v1';

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_STORAGE_KEY)) || []; }
  catch (_) { return []; }
}

function saveFavoritesList(list) {
  localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(list));
}

/** Sichert Höhen + Positionen eines Feldes als neue, benannte Vorlage. */
function saveFavoriteFromBay(bay) {
  const name = prompt('Name für diese Vorlage (z. B. "Standardfassade", "Dachfang", "Treppenturm"):');
  if (!name || !name.trim()) return;
  const list = loadFavorites();
  list.push({
    id: 'fav' + Date.now() + Math.floor(Math.random() * 1000),
    name: name.trim(),
    data: {
      hL: bay.hL, hR: bay.hR,
      positions: JSON.parse(JSON.stringify(bay.positions || []))
    }
  });
  saveFavoritesList(list);
  showToast('Vorlage „' + name.trim() + '" gespeichert');
}

/** Wendet eine gespeicherte Vorlage auf ein Feld an (überschreibt dessen
 *  Höhen + Positionen komplett, wie Einfügen). */
function applyFavoriteToBay(fav, bay) {
  bay.hL = fav.data.hL != null ? fav.data.hL : null;
  bay.hR = fav.data.hR != null ? fav.data.hR : null;
  bay.positions = fav.data.positions.map(p => ({ ...p, id: ++_bId }));
}

function deleteFavorite(id) {
  saveFavoritesList(loadFavorites().filter(f => f.id !== id));
}

/* ── Zeichenfläche: Kamera / Viewport ────────────────────────────────────────
   Die Ansicht wird durch eine ABSOLUTE Kamera in Weltkoordinaten beschrieben:
     cx/cy  = Weltpunkt, der in der Mitte des Panels liegt
     scale  = Bildschirm-Pixel je Welt-Pixel (Welt: 100 px = 1 m)
   Der sichtbare Ausschnitt (viewBox) folgt allein aus Kamera + Panelgröße und
   NICHT mehr aus der Bounding-Box des Inhalts. Dadurch ist das Zoom-/Pan-
   Verhalten exakt gleich, ob 5 oder 50 Felder gezeichnet sind: ein Pinch um
   den Faktor 2 zoomt immer um Faktor 2, ein Wisch um 100 px verschiebt immer
   um 100 px. Neue Felder verändern die Kamera nicht mehr.
   `autoFit` hält die Standardansicht (alles sichtbar) nach, solange der Nutzer
   nicht selbst gezoomt/verschoben hat. */
let camera  = { cx: 200, cy: 150, scale: 1 };
let autoFit = true;
const CAM_MIN_SCALE = 0.010;   // ganz herausgezoomt: 1 m ≈ 1 Bildschirm-px
const CAM_MAX_SCALE = 4;       // ganz hereingezoomt: 1 m ≈ 400 Bildschirm-px
const CAM_FIT_MARGIN = 0.88;   // Luft rund um den Inhalt bei „alles anzeigen“

/* Kamera-Rechnungen laufen bei jedem Zoom-/Pan-Frame. Panelgröße und
   Inhalts-Bounding-Box ändern sich dabei NICHT – beide werden deshalb
   zwischengespeichert und nur bei Größen- bzw. Geometrieänderung verworfen.
   Ohne den Cache würde jeder Zoomschritt ein Layout des Browsers erzwingen und
   alle Felder durchlaufen; das war der Grund, weshalb sich Zoomen bei vielen
   Feldern zäh anfühlte. */
let _vpCache     = null;
let _boundsCache = null;
function invalidateViewCaches() { _vpCache = null; _boundsCache = null; }

/** Größe/Position des Zeichenpanels in Bildschirmpixeln. */
function viewportRect() {
  if (_vpCache) return _vpCache;
  const svg = document.getElementById('planSvg');
  const r   = svg.getBoundingClientRect();
  return (_vpCache = { left: r.left, top: r.top, w: r.width || 800, h: r.height || 600 });
}

/** Bounding-Box aller gezeichneten Felder in Weltkoordinaten (null = leer). */
function contentBounds() {
  if (_boundsCache !== null) return _boundsCache.box;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.sections.forEach(sec => {
    if (!sec.bays.length) return;
    sectionBayPolys(sec, sec.x0, sec.y0).forEach(poly => poly.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }));
  });
  const box = isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
  _boundsCache = { box };
  return box;
}

function clampScale(s) {
  return Math.min(CAM_MAX_SCALE, Math.max(CAM_MIN_SCALE, s));
}

/** Setzt die Kamera so, dass der gesamte Inhalt zentriert sichtbar ist. */
function fitCameraToContent() {
  const vp = viewportRect();
  const b  = contentBounds();
  if (!b) {
    camera.cx = 0; camera.cy = 0;
    camera.scale = clampScale(Math.min(vp.w / 800, vp.h / 600));
    return;
  }
  camera.cx = b.minX + b.w / 2;
  camera.cy = b.minY + b.h / 2;
  const sx = vp.w / Math.max(b.w, 1);
  const sy = vp.h / Math.max(b.h, 1);
  camera.scale = clampScale(Math.min(sx, sy) * CAM_FIT_MARGIN);
}

/** Hält den Kameramittelpunkt in Reichweite des Inhalts (kein „Verlaufen“). */
function clampCamera() {
  camera.scale = clampScale(camera.scale);
  const b = contentBounds();
  if (!b) return;
  const vp     = viewportRect();
  const halfW  = vp.w / camera.scale / 2;
  const halfH  = vp.h / camera.scale / 2;
  camera.cx = Math.max(b.minX - halfW, Math.min(b.maxX + halfW, camera.cx));
  camera.cy = Math.max(b.minY - halfH, Math.min(b.maxY + halfH, camera.cy));
}

/** Schreibt die Kamera in die viewBox des SVG (+ Rasterhintergrund). */
function applyCamera() {
  const svg = document.getElementById('planSvg');
  const vp  = viewportRect();
  const vw  = vp.w / camera.scale;
  const vh  = vp.h / camera.scale;
  const x   = camera.cx - vw / 2;
  const y   = camera.cy - vh / 2;
  svg.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
  const gbg = document.getElementById('gridBg');
  if (gbg) {
    gbg.setAttribute('x', x);      gbg.setAttribute('y', y);
    gbg.setAttribute('width', vw); gbg.setAttribute('height', vh);
  }
}

/** Bildschirm- → Weltkoordinaten (direkt aus der Kamera, ohne DOM-Umweg). */
function clientToWorld(clientX, clientY) {
  const vp = viewportRect();
  return {
    x: camera.cx + (clientX - vp.left - vp.w / 2) / camera.scale,
    y: camera.cy + (clientY - vp.top  - vp.h / 2) / camera.scale
  };
}

/** Zoomt um `factor` und hält dabei den Weltpunkt unter (clientX,clientY) fest. */
function zoomAt(clientX, clientY, factor) {
  const before = clientToWorld(clientX, clientY);
  const next   = clampScale(camera.scale * factor);
  if (next === camera.scale) return;
  camera.scale = next;
  const after  = clientToWorld(clientX, clientY);
  camera.cx += before.x - after.x;
  camera.cy += before.y - after.y;
  autoFit = false;
  clampCamera();
}

// Aktive Zeigerpunkte (Finger) auf der Zeichenfläche, für Pan/Pinch.
const canvasPointers = new Map();   // pointerId → { x, y } (Client-Koordinaten)
let canvasGesture     = null;       // { mode:'pan'|'pinch', ... } – siehe beginCanvasGesture()
let canvasJustMoved   = false;      // unterdrückt den Tap/Klick direkt nach einem Pan/Pinch

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  // Gerüst-Grundfeld: Länge + Höhe links/rechts (hL/hR). Zusätzliche Positionen
  // (Konsole, Netz, …) liegen in positions[].
  return {
    id: ++_bId, len: +parseFloat(len).toFixed(2),
    hL: null, hR: null,
    positions: [], note: ''
  };
}

/** Stellt sicher, dass ein (auch geladenes/älteres) Bay ein positions[] und
 *  note besitzt und migriert die alte Einzel-Kategorie in eine Position. */
function normalizeBay(bay) {
  if (!Array.isArray(bay.positions)) bay.positions = [];
  if (typeof bay.note !== 'string') bay.note = '';
  // Migration: früheres Einzel-Kategorie-Modell → Position
  if (bay.category && bay.category !== 'geruest' && POS_BY_KEY[bay.category]) {
    const pos = { id: ++_bId, cat: bay.category };
    if (bay.category === 'konsole') {
      pos.typ = KONSOLE_TYPES[0];
      pos.lagen = '1';
    }
    bay.positions.push(pos);
  }
  delete bay.category; delete bay.breite; delete bay.flaeche; delete bay.anzahl;
  return bay;
}

function mkSection(dir = 'S', x0 = 0, y0 = 0) {
  const id = ++_sId;
  return { id, name: `A${id}`, dir, angle: DIR_TO_ANGLE[dir] ?? 90, bays: [], x0, y0 };
}

/** Eindeutige, gut lesbare Feldbezeichnung (z. B. "A1", "Ost 3") – basiert auf
 *  dem (frei editierbaren) Sektionsnamen. Eine Sektion hat in der Praxis genau
 *  ein Feld; besitzt sie ausnahmsweise mehrere (ältere Daten), wird die
 *  Feldnummer angehängt, damit jedes Feld weiter eindeutig benennbar bleibt. */
function bayLabel(sec, bi) {
  const base = (sec && sec.name && sec.name.trim()) || `S${sec ? sec.id : '?'}`;
  return sec && sec.bays.length > 1 ? `${base}.${bi + 1}` : base;
}

// ── Geometry helpers ───────────────────────────────────────────────────────

/** Senkrechte Auswärtsrichtung zur Laufrichtung `dir`. Gespiegelte Sektionen
 *  (sec.flip) haben umgekehrte Händigkeit – ohne `flip` würde ihre Gerüsttiefe
 *  auf die falsche (Gebäude-Innen-)Seite zeigen, siehe mirrorSections(). */
function outVec(dir, flip) {
  return flip ? { dx: -dir.dy, dy: dir.dx } : { dx: dir.dy, dy: -dir.dx };
}

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
   • Felder dürfen sich bewusst überlappen (z. B. für komplexe Grundrisse);
     das Andocken selbst wird dadurch nicht verhindert.
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
  return 1 / camera.scale;
}

/** Die vier Eck-Polygone aller Felder einer Sektion an Position (x0,y0). */
function sectionBayPolys(sec, x0, y0) {
  const dir   = secVec(sec);
  const out   = outVec(dir, sec.flip);
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

/**
 * Beste Andockposition für die gezogene Sektion.
 * Prüft alle (Quell-Ecke → Ziel-Ecke)-Paare, sortiert nach Nähe und nimmt
 * das nächstgelegene Paar → eindeutiges, pixelgenaues Einrasten an genau
 * einer Position. Ob das Feld dabei ein anderes überlappt, spielt für das
 * Andocken keine Rolle – Überlappungen sind eine bewusste Nutzerentscheidung.
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
  if (!cands.length) return null;
  cands.sort((p, q) => p.d2 - q.d2);
  return { x0: cands[0].x0, y0: cands[0].y0, anchor: cands[0].anchor };
}

/** Rohposition aufs 0,25-m-Grundraster runden (sanfte Ausrichtung). */
function gridSnapPos(x, y) {
  const g = SNAP_STEP * PX_PER_M;
  return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
}

function screenToSvg(clientX, clientY) {
  return clientToWorld(clientX, clientY);
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

// ── Wand-Erkennung & Spiegeln ────────────────────────────────────────────────
// Eine "Wand" ist hier eine Kette direkt aneinanderhängender Felder mit
// gleichem Winkel (das Ende des einen ist der Start des nächsten) – genau wie
// die Vorlagen (L-/U-Form/Rechteck) sie erzeugen. Nützlich, um bei
// symmetrischen Gebäuden die gegenüberliegende Wand nicht Feld für Feld neu
// aufbauen zu müssen.

/** Indizes aller Felder derselben Wand wie state.sections[si], in Reihenfolge. */
function findWallChain(si) {
  const sections = state.sections;
  const start = sections[si];
  if (!start) return [si];
  const ang = secAngle(start);
  const sameAngle = a => Math.abs(normDeg(a) - normDeg(ang)) < 0.5;
  const samePoint = (x1, y1, x2, y2) => Math.abs(x1 - x2) < 2 && Math.abs(y1 - y2) < 2;

  const chain = [si];
  let changed = true;
  while (changed) {
    changed = false;
    const last = sections[chain[chain.length - 1]];
    const end = sectionEnd(last);
    const idx = sections.findIndex((s, i) =>
      !chain.includes(i) && sameAngle(secAngle(s)) && samePoint(s.x0, s.y0, end.x, end.y));
    if (idx >= 0) { chain.push(idx); changed = true; }
  }
  changed = true;
  while (changed) {
    changed = false;
    const first = sections[chain[0]];
    const idx = sections.findIndex((s, i) => {
      if (chain.includes(i) || !sameAngle(secAngle(s))) return false;
      const e = sectionEnd(s);
      return samePoint(e.x, e.y, first.x0, first.y0);
    });
    if (idx >= 0) { chain.unshift(idx); changed = true; }
  }
  return chain;
}

/** Bounding-Box-Mittelpunkt der gesamten aktuellen Zeichnung – gemeinsamer
 *  Spiegel-Pivot für alle Mirror-Operationen (Achse verläuft durch diesen
 *  Punkt, senkrecht bzw. waagerecht). */
function drawingCenter() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.sections.forEach(sec => {
    const e = sectionEnd(sec);
    [[sec.x0, sec.y0], [e.x, e.y]].forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
  });
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Spiegelt beliebige Sektionen (per Index) an einer waagerechten oder
 *  senkrechten Achse durch den Mittelpunkt der gesamten Zeichnung und fügt sie
 *  als neue Kopien hinzu. `axis: 'v'` spiegelt an einer SENKRECHTEN Achse
 *  (Feld wandert links↔rechts), `axis: 'h'` an einer WAAGERECHTEN Achse
 *  (Feld wandert oben↔unten). Alle Eigenschaften (Höhen, Positionen, Konsolen,
 *  Netze, Dachfang, Treppenturm, Notizen …) werden 1:1 übernommen – eine echte
 *  Achsenspiegelung kehrt die Händigkeit um, daher wird `flip` gegenüber dem
 *  Original umgeschaltet, damit die Gerüsttiefe weiter auf der richtigen
 *  (Gebäude-Außen-)Seite liegt, siehe outVec(). */
function mirrorSections(sectionIndices, axis) {
  if (!sectionIndices || !sectionIndices.length) return;
  const { cx, cy } = drawingCenter();

  const mirrored = sectionIndices.map(i => {
    const sec = state.sections[i];
    const copy = JSON.parse(JSON.stringify(sec));
    copy.id = ++_sId;
    copy.name = (sec.name || '').trim() ? `${sec.name} (Spiegel)` : `Wand ${copy.id}`;
    if (axis === 'v') {
      copy.x0 = 2 * cx - sec.x0;
      copy.angle = normDeg(180 - secAngle(sec));
    } else {
      copy.y0 = 2 * cy - sec.y0;
      copy.angle = normDeg(360 - secAngle(sec));
    }
    copy.dir  = nearestCardinal(copy.angle);
    copy.flip = !sec.flip;
    copy.bays = sec.bays.map(b => {
      const nb = JSON.parse(JSON.stringify(b));
      nb.id = ++_bId;
      nb.positions = (nb.positions || []).map(p => ({ ...p, id: ++_bId }));
      return nb;
    });
    return copy;
  });

  state.sections.push(...mirrored);
  selectedSi = state.sections.length - mirrored.length;
  selectedBi = 0;
  return mirrored;
}

/** Spiegelt die ganze Wand (Kette direkt verbundener, gleich ausgerichteter
 *  Felder), zu der `si` gehört – z. B. aus dem Bearbeiten-Sheet eines Feldes. */
function mirrorWallAt(si, axis) {
  const chainIdx = findWallChain(si);
  const mirrored = mirrorSections(chainIdx, axis);
  if (!mirrored) return;
  renderAll();
  const axisTxt = axis === 'v' ? 'horizontal' : 'vertikal';
  showToast(mirrored.length === 1 ? `Feld ${axisTxt} gespiegelt` : `Wand ${axisTxt} gespiegelt (${mirrored.length} Felder)`);
}

/** Spiegelt eine frei zusammengestellte Auswahl von Feldern (bay-IDs, z. B.
 *  aus der Mehrfachauswahl-Leiste) – unabhängig davon, ob sie zusammenhängen. */
function mirrorBaySelection(bayIds, axis) {
  const sectionIndices = [];
  state.sections.forEach((sec, si) => {
    if (sec.bays.some(b => bayIds.has(b.id))) sectionIndices.push(si);
  });
  const mirrored = mirrorSections(sectionIndices, axis);
  if (!mirrored) return;
  renderAll();
  const axisTxt = axis === 'v' ? 'horizontal' : 'vertikal';
  showToast(`Auswahl ${axisTxt} gespiegelt (${mirrored.length} Feld${mirrored.length === 1 ? '' : 'er'})`);
}

// ── Layout computation ─────────────────────────────────────────────────────

function computeLayout() {
  const depth  = state.depth * PX_PER_M;
  const els    = [];

  state.sections.forEach((sec, si) => {
    const dir    = secVec(sec);
    const out    = outVec(dir, sec.flip);
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
    const out = outVec(secVec(sec), sec.flip);
    state.sections.forEach((next, ni) => {
      if (ni === si) return;
      if (Math.abs(next.x0 - end.x) < 2 && Math.abs(next.y0 - end.y) < 2) {
        const nOut  = outVec(secVec(next), next.flip);
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
  invalidateViewCaches();
  updateAreaReadout();
  updateWarningsReadout();
  scheduleAutosave2d();
  scheduleUndoSnapshot();

  const hasBays = state.sections.some(s => s.bays.length > 0);
  if (!hasBays) {
    autoFit = true;
    fitCameraToContent();
    applyCamera();
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');

  const depth = state.depth * PX_PER_M;
  const els   = computeLayout();

  // Kamera: solange der Nutzer nicht selbst gezoomt/verschoben hat, folgt die
  // Ansicht automatisch dem Inhalt. Sobald er zoomt, bleibt die Kamera stehen –
  // neue Felder verschieben oder skalieren die Ansicht dann nicht mehr.
  if (autoFit) fitCameraToContent();
  else clampCamera();
  applyCamera();

  const bayFontSize  = Math.max(depth * 0.38, 9);
  // Bedienelemente (Griffe, +-Punkte, Maßstabsbalken) werden in BILDSCHIRM-
  // Pixeln bemessen: `hs(px)` rechnet Bildschirm-px in Welt-px um. So bleiben
  // sie bei 50 Feldern (weit herausgezoomt) genauso gut treffbar wie bei 5.
  const hs = px => px / camera.scale;

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
    normalizeBay(bayData);
    const positions  = bayData.positions || [];
    const isSelected     = el.si === selectedSi && el.bi === selectedBi;
    const isBulkSelected = bulkMode && bulkSelected.has(bayData.id);
    const poly = svgEl('polygon', {
      points: ptsStr(el.pts),
      fill: isBulkSelected ? '#6a4bd1' : (isSelected ? '#8ec4f5' : '#deeeff'),
      'fill-opacity': isBulkSelected ? 0.30 : 1,
      stroke: isBulkSelected ? '#6a4bd1' : (isSelected ? '#0a2f58' : '#2c6fa8'),
      'stroke-width': (isSelected || isBulkSelected) ? 4 : 2,
      style: isSelected ? 'filter:drop-shadow(0 0 6px rgba(0,122,255,0.75))' : '',
      cursor: 'pointer'
    });
    poly.addEventListener('click', ev => {
      ev.stopPropagation();
      if (canvasJustMoved) { canvasJustMoved = false; return; }   // Tap direkt nach Pan/Pinch → kein Öffnen
      selectedSi = el.si;
      selectedBi = el.bi;
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

    // Feldbezeichnung (z. B. "A1") – als kleines Kästchen in der Feld-Ecke.
    // Färbt sich je nach Auswahlzustand ein, damit klar ist, WELCHES Feld
    // gerade ausgewählt bzw. in der Mehrfachauswahl markiert ist.
    {
      const fieldLabel = bayLabel(state.sections[el.si], el.bi);
      const cornerFont = Math.max(depth * 0.24, 9);
      const padX       = cornerFont * 0.45;
      const boxH       = cornerFont * 1.4;
      let   labelFont  = cornerFont;
      let   boxW       = fieldLabel.length * labelFont * 0.62 + padX * 2;
      const maxBoxW    = el.len * PX_PER_M * 0.55;
      if (boxW > maxBoxW) { labelFont *= maxBoxW / boxW; boxW = maxBoxW; }
      const cornerPad  = Math.max(depth * 0.08, 3);
      const bbMinX     = Math.min(p0.x, p1.x, p2.x, p3.x);
      const bbMinY     = Math.min(p0.y, p1.y, p2.y, p3.y);
      const boxX = bbMinX + cornerPad, boxY = bbMinY + cornerPad;
      const boxCx = boxX + boxW / 2, boxCy = boxY + boxH / 2;
      const boxBg  = isBulkSelected ? '#6a4bd1' : (isSelected ? '#007aff' : '#0a2f58');
      const boxRot = labelRot ? `rotate(${labelRot.toFixed(1)},${boxCx},${boxCy})` : '';
      g.appendChild(svgEl('rect', {
        x: boxX, y: boxY, width: boxW, height: boxH,
        rx: boxH * 0.25, fill: boxBg, transform: boxRot, 'pointer-events': 'none'
      }));
      const nameTxt = svgEl('text', {
        x: boxCx, y: boxCy,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': labelFont, 'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '800',
        transform: boxRot,
        'pointer-events': 'none'
      });
      nameTxt.textContent = fieldLabel;
      g.appendChild(nameTxt);

      // Notiz-/Hinweis-Icons neben dem Namenskästchen – auf einen Blick
      // erkennbar, ohne das Sheet öffnen zu müssen.
      let markerX = boxX + boxW + boxH * 0.15;
      const markerFont = boxH * 0.85;
      const addMarker = (glyph, title) => {
        const mx = markerX + markerFont * 0.55, my = boxCy;
        const rot = labelRot ? `rotate(${labelRot.toFixed(1)},${mx},${my})` : '';
        const t = svgEl('text', {
          x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': markerFont, transform: rot, 'pointer-events': 'none'
        });
        t.textContent = glyph;
        if (title) { const titleEl = svgEl('title', {}); titleEl.textContent = title; t.appendChild(titleEl); }
        g.appendChild(t);
        markerX += markerFont * 1.1;
      };
      if ((bayData.note || '').trim()) addMarker('📝', bayData.note.trim());
      const warns = bayWarnings(bayData);
      if (warns.length) addMarker('⚠️', warns.join(' · '));
    }

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

    // Höhen an den beiden Enden der Unterkante. Zuordnung nach Bildschirm-Lage:
    // hL ("Höhe links") landet immer am visuell linken (bzw. oberen) Ende,
    // hR am rechten/unteren – unabhängig von Feldrichtung/-drehung.
    const hFont = Math.max(depth * 0.24, 7);
    const hEndA = hPos(0.12), hEndB = hPos(0.88);
    let hLeftPos, hRightPos;
    if (Math.abs(hEndB.x - hEndA.x) >= Math.abs(hEndB.y - hEndA.y)) {
      [hLeftPos, hRightPos] = hEndA.x <= hEndB.x ? [hEndA, hEndB] : [hEndB, hEndA];
    } else {
      [hLeftPos, hRightPos] = hEndA.y <= hEndB.y ? [hEndA, hEndB] : [hEndB, hEndA];
    }
    if (bayData.hL != null) drawEdge(hLeftPos,  '↥ ' + bayData.hL.toFixed(2), '#1f7a3d', hFont);
    if (bayData.hR != null) drawEdge(hRightPos, '↥ ' + bayData.hR.toFixed(2), '#1f7a3d', hFont);

    // Positions-Badges – je Position eine eigene Zeile als Pille, gestapelt
    // außerhalb der Außenkante (offene Seite, weg von der Wand). So bleibt der
    // Feldinnenraum frei für Länge + Höhen und es bleibt auch bei vielen
    // Positionen + Höhenangabe übersichtlich.
    if (positions.length) {
      const badgeFont = Math.max(depth * 0.22, 7);
      const lineH     = badgeFont * 1.45;
      const startDist = depth * 0.5 + lineH * 0.85;   // knapp außerhalb der Außenkante
      const maxBadgeW = el.len * PX_PER_M * 0.96;      // Badge nie breiter als das Feld
      positions.forEach((pos, i) => {
        const d  = startDist + i * lineH;
        const px = ecx + outx * d;
        const py = ecy + outy * d;
        const p  = POS_BY_KEY[pos.cat];
        const label = posBadge(pos, bayData);
        const col   = (p && p.color) || '#333';
        // Lange Labels (z. B. Konsolen „K0,30×2 5,14m") werden so weit
        // verkleinert, dass die Pille innerhalb der Feldbreite bleibt und nicht
        // in Nachbarfelder ragt.
        let font = badgeFont;
        let w = label.length * font * 0.6 + font * 0.9;
        if (w > maxBadgeW) { font *= maxBadgeW / w; w = maxBadgeW; }
        const rot = labelRot ? `rotate(${labelRot.toFixed(1)},${px},${py})` : '';
        g.appendChild(svgEl('rect', {
          x: px - w / 2, y: py - lineH / 2, width: w, height: lineH * 0.92,
          rx: lineH * 0.3, fill: '#ffffff', 'fill-opacity': '0.9',
          stroke: col, 'stroke-width': '0.6', transform: rot, 'pointer-events': 'none'
        }));
        const t = svgEl('text', {
          x: px, y: py, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': font, 'font-family': 'system-ui, sans-serif',
          'font-weight': '700', fill: col, 'pointer-events': 'none', transform: rot
        });
        t.textContent = label;
        g.appendChild(t);
      });
    }
  });

  // 3. Wall lines (schlanke Wandkante – zeigt die Gebäudeseite an)
  els.filter(e => e.type === 'wallLine').forEach(el =>
    g.appendChild(svgEl('line', {
      x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
      stroke: '#5a6b7a', 'stroke-width': 1.5, 'stroke-linecap': 'round'
    }))
  );

  // 5b. Move handles (orange ✥)
  {
    const MOVE_R = hs(HANDLE_R * 1.25);
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
        stroke: '#fff', 'stroke-width': hs(2.5), 'pointer-events': 'none'
      }));

      const sym = svgEl('text', {
        x: el.x, y: el.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': MOVE_R * 1.1,
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      sym.textContent = '✥';
      g.appendChild(sym);
    });

    // Rotation handles (purple ↻) — nur für die ausgewählte Sektion
    const ROT_R     = hs(HANDLE_R * 0.85);
    const movingNow0 = drag && (drag.type === 'move' || drag.type === 'resize');
    els.filter(e => e.type === 'rotateHandle' && e.si === selectedSi && !movingNow0).forEach(el => {
      const isActive = drag && drag.type === 'rotate' && drag.si === el.si;

      // Verbindungslinie vom Sektionsende zum Drehgriff
      const sec = state.sections[el.si];
      const end = sectionEnd(sec);
      g.appendChild(svgEl('line', {
        x1: end.x, y1: end.y, x2: el.x, y2: el.y,
        stroke: '#8e44ec', 'stroke-width': hs(2), 'stroke-dasharray': `${hs(4)} ${hs(4)}`,
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
        stroke: '#fff', 'stroke-width': hs(2.5), 'pointer-events': 'none'
      }));

      const sym = svgEl('text', {
        x: el.x, y: el.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': ROT_R * 1.15,
        'font-family': 'system-ui, sans-serif',
        fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
      });
      sym.textContent = '↻';
      g.appendChild(sym);

      // Winkel-Tooltip während des Drehens
      if (isActive) {
        const deg = Math.round(secAngle(sec));
        const bx = el.x, by = el.y - ROT_R * 2.6;
        g.appendChild(svgEl('rect', { x: bx - hs(30), y: by - hs(14), width: hs(60), height: hs(28), rx: hs(7), fill: '#6c2bd9', 'pointer-events': 'none' }));
        const bt = svgEl('text', { x: bx, y: by, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': hs(14), 'font-family': 'system-ui, sans-serif', fill: '#fff', 'font-weight': '700', 'pointer-events': 'none' });
        bt.textContent = deg + '°';
        g.appendChild(bt);
      }
    });
  }

  // 5. Blaue Schnell-Hinzufügen-Buttons (links / rechts) am ausgewählten Feld.
  //    Ein Klick fügt sofort ein weiteres Feld (Standard 2,57 m) in dieselbe
  //    Laufrichtung an – ohne Dialog. Ersetzt die früheren blauen Zieh-Griffe.
  const busyAdd = drag && (drag.type === 'move' || drag.type === 'rotate' || drag.type === 'resize');
  const selSec  = selectedSi !== null ? state.sections[selectedSi] : null;
  if (selSec && selSec.bays.length && !busyAdd) {
    const dir = secVec(selSec);
    const out = outVec(dir, selSec.flip);
    const end = sectionEnd(selSec);
    const EXT_R = hs(HANDLE_R * 1.05);
    const axOff = EXT_R * 1.7;
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
        fill: '#007aff', stroke: '#fff', 'stroke-width': hs(2.5), 'pointer-events': 'none'
      }));

      const plus = svgEl('text', {
        x: pt.x, y: pt.y,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': EXT_R * 1.25,
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

  // 8. Maßstabsbalken (aus der aktuellen Kamera abgeleitet)
  const camVp = viewportRect();
  drawScaleBar(g,
    camera.cx - camVp.w / camera.scale / 2,
    camera.cy - camVp.h / camera.scale / 2,
    camVp.w / camera.scale, camVp.h / camera.scale,
    hs(12));
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
  // Balkenlänge in ganzen Metern, passend zum aktuellen Zoom (5 m bei normaler
  // Ansicht, bei stark herausgezoomten Großgerüsten 10/20/50 m …).
  const targetPx = 140 / camera.scale;                     // ~140 Bildschirm-px
  const steps    = [1, 2, 5, 10, 20, 50, 100, 200];
  const meters   = steps.find(m => m * PX_PER_M >= targetPx) || steps[steps.length - 1];
  const barLen = meters * PX_PER_M;
  const bx = minX + vw * 0.04;
  const by = minY + vh - (vh * 0.05);
  const tickH = fontSize * 0.7;
  const sw = fontSize * 0.17;
  g.appendChild(svgEl('rect', { x: bx - fontSize * 0.7, y: by - fontSize * 1.6, width: barLen + fontSize * 1.4, height: fontSize * 1.6 + tickH + fontSize * 0.7, fill: 'rgba(255,255,255,0.82)', rx: fontSize * 0.35 }));
  g.appendChild(svgEl('line', { x1: bx, y1: by, x2: bx + barLen, y2: by, stroke: '#333', 'stroke-width': sw }));
  g.appendChild(svgEl('line', { x1: bx, y1: by - tickH, x2: bx, y2: by + tickH, stroke: '#333', 'stroke-width': sw }));
  g.appendChild(svgEl('line', { x1: bx + barLen, y1: by - tickH, x2: bx + barLen, y2: by + tickH, stroke: '#333', 'stroke-width': sw }));
  const lbl = svgEl('text', { x: bx + barLen / 2, y: by - tickH - fontSize * 0.2, 'text-anchor': 'middle', 'font-size': fontSize, 'font-family': 'system-ui, sans-serif', fill: '#333', 'font-weight': '600' });
  lbl.textContent = meters.toString().replace('.', ',') + ' m';
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
  selectedBi = 0;
  renderAll();
}

function onRotateHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const si  = parseInt(e.currentTarget.dataset.si);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  selectedSi = si;
  selectedBi = 0;
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
  selectedBi = 0;
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
    if (d.moved && d.snap) {
      // pixelgenau an der hervorgehobenen Andockstelle einrasten
      sec.x0 = d.snap.x0; sec.y0 = d.snap.y0;
    }
    // Ohne Andock-Treffer bleibt das Feld an der frei gezogenen Position –
    // auch wenn es dabei ein anderes Feld überlappt (bewusst erlaubt).
    movePreview = null;
    renderAll();
    return;
  }
  if (!d.moved) openEditSheet(d.si, d.bi);
  else renderAll();
}

// ── Zeichenfläche: Pinch-Zoom, Pan & Mausrad ────────────────────────────────
// Ein Finger auf leerem Grund oder einem Feld verschiebt die Ansicht (Pan),
// zwei Finger zoomen (Pinch) mit dem Fingermittelpunkt als Ankerpunkt, Maus-
// rad/Trackpad zoomt auf den Cursor. Der Punkt unter Fingern bzw. Cursor bleibt
// dabei exakt fixiert. Handles (Verschieben/Drehen) haben eigene pointerdown-
// Listener mit stopPropagation() und sind hiervon nicht betroffen.

/* Kamera-Änderungen (Pan/Zoom) verändern NUR den sichtbaren Ausschnitt, nicht
   die Zeichnung selbst. Während einer Geste wird deshalb ausschließlich die
   viewBox aktualisiert (konstanter Aufwand) statt das gesamte SVG neu
   aufzubauen – dadurch bleibt das Zoomen bei 50 Feldern exakt so flüssig wie
   bei 5. Erst wenn die Geste endet, wird einmal vollständig neu gezeichnet,
   damit die bildschirmgroßen Bedienelemente wieder passend skaliert sind. */
let camRafPending  = false;
let camSettleTimer = null;

function scheduleCanvasRender() {
  if (camRafPending) return;
  camRafPending = true;
  requestAnimationFrame(() => {
    camRafPending = false;
    applyCamera();
    updateZoomResetBtn();
  });
}

/** Vollständiger Neuaufbau kurz nach Ende einer Zoom-/Pan-Interaktion. */
function scheduleCameraSettle(delay = 140) {
  clearTimeout(camSettleTimer);
  camSettleTimer = setTimeout(() => { renderSvg(); updateZoomResetBtn(); }, delay);
}

/** Setzt canvasGesture anhand der aktuell aktiven Finger neu auf – wird bei
 *  jedem Wechsel der Fingeranzahl (Auflegen/Abheben) aufgerufen, damit z.B.
 *  ein Pinch nahtlos in ein Ein-Finger-Pan übergeht. Alle Bezugswerte werden
 *  beim Gestenstart eingefroren; während der Geste wird ausschließlich mit
 *  Bildschirm-Deltas gerechnet (kein Zurücklesen aus dem DOM) – dadurch bleibt
 *  die Geste unabhängig von Renderzeit und Feldanzahl absolut stabil. */
function beginCanvasGesture() {
  const pts = [...canvasPointers.values()];

  if (pts.length === 1) {
    canvasGesture = {
      mode: 'pan',
      moved: false,
      startClientX: pts[0].x,
      startClientY: pts[0].y,
      startCx: camera.cx,
      startCy: camera.cy,
      startScale: camera.scale
    };
  } else if (pts.length === 2) {
    const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    canvasGesture = {
      mode: 'pinch',
      moved: false,
      startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      startMidClient: midClient,
      startScale: camera.scale,
      // Weltpunkt unter dem Fingermittelpunkt beim Gestenstart – bleibt während
      // der gesamten Geste unter den Fingern fixiert (kein Driften).
      startWorld: clientToWorld(midClient.x, midClient.y)
    };
  } else {
    canvasGesture = null;
  }
}

function onCanvasPointerDown(e) {
  if (drag) return;                                    // Handle-Drag hat Vorrang (stoppt Propagation ohnehin selbst)
  if (canvasPointers.size >= 2 && !canvasPointers.has(e.pointerId)) return;  // max. 2 Finger verfolgen
  // Absichtlich KEIN setPointerCapture hier: das würde den Klick-Kompatibilitäts-
  // event bereits bei einem einfachen Tap auf das svg umleiten (statt auf das
  // Feld/den Hintergrund darunter) und so das Öffnen des Bearbeiten-Sheets
  // verhindern. Capture wird erst in onCanvasPointerMove gesetzt, sobald sich
  // eine echte Pan-/Pinch-Bewegung bestätigt hat.
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  beginCanvasGesture();
}

function onCanvasPointerMove(e) {
  if (!canvasPointers.has(e.pointerId)) return;
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!canvasGesture) return;

  const svg = document.getElementById('planSvg');
  const captureActivePointers = () => {
    canvasPointers.forEach((_, id) => { try { svg.setPointerCapture(id); } catch (err) { /* ignorieren */ } });
  };

  if (canvasGesture.mode === 'pan' && canvasPointers.size === 1) {
    const p = [...canvasPointers.values()][0];
    const dxClient = p.x - canvasGesture.startClientX;
    const dyClient = p.y - canvasGesture.startClientY;
    if (!canvasGesture.moved && Math.hypot(dxClient, dyClient) > 4) { canvasGesture.moved = true; captureActivePointers(); }
    if (!canvasGesture.moved) return;
    // 1 Bildschirm-px Wisch = 1 Bildschirm-px Verschiebung, unabhängig von Zoom
    // und Feldanzahl.
    camera.cx = canvasGesture.startCx - dxClient / canvasGesture.startScale;
    camera.cy = canvasGesture.startCy - dyClient / canvasGesture.startScale;
    autoFit = false;
    clampCamera();
    scheduleCanvasRender();
  } else if (canvasGesture.mode === 'pinch' && canvasPointers.size === 2) {
    const pts = [...canvasPointers.values()];
    const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (!canvasGesture.moved && Math.abs(dist - canvasGesture.startDist) > 6) { canvasGesture.moved = true; captureActivePointers(); }

    camera.scale = clampScale(canvasGesture.startScale * (dist / canvasGesture.startDist));

    // Kamera so setzen, dass startWorld exakt unter dem aktuellen Finger-
    // Mittelpunkt liegt (Zoom + gleichzeitiges Verschieben mit zwei Fingern).
    const vp = viewportRect();
    camera.cx = canvasGesture.startWorld.x - (midClient.x - vp.left - vp.w / 2) / camera.scale;
    camera.cy = canvasGesture.startWorld.y - (midClient.y - vp.top  - vp.h / 2) / camera.scale;
    autoFit = false;
    clampCamera();
    scheduleCanvasRender();
  }
}

function onCanvasPointerUp(e) {
  canvasPointers.delete(e.pointerId);
  try { document.getElementById('planSvg').releasePointerCapture(e.pointerId); } catch (err) { /* ignorieren */ }
  if (canvasGesture && canvasGesture.moved) canvasJustMoved = true;
  beginCanvasGesture();
  if (!canvasPointers.size) scheduleCameraSettle(60);
}

/** Maus-/Trackpad-Zoom. Pinch auf dem Trackpad kommt als wheel+ctrlKey an und
 *  wird deutlich feiner übersetzt als ein Mausrad-Klick. Ankerpunkt ist immer
 *  der Cursor. */
function onCanvasWheel(e) {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;        // Zeilen → Pixel
  else if (e.deltaMode === 2) dy *= 400;  // Seiten → Pixel
  const k = e.ctrlKey ? 0.010 : 0.0022;   // Trackpad-Pinch feiner als Mausrad
  const factor = Math.exp(-dy * k);
  zoomAt(e.clientX, e.clientY, factor);
  scheduleCanvasRender();
  scheduleCameraSettle();
}

/** Doppelklick/Doppeltipp: eine Stufe hineinzoomen auf den Zeigepunkt. */
function onCanvasDblClick(e) {
  zoomAt(e.clientX, e.clientY, 1.8);
  scheduleCanvasRender();
  scheduleCameraSettle(60);
}

/** Setzt Zoom/Pan der Zeichenfläche auf die automatische Vollansicht zurück. */
function resetCanvasView() {
  autoFit = true;
  fitCameraToContent();
  renderSvg();
  updateZoomResetBtn();
}

function updateZoomResetBtn() {
  const btn = document.getElementById('zoomResetBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', autoFit);
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
  selectedBi = 0;
  addCtx = null;
  renderAll();
}

// ── Edit field sheet (existing bay) ───────────────────────────────────────

function openEditSheet(si, bi) {
  closeSheet();
  const sec = state.sections[si];
  const bay = sec && sec.bays[bi];
  if (!sec || !bay) return;
  normalizeBay(bay);
  selectedSi = si;
  selectedBi = bi;

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
  hdr.textContent = `Feld ${bayLabel(sec, bi)}`;

  // Plausibilitätshinweise: rein informativ, blockiert die Bearbeitung nicht.
  const warnBanner = document.createElement('div');
  warnBanner.className = 'sheet-warn-banner';
  function syncWarnBanner() {
    const warns = bayWarnings(bay);
    warnBanner.innerHTML = '';
    warnBanner.classList.toggle('hidden', !warns.length);
    warns.forEach(w => {
      const chip = document.createElement('span');
      chip.className = 'sheet-warn-chip';
      chip.textContent = '⚠ ' + w;
      warnBanner.appendChild(chip);
    });
  }
  syncWarnBanner();

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

  // Feldlänge ist Standardwert der Meter-Positionen → bei Änderung deren
  // Platzhalter/Anzeige mitführen.
  const syncInp = () => { inp.value = bay.len.toFixed(2); buildPosDetails(); buildKonsole(); renderSvg(); };
  minusBtn.addEventListener('click', () => { bay.len = Math.max(0.25, +(bay.len - 0.25).toFixed(2)); syncInp(); });
  plusBtn.addEventListener('click',  () => { bay.len = +(bay.len + 0.25).toFixed(2); syncInp(); });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (v >= 0.25) { bay.len = +v.toFixed(2); buildPosDetails(); buildKonsole(); renderSvg(); }
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

  // ── Höhen (Gerüst-Grundfeld) ────────────────────────────────────────────
  const hLabel = document.createElement('div');
  hLabel.className = 'sheet-section-label';
  hLabel.textContent = 'Höhen (m)';

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
      buildPosDetails();   // Netz-m²-Vorschlag (Länge × kleinere Höhe) live nachführen
      renderSvg();
    });
    field.appendChild(lab); field.appendChild(hInp);
    return { field, input: hInp };
  };
  const hLeft  = makeHeightField('Höhe links',  'hL');
  const hRight = makeHeightField('Höhe rechts', 'hR');
  const hEqBtn = document.createElement('button');
  hEqBtn.className = 'height-eq'; hEqBtn.type = 'button';
  hEqBtn.title = 'Beide Höhen gleich setzen'; hEqBtn.textContent = '=';
  hEqBtn.addEventListener('click', () => {
    const src = bay.hL != null ? bay.hL : bay.hR;
    if (src == null) return;
    bay.hL = src; bay.hR = src;
    hLeft.input.value = src.toFixed(2); hRight.input.value = src.toFixed(2);
    buildPosDetails();
    renderSvg();
  });
  hRow.appendChild(hLeft.field); hRow.appendChild(hEqBtn); hRow.appendChild(hRight.field);

  // ── Positionen (mehrere pro Feld möglich) ───────────────────────────────
  const posLabel = document.createElement('div');
  posLabel.className = 'sheet-section-label';
  posLabel.textContent = 'Positionen';

  const hasPos = key => bay.positions.some(p => p.cat === key);
  const togglePos = key => {
    const i = bay.positions.findIndex(p => p.cat === key);
    if (i >= 0) bay.positions.splice(i, 1);
    else bay.positions.push({ id: ++_bId, cat: key, qty: null, unit: defaultUnit(key) });
    buildPosDetails();
    renderSvg();
  };

  // Toggle-Chips für einfache Positionen (alles außer Konsole)
  const posToggle = document.createElement('div');
  posToggle.className = 'pos-toggle-row';
  POSITIONS.filter(p => !p.konsole).forEach(p => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pos-chip' + (hasPos(p.key) ? ' active' : '');
    chip.textContent = p.label;
    chip.style.setProperty('--pos-color', p.color);
    chip.addEventListener('click', () => {
      togglePos(p.key);
      chip.classList.toggle('active', hasPos(p.key));
    });
    posToggle.appendChild(chip);
  });

  // Mengen-Detail (Anzahl + Einheit) für jede aktive einfache Position
  const posDetailWrap = document.createElement('div');
  posDetailWrap.className = 'pos-detail-list';

  const makePosDetailRow = pos => {
    const p = POS_BY_KEY[pos.cat];
    const row = document.createElement('div');
    row.className = 'pos-detail-row';

    const name = document.createElement('span');
    name.className = 'pos-detail-name';
    name.textContent = p.label;
    name.style.color = p.color;

    // Errechnete Meter (Lagen × Feldlänge) – live aktualisiert.
    const calc = document.createElement('span');
    calc.className = 'pos-detail-calc';
    const updateCalc = () => {
      const m = posMeters(pos, bay);
      calc.textContent = m != null ? '= ' + fmtQty(m) + ' m' : '';
    };

    const qtyInp = document.createElement('input');
    qtyInp.type = 'number'; qtyInp.className = 'pos-detail-qty';
    qtyInp.min = '0'; qtyInp.step = 'any'; qtyInp.inputMode = 'decimal';
    // Bei Einheit 'm' zeigt der Platzhalter die Feldlänge, bei 'm2' die Fläche
    // an (bei Netz: Länge × kleinere Höhe, sonst Länge × Gerüsttiefe) –
    // Vorschlagswert, den der Nutzer jederzeit überschreiben kann.
    const syncPlaceholder = () => {
      const u = pos.unit || defaultUnit(pos.cat);
      if (u === 'm'  && bay.len) { qtyInp.placeholder = fmtQty(bay.len); return; }
      if (u === 'm2') {
        const suggestion = pos.cat === 'netz' ? netzArea(bay) : (bay.len ? bayArea(bay.len) : null);
        qtyInp.placeholder = suggestion != null ? fmtQty(suggestion) : 'Anz.';
        return;
      }
      qtyInp.placeholder = 'Anz.';
    };
    syncPlaceholder();
    qtyInp.value = (pos.qty != null) ? pos.qty : '';
    qtyInp.addEventListener('input', () => {
      const v = parseFloat(qtyInp.value);
      pos.qty = (qtyInp.value === '' || isNaN(v)) ? null : v;
      updateCalc();
      renderSvg();
    });

    const unitRow = document.createElement('div');
    unitRow.className = 'pos-unit-row';
    UNIT_DEFS.forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'punit-btn' + ((pos.unit || defaultUnit(pos.cat)) === val ? ' active' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => {
        pos.unit = val;
        unitRow.querySelectorAll('.punit-btn').forEach(x => x.classList.toggle('active', x === b));
        syncPlaceholder();
        updateCalc();
        renderSvg();
      });
      unitRow.appendChild(b);
    });

    updateCalc();
    row.appendChild(name); row.appendChild(qtyInp); row.appendChild(unitRow); row.appendChild(calc);
    return row;
  };

  function buildPosDetails() {
    posDetailWrap.innerHTML = '';
    bay.positions
      .filter(pos => { const p = POS_BY_KEY[pos.cat]; return p && !p.konsole; })
      .forEach(pos => posDetailWrap.appendChild(makePosDetailRow(pos)));
    syncWarnBanner();
  }
  buildPosDetails();

  // Konsolen-Bereich: Typ + Lagen, mehrfach möglich
  const konsLabel = document.createElement('div');
  konsLabel.className = 'sheet-subsection-label';
  konsLabel.textContent = 'Konsolen';

  const konsWrap = document.createElement('div');
  konsWrap.className = 'pos-konsole-list';

  const lagenPresets = [['1', '1 Lage'], ['2', '2 Lagen'], ['3', '3 Lagen'], ['4', '4 Lagen'], ['5', '5 Lagen']];

  const makeKonsoleRow = pos => {
    const row = document.createElement('div');
    row.className = 'konsole-row';

    const head = document.createElement('div');
    head.className = 'konsole-row-head';
    const title = document.createElement('span');
    title.className = 'konsole-row-title';
    title.textContent = 'Konsole';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'meas-remove-btn'; rm.innerHTML = '&times;';
    rm.addEventListener('click', () => {
      const i = bay.positions.indexOf(pos);
      if (i >= 0) bay.positions.splice(i, 1);
      buildKonsole(); renderSvg();
    });
    const calc = document.createElement('span');
    calc.className = 'pos-detail-calc konsole-row-calc';
    const updateCalc = () => {
      const m = posMeters(pos, bay);
      calc.textContent = m != null ? '= ' + fmtQty(m) + ' m' : '';
    };
    head.appendChild(title); head.appendChild(calc); head.appendChild(rm);

    // Typ-Auswahl
    const typeRow = document.createElement('div');
    typeRow.className = 'konsole-type-row';
    KONSOLE_TYPES.forEach(typ => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ktype-btn' + (pos.typ === typ ? ' active' : '');
      b.textContent = typ;
      b.addEventListener('click', () => {
        pos.typ = typ;
        typeRow.querySelectorAll('.ktype-btn').forEach(x => x.classList.toggle('active', x.textContent === typ));
        renderSvg();
      });
      typeRow.appendChild(b);
    });

    // Abrechnungsart: pro Lage (bisher) oder in laufenden Metern.
    const billingRow = document.createElement('div');
    billingRow.className = 'konsole-billing-row';
    const billingOpts = [['lagen', 'pro Lage'], ['meter', 'in Metern']];

    // Lagen-Auswahl
    const lagenRow = document.createElement('div');
    lagenRow.className = 'konsole-lagen-row';
    const freeInp = document.createElement('input');
    const isPreset = lagenPresets.some(([v]) => String(pos.lagen || 'alle') === v);
    lagenPresets.forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'klagen-btn' + (String(pos.lagen || 'alle') === val ? ' active' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => {
        pos.lagen = val; freeInp.value = '';
        lagenRow.querySelectorAll('.klagen-btn').forEach(x => x.classList.toggle('active', x === b));
        updateCalc();
        renderSvg();
      });
      lagenRow.appendChild(b);
    });
    freeInp.type = 'number'; freeInp.className = 'klagen-free';
    freeInp.min = '1'; freeInp.step = '1'; freeInp.inputMode = 'numeric'; freeInp.placeholder = 'Anz.';
    freeInp.value = (!isPreset && pos.lagen) ? pos.lagen : '';
    freeInp.addEventListener('input', () => {
      const v = parseInt(freeInp.value, 10);
      if (!isNaN(v) && v > 0) {
        pos.lagen = String(v);
        lagenRow.querySelectorAll('.klagen-btn').forEach(x => x.classList.remove('active'));
      }
      updateCalc();
      renderSvg();
    });
    lagenRow.appendChild(freeInp);

    // Meter-Auswahl: standardmäßig die Feldlänge (Platzhalter), manuell überschreibbar.
    const meterRow = document.createElement('div');
    meterRow.className = 'konsole-meter-row';
    const meterInp = document.createElement('input');
    meterInp.type = 'number'; meterInp.className = 'kmeter-inp';
    meterInp.min = '0'; meterInp.step = 'any'; meterInp.inputMode = 'decimal';
    meterInp.placeholder = fmtQty(bay.len);
    meterInp.value = (pos.meterValue != null) ? pos.meterValue : '';
    meterInp.addEventListener('input', () => {
      const v = parseFloat(meterInp.value);
      pos.meterValue = (meterInp.value === '' || isNaN(v)) ? null : v;
      updateCalc();
      renderSvg();
    });
    const meterUnit = document.createElement('span');
    meterUnit.className = 'kmeter-unit';
    meterUnit.textContent = 'm';
    meterRow.appendChild(meterInp); meterRow.appendChild(meterUnit);

    const syncBillingRows = () => {
      const isMeter = isMeterBilling(pos);
      lagenRow.style.display = isMeter ? 'none' : '';
      meterRow.style.display = isMeter ? '' : 'none';
    };
    billingOpts.forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kbill-btn' + ((pos.billing === 'meter' ? 'meter' : 'lagen') === val ? ' active' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => {
        pos.billing = val;
        billingRow.querySelectorAll('.kbill-btn').forEach(x => x.classList.toggle('active', x === b));
        syncBillingRows();
        updateCalc();
        renderSvg();
      });
      billingRow.appendChild(b);
    });
    syncBillingRows();

    updateCalc();
    row.appendChild(head); row.appendChild(typeRow); row.appendChild(billingRow);
    row.appendChild(lagenRow); row.appendChild(meterRow);
    return row;
  };

  function buildKonsole() {
    konsWrap.innerHTML = '';
    bay.positions.filter(p => p.cat === 'konsole').forEach(pos => konsWrap.appendChild(makeKonsoleRow(pos)));
    syncWarnBanner();
  }
  buildKonsole();

  const addKonsBtn = document.createElement('button');
  addKonsBtn.type = 'button'; addKonsBtn.className = 'pos-add-konsole';
  addKonsBtn.textContent = '+ Konsole';
  addKonsBtn.addEventListener('click', () => {
    bay.positions.push({ id: ++_bId, cat: 'konsole', typ: KONSOLE_TYPES[0], lagen: '1', billing: 'lagen' });
    buildKonsole(); renderSvg();
  });

  // ── Notiz ────────────────────────────────────────────────────────────────
  const noteLabel = document.createElement('div');
  noteLabel.className = 'sheet-section-label';
  noteLabel.textContent = 'Notiz';

  const noteInp = document.createElement('textarea');
  noteInp.className = 'sheet-note-inp';
  noteInp.placeholder = 'z. B. Fenster freihalten, nur teilweise eingerüstet …';
  noteInp.rows = 2;
  noteInp.value = bay.note || '';
  noteInp.addEventListener('input', () => { bay.note = noteInp.value; renderSvg(); });

  // ── Favoriten / Vorlagen ─────────────────────────────────────────────────
  const favLabel = document.createElement('div');
  favLabel.className = 'sheet-section-label';
  favLabel.textContent = 'Vorlagen';

  const favWrap = document.createElement('div');
  favWrap.className = 'fav-chip-row';

  function buildFavList() {
    favWrap.innerHTML = '';
    const favs = loadFavorites();
    if (!favs.length) {
      const hint = document.createElement('span');
      hint.className = 'bay-pos-empty';
      hint.textContent = 'Noch keine Vorlagen gespeichert';
      favWrap.appendChild(hint);
      return;
    }
    favs.forEach(fav => {
      const chip = document.createElement('div');
      chip.className = 'fav-chip';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button'; nameBtn.className = 'fav-chip-name';
      nameBtn.textContent = fav.name;
      nameBtn.title = 'Vorlage auf dieses Feld anwenden';
      nameBtn.addEventListener('click', () => {
        applyFavoriteToBay(fav, bay);
        hLeft.input.value = bay.hL == null ? '' : bay.hL.toFixed(2);
        hRight.input.value = bay.hR == null ? '' : bay.hR.toFixed(2);
        buildPosDetails(); buildKonsole(); renderSvg();
        showToast('Vorlage „' + fav.name + '" angewendet');
      });
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'fav-chip-rm'; rm.innerHTML = '&times;';
      rm.title = 'Vorlage löschen';
      rm.addEventListener('click', () => {
        if (!confirm('Vorlage „' + fav.name + '" löschen?')) return;
        deleteFavorite(fav.id);
        buildFavList();
      });
      chip.appendChild(nameBtn); chip.appendChild(rm);
      favWrap.appendChild(chip);
    });
  }
  buildFavList();

  const favSaveBtn = document.createElement('button');
  favSaveBtn.type = 'button'; favSaveBtn.className = 'sheet-copy fav-save-btn';
  favSaveBtn.textContent = '★ Aktuelle Einstellungen als Vorlage speichern';
  favSaveBtn.addEventListener('click', () => { saveFavoriteFromBay(bay); buildFavList(); });

  // Actions
  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';

  const delBtn = document.createElement('button');
  delBtn.className = 'sheet-del'; delBtn.textContent = 'Feld löschen';
  delBtn.addEventListener('click', () => {
    sec.bays.splice(bi, 1);
    if (sec.bays.length === 0) state.sections.splice(si, 1);
    selectedSi = null; selectedBi = null;
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
    selectedBi = 0;
    renderAll(); closeSheet();
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'sheet-ok'; okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });

  // ── Position kopieren / einfügen ────────────────────────────────────────
  const copyPasteRow = document.createElement('div');
  copyPasteRow.className = 'sheet-actions sheet-copy-paste-row';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 'sheet-copy';
  copyBtn.textContent = 'Position kopieren';
  copyBtn.addEventListener('click', () => copyBayPositions(bay));

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'sheet-paste' + (copiedBayData ? ' active' : '');
  pasteBtn.textContent = '📋 Position einfügen';
  pasteBtn.disabled = !copiedBayData;
  pasteBtn.addEventListener('click', () => {
    pasteBayPositions(bay);
    renderSvg();
    closeSheet();
    openEditSheet(si, bi);   // Sheet mit den neuen Werten neu aufbauen
  });

  copyPasteRow.appendChild(copyBtn);
  copyPasteRow.appendChild(pasteBtn);

  // ── Wand spiegeln ────────────────────────────────────────────────────────
  // Dupliziert die gesamte Wand (alle direkt verbundenen Felder mit gleichem
  // Winkel), gespiegelt zur gegenüberliegenden Seite – praktisch bei
  // symmetrischen Gebäuden, bei denen die andere Seite identisch ist.
  const mirrorLabel = document.createElement('div');
  mirrorLabel.className = 'sheet-subsection-label';
  mirrorLabel.textContent = 'Wand spiegeln';

  const mirrorRow = document.createElement('div');
  mirrorRow.className = 'sheet-actions sheet-copy-paste-row';
  const mirrorHBtn = document.createElement('button');
  mirrorHBtn.type = 'button'; mirrorHBtn.className = 'sheet-copy';
  mirrorHBtn.textContent = '⇋ Horizontal';
  mirrorHBtn.title = 'Diese Wand horizontal gespiegelt auf die gegenüberliegende Seite kopieren';
  mirrorHBtn.addEventListener('click', () => { mirrorWallAt(si, 'v'); closeSheet(); });
  const mirrorVBtn = document.createElement('button');
  mirrorVBtn.type = 'button'; mirrorVBtn.className = 'sheet-copy';
  mirrorVBtn.textContent = '⇵ Vertikal';
  mirrorVBtn.title = 'Diese Wand vertikal gespiegelt auf die gegenüberliegende Seite kopieren';
  mirrorVBtn.addEventListener('click', () => { mirrorWallAt(si, 'h'); closeSheet(); });
  mirrorRow.appendChild(mirrorHBtn);
  mirrorRow.appendChild(mirrorVBtn);

  actRow.appendChild(delBtn); actRow.appendChild(addAfterBtn); actRow.appendChild(okBtn);

  sheet.appendChild(hdr);
  sheet.appendChild(warnBanner);
  sheet.appendChild(dirRow);
  sheet.appendChild(stdDiv);
  sheet.appendChild(adjRow);
  sheet.appendChild(rotLabel);
  sheet.appendChild(rotRow);
  sheet.appendChild(rotPresets);
  sheet.appendChild(hLabel);
  sheet.appendChild(hRow);
  sheet.appendChild(posLabel);
  sheet.appendChild(posToggle);
  sheet.appendChild(posDetailWrap);
  sheet.appendChild(konsLabel);
  sheet.appendChild(konsWrap);
  sheet.appendChild(addKonsBtn);
  sheet.appendChild(noteLabel);
  sheet.appendChild(noteInp);
  sheet.appendChild(favLabel);
  sheet.appendChild(favWrap);
  sheet.appendChild(favSaveBtn);
  sheet.appendChild(copyPasteRow);
  sheet.appendChild(mirrorLabel);
  sheet.appendChild(mirrorRow);
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

// ── Fotos-Galerie ────────────────────────────────────────────────────────────
// Projekt-Fotos (Baustelle, Aufbau, Details, Schäden) – gespeichert per
// IndexedDB (siehe addProjectPhoto/listProjectPhotos weiter oben), unabhängig
// von state.sections. Setzt ein verknüpftes Projekt voraus, da Fotos
// projektbezogen sind (nicht an eine einzelne Zeichnung gebunden).

function closePhotosSheet() {
  document.getElementById('photosSheetOverlay')?.remove();
  const s = document.getElementById('photosSheet');
  if (!s) return;
  s.classList.remove('open');
  setTimeout(() => s.remove(), 230);
}

async function openPhotosSheet() {
  if (!linkedProjectId) {
    showToast('Fotos benötigen ein gespeichertes Projekt – bitte über den Projekt-Hub öffnen');
    return;
  }
  closePhotosSheet();

  const overlay = document.createElement('div');
  overlay.id = 'photosSheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', closePhotosSheet);

  const sheet = document.createElement('div');
  sheet.id = 'photosSheet';
  sheet.className = 'bottom-sheet photos-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = '📷 Projekt-Fotos';

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'photos-add-btn';
  addBtn.textContent = '+ Foto hinzufügen (Kamera / Galerie)';
  addBtn.addEventListener('click', () => document.getElementById('photoFileInput').click());

  const grid = document.createElement('div');
  grid.className = 'photos-grid';

  async function renderGrid() {
    grid.innerHTML = '';
    const photos = await listProjectPhotos(linkedProjectId);
    if (!photos.length) {
      const hint = document.createElement('p');
      hint.className = 'hint photos-hint';
      hint.textContent = 'Noch keine Fotos vorhanden.';
      grid.appendChild(hint);
      return;
    }
    photos.forEach(photo => {
      const tile = document.createElement('div');
      tile.className = 'photo-tile';
      const img = document.createElement('img');
      img.src = photo.dataUrl; img.loading = 'lazy';
      img.addEventListener('click', () => openPhotoLightbox(photo, renderGrid));
      tile.appendChild(img);

      const incLabel = document.createElement('label');
      incLabel.className = 'photo-include-toggle';
      incLabel.title = 'In PDF-Export einschließen';
      const incChk = document.createElement('input');
      incChk.type = 'checkbox'; incChk.checked = photo.include !== false;
      incChk.addEventListener('click', e => e.stopPropagation());
      incChk.addEventListener('change', () => setPhotoIncluded(photo.id, incChk.checked));
      const incTxt = document.createElement('span');
      incTxt.textContent = 'PDF';
      incLabel.appendChild(incChk); incLabel.appendChild(incTxt);
      tile.appendChild(incLabel);

      grid.appendChild(tile);
    });
  }
  renderGrid();

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'sheet-ok';
  closeBtn.textContent = 'Fertig';
  closeBtn.addEventListener('click', closePhotosSheet);

  sheet.appendChild(hdr);
  sheet.appendChild(addBtn);
  sheet.appendChild(grid);
  sheet.appendChild(closeBtn);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/** Vollbild-Ansicht eines einzelnen Fotos mit Lösch-Möglichkeit. */
function openPhotoLightbox(photo, onChange) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-lightbox-overlay';

  const img = document.createElement('img');
  img.src = photo.dataUrl;
  img.className = 'photo-lightbox-img';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'photo-lightbox-close';
  closeBtn.textContent = '✕';

  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'photo-lightbox-delete';
  delBtn.textContent = '🗑 Löschen';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Dieses Foto wirklich löschen?')) return;
    await deleteProjectPhoto(photo.id);
    overlay.remove();
    onChange && onChange();
  });

  const close = () => overlay.remove();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(delBtn);
  document.body.appendChild(overlay);
}

/** Verarbeitet über die Kamera/Galerie ausgewählte Foto-Dateien: komprimieren,
 *  speichern, Galerie ggf. aktualisieren. */
async function onPhotoFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';   // erlaubt erneutes Auswählen derselben Datei
  if (!files.length || !linkedProjectId) return;
  showToast(files.length === 1 ? 'Foto wird gespeichert …' : files.length + ' Fotos werden gespeichert …');
  for (const file of files) {
    try { await addProjectPhoto(linkedProjectId, file); }
    catch (err) { console.error('Foto konnte nicht gespeichert werden', err); }
  }
  if (document.getElementById('photosSheet')) openPhotosSheet();
  showToast('Fotos gespeichert');
}

// ── Side panel ─────────────────────────────────────────────────────────────

/** Alle Felder (bays) über alle Sektionen hinweg, unabhängig von Reihenfolge. */
function allBaysFlat() {
  return state.sections.flatMap(s => s.bays);
}

/** Leiste über der Feldliste: Mehrfachauswahl an/aus + Sammel-Aktionen.
 *  Erlaubt, EINE Position (Konsole, Netz, Tunnelrahmen …) auf beliebig viele,
 *  auch nicht benachbarte Felder anzuwenden, ohne deren Höhen oder sonstige
 *  Positionen zu verändern – Ergänzung zu Kopieren/Einfügen (das ein ganzes
 *  Feld 1:1 auf ein einzelnes Ziel überträgt). */
function renderBulkBar() {
  const el = document.getElementById('bulkBar');
  if (!el) return;
  el.innerHTML = '';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'bulk-toggle-btn' + (bulkMode ? ' active' : '');
  toggleBtn.textContent = bulkMode ? '✕ Mehrfachauswahl beenden' : '☑ Mehrere Felder bearbeiten';
  toggleBtn.addEventListener('click', () => {
    bulkMode = !bulkMode;
    if (!bulkMode) { bulkSelected.clear(); bulkHL = null; bulkHR = null; }
    renderAll();
  });
  el.appendChild(toggleBtn);
  if (!bulkMode) return;

  const bays = allBaysFlat();
  if (!bays.length) {
    const hint = document.createElement('p');
    hint.className = 'bulk-hint';
    hint.textContent = 'Zuerst Felder anlegen.';
    el.appendChild(hint);
    return;
  }

  const info = document.createElement('div');
  info.className = 'bulk-info';
  info.textContent = `${bulkSelected.size} von ${bays.length} Feldern ausgewählt`;
  el.appendChild(info);

  const selRow = document.createElement('div');
  selRow.className = 'bulk-sel-row';
  const allBtn = document.createElement('button');
  allBtn.type = 'button'; allBtn.className = 'bulk-sel-btn';
  allBtn.textContent = 'Alle';
  allBtn.addEventListener('click', () => { bays.forEach(b => bulkSelected.add(b.id)); renderAll(); });
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button'; noneBtn.className = 'bulk-sel-btn';
  noneBtn.textContent = 'Keine';
  noneBtn.addEventListener('click', () => { bulkSelected.clear(); renderAll(); });
  selRow.appendChild(allBtn); selRow.appendChild(noneBtn);
  el.appendChild(selRow);

  const selectedBays = bays.filter(b => bulkSelected.has(b.id));
  if (!selectedBays.length) {
    const hint = document.createElement('p');
    hint.className = 'bulk-hint';
    hint.textContent = 'Felder unten in der Liste ankreuzen, dann hier eine Position anwenden.';
    el.appendChild(hint);
    return;
  }

  // Vorlage auf die gesamte Auswahl anwenden: überschreibt Höhen + Positionen
  // aller markierten Felder mit einem Klick.
  const favBulkLabel = document.createElement('div');
  favBulkLabel.className = 'bulk-section-label';
  favBulkLabel.textContent = 'Vorlage auf Auswahl anwenden';
  el.appendChild(favBulkLabel);

  const favBulkWrap = document.createElement('div');
  favBulkWrap.className = 'fav-chip-row';
  const favs = loadFavorites();
  if (!favs.length) {
    const hint = document.createElement('span');
    hint.className = 'bay-pos-empty';
    hint.textContent = 'Noch keine Vorlagen gespeichert (im Bearbeiten-Sheet eines Feldes anlegen)';
    favBulkWrap.appendChild(hint);
  } else {
    favs.forEach(fav => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'fav-chip-name';
      chip.textContent = fav.name;
      chip.title = 'Auf ' + selectedBays.length + ' Feld' + (selectedBays.length === 1 ? '' : 'er') + ' anwenden';
      chip.addEventListener('click', () => {
        selectedBays.forEach(bay => applyFavoriteToBay(fav, bay));
        renderAll();
        showToast('Vorlage „' + fav.name + '" auf ' + selectedBays.length + ' Feldern angewendet');
      });
      favBulkWrap.appendChild(chip);
    });
  }
  el.appendChild(favBulkWrap);

  // Höhe für die gesamte Auswahl: einmal eingeben, per Klick auf alle
  // markierten Felder übertragen – ohne deren sonstige Positionen anzutasten.
  const heightLabel = document.createElement('div');
  heightLabel.className = 'bulk-section-label';
  heightLabel.textContent = 'Höhe für Auswahl übernehmen';
  el.appendChild(heightLabel);

  const heightForm = document.createElement('div');
  heightForm.className = 'bulk-height-form';

  const heightRow = document.createElement('div');
  heightRow.className = 'bay-height-row';

  const applyHeightBtn = document.createElement('button');
  applyHeightBtn.type = 'button'; applyHeightBtn.className = 'bulk-height-apply-btn';

  const syncApplyHeightBtn = () => {
    const n = selectedBays.length;
    applyHeightBtn.textContent = 'Höhe auf ' + n + ' Feld' + (n === 1 ? '' : 'er') + ' übernehmen';
    applyHeightBtn.disabled = bulkHL == null && bulkHR == null;
  };

  const makeBulkHeight = (labelTxt, get, set) => {
    const field = document.createElement('div');
    field.className = 'bay-height-field';
    const lab = document.createElement('span');
    lab.className = 'bay-height-label'; lab.textContent = labelTxt;
    const hInp = document.createElement('input');
    hInp.type = 'number'; hInp.className = 'bay-height-inp';
    hInp.placeholder = '–'; hInp.min = '0'; hInp.step = '0.05'; hInp.inputMode = 'decimal';
    hInp.value = get() == null ? '' : get().toFixed(2);
    hInp.addEventListener('input', () => {
      const v = parseFloat(hInp.value);
      set((isNaN(v) || v < 0) ? null : +v.toFixed(2));
      syncApplyHeightBtn();
    });
    field.appendChild(lab); field.appendChild(hInp);
    return { field, input: hInp };
  };
  const bulkHLeft  = makeBulkHeight('H links',  () => bulkHL, v => bulkHL = v);
  const bulkHRight = makeBulkHeight('H rechts', () => bulkHR, v => bulkHR = v);
  const bulkHEqBtn = document.createElement('button');
  bulkHEqBtn.type = 'button'; bulkHEqBtn.className = 'bay-height-eq';
  bulkHEqBtn.title = 'Beide Höhen gleich setzen'; bulkHEqBtn.textContent = '=';
  bulkHEqBtn.addEventListener('click', () => {
    const src = bulkHL != null ? bulkHL : bulkHR;
    if (src == null) return;
    bulkHL = src; bulkHR = src;
    bulkHLeft.input.value = src.toFixed(2); bulkHRight.input.value = src.toFixed(2);
    syncApplyHeightBtn();
  });
  heightRow.appendChild(bulkHLeft.field);
  heightRow.appendChild(bulkHEqBtn);
  heightRow.appendChild(bulkHRight.field);
  heightForm.appendChild(heightRow);

  syncApplyHeightBtn();
  applyHeightBtn.addEventListener('click', () => {
    selectedBays.forEach(bay => {
      if (bulkHL != null) bay.hL = bulkHL;
      if (bulkHR != null) bay.hR = bulkHR;
    });
    renderAll();
    showToast('Höhe auf ' + selectedBays.length + ' Feldern übernommen');
  });
  heightForm.appendChild(applyHeightBtn);
  el.appendChild(heightForm);

  // Einfache Positionen: Chip togglet die Kategorie auf ALLEN ausgewählten
  // Feldern gleichzeitig ein/aus. Menge bleibt je Feld automatisch (Länge/
  // Höhe/Feldlänge) – wie beim einzelnen "+ Positionen"-Toggle.
  const posLabel = document.createElement('div');
  posLabel.className = 'bulk-section-label';
  posLabel.textContent = 'Position für Auswahl';
  el.appendChild(posLabel);

  const chipRow = document.createElement('div');
  chipRow.className = 'bulk-chip-row';
  POSITIONS.filter(p => !p.konsole).forEach(p => {
    const allHave  = selectedBays.every(b => (b.positions || []).some(x => x.cat === p.key));
    const someHave = !allHave && selectedBays.some(b => (b.positions || []).some(x => x.cat === p.key));
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bulk-pos-chip' + (allHave ? ' active' : '') + (someHave ? ' partial' : '');
    chip.textContent = p.label;
    chip.style.setProperty('--pos-color', p.color);
    chip.title = someHave ? 'Bei einem Teil der Auswahl schon vorhanden' : '';
    chip.addEventListener('click', () => {
      const turnOn = !allHave;   // an, außer alle ausgewählten haben sie schon → dann aus
      selectedBays.forEach(bay => {
        normalizeBay(bay);
        const idx = bay.positions.findIndex(x => x.cat === p.key);
        if (turnOn) { if (idx < 0) bay.positions.push({ id: ++_bId, cat: p.key, qty: null, unit: defaultUnit(p.key) }); }
        else if (idx >= 0) bay.positions.splice(idx, 1);
      });
      renderAll();
    });
    chipRow.appendChild(chip);
  });
  el.appendChild(chipRow);

  // Konsole: braucht Typ + Lagen/Meter, daher eigenes Mini-Formular statt
  // einfachem Toggle-Chip. "+ Hinzufügen" legt auf jedem ausgewählten Feld
  // eine neue Konsolen-Position mit dieser Konfiguration an.
  const konsLabel = document.createElement('div');
  konsLabel.className = 'bulk-section-label';
  konsLabel.textContent = 'Konsole für Auswahl hinzufügen';
  el.appendChild(konsLabel);

  const konsForm = document.createElement('div');
  konsForm.className = 'bulk-kons-form';

  const typRow = document.createElement('div');
  typRow.className = 'bulk-kons-typ-row';
  KONSOLE_TYPES.forEach(typ => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bulk-ktype-btn' + (bulkKonsTyp === typ ? ' active' : '');
    b.textContent = typ;
    b.addEventListener('click', () => {
      bulkKonsTyp = typ;
      typRow.querySelectorAll('.bulk-ktype-btn').forEach(x => x.classList.toggle('active', x.textContent === typ));
    });
    typRow.appendChild(b);
  });
  konsForm.appendChild(typRow);

  const billRow = document.createElement('div');
  billRow.className = 'bulk-kons-bill-row';
  [['lagen', 'pro Lage'], ['meter', 'in Metern']].forEach(([val, lbl]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bulk-kbill-btn' + (bulkKonsBilling === val ? ' active' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => {
      bulkKonsBilling = val;
      billRow.querySelectorAll('.bulk-kbill-btn').forEach(x => x.classList.toggle('active', x === b));
      lagenRow.style.display = val === 'meter' ? 'none' : '';
    });
    billRow.appendChild(b);
  });
  konsForm.appendChild(billRow);

  const lagenRow = document.createElement('div');
  lagenRow.className = 'bulk-kons-lagen-row';
  lagenRow.style.display = bulkKonsBilling === 'meter' ? 'none' : '';
  [['1', '1 Lage'], ['2', '2 Lagen'], ['3', '3 Lagen'], ['4', '4 Lagen'], ['5', '5 Lagen'], ['alle', 'alle Lagen']].forEach(([val, lbl]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bulk-klagen-btn' + (bulkKonsLagen === val ? ' active' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => {
      bulkKonsLagen = val;
      lagenRow.querySelectorAll('.bulk-klagen-btn').forEach(x => x.classList.toggle('active', x === b));
    });
    lagenRow.appendChild(b);
  });
  konsForm.appendChild(lagenRow);

  const addKonsBtn = document.createElement('button');
  addKonsBtn.type = 'button'; addKonsBtn.className = 'bulk-kons-add-btn';
  addKonsBtn.textContent = '+ Auf ' + selectedBays.length + ' Feld' + (selectedBays.length === 1 ? '' : 'er') + ' anwenden';
  addKonsBtn.addEventListener('click', () => {
    selectedBays.forEach(bay => {
      normalizeBay(bay);
      bay.positions.push({
        id: ++_bId, cat: 'konsole', typ: bulkKonsTyp,
        lagen: bulkKonsLagen, billing: bulkKonsBilling
      });
    });
    renderAll();
    showToast('Konsole auf ' + selectedBays.length + ' Feldern ergänzt');
  });
  konsForm.appendChild(addKonsBtn);

  el.appendChild(konsForm);

  // Auswahl spiegeln: dupliziert genau die angehakten Felder (auch nicht
  // benachbarte) gespiegelt zur gegenüberliegenden Seite – Ergänzung zur
  // Einzelfeld-Spiegelung im Bearbeiten-Sheet (die nur die zusammenhängende
  // Wand erfasst).
  const mirrorLabel = document.createElement('div');
  mirrorLabel.className = 'bulk-section-label';
  mirrorLabel.textContent = 'Auswahl spiegeln';
  el.appendChild(mirrorLabel);

  const mirrorSelRow = document.createElement('div');
  mirrorSelRow.className = 'bulk-sel-row';
  const selBayIds = new Set(selectedBays.map(b => b.id));
  const mirrorHSelBtn = document.createElement('button');
  mirrorHSelBtn.type = 'button'; mirrorHSelBtn.className = 'bulk-sel-btn';
  mirrorHSelBtn.textContent = '⇋ Horizontal';
  mirrorHSelBtn.title = 'Ausgewählte Felder horizontal gespiegelt kopieren';
  mirrorHSelBtn.addEventListener('click', () => mirrorBaySelection(selBayIds, 'v'));
  const mirrorVSelBtn = document.createElement('button');
  mirrorVSelBtn.type = 'button'; mirrorVSelBtn.className = 'bulk-sel-btn';
  mirrorVSelBtn.textContent = '⇵ Vertikal';
  mirrorVSelBtn.title = 'Ausgewählte Felder vertikal gespiegelt kopieren';
  mirrorVSelBtn.addEventListener('click', () => mirrorBaySelection(selBayIds, 'h'));
  mirrorSelRow.appendChild(mirrorHSelBtn);
  mirrorSelRow.appendChild(mirrorVSelBtn);
  el.appendChild(mirrorSelRow);
}

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
      normalizeBay(bay);
      const row = document.createElement('div');
      row.className = 'bay-row'
        + (bulkMode && bulkSelected.has(bay.id) ? ' bulk-selected' : '')
        + (si === selectedSi && bi === selectedBi ? ' active-selected' : '');
      row.style.borderLeft = '4px solid #2c6fa8';

      // Zeile 1: [Mehrfachauswahl] · Nummer · Längen-Eingabe · Löschen
      const top = document.createElement('div');
      top.className = 'bay-row-top';

      if (bulkMode) {
        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.className = 'bulk-bay-check';
        chk.checked = bulkSelected.has(bay.id);
        chk.addEventListener('change', () => {
          if (chk.checked) bulkSelected.add(bay.id); else bulkSelected.delete(bay.id);
          renderAll();
        });
        top.appendChild(chk);
      }

      const num = document.createElement('span');
      num.className = 'bay-num'; num.textContent = bayLabel(sec, bi);
      top.appendChild(num);

      if ((bay.note || '').trim()) {
        const noteIcon = document.createElement('span');
        noteIcon.className = 'bay-note-icon';
        noteIcon.textContent = '📝';
        noteIcon.title = bay.note.trim();
        top.appendChild(noteIcon);
      }

      const warns = bayWarnings(bay);
      if (warns.length) {
        const warnIcon = document.createElement('span');
        warnIcon.className = 'bay-warn-icon';
        warnIcon.textContent = '⚠ ' + warns.length;
        warnIcon.title = warns.join(' · ');
        top.appendChild(warnIcon);
      }

      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'bay-inp';
      inp.value = bay.len.toFixed(2); inp.min = '0.01'; inp.step = '0.01';
      inp.addEventListener('input', e => { bay.len = +parseFloat(e.target.value || 0).toFixed(2); renderSvg(); });

      const rmBay = document.createElement('button');
      rmBay.className = 'remove-btn small'; rmBay.textContent = '×';
      rmBay.addEventListener('click', () => { sec.bays.splice(bi, 1); renderAll(); });

      top.appendChild(inp); top.appendChild(rmBay);

      // Zeile 1b: Höhen links/rechts direkt im Seitenpanel – so muss man für die
      // (häufigste) Änderung nicht extra das Bearbeiten-Sheet öffnen.
      const heightRow = document.createElement('div');
      heightRow.className = 'bay-height-row';

      const makeSideHeight = (labelTxt, key) => {
        const field = document.createElement('div');
        field.className = 'bay-height-field';
        const lab = document.createElement('span');
        lab.className = 'bay-height-label';
        lab.textContent = labelTxt;
        const hInp = document.createElement('input');
        hInp.type = 'number'; hInp.className = 'bay-height-inp';
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
      const hLeftSide  = makeSideHeight('H links',  'hL');
      const hRightSide = makeSideHeight('H rechts', 'hR');
      const hEqBtnSide = document.createElement('button');
      hEqBtnSide.type = 'button'; hEqBtnSide.className = 'bay-height-eq';
      hEqBtnSide.title = 'Beide Höhen gleich setzen'; hEqBtnSide.textContent = '=';
      hEqBtnSide.addEventListener('click', () => {
        const src = bay.hL != null ? bay.hL : bay.hR;
        if (src == null) return;
        bay.hL = src; bay.hR = src;
        hLeftSide.input.value = src.toFixed(2); hRightSide.input.value = src.toFixed(2);
        renderSvg();
      });
      heightRow.appendChild(hLeftSide.field);
      heightRow.appendChild(hEqBtnSide);
      heightRow.appendChild(hRightSide.field);

      // Zeile 2: Längen-Schnellwahl
      const bottom = document.createElement('div');
      bottom.className = 'bay-row-bottom';
      const qd = document.createElement('div');
      qd.className = 'quick-btns';
      FIELD_PRESETS.forEach(l => {
        const qb = document.createElement('button');
        qb.className = 'quick-btn'; qb.textContent = l.toFixed(2);
        qb.addEventListener('click', () => { bay.len = l; inp.value = l.toFixed(2); renderSvg(); });
        qd.appendChild(qb);
      });
      bottom.appendChild(qd);

      // Zeile 3: Positionen (Chips) + Bearbeiten
      const posLine = document.createElement('div');
      posLine.className = 'bay-pos-line';
      if (bay.positions.length) {
        bay.positions.forEach(pos => {
          const p = POS_BY_KEY[pos.cat];
          const chip = document.createElement('span');
          chip.className = 'bay-pos-chip';
          chip.textContent = posTitle(pos, bay);
          if (p) { chip.style.color = p.color; chip.style.borderColor = p.color; }
          posLine.appendChild(chip);
        });
      } else {
        const none = document.createElement('span');
        none.className = 'bay-pos-empty'; none.textContent = 'keine Positionen';
        posLine.appendChild(none);
      }
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'bay-pos-edit';
      editBtn.textContent = '+ Positionen';
      editBtn.addEventListener('click', () => { selectedSi = si; selectedBi = bi; renderSvg(); openEditSheet(si, bi); });
      posLine.appendChild(editBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'bay-pos-copy';
      copyBtn.textContent = 'Kopieren';
      copyBtn.title = 'Höhen + Positionen dieses Feldes kopieren';
      copyBtn.addEventListener('click', () => copyBayPositions(bay));
      posLine.appendChild(copyBtn);

      const pasteBtn = document.createElement('button');
      pasteBtn.type = 'button';
      pasteBtn.className = 'bay-pos-paste' + (copiedBayData ? ' active' : '');
      pasteBtn.textContent = '📋 Einfügen';
      pasteBtn.title = copiedBayData ? 'Kopierte Position auf dieses Feld übertragen' : 'Zuerst ein Feld kopieren';
      pasteBtn.disabled = !copiedBayData;
      pasteBtn.addEventListener('click', () => { pasteBayPositions(bay); renderAll(); });
      posLine.appendChild(pasteBtn);

      row.appendChild(top); row.appendChild(heightRow); row.appendChild(bottom); row.appendChild(posLine);
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
      selectedBi = 0;
      renderAll();
    });

    card.appendChild(hdr); card.appendChild(dirRow); card.appendChild(totEl);
    card.appendChild(baysDiv); card.appendChild(addBayBtn);
    container.appendChild(card);
  });
}

function renderAll() { renderBulkBar(); renderSections(); renderSvg(); }

// ── Preset layouts ─────────────────────────────────────────────────────────

/**
 * Baut eine Kette aus EIGENSTÄNDIGEN Feldern (je Feld eine Single-Bay-Sektion).
 * Jedes Feld bleibt einzeln verschieb- und löschbar; Eckstücke entstehen
 * automatisch dort, wo zwei Felder einen Außenwinkel bilden.
 * @param {Array<{dir:string,len:number,name?:string}>} defs
 */
function buildFieldChain(defs) {
  selectedSi = null; selectedBi = null; _sId = 0; _bId = 0;
  let x = 0, y = 0;
  state.sections = defs.map(def => {
    const s = mkSection(def.dir, x, y);
    if (def.name) s.name = def.name;
    s.bays.push(mkBay(def.len));
    const e = sectionEnd(s); x = e.x; y = e.y;
    return s;
  });
  autoFit = true;
  renderAll();
  updateZoomResetBtn();
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
      autoFit = true;
      renderAll();
      updateZoomResetBtn();
    } catch { alert('Fehler beim Laden: Ungültige Datei.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Seiten-Zuordnung (Auswertung nach Gerüstseite) ──────────────────────────
// Jedes Feld wird einer von vier Gebäudeseiten zugeordnet: Oben/Rechts/Unten/
// Links. Waagerechte Felder liegen ober- oder unterhalb des Schwerpunkts,
// senkrechte links oder rechts davon. So entsteht aus einem beliebigen Plan
// eine saubere Gliederung nach Seite – wie auf dem Aufmaßblatt gewünscht.

const SIDE_ORDER = ['top', 'right', 'bottom', 'left'];
const SIDE_LABEL = {
  top:    'Seite 1 · Oben (Straßenseite)',
  right:  'Seite 2 · Rechts',
  bottom: 'Seite 3 · Unten',
  left:   'Seite 4 · Links'
};

/** Alle Felder mit Welt-Mittelpunkt + Ausrichtung (waagerecht/senkrecht). */
function collectFields() {
  const depth = state.depth * PX_PER_M;
  const list  = [];
  state.sections.forEach(sec => {
    const dir = secVec(sec), o = outVec(dir, sec.flip);
    let x = sec.x0, y = sec.y0;
    sec.bays.forEach(bay => {
      const pxLen = bay.len * PX_PER_M;
      const cx = x + dir.dx * pxLen / 2 + o.dx * depth / 2;
      const cy = y + dir.dy * pxLen / 2 + o.dy * depth / 2;
      list.push({ bay, cx, cy, horiz: Math.abs(dir.dx) >= Math.abs(dir.dy) });
      x += dir.dx * pxLen; y += dir.dy * pxLen;
    });
  });
  return list;
}

/** Ordnet alle Felder den vier Seiten zu → { top:[bay,…], right:[…], … }. */
function fieldsBySide() {
  const groups = { top: [], right: [], bottom: [], left: [] };
  const fields = collectFields();
  if (!fields.length) return groups;
  const mx = fields.reduce((s, f) => s + f.cx, 0) / fields.length;
  const my = fields.reduce((s, f) => s + f.cy, 0) / fields.length;
  fields.forEach(f => {
    const side = f.horiz ? (f.cy <= my ? 'top' : 'bottom')
                         : (f.cx <= mx ? 'left' : 'right');
    groups[side].push(f.bay);
  });
  return groups;
}

/** Aggregiert die Positionen einer Feldmenge (Konsolen nach Typ getrennt). */
function aggregatePositions(bays) {
  const agg = {};
  bays.forEach(bay => {
    (bay.positions || []).forEach(pos => {
      const p = POS_BY_KEY[pos.cat];
      if (!p) return;
      // Konsolen "pro Lage" und "in Metern" werden als getrennte Zeilen
      // geführt, damit beide Abrechnungsarten sauber getrennt bleiben.
      const billing = p.konsole ? (isMeterBilling(pos) ? 'meter' : 'lagen') : null;
      const key   = p.konsole ? 'konsole|' + (pos.typ || '') + '|' + billing : pos.cat;
      const label = p.konsole
        ? 'Konsole ' + (pos.typ || '') + (billing === 'meter' ? ' (m)' : ' (Lagen)')
        : p.label;
      const a = agg[key] || (agg[key] = {
        color: p.color, label, n: 0, lagen: 0, qtyByUnit: {}, meters: 0,
        sort: POSITIONS.findIndex(x => x.key === pos.cat)
      });
      a.n++;
      if (p.konsole) {
        if (billing === 'lagen') {
          const lg = (pos.lagen == null || pos.lagen === 'alle' || pos.lagen === '') ? 0 : (parseInt(pos.lagen, 10) || 0);
          a.lagen += lg;
        }
      } else {
        const u = pos.unit || defaultUnit(pos.cat);
        const v = effQty(pos, bay);
        if (v != null) {
          a.qtyByUnit[u] = (a.qtyByUnit[u] || 0) + v;
          if (u === 'm' || u === 'stgm') a.meters += v;   // Meter-/Steigemeter-Mengen zählen direkt als lfd. Meter
        }
      }
      const m = posMeters(pos, bay);   // Lagen × Feldlänge bzw. Meterwert (Konsolen "in Metern")
      if (m != null) a.meters += m;
    });
  });
  return Object.values(agg).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

/** Mengen-Zelle einer aggregierten Position: Lagen + Mengen je Einheit. */
function aggQtyText(a) {
  const parts = [];
  if (a.lagen) parts.push(a.lagen === 1 ? '1 Lage' : a.lagen + ' Lagen');
  UNIT_DEFS.forEach(([u, lbl]) => { if (a.qtyByUnit[u]) parts.push(fmtQty(a.qtyByUnit[u]) + ' ' + lbl); });
  return parts.join(' · ') || '–';
}

/* ── PDF-Export (Vektor) ─────────────────────────────────────────────────────
   Der Plan wird NICHT mehr als Screenshot der Zeichenfläche eingebettet,
   sondern direkt als Vektorgrafik (Linien, Flächen, Text) in die PDF
   gezeichnet. Zwei Gründe:
     • Dateigröße: ein hochauflösendes PNG der gesamten Zeichenfläche wurde bei
       großen Gerüsten dreistellig MB groß. Vektorseiten liegen im KB-Bereich.
     • Lesbarkeit: Schriftgrößen sind in Punkt festgelegt und werden NICHT mit
       der Zeichnung mitskaliert. Passt das Gerüst bei lesbarem Maßstab nicht
       auf eine Seite, wird es automatisch auf mehrere Seiten aufgeteilt statt
       unlesbar klein gequetscht.                                             */

// Papier & Maßstab
const PDF_MARGIN       = 10;     // mm Seitenrand
const PDF_MM_PER_M_MIN = 11;     // mind. 11 mm je Meter (≈ 1:91) – Baustellen-lesbar
const PDF_MM_PER_M_MAX = 45;     // höchstens 45 mm je Meter (≈ 1:22)

// Schriftgrößen in pt – bewusst fix, damit auf Papier nichts unter die
// Lesbarkeitsgrenze rutscht.
const PDF_FS_LEN   = 8.5;   // Feldlänge
const PDF_FS_H     = 7.5;   // Höhenangaben
const PDF_FS_LABEL = 7;     // Feldbezeichnung (A1 …)
const PDF_FS_BADGE = 6.5;   // Positions-Badges

/** #rrggbb → [r,g,b] */
function pdfHex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Polygon aus Punkten (in mm) zeichnen. style: 'F' | 'S' | 'FD' */
function pdfPoly(doc, pts, style) {
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push([pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y]);
  doc.lines(d, pts[0].x, pts[0].y, [1, 1], style, true);
}

/** Auf (cx,cy) ZENTRIERTER Text mit optionaler Drehung.
 *  `deg` folgt dem SVG-Drehsinn (im Uhrzeigersinn positiv).
 *  jsPDF ignoriert align/baseline bei gedrehtem Text, deshalb wird der
 *  Startpunkt hier selbst aus Textbreite und Schrifthöhe berechnet. */
function pdfText(doc, str, cx, cy, deg) {
  const th = -(deg || 0) * Math.PI / 180;
  const w  = doc.getTextWidth(str);
  const fs = doc.getFontSize() * 0.352778;          // pt → mm
  const ax = Math.cos(th), ay = -Math.sin(th);      // Laufrichtung des Textes
  const dx = Math.sin(th), dy = Math.cos(th);       // quer dazu, "nach unten"
  doc.text(str,
    cx - ax * w / 2 + dx * fs * 0.35,
    cy - ay * w / 2 + dy * fs * 0.35,
    deg ? { angle: -deg } : {});
}

/** Größte Schriftgröße ≤ `pref`, mit der `str` in `maxMM` passt (nie unter `min`). */
function pdfFitFont(doc, str, maxMM, pref, min) {
  doc.setFontSize(pref);
  const w = doc.getTextWidth(str);
  const fs = w <= maxMM ? pref : Math.max(min, pref * maxMM / w);
  doc.setFontSize(fs);
  return fs;
}

/** Gedrehte Pille (gefüllte, umrandete Fläche) mit zentriertem Text. */
function pdfPill(doc, str, cx, cy, deg, fill, stroke, textCol) {
  const th = -(deg || 0) * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const fs = doc.getFontSize() * 0.352778;
  const w  = doc.getTextWidth(str) + fs * 0.8;
  const h  = fs * 1.5;
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => ({ x: cx + x * cos + y * sin, y: cy - x * sin + y * cos }));
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
  doc.setLineWidth(0.25);
  pdfPoly(doc, pts, 'FD');
  doc.setTextColor(textCol[0], textCol[1], textCol[2]);
  pdfText(doc, str, cx, cy, deg);
}

/** Bounding-Box eines Feld-Elements (Welt-px). */
function elBBox(el) {
  const xs = el.pts.map(p => p.x), ys = el.pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Zeichnet einen Ausschnitt des Plans als Vektor auf die aktuelle Seite.
 * @param win  sichtbarer Weltausschnitt { minX, minY, w, h }
 * @param area Papierbereich in mm { x, y, w, h }
 * @param s    Maßstab in mm je Welt-px
 * @param bayEls  zu zeichnende Feld-Elemente (bereits gefiltert)
 * @param layout  vollständiges computeLayout() (für Ecken/Wandlinien)
 * @param shapesOnly  true = nur Flächen zeichnen (Übersichtskarte)
 */
function pdfDrawPlan(doc, win, area, s, bayEls, layout, shapesOnly) {
  // Ausschnitt mittig im verfügbaren Bereich platzieren
  const originX = area.x + (area.w - win.w * s) / 2 - win.minX * s;
  const originY = area.y + (area.h - win.h * s) / 2 - win.minY * s;
  const P  = p => ({ x: originX + p.x * s, y: originY + p.y * s });
  const XY = (x, y) => ({ x: originX + x * s, y: originY + y * s });

  const depth   = state.depth * PX_PER_M;
  const drawSet = new Set(bayEls.map(e => e.si + ':' + e.bi));

  // 1. Eckstücke (nur die, deren Nachbarfelder auf dieser Seite liegen)
  doc.setDrawColor(44, 111, 168); doc.setLineWidth(0.4);
  doc.setFillColor(181, 212, 240);
  layout.filter(e => e.type === 'corner').forEach(el => {
    const b = elBBox(el);
    if (b.maxX < win.minX || b.minX > win.minX + win.w) return;
    if (b.maxY < win.minY || b.minY > win.minY + win.h) return;
    pdfPoly(doc, el.pts.map(P), 'FD');
  });

  // 2. Wandlinien – am Rand des Ausschnitts abgeschnitten (Liang-Barsky),
  //    damit auf einer Seite keine Linie ins Nichts weiterläuft.
  doc.setDrawColor(90, 107, 122); doc.setLineWidth(0.3);
  const clipSeg = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const edges = [[-dx, x1 - win.minX], [dx, win.minX + win.w - x1],
                   [-dy, y1 - win.minY], [dy, win.minY + win.h - y1]];
    for (const [pE, qE] of edges) {
      if (pE === 0) { if (qE < 0) return null; continue; }
      const r = qE / pE;
      if (pE < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else        { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
  };
  layout.filter(e => e.type === 'wallLine').forEach(el => {
    const seg = clipSeg(el.x1, el.y1, el.x2, el.y2);
    if (!seg) return;
    const a = XY(seg[0], seg[1]), b = XY(seg[2], seg[3]);
    doc.line(a.x, a.y, b.x, b.y);
  });

  // 3. Felder
  bayEls.forEach(el => {
    const bay = state.sections[el.si].bays[el.bi];
    normalizeBay(bay);
    doc.setFillColor(222, 238, 255);
    doc.setDrawColor(44, 111, 168); doc.setLineWidth(0.45);
    pdfPoly(doc, el.pts.map(P), 'FD');
  });

  // 4. Beschriftungen – nach den Flächen, damit nichts überdeckt wird.
  //    Auf der Übersichtsseite entfallen sie: dort ist der Maßstab bewusst
  //    klein, Text würde sich nur überlagern.
  if (shapesOnly) { doc.setTextColor(0, 0, 0); return; }

  // Die Gerüsttiefe ist im Grundriss nur ~0,7 m breit. Damit auf Papier nichts
  // ineinanderläuft, sitzt im Feld selbst NUR die Feldlänge; Feldbezeichnung
  // liegt an der Wandseite, Höhen und Positionen gestapelt an der offenen
  // Seite – jeweils längs zum Feld gedreht und auf die Feldlänge eingepasst.
  const depthMM = depth * s;
  bayEls.forEach(el => {
    const bay = state.sections[el.si].bays[el.bi];
    const rot = uprightDeg(el.ang);
    const [p0, p1, p2, p3] = el.pts;
    const c   = XY((p0.x + p1.x + p2.x + p3.x) / 4, (p0.y + p1.y + p2.y + p3.y) / 4);

    // Auswärtsrichtung (Wand → offene Seite) im Papierkoordinatensystem
    const wallMid  = P({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
    let ox = c.x - wallMid.x, oy = c.y - wallMid.y;
    const olen = Math.hypot(ox, oy) || 1; ox /= olen; oy /= olen;

    const lenMM  = el.len * PX_PER_M * s;
    const maxTxt = lenMM * 0.92;

    // Feldlänge mittig im Feld
    doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 47, 88);
    pdfFitFont(doc, el.len.toFixed(2).replace('.', ','), maxTxt, PDF_FS_LEN, 5.5);
    pdfText(doc, el.len.toFixed(2).replace('.', ','), c.x, c.y, rot);

    // Feldbezeichnung an der Wandseite
    const label = bayLabel(state.sections[el.si], el.bi);
    doc.setFont('helvetica', 'bold');
    const lblFs = pdfFitFont(doc, label, maxTxt, PDF_FS_LABEL, 5.5);
    const lblD  = depthMM / 2 + lblFs * 0.352778 * 1.0;
    pdfPill(doc, label, c.x - ox * lblD, c.y - oy * lblD, rot,
            [10, 47, 88], [10, 47, 88], [255, 255, 255]);

    // Offene Seite: Höhen, darunter je Position eine Zeile
    const lines = [];
    const hL = bay.hL != null ? bay.hL.toFixed(2).replace('.', ',') : null;
    const hR = bay.hR != null ? bay.hR.toFixed(2).replace('.', ',') : null;
    if (hL || hR) {
      lines.push({
        text: hL && hR ? (hL === hR ? 'h ' + hL : hL + ' | ' + hR) : 'h ' + (hL || hR),
        fill: [240, 249, 243], stroke: [31, 122, 61], col: [22, 92, 45], fs: PDF_FS_H
      });
    }
    (bay.positions || []).forEach(pos => {
      const meta = POS_BY_KEY[pos.cat];
      const col  = pdfHex((meta && meta.color) || '#333333');
      lines.push({ text: posBadge(pos, bay), fill: [255, 255, 255], stroke: col, col, fs: PDF_FS_BADGE });
    });

    let dist = depthMM / 2;
    lines.forEach(ln => {
      doc.setFont('helvetica', 'bold');
      const fs = pdfFitFont(doc, ln.text, maxTxt, ln.fs, 5.5);
      const h  = fs * 0.352778 * 1.5;
      dist += h * 0.62;
      pdfPill(doc, ln.text, c.x + ox * dist, c.y + oy * dist, rot, ln.fill, ln.stroke, ln.col);
      dist += h * 0.48;
    });
  });

  doc.setTextColor(0, 0, 0);
}

/** Kleine Übersichtskarte: ganzes Gerüst grau, der aktuelle Ausschnitt blau. */
function pdfDrawLocator(doc, bounds, win, box) {
  const s = Math.min(box.w / Math.max(bounds.w, 1), box.h / Math.max(bounds.h, 1)) * 0.9;
  const ox = box.x + (box.w - bounds.w * s) / 2 - bounds.minX * s;
  const oy = box.y + (box.h - bounds.h * s) / 2 - bounds.minY * s;

  doc.setDrawColor(200, 205, 212); doc.setLineWidth(0.2);
  doc.setFillColor(252, 253, 255);
  doc.rect(box.x, box.y, box.w, box.h, 'FD');

  doc.setFillColor(196, 205, 214); doc.setDrawColor(196, 205, 214);
  state.sections.forEach(sec => {
    sectionBayPolys(sec, sec.x0, sec.y0).forEach(poly => {
      pdfPoly(doc, poly.map(p => ({ x: ox + p.x * s, y: oy + p.y * s })), 'F');
    });
  });

  doc.setDrawColor(0, 122, 255); doc.setLineWidth(0.5);
  doc.rect(ox + win.minX * s, oy + win.minY * s, win.w * s, win.h * s, 'S');
}

/** Ermittelt die Papierseiten-Aufteilung des Plans. */
function pdfPlanPages(layout, availW, availH) {
  const bayEls = layout.filter(e => e.type === 'bay');
  const bounds = contentBounds();
  if (!bayEls.length || !bounds) return { pages: [], bounds: null, scale: 0 };

  const pad = state.depth * PX_PER_M * 0.9;
  const full = {
    minX: bounds.minX - pad, minY: bounds.minY - pad,
    w: bounds.w + pad * 2,   h: bounds.h + pad * 2
  };

  const sMin = PDF_MM_PER_M_MIN / PX_PER_M;
  const sMax = PDF_MM_PER_M_MAX / PX_PER_M;
  const sFit = Math.min(availW / full.w, availH / full.h);

  // Passt alles bei lesbarem Maßstab auf eine Seite → genau eine Planseite.
  if (sFit >= sMin) {
    return { pages: [{ win: full, els: bayEls }], bounds: full, scale: Math.min(sFit, sMax), tiled: false };
  }

  // Sonst kacheln. Die Kachel wird um die größte Feldausdehnung verkleinert,
  // damit ein Feld, das gerade noch zur Kachel gehört, garantiert vollständig
  // auf die Seite passt – es wird also nie mitten durch ein Feld geschnitten.
  let bayExtent = 0;
  bayEls.forEach(el => {
    const b = elBBox(el);
    bayExtent = Math.max(bayExtent, b.maxX - b.minX, b.maxY - b.minY);
  });
  const tileW = Math.max(availW / sMin - bayExtent, availW / sMin * 0.4);
  const tileH = Math.max(availH / sMin - bayExtent, availH / sMin * 0.4);

  const cols = Math.max(1, Math.ceil(full.w / tileW));
  const rows = Math.max(1, Math.ceil(full.h / tileH));
  const stepX = cols > 1 ? full.w / cols : full.w;
  const stepY = rows > 1 ? full.h / rows : full.h;

  const pages = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = {
        minX: full.minX + c * stepX, maxX: full.minX + (c + 1) * stepX,
        minY: full.minY + r * stepY, maxY: full.minY + (r + 1) * stepY
      };
      // Zuordnung über den Feld-MITTELPUNKT → jedes Feld landet auf genau
      // einer Seite, wird dort aber vollständig gezeichnet.
      const els = bayEls.filter(el => {
        const b = elBBox(el);
        const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
        return mx >= rect.minX && (mx < rect.maxX || c === cols - 1)
            && my >= rect.minY && (my < rect.maxY || r === rows - 1);
      });
      if (!els.length) continue;

      // Fensterausschnitt = Hüllbox der zugeordneten Felder (+ Rand)
      let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
      els.forEach(el => {
        const b = elBBox(el);
        mnX = Math.min(mnX, b.minX); mxX = Math.max(mxX, b.maxX);
        mnY = Math.min(mnY, b.minY); mxY = Math.max(mxY, b.maxY);
      });
      pages.push({
        win: { minX: mnX - pad, minY: mnY - pad, w: (mxX - mnX) + pad * 2, h: (mxY - mnY) + pad * 2 },
        els
      });
    }
  }

  // Die Kacheln wurden für den Mindestmaßstab gebildet. Bleibt danach auf allen
  // Seiten Platz übrig (typisch bei schmalen, langen Gerüsten), wird EIN
  // gemeinsamer, größerer Maßstab gewählt – alle Planseiten behalten so
  // denselben Maßstab, nutzen aber das Blatt voll aus.
  let maxW = 0, maxH = 0;
  pages.forEach(pg => { maxW = Math.max(maxW, pg.win.w); maxH = Math.max(maxH, pg.win.h); });
  const sUsed = Math.max(sMin, Math.min(sMax, availW / maxW, availH / maxH));
  return { pages, bounds: full, scale: sUsed, tiled: true };
}

let pdfBusy    = false;
let pdfLastDone = 0;
const PDF_COOLDOWN_MS = 800;   // Schutz gegen ungeduldiges Doppeltippen

/** Klick-Handler des PDF-Buttons: genau ein Export je Klick. */
async function exportPdf() {
  // Läuft bereits ein Export – oder ist gerade eben einer fertig geworden –,
  // laufen weitere Klicks bewusst ins Leere.
  if (pdfBusy || Date.now() - pdfLastDone < PDF_COOLDOWN_MS) return;
  pdfBusy = true;
  const btn      = document.getElementById('exportPdfBtn');
  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'PDF wird erstellt …'; }
  // Ein Frame Pause, damit der Button-Zustand sichtbar wird, bevor der
  // (synchrone) Aufbau der PDF startet.
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    await buildPdf();
  } catch (err) {
    console.error('PDF-Export fehlgeschlagen:', err);
    showToast('PDF konnte nicht erstellt werden.');
  } finally {
    pdfBusy     = false;
    pdfLastDone = Date.now();
    if (btn) { btn.disabled = false; btn.textContent = prevText; }
  }
}

async function buildPdf() {
  const { jsPDF } = window.jspdf;
  const layout = computeLayout();
  const margin = PDF_MARGIN;
  const headerH = 19;

  // Hoch- oder Querformat? Es gewinnt die Ausrichtung, die bei lesbarem
  // Mindestmaßstab mit WENIGER Planseiten auskommt (bei Gleichstand die mit
  // dem größeren Maßstab) – lange Fassaden landen so im Querformat.
  const cand = ['landscape', 'portrait'].map(o => {
    const w = o === 'landscape' ? 297 : 210;
    const h = o === 'landscape' ? 210 : 297;
    return { orient: o, pdfW: w, pdfH: h,
             plan: pdfPlanPages(layout, w - 2 * margin, h - 2 * margin - headerH) };
  }).sort((a, b) => (a.plan.pages.length - b.plan.pages.length) || (b.plan.scale - a.plan.scale));

  const { orient, pdfW, pdfH, plan } = cand[0];
  const doc    = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4', compress: true });
  const availW = pdfW - 2 * margin;

  const totalLen     = state.sections.reduce((a, s) => a + s.bays.reduce((b, x) => b + x.len, 0), 0);
  const totalFlaeche = computeTotalFlaeche();
  const dateStr      = new Date().toLocaleDateString('de-DE');
  const title        = state.project || 'Gerüst 2D-Ansicht';

  /** Kopfzeile einer Planseite; liefert die Oberkante des Zeichenbereichs. */
  const drawHeader = (sub, scaleTxt) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
    doc.text(title, margin, margin + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 70, 70);
    doc.text(`Gerüsttiefe: ${state.depth.toFixed(2).replace('.', ',')} m   |   Gesamtlänge: ${fmtQty(totalLen)} m   |   Gesamtfläche: ${fmtQty(totalFlaeche)} m²`,
             margin, margin + 10.5);
    doc.text(`Datum: ${dateStr}`, margin, margin + 15);
    if (sub) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(31, 78, 121);
      doc.text(sub, pdfW - margin, margin + 5, { align: 'right' });
    }
    if (scaleTxt) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 110, 110);
      doc.text(scaleTxt, pdfW - margin, margin + 10.5, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
    return margin + 19;
  };

  const planTop    = margin + headerH;
  const planAvailH = pdfH - planTop - margin;

  if (!plan.pages.length) {
    drawHeader('', '');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90, 90, 90);
    doc.text('Keine Gerüstfelder erfasst.', margin, planTop + 10);
  } else {
    const scaleTxt = 'Maßstab ca. 1:' + Math.round(10 / plan.scale);

    // Bei mehrseitigem Plan zuerst eine Übersichtsseite mit Seiteneinteilung –
    // sie zeigt, welcher Ausschnitt auf welcher Seite steht.
    if (plan.tiled) {
      const oTop = drawHeader(`Übersicht · Plan auf ${plan.pages.length} Seiten`, '');
      const oArea = { x: margin, y: oTop, w: availW, h: planAvailH };
      const oScale = Math.min(oArea.w / plan.bounds.w, oArea.h / plan.bounds.h);
      const oWin  = { minX: plan.bounds.minX, minY: plan.bounds.minY, w: plan.bounds.w, h: plan.bounds.h };
      pdfDrawPlan(doc, oWin, oArea, oScale, layout.filter(e => e.type === 'bay'), layout, true);

      const ox = oArea.x + (oArea.w - oWin.w * oScale) / 2 - oWin.minX * oScale;
      const oy = oArea.y + (oArea.h - oWin.h * oScale) / 2 - oWin.minY * oScale;
      doc.setDrawColor(0, 122, 255); doc.setLineWidth(0.45);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      plan.pages.forEach((pg, i) => {
        doc.rect(ox + pg.win.minX * oScale, oy + pg.win.minY * oScale,
                 pg.win.w * oScale, pg.win.h * oScale, 'S');
        doc.setFillColor(0, 122, 255);
        doc.circle(ox + (pg.win.minX + 3) * oScale, oy + (pg.win.minY + 3) * oScale, 2.6, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(String(i + 1), ox + (pg.win.minX + 3) * oScale, oy + (pg.win.minY + 3) * oScale,
                 { align: 'center', baseline: 'middle' });
      });
      doc.setTextColor(0, 0, 0);
    }

    plan.pages.forEach((pg, i) => {
      if (plan.tiled || i > 0) doc.addPage();
      const labels = pg.els.map(el => bayLabel(state.sections[el.si], el.bi));
      const sub = plan.tiled
        ? `Ausschnitt ${i + 1} von ${plan.pages.length} · ${labels[0]} – ${labels[labels.length - 1]}`
        : '';
      const top  = drawHeader(sub, scaleTxt);
      const area = { x: margin, y: top, w: availW, h: pdfH - top - margin };
      pdfDrawPlan(doc, pg.win, area, plan.scale, pg.els, layout);

      // Mini-Orientierungskarte rechts unten
      if (plan.tiled) {
        const lw = Math.min(52, availW * 0.28), lh = lw * 0.62;
        pdfDrawLocator(doc, plan.bounds, pg.win,
                       { x: pdfW - margin - lw, y: pdfH - margin - lh, w: lw, h: lh });
      }
    });
  }

  // ── Aufmaß nach Gerüstseite ───────────────────────────────────────────
  // Je Gebäudeseite (Oben/Rechts/Unten/Links) eine Tabelle, am Ende eine
  // Gesamt-Tabelle über alle Seiten – Material-/Bestellgrundlage.
  const allBays = state.sections.flatMap(s => s.bays);
  const anyPos  = allBays.some(b => (b.positions || []).length);

  if (anyPos) {
    const groups = fieldsBySide();
    const sideBlocks = SIDE_ORDER
      .map(side => ({ side, bays: groups[side] }))
      .filter(b => b.bays.some(bay => (bay.positions || []).length));

    const tableW = availW;
    const cols = [
      { title: 'Position',   w: 0.42, align: 'left'   },
      { title: 'Anzahl',     w: 0.13, align: 'center' },
      { title: 'Menge',      w: 0.27, align: 'left'   },
      { title: 'lfd. Meter', w: 0.18, align: 'right'  }
    ];
    const colX = []; let acc = margin;
    cols.forEach(c => { colX.push(acc); acc += c.w * tableW; });
    const colMid   = i => colX[i] + cols[i].w * tableW / 2;
    const colRight = i => colX[i] + cols[i].w * tableW - 2.5;
    const rowH = 7, headH = 7, sideHdrH = 8.5;

    doc.addPage();
    let py = margin + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 20);
    doc.text('Aufmaß nach Gerüstseite', margin, py);
    py += 9;

    const drawColHeader = () => {
      doc.setFillColor(236, 239, 243);
      doc.rect(margin, py, tableW, headH, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70);
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? colRight(i) : c.align === 'center' ? colMid(i) : colX[i] + (i === 0 ? 8 : 2);
        doc.text(c.title, tx, py + headH - 2.2, { align: c.align });
      });
      py += headH;
    };

    const drawRow = (a, shade) => {
      if (shade) { doc.setFillColor(247, 249, 251); doc.rect(margin, py, tableW, rowH, 'F'); }
      const [r, g2, b2] = pdfHex(a.color);
      doc.setFillColor(r, g2, b2); doc.setDrawColor(130, 130, 130); doc.setLineWidth(0.2);
      doc.rect(colX[0] + 1.5, py + rowH / 2 - 2, 4, 4, 'FD');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(25, 25, 25);
      doc.text(a.label, colX[0] + 8, py + rowH - 2.7);
      doc.text(a.n + '×', colMid(1), py + rowH - 2.7, { align: 'center' });
      doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      doc.text(aggQtyText(a), colX[2] + 2, py + rowH - 2.7);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 25, 25);
      doc.text(a.meters ? fmtQty(a.meters) + ' m' : '–', colRight(3), py + rowH - 2.7, { align: 'right' });
      py += rowH;
      doc.setDrawColor(224, 227, 231); doc.setLineWidth(0.1);
      doc.line(margin, py, margin + tableW, py);
    };

    const drawTable = (ttl, subtitle, aggList) => {
      // Passt die ganze Tabelle nicht mehr auf die Seite, aber auf eine leere
      // Seite → komplett umbrechen, damit Tabellen nicht zerrissen werden.
      const tableH = sideHdrH + headH + aggList.length * rowH;
      if (py + tableH > pdfH - margin && tableH <= pdfH - 2 * margin - 6) { doc.addPage(); py = margin + 6; }
      else if (py + sideHdrH + headH + rowH > pdfH - margin) { doc.addPage(); py = margin + 6; }
      doc.setFillColor(31, 78, 121);
      doc.rect(margin, py, tableW, sideHdrH, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
      doc.text(ttl, margin + 3, py + sideHdrH - 2.7);
      if (subtitle) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(subtitle, margin + tableW - 3, py + sideHdrH - 2.7, { align: 'right' });
      }
      py += sideHdrH;
      drawColHeader();
      aggList.forEach((a, i) => {
        if (py + rowH > pdfH - margin) { doc.addPage(); py = margin + 6; drawColHeader(); }
        drawRow(a, i % 2 === 1);
      });
      py += 6;
    };

    sideBlocks.forEach(({ side, bays }) => {
      const len  = bays.reduce((s, b) => s + b.len, 0);
      const flae = bays.reduce((s, b) => s + bayFlaecheM2(b), 0);
      const cnt  = bays.filter(bay => (bay.positions || []).length).length;
      drawTable(SIDE_LABEL[side], `${cnt} Felder · ${fmtQty(len)} m · ${fmtQty(flae)} m²`, aggregatePositions(bays));
    });

    const totalLenAll = allBays.reduce((s, b) => s + b.len, 0);
    drawTable('Gesamt · alle Seiten', `${allBays.length} Felder · ${fmtQty(totalLenAll)} m · ${fmtQty(totalFlaeche)} m²`, aggregatePositions(allBays));
  }

  // ── Notizen ────────────────────────────────────────────────────────────
  const notedFields = [];
  state.sections.forEach(sec => {
    sec.bays.forEach((bay, bi) => {
      if ((bay.note || '').trim()) notedFields.push({ label: bayLabel(sec, bi), note: bay.note.trim() });
    });
  });
  if (notedFields.length) {
    doc.addPage();
    let ny = margin + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 20);
    doc.text('Notizen', margin, ny);
    ny += 9;
    notedFields.forEach(({ label, note }) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(25, 25, 25);
      const lines = doc.splitTextToSize(note, availW - 22);
      const blockH = 6 + lines.length * 5 + 3;
      if (ny + blockH > pdfH - margin) { doc.addPage(); ny = margin + 6; }
      doc.text(label + ':', margin, ny);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60);
      doc.text(lines, margin + 22, ny);
      ny += Math.max(6, lines.length * 5) + 3;
    });
  }

  // ── Fotos ──────────────────────────────────────────────────────────────
  // Bereits beim Import auf max. 1600 px / JPEG q0.72 komprimiert; sie werden
  // unverändert eingebettet (kein erneutes Rastern) und bleiben so klein.
  if (linkedProjectId) {
    const photos = (await listProjectPhotos(linkedProjectId)).filter(p => p.include !== false);
    photos.forEach((photo, i) => {
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
      doc.text(`Foto ${i + 1} von ${photos.length}`, margin, margin + 5);
      const photoAvailH = pdfH - margin - (margin + 10) - margin;
      const ratio = Math.min(availW / photo.w, photoAvailH / photo.h);
      const pw = photo.w * ratio, ph = photo.h * ratio;
      const px = margin + (availW - pw) / 2;
      doc.addImage(photo.dataUrl, 'JPEG', px, margin + 10, pw, ph, undefined, 'FAST');
    });
  }

  // Seitenzahlen
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
    doc.text(`Seite ${i} von ${pageCount}`, pdfW - margin, pdfH - 4, { align: 'right' });
  }

  doc.save(`${title.replace(/[\\/:*?"<>|\s]+/g, '_')}_2d.pdf`);
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
  loadFromLinkedProject();
  // Ausgangs-Snapshot SOFORT (synchron) setzen, nicht erst über das Debounce –
  // sonst würde eine schnelle erste Aktion (z. B. direkt nach dem Laden eine
  // Vorlage wählen) den Ausgangszustand überschreiben, bevor er als
  // Vergleichsbasis übernommen wurde, und der erste Undo-Schritt ginge verloren.
  lastUndoSnapshot = serializeUndoState();
  document.getElementById('projectName').value = state.project;
  document.getElementById('scaffDepth').value  = state.depth;
  if (linkedProjectId) {
    const backLink = document.querySelector('.back-link');
    if (backLink) backLink.setAttribute('href', 'index.html?resume=1');
  }

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
    scheduleAutosave2d();
  });
  document.getElementById('scaffDepth').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.depth = v; renderSvg(); }
  });

  document.getElementById('savePlanBtn').addEventListener('click', savePlan);
  document.getElementById('loadPlanBtn').addEventListener('click', triggerLoad);
  document.getElementById('loadFileInput').addEventListener('change', onLoadFile);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);

  document.getElementById('photosBtn').addEventListener('click', openPhotosSheet);
  document.getElementById('photoFileInput').addEventListener('change', onPhotoFilesSelected);

  document.getElementById('deviceToggleBtn').addEventListener('click', () => {
    showDevicePicker(() => renderAll());
  });

  document.getElementById('snapToggleBtn').addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    const btn = document.getElementById('snapToggleBtn');
    btn.classList.toggle('snap-off', !snapEnabled);
    btn.title = snapEnabled ? 'Magnetraster: An – tippen zum Ausschalten' : 'Magnetraster: Aus – tippen zum Einschalten';
  });

  document.getElementById('undoBtn')?.addEventListener('click', performUndo);
  document.getElementById('redoBtn')?.addEventListener('click', performRedo);
  document.getElementById('shakeUndoBtn')?.addEventListener('click', toggleShakeUndo);
  updateUndoRedoButtons();

  // Tastaturkürzel Strg/Cmd+Z (Rückgängig) und Strg/Cmd+Umschalt+Z bzw. +Y
  // (Wiederholen) – nicht aktiv, während in einem Text-/Zahlenfeld getippt
  // wird, damit das native Undo dort (z. B. einen Tippfehler rückgängig
  // machen) weiter normal funktioniert.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); performRedo(); }
  });

  const svg = document.getElementById('planSvg');
  svg.addEventListener('pointermove',   onSvgPointerMove);
  svg.addEventListener('pointerup',     onSvgPointerUp);
  svg.addEventListener('pointercancel', onSvgPointerUp);
  // Tap empty canvas → deselect section (hides + buttons)
  const deselect = () => {
    if (canvasJustMoved) { canvasJustMoved = false; return; }   // Tap direkt nach Pan/Pinch → nicht abwählen
    if (selectedSi !== null) { selectedSi = null; selectedBi = null; renderSvg(); }
  };
  svg.addEventListener('click',       deselect);
  svg.addEventListener('pointerdown', e => { if (e.target === svg || e.target.id === 'gridBg') deselect(); });

  // Pinch-Zoom & Pan (ein/zwei Finger) – nach den bestehenden Handle-Listenern,
  // damit Verschiebe-/Dreh-Griffe (die stopPropagation() aufrufen) Vorrang haben.
  svg.addEventListener('pointerdown',   onCanvasPointerDown);
  svg.addEventListener('pointermove',   onCanvasPointerMove);
  svg.addEventListener('pointerup',     onCanvasPointerUp);
  svg.addEventListener('pointercancel', onCanvasPointerUp);
  svg.addEventListener('wheel',         onCanvasWheel, { passive: false });
  svg.addEventListener('dblclick',      onCanvasDblClick);

  // Panelgröße ändert sich (Drehen des iPads, Seitenleiste, Tastatur) → nur die
  // viewBox nachziehen, damit die Kamera exakt dieselbe Stelle zeigt.
  if (window.ResizeObserver) {
    new ResizeObserver(() => { _vpCache = null; if (autoFit) fitCameraToContent(); applyCamera(); })
      .observe(document.getElementById('viewerPanel'));
  } else {
    window.addEventListener('resize', () => { _vpCache = null; if (autoFit) fitCameraToContent(); applyCamera(); });
  }
  window.addEventListener('scroll', () => { _vpCache = null; }, { passive: true });

  document.getElementById('zoomResetBtn')?.addEventListener('click', resetCanvasView);
  document.getElementById('fitViewBtn')?.addEventListener('click', resetCanvasView);

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
