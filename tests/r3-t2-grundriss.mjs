// Runde 3 – Aufgabe 2: Grundriss als Hintergrundebene + Eckentyp aus dem Bild.
//
// Der Grundriss wird hier synthetisch erzeugt: ein L-förmiges Gebäude, NUR als
// Umriss gestrichen, innen weiß. Das ist der entscheidende Fall – „dunkel =
// Gebäude" würde daran scheitern, die Freiraum-Flutung vom Bildrand nicht.
import { open, assert } from './harness.mjs';

const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;
console.log('RUNDE 3 · AUFGABE 2 – Grundriss-Import & Eckenerkennung\n');

/*  Grundriss (Bildkoordinaten, 600 × 600):

      120        320        480
  120  ┌──────────┐
       │  Turm B  │
  320  │          └──────────┐
       │      Balken A       │
  480  └─────────────────────┘

    Innenecke bei (320,320) · Außenecke bei (480,320)                        */
const geo = await page.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 600; cv.height = 600;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 600, 600);
  c.strokeStyle = '#111'; c.lineWidth = 5; c.lineJoin = 'miter';
  c.beginPath();
  c.moveTo(120, 120); c.lineTo(320, 120); c.lineTo(320, 320);
  c.lineTo(480, 320); c.lineTo(480, 480); c.lineTo(120, 480);
  c.closePath(); c.stroke();
  // Innenwände + Bemaßung: beweist, dass nicht „dunkel = Gebäude" gilt –
  // innen ist überwiegend weiß, außen liegen ebenfalls dunkle Striche.
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(220, 120); c.lineTo(220, 480); c.stroke();
  c.beginPath(); c.moveTo(120, 60);  c.lineTo(480, 60);  c.stroke();

  state.sections = []; _sId = 0; _bId = 0;
  state.abschnitte = []; state.aufmass = null; state.ecken = {};
  state.depth = 0.73;

  const add = (angle, x, y, px) => {
    const s = mkSection('E', x, y); setSectionAngle(s, angle);
    const b = mkBay(px / PX_PER_M); b.hL = 8; b.hR = 8;
    s.bays.push(b); state.sections.push(s); return s;
  };
  add(90,  320, 120, 200);   // Achse 2: Süd, endet an der Innenecke
  add(0,   320, 320, 160);   // Achse 1: Ost, beginnt an der Innenecke
  add(90,  480, 320, 160);   // Achse 3: Süd, ab der Außenecke

  state.grundriss = {
    dataUrl: cv.toDataURL('image/png'),
    w: 600, h: 600,
    x: 300, y: 300,          // Bildmitte auf Weltkoordinate (300,300)
    scale: 1, rot: 0, opacity: 0.5, locked: false, visible: true
  };
  renderAll(); flushRender();
  return {
    ecken: eckenListe().map(e => ({ key: e.key, art: e.art, pt: e.pts[0] }))
  };
});

// ── 1. Die Ebene wird gezeichnet ──────────────────────────────────────────
const gezeichnet = await page.evaluate(() => {
  const img = document.querySelector('#planGroup image');
  return {
    da: !!img,
    breite: img ? +img.getAttribute('width') : 0,
    deckkraft: img ? +img.getAttribute('opacity') : 0,
    griff: !!document.querySelector('#planGroup circle[data-grundriss="move"]')
  };
});
assert(gezeichnet.da && gezeichnet.breite === 600,
  `der Grundriss liegt als Hintergrundebene in der Zeichnung (${gezeichnet.breite} px breit)`);
assert(gezeichnet.deckkraft === 0.5, 'die Deckkraft der Ebene ist einstellbar');
assert(gezeichnet.griff, 'ein Griff zum Verschieben der Ebene ist vorhanden');

// ── 2. Die Ebene zählt zum Inhalt (Kamera/„Alle Felder anzeigen") ─────────
assert(await page.evaluate(() => {
  const mit = contentBounds();
  state.grundriss.visible = false;
  _boundsCache = null;
  const ohne = contentBounds();
  state.grundriss.visible = true;
  _boundsCache = null;
  return mit.w > ohne.w;
}), 'die Ebene geht in den sichtbaren Inhalt ein, damit die Ansicht sie erfasst');

// ── 3. Eckentyp aus dem Grundriss ────────────────────────────────────────
const vorschlag = await page.evaluate(async () => {
  const res = await grundrissEckVorschlaege();
  return { fehler: res.fehler, ecken: res.ecken };
});
assert(!vorschlag.fehler, `die Auswertung läuft durch (${vorschlag.fehler || 'ok'})`);
assert(vorschlag.ecken.length === 2, `beide Ecken werden ausgewertet (${vorschlag.ecken.length})`);

const beiPunkt = (x, y) => {
  const e = geo.ecken.find(k => Math.abs(k.pt.x - x) < 2 && Math.abs(k.pt.y - y) < 2);
  return vorschlag.ecken.find(v => v.key === e.key);
};
const innen = beiPunkt(320, 320), aussen = beiPunkt(480, 320);
assert(innen.art === 'innen' && innen.anteil > 0.6,
  `Rücksprung wird als Innenecke erkannt (${Math.round(innen.anteil * 100)} % Gebäude ringsum)`);
assert(aussen.art === 'aussen' && aussen.anteil < 0.4,
  `vorspringende Ecke wird als Außenecke erkannt (${Math.round(aussen.anteil * 100)} % Gebäude ringsum)`);
assert(innen.sicherheit > 0.35 && aussen.sicherheit > 0.35,
  'beide Ergebnisse sind eindeutig genug, um übernommen zu werden');

// Gegenprobe: die reine Geometrie der Achsen sagt dasselbe – der Grundriss
// bestätigt sie also, statt ihr zu widersprechen.
assert(geo.ecken.find(e => e.key === innen.key).art === 'innen'
    && geo.ecken.find(e => e.key === aussen.key).art === 'aussen',
  'Grundriss und Achsgeometrie kommen zum selben Ergebnis');

// ── 4. Übernahme in die Eck-Entscheidung ─────────────────────────────────
const uebernommen = await page.evaluate(async () => {
  // Ecke absichtlich falsch setzen, dann aus dem Grundriss korrigieren lassen
  const e = eckenListe().find(x => x.art === 'innen');
  setEckWahl(e.key, { typ: 'aussen' });
  const falsch = eckenListe().find(x => x.key === e.key).art;
  const res = await grundrissEckVorschlaege();
  const v = res.ecken.find(x => x.key === e.key);
  setEckWahl(e.key, { typ: v.art });
  return { falsch, korrigiert: eckenListe().find(x => x.key === e.key).art };
});
assert(uebernommen.falsch === 'aussen' && uebernommen.korrigiert === 'innen',
  'eine von Hand falsch gesetzte Ecke lässt sich aus dem Grundriss korrigieren');

// ── 5. Maßstab über Referenzstrecke ──────────────────────────────────────
const massstab = await page.evaluate(() => {
  const vorher = state.grundriss.scale;
  starteGrundrissMessung();
  // Zwei Punkte im Abstand von 200 Welt-px = 2,00 m; als 4,00 m angeben
  const echtesPrompt = window.prompt;
  window.prompt = () => '4';
  grundrissMessKlick({ x: 100, y: 100 });
  grundrissMessKlick({ x: 300, y: 100 });
  window.prompt = echtesPrompt;
  return { vorher, nachher: state.grundriss.scale, messen: grundrissMessen };
});
assert(Math.abs(massstab.nachher / massstab.vorher - 2) < 0.001,
  `die Referenzstrecke setzt den Maßstab (Faktor ${(massstab.nachher / massstab.vorher).toFixed(2)} bei 2,00 m → 4,00 m)`);
assert(massstab.messen === false, 'der Messmodus endet nach der zweiten Eingabe');

// ── 6. Verschieben, Sperren, Persistenz ──────────────────────────────────
const bedienung = await page.evaluate(() => {
  state.grundriss.scale = 1;
  state.grundriss.locked = true;
  renderAll(); flushRender();
  const gesperrt = !document.querySelector('#planGroup circle[data-grundriss="move"]');
  state.grundriss.locked = false;
  state.grundriss.x = 355;
  renderAll(); flushRender();
  const json = JSON.stringify({ version: 3, state, _sId, _bId });
  state.grundriss = null; state.ecken = {};
  const d = JSON.parse(json);
  state.grundriss = d.state.grundriss;
  state.ecken = d.state.ecken;
  normalizeState();
  renderAll(); flushRender();
  return { gesperrt, x: grundrissLayer().x, hatBild: !!grundrissLayer().dataUrl };
});
assert(bedienung.gesperrt, 'gesperrt verschwindet der Verschiebe-Griff');
assert(bedienung.x === 355 && bedienung.hatBild,
  'Grundriss samt Ausrichtung wird mit der Zeichnung gespeichert und geladen');

// ── 7. Ohne verwertbaren Freiraum wird KEIN Vorschlag gemacht ────────────
// Ein rundum gerahmter Plan blockiert die Flutung vom Bildrand. Dann lieber
// gar keine Aussage als eine falsche.
const gerahmt = await page.evaluate(async () => {
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 300;
  const c = cv.getContext('2d');
  c.fillStyle = '#111'; c.fillRect(0, 0, 300, 300);      // alles „Gebäude"
  state.grundriss = { ...state.grundriss, dataUrl: cv.toDataURL('image/png'), w: 300, h: 300 };
  const res = await grundrissEckVorschlaege();
  return { fehler: res.fehler, ecken: res.ecken.length };
});
assert(!!gerahmt.fehler && gerahmt.ecken === 0,
  `kein Freiraum erkennbar → ehrliche Fehlmeldung statt Rateergebnis: „${gerahmt.fehler}"`);

assert(ctx.logs.filter(l => l.startsWith('[pageerror]')).length === 0,
  'keine JS-Fehler: ' + ctx.logs.filter(l => l.startsWith('[pageerror]')).join(' | '));

console.log('\nAlle Tests zu Runde 3 / Aufgabe 2 bestanden.');
await ctx.close();
