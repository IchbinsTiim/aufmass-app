// Runde 10 – Werkzeug-Menü, Mehrfachauswahl, Achsen, Positionen, Handy-Modus.
//
// Prüft die Abnahmeliste der Überarbeitung Schritt für Schritt über die
// OBERFLÄCHE (nicht über interne Funktionen), dazu das Verhalten auf den fünf
// Bildschirmen, die auf der Baustelle vorkommen.
import { open, seedFields, assert } from './harness.mjs';

const ctx = await open({ width: 1180, height: 820 });   // iPad quer
const { page } = ctx;

console.log('\nAUFGABE 10 – Werkzeug-Menü\n');

// ── 1. Der Pfeil-Knopf ist da und klappt auf/zu ───────────────────────────
assert(await page.$('#werkzeugBtn') !== null, 'Werkzeug-Knopf steht in der Hauptleiste');
assert(await page.evaluate(() => !document.getElementById('werkzeugPanel').classList.contains('offen')),
  'das Menü startet zugeklappt und nimmt keine Zeichenfläche weg');

const zuBreite = await page.evaluate(() => document.getElementById('viewerPanel').getBoundingClientRect().width);
await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
assert(await page.evaluate(() => document.getElementById('werkzeugBtn').getAttribute('aria-expanded') === 'true'),
  'ein Tipp öffnet das Menü');
await page.click('#werkzeugBtn');
await page.waitForTimeout(150);
assert(await page.evaluate(() => !werkzeugOffen), 'derselbe Knopf schließt es wieder');
const zuBreite2 = await page.evaluate(() => document.getElementById('viewerPanel').getBoundingClientRect().width);
assert(Math.abs(zuBreite - zuBreite2) < 2,
  `zugeklappt ist die Zeichenfläche wieder so breit wie vorher (${Math.round(zuBreite2)} px)`);

await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');

// ── 2. Die geforderten Menüpunkte sind vorhanden ──────────────────────────
const gruppen = await page.evaluate(() =>
  [...document.querySelectorAll('#werkzeugPanel .wz-kopf-txt')].map(e => e.textContent));
['AUSWAHL', 'BEARBEITEN', 'ACHSEN / ABSCHNITTE', 'ANSICHT'].forEach(g => {
  assert(gruppen.some(x => x.toUpperCase().includes(g)), `Menügruppe „${g}" vorhanden`);
});

// ── 3. Felder anlegen und einzeln auswählen ───────────────────────────────
await seedFields(page, 6);
await page.waitForTimeout(150);

const feldMitte = idx => page.evaluate(i => {
  const el = computeLayout().filter(e => e.type === 'bay')[i];
  const vp = viewportRect();
  return { x: vp.left + vp.w / 2 + (el.cx - camera.cx) * camera.scale,
           y: vp.top  + vp.h / 2 + (el.cy - camera.cy) * camera.scale };
}, idx);

const p0 = await feldMitte(0);
await page.mouse.click(p0.x, p0.y);
await page.waitForSelector('#bottomSheet', { timeout: 3000 });
assert(await page.evaluate(() => selectedSi === 0 && selectedBi === 0), 'einzelnes Feld auswählen');
assert(await page.evaluate(() => document.getElementById('bulkBar').textContent.includes('wirkt auf Feld')),
  'das Menü nennt das einzeln ausgewählte Feld als Ziel');
await page.evaluate(() => closeSheet());
await page.waitForTimeout(300);

// ── 4. Mehrfachauswahl aktivieren und fünf Felder markieren ───────────────
await page.click('.bulk-toggle-btn');
await page.waitForTimeout(150);
assert(await page.evaluate(() => bulkMode), 'Mehrfachauswahl über das Menü aktiviert');

for (const i of [0, 1, 2, 3, 4]) {
  const p = await feldMitte(i);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
}
assert(await page.evaluate(() => bulkSelected.size === 5), 'fünf Felder im Plan angetippt und markiert');
assert(await page.evaluate(() =>
  document.getElementById('werkzeugBadge').textContent === '5'), 'der Knopf zeigt die Anzahl (5)');

// Markierung ist auf der Zeichnung deutlich: eigener Ring UND Haken je Feld.
const marken = await page.evaluate(() => {
  const g = document.getElementById('planGroup');
  const haken = [...g.querySelectorAll('text')].filter(t => t.textContent === '✓').length;
  const ringe = [...g.querySelectorAll('polygon')]
    .filter(p => p.getAttribute('fill') === 'none' && parseFloat(p.getAttribute('stroke-width')) > 0).length;
  return { haken, ringe };
});
assert(marken.haken === 5, `jedes markierte Feld trägt einen Haken (${marken.haken})`);
assert(marken.ringe >= 10, `jedes markierte Feld trägt einen doppelten Ring (${marken.ringe} Ringe)`);

// ── 5. Gemeinsame Höhe setzen ─────────────────────────────────────────────
await page.fill('#werkzeugPanel .bay-height-row .bay-height-field:nth-child(1) .bay-height-inp', '9.40');
await page.click('#werkzeugPanel .bay-height-eq');
await page.click('#werkzeugPanel .bulk-height-apply-btn');
await page.waitForTimeout(200);
const hoehen = await page.evaluate(() => allBaysFlat().map(b => [b.hL, b.hR]));
assert(hoehen.slice(0, 5).every(([l, r]) => l === 9.4 && r === 9.4),
  'Höhe 9,40 m auf alle fünf ausgewählten Felder übernommen');
assert(hoehen[5][0] == null && hoehen[5][1] == null,
  'das nicht ausgewählte Feld bleibt unangetastet');

// ── 6. Gemeinsame Achse zuweisen ──────────────────────────────────────────
page.on('dialog', d => d.accept('Achse B'));
await page.click('#abschnittBar .absch-new-chip');
await page.waitForTimeout(250);
const achse = await page.evaluate(() => {
  const a = abschnitteList()[0];
  return { name: a && a.name, zugeordnet: allBaysFlat().filter(b => b.abschnittId === (a && a.id)).length };
});
assert(achse.name === 'Achse B' && achse.zugeordnet === 5,
  `fünf Felder der Achse „${achse.name}" zugewiesen`);

// Die aktive Achse ist in der Liste ausgewiesen – nicht nur farblich.
assert(await page.evaluate(() =>
  document.querySelectorAll('#abschnittBar .absch-row.absch-aktiv .absch-aktiv-mark').length === 1),
  'die aktive Achse ist in der Liste als „aktiv" gekennzeichnet');

// Zuordnung ist am Feld selbst ablesbar (Anzeige oben links).
const info = await page.textContent('#selectionInfo');
assert(/5 Felder ausgewählt/.test(info) && /Achse B/.test(info),
  'Anzeige oben links nennt Anzahl und Achse: ' + info.replace(/\s+/g, ' '));

// ── 7. Gemeinsame Position zuweisen ───────────────────────────────────────
await page.evaluate(() => [...document.querySelectorAll('#bulkBar .bulk-pos-chip')]
  .find(c => c.textContent === 'Innengeländer').click());
await page.waitForSelector('#bottomSheet', { timeout: 3000 });
await page.evaluate(() => document.querySelector('#bottomSheet .sheet-ok').click());
await page.waitForTimeout(300);
const mitPos = await page.evaluate(() =>
  allBaysFlat().filter(b => (b.positions || []).some(p => p.cat === 'innengelaender')).length);
assert(mitPos === 5, `Position „Innengeländer" auf fünf Felder gesetzt (${mitPos})`);

// Auswahl über eine Position: alle Felder mit dieser Position markieren.
await page.evaluate(() => { bulkSelected.clear(); renderAll(); flushRender(); });
await page.evaluate(() => [...document.querySelectorAll('#wzAuswahl .wz-achs-chip')]
  .find(c => c.textContent.startsWith('Innengeländer')).click());
await page.waitForTimeout(200);
assert(await page.evaluate(() => bulkSelected.size === 5),
  'alle Felder einer Position lassen sich in einem Zug auswählen');

// Auswahl über eine Achse.
await page.evaluate(() => { bulkSelected.clear(); renderAll(); flushRender(); });
await page.evaluate(() => [...document.querySelectorAll('#wzAuswahl .wz-achs-chip')]
  .find(c => c.textContent.startsWith('Achse B')).click());
await page.waitForTimeout(200);
assert(await page.evaluate(() => bulkSelected.size === 5),
  'alle Felder einer Achse lassen sich in einem Zug auswählen');

// ── 8. Zustand überlebt das Zuklappen des Menüs ───────────────────────────
await page.click('#werkzeugBtn');
await page.waitForTimeout(150);
assert(await page.evaluate(() => !werkzeugOffen && bulkMode && bulkSelected.size === 5),
  'zugeklapptes Menü ändert nichts an Modus und Auswahl');
await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
assert(await page.evaluate(() =>
  document.getElementById('wzAuswahl').textContent.includes('5')),
  'nach dem Aufklappen steht dieselbe Auswahl wieder da');

// ── 9. Auswahl aufheben, Mehrfachauswahl beenden ──────────────────────────
await page.evaluate(() => [...document.querySelectorAll('#wzAuswahl .wz-aktion')]
  .find(b => b.textContent.includes('Auswahl aufheben')).click());
await page.waitForTimeout(150);
assert(await page.evaluate(() => bulkMode && bulkSelected.size === 0),
  '„Auswahl aufheben" leert die Auswahl, ohne den Modus zu verlassen');
await page.evaluate(() => [...document.querySelectorAll('#wzAuswahl .wz-aktion')]
  .find(b => b.textContent.includes('Alle Felder auswählen')).click());
await page.waitForTimeout(150);
assert(await page.evaluate(() => bulkSelected.size === 6), '„Alle Felder auswählen" markiert alle sechs');
await page.click('.bulk-toggle-btn');
await page.waitForTimeout(150);
assert(await page.evaluate(() => !bulkMode && bulkSelected.size === 0), 'Mehrfachauswahl beendet');

// ── 10. Speichern / Laden erhält Achsen, Positionen und Höhen ─────────────
// Der echte Weg: Zeichnung ins Projekt schreiben, Editor leeren, neu laden.
const vorher = await page.evaluate(() => {
  const proj = { id: 'p-probe', name: 'Probe', geaendert: '2026-01-01' };
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([proj]));
  localStorage.setItem('geruest.app.aktuellesProjekt', 'p-probe');
  linkedProjectId = 'p-probe';
  writeToLinkedProject();
  return JSON.stringify({ a: state.abschnitte, b: allBaysFlat(), t: state.depth });
});
await page.evaluate(() => {
  resetState2d();
  renderAllNow();
  loadFromLinkedProject();
  renderAllNow();
});
const nachher = await page.evaluate(() =>
  JSON.stringify({ a: state.abschnitte, b: allBaysFlat(), t: state.depth }));
assert(await page.evaluate(() => allBaysFlat().length === 6), 'die gespeicherte Zeichnung ist wieder da');
assert(nachher === vorher, 'Achsen, Positionen und Höhen überstehen Speichern und Laden unverändert');

// ── 11. PDF enthält Achse, Höhe und Position ──────────────────────────────
const pdf = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return (window.__pdfSaved.calls || [])
    .filter(c => c[0] === 'text').map(c => String(c[2])).join(' | ');
});
assert(/Achse B/.test(pdf), 'das PDF weist die Achse aus');
assert(/Innengeländer/i.test(pdf), 'das PDF weist die gemeinsam gesetzte Position aus');
assert(/9,40|9,4/.test(pdf), 'das PDF rechnet mit der gemeinsam gesetzten Höhe');

// ── 12. Ansicht: Handy-Modus lässt sich ausdrücklich wählen ───────────────
await page.evaluate(() => { setWerkzeugPanel(true); });
await page.evaluate(() => [...document.querySelectorAll('#wzAnsicht .wz-segment-btn')]
  .find(b => b.dataset.ansicht === 'handy').click());
await page.waitForTimeout(250);
assert(await page.evaluate(() => document.body.dataset.mode === 'iphone'),
  'Handy-Modus lässt sich auf dem iPad ausdrücklich einschalten');
assert(await page.evaluate(() => document.getElementById('sidePanel').closest('#werkzeugPanel') !== null),
  'im Handy-Modus zieht die Feldliste ins Menü (dieselbe Liste, kein Klon)');
assert(await page.evaluate(() => document.getElementById('td-exportPdfBtn').closest('#wzAktionen') !== null),
  'PDF, Projekt und Bordbrett liegen im Handy-Modus im Menü statt in der Leiste');

await page.evaluate(() => [...document.querySelectorAll('#wzAnsicht .wz-segment-btn')]
  .find(b => b.dataset.ansicht === 'tablet').click());
await page.waitForTimeout(250);
assert(await page.evaluate(() => document.body.dataset.mode === 'ipad'),
  'zurück auf Tablet-Ansicht');
assert(await page.evaluate(() => document.getElementById('td-exportPdfBtn').closest('.tb-tools') !== null),
  'die ausgelagerten Knöpfe kehren an ihren Platz in der Leiste zurück');

await page.evaluate(() => [...document.querySelectorAll('#wzAnsicht .wz-segment-btn')]
  .find(b => b.dataset.ansicht === 'auto').click());
await page.waitForTimeout(250);
assert(await page.evaluate(() => localStorage.getItem('geruest.2d.ansichtsmodus') === 'auto'),
  'die Wahl „Automatisch" wird gemerkt');

// Altbestand: die Vorgängerfassung schrieb den ERKANNTEN Modus in denselben
// Schlüssel, aus dem sie ihn las – wer einmal in einem schmalen Fenster war,
// blieb danach überall im Handy-Modus. Der alte Wert darf die Ansicht nicht
// mehr festklemmen.
assert(await page.evaluate(() => {
  localStorage.setItem('geruest.2d.geraetemodus', 'iphone');
  localStorage.removeItem('geruest.2d.ansichtsmodus');
  applyMode();
  return document.body.dataset.mode;
}) === 'ipad', 'ein alter, festgeschriebener Handy-Modus klemmt die Ansicht nicht mehr fest');

const fehler = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(fehler.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + fehler.join(' | '));
await ctx.close();

// ══════════════════════════════════════════════════════════════════════════
//  Bildschirme: nichts läuft aus dem Bild, nichts wird zu klein
// ══════════════════════════════════════════════════════════════════════════
console.log('\nBildschirme\n');

const SCHIRME = [
  ['Desktop',            1440,  900, 'ipad'],
  ['iPad quer',          1180,  820, 'ipad'],
  ['iPad hoch',           820, 1180, 'ipad'],
  ['Smartphone hoch',     390,  844, 'iphone'],
  ['Smartphone quer',     844,  390, 'iphone'],
  ['kleines Smartphone',  320,  568, 'iphone']
];

for (const [name, w, h, modus] of SCHIRME) {
  const c = await open({ width: w, height: h });
  await seedFields(c.page, 8);
  await c.page.click('#werkzeugBtn');
  await c.page.waitForSelector('#werkzeugPanel.offen');
  const m = await c.page.evaluate(() => {
    const innen = (r) => r.right <= window.innerWidth + 1 && r.left >= -1
                      && r.bottom <= window.innerHeight + 1 && r.top >= -1;
    const knoepfe = [...document.querySelectorAll('#toolbar .tb-btn')];
    const menue   = [...document.querySelectorAll('#werkzeugPanel button')]
      .filter(b => b.offsetParent !== null);
    const vp = document.getElementById('viewerPanel').getBoundingClientRect();
    const pr = document.getElementById('werkzeugPanel').getBoundingClientRect();
    const freiH = pr.left >= vp.right - 1 ? vp.height : Math.max(0, pr.top - vp.top);
    return {
      modus:      document.body.dataset.mode,
      querlauf:   document.documentElement.scrollWidth > window.innerWidth + 1,
      raus:       knoepfe.filter(b => !innen(b.getBoundingClientRect())).map(b => b.id || b.title),
      klein:      knoepfe.concat(menue)
                    .filter(b => { const r = b.getBoundingClientRect(); return r.height < 36 || r.width < 36; })
                    .map(b => (b.id || b.className || '').slice(0, 28)),
      menueRaus:  menue.filter(b => { const r = b.getBoundingClientRect();
                    return r.right > window.innerWidth + 1 || r.left < -1; }).length,
      frei:       Math.round(freiH),
      breite:     Math.round(vp.width)
    };
  });
  assert(m.modus === modus, `${name}: Modus „${m.modus}"`);
  assert(!m.querlauf, `${name}: die Seite läuft nicht seitlich aus dem Bild`);
  assert(m.raus.length === 0, `${name}: alle Knöpfe der Hauptleiste sind sichtbar (${m.raus.join(',') || 'keiner fehlt'})`);
  assert(m.klein.length === 0, `${name}: kein Bedienelement unter 36 px (${m.klein.slice(0, 3).join(',') || 'alle groß genug'})`);
  assert(m.menueRaus === 0, `${name}: das Menü ragt nicht seitlich heraus`);
  assert(m.frei >= 140, `${name}: bei offenem Menü bleiben ${m.frei} px Zeichenfläche frei`);
  const f = c.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
  assert(f.length === 0, `${name}: keine JS-Fehler`);
  await c.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  Handy-Modus: jedes Werkzeug bleibt bedienbar – auch die umgezogenen
// ══════════════════════════════════════════════════════════════════════════
console.log('\nHandy-Modus\n');
const hctx = await open({ width: 390, height: 844 });
const hpage = hctx.page;
await seedFields(hpage, 4);
await hpage.waitForTimeout(200);
assert(await hpage.evaluate(() => document.body.dataset.mode === 'iphone'), 'Handy-Modus automatisch erkannt');

await hpage.click('#werkzeugBtn');
await hpage.waitForSelector('#werkzeugPanel.offen');

// Bordbrett (aus dem Menü)
await hpage.click('#wzAktionenSlot #bordbrettBtn');
await hpage.waitForTimeout(250);
assert(await hpage.evaluate(() => bordbrettModus), 'Bordbrett-Modus startet aus dem Menü');
await hpage.evaluate(() => { const b = allBaysFlat()[0]; setzeBordbrettKante(b.id, 2, true); renderAll(); flushRender(); });
assert(await hpage.evaluate(() => bordbrettKantenListe().length === 1), 'Bordbrett-Kante gesetzt');
await hpage.evaluate(() => beendeBordbrettModus());
await hpage.waitForTimeout(200);

// Mehrfachauswahl beendet Bordbrett-Modus
await hpage.evaluate(() => starteBordbrettModus());
await hpage.waitForTimeout(150);
await hpage.click('.bulk-toggle-btn');
await hpage.waitForTimeout(200);
assert(await hpage.evaluate(() => bulkMode && !bordbrettModus),
  'Mehrfachauswahl beendet den Bordbrett-Modus (ein Tipp = eine Bedeutung)');

// Konsole + Dachfang über die Mehrfachauswahl
await hpage.evaluate(() => { allBaysFlat().forEach(b => bulkSelected.add(b.id)); renderAll(); flushRender(); });
await hpage.evaluate(() => document.querySelector('#bulkBar .bulk-kons-add-btn').click());
await hpage.waitForTimeout(200);
assert(await hpage.evaluate(() => allBaysFlat().every(b => b.positions.some(p => p.cat === 'konsole'))),
  'Konsole auf alle Felder');
await hpage.evaluate(() => [...document.querySelectorAll('#bulkBar .bulk-pos-chip')]
  .find(c => c.textContent === 'Dachfang').click());
await hpage.waitForSelector('#bottomSheet');
await hpage.evaluate(() => document.querySelector('#bottomSheet .sheet-ok').click());
await hpage.waitForTimeout(250);
assert(await hpage.evaluate(() => allBaysFlat().every(b => b.positions.some(p => p.cat === 'dachfang'))),
  'Dachfang auf alle Felder');

// Undo / Redo
const vorUndo = await hpage.evaluate(() => allBaysFlat().filter(b => b.positions.some(p => p.cat === 'dachfang')).length);
await hpage.waitForTimeout(800);
await hpage.click('#undoBtn');
await hpage.waitForTimeout(300);
const nachUndo = await hpage.evaluate(() => allBaysFlat().filter(b => b.positions.some(p => p.cat === 'dachfang')).length);
assert(nachUndo !== vorUndo, `Undo wirkt (${vorUndo} → ${nachUndo} Felder mit Dachfang)`);
await hpage.click('#redoBtn');
await hpage.waitForTimeout(300);
assert(await hpage.evaluate(() => allBaysFlat().filter(b => b.positions.some(p => p.cat === 'dachfang')).length) === vorUndo,
  'Redo stellt es wieder her');

// Magnet
const magnetVor = await hpage.evaluate(() => snapEnabled);
await hpage.click('#snapToggleBtn');
await hpage.waitForTimeout(150);
assert(await hpage.evaluate(() => snapEnabled) !== magnetVor, 'Magnet lässt sich umschalten');
await hpage.click('#snapToggleBtn');

// Feld drehen
await hpage.evaluate(() => { bulkMode = false; bulkSelected.clear(); selectedSi = 0; selectedBi = 0; renderAll(); flushRender(); });
const winkelVor = await hpage.evaluate(() => Math.round(secAngle(state.sections[0])));
await hpage.evaluate(() => rotateSectionBy(0, 90));
await hpage.waitForTimeout(200);
assert(await hpage.evaluate(() => Math.round(secAngle(state.sections[0]))) === (winkelVor + 90) % 360,
  'Feld drehen');

// Projekt-Blatt und PDF aus dem Menü
await hpage.click('#wzAktionenSlot #tdMenuBtn');
await hpage.waitForSelector('#bottomSheet');
assert(await hpage.$('#scaffDepth') !== null, 'Projekt-Blatt öffnet aus dem Menü (Gerüsttiefe darin)');
await hpage.evaluate(() => closeSheet());
await hpage.waitForTimeout(350);
await hpage.click('#wzAktionenSlot #td-exportPdfBtn');
await hpage.waitForSelector('.pdf-theme-card', { timeout: 3000 });
assert((await hpage.$$('.pdf-theme-card')).length === 2, 'PDF-Dialog öffnet aus dem Menü');
await hpage.evaluate(() => document.querySelector('.sheet-del').click());
await hpage.waitForTimeout(300);

const errs = hctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));

await hctx.close();

console.log('\nAlle Tests zu Aufgabe 10 bestanden.');
