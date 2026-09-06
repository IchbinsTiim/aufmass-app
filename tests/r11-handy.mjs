// Runde 11 – Handy-Fassung:
// Erkennung, Navigationsleiste unten statt Umschalter-Pille oben,
// Sprungleiste und faltbare Karten in der Projektakte, feste Aktionsleiste
// mit DENSELBEN Knöpfen, Rückweg auf breite Bildschirme – und auf jeder
// Handy-Größe: kein Querlauf, nichts abgeschnitten, nichts zu klein.
//
// Der Nachweis lautet nicht „sieht anders aus", sondern „nichts ist weg":
// jede Prüfung unten bedient eine Funktion, die es vorher schon gab.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assert } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'aufmass_final_app');
const STUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'jspdf-stub.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const EXE  = process.env.PLAYWRIGHT_CHROMIUM || undefined;

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

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const alleFehler = [];

/** Ein Projekt mit zwei Hausseiten – über die Oberfläche angelegt, damit
 *  geprüft wird, was der Nutzer auch bekommt. */
const SEED = `(() => {
  const seite = (nm) => ({ id: 's_' + nm, name: nm, notiz: '', wandabstand: '0.30', wdvs: false,
    abschnitte: [{ id: 'a_' + nm, bezeichnung: 'Abschnitt 1', einzelfeld: false, messungen: [
      { id: 'm1_' + nm, laenge: 12.85, laengeZuschlag: null, hoehe: 10.2, hoeheZuschlag: null },
      { id: 'm2_' + nm, laenge: 7.71,  laengeZuschlag: null, hoehe: 8.2,  hoeheZuschlag: null }] }],
    konsolen: [], zubehoer: {} });
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([{
    id: 'p1', name: 'Wohnhaus Musterstraße', status: 'in_bearbeitung', folderId: null,
    erstellt: '2026-08-01', geaendert: '2026-09-02',
    anschrift: { strasse: 'Musterstraße', nummer: '12', plz: '70173', ort: 'Stuttgart',
                 bauherr: 'Muster GmbH', telefon: '0170 1234567' },
    geruesttyp: 'fassade', geruesttypName: '', seiten: [seite('Nordseite'), seite('Ostseite')],
    technik: { lastklasse: '3', breitenklasse: 'W06' }, logistik: {},
    zusatzpositionen: [], zeichnung2d: null
  }]));
  localStorage.setItem('geruest.aufmass.letztesBackup', String(Date.now()));
  localStorage.setItem('geruest.app.aktuellesProjekt', 'p1');
})()`;

async function seite(w, h, hash) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 900 });
  page.on('pageerror', e => alleFehler.push(`${w}x${h}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) alleFehler.push(`${w}x${h}: ${m.text()}`); });
  await page.addInitScript(SEED);
  await page.goto(URL_(hash));
  await page.waitForFunction(() => !!document.body.dataset.handy);
  await page.waitForTimeout(250);
  return page;
}

/** Öffnet die Projektakte über die Projektkarte – wie auf der Baustelle. */
async function oeffneAkte(page) {
  await page.evaluate(() => document.querySelector('#projectGrid .project-card2, #projectGrid > *')?.click());
  await page.waitForFunction(() => !document.getElementById('projectScreen').classList.contains('hidden'));
  await page.waitForTimeout(250);
}


// ══════════════════════════════════════════════════════════════════════════
//  1  Erkennung: Handy an, Tablet/Desktop unverändert
// ══════════════════════════════════════════════════════════════════════════
console.log('\nErkennung\n');
{
  const handy = await seite(390, 844, '#/aufmass');
  assert(await handy.evaluate(() => document.body.dataset.handy) === '1',
    'Smartphone hoch (390×844) läuft in der Handy-Fassung');
  assert(await handy.evaluate(() => !!document.getElementById('handyNav')),
    'die Navigationsleiste unten ist vorhanden');
  assert(await handy.evaluate(() => getComputedStyle(document.getElementById('modSwitcher')).display) === 'none',
    'die Umschalter-Pille tritt dafür zurück – zwei Umschalter wären einer zu viel');
  await handy.close();

  const quer = await seite(844, 390, '#/aufmass');
  assert(await quer.evaluate(() => document.body.dataset.handy) === '1',
    'liegendes Handy (844×390) ebenfalls – erkannt über die Höhe');
  await quer.close();

  const desktop = await seite(1280, 900, '#/aufmass');
  assert(await desktop.evaluate(() => document.body.dataset.handy) === '0',
    'Desktop (1280×900) bleibt unverändert');
  assert(await desktop.evaluate(() => getComputedStyle(document.getElementById('handyNav')).display) === 'none',
    'dort steht keine Navigationsleiste unten');
  assert(await desktop.evaluate(() => getComputedStyle(document.getElementById('modSwitcher')).display) !== 'none',
    'die Umschalter-Pille ist dort weiterhin da');
  await desktop.close();

  const tablet = await seite(820, 1180, '#/aufmass');
  assert(await tablet.evaluate(() => document.body.dataset.handy) === '0',
    'iPad hoch (820×1180) bleibt die bisherige Fassung');
  await tablet.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  2  Navigationsleiste: dieselben drei Ziele, mit dem Daumen erreichbar
// ══════════════════════════════════════════════════════════════════════════
console.log('\nNavigationsleiste\n');
{
  const page = await seite(390, 844, '#/');
  const nav = await page.evaluate(() => [...document.querySelectorAll('#handyNav a')].map(a => ({
    ziel: a.dataset.ziel, href: a.getAttribute('href'),
    hoch: Math.round(a.getBoundingClientRect().height),
    breit: Math.round(a.getBoundingClientRect().width),
    unten: Math.round(window.innerHeight - a.getBoundingClientRect().bottom)
  })));
  assert(nav.length === 3, 'drei Ziele: Start, Aufmaß, 2D');
  assert(nav.map(n => n.ziel).join(',') === 'hub,aufmass,2d', 'in der gewohnten Reihenfolge');
  assert(nav.every(n => n.hoch >= 44 && n.breit >= 44),
    'jedes Ziel erreicht 44 px Trefferfläche: ' + JSON.stringify(nav.map(n => n.hoch + 'x' + n.breit)));
  assert(nav.every(n => n.unten <= 1), 'die Leiste sitzt am unteren Rand – dort liegt der Daumen');
  assert(await page.evaluate(() => document.querySelector('#handyNav a[data-ziel="hub"]').getAttribute('aria-current')) === 'page',
    'das aktive Ziel ist markiert');

  // Umschalten führt wirklich ins Modul – es ist derselbe Hash-Router.
  await page.click('#handyNav a[data-ziel="2d"]');
  await page.waitForFunction(() => document.body.dataset.modul === '2d');
  await page.waitForTimeout(300);
  assert(true, 'Antippen von „2D" wechselt in das 2D-Modul');

  /* In der Zeichnung tritt die Leiste ab – dort zählt jeder Millimeter.
     Der Rückweg ist der Pfeil oben links, derselbe wie bisher. */
  const rueck = await page.evaluate(() => {
    const nav = getComputedStyle(document.getElementById('handyNav')).display;
    const a = document.querySelector('#toolbar .back-link');
    const r = a.getBoundingClientRect();
    return { nav, ziel: a.getAttribute('href'), hoch: Math.round(r.height), breit: Math.round(r.width) };
  });
  assert(rueck.nav === 'none', 'in der Zeichnung selbst tritt die Leiste zurück');
  assert(/^#\//.test(rueck.ziel) && rueck.hoch >= 40 && rueck.breit >= 40,
    `der Rückweg ist der Pfeil oben links (${rueck.breit}×${rueck.hoch} px → ${rueck.ziel}); `
    + 'er führt dorthin zurück, wo die Zeichnung geöffnet wurde');

  await page.click('#toolbar .back-link');
  await page.waitForFunction(() => document.body.dataset.modul !== '2d');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => getComputedStyle(document.getElementById('handyNav')).display) === 'flex',
    'außerhalb der Zeichnung steht die Leiste sofort wieder da');

  await page.click('#handyNav a[data-ziel="aufmass"]');
  await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
  assert(await page.evaluate(() => document.querySelector('#handyNav a[data-ziel="aufmass"]').getAttribute('aria-current')) === 'page',
    'und führt zurück ins Aufmaß, markiert als aktives Ziel');
  await page.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  3  Projektakte: Sprungleiste, Faltkarten, Aktionsleiste
// ══════════════════════════════════════════════════════════════════════════
console.log('\nProjektakte\n');
{
  const page = await seite(390, 844, '#/aufmass');
  await oeffneAkte(page);

  const marken = await page.evaluate(() =>
    [...document.querySelectorAll('#handySprung .handy-sprung-btn')].map(b => b.textContent));
  assert(marken.length >= 9,
    `die Sprungleiste führt alle ${marken.length} Abschnitte der Akte: ${marken.join(' · ')}`);
  assert(marken.includes('Seiten') && marken.includes('Positionen') && marken.includes('Summe'),
    'Seiten, Positionen und Zusammenfassung sind ohne Scrollen erreichbar');

  // Karten bleiben faltbar – nichts ist entfernt, nur eingeklappt.
  const anschriftZu = await page.evaluate(() => {
    const c = document.querySelector('#projectScreen .card[data-handy-karte="Adresse"]');
    return { falt: c.dataset.falt, feldSichtbar: !!document.getElementById('fieldStrasse').offsetParent };
  });
  assert(anschriftZu.falt === 'zu' && !anschriftZu.feldSichtbar,
    'selten gebrauchte Karten starten eingeklappt (》Adresse《)');

  await page.evaluate(() =>
    [...document.querySelectorAll('#handySprung .handy-sprung-btn')].find(b => b.textContent === 'Adresse').click());
  await page.waitForTimeout(400);
  const anschriftAuf = await page.evaluate(() => {
    const el = document.getElementById('fieldStrasse');
    return { sichtbar: !!el.offsetParent, wert: el.value };
  });
  assert(anschriftAuf.sichtbar, 'der Sprung klappt das Ziel auf – das Feld ist da');
  assert(anschriftAuf.wert === 'Musterstraße', 'und trägt unverändert seinen Inhalt');

  // Eingeben funktioniert wie bisher.
  await page.fill('#fieldStrasse', 'Bahnhofstraße');
  assert(await page.inputValue('#fieldStrasse') === 'Bahnhofstraße', 'Eingaben in der aufgeklappten Karte greifen');

  // Aktionsleiste: DIESELBEN Knöpfe, nur an einem erreichbaren Ort.
  const leiste = await page.evaluate(() => ({
    speichern: document.getElementById('saveProjectBtn').closest('#handyAktionen') !== null,
    pdf:       document.getElementById('exportPdfBtn').closest('#handyAktionen') !== null,
    einmalig:  document.querySelectorAll('#saveProjectBtn').length === 1
            && document.querySelectorAll('#exportPdfBtn').length === 1,
    unten:     Math.round(window.innerHeight - document.getElementById('handyAktionen').getBoundingClientRect().bottom),
    hoch:      Math.round(document.getElementById('saveProjectBtn').getBoundingClientRect().height)
  }));
  assert(leiste.speichern && leiste.pdf, '》Speichern《 und 》PDF erstellen《 stehen in der festen Leiste unten');
  assert(leiste.einmalig, 'es sind dieselben Knöpfe – kein zweites Speichern, kein zweites PDF');
  assert(leiste.unten <= 1 && leiste.hoch >= 44, 'sie sitzen am Rand und sind 44 px hoch');

  // Speichern schreibt wirklich – der umgezogene Knopf trägt sein Ereignis mit.
  await page.click('#saveProjectBtn');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('geruest.aufmass.projekte'))[0].anschrift.strasse) === 'Bahnhofstraße',
    'Speichern über die Leiste schreibt den geänderten Wert weg');

  // Nebenaktionen: JSON bleibt erreichbar, ohne 6 000 px zu scrollen.
  await page.click('#handyAktionen .handy-mehr-btn');
  await page.waitForTimeout(250);
  assert(await page.evaluate(() => !!document.getElementById('exportJsonBtn').offsetParent
                               && !!document.getElementById('importJsonBtn').offsetParent),
    '》⋯《 zeigt JSON exportieren und JSON laden');

  // Die Faltung wird gemerkt.
  await page.reload();
  await page.waitForFunction(() => !!document.body.dataset.handy);
  await page.waitForTimeout(400);
  await oeffneAkte(page);
  assert(await page.evaluate(() =>
    document.querySelector('#projectScreen .card[data-handy-karte="Adresse"]').dataset.falt) === 'auf',
    'die aufgeklappte Karte ist auch nach dem Neuladen offen');
  await page.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  4  Rückweg: auf breiten Bildschirmen steht alles wieder an seinem Platz
// ══════════════════════════════════════════════════════════════════════════
console.log('\nRückweg\n');
{
  const page = await seite(390, 844, '#/aufmass');
  await oeffneAkte(page);
  assert(await page.evaluate(() => document.getElementById('saveProjectBtn').closest('#handyAktionen') !== null),
    'am Handy steht 》Speichern《 in der Leiste');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.body.dataset.handy === '0');
  await page.waitForTimeout(250);
  const zurueck = await page.evaluate(() => ({
    heim:     document.getElementById('saveProjectBtn').closest('.action-buttons') !== null
           && document.getElementById('exportPdfBtn').closest('.action-buttons') !== null,
    json:     document.getElementById('exportJsonBtn').closest('.action-buttons-secondary') !== null
           && document.getElementById('importJsonBtn').closest('.action-buttons-secondary') !== null,
    reihe:    [...document.querySelectorAll('.action-buttons .btn')].map(b => b.id).join(','),
    sichtbar: [...document.querySelectorAll('#projectScreen .card')].every(c => c.dataset.falt !== 'zu'
                || getComputedStyle(c.children[1] || c).display !== 'none')
  }));
  assert(zurueck.heim, 'auf dem Desktop stehen beide Knöpfe wieder in der Aktionskarte');
  assert(zurueck.reihe === 'saveProjectBtn,exportPdfBtn', 'und in der ursprünglichen Reihenfolge');
  assert(zurueck.json, 'die JSON-Knöpfe ebenso');
  assert(await page.evaluate(() => !!document.getElementById('fieldStrasse').offsetParent),
    'die Faltung gilt nur am Handy – auf dem Desktop ist jede Karte offen');
  await page.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  5  Bildschirme: kein Querlauf, nichts abgeschnitten, nichts zu klein
// ══════════════════════════════════════════════════════════════════════════
console.log('\nBildschirme\n');

/* Wischbare Leisten (Ordner, Sprungmarken) laufen absichtlich über den Rand
   hinaus – sie werden gewischt, nicht gequetscht. Sie sind hier ausgenommen. */
const MESSUNG = `(() => {
  const vw = window.innerWidth;
  const wisch = (el) => !!el.closest('#handySprung, .folder-bar, #tdFolderBar, .handy-wischleiste, #handyNav');
  const raus = [], klein = [];
  document.querySelectorAll('button, input, select, textarea, a.btn').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !el.offsetParent) return;
    if (wisch(el)) return;
    if (r.right > vw + 1 || r.left < -1) raus.push((el.id || el.className || '').slice(0, 30) + ' @' + Math.round(r.right));
    if (r.height < 40 || r.width < 32)   klein.push((el.id || el.className || '').slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return { quer: document.documentElement.scrollWidth > vw + 1, raus, klein };
})()`;

for (const [name, w, h] of [['Smartphone hoch', 390, 844], ['Android schmal', 360, 780], ['kleines Smartphone', 320, 568]]) {
  // Hub
  let page = await seite(w, h, '#/');
  let m = await page.evaluate(MESSUNG);
  assert(!m.quer && m.raus.length === 0 && m.klein.length === 0,
    `${name} · Startbildschirm: kein Querlauf, nichts abgeschnitten, nichts unter 40 px ${JSON.stringify(m.raus.concat(m.klein).slice(0, 3))}`);
  await page.close();

  // Aufmaß-Übersicht
  page = await seite(w, h, '#/aufmass');
  m = await page.evaluate(MESSUNG);
  assert(!m.quer && m.raus.length === 0 && m.klein.length === 0,
    `${name} · Projektübersicht: sauber ${JSON.stringify(m.raus.concat(m.klein).slice(0, 3))}`);

  // Projektakte – ALLES aufgeklappt: die Faltung darf keinen Fehler verstecken.
  await oeffneAkte(page);
  await page.evaluate(() => document.querySelectorAll('#projectScreen .card[data-falt]').forEach(c => c.dataset.falt = 'auf'));
  await page.waitForTimeout(250);
  m = await page.evaluate(MESSUNG);
  assert(!m.quer, `${name} · Projektakte: die Seite läuft nicht seitlich aus dem Bild`);
  assert(m.raus.length === 0, `${name} · Projektakte: kein Bedienelement außerhalb des Bildschirms ${JSON.stringify(m.raus.slice(0, 4))}`);
  assert(m.klein.length === 0, `${name} · Projektakte: kein Bedienelement unter 40 px ${JSON.stringify(m.klein.slice(0, 4))}`);
  await page.close();

  // 2D-Zeichnungsübersicht
  page = await seite(w, h, '#/2d/projekte');
  m = await page.evaluate(MESSUNG);
  assert(!m.quer && m.raus.length === 0 && m.klein.length === 0,
    `${name} · Zeichnungsübersicht: sauber ${JSON.stringify(m.raus.concat(m.klein).slice(0, 3))}`);
  await page.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  6  Zeichnung: die Fläche gewinnt die Zeile zurück, die die Pille kostete
// ══════════════════════════════════════════════════════════════════════════
console.log('\nZeichenfläche\n');
{
  const page = await seite(390, 844, '#/2d');
  await page.waitForSelector('#planSvg');
  await page.waitForTimeout(400);
  const z = await page.evaluate(() => ({
    modul:   document.body.dataset.modul,
    nav:     getComputedStyle(document.getElementById('handyNav')).display,
    tbOben:  Math.round(document.getElementById('toolbar').getBoundingClientRect().top),
    flaeche: Math.round(document.getElementById('viewerPanel').getBoundingClientRect().height)
  }));
  assert(z.modul === '2d', 'die Zeichnung ist offen');
  assert(z.nav === 'none', 'in der Zeichnung steht keine Navigationsleiste – jeder Millimeter gehört dem Plan');
  assert(z.tbOben <= 2, `die Werkzeugleiste beginnt am oberen Rand (${z.tbOben} px)`);
  assert(z.flaeche >= 600, `die Zeichenfläche misst ${z.flaeche} px auf einem 844-px-Gerät`);

  // Das Werkzeug-Menü des 2D-Moduls bleibt unangetastet und bedienbar.
  await page.click('#werkzeugBtn');
  await page.waitForSelector('#werkzeugPanel.offen');
  const frei = await page.evaluate(() => {
    const vp = document.getElementById('viewerPanel').getBoundingClientRect();
    const pr = document.getElementById('werkzeugPanel').getBoundingClientRect();
    return Math.round(pr.left >= vp.right - 1 ? vp.height : Math.max(0, pr.top - vp.top));
  });
  assert(frei >= 140, `bei offenem Werkzeug-Menü bleiben ${frei} px Zeichenfläche frei`);
  await page.close();
}


// ══════════════════════════════════════════════════════════════════════════
//  7  Keine Fehler in der Konsole
// ══════════════════════════════════════════════════════════════════════════
console.log('');
assert(alleFehler.length === 0, 'keine JS-Fehler über alle Bildschirme hinweg: ' + alleFehler.slice(0, 3).join(' | '));

console.log('\nAlle Tests zur Handy-Fassung bestanden.');
await browser.close();
server.close();
