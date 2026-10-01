import { open, assert } from './harness.mjs';

const ctx = await open();
try {
  const { page } = ctx;
  const result = await page.evaluate(() => {
    state.sections = []; state.abschnitte = []; state.ecken = {}; state.aufmass = null;
    _sId = 0; _bId = 0;
    const a = mkSection('E', 0, 0); a.bays.push(mkBay(2.57));
    state.sections.push(a);
    const b = mkSection('S', sectionEnd(a).x, sectionEnd(a).y); b.bays.push(mkBay(2.57));
    state.sections.push(b);
    const c = mkSection('W', sectionEnd(b).x, sectionEnd(b).y); c.bays.push(mkBay(2.57));
    state.sections.push(c);
    state.sections.forEach(s => s.bays.forEach(f => {
      f.hL = 8; f.hR = 8; f.positions = [mkPosition('netz'), mkPosition('plane')];
    }));
    const ecken = eckenListe();
    ecken.forEach(e => ['netz', 'plane'].forEach(cat => setEckStirnseite(e.key, cat, b.id)));
    return { ecken: ecken.length, rows: aggregatePositions(allBaysFlat()).filter(a => a.stirnseite)
      .map(a => ({ n: a.n, text: aggQtyText(a), menge: a.qtyByUnit.m2 })) };
  });
  assert(result.ecken === 2, 'Testfall enthält zwei Ecken am selben Feld');
  assert(result.rows.length === 4 && result.rows.every(r => r.n === 1 && r.text.includes('5,84')),
    'beide Stirnseiten werden für Netz und Plane einzeln mit vollständigem Rechenweg ausgewiesen');

  for (const breite of [0.5, 0.73, 0.735, 0.81, 0.97, 1.09, 1.23]) {
    const r = await page.evaluate(async breite => {
      state.depth = breite;
      const b = state.sections[1].bays[0]; b.hL = 9.5; b.hR = 10;
      renderAll(); flushRender();
      const rows = aggregatePositions(allBaysFlat()).filter(a => a.stirnseite);
      window.__pdfSaved = null;
      await buildPdf('farbe');
      return {
        rows: rows.map(a => ({ label: a.label, m2: a.qtyByUnit.m2, text: aggQtyText(a) })),
        pdf: window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => c[2]),
        laengen: state.sections.map(s => s.bays[0].len)
      };
    }, breite);
    const erwartet = +(breite * 9.5).toFixed(3);
    assert(r.rows.length === 4 && r.rows.every(a => Math.abs(a.m2 - erwartet) < 0.00001),
      breite + ' m: Netz und Plane, beide Ecken, kleinere Feldhöhe 9,50 m');
    assert(r.rows.every(a => r.pdf.includes(a.label) && r.pdf.includes(a.text)),
      breite + ' m: vollständige getrennte Rechnungen im PDF');
    assert(r.laengen.every(n => n === 2.57), 'Stirnseiten verändern keine Feldlänge');
  }
  await page.evaluate(() => openProjektSheet());
  await page.fill('#scaffDepth', '0,73');
  await page.locator('#scaffDepth').blur();
  assert(await page.evaluate(() => state.depth === 0.73), 'deutsches Dezimalkomma wird als 0,73 m gelesen');
  await page.selectOption('#scaffDepthUnit', 'cm');
  await page.fill('#scaffDepth', '81');
  await page.locator('#scaffDepth').blur();
  assert(await page.evaluate(() => state.depth === 0.81), '81 cm über die sichtbare Einheitenwahl');
  await page.fill('#scaffDepth', '73 cm');
  await page.locator('#scaffDepth').blur();
  assert(await page.evaluate(() => state.depth === 0.73), '73 cm mit expliziter Einheit');
  await page.fill('#scaffDepth', 'falsch');
  await page.locator('#scaffDepth').blur();
  assert(await page.evaluate(() => state.depth === 0.73), 'ungültige Eingaben verändern die Tiefe nicht');
  assert(await page.getAttribute('#scaffDepth', 'aria-invalid') === 'true', 'Eingabefehler wird sichtbar markiert');
  await page.evaluate(() => closeSheet());
  assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0, 'keine JavaScript-Fehler');
} finally { await ctx.close(); }
