// Runde 8 – Dateiverwaltung:
// Startseite mit Modul-Auswahl, Dateiübersicht beider Module (Ordner, Suche,
// Sortierung, Ansichten, Papierkorb, Import/Export), Migration der Altdaten in
// den Dokumentenspeicher und – der eigentliche Auslöser – „Neue Zeichnung"
// mitten in einer offenen Zeichnung, ohne Reste des alten Dokuments.
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
const page = await browser.newPage({ viewport: { width: 1400, height: 980 } });
const logs = [];
// Nur echte Skriptfehler zählen – ein 404 des Testservers (z. B. favicon)
// sagt nichts über die App aus.
page.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) logs.push('[console] ' + m.text());
});
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

const warte = ms => page.waitForTimeout(ms);
const bereit = () => page.waitForFunction(() => typeof Speicher !== 'undefined' && Speicher.bereit());

console.log('RUNDE 8 – Dateiverwaltung, Modul-Auswahl, neue Zeichnung\n');

// ── 1. Migration: Altdaten tauchen vollständig in der Übersicht auf ───────
console.log('1. Migration der bestehenden Projekte\n');

await page.addInitScript(() => {
  // Ohne gesetzten Gerätemodus fragt das 2D-Modul beim ersten Start nach.
  localStorage.setItem('geruest.2d.geraetemodus', 'ipad');
  localStorage.setItem('geruest.aufmass.projekte', JSON.stringify([
    { id: 'alt-1', name: 'Baustelle Musterstraße', status: 'in_bearbeitung',
      erstellt: '2026-01-02', geaendert: '2026-01-20', folderId: 'f-alt',
      anschrift: { strasse: 'Musterstraße', nummer: '7', plz: '30159', ort: 'Hannover', bauherr: 'Bau GmbH' },
      geruesttyp: 'fassade', seiten: [], technik: {}, logistik: {}, zusatzpositionen: [],
      zeichnung2d: { depth: 0.73, abschnitte: [], _sId: 1, _bId: 2,
        sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, ang: 0,
          bays: [{ id: 1, len: 2.57, hL: 6, hR: 6, positions: [] },
                 { id: 2, len: 2.57, hL: 6, hR: 6, positions: [] }] }] } },
    { id: 'alt-2', name: 'Halle Nord', status: 'abgeschlossen',
      erstellt: '2025-11-11', geaendert: '2025-12-01', folderId: null,
      anschrift: {}, geruesttyp: 'dach', seiten: [], technik: {}, logistik: {},
      zusatzpositionen: [], zeichnung2d: null }
  ]));
  localStorage.setItem('geruest.aufmass.ordner', JSON.stringify([{ id: 'f-alt', name: 'Kunde Müller' }]));
});

await page.goto(URL_('#/'));
await bereit();

const mig = await page.evaluate(() => ({
  dokumente: Speicher.liste('aufmass').length,
  namen:     Speicher.liste('aufmass').map(d => Speicher.anzeigename(d)).sort(),
  ordner:    Speicher.ordner('aufmass').map(o => o.name),
  imOrdner:  Speicher.liste('aufmass').filter(d => Speicher.ordnerIdVon(d, 'aufmass') === 'f-alt').length,
  backup:    !!localStorage.getItem('geruest.backup.vor-dateiverwaltung'),
  altdaBleibt: !!localStorage.getItem('geruest.aufmass.projekte'),
  zeichnungErhalten: (Speicher.liste('aufmass').find(d => d.data.id === 'alt-1')
                      .data.zeichnung2d.sections[0].bays.length)
}));
assert(mig.dokumente === 2, `beide Altprojekte sind als Dokumente vorhanden (${mig.dokumente})`);
assert(mig.namen[0] === 'Baustelle Musterstraße' && mig.namen[1] === 'Halle Nord',
  'die Namen sind unverändert übernommen');
assert(mig.ordner.length === 1 && mig.ordner[0] === 'Kunde Müller', 'der bestehende Ordner ist da');
assert(mig.imOrdner === 1, 'die Ordnerzuordnung des Projekts blieb erhalten');
assert(mig.zeichnungErhalten === 2, 'die eingebettete 2D-Zeichnung ist vollständig mitgewandert');
assert(mig.backup, 'vor der Migration wurde ein Backup des Altstands abgelegt');
assert(mig.altdaBleibt, 'der alte Speicherschlüssel bleibt als zusätzliche Sicherung liegen');

// ── 2. Startseite mit Modul-Auswahl ──────────────────────────────────────
console.log('\n2. Startseite: Kacheln, Kennzahlen, Schnellzugriff\n');

const hub = await page.evaluate(() => ({
  kacheln: [...document.querySelectorAll('.hub-tile')].map(k => k.dataset.ziel),
  metaAufmass: document.getElementById('hubMetaAufmass').textContent,
  meta2d: document.getElementById('hubMeta2d').textContent,
  quickAufmass: document.getElementById('hubQuickAufmass').hidden
    ? null : document.getElementById('hubQuickAufmass').textContent
}));
assert(hub.kacheln.join(',') === 'aufmass,2d', 'die Startseite zeigt beide Kacheln – Aufmaß oben, 2D darunter');
assert(/2 Projekte/.test(hub.metaAufmass), `Kachel 1 nennt die Anzahl: „${hub.metaAufmass}"`);
assert(/1 Zeichnung/.test(hub.meta2d), `Kachel 2 nennt die Anzahl: „${hub.meta2d}"`);
assert(hub.quickAufmass && /Zuletzt:/.test(hub.quickAufmass),
  `Schnellzugriff auf die zuletzt bearbeitete Datei: „${hub.quickAufmass}"`);

// ── 3. Nach der Modulauswahl erscheint die Dateiübersicht ────────────────
console.log('\n3. Dateiübersicht beider Module\n');

await page.click('.hub-tile[data-ziel="aufmass"]');
await page.waitForFunction(() => document.body.dataset.ansicht === 'dateien');
assert(await page.evaluate(() => !!document.querySelector('#projectGrid .dv')),
  'Modul 1 landet in der Dateiübersicht, nicht im leeren Editor');
assert(await page.evaluate(() => document.querySelectorAll('#projectGrid .dv-karte').length) === 1,
  'in der Wurzel steht nur die Datei ohne Ordner – die andere liegt im Ordner');
assert(await page.evaluate(() => document.querySelectorAll('#projectGrid .dv-ordner').length) === 1,
  'der Ordner „Kunde Müller" wird angezeigt');

// Ordner öffnen (Brotkrumen)
await page.click('#projectGrid .dv-ordner');
await warte(150);
assert(await page.evaluate(() => document.querySelectorAll('#projectGrid .dv-karte').length) === 1,
  'im Ordner steht die zugeordnete Datei');
assert(await page.evaluate(() =>
  [...document.querySelectorAll('#projectGrid .dv-crumb')].map(c => c.textContent).join(' / '))
  === 'Alle Projekte / Kunde Müller', 'die Brotkrumen zeigen den Pfad');

await page.click('#projectGrid .dv-crumb');   // zurück zur Wurzel
await warte(150);

// Suche über alle Ordner hinweg
await page.fill('#projectGrid .dv-suche', 'Muster');
await warte(150);
assert(await page.evaluate(() => document.querySelectorAll('#projectGrid .dv-karte').length) === 1,
  'die Suche findet auch Dateien in Unterordnern');
await page.fill('#projectGrid .dv-suche', 'Bau GmbH');
await warte(150);
assert(await page.evaluate(() => document.querySelectorAll('#projectGrid .dv-karte').length) === 1,
  'gesucht wird auch über Bauherr und Anschrift');
await page.fill('#projectGrid .dv-suche', 'gibtesnicht');
await warte(150);
assert(await page.evaluate(() => !document.querySelector('#projectGrid .dv-leer').hidden),
  'ohne Treffer erscheint ein sinnvoller Leerzustand');
await page.fill('#projectGrid .dv-suche', '');
await warte(150);

// Sortierung + Ansichtsumschalter
await page.selectOption('#projectGrid [data-dv="sort"]', 'name');
await warte(150);
assert(await page.evaluate(() => document.querySelector('#projectGrid .dv-karte-name').textContent)
  === 'Halle Nord', 'nach Name sortiert steht „Halle Nord" oben');
await page.click('#projectGrid [data-dv="ansicht-liste"]');
await warte(120);
assert(await page.evaluate(() => document.querySelector('#projectGrid .dv').classList.contains('dv-liste')),
  'der Ansichtsumschalter wechselt auf die Listenansicht');
await page.click('#projectGrid [data-dv="ansicht-kachel"]');
await warte(120);

// ── 4. Ordner anlegen, verschachteln, Datei verschieben ─────────────────
console.log('\n4. Ordner und Verschieben\n');

const ordnerStand = await page.evaluate(() => {
  const oben  = Speicher.neuerOrdner('aufmass', '2026', null);
  const unten = Speicher.neuerOrdner('aufmass', 'Januar', oben.id);
  const datei = Speicher.liste('aufmass').find(d => d.data.id === 'alt-2');
  Speicher.verschiebe(datei.id, 'aufmass', unten.id);
  renderProjectOverview();
  return {
    tiefe: Speicher.ordnerPfad(unten.id).map(o => o.name),
    zugeordnet: Speicher.ordnerIdVon(Speicher.dok(datei.id), 'aufmass') === unten.id,
    // Ordner darf nicht in seinen eigenen Unterordner wandern
    unmoeglich: Speicher.verschiebeOrdner(oben.id, unten.id) === null
  };
});
assert(ordnerStand.tiefe.join(' / ') === '2026 / Januar', 'Ordner lassen sich verschachteln');
assert(ordnerStand.zugeordnet, 'eine Datei lässt sich in einen Unterordner verschieben');
assert(ordnerStand.unmoeglich, 'ein Ordner kann nicht in seinen eigenen Unterordner verschoben werden');

// Ordner löschen: die Dateien darin bleiben erhalten
const nachLoeschen = await page.evaluate(() => {
  const oben = Speicher.ordner('aufmass').find(o => o.name === '2026');
  const vorher = Speicher.liste('aufmass').length;
  Speicher.loescheOrdner(oben.id);
  renderProjectOverview();
  return {
    dateien: Speicher.liste('aufmass').length,
    vorher,
    ordnerWeg: !Speicher.ordner('aufmass').some(o => o.name === '2026' || o.name === 'Januar'),
    inWurzel: Speicher.liste('aufmass').filter(d => !Speicher.ordnerIdVon(d, 'aufmass')).length
  };
});
assert(nachLoeschen.ordnerWeg, 'Ordner samt Unterordner gelöscht');
assert(nachLoeschen.dateien === nachLoeschen.vorher, 'beim Löschen eines Ordners geht keine Datei verloren');
assert(nachLoeschen.inWurzel === 1, 'die Datei liegt danach wieder in der Wurzel');

// ── 5. Duplizieren, Umbenennen, Papierkorb ──────────────────────────────
console.log('\n5. Dateiaktionen und Papierkorb\n');

const aktionen = await page.evaluate(() => {
  const quelle = Speicher.liste('aufmass').find(d => d.data.id === 'alt-1');
  const kopie  = Speicher.dupliziere(quelle.id, 'aufmass');
  const eigeneDaten = kopie.data.id !== quelle.data.id;
  Speicher.umbenenne(kopie.id, 'Kopie mit neuem Namen');
  const geloescht = Speicher.inPapierkorb(kopie.id);
  const imKorb = Speicher.papierkorb().length;
  const sichtbar = Speicher.liste('aufmass').length;
  Speicher.wiederherstellen(geloescht.id);
  const nachWiederherstellen = Speicher.liste('aufmass').length;
  return {
    name: kopie.name, eigeneDaten, imKorb, sichtbar, nachWiederherstellen,
    frist: Speicher.PAPIERKORB_TAGE
  };
});
assert(aktionen.eigeneDaten, 'die Kopie bekommt einen eigenen Datensatz (kein gemeinsamer Zustand)');
assert(aktionen.name === 'Kopie mit neuem Namen', 'Umbenennen wirkt sofort');
assert(aktionen.imKorb === 1 && aktionen.sichtbar === 2, 'Löschen legt die Datei in den Papierkorb');
assert(aktionen.nachWiederherstellen === 3, 'aus dem Papierkorb lässt sie sich wiederherstellen');
assert(aktionen.frist === 30, 'die Aufbewahrungsfrist beträgt 30 Tage');

// Export/Import einer einzelnen Datei
const austausch = await page.evaluate(() => {
  const quelle = Speicher.liste('aufmass').find(d => d.data.id === 'alt-1');
  const paket  = Speicher.exportPaket(quelle.id);
  const wieder = Speicher.importPaket(JSON.parse(JSON.stringify(paket)), 'aufmass', null);
  return {
    typ: paket.typ,
    nameGleich: Speicher.anzeigename(wieder) === Speicher.anzeigename(quelle),
    eigeneId: wieder.data.id !== quelle.data.id,
    zeichnung: wieder.data.zeichnung2d.sections[0].bays.length
  };
});
assert(austausch.typ === 'geruest-dokument', 'Export erzeugt ein erkennbares Paketformat');
assert(austausch.nameGleich, 'der Import trägt denselben Namen');
assert(austausch.eigeneId, 'der Import überschreibt nie ein vorhandenes Dokument');
assert(austausch.zeichnung === 2, 'auch die Zeichnung kommt beim Import vollständig mit');

// ── 6. Der eigentliche Fehler: neue Zeichnung bei offener Zeichnung ─────
console.log('\n6. Neue Zeichnung jederzeit – ohne Reste des alten Dokuments\n');

await page.evaluate(() => { location.hash = '#/2d'; });
await page.waitForFunction(() => document.body.dataset.modul === '2d' && document.body.dataset.ansicht === 'dateien');
assert(await page.evaluate(() => !!document.querySelector('#td-dateienHost .dv')),
  'auch das 2D-Modul hat jetzt eine Dateiübersicht');
assert(await page.evaluate(() => !!document.querySelector('#td-dateienHost .dv-vorschau')),
  'die Zeichnungen der Übersicht haben eine Miniaturvorschau');

// Erste Zeichnung öffnen und bearbeiten
await page.evaluate(() => {
  const dok = Speicher.liste('zweid').find(d => d.data.id === 'alt-1');
  ZweiDModul.oeffneDokument(dok.id);
});
await page.waitForFunction(() => document.body.dataset.ansicht === 'editor');
await warte(400);

await page.click('#uShapeBtn');           // erzeugt Felder → Undo-Schritt
await warte(1000);                        // Undo-Schritte werden gebündelt (600 ms)
await page.evaluate(() => { selectedSi = 0; selectedBi = 0; copiedBayData = { test: true }; });

const vorher = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  undo:   undoStack.length,
  dok:    aktuellesDok2d
}));
assert(vorher.felder > 0, `Zeichnung 1 hat ${vorher.felder} Felder`);
assert(vorher.undo > 0, `Zeichnung 1 hat ${vorher.undo} Rückgängig-Schritte`);

// … und jetzt mitten drin eine neue Zeichnung beginnen
await page.click('#td-neueZeichnungBtn');
await warte(500);

const nachher = await page.evaluate(() => ({
  felder:     state.sections.reduce((n, s) => n + s.bays.length, 0),
  abschnitte: state.abschnitte.length,
  undo:       undoStack.length,
  redo:       redoStack.length,
  auswahl:    [selectedSi, selectedBi],
  bulk:       bulkSelected.size,
  clipboard:  copiedBayData,
  bordbretter: (state.bordbretter || []).length,
  grundriss:  state.grundriss,
  ecken:      Object.keys(state.ecken || {}).length,
  ids:        [_sId, _bId, _aId],
  dok:        aktuellesDok2d,
  imEditor:   document.body.dataset.ansicht === 'editor',
  undoBtnAus: document.getElementById('undoBtn').disabled
}));

assert(nachher.imEditor, 'die neue Zeichnung öffnet sich sofort im Zeichner – keine Blockade');
assert(nachher.dok && nachher.dok !== vorher.dok, 'die neue Zeichnung ist ein eigenes Dokument');
assert(nachher.felder === 0, `die Zeichenfläche ist leer (${nachher.felder} Felder)`);
assert(nachher.abschnitte === 0, 'keine Abschnitte aus dem alten Dokument');
assert(nachher.undo === 0 && nachher.redo === 0, 'die Rückgängig-Historie beginnt bei null');
assert(nachher.undoBtnAus, 'der Rückgängig-Knopf ist entsprechend gesperrt');
assert(nachher.auswahl[0] === null && nachher.auswahl[1] === null, 'keine Auswahl übernommen');
assert(nachher.bulk === 0, 'keine Mehrfachauswahl übernommen');
assert(nachher.clipboard === null, 'die Zwischenablage ist geleert');
assert(nachher.bordbretter === 0 && nachher.grundriss === null && nachher.ecken === 0,
  'Bordbretter, Grundriss und Eck-Entscheidungen sind zurückgesetzt');
assert(nachher.ids.join(',') === '0,0,0', 'auch die ID-Zähler beginnen neu');

// Die alte Zeichnung ist dabei nicht verloren gegangen
const alteNochDa = await page.evaluate(dokId => {
  const dok = Speicher.dok(dokId);
  return dok.data.zeichnung2d.sections.reduce((n, s) => n + s.bays.length, 0);
}, vorher.dok);
assert(alteNochDa === vorher.felder, 'die vorherige Zeichnung wurde vorher vollständig gesichert');

// In der neuen Zeichnung lässt sich sofort weiterarbeiten
await page.click('#lShapeBtn');
await warte(400);
const neueArbeit = await page.evaluate(() => ({
  felder: state.sections.reduce((n, s) => n + s.bays.length, 0),
  gespeichert: Speicher.dok(aktuellesDok2d).data.zeichnung2d
}));
assert(neueArbeit.felder > 0, `in der neuen Zeichnung entstehen Felder (${neueArbeit.felder})`);
await warte(900);
const autosave = await page.evaluate(() =>
  Speicher.dok(aktuellesDok2d).data.zeichnung2d.sections.reduce((n, s) => n + s.bays.length, 0));
assert(autosave === neueArbeit.felder, 'die neue Zeichnung wird automatisch gespeichert');

// ── 6b. Eine im 2D-Modul angelegte Zeichnung überlebt das Aufmaß-Modul ──
// Regressionsschutz: beim Anlegen im 2D-Modul ist die Projektliste des
// Aufmaß-Moduls veraltet. Ein Speichern dort darf das neue Dokument nicht
// aussortieren – ein fehlender Eintrag ist kein Löschwunsch.
const ueberlebt = await page.evaluate(() => {
  const neuId   = aktuellesDok2d;
  const datenId = Speicher.dok(neuId).data.id;
  projects = projects.filter(p => p.id !== datenId);   // absichtlich veralteter Stand
  saveProjects();
  const dok = Speicher.dok(neuId);
  return { nochDa: !!dok && !dok.deletedAt };
});
assert(ueberlebt.nochDa,
  'ein im 2D-Modul angelegtes Dokument bleibt bestehen, auch wenn das Aufmaß-Modul mit älterem Stand speichert');
await page.evaluate(() => loadProjects());

// ── 7. Vorschaubild ──────────────────────────────────────────────────────
console.log('\n7. Vorschaubilder und Modulwechsel\n');

const vorschau = await page.evaluate(() => {
  const url = erzeugeVorschau2d();
  return { hat: !!url, svg: !!url && url.startsWith('data:image/svg+xml'), laenge: url ? url.length : 0 };
});
assert(vorschau.hat && vorschau.svg, 'aus der Zeichnung entsteht ein Vorschaubild (SVG-Data-URL)');
assert(vorschau.laenge < 60000, `das Vorschaubild bleibt klein (${vorschau.laenge} Zeichen)`);

// Modulwechsel verliert nichts (bewusst gespeichert – der Dialog beim
// Verlassen mit offenen Änderungen ist Gegenstand von Abschnitt 8).
await page.evaluate(() => speichereZeichnung());
const vorWechsel = await page.evaluate(() => state.sections.reduce((n, s) => n + s.bays.length, 0));
await page.evaluate(() => { location.hash = '#/aufmass'; });
await page.waitForFunction(() => document.body.dataset.modul === 'aufmass');
await page.evaluate(() => { location.hash = '#/2d/editor'; });
await page.waitForFunction(() => document.body.dataset.ansicht === 'editor');
await warte(400);
const nachWechsel = await page.evaluate(() => state.sections.reduce((n, s) => n + s.bays.length, 0));
assert(nachWechsel === vorWechsel, 'der Modulwechsel lässt die Zeichnung unangetastet');

// ── 8. Dialog beim Verlassen mit ungespeicherten Änderungen ──────────────
console.log('\n8. Speichern / Verwerfen / Abbrechen\n');

// Eine echte, nicht bewusst gespeicherte Änderung herbeiführen
await page.evaluate(() => { state.depth = 0.9; zeichnungSchmutzig = true; });
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForSelector('.dv-dialog-overlay.offen', { timeout: 4000 });
assert(true, 'beim Verlassen mit ungespeicherten Änderungen erscheint der Dialog');
const knoepfe = await page.evaluate(() =>
  [...document.querySelectorAll('.dv-dialog-knoepfe .dv-dialog-btn')].map(b => b.textContent));
assert(knoepfe.join(' / ') === 'Abbrechen / Verwerfen / Speichern',
  `der Dialog bietet alle drei Wege: ${knoepfe.join(' / ')}`);

// „Abbrechen" bleibt im Zeichner
await page.click('.dv-dialog-btn.still');
await warte(400);
assert(await page.evaluate(() => document.body.dataset.ansicht) === 'editor',
  '„Abbrechen" bleibt im Dokument');
assert(await page.evaluate(() => location.hash) === '#/2d/editor',
  'auch die Adresse wird dabei zurückgedreht');

// „Speichern" lässt weiterziehen
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForSelector('.dv-dialog-overlay.offen', { timeout: 4000 });
await page.click('.dv-dialog-btn.primaer');
await page.waitForFunction(() => document.body.dataset.modul === 'hub');
assert(await page.evaluate(() => document.body.dataset.modul) === 'hub',
  '„Speichern" schließt den Vorgang ab und wechselt');

// ── 9. Neustart: alles ist noch da ───────────────────────────────────────
console.log('\n9. Nach dem Neuladen\n');

const vorNeustart = await page.evaluate(() => Speicher.liste('aufmass').length);
await page.evaluate(() => Speicher.flush());
await warte(300);
await page.goto(URL_('#/aufmass'));
await bereit();
await warte(300);
const nachNeustart = await page.evaluate(() => ({
  anzahl: Speicher.liste('aufmass').length,
  karten: document.querySelectorAll('#projectGrid .dv-karte, #projectGrid .dv-ordner').length
}));
assert(nachNeustart.anzahl === vorNeustart,
  `nach dem Neuladen sind alle ${nachNeustart.anzahl} Dokumente wieder da`);
assert(nachNeustart.karten > 0, 'und werden in der Übersicht angezeigt');

// ── 10. Keine JS-Fehler ──────────────────────────────────────────────────
assert(logs.length === 0, 'keine JS-Fehler im gesamten Ablauf: ' + logs.join(' | '));

console.log('\nAlle Tests zur Dateiverwaltung bestanden.');
await browser.close();
server.close();
