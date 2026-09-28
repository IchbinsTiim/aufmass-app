// Runde 7 (neu gefasst) – Trennung der beiden Anwendungen.
//
// Früher lagen Aufmaß und 2D-Aufmaß als zwei Module in EINEM Dokument
// (Hash-Routing #/aufmass, #/2d) und teilten sich Projekte und Ordner. Jetzt:
//
//   /app               Startseite – verlinkt nur, liest keine Daten
//   /app/aufmass       Aufmaß-App      (Ordner aufmass/)
//   /app/aufmass-2d    2D-Aufmaß-App   (Ordner aufmass-2d/)
//   /app/shared/…      nur Design-Tokens und die einmalige Speicher-Migration
//
// Geprüft wird: getrennte Dateien, getrennte Globale, getrennte Speicher,
// verlustfreie Übernahme des Altbestands, Weiterleitung alter Adressen,
// Navigation innerhalb der 2D-App, Bedienbarkeit.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve, assert } from './harness.mjs';

const WURZEL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { server, port } = await serve();
const URL_ = p => `http://127.0.0.1:${port}${p}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const logs = [];
async function neueSeite() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  return page;
}
const warteAufmass = p => p.waitForFunction(() => document.body.dataset.modul === 'aufmass'
  && typeof AufmassModul !== 'undefined' && !!document.getElementById('projectGrid'));
const warte2d = p => p.waitForFunction(() => document.body.dataset.modul === '2d'
  && typeof ZweiDModul !== 'undefined' && !!document.getElementById('planSvg'));

console.log('RUNDE 7 – Trennung von Aufmaß und 2D-Aufmaß\n');

// ── 1. Dateien: jede App hat ihren eigenen Ordner ─────────────────────────
console.log('1 · Ordner und Dateien\n');
const liste = ordner => fs.readdirSync(path.join(WURZEL, ordner));
assert(!fs.existsSync(path.join(WURZEL, 'legacy-app')), 'den gemeinsamen Ordner legacy-app gibt es nicht mehr');
for (const o of ['aufmass', 'aufmass-2d', 'start', 'shared']) {
  assert(fs.existsSync(path.join(WURZEL, o)), `Ordner /${o} vorhanden (${liste(o).join(', ')})`);
}
assert(['index.html', 'script.js', 'style.css', 'cloud.js', 'basis.js'].every(d => liste('aufmass').includes(d)),
  '/aufmass enthält Seite, Code, Styles, Cloud-Abgleich und Basis');
assert(['index.html', 'viewer2d.js', 'viewer2d.css', 'cloud.js', 'basis.js', 'navigation.js']
  .every(d => liste('aufmass-2d').includes(d)), '/aufmass-2d enthält Seite, Code, Styles, Cloud-Abgleich und Basis');
assert(liste('shared').sort().join() === 'speicher-migration.js,tokens.css',
  '/shared enthält nur Design-Tokens und die einmalige Speicher-Migration');

const inhalt = datei => fs.readFileSync(path.join(WURZEL, datei), 'utf8');
const dateienVon = o => liste(o).filter(d => /\.(js|css|html)$/.test(d)).map(d => o + '/' + d);
const fremdeVerweise = (o, muster) => dateienVon(o).filter(d => muster.test(inhalt(d)));
const verweiseAm = fremdeVerweise('aufmass', /\/app\/aufmass-2d\/|geruest\.2d\.|ZweiDModul|zeichnung2d/);
assert(verweiseAm.join() === '', 'kein Code, kein Speicherschlüssel und keine Datei der 2D-App in /aufmass ' + verweiseAm.join());
const verweise2d = fremdeVerweise('aufmass-2d', /\/app\/aufmass\/|geruest\.aufmass\.|AufmassModul|collectSeiten/);
assert(verweise2d.join() === '', 'kein Code, kein Speicherschlüssel und keine Datei der Aufmaß-App in /aufmass-2d ' + verweise2d.join());
const startVerweise = fremdeVerweise('start', /geruest\.|localStorage|<script src="\/app\/(aufmass|shared)/);
assert(startVerweise.join() === '', 'die Startseite liest keine Daten und lädt keinen App-Code ' + startVerweise.join());

// ── 2. Übernahme des Altbestands ──────────────────────────────────────────
console.log('\n2 · Übernahme des früheren gemeinsamen Speichers\n');
const altbestand = () => {
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([
    { id: 'p-mit', name: 'Mit Zeichnung', status: 'in_bearbeitung', folderId: 'f1',
      erstellt: '2026-02-01', geaendert: '2026-02-03',
      anschrift: { strasse: 'Hauptstraße', nummer: '5', plz: '70173', ort: 'Stuttgart' },
      geruesttyp: 'fassade', seiten: [{ id: 's1', name: 'Nord', abschnitte: [] }],
      technik: {}, logistik: {}, zusatzpositionen: [],
      zeichnung2d: {
        depth: 1.09,
        sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
                     bays: [{ id: 1, len: 2.57, hL: 6, hR: 6, positions: [{ id: 3, cat: 'netz', qty: null, unit: 'm2' }] },
                            { id: 2, len: 2.57, hL: 6, hR: 6, positions: [] }] }],
        abschnitte: [], ecken: {}, _sId: 1, _bId: 3
      },
      _cloud: { revision: 4, rolle: 'owner', eigenes: true, dirty: false } },
    { id: 'p-ohne', name: 'Nur Aufmaß', status: 'abgeschlossen', folderId: null,
      erstellt: '2026-02-01', geaendert: '2026-02-01', anschrift: {}, geruesttyp: 'fassade',
      seiten: [], technik: {}, logistik: {}, zusatzpositionen: [], zeichnung2d: null }
  ]));
  localStorage.setItem('geruest.aufmass.ordner', JSON.stringify([{ id: 'f1', name: 'Baustellen 2026' }]));
  localStorage.setItem('geruest.app.aktuellesProjekt', 'p-mit');
  localStorage.setItem('av_2d_pdf_theme', 'kontrast');
  localStorage.setItem('aufmass_ueberstand_wert', '3');
};
let page = await neueSeite();
await page.goto(URL_('/app'));
await page.evaluate(altbestand);
await page.goto(URL_('/app/aufmass'));
await warteAufmass(page);

const nachMigration = () => page.evaluate(() => ({
  aufmass: JSON.parse(localStorage.getItem('geruest.aufmass.projekte')),
  zeichnungen: JSON.parse(localStorage.getItem('geruest.2d.zeichnungen') || '[]'),
  zOrdner: JSON.parse(localStorage.getItem('geruest.2d.ordner') || '[]'),
  aOrdner: JSON.parse(localStorage.getItem('geruest.aufmass.ordner') || '[]'),
  aktAufmass: localStorage.getItem('geruest.aufmass.aktuellesProjekt'),
  aktZeichnung: localStorage.getItem('geruest.2d.aktuelleZeichnung'),
  altGemeinsam: localStorage.getItem('geruest.app.aktuellesProjekt'),
  pdfDesign: localStorage.getItem('geruest.2d.pdfDesign'),
  ueberstand: localStorage.getItem('geruest.aufmass.ueberstandWert'),
  altWeg: localStorage.getItem('av_2d_pdf_theme') === null && localStorage.getItem('aufmass_ueberstand_wert') === null
}));
let m = await nachMigration();
assert(m.aufmass.length === 2 && m.aufmass.every(p => !('zeichnung2d' in p)),
  'Aufmaß-Projekte bleiben vollständig – aber ohne Zeichnung');
assert(m.aufmass[0].seiten.length === 1 && m.aufmass[0].anschrift.ort === 'Stuttgart',
  'Aufmaß-Inhalt (Seiten, Anschrift) unverändert');
assert(m.zeichnungen.length === 1 && m.zeichnungen[0].id === 'z2d_p-mit',
  'die Zeichnung ist ein eigener Datensatz der 2D-App (z2d_p-mit) – ein Projekt ohne Zeichnung erzeugt keinen');
const z = m.zeichnungen[0];
assert(z.zeichnung2d.depth === 1.09 && z.zeichnung2d.sections[0].bays.length === 2
  && z.zeichnung2d.sections[0].bays[0].positions[0].cat === 'netz',
  'Zeichnung verlustfrei übernommen (Gerüsttiefe, Felder, Positionen)');
assert(z.name === 'Mit Zeichnung' && z.anschrift.ort === 'Stuttgart' && z.folderId === 'z2d_f1',
  'Name, Anschrift (PDF-Kopf) und Ordner kommen mit');
assert(m.zOrdner.length === 1 && m.zOrdner[0].id === 'z2d_f1' && m.zOrdner[0].name === 'Baustellen 2026'
  && m.aOrdner.length === 1 && m.aOrdner[0].id === 'f1',
  'der Ordner existiert jetzt zweimal – je App ein eigener Datensatz');
assert(z._cloud && z._cloud.revision === null && z._cloud.dirty === false && z._cloud.uebernommen,
  'Cloud-Stand: sauber übernommen, wartet auf die Cloud-Kopie derselben Kennung (keine Doppelung)');
assert(m.aktAufmass === 'p-mit' && m.aktZeichnung === 'z2d_p-mit' && m.altGemeinsam === null,
  '„zuletzt geöffnet" gehört jetzt jeder App selbst');
assert(m.pdfDesign === 'kontrast' && m.ueberstand === '3' && m.altWeg,
  'Schlüssel aus der Zeit vor der Zusammenführung werden weiterhin übernommen');

// Wiederholbar: kein zweiter Datensatz, und eine gelöschte Zeichnung bleibt gelöscht
await page.reload(); await warteAufmass(page);
m = await nachMigration();
assert(m.zeichnungen.length === 1, 'erneutes Laden legt nichts doppelt an');
await page.evaluate(() => {
  localStorage.setItem('geruest.2d.zeichnungen', '[]');
  // Ein altes Gerät spielt die Zeichnung noch einmal ins Aufmaß-Projekt zurück.
  const liste = JSON.parse(localStorage.getItem('geruest.aufmass.projekte'));
  liste[0].zeichnung2d = { depth: 0.73, sections: [], abschnitte: [] };
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify(liste));
});
await page.reload(); await warteAufmass(page);
m = await nachMigration();
assert(m.zeichnungen.length === 0 && m.aufmass.every(p => !('zeichnung2d' in p)),
  'eine in der 2D-App gelöschte Zeichnung wird nicht wieder angelegt');

// ── 3. Startseite: nur Verweise ───────────────────────────────────────────
console.log('\n3 · Startseite\n');
await page.goto(URL_('/app'));
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
const hub = await page.evaluate(() => ({
  kacheln: [...document.querySelectorAll('.hub-tile')].map(k => k.getAttribute('href')),
  umschalter: [...document.querySelectorAll('#modSwitcher a')].map(a => a.getAttribute('href')),
  skripte: [...document.scripts].map(s => s.getAttribute('src')).filter(Boolean),
  styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')),
  // `const` auf oberster Ebene hängt nicht an window – deshalb über typeof.
  globale: ['AufmassModul', 'ZweiDModul', 'CloudSpeicher', 'GK', 'state']
    .filter(n => (0, eval)('typeof ' + n) !== 'undefined')
}));
assert(hub.kacheln.join() === '/app/aufmass,/app/aufmass-2d', 'zwei Kacheln → zwei getrennte Anwendungen');
assert(hub.umschalter.join() === '/app,/app/aufmass,/app/aufmass-2d', 'der Umschalter verlinkt nur');
assert(hub.skripte.length === 1 && /^\/app\/start\/start\.js/.test(hub.skripte[0]),
  'die Startseite lädt keinen App-Code: ' + hub.skripte.join());
assert(hub.styles.every(s => /^\/app\/(shared\/tokens|start\/start)\.css|fonts/.test(s)),
  'die Startseite lädt nur Tokens und ihr eigenes Stylesheet');
assert(hub.globale.length === 0, 'keine Globalen der Anwendungen auf der Startseite');

await page.click('.hub-tile[data-ziel="aufmass"]');
await warteAufmass(page);
assert(new URL(page.url()).pathname === '/app/aufmass', 'Kachel 1 öffnet /app/aufmass');
await page.goto(URL_('/app'));
await page.click('.hub-tile[data-ziel="2d"]');
await warte2d(page);
assert(new URL(page.url()).pathname === '/app/aufmass-2d', 'Kachel 2 öffnet /app/aufmass-2d');
assert(await page.evaluate(() => location.hash) === '#/projekte', '… beginnend in der Zeichnungsübersicht');

// Alte Adressen
for (const [alt, pfad, hash] of [
  ['/app#/aufmass', '/app/aufmass', ''],
  ['/app#/2d', '/app/aufmass-2d', '#/zeichnung'],
  ['/app#/2d/projekte', '/app/aufmass-2d', '#/projekte'],
  ['/app?resume=1', '/app/aufmass', '']
]) {
  // Wie ein Lesezeichen: frisch geöffnet, nicht aus der Startseite heraus.
  await page.goto('about:blank');
  await page.goto(URL_(alt));
  await page.waitForURL(u => u.pathname === pfad);
  await page.waitForFunction(() => document.body.dataset.modul !== 'hub');
  const u = new URL(page.url());
  assert(u.pathname === pfad && (!hash || u.hash === hash), `alte Adresse ${alt} → ${pfad}${hash}`);
}

// ── 4. Getrennte Dokumente, getrennte Globale ─────────────────────────────
console.log('\n4 · Getrennte Dokumente\n');
await page.goto(URL_('/app/aufmass'));
await warteAufmass(page);
const am = await page.evaluate(() => ({
  fremd: ['ZweiDModul', 'KONSOLE_TYPES_2D', 'state', 'renderSvg', 'Navigation2d', 'Shell']
    .filter(n => (0, eval)('typeof ' + n) !== 'undefined'),
  eigen: ['AufmassModul', 'KONSOLE_TYPES', 'collectSeiten', 'CloudSpeicher']
    .every(n => (0, eval)('typeof ' + n) !== 'undefined'),
  gk: Object.values(GK).every(k => k.startsWith('geruest.aufmass.')),
  quellen: performance.getEntriesByType('resource').map(r => new URL(r.name).pathname)
    .filter(p => p.startsWith('/app/')),
  td: !!document.getElementById('td-root'),
  pdf: !!document.querySelector('#am-root #exportPdfBtn'),
  karte2d: !!document.getElementById('open2dBtn')
}));
assert(am.fremd.length === 0, 'Aufmaß-Seite: keine 2D-Globalen ' + am.fremd.join());
assert(am.eigen && am.gk, 'Aufmaß-Seite: eigene Module und nur geruest.aufmass.*-Schlüssel');
assert(am.quellen.every(p => /^\/app\/(aufmass|shared)\//.test(p)),
  'Aufmaß-Seite lädt nur Dateien aus /aufmass und /shared');
assert(!am.td && am.pdf && !am.karte2d, 'kein 2D-Markup im Aufmaß-Dokument, eigener PDF-Knopf');

await page.goto(URL_('/app/aufmass-2d'));
await warte2d(page);
const zd = await page.evaluate(() => ({
  fremd: ['AufmassModul', 'KONSOLE_TYPES', 'collectSeiten', 'Shell']
    .filter(n => (0, eval)('typeof ' + n) !== 'undefined'),
  eigen: ['ZweiDModul', 'KONSOLE_TYPES_2D', 'Navigation2d', 'CloudSpeicher']
    .every(n => (0, eval)('typeof ' + n) !== 'undefined'),
  gk: Object.values(GK).every(k => k.startsWith('geruest.2d.')),
  quellen: performance.getEntriesByType('resource').map(r => new URL(r.name).pathname)
    .filter(p => p.startsWith('/app/')),
  am: !!document.getElementById('am-root')
}));
assert(zd.fremd.length === 0, '2D-Seite: keine Aufmaß-Globalen ' + zd.fremd.join());
assert(zd.eigen && zd.gk, '2D-Seite: eigene Module und nur geruest.2d.*-Schlüssel');
assert(zd.quellen.every(p => /^\/app\/(aufmass-2d|shared)\//.test(p)),
  '2D-Seite lädt nur Dateien aus /aufmass-2d und /shared');
assert(!zd.am, 'kein Aufmaß-Markup im 2D-Dokument');

// Doppelte IDs – je Dokument
for (const [pfad, warten] of [['/app/aufmass', warteAufmass], ['/app/aufmass-2d', warte2d]]) {
  await page.goto(URL_(pfad)); await warten(page);
  const doppelt = await page.evaluate(() => {
    const gesehen = new Set(), mehrfach = [];
    document.querySelectorAll('[id]').forEach(el => {
      if (gesehen.has(el.id)) mehrfach.push(el.id); else gesehen.add(el.id);
    });
    return mehrfach;
  });
  assert(doppelt.length === 0, `keine doppelt vergebene Element-ID (${pfad}) ` + JSON.stringify(doppelt));
}

// ── 5. Getrennte Daten ────────────────────────────────────────────────────
console.log('\n5 · Getrennte Daten\n');
await page.goto(URL_('/app/aufmass')); await warteAufmass(page);
await page.click('#newProjectBtn');
await page.waitForSelector('#projectScreen:not(.hidden)');
await page.fill('#fieldProjektname', 'Neu im Aufmaß');
await page.evaluate(() => AufmassModul.sichern());
await page.goto(URL_('/app/aufmass-2d')); await warte2d(page);
await page.waitForSelector('#td-projekte:not(.hidden)');
let zNamen = await page.$$eval('#tdProjectGrid .td-project-name', els => els.map(e => e.textContent));
assert(!zNamen.includes('Neu im Aufmaß') && !zNamen.includes('Nur Aufmaß'),
  'ein Aufmaß-Projekt erscheint nicht in der 2D-App');

await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Neu im 2D');
await page.click('#tdNeuAnlegen');
await page.waitForFunction(() => location.hash === '#/zeichnung');
const neu2d = await page.evaluate(() => JSON.parse(localStorage.getItem('geruest.2d.zeichnungen'))
  .find(z => z.name === 'Neu im 2D'));
assert(neu2d && /^z2d_/.test(neu2d.id) && !('seiten' in neu2d) && !('technik' in neu2d),
  'eine neue Zeichnung ist ein schlanker 2D-Datensatz (keine Aufmaß-Felder)');
await page.goto(URL_('/app/aufmass')); await warteAufmass(page);
const aNamen = await page.$$eval('#projectGrid .project-card2-name', els => els.map(e => e.textContent));
assert(aNamen.includes('Neu im Aufmaß') && !aNamen.includes('Neu im 2D'),
  'eine 2D-Zeichnung erscheint nicht in der Aufmaß-App');
const menue = await page.evaluate(() => {
  document.querySelector('.project-card2-menu-btn').click();
  const labels = [...document.querySelectorAll('.floating-menu-item')].map(b => b.textContent);
  closeFloatingMenu();
  return labels;
});
assert(!menue.some(l => /Öffnen mit/.test(l)), 'kein „Öffnen mit… 2D" mehr im Aufmaß');

// ── 6. Navigation in der 2D-App ───────────────────────────────────────────
console.log('\n6 · Navigation der 2D-App\n');
await page.goto(URL_('/app/aufmass-2d')); await warte2d(page);
await page.waitForSelector('#td-projekte:not(.hidden)');
await page.click('#tdProjectGrid .td-project-card');
await page.waitForFunction(() => location.hash === '#/zeichnung'
  && !document.getElementById('td-zeichnung').classList.contains('hidden'));
assert(true, 'Karte antippen öffnet die Zeichnung (#/zeichnung)');
// Sprung innerhalb der Startseite auf eine alte Adresse: ebenfalls weiter.
{
  const p2 = await neueSeite();
  await p2.goto(URL_('/app'));
  await p2.evaluate(() => { location.hash = '#/2d/projekte'; });
  await p2.waitForURL(u => u.pathname === '/app/aufmass-2d');
  await warte2d(p2);
  assert(await p2.evaluate(() => location.hash) === '#/projekte',
    'auch ein Hash-Sprung auf der Startseite (#/2d/projekte) führt in die 2D-App');
  await p2.close();
}
const zurueck = await page.evaluate(() => {
  const a = document.querySelector('#td-zeichnung .back-link');
  return { href: a.getAttribute('href'), label: a.getAttribute('aria-label') };
});
assert(zurueck.href === '#/projekte' && /Zeichnungsübersicht/.test(zurueck.label),
  'der Zurück-Pfeil führt in die Zeichnungsübersicht dieser App');
await page.reload(); await warte2d(page);
assert(await page.evaluate(() => location.hash === '#/zeichnung'
  && !document.getElementById('td-zeichnung').classList.contains('hidden')), 'Neuladen bleibt in der Zeichnung');
await page.goBack();
await page.waitForFunction(() => location.hash === '#/projekte'
  && !document.getElementById('td-projekte').classList.contains('hidden'));
assert(true, 'Zurück-Button des Browsers führt in die Übersicht');
const start = await page.getAttribute('#td-projekte .back-link', 'href');
assert(start === '/app', '„← Start" führt auf die Startseite');

// ── 7. Stile schlagen nicht durch ─────────────────────────────────────────
await page.goto(URL_('/app/aufmass')); await warteAufmass(page);
const leer = await page.evaluate(() => {
  const el = document.querySelector('#am-root .empty-state');
  const war = el.classList.contains('hidden');
  el.classList.remove('hidden');
  const st = getComputedStyle(el);
  const wert = { display: st.display, textAlign: st.textAlign };
  if (war) el.classList.add('hidden');
  return wert;
});
assert(leer.display === 'block' && leer.textAlign === 'center',
  `.empty-state im Aufmaß bleibt ein zentrierter Block (display: ${leer.display})`);

// ── 8. Bedienbarkeit ──────────────────────────────────────────────────────
for (const [pfad, warten, sel] of [
  ['/app/aufmass', warteAufmass, '#modSwitcher a, #am-root .btn:not(.btn-sm), .am-fuss-btn'],
  ['/app/aufmass-2d#/zeichnung', warte2d, '#modSwitcher a, #td-root #toolbar button']
]) {
  await page.goto(URL_(pfad)); await warten(page);
  const klein = await page.evaluate(s => {
    const zuKlein = [];
    document.querySelectorAll(s).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 44) zuKlein.push((el.id || el.className) + ': ' + Math.round(r.height) + 'px');
    });
    return zuKlein;
  }, sel);
  assert(klein.length === 0, `Bedienelemente erreichen 44 px Trefferhöhe (${pfad}) ` + JSON.stringify(klein));
}

const errs = logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));

console.log('\nAlle Tests zur Trennung der Anwendungen bestanden.');
await browser.close();
server.close();
