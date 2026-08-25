// Runde 2 – Aufgabe 2 (kopiertes Feld auf Mehrfachauswahl anwenden) und
// Aufgabe 3 (Zusatzbauteile über die Mehrfachauswahl: Länge + Lagen).
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 2 · AUFGABE 2+3 – Mehrfachauswahl\n');

/** Sechs Felder unterschiedlicher Länge, damit sichtbar wird, dass die Länge
 *  je Feld aus dem eigenen Maß kommt und nicht pauschal übernommen wird. */
async function seed() {
  await page.evaluate(() => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    const lens = [2.57, 3.07, 2.07, 2.57, 1.57, 2.57];
    let x = 0;
    lens.forEach(len => {
      const s = mkSection('E', x, 0);
      setSectionAngle(s, 0);
      s.bays.push(mkBay(len));
      state.sections.push(s);
      x += len * PX_PER_M;
    });
    bulkMode = true; bulkSelected.clear();
    renderAll(); flushRender();
  });
}
await seed();

/* ══ Aufgabe 3: Zusatzbauteil über die Mehrfachauswahl ═════════════════════
   Fehlerbild vorher: Innengeländer über die Mehrfachauswahl hinzugefügt →
   keine Länge, kein Lagen-Dialog. */

// Auswahl: Felder 2..5 (unterschiedlich lang)
await page.evaluate(() => {
  const bays = allBaysFlat();
  [1, 2, 3, 4].forEach(i => bulkSelected.add(bays[i].id));
  renderAll(); flushRender();
});

const sheetOpened = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.bulk-pos-chip')]
    .find(c => c.textContent === 'Innengeländer');
  chip.click();
  const sheet = document.getElementById('bottomSheet');
  return {
    open: !!sheet,
    header: sheet ? sheet.querySelector('.sheet-header').textContent : '',
    lagenButtons: sheet ? [...sheet.querySelectorAll('.klagen-btn')].map(b => b.textContent) : [],
    lagenVisible: sheet ? sheet.querySelector('.konsole-lagen-row').style.display !== 'none' : false,
    preview: sheet ? sheet.querySelector('.bulk-pos-preview').textContent : ''
  };
});
assert(sheetOpened.open, 'Zusatzbauteil über die Mehrfachauswahl öffnet einen Einstell-Dialog');
assert(sheetOpened.header.includes('Innengeländer') && sheetOpened.header.includes('4 Felder'),
  `Dialog gilt für die gesamte Auswahl: „${sheetOpened.header}"`);
assert(sheetOpened.lagenVisible && sheetOpened.lagenButtons.length >= 5,
  `Lagen-Auswahl wird abgefragt (${sheetOpened.lagenButtons.join(', ')})`);
assert(/2,57/.test(sheetOpened.preview) || /m/.test(sheetOpened.preview),
  `Vorschau nennt die sich ergebende Länge: „${sheetOpened.preview}"`);

const applied = await page.evaluate(() => {
  const sheet = document.getElementById('bottomSheet');
  [...sheet.querySelectorAll('.klagen-btn')].find(b => b.textContent === '2 Lagen').click();
  const preview = sheet.querySelector('.bulk-pos-preview').textContent;
  sheet.querySelector('.sheet-ok').click();
  flushRender();
  const bays = allBaysFlat();
  const sel = [1, 2, 3, 4].map(i => bays[i]);
  return {
    preview,
    rows: sel.map(b => {
      const pos = b.positions.find(p => p.cat === 'innengelaender');
      return { len: b.len, qty: pos ? pos.qty : null, unit: pos ? pos.unit : null,
               meters: pos ? posMeters(pos, b) : null, warn: bayWarnings(b).join('|') };
    }),
    untouched: bays[0].positions.length + bays[5].positions.length
  };
});

assert(applied.rows.every(r => r.unit === 'lagen' && r.qty === 2),
  'alle ausgewählten Felder bekommen die gemeinsam gewählten 2 Lagen');
assert(applied.rows.every(r => Math.abs(r.meters - r.qty * r.len) < 0.001),
  'die Länge wird je Feld aus der EIGENEN Feldlänge gerechnet: '
  + applied.rows.map(r => `${r.len}→${r.meters}m`).join(', '));
assert(applied.rows.every(r => !r.warn.includes('Menge fehlt')),
  'kein Feld bleibt mit „Menge fehlt" zurück (früher jedes einzeln nachzuarbeiten)');
assert(applied.untouched === 0, 'nicht ausgewählte Felder bleiben unberührt');

// Erneutes Antippen entfernt das Bauteil wieder bei allen ausgewählten Feldern
const removed = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.bulk-pos-chip')]
    .find(c => c.textContent === 'Innengeländer');
  chip.click();
  flushRender();
  return allBaysFlat().filter(b => b.positions.some(p => p.cat === 'innengelaender')).length;
});
assert(removed === 0, 'sind alle bestückt, entfernt ein weiterer Klick das Bauteil wieder');

// Meter-Einheit ohne eigenen Wert = Feldlänge je Feld
const meterMode = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.bulk-pos-chip')]
    .find(c => c.textContent === 'Dachfang');
  chip.click();
  const sheet = document.getElementById('bottomSheet');
  const hint = sheet.querySelector('.bulk-pos-qty-hint').textContent;
  sheet.querySelector('.sheet-ok').click();
  flushRender();
  const bays = allBaysFlat();
  return { hint, rows: [1, 2, 3, 4].map(i => {
    const b = bays[i], pos = b.positions.find(p => p.cat === 'dachfang');
    return { len: b.len, eff: effQty(pos, b) };
  }) };
});
assert(/Feldlänge/.test(meterMode.hint), `Meter-Einheit erklärt die Vorgabe: „${meterMode.hint}"`);
assert(meterMode.rows.every(r => Math.abs(r.eff - r.len) < 0.001),
  'ohne eigenen Wert rechnet jedes Feld mit seiner eigenen Länge: '
  + meterMode.rows.map(r => `${r.len}→${r.eff}`).join(', '));

/* ══ Aufgabe 2: kopiertes Feld auf die Mehrfachauswahl anwenden ════════════ */

const copied = await page.evaluate(() => {
  const bays = allBaysFlat();
  const src = bays[0];
  src.hL = 9.5; src.hR = 7.25;
  src.note = 'Musterfeld';
  src.positions = [
    { id: ++_bId, cat: 'konsole', typ: '0,30', lagen: '3', billing: 'lagen' },
    { id: ++_bId, cat: 'innengelaender', qty: 2, unit: 'lagen' }
  ];
  const ab = addAbschnitt('Nordseite');
  src.abschnittId = ab.id;
  copyBayPositions(src);
  renderAll(); flushRender();
  return { abId: ab.id, hasClipboard: !!copiedBayData,
           scopeChips: [...document.querySelectorAll('.paste-scope-chip')].map(c => c.textContent.trim()) };
});
assert(copied.hasClipboard, 'Kopieren legt die vollständige Feld-Konfiguration ab');
assert(copied.scopeChips.length >= 4,
  `Umfang des Einfügens ist einstellbar: ${copied.scopeChips.join(' / ')}`);

const bulkPasted = await page.evaluate(() => {
  bulkSelected.clear();
  const bays = allBaysFlat();
  [1, 2, 3, 4].forEach(i => bulkSelected.add(bays[i].id));
  renderAll(); flushRender();
  const btn = document.querySelector('.bulk-paste-apply-btn');
  const label = btn.textContent;
  btn.click();
  flushRender();
  const after = allBaysFlat();
  return {
    label,
    targets: [1, 2, 3, 4].map(i => {
      const b = after[i];
      const k = b.positions.find(p => p.cat === 'konsole');
      const ig = b.positions.find(p => p.cat === 'innengelaender');
      return { len: b.len, hL: b.hL, hR: b.hR, note: b.note, ab: b.abschnittId,
               kons: k ? k.typ + '/' + k.lagen : null, ig: ig ? ig.qty : null,
               igMeters: ig ? posMeters(ig, b) : null,
               ids: b.positions.map(p => p.id) };
    }),
    srcIds: after[0].positions.map(p => p.id),
    untouched: { len: after[5].len, pos: after[5].positions.length, note: after[5].note }
  };
});

assert(/4 Felder/.test(bulkPasted.label), `Knopf nennt die Zielanzahl: „${bulkPasted.label}"`);
assert(bulkPasted.targets.every(t => t.kons === '0,30/3' && t.ig === 2),
  'Zusatzbauteile werden inklusive Typ und Lagen auf alle Felder übertragen');
assert(bulkPasted.targets.every(t => t.hL === 9.5 && t.hR === 7.25),
  'Höhen werden übertragen');
assert(bulkPasted.targets.every(t => t.ab === copied.abId && t.note === 'Musterfeld'),
  'Abschnitt und Notiz werden übertragen');
assert(bulkPasted.targets.map(t => t.len).join() === '3.07,2.07,2.57,1.57',
  `die Feldlänge bleibt feldspezifisch (${bulkPasted.targets.map(t => t.len).join(', ')})`);
assert(bulkPasted.targets.every(t => Math.abs(t.igMeters - 2 * t.len) < 0.001),
  'die Mengen rechnen danach mit der jeweils eigenen Feldlänge weiter');
assert(bulkPasted.targets.every(t => t.ids.every(id => !bulkPasted.srcIds.includes(id))),
  'jedes Ziel bekommt eigene Positions-IDs (keine geteilten Objekte)');
assert(bulkPasted.untouched.pos === 0 && bulkPasted.untouched.note === '' &&
       bulkPasted.untouched.len === 2.57,
  'nicht ausgewählte Felder bleiben unverändert');

// Umfang abwählen wirkt sofort
const scoped = await page.evaluate(() => {
  const bays = allBaysFlat();
  bays[5].hL = 4; bays[5].hR = 4; bays[5].note = 'bleibt';
  bulkSelected.clear(); bulkSelected.add(bays[5].id);
  renderAll(); flushRender();
  // „Höhen" und „Notiz" abwählen
  [...document.querySelectorAll('.paste-scope-chip')]
    .filter(c => /Höhen|Notiz/.test(c.textContent)).forEach(c => c.click());
  document.querySelector('.bulk-paste-apply-btn').click();
  flushRender();
  const b = allBaysFlat()[5];
  return { hL: b.hL, note: b.note, pos: b.positions.length };
});
assert(scoped.hL === 4 && scoped.note === 'bleibt' && scoped.pos === 2,
  'abgewählte Eigenschaften (Höhen, Notiz) bleiben beim Ziel unangetastet');

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 2 / Aufgabe 2+3 bestanden.');
await ctx.close();
