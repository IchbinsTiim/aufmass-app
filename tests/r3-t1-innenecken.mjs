// Runde 3 – Aufgabe 1: Aufmaß an Innenecken.
//
// Fachliche Regel (Rücksprung/Versatz in der Fassade):
//   • durchlaufende Achse  – letztes Feld vor der Ecke MINUS Ecklänge
//   • ausfüllende Achse    – Feld an der Ecke PLUS Ecklänge
//   • Achse ohne Eckbezug  – unverändert
// Referenzbeispiel aus der Aufgabenstellung (Ecklänge 0,73 m):
//   Achse 1: 2,57 + 2,57 + (2,57 − 0,73) = 6,98 m
//   Achse 2: 2,57 + 0,73                 = 3,30 m
//   Achse 3: 3 × 2,57                    = 7,71 m
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 3 · AUFGABE 1 – Aufmaß an Innenecken\n');

/** Grundriss aus der Aufgabenstellung: Achse 1 läuft in eine Innenecke,
 *  Achse 2 füllt sie aus, Achse 3 liegt unabhängig daneben. */
async function seedBeispiel() {
  return page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    state.aufmass = null; state.ecken = {};
    state.depth = 0.73;
    state.project = 'Innenecken';

    const add = (angle, x, y, len) => {
      const s = mkSection('E', x, y); setSectionAngle(s, angle);
      const b = mkBay(len); b.hL = 10; b.hR = 10;
      s.bays.push(b); state.sections.push(s); return s;
    };
    let x = 0;
    for (let i = 0; i < 3; i++) { add(0, x, 0, 2.57); x += 2.57 * PX_PER_M; }
    add(270, x, 0, 2.57);                                   // füllt die Ecke
    let x3 = 0;
    for (let i = 0; i < 3; i++) { add(0, x3, 1500, 2.57); x3 += 2.57 * PX_PER_M; }
    renderAll(); flushRender();
    return { sections: state.sections.length };
  });
}

const laengen = () => page.evaluate(() =>
  aufmassAchsen().map(a => ({ name: a.name, laenge: a.m.laenge, weg: a.rechenweg, rollen: a.rollen })));

await seedBeispiel();

// ── 1. Erkennung ──────────────────────────────────────────────────────────
const erkannt = await page.evaluate(() => eckenListe().map(e => ({
  art: e.art, auto: e.artAuto,
  durch: state.sections[e.durchSi].name,
  fuell: state.sections[e.fuellSi].name,
  bestaetigt: e.bestaetigt
})));
assert(erkannt.length === 1 && erkannt[0].art === 'innen',
  `die Innenecke wird als solche erkannt (${erkannt.map(e => e.art).join(', ') || 'keine Ecke'})`);
assert(erkannt[0].durch === 'A3' && erkannt[0].fuell === 'A4',
  `Vorschlag: die längere Achse läuft durch (${erkannt[0].durch}), die kürzere füllt (${erkannt[0].fuell})`);
assert(erkannt[0].bestaetigt === false,
  'der Vorschlag ist als „noch nicht bestätigt" gekennzeichnet');

// ── 2. Das Rechenbeispiel ─────────────────────────────────────────────────
const a = await laengen();
assert(a.length === 3, `drei Achsen erkannt (${a.length})`);
assert(Math.abs(a[0].laenge - 6.98) < 0.005,
  `durchlaufende Achse: ${a[0].weg} = ${a[0].laenge} m (Soll 6,98)`);
assert(Math.abs(a[1].laenge - 3.30) < 0.005,
  `ausfüllende Achse: ${a[1].weg} = ${a[1].laenge} m (Soll 3,30)`);
assert(Math.abs(a[2].laenge - 7.71) < 0.005,
  `unabhängige Achse ohne Eckbezug bleibt unverändert: ${a[2].laenge} m (Soll 7,71)`);
assert(a[0].rollen[0] === 'durchlaufend' && a[1].rollen[0] === 'ausfüllend' && !a[2].rollen.length,
  'die Rollen werden je Achse ausgewiesen');
assert(a[0].weg.includes('(2,57 − 0,73)') && a[1].weg.includes('(2,57 + 0,73)'),
  'der Rechenweg zeigt feldgenau, welches Feld gekürzt bzw. verlängert wurde');

// ── 3. In der Summe ist die Innenecke neutral ─────────────────────────────
const summe = await page.evaluate(() => computeAufmass(visibleBaysFlat()));
assert(Math.abs(summe.laenge - 17.99) < 0.005 && summe.innenLaenge === 0,
  `Gesamtlänge bleibt das Achsmaß – die Ecke verschiebt nur zwischen den Achsen (${summe.laenge} m)`);
assert(Math.abs(6.98 + 3.30 + 7.71 - summe.laenge) < 0.005,
  'die Achslängen summieren sich exakt zur Gesamtlänge');

// ── 4. Der Nutzer entscheidet, welche Achse durchläuft ────────────────────
const getauscht = await page.evaluate(() => {
  const e = eckenListe()[0];
  setEckWahl(e.key, { durch: state.sections[e.fuellSi].id });   // Rollen tauschen
  const neu = eckenListe()[0];
  return {
    durch: state.sections[neu.durchSi].name, bestaetigt: neu.bestaetigt,
    achsen: aufmassAchsen().map(x => x.m.laenge)
  };
});
assert(getauscht.durch === 'A4' && getauscht.bestaetigt,
  'die Zuordnung lässt sich umdrehen und gilt danach als bestätigt');
assert(Math.abs(getauscht.achsen[0] - 8.44) < 0.005 && Math.abs(getauscht.achsen[1] - 1.84) < 0.005,
  `getauscht rechnet die Ecke andersherum (${getauscht.achsen[0]} m / ${getauscht.achsen[1]} m)`);

// zurück auf den Vorschlag
await page.evaluate(() => { state.ecken = {}; renderAll(); flushRender(); });

// ── 4b. Die Eckenliste wird gemerkt – aber nie veraltet ausgeliefert ──────
// Die Liste ist gepuffert (sonst kostet ein Aufmaß über viele Achsen ~0,6 s).
// Ein Puffer, der eine Änderung verschläft, wäre schlimmer als gar keiner:
// deshalb hier jede Größe einzeln anfassen, ohne zwischendurch neu zu zeichnen.
const puffer = await page.evaluate(() => {
  const art = () => eckenListe().map(e => e.art).join(',');
  const vorher = art();
  const sec = state.sections[3];                     // die ausfüllende Achse
  const altX = sec.x0;
  sec.x0 += 500;                                     // Ecke auseinanderziehen
  const getrennt = art();
  sec.x0 = altX;
  const wieder = art();
  state.sections[0].bays[0].len = 4;                 // Länge ändert den Vorschlag
  const andereLaenge = eckenListe().map(e => state.sections[e.durchSi].name).join(',');
  state.sections[0].bays[0].len = 2.57;
  state.depth = 1.09;                                // Tiefe ändert die Eckgeometrie
  const andereTiefe = art();
  state.depth = 0.73;
  return { vorher, getrennt, wieder, andereLaenge, andereTiefe };
});
assert(puffer.vorher === 'innen' && puffer.getrennt === '' && puffer.wieder === 'innen',
  'ein verschobenes Feld wirkt sofort auf die Eckenliste (kein veralteter Puffer)');
assert(puffer.andereLaenge === 'A3' && puffer.andereTiefe === 'innen',
  'auch geänderte Feldlängen und Gerüsttiefen schlagen sofort durch');

// ── 5. Ecklänge ist konfigurierbar, Regel abschaltbar ─────────────────────
const konfig = await page.evaluate(() => {
  const out = {};
  aufmassRules().innenecke.wert = 1.09;
  out.gross = aufmassAchsen().map(x => x.m.laenge);
  aufmassRules().innenecke.wert = null;
  state.depth = 1.09;                       // ohne eigenen Wert gilt die Gerüsttiefe
  out.tiefe = aufmassAchsen().map(x => x.m.laenge);
  state.depth = 0.73;
  aufmassRules().innenecke.aktiv = false;
  out.aus = aufmassAchsen().map(x => x.m.laenge);
  aufmassRules().innenecke.aktiv = true;
  return out;
});
assert(Math.abs(konfig.gross[0] - 6.62) < 0.005 && Math.abs(konfig.gross[1] - 3.66) < 0.005,
  `eigene Ecklänge wird übernommen (1,09 m → ${konfig.gross[0]} m / ${konfig.gross[1]} m)`);
assert(Math.abs(konfig.tiefe[0] - 6.62) < 0.005,
  'ohne eigenen Wert gilt die Gerüsttiefe als Ecklänge');
assert(Math.abs(konfig.aus[0] - 7.71) < 0.005 && Math.abs(konfig.aus[1] - 2.57) < 0.005,
  'abgeschaltet bleibt es beim reinen Achsmaß');

// ── 6. Außenecken bleiben unberührt (La = L + L1) ─────────────────────────
const aussen = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0;
  state.aufmass = null; state.ecken = {}; state.depth = 0.73;
  const add = (angle, x, y) => {
    const s = mkSection('E', x, y); setSectionAngle(s, angle);
    const b = mkBay(2.57); b.hL = 10; b.hR = 10; s.bays.push(b);
    state.sections.push(s);
  };
  const L = 2.57 * PX_PER_M;
  add(0, 0, 0); add(0, L, 0);          // Ost
  add(90, 2 * L, 0); add(90, 2 * L, L); // Süd → Außenecke
  renderAll(); flushRender();
  const arten = eckenListe().map(e => e.art);
  aufmassRules().eckzuschlag.aktiv = true;
  const m = computeAufmass(visibleBaysFlat());
  return { arten, ecken: m.ecken, laenge: m.laenge, innen: m.innenecken };
});
assert(aussen.arten.length === 1 && aussen.arten[0] === 'aussen',
  'die Außenecke wird weiterhin als Außenecke erkannt');
assert(aussen.innen === 0 && aussen.ecken === 2 && Math.abs(aussen.laenge - (4 * 2.57 + 2 * 0.73)) < 0.01,
  `Außenecke rechnet unverändert beidseitig (${aussen.laenge} m), keine Innenecken-Korrektur`);

// ── 7. Gespiegelte Wände: Ecke bleibt erkannt und behält ihre Art ─────────
// Früher war die Erkennung blind gegenüber sec.flip – gespiegelte L-Formen
// verloren ihre Ecke ersatzlos.
const spiegel = await page.evaluate(() => {
  const bauen = flip => {
    state.sections = []; _sId = 0; _bId = 0;
    state.aufmass = null; state.ecken = {}; state.depth = 0.73;
    const L = 2.57 * PX_PER_M;
    const add = (angle, x, y) => {
      const s = mkSection('E', x, y); setSectionAngle(s, angle); s.flip = flip;
      const b = mkBay(2.57); b.hL = 10; b.hR = 10; s.bays.push(b);
      state.sections.push(s);
    };
    if (!flip) { add(0, 0, 0); add(0, L, 0); }
    else       { add(180, 4 * L, 0); add(180, 3 * L, 0); }
    add(90, 2 * L, 0); add(90, 2 * L, L);
    renderAll(); flushRender();
    return eckenListe().map(e => e.art);
  };
  return { normal: bauen(false), gespiegelt: bauen(true) };
});
assert(spiegel.normal.length === 1 && spiegel.gespiegelt.length === 1,
  `die gespiegelte L-Form behält ihre Ecke (${spiegel.gespiegelt.length})`);
assert(spiegel.normal[0] === 'aussen' && spiegel.gespiegelt[0] === 'aussen',
  `Spiegeln ändert die Art der Ecke nicht (${spiegel.normal[0]} / ${spiegel.gespiegelt[0]})`);

// ── 8. Innenecke wird nicht als Gerüstfläche gezeichnet ───────────────────
await seedBeispiel();
const gezeichnet = await page.evaluate(() => {
  const gefuellt = [...document.querySelectorAll('#planGroup polygon')]
    .filter(p => p.getAttribute('fill') === '#b5d4f0').length;
  const vorher = contentBounds();
  const marker = !!document.querySelector('#planGroup path[stroke-dasharray]');
  return { gefuellt, marker, vorher };
});
assert(gezeichnet.gefuellt === 0,
  'an der Innenecke wird KEIN gefülltes Eckstück gezeichnet (dort überlappen die Bahnen)');
assert(gezeichnet.marker,
  'stattdessen erscheint eine gestrichelte, antippbare Markierung');

// ── 9. Die Regel verändert die maßstäbliche Zeichnung nicht ───────────────
assert(await page.evaluate(() => {
  const before = contentBounds();
  aufmassRules().innenecke.wert = 3;
  renderAll(); flushRender();
  const after = contentBounds();
  aufmassRules().innenecke.wert = null;
  return before.w === after.w && before.h === after.h;
}), 'die Korrektur wirkt nur aufs Aufmaß, nicht auf die Zeichnung');

// ── 10. Bedienung: Ecke antippen und festlegen ────────────────────────────
const dialog = await page.evaluate(() => {
  const key = eckenListe()[0].key;
  openEckSheet(key);
  const sheet = document.getElementById('bottomSheet');
  const wahl  = [...sheet.querySelectorAll('.eck-choice')];
  const texte = wahl.map(b => b.textContent);
  wahl.find(b => /A4 läuft durch/.test(b.textContent)).click();
  const e = eckenListe()[0];
  const nachher = { durch: state.sections[e.durchSi].name, bestaetigt: e.bestaetigt };
  // zurücksetzen
  state.ecken = {}; closeSheet(); renderAll(); flushRender();
  return { texte, nachher };
});
assert(dialog.texte.length === 2 && dialog.texte.every(t => /\d+,\d+ m/.test(t)),
  `der Dialog zeigt beide Möglichkeiten mit ihrem Ergebnis: „${dialog.texte[0]}"`);
assert(dialog.nachher.durch === 'A4' && dialog.nachher.bestaetigt,
  'ein Tipp legt die Zuordnung fest');

// ── 11. Entscheidung überlebt Speichern/Laden ─────────────────────────────
const persist = await page.evaluate(() => {
  const key = eckenListe()[0].key;
  setEckWahl(key, { durch: state.sections[eckenListe()[0].fuellSi].id, typ: 'innen' });
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  state.ecken = {};                            // „App neu geladen"
  const d = JSON.parse(json);
  state.ecken = d.state.ecken;
  normalizeState();
  const e = eckenListe()[0];
  return { durch: state.sections[e.durchSi].name, bestaetigt: e.bestaetigt, art: e.art };
});
assert(persist.durch === 'A4' && persist.bestaetigt && persist.art === 'innen',
  'die Eck-Entscheidung wird mit der Zeichnung gespeichert und wieder geladen');

// ── 12. PDF weist die Achsen mit den korrigierten Längen aus ──────────────
const pdf = await page.evaluate(async () => {
  state.ecken = {};                            // zurück auf den Vorschlag
  renderAll(); flushRender();
  window.__pdfSaved = null;
  await buildPdf('technisch');
  return window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2])).join('\n');
});
assert(/Aufmaß je Achse/.test(pdf), 'das PDF enthält eine Aufstellung je Achse');
assert(pdf.includes('6,98') && pdf.includes('3,3') && pdf.includes('7,71'),
  'das PDF zeigt die korrigierten Achslängen 6,98 / 3,30 / 7,71 m');
assert(/2,57 \+ 2,57 \+ \(2,57 − 0,73\)/.test(pdf),
  'das PDF schreibt den Rechenweg feldgenau aus');
assert(/Innenecke/.test(pdf), 'das PDF benennt die Innenecken-Regel');
assert(/durchlaufend/.test(pdf) && /ausfüllend/.test(pdf),
  'das PDF weist je Achse aus, ob sie durchläuft oder die Ecke ausfüllt');

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 3 / Aufgabe 1 bestanden.');
await ctx.close();
