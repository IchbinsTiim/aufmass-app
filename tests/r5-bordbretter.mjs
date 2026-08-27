/* ══════════════════════════════════════════════════════════════════════════
   Runde 5 – Bordbrett

   Ein Bordbrett steht auf einer Kante der Gerüstlage. Erfasst wird deshalb
   genau das: die Kante. Die Menge ergibt sich zwingend aus der Geometrie –
   nicht aus einer Schätzung, nicht aus dem Verlauf einer frei gezeichneten
   Linie und nicht aus „Länge + Tiefe" als Faustformel.

   Geprüft werden die Abnahmefälle aus der Aufgabenstellung:
     1  ein Feld 2,57 × 0,73, nur die lange Unterseite        →  2,57 m
     2  zusätzlich eine kurze Seite (L-Form)                  →  3,30 m
     3  alle vier Seiten (Umfang)                             →  6,60 m
     4  drei Felder à 2,57 m, komplette Unterseite            →  7,71 m
     5  Feld um 90° gedreht, eine echte 2,57-m-Kante          →  2,57 m
     6  dieselbe Kante zweimal markiert                       →  einmal
   Dazu: Bedienung per Tipp und Wischen, Löschen, Aufmaß je Achse,
   Abwärtskompatibilität zu Zeichnungen mit alten Bordbretter-Linien.
   ══════════════════════════════════════════════════════════════════════════ */
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 5 – Bordbrett\n');

/** Baut n Felder à `len` in Laufrichtung `winkel` und leert die Bordbretter. */
const bau = (n, winkel = 0, len = 2.57, tiefe = 0.73) => page.evaluate(([n, w, len, t]) => {
  state.sections = []; _sId = 0; _bId = 0;
  state.depth = t;
  state.bordbrettKanten = [];
  state.ecken = {};
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const s = mkSection('E', x, y);
    setSectionAngle(s, w);
    s.bays.push(mkBay(len));
    state.sections.push(s);
    const e = sectionEnd(s); x = e.x; y = e.y;
  }
  renderAll(); flushRender();
  return allBaysFlat().map(b => b.id);
}, [n, winkel, len, tiefe]);

/** Setzt/entfernt Kanten und liefert die Gesamtmenge. */
const setze = (paare, an = true) => page.evaluate(([liste, an]) => {
  liste.forEach(([bayId, k]) => setzeBordbrettKante(bayId, k, an));
  renderAll(); flushRender();
  return +bordbrettGesamt().toFixed(2);
}, [paare, an]);

// ── 1. Ein Feld, nur die lange Unterseite ─────────────────────────────────
let ids = await bau(1);
let m = await setze([[ids[0], 0]]);
assert(Math.abs(m - 2.57) < 0.005, `Test 1 – nur die lange Kante: ${m} m (Soll 2,57)`);

// ── 2. L-Form: zusätzlich die kurze Seite ─────────────────────────────────
m = await setze([[ids[0], 1]]);
assert(Math.abs(m - 3.30) < 0.005, `Test 2 – plus kurze Seite: ${m} m (Soll 3,30)`);

// ── 3. Umfang: alle vier Seiten ───────────────────────────────────────────
m = await setze([[ids[0], 2], [ids[0], 3]]);
assert(Math.abs(m - 6.60) < 0.005, `Test 3 – alle vier Seiten: ${m} m (Soll 6,60)`);

// Gegenprobe: Umfang = 2 × Länge + 2 × Tiefe, auch bei anderer Gerüsttiefe
ids = await bau(1, 0, 2.57, 1.09);
m = await setze([0, 1, 2, 3].map(k => [ids[0], k]));
assert(Math.abs(m - (2 * 2.57 + 2 * 1.09)) < 0.005,
  `bei 1,09 m Gerüsttiefe ergibt derselbe Umlauf ${m} m (Soll 7,32) – die Tiefe ist keine Konstante`);

// ── 4. Drei Felder, komplette Unterseite ──────────────────────────────────
ids = await bau(3);
m = await setze(ids.map(id => [id, 0]));
assert(Math.abs(m - 7.71) < 0.005, `Test 4 – drei Felder à 2,57 m: ${m} m (Soll 7,71)`);

// ── 5. Gedrehtes Feld: die Kante behält ihre echte Länge ──────────────────
const gedreht = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  const s = mkSection('E', 0, 0);
  s.bays.push(mkBay(2.57));
  state.sections.push(s);
  setSectionAngle(s, 90);              // Feld steht senkrecht
  renderAll(); flushRender();
  const el = computeLayout().find(e => e.type === 'bay');
  const laengen = [0, 1, 2, 3].map(k => {
    const [p, q] = bayKante(el, k);
    return +kantenLaenge(p, q).toFixed(2);
  });
  // Senkrechtes Feld: die lange Kante läuft in Bildschirm-Y-Richtung.
  const senkrecht = Math.abs(el.pts[1].y - el.pts[0].y) > Math.abs(el.pts[1].x - el.pts[0].x);
  setzeBordbrettKante(state.sections[0].bays[0].id, 0, true);
  renderAll(); flushRender();
  return { laengen, senkrecht, menge: +bordbrettGesamt().toFixed(2) };
});
assert(gedreht.senkrecht, 'das Feld steht nach der Drehung tatsächlich senkrecht');
assert(JSON.stringify(gedreht.laengen) === JSON.stringify([2.57, 0.73, 2.57, 0.73]),
  `die vier Kanten behalten ihre Maße: ${gedreht.laengen.join(' / ')} m`);
assert(Math.abs(gedreht.menge - 2.57) < 0.005,
  `Test 5 – gedreht, echte 2,57-m-Kante: ${gedreht.menge} m (nicht 0,73)`);

// ── 6. Dieselbe Kante zweimal ─────────────────────────────────────────────
const zweimal = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  for (let i = 0; i < 2; i++) {
    const s = mkSection('E', i * 257, 0); setSectionAngle(s, 0);
    s.bays.push(mkBay(2.57)); state.sections.push(s);
  }
  renderAll(); flushRender();
  const b = allBaysFlat();
  setzeBordbrettKante(b[0].id, 1, true);       // gemeinsame Stirnkante …
  const einmal = +bordbrettGesamt().toFixed(2);
  setzeBordbrettKante(b[1].id, 3, true);       // … vom Nachbarfeld aus nochmal
  return { einmal, zweimal: +bordbrettGesamt().toFixed(2),
           eintraege: state.bordbrettKanten.length };
});
assert(Math.abs(zweimal.einmal - 0.73) < 0.005,
  `die gemeinsame Stirnkante misst ${zweimal.einmal} m`);
assert(zweimal.eintraege === 2 && Math.abs(zweimal.zweimal - 0.73) < 0.005,
  `Test 6 – zweimal markiert, einmal gezählt: ${zweimal.zweimal} m`);

// ── 7. Innenkanten zählen NICHT von selbst ────────────────────────────────
const nurMarkiert = await page.evaluate(() => {
  state.bordbrettKanten = [];
  renderAll(); flushRender();
  return +bordbrettGesamt().toFixed(2);
});
assert(nurMarkiert === 0,
  'ohne Markierung gibt es kein Bordbrett – auch nicht an Innenkanten zwischen Feldern');

// ── 8. Bedienung: Tippen setzt, nochmal Tippen entfernt ───────────────────
const bedienung = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  const s = mkSection('E', 0, 0); setSectionAngle(s, 0);
  s.bays.push(mkBay(2.57)); state.sections.push(s);
  renderAll(); flushRender();
  starteBordbrettModus();
  const el = computeLayout().find(e => e.type === 'bay');
  const [p, q] = bayKante(el, 2);              // äußere Längskante
  const mitte = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const treffer = bordbrettKanteUnter(mitte);
  drag = { type: 'bordbrett', op: 'an', geaendert: 0 };
  bordbrettStreichen(mitte);
  const gesetzt = +bordbrettGesamt().toFixed(2);
  // Nochmal darüber – jetzt in der Gegenrichtung, wie beim zweiten Tipp.
  drag = { type: 'bordbrett', op: 'ab', geaendert: 0 };
  bordbrettStreichen(mitte);
  const entfernt = +bordbrettGesamt().toFixed(2);
  drag = null;
  const bar = document.getElementById('bordbrettBar');
  const sichtbar = bar && !bar.classList.contains('hidden');
  beendeBordbrettModus();
  return { treffer: !!treffer, kante: treffer && treffer.k, gesetzt, entfernt, sichtbar,
           barZu: document.getElementById('bordbrettBar').classList.contains('hidden') };
});
assert(bedienung.treffer && bedienung.kante === 2,
  'ein Tipp auf die Kantenmitte trifft genau diese Kante');
assert(bedienung.gesetzt === 2.57 && bedienung.entfernt === 0,
  'Tippen setzt das Bordbrett, nochmal Tippen nimmt es wieder weg');
assert(bedienung.sichtbar && bedienung.barZu,
  'die Bedienleiste steht im Modus und verschwindet danach');

// ── 9. Wischen über mehrere Felder ────────────────────────────────────────
const wischen = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  for (let i = 0; i < 3; i++) {
    const s = mkSection('E', i * 257, 0); setSectionAngle(s, 0);
    s.bays.push(mkBay(2.57)); state.sections.push(s);
  }
  renderAll(); flushRender();
  starteBordbrettModus();
  const els = computeLayout().filter(e => e.type === 'bay');
  // Ein Strich entlang der äußeren Längskante über alle drei Felder – von
  // Kantenmitte zu Kantenmitte, so wie ein Finger tatsächlich streicht.
  const mitte = el => { const [p, q] = bayKante(el, 2); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
  const von = mitte(els[0]), bis = mitte(els[2]);
  drag = { type: 'bordbrett', op: 'an', geaendert: 0 };
  for (let t = 0; t <= 1.0001; t += 0.02) {
    bordbrettStreichen({ x: von.x + (bis.x - von.x) * t, y: von.y + (bis.y - von.y) * t });
  }
  drag = null;
  beendeBordbrettModus();
  return { menge: +bordbrettGesamt().toFixed(2), kanten: state.bordbrettKanten.length };
});
assert(wischen.kanten === 3 && Math.abs(wischen.menge - 7.71) < 0.005,
  `ein Strich über drei Felder markiert alle drei Kanten: ${wischen.menge} m (Soll 7,71)`);

// ── 10. Aufmaß je Achse, Gesamtsumme stimmt ───────────────────────────────
const achsen = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  const lauf = (winkel, n, x, y) => {
    for (let i = 0; i < n; i++) {
      const s = mkSection('E', x, y); setSectionAngle(s, winkel);
      const b = mkBay(2.57); b.hL = 8.2; b.hR = 8.2;
      s.bays.push(b); state.sections.push(s);
      const e = sectionEnd(s); x = e.x; y = e.y;
    }
    return { x, y };
  };
  let p = lauf(0, 3, 0, 0);
  lauf(90, 4, p.x, p.y);
  renderAll(); flushRender();
  allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true));
  renderAll(); flushRender();
  const je = bordbrettJeAchse();
  return {
    je: je.map(a => ({ name: a.name, laenge: +a.laenge.toFixed(2) })),
    gesamt: +bordbrettGesamt().toFixed(2),
    summeTeile: +je.reduce((s, a) => s + a.laenge, 0).toFixed(2),
    readout: document.getElementById('bordbrettReadout').textContent
  };
});
assert(achsen.je.length === 2, `das Bordbrett wird nach Achsen aufgeteilt (${achsen.je.length})`);
assert(Math.abs(achsen.je[0].laenge - 7.71) < 0.005 && Math.abs(achsen.je[1].laenge - 10.28) < 0.005,
  `je Achse die eigene Kantenlänge (${achsen.je.map(a => a.laenge).join(' / ')} m)`);
assert(Math.abs(achsen.gesamt - achsen.summeTeile) < 0.005 && Math.abs(achsen.gesamt - 17.99) < 0.005,
  `die Gesamtsumme ist die Summe der Achsen (${achsen.gesamt} m) – ohne Rundungsfehler`);
assert(/17,99 m/.test(achsen.readout),
  `die Werkzeugleiste zeigt die Menge mit: „${achsen.readout}"`);

// ── 11. Bordbrett im Aufmaß (PDF) ─────────────────────────────────────────
const pdf = await page.evaluate(async () => {
  state.project = 'Bordbrett-Nachweis';
  window.__pdfSaved = null;
  await buildPdf('farbe');
  const t = window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2]));
  const mengeNach = bez => t.map((x, i) => [x, t[i - 1]]).filter(([, v]) => v === bez).map(([x]) => x);
  return { alle: t.join('\n'), bordbrett: mengeNach('Bordbrett') };
});
assert(pdf.alle.includes('Bordbrett'), 'das Aufmaß im PDF führt die Position „Bordbrett"');
assert(pdf.bordbrett.includes('7,71') && pdf.bordbrett.includes('10,28') && pdf.bordbrett.includes('17,99'),
  `je Achse und in der Gesamtsumme (${pdf.bordbrett.join(' / ')} m)`);

// ── 12. Kanten gelöschter Felder verschwinden mit ihnen ───────────────────
const aufgeraeumt = await page.evaluate(() => {
  const vorher = +bordbrettGesamt().toFixed(2);
  state.sections.splice(0, 3);                 // erste Achse löschen
  normalizeState();
  renderAll(); flushRender();
  return { vorher, nachher: +bordbrettGesamt().toFixed(2),
           eintraege: state.bordbrettKanten.length };
});
assert(aufgeraeumt.eintraege === 4 && Math.abs(aufgeraeumt.nachher - 10.28) < 0.005,
  `gelöschte Felder nehmen ihre Bordbretter mit (${aufgeraeumt.vorher} → ${aufgeraeumt.nachher} m)`);

// ── 13. Speichern / Laden / Rückgängig ────────────────────────────────────
const rund = await page.evaluate(() => {
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  const vorher = +bordbrettGesamt().toFixed(2);
  state.bordbrettKanten = [];                  // „App neu geladen"
  const d = JSON.parse(json);
  state.bordbrettKanten = d.state.bordbrettKanten;
  normalizeState(); renderAll(); flushRender();
  const geladen = +bordbrettGesamt().toFixed(2);

  // Undo: eine Kante wegnehmen und zurückholen
  finalizeUndoSnapshot();
  setzeBordbrettKante(state.bordbrettKanten[0].b, state.bordbrettKanten[0].k, false);
  renderAll(); flushRender();
  finalizeUndoSnapshot();
  const nachAenderung = +bordbrettGesamt().toFixed(2);
  performUndo();
  return { vorher, geladen, nachAenderung, nachUndo: +bordbrettGesamt().toFixed(2) };
});
assert(rund.geladen === rund.vorher,
  `Bordbretter überstehen Speichern/Laden (${rund.geladen} m)`);
assert(rund.nachAenderung < rund.vorher && rund.nachUndo === rund.vorher,
  `Rückgängig holt eine entfernte Kante zurück (${rund.nachAenderung} → ${rund.nachUndo} m)`);

// ── 14. Zeichnungen der Vorgängerfassung: Linien werden übernommen ────────
// Alte Projekte speicherten eine gezeichnete LINIE entlang der Lagenkante.
// Sie muss sich beim Öffnen in markierte Kanten übersetzen, sonst stünde eine
// bestehende Zeichnung plötzlich ohne Bordbretter da.
const migriert = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; state.depth = 0.73; state.bordbrettKanten = [];
  for (let i = 0; i < 3; i++) {
    const s = mkSection('E', i * 257, 0); setSectionAngle(s, 0);
    s.bays.push(mkBay(2.57)); state.sections.push(s);
  }
  renderAll(); flushRender();
  // So sah eine Linie in der Vorgängerfassung aus: entlang der äußeren
  // Längskante über alle drei Felder. Die Lage liegt bei diesen Feldern
  // oberhalb der Wandlinie, die Außenkante also bei −Gerüsttiefe.
  const el0 = computeLayout().find(e => e.type === 'bay');
  const yAussen = el0.pts[2].y;
  state.bordbretter = [{ id: 'bb1',
    punkte: [{ x: 0, y: yAussen }, { x: 3 * 257, y: yAussen }] }];
  normalizeState();
  renderAll(); flushRender();
  return { menge: +bordbrettGesamt().toFixed(2),
           kanten: state.bordbrettKanten.length,
           altFeldWeg: state.bordbretter === undefined };
});
assert(migriert.kanten === 3 && Math.abs(migriert.menge - 7.71) < 0.005,
  `eine alte Bordbretter-Linie wird zu ${migriert.kanten} markierten Kanten (${migriert.menge} m)`);
assert(migriert.altFeldWeg,
  'das alte Feld wird dabei abgeräumt – die Umstellung läuft genau einmal');

const errs = ctx.logs.filter(l => l.startsWith('[pageerror]'));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));

console.log('\nAlle Tests zu Runde 5 bestanden.');
await ctx.close();
