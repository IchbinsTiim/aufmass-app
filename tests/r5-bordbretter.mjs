// Runde 5 – Bordbretter-Linie zeichnen und einer Achse zuordnen.
//
// Fachliche Regel (aus dem Aufmaßblatt):
//   Das Aufmaß folgt dem tatsächlichen Verlauf der BORDBRETTER am Rand der
//   Gerüstlage – nicht pauschalen Achsmaßen.
//     • Linie knickt an einer INNENECKE nach innen  → Länge − Gerüsttiefe
//     • Linie knickt an einer AUSSENECKE nach außen → Länge + Gerüsttiefe
//   Der Korrekturwert ist KEINE Konstante, sondern immer die eingestellte
//   Gerüsttiefe (0,73 m im Beispiel, 1,09 m bei breiterem System).
//
// Testbeispiel bei 0,73 m Gerüsttiefe:
//   Achse durch eine Innenecke : letztes Feld vor der Ecke − 0,73 m
//   Achse an einer Außenecke   : Feld an der Ecke + 0,73 m
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 5 – Bordbretter-Linie und Achszuordnung\n');

/** Grundriss mit Innenecke (wie Runde 3): A1–A3 laufen nach Osten, A4 nach
 *  Norden. Die Bordbretter laufen an der Außenkante entlang und knicken an
 *  der Innenecke ab. */
async function seedInnenecke() {
  return page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    state.aufmass = null; state.ecken = {}; state.bordbretter = [];
    state.depth = 0.73;
    state.project = 'Bordbretter';
    const add = (angle, x, y, len) => {
      const s = mkSection('E', x, y); setSectionAngle(s, angle);
      const b = mkBay(len); b.hL = 10; b.hR = 10;
      s.bays.push(b); state.sections.push(s); return s;
    };
    let x = 0;
    for (let i = 0; i < 3; i++) { add(0, x, 0, 2.57); x += 2.57 * PX_PER_M; }
    add(270, x, 0, 2.57);
    renderAll(); flushRender();
  });
}

/** Grundriss mit Außenecke: A1–A2 nach Osten, A3–A4 nach Süden. */
async function seedAussenecke() {
  return page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    state.aufmass = null; state.ecken = {}; state.bordbretter = [];
    state.depth = 0.73;
    const add = (angle, x, y) => {
      const s = mkSection('E', x, y); setSectionAngle(s, angle);
      const b = mkBay(2.57); b.hL = 10; b.hR = 10; s.bays.push(b);
      state.sections.push(s);
    };
    const L = 2.57 * PX_PER_M;
    add(0, 0, 0); add(0, L, 0);
    add(90, 2 * L, 0); add(90, 2 * L, L);
    renderAll(); flushRender();
  });
}

/** Zeichnet eine Linie über die App-Funktionen: Rohpunkte werden – wie beim
 *  Antippen – auf die Feldkanten eingerastet. */
const zeichne = (punkte, achsIdx) => page.evaluate(([roh, idx]) => {
  const gerastet = roh.map(p => {
    const s = bordbrettSnap({ x: p[0], y: p[1] }, 30);
    return { x: s.x, y: s.y, art: s.art };
  });
  const linie = mkBordbrett(gerastet);
  bordbretterListe().push(linie);
  invalidateEckenCache();
  if (idx != null) bordbrettZuordnen(linie, achsenListe()[idx]);
  renderAll(); flushRender();
  return { id: linie.id, punkte: gerastet };
}, [punkte, achsIdx]);

const achsen = () => page.evaluate(() =>
  aufmassAchsen().map(a => ({ name: a.name, laenge: a.m.laenge, weg: a.rechenweg, rollen: a.rollen })));

// ══ 1. Innenecke: Linie einzeichnen, einrasten, zuordnen ═══════════════════
await seedInnenecke();

// Punkte bewusst ein paar Zentimeter NEBEN der Kante antippen – das Einrasten
// muss sie exakt auf die Feldkante bzw. deren Eckpunkt ziehen.
const gezeichnet = await zeichne([[4, -70], [702, -76], [694, -254]], null);
assert(gezeichnet.punkte.every(p => p.art !== 'frei'),
  `alle Punkte rasten auf Feldkanten ein (${gezeichnet.punkte.map(p => p.art).join(', ')})`);
assert(Math.abs(gezeichnet.punkte[1].x - 698) < 0.01 && Math.abs(gezeichnet.punkte[1].y + 73) < 0.01,
  `der Knickpunkt rastet exakt auf die Ecke der Feldkanten (${gezeichnet.punkte[1].x}/${gezeichnet.punkte[1].y})`);

// Ohne Zuordnung ist die Linie nur eine Notiz: es gilt weiter der bisherige
// Vorschlag („die längere Achse läuft durch"), erkennbar an `bestaetigt`.
const vorZuordnung = await page.evaluate(() => {
  const e = eckenListe()[0];
  return { quelle: e.quelle, bestaetigt: e.bestaetigt, offen: offeneInnenecken().length };
});
assert(vorZuordnung.quelle === 'vorschlag' && !vorZuordnung.bestaetigt && vorZuordnung.offen === 1,
  'ohne Zuordnung wirkt die Linie nicht – die Ecke bleibt ein unbestätigter Vorschlag');

const vorschlag = await page.evaluate(id => {
  const l = bordbrettById(id);
  const a = bordbrettAchsVorschlag(l);
  return a ? a.name : null;
}, gezeichnet.id);
assert(vorschlag === 'A1 – A3',
  `als Achse wird die vorgeschlagen, an der die Linie überwiegend entlangläuft (${vorschlag})`);

await page.evaluate(id => {
  bordbrettZuordnen(bordbrettById(id), bordbrettAchsVorschlag(bordbrettById(id)));
  renderAll(); flushRender();
}, gezeichnet.id);

const nachZuordnung = await achsen();
assert(Math.abs(nachZuordnung[0].laenge - 6.98) < 0.005,
  `Achse durch die Innenecke: letztes Feld − 0,73 m → ${nachZuordnung[0].weg} = ${nachZuordnung[0].laenge} m (Soll 6,98)`);
assert(Math.abs(nachZuordnung[1].laenge - 3.30) < 0.005,
  `die ausfüllende Achse bekommt denselben Wert zugeschlagen: ${nachZuordnung[1].laenge} m (Soll 3,30)`);
assert(nachZuordnung[0].weg.includes('(2,57 − 0,73)'),
  'der Rechenweg zeigt feldgenau, welches Feld gekürzt wurde');

const summe = await page.evaluate(() => computeAufmass(visibleBaysFlat()));
assert(Math.abs(summe.laenge - 10.28) < 0.005,
  `über beide Achsen bleibt die Innenecke neutral (${summe.laenge} m)`);

// Die Linie ist die Aussage des Nutzers – die Ecke gilt damit als festgelegt.
const eckStatus = await page.evaluate(() => {
  const e = eckenListe()[0];
  return { quelle: e.quelle, bestaetigt: e.bestaetigt,
           durch: state.sections[e.durchSi].name, offen: offeneInnenecken().length };
});
assert(eckStatus.quelle === 'bordbrett' && eckStatus.bestaetigt && eckStatus.durch === 'A3',
  `die eingezeichnete Linie legt die Innenecke fest (${eckStatus.durch}, Quelle ${eckStatus.quelle})`);
assert(eckStatus.offen === 0,
  'die Ecke gilt nicht mehr als „noch nicht festgelegt"');

// Dieselbe Linie der anderen Achse zugeordnet: dann läuft DIESE durch, und
// das Aufmaß dreht sich entsprechend um.
const andersherum = await page.evaluate(id => {
  bordbrettZuordnen(bordbrettById(id), achsenListe()[1]);
  renderAll(); flushRender();
  const e = eckenListe()[0];
  return { durch: state.sections[e.durchSi].name,
           achsen: aufmassAchsen().map(a => a.m.laenge) };
}, gezeichnet.id);
assert(andersherum.durch === 'A4'
    && Math.abs(andersherum.achsen[0] - 8.44) < 0.005
    && Math.abs(andersherum.achsen[1] - 1.84) < 0.005,
  `die Zuordnung entscheidet, welche Achse durchläuft (${andersherum.achsen[0]} / ${andersherum.achsen[1]} m)`);

await page.evaluate(id => {
  bordbrettZuordnen(bordbrettById(id), achsenListe()[0]);
  renderAll(); flushRender();
}, gezeichnet.id);

// ══ 2. Der Korrekturwert ist die Gerüsttiefe, keine Konstante ══════════════
const tiefen = await page.evaluate(() => {
  const out = {};
  state.depth = 1.09;
  // Die Zeichnung wird mit der neuen Tiefe breiter – die Linie wird
  // nachgezogen, wie es auch der Nutzer täte.
  const l = state.bordbretter[0];
  l.punkte = [{ x: 4, y: -109 }, { x: 771 - 109, y: -109 }, { x: 771 - 109, y: -257 }]
    .map(p => { const s = bordbrettSnap(p, 40); return { x: s.x, y: s.y }; });
  invalidateEckenCache(); renderAll(); flushRender();
  out.tief = aufmassAchsen().map(a => a.m.laenge);
  state.depth = 0.73;
  return out;
});
assert(Math.abs(tiefen.tief[0] - 6.62) < 0.005 && Math.abs(tiefen.tief[1] - 3.66) < 0.005,
  `bei 1,09 m Gerüsttiefe wird um 1,09 m korrigiert (${tiefen.tief[0]} / ${tiefen.tief[1]} m)`);

// ══ 3. Außenecke: Linie läuft um die Ecke herum → + Gerüsttiefe ════════════
await seedAussenecke();
const aussen = await zeichne([[3, -71], [590, -76], [586, 510]], null);
const aussenErg = await page.evaluate(id => {
  const l = bordbrettById(id);
  bordbrettZuordnen(l, achsenListe()[0]);
  renderAll(); flushRender();
  const aus = bordbrettAuswertung(l);
  return {
    zustand: aus.enden.map(e => e.zustand),
    art: aus.enden.map(e => (e.ecke ? e.ecke.art : null)),
    delta: aus.enden.map(e => e.delta),
    achsen: aufmassAchsen().map(a => ({ name: a.name, laenge: a.m.laenge, weg: a.rechenweg, rollen: a.rollen }))
  };
}, aussen.id);
assert(aussenErg.art[1] === 'aussen' && aussenErg.zustand[1] === 'laenger',
  `die Linie wird als „läuft um die Außenecke herum" erkannt (${aussenErg.zustand.join('/')})`);
assert(Math.abs(aussenErg.delta[1] - 0.73) < 0.005,
  `Außenecke: + Gerüsttiefe (${aussenErg.delta[1]} m)`);
assert(Math.abs(aussenErg.achsen[0].laenge - 5.87) < 0.005,
  `Achse an der Außenecke: Feld an der Ecke + 0,73 m → ${aussenErg.achsen[0].weg} = ${aussenErg.achsen[0].laenge} m (Soll 5,87)`);
assert(Math.abs(aussenErg.achsen[1].laenge - 5.14) < 0.005,
  `die Nachbarachse ohne eigene Linie bleibt unverändert (${aussenErg.achsen[1].laenge} m)`);
assert(aussenErg.achsen[0].rollen.includes('um die Außenecke'),
  'die Rolle „um die Außenecke" wird je Achse ausgewiesen');

// Zweite Linie für die Nachbarseite: nach DIN zählt die Außenecke beidseitig.
const beidseitig = await page.evaluate(() => {
  const l = mkBordbrett([{ x: 3, y: -71 }, { x: 590, y: -76 }, { x: 586, y: 510 }]
    .map(p => { const s = bordbrettSnap(p, 30); return { x: s.x, y: s.y }; }));
  bordbretterListe().push(l);
  invalidateEckenCache();
  bordbrettZuordnen(l, achsenListe()[1]);
  renderAll(); flushRender();
  return aufmassAchsen().map(a => a.m.laenge);
});
assert(Math.abs(beidseitig[0] - 5.87) < 0.005 && Math.abs(beidseitig[1] - 5.87) < 0.005,
  `mit Linie auf beiden Seiten zählt die Außenecke beidseitig (${beidseitig[0]} / ${beidseitig[1]} m)`);

// Kein Doppelzählen, wenn zusätzlich der pauschale Eckzuschlag aktiv ist.
const dopplung = await page.evaluate(() => {
  aufmassRules().eckzuschlag.aktiv = true;
  const m = computeAufmass(visibleBaysFlat());
  aufmassRules().eckzuschlag.aktiv = false;
  return { ecken: m.ecken, laenge: m.laenge };
});
assert(dopplung.ecken === 2 && Math.abs(dopplung.laenge - (4 * 2.57 + 2 * 0.73)) < 0.01,
  `der pauschale Eckzuschlag zählt bereits gezeichnete Ecken nicht doppelt (${dopplung.ecken} × 0,73)`);

// ══ 4. Verlauf, der nicht zur Achse passt, korrigiert nichts ══════════════
const unklar = await page.evaluate(() => {
  state.bordbretter = [];
  const l = mkBordbrett([{ x: 3, y: -71 }, { x: 300, y: -73 }]);   // nur halbe Achse
  bordbretterListe().push(l);
  invalidateEckenCache();
  bordbrettZuordnen(l, achsenListe()[0]);
  renderAll(); flushRender();
  const aus = bordbrettAuswertung(l);
  return { zustand: aus.enden.map(e => e.zustand), delta: aus.enden.map(e => e.delta),
           laenge: aufmassAchsen()[0].m.laenge };
});
assert(unklar.zustand[1] === 'unklar' && unklar.delta[1] === 0,
  'ein Verlauf, der weder bündig noch um eine Gerüsttiefe versetzt endet, gilt als unklar');
assert(Math.abs(unklar.laenge - 5.14) < 0.005,
  `bei unklarem Verlauf bleibt es beim reinen Achsmaß (${unklar.laenge} m) – lieber keine Korrektur als eine falsche`);

// ══ 5. Zuordnung lässt sich ändern und aufheben ════════════════════════════
const umgehaengt = await page.evaluate(() => {
  state.bordbretter = [];
  const l = mkBordbrett([{ x: 3, y: -71 }, { x: 590, y: -76 }, { x: 586, y: 510 }]
    .map(p => { const s = bordbrettSnap(p, 30); return { x: s.x, y: s.y }; }));
  bordbretterListe().push(l);
  invalidateEckenCache();
  const out = {};
  bordbrettZuordnen(l, achsenListe()[0]);
  out.aufA = aufmassAchsen().map(a => a.m.laenge);
  bordbrettZuordnen(l, achsenListe()[1]);
  out.aufB = aufmassAchsen().map(a => a.m.laenge);
  bordbrettZuordnen(l, null);
  out.ohne = aufmassAchsen().map(a => a.m.laenge);
  loescheBordbrett(l.id);
  out.geloescht = state.bordbretter.length;
  renderAll(); flushRender();
  return out;
});
assert(Math.abs(umgehaengt.aufA[0] - 5.87) < 0.005 && Math.abs(umgehaengt.aufB[1] - 5.87) < 0.005,
  'dieselbe Linie lässt sich der einen oder der anderen Achse zuordnen');
assert(Math.abs(umgehaengt.ohne[0] - 5.14) < 0.005 && umgehaengt.geloescht === 0,
  'Zuordnung aufheben und Löschen wirken sofort');

// ══ 6. Bedienung: zeichnen über die Oberfläche ═════════════════════════════
await seedInnenecke();
const bedienung = await page.evaluate(() => {
  starteBordbrettZeichnen();
  const barSichtbar = !document.getElementById('bordbrettBar').classList.contains('hidden');
  bordbrettKlick({ x: 4, y: -70 });
  bordbrettKlick({ x: 702, y: -76 });
  const fertigGesperrt = document.getElementById('bordbrettFertigBtn').disabled;
  bordbrettKlick({ x: 694, y: -254 });
  const punkte = bordbrettPunkte.length;
  beendeBordbrettZeichnen();
  const sheetOffen = !!document.getElementById('bottomSheet');
  const wahl = [...document.querySelectorAll('.bordbrett-achs')].map(b => b.textContent);
  const zeilen = [...document.querySelectorAll('.bordbrett-zeile')].map(b => b.textContent);
  closeSheet();
  return { barSichtbar, fertigGesperrt, punkte, sheetOffen, wahl, zeilen,
           linien: state.bordbretter.length, modus: bordbrettModus,
           laenge: aufmassAchsen()[0].m.laenge };
});
assert(bedienung.barSichtbar && bedienung.punkte === 3 && !bedienung.modus,
  'Zeichenmodus: Leiste erscheint, Punkte sammeln sich, „Fertig" beendet ihn');
assert(bedienung.fertigGesperrt === false && bedienung.linien === 1,
  'ab zwei Punkten lässt sich die Linie abschließen');
assert(bedienung.sheetOffen && bedienung.wahl.some(t => /A1 – A3/.test(t)),
  `direkt danach öffnet sich die Achszuordnung (${bedienung.wahl.length} Achsen zur Wahl)`);
assert(bedienung.wahl.some(t => /6,98 m/.test(t)),
  'die Auswahl zeigt vorab, welche Aufmaßlänge sich daraus ergibt');
assert(bedienung.zeilen.some(t => /Innenecke/.test(t) && /− 0,73 m/.test(t)),
  `der Dialog benennt die erkannte Ecke und ihre Wirkung: „${bedienung.zeilen.find(t => /Innenecke/.test(t)) || ''}"`);
assert(Math.abs(bedienung.laenge - 6.98) < 0.005,
  `über die Oberfläche gezeichnet ergibt sich dieselbe Länge (${bedienung.laenge} m)`);

// ══ 7. Speichern / Laden ══════════════════════════════════════════════════
const persist = await page.evaluate(() => {
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  state.bordbretter = [];                       // „App neu geladen"
  invalidateEckenCache();
  const d = JSON.parse(json);
  state.bordbretter = d.state.bordbretter;
  normalizeState(); invalidateEckenCache();
  renderAll(); flushRender();
  return { anzahl: state.bordbretter.length,
           wirkung: bordbrettWirkung(state.bordbretter[0]),
           achsen: bordbrettAchsen(state.bordbretter[0]).map(a => a.name),
           laenge: aufmassAchsen()[0].m.laenge };
});
assert(persist.anzahl === 1 && persist.achsen.includes('A1 – A3')
    && Math.abs(persist.laenge - 6.98) < 0.005,
  `Linie und Wirkungsbereich werden gespeichert und wieder geladen `
  + `(${persist.wirkung}: ${persist.achsen.join(', ')})`);

// ══ 8. PDF übernimmt das Ergebnis ═════════════════════════════════════════
const pdf = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('technisch');
  return window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2])).join('\n');
});
assert(/Bordbretter-Linien und Eckenkorrektur/.test(pdf),
  'das PDF enthält die Aufstellung der Bordbretter-Linien');
assert(/Bordbrett 1/.test(pdf) && /Innenecke A3\/A4 − 0,73 m/.test(pdf),
  'das PDF benennt Linie, Achse und die daraus abgeleitete Eckenkorrektur');
// Fließtext wird im PDF umbrochen – für den Textvergleich wieder zusammenziehen.
assert(/Ecken nach dem gezeichneten Verlauf der Bordbretter/.test(pdf.replace(/\s+/g, ' ')),
  'die angewandte Regel steht als Grundlage im PDF');
assert(pdf.includes('6,98') && pdf.includes('3,3'),
  'das PDF zeigt die korrigierten Achslängen 6,98 / 3,30 m');
assert(/2,57 \+ 2,57 \+ \(2,57 − 0,73\)/.test(pdf),
  'das PDF schreibt den Rechenweg feldgenau aus');

// ══ 9. Verschiedene Höhen auf einer Seite getrennt zusammenfassen ══════════
// Straßenseite: 10 Felder à 2,57 m, davon 5 mit 10,20 m und 5 mit 8,20 m Höhe.
// Erwartet: 12,85 m × 10,20 m UND 12,85 m × 8,20 m – getrennt ausgewiesen.
const hoehen = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0;
  state.abschnitte = []; state.ecken = {}; state.bordbretter = []; state.aufmass = null;
  state.depth = 0.73;
  const ab = mkAbschnitt('Straßenseite');
  state.abschnitte.push(ab);
  let x = 0;
  for (let i = 0; i < 10; i++) {
    const s = mkSection('E', x, 0); setSectionAngle(s, 0);
    const b = mkBay(2.57);
    b.hL = b.hR = i < 5 ? 10.20 : 8.20;
    b.abschnittId = ab.id;
    s.bays.push(b); state.sections.push(s);
    x += 2.57 * PX_PER_M;
  }
  invalidateEckenCache(); renderAll(); flushRender();
  return aufmassNachHoehe(visibleBaysFlat()).map(g => ({
    hoehe: g.hoehe, felder: g.felder, laenge: g.laenge, flaeche: g.flaeche
  }));
});
assert(hoehen.length === 2,
  `die Seite wird nach Höhen getrennt zusammengefasst (${hoehen.length} Gruppen)`);
assert(hoehen[0].hoehe === 10.2 && Math.abs(hoehen[0].laenge - 12.85) < 0.005 && hoehen[0].felder === 5,
  `5 Felder à 2,57 m ergeben 12,85 m × 10,20 m (${hoehen[0].laenge} m)`);
assert(hoehen[1].hoehe === 8.2 && Math.abs(hoehen[1].laenge - 12.85) < 0.005,
  `die übrigen 5 Felder ergeben 12,85 m × 8,20 m (${hoehen[1].laenge} m)`);
assert(Math.abs(hoehen[0].flaeche - 131.07) < 0.02 && Math.abs(hoehen[1].flaeche - 105.37) < 0.02,
  `die Flächen werden je Höhe gerechnet (${hoehen[0].flaeche} / ${hoehen[1].flaeche} m²)`);

const pdfHoehen = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('technisch');
  return window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2])).join('\n');
});
assert(/Gerüsthöhe/.test(pdfHoehen),
  'das PDF enthält die Aufstellung nach Gerüsthöhen');
assert(/12,85 m × 10,2 m/.test(pdfHoehen) && /12,85 m × 8,2 m/.test(pdfHoehen),
  'das PDF weist „12,85 m × 10,20 m" und „12,85 m × 8,20 m" getrennt aus');

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 5 bestanden.');
await ctx.close();
