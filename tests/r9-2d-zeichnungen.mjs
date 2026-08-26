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

console.log('RUNDE 9 – Zeichnungen anlegen und löschen\n');

// ── 1. Der Primärknopf ist da und immer benutzbar ────────────────────────
await zurListe();
assert(await page.isVisible('#tdNeuBtn'), '„Neue Zeichnung" steht in der Übersicht');
assert(!(await page.isDisabled('#tdNeuBtn')), '„Neue Zeichnung" ist nicht gesperrt');
const hoehe = await page.$eval('#tdNeuBtn', el => el.getBoundingClientRect().height);
assert(hoehe >= 44, `Trefferfläche ist tablettauglich (${Math.round(hoehe)} px)`);

// ── 2. Anlegen: Dialog mit Vorschlag und Zielordner ──────────────────────
await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
assert(/^Neue Zeichnung \d+$/.test(await page.inputValue('#tdNeuName')),
  'der Dialog schlägt einen Namen vor: ' + await page.inputValue('#tdNeuName'));
const ordnerAuswahl = await page.$$eval('#tdNeuOrdner option', o => o.map(x => x.textContent));
assert(ordnerAuswahl.includes('Ohne Ordner') && ordnerAuswahl.includes('Hofbau'),
  'alle Ordner stehen zur Wahl: ' + JSON.stringify(ordnerAuswahl));

await page.fill('#tdNeuName', 'Baustelle Nord');
await page.selectOption('#tdNeuOrdner', { label: 'Hofbau' });
await page.click('#tdNeuAnlegen');
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(500);

// ── 3. Die neue Zeichnung ist leer ───────────────────────────────────────
let z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  abschnitte: state.abschnitte.length,
  undo: undoStack.length, redo: redoStack.length,
  projekt: linkedProjectId,
  name: document.getElementById('projectName').value
}));
assert(await page.isVisible('#td-zeichnung'), 'die neue Zeichnung öffnet sich direkt im Editor');
assert(z.felder === 0 && z.abschnitte === 0, `die Zeichenfläche ist leer (${z.felder} Felder, ${z.abschnitte} Abschnitte)`);
assert(z.undo === 0 && z.redo === 0, 'die Undo-History startet leer');
assert(z.name === 'Baustelle Nord', 'der Editor trägt den neuen Namen');
const neueId = z.projekt;

// ── 4. Sie steht in der Übersicht – im gewählten Ordner ──────────────────
await zurListe();
assert((await karten()).includes('Baustelle Nord'), 'die neue Zeichnung steht in der Liste');
await page.click('#tdFolderBar .td-folder-chip:has-text("Hofbau")');
await page.waitForTimeout(250);
assert((await karten()).includes('Baustelle Nord'), 'sie liegt im gewählten Ordner „Hofbau"');
await page.click('#tdFolderBar .td-folder-chip:has-text("Alle Projekte")');
await page.waitForTimeout(250);

// ── 5. Sie überlebt einen Reload ─────────────────────────────────────────
await page.reload();
await page.waitForTimeout(600);
await zurListe();
assert((await karten()).includes('Baustelle Nord'), 'nach dem Reload ist sie noch da');
assert((await gespeicherte()).includes('Baustelle Nord'), 'und steht auch im Speicher');

// ── 6. Anlegen, während eine andere Zeichnung offen ist ──────────────────
await page.click('#tdProjectGrid .td-project-card:has-text("Hofstraße 4")');
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(400);
assert(await page.evaluate(() => state.sections.reduce((n, s) => n + s.bays.length, 0)) === 3,
  'zuerst ist eine gezeichnete Zeichnung geöffnet (3 Felder)');
// Einstieg aus dem Editor heraus: Datei → Neue Zeichnung
await page.click('#tdFileMenuBtn');
await page.waitForSelector('#floatingMenu');
await page.click('#floatingMenu .floating-menu-item:has-text("Neue Zeichnung")');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Während offen');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(500);
z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  undo: undoStack.length,
  kopie: copiedBayData, auswahl: selectedSi,
  name: document.getElementById('projectName').value
}));
assert(z.name === 'Während offen', 'das Anlegen war nicht blockiert – die neue Zeichnung ist offen');
assert(z.felder === 0, `kein Feld aus dem alten Dokument übrig (${z.felder})`);
assert(z.undo === 0 && z.kopie === null && z.auswahl === null,
  'Undo-History, Zwischenablage und Auswahl sind zurückgesetzt');

// ── 7. Löschen einzeln, mit Bestätigung ─────────────────────────────────
await zurListe();
await kartenMenu('Während offen', 'Löschen');
await page.waitForSelector('#tdLoeschOverlay:not(.hidden)');
assert((await page.textContent('#tdLoeschText')).includes('Während offen'),
  'die Sicherheitsabfrage nennt den Dateinamen');
await page.click('#tdLoeschAbbrechen');
await page.waitForTimeout(200);
assert((await karten()).includes('Während offen'), 'Abbrechen löscht nichts');

await kartenMenu('Während offen', 'Löschen');
await page.click('#tdLoeschBestaetigen');
await page.waitForTimeout(300);
assert(!(await karten()).includes('Während offen'), 'nach dem Bestätigen ist der Eintrag weg');
assert(!(await gespeicherte()).includes('Während offen'), 'und auch aus dem Speicher entfernt');
assert(await page.isVisible('.toast-aktion'), 'der Toast bietet „Rückgängig" an');

// ── 8. Rückgängig holt sie zurück ───────────────────────────────────────
await page.click('.toast-aktion');
await page.waitForTimeout(300);
assert((await karten()).includes('Während offen'), '„Rückgängig" stellt die Zeichnung wieder her');
assert((await gespeicherte()).includes('Während offen'), 'auch im Speicher ist sie wieder da');

// ── 9. Endgültig löschen: kein Wiederauftauchen nach dem Reload ─────────
await kartenMenu('Während offen', 'Löschen');
await page.click('#tdLoeschBestaetigen');
await page.waitForTimeout(300);
await page.reload();
await page.waitForTimeout(600);
await zurListe();
assert(!(await karten()).includes('Während offen'), 'nach dem Reload bleibt sie gelöscht');

// ── 10. Wird die geöffnete Zeichnung gelöscht, schließt der Editor ──────
await page.click(`#tdProjectGrid .td-project-card:has-text("Baustelle Nord")`);
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(400);
assert(await page.evaluate(() => linkedProjectId) === neueId, '„Baustelle Nord" ist geöffnet');
await page.click('#tdProjectBtn');
await page.waitForTimeout(300);
await kartenMenu('Baustelle Nord', 'Löschen');
await page.click('#tdLoeschBestaetigen');
await page.waitForTimeout(400);
assert(await page.evaluate(() => linkedProjectId) === null,
  'der Editor hängt nicht mehr an der gelöschten Zeichnung');
assert(await page.evaluate(() => localStorage.getItem('geruest.app.aktuellesProjekt')) === null,
  'auch der Zeiger „zuletzt geöffnet" ist aufgeräumt – keine verwaisten Verweise');
assert(await page.isVisible('#td-projekte'), 'die Übersicht ist wieder zu sehen');

// ── 11. Mehrfachauswahl ────────────────────────────────────────────────
await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Sammel A');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(400);
await zurListe();
await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Sammel B');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(400);
await zurListe();

await page.click('#tdAuswahlBtn');
await page.waitForTimeout(200);
assert(await page.isVisible('#tdBulkBar'), 'die Auswahlleiste erscheint');
await page.click('#tdProjectGrid .td-project-card:has-text("Sammel A")');
await page.click('#tdProjectGrid .td-project-card:has-text("Sammel B")');
await page.waitForTimeout(200);
assert((await page.textContent('#tdBulkInfo')).startsWith('2 '), 'zwei Zeichnungen sind ausgewählt');
await page.click('#tdBulkLoeschen');
await page.waitForSelector('#tdLoeschOverlay:not(.hidden)');
const namenImDialog = await page.$$eval('#tdLoeschListe li', els => els.map(e => e.textContent));
assert(namenImDialog.includes('Sammel A') && namenImDialog.includes('Sammel B'),
  'die Abfrage nennt beide Namen: ' + JSON.stringify(namenImDialog));
await page.click('#tdLoeschBestaetigen');
await page.waitForTimeout(300);
let liste = await karten();
assert(!liste.includes('Sammel A') && !liste.includes('Sammel B'), 'beide sind aus der Liste verschwunden');

// ── 12. Umbenennen, Duplizieren, Verschieben ───────────────────────────
page.once('dialog', d => d.accept('Altbau West neu'));
await kartenMenu('Altbau West', 'Umbenennen');
assert((await karten()).includes('Altbau West neu'), 'Umbenennen wirkt in der Liste');

await kartenMenu('Altbau West neu', 'Duplizieren');
assert((await karten()).includes('Altbau West neu (Kopie)'), 'Duplizieren legt eine Kopie an');
assert(await page.evaluate(() => {
  const l = JSON.parse(localStorage.getItem('geruest.aufmass.projekte'));
  const o = l.find(p => p.name === 'Altbau West neu');
  const k = l.find(p => p.name === 'Altbau West neu (Kopie)');
  return o && k && o.id !== k.id &&
         JSON.stringify(o.zeichnung2d.sections) === JSON.stringify(k.zeichnung2d.sections);
}), 'die Kopie hat eine eigene ID und dieselbe Zeichnung');

await page.click(`#tdProjectGrid .td-project-card:has-text("Altbau West neu (Kopie)") .td-project-menu-btn`);
await page.waitForSelector('#floatingMenu');
await page.click('#floatingMenu .floating-menu-item:has-text("In Ordner verschieben")');
await page.waitForTimeout(200);
await page.click('#floatingMenu .floating-menu-item:has-text("Hofbau")');
await page.waitForTimeout(300);
assert(await page.evaluate(() => JSON.parse(localStorage.getItem('geruest.aufmass.projekte'))
  .find(p => p.name === 'Altbau West neu (Kopie)').folderId) === 'f-hof',
  'Verschieben trägt den Ordner ein');

// ── 13. Ordner anlegen und löschen ─────────────────────────────────────
page.once('dialog', d => d.accept('Sanierung'));
await page.click('#tdFolderBar .td-folder-neu');
await page.waitForTimeout(300);
assert(await page.isVisible('#tdFolderBar .td-folder-chip:has-text("Sanierung")'), 'der neue Ordner steht in der Leiste');
await page.click('#tdFolderBar .td-folder-chip:has-text("Sanierung")');
await page.waitForTimeout(250);
page.once('dialog', d => d.accept());
await page.click('#tdFolderBar .td-folder-verwalten');
await page.waitForSelector('#floatingMenu');
await page.click('#floatingMenu .floating-menu-item:has-text("Ordner löschen")');
await page.waitForTimeout(300);
assert(!(await page.isVisible('#tdFolderBar .td-folder-chip:has-text("Sanierung")')), 'der Ordner ist gelöscht');

// ── 14. Der Bestand ist unverändert und öffnet sich ─────────────────────
await page.click('#tdFolderBar .td-folder-chip:has-text("Alle Projekte")');
await page.waitForTimeout(250);
await page.click('#tdProjectGrid .td-project-card:has-text("Hofstraße 4")');
await page.waitForFunction(() => location.hash === '#/2d');
await page.waitForTimeout(500);
z = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0), tiefe: state.depth
}));
assert(z.felder === 3 && z.tiefe === 0.73,
  `die vorhandene Zeichnung „Hofstraße 4" ist unverändert (${z.felder} Felder, ${z.tiefe} m)`);

// ── 15. Leerzustand bietet das Anlegen an ──────────────────────────────
await page.evaluate(() => {
  localStorage.setItem('geruest.aufmass.projekte', '[]');
  localStorage.removeItem('geruest.app.aktuellesProjekt');
});
await zurListe();
assert(await page.isVisible('#tdEmptyNeuBtn'), 'der Leerzustand hat einen Knopf zum Anlegen');
await page.click('#tdEmptyNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Erste Zeichnung');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(500);
assert(await page.isVisible('#td-zeichnung'), 'aus dem Leerzustand heraus öffnet sich die neue Zeichnung');
assert((await gespeicherte()).includes('Erste Zeichnung'), 'sie ist gespeichert');

// ── 16. Ungespeicherte Änderungen: Speichern / Verwerfen / Abbrechen ────
// „Erste Zeichnung" ist offen. Eine Änderung eintippen und sofort – also
// innerhalb der Autosave-Verzögerung – eine neue Zeichnung anstoßen.
const dateiNeu = async () => {
  await page.click('#tdFileMenuBtn');
  await page.click('#floatingMenu .floating-menu-item:has-text("Neue Zeichnung")');
};
const gespeicherterName = () => page.evaluate(() =>
  (JSON.parse(localStorage.getItem('geruest.aufmass.projekte') || '[]')
    .find(p => p.id === localStorage.getItem('geruest.app.aktuellesProjekt')) || {}).name);

await page.fill('#projectName', 'Erste Zeichnung (getippt)');
await dateiNeu();
await page.waitForSelector('#tdSpeichernOverlay:not(.hidden)', { timeout: 4000 });
assert(true, 'ungespeicherte Änderungen führen zum Dialog statt zu stillem Verlust');
assert(await page.isHidden('#tdNeuOverlay'), 'der Anlege-Dialog wartet solange');

await page.click('#tdSpeichernAbbrechen');
await page.waitForTimeout(200);
assert(await page.isHidden('#tdNeuOverlay') && await page.isVisible('#td-zeichnung'),
  '„Abbrechen" bleibt in der offenen Zeichnung');
assert(await page.inputValue('#projectName') === 'Erste Zeichnung (getippt)',
  'die Eingabe bleibt dabei erhalten');

// Speichern-Weg
await dateiNeu();
await page.waitForSelector('#tdSpeichernOverlay:not(.hidden)', { timeout: 4000 });
await page.click('#tdSpeichernSichern');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
assert(await gespeicherterName() === 'Erste Zeichnung (getippt)',
  '„Speichern" schreibt die Änderung, bevor es weitergeht');
await page.click('#tdNeuAbbrechen');
await page.waitForTimeout(200);

// Verwerfen-Weg
await page.fill('#projectName', 'Wieder weg');
await dateiNeu();
await page.waitForSelector('#tdSpeichernOverlay:not(.hidden)', { timeout: 4000 });
await page.click('#tdSpeichernVerwerfen');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.click('#tdNeuAbbrechen');
await page.waitForTimeout(900);   // länger als die Autosave-Verzögerung
assert(await gespeicherterName() === 'Erste Zeichnung (getippt)',
  '„Verwerfen" lässt die Änderung fallen – auch nach Ablauf der Autosave-Frist');
assert(await page.inputValue('#projectName') === 'Erste Zeichnung (getippt)',
  'der Editor zeigt wieder den gespeicherten Stand');

// ── 17. Keine verwaisten Daten: Fotos verschwinden mit der Zeichnung ────
const fotoZahl = pid => page.evaluate(async id => (await listProjectPhotos(id)).length, pid);
const alleFotos = () => page.evaluate(() => openPhotosDB().then(db => new Promise(res => {
  const tx = db.transaction('photos', 'readonly');
  const req = tx.objectStore('photos').getAll();
  req.onsuccess = () => res(req.result.map(p => p.id));
})));

await zurListe();
await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Mit Fotos');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(400);
const fotoProjekt = await page.evaluate(() => linkedProjectId);

await page.evaluate(async id => {
  const db = await openPhotosDB();
  await new Promise(r => {
    const tx = db.transaction('photos', 'readwrite');
    const st = tx.objectStore('photos');
    st.add({ id: 'ph-t1', projectId: id, dataUrl: 'data:,x', w: 1, h: 1, createdAt: 1, include: true });
    st.add({ id: 'ph-t2', projectId: id, dataUrl: 'data:,y', w: 1, h: 1, createdAt: 2, include: true });
    // Ein Foto ohne Projekt – so sieht ein verwaister Datensatz aus.
    st.add({ id: 'ph-waise', projectId: 'gibt-es-nicht', dataUrl: 'data:,z', w: 1, h: 1, createdAt: 3, include: true });
    tx.oncomplete = r;
  });
}, fotoProjekt);
assert(await fotoZahl(fotoProjekt) === 2, 'zwei Fotos hängen an der Zeichnung');

await page.click('#tdProjectBtn');
await page.waitForTimeout(300);
await kartenMenu('Mit Fotos', 'Löschen');
await page.click('#tdLoeschBestaetigen');
await page.waitForTimeout(400);
assert(await fotoZahl(fotoProjekt) === 2,
  'während der Rückgängig-Frist bleiben die Fotos liegen');
await page.waitForTimeout(7500);   // Frist abwarten
assert(await fotoZahl(fotoProjekt) === 0,
  'nach Ablauf der Frist sind die Fotos wirklich weg – keine verwaisten Datensätze');

// Der Aufräumlauf beim Start entfernt Waisen, die einen Reload überlebt haben.
assert((await alleFotos()).includes('ph-waise'), 'die Waise liegt noch in der Datenbank');
await page.reload();
await page.waitForTimeout(2500);
assert(!(await alleFotos()).includes('ph-waise'),
  'der Aufräumlauf beim Start entfernt Fotos ohne Projekt');

// ── 18. Beide Module arbeiten auf demselben Bestand ────────────────────
await zurListe();
await page.click('#tdNeuBtn');
await page.waitForSelector('#tdNeuOverlay:not(.hidden)');
await page.fill('#tdNeuName', 'Quergeprüft');
await page.click('#tdNeuAnlegen');
await page.waitForTimeout(400);

await page.click('a.back-link[href="#/aufmass"]').catch(() => {});
await page.goto(URL_('#/aufmass'));
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
await page.waitForTimeout(400);
const aufmassKarten = () => page.$$eval('#projectGrid .project-card2-name', els => els.map(e => e.textContent));
assert((await aufmassKarten()).includes('Quergeprüft'),
  'die im 2D-Modul angelegte Zeichnung steht auch im Aufmaß-Modul');

// Das ⋯-Menü der Projektkarte (jetzt aus core.js) funktioniert unverändert.
page.once('dialog', d => d.accept());
await page.click('#projectGrid .project-card2:has-text("Quergeprüft") .project-card2-menu-btn');
await page.waitForSelector('#floatingMenu');
await page.click('#floatingMenu .floating-menu-item:has-text("Löschen")');
await page.waitForTimeout(400);
assert(!(await aufmassKarten()).includes('Quergeprüft'), 'Löschen im Aufmaß-Modul wirkt dort sofort');

await zurListe();
assert(!(await karten()).includes('Quergeprüft'),
  'und die Zeichnungsliste des 2D-Moduls zeigt es ebenfalls nicht mehr');

const errs = logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + errs.join(' | '));

console.log('\nAlle Tests zum Anlegen und Löschen bestanden.');
await browser.close();
server.close();
