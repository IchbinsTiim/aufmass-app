// Runde 2 – Aufgabe 6: Aufmaßregeln nach ATV DIN 18451.
// Grundlage Achsmaße, Außenecke beidseitig (La = L + L1), fester Feldaufschlag
// – alles als konfigurierbare Parameter, nicht hart kodiert.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 2 · AUFGABE 6 – Aufmaßregeln (ATV DIN 18451)\n');

/** L-Form: 4 Felder nach Osten, dann 3 nach Süden → genau eine Außenecke. */
async function seedL() {
  return page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false; state.aufmass = null;
    state.depth = 0.73;
    state.project = 'Aufmaßregeln';
    let x = 0;
    for (let i = 0; i < 4; i++) {
      const s = mkSection('E', x, 0); setSectionAngle(s, 0);
      const b = mkBay(2.57); b.hL = 10; b.hR = 10;
      s.bays.push(b); state.sections.push(s); x += 257;
    }
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const s = mkSection('S', x, y); setSectionAngle(s, 90);
      const b = mkBay(3.07); b.hL = 10; b.hR = 10;
      s.bays.push(b); state.sections.push(s); y += 307;
    }
    renderAll(); flushRender();
    return {
      achse: +(4 * 2.57 + 3 * 3.07).toFixed(2),
      ecken: computeLayout().filter(e => e.type === 'corner').length,
      chains: wallChains().length
    };
  });
}

const geo = await seedL();
assert(geo.ecken === 1, `Grundriss hat genau eine Außenecke (${geo.ecken})`);
assert(geo.chains === 2, `Grundriss hat zwei Wände (${geo.chains})`);

// ── Grundlage: reines Achsmaß, keine Zuschläge im Auslieferungszustand ─────
const plain = await page.evaluate(() => computeAufmass(visibleBaysFlat()));
assert(Math.abs(plain.achse - geo.achse) < 0.01 && Math.abs(plain.laenge - plain.achse) < 0.01,
  `ohne Zuschläge ist die Aufmaßlänge das Achsmaß (${plain.laenge} m)`);
assert(plain.ecken === 0 && plain.felder === 0,
  'Zuschläge sind standardmäßig aus – bestehende Aufmaße ändern sich nicht von allein');
assert(Math.abs(plain.flaeche - plain.achse * 10) < 0.05,
  `Fläche folgt dem Achsmaß × Höhe (${plain.flaeche} m²)`);

// ── Außenecke: zählt bei BEIDEN angrenzenden Seiten (La = L + L1) ──────────
const eck = await page.evaluate(() => {
  aufmassRules().eckzuschlag.aktiv = true;
  return { m: computeAufmass(visibleBaysFlat()), wert: eckZuschlagWert() };
});
assert(eck.m.ecken === 2,
  `eine Außenecke wird bei beiden Seiten gerechnet (${eck.m.ecken} Anrechnungen)`);
assert(Math.abs(eck.wert - 0.73) < 0.001,
  `ohne eigenen Wert gilt die Gerüsttiefe als Ecklänge (${eck.wert} m)`);
assert(Math.abs(eck.m.laenge - (geo.achse + 2 * 0.73)) < 0.01,
  `Aufmaßlänge = Achsmaß + 2 × Ecklänge (${eck.m.laenge} m)`);

// Ecklänge ist konfigurierbar (nicht hart kodiert)
const eckCustom = await page.evaluate(() => {
  aufmassRules().eckzuschlag.wert = 0.5;
  return computeAufmass(visibleBaysFlat());
});
assert(Math.abs(eckCustom.laenge - (geo.achse + 2 * 0.5)) < 0.01,
  `eigene Ecklänge wird übernommen (${eckCustom.laenge} m bei 0,50 m je Seite)`);

// Gerüsttiefe ändern verschiebt nur die Vorgabe, nicht das Achsmaß
const depthChanged = await page.evaluate(() => {
  aufmassRules().eckzuschlag.wert = null;
  state.depth = 1.09;
  const m = computeAufmass(visibleBaysFlat());
  state.depth = 0.73;
  return m;
});
assert(Math.abs(depthChanged.achse - geo.achse) < 0.01,
  'das Achsmaß bleibt unabhängig vom Gerüstsystem/der Systembreite');
assert(Math.abs(depthChanged.laenge - (geo.achse + 2 * 1.09)) < 0.01,
  `die Vorgabe-Ecklänge folgt der Systembreite (${depthChanged.laenge} m bei 1,09 m Tiefe)`);

// ── Fester Feldaufschlag: Wert und Wirkungsbereich konfigurierbar ──────────
const modi = await page.evaluate(() => {
  aufmassRules().eckzuschlag.aktiv = false;
  const r = aufmassRules();
  r.feldzuschlag.aktiv = true;
  const out = {};
  ['feld', 'wand', 'einzelfeld'].forEach(m => {
    r.feldzuschlag.modus = m;
    out[m] = computeAufmass(visibleBaysFlat());
  });
  r.feldzuschlag.wert = 0.73;
  r.feldzuschlag.modus = 'feld';
  out.schmal = computeAufmass(visibleBaysFlat());
  return out;
});
assert(modi.feld.felder === 7 && Math.abs(modi.feld.laenge - (geo.achse + 7 * 0.80)) < 0.01,
  `„je Feld": 7 × 0,80 m Aufschlag (${modi.feld.laenge} m)`);
assert(modi.wand.felder === 2 && Math.abs(modi.wand.laenge - (geo.achse + 2 * 0.80)) < 0.01,
  `„je Wand": einmal je zusammenhängender Wand (${modi.wand.laenge} m)`);
assert(modi.einzelfeld.felder === 0,
  '„nur Einzelfeld": durchgehende Wände bekommen keinen Aufschlag');
assert(Math.abs(modi.schmal.laenge - (geo.achse + 7 * 0.73)) < 0.01,
  `kleinere Systembreite: 0,73 m statt 0,80 m (${modi.schmal.laenge} m)`);

// Einfeldriges Gerüst bekommt den Aufschlag im Modus „nur Einzelfeld"
const einzeln = await page.evaluate(() => {
  const s = mkSection('E', 0, 2000); setSectionAngle(s, 0);
  const b = mkBay(2.57); b.hL = 10; b.hR = 10;
  s.bays.push(b); state.sections.push(s);
  const r = aufmassRules();
  r.feldzuschlag.wert = 0.80; r.feldzuschlag.modus = 'einzelfeld';
  renderAll(); flushRender();
  const m = computeAufmass(visibleBaysFlat());
  state.sections.pop();
  renderAll(); flushRender();
  return m;
});
assert(einzeln.felder === 1,
  'ein freistehendes Einzelfeld erhält im Modus „nur Einzelfeld" genau einen Aufschlag');

// ── Zuschläge je Abschnitt: eine Ecke zählt in beiden Abschnitten ──────────
const perAbschnitt = await page.evaluate(() => {
  const west = addAbschnitt('Westseite');
  const sued = addAbschnitt('Südseite');
  state.sections.forEach((s, i) => s.bays.forEach(b => { b.abschnittId = i < 4 ? west.id : sued.id; }));
  const r = aufmassRules();
  r.eckzuschlag.aktiv = true; r.eckzuschlag.wert = null;
  r.feldzuschlag.aktiv = false;
  renderAll(); flushRender();
  return baysByAbschnitt().map(g => ({
    name: g.abschnitt.name, m: computeAufmass(g.bays)
  }));
});
assert(perAbschnitt.every(g => g.m.ecken === 1),
  'jeder angrenzende Abschnitt rechnet die gemeinsame Ecke einmal mit: '
  + perAbschnitt.map(g => `${g.name} ${g.m.ecken}×`).join(', '));

// ── Regeln werden mit der Zeichnung gespeichert ────────────────────────────
const persisted = await page.evaluate(() => {
  const r = aufmassRules();
  r.feldzuschlag.aktiv = true; r.feldzuschlag.wert = 0.73; r.feldzuschlag.modus = 'wand';
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  state.aufmass = null;                      // „App neu geladen"
  const d = JSON.parse(json);
  state.aufmass = d.state.aufmass;
  normalizeState();
  const back = aufmassRules();
  return { aktiv: back.feldzuschlag.aktiv, wert: back.feldzuschlag.wert,
           modus: back.feldzuschlag.modus, eck: back.eckzuschlag.aktiv };
});
assert(persisted.aktiv && persisted.wert === 0.73 && persisted.modus === 'wand' && persisted.eck,
  'die eingestellten Aufmaßregeln überleben Speichern/Laden');

/* ── PDF: kein Regeltext mehr, aber dieselbe Rechnung ─────────────────────
   Seit Runde 7 steht KEIN Text nach ATV DIN 18451 mehr im PDF und es gibt
   auch keine Auswahlmöglichkeiten am Ende des Export-Dialogs. Die Korrektur-
   logik rechnet unverändert im Hintergrund weiter – nachgewiesen an den
   Werten, die computeAufmass() liefert, und an der Bruttofläche, die als
   Position 1 im PDF steht.                                                 */
const pdfInfo = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return {
    texte: window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2])),
    gesamt: computeAufmass(visibleBaysFlat()),
    pos1: pdfAufmassDaten().reduce((s, g) => s + g.pos1.summe, 0)
  };
});
const joined = pdfInfo.texte.join('\n');
assert(!/Grundlage:/.test(joined) && !/DIN\s?18451/.test(joined)
    && !/Achsmaße der Gerüstkonstruktion/.test(joined),
  'im PDF steht kein Regeltext nach ATV DIN 18451 mehr');
const fmtDe = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
assert(pdfInfo.texte.includes(fmtDe(pdfInfo.pos1) + ' m²'),
  `die Gesamt-Gerüstfläche steht im PDF (${fmtDe(pdfInfo.pos1)} m²)`);
assert(pdfInfo.gesamt.ecken > 0 && pdfInfo.gesamt.felder > 0,
  `Eck- und Feldzuschlag rechnen weiterhin im Hintergrund `
  + `(${pdfInfo.gesamt.ecken} Ecken, ${pdfInfo.gesamt.felder} Feldaufschläge)`);

// ── Der Export-Dialog trägt die Auswahlmöglichkeiten nicht mehr ───────────
const dialog = await page.evaluate(() => {
  openPdfSheet();
  const sheet = document.getElementById('bottomSheet');
  const txt   = sheet.textContent;
  const out = {
    optRows:   sheet.querySelectorAll('.pdf-opt-row').length,
    settings:  !!sheet.querySelector('.aufmass-settings'),
    presets:   sheet.querySelectorAll('.aufmass-preset').length,
    din:       /DIN\s?18451/.test(txt),
    hatLayout: sheet.querySelectorAll('.pdf-theme-card').length
  };
  closeSheet();
  return out;
});
assert(!dialog.settings && dialog.presets === 0 && !dialog.din,
  'die Auswahlmöglichkeiten am Ende des PDF-Dialogs sind ersatzlos entfallen');
assert(dialog.hatLayout === 2,
  'die Wahl der Ausgabe (Farbe / Schwarz-Weiß) bleibt erhalten');

// ── Der eingestellte Wert wirkt NICHT auf die Zeichnung ────────────────────
assert(await page.evaluate(() => {
  const before = contentBounds();
  aufmassRules().feldzuschlag.wert = 5;
  renderAll(); flushRender();
  const after = contentBounds();
  return before.w === after.w && before.h === after.h;
}), 'Zuschläge verändern die maßstäbliche Zeichnung nicht');

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 2 / Aufgabe 6 bestanden.');
await ctx.close();
