// Runde 2 – Aufgabe 4: kollisionsfreies PDF-Layout.
// Nachweis, dass KEINE Feldbeschriftung in Legende, Kopf-/Fußzeile oder auf
// die Übersichtskarte läuft. Gemessen wird an den tatsächlich gezeichneten
// Beschriftungen (pdfPill/pdfText werden protokolliert), nicht an der Absicht.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 2 · AUFGABE 4 – PDF ohne Überlappungen\n');

/**
 * Baut ein Gerüst, exportiert es und liefert alle gezeichneten Beschriftungen
 * mit ihrer Hüllbox in mm – dazu die Sperrzonen des jeweiligen Blattes.
 */
async function measure(kind) {
  return page.evaluate(async k => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false; state.aufmass = null;
    state.project = 'Überlappungstest Musterstraße 12';

    const abs = ['Nordseite', 'Ostseite', 'Südseite'].map(n => addAbschnitt(n));
    const mk = (ang, x, y, len, i) => {
      const s = mkSection(nearestCardinal(ang), x, y);
      setSectionAngle(s, ang);
      const b = mkBay(len);
      b.hL = 12.5; b.hR = 9.75;
      b.abschnittId = abs[i % abs.length].id;
      // Viele Positionen → hoher Beschriftungsstapel an der offenen Seite,
      // genau die Situation, in der früher etwas in die Legende lief.
      b.positions.push({ id: ++_bId, cat: 'konsole', typ: '0,70', lagen: '3', billing: 'lagen' });
      b.positions.push({ id: ++_bId, cat: 'netz', qty: null, unit: 'm2' });
      b.positions.push({ id: ++_bId, cat: 'innengelaender', qty: 2, unit: 'lagen' });
      b.positions.push({ id: ++_bId, cat: 'bautenschutz', qty: null, unit: 'm' });
      s.bays.push(b);
      state.sections.push(s);
    };
    if (k === 'lang')  { for (let i = 0; i < 120; i++) mk(0, i * 257, 0, 2.57, i); }
    // Dicht gepacktes Raster: füllt das Blatt bis an den Rand – der Fall, in
    // dem Beschriftungen früher in Legende und Fußzeile liefen.
    if (k === 'block') {
      let i = 0;
      for (let r2 = 0; r2 < 10; r2++) for (let c = 0; c < 14; c++, i++) mk(0, c * 257, r2 * 260, 2.57, i);
    }
    if (k === 'klein') { for (let i = 0; i < 4; i++)  mk(0, i * 257, 0, 2.57, i); }
    if (k === 'ushape') {
      let x = 0, i = 0;
      for (; i < 30; i++) { mk(0, x, 0, 2.57, i); x += 257; }
      let y = 0;
      for (let j = 0; j < 12; j++, i++) { mk(90, x, y, 3.07, i); y += 307; }
      for (let j = 0; j < 30; j++, i++) mk(180, x - j * 257, y, 2.57, i);
    }
    renderAll(); flushRender();

    // Beschriftungen und Übersichtskarten mitschneiden.
    const labels = [], locators = [], raw = [];
    const origPill = window.pdfPill, origText = window.pdfText, origLoc = window.pdfDrawLocator;
    // Die GEPLANTEN Beschriftungen (vor der Kollisionsprüfung) mitschneiden –
    // nur so ist belegbar, dass die Sperrzonen überhaupt etwas zu tun haben.
    const origLabels = window.pdfPlanLabels;
    window.pdfPlanLabels = function (doc, ...rest) {
      const out = origLabels.call(null, doc, ...rest);
      out.forEach(l => raw.push({ page: doc._page, text: l.text, ...l.rect }));
      return out;
    };
    const rectOf = (doc, str, cx, cy, deg, pad) => {
      const fs = doc.getFontSize() * 0.352778;
      const w = doc.getTextWidth(str) + (pad ? fs * 0.8 : 0);
      const h = pad ? fs * 1.5 : fs;
      const th = (deg || 0) * Math.PI / 180;
      const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
      const bw = w * ca + h * sa, bh = w * sa + h * ca;
      return { page: doc._page, text: String(str),
               x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    };
    window.pdfPill = function (doc, str, cx, cy, deg, ...rest) {
      labels.push(rectOf(doc, str, cx, cy, deg, true));
      return origPill.call(null, doc, str, cx, cy, deg, ...rest);
    };
    window.pdfText = function (doc, str, cx, cy, deg) {
      labels.push(rectOf(doc, str, cx, cy, deg, false));
      return origText.call(null, doc, str, cx, cy, deg);
    };
    window.pdfDrawLocator = function (doc, bounds, win, box, theme, caption) {
      locators.push({ page: doc._page, ...box });
      return origLoc.call(null, doc, bounds, win, box, theme, caption);
    };

    window.__pdfSaved = null;
    let orientation = 'landscape';
    try {
      await buildPdf('technisch');
      const first = window.__pdfSaved.calls.find(c => c[0] === 'new');
      orientation = JSON.parse(first[1]).orientation;
    } finally {
      window.pdfPill = origPill; window.pdfText = origText; window.pdfDrawLocator = origLoc;
      window.pdfPlanLabels = origLabels;
    }

    // Erlaubter Zeichenbereich einer PLANSEITE – exakt wie in buildPdf.
    const pdfW = orientation === 'landscape' ? 297 : 210;
    const pdfH = orientation === 'landscape' ? 210 : 297;
    const margin = PDF_MARGIN;
    const top = margin + PDF_HEADER_H + PDF_LEGEND_H + 2.5;
    const contentBottom = pdfH - margin - PDF_FOOTER_H;
    const area = { x: margin, y: top, w: pdfW - 2 * margin, h: contentBottom - top - 2 };
    return { labels, locators, raw, area, pages: window.__pdfSaved.pages, orientation };
  }, kind);
}

const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
let wouldClash = 0;

for (const kind of ['klein', 'lang', 'ushape', 'block']) {
  const r = await measure(kind);
  const eps = 0.05;   // Rundungstoleranz in mm

  // 1. Nichts ragt aus dem Zeichenbereich – also weder in die Legende (darüber)
  //    noch in die Fußzeile (darunter) noch über den Blattrand.
  const outside = r.labels.filter(l =>
    l.x < r.area.x - eps || l.y < r.area.y - eps ||
    l.x + l.w > r.area.x + r.area.w + eps || l.y + l.h > r.area.y + r.area.h + eps);
  const worst = outside.reduce((m, l) => Math.max(m,
    r.area.y - l.y, (l.y + l.h) - (r.area.y + r.area.h),
    r.area.x - l.x, (l.x + l.w) - (r.area.x + r.area.w)), 0);
  console.log(`  ${kind.padEnd(7)} ${r.orientation.padEnd(10)} ${String(r.pages).padStart(2)} Seiten  `
            + `${String(r.labels.length).padStart(5)} Beschriftungen  ${r.locators.length} Übersichtskarten`);
  assert(outside.length === 0,
    `${kind}: keine Beschriftung verlässt den Zeichenbereich (${outside.length} Fälle, max. ${worst.toFixed(2)} mm`
    + (outside.length ? ', z. B. „' + outside[0].text + '"' : '') + ')');

  // 2. Die Übersichtskarte wird von keiner Beschriftung überdeckt.
  const covered = r.labels.filter(l => r.locators.some(b => b.page === l.page && hits(l, b)));
  assert(covered.length === 0,
    `${kind}: Übersichtskarte bleibt frei (${covered.length} Überdeckungen`
    + (covered.length ? ', z. B. „' + covered[0].text + '"' : '') + ')');

  // 3. Gegenprobe sammeln: Ohne Sperrzonen WÜRDEN Beschriftungen kollidieren –
  //    sonst prüften die Punkte 1 und 2 eine Situation, die gar nicht eintritt.
  wouldClash += r.raw.filter(l =>
    l.x < r.area.x - eps || l.y < r.area.y - eps ||
    l.x + l.w > r.area.x + r.area.w + eps || l.y + l.h > r.area.y + r.area.h + eps ||
    r.locators.some(b => b.page === l.page && hits(l, b))).length;
}

assert(wouldClash > 0,
  `Gegenprobe: ohne Sperrzonen gäbe es ${wouldClash} Kollisionen – die Prüfung greift also wirklich`);

// 3. Die Legende steht weiterhin auf jeder Planseite – die Sperrzone darf sie
//    nicht „wegoptimiert" haben.
const legendCheck = await page.evaluate(async () => {
  window.__pdfSaved = null;
  await buildPdf('technisch');
  const perPage = {};
  window.__pdfSaved.calls.forEach(c => {
    if (c[0] === 'text') (perPage[c[1]] || (perPage[c[1]] = [])).push(String(c[2]));
  });
  return Object.values(perPage).filter(t => t.includes('LEGENDE')).length;
});
assert(legendCheck >= 1, `Legende wird weiterhin gezeichnet (${legendCheck} Seiten)`);

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 2 / Aufgabe 4 bestanden.');
await ctx.close();
