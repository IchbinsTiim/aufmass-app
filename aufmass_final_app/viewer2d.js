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
// Gängige Systembreiten – die Gerüsttiefe ist damit ein Tipp statt einer Eingabe.
const TIEFE_PRESETS = [0.73, 1.09];

// ── Positionen pro Feld ─────────────────────────────────────────────────────
// Jedes Feld ist ein Gerüst-Feld (Länge + Höhen). Zusätzlich kann ein Feld
// mehrere Positionen besitzen (Konsole, Innengeländer, Netz, Dachfang …).
// Positionen werden in bay.positions[] gespeichert: { cat, ... }.

// Konsolentypen (Breite in m) – übernommen aus der ersten Aufmaß-App (0/19/30/50/70/109 cm).
const KONSOLE_TYPES_2D = ['0,19', '0,30', '0,50', '0,70', '1,09'];

// Verfügbare Positions-Arten. `konsole:true` → mit Typ + Lagen, mehrfach möglich.
// `unit` = voreingestellte Mengeneinheit ('m' | 'm2' | 'stgm' | 'stk' | 'lagen');
// pro Position im Editor änderbar.
//
// Zwei Sonderfälle werden zusätzlich IN DER ZEICHNUNG dargestellt, weil sie die
// Konstruktion verändern und nicht nur eine Menge sind (siehe Verbreiterungen
// weiter unten):
//   `strebe:true` – Verbreiterung „Rahmen mit Rohr": Rahmen + diagonales Rohr
//                   als Strebendreieck an der offenen Feldseite.
//   `feld:true`   – Modul-Abstützung: wird wie ein zusätzliches (gestricheltes)
//                   Feld gezeichnet und hat eigene Länge/Breite/Höhe.
const POSITIONS = [
  { key: 'konsole',       label: 'Konsole',          short: 'K',    color: '#cc7a00', konsole: true },
  { key: 'innengelaender',label: 'Innengeländer',    short: 'IG',   color: '#2f9e44', unit: 'lagen' },
  { key: 'netz',          label: 'Netz',             short: 'Netz', color: '#5a6b7a', unit: 'm2' },
  { key: 'dachfang',      label: 'Dachfang',         short: 'DF',   color: '#b08900', unit: 'm' },
  { key: 'treppenturm',   label: 'Treppenturm',      short: 'TT',   color: '#8e44ec', unit: 'stgm' },
  { key: 'durchgang',     label: 'Tunnelrahmen',     short: 'TR',   color: '#1f5f9e', unit: 'stk' },
  { key: 'geruesttreppe', label: 'Gerüsttreppe',     short: 'GT',   color: '#4659c9', unit: 'stk' },
  { key: 'verbreiterung', label: 'Verbreiterung',    short: 'VB',   color: '#0f9b8e', unit: 'lagen' },
  { key: 'verbreiterung_rahmen', label: 'Verbreiterung – Rahmen mit Rohr',
    short: 'VR', color: '#0d7f92', unit: 'stk', strebe: true },
  { key: 'abstuetzung',   label: 'Modul-Abstützung', short: 'MA',   color: '#7a4bd1',
    unit: 'stk', feld: true },
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

/* ── Verbreiterungen ─────────────────────────────────────────────────────────
   Manche Gerüste müssen verbreitert werden. Der Nutzer bildet das direkt beim
   Zeichnen ab – in zwei Bauarten, die sich am Bau grundsätzlich unterscheiden:

     A  „Verbreiterung – Rahmen mit Rohr" (POS-Art `verbreiterung_rahmen`):
        ein Rahmen ragt über das Feld hinaus und wird von einem diagonalen Rohr
        abgestützt. Im Grundriss ist das ein Strebendreieck an der offenen
        (wandabgewandten) Feldseite – gezeichnet wie ein Zusatzbauteil, ohne
        eigene Maße.

     B  „Modul-Abstützung" (POS-Art `abstuetzung`): eine Abstützung, die wie ein
        eigenes Feld neben dem Feld steht (typisch bei Türmen). Sie ist KEINE
        begehbare Lage und wird deshalb GESTRICHELT gezeichnet, hat aber – wie
        ein Feld – eigene Länge, Breite und Höhe.

   Beide hängen an genau einem Gerüstfeld und werden wie die übrigen
   Zusatzbauteile (Innengeländer …) in bay.positions[] geführt: damit gelten
   Kopieren/Einfügen, Mehrfachauswahl, Speichern und die PDF-Aufstellung ohne
   weiteres Zutun auch für sie.                                              */

/** Maße einer Modul-Abstützung in m. Ohne eigene Eingabe gelten die Maße des
 *  Feldes, an dem sie hängt (Länge, Gerüsttiefe, kleinere Feldhöhe) – so steht
 *  auch ohne Tipparbeit ein plausibler Wert im Plan. */
function abstuetzMasse(pos, bay) {
  const num = v => {
    const n = parseFloat(v);
    return (v != null && v !== '' && !isNaN(n) && n > 0) ? +n.toFixed(2) : null;
  };
  return {
    len:    num(pos.fLen)    != null ? num(pos.fLen)    : (bay && bay.len ? bay.len : null),
    breite: num(pos.fBreite) != null ? num(pos.fBreite) : state.depth,
    hoehe:  num(pos.fHoehe)  != null ? num(pos.fHoehe)  : (bay ? bayHoehe(bay) : null)
  };
}

/** Maßangabe einer Modul-Abstützung, z. B. „2,57 × 0,73 × 4,00 m". */
function abstuetzMassText(pos, bay) {
  const m = abstuetzMasse(pos, bay);
  const t = v => (v != null ? fmtQty(v) : '?');
  return `${t(m.len)} × ${t(m.breite)} × ${t(m.hoehe)} m`;
}

/** Neue Position einer Art anlegen. Bauteile, die es je Feld schlicht „gibt"
 *  (Verbreiterung, Abstützung), starten mit Anzahl 1 – sonst stünde sofort ein
 *  Hinweis „Menge fehlt" im Feld, obwohl nichts fehlt. */
function mkPosition(key) {
  const p = POS_BY_KEY[key] || {};
  const pos = { id: ++_bId, cat: key, qty: null, unit: defaultUnit(key) };
  if (p.strebe || p.feld) pos.qty = 1;
  return pos;
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
  el.textContent = sichtbar.toFixed(2).replace('.', ',') + ' m²'
    + (versteckt > 0 ? ' (+' + versteckt.toFixed(2).replace('.', ',') + ' ausgebl.)' : '');
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
    base = 'Konsole ' + (pos.typ || KONSOLE_TYPES_2D[0]) + ' · '
      + (isMeterBilling(pos) ? 'lfd. Meter' : lagenLabel(pos.lagen));
  }
  // Modul-Abstützung: sie zählt nicht in Metern, sondern hat wie ein Feld eigene
  // Maße – die gehören in den Namen, sonst stünde im PDF nur „1 Stk".
  else if (p.feld) { base = p.label + ' · ' + abstuetzMassText(pos, bay); }
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
  // Die Modul-Abstützung ist im Plan als eigenes (gestricheltes) Feld zu sehen –
  // ihr Badge nennt deshalb die Maße, nicht die Stückzahl.
  if (p.feld) return p.short + ' ' + abstuetzMassText(pos, bay);
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

/** Kürzestmögliche Plan-Beschriftung einer Position: nur Art (und bei der
 *  Konsole Typ + Lagen). Wird gebraucht, wenn das Feld auf dem Papier zu schmal
 *  für den vollen Badge ist – dann steht lieber das Bauteil ohne Menge da als
 *  eine Beschriftung, die ins Nachbarfeld läuft. Die Mengen stehen ohnehin in
 *  den Aufmaß-Tabellen. */
function posBadgeKurz(pos) {
  const p = POS_BY_KEY[pos.cat];
  if (!p) return '?';
  if (p.konsole) {
    const lg = isMeterBilling(pos) || pos.lagen == null || pos.lagen === 'alle' || pos.lagen === ''
      ? '' : '×' + (parseInt(pos.lagen, 10) || '');
    return 'K' + (pos.typ || '') + lg;
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
    } else if (p.feld) {
      // Eine Modul-Abstützung wird gezeichnet – dafür braucht sie Maße. Länge
      // und Breite erben notfalls vom Feld, die Höhe nicht immer.
      const m = abstuetzMasse(pos, bay);
      if (m.len == null || m.breite == null) warnings.push(p.label + ': Länge/Breite fehlt');
      if (m.hoehe == null) warnings.push(p.label + ': Höhe fehlt');
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
  el.textContent = n ? '⚠ ' + n : '';
  el.title = n ? n + ' Feld' + (n === 1 ? '' : 'er') + ' mit fehlenden Angaben' : '';
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
  bordbrettKanten: [],   // markierte Gerüstkanten (siehe bordbrettKantenListe())
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
  normalizeBordbrettKanten();
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
let bulkKonsTyp     = KONSOLE_TYPES_2D[0];
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
const PROJECTS_STORAGE_KEY = GK.projekte;
// CURRENT_PROJECT_STORAGE_KEY: siehe core.js (von beiden Modulen genutzt).
let linkedProjectId = null;
let autosave2dTimer = null;
// Stand der Zeichnung, wie er zuletzt im Projekt stand. Daran – und nicht am
// laufenden Autosave-Timer – hängt die Frage „gibt es ungespeicherte
// Änderungen?": Der Timer läuft nach jedem Neuzeichnen an, auch ohne dass
// sich inhaltlich etwas geändert hat.
let dokumentBasis   = null;

function loadLinkedProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Schreibt die Projektliste zurück – die einzige Stelle im 2D-Modul, die das
 * tut. Sie meldet die Änderung auch dem Aufmaß-Modul, das dieselbe Liste im
 * Speicher hält; ohne diese Meldung liefe dort ein veralteter Stand weiter
 * und würde beim nächsten Schreiben die Änderung von hier überschreiben.
 * @returns {boolean} false, wenn der Speicher die Daten nicht annimmt.
 */
function schreibeLinkedProjects(list) {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // Kein stilles Verschlucken: voller Speicher oder privater Modus müssen
    // sichtbar sein, sonst wirkt die Aktion nur scheinbar folgenlos.
    console.error('[2D] Projektliste konnte nicht gespeichert werden:', err);
    showToast('Speicher voll – Änderung nicht gesichert');
    return false;
  }
  meldeDatenAenderung('2d');
  return true;
}

function schreibeLinkedFolders(list) {
  try {
    localStorage.setItem(GK.ordner, JSON.stringify(list));
  } catch (err) {
    console.error('[2D] Ordner konnten nicht gespeichert werden:', err);
    showToast('Speicher voll – Ordner nicht gesichert');
    return false;
  }
  meldeDatenAenderung('2d');
  return true;
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
    state.bordbrettKanten = Array.isArray(z.bordbrettKanten) ? z.bordbrettKanten : [];
    // Nur für die einmalige Umstellung – normalizeState() räumt das Feld ab.
    state.bordbretter = Array.isArray(z.bordbretter) ? z.bordbretter : null;
    _sId = z._sId || state.sections.length;
    _bId = z._bId || state.sections.flatMap(s => s.bays).length;
    normalizeState();
  } else {
    state.project = projName || '';
  }
}

/** Die aktuelle Zeichnung als Datensatz, so wie sie im Projekt landet. */
function aktuelleZeichnungsDaten() {
  return {
    depth: state.depth, sections: state.sections,
    abschnitte: abschnitteList(), hideUnassigned: !!state.hideUnassigned,
    aufmass: aufmassRules(), ecken: state.ecken || {},
    bordbrettKanten: bordbrettKantenListe(),
    _sId, _bId
  };
}

/** Schreibt die aktuelle Zeichnung in das verknüpfte Projekt (ohne Verzögerung). */
function writeToLinkedProject() {
  if (!linkedProjectId) return;
  const list = loadLinkedProjects();
  const idx = list.findIndex(p => p.id === linkedProjectId);
  // Das Projekt ist zwischenzeitlich gelöscht worden – dann gibt es nichts
  // mehr zu beschreiben (und erst recht nichts wieder anzulegen).
  if (idx < 0) { linkedProjectId = null; return; }
  list[idx].name = state.project || list[idx].name || '';
  list[idx].zeichnung2d = aktuelleZeichnungsDaten();
  list[idx].geaendert = new Date().toISOString().slice(0, 10);
  if (schreibeLinkedProjects(list)) dokumentBasis = serializeUndoState();
}

/** Stehen Änderungen an, die noch nicht im Projekt stehen? */
function hatUngespeicherteAenderungen() {
  if (!linkedProjectId || dokumentBasis === null) return false;
  return serializeUndoState() !== dokumentBasis;
}

/** Schreibt die aktuelle Zeichnung (gebündelt) in das verknüpfte Projekt. */
function scheduleAutosave2d() {
  if (!linkedProjectId) return;
  if (autosave2dTimer) clearTimeout(autosave2dTimer);
  autosave2dTimer = setTimeout(() => {
    autosave2dTimer = null;
    writeToLinkedProject();
  }, 700);
}

/**
 * Schreibt die Zeichnung sofort in ihr Projekt – beim Verlassen des Moduls,
 * beim Dokumentwechsel und wenn der Nutzer im Dialog „Speichern" wählt.
 *
 * Geschrieben wird IMMER, nicht nur wenn gerade ein gebündelter Schreibvorgang
 * ansteht. Vorher hing das Sichern daran, dass zufällig noch ein Zeitgeber
 * lief: war die Frist eben abgelaufen (oder hatte eine Änderung gar keinen
 * ausgelöst), tat „Speichern" nichts und meldete trotzdem Erfolg. Ein
 * zusätzlicher Schreibvorgang kostet nichts, ein verlorener Stand viel.
 */
function flushAutosave2d() {
  if (autosave2dTimer) { clearTimeout(autosave2dTimer); autosave2dTimer = null; }
  writeToLinkedProject();
}

// ── Projekt-Fotos: nur noch aufräumen ───────────────────────────────────────
// Die Foto-Galerie ist aus dem Zeichner entfallen – auf der Baustelle wurde
// sie nicht gebraucht und kostete in der Werkzeugleiste einen Platz, den die
// Zeichnung besser nutzt. Neue Fotos legt die App deshalb nicht mehr an.
//
// Was bleibt, ist die AUFRÄUMSEITE: auf Geräten, die schon mit der Galerie
// gearbeitet haben, liegen Fotos in IndexedDB. Sie müssen weiterhin mit ihrer
// Zeichnung verschwinden, sonst bleiben nach dem Löschen Datensätze liegen,
// an die niemand mehr herankommt. Deshalb steht hier nur noch Lesen und
// Löschen – kein Schreiben.
const PHOTOS_DB_NAME  = 'av2d_photos_db';
const PHOTOS_STORE    = 'photos';
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

/** Entfernt alle Fotos eines Projekts – gehört zum Löschen der Zeichnung,
 *  sonst bleiben die Bilder als verwaiste Datensätze in IndexedDB liegen. */
function entferneFotosZuProjekt(projectId) {
  if (!projectId || typeof indexedDB === 'undefined') return Promise.resolve(0);
  return openPhotosDB().then(db => new Promise(resolve => {
    const tx    = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    let n = 0;
    const req = store.index('projectId').openKeyCursor(IDBKeyRange.only(projectId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      store.delete(c.primaryKey); n++;
      c.continue();
    };
    tx.oncomplete = () => resolve(n);
    tx.onerror    = () => resolve(n);
  })).catch(err => {
    console.warn('[2D] Fotos konnten nicht gelöscht werden:', err);
    return 0;
  });
}

/**
 * Einmaliger Aufräumlauf: Fotos, deren Projekt es nicht mehr gibt. Nötig für
 * den Fall, dass die Seite zwischen „gelöscht" und dem Ablauf der
 * Rückgängig-Frist neu geladen wird.
 * Bewusst vorsichtig: Lässt sich die Projektliste nicht sicher lesen, wird
 * nichts gelöscht – lieber ein Foto zu viel als eines zu wenig.
 */
function raeumeVerwaisteFotosAuf() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(0);
  let raw = null;
  try { raw = localStorage.getItem(PROJECTS_STORAGE_KEY); } catch (_) { return Promise.resolve(0); }
  if (raw === null) return Promise.resolve(0);
  let liste;
  try { liste = JSON.parse(raw); } catch (_) { return Promise.resolve(0); }
  if (!Array.isArray(liste)) return Promise.resolve(0);

  const bekannt = new Set(liste.map(p => p && p.id).filter(Boolean));
  return openPhotosDB().then(db => new Promise(resolve => {
    const tx    = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    let n = 0;
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!bekannt.has(c.value && c.value.projectId)) { store.delete(c.primaryKey); n++; }
      c.continue();
    };
    tx.oncomplete = () => resolve(n);
    tx.onerror    = () => resolve(n);
  })).catch(() => 0);
}

// ── Toast ──────────────────────────────────────────────────────────────────

// showToast() steht in core.js – identische Fassung, von beiden Modulen genutzt.

// ── Rückgängig / Wiederholen ────────────────────────────────────────────────

function serializeUndoState() {
  return JSON.stringify({
    project: state.project, depth: state.depth,
    abschnitte: abschnitteList(), hideUnassigned: !!state.hideUnassigned,
    aufmass: aufmassRules(), ecken: state.ecken || {},
    bordbrettKanten: bordbrettKantenListe(),
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
  state.bordbrettKanten = Array.isArray(data.bordbrettKanten) ? data.bordbrettKanten : [];
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

/* ── Umfang des Einfügens ────────────────────────────────────────────────────
   Übertragen wird die AUSSTATTUNG eines Feldes, nicht sein Ort: Zusatzbauteile
   (inkl. Typ, Menge, Einheit, Lagen), Höhen, Abschnitt und Notiz. Feldspezifisch
   und deshalb NIE automatisch übernommen bleiben Position/Drehung/Reihenfolge in
   der Zeichnung – die Feldlänge ist zuschaltbar, weil sie die Geometrie ändert.
   Die Auswahl gilt gleichermaßen für „Einfügen" bei einem einzelnen Feld und
   für „auf Auswahl anwenden" bei der Mehrfachauswahl, damit derselbe Knopf
   überall dasselbe tut. Sie wird gemerkt.                                    */
const PASTE_OPTS_KEY = GK.einfuegenOptionen;
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
const FAV_STORAGE_KEY = GK.favoriten;

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
  const box = isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
  _boundsCache = { box };
  return box;
}

function clampScale(s) {
  return Math.min(CAM_MAX_SCALE, Math.max(CAM_MIN_SCALE, s));
}

/**
 * Der Teil der Zeichenfläche, der WIRKLICH frei liegt.
 *
 * Angedockt steht das Werkzeug-Menü neben der Zeichnung und verdeckt nichts.
 * Als Blatt von unten (Handy, iPad hochkant) liegt es darüber – „alle Felder
 * anzeigen" würde die Zeichnung sonst mittig in eine Fläche einpassen, deren
 * untere Hälfte niemand sieht.
 *
 * Nur fürs Einpassen gedacht: Treffer und Umrechnungen brauchen weiterhin das
 * echte Rechteck aus viewportRect().
 */
function freierViewport() {
  const vp = viewportRect();
  const panel = document.getElementById('werkzeugPanel');
  if (!panel || !panel.classList.contains('offen')) return vp;
  const pr = panel.getBoundingClientRect();
  if (!pr.width || !pr.height) return vp;
  // Liegt es rechts daneben (angedockt), überlappt es die Zeichnung nicht.
  if (pr.left >= vp.left + vp.w - 1) return vp;
  const frei = pr.top - vp.top;
  if (frei >= vp.h - 1) return vp;
  return { left: vp.left, top: vp.top, w: vp.w, h: Math.max(140, frei) };
}

/** Setzt die Kamera so, dass der gesamte Inhalt zentriert sichtbar ist. */
function fitCameraToContent() {
  const vp  = viewportRect();
  const vis = freierViewport();
  const b   = contentBounds();
  if (!b) {
    camera.cx = 0; camera.cy = 0;
    camera.scale = clampScale(Math.min(vis.w / 800, vis.h / 600));
    return;
  }
  const sx = vis.w / Math.max(b.w, 1);
  const sy = vis.h / Math.max(b.h, 1);
  camera.scale = clampScale(Math.min(sx, sy) * CAM_FIT_MARGIN);
  // Die Kamera zielt auf die Mitte der GESAMTEN Fläche. Damit der Inhalt in
  // der Mitte des FREIEN Bereichs landet, wird der Versatz beider Mitten
  // herausgerechnet.
  const dyPx = (vis.top + vis.h / 2) - (vp.top + vp.h / 2);
  camera.cx = b.minX + b.w / 2;
  camera.cy = b.minY + b.h / 2 - dyPx / camera.scale;
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
      pos.typ = KONSOLE_TYPES_2D[0];
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

/* ── Geometrie der Verbreiterungen ───────────────────────────────────────────
   Beide Bauarten hängen an einem gezeichneten Feld (`el` aus computeLayout)
   und liegen an dessen OFFENER Seite – also weg von der Wand. Die Geometrie
   entsteht hier EINMAL in Weltkoordinaten, damit Zeichenfläche und PDF exakt
   dasselbe darstellen.

   el.pts = [p0, p1, p2, p3]:  p0→p1 Wandkante, p3→p2 Außenkante,
                               p0→p3 quer (Gerüsttiefe).                     */

/** Einheitsvektoren eines Feldes: längs (Laufrichtung) und quer nach außen. */
function bayAxes(el) {
  const [p0, p1, , p3] = el.pts;
  const lx = p1.x - p0.x, ly = p1.y - p0.y;
  const ll = Math.hypot(lx, ly) || 1;
  const ox = p3.x - p0.x, oy = p3.y - p0.y;
  const ol = Math.hypot(ox, oy) || 1;
  return { dx: lx / ll, dy: ly / ll, ox: ox / ol, oy: oy / ol, len: ll, tiefe: ol };
}

/**
 * Rechteck einer MODUL-ABSTÜTZUNG (Variante B) in Weltkoordinaten.
 * Sie steht an der offenen Feldseite, beginnt am Feldanfang und ist so lang und
 * breit, wie beim Bauteil eingetragen. Gezeichnet wird sie gestrichelt – sie
 * ist eine Abstützung, keine begehbare Gerüstlage.
 * @returns {{pts:Array, breite:number}|null}
 */
function abstuetzPoly(el, pos, bay) {
  const m = abstuetzMasse(pos, bay);
  if (!m.len || !m.breite) return null;
  const a = bayAxes(el);
  const [, , , p3] = el.pts;
  const L = m.len * PX_PER_M, B = m.breite * PX_PER_M;
  const q0 = { x: p3.x, y: p3.y };
  const q1 = { x: q0.x + a.dx * L, y: q0.y + a.dy * L };
  const q2 = { x: q1.x + a.ox * B, y: q1.y + a.oy * B };
  const q3 = { x: q0.x + a.ox * B, y: q0.y + a.oy * B };
  return { pts: [q0, q1, q2, q3], breite: B };
}

/**
 * Strebendreieck der Verbreiterung „RAHMEN MIT ROHR" (Variante A) in
 * Weltkoordinaten: der Rahmen steht quer zum Feld und ragt über dessen offene
 * Kante hinaus, das Rohr läuft diagonal von der Feldkante zur Rahmenspitze.
 * @returns {{rahmen:Array, rohr:Array, fuss:Array}}
 */
function rahmenRohrLinien(el) {
  const a = bayAxes(el);
  const [, , p2, p3] = el.pts;
  const mid  = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const aus  = a.tiefe * 0.6;                       // Überstand des Rahmens
  const spitze = { x: mid.x + a.ox * aus, y: mid.y + a.oy * aus };
  // Fußpunkt des Rohres: an der Außenkante, ein Stück vor dem Rahmen.
  const fuss = { x: p3.x + a.dx * a.len * 0.18, y: p3.y + a.dy * a.len * 0.18 };
  return { rahmen: [mid, spitze], rohr: [fuss, spitze], fuss: [fuss, mid] };
}

/** Wie weit ragen die Verbreiterungen eines Feldes über die offene Kante
 *  hinaus (Welt-px)? Beschriftungen werden entsprechend weiter nach außen
 *  gestapelt, damit sie nicht auf der Abstützung liegen. */
function verbreiterungAusladung(el, bay) {
  let aus = 0;
  (bay.positions || []).forEach(pos => {
    const p = POS_BY_KEY[pos.cat];
    if (!p) return;
    if (p.feld) {
      const poly = abstuetzPoly(el, pos, bay);
      if (poly) aus = Math.max(aus, poly.breite);
    } else if (p.strebe) {
      aus = Math.max(aus, bayAxes(el).tiefe * 0.6);
    }
  });
  return aus;
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

  /* ── Ecken zwischen verbundenen Sektionen ──────────────────────────────────
     Eine Ecke entsteht, wo sich zwei Sektionen einen Punkt teilen. Das ist
     ausdrücklich NICHT nur „Ende trifft Anfang": beim Zeichnen über die
     Knoten-Plus laufen zwei Felder häufig von DEMSELBEN Punkt weg
     (Anfang/Anfang) oder aufeinander zu (Ende/Ende). Genau diese beiden Fälle
     blieben früher unerkannt – an solchen Ecken fehlte damit die komplette
     Eckenrechnung (± Gerüsttiefe), obwohl in der Zeichnung eine Ecke steht.

     Damit die Prüfung linear zur Feldanzahl bleibt, liegen alle Endpunkte in
     einem groben 2-px-Raster; verglichen wird nur mit den Nachbarzellen.     */
  const cellKey = (x, y) => Math.round(x / 2) + ',' + Math.round(y / 2);
  const knoten  = new Map();          // Rasterzelle → [{ si, endet, p }]
  state.sections.forEach((s, i) => {
    if (!s.bays.some(isBayVisible)) return;
    const ende = sectionEnd(s);
    [[false, { x: s.x0, y: s.y0 }], [true, ende]].forEach(([endet, p]) => {
      const k = cellKey(p.x, p.y);
      const arr = knoten.get(k);
      if (arr) arr.push({ si: i, endet, p }); else knoten.set(k, [{ si: i, endet, p }]);
    });
  });

  const gesehen = new Set();
  knoten.forEach((eintraege, k) => {
    const [cx, cy] = k.split(',').map(Number);
    // Nachbarzellen mitnehmen: ein Knoten kann durch das Runden auf der Grenze
    // zweier Zellen liegen.
    const partner = [];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = knoten.get((cx + ox) + ',' + (cy + oy));
        if (arr) partner.push(...arr);
      }
    }
    eintraege.forEach(a => partner.forEach(b => {
      if (a.si === b.si) return;
      if (Math.abs(a.p.x - b.p.x) >= 2 || Math.abs(a.p.y - b.p.y) >= 2) return;
      // Jede Ecke genau einmal: Paar + Ort als Schlüssel.
      const paar = (a.si < b.si ? `${a.si}-${b.si}` : `${b.si}-${a.si}`) + '@'
                 + cellKey((a.p.x + b.p.x) / 2, (a.p.y + b.p.y) / 2);
      if (gesehen.has(paar)) return;

      // Reihenfolge wie bisher: die EINLAUFENDE Sektion ist `si`, die
      // ausleitende `ni`. Laufen beide gleich (Anfang/Anfang bzw. Ende/Ende),
      // entscheidet der Index – festgehalten wird die Rolle in siEndet/niEndet.
      const [ein, aus] = (a.endet && !b.endet) ? [a, b]
                       : (!a.endet && b.endet) ? [b, a]
                       : (a.si < b.si ? [a, b] : [b, a]);
      const secEin = state.sections[ein.si], secAus = state.sections[aus.si];
      const dirEin = secVec(secEin), dirAus = secVec(secAus);
      const outEin = outVec(dirEin, secEin.flip), outAus = outVec(dirAus, secAus.flip);
      // Anlaufrichtung = Richtung, mit der die Sektion IN den Knoten zeigt.
      const anlauf = ein.endet ? dirEin : { dx: -dirEin.dx, dy: -dirEin.dy };
      const kind = eckArtGeometrisch(anlauf, outAus);
      if (!kind) return;                       // gerade Fortsetzung: keine Ecke
      gesehen.add(paar);

      const c0 = { x: ein.p.x, y: ein.p.y };
      const c1 = { x: c0.x + outEin.dx * depth, y: c0.y + outEin.dy * depth };
      const c2 = { x: c1.x + outAus.dx * depth, y: c1.y + outAus.dy * depth };
      const c3 = { x: c0.x + outAus.dx * depth, y: c0.y + outAus.dy * depth };
      // Das Viereck ist bei der AUSSENECKE das Eckstück, das die Lücke
      // zwischen beiden Gerüstbahnen schließt – bei der INNENECKE dieselbe
      // Fläche als ÜBERLAPPUNG beider Bahnen. Grundlage für das Aufmaß, siehe
      // eckenListe() und computeAufmass().
      els.push({ type: 'corner', pts: [c0, c1, c2, c3],
                 si: ein.si, ni: aus.si,
                 siEndet: ein.endet, niEndet: aus.endet, kind });
    }));
  });

  return els;
}

/** Endet die Sektion `si` an dieser Ecke (statt dort zu beginnen)? Fehlen die
 *  Angaben (ältere Daten), gilt die frühere Regel „si endet, ni beginnt". */
function eckEndetHier(ecke, si) {
  if (si === ecke.si) return ecke.siEndet !== false;
  if (si === ecke.ni) return ecke.niEndet === true;
  return false;
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
  updateBordbrettReadout();
  scheduleAutosave2d();
  scheduleUndoSnapshot();

  const hasBays    = state.sections.some(s => s.bays.length > 0);
  const hasVisible = state.sections.some(s => s.bays.some(isBayVisible));
  syncEmptyHint(hasBays && !hasVisible);
  if (!hasVisible) {
    autoFit = true;
    fitCameraToContent();
    applyCamera();
    gLive.appendChild(g);
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
      'fill-opacity': isBulkSelected ? 0.42 : 1,
      stroke: isBulkSelected ? '#8f74ff' : (isSelected ? '#0a5fd0' : baseStrk),
      'stroke-width': (isSelected || isBulkSelected) ? 4 : 2,
      style: isSelected     ? 'filter:drop-shadow(0 0 7px rgba(10,95,208,0.85))'
           : isBulkSelected ? 'filter:drop-shadow(0 0 7px rgba(143,116,255,0.85))'
           : '',
      cursor: 'pointer'
    });
    poly.addEventListener('click', ev => {
      ev.stopPropagation();
      handleBayTap(el.si, el.bi);
    });
    g.appendChild(poly);

    /* ── Auswahl deutlich zeigen ──────────────────────────────────────────
       Auf dem iPad in der Sonne trägt ein Farbunterschied allein nicht weit
       genug. Ausgewählte Felder bekommen deshalb zusätzlich einen kräftigen
       Ring in FESTER Bildschirmstärke (also unabhängig vom Zoom) und die
       Mehrfachauswahl obendrein einen Haken in der Feldmitte – zwei
       Merkmale, die auch schräg von oben und mit Handschuh erkennbar sind.
       Die Ringe reagieren auf keinen Tipp; sie liegen nur oben auf.       */
    if (isSelected || isBulkSelected) {
      const ringFarbe = isBulkSelected ? '#8f74ff' : '#0a5fd0';
      g.appendChild(svgEl('polygon', {
        points: ptsStr(el.pts), fill: 'none',
        stroke: '#ffffff', 'stroke-width': hs(7),
        'stroke-linejoin': 'round', 'pointer-events': 'none', opacity: 0.55
      }));
      g.appendChild(svgEl('polygon', {
        points: ptsStr(el.pts), fill: 'none',
        stroke: ringFarbe, 'stroke-width': hs(3.5),
        'stroke-linejoin': 'round', 'pointer-events': 'none'
      }));
    }

    if (isBulkSelected) {
      // Der Haken sitzt in der oberen RECHTEN Ecke des Feldes: die linke ist
      // von der Feldbezeichnung belegt, die Mitte vom Längenmaß und vom
      // Verschiebe-Griff. So verdeckt nichts den Auswahlnachweis.
      const r    = Math.min(Math.max(depth * 0.22, hs(10)), hs(17));
      const pad  = r * 1.35;
      const maxX = Math.max(...el.pts.map(q => q.x));
      const minY = Math.min(...el.pts.map(q => q.y));
      const hx = maxX - pad, hy = minY + pad;
      g.appendChild(svgEl('circle', {
        cx: hx, cy: hy, r: r * 1.2,
        fill: '#ffffff', 'pointer-events': 'none'
      }));
      g.appendChild(svgEl('circle', {
        cx: hx, cy: hy, r,
        fill: '#6a4bd1', 'pointer-events': 'none'
      }));
      const hk = svgEl('text', {
        x: hx, y: hy,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': r * 1.5, 'font-family': 'system-ui, sans-serif',
        fill: '#ffffff', 'font-weight': '800', 'pointer-events': 'none'
      });
      hk.textContent = '\u2713';
      g.appendChild(hk);
    }

    // ── Verbreiterungen ───────────────────────────────────────────────────
    // Sie gehören zum Feld und werden deshalb direkt daran gezeichnet: die
    // Modul-Abstützung gestrichelt (keine begehbare Lage), der Rahmen mit Rohr
    // als Strebendreieck. Ein Tipp darauf öffnet dasselbe Feld-Sheet.
    positions.forEach(pos => {
      const meta = POS_BY_KEY[pos.cat];
      if (!meta) return;
      if (meta.feld) {
        const ab = abstuetzPoly(el, pos, bayData);
        if (!ab) return;
        const p = svgEl('polygon', {
          points: ptsStr(ab.pts), fill: meta.color, 'fill-opacity': 0.10,
          stroke: meta.color, 'stroke-width': 2,
          'stroke-dasharray': `${hs(9)},${hs(6)}`, cursor: 'pointer'
        });
        const t = svgEl('title', {});
        t.textContent = `${meta.label} · ${abstuetzMassText(pos, bayData)}`;
        p.appendChild(t);
        p.addEventListener('click', ev => { ev.stopPropagation(); handleBayTap(el.si, el.bi); });
        g.appendChild(p);
      } else if (meta.strebe) {
        const s = rahmenRohrLinien(el);
        const line = (pts, w, dash) => svgEl('line', {
          x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y,
          stroke: meta.color, 'stroke-width': w, 'stroke-linecap': 'round',
          'stroke-dasharray': dash || '', 'pointer-events': 'none'
        });
        g.appendChild(line(s.fuss, 1.4, `${hs(4)},${hs(3)}`));  // Feldkante zum Rahmen
        g.appendChild(line(s.rohr, 2.2));                        // diagonales Rohr
        g.appendChild(line(s.rahmen, 3.4));                      // Rahmen (Überstand)
      }
    });

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
      // Knapp außerhalb der Außenkante – bei einer Verbreiterung hinter DEREN
      // Ausladung, sonst läge die Beschriftung auf der Abstützung.
      const startDist = depth * 0.5 + verbreiterungAusladung(el, bayData) + lineH * 0.85;
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

  /* 4b. Außenecken – ebenfalls antippbar.
     Hier entscheidet sich, ob die Gerüstlage um die Ecke HERUMLÄUFT: dann
     bekommt das Feld an der Ecke eine Gerüsttiefe zugeschlagen. Die Plakette
     zeigt „+", sobald ein Umlauf gilt. */
  {
    const aussen = els.filter(e => e.type === 'corner' && eckArtEffektiv(e) === 'aussen');
    aussen.forEach(el => {
      const secA = state.sections[el.si], secB = state.sections[el.ni];
      if (!secA || !secB) return;
      const key = eckKey(secA, secB);
      const um  = [el.si, el.ni].filter(si => eckLaeuftUm(key, si));
      const [q0, q1, q2, q3] = el.pts;
      const cx = (q0.x + q1.x + q2.x + q3.x) / 4;
      const cy = (q0.y + q1.y + q2.y + q3.y) / 4;
      const R  = Math.min(hs(HANDLE_R * 0.8), depth * 0.34);

      const hit = svgEl('circle', {
        cx, cy, r: R * 1.6, fill: 'rgba(0,0,0,0.001)', style: 'cursor:pointer'
      });
      const tt = svgEl('title', {});
      tt.textContent = um.length
        ? `Außenecke: ${um.map(si => state.sections[si].name).join(' und ')} `
          + `läuft um die Ecke (+ ${fmtQty(eckZuschlagWert())} m). Tippen zum Ändern.`
        : 'Außenecke – tippen, wenn die Gerüstlage um die Ecke herumläuft '
          + `(+ ${fmtQty(eckZuschlagWert())} m je Seite).`;
      hit.appendChild(tt);
      hit.addEventListener('click', ev => { ev.stopPropagation(); openEckSheet(key); });
      g.appendChild(hit);

      g.appendChild(svgEl('circle', {
        cx, cy, r: R, fill: um.length ? '#1d7a4c' : 'rgba(255,255,255,0.85)',
        stroke: um.length ? '#fff' : '#2c6fa8',
        'stroke-width': hs(1.6), 'pointer-events': 'none'
      }));
      const sym = svgEl('text', {
        x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': R * 1.3, 'font-family': 'system-ui, sans-serif',
        fill: um.length ? '#fff' : '#2c6fa8', 'font-weight': '800',
        'pointer-events': 'none'
      });
      sym.textContent = um.length ? '+' : '⌐';
      g.appendChild(sym);
    });
  }

  // 5b. Move handles (orange ✥) – im Bordbrett-Modus ausgeblendet: dort ist
  //     jede Berührung für eine Kante gedacht, und die Griffe sind gesperrt.
  if (!bordbrettModus) {
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

    /* Rotation handles (purple ↻) — nur für die ausgewählte Sektion.

       In der Mehrfachauswahl entfallen sie: dort bedeutet JEDER Tipp im Plan
       „dieses Feld an- bzw. abwählen". Ein Griff, der daneben liegt und den
       Tipp abfängt, ist genau das, was die Auswahl auf dem iPad unzuverlässig
       gemacht hat. */
    const ROT_R     = hs(HANDLE_R * 0.85);
    const movingNow0 = drag && (drag.type === 'move' || drag.type === 'resize');
    els.filter(e => e.type === 'rotateHandle' && e.si === selectedSi && !movingNow0 && !bulkMode).forEach(el => {
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
  /* Sie liegen bewusst NEBEN dem Feld, ragen dadurch aber ein Stück über den
     Nachbarn. Beim Zeichnen ist das richtig (man fügt am Ende an); in der
     Mehrfachauswahl fingen sie die Tipps ab, die dem Nachbarfeld galten –
     „ich tippe das Feld an und nichts passiert". Dort entfallen sie deshalb,
     wie die Drehgriffe: jeder Tipp gehört der Auswahl. */
  const busyAdd = drag && (drag.type === 'move' || drag.type === 'rotate' || drag.type === 'resize');
  const selSec  = (selectedSi !== null && !bordbrettModus && !bulkMode)
    ? state.sections[selectedSi] : null;
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

  // 6b. Bordbretter – über den Feldern, damit die markierten Kanten
  //     ablesbar bleiben und im Modus auch treffbar sind.
  renderBordbretter(g, hs, els);

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

/* ── Bordbrett: Kanten markieren ─────────────────────────────────────────────
   Bedienung in einem Satz: Modus einschalten, Außenkante antippen – oder mit
   dem Finger über mehrere Kanten streichen. Nochmal antippen nimmt sie wieder
   weg. Es gibt keinen Dialog, keine Zuordnung und nichts zu bestätigen; was
   markiert ist, sieht man, und die Menge steht in der Leiste.

   Der frühere Weg (eine Linie aus einzeln gesetzten Punkten zeichnen und sie
   anschließend einer Achse zuordnen) ist entfallen. Er verlangte fünf
   Arbeitsschritte für eine Angabe, die geometrisch längst feststeht, und die
   Menge ergab sich am Ende nicht aus der Kante, sondern aus dem Verlauf der
   gezeichneten Linie – zwei Dinge, die auseinanderlaufen konnten.          */

let bordbrettModus = false;   // Markiermodus aktiv?

/** Fangradius für den Kantengriff in Welt-px – bildschirmbezogen, damit er
 *  bei jedem Zoom gleich gut zu treffen ist. */
function bordbrettFangRadius() {
  return worldPerScreenPx() * 22;
}

function starteBordbrettModus() {
  if (!state.sections.some(s => s.bays.some(isBayVisible))) {
    showToast('Erst Gerüstfelder zeichnen – Bordbretter sitzen auf deren Kanten.');
    return;
  }
  bordbrettModus = true;
  selectedSi = null; selectedBi = null;
  closeSheet();
  renderAll();
  updateBordbrettBar();
}

function beendeBordbrettModus() {
  bordbrettModus = false;
  renderAll();
  updateBordbrettBar();
}

/**
 * Kante unter einem Weltpunkt – die nächstgelegene innerhalb des Fangradius.
 * @returns {{bayId:*, k:number, dist:number}|null}
 */
function bordbrettKanteUnter(pt, els, radius) {
  const r = radius != null ? radius : bordbrettFangRadius();
  let best = null;
  (els || computeLayout()).forEach(el => {
    if (el.type !== 'bay') return;
    const bay = state.sections[el.si] && state.sections[el.si].bays[el.bi];
    if (!bay) return;
    for (let k = 0; k < 4; k++) {
      const [p, q] = bayKante(el, k);
      const d = lotAufStrecke(pt, p, q).dist;
      if (d <= r && (!best || d < best.dist)) best = { bayId: bay.id, k, dist: d };
    }
  });
  return best;
}

/** Pointer-Down im Bordbrett-Modus: Kante treffen → Streichen beginnen.
 *  Ohne Treffer bleibt die Geste beim Verschieben/Zoomen der Ansicht. */
function bordbrettPointerDown(e) {
  if (!bordbrettModus) return;
  const pt  = screenToSvg(e.clientX, e.clientY);
  const tre = bordbrettKanteUnter(pt);
  if (!tre) return;
  e.stopPropagation();
  e.preventDefault();
  // Erste Kante entscheidet die Richtung: war sie markiert, nimmt der ganze
  // Strich weg – sonst setzt er. Sonst würde ein Strich über eine gemischte
  // Reihe jede Kante umschalten und niemand wüsste hinterher, was gilt.
  const op = hatBordbrettKante(tre.bayId, tre.k) ? 'ab' : 'an';
  drag = { type: 'bordbrett', op, geaendert: 0 };
  try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
  bordbrettStreichen(pt);
}

/** Wendet die laufende Streich-Richtung auf die Kante unter `pt` an. */
function bordbrettStreichen(pt) {
  const tre = bordbrettKanteUnter(pt);
  if (!tre) return;
  if (setzeBordbrettKante(tre.bayId, tre.k, drag.op === 'an')) {
    drag.geaendert++;
    requestRender();
    updateBordbrettBar();
  }
}

/** Bedienleiste des Modus: zeigt die aktuelle Summe und blendet sich mit dem
 *  Modus ein/aus. */
function updateBordbrettBar() {
  const bar = document.getElementById('bordbrettBar');
  if (bar) bar.classList.toggle('hidden', !bordbrettModus);

  const info = document.getElementById('bordbrettBarInfo');
  if (info) {
    const n = bordbrettKantenListe().length;
    info.textContent = n
      ? `Bordbrett ${fmtQty(bordbrettGesamt())} m · ${n} Kante${n === 1 ? '' : 'n'}`
      : 'Bordbrett 0,00 m';
  }
  const leeren = document.getElementById('bordbrettLeerenBtn');
  if (leeren) leeren.disabled = bordbrettKantenListe().length === 0;

  const btn = document.getElementById('bordbrettBtn');
  if (btn) {
    btn.classList.toggle('aktiv', bordbrettModus);
    btn.setAttribute('aria-pressed', String(bordbrettModus));
  }
  updateBordbrettReadout();
}

/** Kennzahl in der Werkzeugleiste – nur sichtbar, wenn es Bordbretter gibt. */
function updateBordbrettReadout() {
  const el = document.getElementById('bordbrettReadout');
  if (!el) return;
  const m = bordbrettGesamt();
  el.classList.toggle('hidden', !(m > 0));
  el.textContent = '▤ ' + fmtQty(m) + ' m';
}

/**
 * Zeichnet die Bordbretter.
 *
 * Außerhalb des Modus bleibt es bei einem kräftigen, aber schmalen Strich auf
 * der Kante: man sieht sofort, wo Bordbrett ist, ohne dass die Zeichnung
 * zuläuft. Im Modus kommen die noch freien Kanten als feine Hilfslinien dazu,
 * damit erkennbar ist, was überhaupt markierbar ist.
 */
function renderBordbretter(g, hs, els) {
  const markiert = bordbrettKantenSet();
  if (!markiert.size && !bordbrettModus) return;

  const linie = (p, q, attrs) => svgEl('line', {
    x1: p.x, y1: p.y, x2: q.x, y2: q.y, 'stroke-linecap': 'round', ...attrs
  });

  els.forEach(el => {
    if (el.type !== 'bay') return;
    const bay = state.sections[el.si] && state.sections[el.si].bays[el.bi];
    if (!bay) return;
    for (let k = 0; k < 4; k++) {
      const [p, q] = bayKante(el, k);
      const an = markiert.has(bordbrettSchluessel(bay.id, k));

      if (an) {
        // Weiß unterlegt: auf einer dunklen Feldkante bliebe der Strich sonst
        // unsichtbar, auf einer hellen Fläche wirkte er verwaschen.
        g.appendChild(linie(p, q, {
          stroke: '#fff', 'stroke-width': hs(bordbrettModus ? 9 : 7),
          'stroke-opacity': 0.9, 'pointer-events': 'none'
        }));
        g.appendChild(linie(p, q, {
          stroke: '#0f8f8e', 'stroke-width': hs(bordbrettModus ? 5.5 : 4),
          'pointer-events': 'none'
        }));
      } else if (bordbrettModus) {
        g.appendChild(linie(p, q, {
          stroke: '#0f8f8e', 'stroke-width': hs(3),
          'stroke-dasharray': `${hs(7)},${hs(5)}`, 'stroke-opacity': 0.6,
          'pointer-events': 'none'
        }));
      }

      // Trefferfläche nur im Modus: außerhalb darf ein Tipp auf die Feldkante
      // weiterhin das Feld öffnen.
      if (bordbrettModus) {
        const hit = linie(p, q, {
          stroke: 'rgba(0,0,0,0.001)', 'stroke-width': hs(26), style: 'cursor:pointer'
        });
        const tt = svgEl('title', {});
        tt.textContent = `${an ? 'Bordbrett entfernen' : 'Bordbrett setzen'} · `
                       + fmtQty(kantenLaenge(p, q)) + ' m';
        hit.appendChild(tt);
        g.appendChild(hit);
      }
    }
  });
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
  // Im Bordbrett-Modus gehört jeder Tipp der Kante, nicht dem Feld.
  if (bordbrettModus) return;
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
  // Auswahl + Dreh-/Anfuege-Griffe sofort anzeigen; das Werkzeug-Menue zeigt
  // dasselbe Feld als Ziel seiner Aktionen.
  requestRender({ svg: true, bulk: true });
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
  // Im Bordbrett-Modus gehört jeder Tipp der Kante –
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

  if (drag.type === 'bordbrett') {
    bordbrettStreichen(pt);
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
  if (d.type === 'bordbrett') {
    if (d.geaendert) { renderAll(); scheduleAutosave2d(); }
    updateBordbrettBar();
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
    else bay.positions.push(mkPosition(key));
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

  /* Modul-Abstützung: Eingabe wie bei einem normalen Feld – Länge, Breite und
     Höhe. Leer gelassene Felder erben die Maße des Feldes (Platzhalter zeigt,
     was dann gilt), damit die Abstützung sofort im Plan steht. */
  const makeFeldPosRow = pos => {
    const p = POS_BY_KEY[pos.cat];
    const row = document.createElement('div');
    row.className = 'pos-detail-row pos-feld-row';

    const head = document.createElement('div');
    head.className = 'pos-feld-head';
    const name = document.createElement('span');
    name.className = 'pos-detail-name';
    name.textContent = p.label;
    name.style.color = p.color;
    const calc = document.createElement('span');
    calc.className = 'pos-detail-calc';
    const updateCalc = () => { calc.textContent = abstuetzMassText(pos, bay); };
    head.appendChild(name); head.appendChild(calc);

    const masse = document.createElement('div');
    masse.className = 'pos-feld-masse';
    [['Länge',  'fLen',    () => bay.len],
     ['Breite', 'fBreite', () => state.depth],
     ['Höhe',   'fHoehe',  () => bayHoehe(bay)]].forEach(([lbl, key, fallback]) => {
      const wrap = document.createElement('div');
      wrap.className = 'height-field';
      const lab = document.createElement('span');
      lab.className = 'height-label';
      lab.textContent = lbl + ' (m)';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'height-inp';
      inp.min = '0'; inp.step = '0.05'; inp.inputMode = 'decimal';
      const fb = fallback();
      inp.placeholder = fb != null ? fmtQty(fb) : '–';
      inp.value = pos[key] == null || pos[key] === '' ? '' : pos[key];
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        pos[key] = (inp.value === '' || isNaN(v) || v <= 0) ? null : +v.toFixed(2);
        updateCalc();
        syncWarnBanner();
        requestRender();
      });
      wrap.appendChild(lab); wrap.appendChild(inp);
      masse.appendChild(wrap);
    });

    const hint = document.createElement('p');
    hint.className = 'pdf-sheet-note';
    hint.textContent = 'Wird gestrichelt neben dem Feld gezeichnet – sie ist eine '
                     + 'Abstützung, keine begehbare Lage. Leere Felder übernehmen die '
                     + 'Maße des Gerüstfeldes.';

    updateCalc();
    row.appendChild(head); row.appendChild(masse); row.appendChild(hint);
    return row;
  };

  const makePosDetailRow = pos => {
    const p = POS_BY_KEY[pos.cat];
    if (p.feld) return makeFeldPosRow(pos);
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
    KONSOLE_TYPES_2D.forEach(typ => {
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
    bay.positions.push({ id: ++_bId, cat: 'konsole', typ: KONSOLE_TYPES_2D[0], lagen: '1', billing: 'lagen' });
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

  // ── Umlauf bei Außenecke ────────────────────────────────────────────────
  // „Läuft die Lage um die Ecke herum?" – je Seite eigenständig, weil das am
  // Bau auch einseitig vorkommt. Nach DIN zählt die Ecke bei beiden Seiten.
  const umLabel = document.createElement('div');
  umLabel.className = 'sheet-section-label';
  umLabel.textContent = 'Läuft das Gerüst um die Ecke?';
  sheet.appendChild(umLabel);

  const umHint = document.createElement('p');
  umHint.className = 'pdf-sheet-note';
  sheet.appendChild(umHint);

  const umRow = document.createElement('div');
  umRow.className = 'eck-choice-row';
  sheet.appendChild(umRow);

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
    umLabel.style.display = istInnen ? 'none' : '';
    umHint.style.display  = istInnen ? 'none' : '';
    umRow.style.display   = istInnen ? 'none' : '';

    if (!istInnen) {
      const wert = eckZuschlagWert();
      umHint.textContent = 'Läuft die Gerüstlage um die Ecke herum, gehört die '
        + `Ecklänge (${fmtQty(wert)} m) zum Feld an der Ecke. Nach DIN 18451 `
        + 'zählt eine Außenecke bei beiden angrenzenden Seiten.';
      umRow.replaceChildren();
      [e.si, e.ni].forEach(si => {
        const sec = state.sections[si];
        if (!sec) return;
        const an = eckLaeuftUm(e.key, si);
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'eck-choice';
        b.classList.toggle('active', an);
        const t1 = document.createElement('strong');
        t1.textContent = `${sec.name} läuft um die Ecke`;
        const t2 = document.createElement('span');
        t2.className = 'eck-choice-sub';
        t2.textContent = an
          ? `+ ${fmtQty(wert)} m am Feld an der Ecke · antippen zum Aufheben`
          : 'antippen, wenn die Lage hier um die Ecke geführt wird';
        b.appendChild(t1); b.appendChild(t2);
        b.addEventListener('click', () => {
          setEckUmlauf(e.key, sec.id, !an);
          renderAll(); scheduleAutosave2d(); sync();
        });
        umRow.appendChild(b);
      });
      return;
    }

    zuHint.textContent = e.bestaetigt
      ? 'Ihre Festlegung. Antippen, um sie zu ändern.'
      : 'Noch nicht festgelegt – bis dahin gilt der Vorschlag (die längere '
        + 'Achse läuft durch). Bitte bestätigen oder ändern.';

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

/* ── Projekt-Sheet ───────────────────────────────────────────────────────────
   Alles, was einmal je Zeichnung gebraucht wird, an einer Stelle: Gerüsttiefe,
   Vorlagen, Dokumentwechsel und Datei. Vorher standen dafür fünf einzelne
   Knöpfe in der Werkzeugleiste – jeder davon selten benutzt, alle zusammen
   aber breiter als die eigentlichen Werkzeuge.

   Ein Tipp, ein Blatt, alles sichtbar: nichts liegt in einem Untermenü.     */

function openProjektSheet() {
  closeSheet();

  const overlay = document.createElement('div');
  overlay.id = 'sheetOverlay';
  overlay.className = 'sheet-overlay';
  overlay.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.id = 'bottomSheet';
  sheet.className = 'bottom-sheet';
  sheet.addEventListener('click', e => e.stopPropagation());

  sheet.innerHTML = `
    <div class="sheet-header">Projekt</div>

    <div class="sheet-section-label">Gerüsttiefe</div>
    <div class="sheet-std-btns" id="projDepthBtns">
      ${TIEFE_PRESETS.map(d =>
        `<button type="button" class="std-btn" data-depth="${d}">${fmtQty(d)}&thinsp;m</button>`
      ).join('')}
    </div>
    <div class="sheet-adj-row">
      <input type="number" class="sheet-inp" id="scaffDepth"
             min="0.10" step="0.01" inputmode="decimal" aria-label="Gerüsttiefe in Metern" />
      <span class="sheet-unit">m</span>
    </div>

    <div class="sheet-section-label">Vorlage (ersetzt die Zeichnung)</div>
    <div class="sheet-std-btns">
      <button type="button" class="std-btn" id="lShapeBtn">L-Form</button>
      <button type="button" class="std-btn" id="uShapeBtn">U-Form</button>
      <button type="button" class="std-btn" id="rectBtn">Rechteck</button>
    </div>

    <div class="sheet-section-label">Zeichnung</div>
    <div class="sheet-std-btns">
      <button type="button" class="std-btn" id="projNeuBtn">Neue Zeichnung…</button>
      <button type="button" class="std-btn" id="projWechselBtn">Andere Zeichnung…</button>
    </div>

    <div class="sheet-section-label">Datei</div>
    <div class="sheet-std-btns">
      <button type="button" class="std-btn" id="savePlanBtn">Als Datei speichern</button>
      <button type="button" class="std-btn" id="loadPlanBtn">Aus Datei laden</button>
    </div>

    <div class="sheet-actions">
      <button type="button" class="sheet-ok" id="projFertigBtn">Fertig</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);

  const depthInp = sheet.querySelector('#scaffDepth');
  const markiereTiefe = () => sheet.querySelectorAll('[data-depth]').forEach(b =>
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.depth) - state.depth) < 0.005));

  depthInp.value = state.depth;
  markiereTiefe();

  const setzeTiefe = v => {
    if (!(v > 0)) return;
    state.depth = v;
    depthInp.value = v;
    markiereTiefe();
    invalidateEckenCache();
    renderAll();
    scheduleAutosave2d();
  };

  sheet.querySelectorAll('[data-depth]').forEach(b =>
    b.addEventListener('click', () => setzeTiefe(parseFloat(b.dataset.depth))));
  depthInp.addEventListener('input', e => setzeTiefe(parseFloat(e.target.value)));

  // Eine Vorlage ersetzt die vorhandene Zeichnung. Statt vorher zu fragen –
  // ein Klick mehr bei jedem gewollten Fall – wird sie eingesetzt und lässt
  // sich mit einem Tipp zurücknehmen. Das ist derselbe Weg wie beim Löschen
  // von Zeichnungen und kommt ohne Rückfrage aus.
  const vorlage = (id, fn, name) => sheet.querySelector(id).addEventListener('click', () => {
    const hatFelder = state.sections.some(sec => sec.bays.length);
    // Der Stand VOR der Vorlage muss als Undo-Schritt feststehen, bevor die
    // Vorlage ihn überschreibt – sonst ginge er im Sammel-Snapshot unter.
    if (hatFelder) finalizeUndoSnapshot();
    closeSheet();
    fn();
    if (hatFelder) {
      finalizeUndoSnapshot();
      showToast(`${name} eingesetzt – die bisherige Zeichnung wurde ersetzt`,
                { label: 'Rückgängig', onClick: performUndo });
    }
  });
  vorlage('#lShapeBtn', applyLShape, 'L-Form');
  vorlage('#uShapeBtn', applyUShape, 'U-Form');
  vorlage('#rectBtn',   applyRect,   'Rechteck');

  sheet.querySelector('#projNeuBtn').addEventListener('click', () => {
    closeSheet(); neueZeichnungStarten();
  });
  sheet.querySelector('#projWechselBtn').addEventListener('click', () => {
    closeSheet(); Shell.gehe('#/2d/projekte');
  });
  sheet.querySelector('#savePlanBtn').addEventListener('click', () => { closeSheet(); savePlan(); });
  sheet.querySelector('#loadPlanBtn').addEventListener('click', () => { closeSheet(); triggerLoad(); });
  sheet.querySelector('#projFertigBtn').addEventListener('click', closeSheet);

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


/* ══════════════════════════════════════════════════════════════════════════
   Werkzeug-Menü
   --------------------------------------------------------------------------
   Ein Knopf (der Pfeil ganz rechts in der Werkzeugleiste) klappt ein Panel
   auf, in dem alles liegt, was beim Zeichnen nicht ständig gebraucht wird,
   aber ohne Suchen erreichbar sein muss:

     Auswahl     Mehrfachauswahl an/aus, alle auswählen, Auswahl aufheben
     Bearbeiten  Höhe, Kategorien, Konsole, Kopieren, Vorlagen, Spiegeln
     Achsen      Abschnitte anlegen, zuweisen, umbenennen, ein-/ausblenden
     Felder      die Feldliste (nur im Handy-Modus, sonst links)
     Ansicht     Handy-/Tablet-Modus

   Das Panel ist NICHT modal: die Mehrfachauswahl wird durch Antippen der
   Felder im Plan bedient, und dabei soll das Menü offen bleiben und live
   mitzählen. Es schließt nur über seinen eigenen Knopf (oder Esc).

   Der Auswahlzustand (bulkMode/bulkSelected) hängt NICHT am Menü: Zuklappen
   ändert nichts an der Auswahl, Aufklappen zeigt sie unverändert wieder.
   ══════════════════════════════════════════════════════════════════════════ */

let werkzeugOffen = false;

function ladeWerkzeugOffen() {
  try { return localStorage.getItem(GK.werkzeugMenue) === '1'; }
  catch (_) { return false; }
}

/** Öffnet/schließt das Menü. `merken: false` für Zustände, die nicht die Wahl
 *  des Nutzers sind (z. B. Aufräumen beim Dokumentwechsel). */
function setWerkzeugPanel(offen, { merken = true } = {}) {
  werkzeugOffen = !!offen;
  const panel = document.getElementById('werkzeugPanel');
  const btn   = document.getElementById('werkzeugBtn');
  if (panel) panel.classList.toggle('offen', werkzeugOffen);
  if (btn) {
    btn.classList.toggle('aktiv', werkzeugOffen);
    btn.setAttribute('aria-expanded', String(werkzeugOffen));
    const pfeil = btn.querySelector('.wz-pfeil');
    if (pfeil) pfeil.textContent = werkzeugOffen ? '⌄' : '›';
  }
  document.body.classList.toggle('wz-offen', werkzeugOffen);
  if (merken) { try { localStorage.setItem(GK.werkzeugMenue, werkzeugOffen ? '1' : '0'); } catch (_) {} }
  // Auf schmalen Geraeten zieht die Feldliste mit ins Menue, damit die
  // Zeichnung nicht zwischen zwei Leisten eingeklemmt wird.
  syncSidePanelOrt();
  // Beim Aufklappen den Inhalt frisch aufbauen – die Auswahl kann sich
  // zwischenzeitlich über den Plan geändert haben.
  if (werkzeugOffen) renderWerkzeugPanel();
  // Die Zeichenflaeche wird schmaler bzw. wieder breiter.
  _vpCache = null;
  if (autoFit) fitCameraToContent();
  applyCamera();
}

function toggleWerkzeugPanel() { setWerkzeugPanel(!werkzeugOffen); }

/** Kleine Zahl am Werkzeug-Knopf: so ist auch bei zugeklapptem Menü sichtbar,
 *  dass gerade eine Mehrfachauswahl läuft und wie viele Felder darin sind. */
function updateWerkzeugBadge() {
  const badge = document.getElementById('werkzeugBadge');
  const btn   = document.getElementById('werkzeugBtn');
  if (!badge) return;
  const an = bulkMode;
  badge.textContent = an ? String(bulkSelected.size) : '';
  badge.classList.toggle('hidden', !an);
  if (btn) btn.classList.toggle('wz-mehrfach', an);
}

/** Baut alle Blöcke des Menüs neu auf. */
function renderWerkzeugPanel() {
  renderWzAuswahl();
  renderBulkBar();
  renderAbschnittBar();
  renderWzAnsicht();
}

/* ── Block „Auswahl" ─────────────────────────────────────────────────────────
   Der Einstieg in alles Weitere. Er beantwortet drei Fragen auf einen Blick:
   Ist die Mehrfachauswahl an? Wie viele Felder sind markiert? Wie werde ich
   sie wieder los?                                                           */

function renderWzAuswahl() {
  const el = document.getElementById('wzAuswahl');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(wzKopf('Auswahl', '☑'));

  const alleBays = visibleBaysFlat();

  // Der Hauptschalter. Bewusst groß und über die volle Breite: er ist der
  // meistgesuchte Knopf des ganzen Menüs.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'bulk-toggle-btn wz-hauptschalter' + (bulkMode ? ' active' : '');
  toggleBtn.setAttribute('aria-pressed', String(bulkMode));
  toggleBtn.innerHTML = '';
  const tIco = document.createElement('span');
  tIco.className = 'wz-schalter-ico';
  tIco.textContent = bulkMode ? '✕' : '☑';
  const tTxt = document.createElement('span');
  tTxt.className = 'wz-schalter-txt';
  tTxt.textContent = bulkMode ? 'Mehrfachauswahl beenden' : 'Mehrfachauswahl aktivieren';
  toggleBtn.appendChild(tIco); toggleBtn.appendChild(tTxt);
  toggleBtn.addEventListener('click', () => {
    bulkMode = !bulkMode;
    // Bordbrett-Modus und Mehrfachauswahl deuten denselben Tipp verschieden
    // (Kante gegen Feld) und schließen sich deshalb gegenseitig aus.
    if (bulkMode && bordbrettModus) beendeBordbrettModus();
    if (!bulkMode) { bulkSelected.clear(); bulkHL = null; bulkHR = null; }
    renderAll();
  });
  el.appendChild(toggleBtn);

  if (!bulkMode) {
    // Einzelauswahl: zeigen, WAS ausgewählt ist, und den direkten Weg ins
    // Bearbeiten-Blatt anbieten.
    const sel = currentSelectionBays();
    const zeile = document.createElement('p');
    zeile.className = 'wz-hinweis';
    if (sel.length) {
      zeile.innerHTML = '';
      const stark = document.createElement('strong');
      stark.textContent = 'Feld ' + bayLabel(state.sections[selectedSi], selectedBi);
      zeile.appendChild(stark);
      zeile.appendChild(document.createTextNode(' ausgewählt'));
      el.appendChild(zeile);

      const bearbBtn = document.createElement('button');
      bearbBtn.type = 'button';
      bearbBtn.className = 'wz-aktion';
      bearbBtn.textContent = '✎ Feld bearbeiten';
      bearbBtn.addEventListener('click', () => openEditSheet(selectedSi, selectedBi));
      el.appendChild(bearbBtn);
    } else {
      zeile.textContent = 'Feld im Plan antippen zum Bearbeiten – oder oben die '
                        + 'Mehrfachauswahl einschalten und mehrere Felder markieren.';
      el.appendChild(zeile);
    }
    return;
  }

  // Mehrfachauswahl aktiv ------------------------------------------------
  const zaehler = document.createElement('div');
  zaehler.className = 'wz-zaehler' + (bulkSelected.size ? ' voll' : '');
  const zNum = document.createElement('span');
  zNum.className = 'wz-zaehler-zahl';
  zNum.textContent = String(bulkSelected.size);
  const zTxt = document.createElement('span');
  zTxt.className = 'wz-zaehler-txt';
  zTxt.textContent = `von ${alleBays.length} Feld${alleBays.length === 1 ? '' : 'ern'} ausgewählt`;
  zaehler.appendChild(zNum); zaehler.appendChild(zTxt);
  el.appendChild(zaehler);

  const hinweis = document.createElement('p');
  hinweis.className = 'wz-hinweis';
  hinweis.textContent = 'Felder im Plan antippen – angetippt = markiert, nochmal antippen = wieder abgewählt.';
  el.appendChild(hinweis);

  const reihe = document.createElement('div');
  reihe.className = 'wz-aktion-reihe';

  const alleBtn = document.createElement('button');
  // Der Zweitname `bulk-sel-btn` bleibt: „Alle"/„Keine" heissen seit jeher so
  // und werden in den Abnahmetests darueber angesprochen. Das Aussehen kommt
  // von `wz-aktion` – zwei Namen, ein Knopf.
  alleBtn.type = 'button'; alleBtn.className = 'wz-aktion bulk-sel-btn';
  alleBtn.textContent = '⬚ Alle Felder auswählen';
  alleBtn.disabled = !alleBays.length;
  alleBtn.addEventListener('click', () => {
    alleBays.forEach(b => bulkSelected.add(b.id));
    renderAll();
    showToast(alleBays.length + ' Feld' + (alleBays.length === 1 ? '' : 'er') + ' ausgewählt');
  });

  const keineBtn = document.createElement('button');
  keineBtn.type = 'button'; keineBtn.className = 'wz-aktion bulk-sel-btn';
  keineBtn.textContent = '⨯ Auswahl aufheben';
  keineBtn.disabled = !bulkSelected.size;
  keineBtn.addEventListener('click', () => { bulkSelected.clear(); renderAll(); });

  reihe.appendChild(alleBtn); reihe.appendChild(keineBtn);
  el.appendChild(reihe);

  // Auswahl über eine Achse/einen Abschnitt: „alle Felder der Achse B".
  const achsen = abschnitteList();
  if (achsen.length) {
    const lbl = document.createElement('div');
    lbl.className = 'wz-unterlabel';
    lbl.textContent = 'Achse/Abschnitt komplett auswählen';
    el.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'wz-chip-reihe';
    const counts = abschnittCounts();
    achsen.forEach(a => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wz-achs-chip';
      chip.style.setProperty('--absch-color', a.color);
      chip.textContent = `${a.name} (${counts[a.id] || 0})`;
      chip.addEventListener('click', () => waehleAbschnittFelder(a.id));
      row.appendChild(chip);
    });
    if (counts['']) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wz-achs-chip';
      chip.style.setProperty('--absch-color', '#8a97a5');
      chip.textContent = `Ohne Achse (${counts['']})`;
      chip.addEventListener('click', () => waehleAbschnittFelder(null));
      row.appendChild(chip);
    }
    el.appendChild(row);
  }

  // Auswahl über eine Position: „alle Felder mit Dachfang".
  const posMitFeldern = POSITIONS.filter(p =>
    alleBays.some(b => (b.positions || []).some(x => x.cat === p.key)));
  if (posMitFeldern.length) {
    const lbl = document.createElement('div');
    lbl.className = 'wz-unterlabel';
    lbl.textContent = 'Alle Felder mit einer Position auswählen';
    el.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'wz-chip-reihe';
    posMitFeldern.forEach(p => {
      const treffer = alleBays.filter(b => (b.positions || []).some(x => x.cat === p.key));
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wz-achs-chip';
      chip.style.setProperty('--absch-color', p.color);
      chip.textContent = `${p.label} (${treffer.length})`;
      chip.addEventListener('click', () => {
        bulkSelected.clear();
        treffer.forEach(b => bulkSelected.add(b.id));
        renderAll();
        showToast(`${treffer.length} Feld${treffer.length === 1 ? '' : 'er'} mit „${p.label}" ausgewählt`);
      });
      row.appendChild(chip);
    });
    el.appendChild(row);
  }
}

/** Alle (sichtbaren) Felder einer Achse/eines Abschnitts markieren –
 *  dieselbe Aktion wie der Klick auf die Achszeile weiter unten. */
function waehleAbschnittFelder(id) {
  if (id && isAbschnittHidden(id)) setAbschnittHidden(id, false);
  if (bordbrettModus) beendeBordbrettModus();
  bulkMode = true;
  bulkSelected.clear();
  visibleBaysFlat().forEach(b => {
    const match = id ? b.abschnittId === id : !abschnittById(b.abschnittId);
    if (match) bulkSelected.add(b.id);
  });
  renderAll();
  showToast(`${bulkSelected.size} Feld${bulkSelected.size === 1 ? '' : 'er'} aus „${abschnittName(id)}" ausgewählt`);
}

/** Überschrift eines Menüblocks. */
function wzKopf(text, ico) {
  const h = document.createElement('div');
  h.className = 'wz-kopfzeile';
  if (ico) {
    const i = document.createElement('span');
    i.className = 'wz-kopf-ico'; i.textContent = ico; i.setAttribute('aria-hidden', 'true');
    h.appendChild(i);
  }
  const t = document.createElement('span');
  t.className = 'wz-kopf-txt'; t.textContent = text;
  h.appendChild(t);
  return h;
}

/* ── Block „Ansicht" – der Handy-Modus ───────────────────────────────────────
   Drei Schalter statt eines Ja/Nein: „Automatisch" ist die Vorgabe und trifft
   in fast allen Fällen zu; „Handy" und „Tablet" sind die ausdrückliche
   Ansage, wenn der Bildschirm etwas anderes nahelegt als der Nutzer will
   (z. B. Handy-Modus auf dem iPad, um die Zeichenfläche zu maximieren).    */

function renderWzAnsicht() {
  const el = document.getElementById('wzAnsicht');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(wzKopf('Ansicht', '📱'));

  const wahl = getAnsichtWahl();
  const jetzt = document.body.dataset.mode === 'iphone' ? 'Handy-Modus' : 'Tablet/Desktop';

  const row = document.createElement('div');
  row.className = 'wz-segment';
  [
    ['auto',   'Automatisch', 'Der Bildschirm entscheidet – die übliche Einstellung'],
    ['handy',  'Handy',       'Immer Handy-Modus: größte Zeichenfläche, alle Werkzeuge im Menü'],
    ['tablet', 'Tablet',      'Nie Handy-Modus: Feldliste links, Menü rechts angedockt']
  ].forEach(([val, label, titel]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wz-segment-btn' + (wahl === val ? ' active' : '');
    b.dataset.ansicht = val;
    b.textContent = label;
    b.title = titel;
    b.setAttribute('aria-pressed', String(wahl === val));
    b.addEventListener('click', () => setAnsichtWahl(val));
    row.appendChild(b);
  });
  el.appendChild(row);

  const info = document.createElement('p');
  info.className = 'wz-hinweis';
  info.id = 'wzAnsichtInfo';
  info.textContent = `Aktiv: ${jetzt}` + (wahl === 'auto' ? ` (${window.innerWidth} × ${window.innerHeight} px)` : '');
  el.appendChild(info);
}

/* ── Abschnitts-Verwaltung (Seitenleiste) ────────────────────────────────────
   Abschnitte anlegen, umbenennen, löschen – und mit einem Klick alle Felder
   eines Abschnitts in die Mehrfachauswahl übernehmen. */

function renderAbschnittBar() {
  const el = document.getElementById('abschnittBar');
  if (!el) return;
  el.innerHTML = '';

  const head = wzKopf('Achsen / Abschnitte', '🧭');
  head.classList.add('absch-head');

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'absch-add-btn';
  addBtn.textContent = '+ Achse';
  addBtn.title = 'Neue Achse / neuen Abschnitt anlegen (z. B. „Achse A", „Nordseite")';
  addBtn.addEventListener('click', () => {
    const name = prompt('Name der Achse / des Abschnitts (z. B. „Achse A", „Nordseite"):',
                        `Achse ${String.fromCharCode(65 + abschnitteList().length)}`);
    if (name === null) return;
    const a = addAbschnitt(name.trim());
    // Direkt nutzbar: liegt eine Auswahl vor, wandert sie gleich in die neue
    // Achse – das ist der mit Abstand häufigste nächste Schritt.
    const sel = currentSelectionBays();
    if (sel.length) {
      assignAbschnitt(sel, a.id);
      showToast(`Achse „${a.name}" angelegt · ${sel.length} Feld${sel.length === 1 ? '' : 'er'} zugeordnet`);
    } else {
      showToast(`Achse „${a.name}" angelegt`);
    }
    renderAll();
  });

  head.appendChild(addBtn);
  el.appendChild(head);

  /* ── Zuweisen: Achse für die aktuelle Auswahl ──────────────────────────
     Der Kernfall aus der Praxis: fünf Felder markieren → Achse B zuweisen.
     Deshalb steht er GANZ OBEN in diesem Block und nicht am Ende einer
     langen Liste.                                                        */
  const sel = currentSelectionBays().filter(isBayVisible);
  if (sel.length) {
    const zuLabel = document.createElement('div');
    zuLabel.className = 'wz-unterlabel';
    zuLabel.textContent = `Achse für ${sel.length} ausgewählte${sel.length === 1 ? 's' : ''} Feld${sel.length === 1 ? '' : 'er'}`;
    el.appendChild(zuLabel);

    const abschRow = document.createElement('div');
    abschRow.className = 'bulk-chip-row';
    const curIds = abschnittSummary(sel).ids;
    const mkAbschChip = (id, name, color) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isAll = id
        ? sel.every(b => b.abschnittId === id)
        : sel.every(b => !abschnittById(b.abschnittId));
      const isSome = !isAll && (id ? curIds.includes(id)
                                   : sel.some(b => !abschnittById(b.abschnittId)));
      chip.className = 'bulk-pos-chip' + (isAll ? ' active' : '') + (isSome ? ' partial' : '');
      chip.textContent = name;
      chip.style.setProperty('--pos-color', color);
      chip.title = isAll ? 'Alle ausgewählten Felder liegen bereits auf dieser Achse'
                         : `${sel.length} Feld${sel.length === 1 ? '' : 'er'} dieser Achse zuordnen`;
      chip.addEventListener('click', () => {
        assignAbschnitt(sel, id);
        renderAll();
        showToast(id
          ? `${sel.length} Feld${sel.length === 1 ? '' : 'er'} → „${name}"`
          : `Achse bei ${sel.length} Feld${sel.length === 1 ? '' : 'ern'} entfernt`);
      });
      abschRow.appendChild(chip);
    };
    abschnitteList().forEach(a => mkAbschChip(a.id, a.name, a.color));
    mkAbschChip(null, 'Ohne Abschnitt', '#8a97a5');

    const newAbschBtn = document.createElement('button');
    newAbschBtn.type = 'button';
    newAbschBtn.className = 'bulk-pos-chip absch-new-chip';
    newAbschBtn.textContent = '+ neue Achse';
    newAbschBtn.addEventListener('click', () => {
      const name = prompt('Name der Achse / des Abschnitts (z. B. „Achse A", „Nordseite"):',
                          `Achse ${String.fromCharCode(65 + abschnitteList().length)}`);
      if (name === null) return;
      const a = addAbschnitt(name.trim());
      assignAbschnitt(sel, a.id);
      renderAll();
      showToast(`${sel.length} Feld${sel.length === 1 ? '' : 'er'} → „${a.name}"`);
    });
    abschRow.appendChild(newAbschBtn);
    el.appendChild(abschRow);
  }

  // Sammelknopf, sobald irgendetwas ausgeblendet ist – so ist der Weg zurück
  // zur vollständigen Ansicht immer einen Klick entfernt.
  const nHidden = hiddenGroupCount();
  if (nHidden) {
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'absch-showall-btn';
    showAll.textContent = `👁 Alle einblenden (${nHidden} ausgeblendet)`;
    showAll.title = 'Alle ausgeblendeten Achsen wieder anzeigen';
    showAll.addEventListener('click', () => { showAllAbschnitte(); renderAll(); });
    el.appendChild(showAll);
  }

  const list = abschnitteList();
  if (!list.length) {
    const hint = document.createElement('p');
    hint.className = 'absch-hint';
    hint.textContent = 'Noch keine Achsen. Felder ohne Achse funktionieren normal weiter '
                     + 'und erscheinen im Aufmaß unter der Wand, auf der sie liegen.';
    el.appendChild(hint);
    return;
  }

  const counts   = abschnittCounts();
  // Welche Achse ist gerade „aktiv"? Die der aktuellen Auswahl. Das ist keine
  // zweite Zustandsgröße, sondern eine Ableitung – deshalb kann sie nie von
  // der tatsächlichen Zuordnung abweichen.
  const aktivIds = new Set(abschnittSummary(sel).ids);
  const aktivOhne = sel.length > 0 && sel.some(b => !abschnittById(b.abschnittId));

  const wrap = document.createElement('div');
  wrap.className = 'absch-list';

  const makeRow = (a, count) => {
    const id     = a ? a.id : null;
    const hidden = a ? !!a.hidden : !!state.hideUnassigned;
    const aktiv  = a ? aktivIds.has(a.id) : aktivOhne;
    const row = document.createElement('div');
    row.className = 'absch-row' + (hidden ? ' absch-hidden' : '') + (aktiv ? ' absch-aktiv' : '');
    row.style.setProperty('--absch-color', a ? a.color : '#8a97a5');

    // Sichtbarkeit: blendet die Felder dieser Achse auf der Zeichenfläche
    // aus/ein. Die Felder selbst bleiben unverändert erhalten.
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'absch-eye-btn' + (hidden ? ' off' : '');
    eye.textContent = hidden ? '🙈' : '👁';
    eye.setAttribute('aria-pressed', String(!hidden));
    eye.title = hidden
      ? 'Achse einblenden (Felder sind nur ausgeblendet, nicht gelöscht)'
      : 'Achse ausblenden (Felder bleiben erhalten)';
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

    // Klick auf die Zeile: alle Felder dieser Achse markieren
    // (schaltet die Mehrfachauswahl bei Bedarf ein).
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'absch-pick';
    pick.title = 'Alle Felder dieser Achse auswählen';
    pick.appendChild(dot); pick.appendChild(nameEl); pick.appendChild(cnt);
    if (aktiv) {
      const mark = document.createElement('span');
      mark.className = 'absch-aktiv-mark';
      mark.textContent = 'aktiv';
      pick.appendChild(mark);
    }
    pick.addEventListener('click', () => waehleAbschnittFelder(id));
    row.appendChild(pick);

    if (a) {
      const ren = document.createElement('button');
      ren.type = 'button'; ren.className = 'absch-mini-btn';
      ren.textContent = '✎'; ren.title = 'Achse umbenennen';
      ren.addEventListener('click', () => {
        const next = prompt('Neuer Name für die Achse / den Abschnitt:', a.name);
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed) return;
        renameAbschnitt(a.id, trimmed);
        renderAll();
      });

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'absch-mini-btn danger';
      del.textContent = '×';
      del.title = 'Achse löschen (Felder bleiben erhalten)';
      del.addEventListener('click', () => {
        if (count && !confirm(`Achse „${a.name}" löschen?\n\nDie ${count} zugeordneten Felder bleiben erhalten und gelten danach als „Ohne Abschnitt".`)) return;
        deleteAbschnitt(a.id);
        showToast(`Achse „${a.name}" gelöscht`);
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
    // Modul-Abstützung: hier zählt keine Menge, sondern die Maße. Jedes Feld
    // bekommt zunächst die Maße SEINES Feldes; feinjustiert wird im Feld-Sheet.
    if (POS_BY_KEY[catKey] && POS_BY_KEY[catKey].feld) {
      preview.classList.remove('warn');
      preview.textContent = `Maße je Feld zunächst wie das Feld selbst `
        + `(z. B. ${abstuetzMassText(d, first)}) – im Feld-Sheet änderbar.`;
      return;
    }
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

/** Block „Bearbeiten" im Werkzeug-Menü: alles, was auf die aktuelle Auswahl
 *  wirkt – Höhe, Kategorien, Konsolen, Kopieren, Vorlagen, Spiegeln.
 *
 *  Ziel ist IMMER `currentSelectionBays()`: bei eingeschalteter
 *  Mehrfachauswahl die angehakten Felder, sonst das einzeln ausgewählte.
 *  Dadurch tut derselbe Knopf in beiden Fällen dasselbe, und es gibt nur
 *  eine Auswahlquelle. */
function renderBulkBar() {
  const el = document.getElementById('bulkBar');
  if (!el) return;
  el.innerHTML = '';
  el.appendChild(wzKopf('Bearbeiten', '✎'));

  // Sammelaktionen wirken ausschließlich auf SICHTBARE Felder – Felder einer
  // ausgeblendeten Achse sollen sich nicht unbemerkt mitverändern.
  const selectedBays = currentSelectionBays().filter(isBayVisible);

  if (!selectedBays.length) {
    const hint = document.createElement('p');
    hint.className = 'wz-hinweis';
    hint.textContent = allBaysFlat().length
      ? 'Kein Feld ausgewählt. Feld im Plan antippen – oder oben die Mehrfachauswahl '
        + 'einschalten und mehrere Felder markieren.'
      : 'Zuerst Felder anlegen („+ Feld" in der Werkzeugleiste).';
    el.appendChild(hint);
    return;
  }

  // Woran wird gerade gearbeitet? Eine Zeile, die bei jeder Aktion darüber
  // steht – auf der Baustelle die wichtigste Rückmeldung des Menüs.
  const ziel = document.createElement('div');
  ziel.className = 'wz-ziel';
  ziel.textContent = bulkMode
    ? `wirkt auf ${selectedBays.length} ausgewählte${selectedBays.length === 1 ? 's' : ''} Feld${selectedBays.length === 1 ? '' : 'er'}`
    : `wirkt auf Feld ${bayLabel(state.sections[selectedSi], selectedBi)}`;
  el.appendChild(ziel);

  // ── Höhe ───────────────────────────────────────────────────────────────
  // Einmal eingeben, per Klick auf alle markierten Felder übertragen – ohne
  // deren sonstige Positionen anzutasten.
  const heightLabel = document.createElement('div');
  heightLabel.className = 'wz-unterlabel';
  heightLabel.textContent = 'Höhe setzen';
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

  // Höhe aus der Auswahl übernehmen: sind alle markierten Felder gleich hoch,
  // stehen die Werte auf Knopfdruck in den Feldern – Tippfehler entfallen.
  const hUebernehmen = document.createElement('button');
  hUebernehmen.type = 'button';
  hUebernehmen.className = 'wz-aktion wz-aktion-klein';
  hUebernehmen.textContent = '↧ Höhe aus Auswahl übernehmen';
  hUebernehmen.title = 'Übernimmt die Höhen des ersten ausgewählten Feldes in die Eingabefelder';
  hUebernehmen.addEventListener('click', () => {
    const q = selectedBays[0];
    bulkHL = q.hL != null ? q.hL : null;
    bulkHR = q.hR != null ? q.hR : null;
    bulkHLeft.input.value  = bulkHL == null ? '' : bulkHL.toFixed(2);
    bulkHRight.input.value = bulkHR == null ? '' : bulkHR.toFixed(2);
    syncApplyHeightBtn();
  });
  heightForm.appendChild(hUebernehmen);

  syncApplyHeightBtn();
  applyHeightBtn.addEventListener('click', () => {
    selectedBays.forEach(bay => {
      if (bulkHL != null) bay.hL = bulkHL;
      if (bulkHR != null) bay.hR = bulkHR;
    });
    renderAll();
    showToast('Höhe auf ' + selectedBays.length + ' Feld'
      + (selectedBays.length === 1 ? '' : 'ern') + ' übernommen');
  });
  heightForm.appendChild(applyHeightBtn);
  el.appendChild(heightForm);

  // ── Kategorien / Zusatzbauteile ────────────────────────────────────────
  // Chip togglet die Kategorie auf ALLEN ausgewählten Feldern gleichzeitig
  // ein/aus. Menge bleibt je Feld automatisch (Länge/Höhe/Feldlänge).
  const posLabel = document.createElement('div');
  posLabel.className = 'wz-unterlabel';
  posLabel.textContent = 'Eigenschaften / Kategorien';
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
      // für die gesamte Auswahl festgelegt werden.
      if (allHave) {
        selectedBays.forEach(bay => {
          normalizeBay(bay);
          const idx = bay.positions.findIndex(x => x.cat === p.key);
          if (idx >= 0) bay.positions.splice(idx, 1);
        });
        renderAll();
        showToast(p.label + ' bei ' + selectedBays.length + ' Feld'
          + (selectedBays.length === 1 ? '' : 'ern') + ' entfernt');
        return;
      }
      openBulkPosSheet(p.key, selectedBays);
    });
    chipRow.appendChild(chip);
  });
  el.appendChild(chipRow);

  // ── Konsole ────────────────────────────────────────────────────────────
  // Braucht Typ + Lagen/Meter, daher eigenes Mini-Formular statt Toggle-Chip.
  const konsLabel = document.createElement('div');
  konsLabel.className = 'wz-unterlabel';
  konsLabel.textContent = 'Konsole hinzufügen';
  el.appendChild(konsLabel);

  const konsForm = document.createElement('div');
  konsForm.className = 'bulk-kons-form';

  const typRow = document.createElement('div');
  typRow.className = 'bulk-kons-typ-row';
  KONSOLE_TYPES_2D.forEach(typ => {
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
    showToast('Konsole auf ' + selectedBays.length + ' Feld'
      + (selectedBays.length === 1 ? '' : 'ern') + ' ergänzt');
  });
  konsForm.appendChild(addKonsBtn);
  el.appendChild(konsForm);

  // ── Kopieren / Einfügen ────────────────────────────────────────────────
  // „Position kopieren" nimmt die komplette Ausstattung eines Feldes auf,
  // „Höhe kopieren" nur dessen Höhen. Beide legen im selben Zwischenspeicher
  // ab und unterscheiden sich allein im Umfang, den sie einstellen – so
  // bleibt es EIN Kopierweg und nicht zwei.
  const cpLabel = document.createElement('div');
  cpLabel.className = 'wz-unterlabel';
  cpLabel.textContent = 'Kopieren & übertragen';
  el.appendChild(cpLabel);

  const cpBtnRow = document.createElement('div');
  cpBtnRow.className = 'wz-aktion-reihe';

  const quelle = selectedBays[0];
  const posBtn = document.createElement('button');
  posBtn.type = 'button'; posBtn.className = 'wz-aktion';
  posBtn.textContent = '📋 Position kopieren';
  posBtn.title = selectedBays.length > 1
    ? `Nimmt das erste ausgewählte Feld als Vorlage (Höhen, Zusatzbauteile, Achse, Notiz)`
    : 'Höhen, Zusatzbauteile, Achse und Notiz dieses Feldes kopieren';
  posBtn.addEventListener('click', () => {
    pasteOpts.positionen = true; pasteOpts.hoehen = true;
    savePasteOpts();
    copyBayPositions(quelle);
  });

  const hBtn = document.createElement('button');
  hBtn.type = 'button'; hBtn.className = 'wz-aktion';
  hBtn.textContent = '📐 Höhe kopieren';
  hBtn.title = 'Nur die Höhen dieses Feldes kopieren – Zusatzbauteile der Ziele bleiben unangetastet';
  hBtn.addEventListener('click', () => {
    pasteOpts.hoehen = true;
    pasteOpts.positionen = false; pasteOpts.abschnitt = false;
    pasteOpts.notiz = false; pasteOpts.laenge = false;
    savePasteOpts();
    copyBayPositions(quelle);
  });

  cpBtnRow.appendChild(posBtn); cpBtnRow.appendChild(hBtn);
  el.appendChild(cpBtnRow);

  if (!copiedBayData) {
    const cpHint = document.createElement('p');
    cpHint.className = 'wz-hinweis';
    cpHint.textContent = 'Noch nichts kopiert. Nach dem Kopieren erscheint hier „auf Auswahl anwenden".';
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

  // ── Vorlagen ───────────────────────────────────────────────────────────
  // Überschreibt Höhen + Positionen aller markierten Felder mit einem Klick.
  const favBulkLabel = document.createElement('div');
  favBulkLabel.className = 'wz-unterlabel';
  favBulkLabel.textContent = 'Vorlage anwenden';
  el.appendChild(favBulkLabel);

  const favBulkWrap = document.createElement('div');
  favBulkWrap.className = 'fav-chip-row';
  const favs = loadFavorites();
  if (!favs.length) {
    const hint = document.createElement('span');
    hint.className = 'bay-pos-empty';
    hint.textContent = 'Noch keine Vorlagen gespeichert (im Bearbeiten-Blatt eines Feldes anlegen)';
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
        showToast('Vorlage „' + fav.name + '" auf ' + selectedBays.length + ' Feld'
          + (selectedBays.length === 1 ? '' : 'ern') + ' angewendet');
      });
      favBulkWrap.appendChild(chip);
    });
  }
  el.appendChild(favBulkWrap);

  // ── Spiegeln ───────────────────────────────────────────────────────────
  // Dupliziert genau die ausgewählten Felder (auch nicht benachbarte)
  // gespiegelt zur gegenüberliegenden Seite.
  const mirrorLabel = document.createElement('div');
  mirrorLabel.className = 'wz-unterlabel';
  mirrorLabel.textContent = 'Auswahl spiegeln';
  el.appendChild(mirrorLabel);

  const mirrorSelRow = document.createElement('div');
  mirrorSelRow.className = 'wz-aktion-reihe';
  const selBayIds = new Set(selectedBays.map(b => b.id));
  const mirrorHSelBtn = document.createElement('button');
  mirrorHSelBtn.type = 'button'; mirrorHSelBtn.className = 'wz-aktion';
  mirrorHSelBtn.textContent = '⇋ Horizontal';
  mirrorHSelBtn.title = 'Ausgewählte Felder horizontal gespiegelt kopieren';
  mirrorHSelBtn.addEventListener('click', () => mirrorBaySelection(selBayIds, 'v'));
  const mirrorVSelBtn = document.createElement('button');
  mirrorVSelBtn.type = 'button'; mirrorVSelBtn.className = 'wz-aktion';
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
  /* Solange ein Finger auf der Zeichenfläche liegt und kein Griff gezogen
     wird, bleibt das SVG stehen.

     Grund ist kein Tempo, sondern Verlässlichkeit: renderSvg() ersetzt die
     Feld-Polygone. Wird ein Polygon zwischen Drücken und Loslassen ersetzt,
     bekommt es seinen eigenen Klick nicht mehr – der Browser reicht ihn an
     das übergeordnete SVG weiter, wo „auf leere Fläche getippt" gilt. Genau
     so ging beim schnellen Antippen mehrerer Felder gelegentlich ein Tipp
     verloren (und hob dabei sogar die Auswahl auf).

     Das Verschieben der Ansicht selbst braucht kein renderSvg(): Pan und
     Pinch ändern nur die viewBox (applyCamera). Der aufgeschobene Neuaufbau
     wird nach dem Loslassen zuverlässig nachgeholt – scheduleCameraSettle()
     meldet ihn 60 ms später erneut an.

     Beim Ziehen eines Griffs (Verschieben, Drehen, Bordbrett-Streichen) gilt
     das NICHT: dort ist das laufende Neuzeichnen die Rückmeldung. */
  if (!drag && canvasPointers.size && need.svg) {
    _renderNeed.svg = true;
    need.svg = false;
  }
  // Werkzeug-Menue: Auswahl- und Bearbeiten-Block haengen an derselben
  // Bedarfsmeldung wie die frueheren Leisten in der Seitenleiste.
  if (need.bulk)    { renderWzAuswahl(); renderBulkBar(); }
  if (need.sidebar) renderSections();
  // Die Achsenliste zeigt auch die Zuweisung fuer die aktuelle Auswahl an und
  // muss deshalb bei BEIDEN Anlaessen mitziehen.
  if (need.bulk || need.sidebar) renderAbschnittBar();
  if (need.svg)     renderSvg();
  renderSelectionInfo();
  updateWerkzeugBadge();
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
      state.bordbrettKanten = Array.isArray(s.bordbrettKanten) ? s.bordbrettKanten : [];
      state.bordbretter = Array.isArray(s.bordbretter) ? s.bordbretter : null;
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
      // Die Gerüsttiefe steht im Projekt-Sheet und ist nur da, solange es offen
      // ist – beim Laden aus einer Datei ist es das in der Regel nicht mehr.
      const tiefeInp = document.getElementById('scaffDepth');
      if (tiefeInp) tiefeInp.value = state.depth;
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
        color: p.color, label, n: 0, lagen: 0, qtyByUnit: {}, meters: 0, masse: {},
        sort: POSITIONS.findIndex(x => x.key === pos.cat)
      });
      a.n++;
      // Bauteile mit eigenen Maßen (Modul-Abstützung) werden nach Maß gezählt –
      // „3 Stk" allein sagt bei ihnen nichts aus.
      if (p.feld) {
        const t = abstuetzMassText(pos, bay);
        a.masse[t] = (a.masse[t] || 0) + 1;
      }
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

/** Mengen-Zelle einer aggregierten Position: Lagen + Mengen je Einheit. Bei
 *  Bauteilen mit eigenen Maßen (Modul-Abstützung) stehen dort die Maße. */
function aggQtyText(a) {
  const parts = [];
  if (a.lagen) parts.push(a.lagen === 1 ? '1 Lage' : a.lagen + ' Lagen');
  UNIT_DEFS.forEach(([u, lbl]) => { if (a.qtyByUnit[u]) parts.push(fmtQty(a.qtyByUnit[u]) + ' ' + lbl); });
  Object.entries(a.masse || {}).forEach(([txt, n]) => parts.push(`${n}× ${txt}`));
  return parts.join(' · ') || '–';
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
  if (Object.values(state.ecken || {}).some(w => w && w.umlauf && w.umlauf.length)) {
    parts.push('Außenecken, an denen die Lage laut Festlegung um die Ecke läuft, '
             + `+ ${fmtQty(eckZuschlagWert())} m am Feld an der Ecke`);
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

/* ── Bordbrett ───────────────────────────────────────────────────────────────
   Ein Bordbrett steht auf einer KANTE der Gerüstlage. Genau so wird es hier
   auch erfasst: markiert wird die Kante, die Menge ergibt sich zwingend aus
   der Geometrie – nicht aus einer nachträglichen Schätzung und nicht aus dem
   Verlauf einer frei gezeichneten Linie.

   Jedes Feld hat vier Kanten. Die Nummern folgen den Eckpunkten aus
   computeLayout() (el.pts = [p0, p1, p2, p3]):

        p3 ─────2───── p2      Kante 0: p0→p1  wandseitige Längskante
        │              │       Kante 1: p1→p2  Stirnkante am Feldende
        3     Feld     1       Kante 2: p2→p3  äußere Längskante
        │              │       Kante 3: p3→p0  Stirnkante am Feldanfang
        p0 ─────0───── p1

   Gerechnet wird IMMER mit der tatsächlichen Strecke zwischen den beiden
   Eckpunkten. Damit stimmt die Menge auch bei gedrehten Feldern von selbst:
   dreht sich das Feld, drehen sich seine Kanten mit, und eine 2,57-m-Kante
   bleibt 2,57 m lang – egal, wie sie auf dem Bildschirm liegt. Die Längs-
   kanten sind so lang wie das Feld, die Stirnkanten so tief wie das Gerüst.

   Eine geometrische Kante zählt HÖCHSTENS EINMAL. Zwei nebeneinanderliegende
   Felder teilen sich ihre Stirnkante; wäre sie an beiden Feldern markiert,
   stünde sie sonst zweimal im Aufmaß. Vor dem Summieren werden die Kanten
   deshalb über ihre Lage entdoppelt (beide Endpunkte, auf den Millimeter
   gerundet, richtungsunabhängig).

   Gespeichert wird eine schlichte Liste `state.bordbrettKanten` mit Einträgen
   `{ b: <Feld-ID>, k: 0…3 }`. Ältere Zeichnungen kennen stattdessen
   `state.bordbretter` (gezeichnete Linien); die werden beim Laden EINMAL auf
   Kanten umgestellt – siehe migriereBordbrettLinien().                     */

/** Die beiden Eckpunkte einer Feldkante. */
function bayKante(el, k) {
  return [el.pts[k], el.pts[(k + 1) % 4]];
}

/** Länge einer Kante in Metern (volle Genauigkeit, ohne Rundung). */
function kantenLaenge(p, q) {
  return Math.hypot(q.x - p.x, q.y - p.y) / PX_PER_M;
}

/** Schlüssel einer markierten Kante innerhalb der Liste. */
function bordbrettSchluessel(bayId, k) {
  return String(bayId) + '|' + k;
}

/** Lagebezogener Schlüssel einer Kante – gleich für dieselbe Strecke, egal
 *  von welchem Feld aus und in welcher Richtung sie beschrieben wird. */
function kantenGeoSchluessel(p, q) {
  const r = v => Math.round(v * 10) / 10;          // 0,1 px = 1 mm
  const a = `${r(p.x)},${r(p.y)}`, b = `${r(q.x)},${r(q.y)}`;
  return a < b ? a + '~' + b : b + '~' + a;
}

/** Markierte Kanten der Zeichnung (legt die Liste bei Altdaten transparent an). */
function bordbrettKantenListe() {
  if (!Array.isArray(state.bordbrettKanten)) state.bordbrettKanten = [];
  return state.bordbrettKanten;
}

/** Set der markierten Kanten für schnelle Nachfragen beim Zeichnen. */
function bordbrettKantenSet() {
  return new Set(bordbrettKantenListe().map(e => bordbrettSchluessel(e.b, e.k)));
}

function hatBordbrettKante(bayId, k) {
  return bordbrettKantenListe().some(e => String(e.b) === String(bayId) && e.k === k);
}

/**
 * Setzt oder entfernt eine Kante.
 * @returns {boolean} true, wenn sich dadurch etwas geändert hat.
 */
function setzeBordbrettKante(bayId, k, an) {
  const liste = bordbrettKantenListe();
  const i = liste.findIndex(e => String(e.b) === String(bayId) && e.k === k);
  if (an && i < 0)  { liste.push({ b: bayId, k }); return true; }
  if (!an && i >= 0) { liste.splice(i, 1); return true; }
  return false;
}

/** Nimmt alle Bordbretter zurück. */
function leereBordbrettKanten() {
  const n = bordbrettKantenListe().length;
  state.bordbrettKanten = [];
  return n;
}

/**
 * Räumt die Liste auf: gültige Kantennummern, existierende Felder, keine
 * Doppelten. Läuft bei jedem Laden – so verschwinden Kanten gelöschter Felder
 * von selbst, statt als Geisterlänge im Aufmaß zu bleiben.
 */
function normalizeBordbrettKanten() {
  migriereBordbrettLinien();
  const bekannt = new Set();
  state.sections.forEach(sec => (sec.bays || []).forEach(b => bekannt.add(String(b.id))));
  const gesehen = new Set();
  state.bordbrettKanten = (Array.isArray(state.bordbrettKanten) ? state.bordbrettKanten : [])
    .map(e => (e && typeof e === 'object') ? { b: e.b, k: +e.k } : null)
    .filter(e => e && e.b != null && e.k >= 0 && e.k <= 3 && bekannt.has(String(e.b)))
    .filter(e => {
      const key = bordbrettSchluessel(e.b, e.k);
      if (gesehen.has(key)) return false;
      gesehen.add(key);
      return true;
    });
  return state.bordbrettKanten;
}

/**
 * Übernimmt Bordbretter aus Zeichnungen der Vorgängerfassung.
 *
 * Dort wurde eine LINIE entlang der Lagenkante gezeichnet. Diese Linie lief
 * genau über die Feldkanten, die der Nutzer gemeint hat – also werden alle
 * Kanten markiert, die vollständig unter der Linie liegen. Damit bleibt die
 * gezeichnete Aussage erhalten, und alte Projekte öffnen sich mit sichtbaren
 * Bordbrettern statt mit einer leeren Zeichnung.
 *
 * Läuft genau einmal: danach ist `state.bordbretter` entfernt, und beim
 * nächsten Speichern steht nur noch die Kantenliste im Projekt.
 */
function migriereBordbrettLinien() {
  const linien = Array.isArray(state.bordbretter) ? state.bordbretter : null;
  delete state.bordbretter;
  if (!linien || !linien.length || !state.sections.length) return;
  if (!Array.isArray(state.bordbrettKanten)) state.bordbrettKanten = [];

  const els = computeLayout().filter(e => e.type === 'bay');
  // Toleranz: gut ein Drittel der Gerüsttiefe. Enger würde eine leicht
  // danebengesetzte Linie nichts mehr treffen, weiter würde sie auch die
  // gegenüberliegende Kante desselben Feldes einsammeln.
  const tol = Math.max(state.depth * PX_PER_M * 0.35, 8);

  const aufLinie = (pt, punkte) => {
    for (let i = 0; i + 1 < punkte.length; i++) {
      if (lotAufStrecke(pt, punkte[i], punkte[i + 1]).dist <= tol) return true;
    }
    return false;
  };

  linien.forEach(l => {
    const punkte = (l && Array.isArray(l.punkte) ? l.punkte : [])
      .filter(p => p && isFinite(p.x) && isFinite(p.y));
    if (punkte.length < 2) return;
    els.forEach(el => {
      const bay = state.sections[el.si] && state.sections[el.si].bays[el.bi];
      if (!bay) return;
      for (let k = 0; k < 4; k++) {
        const [p, q] = bayKante(el, k);
        // Die Kante gilt als gemeint, wenn sie auf ihrer ganzen Länge unter
        // der Linie liegt – ein bloßes Kreuzen reicht nicht.
        const treffer = [0.08, 0.3, 0.5, 0.7, 0.92].every(t =>
          aufLinie({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, punkte));
        if (treffer) setzeBordbrettKante(bay.id, k, true);
      }
    });
  });
}

/** Lotfußpunkt von `p` auf die Strecke a–b (inkl. Abstand). */
function lotAufStrecke(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const x = a.x + dx * t, y = a.y + dy * t;
  return { x, y, t, dist: Math.hypot(p.x - x, p.y - y) };
}

/**
 * Alle markierten Kanten mit ihrer Geometrie – bereits ENTDOPPELT.
 *
 * Nur sichtbare Felder zählen: ein ausgeblendeter Abschnitt darf im Aufmaß
 * nicht auftauchen, sonst stimmte die Summe nicht mit dem überein, was auf
 * dem Bildschirm und im PDF steht.
 *
 * @returns {Array<{bayId:*, k:number, si:number, laenge:number, p:Object, q:Object}>}
 */
function bordbrettKanten(els) {
  const liste = bordbrettKantenListe();
  if (!liste.length) return [];
  const markiert = new Set(liste.map(e => bordbrettSchluessel(e.b, e.k)));
  const gesehen = new Set();
  const out = [];
  (els || computeLayout()).forEach(el => {
    if (el.type !== 'bay') return;
    const bay = state.sections[el.si] && state.sections[el.si].bays[el.bi];
    if (!bay || !isBayVisible(bay)) return;
    for (let k = 0; k < 4; k++) {
      if (!markiert.has(bordbrettSchluessel(bay.id, k))) continue;
      const [p, q] = bayKante(el, k);
      const geo = kantenGeoSchluessel(p, q);
      if (gesehen.has(geo)) continue;      // gemeinsame Kante zweier Felder
      gesehen.add(geo);
      out.push({ bayId: bay.id, k, si: el.si, laenge: kantenLaenge(p, q), p, q });
    }
  });
  return out;
}

/** Gesamtlänge aller Bordbretter in m (volle Genauigkeit). */
function bordbrettGesamt(els) {
  return bordbrettKanten(els).reduce((s, e) => s + e.laenge, 0);
}

/**
 * Bordbrettlänge einer Feldmenge (Achse, Abschnitt oder alle Felder).
 *
 * Entdoppelt wird VOR dem Filtern: eine Kante, die sich zwei Felder teilen,
 * gehört genau einer Seite – und die Gesamtsumme bleibt in jedem Fall richtig.
 */
function bordbrettSummeFuer(bays, els) {
  const ids = new Set(bays.map(b => String(b.id)));
  return bordbrettKanten(els)
    .filter(e => ids.has(String(e.bayId)))
    .reduce((s, e) => s + e.laenge, 0);
}

/**
 * Bordbrett je Achse: `[{ idx, name, laenge }]`, nach Achsreihenfolge.
 * Kanten, deren Feld zu keiner Achse gehört (kann bei Altdaten vorkommen),
 * landen unter `idx: -1` – sie gehen damit in die Gesamtsumme ein, ohne
 * einer Achse untergeschoben zu werden.
 */
function bordbrettJeAchse(achsen, els) {
  const liste = achsen || achsenListe();
  const summen = new Map();
  bordbrettKanten(els).forEach(e => {
    const idx = achseVonSektion(liste, e.si);
    summen.set(idx, (summen.get(idx) || 0) + e.laenge);
  });
  return [...summen.entries()]
    .map(([idx, laenge]) => ({
      idx,
      name: liste[idx] ? liste[idx].name : 'Ohne Achse',
      laenge
    }))
    .sort((a, b) => a.idx - b.idx);
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
  if (!cur.umlauf || !cur.umlauf.length) delete cur.umlauf;
  if (Object.keys(cur).length) state.ecken[key] = cur;
  else delete state.ecken[key];
}

/**
 * Läuft die Gerüstlage der Sektion `si` an dieser AUSSENECKE um die Ecke herum?
 *
 * Das ist eine Festlegung des Nutzers, direkt am Eck-Symbol getroffen: zwei
 * Tipps, und der Zuschlag von einer Gerüsttiefe sitzt am Feld an der Ecke.
 * Früher ließ sich dasselbe zusätzlich aus einer gezeichneten Bordbretter-
 * Linie ableiten – mit dem Ergebnis, dass zwei Quellen dieselbe Frage
 * beantworteten und sich widersprechen konnten. Es gibt jetzt nur noch diese
 * eine.
 */
function eckLaeuftUm(key, si) {
  const sec = state.sections[si];
  const umlauf = eckWahl(key).umlauf;
  return !!(sec && Array.isArray(umlauf) && umlauf.some(id => String(id) === String(sec.id)));
}

/** Umlauf einer Seite an einer Außenecke ein-/ausschalten. */
function setEckUmlauf(key, secId, an) {
  const cur = (eckWahl(key).umlauf || []).map(String).filter(id => id !== String(secId));
  if (an) cur.push(String(secId));
  setEckWahl(key, { umlauf: cur.length ? cur : null });
  invalidateEckenCache();
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
  return p.join('|');
}

/** Verwirft die gemerkte Eckenliste. Nötig, wenn sich etwas ändert, das die
 *  Signatur zwar erfasst, aber innerhalb desselben Auswertungsdurchlaufs
 *  (z. B. beim Festlegen einer Ecke). */
function invalidateEckenCache() {
  _eckenCache = null; _eckenSig = null;
}

function eckenListeBerechnen() {
  const achsen = achsenListe();
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
    const durchSi = gewaehlt != null ? gewaehlt : vorschlagDurch;

    return {
      key, si: c.si, ni: c.ni, pts: c.pts,
      siEndet: c.siEndet, niEndet: c.niEndet,
      art, artAuto: c.kind,
      typBestaetigt: w.typ === 'aussen' || w.typ === 'innen',
      durchSi,
      fuellSi: durchSi === c.si ? c.ni : c.si,
      bestaetigt: gewaehlt != null,
      quelle: gewaehlt != null ? 'nutzer' : 'vorschlag'
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
      merke(eckFeldVon(e.durchSi, eckEndetHier(e, e.durchSi)), -innenWert,
            { key: e.key, art: 'innen', rolle: 'durchlaufend', wert: -innenWert });
      merke(eckFeldVon(e.fuellSi, eckEndetHier(e, e.fuellSi)), +innenWert,
            { key: e.key, art: 'innen', rolle: 'ausfuellend', wert: +innenWert });
    });
  }

  const eckWert = eckZuschlagWert();
  if (eckWert > 0) {
    // Außenecken, um die die Lage tatsächlich herumläuft – gezeichnet oder am
    // Eck-Dialog festgelegt (siehe eckLaeuftUm).
    eckenListe().forEach(e => {
      if (e.art !== 'aussen') return;
      [e.si, e.ni].forEach(si => {
        if (!eckLaeuftUm(e.key, si)) return;
        merke(eckFeldVon(si, eckEndetHier(e, si)), +eckWert,
              { key: e.key, art: 'aussen', rolle: 'umlaufend', wert: +eckWert });
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
        if (eckLaeuftUm(c.key, i)) return;   // schon feldgenau erfasst
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
  const achsen = achsenListe();
  const bbJeAchse = bordbrettJeAchse(achsen);
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
      if (e.art === 'innen') {
        if (inChain.has(e.durchSi))      rollen.push('durchlaufend');
        else if (inChain.has(e.fuellSi)) rollen.push('ausfüllend');
      } else if ([e.si, e.ni].some(si => inChain.has(si) && eckLaeuftUm(e.key, si))) {
        rollen.push('um die Außenecke');
      }
    });
    const bb = bbJeAchse.find(x => x.idx === a.idx);
    return { ...a, m, rechenweg: teile.join(' + '), rollen,
             bordbrett: bb ? bb.laenge : 0,
             hoehen: aufmassNachHoehe(a.bays, korr) };
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
const PDF_MM_PER_M_MAX = 45;     // höchstens 45 mm je Meter (≈ 1:22)

/* Maßstabsstufen für die Blatteinteilung, von „gewünscht" nach „gerade noch
   zumutbar". Ein zusätzliches Blatt kostet beim Lesen mehr als ein etwas
   kleinerer Maßstab: verkleinert wird deshalb stufenweise – aber nur so weit,
   wie es tatsächlich ein Blatt spart (siehe pdfPlanPages).

   Die Schriftgrößen sind in Punkt festgelegt und schrumpfen NICHT mit; die
   Felder rücken lediglich enger zusammen. Bei 8 mm je Meter (≈ 1:125) ist ein
   2,57-m-Feld noch 21 mm lang – genug für Maß, Feldname und die Bauteil-Badges,
   ohne dass die Beschriftung ins Nachbarfeld läuft. Weiter herunter zu gehen
   spart in der Praxis kaum noch Blätter, drängt die Beschriftungen aber
   spürbar zusammen.                                                          */
const PDF_MM_PER_M_STEPS = [11, 9, 8];

/* Höhe der wiederkehrenden Seitenelemente (mm). Bewusst knapp: was Kopf- und
   Fußzeile beanspruchen, fehlt der Zeichnung. Aus 17 + 11 + 9 mm sind
   14 + 7 + 5 mm geworden – rund 30 mm mehr Zeichnung auf jeder Planseite. */
const PDF_HEADER_H = 14;   // Projektzeile + Angaben + Trennstrich
const PDF_FOOTER_H = 7;    // nur die Seitenzahl
const PDF_LEGEND_H = 5;    // einzeilige Legende unter dem Plan

// Schriftgrößen in pt – bewusst fix, damit auf Papier nichts unter die
// Lesbarkeitsgrenze rutscht.
const PDF_FS_LEN   = 8.5;   // Feldlänge
const PDF_FS_H     = 7.5;   // Höhenangaben
const PDF_FS_LABEL = 7;     // Feldbezeichnung (A1 …)
const PDF_FS_BADGE = 6.5;   // Positions-Badges

/* ── Zwei Ausgaben desselben Dokuments ───────────────────────────────────────
   Früher standen hier drei „Designs", die sich in Farbbalken, Tabellenköpfen
   und Zebrastreifen unterschieden. Diese Gestaltungselemente gibt es nicht
   mehr – das Blatt besteht aus Zeichnung und Tabelle. Übrig bleibt die eine
   Unterscheidung, die auf der Baustelle wirklich zählt:

     farbe      – Positionen und Abschnitte in ihrer Farbe. Standard.
     monochrom  – reine Graustufen für Schwarz-Weiß-Drucker und Kopien;
                  Positionen werden über Grauwert und Kürzel unterschieden.  */

const PDF_THEMES = {
  farbe: {
    label: 'Farbe',
    desc: 'Positionen und Abschnitte in ihrer Farbe – wie auf dem Bildschirm.',
    accent:   [26, 74, 122],
    ink:      [23, 32, 42],
    inkSoft:  [96, 110, 124],
    rule:     [186, 196, 206],
    bayFill:  [226, 238, 250],
    bayStroke:[44, 111, 168],
    colored:  true
  },
  monochrom: {
    label: 'Schwarz-Weiß',
    desc: 'Reine Graustufen – für Schwarz-Weiß-Druck und Kopien.',
    accent:   [40, 40, 40],
    ink:      [20, 20, 20],
    inkSoft:  [105, 105, 105],
    rule:     [175, 175, 175],
    bayFill:  [240, 240, 240],
    bayStroke:[80, 80, 80],
    colored:  false
  }
};

const PDF_THEME_KEY = GK.pdfDesign;
const PDF_HIDDEN_KEY = GK.pdfMitAusgeblendeten;

function pdfThemeName() {
  const n = localStorage.getItem(PDF_THEME_KEY);
  // „technisch" und „kontrast" der Vorgängerfassung waren beide farbig.
  return PDF_THEMES[n] ? n : 'farbe';
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

/** Wie pdfFitFont, aber für eine PILLE: gemessen wird die Pille samt Rand
 *  (siehe pdfPill), nicht nur der Text. Ohne das ragte jede Pille um ihren
 *  Innenrand über das Feld hinaus und berührte die Pille des Nachbarfeldes. */
function pdfFitPill(doc, str, maxMM, pref, min) {
  let fs = pdfFitFont(doc, str, maxMM, pref, min);
  const pillW = () => doc.getTextWidth(str) + fs * 0.352778 * 0.8;
  const w = pillW();
  if (w > maxMM && fs > min) {
    fs = Math.max(min, fs * maxMM / w);
    doc.setFontSize(fs);
  }
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

/**
 * Kopfzeile: zwei Textzeilen und ein Haarstrich, sonst nichts.
 *
 * Vorher stand hier ein Farbbalken mit Akzentleiste, Dokumentart und
 * Blattangabe – vier Gestaltungselemente für zwei Angaben. Auf dem Blatt
 * zählt, um welches Projekt es geht und welches Blatt man in der Hand hält;
 * alles andere nahm der Zeichnung Platz weg.
 *
 * @returns {number} Oberkante des freien Inhaltsbereichs (mm)
 */
function pdfDrawHeader(ctx, opts = {}) {
  const { doc, theme, pdfW, margin } = ctx;
  const y = margin;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.setTextColor(...theme.ink);
  doc.text(ctx.title, margin, y + 4);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4);
  doc.setTextColor(...theme.inkSoft);
  doc.text(ctx.dateStr, pdfW - margin, y + 4, { align: 'right' });

  // Zweite Zeile: links die Angaben zum Gerüst, rechts das Blatt.
  if (opts.links)  doc.text(opts.links,  margin, y + 9);
  if (opts.rechts) doc.text(opts.rechts, pdfW - margin, y + 9, { align: 'right' });

  doc.setDrawColor(...theme.rule); doc.setLineWidth(0.3);
  doc.line(margin, y + 11.6, pdfW - margin, y + 11.6);
  return y + PDF_HEADER_H;
}

/** Fußzeile: nur die Seitenzahl. Alles andere steht schon oben. */
function pdfDrawFooter(ctx, pageNo, pageCount) {
  const { doc, theme, pdfW, pdfH, margin } = ctx;
  const y = pdfH - margin - PDF_FOOTER_H;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
  doc.setTextColor(...theme.inkSoft);
  doc.text(`Seite ${pageNo} von ${pageCount}`, pdfW - margin, y + 5, { align: 'right' });
}

/** Legendenzeile unter dem Plan: nur Farbe und Wort, ohne Kasten und ohne
 *  Überschrift. Sie erklärt die Bauteil-Plaketten in der Zeichnung – ohne sie
 *  bliebe ein „K"-Kürzel im Plan unverständlich. Liefert die verbrauchte Höhe. */
function pdfDrawLegend(ctx, y, entries) {
  const { doc, theme, pdfW, margin } = ctx;
  if (!entries.length) return 0;

  let x = margin;
  const maxX = pdfW - margin;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  entries.forEach(e => {
    const w = doc.getTextWidth(e.label) + 8.5;
    if (x + w > maxX) return;              // was nicht passt, entfällt still
    const col = pdfCol(theme, e.color);
    doc.setFillColor(...col);
    doc.setDrawColor(...col);
    if (e.shape === 'line') {
      doc.setLineWidth(0.9);
      doc.line(x, y, x + 4, y);
    } else {
      doc.setLineWidth(0.2);
      doc.rect(x, y - 1.7, 3.6, 3.4, 'FD');
    }
    doc.setTextColor(...theme.ink);
    doc.text(e.label, x + 5.6, y + 0.6, { baseline: 'middle' });
    x += w;
  });
  return PDF_LEGEND_H;
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
  if (bordbrettKantenListe().length) {
    entries.push({ label: 'Bordbrett', color: '#0f8f8e', shape: 'line' });
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

  // 3a. Verbreiterungen: Modul-Abstützungen gestrichelt (keine begehbare Lage),
  //     „Rahmen mit Rohr" als Strebendreieck. Sie gehören in den Plan, weil sie
  //     die Konstruktion verändern – nicht nur eine Menge in der Tabelle sind.
  bayEls.forEach(el => {
    const bay = state.sections[el.si].bays[el.bi];
    (bay.positions || []).forEach(pos => {
      const meta = POS_BY_KEY[pos.cat];
      if (!meta) return;
      const col = pdfCol(theme, pdfHex(meta.color));
      if (meta.feld) {
        const ab = abstuetzPoly(el, pos, bay);
        if (!ab) return;
        doc.setDrawColor(...col); doc.setLineWidth(0.45);
        if (doc.setLineDashPattern) doc.setLineDashPattern([1.4, 1.0], 0);
        drawClipped(ab.pts, 'D');
        if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
      } else if (meta.strebe) {
        const s = rahmenRohrLinien(el);
        doc.setDrawColor(...col);
        const seg = (pts, w) => {
          const c = clipSeg(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
          if (!c) return;
          doc.setLineWidth(w);
          const a = XY(c[0], c[1]), b = XY(c[2], c[3]);
          doc.line(a.x, a.y, b.x, b.y);
        };
        seg(s.rohr, 0.5);
        seg(s.rahmen, 0.8);
      }
    });
  });

  // 3b. Bordbretter: die markierten Gerüstkanten. Sie gehören in den Plan,
  //     weil die Menge im Aufmaß genau daraus folgt – ohne sie stünde dort
  //     eine Zahl ohne Beleg. Kräftiger Strich, aber nur auf der Kante: das
  //     Gerüst darunter bleibt vollständig lesbar.
  const bbKanten = bordbrettKanten(layout);
  if (bbKanten.length) {
    doc.setDrawColor(...pdfCol(theme, [15, 143, 142]));
    doc.setLineWidth(1.1);
    bbKanten.forEach(k => {
      const seg = clipSeg(k.p.x, k.p.y, k.q.x, k.q.y);
      if (!seg) return;
      const a = XY(seg[0], seg[1]), b = XY(seg[2], seg[3]);
      doc.line(a.x, a.y, b.x, b.y);
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
    const lblFs = pdfFitPill(doc, label, maxTxt, PDF_FS_LABEL, 5.5);
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
    const hStil = {
      fill: pdfCol(theme, [240, 249, 243]), stroke: pdfCol(theme, [31, 122, 61]),
      col: pdfCol(theme, [22, 92, 45]), fs: PDF_FS_H
    };
    if (hL || hR) {
      const beide = hL && hR && hL !== hR;
      const zusammen = beide ? hL + ' | ' + hR : 'h ' + (hL || hR);
      // Zwei verschiedene Höhen ergeben eine lange Pille. Passt sie nicht in
      // die Feldbreite, werden zwei kurze daraus („L …" / „R …") – lieber
      // übereinander als in das Nachbarfeld hinein.
      doc.setFont('helvetica', 'bold'); doc.setFontSize(PDF_FS_H);
      const passt = doc.getTextWidth(zusammen) + PDF_FS_H * 0.352778 * 0.8 <= maxTxt;
      if (beide && !passt) {
        lines.push({ text: 'L ' + hL, ...hStil });
        lines.push({ text: 'R ' + hR, ...hStil });
      } else {
        lines.push({ text: zusammen, ...hStil });
      }
    }
    (bay.positions || []).forEach(pos => {
      const meta = POS_BY_KEY[pos.cat];
      const col  = pdfCol(theme, pdfHex((meta && meta.color) || '#333333'));
      lines.push({ text: posBadge(pos, bay), kurz: posBadgeKurz(pos),
                   fill: [255, 255, 255], stroke: col, col, fs: PDF_FS_BADGE });
    });

    // Bei einer Verbreiterung beginnt der Stapel hinter deren Ausladung – sonst
    // läge die Beschriftung auf der gezeichneten Abstützung.
    let dist = depthMM / 2 + verbreiterungAusladung(el, bay) * s;
    lines.forEach(ln => {
      doc.setFont('helvetica', 'bold');
      // Passt die Beschriftung selbst in der kleinsten Schrift nicht in die
      // Feldbreite, wird auf die Kurzform ausgewichen – die Menge steht in den
      // Aufmaß-Tabellen, ein in das Nachbarfeld ragender Badge nirgends.
      let text = ln.text;
      if (ln.kurz && ln.kurz !== text) {
        doc.setFontSize(5.5);
        if (doc.getTextWidth(text) + 5.5 * 0.352778 * 0.8 > maxTxt) text = ln.kurz;
      }
      const fs = pdfFitPill(doc, text, maxTxt, ln.fs, 5.5);
      const fsMM = fs * 0.352778;
      const h  = fsMM * 1.5;
      dist += h * 0.62;
      const cx = c.x + ox * dist, cy = c.y + oy * dist;
      out.push({ text, cx, cy, rot, fs, fill: ln.fill, stroke: ln.stroke, col: ln.col,
                 rect: mkRect(cx, cy, doc.getTextWidth(text) + fsMM * 0.8, h, rot) });
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
 * Teilt die Felder auf Blätter auf – in der Reihenfolge, in der ein Betrachter
 * den Plan liest: REIHENWEISE VON OBEN NACH UNTEN, innerhalb einer Reihe VON
 * LINKS NACH RECHTS.
 *
 * Ablauf:
 *  1. REIHE (Band) bilden: das oberste noch freie Feld gibt die Oberkante vor;
 *     die Reihe nimmt alles mit, was bei Blatthöhe vollständig darunter passt.
 *  2. Innerhalb der Reihe von links nach rechts Blätter füllen: das am
 *     weitesten links stehende freie Feld gibt die linke Blattkante vor, das
 *     Blatt nimmt alles mit, was bei Blattbreite vollständig hineinpasst.
 *  3. ZUSAMMENLEGEN: solange zwei Blätter zusammen noch auf EIN Blatt passen,
 *     werden sie verschmolzen. Das räumt die typischen Reste ab (etwa ein
 *     einzelnes Feld, das durch die Reihenbildung allein übrig blieb).
 *
 * Damit landen so viele Felder wie möglich auf einem Blatt, und die Aufteilung
 * bleibt nachvollziehbar: Blatt 2 steht rechts neben Blatt 1, nicht irgendwo.
 *
 * @param {Array<{el:Object,b:Object}>} boxes  Felder mit ihrer Hüllbox
 * @returns {Array<{reihe:number, els:Array, b:Object}>}
 */
function pdfPlanGroups(boxes, useW, useH) {
  const huelle = list => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(o => {
      minX = Math.min(minX, o.b.minX); maxX = Math.max(maxX, o.b.maxX);
      minY = Math.min(minY, o.b.minY); maxY = Math.max(maxY, o.b.maxY);
    });
    return { minX, minY, maxX, maxY };
  };

  const offen = boxes.slice().sort((a, b) => (a.b.minY - b.b.minY) || (a.b.minX - b.b.minX));
  const gruppen = [];
  let reihe = 0;
  while (offen.length) {
    // ── 1. Reihe von oben ──────────────────────────────────────────────────
    const oben = offen[0].b.minY;
    const inReihe = [], darunter = [];
    offen.forEach((o, i) =>
      (i === 0 || o.b.maxY <= oben + useH ? inReihe : darunter).push(o));
    offen.length = 0; offen.push(...darunter);

    // ── 2. Reihe von links nach rechts auf Blätter verteilen ───────────────
    inReihe.sort((a, b) => (a.b.minX - b.b.minX) || (a.b.minY - b.b.minY));
    while (inReihe.length) {
      const links = inReihe[0].b.minX;
      const aufsBlatt = [], rest = [];
      inReihe.forEach((o, i) =>
        (i === 0 || o.b.maxX <= links + useW ? aufsBlatt : rest).push(o));
      gruppen.push({ reihe, els: aufsBlatt, b: huelle(aufsBlatt) });
      inReihe.length = 0; inReihe.push(...rest);
    }
    reihe++;
  }

  // ── 3. Zusammenlegen, was gemeinsam auf ein Blatt passt ──────────────────
  for (let wieder = true; wieder;) {
    wieder = false;
    for (let i = 0; i < gruppen.length && !wieder; i++) {
      for (let j = i + 1; j < gruppen.length; j++) {
        const a = gruppen[i].b, b = gruppen[j].b;
        const v = { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
                    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
        if (v.maxX - v.minX > useW || v.maxY - v.minY > useH) continue;
        gruppen[i] = { reihe: Math.min(gruppen[i].reihe, gruppen[j].reihe),
                       els: gruppen[i].els.concat(gruppen[j].els), b: v };
        gruppen.splice(j, 1);
        wieder = true;
        break;
      }
    }
  }

  // Leserichtung wiederherstellen: Reihe für Reihe von links nach rechts.
  gruppen.sort((a, b) => (a.reihe - b.reihe) || (a.b.minX - b.b.minX) || (a.b.minY - b.b.minY));
  return gruppen;
}

/** Kurzbeschreibung der Felder eines Blattes für die Kopfzeile, z. B.
 *  „Felder A1 – A9". Aufgezählt wird in Leserichtung (links → rechts), damit
 *  die Angabe zur Anordnung auf dem Blatt passt. */
function pdfBlattFelder(els) {
  const namen = els
    .map(el => ({ el, b: elBBox(el) }))
    .sort((a, b) => (a.b.minX - b.b.minX) || (a.b.minY - b.b.minY))
    .map(o => bayLabel(state.sections[o.el.si], o.el.bi));
  if (!namen.length) return 'keine Felder';
  if (namen.length === 1) return 'Feld ' + namen[0];
  if (namen.length === 2) return `Felder ${namen[0]}, ${namen[1]}`;
  return `Felder ${namen[0]} – ${namen[namen.length - 1]}`;
}

/**
 * Ermittelt die Papierseiten-Aufteilung des Plans.
 *
 * Grundsätze der Aufteilung:
 *  • So WENIGE Blätter wie möglich. Ein Gerüst, das bei noch zumutbarem
 *    Maßstab auf ein Blatt passt, bekommt genau ein Blatt – ein zweites Blatt
 *    wiegt beim Lesen schwerer als ein etwas kleinerer Maßstab. Deshalb wird
 *    der Maßstab stufenweise verkleinert (siehe PDF_MM_PER_M_STEPS) und nur so
 *    weit, wie es tatsächlich Blätter spart.
 *  • Aufgeteilt wird in LESERICHTUNG: reihenweise von oben nach unten, in der
 *    Reihe von links nach rechts (siehe pdfPlanGroups) – nicht Feld für Feld
 *    nach Nähe, wie es die frühere Fassung tat.
 *  • EIN gemeinsamer Maßstab für alle Planseiten – nur so lassen sich die
 *    Blätter nebeneinanderlegen und Längen von Blatt zu Blatt vergleichen.
 *  • ALLE Ausschnitte sind gleich groß; jedes Feld liegt vollständig auf genau
 *    einem Blatt – nie angeschnitten.
 *  • Zusätzlich wird notiert, welche FREMDEN Felder in den Ausschnitt ragen;
 *    die zeichnet pdfDrawPlan blass als Anschluss-Kontext (Blattschnitt).
 *
 * @returns {{pages:Array, bounds:Object|null, scale:number, tiled:boolean}}
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

  const sMax  = PDF_MM_PER_M_MAX / PX_PER_M;
  const stufen = PDF_MM_PER_M_STEPS.map(mm => mm / PX_PER_M);
  const sKlein = stufen[stufen.length - 1];
  const sFit  = Math.min(availW / full.w, availH / full.h);

  // Passt alles auf EIN Blatt – notfalls in der kleinsten Maßstabsstufe?
  // Dann genau eine Planseite. Ein einziges Blatt ist der übersichtlichste
  // Plan, den es gibt; der Maßstab wird dafür bewusst kleiner genommen.
  if (sFit >= sKlein) {
    return { pages: [{ win: full, cbox: full, els: bayEls, ghosts: [] }],
             bounds: full, scale: Math.min(sFit, sMax), tiled: false, cols: 1, rows: 1 };
  }

  const boxes = bayEls.map(el => ({ el, b: elBBox(el) }));

  /* Für jede Maßstabsstufe die Aufteilung ermitteln und die mit den WENIGSTEN
     Blättern nehmen. Bei Gleichstand gewinnt die erste (größte) Stufe – kleiner
     wird der Maßstab also nur, wo er wirklich ein Blatt spart. */
  let best = null;
  stufen.forEach(s0 => {
    // Nutzbarer Bereich OHNE den Rand, der rings um den Inhalt frei bleiben
    // soll. Ohne diesen Abzug ragte der Plan um bis zu zwei Randbreiten in die
    // Fußzeile.
    const w0 = availW / s0, h0 = availH / s0;
    const useW = Math.max(w0 - 2 * pad, w0 * 0.5);
    const useH = Math.max(h0 - 2 * pad, h0 * 0.5);
    const gruppen = pdfPlanGroups(boxes, useW, useH);
    if (!best || gruppen.length < best.gruppen.length) best = { gruppen, s0 };
  });

  // Gemeinsamer Maßstab für ALLE Blätter: so groß wie möglich, aber so, dass
  // der Inhalt jedes Blattes noch vollständig passt. Ein einheitlicher Maßstab
  // ist Voraussetzung dafür, dass sich Längen von Blatt zu Blatt vergleichen
  // lassen.
  const gruppen = best.gruppen;
  let maxW = 0, maxH = 0;
  gruppen.forEach(g => {
    maxW = Math.max(maxW, g.b.maxX - g.b.minX + 2 * pad);
    maxH = Math.max(maxH, g.b.maxY - g.b.minY + 2 * pad);
  });
  const scale = Math.min(sMax,
    Math.max(best.s0, Math.min(availW / Math.max(maxW, 1), availH / Math.max(maxH, 1))));
  const winW = availW / scale;
  const winH = availH / scale;

  const pages = gruppen.map(g => {
    const cx = (g.b.minX + g.b.maxX) / 2, cy = (g.b.minY + g.b.maxY) / 2;
    const win = { minX: cx - winW / 2, minY: cy - winH / 2, w: winW, h: winH };
    // Hüllbox des tatsächlichen Blattinhalts – die Blattübersicht setzt ihre
    // Blattnummer dorthin, wo auch wirklich etwas steht.
    const cbox = { minX: g.b.minX - pad, minY: g.b.minY - pad,
                   w: (g.b.maxX - g.b.minX) + 2 * pad, h: (g.b.maxY - g.b.minY) + 2 * pad };
    const own = new Set(g.els.map(o => o.el));
    // Anschluss-Felder: liegen sichtbar im Ausschnitt, gehören aber zu einem
    // anderen Blatt – sie werden blass als Kontext gezeichnet.
    const ghosts = boxes.filter(o =>
      !own.has(o.el) &&
      o.b.maxX > win.minX && o.b.minX < win.minX + win.w &&
      o.b.maxY > win.minY && o.b.minY < win.minY + win.h).map(o => o.el);
    return { win, cbox, els: g.els.map(o => o.el), ghosts, reihe: g.reihe };
  });

  return { pages, bounds: full, scale, tiled: true,
           reihen: pages.reduce((n, p) => Math.max(n, p.reihe + 1), 0) };
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
  lbl.textContent = 'Ausgabe';
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
  note.textContent = 'Seite 1 zeigt die Zeichnung, danach folgt das Aufmaß. '
                   + 'Weitere Blätter entstehen nur, wenn die Zeichnung sonst zu '
                   + 'klein zum Lesen würde oder die Tabelle voll ist.';
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

/**
 * Zeilen des Aufmaßes für eine Feldmenge.
 *
 * Eine Zeile ist genau das, was auf einem Aufmaßblatt steht: Bezeichnung,
 * Menge, Einheit. Mehr braucht es nicht – der Rechenweg gehört auf die
 * Zeichnung, nicht in die Mengenermittlung.
 *
 * Positionen mit mehreren Mengenarten (z. B. ein Bauteil, das teils in Metern
 * und teils in Stück erfasst ist) ergeben mehrere Zeilen. Mengen, die auf
 * 0,00 gerundet würden, entfallen: eine Null sagt nichts aus und macht das
 * Blatt nur länger.
 *
 * @param {Array} bays        Felder der Achse bzw. des Abschnitts
 * @param {Array} [els]       vorberechnetes Layout (spart Arbeit im PDF)
 * @returns {Array<{bez:string, menge:number, einheit:string}>}
 */
function aufmassZeilen(bays, els) {
  const zeilen = [];
  const nimm = (bez, menge, einheit) => {
    if (!(Math.abs(menge) >= 0.005)) return;      // würde als 0,00 erscheinen
    // Dieselbe Bezeichnung in derselben Einheit ist EINE Position. Konsolen
    // etwa werden intern nach Abrechnungsart getrennt geführt („pro Lage" /
    // „in Metern"); auf dem Aufmaßblatt stehen beide in Metern und gehören
    // damit in eine Zeile.
    const da = zeilen.find(z => z.bez === bez && z.einheit === einheit);
    if (da) { da.menge += menge; return; }
    zeilen.push({ bez, menge, einheit });
  };

  const m = computeAufmass(bays);
  nimm('Gerüstfläche', m.flaeche, 'm²');

  aggregatePositions(bays).forEach(a => {
    const vorher = zeilen.length;
    // „Konsole 0,30 (Lagen)" ist eine Angabe über den Rechenweg, keine
    // Bezeichnung der Position – auf dem Blatt steht „Konsole 0,30".
    const label = a.label.replace(/\s*\((?:Lagen|m)\)$/, '');
    // Steigende Meter stehen für sich – ein Treppenturm wird nicht in
    // laufenden Metern abgerechnet.
    const stgm = a.qtyByUnit.stgm || 0;
    nimm(label, stgm, 'Stg. m');
    nimm(label, a.qtyByUnit.m2 || 0, 'm²');
    // Laufende Meter: eingetragene Meterwerte plus die aus Lagen × Feldlänge
    // errechneten (Konsolen, Innengeländer …).
    nimm(label, (a.meters || 0) - stgm, 'm');
    nimm(label, a.qtyByUnit.stk || 0, 'Stk');
    // Bauteile, die nur gezählt werden (Modul-Abstützung ohne eigene Menge),
    // sonst fielen sie ganz aus dem Aufmaß.
    if (zeilen.length === vorher) nimm(label, a.n, 'Stk');
  });

  nimm('Bordbrett', bordbrettSummeFuer(bays, els), 'm');
  return zeilen;
}

/**
 * Baut das PDF: Zeichnung, dann Aufmaß.
 *
 * Aufbau des Dokuments – bewusst kurz gehalten:
 *   Seite 1 (…n)  die Gerüstzeichnung, so groß wie das Blatt es zulässt
 *   Seite 2 (…n)  das Aufmaß je Achse bzw. Abschnitt, danach die Gesamtsumme
 *   ggf.          Notizen, wenn welche erfasst sind
 *
 * Mehr Planseiten entstehen NUR, wenn die Zeichnung bei lesbarem Maßstab
 * nicht auf ein Blatt passt (siehe pdfPlanPages); mehr Aufmaßseiten nur, wenn
 * die Tabelle wirklich voll ist. Eine Achse bekommt niemals allein deshalb
 * ein eigenes Blatt, weil sie eine Achse ist.
 */
async function buildPdfDocument(themeName) {
  const { jsPDF } = window.jspdf;
  const theme  = PDF_THEMES[themeName] || PDF_THEMES[pdfThemeName()];
  const layout = computeLayout();
  const margin = PDF_MARGIN;

  // Nutzbare Fläche einer PLANSEITE = Blatt − Rand − Kopf − Legende − Fuß.
  // Muss EXAKT der später gezeichneten Fläche entsprechen (siehe `area` weiter
  // unten), sonst rechnet die Seitenaufteilung mit mehr Platz, als beim
  // Zeichnen zur Verfügung steht, und der Plan läuft in die Fußzeile.
  const PLAN_GAP = 2;   // Luft zwischen Zeichnung und Legende/Fußzeile
  const legend  = pdfLegendEntries();
  const legendH = legend.length ? PDF_LEGEND_H : 0;
  const chromeH = PDF_HEADER_H + legendH + PLAN_GAP + PDF_FOOTER_H;

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
  const allBays     = visibleBaysFlat();
  const nHiddenBays = allBaysFlat().length - allBays.length;
  const dateStr     = new Date().toLocaleDateString('de-DE');
  const title       = state.project || 'Gerüst-Aufmaß';

  const ctx = { doc, theme, pdfW, pdfH, margin, title, dateStr };
  const contentBottom = pdfH - margin - PDF_FOOTER_H;

  // Kopfzeile links: die Angaben, die für das ganze Blatt gelten.
  const kopfLinks = `Gerüsttiefe ${fmtQty(state.depth)} m   ·   `
    + `${allBays.length} Feld${allBays.length === 1 ? '' : 'er'}`
    + (nHiddenBays ? `   ·   ${nHiddenBays} ausgeblendet (nicht enthalten)` : '');

  // Seitenbuchhaltung: jede Seite bekommt am Ende ihre Fußzeile mit der
  // endgültigen Gesamtzahl (die steht erst fest, wenn alles gezeichnet ist).
  let firstPage = true;
  const startPage = (opts = {}) => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    return pdfDrawHeader(ctx, { links: kopfLinks, ...opts });
  };

  // ── Planseiten ──────────────────────────────────────────────────────────
  if (!plan.pages.length) {
    const top = startPage();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    doc.setTextColor(...theme.inkSoft);
    doc.text('Keine Gerüstfelder erfasst.', margin, top + 10);
  } else {
    const scaleTxt = 'Maßstab ca. 1:' + Math.round(10 / plan.scale);
    plan.pages.forEach((pg, i) => {
      // Auf dem Blatt steht, WELCHE Felder es zeigt – erst damit ist die
      // Aufteilung nachvollziehbar und ein Blatt am Bau wiederfindbar.
      const top = startPage({
        rechts: plan.tiled
          ? `${scaleTxt}   ·   Blatt ${i + 1} von ${plan.pages.length}   ·   ${pdfBlattFelder(pg.els)}`
          : scaleTxt
      });

      const area = { x: margin, y: top, w: availW,
                     h: contentBottom - top - PLAN_GAP - legendH };
      // Die Mini-Orientierungskarte ist eine Sperrzone: pdfDrawPlan platziert
      // sie selbst (dort sind die Beschriftungen bekannt), hält sie frei und
      // zeichnet sie zum Schluss darüber. Nur bei mehreren Blättern – auf
      // einem einzelnen Blatt gäbe es nichts zu verorten.
      const lw = Math.min(52, availW * 0.28);
      pdfDrawPlan(doc, pg.win, area, plan.scale, pg.els, layout, false, {
        theme, ghosts: pg.ghosts,
        locator: plan.tiled
          ? { w: lw, h: lw * 0.62, bounds: plan.bounds,
              caption: `LAGE IM GESAMTPLAN · BLATT ${i + 1}` }
          : null
      });
      if (legendH) pdfDrawLegend(ctx, contentBottom - 1.5, legend);
    });
  }

  /* ── Aufmaß ──────────────────────────────────────────────────────────────
     Gegliedert nach ABSCHNITT, sobald welche angelegt sind – das ist die vom
     Nutzer selbst gewählte Struktur und trägt seine Namen. Ohne Abschnitte
     bleibt es bei den ACHSEN, also den Wänden, die die Zeichnung ohnehin
     hergibt.

     Der Platz wird gerechnet, nicht geraten: ein Block kommt auf dieselbe
     Seite, solange er dort vollständig Platz hat; sonst beginnt eine neue.
     Wird ein langer Block doch getrennt, wiederholt sich der Spaltenkopf.  */
  if (allBays.length) {
    const gruppen = abschnitteList().length
      ? baysByAbschnitt().map(g => ({
          titel: g.abschnitt ? g.abschnitt.name : 'Ohne Abschnitt',
          bays: g.bays
        }))
      : aufmassAchsen().map(a => ({
          titel: /^achse/i.test(a.name) ? a.name : `Achse ${a.name}`,
          bays: a.bays
        }));

    const bloecke = gruppen
      .map(g => ({ ...g, zeilen: aufmassZeilen(g.bays, layout) }))
      .filter(g => g.zeilen.length);

    // Spalten: Position, Bezeichnung, Menge, Einheit – mehr steht auf einem
    // Aufmaßblatt nicht.
    const COLS = [
      { t: 'Pos.',        w: 0.09, a: 'left'  },
      { t: 'Bezeichnung', w: 0.55, a: 'left'  },
      { t: 'Menge',       w: 0.22, a: 'right' },
      { t: 'Einheit',     w: 0.14, a: 'left'  }
    ];
    const cx = []; let acc = margin;
    COLS.forEach(c => { cx.push(acc); acc += c.w * availW; });
    const zelle = (i, txt, y) => {
      const c = COLS[i];
      const x = c.a === 'right' ? cx[i] + c.w * availW - 2 : cx[i] + 2;
      doc.text(txt, x, y, { align: c.a });
    };

    const ZEILE_H = 6.2, KOPF_H = 6.4, TITEL_H = 7.5, BLOCK_ABSTAND = 4;

    let ay = 0;

    /* Der Spaltenkopf steht EINMAL je Seite, nicht einmal je Achse. Vorher
       kostete jeder Block Titel + Spaltenkopf + Trennstrich – bei vielen
       kurzen Abschnitten mehr Platz als die Mengen selbst, und das Blatt war
       nach fünf Achsen voll. Auf einer neuen Seite wird er wiederholt, sonst
       stünden dort Zahlen ohne Spaltenbezeichnung. */
    const spaltenKopf = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8);
      doc.setTextColor(...theme.inkSoft);
      COLS.forEach((c, i) => zelle(i, c.t, ay + 4));
      ay += KOPF_H;
      doc.setDrawColor(...theme.rule); doc.setLineWidth(0.3);
      doc.line(margin, ay, margin + availW, ay);
      ay += 1.5;
    };

    const neueAufmassSeite = () => {
      ay = startPage({ rechts: 'Aufmaß' }) + 4;
      spaltenKopf();
    };
    neueAufmassSeite();

    // Platz, den ein Block auf einem FRISCHEN Blatt hätte.
    const platzAufLeererSeite = contentBottom - (margin + PDF_HEADER_H + 4 + KOPF_H + 1.5);

    const blockTitel = (txt, fortsetzung) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.6);
      doc.setTextColor(...theme.ink);
      doc.text(fortsetzung ? txt + ' (Fortsetzung)' : txt, margin, ay + 4.4);
      ay += TITEL_H;
    };

    const zeichneBlock = (titel, zeilen) => {
      const gesamtH = TITEL_H + zeilen.length * ZEILE_H + BLOCK_ABSTAND;
      const platz   = contentBottom - ay;
      // Der Block wandert nur dann auf ein neues Blatt, wenn er dort auch
      // wirklich ganz hineinpasst – sonst wäre der Umbruch reine Verschwendung.
      if (gesamtH > platz && gesamtH <= platzAufLeererSeite) neueAufmassSeite();
      blockTitel(titel, false);
      let nr = 0;
      zeilen.forEach(z => {
        if (ay + ZEILE_H > contentBottom) {
          neueAufmassSeite();
          blockTitel(titel, true);
        }
        nr++;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.setTextColor(...theme.ink);
        zelle(0, String(nr), ay + 4);
        zelle(1, z.bez, ay + 4);
        doc.setFont('helvetica', 'bold');
        zelle(2, fmtQty(z.menge), ay + 4);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...theme.inkSoft);
        zelle(3, z.einheit, ay + 4);
        ay += ZEILE_H;
      });
      doc.setDrawColor(...theme.rule); doc.setLineWidth(0.2);
      doc.line(margin, ay, margin + availW, ay);
      ay += BLOCK_ABSTAND;
    };

    bloecke.forEach(b => zeichneBlock(b.titel, b.zeilen));

    // ── Gesamt ────────────────────────────────────────────────────────────
    // Über ALLE Felder gerechnet, nicht als Summe der Blöcke: eine Außenecke
    // zählt bei beiden angrenzenden Seiten, und ein Bordbrett zwischen zwei
    // Abschnitten gehört nur einmal in die Summe.
    if (bloecke.length > 1) {
      const gesamt = aufmassZeilen(allBays, layout);
      if (gesamt.length) zeichneBlock('Gesamt', gesamt);
    }

    // Grundlage der Rechnung – eine Zeile, klein, am Ende. Ohne sie wäre nicht
    // nachvollziehbar, welche Zuschläge in den Zahlen stecken.
    const grundlage = aufmassRuleText();
    if (grundlage) {
      if (ay + 8 > contentBottom) neueAufmassSeite();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
      doc.setTextColor(...theme.inkSoft);
      doc.splitTextToSize('Grundlage: ' + grundlage, availW)
        .forEach(line => { doc.text(line, margin, ay + 3); ay += 3.4; });
    }
  }

  // ── Notizen ────────────────────────────────────────────────────────────
  // Nur, wenn welche erfasst sind – und im Anschluss an das Aufmaß, nicht auf
  // einem eigenen Blatt.
  const notizen = [];
  state.sections.forEach(sec => {
    sec.bays.forEach((bay, bi) => {
      if (isBayVisible(bay) && (bay.note || '').trim()) {
        notizen.push({ label: bayLabel(sec, bi), note: bay.note.trim() });
      }
    });
  });
  if (notizen.length) {
    let ny = startPage({ rechts: 'Notizen' }) + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...theme.ink);
    doc.text('Notizen', margin, ny);
    ny += 7;
    notizen.forEach(({ label, note }) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lines = doc.splitTextToSize(note, availW - 26);
      const blockH = Math.max(6, lines.length * 4.4) + 2.5;
      if (ny + blockH > contentBottom) ny = startPage({ rechts: 'Notizen (Fortsetzung)' }) + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.setTextColor(...theme.ink);
      doc.text(label, margin, ny);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...theme.inkSoft);
      doc.text(lines, margin + 26, ny);
      ny += blockH;
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

/* ── Ansicht / Handy-Modus ───────────────────────────────────────────────────
   Die Darstellung kennt zwei Ausprägungen:

     „iphone"  Handy-Modus: Seitenleiste aus, Werkzeuge nur mit Symbol, das
               Werkzeug-Menü fährt als Blatt von unten ein, die Feldliste zieht
               dort mit ein. Die Zeichenfläche bekommt den ganzen Rest.
     „ipad"    Tablet/Desktop: Feldliste links, Werkzeug-Menü rechts angedockt.

   WAS gilt, entscheidet der Nutzer – nicht die App allein. Die Wahl steht im
   Werkzeug-Menü unter „Ansicht" und kennt drei Werte:

     'auto'    Bildschirm entscheidet (Vorgabe)
     'handy'   immer Handy-Modus – auch auf dem iPad, z. B. um die
               Zeichenfläche maximal groß zu bekommen
     'tablet'  nie Handy-Modus

   Eine frühere Fassung schrieb den ERKANNTEN Modus in denselben Schlüssel, aus
   dem sie ihn auch wieder las. Wer einmal in einem schmalen Fenster war, blieb
   danach dauerhaft im Handy-Modus. Deshalb liegt die Wahl jetzt in einem
   eigenen Schlüssel; `GK.geraetemodus` trägt nur noch das Ergebnis.        */

const HANDY_MAX_BREITE = 480;   // px – schmaler gilt als Handy (Hochformat)
const HANDY_MAX_HOEHE  = 450;   // px – flacher gilt als Handy (Querformat)

const ANSICHT_WAHLEN = ['auto', 'handy', 'tablet'];

/** Die ausdrückliche Wahl des Nutzers (Vorgabe: 'auto'). */
function getAnsichtWahl() {
  const v = localStorage.getItem(GK.ansichtsmodus);
  return ANSICHT_WAHLEN.includes(v) ? v : 'auto';
}

function setAnsichtWahl(v) {
  localStorage.setItem(GK.ansichtsmodus, ANSICHT_WAHLEN.includes(v) ? v : 'auto');
  applyMode();
  renderWzAnsicht();
}

/** Was der Bildschirm hergibt – Hochformat über die Breite, Querformat über
 *  die Höhe (ein liegendes Handy ist breit, aber nur ~390 px hoch). */
function erkannterModus() {
  return (window.innerWidth <= HANDY_MAX_BREITE || window.innerHeight <= HANDY_MAX_HOEHE)
    ? 'iphone' : 'ipad';
}

/** Der tatsächlich geltende Modus aus Wahl + Bildschirm. */
function effektiverModus() {
  const w = getAnsichtWahl();
  if (w === 'handy')  return 'iphone';
  if (w === 'tablet') return 'ipad';
  return erkannterModus();
}

/** Bisheriger Name, weiterhin gültig: der zuletzt angewendete Modus. */
function getMode() { return document.body.dataset.mode || localStorage.getItem(GK.geraetemodus); }

function applyMode() {
  const m = effektiverModus();
  const vorher = document.body.dataset.mode;
  document.body.dataset.mode = m;
  localStorage.setItem(GK.geraetemodus, m);
  if (vorher !== m) {
    syncSidePanelOrt();
    syncToolbarOrt();
    // Die Zeichenfläche ändert dabei ihre Größe – Kamera nachziehen.
    _vpCache = null;
    if (autoFit) fitCameraToContent();
    applyCamera();
  }
  return m;
}

/* Im Handy-Modus haben nicht alle Werkzeuge nebeneinander Platz, ohne dass
   Knöpfe aus dem Bildschirm laufen oder unter 44 px schrumpfen. Bordbrett,
   Projekt und PDF ziehen deshalb ins Werkzeug-Menü um – als DIESELBEN Knöpfe,
   mit denselben Ereignissen. Es gibt keine zweite PDF- oder Projekt-Taste.

   Wiedereinsetzen geschieht rückwärts entlang der Ankerliste: so ist der
   Anker beim Einhängen garantiert schon wieder an seinem Platz.            */
const HANDY_AUSGELAGERT = [
  ['bordbrettBtn',    'tbTrennerProjekt'],
  ['tdMenuBtn',       'td-exportPdfBtn'],
  ['td-exportPdfBtn', 'tbTrennerWerkzeug']
];

function syncToolbarOrt() {
  const slot  = document.getElementById('wzAktionenSlot');
  const tools = document.querySelector('#toolbar .tb-tools');
  const box   = document.getElementById('wzAktionen');
  if (!slot || !tools) return;
  const handy = document.body.dataset.mode === 'iphone';

  if (handy) {
    HANDY_AUSGELAGERT.forEach(([id]) => {
      const b = document.getElementById(id);
      if (b && b.parentElement !== slot) slot.appendChild(b);
    });
  } else {
    [...HANDY_AUSGELAGERT].reverse().forEach(([id, ankerId]) => {
      const b = document.getElementById(id);
      const anker = document.getElementById(ankerId);
      if (!b || b.parentElement === tools) return;
      if (anker && anker.parentElement === tools) tools.insertBefore(b, anker);
      else tools.appendChild(b);
    });
  }
  box?.classList.toggle('hidden', !handy);
}

/* Die Feldliste lebt auf breiten Geräten links, im Handy-Modus im
   Werkzeug-Menü. Umgehängt wird DASSELBE Element: es gibt weiterhin nur eine
   Feldliste, mit denselben Zeilen, Ankreuzfeldern und Ereignissen. */
/* Wann gehoert die Feldliste ins Menue statt an den linken Rand?

     – im Handy-Modus immer (dort gibt es keinen linken Rand)
     – sonst, solange das Menue offen ist und das Fenster schmaler als
       1300 px ist: Feldliste (300) + Menue (340) wuerden der Zeichnung sonst
       zwei Drittel wegnehmen. Zugeklappt kehrt die Liste sofort zurueck.

   Auf breiten Bildschirmen bleibt alles wie gewohnt nebeneinander.        */
const FELDLISTE_DOCK_AB = 1300;   // px Fensterbreite

function feldlisteImMenue() {
  return document.body.dataset.mode === 'iphone'
      || (werkzeugOffen && window.innerWidth < FELDLISTE_DOCK_AB);
}

function syncSidePanelOrt() {
  const side   = document.getElementById('sidePanel');
  const slot   = document.getElementById('wzFelder');
  const layout = document.getElementById('appLayout');
  if (!side || !slot || !layout) return;
  if (feldlisteImMenue()) {
    if (side.parentElement !== slot) slot.appendChild(side);
  } else if (side.parentElement !== layout) {
    layout.insertBefore(side, layout.firstChild);
  }
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
  // Der Rücksprung ins Aufmaß-Modul ist in der zusammengeführten App ein
  // Routenwechsel; die Shell setzt das Ziel der Kopfzeile selbst.
  syncBackLink();

  document.getElementById('addSectionBtn').addEventListener('click', () => {
    addCtx = null;
    openAddSheet();
  });
  document.getElementById('emptyAddBtn').addEventListener('click', () => {
    addCtx = null;
    openAddSheet();
  });

  document.getElementById('projectName').addEventListener('input', e => {
    state.project = e.target.value;
    scheduleAutosave2d();
  });

  // Alles, was einmal je Zeichnung gebraucht wird, liegt hinter EINEM Knopf.
  document.getElementById('tdMenuBtn')?.addEventListener('click', openProjektSheet);

  document.getElementById('tdProjectSearch')?.addEventListener('input', e => {
    tdSuche = e.target.value;
    renderProjektListe();
  });

  // ── Zeichnungen anlegen und löschen ─────────────────────────────────────
  // „Neue Zeichnung" steht an drei Stellen: als Primärknopf über der Liste,
  // im Leerzustand und im Datei-Menü des Editors. Alle drei führen auf
  // denselben Einstieg – und keiner davon wird je gesperrt.
  document.getElementById('tdNeuBtn')?.addEventListener('click', neueZeichnungStarten);
  document.getElementById('tdEmptyNeuBtn')?.addEventListener('click', neueZeichnungStarten);

  document.getElementById('tdAuswahlBtn')?.addEventListener('click', () => {
    setzeAuswahlModus(!tdAuswahlModus);
  });
  document.getElementById('tdBulkAlle')?.addEventListener('click', waehleAlleSichtbaren);
  document.getElementById('tdBulkLoeschen')?.addEventListener('click', () => {
    if (!tdAuswahl.size) return;
    frageZeichnungenLoeschen(Array.from(tdAuswahl));
  });

  verknuepfeZeichnungsDialoge();

  // Das Aufmaß-Modul verwaltet dieselben Projekte. Ändert es dort etwas,
  // zeigt die Liste hier sonst einen veralteten Stand.
  document.addEventListener(GERUEST_DATEN_EVENT, e => {
    if (e.detail && e.detail.quelle === '2d') return;
    if (window.location.hash === '#/2d/projekte') renderProjektListe();
  });

  // Fotos ohne Projekt (Seite wurde während der Rückgängig-Frist neu geladen)
  // einmalig entfernen – nachrangig, deshalb erst nach dem Aufbau.
  setTimeout(() => raeumeVerwaisteFotosAuf(), 1500);

  document.getElementById('loadFileInput').addEventListener('change', onLoadFile);
  // ID mit td-Präfix: „exportPdfBtn" gehört im zusammengeführten Dokument
  // bereits dem Aufmaß-Modul (PDF des Angebots).
  document.getElementById('td-exportPdfBtn').addEventListener('click', exportPdf);

  // ── Bordbrett ───────────────────────────────────────────────────────────
  document.getElementById('bordbrettBtn')?.addEventListener('click', () => {
    if (bordbrettModus) beendeBordbrettModus(); else starteBordbrettModus();
  });
  document.getElementById('bordbrettFertigBtn')?.addEventListener('click', beendeBordbrettModus);
  document.getElementById('bordbrettLeerenBtn')?.addEventListener('click', () => {
    const n = leereBordbrettKanten();
    if (!n) return;
    renderAll(); scheduleAutosave2d(); updateBordbrettBar();
    showToast(n === 1 ? 'Bordbrett entfernt' : `${n} Bordbrett-Kanten entfernt`);
  });
  updateBordbrettBar();

  document.getElementById('snapToggleBtn').addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    const btn = document.getElementById('snapToggleBtn');
    btn.classList.toggle('aktiv', snapEnabled);
    btn.setAttribute('aria-pressed', String(snapEnabled));
    btn.title = snapEnabled
      ? 'Magnet: An – Felder rasten aneinander ein'
      : 'Magnet: Aus – Felder lassen sich frei setzen';
  });

  document.getElementById('undoBtn')?.addEventListener('click', performUndo);
  document.getElementById('redoBtn')?.addEventListener('click', performRedo);
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
  // Zuerst: im Bordbrett-Modus fängt die Kante die Geste ab, bevor ein Feld
  // darunter oder das Verschieben der Ansicht sie bekommt.
  svg.addEventListener('pointerdown',   bordbrettPointerDown, true);
  svg.addEventListener('pointermove',   onSvgPointerMove);
  svg.addEventListener('pointerup',     onSvgPointerUp);
  svg.addEventListener('pointercancel', onSvgPointerUp);
  // Tap empty canvas → deselect section (hides + buttons)
  const deselect = () => {
    if (canvasJustMoved) { canvasJustMoved = false; return; }   // Tap direkt nach Pan/Pinch → nicht abwählen
    if (bordbrettModus) return;               // im Bordbrett-Modus zählt der Tipp der Kante
    // Klick, der nur die Nachwehe eines gerade losgelassenen Griffs ist,
    // darf die eben getroffene Auswahl nicht wieder aufheben.
    if (Date.now() - handleReleasedAt < CLICK_AFTER_HANDLE_MS) return;
    if (selectedSi !== null) { selectedSi = null; selectedBi = null; requestRender(); }
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

  /* ── Werkzeug-Menue ────────────────────────────────────────────────────
     Ein Knopf, ein Menue: Aufklappen und Zuklappen liegen auf demselben
     Pfeil. Der Auswahlzustand bleibt davon unberuehrt. */
  document.getElementById('werkzeugBtn')?.addEventListener('click', toggleWerkzeugPanel);
  document.getElementById('werkzeugCloseBtn')?.addEventListener('click',
    () => setWerkzeugPanel(false));

  // Ansicht/Handy-Modus: die Wahl steht im Menue, die Erkennung zieht bei
  // Drehen und Groessenaenderung nach.
  applyMode();
  syncSidePanelOrt();
  syncToolbarOrt();
  let _modusTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_modusTimer);
    _modusTimer = setTimeout(() => { applyMode(); syncSidePanelOrt(); renderWzAnsicht(); }, 150);
  });

  setWerkzeugPanel(ladeWerkzeugOffen(), { merken: false });

  renderAllNow();
  renderWzAnsicht();
}

// ── Rücksprung-Ziel der Kopfzeile ──────────────────────────────────────────
// Ist der Zeichner aus einem Projekt heraus geöffnet, führt der Pfeil zurück
// in genau dieses Projekt; sonst auf den Startbildschirm.

function syncBackLink() {
  const backLink = document.querySelector('#td-zeichnung .back-link');
  if (!backLink) return;
  const ziel = linkedProjectId ? 'Aufmaß' : 'Start';
  backLink.setAttribute('href', linkedProjectId ? '#/aufmass' : '#/');
  // Nur der Pfeil: in der schmalen Leiste zählt jeder Millimeter, das Ziel
  // steht im Tooltip und in der Vorlesehilfe.
  backLink.setAttribute('title', 'Zurück zu ' + ziel);
  backLink.setAttribute('aria-label', 'Zurück zu ' + ziel);
}

/**
 * Setzt ALLES zurück, was zum gerade geöffneten Dokument gehört.
 *
 * Das ist die Grundlage der Zustandsisolierung: Der Editor arbeitet auf
 * modulweiten Variablen (state, Undo-Stapel, Zwischenablage, Auswahl, Kamera,
 * laufende Zeichenmodi). Wer ein anderes Dokument öffnet, ohne sie zu leeren,
 * schleppt Reste des alten mit – sichtbar etwa als Undo-Schritt, der Felder
 * aus einer fremden Zeichnung zurückholt. Deshalb hängt hier alles an einer
 * Stelle, statt an jeder Aufrufstelle einzeln zu stehen.
 */
function resetState2d() {
  // Ausstehende, gebündelte Schreibvorgänge gehören zum alten Dokument.
  if (autosave2dTimer)   { clearTimeout(autosave2dTimer);   autosave2dTimer = null; }
  if (undoSnapshotTimer) { clearTimeout(undoSnapshotTimer); undoSnapshotTimer = null; }

  state = {
    project: '', depth: 0.73, abschnitte: [], hideUnassigned: false,
    aufmass: null, ecken: {}, bordbrettKanten: [], sections: []
  };
  _sId = 0; _bId = 0; _aId = 0;
  linkedProjectId = null;

  // Auswahl und Mehrfachauswahl
  selectedSi = null; selectedBi = null;
  bulkMode = false; bulkSelected.clear();
  bulkHL = null; bulkHR = null; bulkKonsMeter = null;

  // Zwischenablage und Undo-/Redo-History
  copiedBayData = null;
  undoStack = []; redoStack = []; lastUndoSnapshot = null;

  // Laufende Gesten und Zeichenhilfen
  drag = null; movePreview = null;
  addCtx = null; addCtxDirFixed = false; pendingLen = null; pendingDir = 'S';
  canvasGesture = null; canvasJustMoved = false;
  bordbrettModus = false;

  // Ansicht: neues Dokument beginnt wieder eingepasst
  camera = { cx: 200, cy: 150, scale: 1 };
  autoFit = true;

  dokumentBasis = null;

  invalidateEckenCache();
  invalidateViewCaches();
}

/** Schließt alles, was über der Zeichenfläche liegen kann (Sheets, Menüs,
 *  aktive Zeichenmodi mit ihren Event-Listenern). */
function schliesseOffeneOberflaechen() {
  closeSheet();
  closeFloatingMenu();
  if (bordbrettModus)  beendeBordbrettModus();
}

/** Überträgt den frisch geladenen Zustand in die Bedienelemente. */
function uebernehmeDokumentInOberflaeche() {
  const nameEl  = document.getElementById('projectName');
  const depthEl = document.getElementById('scaffDepth');
  if (nameEl)  nameEl.value  = state.project;
  if (depthEl) depthEl.value = state.depth;
  // Frisch geladen = gespeicherter Stand; ab hier zählt jede Abweichung.
  dokumentBasis    = serializeUndoState();
  lastUndoSnapshot = dokumentBasis;
  updateUndoRedoButtons();
  updateBordbrettBar();
}

/** Zeichenfläche neu vermessen und darstellen (nach jedem Sichtbarwerden). */
function aktualisiereZeichenflaeche() {
  zeigeZeichnung();
  syncBackLink();
  _vpCache = null;                 // war ausgeblendet → gemessene Größen veraltet
  if (autoFit) fitCameraToContent();
  applyCamera();
  renderAllNow();
}

/**
 * Öffnet ein Dokument im Editor – vollständig vom vorherigen getrennt.
 * @param {string|null} id Projekt-ID, oder null für die freie Zeichnung.
 */
function oeffneZeichnung(id) {
  schliesseOffeneOberflaechen();
  flushAutosave2d();               // was noch offen ist, gehört ins alte Dokument
  resetState2d();                  // ab hier bleibt nichts vom alten übrig

  if (id) localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, id);
  else    localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);

  loadFromLinkedProject();
  normalizeState();
  uebernehmeDokumentInOberflaeche();

  Shell.gehe('#/2d');
  aktualisiereZeichenflaeche();
}

/** Schließt den Editor, ohne ein anderes Dokument zu öffnen – etwa wenn die
 *  geöffnete Zeichnung gelöscht wurde. */
function schliesseZeichnung() {
  schliesseOffeneOberflaechen();
  resetState2d();                  // löscht auch den ausstehenden Autosave
  localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  uebernehmeDokumentInOberflaeche();
  renderAllNow();
  Shell.gehe('#/2d/projekte');
}

/** Wird gerufen, wenn Zeichnungen verschwinden (auch aus dem Aufmaß-Modul
 *  heraus): Ist eine davon gerade offen, schließt der Editor sauber. */
function zeichnungenEntfallen(ids) {
  if (!linkedProjectId || !Array.isArray(ids) || ids.indexOf(linkedProjectId) < 0) return;
  schliesseZeichnung();
}

// ============================================================================
//  Projektliste des 2D-Moduls
// ============================================================================
// Gezeichnet wird immer für ein bestimmtes Projekt. Vorher übernahm der
// Zeichner stillschweigend das zuletzt geöffnete – welches das war, stand
// nirgends, und ein anderes ließ sich hier gar nicht auswählen.
//
// Diese Liste zeigt dieselben Projekte und dieselbe Ordnerstruktur wie das
// Aufmaß-Modul, aber auf das Zeichnen zugeschnitten: an jeder Karte steht,
// ob und wie viel schon gezeichnet ist. Die Daten kommen direkt aus dem
// gemeinsamen Speicher (siehe core.js) – das Modul greift dafür nicht in das
// Aufmaß-Modul hinein.

let tdSuche       = '';
let tdOrdnerId    = '';       // '' = alle, '__ohne__' = ohne Ordner, sonst Ordner-ID
let tdAuswahlModus = false;   // Mehrfachauswahl zum Löschen
const tdAuswahl    = new Set();

function loadLinkedFolders() {
  try {
    const raw = localStorage.getItem(GK.ordner);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

/** Anzeigename eines Projekts – Name, sonst die Anschrift. */
function tdProjektName(proj) {
  const name = (proj.name || '').trim();
  if (name) return name;
  const a = proj.anschrift || {};
  const zeile = [
    [a.strasse, a.nummer].filter(Boolean).join(' '),
    [a.plz, a.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  return zeile || 'Projekt ohne Namen';
}

/** Felder und Fläche der hinterlegten Zeichnung. */
function tdZeichnungStats(proj) {
  const z = proj.zeichnung2d;
  if (!z || !Array.isArray(z.sections)) return { felder: 0, flaeche: 0 };
  let felder = 0, flaeche = 0;
  z.sections.forEach(sec => (sec.bays || []).forEach(bay => {
    felder++;
    const hoehen = [bay.hL, bay.hR].filter(h => h != null && !isNaN(h) && h > 0);
    if (hoehen.length && bay.len) flaeche += bay.len * Math.min(...hoehen);
  }));
  return { felder, flaeche: Math.round(flaeche * 100) / 100 };
}

function tdPasstZurSuche(proj, text) {
  if (!text) return true;
  const a = proj.anschrift || {};
  return [proj.name, a.bauherr, a.strasse, a.nummer, a.plz, a.ort]
    .filter(Boolean).join(' ').toLowerCase().includes(text.toLowerCase());
}

function tdGefilterteProjekte() {
  const alle = loadLinkedProjects();
  return alle
    .filter(p => {
      if (tdOrdnerId === '__ohne__') return !p.folderId;
      if (tdOrdnerId) return p.folderId === tdOrdnerId;
      return true;
    })
    .filter(p => tdPasstZurSuche(p, tdSuche))
    .sort((x, y) => String(y.geaendert || '').localeCompare(String(x.geaendert || '')));
}

function tdRenderOrdnerLeiste() {
  const bar = document.getElementById('tdFolderBar');
  if (!bar) return;
  const projekte = loadLinkedProjects();
  const ordner   = loadLinkedFolders();
  bar.innerHTML = '';

  const chip = (id, beschriftung, anzahl) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'td-folder-chip' + (tdOrdnerId === id ? ' aktiv' : '');
    const t = document.createElement('span');
    t.textContent = beschriftung;
    b.appendChild(t);
    const z = document.createElement('span');
    z.className = 'td-folder-chip-zahl';
    z.textContent = String(anzahl);
    b.appendChild(z);
    b.addEventListener('click', () => {
      tdOrdnerId = id;
      renderProjektListe();
    });
    bar.appendChild(b);
  };

  chip('', 'Alle Projekte', projekte.length);
  const ohne = projekte.filter(p => !p.folderId).length;
  if (ohne || ordner.length) chip('__ohne__', 'Ohne Ordner', ohne);
  ordner.forEach(o => chip(o.id, o.name || 'Ordner', projekte.filter(p => p.folderId === o.id).length));

  // Ordner anlegen. Bewusst eine eigene Klasse: die Chips oben sind Filter,
  // dieser Knopf ist eine Aktion.
  const neu = document.createElement('button');
  neu.type = 'button';
  neu.className = 'td-folder-neu';
  neu.textContent = '+ Ordner';
  neu.title = 'Neuen Ordner anlegen';
  neu.addEventListener('click', ordnerAnlegen);
  bar.appendChild(neu);

  // Für den gerade gewählten Ordner: umbenennen/löschen.
  if (tdOrdnerId && tdOrdnerId !== '__ohne__') {
    const aktiv = ordner.find(o => o.id === tdOrdnerId);
    if (aktiv) {
      const verwalten = document.createElement('button');
      verwalten.type = 'button';
      verwalten.className = 'td-folder-verwalten';
      verwalten.textContent = '✎';
      verwalten.title = 'Ordner umbenennen oder löschen';
      verwalten.setAttribute('aria-label', 'Ordner umbenennen oder löschen');
      verwalten.addEventListener('click', () => openFloatingMenu(verwalten, [
        { label: 'Ordner umbenennen…', onClick: () => ordnerUmbenennen(aktiv.id) },
        '---',
        { label: 'Ordner löschen', danger: true, onClick: () => ordnerLoeschen(aktiv.id) }
      ]));
      bar.appendChild(verwalten);
    }
  }
}

function tdProjektKarte(proj, ordner) {
  // Bewusst ein <div> mit Knopf-Rolle statt <button>: die Karte trägt selbst
  // Bedienelemente (⋯-Menü, Auswahlfeld), und ein Knopf im Knopf ist weder
  // gültiges HTML noch bedienbar.
  const karte = document.createElement('div');
  karte.className = 'td-project-card';
  karte.setAttribute('role', 'button');
  karte.tabIndex = 0;
  karte.dataset.id = proj.id;
  if (proj.id === linkedProjectId) karte.classList.add('aktuell');
  if (tdAuswahlModus) {
    karte.classList.add('auswahl');
    if (tdAuswahl.has(proj.id)) karte.classList.add('gewaehlt');
  }

  const kopf = document.createElement('div');
  kopf.className = 'td-project-kopf';

  if (tdAuswahlModus) {
    const haken = document.createElement('span');
    haken.className = 'td-project-haken';
    haken.textContent = tdAuswahl.has(proj.id) ? '✓' : '';
    haken.setAttribute('aria-hidden', 'true');
    kopf.appendChild(haken);
  }

  const name = document.createElement('span');
  name.className = 'td-project-name';
  name.textContent = tdProjektName(proj);
  kopf.appendChild(name);
  if (proj.id === linkedProjectId) {
    const marke = document.createElement('span');
    marke.className = 'td-project-marke';
    marke.textContent = 'geöffnet';
    kopf.appendChild(marke);
  }

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'td-project-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.title = 'Aktionen';
  menuBtn.setAttribute('aria-label', 'Aktionen für ' + tdProjektName(proj));
  menuBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    oeffneZeichnungsMenu(proj, ev.currentTarget);
  });
  kopf.appendChild(menuBtn);

  karte.appendChild(kopf);

  const a = proj.anschrift || {};
  const anschrift = [
    [a.strasse, a.nummer].filter(Boolean).join(' '),
    [a.plz, a.ort].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  if (anschrift && anschrift !== tdProjektName(proj)) {
    const z = document.createElement('span');
    z.className = 'td-project-zeile';
    z.textContent = anschrift;
    karte.appendChild(z);
  }

  const ord = proj.folderId ? ordner.find(o => o.id === proj.folderId) : null;
  if (ord) {
    const z = document.createElement('span');
    z.className = 'td-project-ordner';
    z.textContent = '📁 ' + (ord.name || 'Ordner');
    karte.appendChild(z);
  }

  const stats = tdZeichnungStats(proj);
  const fuss = document.createElement('span');
  fuss.className = 'td-project-stats' + (stats.felder ? '' : ' leer');
  fuss.textContent = stats.felder
    ? `${stats.felder} Feld${stats.felder === 1 ? '' : 'er'} · ${geruestFmtNum(stats.flaeche)} m²`
    : 'Noch nichts gezeichnet';
  karte.appendChild(fuss);

  const aktiviere = () => {
    if (tdAuswahlModus) { schalteAuswahl(proj.id); return; }
    oeffneProjektZumZeichnen(proj.id);
  };
  karte.addEventListener('click', aktiviere);
  karte.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aktiviere(); }
  });
  // Rechtsklick (Desktop) öffnet dasselbe Menü wie der ⋯-Knopf.
  karte.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const punkt = { right: ev.clientX + 120, bottom: ev.clientY, top: ev.clientY };
    oeffneZeichnungsMenu(proj, { getBoundingClientRect: () => punkt });
  });
  return karte;
}

function renderProjektListe() {
  const grid = document.getElementById('tdProjectGrid');
  if (!grid) return;
  const leer     = document.getElementById('tdProjectEmpty');
  const keineTr  = document.getElementById('tdProjectNoHits');
  const projekte = loadLinkedProjects();
  const ordner   = loadLinkedFolders();

  // Auswahl aufräumen: gelöschte Einträge dürfen nicht ausgewählt bleiben.
  const vorhanden = new Set(projekte.map(p => p.id));
  Array.from(tdAuswahl).forEach(id => { if (!vorhanden.has(id)) tdAuswahl.delete(id); });

  tdRenderOrdnerLeiste();
  grid.innerHTML = '';

  if (!projekte.length) {
    leer?.classList.remove('hidden');
    keineTr?.classList.add('hidden');
    setzeAuswahlModus(false, true);
    aktualisiereAuswahlLeiste();
    return;
  }
  leer?.classList.add('hidden');

  const liste = tdGefilterteProjekte();
  keineTr?.classList.toggle('hidden', liste.length > 0);
  liste.forEach(p => grid.appendChild(tdProjektKarte(p, ordner)));
  aktualisiereAuswahlLeiste();
}

/** Projekt auswählen und dessen Zeichnung öffnen. */
function oeffneProjektZumZeichnen(id) {
  if (id === linkedProjectId) { Shell.gehe('#/2d'); return; }
  mitGesichertenAenderungen(() => oeffneZeichnung(id));
}

// ── Mehrfachauswahl ────────────────────────────────────────────────────────

function setzeAuswahlModus(an, ohneRender) {
  if (tdAuswahlModus === !!an) return;
  tdAuswahlModus = !!an;
  if (!tdAuswahlModus) tdAuswahl.clear();
  const btn = document.getElementById('tdAuswahlBtn');
  if (btn) {
    btn.classList.toggle('aktiv', tdAuswahlModus);
    btn.textContent = tdAuswahlModus ? 'Fertig' : 'Auswählen';
    btn.setAttribute('aria-pressed', tdAuswahlModus ? 'true' : 'false');
  }
  if (!ohneRender) renderProjektListe();
}

function schalteAuswahl(id) {
  if (tdAuswahl.has(id)) tdAuswahl.delete(id); else tdAuswahl.add(id);
  renderProjektListe();
}

function aktualisiereAuswahlLeiste() {
  const bar = document.getElementById('tdBulkBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !tdAuswahlModus);
  const info = document.getElementById('tdBulkInfo');
  const n = tdAuswahl.size;
  if (info) info.textContent = n === 1 ? '1 Zeichnung ausgewählt' : `${n} Zeichnungen ausgewählt`;
  const del = document.getElementById('tdBulkLoeschen');
  if (del) del.disabled = n === 0;
}

function waehleAlleSichtbaren() {
  const sichtbar = tdGefilterteProjekte();
  const alleSchon = sichtbar.length > 0 && sichtbar.every(p => tdAuswahl.has(p.id));
  sichtbar.forEach(p => { if (alleSchon) tdAuswahl.delete(p.id); else tdAuswahl.add(p.id); });
  renderProjektListe();
}

// ── Aktionsmenü einer Zeichnung ────────────────────────────────────────────

function oeffneZeichnungsMenu(proj, anchor) {
  openFloatingMenu(anchor, [
    { label: 'Öffnen',                  onClick: () => oeffneProjektZumZeichnen(proj.id) },
    { label: 'Umbenennen…',             onClick: () => benenneZeichnungUm(proj) },
    { label: 'Duplizieren',             onClick: () => dupliziereZeichnung(proj) },
    { label: 'In Ordner verschieben…',  onClick: () => oeffneVerschiebenMenu(proj, anchor) },
    { label: 'Mehrere auswählen',       onClick: () => {
        setzeAuswahlModus(true, true);
        tdAuswahl.add(proj.id);
        renderProjektListe();
      } },
    '---',
    { label: 'Löschen', danger: true, onClick: () => frageZeichnungenLoeschen([proj.id]) }
  ]);
}

function oeffneVerschiebenMenu(proj, anchor) {
  const ordner = loadLinkedFolders();
  const items = [{
    label: (!proj.folderId ? '✓ ' : '') + 'Ohne Ordner',
    active: !proj.folderId,
    onClick: () => verschiebeZeichnung(proj.id, null)
  }];
  ordner.forEach(o => items.push({
    label: (proj.folderId === o.id ? '✓ ' : '') + (o.name || 'Ordner'),
    active: proj.folderId === o.id,
    onClick: () => verschiebeZeichnung(proj.id, o.id)
  }));
  items.push('---');
  items.push({ label: '+ Neuer Ordner…', onClick: () => {
    const neu = ordnerAnlegen();
    if (neu) verschiebeZeichnung(proj.id, neu.id);
  } });
  openFloatingMenu(anchor, items);
}

// ============================================================================
//  Zeichnungen anlegen, löschen, umbenennen, duplizieren, verschieben
// ============================================================================
// Bis hierher war die Liste eine Einbahnstraße: lesen ja, schreiben nein. Die
// folgenden Funktionen arbeiten auf demselben Speicher und in demselben
// Format wie das Aufmaß-Modul – ein Projektdatensatz, in dem die Zeichnung
// unter `zeichnung2d` steckt. Damit bleibt jeder vorhandene Datensatz gültig,
// eine Migration ist nicht nötig.

function tdGenId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

/** Eine leere, aber vollständige Zeichnung. */
function leereZeichnung() {
  return {
    depth: 0.73, sections: [], abschnitte: [], hideUnassigned: false,
    aufmass: null, ecken: {}, bordbrettKanten: [], _sId: 0, _bId: 0
  };
}

/** Namensvorschlag: „Neue Zeichnung N", fortlaufend über den Bestand. */
function tdVorschlagName() {
  let max = 0;
  loadLinkedProjects().forEach(p => {
    const m = /^\s*Neue Zeichnung(?:\s+(\d+))?\s*$/i.exec(p.name || '');
    if (m) max = Math.max(max, m[1] ? parseInt(m[1], 10) : 1);
  });
  return 'Neue Zeichnung ' + (max + 1);
}

/** Vorbelegter Zielordner: der gerade gefilterte, sonst der der offenen Zeichnung. */
function tdVorgabeOrdner() {
  if (tdOrdnerId && tdOrdnerId !== '__ohne__') return tdOrdnerId;
  const offen = loadLinkedProjects().find(p => p.id === linkedProjectId);
  return (offen && offen.folderId) || null;
}

/** Legt den Projektdatensatz an (Format wie im Aufmaß-Modul). */
function erzeugeZeichnung(name, folderId) {
  const heute = new Date().toISOString().slice(0, 10);
  const proj = {
    id: tdGenId('proj'),
    name: (name || '').trim(),
    status: 'in_bearbeitung',
    folderId: folderId || null,
    erstellt: heute,
    geaendert: heute,
    anschrift: { strasse: '', nummer: '', plz: '', ort: '', bauherr: '', telefon: '' },
    geruesttyp: 'fassade',
    geruesttypName: '',
    seiten: [],
    technik: { lastklasse: '3', breitenklasse: 'W06' },
    logistik: {},
    zusatzpositionen: [],
    notizen: '',
    zeichnung2d: leereZeichnung()
  };
  const liste = loadLinkedProjects();
  liste.push(proj);
  return schreibeLinkedProjects(liste) ? proj : null;
}

/** Anlegen + sofort öffnen. */
function legeZeichnungAn(name, folderId) {
  const proj = erzeugeZeichnung(name, folderId);
  if (!proj) return;
  setzeAuswahlModus(false, true);
  tdOrdnerId = folderId || '';        // die neue Zeichnung ist auch sichtbar
  renderProjektListe();
  oeffneZeichnung(proj.id);
  showToast('Neue Zeichnung angelegt');
}

/** Entfernt Zeichnungen aus dem Speicher. @returns die entfernten Datensätze. */
function loescheZeichnungen(ids) {
  const liste   = loadLinkedProjects();
  const entfernt = liste.filter(p => ids.indexOf(p.id) >= 0);
  if (!entfernt.length) return [];
  if (!schreibeLinkedProjects(liste.filter(p => ids.indexOf(p.id) < 0))) return [];

  // Der Zeiger auf „zuletzt geöffnet" darf nicht auf einen gelöschten
  // Datensatz zeigen – sonst sucht der nächste Start ein Projekt, das es
  // nicht mehr gibt.
  const aktuell = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
  if (aktuell && ids.indexOf(aktuell) >= 0) localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);

  zeichnungenEntfallen(ids);
  return entfernt;
}

/** „Rückgängig" nach dem Löschen. */
function stelleZeichnungenWiederHer(records) {
  if (!records || !records.length) return;
  const liste   = loadLinkedProjects();
  const bekannt = new Set(liste.map(p => p.id));
  records.forEach(r => { if (!bekannt.has(r.id)) liste.push(r); });
  schreibeLinkedProjects(liste);
}

/** Löschen mit Sicherheitsabfrage, Toast und Rückgängig-Frist. */
function frageZeichnungenLoeschen(ids) {
  const ziel = loadLinkedProjects().filter(p => ids.indexOf(p.id) >= 0);
  if (!ziel.length) return;

  zeigeLoeschDialog(ziel, () => {
    const entfernt = loescheZeichnungen(ziel.map(p => p.id));
    if (!entfernt.length) return;
    setzeAuswahlModus(false, true);
    renderProjektListe();

    showToast(
      entfernt.length === 1 ? `„${tdProjektName(entfernt[0])}" gelöscht`
                            : `${entfernt.length} Zeichnungen gelöscht`,
      {
        label: 'Rückgängig',
        dauer: 7000,
        onClick: () => {
          stelleZeichnungenWiederHer(entfernt);
          renderProjektListe();
          showToast(entfernt.length === 1 ? 'Wiederhergestellt'
                                          : `${entfernt.length} Zeichnungen wiederhergestellt`);
        },
        // Frist verstrichen → jetzt fallen auch die Fotos der Projekte weg.
        // Vorher nicht: sonst käme die Zeichnung ohne ihre Bilder zurück.
        onAblauf: () => entfernt.forEach(pr => entferneFotosZuProjekt(pr.id))
      }
    );
  });
}

function benenneZeichnungUm(proj) {
  const name = prompt('Zeichnung umbenennen:', tdProjektName(proj));
  if (name === null) return;
  const liste = loadLinkedProjects();
  const rec   = liste.find(p => p.id === proj.id);
  if (!rec) return;
  rec.name      = name.trim();
  rec.geaendert = new Date().toISOString().slice(0, 10);
  if (!schreibeLinkedProjects(liste)) return;
  // Ist die Zeichnung gerade offen, trägt der Editor den alten Namen.
  if (rec.id === linkedProjectId) {
    state.project = rec.name;
    const el = document.getElementById('projectName');
    if (el) el.value = rec.name;
  }
  renderProjektListe();
  showToast('Umbenannt');
}

function dupliziereZeichnung(proj) {
  // Der offene Editor kann neuere Daten halten als der Speicher.
  if (proj.id === linkedProjectId) flushAutosave2d();
  const liste = loadLinkedProjects();
  const rec   = liste.find(p => p.id === proj.id);
  if (!rec) return;
  const heute = new Date().toISOString().slice(0, 10);
  const kopie = JSON.parse(JSON.stringify(rec));
  kopie.id        = tdGenId('proj');
  kopie.name      = (tdProjektName(rec) + ' (Kopie)').trim();
  kopie.erstellt  = heute;
  kopie.geaendert = heute;
  liste.push(kopie);
  if (!schreibeLinkedProjects(liste)) return;
  renderProjektListe();
  // Fotos hängen am Projekt, nicht an der Zeichnung – sie bleiben beim Original.
  showToast('Zeichnung dupliziert');
}

function verschiebeZeichnung(id, folderId) {
  const liste = loadLinkedProjects();
  const rec   = liste.find(p => p.id === id);
  if (!rec) return;
  rec.folderId = folderId || null;
  if (!schreibeLinkedProjects(liste)) return;
  renderProjektListe();
  showToast(folderId ? 'In Ordner verschoben' : 'Aus dem Ordner genommen');
}

// ── Ordner ────────────────────────────────────────────────────────────────

function ordnerAnlegen() {
  const name = prompt('Name des neuen Ordners (z. B. 2026, Firma Müller):');
  if (name === null || !name.trim()) return null;
  const ordner = { id: tdGenId('folder'), name: name.trim() };
  const liste = loadLinkedFolders();
  liste.push(ordner);
  if (!schreibeLinkedFolders(liste)) return null;
  renderProjektListe();
  showToast('Ordner angelegt');
  return ordner;
}

function ordnerUmbenennen(id) {
  const liste = loadLinkedFolders();
  const rec   = liste.find(o => o.id === id);
  if (!rec) return;
  const name = prompt('Ordner umbenennen:', rec.name || '');
  if (name === null || !name.trim()) return;
  rec.name = name.trim();
  if (!schreibeLinkedFolders(liste)) return;
  renderProjektListe();
}

/** Löscht den Ordner, nicht seinen Inhalt: die Zeichnungen darin wandern
 *  nach „Ohne Ordner". */
function ordnerLoeschen(id) {
  const ordner = loadLinkedFolders().find(o => o.id === id);
  if (!ordner) return;
  const projekte = loadLinkedProjects();
  const betroffen = projekte.filter(p => p.folderId === id).length;
  const frage = betroffen
    ? `Ordner „${ordner.name}" löschen? ${betroffen} Zeichnung${betroffen === 1 ? '' : 'en'} darin ` +
      'bleibt erhalten und liegt danach unter „Ohne Ordner".'
    : `Ordner „${ordner.name}" löschen?`;
  if (!confirm(frage)) return;

  projekte.forEach(p => { if (p.folderId === id) p.folderId = null; });
  if (betroffen && !schreibeLinkedProjects(projekte)) return;
  if (!schreibeLinkedFolders(loadLinkedFolders().filter(o => o.id !== id))) return;
  if (tdOrdnerId === id) tdOrdnerId = '';
  renderProjektListe();
  showToast('Ordner gelöscht');
}

// ============================================================================
//  Dialoge der Zeichnungsverwaltung
// ============================================================================
// Bewusst eigene Dialoge statt prompt()/confirm() für die beiden Wege, die
// hier täglich gegangen werden: Anlegen braucht zwei Angaben (Name + Ordner),
// Löschen muss den Namen zeigen. Beide sind mit Handschuhen bedienbar
// (44 px Ziele) und tragen die Optik der Suite.

let tdNeuOffen      = false;
let tdLoeschCb      = null;
let tdSpeichernCb   = null;

function tdOverlay(id, sichtbar) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !sichtbar);
  return el;
}

// ── Neue Zeichnung ────────────────────────────────────────────────────────

/** Einstieg „Neue Zeichnung" – aus der Liste wie aus dem Editor. Erst die
 *  ungespeicherten Änderungen klären, dann fragen, was angelegt werden soll. */
function neueZeichnungStarten() {
  mitGesichertenAenderungen(oeffneNeueZeichnungDialog);
}

function oeffneNeueZeichnungDialog() {
  const overlay  = document.getElementById('tdNeuOverlay');
  const nameEl   = document.getElementById('tdNeuName');
  const ordnerEl = document.getElementById('tdNeuOrdner');
  const vorgabe  = tdVorgabeOrdner();

  // Rückfallebene, falls die Oberfläche fehlt: anlegen muss trotzdem gehen.
  if (!overlay || !nameEl || !ordnerEl) {
    const n = prompt('Name der neuen Zeichnung:', tdVorschlagName());
    if (n === null) return;
    legeZeichnungAn(n || tdVorschlagName(), vorgabe);
    return;
  }

  nameEl.value = tdVorschlagName();
  ordnerEl.innerHTML = '';
  const ohne = document.createElement('option');
  ohne.value = '';
  ohne.textContent = 'Ohne Ordner';
  ordnerEl.appendChild(ohne);
  loadLinkedFolders().forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name || 'Ordner';
    ordnerEl.appendChild(opt);
  });
  ordnerEl.value = vorgabe && loadLinkedFolders().some(o => o.id === vorgabe) ? vorgabe : '';

  tdNeuOffen = true;
  tdOverlay('tdNeuOverlay', true);
  setTimeout(() => { nameEl.focus(); nameEl.select(); }, 40);
}

function schliesseNeueZeichnungDialog() {
  tdNeuOffen = false;
  tdOverlay('tdNeuOverlay', false);
}

function bestaetigeNeueZeichnung() {
  if (!tdNeuOffen) return;
  const nameEl   = document.getElementById('tdNeuName');
  const ordnerEl = document.getElementById('tdNeuOrdner');
  const name   = (nameEl && nameEl.value.trim()) || tdVorschlagName();
  const ordner = (ordnerEl && ordnerEl.value) || null;
  schliesseNeueZeichnungDialog();
  legeZeichnungAn(name, ordner);
}

// ── Löschen bestätigen ────────────────────────────────────────────────────

function zeigeLoeschDialog(ziel, onJa) {
  const overlay = document.getElementById('tdLoeschOverlay');
  const namen   = ziel.map(tdProjektName);

  if (!overlay) {
    const frage = ziel.length === 1
      ? `Zeichnung „${namen[0]}" wirklich löschen?`
      : `${ziel.length} Zeichnungen wirklich löschen?\n\n` + namen.join('\n');
    if (confirm(frage)) onJa();
    return;
  }

  const titel = document.getElementById('tdLoeschTitel');
  const text  = document.getElementById('tdLoeschText');
  const liste = document.getElementById('tdLoeschListe');
  if (titel) titel.textContent = ziel.length === 1 ? 'Zeichnung löschen?' : 'Zeichnungen löschen?';
  if (text) {
    text.textContent = ziel.length === 1
      ? `„${namen[0]}" wird mit allen gezeichneten Feldern und den Projektfotos entfernt.`
      : `${ziel.length} Zeichnungen werden mit allen gezeichneten Feldern und den Projektfotos entfernt.`;
  }
  if (liste) {
    liste.innerHTML = '';
    namen.slice(0, 8).forEach(n => {
      const li = document.createElement('li');
      li.textContent = n;
      liste.appendChild(li);
    });
    if (namen.length > 8) {
      const li = document.createElement('li');
      li.className = 'mehr';
      li.textContent = `… und ${namen.length - 8} weitere`;
      liste.appendChild(li);
    }
    liste.classList.toggle('hidden', ziel.length < 2);
  }

  tdLoeschCb = onJa;
  tdOverlay('tdLoeschOverlay', true);
  setTimeout(() => document.getElementById('tdLoeschBestaetigen')?.focus(), 40);
}

function schliesseLoeschDialog() {
  tdLoeschCb = null;
  tdOverlay('tdLoeschOverlay', false);
}

// ── Ungespeicherte Änderungen ─────────────────────────────────────────────

/**
 * Führt `weiter` aus – vorher aber, falls die offene Zeichnung noch
 * ungeschriebene Änderungen hat, den Dialog Speichern / Verwerfen / Abbrechen.
 */
function mitGesichertenAenderungen(weiter) {
  if (!hatUngespeicherteAenderungen()) { weiter(); return; }

  const overlay = document.getElementById('tdSpeichernOverlay');
  if (!overlay) {                       // Rückfallebene: im Zweifel sichern
    flushAutosave2d();
    weiter();
    return;
  }

  const text = document.getElementById('tdSpeichernText');
  if (text) {
    const name = state.project || 'Die geöffnete Zeichnung';
    text.textContent = `„${name}" hat Änderungen, die noch nicht gesichert sind.`;
  }
  tdSpeichernCb = weiter;
  tdOverlay('tdSpeichernOverlay', true);
  setTimeout(() => document.getElementById('tdSpeichernSichern')?.focus(), 40);
}

function schliesseSpeichernDialog() {
  tdSpeichernCb = null;
  tdOverlay('tdSpeichernOverlay', false);
}

function speichernDialogAntwort(art) {
  const weiter = tdSpeichernCb;
  schliesseSpeichernDialog();
  if (art === 'abbrechen' || !weiter) return;
  if (art === 'speichern') {
    flushAutosave2d();
  } else {
    verwerfeAenderungen();
  }
  weiter();
}

/** Verwerfen: den ausstehenden Schreibvorgang fallen lassen und den zuletzt
 *  gespeicherten Stand zurückholen. Ohne dieses Zurückladen stünden die
 *  verworfenen Änderungen weiter im Arbeitsspeicher – und wären beim nächsten
 *  Neuzeichnen doch geschrieben worden. */
function verwerfeAenderungen() {
  if (autosave2dTimer) { clearTimeout(autosave2dTimer); autosave2dTimer = null; }
  if (!linkedProjectId) return;
  resetState2d();                  // liest den Zeiger nicht – der bleibt stehen
  loadFromLinkedProject();
  normalizeState();
  uebernehmeDokumentInOberflaeche();
  renderAllNow();
}

/** Verknüpft die Dialoge einmalig (aus init()). */
function verknuepfeZeichnungsDialoge() {
  document.getElementById('tdNeuAbbrechen')?.addEventListener('click', schliesseNeueZeichnungDialog);
  document.getElementById('tdNeuAnlegen')?.addEventListener('click', bestaetigeNeueZeichnung);
  document.getElementById('tdNeuName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); bestaetigeNeueZeichnung(); }
  });
  document.getElementById('tdNeuOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tdNeuOverlay') schliesseNeueZeichnungDialog();
  });

  document.getElementById('tdLoeschAbbrechen')?.addEventListener('click', schliesseLoeschDialog);
  document.getElementById('tdLoeschBestaetigen')?.addEventListener('click', () => {
    const cb = tdLoeschCb;
    schliesseLoeschDialog();
    if (cb) cb();
  });
  document.getElementById('tdLoeschOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tdLoeschOverlay') schliesseLoeschDialog();
  });

  document.getElementById('tdSpeichernAbbrechen')?.addEventListener('click', () => speichernDialogAntwort('abbrechen'));
  document.getElementById('tdSpeichernVerwerfen')?.addEventListener('click', () => speichernDialogAntwort('verwerfen'));
  document.getElementById('tdSpeichernSichern')?.addEventListener('click', () => speichernDialogAntwort('speichern'));

  // Escape schließt den obersten offenen Dialog.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('tdSpeichernOverlay')?.classList.contains('hidden')) { speichernDialogAntwort('abbrechen'); return; }
    if (!document.getElementById('tdLoeschOverlay')?.classList.contains('hidden'))    { schliesseLoeschDialog(); return; }
    if (tdNeuOffen) { schliesseNeueZeichnungDialog(); return; }
    // Zuletzt das Werkzeug-Menue: es ist der unterste Deckel ueber der
    // Zeichenflaeche und soll erst schliessen, wenn nichts darueber liegt.
    if (werkzeugOffen) setWerkzeugPanel(false);
  });
}

// ── Bildschirmwechsel innerhalb des Moduls ─────────────────────────────────

function zeigeProjektListe() {
  document.getElementById('td-projekte')?.classList.remove('hidden');
  document.getElementById('td-zeichnung')?.classList.add('hidden');
  renderProjektListe();
  const suche = document.getElementById('tdProjectSearch');
  if (suche) suche.value = tdSuche;
  window.scrollTo(0, 0);
}

function zeigeZeichnung() {
  document.getElementById('td-projekte')?.classList.add('hidden');
  document.getElementById('td-zeichnung')?.classList.remove('hidden');
}

// ============================================================================
//  Modul-Schnittstelle zur Shell
// ============================================================================
// Früher startete der Zeichner selbst per DOMContentLoaded. Jetzt entscheidet
// die Shell, wann aufgebaut (`mount`) und wann sichtbar geschaltet wird
// (`aktiviere`). Der Aufbau passiert bewusst erst beim ersten Öffnen des
// Moduls: die Kamera braucht eine sichtbare Zeichenfläche, um korrekt auf den
// Inhalt einzupassen. Danach bleibt das Modul im Speicher – wer zeichnet, zum
// Hub wechselt und zurückkommt, findet seine Zeichnung unverändert vor.

const ZweiDModul = (() => {
  let gemountet = false;

  return {
    id: '2d',
    name: '2D-Aufmaß',

    mount() {
      if (gemountet) return;
      gemountet = true;
      init();
    },

    aktiviere() {
      this.mount();

      // Route entscheidet, welcher Bildschirm des Moduls zu sehen ist.
      if (window.location.hash === '#/2d/projekte') { zeigeProjektListe(); return; }

      // Ohne gewähltes Projekt gibt es nichts zu zeichnen – dann zuerst die
      // Liste anbieten, statt wortlos eine leere Fläche zu zeigen. Gibt es
      // überhaupt kein Projekt, bleibt es bei der freien Zeichnung.
      const gewaehlt = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
      const bekannt  = gewaehlt && loadLinkedProjects().some(p => p.id === gewaehlt);
      if (!bekannt && loadLinkedProjects().length) {
        Shell.gehe('#/2d/projekte');
        return;
      }

      zeigeZeichnung();

      // Wurde im Aufmaß-Modul zwischenzeitlich ein anderes Projekt geöffnet,
      // gehört zu diesem Projekt eine andere Zeichnung. Der Wechsel läuft über
      // dieselbe Funktion wie überall sonst – ein Dokument, ein Aufbau.
      const id = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || null;
      if (id !== linkedProjectId) {
        flushAutosave2d();
        resetState2d();
        loadFromLinkedProject();
        normalizeState();
        uebernehmeDokumentInOberflaeche();
      }

      aktualisiereZeichenflaeche();
    },

    deaktiviere() {
      if (!gemountet) return;
      flushAutosave2d();
      // Offene Sheets/Menüs/Overlays hängen am <body> und würden sonst über
      // dem anderen Modul stehen bleiben.
      schliesseOffeneOberflaechen();
    },

    hatUngespeicherte() {
      // Nicht am Timer messen: der läuft nach jedem Neuzeichnen an. Gemeint
      // ist, ob der Speicher einen anderen Stand hat als der Bildschirm.
      return gemountet && hatUngespeicherteAenderungen();
    }
  };
})();
