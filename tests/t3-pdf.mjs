/* ══════════════════════════════════════════════════════════════════════════
   Aufgabe 3 – PDF-Export

   Das Dokument besteht aus zwei Dingen: der Zeichnung und dem Aufmaß.
   Geprüft wird genau das – und dass zusätzliche Blätter nur dort entstehen,
   wo sie gebraucht werden:

     • ein normales Gerüst  →  Seite 1 Zeichnung, Seite 2 Aufmaß
     • mehrere Achsen       →  alle auf derselben Aufmaßseite, solange Platz ist
     • sehr großes Gerüst   →  Zeichnung auf mehrere Blätter, gleicher Maßstab
     • Tabellenumbruch      →  Spaltenkopf wird wiederholt
     • keine Nullzeilen, keine doppelten Angaben, keine Zierseiten
   ══════════════════════════════════════════════════════════════════════════ */
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('AUFGABE 3 – PDF-Export\n');

/** Baut ein Testgerüst und liefert die Aufrufliste des PDF-Stubs. */
async function build(n, { abschnitte = true, notes = 0, theme = 'farbe', bordbrett = false } = {}) {
  return page.evaluate(async ([count, withAbsch, noteCount, themeName, bb]) => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
    state.bordbrettKanten = []; state.ecken = {};
    state.project = 'Testprojekt Musterstraße';
    const names = ['Nordseite', 'Ostseite', 'Südseite', 'Westseite'];
    const abs = withAbsch ? names.map(nm => addAbschnitt(nm)) : [];
    for (let i = 0; i < count; i++) {
      const s = mkSection('E', i * 257, 0);
      setSectionAngle(s, 0);
      const b = mkBay(2.57);
      b.hL = 8.5; b.hR = 8.5;
      if (withAbsch) b.abschnittId = abs[Math.floor(i / Math.ceil(count / abs.length))].id;
      if (i % 3 === 0) b.positions.push({ id: ++_bId, cat: 'konsole', typ: '0,30', lagen: '2', billing: 'lagen' });
      if (i % 4 === 0) b.positions.push({ id: ++_bId, cat: 'netz', qty: null, unit: 'm2' });
      if (i < noteCount) b.note = 'Fenster im Bereich freihalten, Absprache mit Bauleitung erforderlich.';
      s.bays.push(b);
      state.sections.push(s);
    }
    renderAll(); flushRender();
    if (bb) { allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true)); renderAll(); flushRender(); }
    window.__pdfSaved = null;
    await buildPdf(themeName);
    return window.__pdfSaved;
  }, [n, abschnitte, notes, theme, bordbrett]);
}

/** Analysiert die Stub-Aufrufe: welche Texte stehen auf welcher Seite? */
function byPage(saved) {
  const pages = {};
  saved.calls.forEach(c => {
    if (c[0] === 'text') {
      const p = c[1];
      (pages[p] || (pages[p] = [])).push(String(c[2]));
    }
  });
  return pages;
}

const istPlanseite = t => t.some(x => /Maßstab ca\. 1:\d+/.test(x));
const istAufmass   = t => t.includes('Bezeichnung') && t.includes('Einheit');

// ── 1. Normales Gerüst (eine Achse): genau zwei Seiten ────────────────────
let saved = await build(6, { abschnitte: false, bordbrett: true });
let pages = byPage(saved);
assert(saved.pages === 2, `ein normales Gerüst ergibt genau ${saved.pages} Seiten (Soll 2)`);
assert(istPlanseite(pages[1]) && !istAufmass(pages[1]), 'Seite 1 zeigt die Zeichnung');
assert(istAufmass(pages[2]) && !istPlanseite(pages[2]), 'Seite 2 zeigt das Aufmaß');

// Kopfzeile: Projekt, Datum, Gerüsttiefe – auf jeder Seite, sonst nichts.
assert(Object.values(pages).every(t => t.some(x => x.includes('Testprojekt'))),
  'Projektname steht auf JEDER Seite');
assert(Object.values(pages).every(t => t.some(x => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(x))),
  'das Datum steht auf jeder Seite');
assert(Object.values(pages).every(t => t.some(x => /Gerüsttiefe 0,73 m/.test(x))),
  'die Gerüsttiefe steht auf jeder Seite');
assert(Object.values(pages).every(t => t.some(x => /^Seite \d+ von \d+$/.test(x))),
  'die Fußzeile besteht nur aus der Seitenzahl');

// Die Zeichnung bleibt beschriftet.
assert(pages[1].some(x => x === 'A1') && pages[1].some(x => x === '2,57')
    && pages[1].some(x => /^h 8,50/.test(x)),
  'die Zeichnung zeigt Feldbezeichnung, Feldlänge und Höhe');
assert(pages[1].some(x => x === 'Konsole') && pages[1].some(x => x === 'Netz')
    && pages[1].some(x => x === 'Bordbrett'),
  'unter der Zeichnung steht eine Legende der verwendeten Positionsarten');

// ── 2. Aufmaß: Pos. / Bezeichnung / Menge / Einheit ───────────────────────
const auf = pages[2];
['Pos.', 'Bezeichnung', 'Menge', 'Einheit'].forEach(sp =>
  assert(auf.includes(sp), `die Aufmaßtabelle hat die Spalte „${sp}"`));
assert(auf.includes('Gerüstfläche') && auf.includes('m²'), 'die Gerüstfläche ist eine Position');
assert(auf.includes('Bordbrett'), 'das Bordbrett ist eine Position');
assert(!auf.includes('0,00'), 'keine Position mit der Menge 0,00');
assert(!auf.includes('Gesamt'),
  'bei einer einzigen Achse steht die Aufstellung nicht zweimal auf dem Blatt');

// ── 3. Mehrere Achsen teilen sich EINE Aufmaßseite ────────────────────────
const mehrAchsen = await page.evaluate(async () => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
  state.bordbrettKanten = []; state.ecken = {};
  state.project = 'Drei Achsen';
  const lauf = (winkel, n, x, y) => {
    for (let i = 0; i < n; i++) {
      const s = mkSection('E', x, y); setSectionAngle(s, winkel);
      const b = mkBay(2.57); b.hL = 8.2; b.hR = 8.2;
      s.bays.push(b); state.sections.push(s);
      const e = sectionEnd(s); x = e.x; y = e.y;
    }
    return { x, y };
  };
  let p = lauf(0, 4, 0, 0);
  p = lauf(90, 3, p.x, p.y);
  lauf(180, 4, p.x, p.y);
  renderAll(); flushRender();
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return window.__pdfSaved;
});
const mPages = byPage(mehrAchsen);
const aufmassSeiten = Object.entries(mPages).filter(([, t]) => istAufmass(t)).map(([p]) => +p);
assert(aufmassSeiten.length === 1,
  `drei Achsen stehen auf ${aufmassSeiten.length} Aufmaßseite (nicht auf je einer)`);
const achsBloecke = mPages[aufmassSeiten[0]].filter(x => /^Achse /.test(x));
assert(achsBloecke.length === 3,
  `alle drei Achsen sind eigene Blöcke auf derselben Seite: ${achsBloecke.join(', ')}`);
assert(mPages[aufmassSeiten[0]].includes('Gesamt'),
  'die Gesamtaufstellung steht darunter, nicht auf einem eigenen Blatt');

// ── 4. Großes Gerüst: Zeichnung auf mehrere Blätter, gleicher Maßstab ─────
saved = await build(90);
pages = byPage(saved);
const planPages = Object.entries(pages).filter(([, t]) => istPlanseite(t)).map(([p]) => +p);
assert(planPages.length >= 3, `großer Plan wird auf ${planPages.length} Planblätter verteilt`);
assert(planPages.every(p => /Blatt \d+ von \d+/.test(pages[p].join('\n'))),
  'jedes Planblatt ist als „Blatt x von y" gekennzeichnet');
assert(planPages.every(p => pages[p].some(x => /Felder A\d+ – A\d+|Feld A\d+/.test(x))),
  'jedes Planblatt nennt die Felder, die es zeigt');
assert(planPages.every(p => pages[p].some(x => /^LAGE IM GESAMTPLAN/.test(x))),
  'jedes Planblatt zeigt seine Lage im Gesamtplan');
const scaleTexts = [...new Set(Object.values(pages).flat()
  .map(x => (x.match(/Maßstab ca\. 1:\d+/) || [])[0]).filter(Boolean))];
assert(scaleTexts.length === 1, `alle Planblätter haben denselben Maßstab (${scaleTexts[0]})`);
assert(!Object.values(pages).some(t => istPlanseite(t) === false && istAufmass(t) === false
                                       && t.length < 6),
  'es gibt kein Blatt ohne Inhalt – auch keine reine Übersichtsseite');

// ── 5. Kein Feld wird angeschnitten und keines geht verloren ──────────────
const split = await page.evaluate(() => {
  const layout = computeLayout();
  const legendH = pdfLegendEntries().length ? PDF_LEGEND_H : 0;
  const plan = pdfPlanPages(layout, 297 - 24,
    210 - 24 - (PDF_HEADER_H + legendH + 2 + PDF_FOOTER_H));
  const all = layout.filter(e => e.type === 'bay');
  const assigned = plan.pages.flatMap(p => p.els);
  const ids = assigned.map(e => e.si + ':' + e.bi);
  let cut = 0;
  plan.pages.forEach(pg => pg.els.forEach(el => {
    const b = elBBox(el);
    if (b.minX < pg.win.minX || b.maxX > pg.win.minX + pg.win.w ||
        b.minY < pg.win.minY || b.maxY > pg.win.minY + pg.win.h) cut++;
  }));
  const sizes = plan.pages.map(p => Math.round(p.win.w) + 'x' + Math.round(p.win.h));
  return { total: all.length, assigned: assigned.length, unique: new Set(ids).size,
           cut, uniformWindows: new Set(sizes).size, ghosts: plan.pages.some(p => p.ghosts.length) };
});
assert(split.assigned === split.total, `alle ${split.total} Felder sind einem Blatt zugeordnet`);
assert(split.unique === split.total, 'kein Feld erscheint doppelt');
assert(split.cut === 0, 'kein Feld wird am Blattrand angeschnitten');
assert(split.uniformWindows === 1, 'alle Planblätter zeigen einen gleich großen Ausschnitt');
assert(split.ghosts, 'Anschluss-Felder der Nachbarblätter werden als Kontext mitgeführt');

// ── 6. Gliederung: Abschnitte, sonst Achsen ───────────────────────────────
pages = byPage(await build(20));
const mitAbsch = Object.values(pages).flat();
['Nordseite', 'Ostseite', 'Südseite', 'Westseite'].forEach(nm =>
  assert(mitAbsch.includes(nm), `Abschnitt „${nm}" hat einen eigenen Block`));
assert(!mitAbsch.some(x => /^Achse /.test(x)),
  'mit Abschnitten wird nicht zusätzlich nach Achsen gegliedert');

const ohneAbsch = Object.values(byPage(await build(10, { abschnitte: false }))).flat();
assert(ohneAbsch.some(x => /^Achse /.test(x)),
  'ohne Abschnitte gliedert das Aufmaß nach Achsen');

// ── 7. Tabellenumbruch wiederholt den Spaltenkopf ─────────────────────────
const umbruch = await page.evaluate(async () => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
  state.bordbrettKanten = []; state.ecken = {};
  state.project = 'Viele Abschnitte';
  // 26 Abschnitte × je 2 Zeilen sprengen eine Aufmaßseite sicher.
  const abs = [];
  for (let i = 0; i < 26; i++) abs.push(addAbschnitt('Abschnitt ' + (i + 1)));
  for (let i = 0; i < 26; i++) {
    const s = mkSection('E', i * 257, 0); setSectionAngle(s, 0);
    const b = mkBay(2.57); b.hL = 8.5; b.hR = 8.5;
    b.abschnittId = abs[i].id;
    b.positions.push({ id: ++_bId, cat: 'dachfang', qty: null, unit: 'm' });
    s.bays.push(b); state.sections.push(s);
  }
  renderAll(); flushRender();
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return window.__pdfSaved;
});
const uPages = byPage(umbruch);
const uAufmass = Object.entries(uPages).filter(([, t]) => istAufmass(t)).map(([p]) => +p);
assert(uAufmass.length >= 2, `die volle Tabelle bricht auf ${uAufmass.length} Seiten um`);
assert(uAufmass.every(p => uPages[p].includes('Pos.') && uPages[p].includes('Bezeichnung')
                        && uPages[p].includes('Menge') && uPages[p].includes('Einheit')),
  'nach dem Umbruch wird der Spaltenkopf wiederholt');

// ── 8. Notizen nur, wenn welche erfasst sind ──────────────────────────────
const ohneNotizen = Object.values(byPage(await build(8))).flat();
assert(!ohneNotizen.includes('Notizen'), 'ohne Notizen gibt es keine Notizseite');
const mitNotizen = Object.values(byPage(await build(8, { notes: 3 }))).flat();
assert(mitNotizen.includes('Notizen'), 'mit Notizen erscheinen sie am Ende');

// ── 9. Beide Ausgaben erzeugen ein vollständiges Dokument ─────────────────
for (const t of ['farbe', 'monochrom']) {
  const s = await build(30, { theme: t });
  const p = byPage(s);
  assert(s.pages >= 2 && Object.values(p).every(x => x.some(y => /^Seite \d+ von \d+$/.test(y))),
    `Ausgabe „${t}": ${s.pages} Seiten, alle mit Kopf- und Fußzeile`);
}

// ── 10. Auswahl-Sheet ─────────────────────────────────────────────────────
await page.evaluate(() => { localStorage.removeItem('geruest.2d.pdfDesign'); exportPdf(); });
await page.waitForSelector('#bottomSheet .pdf-theme-card', { timeout: 3000 });
const sheet = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.pdf-theme-card .pdf-theme-name')].map(e => e.textContent),
  active: document.querySelector('.pdf-theme-card.active .pdf-theme-name').textContent
}));
assert(sheet.cards.length === 2, 'zwei Ausgaben zur Auswahl: ' + sheet.cards.join(', '));
assert(sheet.active === 'Farbe', 'Voreinstellung ist „Farbe"');

await page.evaluate(() => {
  [...document.querySelectorAll('.pdf-theme-card')][1].click();
  [...document.querySelectorAll('.sheet-ok')][0].click();
});
await page.waitForTimeout(700);
assert(await page.evaluate(() => localStorage.getItem('geruest.2d.pdfDesign')) === 'monochrom',
  'die gewählte Ausgabe wird für das nächste Mal gemerkt');

// Gemerkte Wahl aus der Vorgängerfassung darf nicht ins Leere zeigen.
assert(await page.evaluate(() => {
  localStorage.setItem('geruest.2d.pdfDesign', 'technisch');
  const n = pdfThemeName();
  localStorage.setItem('geruest.2d.pdfDesign', 'farbe');
  return n;
}) === 'farbe', 'ein früher gemerktes Layout fällt auf „Farbe" zurück');

const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));
console.log('\nAlle Tests zu Aufgabe 3 bestanden.');
await ctx.close();
