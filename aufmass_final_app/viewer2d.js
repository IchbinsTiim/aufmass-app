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

/** Gerüstfläche (m²) einer Feldmenge. */
function sumFlaecheM2(bays) {
  return +bays.reduce((s, b) => s + bayFlaecheM2(b), 0).toFixed(2);
}

/** Gesamtgerüstfläche (m²) über alle Felder der Zeichnung. */
function computeTotalFlaeche() {
  let total = 0;
  state.sections.forEach(sec => sec.bays.forEach(bay => { total += bayFlaecheM2(bay); }));
  return +total.toFixed(2);
}

/** Aktualisiert die Live-Anzeige der Gesamtfläche im Toolbar. Gezeigt wird die
 *  Fläche dessen, was gerade GEZEICHNET ist – ausgeblendete Abschnitte werden
 *  getrennt ausgewiesen, damit klar bleibt, dass sie nur unsichtbar und nicht
 *  gelöscht sind. */
function updateAreaReadout() {
  const el = document.getElementById('areaReadout');
  if (!el) return;
  const sichtbar = sumFlaecheM2(visibleBaysFlat());
  const gesamt   = computeTotalFlaeche();
  const versteckt = +(gesamt - sichtbar).toFixed(2);
  el.textContent = 'Gesamtfläche: ' + sichtbar.toFixed(2).replace('.', ',') + ' m²'
    + (versteckt > 0 ? '  (+ ' + versteckt.toFixed(2).replace('.', ',') + ' m² ausgeblendet)' : '');
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

/* ── Abschnitte (Unterkategorien) ────────────────────────────────────────────
   Ein Abschnitt bündelt beliebig viele Felder unter einem frei wählbaren Namen
   ("Nordseite", "Abschnitt A", "Bauteil 2" …). Die Zuordnung ist optional:
   jedes Feld trägt höchstens eine `abschnittId`; Felder ohne Zuordnung
   funktionieren unverändert weiter und laufen in Auswertungen unter
   „Ohne Abschnitt". Abschnitte leben in `state.abschnitte` und werden mit der
   Zeichnung gespeichert (Datei, Projekt-Autosave, Undo).                     */

// Farbpalette der Abschnitte – bewusst kräftig und gut unterscheidbar, auch
// im Graustufendruck (unterschiedliche Helligkeiten).
const ABSCHNITT_COLORS = [
  '#1f6fb2', '#c0392b', '#1f8a4c', '#b8860b', '#6a4bd1',
  '#0f8f8e', '#d1560b', '#a5237e', '#4a5f7a', '#7a6a2c'
];

let _aId = 0;

/** Liste aller Abschnitte (legt sie bei Altdaten transparent an). */
function abschnitteList() {
  if (!Array.isArray(state.abschnitte)) state.abschnitte = [];
  return state.abschnitte;
}

function mkAbschnitt(name) {
  const id = 'ab' + (++_aId);
  const used = abschnitteList().length;
  return {
    id, name: name || `Abschnitt ${used + 1}`,
    color: ABSCHNITT_COLORS[used % ABSCHNITT_COLORS.length],
    hidden: false
  };
}

function abschnittById(id) {
  if (!id) return null;
  return abschnitteList().find(a => a.id === id) || null;
}

/** Anzeigename eines Abschnitts (auch für nicht/unbekannt zugeordnete Felder). */
function abschnittName(id) {
  const a = abschnittById(id);
  return a ? a.name : 'Ohne Abschnitt';
}

/** Farbe eines Abschnitts; ohne Zuordnung neutrales Grau. */
function abschnittColor(id) {
  const a = abschnittById(id);
  return a ? a.color : '#8a97a5';
}

function addAbschnitt(name) {
  const a = mkAbschnitt(name);
  abschnitteList().push(a);
  return a;
}

/* ── Sichtbarkeit von Abschnitten ────────────────────────────────────────────
   Ein Abschnitt kann ausgeblendet werden: seine Felder verschwinden von der
   Zeichenfläche, bleiben aber VOLLSTÄNDIG im Datenmodell (Länge, Höhen,
   Positionen, Notiz, Zuordnung). Ausblenden ist also reine Ansichtssache und
   nie Datenverlust – Einblenden stellt exakt denselben Stand wieder her.
   Felder ohne Abschnitt lassen sich über denselben Weg ausblenden
   (`state.hideUnassigned`).
   Für den PDF-Export gilt standardmäßig „nur sichtbare Abschnitte"; im
   PDF-Dialog lässt sich das je Export umschalten (siehe pdfIncludeHidden).  */

// Solange gesetzt, gelten ALLE Abschnitte als sichtbar. Wird ausschließlich vom
// PDF-Export benutzt, der ausgeblendete Abschnitte auf Wunsch mit ausgibt –
// die Zeichenfläche selbst setzt das Flag nie.
let ignoreHidden = false;

/** Ist der Abschnitt (id === null → „Ohne Abschnitt") ausgeblendet? */
function isAbschnittHidden(id) {
  if (ignoreHidden) return false;
  const a = abschnittById(id);
  return a ? !!a.hidden : !!state.hideUnassigned;
}

/** Wird das Feld gerade gezeichnet? */
function isBayVisible(bay) {
  return !isAbschnittHidden(bay ? bay.abschnittId : null);
}

/** Alle sichtbaren Felder (Gegenstück zu allBaysFlat(), das IMMER alle liefert). */
function visibleBaysFlat() {
  return allBaysFlat().filter(isBayVisible);
}

/** Blendet einen Abschnitt (oder „Ohne Abschnitt" mit id === null) aus/ein. */
function setAbschnittHidden(id, hidden) {
  if (id) { const a = abschnittById(id); if (a) a.hidden = !!hidden; }
  else state.hideUnassigned = !!hidden;
  // Unsichtbare Felder dürfen weder ausgewählt noch angehakt bleiben – sonst
  // veränderte eine Sammelaktion Felder, die gerade niemand sieht.
  allBaysFlat().forEach(b => { if (!isBayVisible(b)) bulkSelected.delete(b.id); });
  const selSec = selectedSi != null ? state.sections[selectedSi] : null;
  const selBay = selSec && selSec.bays[selectedBi];
  if (selBay && !isBayVisible(selBay)) { selectedSi = null; selectedBi = null; }
  invalidateViewCaches();
}

/** Anzahl ausgeblendeter Gruppen (inkl. „Ohne Abschnitt"). */
function hiddenGroupCount() {
  let n = abschnitteList().filter(a => a.hidden).length;
  if (state.hideUnassigned && allBaysFlat().some(b => !abschnittById(b.abschnittId))) n++;
  return n;
}

/** Blendet alles wieder ein. */
function showAllAbschnitte() {
  abschnitteList().forEach(a => { a.hidden = false; });
  state.hideUnassigned = false;
  invalidateViewCaches();
}

/** Führt `fn()` so aus, als wäre nichts ausgeblendet (PDF-Export mit
 *  ausgeblendeten Abschnitten). */
function withHiddenShown(fn) {
  const prev = ignoreHidden;
  ignoreHidden = true; invalidateViewCaches();
  try { return fn(); }
  finally { ignoreHidden = prev; invalidateViewCaches(); }
}

function renameAbschnitt(id, name) {
  const a = abschnittById(id);
  if (a) a.name = name;
}

/** Löscht einen Abschnitt. Die Felder bleiben erhalten und gelten danach als
 *  „Ohne Abschnitt" – es gehen also nie Aufmaßdaten verloren. */
function deleteAbschnitt(id) {
  state.abschnitte = abschnitteList().filter(a => a.id !== id);
  allBaysFlat().forEach(b => { if (b.abschnittId === id) b.abschnittId = null; });
}

/** Setzt (oder entfernt mit id === null) den Abschnitt für eine Feldmenge. */
function assignAbschnitt(bays, id) {
  bays.forEach(b => { b.abschnittId = id || null; });
}

/** Anzahl Felder je Abschnitt (inkl. Schlüssel '' für „ohne"). */
function abschnittCounts() {
  const counts = {};
  allBaysFlat().forEach(b => {
    const key = abschnittById(b.abschnittId) ? b.abschnittId : '';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/**
 * Fasst die Abschnitts-Zuordnung einer Feldmenge zusammen – Grundlage der
 * Anzeige oben links bei Mehrfachauswahl.
 * @returns {{ ids: (string|null)[], names: string[], mixed: boolean, hasUnassigned: boolean }}
 */
function abschnittSummary(bays) {
  const ids = [];
  let hasUnassigned = false;
  bays.forEach(b => {
    const a = abschnittById(b.abschnittId);
    if (!a) { hasUnassigned = true; return; }
    if (!ids.includes(a.id)) ids.push(a.id);
  });
  const names = ids.map(id => abschnittName(id));
  return { ids, names, mixed: ids.length + (hasUnassigned ? 1 : 0) > 1, hasUnassigned };
}

/** Alle Felder gruppiert nach Abschnitt, in Abschnitts-Reihenfolge;
 *  nicht zugeordnete Felder hängen als letzte Gruppe an. */
function baysByAbschnitt() {
  const groups = abschnitteList().map(a => ({ abschnitt: a, bays: [] }));
  const byId = Object.fromEntries(groups.map(g => [g.abschnitt.id, g]));
  const rest = { abschnitt: null, bays: [] };
  // Ausgeblendete Abschnitte tauchen in Auswertungen nur auf, wenn sie auch
  // gezeichnet werden (PDF-Export „ausgeblendete mitexportieren").
  visibleBaysFlat().forEach(b => {
    const g = byId[b.abschnittId];
    (g || rest).bays.push(b);
  });
  const out = groups.filter(g => g.bays.length);
  if (rest.bays.length) out.push(rest);
  return out;
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
  project:   '',
  depth:     0.73,
  abschnitte: [],   // [{ id, name, color, hidden }] – frei benennbare Feld-Gruppen
  hideUnassigned: false,   // Felder ohne Abschnitt ausgeblendet?
  aufmass:   null,  // Aufmaßregeln nach ATV DIN 18451 (siehe aufmassRules())
  ecken:     {},    // Eck-Entscheidungen des Nutzers (siehe eckWahl())
  grundriss: null,  // Grundriss-Hintergrundebene (siehe grundrissLayer())
  bordbretter: [],  // gezeichnete Bordbretter-Linien (siehe bordbretterListe())
  sections:  []
  // section: { id, name, dir, bays:[{id,len,…,abschnittId}], x0, y0 }
};

/** Nach dem Laden (Datei/Projekt/Undo) aufrufen: stellt sicher, dass Felder
 *  und Abschnitte vollständig sind und dass die ID-Zähler über den bereits
 *  vergebenen IDs stehen. Ältere Zeichnungen ohne Abschnitte bleiben dabei
 *  unverändert gültig – sie haben schlicht keine Abschnitte. */
function normalizeState() {
  if (!Array.isArray(state.abschnitte)) state.abschnitte = [];
  state.abschnitte = state.abschnitte
    .filter(a => a && a.id)
    .map((a, i) => ({
      id: String(a.id),
      name: (a.name != null && String(a.name).trim()) || `Abschnitt ${i + 1}`,
      color: a.color || ABSCHNITT_COLORS[i % ABSCHNITT_COLORS.length],
      // Zeichnungen aus der Zeit vor dem Ein-/Ausblenden kennen `hidden` nicht –
      // sie starten (wie bisher) vollständig sichtbar.
      hidden: !!a.hidden
    }));
  state.hideUnassigned = !!state.hideUnassigned;
  if (!state.ecken || typeof state.ecken !== 'object') state.ecken = {};
  normalizeBordbretter();
  // ID-Zähler hinter die höchste vergebene „abN"-Nummer setzen, damit neue
  // Abschnitte niemals eine bereits benutzte ID bekommen.
  state.abschnitte.forEach(a => {
    const n = parseInt(String(a.id).replace(/^ab/, ''), 10);
    if (!isNaN(n) && n > _aId) _aId = n;
  });
  const known = new Set(state.abschnitte.map(a => a.id));
  (state.sections || []).forEach(sec => (sec.bays || []).forEach(bay => {
    normalizeBay(bay);
    // Verweise auf gelöschte/unbekannte Abschnitte sauber auflösen.
    if (bay.abschnittId && !known.has(bay.abschnittId)) bay.abschnittId = null;
  }));
}

let drag           = null;
// (Das frühere `rafPending` ist entfallen – das Bündeln übernimmt jetzt
//  zentral requestRender(); siehe „Render-Planer".)
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
// Meterwert für Konsolen „in Metern" – null = je Feld die eigene Feldlänge.
let bulkKonsMeter   = null;
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
    state.project   = projName || z.project || '';
    state.depth     = z.depth || 0.73;
    state.sections  = z.sections;
    // Zeichnungen, die vor der Abschnitts-Funktion gespeichert wurden, haben
    // schlicht keine Abschnitte – sie werden unverändert weiterverwendet.
    state.abschnitte = Array.isArray(z.abschnitte) ? z.abschnitte : [];
    state.hideUnassigned = !!z.hideUnassigned;
    state.aufmass    = z.aufmass || null;
    state.ecken      = z.ecken || {};
    state.grundriss  = z.grundriss || null;
    state.bordbretter = Array.isArray(z.bordbretter) ? z.bordbretter : [];
    _sId = z._sId || state.sections.length;
    _bId = z._bId || state.sections.flatMap(s => s.bays).length;
    normalizeState();
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
    list[idx].zeichnung2d = {
      depth: state.depth, sections: state.sections,
      abschnitte: abschnitteList(), hideUnassigned: !!state.hideUnassigned,
      aufmass: aufmassRules(), ecken: state.ecken || {},
      grundriss: state.grundriss || null, bordbretter: state.bordbretter || [],
      _sId, _bId
    };
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
  return JSON.stringify({
    project: state.project, depth: state.depth,
    abschnitte: abschnitteList(), hideUnassigned: !!state.hideUnassigned,
    aufmass: aufmassRules(), ecken: state.ecken || {},
    grundriss: state.grundriss || null, bordbretter: state.bordbretter || [],
    sections: state.sections
  });
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
  state.project    = data.project;
  state.depth      = data.depth;
  state.abschnitte = Array.isArray(data.abschnitte) ? data.abschnitte : [];
  state.hideUnassigned = !!data.hideUnassigned;
  state.aufmass    = data.aufmass || null;
  state.ecken      = data.ecken || {};
  state.grundriss  = data.grundriss || null;
  state.bordbretter = Array.isArray(data.bordbretter) ? data.bordbretter : [];
  state.sections   = data.sections;
  normalizeState();
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

/* ── Umfang des Einfügens ────────────────────────────────────────────────────
   Übertragen wird die AUSSTATTUNG eines Feldes, nicht sein Ort: Zusatzbauteile
   (inkl. Typ, Menge, Einheit, Lagen), Höhen, Abschnitt und Notiz. Feldspezifisch
   und deshalb NIE automatisch übernommen bleiben Position/Drehung/Reihenfolge in
   der Zeichnung – die Feldlänge ist zuschaltbar, weil sie die Geometrie ändert.
   Die Auswahl gilt gleichermaßen für „Einfügen" bei einem einzelnen Feld und
   für „auf Auswahl anwenden" bei der Mehrfachauswahl, damit derselbe Knopf
   überall dasselbe tut. Sie wird gemerkt.                                    */
const PASTE_OPTS_KEY = 'av_2d_paste_opts_v1';
const PASTE_FIELDS = [
  ['positionen', 'Zusatzbauteile', 'Alle Positionen inkl. Typ, Menge, Einheit und Lagen'],
  ['hoehen',     'Höhen',          'Höhe links und rechts'],
  ['abschnitt',  'Abschnitt',      'Abschnitts-Zuordnung des kopierten Feldes'],
  ['notiz',      'Notiz',          'Notiztext des kopierten Feldes'],
  ['laenge',     'Feldlänge',      'Überschreibt die Länge – verändert die Zeichnung']
];
const PASTE_DEFAULTS = { positionen: true, hoehen: true, abschnitt: true, notiz: true, laenge: false };

function loadPasteOpts() {
  try {
    const saved = JSON.parse(localStorage.getItem(PASTE_OPTS_KEY)) || {};
    const out = { ...PASTE_DEFAULTS };
    PASTE_FIELDS.forEach(([k]) => { if (typeof saved[k] === 'boolean') out[k] = saved[k]; });
    return out;
  } catch (_) { return { ...PASTE_DEFAULTS }; }
}

let pasteOpts = loadPasteOpts();

function savePasteOpts() {
  localStorage.setItem(PASTE_OPTS_KEY, JSON.stringify(pasteOpts));
}

/** Kurzbeschreibung des aktuellen Umfangs, z. B. „Zusatzbauteile · Höhen". */
function pasteScopeText() {
  const on = PASTE_FIELDS.filter(([k]) => pasteOpts[k]).map(([, label]) => label);
  return on.length ? on.join(' · ') : 'nichts ausgewählt';
}

/** Kopiert Höhen, alle Positionen (Konsolen, Innengeländer, Netze, Dachfang
 *  usw. inkl. Mengen/Lagen), Abschnitt, Notiz und Länge eines Feldes in die
 *  Zwischenablage. Was davon eingefügt wird, entscheidet `pasteOpts`. */
function copyBayPositions(bay) {
  copiedBayData = {
    hL: bay.hL,
    hR: bay.hR,
    len: bay.len,
    abschnittId: bay.abschnittId || null,
    note: bay.note || '',
    positions: JSON.parse(JSON.stringify(bay.positions || []))
  };
  const n = copiedBayData.positions.length;
  showToast(`Feld kopiert (${n} Zusatzbauteil${n === 1 ? '' : 'e'}) – bei anderen Feldern „Einfügen" antippen`);
  renderAll();
}

/** Überträgt die kopierte Konfiguration auf EIN Feld (Umfang: `pasteOpts`). */
function pasteBayPositions(bay) {
  if (!copiedBayData || !bay) return false;
  const d = copiedBayData;
  if (pasteOpts.hoehen)     { bay.hL = d.hL; bay.hR = d.hR; }
  if (pasteOpts.positionen) bay.positions = (d.positions || []).map(p => ({ ...p, id: ++_bId }));
  if (pasteOpts.abschnitt)  bay.abschnittId = abschnittById(d.abschnittId) ? d.abschnittId : null;
  if (pasteOpts.notiz)      bay.note = d.note || '';
  if (pasteOpts.laenge && d.len) bay.len = d.len;
  return true;
}

/** Überträgt die kopierte Konfiguration in einem Rutsch auf beliebig viele
 *  Felder – der Kern von „kopiertes Feld auf Mehrfachauswahl anwenden". */
function pasteBayPositionsToAll(bays) {
  if (!copiedBayData || !bays.length) return 0;
  bays.forEach(bay => { normalizeBay(bay); pasteBayPositions(bay); });
  return bays.length;
}

/** Auswahl, WAS eingefügt wird – identisch im Bearbeiten-Sheet und in der
 *  Mehrfachauswahl. */
function buildPasteScopeRow(onChange) {
  const row = document.createElement('div');
  row.className = 'paste-scope-row';
  PASTE_FIELDS.forEach(([key, label, desc]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'paste-scope-chip' + (pasteOpts[key] ? ' active' : '');
    chip.textContent = (pasteOpts[key] ? '✓ ' : '') + label;
    chip.title = desc;
    chip.setAttribute('aria-pressed', String(!!pasteOpts[key]));
    chip.addEventListener('click', () => {
      pasteOpts[key] = !pasteOpts[key];
      savePasteOpts();
      chip.classList.toggle('active', pasteOpts[key]);
      chip.textContent = (pasteOpts[key] ? '✓ ' : '') + label;
      chip.setAttribute('aria-pressed', String(!!pasteOpts[key]));
      if (onChange) onChange();
    });
    row.appendChild(chip);
  });
  return row;
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
    // Ausgeblendete Abschnitte zählen nicht zum sichtbaren Inhalt – sonst
    // zoomte „Alle Felder anzeigen" auf leeren Raum.
    sectionBayPolys(sec, sec.x0, sec.y0).forEach((poly, bi) => {
      if (!isBayVisible(sec.bays[bi])) return;
      poly.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
  });
  // Die Grundriss-Ebene gehört mit zum Inhalt – sonst zoomte „Alle Felder
  // anzeigen" an einem frisch eingefügten Grundriss vorbei, und vor dem ersten
  // Feld gäbe es überhaupt nichts, worauf sich die Kamera einstellen könnte.
  const gr = grundrissLayer();
  if (gr && gr.visible) {
    const w = gr.w * gr.scale / 2, h = gr.h * gr.scale / 2;
    const r = gr.rot * Math.PI / 180;
    [[-w, -h], [w, -h], [w, h], [-w, h]].forEach(([ex, ey]) => {
      const px = gr.x + ex * Math.cos(r) - ey * Math.sin(r);
      const py = gr.y + ex * Math.sin(r) + ey * Math.cos(r);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    });
  }
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
let handleReleasedAt  = 0;          // Zeitpunkt des letzten Griff-Loslassens (ms)
const CLICK_AFTER_HANDLE_MS = 400;  // so lange gilt ein Klick als Nachwehe eines Griffs

// ── Factories ──────────────────────────────────────────────────────────────

function mkBay(len = 2.57) {
  // Gerüst-Grundfeld: Länge + Höhe links/rechts (hL/hR). Zusätzliche Positionen
  // (Konsole, Netz, …) liegen in positions[].
  return {
    id: ++_bId, len: +parseFloat(len).toFixed(2),
    hL: null, hR: null,
    positions: [], note: '', abschnittId: null
  };
}

/** Stellt sicher, dass ein (auch geladenes/älteres) Bay ein positions[] und
 *  note besitzt und migriert die alte Einzel-Kategorie in eine Position. */
function normalizeBay(bay) {
  if (!Array.isArray(bay.positions)) bay.positions = [];
  if (typeof bay.note !== 'string') bay.note = '';
  // Felder aus älteren Zeichnungen kennen noch keine Abschnitte.
  if (bay.abschnittId === undefined) bay.abschnittId = null;
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

/* Art einer Ecke allein aus der Geometrie – 'aussen', 'innen' oder null
   (gerade Fortsetzung, also gar keine Ecke).

   Maßgeblich ist, wohin die AUSSENNORMALE der ausleitenden Wand relativ zur
   LAUFRICHTUNG der einlaufenden zeigt:

     • Außenecke  – das Gerüst wickelt sich um eine vorspringende Gebäudeecke.
                    Die Normale der Folgewand zeigt nach vorn (dot > 0); beide
                    Gerüstbahnen lassen eine Lücke, die das Eckstück füllt.
     • Innenecke  – das Gerüst läuft in einen Rücksprung. Die Normale der
                    Folgewand zeigt zurück (dot < 0); beide Bahnen ÜBERLAPPEN
                    sich um Gerüsttiefe × Gerüsttiefe.

   Früher wurde stattdessen das Kreuzprodukt der beiden AUSSENNORMALEN geprüft.
   Das hat zwei Fehler: Innenecken fielen ersatzlos heraus (cross < 0 wurde
   verworfen), und weil eine gemeinsame Drehung beider Normalen ihr
   Kreuzprodukt nicht ändert, war das Ergebnis blind gegenüber sec.flip –
   gespiegelte Wände bekamen die Ecke schlicht nicht (oder verkehrt herum).
   Die Laufrichtung mitzunehmen behebt beides. */
function eckArtGeometrisch(dirIn, outNext) {
  const dot = dirIn.dx * outNext.dx + dirIn.dy * outNext.dy;
  if (Math.abs(dot) < 1e-6) return null;
  return dot > 0 ? 'aussen' : 'innen';
}

/** Tatsächlich geltende Art einer Ecke aus computeLayout(): eine gespeicherte
 *  Entscheidung des Nutzers geht der Geometrie vor (z. B. wenn die Zeichnung
 *  die Gebäudeseite nicht sauber abbildet). */
function eckArtEffektiv(cornerEl) {
  const a = state.sections[cornerEl.si], b = state.sections[cornerEl.ni];
  if (!a || !b) return cornerEl.kind;
  const w = eckWahl(eckKey(a, b));
  return (w.typ === 'aussen' || w.typ === 'innen') ? w.typ : cornerEl.kind;
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
    // Ausgeblendete Abschnitte werden NICHT gezeichnet – ihre Felder gehen
    // aber trotzdem in die Positionsrechnung ein, damit die sichtbaren
    // Nachbarfelder an derselben Stelle bleiben wie zuvor.
    const anyVisible = sec.bays.some(isBayVisible);

    // ── Start junction (tagged with si — only shown when section selected) ──
    if (anyVisible) els.push({ type: 'junctionBtn', x, y, si });

    // ── Bays ────────────────────────────────────────────────────────────
    sec.bays.forEach((bay, bi) => {
      const pxLen = bay.len * PX_PER_M;
      const visible = isBayVisible(bay);
      if (visible) {
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
      }

      x += dir.dx * pxLen;
      y += dir.dy * pxLen;

      if (visible) els.push({ type: 'junctionBtn', x, y, si });
    });

    // ── Wall line ───────────────────────────────────────────────────────
    if (sec.bays.length > 0 && anyVisible) {
      els.push({ type: 'wallLine', x1: startX, y1: startY, x2: x, y2: y });

      // Move handle at wall-line midpoint. `secLen` wird mitgeführt, damit der
      // Griff nie größer gezeichnet wird als das Feld selbst (siehe renderSvg).
      els.push({
        type: 'moveHandle',
        x: (startX + x) / 2,
        y: (startY + y) / 2,
        secLen: Math.hypot(x - startX, y - startY),
        si
      });

      // Rotation handle – sitzt MITTIG an der offenen (wandabgewandten) Seite.
      // Früher lag er in Laufrichtung hinter dem Sektionsende und damit genau
      // dort, wo auch der blaue „+"-Knopf sitzt: beim Herauszoomen überlappten
      // beide Trefferflächen, und ein Tipp auf „Drehen" hängte stattdessen ein
      // neues Feld an. Quer zur Laufrichtung kann das nicht mehr passieren.
      // Der Abstand kommt erst beim Zeichnen dazu (bildschirmbezogen).
      els.push({
        type: 'rotateHandle',
        ax: (startX + x) / 2 + out.dx * depth,
        ay: (startY + y) / 2 + out.dy * depth,
        odx: out.dx, ody: out.dy,
        si, ang
      });
    }
  });

  // ── Ecken zwischen verbundenen Sektionen ────────────────────────────────
  // Früher wurde jede Sektion gegen JEDE andere geprüft (quadratischer
  // Aufwand: bei 150 Feldern über 22 000 Vergleiche je Neuzeichnung – und
  // neu gezeichnet wird bei jeder Mausbewegung). Jetzt liegen die
  // Sektionsanfänge in einem groben 2-px-Raster; geprüft werden nur noch die
  // Nachbarzellen des jeweiligen Sektionsendes. Ergebnis identisch, Aufwand
  // linear zur Feldanzahl.
  const cellKey  = (x, y) => Math.round(x / 2) + ',' + Math.round(y / 2);
  const startBuckets = new Map();
  state.sections.forEach((s, i) => {
    const k = cellKey(s.x0, s.y0);
    const arr = startBuckets.get(k);
    if (arr) arr.push(i); else startBuckets.set(k, [i]);
  });

  state.sections.forEach((sec, si) => {
    if (!sec.bays.some(isBayVisible)) return;
    const end = sectionEnd(sec);
    const dir = secVec(sec);
    const out = outVec(dir, sec.flip);
    const bx  = Math.round(end.x / 2), by = Math.round(end.y / 2);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = startBuckets.get((bx + ox) + ',' + (by + oy));
        if (!arr) continue;
        for (const ni of arr) {
          if (ni === si) continue;
          const next = state.sections[ni];
          if (!next.bays.some(isBayVisible)) continue;
          if (Math.abs(next.x0 - end.x) >= 2 || Math.abs(next.y0 - end.y) >= 2) continue;
          const nOut = outVec(secVec(next), next.flip);
          const kind = eckArtGeometrisch(dir, nOut);
          if (!kind) continue;                       // gerade Fortsetzung: keine Ecke
          const c0 = { x: end.x, y: end.y };
          const c1 = { x: end.x + out.dx * depth, y: end.y + out.dy * depth };
          const c2 = { x: c1.x + nOut.dx * depth, y: c1.y + nOut.dy * depth };
          const c3 = { x: end.x + nOut.dx * depth, y: end.y + nOut.dy * depth };
          // `si`/`ni` = ein- und ausleitende Sektion der Ecke. Das Viereck ist
          // bei der AUSSENECKE das Eckstück, das die Lücke zwischen beiden
          // Gerüstbahnen schließt – bei der INNENECKE dieselbe Fläche als
          // ÜBERLAPPUNG beider Bahnen. Grundlage für das Aufmaß, siehe
          // eckenListe() und computeAufmass().
          els.push({ type: 'corner', pts: [c0, c1, c2, c3], si, ni, kind });
        }
      }
    }
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

/** Mischt eine Hex-Farbe mit Weiß (t = 0 … 1, 1 = reines Weiß) – für die
 *  zurückhaltende Flächenfärbung der Abschnitte. */
function tintHex(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(c + (255 - c) * t);
  return '#' + [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

// ── Main SVG render ────────────────────────────────────────────────────────

/** Der leere Zeichenbereich sagt, WARUM er leer ist: gar keine Felder erfasst
 *  – oder alle Abschnitte ausgeblendet. Im zweiten Fall führt ein Knopf direkt
 *  zurück zur vollständigen Ansicht, damit niemand die Felder für verloren
 *  hält. */
function syncEmptyHint(allHidden) {
  const icon  = document.querySelector('#emptyHint .empty-icon');
  const title = document.querySelector('#emptyHint .empty-title');
  const addBtn = document.getElementById('emptyAddBtn');
  let showBtn = document.getElementById('emptyShowAllBtn');
  if (!icon || !title || !addBtn) return;

  if (allHidden) {
    icon.textContent  = '🙈';
    title.textContent = 'Alle Abschnitte ausgeblendet';
    addBtn.classList.add('hidden');
    if (!showBtn) {
      showBtn = document.createElement('button');
      showBtn.id = 'emptyShowAllBtn';
      showBtn.type = 'button';
      showBtn.className = 'empty-add-btn';
      showBtn.textContent = 'Alle Abschnitte einblenden';
      showBtn.addEventListener('click', () => { showAllAbschnitte(); renderAll(); });
      addBtn.parentNode.appendChild(showBtn);
    }
    showBtn.classList.remove('hidden');
  } else {
    icon.textContent  = '📐';
    title.textContent = 'Noch keine Felder erfasst';
    addBtn.classList.remove('hidden');
    if (showBtn) showBtn.classList.add('hidden');
  }
}

function renderSvg() {
  const gLive = document.getElementById('planGroup');
  const svg   = document.getElementById('planSvg');
  const hint  = document.getElementById('emptyHint');
  // In ein Fragment zeichnen und erst am Ende EINMAL einhängen: der Browser
  // muss dann nicht bei jedem der (bei großen Gerüsten mehreren tausend)
  // Elemente Layout/Stil neu bewerten.
  const g = document.createDocumentFragment();
  gLive.textContent = '';
  invalidateViewCaches();
  updateAreaReadout();
  updateWarningsReadout();
  scheduleAutosave2d();
  scheduleUndoSnapshot();

  const hasBays    = state.sections.some(s => s.bays.length > 0);
  const hasVisible = state.sections.some(s => s.bays.some(isBayVisible));
  syncEmptyHint(hasBays && !hasVisible);
  if (!hasVisible) {
    autoFit = true;
    fitCameraToContent();
    applyCamera();
    // Der Grundriss wird AUCH ohne Felder gezeichnet – genau dann zeichnet man
    // ja die ersten Achsen darüber ab.
    renderGrundriss(g, px => px / camera.scale);
    gLive.appendChild(g);
    hint.classList.toggle('hidden', !!grundrissLayer() && !hasBays);
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

  // 0. Grundriss-Hintergrundebene – ganz unten, damit alles Gezeichnete
  //    darüberliegt.
  renderGrundriss(g, hs);

  // 1. Eckstücke – NUR an Außenecken. Dort lassen die beiden Gerüstbahnen eine
  //    Lücke, die das Eckstück schließt; es ist echtes Bauteil und wird
  //    deshalb wie ein Feld gefüllt gezeichnet (und vor den Feldern, damit
  //    deren Konturen darüberliegen).
  //    An einer INNENECKE beschreibt dasselbe Viereck dagegen die ÜBERLAPPUNG
  //    zweier Bahnen – dort steht kein zusätzliches Gerüst. Als Fläche gefüllt
  //    wäre das schlicht falsch; die Innenecke bekommt weiter unten eine
  //    eigene, antippbare Markierung (Schritt 6).
  els.filter(e => e.type === 'corner' && eckArtEffektiv(e) === 'aussen').forEach(el =>
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
    // Abschnitts-Zuordnung wird als zurückhaltende Einfärbung sichtbar –
    // Auswahl-Zustände haben aber immer Vorrang, damit klar bleibt, was gerade
    // angefasst wird.
    const absch     = abschnittById(bayData.abschnittId);
    const baseFill  = absch ? tintHex(absch.color, 0.86) : '#deeeff';
    const baseStrk  = absch ? absch.color : '#2c6fa8';
    const poly = svgEl('polygon', {
      points: ptsStr(el.pts),
      fill: isBulkSelected ? '#6a4bd1' : (isSelected ? '#8ec4f5' : baseFill),
      'fill-opacity': isBulkSelected ? 0.30 : 1,
      stroke: isBulkSelected ? '#6a4bd1' : (isSelected ? '#0a2f58' : baseStrk),
      'stroke-width': (isSelected || isBulkSelected) ? 4 : 2,
      style: isSelected ? 'filter:drop-shadow(0 0 6px rgba(0,122,255,0.75))' : '',
      cursor: 'pointer'
    });
    poly.addEventListener('click', ev => {
      ev.stopPropagation();
      handleBayTap(el.si, el.bi);
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
      const boxBg  = isBulkSelected ? '#6a4bd1' : (isSelected ? '#007aff' : (absch ? absch.color : '#0a2f58'));
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

  // 4. Innenecken – antippbare Markierung statt gefüllter Fläche.
  //    Das Viereck ist hier die ÜBERLAPPUNG zweier Gerüstbahnen; gezeichnet
  //    wird es schraffiert (nicht gefüllt), damit sofort klar ist: hier steht
  //    kein zusätzliches Gerüst, hier wird umverteilt. Die Plakette in der
  //    Mitte öffnet die Entscheidung „welche Achse läuft durch?" – solange
  //    der Nutzer nicht entschieden hat, zeigt sie „?" in Warnfarbe.
  {
    const innen = els.filter(e => e.type === 'corner' && eckArtEffektiv(e) === 'innen');
    if (innen.length) {
      const ecken = eckenListe();
      const byKey = new Map(ecken.map(e => [e.key, e]));
      innen.forEach(el => {
        const secA = state.sections[el.si], secB = state.sections[el.ni];
        if (!secA || !secB) return;
        const key  = eckKey(secA, secB);
        const info = byKey.get(key);
        if (!info) return;
        const offen = !info.bestaetigt;
        const farbe = offen ? '#c2691b' : '#4a5b6b';

        // Schraffur: zwei Diagonalen im Viereck – bewusst sparsam, damit die
        // darunterliegenden Feldbeschriftungen lesbar bleiben.
        const [q0, q1, q2, q3] = el.pts;
        g.appendChild(svgEl('path', {
          d: `M${q0.x},${q0.y}L${q1.x},${q1.y}L${q2.x},${q2.y}L${q3.x},${q3.y}Z`,
          fill: 'none', stroke: farbe, 'stroke-width': 1.6,
          'stroke-dasharray': `${hs(5)},${hs(4)}`, 'pointer-events': 'none'
        }));
        g.appendChild(svgEl('line', {
          x1: q0.x, y1: q0.y, x2: q2.x, y2: q2.y,
          stroke: farbe, 'stroke-width': 1.1, 'stroke-opacity': 0.55,
          'pointer-events': 'none'
        }));

        const cx = (q0.x + q1.x + q2.x + q3.x) / 4;
        const cy = (q0.y + q1.y + q2.y + q3.y) / 4;
        const R  = Math.min(hs(HANDLE_R * 0.95), depth * 0.42);

        const hit = svgEl('circle', {
          cx, cy, r: R * 1.5, fill: 'rgba(0,0,0,0.001)', style: 'cursor:pointer'
        });
        const tt = svgEl('title', {});
        tt.textContent = offen
          ? 'Innenecke – Zuordnung noch nicht bestätigt. Tippen zum Festlegen.'
          : `Innenecke: ${state.sections[info.durchSi].name} läuft durch, `
            + `${state.sections[info.fuellSi].name} füllt aus. Tippen zum Ändern.`;
        hit.appendChild(tt);
        hit.addEventListener('click', ev => { ev.stopPropagation(); openEckSheet(key); });
        g.appendChild(hit);

        g.appendChild(svgEl('circle', {
          cx, cy, r: R, fill: farbe, stroke: '#fff',
          'stroke-width': hs(2), 'pointer-events': 'none'
        }));
        const sym = svgEl('text', {
          x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': R * 1.15, 'font-family': 'system-ui, sans-serif',
          fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
        });
        sym.textContent = offen ? '?' : '⇱';
        g.appendChild(sym);

        // Wirkung direkt am Feld anschreiben („−0,73" / „+0,73"), sobald die
        // Ecke groß genug dargestellt ist, um das lesbar unterzubringen.
        if (aufmassRules().innenecke.aktiv && depth * camera.scale > 46) {
          const wert = innenEckWert();
          [[info.durchSi, -wert], [info.fuellSi, +wert]].forEach(([si, d]) => {
            const sec = state.sections[si];
            if (!sec) return;
            const v = secVec(sec), o = outVec(v, sec.flip);
            // Vom Eckpunkt aus in die Achse hinein: die einlaufende Sektion
            // liegt entgegen ihrer Laufrichtung, die ausleitende in Richtung.
            const sgn = si === el.si ? -1 : 1;
            const px = q0.x + v.dx * sgn * depth * 0.95 + o.dx * depth * 0.5;
            const py = q0.y + v.dy * sgn * depth * 0.95 + o.dy * depth * 0.5;
            const t = svgEl('text', {
              x: px, y: py, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
              'font-size': Math.max(depth * 0.26, 8),
              'font-family': 'system-ui, sans-serif',
              fill: d < 0 ? '#b3402a' : '#1d7a4c', 'font-weight': '700',
              'pointer-events': 'none',
              transform: `rotate(${uprightDeg(secAngle(sec)).toFixed(1)},${px},${py})`
            });
            t.textContent = (d < 0 ? '−' : '+') + fmtQty(Math.abs(d));
            g.appendChild(t);
          });
        }
      });
    }
  }

  // 5b. Move handles (orange ✥)
  {
    // Der Verschiebe-Griff darf nie größer sein als das Feld, zu dem er
    // gehört: Früher war er rein bildschirmbezogen bemessen, sodass er beim
    // Herauszoomen (und bei vielen Feldern) über die Nachbarfelder wuchs. Ein
    // Tipp landete dann auf einem fremden Griff – „falsches Feld reagiert" –
    // und die Zeichnung verschwand unter orangen Punkten. Deshalb wird die
    // Größe zusätzlich an Feldlänge und Gerüsttiefe gedeckelt.
    els.filter(e => e.type === 'moveHandle').forEach(el => {
      const isActive = drag && drag.type === 'move' && drag.si === el.si;
      // Bewusst ohne Mindestgröße in Bildschirm-Pixeln: weit herausgezoomt ist
      // das Feld selbst nur wenige Pixel groß – ein „mindestens gut treffbarer"
      // Griff wäre dort zwangsläufig größer als das Feld und würde erneut die
      // Nachbarn überdecken. Zum Verschieben zoomt man ohnehin heran.
      const MOVE_R = Math.min(hs(HANDLE_R * 1.1), el.secLen * 0.20, depth * 0.40);

      const hit = svgEl('circle', {
        cx: el.x, cy: el.y, r: MOVE_R * 1.15,
        fill: 'rgba(0,0,0,0.001)', style: 'cursor:move', 'data-si': el.si
      });
      hit.addEventListener('pointerdown', onMoveHandleDown);
      const hitTitle = svgEl('title', {});
      hitTitle.textContent = 'Ziehen: Feld verschieben · Tippen: Feld bearbeiten';
      hit.appendChild(hitTitle);
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: el.x, cy: el.y, r: MOVE_R,
        fill: isActive ? '#c85000' : '#ff8800',
        stroke: '#fff', 'stroke-width': Math.min(hs(2.5), MOVE_R * 0.22), 'pointer-events': 'none'
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

      // Abstand zur Feldkante bildschirmbezogen – der Griff bleibt bei jedem
      // Zoom gleich weit weg und wächst nicht in die Nachbarfelder hinein.
      const rotOff = hs(HANDLE_R * 2.2);
      const hx = el.ax + el.odx * rotOff;
      const hy = el.ay + el.ody * rotOff;

      // Verbindungslinie von der Feldkante zum Drehgriff
      const sec = state.sections[el.si];
      g.appendChild(svgEl('line', {
        x1: el.ax, y1: el.ay, x2: hx, y2: hy,
        stroke: '#8e44ec', 'stroke-width': hs(2), 'stroke-dasharray': `${hs(4)} ${hs(4)}`,
        'pointer-events': 'none'
      }));

      const hit = svgEl('circle', {
        cx: hx, cy: hy, r: ROT_R * 1.9,
        fill: 'rgba(0,0,0,0.001)', style: 'cursor:grab', 'data-si': el.si
      });
      hit.addEventListener('pointerdown', onRotateHandleDown);
      const hitTitle = svgEl('title', {});
      hitTitle.textContent = 'Tippen: 90° drehen · Ziehen: frei drehen';
      hit.appendChild(hitTitle);
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx: hx, cy: hy, r: ROT_R,
        fill: isActive ? '#6c2bd9' : '#8e44ec',
        stroke: '#fff', 'stroke-width': hs(2.5), 'pointer-events': 'none'
      }));

      const sym = svgEl('text', {
        x: hx, y: hy,
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
        const bx = hx, by = hy - ROT_R * 2.6;
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
    // Auch die „+"-Knöpfe bleiben an die Feldgröße gekoppelt, damit sie beim
    // Herauszoomen nicht über die Nachbarfelder wachsen.
    const selLenPx = Math.hypot(end.x - selSec.x0, end.y - selSec.y0) || depth;
    const EXT_R = Math.min(hs(HANDLE_R * 1.05), selLenPx * 0.26);
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
      // Trefferfläche eng am sichtbaren Knopf halten: eine deutlich größere
      // hätte (wie früher) benachbarte Bedienelemente überlagert.
      const hit = svgEl('circle', {
        cx: pt.x, cy: pt.y, r: EXT_R * 1.45,
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

  // 6b. Bordbretter-Linien (gezeichnete Kante der Gerüstlage) – über den
  //     Feldern, damit ihr Verlauf entlang der Kanten ablesbar bleibt.
  renderBordbretter(g, hs);

  // 7. Andock-Vorschau (während des Verschiebens)
  drawMovePreview(g);

  // 8. Maßstabsbalken (aus der aktuellen Kamera abgeleitet)
  const camVp = viewportRect();
  drawScaleBar(g,
    camera.cx - camVp.w / camera.scale / 2,
    camera.cy - camVp.h / camera.scale / 2,
    camVp.w / camera.scale, camVp.h / camera.scale,
    hs(12));

  gLive.appendChild(g);   // fertiges Fragment in einem Rutsch einhängen
}

/* ── Grundriss zeichnen & ausrichten ─────────────────────────────────────── */

// Referenzstrecke: erster angetippter Punkt, solange der Messmodus läuft.
let grundrissMessPunkt = null;
let grundrissMessen    = false;

/** Zeichnet die Grundriss-Ebene samt Verschiebe-Griff und Messstrecke. */
function renderGrundriss(g, hs) {
  const gr = grundrissLayer();
  if (!gr || !gr.visible) return;

  const w = gr.w * gr.scale, h = gr.h * gr.scale;
  const wrap = svgEl('g', {
    transform: `translate(${gr.x},${gr.y}) rotate(${gr.rot})`,
    'pointer-events': 'none'
  });
  const img = svgEl('image', {
    x: -w / 2, y: -h / 2, width: w, height: h,
    opacity: gr.opacity, preserveAspectRatio: 'none'
  });
  img.setAttribute('href', gr.dataUrl);
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', gr.dataUrl);
  wrap.appendChild(img);
  // Rahmen: ohne ihn ist bei blassen Plänen nicht erkennbar, wie weit die
  // Ebene reicht – und damit auch nicht, was man gerade verschiebt.
  wrap.appendChild(svgEl('rect', {
    x: -w / 2, y: -h / 2, width: w, height: h,
    fill: 'none', stroke: '#8e9aa6', 'stroke-width': 1,
    'stroke-dasharray': '6,5', 'stroke-opacity': 0.7
  }));
  g.appendChild(wrap);

  // Verschiebe-Griff nur, solange die Ebene nicht gesperrt ist.
  if (!gr.locked) {
    const R = hs(HANDLE_R * 0.9);
    const hit = svgEl('circle', {
      cx: gr.x, cy: gr.y, r: R * 1.5,
      fill: 'rgba(0,0,0,0.001)', style: 'cursor:move', 'data-grundriss': 'move'
    });
    const tt = svgEl('title', {});
    tt.textContent = 'Grundriss verschieben (im Grundriss-Dialog sperrbar)';
    hit.appendChild(tt);
    hit.addEventListener('pointerdown', onGrundrissHandleDown);
    g.appendChild(hit);
    g.appendChild(svgEl('circle', {
      cx: gr.x, cy: gr.y, r: R, fill: '#5a6b7a',
      stroke: '#fff', 'stroke-width': hs(2), 'pointer-events': 'none'
    }));
    const sym = svgEl('text', {
      x: gr.x, y: gr.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': R * 1.2, 'font-family': 'system-ui, sans-serif',
      fill: '#fff', 'font-weight': '700', 'pointer-events': 'none'
    });
    sym.textContent = '🗺';
    g.appendChild(sym);
  }

  // Erster Punkt der Referenzstrecke
  if (grundrissMessen && grundrissMessPunkt) {
    g.appendChild(svgEl('circle', {
      cx: grundrissMessPunkt.x, cy: grundrissMessPunkt.y, r: hs(6),
      fill: '#c2691b', stroke: '#fff', 'stroke-width': hs(2), 'pointer-events': 'none'
    }));
  }
}

function onGrundrissHandleDown(e) {
  const gr = grundrissLayer();
  if (!gr || gr.locked) return;
  e.preventDefault(); e.stopPropagation();
  canvasJustMoved = false;
  document.getElementById('planSvg').setPointerCapture(e.pointerId);
  drag = {
    type: 'grundriss',
    startX: gr.x, startY: gr.y,
    startPt: screenToSvg(e.clientX, e.clientY),
    moved: false
  };
}

/** Messmodus: zwei Punkte antippen, dann die wahre Länge eingeben. */
function starteGrundrissMessung() {
  if (!grundrissLayer()) return;
  grundrissMessen = true;
  grundrissMessPunkt = null;
  closeSheet();
  showToast('Referenzstrecke: ersten Punkt auf dem Grundriss antippen');
  renderAll();
}

function brichGrundrissMessungAb() {
  grundrissMessen = false;
  grundrissMessPunkt = null;
  renderAll();
}

/** Klick auf die Zeichenfläche während des Messmodus. */
function grundrissMessKlick(pt) {
  if (!grundrissMessPunkt) {
    grundrissMessPunkt = pt;
    showToast('Jetzt den zweiten Punkt antippen');
    renderAll();
    return;
  }
  const distWelt = Math.hypot(pt.x - grundrissMessPunkt.x, pt.y - grundrissMessPunkt.y);
  if (distWelt < 4) { showToast('Die beiden Punkte liegen zu dicht beieinander'); return; }

  const gr = grundrissLayer();
  const istM = distWelt / PX_PER_M;
  const eingabe = window.prompt(
    'Wie lang ist diese Strecke in Wirklichkeit? (m)\n'
    + `Aktuell entspricht sie ${fmtQty(istM)} m.`,
    fmtQty(istM).replace(',', '.'));
  grundrissMessen = false;
  grundrissMessPunkt = null;
  const sollM = parseFloat(String(eingabe || '').replace(',', '.'));
  if (!eingabe || isNaN(sollM) || sollM <= 0) { renderAll(); return; }

  // Der Faktor wirkt auf die Bildskalierung; die Bildmitte bleibt, wo sie ist.
  // Die Maske bleibt gültig: sie liegt in Bildpixeln, und nur die Abbildung
  // Welt → Bild ändert sich.
  gr.scale = Math.max(0.001, gr.scale * (sollM / istM));
  showToast(`Maßstab gesetzt: Referenzstrecke = ${fmtQty(sollM)} m`);
  renderAll();
  scheduleAutosave2d();
}

/* ── Bordbretter-Linie zeichnen ──────────────────────────────────────────────
   Bedienung bewusst wie die Referenzstrecke des Grundrisses: Modus starten,
   Punkte antippen, fertig. Jeder Tipp rastet auf die nächstgelegene Feldkante
   (bzw. deren Eckpunkt) ein – ohne dieses Einrasten läge die Linie um ein paar
   Zentimeter neben der Kante, und die Ecken-Auswertung würde die Sektion
   verfehlen.                                                                */

let bordbrettModus  = false;   // Zeichenmodus aktiv?
let bordbrettPunkte = [];      // Punkte der gerade entstehenden Linie

/** Fangradius in Welt-px – bildschirmbezogen, damit er bei jedem Zoom passt. */
function bordbrettFangRadius() {
  return worldPerScreenPx() * 26;
}

function starteBordbrettZeichnen() {
  if (!state.sections.some(s => s.bays.some(isBayVisible))) {
    showToast('Erst Gerüstfelder zeichnen – die Linie rastet auf deren Kanten ein.');
    return;
  }
  bordbrettModus  = true;
  bordbrettPunkte = [];
  closeSheet();
  // Kein Toast: die Bedienleiste sagt dasselbe und bleibt stehen, statt nach
  // zwei Sekunden zu verschwinden.
  renderAll();
  updateBordbrettBar();
}

function brichBordbrettZeichnenAb() {
  bordbrettModus  = false;
  bordbrettPunkte = [];
  renderAll();
  updateBordbrettBar();
}

/** Tipp auf die Zeichenfläche im Zeichenmodus: Punkt einrasten und anhängen. */
function bordbrettKlick(pt) {
  const s = bordbrettSnap(pt, bordbrettFangRadius());
  const letzter = bordbrettPunkte[bordbrettPunkte.length - 1];
  if (letzter && Math.hypot(letzter.x - s.x, letzter.y - s.y) < 1) {
    showToast('Dieser Punkt ist schon gesetzt');
    return;
  }
  bordbrettPunkte.push({ x: s.x, y: s.y });
  if (s.art === 'frei') {
    showToast('Punkt liegt neben den Feldkanten – näher an eine Kante tippen');
  }
  renderAll();
  updateBordbrettBar();
}

function bordbrettPunktZurueck() {
  bordbrettPunkte.pop();
  renderAll();
  updateBordbrettBar();
}

/** Zeichnen beenden: Linie anlegen, Achse vorschlagen, Dialog öffnen. */
function beendeBordbrettZeichnen() {
  if (bordbrettPunkte.length < 2) {
    showToast('Mindestens zwei Punkte setzen');
    return;
  }
  const linie = mkBordbrett(bordbrettPunkte);
  bordbretterListe().push(linie);
  bordbrettModus  = false;
  bordbrettPunkte = [];
  invalidateEckenCache();
  // Vorschlag: die Achse, auf der der größte Teil der Linie verläuft. Der
  // Nutzer kann sie im Dialog jederzeit ändern.
  const vorschlag = bordbrettAchsVorschlag(linie);
  if (vorschlag) bordbrettZuordnen(linie, vorschlag);
  renderAll();
  scheduleAutosave2d();
  updateBordbrettBar();
  openBordbrettSheet(linie.id);
}

/** Blendet die Bedienleiste des Zeichenmodus ein/aus. */
function updateBordbrettBar() {
  const bar = document.getElementById('bordbrettBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !bordbrettModus);
  const info = document.getElementById('bordbrettBarInfo');
  if (info) {
    info.textContent = bordbrettPunkte.length < 2
      ? `Bordbretter-Linie · ${bordbrettPunkte.length} von mindestens 2 Punkten`
      : `Bordbretter-Linie · ${bordbrettPunkte.length} Punkte`;
  }
  const fertig = document.getElementById('bordbrettFertigBtn');
  if (fertig) fertig.disabled = bordbrettPunkte.length < 2;
  const zurueck = document.getElementById('bordbrettZurueckBtn');
  if (zurueck) zurueck.disabled = bordbrettPunkte.length === 0;
  const btn = document.getElementById('bordbrettBtn');
  if (btn) btn.classList.toggle('active', bordbrettModus);
}

/** Zeichnet die gespeicherten Linien und die gerade entstehende. */
function renderBordbretter(g, hs) {
  const linien = bordbretterListe();
  if (!linien.length && !bordbrettModus) return;

  // Achsen und Ecken EINMAL ermitteln, nicht je Linie – renderSvg() läuft bei
  // jeder Zeichnungsänderung.
  const achsen = achsenListe();
  const ecken  = linien.length ? roheEcken() : [];

  const polyline = (pts, attrs) => svgEl('polyline', {
    points: pts.map(p => `${p.x},${p.y}`).join(' '),
    fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...attrs
  });

  linien.forEach(linie => {
    const zugeordnet = !!bordbrettAchse(linie, achsen);
    const farbe = zugeordnet ? '#0f8f8e' : '#c2691b';

    // Breite, unsichtbare Trefferfläche: die Linie selbst ist zu dünn zum
    // Antippen, gerade auf dem iPad.
    const hit = polyline(linie.punkte, {
      stroke: 'rgba(0,0,0,0.001)', 'stroke-width': hs(22), style: 'cursor:pointer'
    });
    const tt = svgEl('title', {});
    tt.textContent = zugeordnet
      ? `${bordbrettName(linie)} – zugeordnet. Tippen zum Ändern.`
      : `${bordbrettName(linie)} – noch keiner Achse zugeordnet. Tippen zum Zuordnen.`;
    hit.appendChild(tt);
    hit.addEventListener('click', ev => { ev.stopPropagation(); openBordbrettSheet(linie.id); });
    g.appendChild(hit);

    g.appendChild(polyline(linie.punkte, {
      stroke: '#fff', 'stroke-width': hs(7), 'stroke-opacity': 0.85,
      'pointer-events': 'none'
    }));
    g.appendChild(polyline(linie.punkte, {
      stroke: farbe, 'stroke-width': hs(3.4),
      'stroke-dasharray': zugeordnet ? '' : `${hs(9)},${hs(6)}`,
      'pointer-events': 'none'
    }));

    // Wirkung an den erkannten Ecken direkt anschreiben.
    if (zugeordnet) {
      bordbrettAuswertung(linie, achsen, ecken).enden.forEach(ende => {
        if (!ende.ecke || !ende.delta) return;
        // An Innenecken schreibt die Eck-Markierung ihr ±-Maß bereits an die
        // beteiligten Felder – hier nicht ein zweites Mal danebenschreiben.
        if (ende.ecke.art !== 'aussen') return;
        const pts = ende.ecke.pts;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const t = svgEl('text', {
          x: cx, y: cy - hs(16), 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': hs(13), 'font-family': 'system-ui, sans-serif',
          fill: ende.delta < 0 ? '#b3402a' : '#1d7a4c', 'font-weight': '700',
          stroke: '#fff', 'stroke-width': hs(3), 'paint-order': 'stroke',
          'pointer-events': 'none'
        });
        t.textContent = (ende.delta < 0 ? '−' : '+') + fmtQty(Math.abs(ende.delta)) + ' m';
        g.appendChild(t);
      });
    }
  });

  // Linie im Entstehen: Punkte sichtbar, damit erkennbar ist, wo eingerastet
  // wurde.
  if (bordbrettModus && bordbrettPunkte.length) {
    if (bordbrettPunkte.length > 1) {
      g.appendChild(polyline(bordbrettPunkte, {
        stroke: '#0f8f8e', 'stroke-width': hs(3.4),
        'stroke-dasharray': `${hs(10)},${hs(6)}`, 'pointer-events': 'none'
      }));
    }
    bordbrettPunkte.forEach((p, i) => {
      g.appendChild(svgEl('circle', {
        cx: p.x, cy: p.y, r: hs(i === bordbrettPunkte.length - 1 ? 7 : 5),
        fill: '#0f8f8e', stroke: '#fff', 'stroke-width': hs(2),
        'pointer-events': 'none'
      }));
    });
  }
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

/* ── Tippen auf ein Feld ─────────────────────────────────────────────────────
   Zentrale Stelle für „Feld angetippt". Sie wird von der Feldfläche UND von
   einem folgenlosen Tipp auf den Verschiebe-Griff aufgerufen.

   Hintergrund: Der orange Verschiebe-Griff sitzt in der Mitte der Wandkante
   und hatte eine unsichtbare Trefferfläche von 38 px Radius – bei der geringen
   Gerüsttiefe (≈ 0,73 m) überdeckte sie praktisch das ganze Feld. Ein Tipp
   aufs Feld landete deshalb meist auf dem Griff, startete ein Verschieben um
   0 px und endete in `onSvgPointerUp` mit einem vollständigen Neuaufbau –
   sichtbar passierte NICHTS. Genau das war das „Feld reagiert nicht / erst
   nach vielen Versuchen"-Verhalten. Jetzt öffnet auch ein Tipp auf den Griff
   direkt das Feld. */
function handleBayTap(si, bi) {
  // Tipp unmittelbar nach einem Verschieben/Zoomen der Ansicht ignorieren.
  if (canvasJustMoved) { canvasJustMoved = false; return; }
  const sec = state.sections[si];
  const bay = sec && sec.bays[bi];
  if (!bay) return;

  // In der Mehrfachauswahl hakt ein Tipp das Feld an bzw. ab, statt das
  // Bearbeiten-Sheet zu öffnen – so lässt sich direkt im Plan auswählen.
  if (bulkMode) {
    if (bulkSelected.has(bay.id)) bulkSelected.delete(bay.id);
    else bulkSelected.add(bay.id);
    selectedSi = si; selectedBi = bi;
    requestRender({ svg: true, sidebar: true, bulk: true });
    return;
  }

  selectedSi = si;
  selectedBi = bi;
  requestRender();            // Auswahl + Dreh-/Anfüge-Griffe sofort anzeigen
  openEditSheet(si, bi);
}

/** Dreht die Sektion in 90°-Schritten und rastet sauber auf ein Vielfaches
 *  von 90° ein – die Aktion hinter einem Tipp auf den Drehgriff. */
function rotateSectionBy(si, step) {
  const sec = state.sections[si];
  if (!sec) return;
  const a = (Math.round(normDeg(secAngle(sec) + step) / 90) * 90) % 360;
  setSectionAngle(sec, a);
  syncRotSheet(sec);
  requestRender({ svg: true, sidebar: true });
}

function onRotateHandleDown(e) {
  // Beim Zeichnen einer Bordbretter-Linie zählt jeder Tipp als Linienpunkt –
  // dann darf ein Griff die Zeichnung nicht nebenbei verändern.
  if (bordbrettModus) return;
  e.preventDefault();
  e.stopPropagation();
  canvasJustMoved = false;   // Griff-Bedienung ist nie die Nachwehe eines Wischens
  const si  = parseInt(e.currentTarget.dataset.si);
  const svg = document.getElementById('planSvg');
  svg.setPointerCapture(e.pointerId);
  selectedSi = si;
  selectedBi = 0;
  drag = {
    type: 'rotate', si,
    startAngle: secAngle(state.sections[si]),
    startClientX: e.clientX, startClientY: e.clientY,
    moved: false
  };
}

function onMoveHandleDown(e) {
  if (bordbrettModus) return;   // siehe onRotateHandleDown
  e.preventDefault();
  e.stopPropagation();
  canvasJustMoved = false;   // Griff-Bedienung ist nie die Nachwehe eines Wischens
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

  if (drag.type === 'grundriss') {
    const gr = grundrissLayer();
    if (!gr) { drag = null; return; }
    const dx = pt.x - drag.startPt.x, dy = pt.y - drag.startPt.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    gr.x = drag.startX + dx;
    gr.y = drag.startY + dy;
    requestRender();
    return;
  }

  if (drag.type === 'rotate') {
    // Erst ab einer echten Zieh-Bewegung frei drehen. Ohne diese Schwelle
    // würde schon das minimale Wackeln beim Antippen als Drehung gelten – der
    // Tipp-Kurzbefehl „90° drehen" (siehe onSvgPointerUp) käme nie zustande.
    if (!drag.moved) {
      const dxC = e.clientX - drag.startClientX;
      const dyC = e.clientY - drag.startClientY;
      if (Math.hypot(dxC, dyC) < 6) return;
      drag.moved = true;
    }
    const sec = state.sections[drag.si];
    // Winkel vom Sektionsanfang zum Finger – Sektion zeigt zum Finger
    let deg = Math.atan2(pt.y - sec.y0, pt.x - sec.x0) * 180 / Math.PI;
    if (snapEnabled) deg = snapAngle(deg);   // bei Magnet aus → frei drehbar
    setSectionAngle(sec, deg);
    syncRotSheet(sec);
    requestRender();
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

    requestRender();
    return;
  }

  const dPx = (pt.x - drag.startPt.x) * drag.dir.dx
            + (pt.y - drag.startPt.y) * drag.dir.dy;
  if (Math.abs(dPx) > 5) drag.moved = true;
  const newLen = snapLen(drag.startLen + dPx / PX_PER_M);
  if (newLen !== state.sections[drag.si].bays[drag.bi].len) {
    state.sections[drag.si].bays[drag.bi].len = newLen;
    requestRender();
  }
}

function onSvgPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  // Nach dem Loslassen eines Griffs schickt der Browser noch ein Klick-Event
  // an das SVG. Ohne diese Sperre würde der „leere Fläche angetippt →
  // Auswahl aufheben"-Handler die soeben getroffene Auswahl sofort wieder
  // verwerfen. Zeitstempel statt Flag, damit nichts hängen bleiben kann,
  // falls der Klick einmal ausbleibt.
  handleReleasedAt = Date.now();
  if (d.type === 'grundriss') {
    if (d.moved) { renderAll(); scheduleAutosave2d(); }
    else openGrundrissSheet();
    return;
  }
  if (d.type === 'rotate') {
    // Kurzer Tipp auf den Drehgriff (ohne Ziehen) = eine Vierteldrehung.
    // Damit ist „Feld drehen" eine einzige, sofort wirksame Berührung; das
    // freie Drehen bleibt über das Ziehen desselben Griffs erhalten.
    if (!d.moved) rotateSectionBy(d.si, 90);
    else renderAll();
    return;
  }
  if (d.type === 'move') {
    const sec = state.sections[d.si];
    if (!d.moved) {
      // Nichts verschoben → als Tipp auf das Feld behandeln (siehe
      // handleBayTap): Feld auswählen bzw. Bearbeiten öffnen.
      movePreview = null;
      handleBayTap(d.si, 0);
      return;
    }
    if (d.snap) {
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
  camSettleTimer = setTimeout(() => { requestRender(); updateZoomResetBtn(); }, delay);
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
  // Neue Berührung → die Klick-Sperre der VORIGEN Geste verfällt. Ohne dieses
  // Zurücksetzen blieb `canvasJustMoved` nach einem Wischen stehen (wenn der
  // Browser danach keinen Klick nachreichte) und verschluckte dann den
  // nächsten Tipp auf ein Feld – der erste Antippversuch blieb wirkungslos.
  if (!canvasPointers.size) canvasJustMoved = false;
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
  requestRender();
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
      requestRender();
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
  const syncInp = () => { inp.value = bay.len.toFixed(2); buildPosDetails(); buildKonsole(); requestRender(); };
  minusBtn.addEventListener('click', () => { bay.len = Math.max(0.25, +(bay.len - 0.25).toFixed(2)); syncInp(); });
  plusBtn.addEventListener('click',  () => { bay.len = +(bay.len + 0.25).toFixed(2); syncInp(); });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (v >= 0.25) { bay.len = +v.toFixed(2); buildPosDetails(); buildKonsole(); requestRender(); }
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
    requestRender();
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
    requestRender();
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

  // ── Abschnitt ────────────────────────────────────────────────────────────
  // Jedes Feld kann genau einem Abschnitt angehören ("Nordseite", "Abschnitt
  // A" …) – oder keinem, dann verhält es sich wie bisher.
  const abschLabel = document.createElement('div');
  abschLabel.className = 'sheet-section-label';
  abschLabel.textContent = 'Abschnitt';

  const abschRow = document.createElement('div');
  abschRow.className = 'pos-toggle-row sheet-absch-row';

  function buildAbschRow() {
    abschRow.innerHTML = '';
    const mk = (id, name, color) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pos-chip absch-chip' + ((bay.abschnittId || null) === id ? ' active' : '');
      chip.textContent = name;
      chip.style.setProperty('--pos-color', color);
      chip.addEventListener('click', () => {
        bay.abschnittId = id;
        buildAbschRow();
        requestRender({ sidebar: true, bulk: true });
      });
      abschRow.appendChild(chip);
    };
    mk(null, 'Ohne Abschnitt', '#8a97a5');
    abschnitteList().forEach(a => mk(a.id, a.name, a.color));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'pos-chip absch-new-chip';
    add.textContent = '+ neuer Abschnitt';
    add.addEventListener('click', () => {
      const name = prompt('Name des Abschnitts (z. B. „Nordseite"):',
                          `Abschnitt ${abschnitteList().length + 1}`);
      if (name === null) return;
      const a = addAbschnitt(name.trim());
      bay.abschnittId = a.id;
      buildAbschRow();
      requestRender({ sidebar: true, bulk: true });
    });
    abschRow.appendChild(add);
  }
  buildAbschRow();

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
      requestRender();
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
    requestRender();
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
    requestRender();
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
      requestRender();
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
        requestRender();
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
      buildKonsole(); requestRender();
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
        requestRender();
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
        requestRender();
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
      requestRender();
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
      requestRender();
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
        requestRender();
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
    buildKonsole(); requestRender();
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
  noteInp.addEventListener('input', () => { bay.note = noteInp.value; requestRender(); });

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
        buildPosDetails(); buildKonsole(); requestRender();
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
  copyBtn.addEventListener('click', () => { copyBayPositions(bay); closeSheet(); });

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'sheet-paste' + (copiedBayData ? ' active' : '');
  pasteBtn.textContent = '📋 Position einfügen';
  pasteBtn.disabled = !copiedBayData;
  pasteBtn.title = copiedBayData ? 'Übernommen wird: ' + pasteScopeText() : '';
  pasteBtn.addEventListener('click', () => {
    pasteBayPositions(bay);
    requestRender();
    closeSheet();
    openEditSheet(si, bi);   // Sheet mit den neuen Werten neu aufbauen
  });

  copyPasteRow.appendChild(copyBtn);
  copyPasteRow.appendChild(pasteBtn);

  // Welche Eigenschaften das Einfügen überträgt – gleiche Auswahl wie bei der
  // Mehrfachauswahl, damit „Einfügen" überall dasselbe bedeutet.
  const pasteScopeHint = document.createElement('div');
  pasteScopeHint.className = 'sheet-subsection-label';
  pasteScopeHint.textContent = 'Einfügen überträgt';
  const pasteScope = buildPasteScopeRow(() => {
    pasteBtn.title = copiedBayData ? 'Übernommen wird: ' + pasteScopeText() : '';
  });

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
  sheet.appendChild(abschLabel);
  sheet.appendChild(abschRow);
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
  sheet.appendChild(pasteScopeHint);
  sheet.appendChild(pasteScope);
  sheet.appendChild(mirrorLabel);
  sheet.appendChild(mirrorRow);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/* ── Grundriss-Dialog ────────────────────────────────────────────────────────
   Bild wählen, ausrichten, Maßstab setzen – und daraus Eckentypen vorschlagen
   lassen. Bewusst ein eigener Dialog statt Werkzeugleiste: die Ausrichtung ist
   eine kurze, in sich geschlossene Tätigkeit vor dem eigentlichen Zeichnen. */

async function onGrundrissFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = dataUrl;
    });

    // Startmaßstab: den Grundriss etwa so breit legen wie das bereits
    // gezeichnete Gerüst (oder 30 m, wenn noch nichts da ist). Näher als das
    // kommt keine Automatik heran – der genaue Maßstab kommt über die
    // Referenzstrecke.
    const box = contentBounds();
    const zielBreite = box && box.w > 0 ? box.w * 1.4 : 30 * PX_PER_M;
    const mitte = box
      ? { x: box.minX + box.w / 2, y: box.minY + box.h / 2 }
      : { x: 0, y: 0 };

    state.grundriss = {
      ...GRUNDRISS_DEFAULTS,
      dataUrl, w: img.naturalWidth, h: img.naturalHeight,
      x: mitte.x, y: mitte.y,
      scale: zielBreite / img.naturalWidth
    };
    _grMaskeSrc = null; _grMaske = null;
    autoFit = true;
    renderAll();
    scheduleAutosave2d();
    showToast('Grundriss eingefügt – jetzt ausrichten und Maßstab setzen');
    openGrundrissSheet();
  } catch (_) {
    showToast('Das Bild konnte nicht gelesen werden');
  }
}

function openGrundrissSheet() {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', () => { renderAll(); closeSheet(); });

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', ev => ev.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = 'Grundriss als Hintergrund';
  sheet.appendChild(hdr);

  const gr = grundrissLayer();

  if (!gr) {
    const p = document.createElement('p');
    p.className = 'pdf-sheet-note';
    p.textContent = 'Legen Sie einen Grundriss (Foto, Scan oder Screenshot) unter '
                  + 'die Zeichnung. Sie können die Gerüstachsen dann direkt darüber '
                  + 'abgreifen – und aus dem Grundriss ableiten lassen, ob eine Ecke '
                  + 'innen oder außen liegt.';
    sheet.appendChild(p);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'sheet-ok';
    add.textContent = 'Bild auswählen';
    add.addEventListener('click', () => document.getElementById('grundrissFileInput').click());
    const row = document.createElement('div');
    row.className = 'sheet-actions';
    row.appendChild(add);
    sheet.appendChild(row);
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));
    return;
  }

  const note = document.createElement('p');
  note.className = 'pdf-sheet-note';
  note.textContent = 'Ziehen Sie den 🗺-Griff, um den Grundriss zu verschieben. '
                   + 'Den Maßstab setzen Sie am zuverlässigsten über eine bekannte '
                   + 'Strecke im Plan (Maßkette, Gebäudekante).';
  sheet.appendChild(note);

  /** Zahlenregler-Zeile. */
  const regler = (label, wert, min, max, step, onInput, format) => {
    const row = document.createElement('div');
    row.className = 'aufmass-cfg-row';
    const lab = document.createElement('span');
    lab.className = 'aufmass-cfg-label';
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = wert; inp.className = 'grundriss-slider';
    const out = document.createElement('span');
    out.className = 'aufmass-cfg-label';
    out.textContent = format(wert);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      out.textContent = format(v);
      onInput(v);
      requestRender();
      scheduleAutosave2d();
    });
    row.appendChild(lab); row.appendChild(inp); row.appendChild(out);
    sheet.appendChild(row);
    return inp;
  };

  regler('Deckkraft', gr.opacity, 0.05, 1, 0.05,
    v => { gr.opacity = v; }, v => Math.round(v * 100) + ' %');
  regler('Drehung', gr.rot, 0, 359, 1,
    v => { gr.rot = v; }, v => Math.round(v) + '°');
  // Größe als Faktor auf den aktuellen Maßstab: absolute Bildpixel sagen dem
  // Nutzer nichts, die relative Feinkorrektur nach der Referenzstrecke schon.
  const basisScale = gr.scale;
  regler('Größe', 1, 0.25, 4, 0.01,
    v => { gr.scale = basisScale * v; }, v => Math.round(v * 100) + ' %');

  const massBtn = document.createElement('button');
  massBtn.type = 'button'; massBtn.className = 'sheet-copy';
  massBtn.textContent = '📏 Maßstab über Referenzstrecke setzen';
  massBtn.addEventListener('click', starteGrundrissMessung);
  const massRow = document.createElement('div');
  massRow.className = 'sheet-actions';
  massRow.appendChild(massBtn);
  sheet.appendChild(massRow);

  // ── Sichtbarkeit / Sperre ───────────────────────────────────────────────
  [['Grundriss einblenden', 'visible'], ['Gegen Verschieben sperren', 'locked']]
    .forEach(([txt, feld]) => {
      const row = document.createElement('label');
      row.className = 'pdf-opt-row';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = !!gr[feld];
      const span = document.createElement('span');
      span.innerHTML = `<strong>${txt}</strong>`;
      chk.addEventListener('change', () => {
        gr[feld] = chk.checked; renderAll(); scheduleAutosave2d();
      });
      row.appendChild(chk); row.appendChild(span);
      sheet.appendChild(row);
    });

  // ── Ecken aus dem Grundriss ableiten ────────────────────────────────────
  const eckLabel = document.createElement('div');
  eckLabel.className = 'sheet-section-label';
  eckLabel.textContent = 'Ecken aus dem Grundriss bestimmen';
  sheet.appendChild(eckLabel);

  const eckNote = document.createElement('p');
  eckNote.className = 'pdf-sheet-note';
  eckNote.textContent = 'Prüft für jeden Achsknoten, wie viel Gebäude ringsum '
                      + 'liegt: viel Gebäude = Innenecke, wenig = Außenecke. '
                      + 'Setzt voraus, dass der Grundriss maßstäblich unter den '
                      + 'Achsen liegt.';
  sheet.appendChild(eckNote);

  const erg = document.createElement('div');
  erg.className = 'aufmass-summary';
  erg.style.display = 'none';
  sheet.appendChild(erg);

  const analyseBtn = document.createElement('button');
  analyseBtn.type = 'button'; analyseBtn.className = 'sheet-copy';
  analyseBtn.textContent = '🔍 Ecken auswerten';
  analyseBtn.addEventListener('click', async () => {
    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Wird ausgewertet …';
    const res = await grundrissEckVorschlaege();
    analyseBtn.disabled = false;
    analyseBtn.textContent = '🔍 Ecken auswerten';
    erg.style.display = '';
    if (res.fehler) { erg.textContent = res.fehler; return; }
    if (!res.ecken.length) { erg.textContent = 'Es sind noch keine Ecken gezeichnet.'; return; }

    // Nur eindeutige Ergebnisse übernehmen. Ein knapper Ringanteil bedeutet,
    // dass der Knoten im Plan nicht sauber freisteht – dann ist ein falscher
    // Automatikwert schlimmer als gar keiner.
    let gesetzt = 0, unklar = 0;
    res.ecken.forEach(v => {
      if (!v.art || v.sicherheit < 0.35) { unklar++; return; }
      setEckWahl(v.key, { typ: v.art });
      gesetzt++;
    });
    renderAll(); scheduleAutosave2d();
    erg.textContent = `${gesetzt} von ${res.ecken.length} Ecken aus dem Grundriss gesetzt`
      + (unklar ? `, ${unklar} nicht eindeutig (bitte in der Zeichnung antippen).` : '.')
      + ' Welche Achse an einer Innenecke durchläuft, legen Sie weiterhin selbst fest.';
  });
  const analyseRow = document.createElement('div');
  analyseRow.className = 'sheet-actions';
  analyseRow.appendChild(analyseBtn);
  sheet.appendChild(analyseRow);

  // ── Aktionen ────────────────────────────────────────────────────────────
  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'sheet-delete';
  delBtn.textContent = 'Entfernen';
  delBtn.addEventListener('click', () => {
    state.grundriss = null;
    _grMaskeSrc = null; _grMaske = null;
    renderAll(); scheduleAutosave2d(); closeSheet();
  });
  const swapBtn = document.createElement('button');
  swapBtn.type = 'button'; swapBtn.className = 'sheet-copy';
  swapBtn.textContent = 'Anderes Bild';
  swapBtn.addEventListener('click', () => document.getElementById('grundrissFileInput').click());
  const okBtn = document.createElement('button');
  okBtn.type = 'button'; okBtn.className = 'sheet-ok';
  okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });
  actRow.appendChild(delBtn); actRow.appendChild(swapBtn); actRow.appendChild(okBtn);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/* ── Ecken-Dialog ────────────────────────────────────────────────────────────
   Öffnet sich beim Tippen auf eine Eck-Markierung in der Zeichnung. Hier
   entscheidet der Nutzer zweierlei:

     1. Ist es eine Außen- oder eine Innenecke? Vorgabe ist die geometrische
        Erkennung (die stimmt, solange die Gerüsttiefe in der Zeichnung auf der
        Gebäude-Außenseite liegt) – überschreibbar bleibt sie trotzdem.
     2. Bei einer Innenecke: WELCHE Achse läuft durch (−) und welche füllt die
        Ecke aus (+)? Das ist eine Planungsentscheidung, keine Geometriefrage,
        deshalb trifft sie der Nutzer. Beide Knöpfe zeigen sofort die
        resultierende Aufmaßlänge beider Achsen, damit die Wirkung der Wahl
        ohne Umweg über den PDF-Export sichtbar ist.                          */

function openEckSheet(key) {
  const finde = () => eckenListe().find(e => e.key === key);
  if (!finde()) return;
  closeSheet();

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
  sheet.appendChild(hdr);

  const note = document.createElement('p');
  note.className = 'pdf-sheet-note';
  sheet.appendChild(note);

  // ── Eckenart ────────────────────────────────────────────────────────────
  const artLabel = document.createElement('div');
  artLabel.className = 'sheet-section-label';
  artLabel.textContent = 'Art der Ecke';
  sheet.appendChild(artLabel);

  const artRow = document.createElement('div');
  artRow.className = 'aufmass-preset-row';
  sheet.appendChild(artRow);

  // Nur sinnvoll, wenn ein Grundriss hinterlegt ist – sonst gibt es nichts
  // auszuwerten. Der Knopf blendet sich in sync() entsprechend aus.
  const grBtn = document.createElement('button');
  grBtn.type = 'button'; grBtn.className = 'sheet-copy';
  grBtn.textContent = '🗺️ Aus Grundriss bestimmen';
  grBtn.addEventListener('click', async () => {
    grBtn.disabled = true;
    const res = await grundrissEckVorschlaege();
    grBtn.disabled = false;
    const v = res.ecken.find(x => x.key === key);
    if (res.fehler)                   { showToast(res.fehler); return; }
    if (!v || !v.art)                 { showToast('Diese Ecke liegt nicht im Grundriss'); return; }
    if (v.sicherheit < 0.35)          { showToast('Der Grundriss ist hier nicht eindeutig'); return; }
    setEckWahl(key, { typ: v.art });
    showToast(`Grundriss: ${v.art === 'innen' ? 'Innenecke' : 'Außenecke'} `
            + `(${Math.round(v.anteil * 100)} % Gebäude ringsum)`);
    renderAll(); sync(); scheduleAutosave2d();
  });
  const grRow = document.createElement('div');
  grRow.className = 'sheet-actions';
  grRow.appendChild(grBtn);
  sheet.appendChild(grRow);

  // ── Zuordnung bei Innenecke ─────────────────────────────────────────────
  const zuLabel = document.createElement('div');
  zuLabel.className = 'sheet-section-label';
  zuLabel.textContent = 'Welche Achse läuft durch?';
  sheet.appendChild(zuLabel);

  const zuHint = document.createElement('p');
  zuHint.className = 'pdf-sheet-note';
  sheet.appendChild(zuHint);

  const zuRow = document.createElement('div');
  zuRow.className = 'eck-choice-row';
  sheet.appendChild(zuRow);

  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';
  const okBtn = document.createElement('button');
  okBtn.type = 'button'; okBtn.className = 'sheet-ok';
  okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', () => { renderAll(); closeSheet(); });
  actRow.appendChild(okBtn);
  sheet.appendChild(actRow);

  /** Baut den Inhalt aus dem aktuellen Zustand neu auf. */
  const sync = () => {
    const e = finde();
    if (!e) { closeSheet(); return; }
    const secDurch = state.sections[e.durchSi], secFuell = state.sections[e.fuellSi];
    const nameSi = state.sections[e.si].name, nameNi = state.sections[e.ni].name;

    hdr.textContent = `Ecke ${nameSi} / ${nameNi}`;
    note.textContent = e.art === 'innen'
      ? 'Innenecke: die beiden Gerüstbahnen überlappen sich. Die Ecklänge wird '
        + 'einmal abgezogen und einmal zugeschlagen – in der Summe neutral.'
      : 'Außenecke: zwischen den Bahnen bleibt eine Lücke, die das Eckstück '
        + 'schließt. Nach DIN 18451 zählt sie bei beiden Seiten (La = L + L1).';

    grBtn.style.display = grundrissLayer() ? '' : 'none';

    artRow.replaceChildren();
    [['auto', `Automatik (${e.artAuto === 'innen' ? 'Innenecke' : 'Außenecke'})`],
     ['aussen', 'Außenecke'], ['innen', 'Innenecke']].forEach(([wert, txt]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'aufmass-preset';
      b.textContent = txt;
      const aktiv = wert === 'auto' ? !e.typBestaetigt : (e.typBestaetigt && e.art === wert);
      b.classList.toggle('active', aktiv);
      b.addEventListener('click', () => {
        setEckWahl(key, { typ: wert === 'auto' ? null : wert });
        renderAll(); sync();
      });
      artRow.appendChild(b);
    });

    const istInnen = e.art === 'innen';
    zuLabel.style.display = istInnen ? '' : 'none';
    zuHint.style.display  = istInnen ? '' : 'none';
    zuRow.style.display   = istInnen ? '' : 'none';
    if (!istInnen) return;

    const bbLinie = e.bordbrettId ? bordbrettById(e.bordbrettId) : null;
    zuHint.textContent = e.quelle === 'bordbrett'
      ? `Ergibt sich aus dem gezeichneten Verlauf von „${bbLinie ? bordbrettName(bbLinie) : 'Bordbrett'}". `
        + 'Ein Tipp hier setzt sich darüber hinweg.'
        + (e.bordbrettKonflikt
           ? ' Achtung: zwei Bordbretter-Linien widersprechen sich an dieser Ecke.'
           : '')
      : (e.bestaetigt
          ? 'Ihre Festlegung. Antippen, um sie zu ändern.'
          : 'Noch nicht festgelegt – bis dahin gilt der Vorschlag (die längere '
            + 'Achse läuft durch). Bitte bestätigen oder ändern.');

    // Beide Möglichkeiten mit ihrem jeweiligen Ergebnis anbieten. Dafür wird
    // die Wahl kurz probeweise gesetzt und danach wiederhergestellt – so
    // stimmen die angezeigten Längen mit dem PDF garantiert überein.
    const vorher = { ...eckWahl(key) };
    const varianten = [e.si, e.ni].map(si => {
      setEckWahl(key, { durch: state.sections[si].id });
      const achsen = aufmassAchsen();
      const zeile = idx => {
        const a = achsen.find(x => x.chain.includes(idx));
        return a ? `${a.name}: ${fmtQty(a.m.laenge)} m` : '–';
      };
      return { si, durch: zeile(si), fuell: zeile(si === e.si ? e.ni : e.si) };
    });
    state.ecken[key] = vorher;
    if (!Object.keys(vorher).length) delete state.ecken[key];

    zuRow.replaceChildren();
    varianten.forEach(v => {
      const sec = state.sections[v.si];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'eck-choice';
      b.classList.toggle('active', v.si === e.durchSi);
      const t1 = document.createElement('strong');
      t1.textContent = `${sec.name} läuft durch`;
      const t2 = document.createElement('span');
      t2.className = 'eck-choice-sub';
      t2.textContent = `${v.durch}  ·  ${v.fuell}`;
      b.appendChild(t1); b.appendChild(t2);
      b.addEventListener('click', () => {
        setEckWahl(key, { durch: sec.id });
        renderAll(); sync();
      });
      zuRow.appendChild(b);
    });
  };

  sync();
  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/* ── Bordbretter-Dialog ──────────────────────────────────────────────────────
   Hier wird die gezeichnete Linie einer ACHSE zugeordnet. Alles Weitere ergibt
   sich daraus von selbst: das Programm liest den Verlauf entlang der Felder
   aus, erkennt die durchlaufenen Innen- und Außenecken und korrigiert die
   Achslänge um die Gerüsttiefe. Der Dialog zeigt beides – die erkannten Ecken
   und die daraus folgende Aufmaßlänge –, damit die Zahl nicht aus dem Nichts
   kommt.                                                                     */

function openBordbrettSheet(id) {
  if (!bordbrettById(id)) return;
  closeSheet();

  const fertigUndZu = () => { renderAll(); scheduleAutosave2d(); closeSheet(); };

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', fertigUndZu);

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  sheet.appendChild(hdr);

  const note = document.createElement('p');
  note.className = 'pdf-sheet-note';
  note.textContent = 'Die Linie folgt den Bordbrettern am Rand der Gerüstlage. '
    + 'Ordnen Sie sie einer Achse zu – die Eckenkorrektur rechnet das Programm '
    + 'dann selbst: Innenecke − Gerüsttiefe, Außenecke + Gerüsttiefe.';
  sheet.appendChild(note);

  const achsLabel = document.createElement('div');
  achsLabel.className = 'sheet-section-label';
  achsLabel.textContent = 'Achse zuordnen';
  sheet.appendChild(achsLabel);

  const achsRow = document.createElement('div');
  achsRow.className = 'eck-choice-row bordbrett-achs-row';
  sheet.appendChild(achsRow);

  const verlaufLabel = document.createElement('div');
  verlaufLabel.className = 'sheet-section-label';
  verlaufLabel.textContent = 'Erkannter Verlauf';
  sheet.appendChild(verlaufLabel);

  const verlauf = document.createElement('div');
  verlauf.className = 'bordbrett-verlauf';
  sheet.appendChild(verlauf);

  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'sheet-del';
  delBtn.textContent = 'Linie löschen';
  delBtn.addEventListener('click', () => {
    loescheBordbrett(id);
    showToast('Bordbretter-Linie gelöscht');
    fertigUndZu();
  });
  const okBtn = document.createElement('button');
  okBtn.type = 'button'; okBtn.className = 'sheet-ok';
  okBtn.textContent = 'Fertig';
  okBtn.addEventListener('click', fertigUndZu);
  actRow.appendChild(delBtn); actRow.appendChild(okBtn);
  sheet.appendChild(actRow);

  /** Aufmaßlänge einer Achse, WENN die Linie ihr zugeordnet wäre. Dafür wird
   *  die Zuordnung kurz probeweise gesetzt und danach wiederhergestellt – so
   *  stimmt die angezeigte Länge garantiert mit dem PDF überein. */
  const probe = (linie, achse) => {
    const vorher = linie.achseSecId;
    bordbrettZuordnen(linie, achse);
    const a = aufmassAchsen().find(x => x.idx === achse.idx);
    linie.achseSecId = vorher;
    invalidateEckenCache();
    return a ? a.m.laenge : null;
  };

  const sync = () => {
    const linie = bordbrettById(id);
    if (!linie) { closeSheet(); return; }
    const achsen  = achsenListe();
    const aktuell = bordbrettAchse(linie, achsen);

    hdr.textContent = `${bordbrettName(linie)} · ${fmtQty(bordbrettLaenge(linie))} m gezeichnet`;

    // ── Achsen zur Auswahl ────────────────────────────────────────────────
    // Angeboten werden die Achsen, an denen die Linie tatsächlich entlangläuft –
    // sonst stünden bei großen Zeichnungen dutzende belangloser Achsen im
    // Dialog.
    const beruehrt = bordbrettBeruehrteAchsen(linie);
    if (aktuell && !beruehrt.includes(aktuell.idx)) beruehrt.unshift(aktuell.idx);

    achsRow.replaceChildren();
    if (!beruehrt.length) {
      const p = document.createElement('p');
      p.className = 'pdf-sheet-note';
      p.textContent = 'Die Linie verläuft an keinem Gerüstfeld entlang. Bitte '
                    + 'löschen und näher an den Feldkanten neu zeichnen.';
      achsRow.appendChild(p);
    }
    beruehrt.forEach(i => {
      const achse = achsen[i];
      if (!achse) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'eck-choice bordbrett-achs';
      b.classList.toggle('active', !!aktuell && aktuell.idx === achse.idx);
      const t1 = document.createElement('strong');
      t1.textContent = achse.name;
      const t2 = document.createElement('span');
      t2.className = 'eck-choice-sub';
      const len = probe(linie, achse);
      t2.textContent = `${achse.bays.length} Feld${achse.bays.length === 1 ? '' : 'er'} `
                     + `·  Aufmaß ${len != null ? fmtQty(len) + ' m' : '–'}`;
      b.appendChild(t1); b.appendChild(t2);
      b.addEventListener('click', () => {
        bordbrettZuordnen(linie, achse);
        renderAll(); scheduleAutosave2d(); sync();
      });
      achsRow.appendChild(b);
    });
    if (aktuell) {
      const off = document.createElement('button');
      off.type = 'button'; off.className = 'eck-choice bordbrett-achs';
      const o1 = document.createElement('strong');
      o1.textContent = 'Zuordnung aufheben';
      const o2 = document.createElement('span');
      o2.className = 'eck-choice-sub';
      o2.textContent = 'Linie bleibt als Notiz erhalten, wirkt aber nicht aufs Aufmaß';
      off.appendChild(o1); off.appendChild(o2);
      off.addEventListener('click', () => {
        bordbrettZuordnen(linie, null);
        renderAll(); scheduleAutosave2d(); sync();
      });
      achsRow.appendChild(off);
    }

    // ── Verlauf & Wirkung ─────────────────────────────────────────────────
    verlauf.replaceChildren();
    const zeile = (txt, cls) => {
      const d = document.createElement('div');
      d.className = 'bordbrett-zeile' + (cls ? ' ' + cls : '');
      d.textContent = txt;
      verlauf.appendChild(d);
    };

    if (!aktuell) {
      zeile('Noch keiner Achse zugeordnet – die Linie wirkt erst danach aufs '
          + 'Aufmaß.', 'neutral');
    } else {
      const aus = bordbrettAuswertung(linie, achsen);
      const rollen = bordbrettEckRollen();
      const seiteTxt = { start: 'Achsanfang', ende: 'Achsende' };
      aus.enden.forEach(e => {
        if (!e.ecke) {
          if (e.zustand !== 'buendig' && e.zustand !== 'unklar') {
            zeile(`${seiteTxt[e.seite]}: hier trifft keine andere Achse an – `
                + 'keine Eckenkorrektur.', 'neutral');
          }
          return;
        }
        const nameSi = state.sections[e.ecke.si] ? state.sections[e.ecke.si].name : '?';
        const nameNi = state.sections[e.ecke.ni] ? state.sections[e.ecke.ni].name : '?';
        const artTxt = e.ecke.art === 'innen' ? 'Innenecke' : 'Außenecke';
        if (!e.rolle) {
          zeile(`${artTxt} ${nameSi}/${nameNi} am ${seiteTxt[e.seite]}: `
              + (e.zustand === 'buendig'
                 ? 'die Linie endet bündig mit der Achse – keine Korrektur.'
                 : `die Linie endet ${fmtQty(Math.abs(e.roh))} m `
                   + `${e.roh < 0 ? 'vor' : 'hinter'} dem Achsende und passt damit `
                   + `nicht zur Gerüsttiefe (${fmtQty(state.depth)} m) – keine `
                   + 'Korrektur. Bitte die Linie an der Feldkante nachziehen.'),
            e.zustand === 'buendig' ? 'neutral' : 'warn');
          return;
        }
        const konflikt = (rollen.get(e.ecke.key) || {}).konflikt;
        const sec = state.sections[e.achsSi];
        zeile(e.ecke.art === 'innen'
          ? (e.rolle === 'durchlaufend'
              ? `${artTxt} ${nameSi}/${nameNi}: ${sec ? sec.name : '?'} läuft durch → `
                + `letztes Feld vor der Ecke − ${fmtQty(Math.abs(e.delta))} m`
              : `${artTxt} ${nameSi}/${nameNi}: ${sec ? sec.name : '?'} füllt die Ecke `
                + `aus → Feld an der Ecke + ${fmtQty(Math.abs(e.delta))} m`)
          : `${artTxt} ${nameSi}/${nameNi}: ${sec ? sec.name : '?'} läuft um die Ecke → `
            + `Feld an der Ecke + ${fmtQty(Math.abs(e.delta))} m`,
          e.delta < 0 ? 'minus' : 'plus');
        if (konflikt) {
          zeile('An dieser Innenecke widersprechen sich zwei Bordbretter-Linien. '
              + 'Es gilt die zuerst gezeichnete – über das Eck-Symbol in der '
              + 'Zeichnung lässt sich die Zuordnung festlegen.', 'warn');
        }
      });

      const m = aufmassAchsen().find(x => x.idx === aktuell.idx);
      if (m) {
        zeile(`${aktuell.name}: ${m.rechenweg} = ${fmtQty(m.m.laenge)} m`, 'summe');
      }
    }
    zeile(`Korrekturwert = Gerüsttiefe ${fmtQty(state.depth)} m`
        + (aufmassRules().innenecke.wert != null || aufmassRules().eckzuschlag.wert != null
           ? ' (in den Aufmaßregeln überschrieben)' : ''), 'neutral');
  };

  sync();
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
  // Die ID sofort freigeben: das Sheet bleibt für die Schließ-Animation noch
  // 230 ms im DOM. Wird in dieser Zeit ein neues geöffnet (Einfügen baut das
  // Sheet z. B. direkt neu auf), fände getElementById sonst weiterhin das ALTE
  // und Klicks landeten in dessen Handlern.
  s.id = '';
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

/** Alle aktuell "gemeinten" Felder: in der Mehrfachauswahl die angehakten,
 *  sonst das einzeln ausgewählte Feld. */
function currentSelectionBays() {
  if (bulkMode) return allBaysFlat().filter(b => bulkSelected.has(b.id));
  if (selectedSi == null) return [];
  const sec = state.sections[selectedSi];
  const bay = sec && sec.bays[selectedBi];
  return bay ? [bay] : [];
}

/* ── Abschnitts-Verwaltung (Seitenleiste) ────────────────────────────────────
   Abschnitte anlegen, umbenennen, löschen – und mit einem Klick alle Felder
   eines Abschnitts in die Mehrfachauswahl übernehmen. */

function renderAbschnittBar() {
  const el = document.getElementById('abschnittBar');
  if (!el) return;
  el.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'absch-head';

  const title = document.createElement('span');
  title.className = 'absch-title';
  title.textContent = 'Abschnitte';

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'absch-add-btn';
  addBtn.textContent = '+ Abschnitt';
  addBtn.title = 'Neuen Abschnitt anlegen (z. B. „Nordseite")';
  addBtn.addEventListener('click', () => {
    const name = prompt('Name des Abschnitts (z. B. „Nordseite", „Abschnitt A"):',
                        `Abschnitt ${abschnitteList().length + 1}`);
    if (name === null) return;
    const a = addAbschnitt(name.trim());
    // Direkt nutzbar: liegt eine Auswahl vor, wandert sie gleich in den neuen
    // Abschnitt – das ist der mit Abstand häufigste nächste Schritt.
    const sel = currentSelectionBays();
    if (sel.length) {
      assignAbschnitt(sel, a.id);
      showToast(`Abschnitt „${a.name}" angelegt · ${sel.length} Feld${sel.length === 1 ? '' : 'er'} zugeordnet`);
    } else {
      showToast(`Abschnitt „${a.name}" angelegt`);
    }
    renderAll();
  });

  head.appendChild(title); head.appendChild(addBtn);
  el.appendChild(head);

  // Sammelknopf, sobald irgendetwas ausgeblendet ist – so ist der Weg zurück
  // zur vollständigen Ansicht immer einen Klick entfernt.
  const nHidden = hiddenGroupCount();
  if (nHidden) {
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'absch-showall-btn';
    showAll.textContent = `👁 Alle einblenden (${nHidden} ausgeblendet)`;
    showAll.title = 'Alle ausgeblendeten Abschnitte wieder anzeigen';
    showAll.addEventListener('click', () => { showAllAbschnitte(); renderAll(); });
    el.appendChild(showAll);
  }

  const list = abschnitteList();
  if (!list.length) {
    const hint = document.createElement('p');
    hint.className = 'absch-hint';
    hint.textContent = 'Noch keine Abschnitte. Felder ohne Abschnitt funktionieren normal weiter.';
    el.appendChild(hint);
    return;
  }

  const counts = abschnittCounts();
  const wrap = document.createElement('div');
  wrap.className = 'absch-list';

  const makeRow = (a, count) => {
    const id     = a ? a.id : null;
    const hidden = a ? !!a.hidden : !!state.hideUnassigned;
    const row = document.createElement('div');
    row.className = 'absch-row' + (hidden ? ' absch-hidden' : '');
    row.style.setProperty('--absch-color', a ? a.color : '#8a97a5');

    // Sichtbarkeit: blendet die Felder dieses Abschnitts auf der Zeichenfläche
    // aus/ein. Die Felder selbst bleiben unverändert erhalten.
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'absch-eye-btn' + (hidden ? ' off' : '');
    eye.textContent = hidden ? '🙈' : '👁';
    eye.setAttribute('aria-pressed', String(!hidden));
    eye.title = hidden
      ? 'Abschnitt einblenden (Felder sind nur ausgeblendet, nicht gelöscht)'
      : 'Abschnitt ausblenden (Felder bleiben erhalten)';
    eye.addEventListener('click', () => {
      setAbschnittHidden(id, !hidden);
      showToast(hidden
        ? `„${a ? a.name : 'Ohne Abschnitt'}" eingeblendet`
        : `„${a ? a.name : 'Ohne Abschnitt'}" ausgeblendet · ${count} Feld${count === 1 ? '' : 'er'} bleiben erhalten`);
      renderAll();
    });
    row.appendChild(eye);

    const dot = document.createElement('span');
    dot.className = 'absch-dot';

    const nameEl = document.createElement('span');
    nameEl.className = 'absch-name';
    nameEl.textContent = a ? a.name : 'Ohne Abschnitt';

    const cnt = document.createElement('span');
    cnt.className = 'absch-count';
    cnt.textContent = count + ' Feld' + (count === 1 ? '' : 'er');

    // Klick auf die Zeile: alle Felder dieses Abschnitts markieren
    // (schaltet die Mehrfachauswahl bei Bedarf ein).
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'absch-pick';
    pick.title = 'Alle Felder dieses Abschnitts auswählen';
    pick.appendChild(dot); pick.appendChild(nameEl); pick.appendChild(cnt);
    pick.addEventListener('click', () => {
      // Ein ausgeblendeter Abschnitt wird zuerst wieder eingeblendet – sonst
      // markierte man Felder, die man nicht sieht.
      if (hidden) setAbschnittHidden(id, false);
      bulkMode = true;
      bulkSelected.clear();
      allBaysFlat().forEach(b => {
        const match = a ? b.abschnittId === a.id : !abschnittById(b.abschnittId);
        if (match) bulkSelected.add(b.id);
      });
      renderAll();
    });
    row.appendChild(pick);

    if (a) {
      const ren = document.createElement('button');
      ren.type = 'button'; ren.className = 'absch-mini-btn';
      ren.textContent = '✎'; ren.title = 'Abschnitt umbenennen';
      ren.addEventListener('click', () => {
        const next = prompt('Neuer Name für den Abschnitt:', a.name);
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed) return;
        renameAbschnitt(a.id, trimmed);
        renderAll();
      });

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'absch-mini-btn danger';
      del.textContent = '×';
      del.title = 'Abschnitt löschen (Felder bleiben erhalten)';
      del.addEventListener('click', () => {
        if (count && !confirm(`Abschnitt „${a.name}" löschen?\n\nDie ${count} zugeordneten Felder bleiben erhalten und gelten danach als „Ohne Abschnitt".`)) return;
        deleteAbschnitt(a.id);
        showToast(`Abschnitt „${a.name}" gelöscht`);
        renderAll();
      });

      row.appendChild(ren); row.appendChild(del);
    }
    return row;
  };

  list.forEach(a => wrap.appendChild(makeRow(a, counts[a.id] || 0)));
  if (counts['']) wrap.appendChild(makeRow(null, counts['']));
  el.appendChild(wrap);
}

/** Zeigt oben links auf der Zeichenfläche, welche Felder gerade ausgewählt
 *  sind und welchem Abschnitt / welchen Abschnitten sie angehören. Bei
 *  Mehrfachauswahl ist das die geforderte Sammelanzeige, bei Einzelauswahl
 *  eine kompakte Zeile zum selben Zweck. */
function renderSelectionInfo() {
  const el = document.getElementById('selectionInfo');
  if (!el) return;
  const bays = currentSelectionBays();

  if (!bays.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  const sum = abschnittSummary(bays);
  el.innerHTML = '';
  el.classList.remove('hidden');
  el.classList.toggle('multi', bulkMode);

  const head = document.createElement('div');
  head.className = 'sel-info-head';
  head.textContent = bulkMode
    ? `${bays.length} Feld${bays.length === 1 ? '' : 'er'} ausgewählt`
    : 'Feld ' + bayLabel(state.sections[selectedSi], selectedBi);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'sel-info-body';

  const lbl = document.createElement('span');
  lbl.className = 'sel-info-label';
  lbl.textContent = sum.names.length > 1 ? 'Abschnitte:' : 'Abschnitt:';
  body.appendChild(lbl);

  const chips = document.createElement('span');
  chips.className = 'sel-info-chips';
  const addChip = (name, color) => {
    const c = document.createElement('span');
    c.className = 'sel-info-chip';
    c.style.setProperty('--absch-color', color);
    c.textContent = name;
    chips.appendChild(c);
  };
  sum.ids.forEach(id => addChip(abschnittName(id), abschnittColor(id)));
  if (sum.hasUnassigned) addChip('Ohne Abschnitt', '#8a97a5');
  body.appendChild(chips);
  el.appendChild(body);

  if (sum.mixed) {
    const note = document.createElement('div');
    note.className = 'sel-info-note';
    note.textContent = 'gemischte Zuordnung';
    el.appendChild(note);
  }
}

/**
 * Zusatzbauteil (Innengeländer, Netz, Dachfang, Tunnelrahmen …) für die GESAMTE
 * Mehrfachauswahl einstellen und in einem Zug anwenden.
 *
 * Hintergrund: Über die Mehrfachauswahl hinzugefügte Zusatzbauteile wurden
 * früher ohne jede Angabe angelegt – ohne Menge, ohne Lagen. Bei
 * lagenbasierten Bauteilen (z. B. Innengeländer) fehlte damit die Lagenzahl,
 * und weil sich die Länge erst aus „Lagen × Feldlänge" ergibt, blieb auch die
 * Länge leer. Jedes Feld musste einzeln nachgearbeitet werden.
 *
 * Jetzt werden Menge/Einheit bzw. Lagen EINMAL für alle ausgewählten Felder
 * abgefragt. Die Länge bleibt dabei bewusst feldspezifisch: Sie wird je Feld
 * aus dessen eigener Feldlänge gerechnet (Lagen × Feldlänge bzw. bei Einheit
 * „m"/„m²" die Feldlänge/-fläche als Vorgabewert), sodass unterschiedlich
 * lange Felder automatisch richtig herauskommen.
 */
function openBulkPosSheet(catKey, bays) {
  const p = POS_BY_KEY[catKey];
  if (!p || !bays.length) return;
  closeSheet();

  // Vorbelegung aus einem bereits vorhandenen Exemplar der Auswahl.
  const sample = bays.map(b => (b.positions || []).find(x => x.cat === catKey)).find(Boolean);
  let unit = (sample && sample.unit) || defaultUnit(catKey);
  let qty  = (sample && sample.qty != null) ? String(sample.qty) : '';
  // Lagen-Bauteile starten mit 1 Lage: ohne Lagenzahl gäbe es weder Menge noch
  // Länge – genau der Zustand, in dem früher jedes Feld nachgearbeitet werden
  // musste.
  if (unit === 'lagen' && qty === '') qty = '1';

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = `${p.label} für ${bays.length} Feld${bays.length === 1 ? '' : 'er'}`;
  sheet.appendChild(hdr);

  const unitLabel = document.createElement('div');
  unitLabel.className = 'sheet-section-label';
  unitLabel.textContent = 'Abrechnungseinheit';
  sheet.appendChild(unitLabel);

  const unitRow = document.createElement('div');
  unitRow.className = 'pos-unit-row bulk-pos-unit-row';
  sheet.appendChild(unitRow);

  const lagenLabelEl = document.createElement('div');
  lagenLabelEl.className = 'sheet-section-label';
  lagenLabelEl.textContent = 'Lagen (für alle ausgewählten Felder)';
  sheet.appendChild(lagenLabelEl);

  const lagenRow = document.createElement('div');
  lagenRow.className = 'konsole-lagen-row';
  sheet.appendChild(lagenRow);

  const qtyLabelEl = document.createElement('div');
  qtyLabelEl.className = 'sheet-section-label';
  qtyLabelEl.textContent = 'Menge je Feld';
  sheet.appendChild(qtyLabelEl);

  const qtyRow = document.createElement('div');
  qtyRow.className = 'bulk-pos-qty-row';
  const qtyInp = document.createElement('input');
  qtyInp.type = 'number'; qtyInp.className = 'pos-detail-qty';
  qtyInp.min = '0'; qtyInp.step = 'any'; qtyInp.inputMode = 'decimal';
  const qtyHint = document.createElement('span');
  qtyHint.className = 'bulk-pos-qty-hint';
  qtyRow.appendChild(qtyInp); qtyRow.appendChild(qtyHint);
  sheet.appendChild(qtyRow);

  const preview = document.createElement('div');
  preview.className = 'bulk-pos-preview';
  sheet.appendChild(preview);

  /** Testposition mit dem aktuellen Formularstand (für die Vorschau). */
  const draft = () => ({ cat: catKey, unit, qty: qty === '' ? null : parseFloat(qty) });

  const sync = () => {
    const isLagen = unit === 'lagen';
    lagenLabelEl.style.display = isLagen ? '' : 'none';
    lagenRow.style.display     = isLagen ? '' : 'none';
    qtyLabelEl.style.display   = isLagen ? 'none' : '';
    qtyRow.style.display       = isLagen ? 'none' : '';

    unitRow.querySelectorAll('.punit-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.unit === unit));
    lagenRow.querySelectorAll('.klagen-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.lagen === qty));
    if (document.activeElement !== qtyInp) qtyInp.value = isLagen ? '' : qty;

    // Vorgabewert je Einheit – ohne eigene Eingabe rechnet jedes Feld mit
    // seiner eigenen Länge bzw. Fläche.
    qtyHint.textContent = unit === 'm'
      ? 'leer = je Feld die eigene Feldlänge'
      : unit === 'm2'
        ? 'leer = je Feld Länge × Höhe bzw. Länge × Gerüsttiefe'
        : 'Anzahl je Feld';
    qtyInp.placeholder = unit === 'm' || unit === 'm2' ? 'automatisch' : 'Anz.';

    // Vorschau: was ergibt die Eingabe konkret – je Feld und in Summe?
    const d = draft();
    let meters = 0, mCount = 0, missing = 0;
    bays.forEach(bay => {
      const m = posMeters(d, bay);
      if (m != null) { meters += m; mCount++; }
      else if (effQty(d, bay) == null) missing++;
    });
    const first = bays[0];
    const per = posMeters(d, first) != null
      ? `je Feld z. B. ${fmtQty(posMeters(d, first))} m (${fmtQty(first.len)} m Feldlänge)`
      : (effQty(d, first) != null ? `je Feld ${qtyLabel(d, first)}` : '');
    preview.textContent = missing
      ? `⚠ ${missing} Feld${missing === 1 ? '' : 'er'} ohne Menge – bitte Wert bzw. Lagen angeben.`
      : (mCount ? `${per}  ·  gesamt ${fmtQty(meters)} m über ${bays.length} Felder`
                : per || `wird auf ${bays.length} Felder angewendet`);
    preview.classList.toggle('warn', !!missing);
  };

  UNIT_DEFS.forEach(([val, lbl]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'punit-btn';
    b.dataset.unit = val; b.textContent = lbl;
    b.addEventListener('click', () => {
      unit = val;
      // Beim Wechsel auf/von Lagen ist der alte Wert bedeutungslos.
      if (val === 'lagen' && !/^\d+$/.test(qty)) qty = '1';
      sync();
    });
    unitRow.appendChild(b);
  });

  [['1', '1 Lage'], ['2', '2 Lagen'], ['3', '3 Lagen'], ['4', '4 Lagen'], ['5', '5 Lagen']]
    .forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'klagen-btn';
      b.dataset.lagen = val; b.textContent = lbl;
      b.addEventListener('click', () => { qty = val; freeLagen.value = ''; sync(); });
      lagenRow.appendChild(b);
    });
  const freeLagen = document.createElement('input');
  freeLagen.type = 'number'; freeLagen.className = 'klagen-free';
  freeLagen.min = '1'; freeLagen.step = '1'; freeLagen.inputMode = 'numeric';
  freeLagen.placeholder = 'Anz.';
  freeLagen.addEventListener('input', () => {
    const v = parseInt(freeLagen.value, 10);
    if (!isNaN(v) && v > 0) { qty = String(v); sync(); }
  });
  lagenRow.appendChild(freeLagen);

  qtyInp.addEventListener('input', () => { qty = qtyInp.value; sync(); });

  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'sheet-del';
  cancel.textContent = 'Abbrechen';
  cancel.addEventListener('click', closeSheet);

  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'sheet-ok';
  ok.textContent = `Auf ${bays.length} Feld${bays.length === 1 ? '' : 'er'} anwenden`;
  ok.addEventListener('click', () => {
    const value = qty === '' ? null : parseFloat(qty);
    bays.forEach(bay => {
      normalizeBay(bay);
      let pos = bay.positions.find(x => x.cat === catKey);
      if (!pos) { pos = { id: ++_bId, cat: catKey }; bay.positions.push(pos); }
      pos.unit = unit;
      pos.qty  = (value == null || isNaN(value)) ? null : value;
    });
    renderAll();
    closeSheet();
    showToast(`${p.label} auf ${bays.length} Feld${bays.length === 1 ? '' : 'er'} angewendet`);
  });

  actRow.appendChild(cancel); actRow.appendChild(ok);
  sheet.appendChild(actRow);

  sync();
  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
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

  // Sammelaktionen wirken ausschließlich auf SICHTBARE Felder – Felder eines
  // ausgeblendeten Abschnitts sollen sich nicht unbemerkt mitverändern.
  const bays = visibleBaysFlat();
  if (!bays.length) {
    const hint = document.createElement('p');
    hint.className = 'bulk-hint';
    hint.textContent = allBaysFlat().length
      ? 'Alle Abschnitte ausgeblendet – zuerst einen Abschnitt einblenden.'
      : 'Zuerst Felder anlegen.';
    el.appendChild(hint);
    return;
  }

  const info = document.createElement('div');
  info.className = 'bulk-info';
  const nHiddenBays = allBaysFlat().length - bays.length;
  info.textContent = `${bulkSelected.size} von ${bays.length} Feldern ausgewählt`
    + (nHiddenBays ? ` · ${nHiddenBays} ausgeblendet` : '');
  el.appendChild(info);

  // Abschnitts-Zuordnung der Auswahl – dieselbe Information wie in der Anzeige
  // oben links auf der Zeichenfläche, hier direkt über den Sammel-Aktionen.
  {
    const selNow = bays.filter(b => bulkSelected.has(b.id));
    if (selNow.length) {
      const sum = abschnittSummary(selNow);
      const line = document.createElement('div');
      line.className = 'bulk-absch-info';
      const lab = document.createElement('span');
      lab.className = 'bulk-absch-info-label';
      lab.textContent = sum.names.length > 1 ? 'Abschnitte:' : 'Abschnitt:';
      line.appendChild(lab);
      const add = (name, color) => {
        const c = document.createElement('span');
        c.className = 'sel-info-chip';
        c.style.setProperty('--absch-color', color);
        c.textContent = name;
        line.appendChild(c);
      };
      sum.ids.forEach(id => add(abschnittName(id), abschnittColor(id)));
      if (sum.hasUnassigned) add('Ohne Abschnitt', '#8a97a5');
      el.appendChild(line);
    }
  }

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

  // Abschnitt der gesamten Auswahl zuweisen bzw. entfernen.
  const abschLabel = document.createElement('div');
  abschLabel.className = 'bulk-section-label';
  abschLabel.textContent = 'Abschnitt für Auswahl';
  el.appendChild(abschLabel);

  const abschRow = document.createElement('div');
  abschRow.className = 'bulk-chip-row';
  const curIds = abschnittSummary(selectedBays).ids;
  const mkAbschChip = (id, name, color) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const isAll = id
      ? selectedBays.every(b => b.abschnittId === id)
      : selectedBays.every(b => !abschnittById(b.abschnittId));
    const isSome = !isAll && (id ? curIds.includes(id)
                                 : selectedBays.some(b => !abschnittById(b.abschnittId)));
    chip.className = 'bulk-pos-chip' + (isAll ? ' active' : '') + (isSome ? ' partial' : '');
    chip.textContent = name;
    chip.style.setProperty('--pos-color', color);
    chip.addEventListener('click', () => {
      assignAbschnitt(selectedBays, id);
      renderAll();
      showToast(id
        ? `${selectedBays.length} Feld${selectedBays.length === 1 ? '' : 'er'} → „${name}"`
        : `Abschnitt bei ${selectedBays.length} Feld${selectedBays.length === 1 ? '' : 'ern'} entfernt`);
    });
    abschRow.appendChild(chip);
  };
  abschnitteList().forEach(a => mkAbschChip(a.id, a.name, a.color));
  mkAbschChip(null, 'Ohne Abschnitt', '#8a97a5');

  const newAbschBtn = document.createElement('button');
  newAbschBtn.type = 'button';
  newAbschBtn.className = 'bulk-pos-chip absch-new-chip';
  newAbschBtn.textContent = '+ neuer Abschnitt';
  newAbschBtn.addEventListener('click', () => {
    const name = prompt('Name des Abschnitts (z. B. „Nordseite"):',
                        `Abschnitt ${abschnitteList().length + 1}`);
    if (name === null) return;
    const a = addAbschnitt(name.trim());
    assignAbschnitt(selectedBays, a.id);
    renderAll();
    showToast(`${selectedBays.length} Feld${selectedBays.length === 1 ? '' : 'er'} → „${a.name}"`);
  });
  abschRow.appendChild(newAbschBtn);
  el.appendChild(abschRow);

  /* Kopiertes Feld auf die gesamte Auswahl anwenden. Bisher musste das
     kopierte Feld bei jedem Ziel einzeln über das Bearbeiten-Sheet eingefügt
     werden – bei zwanzig gleichen Feldern zwanzig Mal. Hier genügt ein Klick;
     WAS übertragen wird, legen die Chips darüber fest (Ausstattung, nicht
     Ort: Position und Drehung bleiben immer feldspezifisch). */
  const cpLabel = document.createElement('div');
  cpLabel.className = 'bulk-section-label';
  cpLabel.textContent = 'Kopiertes Feld auf Auswahl anwenden';
  el.appendChild(cpLabel);

  if (!copiedBayData) {
    const cpHint = document.createElement('p');
    cpHint.className = 'bulk-hint';
    cpHint.textContent = 'Noch kein Feld kopiert – ein Feld antippen und dort '
                       + '„Position kopieren" wählen.';
    el.appendChild(cpHint);
  } else {
    const cpWrap = document.createElement('div');
    cpWrap.className = 'bulk-paste-form';

    const cpApply = document.createElement('button');
    cpApply.type = 'button'; cpApply.className = 'bulk-paste-apply-btn';
    const syncCpApply = () => {
      const n = selectedBays.length;
      const any = PASTE_FIELDS.some(([k]) => pasteOpts[k]);
      cpApply.textContent = '📋 Auf ' + n + ' Feld' + (n === 1 ? '' : 'er') + ' anwenden';
      cpApply.disabled = !any;
      cpApply.title = any ? 'Übernommen wird: ' + pasteScopeText()
                          : 'Mindestens eine Eigenschaft auswählen';
    };

    cpWrap.appendChild(buildPasteScopeRow(syncCpApply));

    const cpInfo = document.createElement('div');
    cpInfo.className = 'bulk-paste-info';
    const nPos = (copiedBayData.positions || []).length;
    cpInfo.textContent = `Kopiert: ${nPos} Zusatzbauteil${nPos === 1 ? '' : 'e'}`
      + `  ·  Höhen ${copiedBayData.hL != null ? fmtQty(copiedBayData.hL) : '–'}`
      + ` / ${copiedBayData.hR != null ? fmtQty(copiedBayData.hR) : '–'} m`
      + `  ·  Länge ${fmtQty(copiedBayData.len || 0)} m`;
    cpWrap.appendChild(cpInfo);

    syncCpApply();
    cpApply.addEventListener('click', () => {
      const n = pasteBayPositionsToAll(selectedBays);
      renderAll();
      showToast(`Auf ${n} Feld${n === 1 ? '' : 'er'} angewendet · ${pasteScopeText()}`);
    });
    cpWrap.appendChild(cpApply);
    el.appendChild(cpWrap);
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
    chip.title = allHave ? 'Bei allen ausgewählten Feldern entfernen'
               : someHave ? 'Bei einem Teil der Auswahl schon vorhanden – antippen zum Einstellen'
               : 'Menge/Lagen einstellen und auf alle ausgewählten Felder anwenden';
    chip.addEventListener('click', () => {
      // Haben ALLE das Bauteil schon → Klick entfernt es (wie bisher).
      // Sonst öffnet sich der Einstell-Dialog, in dem Menge bzw. Lagen EINMAL
      // für die gesamte Auswahl festgelegt werden. Früher wurde das Bauteil
      // ohne jede Angabe angelegt: die Feldlänge floss nicht ein und die
      // Lagen-Abfrage fehlte, sodass jedes Feld einzeln nachbearbeitet
      // werden musste.
      if (allHave) {
        selectedBays.forEach(bay => {
          normalizeBay(bay);
          const idx = bay.positions.findIndex(x => x.cat === p.key);
          if (idx >= 0) bay.positions.splice(idx, 1);
        });
        renderAll();
        showToast(p.label + ' bei ' + selectedBays.length + ' Feldern entfernt');
        return;
      }
      openBulkPosSheet(p.key, selectedBays);
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
      lagenRow.style.display  = val === 'meter' ? 'none' : '';
      meterRow.style.display  = val === 'meter' ? '' : 'none';
    });
    billRow.appendChild(b);
  });
  konsForm.appendChild(billRow);

  // Meter-Abrechnung: ohne eigenen Wert rechnet jedes Feld mit seiner eigenen
  // Feldlänge – der Wert hier überschreibt das für alle ausgewählten Felder.
  const meterRow = document.createElement('div');
  meterRow.className = 'konsole-meter-row';
  meterRow.style.display = bulkKonsBilling === 'meter' ? '' : 'none';
  const meterInp = document.createElement('input');
  meterInp.type = 'number'; meterInp.className = 'kmeter-inp';
  meterInp.min = '0'; meterInp.step = 'any'; meterInp.inputMode = 'decimal';
  meterInp.placeholder = 'je Feld die Feldlänge';
  meterInp.value = bulkKonsMeter == null ? '' : String(bulkKonsMeter);
  meterInp.addEventListener('input', () => {
    const v = parseFloat(meterInp.value);
    bulkKonsMeter = (meterInp.value === '' || isNaN(v) || v < 0) ? null : v;
  });
  const meterUnit = document.createElement('span');
  meterUnit.className = 'kmeter-unit'; meterUnit.textContent = 'm';
  meterRow.appendChild(meterInp); meterRow.appendChild(meterUnit);
  konsForm.appendChild(meterRow);

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
        lagen: bulkKonsLagen, billing: bulkKonsBilling,
        meterValue: bulkKonsBilling === 'meter' ? bulkKonsMeter : null
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

  if (!state.sections.length) {
    container.textContent = '';
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');
  // Wie beim Plan: erst im Fragment aufbauen, dann einmal einhängen. Die
  // Feldliste ist mit ~30 Elementen je Feld der teuerste Teil des Neuaufbaus.
  const frag = document.createDocumentFragment();

  state.sections.forEach((sec, si) => {
    const card = document.createElement('div');
    card.className = 'section-card';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'sec-hdr';

    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'sec-name'; nameIn.value = sec.name;
    nameIn.addEventListener('input', e => { sec.name = e.target.value; requestRender(); });

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
      const bayHidden = !isBayVisible(bay);
      const row = document.createElement('div');
      row.className = 'bay-row'
        + (bulkMode && bulkSelected.has(bay.id) ? ' bulk-selected' : '')
        + (si === selectedSi && bi === selectedBi ? ' active-selected' : '')
        + (bayHidden ? ' bay-hidden' : '');
      row.style.borderLeft = '4px solid #2c6fa8';

      // Zeile 1: [Mehrfachauswahl] · Nummer · Längen-Eingabe · Löschen
      const top = document.createElement('div');
      top.className = 'bay-row-top';

      if (bulkMode) {
        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.className = 'bulk-bay-check';
        chk.checked = bulkSelected.has(bay.id);
        // Ausgeblendete Felder lassen sich nicht in die Mehrfachauswahl
        // aufnehmen – Sammelaktionen sollen nur wirken, was auch sichtbar ist.
        chk.disabled = bayHidden;
        chk.title = bayHidden ? 'Feld ist ausgeblendet' : '';
        chk.addEventListener('change', () => {
          if (chk.checked) bulkSelected.add(bay.id); else bulkSelected.delete(bay.id);
          renderAll();
        });
        top.appendChild(chk);
      }

      const num = document.createElement('span');
      num.className = 'bay-num'; num.textContent = bayLabel(sec, bi);
      top.appendChild(num);

      // Abschnitts-Marker: zeigt auf einen Blick, wohin das Feld gehört.
      // Ohne Zuordnung bleibt die Zeile wie bisher – kein zusätzlicher Marker.
      const bayAbsch = abschnittById(bay.abschnittId);
      if (bayAbsch) {
        const tag = document.createElement('span');
        tag.className = 'bay-absch-tag';
        tag.style.setProperty('--absch-color', bayAbsch.color);
        tag.textContent = bayAbsch.name;
        tag.title = 'Abschnitt: ' + bayAbsch.name;
        top.appendChild(tag);
      }

      // Ausgeblendete Felder bleiben in der Liste sichtbar und bearbeitbar –
      // nur so ist erkennbar, dass keine Daten verloren gegangen sind.
      if (bayHidden) {
        const eyeTag = document.createElement('span');
        eyeTag.className = 'bay-hidden-tag';
        eyeTag.textContent = '🙈 ausgeblendet';
        eyeTag.title = 'Der Abschnitt dieses Feldes ist ausgeblendet – die Daten bleiben erhalten.';
        top.appendChild(eyeTag);
      }

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
      inp.addEventListener('input', e => { bay.len = +parseFloat(e.target.value || 0).toFixed(2); requestRender(); });

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
          requestRender();
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
        requestRender();
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
        qb.addEventListener('click', () => { bay.len = l; inp.value = l.toFixed(2); requestRender(); });
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
      editBtn.addEventListener('click', () => { selectedSi = si; selectedBi = bi; requestRender(); openEditSheet(si, bi); });
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
    frag.appendChild(card);
  });

  container.replaceChildren(frag);
}

/* ── Render-Planer ───────────────────────────────────────────────────────────
   Früher rief jeder Eingabe-Handler (Schieberegler, Zahlenfeld, Chip …)
   `renderSvg()` bzw. `renderAll()` SYNCHRON auf. Ein Regler feuert beim Ziehen
   aber 60–120 `input`-Events je Sekunde – und `renderAll()` baut die komplette
   Seitenleiste neu auf (bei 40 Feldern ~140 ms, bei 100 Feldern ~0,4 s). Die
   Events stauten sich schneller, als sie abgearbeitet werden konnten; die App
   „hing" danach sekunden- bis minutenlang nach.

   Jetzt melden alle Handler ihren Bedarf nur noch an; pro Bildschirm-Frame
   wird höchstens EINMAL gezeichnet, und nur die Teile, die sich wirklich
   geändert haben. Während einer Zieh-Geste bleibt die (teure) Seitenleiste
   ganz außen vor und wird erst danach nachgezogen.                           */

let _renderRaf   = 0;
const _renderNeed = { svg: false, sidebar: false, bulk: false };

function _runRender() {
  _renderRaf = 0;
  const need = { ..._renderNeed };
  _renderNeed.svg = _renderNeed.sidebar = _renderNeed.bulk = false;
  // Seitenleiste während einer laufenden Geste nicht anfassen – sie ist der
  // teuerste Teil und währenddessen ohnehin nicht sichtbar in Benutzung.
  if (drag && (need.sidebar || need.bulk)) {
    _renderNeed.sidebar = _renderNeed.sidebar || need.sidebar;
    _renderNeed.bulk    = _renderNeed.bulk    || need.bulk;
    need.sidebar = need.bulk = false;
  }
  if (need.bulk)    renderBulkBar();
  if (need.sidebar) { renderAbschnittBar(); renderSections(); }
  if (need.svg)     renderSvg();
  renderSelectionInfo();
}

/** Zeichnen anfordern. Mehrere Aufrufe innerhalb eines Frames werden zu einem
 *  einzigen Neuaufbau zusammengefasst. */
function requestRender(need = {}) {
  if (need.svg !== false)  _renderNeed.svg = true;
  if (need.sidebar)        _renderNeed.sidebar = true;
  if (need.bulk)           _renderNeed.bulk = true;
  if (_renderRaf) return;
  _renderRaf = requestAnimationFrame(_runRender);
}

/** Wartende Zeichenarbeit sofort erledigen (z. B. vor dem PDF-Export). */
function flushRender() {
  if (!_renderRaf) return;
  cancelAnimationFrame(_renderRaf);
  _runRender();
}

/** Vollständiger Neuaufbau (Seitenleiste + Zeichnung) – gebündelt. */
function renderAll() { requestRender({ svg: true, sidebar: true, bulk: true }); }

/** Vollständiger Neuaufbau, sofort und synchron. Nur dort verwenden, wo direkt
 *  danach mit dem fertigen DOM weitergearbeitet wird. */
function renderAllNow() {
  renderAll();
  flushRender();
}

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
  const payload = JSON.stringify({ version: 3, state, _sId, _bId });
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
      // v1/v2-Dateien kennen noch keine Abschnitte → leere Liste, alle Felder
      // gelten als „ohne Abschnitt" und bleiben vollständig erhalten.
      state.abschnitte = Array.isArray(s.abschnitte) ? s.abschnitte : [];
      state.hideUnassigned = !!s.hideUnassigned;
      state.aufmass  = s.aufmass || null;
      state.ecken    = s.ecken || {};
      state.grundriss = s.grundriss || null;
      state.bordbretter = Array.isArray(s.bordbretter) ? s.bordbretter : [];
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
      normalizeState();
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
      if (isBayVisible(bay)) {
        const cx = x + dir.dx * pxLen / 2 + o.dx * depth / 2;
        const cy = y + dir.dy * pxLen / 2 + o.dy * depth / 2;
        list.push({ bay, cx, cy, horiz: Math.abs(dir.dx) >= Math.abs(dir.dy) });
      }
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

/* ── Grundriss als Hintergrundebene ──────────────────────────────────────────
   Der Nutzer legt einen Gebäudegrundriss (Foto, Scan, Screenshot) unter die
   Zeichnung, richtet ihn aus und zeichnet die Gerüstachsen darüber. Zwei
   Zwecke:

     1. TRACING – die Achsen lassen sich am tatsächlichen Grundriss abgreifen
        statt nach Gedächtnis.
     2. ECKEN-VORSCHLAG – aus dem Bild lässt sich ableiten, ob an einem
        Achsknoten Gebäude oder Freiraum liegt, und damit Innen- oder
        Außenecke vorschlagen.

   Ausrichtung: der Nutzer verschiebt die Ebene mit einem Griff, dreht sie über
   ein Zahlenfeld und setzt den Maßstab über eine REFERENZSTRECKE – zwei Punkte
   auf dem Grundriss antippen und die wahre Länge eintragen. Das ist der
   verlässlichste Weg: Grundrisse tragen selten verwertbare DPI-Angaben, aber
   fast immer eine bekannte Strecke (Maßkette, Türbreite, Gebäudekante).

   Wie der Eckentyp aus dem Bild gelesen wird, steht bei grundrissMaske(). */

// Position/Skalierung werden auf die MITTE der Ebene bezogen – so dreht sich
// die Ebene um ihren Mittelpunkt und „wandert" beim Drehen nicht davon.
const GRUNDRISS_DEFAULTS = {
  x: 0, y: 0,            // Weltkoordinaten der Bildmitte
  scale: 1,              // Welt-Pixel je Bildpixel
  rot: 0,                // Grad
  opacity: 0.45,
  locked: false,
  visible: true
};

/** Normalisierte Grundriss-Ebene oder null, wenn keine hinterlegt ist. */
function grundrissLayer() {
  const g = state.grundriss;
  if (!g || !g.dataUrl || !g.w || !g.h) return null;
  const num = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
  g.x       = num(g.x, GRUNDRISS_DEFAULTS.x);
  g.y       = num(g.y, GRUNDRISS_DEFAULTS.y);
  g.scale   = Math.max(0.001, num(g.scale, GRUNDRISS_DEFAULTS.scale));
  g.rot     = normDeg(num(g.rot, 0));
  g.opacity = Math.min(1, Math.max(0.05, num(g.opacity, GRUNDRISS_DEFAULTS.opacity)));
  g.locked  = !!g.locked;
  g.visible = g.visible !== false;
  return g;
}

/** Weltkoordinate → Bildpixel (Umkehrung der Ebenen-Transformation). */
function weltZuGrundriss(g, wx, wy) {
  const r = -g.rot * Math.PI / 180;
  const dx = wx - g.x, dy = wy - g.y;
  const rx = dx * Math.cos(r) - dy * Math.sin(r);
  const ry = dx * Math.sin(r) + dy * Math.cos(r);
  return { x: rx / g.scale + g.w / 2, y: ry / g.scale + g.h / 2 };
}

/* ── Auswertung des Grundriss-Bildes ─────────────────────────────────────────
   Ziel: für einen Punkt neben einer Wand beantworten „liegt hier Gebäude oder
   Freiraum?". Naheliegend wäre, auf dunkle Pixel zu prüfen – das scheitert
   aber daran, dass Grundrisse INNEN überwiegend weiß sind (Räume) und nur die
   Wände dunkel. Dunkel ≠ Gebäude.

   Deshalb wird der FREIRAUM bestimmt statt des Gebäudes: Vom Bildrand aus wird
   der helle Bereich geflutet (Flood-Fill über den Hintergrund). Alles, was der
   Fluss nicht erreicht, liegt hinter einer Wand – also im Gebäude. Räume im
   Inneren sind vom Rand aus nicht erreichbar und zählen damit korrekt zum
   Gebäude.

   Ausgewertet wird dann ein RING um den Eckpunkt: an einer Außenecke liegt
   etwa ein Viertel des Rings im Gebäude, an einer Innenecke etwa drei Viertel.
   Das ist robust gegen Strichstärken, Möblierung und Bemaßung im Plan.

   Grenzen (bewusst offengelegt statt kaschiert): ein umlaufender Rahmen um den
   Plan blockiert den Fluss vom Bildrand. Wird dabei fast nichts als Freiraum
   erkannt, liefert die Auswertung KEINEN Vorschlag statt eines falschen.     */

let _grMaskeSrc = null;    // dataUrl, zu der die Maske gehört
let _grMaske    = null;    // { w, h, aussen: Uint8Array }

/** Verkleinerte Freiraum-Maske des Grundrisses (asynchron, einmal je Bild). */
async function grundrissMaske() {
  const g = grundrissLayer();
  if (!g) return null;
  if (_grMaskeSrc === g.dataUrl && _grMaske) return _grMaske;

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej;
    i.src = g.dataUrl;
  }).catch(() => null);
  if (!img) return null;

  // Auf höchstens 900 px lange Kante herunterrechnen: die Maske muss nur
  // Räume trennen, nicht Details auflösen – und der Flood-Fill bleibt schnell.
  const MAX = 900;
  const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);   // Transparenz = Freiraum
  cx.drawImage(img, 0, 0, w, h);
  let data;
  try { data = cx.getImageData(0, 0, w, h).data; } catch (_) { return null; }

  // Hintergrund = hell. Der Schwellwert ist bewusst hoch: lieber eine graue
  // Rasterfläche noch als Wand werten, als eine dünne Wandlinie zu verlieren –
  // eine Lücke in der Wand ließe den Fluss ins Gebäude durchbrechen.
  const hell = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < hell.length; i++, p += 4) {
    hell[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) > 205 ? 1 : 0;
  }

  const aussen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (hell[i] && !aussen[i]) { aussen[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0)     push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0)     push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  let frei = 0;
  for (let i = 0; i < aussen.length; i++) frei += aussen[i];
  _grMaskeSrc = g.dataUrl;
  _grMaske = { w, h, aussen, anteilFrei: frei / aussen.length };
  return _grMaske;
}

/** Liegt die Weltkoordinate im Gebäude? (null = außerhalb des Bildes) */
function imGebaeude(maske, g, wx, wy) {
  const p = weltZuGrundriss(g, wx, wy);
  const px = Math.round(p.x * maske.w / g.w);
  const py = Math.round(p.y * maske.h / g.h);
  if (px < 0 || py < 0 || px >= maske.w || py >= maske.h) return null;
  return !maske.aussen[py * maske.w + px];
}

/**
 * Eckentyp-Vorschläge aus dem Grundriss – je Ecke `{ key, art, sicherheit }`.
 *
 * Gemessen wird der Anteil des Gebäudes auf einem Ring um den Eckpunkt:
 * ≈ 25 % → Außenecke, ≈ 75 % → Innenecke. Die Sicherheit ist der Abstand von
 * der 50-%-Grenze; bei zu wenig Aussage (Bildrand, Rahmen, unklarer Plan)
 * entfällt der Vorschlag.
 */
async function grundrissEckVorschlaege() {
  const g = grundrissLayer();
  if (!g) return { fehler: 'Kein Grundriss hinterlegt.', ecken: [] };
  const maske = await grundrissMaske();
  if (!maske) return { fehler: 'Der Grundriss konnte nicht ausgewertet werden.', ecken: [] };
  if (maske.anteilFrei < 0.03) {
    return { fehler: 'Im Grundriss ist kein zusammenhängender Freiraum erkennbar '
                   + '(z. B. wegen eines Rahmens um den Plan). Der Eckentyp lässt '
                   + 'sich daraus nicht ableiten.', ecken: [] };
  }

  const R = Math.max(state.depth * PX_PER_M * 1.6, 40);   // Ringradius in Welt-px
  const N = 96;
  const ecken = eckenListe().map(e => {
    // Eckpunkt = der gemeinsame Knoten beider Achsen (erster Punkt des Vierecks).
    const p = e.pts[0];
    let drin = 0, gueltig = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI;
      const t = imGebaeude(maske, g, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
      if (t === null) continue;
      gueltig++; if (t) drin++;
    }
    if (gueltig < N * 0.75) return { key: e.key, art: null, sicherheit: 0 };
    const anteil = drin / gueltig;
    return {
      key: e.key,
      art: anteil > 0.5 ? 'innen' : 'aussen',
      anteil,
      sicherheit: Math.min(1, Math.abs(anteil - 0.5) * 4)
    };
  });
  return { fehler: null, ecken };
}

/* ── Aufmaßregeln nach ATV DIN 18451 ─────────────────────────────────────────
   Die Norm rechnet nicht mit den Systemmaßen des verwendeten Gerüstsystems,
   sondern ausschließlich mit den ACHSMASSEN der Gerüstkonstruktion – „Der
   Ermittlung der Leistung … sind die technisch erforderlichen Maße an den
   Außenseiten der Gerüstkonstruktion zugrunde zu legen" (5.1.1). Genau das
   zeichnet und summiert die App ohnehin: jede Feldlänge ist ein Achsmaß.

   Dazu kommen zwei Zuschläge, die sich aus der Konstruktion ergeben:

   • AUSSENECKE (5.2.1.1): an einer Außenecke überlappen sich die beiden
     angrenzenden Seiten. Die überlappende Ecklänge darf bei BEIDEN Seiten
     mitgerechnet werden (La = L + L1) – die Ecke zählt also bewusst doppelt.
     Der Zuschlag je Seite entspricht der Gerüsttiefe (Wandabstand +
     Systembreite); er ist frei überschreibbar.
   • FELDZUSCHLAG: fester Aufschlag von 0,80 m (bei kleineren Systembreiten
     0,73 m). Ob er je Feld, je Wand oder nur bei einfeldrigen Gerüsten
     anfällt, ist einstellbar.
   • INNENECKE: läuft das Gerüst in einen Rücksprung, ÜBERLAPPEN sich die
     beiden Bahnen um Gerüsttiefe × Gerüsttiefe. Anders als bei der Außenecke
     darf diese Fläche NICHT doppelt zählen. Gerechnet wird sie einer der
     beiden Achsen zugeschlagen:
       – die DURCHLAUFENDE Achse (läuft in die Ecke hinein): ihr letztes Feld
         vor der Ecke wird um die Ecklänge REDUZIERT,
       – die AUSFÜLLENDE Achse (senkrecht dazu, füllt die Ecke): ihr Feld an
         der Ecke wird um dieselbe Länge ERHÖHT.
     Beispiel bei 0,73 m: Achse 1 mit 3 × 2,57 m ergibt
     2,57 + 2,57 + (2,57 − 0,73) = 6,98 m, die ausfüllende Achse 2 mit einem
     Feld 2,57 + 0,73 = 3,30 m. In der Summe ist die Innenecke damit neutral
     (−0,73 + 0,73 = 0) – sie verschiebt die Länge nur von einer Achse auf die
     andere. Genau das ist für abschnitts- oder achsweise Abrechnung
     entscheidend.

   WELCHE Achse durchläuft, ist am Bau eine Planungsentscheidung und keine
   reine Geometriefrage. Deshalb entscheidet der NUTZER: jede Innenecke ist in
   der Zeichnung antippbar und umschaltbar (siehe openEckSheet()). Bis zur
   Bestätigung gilt ein Vorschlag – die längere Achse läuft durch – und die
   Ecke wird als „noch nicht bestätigt" markiert (Warnfarbe, „?"-Kennzeichen,
   Hinweis im PDF-Dialog), damit keine Zahl unbemerkt aus einer Annahme
   entsteht.

   Alles ist bewusst als KONFIGURIERBARER Parameter umgesetzt (Wert,
   Wirkungsbereich, an/aus) statt hart kodiert: ändern sich die Aufmaßregeln,
   genügt eine Änderung im Dialog „Aufmaßregeln" im PDF-Export.

   Wichtig: die Regeln wirken ausschließlich auf die AUFMASS-Auswertung im
   PDF. Die Zeichnung und die Live-Anzeige bleiben immer das reine Achsmaß –
   sonst würde ein Zuschlag die maßstäbliche Darstellung verfälschen.        */

// Wirkungsbereich des Feldzuschlags: [Schlüssel, Knopfbeschriftung, Erklärung]
const AUFMASS_MODI = [
  ['feld',       'je Feld',        'Jedes Gerüstfeld erhält den Aufschlag.'],
  ['wand',       'je Wand',        'Einmal je zusammenhängender Wand (Feldkette).'],
  ['einzelfeld', 'nur Einzelfeld', 'Nur Wände, die aus genau einem Feld bestehen.']
];

// Übliche Aufschläge in m – Schnellwahl im Dialog, freie Eingabe bleibt möglich.
const AUFMASS_FELD_PRESETS = [0.80, 0.73];

const AUFMASS_DEFAULTS = {
  // Standard: keine ZUSCHLÄGE. Sie werden bewusst vom Nutzer zugeschaltet,
  // damit sich bestehende Aufmaße nicht unbemerkt ändern.
  eckzuschlag:  { aktiv: false, wert: null },          // wert null → Gerüsttiefe
  feldzuschlag: { aktiv: false, wert: 0.80, modus: 'wand' },
  // Die Innenecken-Regel ist dagegen standardmäßig AN: sie ist kein Zuschlag,
  // sondern eine Korrektur. Ohne sie zählt die Überlappung an einer Innenecke
  // bei beiden Achsen mit – das ist schlicht falsch. Für die Gesamtsumme ist
  // sie neutral (−x bei der einen, +x bei der anderen Achse), sie ändert also
  // keine bestehende Gesamtlänge, sondern nur deren Aufteilung.
  innenecke:    { aktiv: true, wert: null }            // wert null → Gerüsttiefe
};

/** Aufmaßregeln der Zeichnung – ergänzt fehlende/ungültige Werte AN ORT UND
 *  STELLE in `state.aufmass` (damit sie mitgespeichert werden) und liefert
 *  immer dasselbe Objekt zurück. Die stabile Identität ist wichtig: die
 *  Eingabefelder im Dialog schreiben direkt in dieses Objekt. */
function aufmassRules() {
  const d = AUFMASS_DEFAULTS;
  const num = (v, fb) => {
    const n = parseFloat(v);
    return (v != null && v !== '' && !isNaN(n) && n >= 0) ? n : fb;
  };
  if (!state.aufmass || typeof state.aufmass !== 'object') state.aufmass = {};
  const r = state.aufmass;
  if (!r.eckzuschlag  || typeof r.eckzuschlag  !== 'object') r.eckzuschlag  = {};
  if (!r.feldzuschlag || typeof r.feldzuschlag !== 'object') r.feldzuschlag = {};
  // Zeichnungen von vor der Innenecken-Regel haben den Block nicht – sie
  // bekommen die Vorgabe (aktiv), weil er nur eine Fehlrechnung korrigiert.
  if (!r.innenecke    || typeof r.innenecke    !== 'object') {
    r.innenecke = { ...d.innenecke };
  }

  r.eckzuschlag.aktiv  = !!r.eckzuschlag.aktiv;
  r.eckzuschlag.wert   = (r.eckzuschlag.wert == null || r.eckzuschlag.wert === '')
                         ? null : num(r.eckzuschlag.wert, null);
  r.feldzuschlag.aktiv = !!r.feldzuschlag.aktiv;
  r.feldzuschlag.wert  = num(r.feldzuschlag.wert, d.feldzuschlag.wert);
  r.feldzuschlag.modus = AUFMASS_MODI.some(m => m[0] === r.feldzuschlag.modus)
                         ? r.feldzuschlag.modus : d.feldzuschlag.modus;
  r.innenecke.aktiv    = !!r.innenecke.aktiv;
  r.innenecke.wert     = (r.innenecke.wert == null || r.innenecke.wert === '')
                         ? null : num(r.innenecke.wert, null);
  return r;
}

/** Zuschlag je Außenecke und Seite in m – ohne eigenen Wert die Gerüsttiefe. */
function eckZuschlagWert() {
  const r = aufmassRules();
  return r.eckzuschlag.wert != null ? r.eckzuschlag.wert : state.depth;
}

/** Ecklänge einer Innenecke in m: um so viel wird die durchlaufende Achse
 *  gekürzt und die ausfüllende verlängert. Ohne eigenen Wert die Gerüsttiefe –
 *  das ist genau die Kantenlänge der Überlappung (0,73 m im Standardsystem). */
function innenEckWert() {
  const r = aufmassRules();
  return r.innenecke.wert != null ? r.innenecke.wert : state.depth;
}

/** Ist mindestens ein Zuschlag eingeschaltet? */
function aufmassAktiv() {
  const r = aufmassRules();
  return r.eckzuschlag.aktiv || r.feldzuschlag.aktiv;
}

/** Kurzbeschreibung der aktiven Regeln (Dialog, PDF-Fußnote). */
function aufmassRuleText() {
  const r = aufmassRules();
  const parts = ['Achsmaße der Gerüstkonstruktion (DIN 18451, 5.1.1)'];
  if (r.eckzuschlag.aktiv) {
    parts.push(`Außenecke beidseitig + ${fmtQty(eckZuschlagWert())} m (La = L + L1)`);
  }
  if (r.feldzuschlag.aktiv) {
    const m = AUFMASS_MODI.find(x => x[0] === r.feldzuschlag.modus);
    parts.push(`Aufschlag ${fmtQty(r.feldzuschlag.wert)} m ${m ? m[1] : ''}`.trim());
  }
  if (r.innenecke.aktiv) {
    parts.push(`Innenecke ± ${fmtQty(innenEckWert())} m `
             + '(durchlaufende Achse −, ausfüllende Achse +)');
  }
  if (bordbretterListe().some(l => l.achseSecId != null)) {
    parts.push('Ecken nach dem gezeichneten Verlauf der Bordbretter '
             + `(± Gerüsttiefe ${fmtQty(state.depth)} m)`);
  }
  return parts.join('   ·   ');
}

/** Wände als Listen von Sektionsindizes: Ketten direkt aneinanderhängender
 *  Felder gleichen Winkels. Grundlage für den Feldzuschlag „je Wand". */
function wallChains() {
  const seen = new Set(), chains = [];
  state.sections.forEach((sec, si) => {
    if (seen.has(si) || !sec.bays.some(isBayVisible)) return;
    const chain = findWallChain(si);
    chain.forEach(i => seen.add(i));
    const visible = chain.filter(i => state.sections[i].bays.some(isBayVisible));
    if (visible.length) chains.push(visible);
  });
  return chains;
}

/* ── Achsen ─────────────────────────────────────────────────────────────────
   Eine ACHSE im Aufmaß-Sinn ist genau eine Wand: eine Kette direkt
   aneinanderhängender Felder gleicher Laufrichtung. Genau darauf bezieht sich
   die Innenecken-Regel („das letzte Feld VOR der Ecke"), deshalb braucht das
   Aufmaß diese Gliederung – die frühere flache Summe über alle Felder konnte
   sie gar nicht ausdrücken.                                                */

/** Alle Achsen der Zeichnung: Sektionsindizes, Felder und ein Anzeigename. */
function achsenListe() {
  return wallChains().map((chain, i) => {
    const secs  = chain.map(si => state.sections[si]);
    const bays  = chain.flatMap(si => state.sections[si].bays.filter(isBayVisible));
    // Name: bei einer einzelnen Sektion deren (frei benennbarer) Name, sonst
    // „erste–letzte", damit die Achse im PDF wiederfindbar bleibt.
    const first = secs[0], last = secs[secs.length - 1];
    const name  = secs.length === 1
      ? (first.name || `Achse ${i + 1}`)
      : `${first.name || 'Achse'} – ${last.name || ''}`.trim();
    return { idx: i, chain, secs, bays, name };
  });
}

/** Achse (Index in achsenListe()) zu einem Sektionsindex – oder -1. */
function achseVonSektion(achsen, si) {
  return achsen.findIndex(a => a.chain.includes(si));
}

/* ── Bordbretter-Linien ──────────────────────────────────────────────────────
   Das Aufmaß orientiert sich am tatsächlichen Verlauf der BORDBRETTER – der
   Kantenbretter am Rand der Gerüstlage. Sie laufen genau dort, wo die Lage
   endet, und damit auch um jede Ecke herum. Genau dieser Verlauf entscheidet,
   wie lang eine Achse im Aufmaß ist:

     • Die Linie knickt an einer INNENECKE nach innen ab → die Achse endet um
       eine Gerüsttiefe früher: ihr letztes Feld vor der Ecke wird REDUZIERT.
     • Die Linie knickt an einer AUSSENECKE nach außen ab → die Achse läuft um
       die Ecke herum: ihr Feld an der Ecke wird ERHÖHT.

   Der Korrekturwert ist KEINE Konstante, sondern immer die im Abschnitt
   eingestellte Gerüsttiefe (`state.depth`, überschreibbar in den Aufmaßregeln
   – siehe innenEckWert()/eckZuschlagWert()). Bei 0,73 m Gerüsttiefe ergibt
   sich die aus dem Aufmaßblatt bekannte Korrektur von ±0,73 m, bei 1,09 m
   entsprechend ±1,09 m.

   Der Nutzer zeichnet die Linie einmal entlang der Feldkanten (mit Snapping,
   damit sie exakt am Rand liegt) und ordnet sie einer Achse zu. Alles Weitere –
   Eckenerkennung, Vorzeichen, Rechenweg, PDF – macht das Programm. Die
   Eckenerkennung ist dabei NICHT neu gebaut: die Linie sagt nur, WELCHE der
   bereits erkannten Ecken (computeLayout → eckenListe) sie durchläuft und
   welche Achse dort durchgeht.                                              */

let _bbId = 0;

/** Bordbretter-Linien der Zeichnung (legt die Liste bei Altdaten transparent an). */
function bordbretterListe() {
  if (!Array.isArray(state.bordbretter)) state.bordbretter = [];
  return state.bordbretter;
}

/** Ergänzt/prüft die gespeicherten Linien und hält den ID-Zähler vorn. */
function normalizeBordbretter() {
  const roh = Array.isArray(state.bordbretter) ? state.bordbretter : [];
  state.bordbretter = roh
    .filter(l => l && Array.isArray(l.punkte))
    .map((l, i) => ({
      id: String(l.id || ('bb' + (i + 1))),
      name: (l.name != null && String(l.name).trim()) || '',
      achseSecId: (l.achseSecId === '' || l.achseSecId == null) ? null : l.achseSecId,
      punkte: l.punkte
        .filter(p => p && isFinite(p.x) && isFinite(p.y))
        .map(p => ({ x: +p.x, y: +p.y }))
    }))
    .filter(l => l.punkte.length >= 2);
  state.bordbretter.forEach(l => {
    const n = parseInt(String(l.id).replace(/^bb/, ''), 10);
    if (!isNaN(n) && n > _bbId) _bbId = n;
  });
  return state.bordbretter;
}

function mkBordbrett(punkte) {
  return { id: 'bb' + (++_bbId), name: '', achseSecId: null,
           punkte: punkte.map(p => ({ x: p.x, y: p.y })) };
}

function bordbrettById(id) {
  return bordbretterListe().find(l => l.id === id) || null;
}

/** Anzeigename einer Linie – eigener Name, sonst „Bordbrett n". */
function bordbrettName(linie) {
  if (linie.name) return linie.name;
  const i = bordbretterListe().indexOf(linie);
  return 'Bordbrett ' + (i >= 0 ? i + 1 : '?');
}

/** Lotfußpunkt von `p` auf die Strecke a–b (inkl. Abstand). */
function lotAufStrecke(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const x = a.x + dx * t, y = a.y + dy * t;
  return { x, y, t, dist: Math.hypot(p.x - x, p.y - y) };
}

/** Abstand eines Punktes zum Rand eines Polygons (0 nur AUF dem Rand). */
function abstandZuPolygonrand(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = lotAufStrecke(p, pts[i], pts[(i + 1) % pts.length]).dist;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Snap-Ziele für die Bordbretter-Linie: alle Kanten und Eckpunkte der
 * gezeichneten Felder – und zusätzlich die der Eckvierecke. Deren Punkte sind
 * wichtig: An einer Innenecke knickt das Bordbrett genau dort, wo sich die
 * beiden Außenkanten schneiden, und dieser Punkt ist KEIN Feld-Eckpunkt,
 * sondern der äußere Punkt des Eckvierecks.
 */
function bordbrettSnapZiele(els) {
  const liste = els || computeLayout();
  const punkte = [], kanten = [];
  liste.forEach(el => {
    if (el.type !== 'bay' && el.type !== 'corner') return;
    el.pts.forEach((p, i) => {
      punkte.push(p);
      kanten.push([p, el.pts[(i + 1) % el.pts.length]]);
    });
  });
  return { punkte, kanten };
}

/**
 * Rastet einen Rohpunkt auf die Feldkanten ein. Nah an einem Eckpunkt gewinnt
 * dieser: genau dort knickt die Bordbretter-Linie, und ein um wenige
 * Zentimeter danebenliegender Knick würde die Eckenauswertung verfälschen.
 * Weiter weg vom Eckpunkt zählt dagegen die nächstgelegene Kante – sonst
 * würde ein Tipp in Feldmitte an den Feldrand springen.
 * @returns {{x:number,y:number,art:'punkt'|'kante'|'frei'}}
 */
function bordbrettSnap(p, toleranz, els) {
  const ziele = bordbrettSnapZiele(els);
  let punkt = null, kante = null;
  ziele.punkte.forEach(q => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= toleranz && (!punkt || d < punkt.dist)) punkt = { x: q.x, y: q.y, art: 'punkt', dist: d };
  });
  if (punkt && punkt.dist <= toleranz * 0.6) return punkt;
  ziele.kanten.forEach(([a, b]) => {
    const r = lotAufStrecke(p, a, b);
    if (r.dist <= toleranz && (!kante || r.dist < kante.dist)) {
      kante = { x: r.x, y: r.y, art: 'kante', dist: r.dist };
    }
  });
  if (kante && (!punkt || kante.dist < punkt.dist)) return kante;
  return punkt || kante || { x: p.x, y: p.y, art: 'frei', dist: Infinity };
}

/** Sektionsindex des Feldes, an dessen Kante der Punkt am nächsten liegt. */
function bordbrettSektionAn(p, bayEls) {
  let best = null;
  bayEls.forEach(el => {
    const d = abstandZuPolygonrand(p, el.pts);
    if (!best || d < best.d) best = { d, si: el.si };
  });
  return best ? best.si : null;
}

/** Gesamtlänge der gezeichneten Linie in m. */
function bordbrettLaenge(linie) {
  const p = linie.punkte || [];
  let l = 0;
  for (let i = 0; i + 1 < p.length; i++) l += Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
  return +(l / PX_PER_M).toFixed(3);
}

/** Ecken der Zeichnung OHNE die Durchlauf-Entscheidung – die hängt ihrerseits
 *  von den Bordbretter-Linien ab (siehe eckenListeBerechnen). */
function roheEcken() {
  return computeLayout()
    .filter(e => e.type === 'corner')
    .map(c => {
      const a = state.sections[c.si], b = state.sections[c.ni];
      if (!a || !b) return null;
      return { key: eckKey(a, b), si: c.si, ni: c.ni, art: eckArtEffektiv(c), pts: c.pts };
    })
    .filter(Boolean);
}

/** Anfang, Ende, Laufrichtung und Länge einer Achse (nur sichtbare Felder). */
function achsGeometrie(achse) {
  let start = null, ende = null;
  achse.chain.forEach(si => {
    const sec = state.sections[si];
    if (!sec) return;
    const dir = secVec(sec);
    let x = sec.x0, y = sec.y0;
    sec.bays.forEach(b => {
      const l = b.len * PX_PER_M;
      if (isBayVisible(b)) {
        if (!start) start = { x, y };
        ende = { x: x + dir.dx * l, y: y + dir.dy * l };
      }
      x += dir.dx * l; y += dir.dy * l;
    });
  });
  if (!start || !ende) return null;
  const erste = state.sections[achse.chain[0]];
  return { start, ende, d: secVec(erste),
           laenge: Math.hypot(ende.x - start.x, ende.y - start.y) };
}

/* Zustände eines Achsendes, abgeleitet aus dem gezeichneten Verlauf:
     buendig  – das Bordbrett endet dort, wo auch die Achse rechnerisch endet
     laenger  – es läuft um die Gerüsttiefe darüber hinaus (um die Ecke herum)
     kuerzer  – es endet um die Gerüsttiefe früher (die andere Bahn stößt an)
     unklar   – weder das eine noch das andere; die Linie sagt hier nichts aus */
const BB_TOL_BUENDIG = 0.30;   // Anteil der Gerüsttiefe
const BB_TOL_ECKE    = 0.45;

/**
 * Wertet eine gezeichnete Linie gegen ihre Achse aus.
 *
 * Gemessen wird, WIE WEIT das Bordbrett über die rechnerischen Achsenden
 * hinaus- bzw. dahinter zurückbleibt. Dafür werden alle Linienpunkte auf die
 * Laufrichtung der Achse projiziert; die Über-/Unterlänge an beiden Enden
 * ergibt unmittelbar die Eckenkorrektur:
 *
 *   • + eine Gerüsttiefe  → die Lage läuft um eine AUSSENECKE herum
 *                           → Feld an der Ecke + Gerüsttiefe
 *   • − eine Gerüsttiefe  → an einer INNENECKE stößt die andere Bahn an
 *                           → letztes Feld vor der Ecke − Gerüsttiefe
 *
 * Verglichen wird gegen die tatsächlich gezeichnete Gerüsttiefe; der ANGESETZTE
 * Wert kommt aus den Aufmaßregeln (dort standardmäßig ebenfalls die
 * Gerüsttiefe, aber überschreibbar).
 *
 * @returns {{achse, laenge:number, achsLaenge:number, enden:Array}}
 */
function bordbrettAuswertung(linie, achsen, ecken) {
  const liste  = achsen || achsenListe();
  const alleE  = ecken || roheEcken();
  const achse  = bordbrettAchse(linie, liste);
  const laenge = bordbrettLaenge(linie);
  if (!achse) return { achse: null, laenge, achsLaenge: 0, enden: [] };

  const g = achsGeometrie(achse);
  if (!g || !(linie.punkte || []).length) {
    return { achse, laenge, achsLaenge: 0, enden: [] };
  }

  const proj = p => (p.x - g.start.x) * g.d.dx + (p.y - g.start.y) * g.d.dy;
  const ts   = linie.punkte.map(proj);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);

  const tiefe   = state.depth * PX_PER_M;
  const ersteSi = achse.chain[0], letzteSi = achse.chain[achse.chain.length - 1];

  const zustandVon = roh => {
    if (!(tiefe > 0)) return 'unklar';
    if (Math.abs(roh) <= tiefe * BB_TOL_BUENDIG)         return 'buendig';
    if (Math.abs(roh - tiefe) <= tiefe * BB_TOL_ECKE)    return 'laenger';
    if (Math.abs(roh + tiefe) <= tiefe * BB_TOL_ECKE)    return 'kuerzer';
    return 'unklar';
  };

  const bauEnde = (seite, roh, ecke) => {
    const zustand = zustandVon(roh);
    const e = {
      seite, roh: +(roh / PX_PER_M).toFixed(3), zustand, ecke: ecke || null,
      // Sektion DIESER Achse an der Ecke – dort greift die Korrektur.
      achsSi: ecke ? (ecke.si === (seite === 'ende' ? letzteSi : ersteSi) ? ecke.si : ecke.ni) : null,
      delta: 0, rolle: null
    };
    if (!ecke || zustand === 'buendig' || zustand === 'unklar') return e;
    if (ecke.art === 'aussen' && zustand === 'laenger') {
      e.delta = +eckZuschlagWert();
      e.rolle = 'umlaufend';
    } else if (ecke.art === 'innen' && zustand === 'kuerzer') {
      e.delta = -innenEckWert();
      e.rolle = 'durchlaufend';
    } else if (ecke.art === 'innen' && zustand === 'laenger') {
      // Das Bordbrett läuft in den Rücksprung hinein: diese Achse füllt die
      // Ecke aus, die andere läuft durch.
      e.delta = +innenEckWert();
      e.rolle = 'ausfuellend';
    }
    return e;
  };

  return {
    achse, laenge, achsLaenge: +(g.laenge / PX_PER_M).toFixed(3),
    enden: [
      bauEnde('start', -tMin, alleE.find(e => e.ni === ersteSi)),
      bauEnde('ende', tMax - g.laenge, alleE.find(e => e.si === letzteSi))
    ]
  };
}

/** Achse, der die Linie zugeordnet ist (oder null). */
function bordbrettAchse(linie, achsen) {
  if (linie.achseSecId == null) return null;
  const liste = achsen || achsenListe();
  return liste.find(a => a.secs.some(s => String(s.id) === String(linie.achseSecId))) || null;
}

/** Vorschlag: die Achse, an der der größte Teil der Linie entlangläuft. */
function bordbrettAchsVorschlag(linie) {
  const achsen = achsenListe();
  const bayEls = computeLayout().filter(e => e.type === 'bay');
  if (!bayEls.length) return null;
  const proAchse = new Map();
  const pts = linie.punkte || [];
  const schritt = Math.max(state.depth * PX_PER_M * 0.4, 10);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.ceil(len / schritt));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const si = bordbrettSektionAn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, bayEls);
      if (si == null) continue;
      const idx = achseVonSektion(achsen, si);
      if (idx < 0) continue;
      proAchse.set(idx, (proAchse.get(idx) || 0) + len / n);
    }
  }
  let best = null;
  proAchse.forEach((len, idx) => { if (!best || len > best.len) best = { idx, len }; });
  return best ? achsen[best.idx] : null;
}

/** Achsen, an denen die Linie entlangläuft (Indizes, in Reihenfolge). */
function bordbrettBeruehrteAchsen(linie) {
  const achsen = achsenListe();
  const bayEls = computeLayout().filter(e => e.type === 'bay');
  const out = [];
  const pts = linie.punkte || [];
  const schritt = Math.max(state.depth * PX_PER_M * 0.4, 10);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.ceil(len / schritt));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const si = bordbrettSektionAn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, bayEls);
      if (si == null) continue;
      const idx = achseVonSektion(achsen, si);
      if (idx >= 0 && !out.includes(idx)) out.push(idx);
    }
  }
  return out;
}

/** Ordnet eine Linie einer Achse zu (achse === null hebt die Zuordnung auf). */
function bordbrettZuordnen(linie, achse) {
  linie.achseSecId = achse ? achse.secs[0].id : null;
  invalidateEckenCache();
  return linie;
}

function loescheBordbrett(id) {
  const list = bordbretterListe();
  const i = list.findIndex(l => l.id === id);
  if (i >= 0) list.splice(i, 1);
  invalidateEckenCache();
}

/* Was die gezeichneten Linien über die Ecken aussagen: `eckKey → Rolle`.
     durchSi    Innenecke – welche Achse dort DURCHLÄUFT (sie wird gekürzt,
                die andere um denselben Wert verlängert; siehe eckKorrekturen)
     aussenSis  Außenecke – Achsen, deren Lage um die Ecke herumläuft; jede
                bekommt ihr Feld an der Ecke um die Gerüsttiefe verlängert
                (nach DIN 18451 zählt eine Außenecke bei beiden Seiten, hier
                aber nur, soweit es auch gezeichnet ist)
     konflikt   zwei Linien behaupten an derselben Innenecke Gegenteiliges –
                es gilt die zuerst gezeichnete, der Hinweis bleibt sichtbar */
let _bbRollenSig = null, _bbRollen = null;

function bordbrettEckRollen() {
  const sig = eckenSignatur();
  if (_bbRollenSig === sig && _bbRollen) return _bbRollen;
  const map = new Map();
  const achsen = achsenListe();
  const ecken  = roheEcken();
  const hole = e => {
    let r = map.get(e.key);
    if (!r) {
      r = { key: e.key, art: e.art, si: e.si, ni: e.ni,
            durchSi: null, durchLinieId: null, aussenSis: [], konflikt: false };
      map.set(e.key, r);
    }
    return r;
  };

  bordbretterListe().forEach(linie => {
    const a = bordbrettAchse(linie, achsen);
    if (!a) return;
    bordbrettAuswertung(linie, achsen, ecken).enden.forEach(ende => {
      if (!ende.ecke || !ende.rolle) return;
      const r = hole(ende.ecke);
      const gegenSi = ende.achsSi === ende.ecke.si ? ende.ecke.ni : ende.ecke.si;
      if (ende.rolle === 'umlaufend') {
        if (!r.aussenSis.includes(ende.achsSi)) r.aussenSis.push(ende.achsSi);
        return;
      }
      const durch = ende.rolle === 'durchlaufend' ? ende.achsSi : gegenSi;
      if (r.durchSi != null) { if (r.durchSi !== durch) r.konflikt = true; return; }
      r.durchSi = durch;
      r.durchLinieId = linie.id;
    });
  });
  _bbRollen = map; _bbRollenSig = sig;
  return map;
}

/** Läuft an dieser Ecke eine Bordbretter-Linie um die Sektion `si` herum? */
function bordbrettDecktEcke(key, si) {
  const r = bordbrettEckRollen().get(key);
  return !!r && r.aussenSis.includes(si);
}

/* ── Ecken: Erkennung + Entscheidung des Nutzers ───────────────────────────── */

/** Stabiler Schlüssel einer Ecke: das ungeordnete Paar der Sektions-IDs.
 *  Bewusst NICHT die Position – die ändert sich beim Verschieben – und
 *  bewusst ungeordnet, damit die Entscheidung erhalten bleibt, wenn dieselbe
 *  Ecke einmal von der anderen Seite her gefunden wird. */
function eckKey(secA, secB) {
  const a = secA.id, b = secB.id;
  return a < b ? `E${a}-${b}` : `E${b}-${a}`;
}

/** Gespeicherte Entscheidung zu einer Ecke (oder ein leeres Objekt). */
function eckWahl(key) {
  if (!state.ecken || typeof state.ecken !== 'object') state.ecken = {};
  return state.ecken[key] || {};
}

/** Entscheidung setzen. `typ`: 'auto' | 'aussen' | 'innen';
 *  `durch`: Sektions-ID der durchlaufenden Achse oder null (= Vorschlag). */
function setEckWahl(key, patch) {
  if (!state.ecken || typeof state.ecken !== 'object') state.ecken = {};
  const cur = { ...eckWahl(key), ...patch };
  if (cur.typ === 'auto' || cur.typ == null) delete cur.typ;
  if (cur.durch == null) delete cur.durch;
  if (Object.keys(cur).length) state.ecken[key] = cur;
  else delete state.ecken[key];
}

/**
 * Alle Ecken der Zeichnung, angereichert um die Aufmaß-Bedeutung.
 *
 * Für jede Ecke wird geliefert:
 *   key        stabiler Schlüssel (siehe eckKey)
 *   si, ni     ein- und ausleitende Sektion (Index)
 *   art        'aussen' | 'innen' – nach Nutzerentscheidung, sonst Geometrie
 *   artAuto    was die Geometrie allein sagt
 *   pts        Viereck (Eckstück bzw. Überlappung) für die Zeichnung
 *   durchSi    Sektionsindex der DURCHLAUFENDEN Achse   (nur bei 'innen')
 *   fuellSi    Sektionsindex der AUSFÜLLENDEN Achse     (nur bei 'innen')
 *   bestaetigt hat der Nutzer die Zuordnung selbst gesetzt?
 *
 * Solange der Nutzer nicht entschieden hat, gilt ein VORSCHLAG: die Achse mit
 * der größeren Gesamtlänge läuft durch, die kürzere füllt die Ecke. Das ist
 * der übliche Fall (ein Rücksprung wird von einem kurzen Feld ausgefüllt) –
 * aber eben nur ein Vorschlag, siehe `bestaetigt`.
 */
function eckenListe() {
  const sig = eckenSignatur();
  if (_eckenSig === sig && _eckenCache) return _eckenCache;
  _eckenCache = eckenListeBerechnen();
  _eckenSig   = sig;
  return _eckenCache;
}

/* Merker für eckenListe(). Die Liste wird pro Achse und pro Abschnitt
   gebraucht (computeAufmass → eckKorrekturen), ihre Ermittlung ist aber
   vergleichsweise teuer: computeLayout() plus wallChains(). Ohne Merker
   kostete ein Aufmaß über 160 Achsen rund 0,6 s – spürbar beim PDF-Export.

   Statt an Änderungen „gemeldet" zu werden (was leicht eine Stelle übersieht
   und dann veraltete Zahlen liefert), prüft der Merker eine Signatur über
   ALLES, wovon die Liste abhängt: Geometrie, Sichtbarkeit, Gerüsttiefe und
   die Eck-Entscheidungen. Aufstellen der Signatur ist linear zur Feldanzahl,
   die Berechnung selbst quadratisch – der Merker lohnt sich also auch dann,
   wenn er nur innerhalb eines Durchlaufs greift. */
let _eckenCache = null;
let _eckenSig   = null;

function eckenSignatur() {
  const p = [state.depth];
  state.sections.forEach(s => {
    p.push(s.id, s.x0, s.y0, secAngle(s), s.flip ? 1 : 0);
    s.bays.forEach(b => p.push(b.id, b.len, isBayVisible(b) ? 1 : 0));
  });
  p.push(JSON.stringify(state.ecken || {}));
  // Die gezeichneten Bordbretter-Linien bestimmen mit, welche Achse an einer
  // Innenecke durchläuft – sie gehören deshalb in die Signatur.
  p.push(JSON.stringify(state.bordbretter || []));
  return p.join('|');
}

/** Verwirft die gemerkten Ecken-/Bordbrettauswertungen. Nötig, wenn sich etwas
 *  ändert, das die Signatur zwar erfasst, aber innerhalb desselben
 *  Auswertungsdurchlaufs (z. B. beim Zuordnen einer Linie). */
function invalidateEckenCache() {
  _eckenCache = null; _eckenSig = null;
  _bbRollen = null;   _bbRollenSig = null;
}

function eckenListeBerechnen() {
  const achsen = achsenListe();
  const rollen = bordbrettEckRollen();
  const laengeVon = si => {
    const a = achsen[achseVonSektion(achsen, si)];
    return a ? a.bays.reduce((s, b) => s + b.len, 0) : 0;
  };

  return computeLayout().filter(e => e.type === 'corner').map(c => {
    const secA = state.sections[c.si], secB = state.sections[c.ni];
    const key  = eckKey(secA, secB);
    const w    = eckWahl(key);
    const art  = (w.typ === 'aussen' || w.typ === 'innen') ? w.typ : c.kind;

    // Vorschlag: die längere Achse läuft durch. Bei Gleichstand entscheidet
    // die Zeichenrichtung (die in der Ecke endende Achse „läuft hinein").
    const lenA = laengeVon(c.si), lenB = laengeVon(c.ni);
    const vorschlagDurch = lenB > lenA ? c.ni : c.si;

    // Die gespeicherte Wahl zählt nur, wenn sie eine der beiden Achsen
    // benennt – nach Umbauten kann sie ins Leere zeigen.
    const gewaehlt = w.durch != null
      ? [c.si, c.ni].find(i => state.sections[i] && state.sections[i].id === w.durch)
      : undefined;
    // Läuft eine zugeordnete Bordbretter-Linie durch die Ecke, ist das die
    // Aussage des Nutzers über den tatsächlichen Verlauf – sie geht dem
    // Vorschlag vor, weicht aber einem direkt am Eck-Symbol gesetzten Wunsch.
    const bb = rollen.get(key);
    const ausLinie = (gewaehlt == null && bb && bb.durchSi != null && art === 'innen')
      ? bb.durchSi : null;
    const durchSi = gewaehlt != null ? gewaehlt
                  : (ausLinie != null ? ausLinie : vorschlagDurch);

    return {
      key, si: c.si, ni: c.ni, pts: c.pts,
      art, artAuto: c.kind,
      typBestaetigt: w.typ === 'aussen' || w.typ === 'innen',
      durchSi,
      fuellSi: durchSi === c.si ? c.ni : c.si,
      bestaetigt: gewaehlt != null || ausLinie != null,
      quelle: gewaehlt != null ? 'nutzer' : (ausLinie != null ? 'bordbrett' : 'vorschlag'),
      bordbrettId: bb ? bb.durchLinieId : null,
      bordbrettKonflikt: !!(bb && bb.konflikt)
    };
  });
}

/** Innenecken, deren Zuordnung noch auf dem Vorschlag beruht. */
function offeneInnenecken() {
  return eckenListe().filter(e => e.art === 'innen' && !e.bestaetigt);
}

/**
 * Das Feld einer Sektion, das AN der Ecke liegt: endet die Sektion dort, ist
 * es ihr letztes Feld, beginnt sie dort, ihr erstes.
 */
function eckFeldVon(si, endetAnDerEcke) {
  const sec = state.sections[si];
  if (!sec || !sec.bays.length) return null;
  const sichtbar = sec.bays.filter(isBayVisible);
  const liste = sichtbar.length ? sichtbar : sec.bays;
  return endetAnDerEcke ? liste[liste.length - 1] : liste[0];
}

/**
 * Ecken-Korrektur je Feld:
 * `bay.id → { delta, innen, innenAnzahl, aussen, aussenAnzahl, ecken:[…] }`.
 *
 * Zwei Quellen, beide feldgenau – damit der Rechenweg im PDF „2,57 + 2,57 +
 * (2,57 − 0,73)" lauten kann statt einer anonymen Summenkorrektur:
 *
 * 1. INNENECKE (Regel „Innenecken verrechnen"): das Feld an der Ecke der
 *    DURCHLAUFENDEN Achse wird um die Ecklänge gekürzt, das Feld an der Ecke
 *    der AUSFÜLLENDEN Achse um dieselbe Länge verlängert. Liegen beide Felder
 *    in derselben Auswertung, heben sich −x und +x exakt auf: die Innenecke
 *    ist in der Summe neutral.
 *
 * 2. AUSSENECKE, um die eine zugeordnete BORDBRETTER-LINIE herumläuft: das
 *    Feld dieser Achse an der Ecke wird um die Ecklänge verlängert – die
 *    Gerüstlage läuft dort tatsächlich um die Ecke herum. Ohne gezeichnete
 *    Linie ändert sich nichts; dann gilt weiter allein der (abschaltbare)
 *    pauschale Eckzuschlag aus den Aufmaßregeln.
 *
 * Die Ecklänge ist in beiden Fällen die Gerüsttiefe des Abschnitts, solange in
 * den Aufmaßregeln kein eigener Wert eingetragen ist.
 */
function eckKorrekturen() {
  const map = new Map();
  const r = aufmassRules();

  const merke = (bay, delta, info) => {
    if (!bay) return;
    const cur = map.get(bay.id)
      || { delta: 0, innen: 0, innenAnzahl: 0, aussen: 0, aussenAnzahl: 0, ecken: [] };
    cur.delta += delta;
    if (info.art === 'innen') { cur.innen  += delta; cur.innenAnzahl++; }
    else                      { cur.aussen += delta; cur.aussenAnzahl++; }
    cur.ecken.push(info);
    map.set(bay.id, cur);
  };

  const innenWert = innenEckWert();
  if (r.innenecke.aktiv && innenWert > 0) {
    eckenListe().forEach(e => {
      if (e.art !== 'innen') return;
      merke(eckFeldVon(e.durchSi, e.durchSi === e.si), -innenWert,
            { key: e.key, art: 'innen', rolle: 'durchlaufend', wert: -innenWert });
      merke(eckFeldVon(e.fuellSi, e.fuellSi === e.si), +innenWert,
            { key: e.key, art: 'innen', rolle: 'ausfuellend', wert: +innenWert });
    });
  }

  const eckWert = eckZuschlagWert();
  if (eckWert > 0) {
    bordbrettEckRollen().forEach(rolle => {
      if (rolle.art !== 'aussen') return;
      rolle.aussenSis.forEach(si => {
        merke(eckFeldVon(si, si === rolle.si), +eckWert,
              { key: rolle.key, art: 'aussen', rolle: 'umlaufend', wert: +eckWert });
      });
    });
  }
  return map;
}

/** Aufmaßlänge eines einzelnen Feldes inkl. Eckenkorrektur (nie < 0). */
function bayAufmassLen(bay, korr) {
  const k = korr && korr.get(bay.id);
  return Math.max(0, bay.len + (k ? k.delta : 0));
}

/** Aufmaßrelevante Gerüsthöhe eines Feldes (kleinere der beiden Höhen). */
function bayHoehe(bay) {
  const hs = [bay.hL, bay.hR].filter(h => h != null && !isNaN(h) && h > 0);
  return hs.length ? Math.min(...hs) : null;
}

/**
 * Felder einer Menge nach ihrer Gerüsthöhe zusammengefasst.
 *
 * Auf einer Seite stehen häufig unterschiedlich hohe Gerüste (z. B. 5 Felder
 * bis 10,20 m, 5 weitere bis 8,20 m). Im Aufmaß gehören diese Felder getrennt
 * zusammengefasst, weil sich Fläche und Abrechnung sonst nicht nachvollziehen
 * lassen: 12,85 m × 10,20 m UND 12,85 m × 8,20 m statt einer Mischzahl.
 *
 * Die Länge je Höhengruppe ist das Achsmaß der Gruppe inklusive der
 * feldgenauen Eckenkorrekturen (Innenecke, Bordbretter-Linie an Außenecken).
 *
 * @returns {Array<{hoehe:number|null, bays:Array, felder:number,
 *                  laenge:number, flaeche:number}>} nach Höhe absteigend
 */
function aufmassNachHoehe(bays, korr) {
  const k = korr || eckKorrekturen();
  const gruppen = new Map();
  bays.forEach(b => {
    const h = bayHoehe(b);
    const key = h == null ? 'ohne' : h.toFixed(2);
    const g = gruppen.get(key) || { hoehe: h, bays: [] };
    g.bays.push(b);
    gruppen.set(key, g);
  });
  const r2 = n => +n.toFixed(2);
  return [...gruppen.values()].map(g => {
    const laenge = g.bays.reduce((s, b) => s + bayAufmassLen(b, k), 0);
    return {
      hoehe: g.hoehe, bays: g.bays, felder: g.bays.length,
      laenge: r2(laenge),
      flaeche: g.hoehe != null ? r2(laenge * g.hoehe) : 0
    };
  }).sort((a, b) => (b.hoehe == null ? -1 : b.hoehe) - (a.hoehe == null ? -1 : a.hoehe));
}

/**
 * Aufmaß einer Feldmenge nach den eingestellten Regeln.
 * Grundlage ist immer das Achsmaß; Korrektur und Zuschläge kommen nur dazu,
 * wenn sie eingeschaltet sind.
 *
 * @param {Array} bays  Felder (z. B. ein Abschnitt oder alle Felder)
 * @returns {{achse:number, innenecken:number, innenLaenge:number,
 *            ecken:number, eckLaenge:number, felder:number,
 *            feldLaenge:number, laenge:number, achsFlaeche:number,
 *            flaeche:number, hoehe:number|null}}
 */
function computeAufmass(bays) {
  const r   = aufmassRules();
  const ids = new Set(bays.map(b => b.id));
  const achse       = bays.reduce((s, b) => s + b.len, 0);
  const achsFlaeche = bays.reduce((s, b) => s + bayFlaecheM2(b), 0);

  const alleEcken = (r.eckzuschlag.aktiv || r.innenecke.aktiv) ? eckenListe() : [];

  // ── Feldgenaue Eckenkorrekturen ─────────────────────────────────────────
  // Innenecke: Umverteilung, kein Zuschlag. Gezählt wird, wie oft eine
  // Innenecke Felder DIESER Menge betrifft; die Summe der Korrekturen kann
  // dabei positiv, negativ oder (wenn beide Seiten in der Menge liegen) genau
  // null sein. Außenecke: nur dort, wo eine Bordbretter-Linie tatsächlich um
  // die Ecke läuft (siehe eckKorrekturen()).
  const korr = eckKorrekturen();
  let innenLaenge = 0, innenecken = 0, linienEcken = 0, linienLaenge = 0;
  bays.forEach(b => {
    const k = korr.get(b.id);
    if (!k) return;
    innenLaenge  += k.innen;
    innenecken   += k.innenAnzahl;
    linienLaenge += k.aussen;
    linienEcken  += k.aussenAnzahl;
  });

  // ── Außenecke: Zuschlag bei BEIDEN angrenzenden Seiten (La = L + L1) ─────
  // Jede Ecke bringt den Zuschlag für JEDE angrenzende Seite ein, die zu
  // dieser Feldmenge gehört – so wird die Ecke wie vorgesehen doppelt
  // gerechnet. Innenecken sind hier bewusst ausgenommen: dort überlappen sich
  // die Bahnen, statt eine Lücke zu lassen. Seiten, deren Bordbretter-Linie
  // bereits um die Ecke läuft, sind oben schon feldgenau erfasst und werden
  // hier NICHT ein zweites Mal gezählt.
  let ecken = 0;
  if (r.eckzuschlag.aktiv) {
    alleEcken.forEach(c => {
      if (c.art !== 'aussen') return;
      [c.si, c.ni].forEach(i => {
        const sec = state.sections[i];
        if (!sec || !sec.bays.some(b => ids.has(b.id))) return;
        if (bordbrettDecktEcke(c.key, i)) return;
        ecken++;
      });
    });
  }
  const eckLaenge = ecken * eckZuschlagWert() + linienLaenge;
  ecken += linienEcken;

  // Feldzuschlag – je nach eingestelltem Wirkungsbereich.
  let felder = 0;
  if (r.feldzuschlag.aktiv) {
    if (r.feldzuschlag.modus === 'feld') {
      felder = bays.length;
    } else {
      wallChains().forEach(chain => {
        const chainBays = chain.flatMap(i => state.sections[i].bays.filter(isBayVisible));
        if (!chainBays.some(b => ids.has(b.id))) return;
        if (r.feldzuschlag.modus === 'einzelfeld' && chainBays.length !== 1) return;
        felder++;
      });
    }
  }
  const feldLaenge = felder * r.feldzuschlag.wert;

  const laenge = achse + innenLaenge + eckLaenge + feldLaenge;
  // Die Zuschlagslängen werden mit der längengewichteten mittleren Gerüsthöhe
  // in Fläche umgerechnet – dieselbe Höhe, mit der auch das Achsmaß rechnet.
  const hoehe = achse > 0 ? achsFlaeche / achse : null;
  const flaeche = hoehe != null ? laenge * hoehe : achsFlaeche;

  const r2 = n => +n.toFixed(2);
  return {
    achse: r2(achse),
    innenecken, innenLaenge: r2(innenLaenge),
    ecken, eckLaenge: r2(eckLaenge),
    felder, feldLaenge: r2(feldLaenge), laenge: r2(laenge),
    achsFlaeche: r2(achsFlaeche), flaeche: r2(flaeche),
    hoehe: hoehe != null ? r2(hoehe) : null
  };
}

/**
 * Aufmaß je ACHSE – die Gliederung, auf die sich die Innenecken-Regel
 * bezieht. Liefert zusätzlich den feldgenauen Rechenweg als Text, damit im
 * PDF nachvollziehbar bleibt, WELCHES Feld gekürzt bzw. verlängert wurde.
 */
function aufmassAchsen() {
  const korr   = eckKorrekturen();
  const ecken  = eckenListe();          // einmal ermitteln, nicht je Achse
  const rollenBB = bordbrettEckRollen();
  const linien = bordbretterListe();
  const achsen = achsenListe();
  return achsen.map(a => {
    const m = computeAufmass(a.bays);
    const teile = a.bays.map(b => {
      const k = korr.get(b.id);
      if (!k || !k.delta) return fmtQty(b.len);
      const vz = k.delta < 0 ? '−' : '+';
      return `(${fmtQty(b.len)} ${vz} ${fmtQty(Math.abs(k.delta))})`;
    });
    // Rolle der Achse an ihren Ecken – für die Spalte „Rolle an der Ecke".
    const inChain = new Set(a.chain);
    const rollen = [];
    ecken.forEach(e => {
      if (e.art !== 'innen') return;
      if (inChain.has(e.durchSi))      rollen.push('durchlaufend');
      else if (inChain.has(e.fuellSi)) rollen.push('ausfüllend');
    });
    rollenBB.forEach(rb => {
      if (rb.art !== 'aussen') return;
      if (rb.aussenSis.some(si => inChain.has(si))) rollen.push('um die Außenecke');
    });
    // Zugeordnete Bordbretter-Linien dieser Achse.
    const bb = linien.filter(l => {
      const ach = bordbrettAchse(l, achsen);
      return ach && ach.idx === a.idx;
    });
    return { ...a, m, rechenweg: teile.join(' + '), rollen,
             bordbretter: bb, hoehen: aufmassNachHoehe(a.bays, korr) };
  });
}

/**
 * Aufstellung der Bordbretter-Linien für Dialog und PDF: was gezeichnet wurde,
 * welcher Achse es zugeordnet ist, welche Ecken daraus folgen und wie sich das
 * auf die Aufmaßlänge auswirkt.
 */
function bordbretterAufstellung() {
  const achsen  = achsenListe();
  const ecken   = roheEcken();
  const achsMass = aufmassAchsen();
  const r = aufmassRules();
  return bordbretterListe().map(linie => {
    const aus = bordbrettAuswertung(linie, achsen, ecken);
    const m   = aus.achse ? achsMass.find(a => a.idx === aus.achse.idx) : null;
    // Eine Innenecken-Korrektur greift nur, solange die Regel eingeschaltet
    // ist – sonst stünde im PDF eine Zahl, mit der gar nicht gerechnet wurde.
    const wirksam = e => !!e.rolle && (e.ecke.art === 'aussen' || r.innenecke.aktiv);
    const texte = [], hinweise = [];
    let korrektur = 0;
    aus.enden.forEach(e => {
      if (!e.ecke) return;
      const art = e.ecke.art === 'innen' ? 'Innenecke' : 'Außenecke';
      const nSi = state.sections[e.ecke.si], nNi = state.sections[e.ecke.ni];
      const bez = `${art} ${nSi ? nSi.name : '?'}/${nNi ? nNi.name : '?'}`;
      if (!wirksam(e)) {
        hinweise.push(e.rolle
          ? `${bez}: Regel abgeschaltet`
          : `${bez}: Verlauf ohne eindeutigen Bezug – keine Korrektur`);
        return;
      }
      korrektur += e.delta;
      texte.push(`${bez} ${e.delta < 0 ? '−' : '+'} ${fmtQty(Math.abs(e.delta))} m`);
    });
    return {
      linie, name: bordbrettName(linie),
      achse: aus.achse ? aus.achse.name : null,
      laenge: aus.laenge, achsLaenge: aus.achsLaenge,
      ecken: texte, hinweise,
      korrektur: +korrektur.toFixed(2),
      aufmass: m ? m.m.laenge : null
    };
  });
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
const PDF_MARGIN       = 12;     // mm Seitenrand
const PDF_MM_PER_M_MIN = 11;     // mind. 11 mm je Meter (≈ 1:91) – Baustellen-lesbar
const PDF_MM_PER_M_MAX = 45;     // höchstens 45 mm je Meter (≈ 1:22)

// Höhe der wiederkehrenden Seitenelemente (mm)
const PDF_HEADER_H = 17;   // Kopfzeile mit Projekt/Blattangabe
const PDF_FOOTER_H = 11;   // Fußzeile mit Kennzahlen, Datum, Seitenzahl
const PDF_LEGEND_H = 9;    // Legendenstreifen auf Planseiten

// Schriftgrößen in pt – bewusst fix, damit auf Papier nichts unter die
// Lesbarkeitsgrenze rutscht.
const PDF_FS_LEN   = 8.5;   // Feldlänge
const PDF_FS_H     = 7.5;   // Höhenangaben
const PDF_FS_LABEL = 7;     // Feldbezeichnung (A1 …)
const PDF_FS_BADGE = 6.5;   // Positions-Badges

/* ── Layout-Varianten ────────────────────────────────────────────────────────
   Drei Gestaltungen für dasselbe Dokument – die Wahl merkt sich die App.
     technisch : Weißes Blatt, feine Linien, marineblauer Akzent, Kopf- und
                 Fußleiste als schmale Regellinien. Wirkt wie eine
                 Werkplan-Zeichnung und druckt sparsam.
     kontrast  : Durchgehend farbige Kopfleiste, kräftige Tabellenköpfe,
                 großzügige Zebra-Zeilen. Am besten lesbar auf der Baustelle
                 und beim schnellen Durchblättern am Bildschirm.
     monochrom : Reine Graustufen ohne Farbflächen – für schwarz-weiße
                 Bürodrucker, Kopien und Faxversand. Positionen werden über
                 Graustufen und Kürzel unterschieden statt über Farbe.        */

const PDF_THEMES = {
  technisch: {
    label: 'Technisch',
    desc: 'Weißes Blatt, feine Linien, marineblauer Akzent – wie ein Werkplan.',
    accent:   [26, 74, 122],
    accentSoft: [232, 240, 248],
    ink:      [23, 32, 42],
    inkSoft:  [96, 110, 124],
    rule:     [186, 196, 206],
    bandFill: null,              // kein Farbbalken – nur Regellinien
    bandText: [23, 32, 42],
    tableHead:[236, 240, 245],
    tableHeadText: [60, 72, 84],
    groupFill:[26, 74, 122],
    groupText:[255, 255, 255],
    zebra:    [246, 248, 251],
    bayFill:  [226, 238, 250],
    bayStroke:[44, 111, 168],
    colored:  true
  },
  kontrast: {
    label: 'Kontrast',
    desc: 'Farbige Kopfleiste, kräftige Tabellen – gut lesbar auf der Baustelle.',
    accent:   [11, 61, 105],
    accentSoft: [225, 236, 247],
    ink:      [17, 24, 33],
    inkSoft:  [88, 100, 114],
    rule:     [200, 209, 218],
    bandFill: [11, 61, 105],
    bandText: [255, 255, 255],
    tableHead:[11, 61, 105],
    tableHeadText: [255, 255, 255],
    groupFill:[233, 240, 248],
    groupText:[11, 61, 105],
    zebra:    [243, 247, 251],
    bayFill:  [219, 234, 249],
    bayStroke:[11, 61, 105],
    colored:  true
  },
  monochrom: {
    label: 'Monochrom',
    desc: 'Reine Graustufen – für Schwarz-Weiß-Druck und Kopien.',
    accent:   [40, 40, 40],
    accentSoft: [238, 238, 238],
    ink:      [20, 20, 20],
    inkSoft:  [105, 105, 105],
    rule:     [175, 175, 175],
    bandFill: null,
    bandText: [20, 20, 20],
    tableHead:[232, 232, 232],
    tableHeadText: [45, 45, 45],
    groupFill:[60, 60, 60],
    groupText:[255, 255, 255],
    zebra:    [245, 245, 245],
    bayFill:  [240, 240, 240],
    bayStroke:[80, 80, 80],
    colored:  false
  }
};

const PDF_THEME_KEY = 'av_2d_pdf_theme';
const PDF_HIDDEN_KEY = 'av_2d_pdf_include_hidden';

function pdfThemeName() {
  const n = localStorage.getItem(PDF_THEME_KEY);
  return PDF_THEMES[n] ? n : 'technisch';
}

/* Standardregel für ausgeblendete Abschnitte: NICHT mitexportieren. Das PDF
   zeigt damit genau das, was auch auf dem Bildschirm zu sehen ist – gerade bei
   Bauabschnitten, die getrennt abgerechnet werden, ist das die Erwartung.
   Umschaltbar im PDF-Dialog; die Wahl wird gemerkt.                         */
let pdfIncludeHidden = localStorage.getItem(PDF_HIDDEN_KEY) === '1';

/** Farbe im gewählten Layout: in „monochrom" wird jede Farbe in einen
 *  Grauwert gleicher Helligkeit übersetzt, damit auch Schwarz-Weiß-Ausdrucke
 *  die Positionen unterscheidbar zeigen. */
function pdfCol(theme, rgb) {
  if (theme.colored) return rgb;
  const l = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
  const v = Math.round(40 + (l / 255) * 150);   // auf 40…190 stauchen
  return [v, v, v];
}

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

/* ── Wiederkehrende Seitenelemente ───────────────────────────────────────────
   Kopfzeile, Legende und Fußzeile werden auf JEDER Seite gezeichnet – auch auf
   Tabellen-, Notiz- und Fotoseiten. Damit bleibt bei einem mehrseitigen
   Ausdruck auf jedem Blatt erkennbar, zu welchem Projekt es gehört, welcher
   Ausschnitt zu sehen ist und wie die Farben zu lesen sind.                  */

/** Kopfzeile. Liefert die Oberkante des freien Inhaltsbereichs (mm). */
function pdfDrawHeader(ctx, opts = {}) {
  const { doc, theme, pdfW, margin } = ctx;
  const y = margin;
  const h = PDF_HEADER_H;

  if (theme.bandFill) {
    doc.setFillColor(...theme.bandFill);
    doc.rect(0, 0, pdfW, y + h - 2, 'F');
  } else {
    // Akzentbalken links + feine Trennlinie unten
    doc.setFillColor(...theme.accent);
    doc.rect(margin, y, 1.6, h - 4, 'F');
  }

  const tx = theme.bandFill ? margin : margin + 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13.5);
  doc.setTextColor(...(theme.bandFill ? theme.bandText : theme.ink));
  doc.text(ctx.title, tx, y + 5.4);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2);
  doc.setTextColor(...(theme.bandFill ? theme.bandText : theme.inkSoft));
  if (ctx.subtitle) doc.text(ctx.subtitle, tx, y + 10.2);

  // Rechts: Dokumentart + Blattangabe
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(...(theme.bandFill ? theme.bandText : theme.accent));
  doc.text(opts.kicker || 'Gerüst-Aufmaß', pdfW - margin, y + 5.4, { align: 'right' });
  if (opts.sheet) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2);
    doc.setTextColor(...(theme.bandFill ? theme.bandText : theme.inkSoft));
    doc.text(opts.sheet, pdfW - margin, y + 10.2, { align: 'right' });
  }

  if (!theme.bandFill) {
    doc.setDrawColor(...theme.rule); doc.setLineWidth(0.3);
    doc.line(margin, y + h - 3.2, pdfW - margin, y + h - 3.2);
  }
  return y + h;
}

/** Fußzeile mit Kennzahlen, Datum und Seitenzahl (auf jeder Seite). */
function pdfDrawFooter(ctx, pageNo, pageCount) {
  const { doc, theme, pdfW, pdfH, margin } = ctx;
  const y = pdfH - margin - PDF_FOOTER_H;
  doc.setDrawColor(...theme.rule); doc.setLineWidth(0.3);
  doc.line(margin, y + 3, pdfW - margin, y + 3);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
  doc.setTextColor(...theme.inkSoft);
  doc.text(ctx.metaLine, margin, y + 7.2);
  doc.text(`${ctx.dateStr}   ·   Seite ${pageNo} von ${pageCount}`,
           pdfW - margin, y + 7.2, { align: 'right' });
}

/** Legendenstreifen: Positionsarten und Abschnitte mit ihren Farben.
 *  Wird auf jeder Planseite wiederholt. Liefert die neue Oberkante. */
function pdfDrawLegend(ctx, top, entries) {
  const { doc, theme, pdfW, margin } = ctx;
  if (!entries.length) return top;
  const h = PDF_LEGEND_H;

  doc.setFillColor(...theme.accentSoft);
  doc.rect(margin, top, pdfW - 2 * margin, h, 'F');

  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
  doc.setTextColor(...theme.inkSoft);
  doc.text('LEGENDE', margin + 2.5, top + h / 2 + 0.6, { baseline: 'middle' });

  let x = margin + 16;
  const maxX = pdfW - margin - 2;
  doc.setFontSize(7);
  entries.forEach(e => {
    doc.setFont('helvetica', 'normal');
    const w = doc.getTextWidth(e.label) + 8.5;
    if (x + w > maxX) return;              // was nicht passt, entfällt still
    const col = pdfCol(theme, e.color);
    doc.setFillColor(...col);
    doc.setDrawColor(...col); doc.setLineWidth(0.2);
    if (e.shape === 'line') {
      doc.setLineWidth(0.9);
      doc.line(x, top + h / 2, x + 4, top + h / 2);
    } else {
      doc.rect(x, top + h / 2 - 1.7, 3.6, 3.4, 'FD');
    }
    doc.setTextColor(...theme.ink);
    doc.text(e.label, x + 5.6, top + h / 2 + 0.6, { baseline: 'middle' });
    x += w;
  });
  return top + h + 2.5;
}

/** Legendeneinträge aus der aktuellen Zeichnung ableiten. */
function pdfLegendEntries() {
  const entries = [];
  const seen = new Set();
  const bays = visibleBaysFlat();
  bays.forEach(bay => (bay.positions || []).forEach(pos => {
    const p = POS_BY_KEY[pos.cat];
    if (!p || seen.has(p.key)) return;
    seen.add(p.key);
    entries.push({ label: p.label, color: pdfHex(p.color) });
  }));
  entries.sort((a, b) => a.label.localeCompare(b.label));
  abschnitteList().forEach(a => {
    if (bays.some(b => b.abschnittId === a.id)) {
      entries.push({ label: a.name, color: pdfHex(a.color), shape: 'line' });
    }
  });
  // Innenecken erklären sich im Plan nicht von selbst: dort steht kein
  // Bauteil, sondern es überlappen sich zwei Bahnen. Ohne Legendeneintrag
  // bliebe die gestrichelte Kontur unverständlich.
  if (eckenListe().some(e => e.art === 'innen')) {
    entries.push({ label: 'Innenecke (Überlappung, ± Aufmaß)', color: '#c2691b' });
  }
  if (bordbretterListe().length) {
    entries.push({ label: 'Bordbretter-Linie (Kante der Gerüstlage)',
                   color: '#0f8f8e', shape: 'line' });
  }
  return entries;
}

/**
 * Schneidet ein Polygon am achsparallelen Rechteck ab (Sutherland–Hodgman).
 * Gebraucht für die blass gezeichneten Anschlussfelder der Nachbarblätter:
 * die ragen naturgemäß über den Blattausschnitt hinaus und würden sonst in
 * Kopf- oder Fußzeile hineinlaufen.
 * @returns {Array<{x:number,y:number}>} leeres Array, wenn nichts übrig bleibt
 */
function clipPolyToRect(pts, r) {
  const edges = [
    { inside: p => p.x >= r.minX, cut: (a, b) => (r.minX - a.x) / (b.x - a.x) },
    { inside: p => p.x <= r.maxX, cut: (a, b) => (r.maxX - a.x) / (b.x - a.x) },
    { inside: p => p.y >= r.minY, cut: (a, b) => (r.minY - a.y) / (b.y - a.y) },
    { inside: p => p.y <= r.maxY, cut: (a, b) => (r.maxY - a.y) / (b.y - a.y) }
  ];
  let out = pts;
  for (const e of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ain = e.inside(a), bin = e.inside(b);
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = e.cut(a, b);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    if (!out.length) return [];
  }
  return out;
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
/** Ursprung der Papier-Abbildung: Ausschnitt mittig im verfügbaren Bereich. */
function pdfPlanOrigin(win, area, s) {
  return {
    x: area.x + (area.w - win.w * s) / 2 - win.minX * s,
    y: area.y + (area.h - win.h * s) / 2 - win.minY * s
  };
}

/* ── Kollisionsfreies Blattlayout ────────────────────────────────────────────
   Feldflächen werden am Rand des Ausschnitts abgeschnitten, ihre BESCHRIFTUNGEN
   (Feldlänge, Feldbezeichnung, Höhen- und Positions-Pillen) aber nicht: die
   sitzen neben dem Feld und ragten deshalb bei randnahen Feldern in die
   Legende, die Kopf-/Fußzeile oder über die Übersichtskarte.
   Deshalb werden alle Beschriftungen erst GEPLANT (Position + tatsächliche
   Ausdehnung auf dem Papier), dann gegen feste Sperrzonen geprüft und erst
   danach gezeichnet.                                                        */

/** Überlappen sich zwei Rechtecke {x,y,w,h}? */
function rectHits(a, b) {
  return !!b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Schiebt eine Beschriftung so weit, dass ihr Rechteck vollständig im
 * erlaubten Bereich liegt. Passt sie selbst verschoben nicht hinein (breiter
 * als der Bereich), liefert die Funktion null – sie entfällt dann lieber, als
 * die Legende zu überdecken.
 */
function clampLabelInto(label, area) {
  const r = label.rect;
  if (r.w > area.w || r.h > area.h) return null;
  let dx = 0, dy = 0;
  if (r.x < area.x)                   dx = area.x - r.x;
  else if (r.x + r.w > area.x + area.w) dx = (area.x + area.w) - (r.x + r.w);
  if (r.y < area.y)                   dy = area.y - r.y;
  else if (r.y + r.h > area.y + area.h) dy = (area.y + area.h) - (r.y + r.h);
  if (!dx && !dy) return label;
  return { ...label, cx: label.cx + dx, cy: label.cy + dy,
           rect: { ...r, x: r.x + dx, y: r.y + dy } };
}

/**
 * Sucht die Ecke des Zeichenbereichs, in der die Übersichtskarte am wenigsten
 * verdeckt. Sonst landete sie stur unten rechts – und damit bei L-förmigen
 * Gerüsten mitten auf der abgehenden Wand. Bewertet werden Feldflächen UND
 * Beschriftungen; Beschriftungen zählen dabei schwerer, weil eine verdeckte
 * Maßangabe das Blatt unbrauchbar macht.
 */
function pdfPickLocatorBox(area, win, s, bayEls, lw, lh, labels = []) {
  const o = pdfPlanOrigin(win, area, s);
  const boxes = [
    { x: area.x + area.w - lw, y: area.y + area.h - lh },   // unten rechts (bevorzugt)
    { x: area.x,               y: area.y + area.h - lh },   // unten links
    { x: area.x + area.w - lw, y: area.y },                 // oben rechts
    { x: area.x,               y: area.y }                  // oben links
  ].map(p => ({ ...p, w: lw, h: lh }));

  const rects = bayEls.map(el => {
    const b = elBBox(el);
    return { x: o.x + b.minX * s, y: o.y + b.minY * s,
             w: (b.maxX - b.minX) * s, h: (b.maxY - b.minY) * s };
  });
  let best = boxes[0], bestScore = Infinity;
  boxes.forEach(box => {
    const score = rects.filter(r => rectHits(r, box)).length
                + labels.filter(l => rectHits(l.rect, box)).length * 3;
    if (score < bestScore) { bestScore = score; best = box; }
  });
  return best;
}

function pdfDrawPlan(doc, win, area, s, bayEls, layout, shapesOnly, opts = {}) {
  const theme  = opts.theme || PDF_THEMES[pdfThemeName()];
  const ghosts = opts.ghosts || [];
  // Ausschnitt mittig im verfügbaren Bereich platzieren
  const _o = pdfPlanOrigin(win, area, s);
  const originX = _o.x;
  const originY = _o.y;
  const P  = p => ({ x: originX + p.x * s, y: originY + p.y * s });
  const XY = (x, y) => ({ x: originX + x * s, y: originY + y * s });

  const depth   = state.depth * PX_PER_M;

  // Alles, was über den Blattausschnitt hinausragt, wird am Rand des
  // Ausschnitts abgeschnitten – sonst liefen Anschlussfelder und Eckstücke in
  // Kopf- oder Fußzeile hinein.
  const clipRect = { minX: win.minX, minY: win.minY,
                     maxX: win.minX + win.w, maxY: win.minY + win.h };
  const drawClipped = (pts, style) => {
    const c = clipPolyToRect(pts, clipRect);
    if (c.length >= 3) pdfPoly(doc, c.map(P), style);
  };

  // 0. Anschluss-Felder der Nachbarblätter: blass und ohne Beschriftung, damit
  //    am Blattschnitt sichtbar bleibt, wie es weitergeht – ohne dass unklar
  //    wird, welche Felder zu DIESEM Blatt gehören.
  if (ghosts.length) {
    doc.setFillColor(245, 246, 248);
    doc.setDrawColor(198, 204, 211); doc.setLineWidth(0.3);
    ghosts.forEach(el => drawClipped(el.pts, 'FD'));
  }

  // 1. Eckstücke (nur die, deren Nachbarfelder auf dieser Seite liegen).
  //    Wie in der Zeichnung wird nur die AUSSENECKE als Fläche dargestellt –
  //    sie ist ein Bauteil. Die Innenecke ist eine Überlappung und bekommt
  //    lediglich eine Kontur, damit im Plan erkennbar bleibt, wo die
  //    Aufmaß-Anpassung greift, ohne Gerüst vorzutäuschen.
  const sichtbar = el => {
    const b = elBBox(el);
    return !(b.maxX < win.minX || b.minX > win.minX + win.w
          || b.maxY < win.minY || b.minY > win.minY + win.h);
  };
  const cornerStroke = pdfCol(theme, [44, 111, 168]);
  const cornerFill   = pdfCol(theme, [181, 212, 240]);
  doc.setDrawColor(...cornerStroke); doc.setLineWidth(0.4);
  doc.setFillColor(...cornerFill);
  layout.filter(e => e.type === 'corner' && eckArtEffektiv(e) === 'aussen')
        .forEach(el => { if (sichtbar(el)) drawClipped(el.pts, 'FD'); });

  const innenCorners = layout.filter(e => e.type === 'corner' && eckArtEffektiv(e) === 'innen');
  if (innenCorners.length) {
    doc.setDrawColor(...pdfCol(theme, [194, 105, 27])); doc.setLineWidth(0.35);
    if (doc.setLineDashPattern) doc.setLineDashPattern([1.1, 0.9], 0);
    innenCorners.forEach(el => { if (sichtbar(el)) drawClipped(el.pts, 'D'); });
    if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
  }

  // 2. Wandlinien – am Rand des Ausschnitts abgeschnitten (Liang-Barsky),
  //    damit auf einer Seite keine Linie ins Nichts weiterläuft.
  doc.setDrawColor(...pdfCol(theme, [90, 107, 122])); doc.setLineWidth(0.3);
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

  // 3. Felder – mit Abschnittsfarbe, falls das Feld einem Abschnitt angehört.
  bayEls.forEach(el => {
    const bay = state.sections[el.si].bays[el.bi];
    normalizeBay(bay);
    const absch = abschnittById(bay.abschnittId);
    const fill  = absch ? pdfCol(theme, pdfHex(tintHex(absch.color, 0.86))) : theme.bayFill;
    const strk  = absch ? pdfCol(theme, pdfHex(absch.color))                : theme.bayStroke;
    doc.setFillColor(...fill);
    doc.setDrawColor(...strk); doc.setLineWidth(0.45);
    pdfPoly(doc, el.pts.map(P), 'FD');
  });

  // 3b. Bordbretter-Linien: der gezeichnete Verlauf der Lagenkante. Er gehört
  //     in den Plan, weil die Eckenkorrektur im Aufmaß genau daraus abgeleitet
  //     ist – ohne ihn stünde im Dokument eine Zahl ohne Beleg.
  const bbLinien = bordbretterListe();
  if (bbLinien.length) {
    doc.setDrawColor(...pdfCol(theme, [15, 143, 142]));
    doc.setLineWidth(0.75);
    bbLinien.forEach(l => {
      for (let i = 0; i + 1 < l.punkte.length; i++) {
        const seg = clipSeg(l.punkte[i].x, l.punkte[i].y,
                            l.punkte[i + 1].x, l.punkte[i + 1].y);
        if (!seg) continue;
        const a = XY(seg[0], seg[1]), b = XY(seg[2], seg[3]);
        doc.line(a.x, a.y, b.x, b.y);
      }
    });
  }

  // 4. Beschriftungen – nach den Flächen, damit nichts überdeckt wird.
  //    Auf der Übersichtsseite entfallen sie: dort ist der Maßstab bewusst
  //    klein, Text würde sich nur überlagern.
  if (shapesOnly) { doc.setTextColor(0, 0, 0); return; }

  const labels = pdfPlanLabels(doc, s, bayEls, theme, P, XY, depth);

  /* Sperrzonen: Der Zeichenbereich `area` endet exakt unter der Legende und
     über der Fußzeile – was dort nicht hineinpasst, wird hineingeschoben oder
     weggelassen. Zusätzlich bleibt die Übersichtskarte frei. Sie wird ERST
     platziert, wenn die Beschriftungen bekannt sind, und danach gezeichnet. */
  const locBox = opts.locator
    ? pdfPickLocatorBox(area, win, s, bayEls, opts.locator.w, opts.locator.h, labels)
    : null;

  labels.forEach(raw => {
    const ln = clampLabelInto(raw, area);
    if (!ln || rectHits(ln.rect, locBox)) return;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(ln.fs);
    if (ln.plain) {
      doc.setTextColor(...ln.col);
      pdfText(doc, ln.text, ln.cx, ln.cy, ln.rot);
    } else {
      pdfPill(doc, ln.text, ln.cx, ln.cy, ln.rot, ln.fill, ln.stroke, ln.col);
    }
  });

  if (locBox) {
    pdfDrawLocator(doc, opts.locator.bounds, win, locBox, theme, opts.locator.caption);
  }

  doc.setTextColor(0, 0, 0);
}

/**
 * Plant alle Feldbeschriftungen eines Blattes, OHNE sie zu zeichnen.
 *
 * Die Gerüsttiefe ist im Grundriss nur ~0,7 m breit. Damit auf Papier nichts
 * ineinanderläuft, sitzt im Feld selbst NUR die Feldlänge; die Feldbezeichnung
 * liegt an der Wandseite, Höhen und Positionen gestapelt an der offenen Seite –
 * jeweils längs zum Feld gedreht und auf die Feldlänge eingepasst.
 *
 * @returns {Array<{text,cx,cy,rot,fs,fill,stroke,col,plain,rect}>}
 *          `rect` ist die achsparallele Hüllbox in mm – Grundlage für die
 *          Kollisionsprüfung gegen Legende, Fußzeile und Übersichtskarte.
 */
function pdfPlanLabels(doc, s, bayEls, theme, P, XY, depth) {
  const out = [];
  const depthMM = depth * s;

  /** Hüllbox einer gedrehten Pille bzw. eines gedrehten Textes (mm). */
  const mkRect = (cx, cy, w, h, deg) => {
    const th = (deg || 0) * Math.PI / 180;
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    const bw = w * ca + h * sa, bh = w * sa + h * ca;
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  };

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

    // Feldlänge mittig im Feld (ohne Pille – die Fläche ist ihr Hintergrund)
    const lenTxt = el.len.toFixed(2).replace('.', ',');
    doc.setFont('helvetica', 'bold');
    const lenFs = pdfFitFont(doc, lenTxt, maxTxt, PDF_FS_LEN, 5.5);
    const lenW  = doc.getTextWidth(lenTxt), lenH = lenFs * 0.352778;
    out.push({ text: lenTxt, cx: c.x, cy: c.y, rot, fs: lenFs, plain: true,
               col: theme.ink, rect: mkRect(c.x, c.y, lenW, lenH, rot) });

    // Feldbezeichnung an der Wandseite – in der Abschnittsfarbe, sodass sich
    // die Abschnitte auch im Ausdruck auf einen Blick unterscheiden.
    const absch = abschnittById(bay.abschnittId);
    const lblBg = absch ? pdfCol(theme, pdfHex(absch.color)) : theme.accent;
    const label = bayLabel(state.sections[el.si], el.bi);
    doc.setFont('helvetica', 'bold');
    const lblFs = pdfFitFont(doc, label, maxTxt, PDF_FS_LABEL, 5.5);
    const lblFsMM = lblFs * 0.352778;
    const lblD  = depthMM / 2 + lblFsMM;
    const lblCx = c.x - ox * lblD, lblCy = c.y - oy * lblD;
    out.push({ text: label, cx: lblCx, cy: lblCy, rot, fs: lblFs,
               fill: lblBg, stroke: lblBg, col: [255, 255, 255],
               rect: mkRect(lblCx, lblCy,
                            doc.getTextWidth(label) + lblFsMM * 0.8, lblFsMM * 1.5, rot) });

    // Offene Seite: Höhen, darunter je Position eine Zeile
    const lines = [];
    const hL = bay.hL != null ? bay.hL.toFixed(2).replace('.', ',') : null;
    const hR = bay.hR != null ? bay.hR.toFixed(2).replace('.', ',') : null;
    if (hL || hR) {
      lines.push({
        text: hL && hR ? (hL === hR ? 'h ' + hL : hL + ' | ' + hR) : 'h ' + (hL || hR),
        fill: pdfCol(theme, [240, 249, 243]), stroke: pdfCol(theme, [31, 122, 61]),
        col: pdfCol(theme, [22, 92, 45]), fs: PDF_FS_H
      });
    }
    (bay.positions || []).forEach(pos => {
      const meta = POS_BY_KEY[pos.cat];
      const col  = pdfCol(theme, pdfHex((meta && meta.color) || '#333333'));
      lines.push({ text: posBadge(pos, bay), fill: [255, 255, 255], stroke: col, col, fs: PDF_FS_BADGE });
    });

    let dist = depthMM / 2;
    lines.forEach(ln => {
      doc.setFont('helvetica', 'bold');
      const fs = pdfFitFont(doc, ln.text, maxTxt, ln.fs, 5.5);
      const fsMM = fs * 0.352778;
      const h  = fsMM * 1.5;
      dist += h * 0.62;
      const cx = c.x + ox * dist, cy = c.y + oy * dist;
      out.push({ text: ln.text, cx, cy, rot, fs, fill: ln.fill, stroke: ln.stroke, col: ln.col,
                 rect: mkRect(cx, cy, doc.getTextWidth(ln.text) + fsMM * 0.8, h, rot) });
      dist += h * 0.48;
    });
  });

  return out;
}

/** Kleine Übersichtskarte: ganzes Gerüst grau, der aktuelle Ausschnitt farbig
 *  hervorgehoben – zeigt auf jedem Blatt, wo man sich im Gesamtplan befindet. */
function pdfDrawLocator(doc, bounds, win, box, theme, caption) {
  const th = theme || PDF_THEMES[pdfThemeName()];

  doc.setDrawColor(...th.rule); doc.setLineWidth(0.25);
  doc.setFillColor(255, 255, 255);
  doc.rect(box.x, box.y, box.w, box.h, 'FD');

  doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6);
  doc.setTextColor(...th.inkSoft);
  doc.text(caption || 'LAGE IM GESAMTPLAN', box.x + 1.8, box.y + 3.2);

  // Zeichenfläche UNTER der Beschriftung, damit sich beides nicht überlagert.
  const capH = 4.6;
  const inner = { x: box.x + 1.8, y: box.y + capH, w: box.w - 3.6, h: box.h - capH - 1.8 };
  const s  = Math.min(inner.w / Math.max(bounds.w, 1), inner.h / Math.max(bounds.h, 1));
  const ox = inner.x + (inner.w - bounds.w * s) / 2 - bounds.minX * s;
  const oy = inner.y + (inner.h - bounds.h * s) / 2 - bounds.minY * s;

  // Gerüst als Umriss MIT Kontur: bei 0,73 m Tiefe wäre eine reine Füllung in
  // dieser Größe eine unsichtbare Haarlinie.
  doc.setFillColor(198, 206, 214); doc.setDrawColor(150, 160, 172);
  doc.setLineWidth(0.18);
  state.sections.forEach(sec => {
    sectionBayPolys(sec, sec.x0, sec.y0).forEach(poly => {
      pdfPoly(doc, poly.map(p => ({ x: ox + p.x * s, y: oy + p.y * s })), 'FD');
    });
  });

  doc.setDrawColor(...th.accent); doc.setLineWidth(0.7);
  doc.rect(ox + win.minX * s, oy + win.minY * s, win.w * s, win.h * s, 'S');
}

/**
 * Ermittelt die Papierseiten-Aufteilung des Plans.
 *
 * Grundsätze der Aufteilung:
 *  • EIN gemeinsamer Maßstab für alle Planseiten – nur so lassen sich die
 *    Blätter nebeneinanderlegen und Längen von Blatt zu Blatt vergleichen.
 *  • ALLE Ausschnitte sind gleich groß und liegen auf einem festen Raster.
 *    Blatt 2 schließt damit exakt an Blatt 1 an (früher war jeder Ausschnitt
 *    die Hüllbox seiner Felder – die Blätter passten nicht zusammen).
 *  • Zugeordnet wird über den Feldmittelpunkt, und jeder Ausschnitt ist um die
 *    größte Feldausdehnung größer als sein Rasterfeld. Dadurch liegt jedes
 *    Feld vollständig auf genau einem Blatt – nie angeschnitten.
 *  • Zusätzlich wird notiert, welche FREMDEN Felder in den Ausschnitt ragen;
 *    die zeichnet pdfDrawPlan blass als Anschluss-Kontext (Blattschnitt).
 *
 * @returns {{pages:Array, bounds:Object|null, scale:number, tiled:boolean,
 *            cols:number, rows:number}}
 */
function pdfPlanPages(layout, availW, availH) {
  const bayEls = layout.filter(e => e.type === 'bay');
  const bounds = contentBounds();
  if (!bayEls.length || !bounds) {
    return { pages: [], bounds: null, scale: 0, tiled: false, cols: 0, rows: 0 };
  }

  const pad = state.depth * PX_PER_M * 1.1;
  const full = {
    minX: bounds.minX - pad, minY: bounds.minY - pad,
    w: bounds.w + pad * 2,   h: bounds.h + pad * 2
  };

  const sMin = PDF_MM_PER_M_MIN / PX_PER_M;
  const sMax = PDF_MM_PER_M_MAX / PX_PER_M;
  const sFit = Math.min(availW / full.w, availH / full.h);

  // Passt alles bei lesbarem Maßstab auf eine Seite → genau eine Planseite.
  if (sFit >= sMin) {
    return { pages: [{ win: full, els: bayEls, ghosts: [], col: 0, row: 0 }],
             bounds: full, scale: Math.min(sFit, sMax), tiled: false, cols: 1, rows: 1 };
  }

  const boxes = bayEls.map(el => {
    const b = elBBox(el);
    return { el, b };
  });

  /* Blätter greedy in Leserichtung füllen (oben-links zuerst).
     Ein starres Raster über die Gesamtausdehnung zu legen wäre einfacher,
     verschwendet bei ring- oder U-förmigen Gerüsten aber massiv Papier: die
     Mitte ist leer, trotzdem entstünde für jede Rasterzelle ein Blatt. Beim
     greedy Füllen wandert stattdessen ein Blattfenster über die tatsächlich
     belegten Bereiche und nimmt jeweils alles mit, was VOLLSTÄNDIG hineinpasst
     – dadurch bleibt garantiert kein Feld angeschnitten, und leere Bereiche
     kosten keine Seite. */
  const w0 = availW / sMin, h0 = availH / sMin;    // Fenster bei Mindestmaßstab
  // Nutzbarer Bereich OHNE den Rand, der rings um den Inhalt frei bleiben soll.
  // Nur so passt später Inhalt + Rand garantiert auf das Blatt; ohne diesen
  // Abzug ragte der Plan um bis zu zwei Randbreiten in die Fußzeile.
  const useW = Math.max(w0 - 2 * pad, w0 * 0.5);
  const useH = Math.max(h0 - 2 * pad, h0 * 0.5);

  const order = boxes.slice().sort((a, b) =>
    (a.b.minY - b.b.minY) || (a.b.minX - b.b.minX));

  const taken  = new Set();
  const groups = [];
  for (const start of order) {
    if (taken.has(start.el)) continue;
    const wx = start.b.minX, wy = start.b.minY;
    const els = [];
    for (const o of order) {
      if (taken.has(o.el)) continue;
      if (o.b.minX >= wx && o.b.maxX <= wx + useW &&
          o.b.minY >= wy && o.b.maxY <= wy + useH) { els.push(o); taken.add(o.el); }
    }
    groups.push(els);
  }

  // Gemeinsamer Maßstab für ALLE Blätter: so groß wie möglich, aber so, dass
  // der Inhalt jedes Blattes noch vollständig passt. Ein einheitlicher Maßstab
  // ist Voraussetzung dafür, dass sich Längen von Blatt zu Blatt vergleichen
  // lassen.
  let maxW = 0, maxH = 0;
  const bbox = g => {
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    g.forEach(o => {
      mnX = Math.min(mnX, o.b.minX); mxX = Math.max(mxX, o.b.maxX);
      mnY = Math.min(mnY, o.b.minY); mxY = Math.max(mxY, o.b.maxY);
    });
    return { minX: mnX, minY: mnY, maxX: mxX, maxY: mxY,
             cx: (mnX + mxX) / 2, cy: (mnY + mxY) / 2 };
  };
  const bbs = groups.map(bbox);
  bbs.forEach(b => {
    maxW = Math.max(maxW, b.maxX - b.minX + 2 * pad);
    maxH = Math.max(maxH, b.maxY - b.minY + 2 * pad);
  });
  const scale = Math.min(sMax,
    Math.max(sMin, Math.min(availW / Math.max(maxW, 1), availH / Math.max(maxH, 1))));
  const winW = availW / scale;
  const winH = availH / scale;

  const pages = groups.map((g, i) => {
    const b   = bbs[i];
    const win = { minX: b.cx - winW / 2, minY: b.cy - winH / 2, w: winW, h: winH };
    // Hüllbox des tatsächlichen Blattinhalts – die Blattübersicht setzt ihre
    // Blattnummer dorthin, wo auch wirklich etwas steht.
    const cbox = { minX: b.minX - pad, minY: b.minY - pad,
                   w: (b.maxX - b.minX) + 2 * pad, h: (b.maxY - b.minY) + 2 * pad };
    const own = new Set(g.map(o => o.el));
    // Anschluss-Felder: liegen sichtbar im Ausschnitt, gehören aber zu einem
    // anderen Blatt – sie werden blass als Kontext gezeichnet.
    const ghosts = boxes.filter(o =>
      !own.has(o.el) &&
      o.b.maxX > win.minX && o.b.minX < win.minX + win.w &&
      o.b.maxY > win.minY && o.b.minY < win.minY + win.h).map(o => o.el);
    return { win, cbox, els: g.map(o => o.el), ghosts };
  });

  return { pages, bounds: full, scale, tiled: true };
}

let pdfBusy    = false;
let pdfLastDone = 0;
const PDF_COOLDOWN_MS = 800;   // Schutz gegen ungeduldiges Doppeltippen

/** Klick-Handler des PDF-Buttons: fragt zuerst das Layout ab. */
function exportPdf() {
  if (pdfBusy || Date.now() - pdfLastDone < PDF_COOLDOWN_MS) return;
  openPdfSheet();
}

/**
 * Einstellblock für die Aufmaßregeln nach ATV DIN 18451. Bewusst im
 * PDF-Dialog: die Regeln wirken ausschließlich auf die Aufmaß-Auswertung im
 * Dokument, nicht auf die Zeichnung. Alle Werte sind frei änderbar – so lassen
 * sich künftige Anpassungen der Aufmaßregeln ohne Codeänderung einpflegen.
 */
function buildAufmassSettings() {
  const wrap = document.createElement('div');
  wrap.className = 'aufmass-settings';

  const lbl = document.createElement('div');
  lbl.className = 'sheet-section-label';
  lbl.textContent = 'Aufmaßregeln (ATV DIN 18451)';
  wrap.appendChild(lbl);

  const base = document.createElement('p');
  base.className = 'pdf-sheet-note';
  base.textContent = 'Grundlage sind immer die Achsmaße der Gerüstkonstruktion – '
                   + 'unabhängig vom Gerüstsystem (5.1.1). Zuschläge werden im PDF '
                   + 'getrennt ausgewiesen; die Zeichnung bleibt maßstäblich.';
  wrap.appendChild(base);

  const r = aufmassRules();
  const summary = document.createElement('div');
  summary.className = 'aufmass-summary';
  const syncSummary = () => {
    // Vorschau über GENAU die Felder, die auch im PDF landen – sonst zeigte der
    // Dialog eine andere Zahl als das Dokument.
    const calc = () => computeAufmass(visibleBaysFlat());
    const m = pdfIncludeHidden ? withHiddenShown(calc) : calc();
    summary.textContent = `Achsmaß ${fmtQty(m.achse)} m`
      + (m.innenLaenge ? `  ${m.innenLaenge < 0 ? '−' : '+'}  ${fmtQty(Math.abs(m.innenLaenge))} m Innenecke` : '')
      + (m.ecken ? `  +  ${m.ecken} × ${fmtQty(eckZuschlagWert())} m Ecke` : '')
      + (m.felder ? `  +  ${m.felder} × ${fmtQty(aufmassRules().feldzuschlag.wert)} m Feld` : '')
      + `  =  Aufmaß ${fmtQty(m.laenge)} m`
      + (m.flaeche ? `  ·  ${fmtQty(m.flaeche)} m²` : '');
    // Unbestätigte Innenecken sichtbar machen: die Zahl steht dann auf einer
    // Annahme, die der Nutzer noch nicht geprüft hat.
    const offen = aufmassRules().innenecke.aktiv ? offeneInnenecken() : [];
    warn.style.display = offen.length ? '' : 'none';
    if (offen.length) {
      warn.textContent = offen.length === 1
        ? 'Eine Innenecke ist noch nicht festgelegt – es gilt der Vorschlag '
          + `„${state.sections[offen[0].durchSi].name} läuft durch". `
          + 'In der Zeichnung auf das „?" tippen, um sie zu bestätigen.'
        : `${offen.length} Innenecken sind noch nicht festgelegt. Es gilt der `
          + 'Vorschlag „längere Achse läuft durch". In der Zeichnung auf das '
          + '„?" tippen, um sie zu bestätigen.';
    }
  };
  // Der Schalter „ausgeblendete mitexportieren" liegt weiter oben im Dialog und
  // zieht die Vorschau hierüber nach.
  wrap._syncSummary = syncSummary;

  const warn = document.createElement('div');
  warn.className = 'aufmass-warn';
  warn.style.display = 'none';

  // ── Außenecke ───────────────────────────────────────────────────────────
  const eckRow = document.createElement('label');
  eckRow.className = 'pdf-opt-row';
  const eckChk = document.createElement('input');
  eckChk.type = 'checkbox'; eckChk.checked = r.eckzuschlag.aktiv;
  const eckTxt = document.createElement('span');
  eckTxt.innerHTML = '<strong>Außenecken beidseitig mitrechnen</strong>'
                   + '<br><span class="pdf-opt-hint">La = L + L1: die überlappende '
                   + 'Ecklänge zählt bei beiden angrenzenden Seiten.</span>';
  eckRow.appendChild(eckChk); eckRow.appendChild(eckTxt);
  wrap.appendChild(eckRow);

  const eckCfg = document.createElement('div');
  eckCfg.className = 'aufmass-cfg-row';
  const eckLab = document.createElement('span');
  eckLab.className = 'aufmass-cfg-label';
  eckLab.textContent = 'Ecklänge je Seite (m)';
  const eckInp = document.createElement('input');
  eckInp.type = 'number'; eckInp.className = 'aufmass-cfg-inp';
  eckInp.min = '0'; eckInp.step = '0.01'; eckInp.inputMode = 'decimal';
  eckInp.placeholder = state.depth.toFixed(2);
  eckInp.title = 'Leer lassen = Gerüsttiefe (' + state.depth.toFixed(2).replace('.', ',') + ' m)';
  eckInp.value = r.eckzuschlag.wert != null ? r.eckzuschlag.wert.toFixed(2) : '';
  eckInp.addEventListener('input', () => {
    const v = parseFloat(eckInp.value);
    state.aufmass.eckzuschlag.wert = (eckInp.value === '' || isNaN(v) || v < 0) ? null : +v.toFixed(2);
    syncSummary(); scheduleAutosave2d();
  });
  eckCfg.appendChild(eckLab); eckCfg.appendChild(eckInp);
  wrap.appendChild(eckCfg);

  const syncEck = () => { eckCfg.style.display = eckChk.checked ? '' : 'none'; };
  eckChk.addEventListener('change', () => {
    state.aufmass.eckzuschlag.aktiv = eckChk.checked;
    syncEck(); syncSummary(); scheduleAutosave2d();
  });
  syncEck();

  // ── Feldzuschlag ────────────────────────────────────────────────────────
  const feldRow = document.createElement('label');
  feldRow.className = 'pdf-opt-row';
  const feldChk = document.createElement('input');
  feldChk.type = 'checkbox'; feldChk.checked = r.feldzuschlag.aktiv;
  const feldTxt = document.createElement('span');
  feldTxt.innerHTML = '<strong>Festen Aufschlag berücksichtigen</strong>'
                    + '<br><span class="pdf-opt-hint">0,80 m je Gerüstfeld, bei kleineren '
                    + 'Systembreiten 0,73 m. Wert und Wirkungsbereich frei wählbar.</span>';
  feldRow.appendChild(feldChk); feldRow.appendChild(feldTxt);
  wrap.appendChild(feldRow);

  const feldCfg = document.createElement('div');
  feldCfg.className = 'aufmass-cfg-block';

  const valRow = document.createElement('div');
  valRow.className = 'aufmass-cfg-row';
  const valLab = document.createElement('span');
  valLab.className = 'aufmass-cfg-label';
  valLab.textContent = 'Aufschlag (m)';
  const valInp = document.createElement('input');
  valInp.type = 'number'; valInp.className = 'aufmass-cfg-inp';
  valInp.min = '0'; valInp.step = '0.01'; valInp.inputMode = 'decimal';
  valInp.value = r.feldzuschlag.wert.toFixed(2);
  valInp.addEventListener('input', () => {
    const v = parseFloat(valInp.value);
    if (!isNaN(v) && v >= 0) {
      state.aufmass.feldzuschlag.wert = +v.toFixed(2);
      presetRow.querySelectorAll('.aufmass-preset').forEach(b =>
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.v) - v) < 0.005));
      syncSummary(); scheduleAutosave2d();
    }
  });
  valRow.appendChild(valLab); valRow.appendChild(valInp);
  feldCfg.appendChild(valRow);

  const presetRow = document.createElement('div');
  presetRow.className = 'aufmass-preset-row';
  AUFMASS_FELD_PRESETS.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aufmass-preset' + (Math.abs(r.feldzuschlag.wert - v) < 0.005 ? ' active' : '');
    b.dataset.v = String(v);
    b.textContent = v.toFixed(2).replace('.', ',') + ' m';
    b.addEventListener('click', () => {
      state.aufmass.feldzuschlag.wert = v;
      valInp.value = v.toFixed(2);
      presetRow.querySelectorAll('.aufmass-preset').forEach(x => x.classList.toggle('active', x === b));
      syncSummary(); scheduleAutosave2d();
    });
    presetRow.appendChild(b);
  });
  feldCfg.appendChild(presetRow);

  const modeRow = document.createElement('div');
  modeRow.className = 'aufmass-preset-row';
  AUFMASS_MODI.forEach(([key, label, desc]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aufmass-preset' + (r.feldzuschlag.modus === key ? ' active' : '');
    b.textContent = label;
    b.title = desc;
    b.addEventListener('click', () => {
      state.aufmass.feldzuschlag.modus = key;
      modeRow.querySelectorAll('.aufmass-preset').forEach(x => x.classList.toggle('active', x === b));
      syncSummary(); scheduleAutosave2d();
    });
    modeRow.appendChild(b);
  });
  feldCfg.appendChild(modeRow);
  wrap.appendChild(feldCfg);

  const syncFeld = () => { feldCfg.style.display = feldChk.checked ? '' : 'none'; };
  feldChk.addEventListener('change', () => {
    state.aufmass.feldzuschlag.aktiv = feldChk.checked;
    syncFeld(); syncSummary(); scheduleAutosave2d();
  });
  syncFeld();

  syncSummary();
  // ── Innenecke ───────────────────────────────────────────────────────────
  // Steht bewusst NACH den beiden Zuschlägen: die sind Aufschläge auf das
  // Aufmaß, dies hier ist eine Korrektur, die nur umverteilt.
  const innRow = document.createElement('label');
  innRow.className = 'pdf-opt-row';
  const innChk = document.createElement('input');
  innChk.type = 'checkbox'; innChk.checked = r.innenecke.aktiv;
  const innTxt = document.createElement('span');
  innTxt.innerHTML = '<strong>Innenecken verrechnen</strong>'
                   + '<br><span class="pdf-opt-hint">An einer Innenecke überlappen '
                   + 'sich beide Bahnen. Die durchlaufende Achse wird am letzten '
                   + 'Feld vor der Ecke gekürzt, die ausfüllende um denselben Wert '
                   + 'verlängert – in der Summe neutral.</span>';
  innRow.appendChild(innChk); innRow.appendChild(innTxt);
  wrap.appendChild(innRow);

  const innCfg = document.createElement('div');
  innCfg.className = 'aufmass-cfg-row aufmass-cfg-innen';
  const innLab = document.createElement('span');
  innLab.className = 'aufmass-cfg-label';
  innLab.textContent = 'Ecklänge (m)';
  const innInp = document.createElement('input');
  innInp.type = 'number'; innInp.className = 'aufmass-cfg-inp';
  innInp.min = '0'; innInp.step = '0.01'; innInp.inputMode = 'decimal';
  innInp.placeholder = state.depth.toFixed(2);
  innInp.title = 'Leer lassen = Gerüsttiefe (' + state.depth.toFixed(2).replace('.', ',') + ' m)';
  innInp.value = r.innenecke.wert != null ? r.innenecke.wert.toFixed(2) : '';
  innInp.addEventListener('input', () => {
    const v = parseFloat(innInp.value);
    state.aufmass.innenecke.wert = (innInp.value === '' || isNaN(v) || v < 0) ? null : +v.toFixed(2);
    syncSummary(); scheduleAutosave2d();
  });
  innCfg.appendChild(innLab); innCfg.appendChild(innInp);
  wrap.appendChild(innCfg);

  const syncInn = () => { innCfg.style.display = innChk.checked ? '' : 'none'; };
  innChk.addEventListener('change', () => {
    state.aufmass.innenecke.aktiv = innChk.checked;
    syncInn(); syncSummary(); scheduleAutosave2d(); renderAll();
  });
  syncInn();

  wrap.appendChild(summary);
  wrap.appendChild(warn);
  return wrap;
}

/** Auswahl des PDF-Layouts. Die zuletzt gewählte Variante ist vorausgewählt,
 *  ein Tipp auf „PDF erstellen" genügt also im Alltag. */
function openPdfSheet() {
  closeSheet();
  let chosen = pdfThemeName();

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  const hdr = document.createElement('div');
  hdr.className = 'sheet-header';
  hdr.textContent = 'PDF erstellen';
  sheet.appendChild(hdr);

  const lbl = document.createElement('div');
  lbl.className = 'sheet-section-label';
  lbl.textContent = 'Layout';
  sheet.appendChild(lbl);

  const list = document.createElement('div');
  list.className = 'pdf-theme-list';
  const cards = {};
  Object.entries(PDF_THEMES).forEach(([key, t]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pdf-theme-card' + (key === chosen ? ' active' : '');

    const prev = document.createElement('span');
    prev.className = 'pdf-theme-prev pdf-theme-prev--' + key;
    prev.setAttribute('aria-hidden', 'true');
    prev.innerHTML = '<i class="ptp-band"></i><i class="ptp-l ptp-l1"></i>'
                   + '<i class="ptp-l ptp-l2"></i><i class="ptp-l ptp-l3"></i>';

    const name = document.createElement('span');
    name.className = 'pdf-theme-name';
    name.textContent = t.label;

    const desc = document.createElement('span');
    desc.className = 'pdf-theme-desc';
    desc.textContent = t.desc;

    card.appendChild(prev); card.appendChild(name); card.appendChild(desc);
    card.addEventListener('click', () => {
      chosen = key;
      Object.entries(cards).forEach(([k, c]) => c.classList.toggle('active', k === key));
    });
    cards[key] = card;
    list.appendChild(card);
  });
  sheet.appendChild(list);

  const note = document.createElement('p');
  note.className = 'pdf-sheet-note';
  note.textContent = 'Passt der Plan nicht auf ein Blatt, wird er automatisch auf mehrere '
                   + 'Blätter im gleichen Maßstab aufgeteilt – mit Blattübersicht, '
                   + 'wiederholter Kopfzeile und Legende auf jeder Seite.';
  sheet.appendChild(note);

  // ── Ausgeblendete Abschnitte ────────────────────────────────────────────
  const nHiddenGroups = hiddenGroupCount();
  if (nHiddenGroups) {
    const hLbl = document.createElement('div');
    hLbl.className = 'sheet-section-label';
    hLbl.textContent = 'Ausgeblendete Abschnitte';
    sheet.appendChild(hLbl);

    const hRow = document.createElement('label');
    hRow.className = 'pdf-opt-row';
    const hChk = document.createElement('input');
    hChk.type = 'checkbox';
    hChk.checked = pdfIncludeHidden;
    hChk.addEventListener('change', () => {
      pdfIncludeHidden = hChk.checked;
      localStorage.setItem(PDF_HIDDEN_KEY, pdfIncludeHidden ? '1' : '0');
      // Die Aufmaß-Vorschau rechnet über den Export-Umfang → mitziehen.
      const box = sheet.querySelector('.aufmass-settings');
      if (box && box._syncSummary) box._syncSummary();
    });
    const hTxt = document.createElement('span');
    hTxt.innerHTML = `<strong>Ausgeblendete Abschnitte mitexportieren</strong>`
                   + `<br><span class="pdf-opt-hint">${nHiddenGroups} Abschnitt`
                   + `${nHiddenGroups === 1 ? '' : 'e'} ausgeblendet. Standard: nur sichtbare `
                   + `Abschnitte kommen in Plan und Tabellen.</span>`;
    hRow.appendChild(hChk); hRow.appendChild(hTxt);
    sheet.appendChild(hRow);
  }

  // ── Aufmaßregeln (ATV DIN 18451) ────────────────────────────────────────
  sheet.appendChild(buildAufmassSettings());

  const actRow = document.createElement('div');
  actRow.className = 'sheet-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'sheet-del';
  cancel.textContent = 'Abbrechen';
  cancel.addEventListener('click', closeSheet);

  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'sheet-ok';
  ok.textContent = 'PDF erstellen';
  ok.addEventListener('click', () => {
    localStorage.setItem(PDF_THEME_KEY, chosen);
    closeSheet();
    runPdfExport(chosen);
  });

  actRow.appendChild(cancel); actRow.appendChild(ok);
  sheet.appendChild(actRow);

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}

/** Erzeugt genau eine PDF; weitere Klicks währenddessen laufen ins Leere. */
async function runPdfExport(themeName) {
  if (pdfBusy || Date.now() - pdfLastDone < PDF_COOLDOWN_MS) return;
  pdfBusy = true;
  const btn      = document.getElementById('exportPdfBtn');
  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'PDF wird erstellt …'; }
  // Ausstehende Zeichenarbeit zuerst erledigen, damit die PDF garantiert den
  // aktuellen Stand zeigt.
  flushRender();
  // Ein Frame Pause, damit der Button-Zustand sichtbar wird, bevor der
  // (synchrone) Aufbau der PDF startet.
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    await buildPdf(themeName);
  } catch (err) {
    console.error('PDF-Export fehlgeschlagen:', err);
    showToast('PDF konnte nicht erstellt werden.');
  } finally {
    pdfBusy     = false;
    pdfLastDone = Date.now();
    if (btn) { btn.disabled = false; btn.textContent = prevText; }
  }
}
/**
 * PDF erzeugen. Standardregel: Es werden NUR SICHTBARE Abschnitte exportiert –
 * was auf der Zeichenfläche ausgeblendet ist, steht auch nicht im Plan und in
 * den Tabellen. Über den Schalter im PDF-Dialog (`pdfIncludeHidden`) lässt sich
 * das je Export umstellen, ohne die Ansicht anzufassen.
 */
async function buildPdf(themeName, opts = {}) {
  const includeHidden = opts.includeHidden != null ? opts.includeHidden : pdfIncludeHidden;
  const prevIgnore = ignoreHidden;
  ignoreHidden = !!includeHidden;
  invalidateViewCaches();
  try {
    return await buildPdfDocument(themeName);
  } finally {
    ignoreHidden = prevIgnore;
    invalidateViewCaches();
  }
}

async function buildPdfDocument(themeName) {
  const { jsPDF } = window.jspdf;
  const theme  = PDF_THEMES[themeName] || PDF_THEMES[pdfThemeName()];
  const layout = computeLayout();
  const margin = PDF_MARGIN;

  // Nutzbare Fläche einer PLANSEITE = Blatt − Rand − Kopf − Legende − Fuß.
  // Muss EXAKT der später gezeichneten Fläche entsprechen (siehe `area` weiter
  // unten), sonst rechnet die Seitenaufteilung mit mehr Platz, als beim
  // Zeichnen zur Verfügung steht, und der Plan läuft in die Fußzeile.
  const PLAN_GAP = 2;   // Luft zwischen Legende/Fußzeile und Zeichnung
  const chromeH = PDF_HEADER_H + PDF_LEGEND_H + 2.5 + PLAN_GAP + PDF_FOOTER_H;

  // Hoch- oder Querformat? Es gewinnt die Ausrichtung, die bei lesbarem
  // Mindestmaßstab mit WENIGER Planseiten auskommt (bei Gleichstand die mit
  // dem größeren Maßstab) – lange Fassaden landen so im Querformat.
  const cand = ['landscape', 'portrait'].map(o => {
    const w = o === 'landscape' ? 297 : 210;
    const h = o === 'landscape' ? 210 : 297;
    return { orient: o, pdfW: w, pdfH: h,
             plan: pdfPlanPages(layout, w - 2 * margin, h - 2 * margin - chromeH) };
  }).sort((a, b) => (a.plan.pages.length - b.plan.pages.length) || (b.plan.scale - a.plan.scale));

  const { orient, pdfW, pdfH, plan } = cand[0];
  const doc    = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4', compress: true });
  const availW = pdfW - 2 * margin;

  // Exportiert wird die Feldmenge, die auch gezeichnet wird (siehe buildPdf:
  // ausgeblendete Abschnitte sind je nach Schalter enthalten oder nicht).
  const allBays      = visibleBaysFlat();
  const totalLen     = allBays.reduce((a, b) => a + b.len, 0);
  const totalFlaeche = sumFlaecheM2(allBays);
  const aufmassAll   = computeAufmass(allBays);
  const nHiddenBays  = allBaysFlat().length - allBays.length;
  const dateStr      = new Date().toLocaleDateString('de-DE');
  const title        = state.project || 'Gerüst 2D-Ansicht';

  // Gemeinsamer Zeichen-Kontext für Kopf-/Fußzeile und Legende.
  const ctx = {
    doc, theme, pdfW, pdfH, margin, title, dateStr,
    subtitle: `${allBays.length} Feld${allBays.length === 1 ? '' : 'er'}   ·   `
            + `Gerüsttiefe ${state.depth.toFixed(2).replace('.', ',')} m`
            + (nHiddenBays ? `   ·   ${nHiddenBays} Feld${nHiddenBays === 1 ? '' : 'er'} ausgeblendet (nicht enthalten)` : ''),
    metaLine: `Achsmaß ${fmtQty(totalLen)} m   ·   Gerüstfläche ${fmtQty(totalFlaeche)} m²`
            + (aufmassAktiv() ? `   ·   Aufmaß ${fmtQty(aufmassAll.laenge)} m / ${fmtQty(aufmassAll.flaeche)} m²` : '')
            + `   ·   Gerüsttiefe ${state.depth.toFixed(2).replace('.', ',')} m`
  };

  const legend  = pdfLegendEntries();
  const contentBottom = pdfH - margin - PDF_FOOTER_H;

  // Seitenbuchhaltung: jede Seite bekommt am Ende ihre Fußzeile mit der
  // endgültigen Gesamtzahl (die steht erst fest, wenn alles gezeichnet ist).
  let firstPage = true;
  /** Neue Seite beginnen (die erste Seite existiert bereits) + Kopfzeile.
   *  @returns {number} Oberkante des freien Inhaltsbereichs (mm) */
  const startPage = (opts = {}) => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    return pdfDrawHeader(ctx, opts);
  };

  // ── Planseiten ──────────────────────────────────────────────────────────
  if (!plan.pages.length) {
    const top = startPage({ kicker: 'Gerüst-Aufmaß' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    doc.setTextColor(...theme.inkSoft);
    doc.text('Keine Gerüstfelder erfasst.', margin, top + 10);
  } else {
    const scaleTxt = 'Maßstab ca. 1:' + Math.round(10 / plan.scale);

    // Bei mehrseitigem Plan zuerst eine Übersichtsseite mit der Blatteinteilung –
    // sie zeigt, welcher Ausschnitt auf welchem Blatt steht.
    if (plan.tiled) {
      const oTop  = startPage({ kicker: 'Blattübersicht',
                                sheet: `Plan auf ${plan.pages.length} Blättern` });
      // Platz für die Erläuterungszeile unten – aus der TATSÄCHLICHEN Zeilenzahl
      // abgeleitet, damit die Übersicht sie nie überdeckt.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
      const oCaption = doc.splitTextToSize(
        `${plan.pages.length} Planblätter   ·   ${scaleTxt} auf allen Blättern   ·   `
        + `gestrichelt: Blattgrenzen   ·   Anschlussfelder der Nachbarblätter sind auf den `
        + `Planblättern blassgrau dargestellt`, availW);
      const legendH = 3 + oCaption.length * 3.4;
      const oArea = { x: margin, y: oTop + 2, w: availW,
                      h: contentBottom - oTop - 4 - legendH };
      // Maßstab der Übersicht aus der Hülle ALLER Blattfenster ableiten (nicht
      // nur aus dem Inhalt) – sonst ragen die Blattrahmen über den Rand.
      const oWin = plan.pages.reduce((acc, pg) => ({
        minX: Math.min(acc.minX, pg.win.minX), minY: Math.min(acc.minY, pg.win.minY),
        maxX: Math.max(acc.maxX, pg.win.minX + pg.win.w),
        maxY: Math.max(acc.maxY, pg.win.minY + pg.win.h)
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      oWin.w = oWin.maxX - oWin.minX; oWin.h = oWin.maxY - oWin.minY;
      const oScale = Math.min(oArea.w / oWin.w, oArea.h / oWin.h);
      pdfDrawPlan(doc, oWin, oArea, oScale, plan.pages.flatMap(p => p.els), layout, true, { theme });

      const ox = oArea.x + (oArea.w - oWin.w * oScale) / 2 - oWin.minX * oScale;
      const oy = oArea.y + (oArea.h - oWin.h * oScale) / 2 - oWin.minY * oScale;
      doc.setDrawColor(...theme.accent); doc.setLineWidth(0.3);
      doc.setLineDashPattern([1.2, 1.0], 0);
      plan.pages.forEach(pg => {
        doc.rect(ox + pg.win.minX * oScale, oy + pg.win.minY * oScale,
                 pg.win.w * oScale, pg.win.h * oScale, 'S');
      });
      doc.setLineDashPattern([], 0);
      // Blattnummer dorthin, wo auf dem Blatt tatsächlich Felder stehen –
      // die Blattfenster überlappen sich, die Inhalte nicht.
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      plan.pages.forEach((pg, i) => {
        const bx = ox + (pg.cbox.minX + pg.cbox.w / 2) * oScale;
        const by = oy + (pg.cbox.minY + pg.cbox.h / 2) * oScale;
        doc.setFillColor(...theme.accent);
        doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.4);
        doc.circle(bx, by, 3.1, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.text('B' + (i + 1), bx, by, { align: 'center', baseline: 'middle' });
      });
      // Erläuterungszeile (oben bereits umbrochen) – sie wächst nach OBEN,
      // damit sie die Fußzeile nie berührt.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
      doc.setTextColor(...theme.inkSoft);
      oCaption.forEach((line, li) => {
        doc.text(line, margin, contentBottom - 1.5 - (oCaption.length - 1 - li) * 3.4);
      });
    }

    plan.pages.forEach((pg, i) => {
      const sheet = plan.tiled
        ? `Planblatt B${i + 1} von ${plan.pages.length}   ·   ${scaleTxt}`
        : scaleTxt;
      let top = startPage({ kicker: 'Grundriss', sheet });
      top = pdfDrawLegend(ctx, top, legend);

      const area = { x: margin, y: top, w: availW, h: contentBottom - top - PLAN_GAP };
      // Die Mini-Orientierungskarte ist eine Sperrzone: pdfDrawPlan platziert
      // sie selbst (dort sind die Beschriftungen bekannt), hält sie frei und
      // zeichnet sie zum Schluss darüber.
      const lw = Math.min(58, availW * 0.30);
      pdfDrawPlan(doc, pg.win, area, plan.scale, pg.els, layout, false, {
        theme, ghosts: pg.ghosts,
        locator: plan.tiled
          ? { w: lw, h: lw * 0.62, bounds: plan.bounds,
              caption: `LAGE IM GESAMTPLAN · BLATT B${i + 1}` }
          : null
      });
    });
  }

  /* ── Aufmaß nach ATV DIN 18451 ──────────────────────────────────────────
     Rechenweg statt Ergebnis: je Abschnitt wird das Achsmaß, der Eckzuschlag
     und der Feldzuschlag getrennt ausgewiesen, damit die Aufmaßlänge im
     Streitfall Zeile für Zeile nachvollziehbar ist. Welche Zuschläge gelten,
     stellt der Nutzer im PDF-Dialog ein (siehe aufmassRules()).           */
  if (allBays.length) {
    const groups = abschnitteList().length
      ? baysByAbschnitt().map(g => ({
          title: g.abschnitt ? g.abschnitt.name : 'Ohne Abschnitt',
          color: g.abschnitt ? pdfHex(g.abschnitt.color) : null,
          bays: g.bays
        }))
      : SIDE_ORDER.map(side => ({ title: SIDE_LABEL[side], color: null, bays: fieldsBySide()[side] }))
                  .filter(b => b.bays.length);

    const aCols = [
      { t: 'Abschnitt',      w: 0.22, a: 'left'   },
      { t: 'Felder',         w: 0.07, a: 'center' },
      { t: 'Achsmaß',        w: 0.12, a: 'right'  },
      { t: 'Innenecke',      w: 0.13, a: 'right'  },
      { t: 'Eckzuschlag',    w: 0.14, a: 'right'  },
      { t: 'Feldzuschlag',   w: 0.13, a: 'right'  },
      { t: 'Aufmaßlänge',    w: 0.10, a: 'right'  },
      { t: 'Aufmaßfläche',   w: 0.09, a: 'right'  }
    ];
    const aW = availW;
    const aX = []; let aAcc = margin;
    aCols.forEach(c => { aX.push(aAcc); aAcc += c.w * aW; });
    const aCell = (i, txt, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const c = aCols[i];
      const x = c.a === 'right' ? aX[i] + c.w * aW - 2.5
              : c.a === 'center' ? aX[i] + c.w * aW / 2
              : aX[i] + 2.5;
      doc.text(txt, x, ay + 5, { align: c.a });
    };
    const aRowH = 7.2, aHeadH = 7.5;

    let ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'nach ATV DIN 18451' }) + 3;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4);
    doc.setTextColor(...theme.inkSoft);
    doc.splitTextToSize('Grundlage: ' + aufmassRuleText(), aW).forEach(line => {
      doc.text(line, margin, ay + 3);
      ay += 4.4;
    });
    ay += 2.5;

    const aDrawHead = () => {
      doc.setFillColor(...theme.tableHead);
      doc.rect(margin, ay, aW, aHeadH, 'F');
      doc.setFontSize(7.8); doc.setTextColor(...theme.tableHeadText);
      aCols.forEach((c, i) => aCell(i, c.t, true));
      ay += aHeadH;
    };
    aDrawHead();

    const aDrawRow = (label, color, m, shade, bold) => {
      if (ay + aRowH > contentBottom) {
        ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'Fortsetzung' }) + 3;
        aDrawHead();
      }
      if (shade) { doc.setFillColor(...theme.zebra); doc.rect(margin, ay, aW, aRowH, 'F'); }
      if (bold)  { doc.setFillColor(...theme.tableHead); doc.rect(margin, ay, aW, aRowH, 'F'); }
      if (color) {
        const sw = pdfCol(theme, color);
        doc.setFillColor(...sw); doc.setDrawColor(...sw); doc.setLineWidth(0.2);
        doc.rect(aX[0] + 1.6, ay + aRowH / 2 - 1.8, 3.6, 3.6, 'FD');
      }
      doc.setFontSize(8.6); doc.setTextColor(...theme.ink);
      const labelX = color ? 6.6 : 2.5;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(label, aX[0] + labelX, ay + 5);
      aCell(1, String(m.count), bold);
      aCell(2, fmtQty(m.achse) + ' m', bold);
      // Innenecke: Vorzeichen ist die Aussage. „± 0,00" statt „–" zeigt, dass
      // sich die Korrektur innerhalb dieser Zeile aufhebt (beide Achsen der
      // Ecke liegen im selben Abschnitt) – das ist etwas anderes als „keine
      // Innenecke vorhanden".
      aCell(3, m.innenecken
        ? (m.innenLaenge === 0 ? '± 0,00 m'
           : (m.innenLaenge < 0 ? '− ' : '+ ') + fmtQty(Math.abs(m.innenLaenge)) + ' m')
        : '–', bold);
      aCell(4, m.ecken ? `${m.ecken} × ${fmtQty(eckZuschlagWert())} = ${fmtQty(m.eckLaenge)} m` : '–', bold);
      aCell(5, m.felder ? `${m.felder} × ${fmtQty(aufmassRules().feldzuschlag.wert)} = ${fmtQty(m.feldLaenge)} m` : '–', bold);
      doc.setFont('helvetica', 'bold');
      doc.text(fmtQty(m.laenge) + ' m', aX[6] + aCols[6].w * aW - 2.5, ay + 5, { align: 'right' });
      doc.text(m.flaeche ? fmtQty(m.flaeche) + ' m²' : '–',
               aX[7] + aCols[7].w * aW - 2.5, ay + 5, { align: 'right' });
      ay += aRowH;
      doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
      doc.line(margin, ay, margin + aW, ay);
    };

    groups.forEach((g, i) => {
      const m = computeAufmass(g.bays);
      aDrawRow(g.title, g.color, { ...m, count: g.bays.length }, i % 2 === 1, false);
    });
    aDrawRow('Gesamt', null, { ...aufmassAll, count: allBays.length }, false, true);

    // Bei Abschnitts-Gliederung: Hinweis, dass eine Ecke bei BEIDEN
    // angrenzenden Abschnitten zählt – sonst wirkt die Summe fehlerhaft.
    const fuss = [];
    if (aufmassRules().eckzuschlag.aktiv) {
      fuss.push('Außenecken werden nach DIN 18451 bei beiden angrenzenden Seiten '
              + 'mitgerechnet (La = L + L1); eine Ecke erscheint daher in zwei Zeilen.');
    }
    if (aufmassRules().innenecke.aktiv) {
      fuss.push('An Innenecken überlappen sich die Bahnen: die durchlaufende Achse '
              + `wird um ${fmtQty(innenEckWert())} m gekürzt, die ausfüllende um `
              + 'denselben Wert verlängert. Über beide Achsen zusammen ist die '
              + 'Innenecke damit neutral.');
    }
    if (fuss.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
      doc.setTextColor(...theme.inkSoft);
      let fy = ay + 5;
      fuss.forEach(txt => {
        doc.splitTextToSize(txt, aW).forEach(line => { doc.text(line, margin, fy); fy += 3.6; });
        fy += 1;
      });
      ay = fy;
    }

    // ── Aufstellung je ACHSE ────────────────────────────────────────────────
    // Die Innenecken-Regel greift feldgenau („letztes Feld vor der Ecke"),
    // deshalb wird der Rechenweg hier Feld für Feld ausgeschrieben. Erst das
    // macht auf der Baustelle nachvollziehbar, warum eine Achse kürzer ist als
    // die Summe ihrer Felder.
    const achsen = aufmassAchsen();
    if (achsen.length) {
      const kCols = [
        { t: 'Achse',        w: 0.16, a: 'left'   },
        { t: 'Felder',       w: 0.07, a: 'center' },
        { t: 'Rechenweg (Feldlängen inkl. Eckanpassung)', w: 0.47, a: 'left' },
        { t: 'Rolle an der Ecke', w: 0.17, a: 'left' },
        { t: 'Aufmaßlänge',  w: 0.13, a: 'right'  }
      ];
      const kX = []; let kAcc = margin;
      kCols.forEach(c => { kX.push(kAcc); kAcc += c.w * aW; });
      const kCell = (i, txt, bold, y) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const c = kCols[i];
        const x = c.a === 'right' ? kX[i] + c.w * aW - 2.5
                : c.a === 'center' ? kX[i] + c.w * aW / 2
                : kX[i] + 2.5;
        doc.text(txt, x, y, { align: c.a });
      };

      if (ay + 26 > contentBottom) {
        ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'je Achse' }) + 3;
      } else {
        ay += 4;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(...theme.ink);
      doc.text('Aufmaß je Achse', margin, ay + 4);
      ay += 7;

      const kDrawHead = () => {
        doc.setFillColor(...theme.tableHead);
        doc.rect(margin, ay, aW, aHeadH, 'F');
        doc.setFontSize(7.8); doc.setTextColor(...theme.tableHeadText);
        kCols.forEach((c, i) => kCell(i, c.t, true, ay + 5));
        ay += aHeadH;
      };
      kDrawHead();

      achsen.forEach((a, i) => {
        // Lange Rechenwege umbrechen, damit nichts über die Spalte hinausläuft.
        const wegLines = doc.splitTextToSize(a.rechenweg, kCols[2].w * aW - 5);
        const rowH = Math.max(aRowH, 3.1 + wegLines.length * 3.6);
        if (ay + rowH > contentBottom) {
          ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'je Achse (Fortsetzung)' }) + 3;
          kDrawHead();
        }
        if (i % 2 === 1) { doc.setFillColor(...theme.zebra); doc.rect(margin, ay, aW, rowH, 'F'); }
        doc.setFontSize(8.6); doc.setTextColor(...theme.ink);
        kCell(0, a.name, false, ay + 5);
        kCell(1, String(a.bays.length), false, ay + 5);
        doc.setFont('helvetica', 'normal');
        wegLines.forEach((line, li) => doc.text(line, kX[2] + 2.5, ay + 5 + li * 3.6));
        const rolle = a.rollen.length
          ? [...new Set(a.rollen)].join(', ')
          : (a.m.ecken ? 'Außenecke' : '–');
        kCell(3, rolle, false, ay + 5);
        doc.setFont('helvetica', 'bold');
        doc.text(fmtQty(a.m.laenge) + ' m', kX[4] + kCols[4].w * aW - 2.5, ay + 5, { align: 'right' });
        ay += rowH;
        doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
        doc.line(margin, ay, margin + aW, ay);
      });
    }

    /* ── Bordbretter-Linien ──────────────────────────────────────────────
       Beleg für die Eckenkorrektur: Welche Linie wurde gezeichnet, zu welcher
       Achse gehört sie, welche Ecke ergibt sich daraus und mit welchem Wert
       geht sie ins Aufmaß ein.                                            */
    const bbAufstellung = bordbretterAufstellung();
    if (bbAufstellung.length) {
      const bCols = [
        { t: 'Bordbretter-Linie', w: 0.17, a: 'left'  },
        { t: 'Achse',             w: 0.17, a: 'left'  },
        { t: 'gezeichnet',        w: 0.11, a: 'right' },
        { t: 'erkannte Ecken',    w: 0.32, a: 'left'  },
        { t: 'Korrektur',         w: 0.11, a: 'right' },
        { t: 'Aufmaßlänge',       w: 0.12, a: 'right' }
      ];
      const bX = []; let bAcc = margin;
      bCols.forEach(c => { bX.push(bAcc); bAcc += c.w * aW; });
      const bCell = (i, txt, bold, y) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const c = bCols[i];
        const x = c.a === 'right' ? bX[i] + c.w * aW - 2.5
                : c.a === 'center' ? bX[i] + c.w * aW / 2
                : bX[i] + 2.5;
        doc.text(txt, x, y, { align: c.a });
      };

      if (ay + 26 > contentBottom) {
        ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'Bordbretter' }) + 3;
      } else {
        ay += 4;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(...theme.ink);
      doc.text('Bordbretter-Linien und Eckenkorrektur', margin, ay + 4);
      ay += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
      doc.setTextColor(...theme.inkSoft);
      doc.splitTextToSize(
        'Die Linien folgen der Kante der Gerüstlage (Bordbretter). Wo eine Linie '
        + 'um eine Außenecke herumläuft, wird das Feld an der Ecke um die '
        + `Gerüsttiefe (${fmtQty(state.depth)} m) verlängert; wo sie an einer `
        + 'Innenecke früher endet, wird das letzte Feld vor der Ecke um denselben '
        + 'Wert gekürzt und die ausfüllende Achse entsprechend verlängert.', aW)
        .forEach(line => { doc.text(line, margin, ay + 3); ay += 3.6; });
      ay += 2;

      const bDrawHead = () => {
        doc.setFillColor(...theme.tableHead);
        doc.rect(margin, ay, aW, aHeadH, 'F');
        doc.setFontSize(7.8); doc.setTextColor(...theme.tableHeadText);
        bCols.forEach((c, i) => bCell(i, c.t, true, ay + 5));
        ay += aHeadH;
      };
      bDrawHead();

      bbAufstellung.forEach((b, i) => {
        const txt = [...b.ecken, ...b.hinweise];
        const eckLines = doc.splitTextToSize(txt.length ? txt.join(';  ') : '–',
                                             bCols[3].w * aW - 5);
        const rowH = Math.max(aRowH, 3.1 + eckLines.length * 3.6);
        if (ay + rowH > contentBottom) {
          ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'Bordbretter (Fortsetzung)' }) + 3;
          bDrawHead();
        }
        if (i % 2 === 1) { doc.setFillColor(...theme.zebra); doc.rect(margin, ay, aW, rowH, 'F'); }
        doc.setFontSize(8.6); doc.setTextColor(...theme.ink);
        bCell(0, b.name, false, ay + 5);
        bCell(1, b.achse || 'nicht zugeordnet', false, ay + 5);
        bCell(2, fmtQty(b.laenge) + ' m', false, ay + 5);
        doc.setFont('helvetica', 'normal');
        eckLines.forEach((line, li) => doc.text(line, bX[3] + 2.5, ay + 5 + li * 3.6));
        bCell(4, b.korrektur
          ? (b.korrektur < 0 ? '− ' : '+ ') + fmtQty(Math.abs(b.korrektur)) + ' m'
          : '–', false, ay + 5);
        doc.setFont('helvetica', 'bold');
        doc.text(b.aufmass != null ? fmtQty(b.aufmass) + ' m' : '–',
                 bX[5] + bCols[5].w * aW - 2.5, ay + 5, { align: 'right' });
        ay += rowH;
        doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
        doc.line(margin, ay, margin + aW, ay);
      });
    }

    /* ── Aufmaß nach Gerüsthöhen ─────────────────────────────────────────
       Auf einer Seite stehen häufig unterschiedlich hohe Gerüste. Die Felder
       werden dann je Höhe getrennt zusammengefasst – „12,85 m × 10,20 m" und
       „12,85 m × 8,20 m" statt einer Mischzahl, die niemand nachrechnen kann.
       Die Tabelle erscheint nur, wenn es tatsächlich mehrere Höhen gibt.   */
    const korrH = eckKorrekturen();
    const hoehenBloecke = groups
      .map(g => ({ ...g, hoehen: aufmassNachHoehe(g.bays, korrH) }))
      .filter(g => g.bays.length);
    if (hoehenBloecke.some(g => g.hoehen.length > 1)) {
      const hCols = [
        { t: 'Abschnitt / Seite', w: 0.28, a: 'left'   },
        { t: 'Gerüsthöhe',        w: 0.14, a: 'right'  },
        { t: 'Felder',            w: 0.09, a: 'center' },
        { t: 'Länge',             w: 0.14, a: 'right'  },
        { t: 'Aufmaß (L × H)',    w: 0.35, a: 'right'  }
      ];
      const hX = []; let hAcc = margin;
      hCols.forEach(c => { hX.push(hAcc); hAcc += c.w * aW; });
      const hCell = (i, txt, bold, y) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const c = hCols[i];
        const x = c.a === 'right' ? hX[i] + c.w * aW - 2.5
                : c.a === 'center' ? hX[i] + c.w * aW / 2
                : hX[i] + 2.5;
        doc.text(txt, x, y, { align: c.a });
      };

      if (ay + 30 > contentBottom) {
        ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'nach Gerüsthöhen' }) + 3;
      } else {
        ay += 5;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(...theme.ink);
      doc.text('Aufmaß nach Gerüsthöhen', margin, ay + 4);
      ay += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
      doc.setTextColor(...theme.inkSoft);
      doc.splitTextToSize(
        'Felder gleicher Gerüsthöhe sind je Abschnitt bzw. Seite getrennt '
        + 'zusammengefasst. Die Länge enthält die Eckenkorrekturen; die Höhe ist '
        + 'die kleinere der beiden am Feld eingetragenen Höhen.', aW)
        .forEach(line => { doc.text(line, margin, ay + 3); ay += 3.6; });
      ay += 2;

      const hDrawHead = () => {
        doc.setFillColor(...theme.tableHead);
        doc.rect(margin, ay, aW, aHeadH, 'F');
        doc.setFontSize(7.8); doc.setTextColor(...theme.tableHeadText);
        hCols.forEach((c, i) => hCell(i, c.t, true, ay + 5));
        ay += aHeadH;
      };
      hDrawHead();

      hoehenBloecke.forEach(g => {
        g.hoehen.forEach((h, i) => {
          if (ay + aRowH > contentBottom) {
            ay = startPage({ kicker: 'Aufmaß-Ermittlung', sheet: 'nach Gerüsthöhen (Fortsetzung)' }) + 3;
            hDrawHead();
          }
          if (i % 2 === 1) { doc.setFillColor(...theme.zebra); doc.rect(margin, ay, aW, aRowH, 'F'); }
          doc.setFontSize(8.6); doc.setTextColor(...theme.ink);
          hCell(0, i === 0 ? g.title : '', i === 0, ay + 5);
          hCell(1, h.hoehe != null ? fmtQty(h.hoehe) + ' m' : 'ohne Höhe', false, ay + 5);
          hCell(2, String(h.felder), false, ay + 5);
          hCell(3, fmtQty(h.laenge) + ' m', false, ay + 5);
          doc.setFont('helvetica', 'bold');
          doc.text(h.hoehe != null
            ? `${fmtQty(h.laenge)} m × ${fmtQty(h.hoehe)} m = ${fmtQty(h.flaeche)} m²`
            : 'keine Höhe erfasst',
            hX[4] + hCols[4].w * aW - 2.5, ay + 5, { align: 'right' });
          ay += aRowH;
          doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
          doc.line(margin, ay, margin + aW, ay);
        });
      });
    }
  }

  // ── Aufmaß-Tabellen ─────────────────────────────────────────────────────
  // Gegliedert nach ABSCHNITT, sobald welche angelegt sind – das ist die vom
  // Nutzer selbst gewählte Struktur. Ohne Abschnitte bleibt es bei der
  // automatischen Einteilung nach Gebäudeseite.
  const anyPos = allBays.some(b => (b.positions || []).length);

  if (anyPos) {
    const useAbschnitte = abschnitteList().length > 0;
    const blocks = useAbschnitte
      ? baysByAbschnitt().map(g => ({
          title: g.abschnitt ? g.abschnitt.name : 'Ohne Abschnitt',
          color: g.abschnitt ? pdfHex(g.abschnitt.color) : null,
          bays: g.bays
        }))
      : SIDE_ORDER.map(side => ({ title: SIDE_LABEL[side], color: null, bays: fieldsBySide()[side] }));
    const sideBlocks = blocks.filter(b => b.bays.some(bay => (bay.positions || []).length));

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
    const rowH = 7, headH = 7.5, blockHdrH = 9;

    let py = startPage({ kicker: 'Aufmaß',
                         sheet: useAbschnitte ? 'nach Abschnitt' : 'nach Gerüstseite' }) + 3;

    const drawColHeader = () => {
      doc.setFillColor(...theme.tableHead);
      doc.rect(margin, py, tableW, headH, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2);
      doc.setTextColor(...theme.tableHeadText);
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? colRight(i) : c.align === 'center' ? colMid(i) : colX[i] + (i === 0 ? 8 : 2);
        doc.text(c.title, tx, py + headH - 2.5, { align: c.align });
      });
      py += headH;
    };

    const drawRow = (a, shade) => {
      if (shade) { doc.setFillColor(...theme.zebra); doc.rect(margin, py, tableW, rowH, 'F'); }
      const swatch = pdfCol(theme, pdfHex(a.color));
      doc.setFillColor(...swatch); doc.setDrawColor(...swatch); doc.setLineWidth(0.2);
      doc.rect(colX[0] + 1.8, py + rowH / 2 - 1.9, 3.8, 3.8, 'FD');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.2);
      doc.setTextColor(...theme.ink);
      doc.text(a.label, colX[0] + 8, py + rowH - 2.7);
      doc.text(a.n + '×', colMid(1), py + rowH - 2.7, { align: 'center' });
      doc.setFontSize(8.8); doc.setTextColor(...theme.inkSoft);
      doc.text(aggQtyText(a), colX[2] + 2, py + rowH - 2.7);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.2);
      doc.setTextColor(...theme.ink);
      doc.text(a.meters ? fmtQty(a.meters) + ' m' : '–', colRight(3), py + rowH - 2.7, { align: 'right' });
      py += rowH;
      doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
      doc.line(margin, py, margin + tableW, py);
    };

    const drawTable = (ttl, subtitle, aggList, accentColor) => {
      // Tabellen möglichst nicht zerreißen: passt der ganze Block nicht mehr
      // aufs Blatt, aber auf ein leeres, wird komplett umgebrochen. Sonst
      // bleibt mindestens Blockkopf + Spaltenkopf + eine Zeile zusammen.
      const tableH = blockHdrH + headH + aggList.length * rowH;
      const room   = contentBottom - py;
      if ((tableH > room && tableH <= contentBottom - margin - 6) ||
          (blockHdrH + headH + rowH > room)) {
        py = startPage({ kicker: 'Aufmaß', sheet: 'Fortsetzung' }) + 3;
      }
      doc.setFillColor(...(accentColor ? pdfCol(theme, accentColor) : theme.groupFill));
      doc.rect(margin, py, tableW, blockHdrH, 'F');
      const headText = accentColor ? [255, 255, 255] : theme.groupText;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      doc.setTextColor(...headText);
      doc.text(ttl, margin + 3, py + blockHdrH - 2.9);
      if (subtitle) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
        doc.text(subtitle, margin + tableW - 3, py + blockHdrH - 2.9, { align: 'right' });
      }
      py += blockHdrH;
      drawColHeader();
      aggList.forEach((a, i) => {
        if (py + rowH > contentBottom) {
          py = startPage({ kicker: 'Aufmaß', sheet: 'Fortsetzung' }) + 3;
          // Nach dem Umbruch Blockname wiederholen, damit die Zeilen
          // zuordenbar bleiben.
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
          doc.setTextColor(...theme.inkSoft);
          doc.text(ttl + ' (Fortsetzung)', margin, py + 3);
          py += 6;
          drawColHeader();
        }
        drawRow(a, i % 2 === 1);
      });
      py += 7;
    };

    sideBlocks.forEach(({ title: ttl, color, bays }) => {
      const len  = bays.reduce((s, b) => s + b.len, 0);
      const flae = bays.reduce((s, b) => s + bayFlaecheM2(b), 0);
      const cnt  = bays.filter(bay => (bay.positions || []).length).length;
      drawTable(ttl, `${cnt} Felder · ${fmtQty(len)} m · ${fmtQty(flae)} m²`,
                aggregatePositions(bays), color);
    });

    const totalLenAll = allBays.reduce((s, b) => s + b.len, 0);
    drawTable('Gesamt · alle Felder',
              `${allBays.length} Felder · ${fmtQty(totalLenAll)} m · ${fmtQty(totalFlaeche)} m²`,
              aggregatePositions(allBays), null);
  }

  // ── Notizen ────────────────────────────────────────────────────────────
  const notedFields = [];
  state.sections.forEach(sec => {
    sec.bays.forEach((bay, bi) => {
      if (isBayVisible(bay) && (bay.note || '').trim()) {
        notedFields.push({
          label: bayLabel(sec, bi),
          abschnitt: abschnittName(bay.abschnittId),
          note: bay.note.trim()
        });
      }
    });
  });
  if (notedFields.length) {
    let ny = startPage({ kicker: 'Notizen', sheet: `${notedFields.length} Eintr${notedFields.length === 1 ? 'ag' : 'äge'}` }) + 4;
    notedFields.forEach(({ label, abschnitt, note }) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.2);
      const lines = doc.splitTextToSize(note, availW - 30);
      const blockH = Math.max(7, lines.length * 4.6) + 4;
      if (ny + blockH > contentBottom) ny = startPage({ kicker: 'Notizen', sheet: 'Fortsetzung' }) + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(...theme.accent);
      doc.text(label, margin, ny);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4);
      doc.setTextColor(...theme.inkSoft);
      doc.text(abschnitt, margin, ny + 4);
      doc.setFontSize(9.2); doc.setTextColor(...theme.ink);
      doc.text(lines, margin + 30, ny);
      ny += blockH;
      doc.setDrawColor(...theme.rule); doc.setLineWidth(0.1);
      doc.line(margin, ny - 2, pdfW - margin, ny - 2);
    });
  }

  // ── Fotos ──────────────────────────────────────────────────────────────
  // Bereits beim Import auf max. 1600 px / JPEG q0.72 komprimiert; sie werden
  // unverändert eingebettet (kein erneutes Rastern) und bleiben so klein.
  if (linkedProjectId) {
    const photos = (await listProjectPhotos(linkedProjectId)).filter(p => p.include !== false);
    photos.forEach((photo, i) => {
      const top = startPage({ kicker: 'Fotos', sheet: `Foto ${i + 1} von ${photos.length}` });
      const photoAvailH = contentBottom - top - 2;
      const ratio = Math.min(availW / photo.w, photoAvailH / photo.h);
      const pw = photo.w * ratio, ph = photo.h * ratio;
      doc.addImage(photo.dataUrl, 'JPEG', margin + (availW - pw) / 2, top + 1, pw, ph, undefined, 'FAST');
    });
  }

  // Fußzeile auf JEDER Seite – erst jetzt bekannt, wie viele es geworden sind.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    pdfDrawFooter(ctx, i, pageCount);
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
  normalizeState();
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
    if (v > 0) { state.depth = v; requestRender(); }
  });

  document.getElementById('savePlanBtn').addEventListener('click', savePlan);
  document.getElementById('loadPlanBtn').addEventListener('click', triggerLoad);
  document.getElementById('loadFileInput').addEventListener('change', onLoadFile);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);

  document.getElementById('photosBtn').addEventListener('click', openPhotosSheet);
  document.getElementById('photoFileInput').addEventListener('change', onPhotoFilesSelected);
  document.getElementById('grundrissBtn').addEventListener('click', openGrundrissSheet);
  document.getElementById('grundrissFileInput').addEventListener('change', onGrundrissFileSelected);

  // ── Bordbretter-Linie ───────────────────────────────────────────────────
  document.getElementById('bordbrettBtn')?.addEventListener('click', () => {
    if (bordbrettModus) { brichBordbrettZeichnenAb(); return; }
    starteBordbrettZeichnen();
  });
  document.getElementById('bordbrettZurueckBtn')?.addEventListener('click', bordbrettPunktZurueck);
  document.getElementById('bordbrettAbbruchBtn')?.addEventListener('click', brichBordbrettZeichnenAb);
  document.getElementById('bordbrettFertigBtn')?.addEventListener('click', beendeBordbrettZeichnen);
  updateBordbrettBar();

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
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    const k = e.key.toLowerCase();

    // „R" dreht das ausgewählte Feld um 90° (mit Umschalt gegen den
    // Uhrzeigersinn) – am Rechner der schnellste Weg zum Drehen.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && k === 'r' && selectedSi !== null) {
      e.preventDefault();
      rotateSectionBy(selectedSi, e.shiftKey ? -90 : 90);
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;
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
    if (grundrissMessen || bordbrettModus) return;               // im Mess-/Zeichenmodus zählt der Tipp als Punkt
    // Klick, der nur die Nachwehe eines gerade losgelassenen Griffs ist,
    // darf die eben getroffene Auswahl nicht wieder aufheben.
    if (Date.now() - handleReleasedAt < CLICK_AFTER_HANDLE_MS) return;
    if (selectedSi !== null) { selectedSi = null; selectedBi = null; requestRender(); }
  };
  svg.addEventListener('click',       deselect);
  svg.addEventListener('pointerdown', e => { if (e.target === svg || e.target.id === 'gridBg') deselect(); });

  // Messmodus für den Grundriss-Maßstab: zwei Tipps auf die Zeichenfläche.
  // Liegt VOR den Pan/Pinch-Handlern, damit ein Tipp nicht als Wischen zählt.
  // Ebenso der Zeichenmodus der Bordbretter-Linie: dort fängt der Tipp den
  // Punkt ab, bevor ein Feld darunter das Bearbeiten-Sheet öffnet.
  svg.addEventListener('click', e => {
    if (!grundrissMessen && !bordbrettModus) return;
    if (canvasJustMoved) { canvasJustMoved = false; return; }
    e.stopPropagation();
    const pt = screenToSvg(e.clientX, e.clientY);
    if (grundrissMessen) grundrissMessKlick(pt);
    else                 bordbrettKlick(pt);
  }, true);

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

  renderAllNow();
}

document.addEventListener('DOMContentLoaded', init);
