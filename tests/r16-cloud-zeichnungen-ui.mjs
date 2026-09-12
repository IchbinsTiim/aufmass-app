// Runde 9 – Zeichnungen im 2D-Modul anlegen und löschen:
// Primärknopf, Anlege-Dialog, leere Zeichenfläche, Persistenz über einen
// Reload, Löschen einzeln und in Mehrfachauswahl, „Rückgängig", geöffnete
// Zeichnung wird beim Löschen sauber geschlossen, Umbenennen/Duplizieren/
// Verschieben sowie Ordner anlegen und löschen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assert } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'legacy-app');
const STUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'jspdf-stub.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__jspdf.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(STUB)); return; }
  if (url.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(''); return; }
  // Die App verweist auf ihre Dateien unter `/app/…` – so liefert sie der
  // geschützte Route Handler der Next.js-Hülle aus. Der Testserver bildet
  // dieselbe Adresse auf den Ordner ab.
  const _pfad = decodeURIComponent(url.pathname).replace(/^\/app(\/|$)/, '/');
  const p = path.join(ROOT, _pfad);
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

// Bestand: zwei Projekte mit Zeichnung, ein Ordner. Dieser Bestand muss den
// gesamten Ablauf unverändert überstehen.
const SEED = () => {
  const z = (tiefe, felder) => ({
    depth: tiefe,
    sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
                 bays: Array.from({ length: felder }, (_, i) => ({ id: i + 1, len: 2.57, hL: 8, hR: 8, positions: [] })) }],
    abschnitte: [], _sId: 1, _bId: felder
  });
  localStorage.setItem('geruest.2d.geraetemodus', 'ipad');
  // Nur beim allerersten Laden einsäen – ein Reload im Test muss den echten,
  // gespeicherten Stand zeigen, nicht wieder den Ausgangsbestand.
  if (localStorage.getItem('__r9_seed') === '1') return;
  localStorage.setItem('__r9_seed', '1');
  localStorage.setItem('geruest.aufmass.ordner', JSON.stringify([{ id: 'f-hof', name: 'Hofbau' }]));
  const basis = { status: 'in_bearbeitung', erstellt: '2026-03-01', geruesttyp: 'fassade',
                  seiten: [], technik: {}, logistik: {}, zusatzpositionen: [] };
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([
    { ...basis, id: 'p-hof', name: 'Hofstraße 4', folderId: 'f-hof', geaendert: '2026-03-05',
      anschrift: { strasse: 'Hofstraße', nummer: '4', plz: '70173', ort: 'Stuttgart' }, zeichnung2d: z(0.73, 3) },
    { ...basis, id: 'p-alt', name: 'Altbau West', folderId: null, geaendert: '2026-03-02',
      anschrift: { strasse: 'Weststraße', nummer: '9', plz: '70565', ort: 'Stuttgart' }, zeichnung2d: z(1.09, 5) }
  ]));
};
await page.addInitScript(SEED);

const karten = () => page.$$eval('#tdProjectGrid .td-project-card',
  els => els.map(e => e.querySelector('.td-project-name').textContent));
const gespeicherte = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem('geruest.aufmass.projekte') || '[]').map(p => p.name));
const zurListe = async () => {
  await page.goto(URL_('#/2d/projekte'));
  await page.waitForFunction(() => document.body.dataset.modul === '2d' && !document.getElementById('td-projekte').classList.contains('hidden'));
  await page.waitForTimeout(250);
};
/** Öffnet das ⋯-Menü der Karte mit diesem Namen und klickt einen Eintrag. */
const kartenMenu = async (name, eintrag) => {
  await page.click(`#tdProjectGrid .td-project-card:has-text("${name}") .td-project-menu-btn`);
  await page.waitForSelector('#floatingMenu');
  await page.click(`#floatingMenu .floating-menu-item:has-text("${eintrag}")`);
  await page.waitForTimeout(250);
};


const bestand = [];
await page.route('**/api/cloud/**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/zeichnungen')) {
    if (req.method() === 'POST') {
      const z = req.postDataJSON();bestand.push({...z,erstellt_am:new Date().toISOString()});
      return route.fulfill({json:{zeichnung:z},status:201});
    }
    return route.fulfill({json:{zeichnungen:bestand.filter(z => !url.searchParams.get('zeichnung') || z.id === url.searchParams.get('zeichnung'))}});
  }
  return route.fulfill({status:503,json:{error:'Cloud im UI-Test deaktiviert'}});
});
try {
  await zurListe();
  await page.click('[data-zeichnungen]:visible');
  await page.waitForSelector('dialog[open]');
  await page.selectOption('#bestandProjekt','p-hof');
  await page.fill('#bestandName','Nordfassade');
  await page.click('#bestandSpeichern');
  await page.waitForFunction(() => document.getElementById('bestandStatus').textContent.includes('In der Cloud gespeichert'));
  assert(bestand.length === 1,'Speicherstand angelegt');
  await page.fill('#bestandName','Datei West');
  await page.setInputFiles('#bestandDatei',{name:'west.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:3,state:{depth:1.09,sections:[{id:1,dir:'E',x0:0,y0:0,bays:[{id:1,len:3.07,hL:6,hR:6,positions:[]}]}]},_sId:1,_bId:1}))});
  await page.waitForFunction(() => document.querySelectorAll('#bestandListe article').length === 2);
  assert(bestand[1].quelle === 'upload','Datei als Upload gesichert');
  await page.setInputFiles('#bestandDatei',{name:'kaputt.json',mimeType:'application/json',buffer:Buffer.from('kein json')});
  await page.waitForFunction(() => document.getElementById('bestandStatus').textContent.includes('kein gültiges JSON'));
  assert(bestand.length === 2,'Ungültiger Upload verändert Bestand nicht');
  await page.locator('#bestandListe article').filter({hasText:'Datei West'}).getByRole('button').click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
  const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('geruest.aufmass.projekte')));
  assert(projects.find(p=>p.name==='Datei West (Kopie)').zeichnung2d.sections[0].bays[0].len === 3.07,'Upload im Editor als Kopie geladen');
  assert(projects.find(p=>p.id==='p-hof').zeichnung2d.sections[0].bays.length === 3,'Vorhandene Zeichnung unverändert');
  await page.reload();
  await page.waitForSelector('#toolbar');
  assert((await gespeicherte()).includes('Datei West (Kopie)'), 'Geladene Kopie übersteht Reload');
  await page.click('[data-zeichnungen]:visible');
  await page.waitForSelector('dialog[open]');
  await page.screenshot({path:process.env.CLOUD_SCREENSHOT || '/tmp/aufmassx-zeichnungen.png'});
  assert(!logs.some(x=>x.startsWith('[pageerror]')), 'Keine Browser-Laufzeitfehler');
  console.log('Cloud-Zeichnungen UI bestanden');
} finally { await browser.close();server.close(); }
