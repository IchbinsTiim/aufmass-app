// Runde 8 – Zeichnungsübersicht der 2D-Aufmaß-App:
// Ordnerstruktur, Suche, Auswahl öffnet die richtige Zeichnung, Wechseln
// zwischen Zeichnungen, Rücksprung über den Zurück-Button.
//
// Seit der Trennung der Anwendungen liegen die Zeichnungen in einem eigenen
// Speicher der 2D-App (geruest.2d.zeichnungen / geruest.2d.ordner) – nicht
// mehr in den Projekten der Aufmaß-App.
import { chromium } from 'playwright';
import { serve, assert } from './harness.mjs';

const { server, port: PORT } = await serve();
// Die 2D-Aufmaß-App ist eine eigene Seite; `#/projekte` ist die
// Zeichnungsübersicht, `#/zeichnung` die geöffnete Zeichnung.
const URL_ = pfad => `http://127.0.0.1:${PORT}${pfad}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

// Drei Zeichnungen in zwei Ordnern, eine ohne Ordner und noch leer.
await page.addInitScript(() => {
  const z = (tiefe, felder) => ({
    depth: tiefe,
    sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
                 bays: Array.from({ length: felder }, (_, i) => ({ id: i + 1, len: 2.57, hL: 8, hR: 8, positions: [] })) }],
    abschnitte: [], _sId: 1, _bId: felder
  });
  localStorage.setItem('geruest.2d.geraetemodus', 'ipad');
  // Nur beim ersten Laden befüllen – spätere Seitenaufrufe arbeiten mit dem,
  // was die App daraus gemacht hat.
  if (sessionStorage.getItem('r8-befuellt')) return;
  sessionStorage.setItem('r8-befuellt', '1');
  localStorage.setItem('geruest.2d.ordner', JSON.stringify([
    { id: 'f-hof', name: 'Hofbau' }, { id: 'f-neu', name: 'Neubau' }
  ]));
  const basis = { erstellt: '2026-03-01' };
  localStorage.setItem('geruest.2d.zeichnungen', JSON.stringify([
    { ...basis, id: 'p-hof', name: 'Hofstraße 4', folderId: 'f-hof', geaendert: '2026-03-05',
      anschrift: { strasse: 'Hofstraße', nummer: '4', plz: '70173', ort: 'Stuttgart', bauherr: 'Maier Bau' },
      zeichnung2d: z(0.73, 3) },
    { ...basis, id: 'p-neu', name: 'Neubau Ost', folderId: 'f-neu', geaendert: '2026-03-09',
      anschrift: { strasse: 'Ostweg', nummer: '11', plz: '71034', ort: 'Böblingen', bauherr: 'Stadtwerke' },
      zeichnung2d: z(1.09, 5) },
    { ...basis, id: 'p-frei', name: 'Lagerhalle', folderId: null, geaendert: '2026-03-02',
      anschrift: { strasse: 'Industriestraße', nummer: '2', plz: '70565', ort: 'Stuttgart', bauherr: 'Logistik GmbH' },
      zeichnung2d: { depth: 0.73, sections: [], abschnitte: [], _sId: 0, _bId: 0 } }
  ]));
});

const karten = () => page.$$eval('#tdProjectGrid .td-project-card',
  els => els.map(e => e.querySelector('.td-project-name').textContent));
// Beschriftung und Zähler stehen in getrennten Elementen (für den Abstand
// sorgt das Layout), deshalb hier gezielt auslesen statt textContent.
const chips = () => page.$$eval('#tdFolderBar .td-folder-chip', els => els.map(e => {
  const zahl = e.querySelector('.td-folder-chip-zahl');
  const name = e.firstElementChild.textContent.trim();
  return `${name} ${zahl ? zahl.textContent.trim() : ''}`.trim();
}));

console.log('RUNDE 8 – Zeichnungsübersicht der 2D-Aufmaß-App\n');

// ── 1. Die Kachel der Startseite führt zuerst auf die Übersicht ──────────
await page.goto(URL_('/app'));
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
await page.click('.hub-tile[data-ziel="2d"]');
await page.waitForURL(u => u.pathname === '/app/aufmass-2d');
await page.waitForFunction(() => location.hash === '#/projekte' && typeof ZweiDModul !== 'undefined');
await page.waitForTimeout(400);
assert(await page.isVisible('#td-projekte') && !(await page.isVisible('#td-zeichnung')),
  'Kachel „2D-Aufmaß" führt auf die Zeichnungsübersicht, nicht auf die Zeichenfläche');
assert(await page.evaluate(() => document.body.dataset.modul) === '2d',
  'die App trägt dabei die Farbe des 2D-Aufmaßes');

// ── 2. Ordnerstruktur ────────────────────────────────────────────────────
const c = await chips();
assert(c.length === 4, `Ordnerleiste zeigt alle Einträge: ${JSON.stringify(c)}`);
assert(c[0] === 'Alle Zeichnungen 3', 'Zähler „Alle Zeichnungen" stimmt');
assert(c[1] === 'Ohne Ordner 1', 'Zähler „Ohne Ordner" stimmt');
assert(c.includes('Hofbau 1') && c.includes('Neubau 1'), 'beide Ordner mit ihren Zählern da');
assert((await karten()).length === 3, 'ohne Filter sind alle drei Zeichnungen gelistet');
assert((await karten())[0] === 'Neubau Ost', 'zuletzt geänderte Zeichnung steht vorn');

await page.click('#tdFolderBar .td-folder-chip:has-text("Hofbau")');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Hofstraße 4']),
  'Ordner „Hofbau" filtert auf seine Zeichnung');

await page.click('#tdFolderBar .td-folder-chip:has-text("Ohne Ordner")');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Lagerhalle']),
  '„Ohne Ordner" zeigt die Zeichnung ohne Zuordnung');

await page.click('#tdFolderBar .td-folder-chip:has-text("Alle Zeichnungen")');
await page.waitForTimeout(250);

// ── 3. Suche ─────────────────────────────────────────────────────────────
await page.fill('#tdProjectSearch', 'böblingen');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Neubau Ost']),
  'Suche greift auch auf die Anschrift');
await page.fill('#tdProjectSearch', 'Logistik');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Lagerhalle']),
  'Suche greift auch auf den Bauherrn');
await page.fill('#tdProjectSearch', 'gibtesnicht');
await page.waitForTimeout(250);
assert(await page.isVisible('#tdProjectNoHits'), 'ohne Treffer erscheint der Hinweis');
await page.fill('#tdProjectSearch', '');
await page.waitForTimeout(250);

// ── 4. Karte zeigt den Zeichenstand ──────────────────────────────────────
const stand = await page.$$eval('#tdProjectGrid .td-project-card', els => els.map(e => ({
  name: e.querySelector('.td-project-name').textContent,
  stats: e.querySelector('.td-project-stats').textContent,
  ordner: e.querySelector('.td-project-ordner')?.textContent || ''
})));
assert(stand.find(s => s.name === 'Neubau Ost').stats === '5 Felder · 102,80 m²',
  'gezeichnete Felder stehen an der Karte: ' + stand.find(s => s.name === 'Neubau Ost').stats);
assert(stand.find(s => s.name === 'Lagerhalle').stats === 'Noch nichts gezeichnet',
  'eine leere Zeichnung sagt das auch');
assert(stand.find(s => s.name === 'Hofstraße 4').ordner.includes('Hofbau'),
  'der Ordner steht an der Karte');

// ── 5. Auswahl öffnet die richtige Zeichnung ─────────────────────────────
await page.click('#tdProjectGrid .td-project-card:has-text("Neubau Ost")');
await page.waitForFunction(() => location.hash === '#/zeichnung');
await page.waitForTimeout(500);
assert(await page.isVisible('#td-zeichnung') && !(await page.isVisible('#td-projekte')),
  'nach der Auswahl ist die Zeichenfläche sichtbar');
let z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  tiefe: state.depth, projekt: linkedProjectId
}));
assert(z.projekt === 'p-neu' && z.felder === 5 && z.tiefe === 1.09,
  `die gewählte Zeichnung ist geladen (${z.felder} Felder, ${z.tiefe} m Gerüsttiefe)`);

// ── 6. Projekt wechseln aus der Werkzeugleiste ───────────────────────────
await page.click('#tdMenuBtn');
await page.waitForSelector('#projWechselBtn');
await page.click('#projWechselBtn');
await page.waitForFunction(() => location.hash === '#/projekte');
await page.waitForTimeout(400);
assert(await page.isVisible('#td-projekte'), '„Zeichnung wechseln" führt zurück in die Übersicht');
const markiert = await page.$$eval('#tdProjectGrid .td-project-card.aktuell',
  els => els.map(e => e.querySelector('.td-project-name').textContent));
assert(JSON.stringify(markiert) === JSON.stringify(['Neubau Ost']),
  'die geöffnete Zeichnung ist in der Übersicht markiert');

await page.click('#tdProjectGrid .td-project-card:has-text("Hofstraße 4")');
await page.waitForFunction(() => location.hash === '#/zeichnung');
await page.waitForTimeout(500);
z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  tiefe: state.depth, projekt: linkedProjectId
}));
assert(z.projekt === 'p-hof' && z.felder === 3 && z.tiefe === 0.73,
  `Wechsel lädt die andere Zeichnung (${z.felder} Felder, ${z.tiefe} m Gerüsttiefe)`);

// ── 7. Zurück-Button ─────────────────────────────────────────────────────
await page.goBack();
await page.waitForFunction(() => location.hash === '#/projekte');
await page.waitForTimeout(300);
assert(await page.isVisible('#td-projekte'), 'Zurück führt von der Zeichnung in die Übersicht');

// ── 8. Direkter Einstieg ohne gewählte Zeichnung ─────────────────────────
await page.evaluate(() => localStorage.removeItem('geruest.2d.aktuelleZeichnung'));
await page.goto(URL_('/app/aufmass-2d#/zeichnung'));
await page.waitForFunction(() => location.hash === '#/projekte', null, { timeout: 5000 });
await page.waitForTimeout(300);
assert(await page.isVisible('#td-projekte'),
  'ohne gewählte Zeichnung bietet #/zeichnung zuerst die Übersicht an, statt einer leeren Fläche');

// ── 9. Ohne jede Zeichnung bleibt die freie Zeichnung ────────────────────
await page.evaluate(() => {
  localStorage.setItem('geruest.2d.zeichnungen', '[]');
  localStorage.removeItem('geruest.2d.ordner');
});
await page.goto(URL_('/app/aufmass-2d#/zeichnung'));
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.waitForTimeout(500);
assert(await page.isVisible('#td-zeichnung'),
  'gibt es überhaupt keine Zeichnung, öffnet #/zeichnung direkt die freie Zeichnung');

const errs = logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));

console.log('\nAlle Tests zur Zeichnungsübersicht bestanden.');
await browser.close();
server.close();
