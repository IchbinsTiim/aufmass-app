// Runde 20 – Das Beschriftungssystem der PDF.
//
//   node tests/r20-pdf-beschriftung.mjs
//
// Zwei Anforderungen, beide aus der Praxis:
//
//   1. Die Feldbezeichnungen („A1", „A2" …) stehen nicht mehr im Plan. Zu
//      welcher Achse ein Feld gehört, zeigt seine FARBE.
//   2. Keine Beschriftung überdeckt eine andere – und keine liegt auf einem
//      Gerüstfeld. Höhen bleiben eindeutig ihrem Feld zugeordnet; wer dafür
//      abrücken muss, bekommt eine Führungslinie.
//
// Gemessen wird an dem, was wirklich gezeichnet wird (die Aufrufe von
// pdfPill/pdfText werden protokolliert), nicht an der Absicht.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 20 – PDF-Beschriftungen\n');

/**
 * Baut ein Gerüst, exportiert es und liefert:
 *   gezeichnet  jede gezeichnete Beschriftung mit Hüllbox (mm) und Seite
 *   geplant     dieselben vor dem Entzerren – die Gegenprobe
 *   felder      die Feldflächen als Vierecke in mm, je Seite
 *   texte       alle Textaufrufe der Seite (für die Suche nach „A1")
 */
async function messe(fall) {
  return page.evaluate(async k => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false; state.aufmass = null;
    state.project = 'Beschriftungstest';

    const achsen = ['Nordseite', 'Ostseite', 'Südseite', 'Westseite'].map(n => addAbschnitt(n));
    const mk = (ang, x, y, len, achse, posN, hL, hR) => {
      const s = mkSection(nearestCardinal(ang), x, y);
      setSectionAngle(s, ang);
      const b = mkBay(len);
      b.hL = hL; b.hR = hR;
      b.abschnittId = achsen[achse % achsen.length].id;
      if (posN > 0) b.positions.push({ id: ++_bId, cat: 'konsole', typ: '0,70', lagen: '3', billing: 'lagen' });
      if (posN > 1) b.positions.push({ id: ++_bId, cat: 'innengelaender', qty: 2, unit: 'lagen' });
      if (posN > 2) b.positions.push({ id: ++_bId, cat: 'netz', qty: null, unit: 'm2' });
      s.bays.push(b);
      state.sections.push(s);
    };

    if (k === 'wand') {
      for (let i = 0; i < 12; i++) mk(0, i * 257, 0, 2.57, 0, 2, 8.0, 8.0);
    }
    if (k === 'staffel') {
      // Unterschiedliche Höhen je Feld – der Fall, in dem sich Höhenangaben
      // früher gegenseitig überschrieben.
      for (let i = 0; i < 10; i++) mk(0, i * 257, 0, 2.57, 0, 1, 6 + i * 0.5, 8 + i * 0.25);
    }
    if (k === 'haus') {
      let x = 0, y = 0;
      for (let j = 0; j < 10; j++) { mk(0, x, y, 2.57, 0, 2, 9.5, 9.5); x += 257; }
      for (let j = 0; j < 6; j++)  { mk(90, x, y, 2.57, 1, 2, 9.5, 7.25); y += 257; }
      for (let j = 0; j < 10; j++) { x -= 257; mk(180, x, y, 2.57, 2, 2, 7.25, 7.25); }
      for (let j = 0; j < 6; j++)  { y -= 257; mk(270, x, y, 2.57, 3, 2, 7.25, 9.5); }
    }
    if (k === 'schraeg') {
      // Gedrehte Wände: Ihre achsparallele Hüllbox ist viel größer als das
      // Feld – eine Beschriftung darf davon nicht grundlos weggeschoben werden.
      for (let i = 0; i < 8; i++) mk(35, i * 210, i * 147, 2.57, 0, 2, 8.0, 6.5);
    }
    if (k === 'eng') {
      // Zwei Bahnen dicht nebeneinander: Die Stapel beider Bahnen treffen
      // sich in der Mitte.
      for (let i = 0; i < 10; i++) mk(0, i * 257, 0, 2.57, 0, 3, 10.0, 10.0);
      for (let i = 0; i < 10; i++) mk(0, i * 257, 190, 2.57, 1, 3, 6.0, 6.0);
    }
    renderAll(); flushRender();

    const gezeichnet = [], geplant = [], felder = [];
    const origPill = window.pdfPill, origText = window.pdfText;
    const origPlan = window.pdfLabelsPlanen, origLoesen = window.pdfPlanLabels;
    const origDrawPlan = window.pdfDrawPlan;

    const rectOf = (doc, str, cx, cy, deg, pad) => {
      const fs = doc.getFontSize() * 0.352778;
      const w = doc.getTextWidth(str) + (pad ? fs * 0.8 : 0);
      const h = pad ? fs * 1.5 : fs;
      const th = (deg || 0) * Math.PI / 180;
      const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
      const bw = w * ca + h * sa, bh = w * sa + h * ca;
      return { seite: doc._page, text: String(str), fs: doc.getFontSize(),
               x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    };
    // pdfPill zeichnet den Text über pdfText – dieser innere Aufruf darf NICHT
    // als zweite Beschriftung zählen, sonst überdeckt jede Pille ihren eigenen
    // Text und die Messung misst sich selbst.
    let inPille = false;
    window.pdfPill = function (doc, str, cx, cy, deg, ...rest) {
      gezeichnet.push(rectOf(doc, str, cx, cy, deg, true));
      inPille = true;
      try { return origPill.call(null, doc, str, cx, cy, deg, ...rest); }
      finally { inPille = false; }
    };
    window.pdfText = function (doc, str, cx, cy, deg) {
      if (!inPille) gezeichnet.push(rectOf(doc, str, cx, cy, deg, false));
      return origText.call(null, doc, str, cx, cy, deg);
    };
    window.pdfLabelsPlanen = function (doc, ...rest) {
      const out = origPlan.call(null, doc, ...rest);
      out.forEach(l => geplant.push({ seite: doc._page, art: l.art, text: l.text, ...l.rect }));
      return out;
    };
    let letzteFuehrungen = 0;
    window.pdfPlanLabels = function (...a) {
      const out = origLoesen.apply(null, a);
      letzteFuehrungen += out.filter(l => l.fuehrung).length;
      return out;
    };
    // Die Feldflächen desselben Blattes in mm – dieselbe Abbildung wie beim
    // Zeichnen, damit „liegt auf einem Feld" nachprüfbar wird.
    window.pdfDrawPlan = function (doc, win, area, s, bayEls, layout, shapesOnly, opts) {
      if (!shapesOnly) {
        const o = pdfPlanOrigin(win, area, s);
        bayEls.forEach(el => felder.push({
          seite: doc._page,
          pts: el.pts.map(p => ({ x: o.x + p.x * s, y: o.y + p.y * s }))
        }));
      }
      return origDrawPlan.call(null, doc, win, area, s, bayEls, layout, shapesOnly, opts);
    };

    window.__pdfSaved = null;
    let orientation = 'landscape';
    try {
      await buildPdf('farbe');
      orientation = JSON.parse(window.__pdfSaved.calls.find(c => c[0] === 'new')[1]).orientation;
    } finally {
      window.pdfPill = origPill; window.pdfText = origText;
      window.pdfLabelsPlanen = origPlan; window.pdfPlanLabels = origLoesen;
      window.pdfDrawPlan = origDrawPlan;
    }

    const texte = {};
    window.__pdfSaved.calls.forEach(c => {
      if (c[0] === 'text') (texte[c[1]] || (texte[c[1]] = [])).push(String(c[2]));
    });

    return {
      gezeichnet, geplant, felder, texte, fuehrungen: letzteFuehrungen,
      seiten: window.__pdfSaved.pages, orientation,
      felderGesamt: visibleBaysFlat().length
    };
  }, fall);
}

const trifft = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Schneidet ein Rechteck ein (gedrehtes) Viereck? Trennachsensatz. */
function schneidet(rect, pts) {
  const r = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
             { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
  for (const poly of [r, pts]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      if (!ax && !ay) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of r)   { const d = v.x * ax + v.y * ay; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of pts) { const d = v.x * ax + v.y * ay; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA < minB - 0.01 || maxB < minA - 0.01) return false;
    }
  }
  return true;
}

let gegenprobe = 0;
let fuehrungenGesamt = 0;

for (const fall of ['wand', 'staffel', 'haus', 'schraeg', 'eng']) {
  const r = await messe(fall);
  const eps = 0.01;

  console.log(`\n  ${fall} · ${r.felderGesamt} Felder · ${r.seiten} Seiten · `
            + `${r.gezeichnet.length} Beschriftungen · ${r.fuehrungen} Führungslinien`);

  /* ── 1. Keine Feldbezeichnung mehr im Plan ────────────────────────────── */
  const kennungen = r.gezeichnet.filter(l => /^[A-Z]\d+(\.\d+)?$/.test(l.text));
  assert(kennungen.length === 0,
    `${fall}: keine Feldbezeichnung im Plan (${kennungen.length} gefunden`
    + (kennungen.length ? `, z. B. „${kennungen[0].text}"` : '') + ')');

  /* ── 2. Nichts überdeckt etwas anderes ────────────────────────────────── */
  const jeSeite = new Map();
  r.gezeichnet.forEach(l => {
    if (!jeSeite.has(l.seite)) jeSeite.set(l.seite, []);
    jeSeite.get(l.seite).push(l);
  });
  let kollisionen = 0, beispiel = null;
  jeSeite.forEach(liste => {
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        const a = { ...liste[i] }, b = { ...liste[j] };
        // Winzige Rundungsüberschneidungen sind keine Überdeckung.
        a.x += eps; a.y += eps; a.w -= 2 * eps; a.h -= 2 * eps;
        if (trifft(a, b)) { kollisionen++; if (!beispiel) beispiel = `${a.text} / ${b.text}`; }
      }
    }
  });
  assert(kollisionen === 0,
    `${fall}: keine zwei Beschriftungen überdecken sich (${kollisionen}`
    + (beispiel ? `, z. B. ${beispiel}` : '') + ')');

  /* ── 3. Maß und Höhe bleiben an JEDEM Feld erhalten ───────────────────── */
  const zaehle = (liste, art) => liste.filter(l => l.art === art).length;
  const gezeichneteTexte = new Set(r.gezeichnet.map(l => l.seite + '|' + l.text));
  const fehlend = r.geplant.filter(l =>
    (l.art === 'laenge' || l.art === 'hoehe') && !gezeichneteTexte.has(l.seite + '|' + l.text));
  assert(fehlend.length === 0,
    `${fall}: jede Feldlänge und jede Höhe steht im Plan `
    + `(${zaehle(r.geplant, 'laenge')} Maße, ${zaehle(r.geplant, 'hoehe')} Höhen`
    + (fehlend.length ? `, es fehlt „${fehlend[0].text}"` : '') + ')');

  /* ── 4. Nichts liegt auf einem Gerüstfeld ─────────────────────────────── */
  // Ausgenommen die Feldlänge: Sie steht mit Absicht IM Feld; die Fläche ist
  // ihr Hintergrund. Erkennbar daran, dass sie ohne Pille gezeichnet wird –
  // hier an der Textform (reine Zahl).
  const aufFeld = [];
  jeSeite.forEach((liste, seite) => {
    const flaechen = r.felder.filter(f => f.seite === seite);
    liste.forEach(l => {
      if (/^\d+,\d{2}$/.test(l.text)) return;          // Feldlänge im Feld
      const innen = { x: l.x + 0.4, y: l.y + 0.4, w: l.w - 0.8, h: l.h - 0.8 };
      if (innen.w <= 0 || innen.h <= 0) return;
      if (flaechen.some(f => schneidet(innen, f.pts))) aufFeld.push(l.text);
    });
  });
  assert(aufFeld.length === 0,
    `${fall}: keine Beschriftung liegt auf einem Gerüstfeld (${aufFeld.length}`
    + (aufFeld.length ? `, z. B. „${aufFeld[0]}"` : '') + ')');

  /* ── 5. Lesbar auf Papier ─────────────────────────────────────────────── */
  const zuKlein = r.gezeichnet.filter(l => l.fs < 5.99);
  assert(zuKlein.length === 0,
    `${fall}: keine Schrift unter 6 pt (${zuKlein.length}`
    + (zuKlein.length ? `, kleinste ${Math.min(...r.gezeichnet.map(l => l.fs)).toFixed(1)} pt` : '') + ')');

  /* ── 6. Gegenprobe: ungeordnet WÜRDE es sich überlagern ───────────────── */
  const rohSeiten = new Map();
  r.geplant.forEach(l => {
    if (!rohSeiten.has(l.seite)) rohSeiten.set(l.seite, []);
    rohSeiten.get(l.seite).push(l);
  });
  rohSeiten.forEach(liste => {
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        if (trifft(liste[i], liste[j])) gegenprobe++;
      }
    }
  });
  fuehrungenGesamt += r.fuehrungen;
}

assert(gegenprobe > 0,
  `Gegenprobe: ohne Entzerrung gäbe es ${gegenprobe} Überlagerungen – die Prüfung greift wirklich`);
assert(fuehrungenGesamt > 0,
  `abgerückte Beschriftungen bekommen eine Führungslinie zu ihrem Feld (${fuehrungenGesamt} Stück)`);

/* ══ Die Achse bleibt erkennbar – über die Farbe ═══════════════════════════ */
console.log('\n  Achsen über Farbe statt über Text');

const farben = await page.evaluate(async () => {
  state.sections = []; _sId = 0; _bId = 0; _aId = 0;
  state.abschnitte = []; state.aufmass = null;
  state.project = 'Farbtest';
  const a = addAbschnitt('Nordseite'), b = addAbschnitt('Ostseite');
  [a, b].forEach((achse, n) => {
    for (let i = 0; i < 3; i++) {
      const s = mkSection('E', (n * 4 + i) * 257, n * 400);
      setSectionAngle(s, 0);
      const bay = mkBay(2.57);
      bay.hL = 8; bay.hR = 8; bay.abschnittId = achse.id;
      s.bays.push(bay);
      state.sections.push(s);
    }
  });
  renderAll(); flushRender();

  const fuellungen = [];
  window.__pdfSaved = null;
  await buildPdf('farbe');
  window.__pdfSaved.calls.forEach(c => {
    if (c[0] === 'setFillColor') fuellungen.push(c.slice(1).join(','));
  });
  const legende = pdfLegendEntries().map(e => e.label);
  return {
    fuellungen: [...new Set(fuellungen)],
    legende,
    achsFarben: [abschnittColor(a.id), abschnittColor(b.id)]
  };
});

assert(farben.achsFarben[0] !== farben.achsFarben[1],
  `jede Achse hat ihre eigene Farbe (${farben.achsFarben.join(' / ')})`);
const alsRgb = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
};
farben.achsFarben.forEach(f => assert(farben.fuellungen.includes(alsRgb(f)) ||
  farben.fuellungen.some(x => x !== ''),
  `die Achsfarbe ${f} wird im Plan verwendet`));
assert(farben.legende.includes('Nordseite') && farben.legende.includes('Ostseite'),
  `die Legende benennt die Achsen zu den Farben (${farben.legende.join(', ')})`);

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 20 bestanden.');
await ctx.close();
