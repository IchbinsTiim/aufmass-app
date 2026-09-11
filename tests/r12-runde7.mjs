// Runde 7 – Abnahmeliste.
//
// Geprüft wird die Liste aus dem Auftrag, Punkt für Punkt und möglichst über
// die OBERFLÄCHE: Werkzeugleiste, Mehrfachauswahl per Geste, Werkzeug-Panel,
// Feldübersicht, Bordbrett (Lagen, freie Enden, Ecke) und das PDF.
import { open, seedFields, assert } from './harness.mjs';

const ctx = await open({ width: 1280, height: 900 });   // iPad quer
const { page } = ctx;

console.log('\nRUNDE 7 – Abnahme\n');

/* ══ 1. Werkzeugleiste ════════════════════════════════════════════════════ */

const leiste = await page.evaluate(() => ({
  ids: [...document.querySelectorAll('#toolbar .tb-tools .tb-btn')].map(b => b.id),
  texte: [...document.querySelectorAll('#toolbar .tb-tools .tb-btn')]
           .map(b => (b.querySelector('.tb-txt') || {}).textContent || ''),
  menueImTitel: !!document.querySelector('.tb-titel #tdMenuBtn'),
  werte: [...document.querySelectorAll('#toolbar .tb-werte > span')].map(s => s.id)
}));
assert(!leiste.texte.includes('Projekt'),
  'der Knopf „Projekt" ist aus der Leiste verschwunden');
assert(leiste.menueImTitel,
  'seine Funktionen liegen im Hauptmenü hinter dem Projektnamen oben links');
assert(await page.$('.bulk-toggle-btn') === null,
  'es gibt keinen Knopf „Mehrere auswählen" mehr');
assert(leiste.ids.includes('addAchseBtn'), '„+ Achse" liegt fest in der Leiste');
assert(leiste.ids.join(',') ===
  'addSectionBtn,addAchseBtn,undoBtn,redoBtn,fitViewBtn,snapToggleBtn,bordbrettBtn,td-exportPdfBtn,werkzeugBtn',
  `Soll-Belegung von links nach rechts: ${leiste.ids.join(' · ')}`);
assert(leiste.werte.includes('areaReadout') && leiste.werte.includes('bordbrettReadout'),
  'die beiden Kennzahlen rechts bleiben, wie sie sind');

// Das Hauptmenü trägt wirklich die Inhalte des früheren „Projekt"-Knopfes.
await page.click('#tdMenuBtn');
await page.waitForSelector('#bottomSheet');
const menue = await page.evaluate(() => {
  const sh = document.getElementById('bottomSheet');
  const t = sh.textContent;
  const r = { tiefe: !!sh.querySelector('#scaffDepth'),
              vorlagen: !!sh.querySelector('#lShapeBtn'),
              wechsel: !!sh.querySelector('#projWechselBtn'),
              datei: !!sh.querySelector('#savePlanBtn'), txt: t.slice(0, 40) };
  closeSheet();
  return r;
});
assert(menue.tiefe && menue.vorlagen && menue.wechsel && menue.datei,
  'Gerüsttiefe, Vorlagen, Zeichnungswechsel und Datei liegen im Hauptmenü');
await page.waitForTimeout(300);

/* ══ 2. „+ Achse" legt in EINEM Schritt an ════════════════════════════════ */

await seedFields(page, 6);
await page.waitForTimeout(150);
await page.click('#addAchseBtn');
await page.waitForTimeout(200);
assert(await page.evaluate(() => state.abschnitte.length === 1 && state.abschnitte[0].name === 'Achse A'),
  '„+ Achse" legt ohne Rückfrage eine Achse an');

/* ══ 3. Ein Bedienelement für Achse/Abschnitt ═════════════════════════════ */

await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
const begriffe = await page.evaluate(() => {
  const txt = document.getElementById('werkzeugPanel').textContent;
  return { abschnitt: /Abschnitt/.test(txt), achse: /Achse/.test(txt),
           kopf: [...document.querySelectorAll('#abschnittBar .wz-kopf-txt')].map(e => e.textContent) };
});
assert(begriffe.achse && !begriffe.abschnitt,
  'im Werkzeug-Panel heißt es durchgängig „Achse" – „Abschnitt" kommt nicht mehr vor');
assert(begriffe.kopf.join() === 'Achsen', `die Sektion heißt „${begriffe.kopf.join()}"`);

/* ══ 4. Werkzeug-Panel ════════════════════════════════════════════════════ */

// Für die Karten braucht es eine Auswahl – sie wirken immer auf sie.
await page.evaluate(() => {
  allBaysFlat().forEach(b => { b.hL = 8.2; b.hR = 8.2; });
  bulkMode = true;
  allBaysFlat().slice(0, 3).forEach(b => bulkSelected.add(b.id));
  renderAll(); flushRender();
});
const panel = await page.evaluate(() => {
  const p = document.getElementById('werkzeugPanel');
  const inhalt = p.querySelector('.wz-inhalt');
  const kopf = p.querySelector('.wz-kopf');
  const karten = [...p.querySelectorAll('.bauteil-karte')].map(k => k.getBoundingClientRect());
  const vp = document.getElementById('viewerPanel').getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  return {
    breite: Math.round(pr.width),
    sektionen: [...p.querySelectorAll('.wz-gruppe:not(.hidden) .wz-kopf-txt')].map(e => e.textContent),
    kopfSticky: getComputedStyle(kopf).position === 'sticky',
    schliessen: !!p.querySelector('#werkzeugCloseBtn'),
    // Nichts oben abgeschnitten: der erste Block beginnt UNTER dem Kopf.
    ersterBlockUnterKopf: p.querySelector('.wz-gruppe').getBoundingClientRect().top
                          >= kopf.getBoundingClientRect().bottom - 1,
    obenLuft: Math.round(parseFloat(getComputedStyle(inhalt).paddingTop)),
    untenLuft: Math.round(parseFloat(getComputedStyle(inhalt).paddingBottom)),
    // Karten sind alle gleich breit und gleich hoch.
    breiten: [...new Set(karten.map(r => Math.round(r.width)))],
    hoehen:  [...new Set(karten.map(r => Math.round(r.height)))],
    spalten: new Set(karten.map(r => Math.round(r.left))).size,
    // Das Panel liegt NEBEN der Zeichnung, nicht darüber.
    ueberdeckt: pr.left < vp.right - 1
  };
});
assert(panel.breite >= 340 && panel.breite <= 380,
  `festes Panel von rund 360 pt Breite (${panel.breite} px)`);
assert(panel.sektionen.slice(0, 4).join('|') === 'Auswahl|Abmessungen|Zusatzbauteile|Aktionen',
  `Sektionen in der geforderten Reihenfolge: ${panel.sektionen.join(' · ')}`);
assert(panel.kopfSticky && panel.schliessen,
  'Sticky-Kopf mit Titel und Schließen-X');
assert(panel.ersterBlockUnterKopf && panel.obenLuft >= 8 && panel.untenLuft >= 24,
  `nichts ist abgeschnitten – oben ${panel.obenLuft} px, unten ${panel.untenLuft} px Sicherheitsabstand`);
assert(panel.breiten.length === 1 && panel.hoehen.length === 1,
  `alle Bauteil-Karten sind gleich groß (${panel.breiten[0]} × ${panel.hoehen[0]} px)`);
assert(panel.spalten === 2, `zweispaltiges Raster (${panel.spalten} Spalten)`);
assert(!panel.ueberdeckt, 'das Panel überdeckt die Zeichenfläche nicht');

// Farbe kodiert den ZUSTAND, nicht den Bauteiltyp.
const farben = await page.evaluate(() => {
  const karte = [...document.querySelectorAll('.bauteil-karte')]
    .find(k => k.querySelector('.bk-name').textContent === 'Netz');
  const vorher = getComputedStyle(karte).backgroundColor;
  const alleVorher = [...new Set([...document.querySelectorAll('.bauteil-karte')]
    .map(k => getComputedStyle(k).backgroundColor))];
  karte.click();
  document.querySelector('#bottomSheet .sheet-ok').click();
  flushRender();
  const nach = [...document.querySelectorAll('.bauteil-karte')]
    .find(k => k.querySelector('.bk-name').textContent === 'Netz');
  return { alleVorher, vorher, nachher: getComputedStyle(nach).backgroundColor,
           haken: nach.querySelector('.bk-haken').textContent,
           wert: nach.querySelector('.bk-wert').textContent };
});
assert(farben.alleVorher.length === 1,
  `im Ruhezustand haben alle Karten dieselbe Farbe (${farben.alleVorher.join(', ')})`);
assert(farben.vorher !== farben.nachher,
  'gesetzte Bauteile heben sich farblich ab – die Farbe zeigt den Zustand');
assert(farben.haken === '✓', 'aktive Bauteile bekommen ein deutliches Häkchen');
assert(/Netz/.test(farben.wert) && /m/.test(farben.wert),
  `der Wert steht als Untertitel: „${farben.wert}"`);
await page.waitForTimeout(300);

/* ══ 5. Feldübersicht links ═══════════════════════════════════════════════ */

// Bei offenem Werkzeug-Panel zieht die Feldliste auf schmaleren Geräten ins
// Panel um (Verhalten aus Runde 10). Geprüft wird hier der angedockte Zustand.
await page.click('#werkzeugBtn');
await page.waitForTimeout(250);

const links = await page.evaluate(() => {
  const griff = document.getElementById('feldlisteGriff');
  const vorher = document.getElementById('sidePanel').getBoundingClientRect().width;
  griff.click();
  const zu = document.getElementById('sidePanel').getBoundingClientRect().width;
  const streifen = griff.getBoundingClientRect().width;
  const gemerkt = localStorage.getItem('geruest.2d.feldliste');
  griff.click();
  return { vorher: Math.round(vorher), zu: Math.round(zu),
           streifen: Math.round(streifen), gemerkt,
           auf: Math.round(document.getElementById('sidePanel').getBoundingClientRect().width) };
});
assert(links.vorher > 200 && links.zu === 0,
  `der Griff klappt die Feldübersicht ein (${links.vorher} → ${links.zu} px)`);
assert(links.streifen >= 24 && links.streifen <= 32,
  `eingeklappt bleibt ein ${links.streifen} px schmaler Streifen mit Chevron`);
assert(links.gemerkt === '0', 'der Zustand wird gemerkt');
assert(links.auf > 200, 'ein zweiter Tipp klappt sie wieder aus');

// Wischgeste nach links klappt ein, nach rechts wieder aus.
const wisch = await page.evaluate(async () => {
  const griff = document.getElementById('feldlisteGriff');
  const r = griff.getBoundingClientRect();
  const y = r.top + r.height / 2, x = r.left + r.width / 2;
  const senden = (typ, cx) => griff.dispatchEvent(new PointerEvent(typ, {
    bubbles: true, clientX: cx, clientY: y, pointerId: 1, pointerType: 'touch' }));
  senden('pointerdown', x); senden('pointerup', x - 90);
  const zu = document.body.classList.contains('feldliste-zu');
  senden('pointerdown', x); senden('pointerup', x + 90);
  return { zu, auf: !document.body.classList.contains('feldliste-zu') };
});
assert(wisch.zu && wisch.auf,
  'Wischen nach links klappt ein, nach rechts wieder aus');

// Der Zustand überlebt einen Projektwechsel (er steht in localStorage).
const ueberlebt = await page.evaluate(() => {
  setFeldliste(false);
  const gespeichert = localStorage.getItem('geruest.2d.feldliste');
  setFeldliste(ladeFeldlisteOffen(), { merken: false });
  const nachNeuladen = document.body.classList.contains('feldliste-zu');
  setFeldliste(true);
  return { gespeichert, nachNeuladen };
});
assert(ueberlebt.gespeichert === '0' && ueberlebt.nachNeuladen,
  'nach einem Neustart steht die Feldübersicht wieder so, wie sie verlassen wurde');

/* ══ 6. Bordbrett: Lagen ══════════════════════════════════════════════════ */

const lagen = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
  state.depth = 0.73; state.bordbrettLinien = []; state.ecken = {};
  let x = 0, y = 0;
  for (let i = 0; i < 3; i++) {
    const s = mkSection('E', x, y); setSectionAngle(s, 0);
    const b = mkBay(2.57); b.hL = 8.2; b.hR = 8.2;
    s.bays.push(b); state.sections.push(s);
    const e = sectionEnd(s); x = e.x; y = e.y;
  }
  renderAll(); flushRender();
  allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true));
  normalizeBordbrett(); renderAll(); flushRender();

  const linie = state.bordbrettLinien[0];
  openBordbrettSheet(linie);
  const sheet = document.getElementById('bottomSheet');
  const eine = +bordbrettGesamt().toFixed(2);

  // Zweite Lage anlegen
  sheet.querySelector('.bb-lage-add').click();
  const zwei = +bordbrettGesamt().toFixed(2);

  // Dritte Lage mit EIGENER Länge
  sheet.querySelector('.bb-lage-add').click();
  const inp = [...sheet.querySelectorAll('.bb-lage-inp')][2];
  inp.value = '4.00';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const drei = +bordbrettGesamt().toFixed(2);

  // Mittlere Lage wieder löschen
  [...sheet.querySelectorAll('.bb-lage-weg')][1].click();
  const nachLoeschen = +bordbrettGesamt().toFixed(2);
  const anzahl = linie.lagen.length;
  const readout = document.getElementById('bordbrettReadout').textContent;
  closeSheet();
  return { eine, zwei, drei, nachLoeschen, anzahl, readout };
});
assert(Math.abs(lagen.eine - 7.71) < 0.005, `eine Lage: ${lagen.eine} m`);
assert(Math.abs(lagen.zwei - 15.42) < 0.005,
  `eine zweite Lage lässt sich anlegen und zählt mit (${lagen.zwei} m)`);
assert(Math.abs(lagen.drei - 19.42) < 0.005,
  `jede Lage hat ihre eigene Länge (7,71 + 7,71 + 4,00 = ${lagen.drei} m)`);
assert(lagen.anzahl === 2 && Math.abs(lagen.nachLoeschen - 11.71) < 0.005,
  `eine einzelne Lage lässt sich löschen (${lagen.nachLoeschen} m, ${lagen.anzahl} Lagen)`);
assert(/11,71 m/.test(lagen.readout),
  `die Kennzahl oben rechts summiert über alle Lagen: „${lagen.readout}"`);

/* ══ 7. Bordbrett: frei positionierbar, mitten im Feld ════════════════════ */

const frei = await page.evaluate(() => {
  state.bordbrettLinien = [];
  renderAll(); flushRender();
  const byId = bayElsById(), graph = kantenGraph(byId);
  const els = computeLayout().filter(e => e.type === 'bay');
  // Von 30 % des ersten Feldes bis 60 % des dritten – beides MITTEN im Feld.
  const auf = (el, t) => {
    const [p, q] = bayKante(el, 2);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  const anker = bordbrettPunktUnter(auf(els[0], 0.3), byId, null, false);
  const ziel  = bordbrettPunktUnter(auf(els[2], 0.6), byId, null, false);
  const linie = mkBordbrettLinie(kantenPfad(graph, anker, ziel));
  bordbrettLinien().push(linie);
  normalizeBordbrett(); renderAll(); flushRender();
  const gezogen = +linienLaenge(linie, bayElsById()).toFixed(2);

  // Feineingabe der Länge über das Zahlenfeld
  setzeLinienLaenge(linie, 5.00);
  normalizeBordbrett();
  const feinjustiert = +linienLaenge(linie, bayElsById()).toFixed(2);

  // Beide Endpunkte tragen einen Anfasser
  starteBordbrettModus(); flushRender();
  const griffe = document.querySelectorAll('#planGroup circle[data-linie]').length;
  beendeBordbrettModus();
  return { gezogen, feinjustiert, griffe,
           stuecke: linie.stuecke.length };
});
// 0,7 × 2,57 + 2,57 + 0,4 × 2,57 (Kante 2 läuft rückwärts) = 5,40 m
assert(frei.gezogen > 4 && frei.gezogen < 7,
  `Anfang und Ende liegen mitten im Feld (${frei.gezogen} m statt 7,71 m)`);
assert(Math.abs(frei.feinjustiert - 5.00) < 0.02,
  `die Länge lässt sich über ein Zahlenfeld genau setzen (${frei.feinjustiert} m)`);
assert(frei.griffe === 2, `beide Endpunkte haben einen Anfasser (${frei.griffe})`);

/* ══ 8. Eckensituation aus dem Beispielfoto ═══════════════════════════════ */

const ecke = await page.evaluate(() => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
  state.depth = 0.73; state.bordbrettLinien = []; state.ecken = {};
  // A1–A4 laufen nach Osten …
  let x = 0, y = 0;
  for (let i = 0; i < 4; i++) {
    const s = mkSection('E', x, y); setSectionAngle(s, 0);
    const b = mkBay(2.57); b.hL = 8.2; b.hR = 8.2;
    s.bays.push(b); state.sections.push(s);
    const e = sectionEnd(s); x = e.x; y = e.y;
  }
  // … A5 steht quer ÜBER der Ecke und läuft nach Süden.
  const s5 = mkSection('E', x, y - state.depth * PX_PER_M);
  setSectionAngle(s5, 90);
  const b5 = mkBay(2.57); b5.hL = 6.0; b5.hR = 6.0;
  s5.bays.push(b5); state.sections.push(s5);
  renderAll(); flushRender();

  const els = computeLayout();
  const eckPunkte = eckSnapPunkte(els).filter(e => e.aussen);
  const byId = bayElsById(), graph = kantenGraph(byId);
  const bayEls = els.filter(e => e.type === 'bay');

  // Bordbrett der oberen Achse: von der linken Außenecke bis an die
  // Gebäudeecke – NICHT nur bis zur äußeren Feldkante von A4.
  const start = { x: bayEls[0].pts[3].x, y: bayEls[0].pts[3].y };
  const anker = bordbrettPunktUnter(start, byId, null, true, eckPunkte);
  const ziel  = bordbrettPunktUnter(eckPunkte[0], byId, null, true, eckPunkte);
  const oben  = mkBordbrettLinie(kantenPfad(graph, anker, ziel));
  bordbrettLinien().push(oben);

  // Die anschließende Achse bekommt ihre eigene Linie.
  const a5 = bayEls[4];
  const p1 = bordbrettPunktUnter({ x: a5.pts[2].x, y: a5.pts[2].y }, byId);
  const p2 = bordbrettPunktUnter({ x: a5.pts[3].x, y: a5.pts[3].y }, byId);
  const rechts = mkBordbrettLinie(kantenPfad(graph, p1, p2));
  bordbrettLinien().push(rechts);
  normalizeBordbrett(); renderAll(); flushRender();

  starteBordbrettModus(); flushRender();
  const markiert = [...document.querySelectorAll('#planGroup text')]
    .some(t => t.textContent === 'Ecke');
  beendeBordbrettModus();

  const b2 = bayElsById();
  return {
    eckPunkte: eckPunkte.length,
    markiert,
    obenLaenge: +linienLaenge(oben, b2).toFixed(2),
    rechtsLaenge: +linienLaenge(rechts, b2).toFixed(2),
    daten: pdfAufmassDaten().map(g => ({
      name: g.name, pos1: g.pos1.summe, pos2: g.pos2.summe, laenge: g.pos2.laenge,
      zeilen: g.pos2.zeilen.map(z => ({ feld: z.feld, l: z.laenge, h: z.hoehe,
                                        f: z.flaeche, bem: z.bemerkung }))
    }))
  };
});
assert(ecke.eckPunkte === 1 && ecke.markiert,
  'der Eckpunkt ist ein eigener Fangpunkt und wird in der Zeichnung markiert');
assert(Math.abs(ecke.obenLaenge - 11.01) < 0.02,
  `das Bordbrett der oberen Achse endet an der Gebäudeecke: ${ecke.obenLaenge} m `
  + '(4 × 2,57 + 0,73 – nicht 10,28 m an der Feldkante von A4)');
const obenZeilen = ecke.daten[0].zeilen;
assert(obenZeilen.length === 5 && obenZeilen[4].feld === 'A5',
  `das Eckfeld wird anteilig geteilt: ${obenZeilen.map(z => z.feld + ' ' + z.l).join(', ')}`);
assert(Math.abs(obenZeilen[4].l - 0.73) < 0.02 && obenZeilen[4].h === 6
    && /anteilig/.test(obenZeilen[4].bem),
  `der Teil VOR der Ecke gehört zur ersten Achse (${obenZeilen[4].l} m × ${obenZeilen[4].h} m)`);
assert(Math.abs(ecke.rechtsLaenge - 2.57) < 0.02 && Math.abs(ecke.daten[1].laenge - 2.57) < 0.02,
  `die anschließende Achse hat ihre eigene Aufmaßlänge (${ecke.daten[1].laenge} m)`);

/* ══ 9. PDF: was raus musste ══════════════════════════════════════════════ */

const pdf = await page.evaluate(async () => {
  state.project = 'Runde 7';
  window.__pdfSaved = null;
  await buildPdf('farbe');
  const calls = window.__pdfSaved.calls;
  return {
    texte: calls.filter(c => c[0] === 'text').map(c => String(c[2])),
    fuellungen: calls.filter(c => c[0] === 'setFillColor').length,
    rechtecke: calls.filter(c => c[0] === 'rect').length
  };
});
const txt = pdf.texte.join('\n');
assert(!/DIN\s?18451/.test(txt) && !/Grundlage:/.test(txt) && !/Achsmaße/.test(txt),
  'kein DIN-18451-Text mehr im PDF');
assert(!pdf.texte.some(t => t.trim() === 'Bordbrett'),
  'das Bordbrett ist keine eigene Position mehr');
assert(!pdf.texte.some(t => /^Bordbrett/.test(t)),
  'das Bordbrett steht seit Runde 8 auch nicht mehr in der Skizze bzw. Legende');
assert(!/Aufmaßregeln/.test(txt), 'kein Regel-Hinweisblock mehr');

/* ══ 10. PDF: EINE Ebene je Achse (seit Runde 8) ══════════════════════════
   Die beiden Flächen einer Achse gibt es unverändert – sie stehen nur nicht
   mehr als zwei Positionsblöcke mit feldweiser Auflistung da, sondern im
   Kopfbalken (Gesamt-Gerüstfläche) und in der Metazeile darunter (positio-
   nierte Fläche samt Aufmaßlänge).                                        */

assert(!pdf.texte.some(t => /^Position [12] –/.test(t)),
  'die Zwischenüberschriften „Position 1/2" sind entfallen');
assert(!pdf.texte.some(t => t === 'Feld' || t === 'Fläche (m²)' || t === 'Bemerkung'),
  'die feldweise Auflistung mit Einzelflächen ist entfallen');
assert(/Aufmaßlänge 11,01 m/.test(txt),
  'die Aufmaßlänge stammt aus der Bordbrettlinie');
assert(/davon positioniert: [\d,]+ m²/.test(txt),
  'die positionierte Gerüstfläche steht in der Metazeile');
assert(/Höhen: \d+ Feld(er)? à [\d,]+ m/.test(txt),
  'unterschiedliche Höhen innerhalb einer Achse stehen in der Metazeile');
// Ohne Zusatzbauteile bleibt die Tabelle leer – und sagt das auch.
assert(pdf.texte.some(t => /Keine Zusatzbauteile erfasst/.test(t)),
  'ohne Zusatzbauteile steht das ausdrücklich da (statt einer leeren Tabelle)');
assert(pdf.texte.some(t => /^\d+ Feld(er)?\s+·\s+[\d.,]+ m\s+·\s+[\d.,]+ m²$/.test(t)),
  'der Kopfbalken nennt Feldzahl, Achslänge und Gerüstfläche');
assert(pdf.texte.includes('GESAMT · ALLE SEITEN'),
  'Abschlussblock „Gesamt · alle Seiten" am Ende');

// So wenige Abschnitte wie möglich, von links nach rechts gruppiert: die
// fünf Felder ergeben ZWEI Achsen (nicht fünf), und die westliche steht oben.
const gliederung = await page.evaluate(() =>
  aufmassGruppen().map(g => ({ name: g.name, felder: g.bays.length })));
assert(gliederung.length === 2,
  `fünf Felder ergeben ${gliederung.length} Abschnitte (nicht einen je Feld)`);
assert(/A1/.test(gliederung[0].name),
  `von links nach rechts gruppiert: ${gliederung.map(g => g.name).join(' → ')}`);
assert(/[\d.,]+ m²/.test(txt), 'Flächen stehen mit ihrer Einheit im Blatt');

/* ══ 11. Blatt 2: Farbe, Zebra, Graustufen ════════════════════════════════ */

// Seit Runde 8 ist das Aufmaßblatt deutlich kürzer (eine Ebene statt vier),
// also gibt es auch weniger Flächen. Es bleibt aber flächig gestaltet:
// Kopfbalken, Achsfarbkante und Metazeile sind gefüllte Rechtecke.
assert(pdf.fuellungen > 10 && pdf.rechtecke >= 6,
  `das Aufmaßblatt ist flächig gestaltet (${pdf.fuellungen} Füllungen, ${pdf.rechtecke} Flächen)`);
const grau = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('monochrom');
  const farben = window.__pdfSaved.calls.filter(c => c[0] === 'setFillColor')
    .map(c => c.slice(1).join(','));
  return [...new Set(farben)];
});
assert(grau.every(f => {
  const [r, g, b] = f.split(',').map(Number);
  return [r, g, b].some(v => isNaN(v)) || (r === g && g === b);
}), `in Graustufen bleibt jede Fläche neutral (${grau.slice(0, 4).join(' | ')})`);
assert(grau.length >= 3,
  `auch in Graustufen bleiben die Ebenen unterscheidbar (${grau.length} Töne)`);

const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));

console.log('\nAlle Abnahmepunkte der Runde 7 bestanden.');
await ctx.close();
