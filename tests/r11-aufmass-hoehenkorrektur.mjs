// Runde 11 – Erweiterungen am Aufmaß-Programm (nicht am 2D-Zeichner):
//   1. Laser-Höhenkorrektur (+1,60 m / +2,00 m / +3,60 m) – nur bei Höhen
//   2. Treppenturm-Hinweis direkt in der App statt am Ende des PDFs
//   3. Neue Logistik-Position „Parkplatz"
//
// Geprüft wird das Verhalten über die Oberfläche (klicken/tippen wie ein
// Anwender) sowie die Ausgabe in Zusammenfassung, Speicher und PDF.
import { openAufmass, assert } from './harness.mjs';

const ctx = await openAufmass();
const { page } = ctx;
console.log('RUNDE 11 – Laser-Höhenkorrektur, Treppenturm-Hinweis, Parkplatz\n');

// ── Vorbereitung: neues Projekt mit einer Hausseite ───────────────────────
await page.click('#newProjectBtn');
await page.waitForSelector('#projectScreen:not(.hidden)');
await page.click('#addSideBtn');
await page.waitForSelector('.seite-card .messung-row');

const ZEILE = '.seite-card .messung-row:first-child';

/** Zustand der Laser-Korrektur eines Höhenfeldes ('hoehe' oder 'hoehe2'). */
const korrektur = feld => page.evaluate(f => {
  const wrap = document.querySelector('.seite-card .messung-row .messung-' + f + '-korrektur');
  if (!wrap) return null;
  return {
    wert:    wrap.dataset.korrektur,
    aktiv:   wrap.classList.contains('aktiv'),
    tasten:  [...wrap.querySelectorAll('.hkorr-btn')].map(b => b.classList.contains('active')),
    anzeige: wrap.querySelector('.hkorr-calc').textContent,
    reset:   wrap.querySelector('.hkorr-reset').style.display !== 'none',
    feld:    wrap.querySelector('.hkorr-feld').textContent
  };
}, feld);

/** n-te Korrektur-Taste eines Höhenfeldes drücken (1 = +1,60, 2 = +2,00, 3 = +3,60). */
const taste = (feld, n) =>
  page.click(`${ZEILE} .messung-${feld}-korrektur .hkorr-btn:nth-of-type(${n})`);

const flaeche = () => page.textContent(ZEILE + ' .messung-calc');

// ══ AUFGABE 1 – Laser-Höhenkorrektur ═════════════════════════════════════
console.log('AUFGABE 1 – Höhenkorrektur bei der Höheneingabe\n');

// Gemessen wird vom Kinn bis zur Dachkante: der Laser zeigt 10,40 m.
await page.fill(ZEILE + ' .messung-hoehe',  '10.40');
await page.fill(ZEILE + ' .messung-laenge', '10');

let k = await korrektur('hoehe');
assert(k !== null, 'die Höheneingabe bringt Korrektur-Tasten mit');
assert(k.tasten.length === 3, 'es gibt drei Korrektur-Tasten (+1,60 / +2,00 / +3,60)');
assert(k.wert === '0' && !k.reset, 'ohne Auswahl ist keine Korrektur aktiv und nichts zurückzusetzen');
assert(/104,00 m²/.test(await flaeche()), 'ohne Korrektur rechnet die Fläche mit dem gemessenen Wert');

const beschriftung = await page.evaluate(() =>
  [...document.querySelectorAll(`.seite-card .messung-row .messung-hoehe-korrektur .hkorr-btn`)]
    .map(b => b.textContent));
assert(beschriftung.join(' ') === '+1,60 m +2,00 m +3,60 m',
  'die Tasten sind mit ihren Werten beschriftet: ' + beschriftung.join(' '));

// 10,40 m + 1,60 m = 12,00 m
await taste('hoehe', 1);
k = await korrektur('hoehe');
assert(k.wert === '1.6' && k.tasten[0] === true, '+1,60 m ist aktiv');
assert(/10,40 m \+ 1,60 m = 12,00 m/.test(k.anzeige),
  'gemessener Wert, Korrektur und Endhöhe stehen getrennt da: ' + k.anzeige);
assert(/120,00 m²/.test(await flaeche()), '10,40 m + 1,60 m × 10 m = 120,00 m²');

// Zweite Stufe dazu: 1,60 + 2,00 = 3,60 → 14,00 m
await taste('hoehe', 2);
k = await korrektur('hoehe');
assert(k.wert === '3.6' && k.tasten.every(Boolean),
  'beide Korrekturen zusammen ergeben +3,60 m – auch die 3,60-Taste leuchtet');
assert(/= 14,00 m/.test(k.anzeige), 'die Endhöhe ist 14,00 m: ' + k.anzeige);
assert(/140,00 m²/.test(await flaeche()), 'die Fläche rechnet mit 14,00 m');

// Körper-Korrektur wieder ab: bleibt +2,00 m → 12,40 m
await taste('hoehe', 1);
k = await korrektur('hoehe');
assert(k.wert === '2' && /= 12,40 m/.test(k.anzeige),
  'nur noch +2,00 m: 10,40 m + 2,00 m = 12,40 m – ' + k.anzeige);

// „+3,60 m" schaltet beide Stufen in einem Schritt
await page.click(`${ZEILE} .messung-hoehe-korrektur .hkorr-reset`);
k = await korrektur('hoehe');
assert(k.wert === '0' && !k.aktiv, 'Zurücksetzen entfernt die Korrektur');
assert(await page.inputValue(ZEILE + ' .messung-hoehe') === '10.40',
  'das gemessene Höhenmaß bleibt beim Zurücksetzen stehen');

await taste('hoehe', 3);
k = await korrektur('hoehe');
assert(k.wert === '3.6' && /= 14,00 m/.test(k.anzeige),
  '„+3,60 m" setzt beide Korrekturen auf einmal: ' + k.anzeige);

// ── Der bestehende „+2 m"-Zuschlag bleibt davon unberührt ────────────────
await page.click(ZEILE + ' .messung-hoehe-zuschlag .plus2-btn');
assert(await page.evaluate(() =>
  document.querySelector('.seite-card .messung-row .messung-hoehe-zuschlag .plus2-btn').classList.contains('active')),
  'die bestehende „+2 m"-Taste an der Höhe funktioniert weiterhin');
assert(/160,00 m²/.test(await flaeche()),
  'Zuschlag und Korrektur addieren sich: (10,40 + 3,60 + 2,00) × 10 = 160,00 m² – ' + await flaeche());
await page.click(ZEILE + ' .messung-hoehe-zuschlag .plus2-btn');

// ══ AUFGABE 1b – niemals bei Längen ══════════════════════════════════════
console.log('\nAUFGABE 1b – Längenmaße bleiben unangetastet\n');

const laenge = await page.evaluate(() => {
  const row = document.querySelector('.seite-card .messung-row');
  return {
    korrektur: !!row.querySelector('.messung-laenge-korrektur'),
    tasten: [...row.querySelectorAll('.hkorr-ctrl')].map(el => el.className),
    zuschlag: !!row.querySelector('.messung-laenge-zuschlag .plus2-btn')
  };
});
assert(!laenge.korrektur, 'das Längenfeld hat keine Höhenkorrektur');
assert(laenge.tasten.every(c => /messung-hoehe2?-korrektur/.test(c)),
  'Korrektur-Tasten gibt es ausschließlich an Höhenfeldern: ' + laenge.tasten.join(' | '));
assert(laenge.zuschlag, 'der normale Zuschlag der Länge bleibt erhalten');
assert(await page.inputValue(ZEILE + ' .messung-laenge') === '10',
  'die eingegebene Länge wird durch die Höhenkorrektur nicht verändert');

// ══ AUFGABE 1c – Giebel: H1 und H2 getrennt korrigierbar ═════════════════
console.log('\nAUFGABE 1c – Giebel (H1 / H2)\n');

await page.click('.seite-card .giebel-btn');
await page.fill(ZEILE + ' .messung-hoehe2', '13');
assert((await korrektur('hoehe')).feld === 'H1', 'beim Giebel heißt die erste Höhe H1');
assert(await page.evaluate(() => getComputedStyle(
  document.querySelector('.seite-card .messung-row .messung-hoehe2-korrektur')).display) !== 'none',
  'H2 bringt eine eigene Korrektur mit');

await taste('hoehe2', 3);
assert(/13,00 m \+ 3,60 m = 16,60 m/.test((await korrektur('hoehe2')).anzeige),
  'H2 rechnet unabhängig von H1: ' + (await korrektur('hoehe2')).anzeige);
// H1 = 10,40 + 3,60 = 14,00 · H2 = 13,00 + 3,60 = 16,60
// (14,00 + 16,60) / 2 × 10,00 = 153,00 m²
assert(/153,00 m²/.test(await flaeche()), 'die Giebelfläche rechnet mit beiden korrigierten Höhen');

await page.click('.seite-card .giebel-btn');
assert((await korrektur('hoehe')).feld === 'H', 'ohne Giebel heißt die Höhe wieder H');
assert(/140,00 m²/.test(await flaeche()), 'ohne Giebel zählt wieder nur die korrigierte H');

// ══ AUFGABE 1d – Speichern: Messwert und Korrektur bleiben getrennt ══════
console.log('\nAUFGABE 1d – gemessener Wert und Korrektur getrennt gespeichert\n');

const gespeichert = await page.evaluate(() => {
  flushAutosave();
  const id = currentProjectId;
  loadProjects();
  openProject(id);
  const m = getCurrentProject().seiten[0].abschnitte[0].messungen[0];
  const wrap = document.querySelector('.seite-card .messung-row .messung-hoehe-korrektur');
  return {
    daten: m,
    feldWert:  document.querySelector('.seite-card .messung-row .messung-hoehe').value,
    wiederher: wrap.dataset.korrektur,
    anzeige:   wrap.querySelector('.hkorr-calc').textContent
  };
});
assert(gespeichert.daten.hoehe === 10.4,
  'gespeichert wird der gemessene Laser-Wert: ' + gespeichert.daten.hoehe);
assert(gespeichert.daten.hoeheKorrektur === 3.6,
  'die Korrektur steht in einem eigenen Feld: ' + gespeichert.daten.hoeheKorrektur);
assert(gespeichert.feldWert === '10.4' && gespeichert.wiederher === '3.6',
  'nach dem Öffnen stehen Messwert und Korrektur wieder getrennt da');
assert(/= 14,00 m/.test(gespeichert.anzeige),
  'die Endhöhe wird nach dem Öffnen wieder ausgewiesen: ' + gespeichert.anzeige);

const zusammenfassung = await page.textContent('#summaryContent');
assert(/14,00 m × 10,00 m/.test(zusammenfassung),
  'die Zusammenfassung rechnet mit der korrigierten Höhe');
assert(/Laser-Korrektur H \+3,60 m/.test(zusammenfassung),
  'die Zusammenfassung weist die angewandte Korrektur aus');

// ══ AUFGABE 2 – Treppenturm-Hinweis in der App ═══════════════════════════
console.log('\nAUFGABE 2 – Treppenturm-Hinweis direkt in der App\n');

const ttHinweis = () => page.evaluate(() => {
  const el = document.querySelector('.seite-card .acc-hinweis[data-acc="tt"]');
  if (!el) return null;
  return { sichtbar: el.style.display !== 'none', text: el.textContent };
});

assert((await ttHinweis()).sichtbar === false,
  'ohne gewählten Treppenturm steht kein Hinweis im Weg');

await page.click('.seite-card .accessory-toggle[data-acc="tt"]');
const hinweis = await ttHinweis();
assert(hinweis.sichtbar, 'sobald der Treppenturm gewählt ist, erscheint der Hinweis in der App');
assert(/Treppenturm/.test(hinweis.text), 'der Hinweis nennt den Treppenturm');
assert(/Standfläche/.test(hinweis.text) && /Verankerung/.test(hinweis.text),
  'der Hinweis erinnert an das, was beim Treppenturm zu beachten ist');

await page.click('.seite-card .accessory-toggle[data-acc="tt"]');
assert((await ttHinweis()).sichtbar === false,
  'wird der Treppenturm wieder abgewählt, verschwindet auch der Hinweis');
await page.click('.seite-card .accessory-toggle[data-acc="tt"]');

// ══ AUFGABE 3 – Parkplatz unter Logistik ═════════════════════════════════
console.log('\nAUFGABE 3 – Logistik-Position „Parkplatz"\n');

const parkplatzBtn = await page.evaluate(() => {
  const btn = document.getElementById('toggleParkplatz');
  return btn ? { text: btn.textContent, inLogistik: !!btn.closest('.logistik-toggles') } : null;
});
assert(parkplatzBtn && parkplatzBtn.text === 'Parkplatz', 'es gibt eine Position „Parkplatz"');
assert(parkplatzBtn.inLogistik, '„Parkplatz" steht bei den übrigen Logistik-Positionen');

const bestehende = await page.evaluate(() =>
  ['toggleOeffentlich', 'toggleVerkehr', 'toggleGenehmigung'].filter(id => document.getElementById(id)));
assert(bestehende.length === 3, 'die bestehenden Logistik-Positionen sind unverändert vorhanden');

await page.click('#toggleParkplatz');
const parkplatz = await page.evaluate(() => {
  flushAutosave();
  return {
    aktiv:       document.getElementById('toggleParkplatz').dataset.active,
    gespeichert: getCurrentProject().logistik.parkplatz,
    summary:     document.getElementById('summaryContent').textContent
  };
});
assert(parkplatz.aktiv === '1', '„Parkplatz" lässt sich auswählen');
assert(parkplatz.gespeichert === true, '„Parkplatz" wird mit dem Aufmaß gespeichert');
assert(/Parkplatz/.test(parkplatz.summary), '„Parkplatz" steht in der Zusammenfassung');

// Nach dem erneuten Öffnen ist die Auswahl noch da …
assert(await page.evaluate(() => {
  const id = currentProjectId;
  loadProjects();
  openProject(id);
  return document.getElementById('toggleParkplatz').dataset.active === '1';
}), 'nach dem erneuten Öffnen ist „Parkplatz" weiterhin ausgewählt');

// … und lässt sich genauso wieder abwählen.
await page.click('#toggleParkplatz');
assert(await page.evaluate(() => {
  flushAutosave();
  return getCurrentProject().logistik.parkplatz === false
    && !/Parkplatz/.test(document.getElementById('summaryContent').textContent);
}), 'abgewählt verschwindet „Parkplatz" wieder aus Speicher und Zusammenfassung');
await page.click('#toggleParkplatz');

// ══ PDF ══════════════════════════════════════════════════════════════════
console.log('\nPDF-Ausgabe\n');

const pdf = await page.evaluate(() => {
  window.__pdfSaved = null;
  document.getElementById('exportPdfBtn').click();
  return (window.__pdfSaved?.calls || []).filter(c => c[0] === 'text').map(c => c[2]).join('\n');
});

assert(/14,00 m × 10,00 m/.test(pdf), 'PDF: die korrigierte Höhe steht im Bericht');
assert(/Laser-Korrektur H \+3,60 m/.test(pdf), 'PDF: die angewandte Korrektur wird ausgewiesen');
assert(/BAUSTELLE \/ LOGISTIK/i.test(pdf) && /Parkplatz/.test(pdf),
  'PDF: „Parkplatz" erscheint unter Baustelle / Logistik');
assert(!/Hinweis: Gesamtlänge/.test(pdf),
  'PDF: der alte Treppenturm-Hinweis am Ende ist entfallen');

// ── Keine Fehler auf der Seite ────────────────────────────────────────────
const errs = ctx.logs.filter(l => l.includes('pageerror') || (l.includes('[error]') && !l.includes('404')));
assert(errs.length === 0, 'keine JavaScript-Fehler auf der Seite: ' + errs.join(' | '));

console.log('\nAlle Tests zu Runde 11 bestanden.');
await ctx.close();
