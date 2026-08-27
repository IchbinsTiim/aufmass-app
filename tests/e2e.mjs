// Durchgängiger Ablauf wie beim Nutzer: Vorlage laden, Abschnitte anlegen,
// zuordnen, drehen, PDF-Dialog öffnen – ohne interne Funktionen aufzurufen.
import { open, assert } from './harness.mjs';
const ctx = await open({ width: 1440, height: 1020 });
const { page } = ctx;

// Vorlagen liegen seit der Überarbeitung im Projekt-Sheet – die Werkzeug-
// leiste zeigt nur noch, was beim Zeichnen selbst gebraucht wird.
await page.click('#tdMenuBtn');
await page.waitForSelector('#uShapeBtn');
await page.click('#uShapeBtn');
await page.waitForTimeout(250);
assert(await page.evaluate(() => state.sections.length > 0), 'U-Form-Vorlage erzeugt Felder');

// Werkzeug-Menü öffnen: Auswahl, Achsen und Sammelbearbeitung liegen dort.
await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
assert(await page.evaluate(() => werkzeugOffen), 'Werkzeug-Menü öffnet über den Pfeil-Knopf');

// Abschnitt über die Oberfläche anlegen (prompt beantworten)
page.on('dialog', d => d.accept('Nordseite'));
await page.click('.absch-add-btn');
await page.waitForTimeout(250);
assert(await page.evaluate(() => state.abschnitte.length === 1 && state.abschnitte[0].name === 'Nordseite'),
  'Abschnitt über die Oberfläche angelegt');

// Mehrfachauswahl einschalten und im Plan zwei Felder antippen
await page.click('.bulk-toggle-btn');
await page.waitForTimeout(200);
for (const i of [0, 1]) {
  // Bildschirmposition der Feldmitte aus der Kamera ableiten (Eckstücke sind
  // ebenfalls Polygone und dürfen hier nicht getroffen werden).
  const p = await page.evaluate(idx => {
    const el = computeLayout().filter(e => e.type === 'bay')[idx];
    const vp = viewportRect();
    return { x: vp.left + vp.w / 2 + (el.cx - camera.cx) * camera.scale,
             y: vp.top  + vp.h / 2 + (el.cy - camera.cy) * camera.scale };
  }, i);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}
assert(await page.evaluate(() => bulkSelected.size === 2), 'zwei Felder direkt im Plan angehakt');

// Achse/Abschnitt der Auswahl zuweisen – die Chips stehen im Achsen-Block
await page.evaluate(() => [...document.querySelectorAll('#abschnittBar .bulk-pos-chip')]
  .find(c => c.textContent === 'Nordseite').click());
await page.waitForTimeout(250);
assert(await page.evaluate(() => allBaysFlat().filter(b => b.abschnittId).length === 2),
  'Abschnitt auf die Auswahl übertragen');

const info = await page.textContent('#selectionInfo');
assert(/2 Felder ausgewählt/.test(info) && /Nordseite/.test(info),
  'Anzeige oben links: ' + info.replace(/\s+/g, ' '));

// Auswahl überlebt das Zuklappen des Menüs (das Menü ist nur die Oberfläche)
await page.click('#werkzeugBtn');
await page.waitForTimeout(200);
assert(await page.evaluate(() => !werkzeugOffen && bulkMode && bulkSelected.size === 2),
  'Auswahl bleibt erhalten, wenn das Menü zugeklappt wird');
await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
assert(await page.evaluate(() => bulkSelected.size === 2),
  'nach dem Wiederaufklappen ist dieselbe Auswahl markiert');

// Mehrfachauswahl beenden, Feld antippen, drehen
await page.click('.bulk-toggle-btn');
await page.waitForTimeout(200);
const p0 = await page.evaluate(() => {
  const el = computeLayout().filter(e => e.type === 'bay')[0];
  const vp = viewportRect();
  return { x: vp.left + vp.w / 2 + (el.cx - camera.cx) * camera.scale,
           y: vp.top  + vp.h / 2 + (el.cy - camera.cy) * camera.scale };
});
const t0 = Date.now();
await page.mouse.click(p0.x, p0.y);
await page.waitForSelector('#bottomSheet', { timeout: 3000 });
assert(Date.now() - t0 < 1200, `Bearbeiten öffnet in ${Date.now() - t0} ms`);
const before = await page.evaluate(() => Math.round(secAngle(state.sections[selectedSi])));
await page.evaluate(() => [...document.querySelectorAll('.rot-preset')][0].click());
await page.waitForTimeout(200);
const after = await page.evaluate(() => Math.round(secAngle(state.sections[selectedSi])));
assert(after === (before + 90) % 360, `90°-Knopf dreht sofort (${before}° → ${after}°)`);

// Abschnitt im Bearbeiten-Sheet setzen
await page.evaluate(() => [...document.querySelectorAll('.absch-chip')]
  .find(c => c.textContent === 'Nordseite').click());
await page.waitForTimeout(200);
assert(await page.evaluate(() => !!abschnittById(state.sections[selectedSi].bays[0].abschnittId)),
  'Abschnitt im Bearbeiten-Sheet zugewiesen');
await page.evaluate(() => closeSheet());
await page.waitForTimeout(350);

// PDF-Dialog
await page.click('#td-exportPdfBtn');
await page.waitForSelector('.pdf-theme-card', { timeout: 3000 });
assert((await page.$$('.pdf-theme-card')).length === 2,
  'PDF-Dialog zeigt zwei Ausgaben (Farbe / Schwarz-Weiß)');
await page.evaluate(() => document.querySelector('.sheet-del').click());
await page.waitForTimeout(300);

const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));
console.log('\nDurchgängiger Ablauf bestanden.');
await ctx.close();
