// Runde 21 – Ruhige Zeichenfläche und richtiger Zurück-Pfeil.
//
//   node tests/r21-zeichnung-navigation.mjs
//
// Zwei Änderungen an der 2D-App:
//
//   1. Unter den Feldern steht kein Achsentext mehr. Die Zuordnung zeigt die
//      FARBE; der Achsname erscheint nur noch dort, wo er eine Frage
//      beantwortet – an der Auswahl.
//   2. Der Zurück-Pfeil führt in die Zeichnungsübersicht DIESER App – und
//      niemals in die andere Anwendung. (Seit der Trennung der Anwendungen
//      gibt es innerhalb der 2D-App genau zwei Bildschirme: Übersicht und
//      Zeichnung.)
//
// Dazu der Nachweis, dass nichts verloren gegangen ist: Feldbezeichnungen
// gibt es weiterhin in Feldübersicht, Auswahl-Anzeige und Feld-Blatt, und die
// Achsenverwaltung arbeitet unverändert.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1280, height: 900 });
const { page } = ctx;
console.log('RUNDE 21 – Zeichenfläche und Navigation\n');

/* ══ Aufbau: zwei Achsen mit je drei Feldern ═══════════════════════════════ */
await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0;
  state.abschnitte = []; state.aufmass = null;
  state.project = 'Ruhetest';
  const nord = addAbschnitt('Nordseite');
  const ost  = addAbschnitt('Ostseite');
  [nord, ost].forEach((achse, n) => {
    for (let i = 0; i < 3; i++) {
      const s = mkSection('E', i * 257, n * 400);
      setSectionAngle(s, 0);
      const b = mkBay(2.57);
      b.hL = 8; b.hR = 8;
      b.abschnittId = achse.id;
      s.bays.push(b);
      state.sections.push(s);
    }
  });
  bulkMode = false; bulkSelected.clear(); selectedSi = null; selectedBi = null;
  renderAll(); flushRender();
});

/* ══ 1. Keine Feldbezeichnung, kein Achsentext in der Zeichnung ════════════ */
console.log('  Ruhige Zeichnung');

const ohneAuswahl = await page.evaluate(() => {
  const svg = document.getElementById('planSvg');
  const texte = [...svg.querySelectorAll('text')].map(t => t.textContent.trim());
  return {
    texte,
    achsLabels: svg.querySelectorAll('.achs-label').length,
    namen: texte.filter(t => /^[A-Z]\d+(\.\d+)?$/.test(t)),
    laengen: texte.filter(t => /^\d+\.\d{2}$/.test(t)).length,
    hoehen: texte.filter(t => /^↥/.test(t)).length
  };
});
assert(ohneAuswahl.namen.length === 0,
  `keine Feldbezeichnung in der Zeichenfläche (${ohneAuswahl.namen.join(', ') || 'keine'})`);
assert(ohneAuswahl.achsLabels === 0,
  'ohne Auswahl steht auch kein Achsname in der Zeichnung');
assert(ohneAuswahl.laengen === 6 && ohneAuswahl.hoehen === 12,
  `Maße und Höhen stehen unverändert im Plan (${ohneAuswahl.laengen} Längen, ${ohneAuswahl.hoehen} Höhen)`);

/* ══ 2. Die Achse bleibt über die FARBE erkennbar ══════════════════════════ */
const farben = await page.evaluate(() => {
  const svg = document.getElementById('planSvg');
  const polys = [...svg.querySelectorAll('polygon')]
    .map(p => p.getAttribute('fill'))
    .filter(f => f && f !== 'none');
  const achsen = abschnitteList();
  return {
    fuellungen: [...new Set(polys)],
    erwartet: achsen.map(a => tintHex(a.color, 0.86)),
    achsFarben: achsen.map(a => a.color)
  };
});
assert(farben.achsFarben[0] !== farben.achsFarben[1],
  `die beiden Achsen haben verschiedene Farben (${farben.achsFarben.join(' / ')})`);
farben.erwartet.forEach((f, i) => assert(farben.fuellungen.includes(f),
  `die Felder der Achse ${i + 1} tragen ihre Achsfarbe (${f})`));

/* ══ 3. Bei Auswahl erscheint der Achsname – nur der der Auswahl ═══════════ */
console.log('\n  Achsname auf Nachfrage');

const beiAuswahl = await page.evaluate(() => {
  starteMehrfachMitFeld(allBaysFlat()[0]);
  renderAll(); flushRender();
  const labels = [...document.querySelectorAll('#planSvg .achs-label')];
  return {
    anzahl: labels.length,
    namen: labels.map(l => l.querySelector('text')?.textContent),
    info: document.getElementById('selectionInfo')?.textContent || ''
  };
});
assert(beiAuswahl.anzahl === 1 && beiAuswahl.namen[0] === 'Nordseite',
  `die Achse der Auswahl wird benannt (${beiAuswahl.namen.join(', ') || 'keine'})`);
assert(!beiAuswahl.namen.includes('Ostseite'),
  'die übrigen Achsen bleiben stumm');
assert(/Nordseite/.test(beiAuswahl.info),
  'die Auswahl-Anzeige nennt die Achse weiterhin');

const nachAbwahl = await page.evaluate(() => {
  bulkMode = false; bulkSelected.clear(); selectedSi = null; selectedBi = null;
  renderAll(); flushRender();
  return document.querySelectorAll('#planSvg .achs-label').length;
});
assert(nachAbwahl === 0, 'ohne Auswahl wird die Zeichnung wieder ruhig');

/* ══ 4. Die Bezeichnungen gibt es weiterhin – nur woanders ═════════════════ */
console.log('\n  Bezeichnungen in Menüs und Blättern');

const woanders = await page.evaluate(() => {
  const bay = allBaysFlat()[0];
  selectedSi = 0; selectedBi = 0; bulkMode = false; bulkSelected.clear();
  renderAll(); flushRender();
  const uebersicht = [...document.querySelectorAll('#sidePanel .bay-num')].map(e => e.textContent);
  const info = document.getElementById('selectionInfo')?.textContent || '';
  return { uebersicht, info, name: bayName(bay) };
});
assert(woanders.name === 'A1', `jedes Feld hat weiterhin seinen Namen (${woanders.name})`);
assert(woanders.uebersicht.includes('A1'),
  `die Feldübersicht listet die Bezeichnungen (${woanders.uebersicht.slice(0, 3).join(', ')})`);
assert(/Feld A1/.test(woanders.info), 'die Auswahl-Anzeige nennt das Feld beim Namen');

const sheet = await page.evaluate(() => {
  openEditSheet(0, 0);
  const kopf = document.querySelector('#bottomSheet .sheet-header');
  const text = document.getElementById('bottomSheet')?.textContent || '';
  closeSheet();
  return { kopf: kopf?.textContent || '', text };
});
assert(/A1/.test(sheet.kopf) || /Feld A1/.test(sheet.text),
  `das Feld-Blatt trägt die Bezeichnung („${(sheet.kopf || sheet.text).slice(0, 24)}…")`);

/* ══ 5. Achsenverwaltung unverändert ═══════════════════════════════════════ */
console.log('\n  Achsenverwaltung');

const verwaltung = await page.evaluate(() => {
  const achse = abschnitteList()[0];
  const vorher = allBaysFlat().filter(b => b.abschnittId === achse.id).length;
  achse.name = 'Straßenseite';
  renderAll(); flushRender();
  const nachher = allBaysFlat().filter(b => b.abschnittId === achse.id).length;
  starteMehrfachMitFeld(allBaysFlat()[0]);
  renderAll(); flushRender();
  const label = document.querySelector('#planSvg .achs-label text')?.textContent;
  bulkMode = false; bulkSelected.clear();
  renderAll(); flushRender();
  return { vorher, nachher, label, anzeige: achsAnzeigeName(achse.id) };
});
assert(verwaltung.vorher === verwaltung.nachher && verwaltung.nachher === 3,
  'Umbenennen ändert keine Zuordnung');
assert(verwaltung.label === 'Straßenseite' && verwaltung.anzeige === 'Straßenseite',
  `der neue Name erscheint überall, wo ein Name steht (${verwaltung.label})`);

/* ══ 6. Der Zurück-Pfeil ═══════════════════════════════════════════════════ */
console.log('\n  Zurück-Pfeil');

const zurueck = async () => page.evaluate(() => {
  const a = document.querySelector('#td-zeichnung .back-link');
  return { href: a?.getAttribute('href'), titel: a?.getAttribute('title') };
});

// a) Direkt geöffnet (Deep-Link, Neuladen): in die Zeichnungsübersicht.
const direkt = await zurueck();
assert(direkt.href === '#/projekte',
  `ohne bekannte Herkunft führt der Pfeil in die Zeichnungsübersicht (${direkt.href})`);
assert(/Zeichnungsübersicht/.test(direkt.titel || ''), `und sagt das auch (${direkt.titel})`);

// b) Aus der Zeichnungsübersicht heraus geöffnet – der häufigste Weg.
await page.evaluate(() => Navigation2d.zurUebersicht());
await page.waitForTimeout(150);
await page.evaluate(() => Navigation2d.zurZeichnung());
await page.waitForTimeout(250);
const ausListe = await zurueck();
assert(ausListe.href === '#/projekte',
  `aus der Zeichnungsübersicht führt er dorthin zurück (${ausListe.href})`);

// c) Eine Zeichnung mit Datensatz ändert daran nichts – früher schickte
//    genau das den Pfeil ins andere Modul.
const mitProjekt = await page.evaluate(() => {
  linkedProjectId = 'irgendeine-zeichnung';
  syncBackLink();
  const a = document.querySelector('#td-zeichnung .back-link');
  linkedProjectId = null;
  return a?.getAttribute('href');
});
assert(mitProjekt === '#/projekte',
  `auch eine gespeicherte Zeichnung führt zurück in die Übersicht, nicht ins Aufmaß (${mitProjekt})`);

// d) Der Pfeil wirkt wirklich.
await page.click('#td-zeichnung .back-link');
await page.waitForFunction(() => location.hash === '#/projekte'
  && !document.getElementById('td-projekte').classList.contains('hidden'));
assert(true, 'ein Tipp auf den Pfeil zeigt die Zeichnungsübersicht');
await page.evaluate(() => Navigation2d.zurZeichnung());
await page.waitForTimeout(250);

// e) Eine unbekannte Adresse zeigt die Übersicht – nie eine leere Seite.
await page.evaluate(() => { window.location.hash = '#/gibtesnicht'; });
await page.waitForFunction(() => !document.getElementById('td-projekte').classList.contains('hidden')
  || !document.getElementById('td-zeichnung').classList.contains('hidden'));
assert(await page.evaluate(() => Navigation2d.istUebersicht()),
  'eine unbekannte Adresse gilt als Zeichnungsübersicht');

// f) Das Ziel ist immer ein Bildschirm DIESER App – nie ein Link in die
//    Aufmaß-App.
const zieleGesehen = [direkt, ausListe].map(z => z.href).concat(mitProjekt);
assert(zieleGesehen.every(z => z === '#/projekte'),
  `jedes Rücksprungziel bleibt in der 2D-Aufmaß-App (${[...new Set(zieleGesehen)].join(', ')})`);

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 21 bestanden.');
await ctx.close();
