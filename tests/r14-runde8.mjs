/* ══════════════════════════════════════════════════════════════════════════
   Runde 8 – Abnahmeliste

   Geprüft werden die acht Änderungen dieser Runde, jede an ihrem eigenen
   Abnahmefall:

     Ä1  Mehrfachauswahl als echte MENGE: aus 21 Feldern genau 3 beliebige,
         ein viertes Tippen nimmt eines wieder heraus, danach wirkt eine
         Aktion nur auf diese 3 – und die Auswahl bleibt danach stehen.
     Ä2  Achse umbenennen, während Felder, Mengen und Bordbrett daran hängen.
     Ä3  Feste, kollisionsfreie Overlay-Zonen auf der Zeichenfläche.
     Ä4  Bordbrett in der (abgedunkelten) Achsfarbe, ohne Achse grau.
     Ä5  Die Seite des Bordbretts steht fest – über Richtungswechsel,
         Speichern und erneutes Öffnen hinweg. Dazu Stützpunkte.
     Ä6  Bordbrett weder in der Skizze noch als Position im PDF.
     Ä7  Skizze auf eine frei wählbare Blattzahl verteilen.
     Ä8  Aufmaßblatt mit EINER Ebene je Achse.
   ══════════════════════════════════════════════════════════════════════════ */
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 8 – Abnahmeliste\n');

/** Grundgerüst: `n` Felder in einer Reihe, wahlweise auf Achsen verteilt. */
await page.evaluate(() => {
  window.__reset = () => {
    state.sections = []; _sId = 0; _bId = 0; _aId = 0;
    state.abschnitte = []; state.hideUnassigned = false;
    state.aufmass = null; state.ecken = {}; state.bordbrettLinien = [];
    state.depth = 0.73; state.project = 'Runde 8';
    bulkMode = false; bulkSelected.clear();
    selectedSi = null; selectedBi = null;
  };
  window.__reihe = (n, x0 = 0, y0 = 0, winkel = 0, hoehe = 8) => {
    let x = x0, y = y0;
    const r = winkel * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const s = mkSection('E', x, y);
      setSectionAngle(s, winkel);
      const b = mkBay(2.57); b.hL = hoehe; b.hR = hoehe;
      s.bays.push(b); state.sections.push(s);
      x += Math.cos(r) * 2.57 * PX_PER_M;
      y += Math.sin(r) * 2.57 * PX_PER_M;
    }
    return { x, y };
  };
  /** Tippt ein Feld an, ohne dass die Klick-Sperre nach Gesten dazwischenkommt. */
  window.__tippe = i => {
    canvasJustMoved = false;
    const bays = allBaysFlat();
    const bay = bays[i];
    const si = sektionVonBay(bay);
    handleBayTap(si, state.sections[si].bays.findIndex(b => b.id === bay.id));
  };
});

/* ══ Ä1 – Mehrfachauswahl: freie Teilauswahl ══════════════════════════════ */
console.log('Ä1 – Mehrfachauswahl');

const auswahl = await page.evaluate(() => {
  __reset(); __reihe(21); renderAll(); flushRender();
  const bays = allBaysFlat();
  // Drei beliebige, ausdrücklich NICHT benachbarte Felder.
  starteMehrfachMitFeld(bays[2]);
  __tippe(9);
  __tippe(17);
  const drei = [...bulkSelected];
  // Ein viertes Tippen auf ein bereits gewähltes Feld nimmt es heraus.
  __tippe(9);
  const nachAbwahl = [...bulkSelected];
  __tippe(9);                                  // wieder dazu
  renderAll(); flushRender();
  return {
    gesamt: bays.length,
    drei: drei.length,
    dreiIdx: drei.map(id => bays.findIndex(b => b.id === id)),
    nachAbwahl: nachAbwahl.length,
    wiederDrei: bulkSelected.size,
    anzeige: document.getElementById('selectionInfo').textContent,
    leiste: document.getElementById('mehrfachBar').textContent
  };
});
assert(auswahl.gesamt === 21 && auswahl.drei === 3,
  `aus 21 Feldern sind genau 3 ausgewählt (${auswahl.dreiIdx.join(', ')})`);
assert(auswahl.dreiIdx.every((v, i, a) => i === 0 || v - a[i - 1] > 1),
  'die drei Felder liegen nicht nebeneinander – die Auswahl ist eine echte Menge');
assert(auswahl.nachAbwahl === 2, 'ein viertes Tippen nimmt eines wieder heraus');
assert(auswahl.wiederDrei === 3, 'nochmaliges Tippen nimmt es wieder dazu');
assert(/3 Felder ausgewählt/.test(auswahl.anzeige),
  `die Anzeige nennt die exakte Zahl: „${auswahl.anzeige.split('Achse')[0]}"`);
assert(/3 Felder/.test(auswahl.leiste) && !/mehrere/i.test(auswahl.leiste),
  'auch die Aktionsleiste nennt die Zahl, nicht „mehrere"');

const nachAktion = await page.evaluate(() => {
  const sel = currentSelectionBays();
  sel.forEach(b => b.positions.push({ id: ++_bId, cat: 'innengelaender', qty: '2', unit: 'lagen' }));
  renderAll(); flushRender();
  return {
    mitIG: allBaysFlat().filter(b => (b.positions || []).some(p => p.cat === 'innengelaender')).length,
    nochAusgewaehlt: bulkSelected.size
  };
});
assert(nachAktion.mitIG === 3, 'das Innengeländer wirkt nur auf diese 3 Felder');
assert(nachAktion.nochAusgewaehlt === 3,
  'die Auswahl bleibt nach der Aktion bestehen – kein automatisches Zurücksetzen');

const lasso = await page.evaluate(() => {
  // Ein Rahmen nimmt DAZU, statt die Auswahl zu ersetzen.
  const els = computeLayout().filter(e => e.type === 'bay').slice(0, 2);
  const alle = els.flatMap(e => e.pts);
  const p1 = { x: Math.min(...alle.map(p => p.x)) - 5, y: Math.min(...alle.map(p => p.y)) - 5 };
  const p2 = { x: Math.max(...alle.map(p => p.x)) + 5, y: Math.max(...alle.map(p => p.y)) + 5 };
  const zuSchirm = w => {
    const svg = document.getElementById('planSvg').getBoundingClientRect();
    const vb = document.getElementById('planSvg').viewBox.baseVal;
    return { x: svg.left + (w.x - vb.x) / vb.width * svg.width,
             y: svg.top  + (w.y - vb.y) / vb.height * svg.height };
  };
  const vorher = bulkSelected.size;
  rahmen = { a: zuSchirm(p1), b: zuSchirm(p2) };
  beendeRahmen();
  return { vorher, nachher: bulkSelected.size };
});
assert(lasso.nachher > lasso.vorher,
  `der Rahmen nimmt dazu, statt zu ersetzen (${lasso.vorher} → ${lasso.nachher})`);

// „Alle BERÜHRTEN Felder": ein Gerüstfeld ist lang und schmal. Wer quer über
// eine Reihe zieht, streift sie meist am Rand – über die Feldmitte gerechnet
// bliebe so ein Rahmen leer, obwohl er sichtbar über den Feldern lag.
const streif = await page.evaluate(() => {
  const zuSchirm = w => {
    const svg = document.getElementById('planSvg');
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: r.left + (w.x - vb.x) / vb.width * r.width,
             y: r.top  + (w.y - vb.y) / vb.height * r.height };
  };
  // Die laufende Auswahl der vorigen Prüfungen sichern – die folgenden Fälle
  // bauen darauf auf.
  const gesichert = [...bulkSelected];
  const warModus  = bulkMode;
  const els = computeLayout().filter(e => e.type === 'bay');
  const kasten = liste => {
    const ps = liste.flatMap(e => e.pts).map(zuSchirm);
    return { minX: Math.min(...ps.map(p => p.x)), maxX: Math.max(...ps.map(p => p.x)),
             minY: Math.min(...ps.map(p => p.y)), maxY: Math.max(...ps.map(p => p.y)) };
  };
  const drei = kasten(els.slice(0, 3));
  const eins = kasten(els.slice(0, 1));
  const hoehe = eins.maxY - eins.minY;

  // Ein schmaler Streifen ENTLANG der Oberkante der ersten drei Felder: er
  // berührt sie, schließt aber keine einzige Feldmitte ein.
  bulkMode = false; bulkSelected.clear();
  const y = eins.minY + hoehe * 0.12;
  rahmen = { a: { x: drei.minX + 3, y: y - 4 }, b: { x: drei.maxX - 3, y: y + 4 } };
  beendeRahmen();
  const gestreift = bulkSelected.size;

  // Gegenprobe: neben dem Gerüst nimmt derselbe Rahmen nichts auf.
  bulkMode = false; bulkSelected.clear();
  rahmen = { a: { x: eins.minX, y: eins.minY - 400 },
             b: { x: eins.maxX, y: eins.minY - 300 } };
  beendeRahmen();
  const daneben = bulkSelected.size;

  bulkSelected.clear();
  gesichert.forEach(id => bulkSelected.add(id));
  bulkMode = warModus;
  renderAll();
  return { gestreift, daneben, hoehe: Math.round(hoehe),
           wiederhergestellt: bulkSelected.size };
});
assert(streif.gestreift === 3,
  `ein Streifen, der die Felder nur am Rand berührt, nimmt sie mit `
  + `(${streif.gestreift} von 3, Feldhöhe ${streif.hoehe} px)`);
assert(streif.daneben === 0, 'ein Rahmen neben dem Gerüst nimmt nichts auf');

// Ein Auswahlrahmen beginnt auf LEERER Fläche – dort darf das Pointer-Down
// die laufende Auswahl noch nicht wegräumen, sonst könnte der Rahmen nichts
// mehr dazunehmen.
const rahmenStart = await page.evaluate(() => {
  const svg = document.getElementById('planSvg');
  const r = svg.getBoundingClientRect();
  const vorher = bulkSelected.size;
  const opt = { bubbles: true, pointerId: 77, isPrimary: true,
                clientX: r.right - 12, clientY: r.bottom - 90 };
  svg.dispatchEvent(new PointerEvent('pointerdown', opt));
  const nachher = bulkSelected.size;
  // Den Finger auch wieder heben: eine offene Zeigergeste hielte den
  // Neuaufbau des SVG an (siehe _runRender).
  svg.dispatchEvent(new PointerEvent('pointerup', opt));
  svg.dispatchEvent(new PointerEvent('pointercancel', opt));
  return { vorher, nachher };
});
assert(rahmenStart.nachher === rahmenStart.vorher,
  `das Aufsetzen auf leerer Fläche räumt die Auswahl noch nicht weg (${rahmenStart.nachher} Felder)`);

const geleert = await page.evaluate(() => {
  const svg = document.getElementById('planSvg');
  canvasJustMoved = false; handleReleasedAt = 0;
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return bulkSelected.size;
});
assert(geleert === 0, 'erst der Tipp auf leere Fläche (Klick) leert die Menge');
assert(await page.evaluate(() => { hebeAuswahlAuf(); return bulkSelected.size; }) === 0,
  '„Auswahl aufheben" tut dasselbe ausdrücklich');

/* ══ Ä2 – Achse nachträglich umbenennen ═══════════════════════════════════ */
console.log('\nÄ2 – Achse umbenennen');

const umbenannt = await page.evaluate(async () => {
  __reset(); __reihe(7); renderAll(); flushRender();
  const a = addAbschnitt('Achse 2');
  assignAbschnitt(allBaysFlat(), a.id);
  allBaysFlat().forEach(b => b.positions.push(
    { id: ++_bId, cat: 'innengelaender', qty: '2', unit: 'lagen' }));
  allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true));
  bordbrettLinien().forEach(l => { l.achsId = a.id; });
  normalizeBordbrett(); renderAll(); flushRender();

  const vorher = {
    felder: allBaysFlat().filter(b => b.abschnittId === a.id).length,
    bordbrett: +bordbrettGesamt().toFixed(2),
    achsIds: bordbrettLinien().map(l => l.achsId),
    block: pdfAchsBloecke()[0]
  };
  achseSetzeName(a.id, 'linke Seite');
  flushRender();
  window.__pdfSaved = null;
  await buildPdf('farbe');
  const texte = window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2]));
  return {
    vorher,
    id: a.id,
    nachher: {
      felder: allBaysFlat().filter(b => b.abschnittId === a.id).length,
      bordbrett: +bordbrettGesamt().toFixed(2),
      achsIds: bordbrettLinien().map(l => l.achsId),
      block: pdfAchsBloecke()[0]
    },
    texte,
    leer: (() => { achseSetzeName(a.id, '   '); const n = achsAnzeigeName(a.id);
                   achseSetzeName(a.id, 'linke Seite'); return n; })()
  };
});
assert(umbenannt.nachher.felder === 7 && umbenannt.vorher.felder === 7,
  'alle 7 Felder bleiben der Achse zugeordnet');
assert(umbenannt.nachher.bordbrett === umbenannt.vorher.bordbrett,
  `das Bordbrett bleibt unverändert (${umbenannt.nachher.bordbrett} m)`);
assert(umbenannt.nachher.achsIds.every(id => id === umbenannt.id),
  'das Bordbrett hängt weiter an derselben Achsen-ID, nicht am Namen');
assert(umbenannt.nachher.block.flaeche === umbenannt.vorher.block.flaeche
    && umbenannt.nachher.block.positioniert === umbenannt.vorher.block.positioniert,
  `die Mengen bleiben gleich (${umbenannt.nachher.block.flaeche} m²)`);
assert(umbenannt.texte.some(t => /LINKE SEITE/.test(t)),
  'das PDF zeigt den neuen Namen');
assert(umbenannt.leer === 'Achse 1',
  `ein leerer Name fällt auf „Achse {n}" zurück (${umbenannt.leer})`);

const dublette = await page.evaluate(() => {
  const b = addAbschnitt('linke Seite');
  renderAll(); flushRender();
  const doppelt = achsNameDoppelt(b.id);
  deleteAbschnitt(b.id); renderAll(); flushRender();
  return doppelt;
});
assert(dublette, 'doppelte Namen sind erlaubt, werden aber als Dublette erkannt');

/* ══ Ä3 – kollisionsfreie Overlay-Zonen ═══════════════════════════════════ */
console.log('\nÄ3 – Overlay-Zonen');

await page.evaluate(() => {
  __reset(); __reihe(7);
  const a = addAbschnitt('linke Seite');
  assignAbschnitt(allBaysFlat(), a.id);
  renderAll(); flushRender();
  starteMehrfachMitFeld(allBaysFlat()[1]);
  __tippe(2);
  setWerkzeugPanel(true);
  renderAll(); flushRender();
});
await page.waitForTimeout(200);
const zonen = await page.evaluate(() => {
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect();
                    return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
  const sicht = document.getElementById('viewerPanel').getBoundingClientRect();
  return {
    anzeige: r(document.getElementById('selectionInfo')),
    achse:   r(document.querySelector('.achs-label')),
    leiste:  r(document.getElementById('mehrfachBar')),
    panel:   r(document.getElementById('werkzeugPanel')),
    svg:     r(document.getElementById('planSvg')),
    sicht:   { l: sicht.left, t: sicht.top, r: sicht.right, b: sicht.bottom },
    knoepfe: [...document.querySelectorAll('#mehrfachBar .mf-btn')].map(b => {
      const q = b.getBoundingClientRect();
      return { w: Math.round(q.width), h: Math.round(q.height) };
    })
  };
});
const ueberlappt = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
assert(zonen.anzeige && zonen.achse && zonen.leiste,
  'Auswahl-Anzeige, Achslabel und Aktionsleiste sind gleichzeitig sichtbar');
assert(!ueberlappt(zonen.anzeige, zonen.achse),
  'Auswahl-Anzeige und Achslabel überlagern sich nicht');
assert(!ueberlappt(zonen.anzeige, zonen.leiste),
  'Auswahl-Anzeige und Aktionsleiste überlagern sich nicht');
assert(!ueberlappt(zonen.achse, zonen.leiste),
  'Achslabel und Aktionsleiste überlagern sich nicht');
assert(!ueberlappt(zonen.anzeige, zonen.panel) && !ueberlappt(zonen.leiste, zonen.panel),
  'das aufgeklappte Werkzeug-Panel überlagert keines der beiden');
assert(zonen.leiste.b <= zonen.sicht.b + 1 && zonen.leiste.t > zonen.sicht.t + 100,
  'die Aktionsleiste sitzt unten – daumennah');
assert(Math.abs(zonen.leiste.l - zonen.sicht.l) < 2 && Math.abs(zonen.leiste.r - zonen.sicht.r) < 2,
  'sie geht über die volle Breite der Zeichenfläche');
assert(zonen.svg.b <= zonen.leiste.t + 1,
  'die Zeichenfläche endet über der Leiste – sie wird verkleinert, nicht verdeckt');
assert(zonen.knoepfe.length >= 5 && zonen.knoepfe.every(k => k.h >= 36),
  `alle ${zonen.knoepfe.length} Knöpfe der Leiste sind vollständig und groß genug`);

/* Dieselbe Zusage auf dem iPad HOCHKANT. Unter 900 px kommt das Werkzeug-Menü
   nicht rechts angedockt, sondern als Blatt von unten – also genau dorthin,
   wo auch die Aktionsleiste sitzt. Auch dann darf sich nichts überlagern: das
   Blatt reserviert seinen Streifen, die Zeichenfläche wird kleiner und die
   Leiste rückt darüber. */
await page.setViewportSize({ width: 820, height: 1100 });
await page.waitForTimeout(320);
const hochkant = await page.evaluate(() => {
  renderAll(); flushRender();
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect();
                    return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
  const panel = document.getElementById('werkzeugPanel');
  return {
    blatt:   getComputedStyle(panel).position === 'fixed',
    // Das Blatt fährt mit einer Animation hoch; für die Lage zählt die
    // Layout-Höhe am unteren Fensterrand, nicht die Momentaufnahme.
    panelTop: window.innerHeight - panel.offsetHeight,
    anzeige: r(document.getElementById('selectionInfo')),
    leiste:  r(document.getElementById('mehrfachBar')),
    svg:     r(document.getElementById('planSvg')),
    knoepfe: document.querySelectorAll('#mehrfachBar .mf-btn').length
  };
});
assert(hochkant.blatt, 'hochkant kommt das Werkzeug-Menü als Blatt von unten');
assert(hochkant.leiste && hochkant.leiste.b <= hochkant.panelTop + 1,
  'die Aktionsleiste steht ÜBER dem Blatt – nicht dahinter');
assert(hochkant.svg.b <= hochkant.leiste.t + 1,
  'die Zeichenfläche endet über der Leiste');
assert(hochkant.svg.b <= hochkant.panelTop + 1,
  'und wird vom Blatt nicht verdeckt, sondern um dessen Höhe kleiner');
assert(hochkant.anzeige && hochkant.anzeige.b < hochkant.leiste.t,
  'die Auswahl-Anzeige bleibt oben und frei');
assert(hochkant.knoepfe >= 5,
  `alle ${hochkant.knoepfe} Knöpfe der Auswahl bleiben erreichbar`);

await page.setViewportSize({ width: 1400, height: 1000 });
await page.waitForTimeout(320);
await page.evaluate(() => { setWerkzeugPanel(false); renderAll(); flushRender(); });

/* ══ Ä4 – Bordbrett in Achsfarbe ══════════════════════════════════════════ */
console.log('\nÄ4 – Bordbrett in Achsfarbe');

const farben = await page.evaluate(() => {
  __reset(); __reihe(4);
  const a = addAbschnitt('Nord');
  assignAbschnitt(allBaysFlat(), a.id);
  allBaysFlat().forEach(b => setzeBordbrettKante(b.id, 2, true));
  normalizeBordbrett();
  const mitAchse = bordbrettLinien()[0];
  mitAchse.achsId = a.id;
  const mit = bordbrettFarbe(mitAchse);
  mitAchse.achsId = null;
  const ohne = bordbrettFarbe(mitAchse);
  mitAchse.achsId = a.id;
  renderAll(); flushRender();
  return { achsFarbe: abschnittColor(a.id), mit, ohne,
           dunkler: dunkler(abschnittColor(a.id), 0.8) };
});
assert(farben.mit === farben.dunkler && farben.mit !== farben.achsFarbe,
  `das Bordbrett trägt die abgedunkelte Achsfarbe (${farben.achsFarbe} → ${farben.mit})`);
assert(farben.ohne === '#8a97a5',
  'ohne Achszuordnung bleibt es neutral grau – die Lücke fällt sofort auf');

/* ══ Ä5 – Seite steht fest, Stützpunkte ═══════════════════════════════════ */
console.log('\nÄ5 – Bordbrett-Seite und Stützpunkte');

const seite = await page.evaluate(() => {
  __reset();
  // Sieben Felder mit ZWEI Richtungswechseln.
  let p = __reihe(3, 0, 0, 0);
  p = __reihe(2, p.x, p.y, 90);
  __reihe(2, p.x, p.y, 0);
  renderAll(); flushRender();

  const byId  = bayElsById();
  const graph = kantenGraph(byId);
  const els   = computeLayout().filter(e => e.type === 'bay');
  const mitte = (el, k) => { const [a, b] = bayKante(el, k);
                             return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const von = bordbrettPunktUnter(mitte(els[0], 2), byId);
  const bis = bordbrettPunktUnter(mitte(els[6], 2), byId);
  const linie = mkBordbrettLinie([{ b: von.b, k: von.k, t0: von.t, t1: von.t }],
                                 null, seiteAusPunkt(von, byId));
  linie.punkte = [{ b: von.b, k: +von.k, t: von.t }, { b: bis.b, k: +bis.k, t: bis.t }];
  linie.stuecke = baueStueckeAusPunkten(linie, graph, byId);
  bordbrettLinien().push(linie);
  normalizeBordbrett(); renderAll(); flushRender();

  const lagen = () => {
    const b = bayElsById();
    return bordbrettLinien()[0].stuecke.map(st => kantenLage(b.get(String(st.b)), st.k));
  };
  const vorher = { lagen: lagen(), seite: bordbrettLinien()[0].seite,
                   laenge: +bordbrettGesamt().toFixed(2), stuecke: bordbrettLinien()[0].stuecke.length };

  // Zoomen darf nichts daran ändern.
  camera.scale *= 2.4; applyCamera(); renderAll(); flushRender();
  const nachZoom = lagen();

  // Speichern und erneut öffnen.
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  state.bordbrettLinien = [];
  const d = JSON.parse(json);
  state.bordbrettLinien = d.state.bordbrettLinien;
  normalizeState(); renderAll(); flushRender();

  return { vorher, nachZoom, nachLaden: lagen(),
           seiteNachLaden: bordbrettLinien()[0].seite,
           laengeNachLaden: +bordbrettGesamt().toFixed(2) };
});
assert(seite.vorher.stuecke >= 7,
  `die Linie läuft über ${seite.vorher.stuecke} Kantenstücke (7 Felder, zwei Richtungswechsel)`);
const nurEineSeite = l => l.every(x => x === 'aussen' || x === null);
assert(nurEineSeite(seite.vorher.lagen),
  `beim Zeichnen bleibt sie durchgehend auf einer Seite (${seite.vorher.lagen.join(', ')})`);
assert(nurEineSeite(seite.nachZoom), 'nach dem Zoomen ebenso');
assert(nurEineSeite(seite.nachLaden), 'nach Speichern und erneutem Öffnen ebenso');
assert(seite.seiteNachLaden === seite.vorher.seite,
  `die Seite ist gespeichert und nicht gerechnet (${seite.seiteNachLaden})`);
assert(seite.laengeNachLaden === seite.vorher.laenge,
  `die Länge bleibt gleich (${seite.laengeNachLaden} m)`);

const wechsel = await page.evaluate(() => {
  const l = bordbrettLinien()[0];
  const vorher = l.seite;
  bordbrettSeiteWechseln(l);
  const b = bayElsById();
  const lagen = l.stuecke.map(st => kantenLage(b.get(String(st.b)), st.k));
  const nachher = l.seite;
  bordbrettSeiteWechseln(l);                       // wieder zurück
  return { vorher, nachher, lagen };
});
assert(wechsel.nachher !== wechsel.vorher,
  `„Seite wechseln" kippt die gespeicherte Seite (${wechsel.vorher} → ${wechsel.nachher})`);
assert(wechsel.lagen.every(x => x === 'wand' || x === null),
  'und legt die GESAMTE Linie auf die Gegenseite');

const stuetz = await page.evaluate(() => {
  const l = bordbrettLinien()[0];
  const byId = bayElsById();
  const vorher = linienPunkte(l).length;
  const geo = linienGeo(l, byId);
  const g = geo[Math.floor(geo.length / 2)];
  const mitte = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
  bordbrettModus = true;
  const gesetzt = setzeStuetzpunkt(l, mitte, byId);
  const nachher = linienPunkte(l).length;
  const laenge  = +linienLaenge(l, bayElsById()).toFixed(2);
  // Wieder entfernen: der Zwischenpunkt fällt heraus, die Linie bleibt.
  l.punkte.splice(1, l.punkte.length - 2);
  l.stuecke = baueStueckeAusPunkten(l, kantenGraph(bayElsById()), bayElsById());
  bordbrettModus = false;
  renderAll(); flushRender();
  return { gesetzt, vorher, nachher, laenge,
           zurueck: linienPunkte(l).length,
           laengeZurueck: +linienLaenge(l, bayElsById()).toFixed(2) };
});
assert(stuetz.gesetzt && stuetz.nachher === stuetz.vorher + 1,
  `ein Tipp auf die Linie setzt einen Stützpunkt (${stuetz.vorher} → ${stuetz.nachher} Punkte)`);
assert(stuetz.zurueck === 2 && stuetz.laengeZurueck === stuetz.laenge,
  'ihn wieder zu entfernen ändert die Linie nicht – sie ist eine Polylinie über ihre Punkte');

/* ══ Ä6 + Ä8 – PDF ═══════════════════════════════════════════════════════ */
console.log('\nÄ6 + Ä8 – PDF');

const pdf = await page.evaluate(async () => {
  __reset();
  __reihe(4, 0, 0, 0, 8);
  __reihe(3, 4 * 2.57 * PX_PER_M, 0, 0, 6);
  const a1 = addAbschnitt('linke Seite');
  const a2 = addAbschnitt('linker Giebel');
  const bays = allBaysFlat();
  assignAbschnitt(bays.slice(0, 4), a1.id);
  assignAbschnitt(bays.slice(4), a2.id);
  bays.forEach(b => b.positions.push({ id: ++_bId, cat: 'innengelaender', qty: '2', unit: 'lagen' }));
  bays.slice(0, 4).forEach(b => setzeBordbrettKante(b.id, 2, true));
  bordbrettLinien().forEach(l => { l.achsId = a1.id; });
  normalizeBordbrett(); renderAll(); flushRender();
  window.__pdfSaved = null;
  await buildPdf('farbe');
  const seiten = {};
  window.__pdfSaved.calls.forEach(c => {
    if (c[0] === 'text') (seiten[c[1]] || (seiten[c[1]] = [])).push(String(c[2]));
  });
  return {
    texte: window.__pdfSaved.calls.filter(c => c[0] === 'text').map(c => String(c[2])),
    seiten,
    bloecke: pdfAchsBloecke().map(b => ({ titel: b.titel, felder: b.felder,
                                          laenge: b.laenge, flaeche: b.flaeche,
                                          hoehenText: b.hoehenText,
                                          positionen: b.positionen.length }))
  };
});
const txt = pdf.texte.join('\n');
// Kein Balken in der Skizze, kein Legendeneintrag, keine Position. Der
// Hinweis „keine Bordbrettlinie – keine positionierte Fläche" in der
// Metazeile bleibt: er erklärt eine fehlende Zahl, er zeichnet nichts.
assert(!pdf.texte.some(t => /^Bordbrett/.test(t)),
  'das Bordbrett steht weder in der Skizze noch als Position im PDF');
assert(pdf.texte.some(t => t === 'ACHSE 1 · LINKE SEITE')
    && pdf.texte.some(t => t === 'ACHSE 2 · LINKER GIEBEL'),
  'je Achse EINE Überschrift mit dem vom Nutzer vergebenen Namen');
assert(pdf.texte.filter(t => /^ACHSE /.test(t)).length === 2,
  'keine weiteren Überschriftenebenen unterhalb der Achse');
assert(pdf.texte.some(t => /^4 Felder\s+·\s+10,28 m\s+·\s+82,24 m²$/.test(t)),
  'der Kopfbalken trägt rechts die Kennzahlen der Achse');
assert(pdf.texte.some(t => /^Innengeländer$/.test(t)) && pdf.texte.includes('lfd. Meter'),
  'darunter eine einzige Positionsliste mit Farbfeld, Position, Anzahl, Menge, lfd. Meter');
assert(pdf.texte.some(t => t === '4×') && pdf.texte.some(t => t === '8 Lagen')
    && pdf.texte.some(t => t === '20,56 m'),
  'eine Zeile je Positionsart, über die ganze Achse aggregiert');
// Auf dem AUFMASSBLATT selbst (nicht in der Skizze) darf keine Feldzeile
// mehr stehen: keine Feldbezeichnung, keine Einzelfläche.
const aufmassSeiten = Object.values(pdf.seiten).filter(t => t.includes('lfd. Meter'));
assert(aufmassSeiten.length >= 1, 'es gibt ein Aufmaßblatt');
assert(aufmassSeiten.every(t => !t.some(x => /^A\d+$/.test(x))),
  'keine Feldzeilen im Aufmaß – kein „A1", „A2" …');
assert(pdf.texte.includes('GESAMT · ALLE SEITEN'),
  'zum Schluss der Abschlussblock „Gesamt · alle Seiten"');
assert(pdf.texte.some(t => /^Höhen: 4 Felder à 8,00 m · 3 Felder à 6,00 m/.test(t)),
  'unterschiedliche Höhen stehen in der Metazeile – ohne neue Überschrift');
assert(pdf.bloecke.every(b => !b.hoehenText),
  'bei einheitlicher Höhe innerhalb einer Achse entfällt die Höhenzeile ganz');
assert(pdf.bloecke.length === 2 && pdf.bloecke[0].positionen === 1,
  'je Achse genau eine Positionsart in diesem Beispiel');

/* ══ Ä7 – Blattzahl der Skizze ════════════════════════════════════════════ */
console.log('\nÄ7 – Blattzahl der Skizze');

const blaetter = await page.evaluate(() => {
  __reset(); __reihe(24); renderAll(); flushRender();
  const layout = computeLayout();
  const chrome = 14 + 5 + 2 + 7;
  const w = 297 - 24, h = 210 - 24 - chrome;
  const plan = wahl => {
    const p = pdfPlanPages(layout, w, h, wahl);
    return {
      blaetter: p.pages.length,
      massstab: Math.round(p.scale * 1e6) / 1e6,
      felder: p.pages.map(x => x.els.length),
      zugeordnet: p.pages.reduce((n, x) => n + x.els.length, 0),
      eindeutig: new Set(p.pages.flatMap(x => x.els.map(e => e.si + ':' + e.bi))).size,
      angeschnitten: p.pages.reduce((n, pg) => n + pg.els.filter(el => {
        const b = elBBox(el);
        return b.minX < pg.win.minX - 0.5 || b.maxX > pg.win.minX + pg.win.w + 0.5 ||
               b.minY < pg.win.minY - 0.5 || b.maxY > pg.win.minY + pg.win.h + 0.5;
      }).length, 0),
      ueberlappung: p.ueberlappung || 0,
      // Blattbreite ohne Überlappung: daran wird der 5-%-Anteil gemessen.
      bandbreite: p.pages.length > 1
        ? (Math.max(...layout.filter(e => e.type === 'bay').flatMap(e => e.pts.map(q => q.x)))
         - Math.min(...layout.filter(e => e.type === 'bay').flatMap(e => e.pts.map(q => q.x)))) / p.pages.length
        : 0
    };
  };
  return { eins: plan('1'), zwei: plan('2'), drei: plan('3'), auto: plan('auto'),
           gesamt: layout.filter(e => e.type === 'bay').length };
});
assert(blaetter.eins.blaetter === 1, '„1 Blatt": die ganze Zeichnung auf eine Seite');
assert(blaetter.zwei.blaetter === 2, `„2 Blätter": ${blaetter.zwei.felder.join(' + ')} Felder`);
assert(blaetter.drei.blaetter === 3, `„3 Blätter": ${blaetter.drei.felder.join(' + ')} Felder`);
[blaetter.eins, blaetter.zwei, blaetter.drei, blaetter.auto].forEach(p => {
  assert(p.zugeordnet === blaetter.gesamt && p.eindeutig === blaetter.gesamt,
    `jedes der ${blaetter.gesamt} Felder liegt auf genau einem Blatt (${p.blaetter} Blätter)`);
  assert(p.angeschnitten === 0,
    `kein Feld wird angeschnitten (${p.blaetter} Blätter)`);
});
assert(blaetter.zwei.massstab > blaetter.eins.massstab
    && blaetter.drei.massstab > blaetter.zwei.massstab,
  'mehr Blätter heißt größerer Maßstab');
const anteil = blaetter.zwei.ueberlappung / blaetter.zwei.bandbreite;
assert(blaetter.zwei.ueberlappung > 0 && Math.abs(anteil - 0.05) < 0.02,
  `an jeder Schnittkante rund 5 % Überlappung (${(anteil * 100).toFixed(1)} %)`);
assert(blaetter.auto.blaetter >= 1 && blaetter.auto.blaetter <= 3,
  `„Automatisch" wählt ${blaetter.auto.blaetter} Blatt/Blätter`);

const auto6pt = await page.evaluate(() => {
  const layout = computeLayout();
  const bayEls = layout.filter(e => e.type === 'bay');
  const chrome = 14 + 5 + 2 + 7;
  const p = pdfPlanPages(layout, 297 - 24, 210 - 24 - chrome, 'auto');
  return { blaetter: p.pages.length, fs: pdfLabelSchriftgroesse(p.scale, bayEls) };
});
assert(auto6pt.fs >= 6,
  `„Automatisch" hält die Feldbeschriftung bei mindestens 6 pt (${auto6pt.fs.toFixed(1)} pt)`);

const dialog = await page.evaluate(() => {
  openPdfSheet();
  const karten = [...document.querySelectorAll('.pdf-blatt-karte')].map(b => b.textContent);
  const aktiv = document.querySelector('.pdf-blatt-karte.active');
  [...document.querySelectorAll('.pdf-blatt-karte')].find(b => b.dataset.blatt === '2').click();
  const nachKlick = document.querySelector('.pdf-blatt-karte.active').dataset.blatt;
  closeSheet();
  return { karten, aktiv: aktiv && aktiv.dataset.blatt, nachKlick };
});
assert(dialog.karten.length === 4,
  'der Export-Dialog bietet 1 / 2 / 3 Blätter und „Automatisch": ' + dialog.karten.join(' · '));
assert(dialog.aktiv === 'auto', '„Automatisch" ist die Vorgabe');
assert(dialog.nachKlick === '2', 'die Wahl lässt sich umstellen');

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Abnahmepunkte der Runde 8 bestanden.');
await ctx.close();
