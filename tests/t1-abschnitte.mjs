import { open, seedFields, assert } from './harness.mjs';

const ctx = await open();
const { page } = ctx;
console.log('AUFGABE 1 – Abschnitte\n');

await seedFields(page, 6);
await page.waitForTimeout(60);

// ── Rückwärtskompatibilität: Felder ohne Abschnitt ─────────────────────────
assert(await page.evaluate(() => Array.isArray(state.abschnitte) && state.abschnitte.length === 0),
  'frische Zeichnung startet ohne Abschnitte');
assert(await page.evaluate(() => allBaysFlat().every(b => b.abschnittId === null)),
  'alle Felder starten ohne Zuordnung');
assert(await page.evaluate(() => document.querySelectorAll('#planGroup polygon').length >= 6),
  'Felder ohne Abschnitt werden normal gezeichnet');

// Altdaten (ganz ohne abschnittId / abschnitte) laden
const migrated = await page.evaluate(() => {
  state.abschnitte = undefined;
  state.sections = [{ id: 1, name: 'Alt1', dir: 'E', angle: 0, x0: 0, y0: 0,
                      bays: [{ id: 1, len: 2.57, hL: 3, hR: 3, positions: [] }] }];
  normalizeState();
  renderAll(); flushRender();
  const b = state.sections[0].bays[0];
  return { ab: Array.isArray(state.abschnitte), id: b.abschnittId, len: b.len, h: b.hL };
});
assert(migrated.ab && migrated.id === null && migrated.len === 2.57 && migrated.h === 3,
  'Altdaten ohne Abschnitte migrieren verlustfrei (Länge/Höhe erhalten)');

await seedFields(page, 6);
await page.waitForTimeout(60);

// ── Anlegen / Umbenennen / Löschen ─────────────────────────────────────────
const created = await page.evaluate(() => {
  const a = addAbschnitt('Nordseite');
  const b = addAbschnitt('Abschnitt A');
  renderAll(); flushRender();
  return { n: state.abschnitte.length, names: state.abschnitte.map(x => x.name),
           colors: state.abschnitte.map(x => x.color), ids: state.abschnitte.map(x => x.id) };
});
assert(created.n === 2 && created.names.join() === 'Nordseite,Abschnitt A', 'zwei Abschnitte angelegt');
assert(created.colors[0] !== created.colors[1], 'Abschnitte bekommen unterschiedliche Farben');
assert(new Set(created.ids).size === 2, 'IDs sind eindeutig');

assert(await page.evaluate(() => {
  renameAbschnitt(state.abschnitte[0].id, 'Nordfassade');
  return state.abschnitte[0].name === 'Nordfassade';
}), 'Abschnitt umbenennen');

// Zuordnung
const assigned = await page.evaluate(() => {
  const bays = allBaysFlat();
  const [n, a] = state.abschnitte;
  assignAbschnitt(bays.slice(0, 3), n.id);
  assignAbschnitt(bays.slice(3, 5), a.id);
  renderAll(); flushRender();
  return { counts: abschnittCounts(), grouped: baysByAbschnitt().map(g => [g.abschnitt ? g.abschnitt.name : 'ohne', g.bays.length]) };
});
assert(JSON.stringify(assigned.grouped) === JSON.stringify([['Nordfassade', 3], ['Abschnitt A', 2], ['ohne', 1]]),
  'Felder gruppieren nach Abschnitt (inkl. Rest-Gruppe „ohne")');

// Löschen darf keine Felder verlieren
const afterDelete = await page.evaluate(() => {
  const before = allBaysFlat().length;
  deleteAbschnitt(state.abschnitte[0].id);
  renderAll(); flushRender();
  return { before, after: allBaysFlat().length, sections: state.abschnitte.length,
           orphan: allBaysFlat().filter(b => b.abschnittId === null).length };
});
assert(afterDelete.before === afterDelete.after && afterDelete.after === 6,
  'Löschen eines Abschnitts verliert keine Felder');
assert(afterDelete.sections === 1 && afterDelete.orphan === 4,
  'Felder des gelöschten Abschnitts gelten als „ohne Abschnitt"');

// ── Anzeige oben links bei Mehrfachauswahl ─────────────────────────────────
await page.evaluate(() => {
  state.abschnitte = []; _aId = 0;
  allBaysFlat().forEach(b => { b.abschnittId = null; });
  const n = addAbschnitt('Nordseite'), o = addAbschnitt('Ostseite');
  const bays = allBaysFlat();
  assignAbschnitt(bays.slice(0, 2), n.id);
  assignAbschnitt(bays.slice(2, 4), o.id);
  bulkMode = true;
  bulkSelected.clear();
  bays.slice(0, 2).forEach(b => bulkSelected.add(b.id));
  renderAll(); flushRender();
});
let info = await page.evaluate(() => {
  const el = document.getElementById('selectionInfo');
  const r = el.getBoundingClientRect();
  const panel = document.getElementById('viewerPanel').getBoundingClientRect();
  return { hidden: el.classList.contains('hidden'), text: el.textContent,
           dx: Math.round(r.left - panel.left), dy: Math.round(r.top - panel.top) };
});
assert(!info.hidden, 'Auswahl-Info ist bei Mehrfachauswahl sichtbar');
assert(info.dx < 40 && info.dy < 40, `Auswahl-Info sitzt oben links (Δ ${info.dx}/${info.dy} px)`);
assert(/2 Felder ausgewählt/.test(info.text), 'Auswahl-Info nennt die Anzahl: ' + JSON.stringify(info.text));
assert(/Abschnitt:/.test(info.text) && /Nordseite/.test(info.text),
  'Auswahl-Info nennt den Abschnitt');

// gemischte Auswahl
info = await page.evaluate(() => {
  allBaysFlat().forEach(b => bulkSelected.add(b.id));
  renderAll(); flushRender();
  return document.getElementById('selectionInfo').textContent;
});
assert(/Abschnitte:/.test(info) && /Nordseite/.test(info) && /Ostseite/.test(info) && /Ohne Abschnitt/.test(info),
  'gemischte Auswahl listet alle beteiligten Abschnitte + „Ohne Abschnitt"');
assert(/gemischte Zuordnung/.test(info), 'gemischte Zuordnung wird ausgewiesen');

// ── Persistenz: Speichern/Laden + Undo ─────────────────────────────────────
const roundTrip = await page.evaluate(() => {
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  // simuliert onLoadFile
  const d = JSON.parse(json), s = d.state;
  state.abschnitte = Array.isArray(s.abschnitte) ? s.abschnitte : [];
  state.sections = s.sections;
  normalizeState();
  return { n: state.abschnitte.length, assigned: allBaysFlat().filter(b => b.abschnittId).length };
});
assert(roundTrip.n === 2 && roundTrip.assigned === 4, 'Abschnitte überleben Speichern/Laden');

const undoOk = await page.evaluate(() => {
  finalizeUndoSnapshot();
  const before = state.abschnitte.length;
  addAbschnitt('Temporär');
  finalizeUndoSnapshot();
  performUndo();
  return { before, after: state.abschnitte.length };
});
assert(undoOk.before === 2 && undoOk.after === 2, 'Undo macht das Anlegen eines Abschnitts rückgängig');

const errs = ctx.logs.filter(l => l.includes('pageerror') || l.includes('[error]') && !l.includes('404'));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));
console.log('\nAlle Tests zu Aufgabe 1 bestanden.');
await ctx.close();
