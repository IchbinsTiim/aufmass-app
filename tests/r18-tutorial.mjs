// Runde 18 – geführtes Tutorial der 2D-App.
//
// Geprüft wird über die OBERFLÄCHE, was der Auftrag verlangt: ein dezenter
// „?"-Knopf in der Werkzeugleiste, elf Schritte mit Überschrift, kurzem Text,
// Hervorhebung eines ECHTEN Bedienelements, Zurück/Weiter/Beenden und
// Fortschrittsanzeige – und zwar so, dass weder Projektdaten noch die
// bestehende Bedienung (Touch auf der Zeichenfläche, Werkzeug-Menü,
// Event-Listener) Schaden nehmen.
import { open, seedFields, assert } from './harness.mjs';

const ctx = await open({ width: 1180, height: 820 });   // iPad quer
const { page } = ctx;

console.log('\nRUNDE 18 – Tutorial\n');

/* ══ 1. Der Knopf ═════════════════════════════════════════════════════════ */

const knopf = await page.evaluate(() => {
  const b = document.getElementById('tutorialBtn');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return {
    inLeiste: !!b.closest('#toolbar'),
    beiWerkzeugen: !!b.closest('.tb-tools'),
    text: b.textContent.trim(),
    titel: b.getAttribute('title') || '',
    hatTbBtn: b.classList.contains('tb-btn'),
    w: Math.round(r.width), h: Math.round(r.height),
    punkt: b.classList.contains('neu')
  };
});
assert(knopf !== null, 'es gibt einen Tutorial-Knopf');
assert(knopf.inLeiste && knopf.beiWerkzeugen, 'er steht in der oberen Bedienleiste bei den Werkzeugen');
assert(knopf.text === '?', `er trägt nur ein Fragezeichen („${knopf.text}")`);
assert(/Tutorial/i.test(knopf.titel), 'sein Tooltip nennt das Tutorial');
assert(knopf.w >= 44 && knopf.h >= 44, `Trefferfläche ${knopf.w} × ${knopf.h} px`);
assert(knopf.punkt, 'wer das Tutorial nie abgeschlossen hat, sieht einen Hinweis-Punkt');

// Die Soll-Belegung der Werkzeuge aus Runde 7 bleibt unverändert.
const belegung = await page.evaluate(() =>
  [...document.querySelectorAll('#toolbar .tb-tools .tb-btn')].map(b => b.id).join(','));
assert(belegung === 'addSectionBtn,addAchseBtn,undoBtn,redoBtn,fitViewBtn,snapToggleBtn,'
                 + 'bordbrettBtn,td-exportPdfBtn,werkzeugBtn',
  `die Werkzeuge selbst bleiben, wie sie waren: ${belegung}`);

/* ══ 2. Start: Abdunkelung, Loch, Karte ═══════════════════════════════════ */

await seedFields(page, 5);
await page.waitForTimeout(200);

// Ausgangszustand festhalten – er muss den Durchlauf unverändert überleben.
const datenVorher = await page.evaluate(() => JSON.stringify(aktuelleZeichnungsDaten()));
const menueVorher = await page.evaluate(() => werkzeugOffen);

await page.click('#tutorialBtn');
await page.waitForSelector('.tut-karte.sichtbar');
await page.waitForTimeout(350);

const start = await page.evaluate(() => ({
  sperre:   !!document.querySelector('.tut-sperre'),
  schatten: !!document.querySelector('.tut-schatten'),
  loecher:  document.querySelectorAll('.tut-loch').length,
  zaehler:  document.getElementById('tutZaehler').textContent,
  titel:    document.getElementById('tutTitel').textContent,
  zurueck:  document.getElementById('tutZurueck').disabled,
  weiter:   document.getElementById('tutWeiter').textContent,
  ende:     !!document.getElementById('tutEnde'),
  blatt:    !!document.getElementById('bottomSheet'),
  laeuft:   document.body.classList.contains('tut-laeuft')
}));
assert(start.sperre && start.schatten, 'Deckel und Abdunkelung liegen über der Seite');
assert(start.zaehler === '1 / 11', `Fortschrittsanzeige „${start.zaehler}"`);
assert(start.titel.length > 0 && start.titel.length < 44, `kurze Überschrift: „${start.titel}"`);
assert(start.zurueck, 'im ersten Schritt ist „Zurück" gesperrt');
assert(start.weiter === 'Weiter' && start.ende, '„Weiter" und „Tutorial beenden" sind da');
assert(start.blatt, 'Schritt 1 öffnet das echte Einstellblatt „Feld hinzufügen"');
assert(start.loecher >= 2, `Knopf UND Feldlängen sind ausgeschnitten (${start.loecher} Löcher)`);

// Das Loch sitzt wirklich auf dem erklärten Knopf.
const treffer = await page.evaluate(() => {
  const b = document.getElementById('addSectionBtn').getBoundingClientRect();
  return [...document.querySelectorAll('.tut-loch')].some(l => {
    const x = +l.getAttribute('x'), y = +l.getAttribute('y');
    const w = +l.getAttribute('width'), h = +l.getAttribute('height');
    return x <= b.left + 1 && y <= b.top + 1 && x + w >= b.right - 1 && y + h >= b.bottom - 1;
  });
});
assert(treffer, 'die Hervorhebung liegt exakt über „＋ Feld"');

// Die Karte verdeckt die Hervorhebung nicht.
const frei = await page.evaluate(() => {
  const k = document.querySelector('.tut-karte').getBoundingClientRect();
  return [...document.querySelectorAll('.tut-loch')].every(l => {
    const x = +l.getAttribute('x'), y = +l.getAttribute('y');
    const w = +l.getAttribute('width'), h = +l.getAttribute('height');
    return k.right < x || k.left > x + w || k.bottom < y || k.top > y + h;
  });
});
assert(frei, 'die Erklärkarte liegt neben der Hervorhebung, nicht darauf');

/* ══ 3. Der Deckel schützt die Zeichnung ══════════════════════════════════ */

const vorTipp = await page.evaluate(() => ({ felder: allBaysFlat().length, sel: selectedSi }));
// Mitten auf die Zeichenfläche tippen – im laufenden Tutorial darf das nichts tun.
const mitte = await page.evaluate(() => {
  const r = document.getElementById('viewerPanel').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.click(mitte.x, mitte.y);
await page.waitForTimeout(150);
const nachTipp = await page.evaluate(() => ({ felder: allBaysFlat().length, sel: selectedSi }));
assert(nachTipp.felder === vorTipp.felder && nachTipp.sel === vorTipp.sel,
  'ein Tipp auf die Zeichenfläche erreicht sie nicht – das Tutorial kann nichts verändern');

// Und die Tastatur ebenso: „R" dreht sonst, Strg+Z macht rückgängig.
const winkelVor = await page.evaluate(() => Math.round(secAngle(state.sections[0])));
await page.keyboard.press('r');
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const tastatur = await page.evaluate(() => ({
  winkel: Math.round(secAngle(state.sections[0])), felder: allBaysFlat().length }));
assert(tastatur.winkel === winkelVor && tastatur.felder === vorTipp.felder,
  'auch Tastenkürzel der App („R", Strg+Z) greifen während des Tutorials nicht durch');

/* ══ 4. Alle elf Schritte: Überschrift, Text, echtes Ziel ═════════════════ */

const anzahl = await page.evaluate(() => Tutorial2D.anzahl());
assert(anzahl === 11, `elf Schritte (${anzahl})`);

const themen = [];
for (let i = 1; i <= anzahl; i++) {
  const s = await page.evaluate(() => ({
    nr:      document.getElementById('tutZaehler').textContent,
    titel:   document.getElementById('tutTitel').textContent,
    text:    document.getElementById('tutText').textContent,
    loecher: [...document.querySelectorAll('.tut-loch')]
               .map(l => +l.getAttribute('width') * +l.getAttribute('height'))
               .filter(f => f > 100).length,
    karte:   document.querySelector('.tut-karte').getBoundingClientRect().toJSON(),
    innen:   (() => { const k = document.querySelector('.tut-karte').getBoundingClientRect();
                      return k.left >= -1 && k.top >= -1
                          && k.right <= window.innerWidth + 1 && k.bottom <= window.innerHeight + 1; })()
  }));
  assert(s.nr === `${i} / 11`, `Schritt ${i}: Anzeige „${s.nr}"`);
  assert(s.titel.length > 3, `Schritt ${i}: Überschrift „${s.titel}"`);
  const saetze = s.text.split(/[.!?](\s|$)/).filter(t => t.trim().length > 3).length;
  assert(saetze >= 1 && saetze <= 3, `Schritt ${i}: ${saetze} Satz/Sätze`);
  assert(s.loecher >= 1, `Schritt ${i}: ein echtes Bedienelement ist hervorgehoben`);
  assert(s.innen, `Schritt ${i}: die Karte bleibt vollständig im Bild`);
  themen.push(s.titel);
  if (i < anzahl) {
    await page.click('#tutWeiter');
    await page.waitForTimeout(280);
  }
}

// Die geforderten Themen kommen vor – in dieser Reihenfolge.
const soll = [/Feld/i, /verschieb|dreh/i, /Magnet/i, /Höhe/i, /Mehrere|gemeinsam/i,
              /Achse/i, /Bauteil/i, /Bordbrett/i, /Zoom|Navigation/i, /Speichern|Laden/i, /PDF|Aufmaß/i];
soll.forEach((re, i) => assert(re.test(themen[i]),
  `Schritt ${i + 1} behandelt das geforderte Thema: „${themen[i]}"`));

/* ══ 5. Menüs öffnen sich von selbst und schließen wieder ═════════════════ */

// Schritt 4 (Höhe) liegt im Werkzeug-Menü – zurückblättern und nachsehen.
await page.evaluate(() => Tutorial2D.starte(3));
await page.waitForTimeout(60);
await page.evaluate(() => { /* schon aktiv: starte() tut nichts, also blättern */ });
// Direkt dorthin blättern, ohne Klickstrecke:
for (let i = 0; i < 20 && await page.evaluate(() => Tutorial2D.schritt()) > 3; i++) {
  await page.click('#tutZurueck');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
const hoehe = await page.evaluate(() => ({
  schritt: Tutorial2D.schritt(),
  menue:   werkzeugOffen && document.getElementById('werkzeugPanel').classList.contains('offen'),
  offen:   !document.getElementById('wzMasse').classList.contains('wz-zu'),
  gemerkt: localStorage.getItem('geruest.2d.werkzeugMenue'),
  hLinks:  [...document.querySelectorAll('#wzMasse .bay-height-label')].map(e => e.textContent),
  auswahl: selectedSi
}));
assert(hoehe.schritt === 3, 'Schritt 4 erreicht');
assert(hoehe.menue, 'liegt ein Ziel im Werkzeug-Menü, öffnet das Tutorial es selbst');
assert(hoehe.offen, 'eine eingeklappte Sektion wird dafür aufgeklappt');
assert(hoehe.gemerkt !== '1', 'das Aufklappen ersetzt NICHT die gemerkte Einstellung des Nutzers');
assert(hoehe.auswahl !== null && hoehe.hLinks.join('/') === 'H links/H rechts',
  'die erklärten Höhenfelder sind wirklich zu sehen (Beispiel-Auswahl statt Platzhaltertext)');

/* ══ 6. Beenden räumt auf ═════════════════════════════════════════════════ */

await page.click('#tutEnde');
await page.waitForTimeout(400);
const danach = await page.evaluate(() => ({
  sperre:   !!document.querySelector('.tut-sperre'),
  schatten: !!document.querySelector('.tut-schatten'),
  karte:    !!document.querySelector('.tut-karte'),
  blatt:    !!document.getElementById('bottomSheet'),
  laeuft:   document.body.classList.contains('tut-laeuft'),
  menue:    werkzeugOffen,
  aktiv:    Tutorial2D.istAktiv(),
  auswahl:  selectedSi,
  daten:    JSON.stringify(aktuelleZeichnungsDaten())
}));
assert(!danach.sperre && !danach.schatten && !danach.karte, 'nach dem Beenden ist nichts davon übrig');
assert(!danach.blatt, 'das geöffnete Einstellblatt ist wieder zu');
assert(!danach.laeuft && !danach.aktiv, 'der Zustand ist sauber zurückgesetzt');
assert(danach.menue === menueVorher,
  `das Werkzeug-Menü steht wieder wie vorher (${menueVorher ? 'offen' : 'zu'})`);
assert(danach.auswahl === null,
  'die Beispiel-Auswahl des Tutorials ist wieder aufgehoben');
assert(danach.daten === datenVorher, 'KEIN Zeichen der Zeichnung hat sich geändert');

/* ══ 7. Touch-Bedienung läuft weiter ══════════════════════════════════════ */

// Genau die Geste, die auf dem iPad zählt: mit dem Finger ein Feld antippen.
// Gesendet werden echte Zeiger-Ereignisse mit `pointerType: 'touch'` – also
// dasselbe, was das iPad schickt, durch dieselben Listener wie im Betrieb.
await page.evaluate(() => { selectedSi = null; selectedBi = null; closeSheet(); renderAll(); flushRender(); });
await page.waitForTimeout(300);
const tipp = await page.evaluate(() => {
  const poly = document.querySelector('#planGroup polygon');
  const r = poly.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const opt = { bubbles: true, cancelable: true, pointerId: 11, isPrimary: true,
                pointerType: 'touch', clientX: x, clientY: y };
  poly.dispatchEvent(new PointerEvent('pointerdown', opt));
  poly.dispatchEvent(new PointerEvent('pointerup', opt));
  poly.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return { si: selectedSi, blatt: !!document.getElementById('bottomSheet') };
});
assert(tipp.si !== null, 'nach dem Tutorial wählt ein Fingertipp im Plan wieder ein Feld aus');
assert(tipp.blatt, 'und öffnet wie gewohnt das Bearbeiten-Blatt');
await page.evaluate(() => closeSheet());
await page.waitForTimeout(300);

// Zwei Finger, die auseinandergehen: Pinch-Zoom auf der Zeichenfläche.
const pinch = await page.evaluate(async () => {
  const svg = document.getElementById('planSvg');
  const r = svg.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const vorher = camera.scale;
  const senden = (typ, id, x, y) => svg.dispatchEvent(new PointerEvent(typ, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
    isPrimary: id === 21, clientX: x, clientY: y }));
  senden('pointerdown', 21, cx - 40, cy);
  senden('pointerdown', 22, cx + 40, cy);
  for (let s = 1; s <= 6; s++) {
    senden('pointermove', 21, cx - 40 - s * 18, cy);
    senden('pointermove', 22, cx + 40 + s * 18, cy);
  }
  senden('pointerup', 21, cx - 148, cy);
  senden('pointerup', 22, cx + 148, cy);
  return { vorher, nachher: camera.scale };
});
assert(pinch.nachher > pinch.vorher,
  `Pinch-Zoom mit zwei Fingern wirkt wieder (${pinch.vorher.toFixed(2)} → ${pinch.nachher.toFixed(2)})`);

// Werkzeug-Menü und Blätter funktionieren unverändert.
await page.click('#werkzeugBtn');
await page.waitForSelector('#werkzeugPanel.offen');
await page.click('#werkzeugBtn');
await page.waitForTimeout(150);
assert(await page.evaluate(() => !werkzeugOffen), 'das Werkzeug-Menü klappt wieder auf und zu');
await page.click('#addSectionBtn');
await page.waitForSelector('#bottomSheet');
await page.evaluate(() => closeSheet());
await page.waitForTimeout(300);

/* ══ 8. Durchlaufen wird gemerkt, Neustart bleibt möglich ═════════════════ */

await page.evaluate(async () => {
  Tutorial2D.starte(Tutorial2D.anzahl() - 1);
});
await page.waitForSelector('.tut-karte.sichtbar');
await page.waitForTimeout(250);
assert(await page.evaluate(() => document.getElementById('tutWeiter').textContent === 'Fertig'),
  'im letzten Schritt heißt der Knopf „Fertig"');
await page.click('#tutWeiter');
await page.waitForTimeout(350);
const merk = await page.evaluate(() => ({
  gespeichert: JSON.parse(localStorage.getItem('geruest.2d.tutorial') || 'null'),
  punkt: document.getElementById('tutorialBtn').classList.contains('neu'),
  aktiv: Tutorial2D.istAktiv()
}));
assert(merk.gespeichert && merk.gespeichert.abgeschlossen,
  'der Abschluss wird im Namensraum der App gemerkt (geruest.2d.tutorial)');
assert(!merk.punkt, 'der Hinweis-Punkt am „?" verschwindet');
assert(!merk.aktiv, '„Fertig" beendet das Tutorial');

await page.click('#tutorialBtn');
await page.waitForSelector('.tut-karte.sichtbar');
assert(await page.evaluate(() => Tutorial2D.schritt() === 0),
  'der Knopf startet das Tutorial jederzeit von vorn');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
assert(await page.evaluate(() => !Tutorial2D.istAktiv()), 'Esc beendet das Tutorial');

const errs1 = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs1.length === 0, 'keine JS-Fehler auf dem iPad: ' + errs1.join(' | '));
await ctx.close();

/* ══ 9. Handy: ausgelagerte Knöpfe werden im Menü gefunden ════════════════ */

console.log('\nHandy-Modus und kleine Bildschirme\n');

for (const [name, w, h] of [['Smartphone hoch', 390, 844], ['kleines Smartphone', 320, 568],
                            ['iPad hoch', 820, 1100]]) {
  const c = await open({ width: w, height: h });
  await seedFields(c.page, 4);
  await c.page.waitForTimeout(200);

  // Der Knopf läuft auch hier nicht aus dem Bild.
  const sichtbar = await c.page.evaluate(() => {
    const r = document.getElementById('tutorialBtn').getBoundingClientRect();
    return { innen: r.right <= window.innerWidth + 1 && r.left >= -1
                 && r.bottom <= window.innerHeight + 1 && r.top >= -1,
             h: Math.round(r.height),
             querlauf: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  assert(sichtbar.innen, `${name}: der „?"-Knopf ist vollständig sichtbar`);
  assert(sichtbar.h >= 44, `${name}: ${sichtbar.h} px Trefferhöhe`);
  assert(!sichtbar.querlauf, `${name}: die Seite läuft nicht seitlich aus dem Bild`);

  await c.page.click('#tutorialBtn');
  await c.page.waitForSelector('.tut-karte.sichtbar');

  // Jeden Schritt durchblättern: überall ein Ziel und eine Karte im Bild.
  for (let i = 1; i <= 11; i++) {
    await c.page.waitForTimeout(i === 1 ? 380 : 280);
    const s = await c.page.evaluate(() => {
      const k = document.querySelector('.tut-karte').getBoundingClientRect();
      return {
        nr: document.getElementById('tutZaehler').textContent,
        loecher: [...document.querySelectorAll('.tut-loch')]
                   .map(l => +l.getAttribute('width') * +l.getAttribute('height'))
                   .filter(f => f > 100).length,
        innen: k.left >= -1 && k.top >= -1
            && k.right <= window.innerWidth + 1 && k.bottom <= window.innerHeight + 1,
        knoepfe: [...document.querySelectorAll('.tut-fuss .tut-btn')]
                   .map(b => Math.round(b.getBoundingClientRect().height))
      };
    });
    assert(s.nr === `${i} / 11`, `${name}: Schritt ${s.nr}`);
    assert(s.loecher >= 1, `${name}: Schritt ${i} hebt ein Bedienelement hervor`);
    assert(s.innen, `${name}: Schritt ${i} – die Karte bleibt im Bild`);
    assert(s.knoepfe.every(x => x >= 44), `${name}: Schritt ${i} – Knöpfe ${s.knoepfe.join('/')} px`);
    if (i < 11) await c.page.click('#tutWeiter');
  }
  await c.page.click('#tutWeiter');
  await c.page.waitForTimeout(350);
  assert(await c.page.evaluate(() => !Tutorial2D.istAktiv() && !document.querySelector('.tut-sperre')),
    `${name}: am Ende ist die Oberfläche wieder frei`);

  // Und danach lässt sich mit dem Finger weiterzeichnen.
  await c.page.click('#addSectionBtn');
  await c.page.waitForSelector('#bottomSheet');
  await c.page.evaluate(() => { document.querySelector('#sheetSizeBtns .std-btn').click();
                                document.getElementById('sheetAddBtn').click(); });
  await c.page.waitForTimeout(250);
  assert(await c.page.evaluate(() => allBaysFlat().length === 5),
    `${name}: ein Feld lässt sich nach dem Tutorial normal hinzufügen`);

  const f = c.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
  assert(f.length === 0, `${name}: keine JS-Fehler` + (f.length ? ": " + f.join(" || ") : ""));
  await c.close();
}

console.log('\nAlle Tests zum Tutorial bestanden.');
