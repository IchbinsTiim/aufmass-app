import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('AUFGABE 3 – PDF-Export\n');

/** Baut ein Testgerüst und liefert die Aufrufliste des PDF-Stubs. */
async function build(n, { abschnitte = true, notes = 0, theme = 'technisch' } = {}) {
  return page.evaluate(async ([count, withAbsch, noteCount, themeName]) => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0; state.abschnitte = [];
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
    window.__pdfSaved = null;
    await buildPdf(themeName);
    return window.__pdfSaved;
  }, [n, abschnitte, notes, theme]);
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

// ── 1. Kleiner Plan: eine Planseite, trotzdem volle Seitenausstattung ─────
let saved = await build(6);
let pages = byPage(saved);
assert(saved.pages >= 2, `kleiner Plan erzeugt ${saved.pages} Seiten (Plan + Aufmaß)`);
assert(Object.values(pages).every(t => t.some(x => x.includes('Testprojekt'))),
  'Projektname steht auf JEDER Seite');
assert(Object.values(pages).every(t => t.some(x => /Seite \d+ von \d+/.test(x))),
  'Seitenzahl steht auf jeder Seite');
assert(Object.values(pages).every(t => t.some(x => x.includes('Achsmaß') && x.includes('Gerüstfläche'))),
  'Kennzahlen-Fußzeile steht auf jeder Seite');
assert(pages[1].some(x => x === 'LEGENDE'), 'Planseite hat eine Legende');
assert(pages[1].some(x => x === 'Konsole') && pages[1].some(x => x === 'Netz'),
  'Legende benennt die verwendeten Positionsarten');
assert(pages[1].some(x => x === 'Nordseite'), 'Legende benennt die Abschnitte');

// ── 2. Großer Plan: Mehrseitigkeit mit Übersicht + wiederholter Legende ───
saved = await build(90);
pages = byPage(saved);
const planPages = Object.entries(pages).filter(([, t]) => t.includes('Grundriss')).map(([p]) => +p);
assert(planPages.length >= 3, `großer Plan wird auf ${planPages.length} Planblätter verteilt`);
assert(planPages.every(p => pages[p].some(x => x === 'LEGENDE')),
  'Legende wird auf JEDEM Planblatt wiederholt');
const missing = planPages.filter(p => !pages[p].some(x => /Planblatt B\d+ von \d+/.test(x)));
if (missing.length) console.log('  ! ohne Blattangabe:', missing, JSON.stringify(pages[missing[0]].slice(0,8)));
assert(missing.length === 0,
  'jedes Planblatt ist als „Planblatt B x von y" gekennzeichnet');
assert(Object.values(pages).some(t => t.some(x => /^\d+ Planblätter.*gestrichelt: Blattgrenzen/.test(x))),
  'es gibt eine Blattübersicht mit Einteilung');
assert(planPages.every(p => pages[p].some(x => /^LAGE IM GESAMTPLAN/.test(x))),
  'jedes Planblatt zeigt die Lage im Gesamtplan');
const scaleTexts = [...new Set(Object.values(pages).flat()
  .map(x => (x.match(/Maßstab ca\. 1:\d+/) || [])[0]).filter(Boolean))];
assert(scaleTexts.length === 1, `alle Planblätter haben denselben Maßstab (${scaleTexts[0]})`);

// ── 3. Kein Feld wird angeschnitten und keines geht verloren ──────────────
const split = await page.evaluate(() => {
  const layout = computeLayout();
  const plan = pdfPlanPages(layout, 297 - 24, 210 - 24 - (17 + 9 + 2.5 + 11));
  const all = layout.filter(e => e.type === 'bay');
  const assigned = plan.pages.flatMap(p => p.els);
  const ids = assigned.map(e => e.si + ':' + e.bi);
  // Liegt jedes Feld vollständig im Fenster seines Blattes?
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

// ── 4. Tabellen nach Abschnitt ────────────────────────────────────────────
assert(Object.values(pages).some(t => t.includes('nach Abschnitt')),
  'Aufmaß-Tabellen werden nach Abschnitt gegliedert');
['Nordseite', 'Ostseite', 'Südseite', 'Westseite'].forEach(nm =>
  assert(Object.values(pages).some(t => t.includes(nm)), `Abschnitt „${nm}" hat eine Tabelle`));
assert(Object.values(pages).some(t => t.includes('Gesamt · alle Felder')), 'Gesamt-Tabelle vorhanden');

// Ohne Abschnitte → Rückfall auf die Gliederung nach Gerüstseite
const noAbsch = byPage(await build(10, { abschnitte: false }));
assert(Object.values(noAbsch).some(t => t.includes('nach Gerüstseite')),
  'ohne Abschnitte bleibt die Gliederung nach Gerüstseite erhalten');

// ── 5. Notizen erhalten ebenfalls Kopf-/Fußzeile ──────────────────────────
const withNotes = byPage(await build(8, { notes: 3 }));
const notePages = Object.entries(withNotes).filter(([, t]) => t.some(x => x === 'Notizen')).map(([p]) => +p);
assert(notePages.length >= 1, 'Notizseite vorhanden');
assert(notePages.every(p => withNotes[p].some(x => x.includes('Testprojekt'))),
  'auch die Notizseite trägt die Kopfzeile');

// ── 6. Alle drei Layouts erzeugen ein vollständiges Dokument ──────────────
for (const t of ['technisch', 'kontrast', 'monochrom']) {
  const s = await build(30, { theme: t });
  const p = byPage(s);
  assert(s.pages >= 3 && Object.values(p).every(x => x.some(y => /Seite \d+ von \d+/.test(y))),
    `Layout „${t}": ${s.pages} Seiten, alle mit Kopf-/Fußzeile`);
}

// ── 7. Auswahl-Sheet ──────────────────────────────────────────────────────
await page.evaluate(() => { localStorage.removeItem('av_2d_pdf_theme'); exportPdf(); });
await page.waitForSelector('#bottomSheet .pdf-theme-card', { timeout: 3000 });
const sheet = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.pdf-theme-card .pdf-theme-name')].map(e => e.textContent),
  active: document.querySelector('.pdf-theme-card.active .pdf-theme-name').textContent
}));
assert(sheet.cards.length === 3, 'drei Layout-Vorschläge zur Auswahl: ' + sheet.cards.join(', '));
assert(sheet.active === 'Technisch', 'Voreinstellung ist „Technisch"');

await page.evaluate(() => {
  [...document.querySelectorAll('.pdf-theme-card')][1].click();
  [...document.querySelectorAll('.sheet-ok')][0].click();
});
await page.waitForTimeout(700);
// Speicher-Schlüssel liegen seit dem Zusammenführen im Namensraum „geruest.*"
// (siehe core.js); Altdaten werden beim ersten Start migriert.
assert(await page.evaluate(() => localStorage.getItem('geruest.2d.pdfDesign')) === 'kontrast',
  'gewähltes Layout wird für das nächste Mal gemerkt');

const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));
console.log('\nAlle Tests zu Aufgabe 3 bestanden.');
await ctx.close();
