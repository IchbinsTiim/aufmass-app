import { open, seedFields, assert } from './harness.mjs';

const N = Number(process.argv[2] || 80);
const ctx = await open();
const { page } = ctx;
console.log(`AUFGABE 2 – Rotations-Bug & Performance (${N} Felder)\n`);

await seedFields(page, N);
await page.waitForTimeout(100);

// Zähler um renderSvg/renderSections legen
await page.evaluate(() => {
  window.__c = { svg: 0, sections: 0, bulk: 0 };
  const rs = window.renderSvg, rc = window.renderSections, rb = window.renderBulkBar;
  window.renderSvg      = function () { window.__c.svg++;      return rs.apply(this, arguments); };
  window.renderSections = function () { window.__c.sections++; return rc.apply(this, arguments); };
  window.renderBulkBar  = function () { window.__c.bulk++;     return rb.apply(this, arguments); };
});

// ── 1. Tipp auf die Feldmitte wählt das Feld aus und öffnet Bearbeiten ─────
const mid = await page.evaluate(() => {
  const r = document.querySelectorAll('#planGroup polygon')[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const t0 = Date.now();
await page.mouse.click(mid.x, mid.y);
await page.waitForSelector('#bottomSheet', { timeout: 4000 });
const dtOpen = Date.now() - t0;
assert(dtOpen < 1500, `Tipp mitten auf das Feld öffnet die Bearbeitung (${dtOpen} ms)`);
assert(await page.evaluate(() => selectedSi === 0 && selectedBi === 0),
  'genau dieses Feld ist ausgewählt (nicht die ganze Fläche)');
assert(await page.evaluate(() => !bulkMode && bulkSelected.size === 0),
  'Tipp löst KEINE Mehrfachauswahl/Kopieraktion aus');

// ── 2. Auswahl bleibt bestehen (kein Abwählen durch den Folge-Klick) ──────
await page.waitForTimeout(250);
assert(await page.evaluate(() => selectedSi === 0),
  'Auswahl bleibt nach dem Tipp bestehen');

// ── 3. Rotationsregler: viele input-Events → wenige Neuzeichnungen ────────
const rot = await page.evaluate(async () => {
  const sl = document.getElementById('rotSlider');
  window.__c.svg = 0; window.__c.sections = 0;
  const t = performance.now();
  for (let i = 0; i < 60; i++) {
    sl.value = String(i * 3);
    sl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const blocked = performance.now() - t;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { blocked, renders: window.__c.svg, sidebar: window.__c.sections,
           deg: Math.round(secAngle(state.sections[selectedSi])) };
});
assert(rot.renders <= 3, `60 Regler-Events → nur ${rot.renders} Neuzeichnung(en) statt 60`);
assert(rot.blocked < 120, `Regler blockiert den Hauptthread nur ${rot.blocked.toFixed(0)} ms`);
assert(rot.sidebar === 0, 'der Regler baut die Feldliste gar nicht neu auf');
assert(rot.deg === 180, `Drehwinkel folgt dem Regler und rastet ein (${rot.deg}°)`);

// ── 4. Tippen in ein Zahlenfeld ───────────────────────────────────────────
const typing = await page.evaluate(async () => {
  const inp = document.querySelector('.height-inp');
  window.__c.svg = 0;
  const t = performance.now();
  '1234567890'.split('').forEach((ch, i) => {
    inp.value = '1234567890'.slice(0, i + 1);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const blocked = performance.now() - t;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { blocked, renders: window.__c.svg };
});
assert(typing.renders <= 2, `10 Tastenanschläge → ${typing.renders} Neuzeichnung(en)`);
assert(typing.blocked < 80, `Tippen blockiert nur ${typing.blocked.toFixed(0)} ms`);

await page.evaluate(() => closeSheet());
await page.waitForTimeout(300);

// ── 5. Drehgriff: Tipp = 90°, Ziehen = frei ───────────────────────────────
const handleAt = await page.evaluate(() => {
  selectedSi = 3; selectedBi = 0;
  renderAll(); flushRender();
  const secBefore = Math.round(secAngle(state.sections[3]));
  // Drehgriff = unsichtbarer Trefferkreis mit data-si und cursor:grab
  const hit = [...document.querySelectorAll('#planGroup circle[data-si="3"]')]
    .find(c => (c.getAttribute('style') || '').includes('grab'));
  const r = hit.getBoundingClientRect();
  return { before: secBefore, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(handleAt.x, handleAt.y);
await page.waitForTimeout(120);
const afterTap = await page.evaluate(() => Math.round(secAngle(state.sections[3])));
assert(afterTap === (handleAt.before + 90) % 360,
  `Tipp auf den Drehgriff dreht sofort um 90° (${handleAt.before}° → ${afterTap}°)`);

// Ziehen dreht frei (Griff sitzt nach der Drehung woanders → neu ermitteln)
const h2 = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('#planGroup circle[data-si="3"]')]
    .find(c => (c.getAttribute('style') || '').includes('grab'));
  const r = hit.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(h2.x, h2.y);
await page.mouse.down();
await page.mouse.move(h2.x + 120, h2.y - 90, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(120);
const afterDrag = await page.evaluate(() => Math.round(secAngle(state.sections[3])));
assert(afterDrag !== afterTap, `Ziehen am Drehgriff dreht weiterhin frei (${afterDrag}°)`);

// ── 6. Verschiebe-Griff verdeckt das Feld nicht mehr ──────────────────────
const cover = await page.evaluate(() => {
  const poly = document.querySelectorAll('#planGroup polygon')[0];
  const pr = poly.getBoundingClientRect();
  const hit = [...document.querySelectorAll('#planGroup circle[data-si="0"]')]
    .find(c => (c.getAttribute('style') || '').includes('move'));
  const hr = hit.getBoundingClientRect();
  return { field: pr.width * pr.height, handle: Math.PI * (hr.width / 2) ** 2 };
});
assert(cover.handle / cover.field < 0.35,
  `Trefferfläche des Verschiebe-Griffs deckt nur ${(100 * cover.handle / cover.field).toFixed(0)} % des Feldes ab`);

// ── 7. Text-/Bereichsauswahl ist unterbunden („alles blau markiert") ──────
const sel = await page.evaluate(() => {
  const cs = el => getComputedStyle(el);
  const svg = document.getElementById('planSvg');
  const panel = document.getElementById('viewerPanel');
  const side = document.getElementById('sidePanel');
  const inp = document.getElementById('projectName');
  return {
    svg: cs(svg).userSelect || cs(svg).webkitUserSelect,
    panel: cs(panel).userSelect,
    side: cs(side).userSelect,
    input: cs(inp).userSelect
  };
});
assert(sel.svg === 'none' && sel.panel === 'none' && sel.side === 'none',
  `Zeichenfläche/Seitenleiste sind nicht markierbar (${JSON.stringify(sel)})`);
assert(sel.input === 'text' || sel.input === 'auto',
  'Text in Eingabefeldern bleibt normal markierbar');

// ── 8. Performance des Neuaufbaus ─────────────────────────────────────────
const perf = await page.evaluate(() => {
  const t1 = performance.now(); for (let i = 0; i < 10; i++) renderSvg();
  const svgMs = (performance.now() - t1) / 10;
  const t2 = performance.now(); for (let i = 0; i < 5; i++) renderSections();
  const secMs = (performance.now() - t2) / 5;
  const t3 = performance.now(); for (let i = 0; i < 50; i++) computeLayout();
  const layMs = (performance.now() - t3) / 50;
  return { svgMs, secMs, layMs };
});
console.log(`  · renderSvg ${perf.svgMs.toFixed(1)} ms · renderSections ${perf.secMs.toFixed(1)} ms · computeLayout ${perf.layMs.toFixed(2)} ms`);
assert(perf.layMs < 1.5, `computeLayout bleibt bei ${N} Feldern unter 1,5 ms (${perf.layMs.toFixed(2)} ms)`);

// ── 9. Stehengebliebene Klick-Sperre nach Wischen ─────────────────────────
const stale = await page.evaluate(() => {
  canvasJustMoved = true;                 // simuliert: Wisch ohne Folge-Klick
  const svg = document.getElementById('planSvg');
  svg.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 500, clientY: 400, bubbles: true }));
  const after = canvasJustMoved;
  svg.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, clientX: 500, clientY: 400, bubbles: true }));
  return after;
});
assert(stale === false, 'eine stehengebliebene Klick-Sperre verfällt beim nächsten Antippen');

const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));
console.log('\nAlle Tests zu Aufgabe 2 bestanden.');
await ctx.close();
