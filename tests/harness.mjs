// Minimaler Test-Harness: statischer Server + Chromium (Playwright).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// Wie der geschützte Route Handler (app/app/[[...pfad]]/route.ts): erstes
// Segment unter /app → Ordner; /app selbst ist die Startseite.
const ORDNER = { start: 'start', aufmass: 'aufmass', 'aufmass-2d': 'aufmass-2d', shared: 'shared' };
const MIT_STARTSEITE = new Set(['start', 'aufmass', 'aufmass-2d']);

/** URL-Pfad → Datei im Projekt (oder null). */
export function dateiZuPfad(pfad) {
  const m = /^\/app(?:\/(.*))?$/.exec(pfad);
  if (!m) return null;
  const segmente = (m[1] || '').split('/').filter(Boolean);
  const [kopf = 'start', ...rest] = segmente;
  if (!ORDNER[kopf]) return null;
  let relativ = rest.join('/');
  if (!relativ) { if (!MIT_STARTSEITE.has(kopf)) return null; relativ = 'index.html'; }
  const wurzel = path.join(ROOT, ORDNER[kopf]);
  const ziel = path.resolve(wurzel, relativ);
  if (!ziel.startsWith(wurzel + path.sep)) return null;
  return ziel;
}
// Chromium-Pfad: PLAYWRIGHT_CHROMIUM oder die von Playwright verwaltete Installation.
const EXE = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

export async function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Die Anwendungen verweisen auf ihre Dateien unter `/app/…` – so liefert
    // sie der geschützte Route Handler der Next.js-Hülle aus. Der Testserver
    // bildet dieselben Adressen auf dieselben Ordner ab.
    const p = dateiZuPfad(decodeURIComponent(url.pathname));
    // jsPDF vom CDN lokal stubben, damit Tests offline laufen.
    if (url.pathname === '/__jspdf.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'jspdf-stub.js')));
      return;
    }
    // Webschriften ebenso: offline gäbe es sonst Konsolenfehler, die nichts
    // mit der App zu tun haben. Im Browser greifen dann die Ersatzschriften.
    if (url.pathname === '/__fonts.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('/* Testlauf ohne Webschriften */');
      return;
    }
    if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end('nf'); return; }
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
  return { server, port: server.address().port };
}

export async function open({ width = 1280, height = 900 } = {}) {
  const { server, port } = await serve();
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.addInitScript(() => localStorage.setItem('av_deviceMode', 'ipad'));
  // Die 2D-Aufmaß-App ist eine eigene Seite; die Zeichnung liegt auf #/zeichnung.
  await page.goto(`http://127.0.0.1:${port}/app/aufmass-2d#/zeichnung`);
  await page.waitForFunction(() => document.body.dataset.modul === '2d' && !!document.getElementById('planSvg')
    && typeof ZweiDModul !== 'undefined' && !document.getElementById('td-zeichnung').classList.contains('hidden'));
  return {
    page, logs,
    async close() { await browser.close(); server.close(); }
  };
}

/** Öffnet die Aufmaß-App (eigene Seite /app/aufmass) mit leerem Speicher. */
export async function openAufmass({ width = 1280, height = 900 } = {}) {
  const { server, port } = await serve();
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/app/aufmass`);
  await page.waitForFunction(() => document.body.dataset.modul === 'aufmass'
    && !!document.getElementById('projectGrid') && typeof window.jspdf !== 'undefined');
  return {
    page, logs,
    async close() { await browser.close(); server.close(); }
  };
}

/** Baut n Felder als gerade Wand über die App-eigenen Funktionen auf. */
export async function seedFields(page, n) {
  await page.evaluate(count => {
    state.sections = [];
    _sId = 0; _bId = 0;
    for (let i = 0; i < count; i++) {
      const s = mkSection('E', i * 257, 0);
      setSectionAngle(s, 0);
      s.bays.push(mkBay(2.57));
      state.sections.push(s);
    }
    renderAll();
  }, n);
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}
