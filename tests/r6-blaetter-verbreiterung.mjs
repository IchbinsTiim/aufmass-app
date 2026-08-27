// Runde 6 – drei Themen:
//
//   A  BLATTEINTEILUNG im PDF: so wenige Blätter wie möglich, aufgeteilt in
//      Leserichtung (links → rechts, Reihe für Reihe von oben nach unten).
//      Früher wanderte ein Blattfenster nach Nähe über die Felder – bei
//      ring- und L-förmigen Gerüsten entstanden dabei viele kleine Blätter.
//
//   B  VERBREITERUNGEN am Gerüstfeld, zwei Bauarten:
//        „Rahmen mit Rohr"  – Strebendreieck an der offenen Feldseite
//        „Modul-Abstützung" – gestricheltes Zusatzfeld mit eigener
//                             Länge/Breite/Höhe
//
//   C  BORDBRETTER / ± Gerüsttiefe: Ecken werden auch dort erkannt, wo zwei
//      Felder am selben Punkt BEGINNEN (oder enden); eine Linie wirkt auf
//      alle Achsen, an denen sie entlangläuft; und ein Umlauf an einer
//      Außenecke lässt sich direkt an der Ecke festlegen.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 6 – Blatteinteilung, Verbreiterungen, Bordbretter\n');

/** Baut Felder als Kette (Länge in m, Winkel in Grad) und liefert das Ende. */
await page.evaluate(() => {
  window.__reset = () => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    state.aufmass = null; state.ecken = {}; state.bordbrettKanten = [];
    state.depth = 0.73;
  };
  window.__run = (x0, y0, winkel, n, len = 2.57, flip = false) => {
    let x = x0, y = y0;
    const r = winkel * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const s = mkSection('E', x, y);
      setSectionAngle(s, winkel);
      if (flip) s.flip = true;
      const b = mkBay(len); b.hL = 8; b.hR = 8;
      s.bays.push(b); state.sections.push(s);
      x += Math.cos(r) * len * PX_PER_M;
      y += Math.sin(r) * len * PX_PER_M;
    }
    return { x, y };
  };
  // Blatteinteilung wie im Export: die Ausrichtung mit den wenigsten Blättern.
  window.__blaetter = () => {
    const layout = computeLayout();
    const chrome = 17 + 9 + 2.5 + 2 + 11;
    const cand = [[297, 210], [210, 297]].map(([w, h]) =>
      pdfPlanPages(layout, w - 24, h - 24 - chrome));
    cand.sort((a, b) => (a.pages.length - b.pages.length) || (b.scale - a.scale));
    const plan = cand[0];
    return {
      blaetter: plan.pages.length,
      felderJeBlatt: plan.pages.map(p => p.els.length),
      // Reihenfolge: linke Kante jedes Blattes (Leserichtung)
      linkeKanten: plan.pages.map(p => Math.round(Math.min(...p.els.map(e => elBBox(e).minX)))),
      reihen: plan.pages.map(p => p.reihe),
      // Vollständigkeit: jedes Feld genau einmal, keines angeschnitten
      zugeordnet: plan.pages.reduce((n, p) => n + p.els.length, 0),
      eindeutig: new Set(plan.pages.flatMap(p => p.els.map(e => e.si + ':' + e.bi))).size,
      gesamt: layout.filter(e => e.type === 'bay').length,
      angeschnitten: plan.pages.reduce((n, pg) => n + pg.els.filter(el => {
        const b = elBBox(el);
        return b.minX < pg.win.minX || b.maxX > pg.win.minX + pg.win.w ||
               b.minY < pg.win.minY || b.maxY > pg.win.minY + pg.win.h;
      }).length, 0),
      massstab: Math.round(10 / plan.scale)
    };
  };
});

const bau = (fn) => page.evaluate(fn);

// ══ A. Blatteinteilung ═════════════════════════════════════════════════════
console.log('A – Blatteinteilung');

const gerade15 = await bau(() => { __reset(); __run(0, 0, 0, 15); renderAll(); flushRender(); return __blaetter(); });
assert(gerade15.blaetter <= 2,
  `15 Felder in einer Reihe kommen auf ${gerade15.blaetter} Blatt/Blätter `
  + `(${gerade15.felderJeBlatt.join(' + ')} Felder, 1:${gerade15.massstab})`);
assert(gerade15.zugeordnet === gerade15.gesamt && gerade15.eindeutig === gerade15.gesamt,
  'jedes Feld liegt auf genau einem Blatt');
assert(gerade15.angeschnitten === 0, 'kein Feld wird am Blattrand angeschnitten');
const sortiert = [...gerade15.linkeKanten].sort((a, b) => a - b);
assert(JSON.stringify(gerade15.linkeKanten) === JSON.stringify(sortiert),
  `die Blätter folgen der Leserichtung von links nach rechts (${gerade15.linkeKanten.join(' → ')})`);

const zehn = await bau(() => { __reset(); __run(0, 0, 0, 10); renderAll(); flushRender(); return __blaetter(); });
assert(zehn.blaetter === 1,
  `was auf ein Blatt passt, bleibt auf einem Blatt (10 Felder, 1:${zehn.massstab})`);

const ring = await bau(() => {
  __reset();
  let p = __run(0, 0, 0, 12);
  p = __run(p.x, p.y, 90, 8);
  p = __run(p.x, p.y, 180, 12);
  __run(p.x, p.y, 270, 8);
  renderAll(); flushRender();
  return __blaetter();
});
assert(ring.blaetter <= 3,
  `Ring aus 40 Feldern: ${ring.blaetter} Blätter (${ring.felderJeBlatt.join(' + ')} Felder) `
  + '– früher entstanden daraus sechs');
assert(ring.zugeordnet === 40 && ring.eindeutig === 40 && ring.angeschnitten === 0,
  'auch beim Ring ist jedes Feld genau einmal und vollständig auf einem Blatt');

const lang = await bau(() => { __reset(); __run(0, 0, 0, 90); renderAll(); flushRender(); return __blaetter(); });
assert(lang.reihen.every(r => r === 0),
  'eine lange Fassade bleibt EINE Reihe – aufgeteilt wird nur nach rechts');
assert(lang.blaetter <= 8, `90 Felder auf ${lang.blaetter} Blätter (früher 10)`);

const kopf = await bau(async () => {
  __reset(); __run(0, 0, 0, 30);
  state.project = 'Blatttest';
  renderAll(); flushRender();
  window.__pdfSaved = null;
  await buildPdf('farbe');
  return window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2]));
});
assert(kopf.some(t => /Blatt 1 von \d+ .*Felder A1 – A\d+/.test(t)),
  `die Kopfzeile nennt die Felder des Blattes: „${kopf.find(t => /Blatt 1 von/.test(t)) || '–'}"`);
// Die frühere eigene Übersichtsseite ist entfallen – ein Blatt, das keine
// Zeichnung zeigt, kostet nur Papier. Die Lage im Gesamtplan steht als kleine
// Karte auf jedem Planblatt selbst.
assert(kopf.some(t => /^LAGE IM GESAMTPLAN/.test(t)),
  'jedes Planblatt zeigt selbst, welchen Ausschnitt es abbildet');

// Weniger Blätter heißt engerer Maßstab – die Beschriftungen dürfen sich
// deswegen trotzdem nicht überlagern (sie werden bei Bedarf gekürzt).
const dichte = await bau(async () => {
  __reset();
  for (let i = 0; i < 40; i++) {
    const s = mkSection('E', i * 257, 0); setSectionAngle(s, 0);
    const b = mkBay(2.57); b.hL = 12.5; b.hR = 9.75;
    b.positions.push({ id: ++_bId, cat: 'konsole', typ: '0,70', lagen: '3', billing: 'lagen' });
    b.positions.push({ id: ++_bId, cat: 'netz', qty: null, unit: 'm2' });
    b.positions.push({ id: ++_bId, cat: 'innengelaender', qty: 2, unit: 'lagen' });
    s.bays.push(b); state.sections.push(s);
  }
  state.project = 'Dichtetest';
  renderAll(); flushRender();

  const seiten = [];
  const orig = window.pdfPlanLabels;
  window.pdfPlanLabels = function (...a) { const r = orig.apply(this, a); seiten.push(r); return r; };
  window.__pdfSaved = null;
  await buildPdf('farbe');
  window.pdfPlanLabels = orig;

  let kollisionen = 0, n = 0;
  seiten.forEach(l => {
    n += l.length;
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const a = l[i].rect, b = l[j].rect;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) kollisionen++;
    }
  });
  return { blaetter: seiten.length, labels: n, kollisionen };
});
assert(dichte.kollisionen === 0,
  `keine Beschriftung überlagert eine andere (${dichte.labels} Beschriftungen `
  + `auf ${dichte.blaetter} Blättern)`);

// ══ B. Verbreiterungen ═════════════════════════════════════════════════════
console.log('\nB – Verbreiterungen');

const verb = await bau(async () => {
  __reset(); __run(0, 0, 0, 3);
  state.project = 'Verbreiterung';
  const rahmen = mkPosition('verbreiterung_rahmen');
  state.sections[0].bays[0].positions.push(rahmen);
  const ma = mkPosition('abstuetzung');
  ma.fLen = 1.57; ma.fBreite = 1.09; ma.fHoehe = 4.00;
  state.sections[1].bays[0].positions.push(ma);
  state.sections[2].bays[0].positions.push(mkPosition('abstuetzung'));
  renderAll(); flushRender();

  const els = computeLayout().filter(e => e.type === 'bay');
  const poly  = abstuetzPoly(els[1], ma, state.sections[1].bays[0]);
  const erbt  = abstuetzMasse(state.sections[2].bays[0].positions[0], state.sections[2].bays[0]);
  const strebe = rahmenRohrLinien(els[0]);
  const seite = (p, q) => Math.round(Math.hypot(q.x - p.x, q.y - p.y));

  // Chips im Feld-Sheet
  openEditSheet(0, 0);
  const chips = [...document.querySelectorAll('.pos-chip')].map(e => e.textContent);
  closeSheet();
  openEditSheet(1, 0);
  const felder = [...document.querySelectorAll('.pos-feld-masse .height-label')].map(e => e.textContent);
  const werte  = [...document.querySelectorAll('.pos-feld-masse .height-inp')].map(e => e.value);
  closeSheet();

  // Kopieren/Einfügen überträgt die Maße mit (Ziel: das dritte Feld, damit das
  // erste seine Strebe behält)
  copyBayPositions(state.sections[1].bays[0]);
  pasteBayPositions(state.sections[2].bays[0]);
  const kopiert = state.sections[2].bays[0].positions
    .filter(p => p.cat === 'abstuetzung')
    .map(p => abstuetzMassText(p, state.sections[2].bays[0]));

  window.__pdfSaved = null;
  await buildPdf('farbe');
  const texte = window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2]));

  return {
    chips: chips.filter(c => /Rahmen mit Rohr|Modul-Abstützung/.test(c)),
    felder, werte,
    laenge: seite(poly.pts[0], poly.pts[1]) / PX_PER_M,
    breite: seite(poly.pts[1], poly.pts[2]) / PX_PER_M,
    // Die Abstützung liegt an der offenen Seite: sie beginnt an der Außenkante
    ausserhalb: poly.pts.every(p => p.y <= -73 + 0.01),
    gestrichelt: (document.getElementById('planSvg').innerHTML
      .match(/stroke-dasharray/g) || []).length,
    strebeRagtHinaus: Math.abs(strebe.rahmen[1].y) > 73,
    erbt: { len: erbt.len, breite: erbt.breite, hoehe: erbt.hoehe },
    kopiert,
    pdf: texte
  };
});
assert(verb.chips.length === 2,
  `beide Verbreiterungen stehen als Zusatzbauteil zur Wahl: ${verb.chips.join(' · ')}`);
assert(JSON.stringify(verb.felder) === JSON.stringify(['Länge (m)', 'Breite (m)', 'Höhe (m)']),
  'die Modul-Abstützung hat eigene Eingaben für Länge, Breite und Höhe');
assert(JSON.stringify(verb.werte) === JSON.stringify(['1.57', '1.09', '4']),
  `die eingetragenen Maße stehen im Sheet (${verb.werte.join(' / ')})`);
assert(Math.abs(verb.laenge - 1.57) < 0.01 && Math.abs(verb.breite - 1.09) < 0.01,
  `sie wird mit genau diesen Maßen gezeichnet (${verb.laenge} × ${verb.breite} m)`);
assert(verb.ausserhalb, 'sie liegt neben dem Feld an dessen offener Seite');
assert(verb.gestrichelt >= 1, 'sie wird gestrichelt gezeichnet – keine begehbare Lage');
assert(verb.strebeRagtHinaus,
  'der Rahmen mit Rohr ragt über die Feldkante hinaus (Strebendreieck)');
assert(verb.erbt.len === 2.57 && verb.erbt.breite === 0.73 && verb.erbt.hoehe === 8,
  `ohne eigene Eingabe gelten die Maße des Feldes (${verb.erbt.len} × ${verb.erbt.breite} × ${verb.erbt.hoehe} m)`);
assert(verb.kopiert.includes('1,57 × 1,09 × 4 m'),
  'Kopieren/Einfügen überträgt die Abstützung samt Maßen');
assert(verb.pdf.some(t => t === 'Verbreiterung – Rahmen mit Rohr') &&
       verb.pdf.some(t => t === 'Modul-Abstützung'),
  'beide erscheinen in der PDF-Legende bzw. den Tabellen');
assert(verb.pdf.some(t => /1,57 × 1,09 × 4 m/.test(t)),
  'das PDF weist die Maße der Modul-Abstützung aus');

// ══ C. Bordbretter und die ± Gerüsttiefe ═══════════════════════════════════
console.log('\nC – Ecken und Bordbretter');

// C1: Zwei Felder, die am SELBEN Punkt beginnen – am Bau eine ganz normale
//     Ecke, für das Programm bisher gar keine.
const ecke = await bau(() => {
  __reset();
  __run(0, 0, 0, 3);                 // nach Osten, Lage oberhalb
  __run(0, 0, 90, 3, 2.57, true);    // nach Süden, Lage westlich (gespiegelt)
  renderAll(); flushRender();
  const liste = eckenListe();
  return { anzahl: liste.length, art: liste[0] ? liste[0].art : null,
           achsen: aufmassAchsen().map(a => a.m.laenge) };
});
assert(ecke.anzahl === 1 && ecke.art === 'aussen',
  `zwei Felder mit gemeinsamem ANFANG bilden eine Ecke (${ecke.art})`);

const umlauf = await bau(() => {
  const e = eckenListe()[0];
  const out = {};
  setEckUmlauf(e.key, state.sections[e.si].id, true);
  setEckUmlauf(e.key, state.sections[e.ni].id, true);
  renderAll(); flushRender();
  out.beide = aufmassAchsen().map(a => a.m.laenge);
  out.rollen = aufmassAchsen().map(a => a.rollen.join('/'));
  out.regel = aufmassRuleText();
  // Der pauschale Eckzuschlag darf dieselbe Ecke nicht ein zweites Mal zählen.
  aufmassRules().eckzuschlag.aktiv = true;
  out.mitPauschale = computeAufmass(visibleBaysFlat()).laenge;
  aufmassRules().eckzuschlag.aktiv = false;
  setEckUmlauf(e.key, state.sections[e.si].id, false);
  setEckUmlauf(e.key, state.sections[e.ni].id, false);
  out.ohne = aufmassAchsen().map(a => a.m.laenge);
  return out;
});
assert(Math.abs(umlauf.beide[0] - 8.44) < 0.005 && Math.abs(umlauf.beide[1] - 8.44) < 0.005,
  `an der Ecke festgelegt: beide Seiten + 0,73 m → ${umlauf.beide.join(' / ')} m (Soll 8,44)`);
assert(umlauf.rollen.every(r => /um die Außenecke/.test(r)),
  'die Rolle steht je Achse in der Aufmaß-Aufstellung');
assert(/um die Ecke/.test(umlauf.regel),
  'die Festlegung erscheint als Grundlage im PDF');
assert(Math.abs(umlauf.mitPauschale - (6 * 2.57 + 2 * 0.73)) < 0.01,
  'der pauschale Eckzuschlag zählt eine bereits erfasste Ecke nicht doppelt');
assert(Math.abs(umlauf.ohne[0] - 7.71) < 0.005,
  'aufheben wirkt sofort – zurück auf das reine Achsmaß');

/* C2: Bordbrett rund um das Gerüst.
   Markiert wird die komplette Außenkante eines Rechtecks aus 4 + 3 + 4 + 3
   Feldern. Erwartet wird der tatsächliche Umfang – und zwar je Achse getrennt,
   ohne dass eine Kante doppelt zählt. */
const rundum = await bau(() => {
  __reset();
  let p = __run(0, 0, 0, 4);
  p = __run(p.x, p.y, 90, 3);
  p = __run(p.x, p.y, 180, 4);
  __run(p.x, p.y, 270, 3);
  renderAll(); flushRender();
  // Äußere Längskante jedes Feldes markieren (Kante 2).
  allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true));
  renderAll(); flushRender();
  return {
    achsen: bordbrettJeAchse().map(x => +x.laenge.toFixed(2)),
    gesamt: +bordbrettGesamt().toFixed(2),
    felder: allBaysFlat().length
  };
});
assert(rundum.achsen.length === 4,
  `das Bordbrett verteilt sich auf alle ${rundum.achsen.length} Achsen`);
assert(rundum.achsen.every((v, i) => Math.abs(v - [4, 3, 4, 3][i] * 2.57) < 0.005),
  `je Achse die tatsächliche Kantenlänge (${rundum.achsen.join(' / ')} m)`);
assert(Math.abs(rundum.gesamt - 14 * 2.57) < 0.005,
  `Gesamt = Summe der markierten Kanten (${rundum.gesamt} m, Soll ${(14 * 2.57).toFixed(2)})`);

/* C3: Eine Kante, die sich zwei Felder teilen, zählt genau einmal – auch wenn
   sie von beiden Seiten markiert wird. Ohne diese Entdopplung stünde eine
   Stirnkante zwischen zwei Feldern zweimal im Aufmaß. */
const doppelt = await bau(() => {
  __reset();
  __run(0, 0, 0, 3);
  renderAll(); flushRender();
  state.bordbrettKanten = [];
  const bays = allBaysFlat();
  setzeBordbrettKante(bays[0].id, 1, true);   // Stirnkante am Ende von Feld 1
  const einfach = bordbrettGesamt();
  setzeBordbrettKante(bays[1].id, 3, true);   // dieselbe Strecke, von Feld 2 aus
  return { einfach: +einfach.toFixed(2), zweifach: +bordbrettGesamt().toFixed(2),
           eintraege: state.bordbrettKanten.length, tiefe: state.depth };
});
assert(Math.abs(doppelt.einfach - doppelt.tiefe) < 0.005,
  `eine Stirnkante ist so lang wie das Gerüst tief (${doppelt.einfach} m)`);
assert(doppelt.eintraege === 2 && Math.abs(doppelt.zweifach - doppelt.einfach) < 0.005,
  'dieselbe Kante von beiden Feldern markiert zählt trotzdem nur einmal');

const errs = ctx.logs.filter(l => l.startsWith('[pageerror]'));
assert(errs.length === 0, 'keine JS-Fehler: ' + errs.join(' | '));

console.log('\nAlle Tests zu Runde 6 bestanden.');
await ctx.close();
