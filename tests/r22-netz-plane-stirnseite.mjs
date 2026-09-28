// Runde 22 – Plane als eigene Position und Stirnseite im Eckfeld.
//
//   1. „Plane" verhält sich wie „Netz": gleiche Eingabe, gleiche Rechnung
//      (Länge × kleinere Höhe), gleiche Darstellung in Zeichnung, Feldliste
//      und PDF – aber mit eigener Bezeichnung und eigener Summenzeile.
//      Im 2D-Aufmaß UND im Aufmaß-Programm.
//   2. Stirnseite im Eckfeld (nur 2D – das Aufmaß-Programm kennt keine
//      Eckfelder): optional je Ecke und je Bekleidungsart, Gerüstbreite
//      (= eingestellte Gerüsttiefe) × Höhe des gewählten Feldes, als eigene
//      Zeile im Aufmaß. Standardmäßig AUS.
//
// Grundriss: Achse A1 läuft mit drei Feldern à 2,57 m (Höhe 10,00 m) nach
// Osten, an ihrem Ende knickt Achse A2 mit zwei Feldern (Höhe 8,00 m) nach
// Süden ab – eine Außenecke zwischen A1.3 und A2.1.
import { open, openAufmass, assert } from './harness.mjs';

const nah = (a, b) => Math.abs(a - b) < 0.005;

// ════════════════════════════════════════════════════════════════════════
//  Teil 1 · 2D-Aufmaß
// ════════════════════════════════════════════════════════════════════════
const ctx = await open({ width: 1400, height: 1000 });
const { page, logs } = ctx;
console.log('RUNDE 22 – Netz / Plane / Stirnseite im Eckfeld\n');

await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0;
  state.abschnitte = []; state.hideUnassigned = false;
  state.aufmass = null; state.ecken = {}; state.depth = 0.73;
  state.project = 'Stirnseite';
  const add = (angle, x, y, n, h) => {
    const s = mkSection('E', x, y); setSectionAngle(s, angle);
    for (let i = 0; i < n; i++) { const b = mkBay(2.57); b.hL = h; b.hR = h; s.bays.push(b); }
    state.sections.push(s); return s;
  };
  const a = add(0, 0, 0, 3, 10);
  const e = sectionEnd(a);
  add(90, e.x, e.y, 2, 8);
  renderAll(); flushRender();
});

// ── 1. Plane im Katalog – wie Netz ───────────────────────────────────────
console.log('1 · Plane verhält sich wie Netz\n');
const katalog = await page.evaluate(() => ({
  netz: POS_BY_KEY.netz, plane: POS_BY_KEY.plane,
  reihenfolge: POSITIONS.map(p => p.key)
}));
assert(katalog.plane && katalog.plane.label === 'Plane', 'es gibt die Position „Plane"');
assert(katalog.plane.unit === katalog.netz.unit && katalog.plane.huelle && katalog.netz.huelle,
  'Plane und Netz teilen Einheit (m²) und Logik (huelle)');
assert(katalog.plane.color !== katalog.netz.color,
  'Plane hat eine eigene Farbe – in Plan und PDF unterscheidbar');
assert(katalog.reihenfolge.indexOf('plane') === katalog.reihenfolge.indexOf('netz') + 1,
  'Plane steht im Katalog direkt hinter Netz');

const rechnung = await page.evaluate(() => {
  const bay = state.sections[0].bays[0];
  bay.hL = 10; bay.hR = 9;                              // kleinere Höhe zählt
  const n = mkPosition('netz'), p = mkPosition('plane');
  const r = {
    netz: effQty(n, bay), plane: effQty(p, bay),
    labelNetz: qtyLabel(n, bay), labelPlane: qtyLabel(p, bay),
    badgePlane: posBadge(p, bay)
  };
  bay.hR = 10;
  return r;
});
assert(nah(rechnung.netz, 2.57 * 9) && nah(rechnung.plane, rechnung.netz),
  `gleiche Rechnung: Länge × kleinere Höhe (${rechnung.netz} m² / ${rechnung.plane} m²)`);
assert(rechnung.labelPlane === rechnung.labelNetz, 'gleiche Mengenangabe: ' + rechnung.labelPlane);
assert(/^Plane 23,13m²$/.test(rechnung.badgePlane), 'Plan-Beschriftung wie beim Netz: ' + rechnung.badgePlane);

// Über die Oberfläche: Feld-Blatt öffnen, Plane antippen
await page.evaluate(() => openEditSheet(0, 0));
await page.waitForSelector('#bottomSheet.open');
const chips = await page.$$eval('#bottomSheet .pos-chip', els => els.map(e => e.textContent));
assert(chips.includes('Netz') && chips.includes('Plane'), 'im Feld-Blatt stehen Netz und Plane als Chips');
await page.click('#bottomSheet .pos-chip:text-is("Plane")');
const detail = await page.evaluate(() => {
  const row = [...document.querySelectorAll('#bottomSheet .pos-detail-row')]
    .find(r => r.querySelector('.pos-detail-name').textContent === 'Plane');
  return row ? {
    platzhalter: row.querySelector('.pos-detail-qty').placeholder,
    einheit: row.querySelector('.punit-btn.active').textContent
  } : null;
});
assert(detail && detail.einheit === 'm²' && detail.platzhalter === '25,7',
  `gleiche Eingabefelder: Menge mit Vorschlag ${detail && detail.platzhalter} ${detail && detail.einheit}`);
await page.evaluate(() => { closeSheet(); renderAll(); flushRender(); });

const feldliste = await page.$$eval('#sectionsContainer .bay-pos-chip', els => els.map(e => e.textContent));
assert(feldliste.some(t => /^Plane · 25,7 m²$/.test(t)), 'die Feldliste zeigt die Plane mit Menge: '
  + feldliste.join(' | '));

// Netz auf beide Eckfelder, Plane nur auf A2.1
await page.evaluate(() => {
  state.sections[0].bays[0].positions = [];
  state.sections[0].bays[2].positions.push(mkPosition('netz'));
  state.sections[1].bays[0].positions.push(mkPosition('netz'));
  state.sections[1].bays[0].positions.push(mkPosition('plane'));
  renderAll(); flushRender();
});

const agg = () => page.evaluate(() => aggregatePositions(allBaysFlat())
  .map(a => ({ label: a.label, menge: aggQtyText(a), n: a.n })));
let zeilen = await agg();
assert(zeilen.map(z => z.label).join('|') === 'Netz|Plane',
  'eigene Summenzeile: Netz und Plane werden getrennt zusammengefasst');
assert(zeilen[0].menge === '46,26 m²' && zeilen[1].menge === '20,56 m²',
  `Netz 2,57×10 + 2,57×8 = ${zeilen[0].menge}, Plane 2,57×8 = ${zeilen[1].menge}`);

// ── 2. Stirnseite: Standard AUS ──────────────────────────────────────────
console.log('\n2 · Stirnseite im Eckfeld\n');
const ecke = await page.evaluate(() => {
  const e = eckenListe()[0];
  return { anzahl: eckenListe().length, art: e.art, key: e.key,
           felder: eckFelder(e).map(f => bayName(f.bay)), ecken: JSON.stringify(state.ecken) };
});
assert(ecke.anzahl === 1 && ecke.art === 'aussen', 'eine Außenecke erkannt');
assert(ecke.felder.join('/') === 'A1.3/A2.1', 'Eckfelder: ' + ecke.felder.join(' / '));
assert(ecke.ecken === '{}' && !zeilen.some(z => /Stirnseite/.test(z.label)),
  'Standard ist AUS: keine Stirnseite, keine gespeicherte Einstellung');

const laengenVorher = await page.evaluate(() => pdfAchsBloecke().map(b => b.laenge));

// Eck-Menü: Abschnitt „Gerüstbreite / Stirnseite mit abrechnen"
await page.evaluate(k => openEckSheet(k), ecke.key);
await page.waitForSelector('#bottomSheet.open');
const eckMenue = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('#bottomSheet .sheet-section-label')].map(e => e.textContent);
  const reihen = [...document.querySelectorAll('#bottomSheet .eck-stirn-liste .eck-choice-row')]
    .map(r => ({ cat: r.dataset.cat, knoepfe: [...r.querySelectorAll('.eck-choice')].map(b => ({
      titel: b.querySelector('strong').textContent, sub: b.querySelector('.eck-choice-sub').textContent,
      aktiv: b.classList.contains('active') })) }));
  return { labels, reihen };
});
assert(eckMenue.labels.includes('Gerüstbreite / Stirnseite mit abrechnen'),
  'das Eck-Menü bietet „Gerüstbreite / Stirnseite mit abrechnen" an');
assert(eckMenue.reihen.map(r => r.cat).join(',') === 'netz,plane',
  'je Bekleidungsart eine eigene Wahl (Netz, Plane)');
const netzWahl = eckMenue.reihen[0].knoepfe;
assert(netzWahl.map(k => k.titel).join('|') === 'Aus|an Feld A1.3|an Feld A2.1' && netzWahl[0].aktiv,
  'Wahl: Aus (aktiv) · an Feld A1.3 · an Feld A2.1');
assert(/0,73 × 10,00 m = 7,3 m²/.test(netzWahl[1].sub) && /0,73 × 8,00 m = 5,84 m²/.test(netzWahl[2].sub),
  `jede Wahl zeigt ihren Rechenweg (${netzWahl[1].sub} · ${netzWahl[2].sub})`);

// An Feld A2.1 ansetzen
await page.click('#bottomSheet .eck-choice-row[data-cat="netz"] .eck-choice:nth-child(3)');
zeilen = await agg();
const stirn = zeilen.find(z => /Stirnseite/.test(z.label));
assert(stirn && stirn.label === 'Netz · Stirnseite A2.1' && stirn.n === 1,
  'eigene Zeile „Netz · Stirnseite A2.1"');
assert(stirn.menge === '0,73 × 8,00 m = 5,84 m²', 'Rechenweg Gerüstbreite × Feldhöhe: ' + stirn.menge);
assert(zeilen.find(z => z.label === 'Netz').menge === '46,26 m²',
  'die Netz-Zeile selbst bleibt unverändert – die Stirnseite kommt dazu');
assert(!zeilen.some(z => /Plane · Stirnseite/.test(z.label)), 'die Plane ist davon unberührt');
const gespeichert = await page.evaluate(k => JSON.stringify(state.ecken[k]), ecke.key);
assert(gespeichert === '{"stirnseite":{"netz":"2"}}', 'gespeichert an der Ecke: ' + gespeichert);

// Achse: eigene Zeile im Block der Achse A2, Längen unverändert
const bloecke = await page.evaluate(() => pdfAchsBloecke().map(b => ({
  titel: b.titel, laenge: b.laenge, pos: b.positionen.map(p => p.label + ' = ' + p.menge) })));
assert(bloecke[1].pos.includes('Netz · Stirnseite A2.1 = 0,73 × 8,00 m = 5,84 m²')
  && !bloecke[0].pos.some(p => /Stirnseite/.test(p)),
  'die Stirnseite steht bei der Achse ihres Feldes (' + bloecke[1].titel + ') und nur dort');
assert(JSON.stringify(bloecke.map(b => b.laenge)) === JSON.stringify(laengenVorher),
  `die Achslängen bleiben unverändert (${laengenVorher.join(' / ')} m) – nichts geht in der Länge unter`);

// Andere Wahl: an Feld A1.3 (Höhe 10,00 m) – feldweise Höhe
await page.click('#bottomSheet .eck-choice-row[data-cat="netz"] .eck-choice:nth-child(2)');
zeilen = await agg();
const stirnA = zeilen.find(z => /Stirnseite/.test(z.label));
assert(stirnA.label === 'Netz · Stirnseite A1.3' && stirnA.menge === '0,73 × 10,00 m = 7,3 m²',
  'der Nutzer wählt das Feld – jetzt mit der Höhe von A1.3: ' + stirnA.menge);
assert(zeilen.filter(z => /Stirnseite/.test(z.label)).length === 1,
  'die Stirnseite sitzt immer nur an EINEM der beiden Felder');

// Plane separat an A2.1
await page.click('#bottomSheet .eck-choice-row[data-cat="plane"] .eck-choice:nth-child(3)');
zeilen = await agg();
assert(zeilen.map(z => z.label).join('|') ===
  'Netz|Netz · Stirnseite A1.3|Plane|Plane · Stirnseite A2.1',
  'Plane hat ihre eigene Stirnseiten-Zeile: ' + zeilen.map(z => z.label).join(' | '));
await page.click('#bottomSheet .sheet-ok');

// Gerüstbreite ist dynamisch: 1,09 m
await page.evaluate(() => { state.depth = 1.09; invalidateEckenCache(); renderAll(); flushRender(); });
zeilen = await agg();
assert(zeilen.find(z => z.label === 'Netz · Stirnseite A1.3').menge === '1,09 × 10,00 m = 10,9 m²',
  'bei 1,09 m Gerüsttiefe rechnet die Stirnseite mit 1,09 m – keine Konstante');
await page.evaluate(() => { state.depth = 0.73; invalidateEckenCache(); renderAll(); flushRender(); });

// Unterschiedliche Höhen im Feld: es zählt die Höhe DIESES Feldes (kleinere)
await page.evaluate(() => { const b = state.sections[0].bays[2]; b.hL = 10; b.hR = 9.5; renderAll(); flushRender(); });
zeilen = await agg();
assert(zeilen.find(z => z.label === 'Netz · Stirnseite A1.3').menge === '0,73 × 9,50 m = 6,94 m²',
  'feldweise Höhe: Feld mit 10,00 / 9,50 m rechnet mit 9,50 m');
await page.evaluate(() => { const b = state.sections[0].bays[2]; b.hR = 10; renderAll(); flushRender(); });

// Feldliste zeigt die Stirnseite am gewählten Feld
const listenChips = await page.$$eval('#sectionsContainer .bay-pos-stirn', els => els.map(e => e.textContent));
assert(listenChips.includes('Netz · Stirnseite 0,73 × 10,00 m = 7,3 m²')
  && listenChips.includes('Plane · Stirnseite 0,73 × 8,00 m = 5,84 m²'),
  'die Feldliste weist die Stirnseiten als eigene Chips aus');

// Feld-Blatt von A2.1: Schalter unter Netz und Plane
await page.evaluate(() => openEditSheet(1, 0));
await page.waitForSelector('#bottomSheet.open');
const schalter = () => page.evaluate(() =>
  [...document.querySelectorAll('#bottomSheet .pos-stirn-row')].map(r => ({
    cat: r.dataset.cat, an: r.querySelector('input').checked, text: r.textContent })));
let sw = await schalter();
assert(sw.length === 2 && sw[0].cat === 'netz' && !sw[0].an && /derzeit an Feld A1\.3/.test(sw[0].text),
  'Feld-Blatt: Netz-Schalter aus, mit Hinweis „derzeit an Feld A1.3"');
assert(sw[1].cat === 'plane' && sw[1].an, 'Feld-Blatt: Plane-Schalter an');
await page.click('#bottomSheet .pos-stirn-row[data-cat="netz"] input');
sw = await schalter();
zeilen = await agg();
assert(sw[0].an && zeilen.some(z => z.label === 'Netz · Stirnseite A2.1')
  && !zeilen.some(z => z.label === 'Netz · Stirnseite A1.3'),
  'Schalter im Feld-Blatt verlegt die Stirnseite an dieses Feld');
await page.click('#bottomSheet .pos-stirn-row[data-cat="plane"] input');
zeilen = await agg();
assert(!zeilen.some(z => /Plane · Stirnseite/.test(z.label)), 'Schalter aus → Plane-Stirnseite entfällt');
await page.evaluate(() => { closeSheet(); renderAll(); flushRender(); });

// Ohne Bekleidung an der Ecke keine Stirnseite
await page.evaluate(() => {
  state.sections[0].bays[2].positions = state.sections[0].bays[2].positions.filter(p => p.cat !== 'netz');
  state.sections[1].bays[0].positions = state.sections[1].bays[0].positions.filter(p => p.cat !== 'netz');
  renderAll(); flushRender();
});
zeilen = await agg();
assert(!zeilen.some(z => /Netz/.test(z.label)), 'Netz an beiden Eckfeldern entfernt → auch die Stirnseite entfällt');
await page.evaluate(() => {
  state.sections[0].bays[2].positions.push(mkPosition('netz'));
  renderAll(); flushRender();
});
zeilen = await agg();
assert(zeilen.some(z => z.label === 'Netz · Stirnseite A2.1'),
  'kommt die Bekleidung zurück, greift die Einstellung wieder');

// Speichern + Laden: die Einstellung gehört zur Zeichnung
const rund = await page.evaluate(() => {
  const daten = JSON.parse(JSON.stringify(aktuelleZeichnungsDaten()));
  state.ecken = {}; invalidateEckenCache();
  const ohne = aggregatePositions(allBaysFlat()).some(a => a.stirnseite);
  state.ecken = daten.ecken; invalidateEckenCache();
  return { ohne, mit: aggregatePositions(allBaysFlat()).filter(a => a.stirnseite).map(a => a.label) };
});
assert(!rund.ohne && rund.mit.join() === 'Netz · Stirnseite A2.1',
  'die Einstellung steht in den Zeichnungsdaten (ecken) und kommt mit ihnen zurück');

// Rückgängig: die Wahl ist ein normaler Undo-Schritt
const undo = await page.evaluate(async () => {
  finalizeUndoSnapshot();
  const key = eckenListe()[0].key;
  setEckStirnseite(key, 'netz', null); renderAll(); flushRender();
  finalizeUndoSnapshot();
  const aus = aggregatePositions(allBaysFlat()).some(a => a.stirnseite);
  performUndo(); flushRender();
  return { aus, wieder: aggregatePositions(allBaysFlat()).some(a => a.stirnseite) };
});
assert(!undo.aus && undo.wieder, 'Abschalten lässt sich rückgängig machen');

// PDF: Plane und Stirnseite als eigene Zeilen
await page.evaluate(() => {
  setEckStirnseite(eckenListe()[0].key, 'plane', state.sections[0].id);
  state.sections[0].bays[2].positions.push(mkPosition('plane'));
  renderAll(); flushRender();
});
const pdf = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return (window.__pdfSaved?.calls || []).filter(c => c[0] === 'text').map(c => c[2]);
});
assert(pdf.filter(t => t === 'Plane').length >= 2, 'PDF: Plane als eigene Zeile in Achsblock und Gesamt');
assert(pdf.includes('Netz · Stirnseite A2.1') && pdf.includes('0,73 × 8,00 m = 5,84 m²'),
  'PDF: „Netz · Stirnseite A2.1" mit Rechenweg in der Mengenspalte');
assert(pdf.includes('Plane · Stirnseite A1.3') && pdf.includes('0,73 × 10,00 m = 7,3 m²'),
  'PDF: „Plane · Stirnseite A1.3" mit Rechenweg');
assert(pdf.filter(t => t === 'Netz · Stirnseite A2.1').length === 2,
  'PDF: die Stirnseite steht bei ihrer Achse und in „Gesamt · alle Seiten"');

const fehler2d = logs.filter(l => l.startsWith('[pageerror]'));
assert(fehler2d.length === 0, 'keine JS-Fehler im 2D-Aufmaß ' + fehler2d.join(' '));
await ctx.close();

// ════════════════════════════════════════════════════════════════════════
//  Teil 2 · Aufmaß-Programm
// ════════════════════════════════════════════════════════════════════════
console.log('\n3 · Planen im Aufmaß-Programm\n');
const am = await openAufmass();
const ap = am.page;
await ap.click('#newProjectBtn');
await ap.waitForSelector('#projectScreen:not(.hidden)');
await ap.click('#addSideBtn');
await ap.waitForSelector('.seite-card .messung-row');
await ap.fill('.seite-card .messung-row:first-child .messung-hoehe', '10');
await ap.fill('.seite-card .messung-row:first-child .messung-laenge', '12');

const tasten = await ap.$$eval('.seite-card .accessory-toggle', els => els.map(e => e.textContent));
const iNe = tasten.indexOf('Netze (NE)'), iPl = tasten.indexOf('Planen (PL)');
assert(iNe >= 0 && iPl === iNe + 1, 'die Taste „Planen (PL)" steht direkt neben „Netze (NE)"');

await ap.click('.seite-card .accessory-toggle[data-acc="pl"]');
const plWert = await ap.inputValue('.seite-card .accessory-length-input[data-acc="pl"]');
const plAuto = await ap.textContent('.seite-card .accessory-l1-btn[data-acc="pl"]');
assert(plAuto === '= Fläche' && plWert === '120', `wie bei Netzen: Vorschlag „= Fläche" (${plWert} m²)`);
await ap.click('.seite-card .accessory-toggle[data-acc="ne"]');
await ap.click('.seite-card .accessory-l1-btn[data-acc="ne"]');         // manuell
await ap.fill('.seite-card .accessory-length-input[data-acc="ne"]', '80');

const seite = await ap.evaluate(() => collectSeiten()[0]);
assert(seite.planen && seite.planen.laenge === 120 && seite.planen.autoL1 === true,
  'gespeichert als eigene Position „planen" (120 m², automatisch)');
assert(seite.netze && seite.netze.laenge === 80, 'Netze bleiben eine eigene Position (80 m²)');

await ap.evaluate(() => updateSummary());
const zus = await ap.textContent('#summaryContent');
assert(/NE: 80,00 m²/.test(zus) && /PL: 120,00 m²/.test(zus), 'Zusammenfassung: NE und PL getrennt');

const amPdf = await ap.evaluate(() => {
  window.__pdfSaved = null;
  document.getElementById('exportPdfBtn').click();
  return (window.__pdfSaved?.calls || []).filter(c => c[0] === 'text').map(c => c[2]);
});
const iNetze = amPdf.indexOf('Netze'), iPlanen = amPdf.indexOf('Planen');
assert(iNetze >= 0 && amPdf[iNetze + 1] === '80,00 m²', 'PDF: Summenzeile „Netze 80,00 m²"');
assert(iPlanen >= 0 && amPdf[iPlanen + 1] === '120,00 m²', 'PDF: eigene Summenzeile „Planen 120,00 m²"');

const fehlerAm = am.logs.filter(l => l.startsWith('[pageerror]'));
assert(fehlerAm.length === 0, 'keine JS-Fehler im Aufmaß-Programm ' + fehlerAm.join(' '));
await am.close();

console.log('\nAlle Tests zu Runde 22 bestanden.');
