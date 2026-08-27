// Runde 7 – Shell der zusammengeführten App:
// Hash-Routing (Hub / Aufmaß / 2D), Deep-Link, Neuladen, Zurück-Button,
// Zustandserhalt beim Modulwechsel, Speicher-Migration, Namensraum-Sauberkeit.
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
  if (url.pathname === '/__jspdf.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(STUB)); return;
  }
  if (url.pathname === '/__fonts.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('/* keine Webschriften */'); return;
  }
  const p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end('nf'); return; }
  let body = fs.readFileSync(p);
  if (p.endsWith('.html')) {
    body = body.toString()
      .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+/, '/__jspdf.js')
      .replace(/https:\/\/fonts\.googleapis\.com\/css2[^"]*/, '/__fonts.css')
      .replace(/<link rel="preconnect"[^>]*>/g, '');
  }
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

const modul = () => page.evaluate(() => document.body.dataset.modul);
const sichtbar = v => page.evaluate(
  s => { const el = document.querySelector(`.view[data-view="${s}"]`); return !!el && getComputedStyle(el).display !== 'none'; }, v);

console.log('RUNDE 7 – Shell: Routing, Zustandserhalt, Migration\n');

// ── 1. Speicher-Migration ────────────────────────────────────────────────
await page.addInitScript(() => {
  localStorage.setItem('aufmass_projects_v2', JSON.stringify([{
    id: 'p-alt', name: 'Altprojekt', status: 'in_bearbeitung',
    erstellt: '2026-01-02', geaendert: '2026-01-03',
    anschrift: {}, geruesttyp: 'fassade', seiten: [], technik: {}, logistik: {},
    zusatzpositionen: [], zeichnung2d: null
  }]));
  localStorage.setItem('aufmass_folders_v1', JSON.stringify([{ id: 'f1', name: 'Altordner' }]));
  localStorage.setItem('aufmass_ueberstand_wert', '3');
  localStorage.setItem('av_2d_pdf_theme', 'kontrast');
  localStorage.setItem('av_deviceMode', 'ipad');
});
await page.goto(URL_('#/'));
await page.waitForFunction(() => document.body.dataset.modul === 'hub');

const mig = await page.evaluate(() => ({
  projekteNeu: JSON.parse(localStorage.getItem('geruest.aufmass.projekte') || '[]').length,
  ordnerNeu:   JSON.parse(localStorage.getItem('geruest.aufmass.ordner') || '[]').length,
  ueberstand:  localStorage.getItem('geruest.aufmass.ueberstandWert'),
  pdfDesign:   localStorage.getItem('geruest.2d.pdfDesign'),
  geraet:      localStorage.getItem('geruest.2d.geraetemodus'),
  altWeg: ['aufmass_projects_v2', 'aufmass_folders_v1', 'aufmass_ueberstand_wert',
           'av_2d_pdf_theme', 'av_deviceMode'].every(k => localStorage.getItem(k) === null)
}));
assert(mig.projekteNeu === 1, 'Projekte wandern nach geruest.aufmass.projekte');
assert(mig.ordnerNeu === 1, 'Ordner wandern nach geruest.aufmass.ordner');
assert(mig.ueberstand === '3', 'Standard-Zuschlag übernommen');
assert(mig.pdfDesign === 'kontrast', 'PDF-Layout übernommen');
assert(mig.geraet === 'ipad', 'Gerätemodus übernommen');
assert(mig.altWeg, 'alte Schlüssel sind nach der Migration entfernt');

// Ein gewähltes Projekt setzen: das 2D-Modul zeigt sonst zuerst seine
// Projektliste (siehe r8) statt der Zeichenfläche. Hier geht es um das
// Routing der Shell, nicht um die Projektauswahl.
await page.evaluate(() => localStorage.setItem('geruest.app.aktuellesProjekt', 'p-alt'));

// ── 2. Routing ───────────────────────────────────────────────────────────
assert(await modul() === 'hub', 'Startadresse ohne Route zeigt den Hub');
assert(await sichtbar('hub') && !(await sichtbar('aufmass')) && !(await sichtbar('2d')),
  'nur der Hub ist sichtbar');

await page.click('.hub-tile[data-ziel="aufmass"]');
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
assert(await page.evaluate(() => location.hash) === '#/aufmass', 'Kachel 1 führt auf #/aufmass');
assert(await sichtbar('aufmass') && !(await sichtbar('hub')), 'Modul 1 ist sichtbar, der Hub nicht');

await page.click('.mod-tab[data-ziel="2d"]');
await page.waitForFunction(() => document.body.dataset.modul === '2d');
assert(await page.evaluate(() => location.hash) === '#/2d',
  'Umschalter führt mit gewähltem Projekt direkt in die Zeichnung');
assert(await page.evaluate(() => !!document.getElementById('planSvg').clientWidth),
  'die Zeichenfläche ist beim Aktivieren wirklich sichtbar (Kamera kann messen)');

// Unbekannte Route → Hub statt Leerseite
await page.evaluate(() => { location.hash = '#/gibtesnicht'; });
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
assert(await modul() === 'hub', 'unbekannte Route landet auf dem Hub');

// ── 3. Deep-Link und Neuladen ────────────────────────────────────────────
await page.goto(URL_('#/2d'));
await page.waitForFunction(() => document.body.dataset.modul === '2d');
assert(await modul() === '2d', 'Deep-Link #/2d öffnet direkt Modul 2');
await page.reload();
await page.waitForFunction(() => document.body.dataset.modul === '2d');
assert(await modul() === '2d', 'Neuladen bleibt in Modul 2');

// ── 4. Zurück-Button des Browsers ────────────────────────────────────────
await page.goto(URL_('#/'));
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
await page.evaluate(() => { location.hash = '#/aufmass'; });
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.goBack();
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
assert(await modul() === 'aufmass', 'Zurück führt von Modul 2 nach Modul 1');
await page.goBack();
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
assert(await modul() === 'hub', 'noch einmal Zurück führt auf den Hub');
await page.goForward();
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
assert(await modul() === 'aufmass', 'Vorwärts funktioniert ebenso');

// ── 5. Zustandserhalt beim Wechsel ───────────────────────────────────────
await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.click('#tdMenuBtn');
await page.waitForSelector('#uShapeBtn');
await page.click('#uShapeBtn');
await page.waitForTimeout(300);
const vorher = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  achsen: state.sections.length,
  zoom:   Math.round(camera.scale * 1e6)
}));
assert(vorher.felder > 0, `Zeichnung angelegt (${vorher.felder} Felder)`);

await page.evaluate(() => { location.hash = '#/'; });
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.waitForTimeout(300);
const nachher = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  achsen: state.sections.length,
  zoom:   Math.round(camera.scale * 1e6)
}));
assert(nachher.felder === vorher.felder && nachher.achsen === vorher.achsen,
  'nach Hub und zurück ist die Zeichnung unverändert');
assert(nachher.zoom === vorher.zoom, 'auch der Bildausschnitt bleibt erhalten');

// Formularzustand in Modul 1 übersteht den Wechsel ebenso
await page.evaluate(() => { location.hash = '#/aufmass'; });
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
await page.evaluate(() => AufmassModul.oeffneProjekt('p-alt'));
await page.waitForTimeout(200);
await page.fill('#fieldBauherr', 'Zwischenstand Bauherr');
await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.evaluate(() => { location.hash = '#/aufmass'; });
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
assert(await page.inputValue('#fieldBauherr') === 'Zwischenstand Bauherr',
  'Eingaben in Modul 1 überstehen den Ausflug in Modul 2');
assert(await page.evaluate(() => !document.getElementById('projectScreen').classList.contains('hidden')),
  'das geöffnete Projekt ist beim Rücksprung weiterhin offen');

// ── 6. Projektwechsel lädt die zugehörige Zeichnung ──────────────────────
await page.evaluate(() => {
  const liste = JSON.parse(localStorage.getItem('geruest.aufmass.projekte'));
  liste.push({
    id: 'p-zeichnung', name: 'Mit Zeichnung', status: 'in_bearbeitung',
    erstellt: '2026-02-01', geaendert: '2026-02-01', anschrift: {}, geruesttyp: 'fassade',
    seiten: [], technik: {}, logistik: {}, zusatzpositionen: [],
    zeichnung2d: {
      depth: 1.09,
      sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
                   bays: [{ id: 1, len: 2.57, hL: 6, hR: 6, positions: [] },
                          { id: 2, len: 2.57, hL: 6, hR: 6, positions: [] }] }],
      abschnitte: [], _sId: 1, _bId: 2
    }
  });
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify(liste));
  loadProjects();
  AufmassModul.oeffneProjekt('p-zeichnung');
});
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d');
await page.waitForTimeout(400);
const geladen = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  tiefe:  state.depth
}));
assert(geladen.felder === 2, `Zeichnung des gewechselten Projekts geladen (${geladen.felder} Felder)`);
assert(geladen.tiefe === 1.09, 'auch die Gerüsttiefe stammt aus diesem Projekt (1,09 m)');

// ── 7. Namensraum / Dokument-Sauberkeit ──────────────────────────────────
const doppelt = await page.evaluate(() => {
  const gesehen = new Set(), mehrfach = [];
  document.querySelectorAll('[id]').forEach(el => {
    if (gesehen.has(el.id)) mehrfach.push(el.id); else gesehen.add(el.id);
  });
  return mehrfach;
});
assert(doppelt.length === 0, 'keine doppelt vergebene Element-ID im gemeinsamen Dokument: ' + JSON.stringify(doppelt));

const eindeutig = await page.evaluate(() => ({
  toasts: document.querySelectorAll('#toastEl').length,
  konsole: typeof KONSOLE_TYPES !== 'undefined' && typeof KONSOLE_TYPES_2D !== 'undefined'
           && KONSOLE_TYPES.join() !== KONSOLE_TYPES_2D.join(),
  aufmassPdf: !!document.querySelector('#am-root #exportPdfBtn'),
  zweidPdf:   !!document.querySelector('#td-root #td-exportPdfBtn')
}));
assert(eindeutig.toasts === 1, 'genau ein Toast-Element für beide Module');
assert(eindeutig.konsole, 'beide Konsolen-Listen existieren getrennt (KONSOLE_TYPES / KONSOLE_TYPES_2D)');
assert(eindeutig.aufmassPdf && eindeutig.zweidPdf, 'jedes Modul hat seinen eigenen PDF-Knopf');

// Kein Durchschlagen der 2D-Stile in das Aufmaß-Modul
await page.evaluate(() => { location.hash = '#/aufmass'; });
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
// `.empty-state` ist der einzige Klassenname, den beide Stylesheets kennen:
// im 2D-Modul eine zentrierte Flex-Spalte, im Aufmaß-Modul ein einfacher Block.
const leer = await page.evaluate(() => {
  const el = document.querySelector('#am-root .empty-state');
  if (!el) return { fehlt: true };
  const war = el.classList.contains('hidden');
  el.classList.remove('hidden');
  const st = getComputedStyle(el);
  const wert = { display: st.display, textAlign: st.textAlign };
  if (war) el.classList.add('hidden');
  return wert;
});
assert(leer.display === 'block' && leer.textAlign === 'center',
  'die 2D-Regel für .empty-state schlägt nicht ins Aufmaß-Modul durch '
  + `(display: ${leer.display}, text-align: ${leer.textAlign})`);

// ── 8. Bedienbarkeit ─────────────────────────────────────────────────────
// Baustellen-Handschuhe: die dauerhaft sichtbaren Bedienelemente müssen
// mindestens 44 px hoch sein. (Die kleinen Nebenaktionen `.btn-sm` sind
// bewusst kompakter und hier ausgenommen.)
const klein = await page.evaluate(() => {
  const zuKlein = [];
  document.querySelectorAll('#modSwitcher a, #am-root .btn:not(.btn-sm), #td-root #toolbar button')
    .forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 44) {
        zuKlein.push((el.id || el.className) + ': ' + Math.round(r.height) + 'px');
      }
    });
  return zuKlein;
});
assert(klein.length === 0, 'Bedienelemente erreichen 44 px Trefferhöhe: ' + JSON.stringify(klein));

const errs = logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));

console.log('\nAlle Tests zur Shell bestanden.');
await browser.close();
server.close();
