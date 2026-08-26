// Runde 8 – Projektauswahl im 2D-Modul:
// Ordnerstruktur, Suche, Auswahl öffnet die richtige Zeichnung, Wechseln
// zwischen Projekten, Rücksprung über den Zurück-Button.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assert } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'aufmass_final_app');
const STUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'jspdf-stub.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__jspdf.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(STUB)); return; }
  if (url.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(''); return; }
  const p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end('nf'); return; }
  let body = fs.readFileSync(p);
  if (p.endsWith('.html')) body = body.toString()
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+/, '/__jspdf.js')
    .replace(/https:\/\/fonts\.googleapis\.com\/css2[^"]*/, '/__fonts.css')
    .replace(/<link rel="preconnect"[^>]*>/g, '');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const URL_ = h => `http://127.0.0.1:${PORT}/index.html${h}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

// Drei Projekte in zwei Ordnern, eines ohne Ordner, mit unterschiedlichen Zeichnungen.
await page.addInitScript(() => {
  const z = (tiefe, felder) => ({
    depth: tiefe,
    sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
                 bays: Array.from({ length: felder }, (_, i) => ({ id: i + 1, len: 2.57, hL: 8, hR: 8, positions: [] })) }],
    abschnitte: [], _sId: 1, _bId: felder
  });
  localStorage.setItem('geruest.2d.geraetemodus', 'ipad');
  localStorage.setItem('geruest.aufmass.ordner', JSON.stringify([
    { id: 'f-hof', name: 'Hofbau' }, { id: 'f-neu', name: 'Neubau' }
  ]));
  const basis = { status: 'in_bearbeitung', erstellt: '2026-03-01', geruesttyp: 'fassade',
                  seiten: [], technik: {}, logistik: {}, zusatzpositionen: [] };
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([
    { ...basis, id: 'p-hof', name: 'Hofstraße 4', folderId: 'f-hof', geaendert: '2026-03-05',
      anschrift: { strasse: 'Hofstraße', nummer: '4', plz: '70173', ort: 'Stuttgart', bauherr: 'Maier Bau' },
      zeichnung2d: z(0.73, 3) },
    { ...basis, id: 'p-neu', name: 'Neubau Ost', folderId: 'f-neu', geaendert: '2026-03-09',
      anschrift: { strasse: 'Ostweg', nummer: '11', plz: '71034', ort: 'Böblingen', bauherr: 'Stadtwerke' },
      zeichnung2d: z(1.09, 5) },
    { ...basis, id: 'p-frei', name: 'Lagerhalle', folderId: null, geaendert: '2026-03-02',
      anschrift: { strasse: 'Industriestraße', nummer: '2', plz: '70565', ort: 'Stuttgart', bauherr: 'Logistik GmbH' },
      zeichnung2d: null }
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

console.log('RUNDE 8 – Projektauswahl im 2D-Modul\n');

// ── 1. Die Hub-Kachel führt zuerst auf die Liste ─────────────────────────
await page.goto(URL_('#/'));
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
await page.click('.hub-tile[data-ziel="2d"]');
await page.waitForFunction(() => location.hash === '#/2d/projekte');
await page.waitForTimeout(400);
assert(await page.isVisible('#td-projekte') && !(await page.isVisible('#td-zeichnung')),
  'Kachel „2D-Aufmaß" führt auf die Projektliste, nicht auf die Zeichenfläche');
assert(await page.evaluate(() => document.body.dataset.modul) === '2d',
  'das Modul trägt dabei weiterhin die Farbe des 2D-Aufmaßes');

// ── 2. Ordnerstruktur ────────────────────────────────────────────────────
const c = await chips();
assert(c.length === 4, `Ordnerleiste zeigt alle Einträge: ${JSON.stringify(c)}`);
assert(c[0] === 'Alle Projekte 3', 'Zähler „Alle Projekte" stimmt');
assert(c[1] === 'Ohne Ordner 1', 'Zähler „Ohne Ordner" stimmt');
assert(c.includes('Hofbau 1') && c.includes('Neubau 1'), 'beide Ordner mit ihren Zählern da');
assert((await karten()).length === 3, 'ohne Filter sind alle drei Projekte gelistet');
assert((await karten())[0] === 'Neubau Ost', 'zuletzt geändertes Projekt steht vorn');

await page.click('#tdFolderBar .td-folder-chip:has-text("Hofbau")');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Hofstraße 4']),
  'Ordner „Hofbau" filtert auf sein Projekt');

await page.click('#tdFolderBar .td-folder-chip:has-text("Ohne Ordner")');
await page.waitForTimeout(250);
assert(JSON.stringify(await karten()) === JSON.stringify(['Lagerhalle']),
  '„Ohne Ordner" zeigt das Projekt ohne Zuordnung');

await page.click('#tdFolderBar .td-folder-chip:has-text("Alle Projekte")');
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
  'ein Projekt ohne Zeichnung sagt das auch');
assert(stand.find(s => s.name === 'Hofstraße 4').ordner.includes('Hofbau'),
  'der Ordner steht an der Karte');

// ── 5. Auswahl öffnet die richtige Zeichnung ─────────────────────────────
await page.click('#tdProjectGrid .td-project-card:has-text("Neubau Ost")');
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(500);
assert(await page.isVisible('#td-zeichnung') && !(await page.isVisible('#td-projekte')),
  'nach der Auswahl ist die Zeichenfläche sichtbar');
let z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  tiefe: state.depth, projekt: linkedProjectId
}));
assert(z.projekt === 'p-neu' && z.felder === 5 && z.tiefe === 1.09,
  `Zeichnung des gewählten Projekts geladen (${z.felder} Felder, ${z.tiefe} m Gerüsttiefe)`);

// ── 6. Projekt wechseln aus der Werkzeugleiste ───────────────────────────
await page.click('#tdProjectBtn');
await page.waitForFunction(() => location.hash === '#/2d/projekte');
await page.waitForTimeout(400);
assert(await page.isVisible('#td-projekte'), '„📁 Projekt" führt zurück in die Liste');
const markiert = await page.$$eval('#tdProjectGrid .td-project-card.aktuell',
  els => els.map(e => e.querySelector('.td-project-name').textContent));
assert(JSON.stringify(markiert) === JSON.stringify(['Neubau Ost']),
  'das geöffnete Projekt ist in der Liste markiert');

await page.click('#tdProjectGrid .td-project-card:has-text("Hofstraße 4")');
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(500);
z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  tiefe: state.depth, projekt: linkedProjectId
}));
assert(z.projekt === 'p-hof' && z.felder === 3 && z.tiefe === 0.73,
  `Wechsel lädt die andere Zeichnung (${z.felder} Felder, ${z.tiefe} m Gerüsttiefe)`);

// ── 7. Zurück-Button ─────────────────────────────────────────────────────
await page.goBack();
await page.waitForFunction(() => location.hash === '#/2d/projekte');
await page.waitForTimeout(300);
assert(await page.isVisible('#td-projekte'), 'Zurück führt von der Zeichnung in die Liste');

// ── 8. Direkter Einstieg ohne gewähltes Projekt ──────────────────────────
await page.evaluate(() => localStorage.removeItem('geruest.app.aktuellesProjekt'));
await page.goto(URL_('#/2d'));
await page.waitForFunction(() => location.hash === '#/2d/projekte', null, { timeout: 5000 });
await page.waitForTimeout(300);
assert(await page.isVisible('#td-projekte'),
  'ohne gewähltes Projekt bietet #/2d zuerst die Liste an, statt einer leeren Fläche');

// ── 9. Ohne jedes Projekt bleibt die freie Zeichnung ─────────────────────
await page.evaluate(() => {
  localStorage.removeItem('geruest.aufmass.projekte');
  localStorage.removeItem('geruest.aufmass.ordner');
});
await page.goto(URL_('#/2d'));
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.waitForTimeout(500);
assert(await page.isVisible('#td-zeichnung'),
  'gibt es überhaupt kein Projekt, öffnet #/2d direkt die freie Zeichnung');

const errs = logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));

console.log('\nAlle Tests zur Projektauswahl bestanden.');
await browser.close();
server.close();
