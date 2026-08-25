// Runde 2 – Aufgabe 1: Abschnitte ein-/ausblenden.
// Geprüft wird Verhalten: verschwindet das Feld von der Zeichenfläche, bleiben
// die Daten erhalten, und was landet im PDF?
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 2 · AUFGABE 1 – Abschnitte ein-/ausblenden\n');

/** Zwei Abschnitte à 3 Feldern + 2 Felder ohne Abschnitt. */
async function seed() {
  return page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false; state.aufmass = null;
    state.project = 'Sichtbarkeit';
    const nord = addAbschnitt('Nordseite');
    const ost  = addAbschnitt('Ostseite');
    for (let i = 0; i < 8; i++) {
      const s = mkSection('E', i * 257, 0);
      setSectionAngle(s, 0);
      const b = mkBay(2.57);
      b.hL = 8.5; b.hR = 8.5;
      b.positions.push({ id: ++_bId, cat: 'netz', qty: null, unit: 'm2' });
      b.note = 'Notiz ' + i;
      if (i < 3) b.abschnittId = nord.id;
      else if (i < 6) b.abschnittId = ost.id;
      s.bays.push(b);
      state.sections.push(s);
    }
    renderAll(); flushRender();
    return { nord: nord.id, ost: ost.id };
  });
}

const ids = await seed();

// ── Grundzustand ──────────────────────────────────────────────────────────
assert(await page.evaluate(() => document.querySelectorAll('#planGroup polygon').length >= 8),
  'alle 8 Felder werden zunächst gezeichnet');
assert(await page.evaluate(() => document.querySelectorAll('.absch-eye-btn').length >= 3),
  'jede Abschnittszeile (inkl. „Ohne Abschnitt") hat eine Sichtbarkeits-Option');

// ── Ausblenden über die Abschnittsübersicht ───────────────────────────────
const afterHide = await page.evaluate(nordId => {
  // Klick auf das Auge der ersten Abschnittszeile (Nordseite)
  document.querySelectorAll('.absch-row')[0].querySelector('.absch-eye-btn').click();
  flushRender();
  return {
    hidden: abschnittById(nordId).hidden,
    drawn: document.querySelectorAll('#planGroup polygon').length,
    // Daten müssen unverändert vorhanden sein
    bays: allBaysFlat().filter(b => b.abschnittId === nordId).map(b => ({
      len: b.len, hL: b.hL, pos: b.positions.length, note: b.note, ab: b.abschnittId
    })),
    visible: visibleBaysFlat().length,
    total: allBaysFlat().length
  };
}, ids.nord);

assert(afterHide.hidden === true, 'Abschnitt ist als ausgeblendet markiert');
assert(afterHide.visible === 5 && afterHide.total === 8,
  `3 Felder ausgeblendet, 5 sichtbar – Datenbestand bleibt 8 (${afterHide.visible}/${afterHide.total})`);
assert(afterHide.bays.length === 3 &&
       afterHide.bays.every(b => b.len === 2.57 && b.hL === 8.5 && b.pos === 1 && b.note && b.ab === ids.nord),
  'kein Datenverlust: Länge, Höhe, Zusatzbauteil, Notiz und Zuordnung bleiben erhalten');
assert(afterHide.drawn < 8 * 1.5,
  `ausgeblendete Felder werden nicht mehr gezeichnet (${afterHide.drawn} Polygone)`);

// Die Zeichenfläche darf keine Spur des Feldes mehr zeigen
assert(await page.evaluate(() => {
  const els = computeLayout();
  const hiddenSi = state.sections.findIndex(s => s.bays.some(b => !isBayVisible(b)));
  return !els.some(e => e.type === 'bay' && e.si === hiddenSi);
}), 'computeLayout liefert für ausgeblendete Felder keine Fläche mehr');

// ── Zoom/Bounding-Box folgt der Sichtbarkeit ──────────────────────────────
assert(await page.evaluate(() => {
  const b = contentBounds();
  // Die ersten drei Felder (0…771 px) sind ausgeblendet → Inhalt beginnt später
  return b && b.minX > 700;
}), '„Alle Felder anzeigen" zoomt nur auf die sichtbaren Felder');

// ── Mehrfachauswahl fasst ausgeblendete Felder nicht an ───────────────────
const bulk = await page.evaluate(() => {
  bulkMode = true;
  bulkSelected.clear();
  renderAll(); flushRender();
  document.querySelectorAll('.bulk-sel-btn')[0].click();   // „Alle"
  flushRender();
  const picked = allBaysFlat().filter(b => bulkSelected.has(b.id));
  return { n: picked.length, anyHidden: picked.some(b => !isBayVisible(b)) };
});
assert(bulk.n === 5 && !bulk.anyHidden,
  `„Alle" wählt nur sichtbare Felder (${bulk.n} von 8)`);

// ── Wieder einblenden stellt exakt denselben Stand her ────────────────────
const restored = await page.evaluate(nordId => {
  showAllAbschnitte();
  renderAll(); flushRender();
  return {
    visible: visibleBaysFlat().length,
    hidden: !!abschnittById(nordId).hidden,
    bays: allBaysFlat().filter(b => b.abschnittId === nordId).length
  };
}, ids.nord);
assert(restored.visible === 8 && !restored.hidden && restored.bays === 3,
  'Einblenden stellt alle Felder unverändert wieder her');

// ── Speichern/Laden und Undo ──────────────────────────────────────────────
const persisted = await page.evaluate(nordId => {
  setAbschnittHidden(nordId, true);
  state.hideUnassigned = true;
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  // Neu laden wie beim Öffnen einer Datei
  const d = JSON.parse(json);
  state.abschnitte = d.state.abschnitte;
  state.hideUnassigned = d.state.hideUnassigned;
  state.sections = d.state.sections;
  normalizeState();
  renderAll(); flushRender();
  return { hidden: !!abschnittById(nordId).hidden, unassigned: !!state.hideUnassigned,
           bays: allBaysFlat().length };
}, ids.nord);
assert(persisted.hidden && persisted.unassigned && persisted.bays === 8,
  'Sichtbarkeit wird mitgespeichert und geladen (Felder bleiben vollzählig)');

// ── PDF: Standard = nur sichtbare Abschnitte ──────────────────────────────
function textsOf(saved) {
  return saved.calls.filter(c => c[0] === 'text').map(c => String(c[2]));
}

const onlyVisible = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('technisch', { includeHidden: false });
  return window.__pdfSaved;
});
const withHidden = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('technisch', { includeHidden: true });
  return window.__pdfSaved;
});

const tVis = textsOf(onlyVisible).join('\n');
const tAll = textsOf(withHidden).join('\n');
assert(!tVis.includes('Nordseite') && tAll.includes('Nordseite'),
  'Standard: ausgeblendeter Abschnitt fehlt im PDF – mit Schalter ist er enthalten');
assert(tVis.includes('ausgeblendet'),
  'die Kopfzeile weist ausgeblendete Felder aus, damit niemand ein Blatt für vollständig hält');
assert(tAll.includes('Ostseite') && tVis.includes('Ostseite'),
  'sichtbare Abschnitte sind in beiden Fällen enthalten');

// Kennzahlen unterscheiden sich entsprechend
const lenVis = tVis.match(/Achsmaß ([\d,]+) m/);
const lenAll = tAll.match(/Achsmaß ([\d,]+) m/);
assert(lenVis && lenAll && parseFloat(lenVis[1].replace(',', '.')) < parseFloat(lenAll[1].replace(',', '.')),
  `Kennzahlen folgen dem Export-Umfang (${lenVis[1]} m sichtbar vs. ${lenAll[1]} m gesamt)`);

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 2 / Aufgabe 1 bestanden.');
await ctx.close();
