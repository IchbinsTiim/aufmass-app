// Runde 4 – Erweiterungen am Aufmaß-Programm (index.html, Positionserfassung):
//   1. Positionsarten „Parkplatz" und „Genehmigung" (Pauschal-/Stückposition)
//   2. Positionen doppelt erfassen („+") + Höhen-Übernahme aus der ersten Zeile
//   3. Notizfeld je Projekt und je Abschnitt
//   4. Warnmeldung ab 50 m Gesamtlänge (Treppenturm)
//   5. Reihenfolge der Felder: erst Höhe, dann Länge
//
// Geprüft wird das Verhalten über die Oberfläche (klicken/tippen wie ein
// Anwender) sowie die Ausgabe in Zusammenfassung und PDF.
import { openAufmass, assert } from './harness.mjs';

const ctx = await openAufmass();
const { page } = ctx;
console.log('RUNDE 4 – Aufmaß-Programm: Positionen, Umlauf, Notizen, 50 m\n');

// ── Vorbereitung: neues Projekt mit einer Hausseite ───────────────────────
await page.click('#newProjectBtn');
await page.waitForSelector('#projectScreen:not(.hidden)');
await page.click('#addSideBtn');
await page.waitForSelector('.seite-card .messung-row');

/** Werte aller Messzeilen des ersten Abschnitts. */
const messzeilen = () => page.evaluate(() =>
  [...document.querySelectorAll('.seite-card .abschnitt-row:first-child .messung-row')].map(r => ({
    h: r.querySelector('.messung-hoehe').value,
    l: r.querySelector('.messung-laenge').value,
    hZuschlag: r.querySelector('.messung-hoehe-zuschlag .plus2-btn').classList.contains('active')
      ? r.querySelector('.messung-hoehe-zuschlag .plus2-value-input').value : null
  })));

const setzen = async (index, feld, wert) => {
  await page.fill(`.seite-card .abschnitt-row:first-child .messung-row:nth-child(${index + 1}) .messung-${feld}`, wert);
};

// ══ AUFGABE 5 – Reihenfolge Länge/Höhe getauscht ═════════════════════════
console.log('AUFGABE 5 – Reihenfolge der Maß-Felder\n');

const reihenfolge = await page.evaluate(() => {
  const row = document.querySelector('.messung-row');
  return [...row.children]
    .map(el => el.querySelector?.('input')?.className || el.className)
    .filter(c => /messung-(hoehe|laenge)\b|messung-hoehe2/.test(c));
});
assert(/hoehe/.test(reihenfolge[0]) && !/hoehe2/.test(reihenfolge[0]),
  'erstes Maß-Feld der Zeile ist die Höhe');
assert(reihenfolge.some(c => /laenge/.test(c)) &&
  reihenfolge.findIndex(c => /laenge/.test(c)) > 0,
  'die Länge steht hinter der Höhe');

const tags = await page.evaluate(() =>
  [...document.querySelector('.messung-row').querySelectorAll('.meas-field-tag')].map(t => t.textContent));
assert(tags[0] === 'H', 'Beschriftung der Felder folgt der neuen Reihenfolge (H zuerst): ' + tags.join(' '));

// ══ AUFGABE 2 – doppelt erfassen + Höhen-Übernahme ═══════════════════════
console.log('\nAUFGABE 2 – Position doppelt erfassen (Umlauf) & Höhen-Übernahme\n');

await setzen(0, 'hoehe', '3');
await setzen(0, 'laenge', '5');
// Zuschlag auf der Höhe aktivieren – muss beim Duplizieren mitkommen
await page.click('.seite-card .messung-row:first-child .messung-hoehe-zuschlag .plus2-btn');

await page.click('.seite-card .messung-row:first-child .messung-dup-btn');
let zeilen = await messzeilen();
assert(zeilen.length === 2, 'ein Klick auf „+" legt eine zweite Zeile an');
assert(zeilen[1].h === '3' && zeilen[1].l === '5',
  'die Kopie übernimmt Höhe und Länge unverändert (' + zeilen[1].h + ' × ' + zeilen[1].l + ')');
assert(zeilen[1].hZuschlag === '2', 'auch der Zuschlag der Höhe wird mitkopiert');

// Kopie ist unabhängig änderbar
await setzen(1, 'laenge', '7');
zeilen = await messzeilen();
assert(zeilen[0].l === '5' && zeilen[1].l === '7',
  'die Kopie lässt sich einzeln ändern, ohne die erste Zeile zu verändern');

// „+ Maß" übernimmt die Höhe der ERSTEN Zeile des Abschnitts, Länge bleibt leer
await page.click('.seite-card .abschnitt-row:first-child .meas-add-btn-sm');
zeilen = await messzeilen();
assert(zeilen.length === 3, '„+ Maß" legt eine weitere Zeile an');
assert(zeilen[2].h === '3', 'die Höhe der ersten Zeile wird automatisch übernommen');
assert(zeilen[2].hZuschlag === '2', 'der Höhen-Zuschlag der ersten Zeile wird mit übernommen');
assert(zeilen[2].l === '', 'die Länge bleibt leer – nur sie muss noch eingetragen werden');

// Übernommene Höhe bleibt manuell änderbar
await setzen(2, 'hoehe', '4');
zeilen = await messzeilen();
assert(zeilen[2].h === '4' && zeilen[0].h === '3',
  'die übernommene Höhe ist weiterhin manuell änderbar');

// Fläche rechnet mit den kopierten Werten: (3+2)×5 + (3+2)×7 = 60 m²
await setzen(2, 'hoehe', '3');
await setzen(2, 'laenge', '');
const summe = await page.textContent('.seite-card .abschnitt-total');
assert(/60,00 m²/.test(summe), 'Abschnittssumme rechnet die doppelt erfasste Position mit: ' + summe);

// ══ AUFGABE 4 – Warnung ab 50 m (Treppenturm) ════════════════════════════
console.log('\nAUFGABE 4 – Warnmeldung ab 50 m Gesamtlänge\n');

const warnung = () => page.evaluate(() => {
  const ab = document.querySelector('.abschnitt-row .laenge-warn');
  const seite = document.querySelector('.seite-warn');
  const sicht = el => !!el && el.style.display !== 'none' && el.textContent.trim() !== '';
  return { abschnitt: sicht(ab) ? ab.textContent : '', seite: sicht(seite) ? seite.textContent : '' };
});

let w = await warnung();
assert(w.abschnitt === '' && w.seite === '', 'unter 50 m erscheint keine Warnung');

// 5 + 7 + 40 = 52 m (Zuschläge zählen nur bei der Höhe)
await setzen(2, 'laenge', '40');
w = await warnung();
assert(/Treppenturm/.test(w.abschnitt), 'Abschnitt über 50 m: Hinweis auf Treppenturm – ' + w.abschnitt.trim());
assert(/52,00 m/.test(w.abschnitt), 'die Warnung nennt die tatsächliche Gesamtlänge');
assert(/Treppenturm/.test(w.seite), 'auch die Hausseite weist auf den Treppenturm hin');

const toast = await page.evaluate(() => {
  const el = document.getElementById('toastEl');
  return el.classList.contains('show') ? el.textContent : '';
});
assert(/Treppenturm/.test(toast), 'beim Überschreiten erscheint zusätzlich eine Meldung: ' + toast);

const summaryWarn = await page.textContent('#summaryContent');
assert(/Treppenturm/.test(summaryWarn), 'die Zusammenfassung weist ebenfalls auf den Treppenturm hin');

// Unter die Grenze zurück → Warnung verschwindet wieder
await setzen(2, 'laenge', '10');
w = await warnung();
assert(w.abschnitt === '' && w.seite === '', 'unter 50 m verschwindet die Warnung wieder');
await setzen(2, 'laenge', '40');

// Warnung greift auch über mehrere Abschnitte hinweg (nur Seitensumme > 50 m)
await page.evaluate(() => {
  document.querySelectorAll('.seite-card .abschnitt-row .messung-laenge').forEach(inp => {
    inp.value = '20';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
});
await page.click('.seite-card .abschnitt-section > .meas-add-btn');
await page.fill('.seite-card .abschnitt-row:nth-child(2) .messung-hoehe', '3');
await page.fill('.seite-card .abschnitt-row:nth-child(2) .messung-laenge', '20');
w = await warnung();
assert(/Treppenturm/.test(w.seite), 'Summe mehrerer Abschnitte (60 m + 20 m) löst die Seiten-Warnung aus');

// Ausgangszustand für die restlichen Tests: eine Seite mit 60 m
await page.evaluate(() => {
  const rows = document.querySelectorAll('.seite-card .abschnitt-row');
  if (rows.length > 1) rows[1].querySelector('.meas-remove-btn').click();
});

// ══ AUFGABE 3 – Notizfelder ══════════════════════════════════════════════
console.log('\nAUFGABE 3 – Notizfeld für allgemeine Informationen\n');

assert(await page.isVisible('#fieldNotizen'), 'das Projekt hat ein freies Notizfeld');
assert(await page.isVisible('.seite-card .seite-notiz'), 'jede Hausseite hat ein eigenes Notizfeld');
await page.fill('#fieldNotizen', 'Schlüssel beim Hausmeister abholen.\nZufahrt nur vormittags frei.');
await page.fill('.seite-card .seite-notiz', 'Zufahrt nur über den Hof');
await page.fill('.seite-card .abschnitt-row:first-child .abschnitt-notiz', 'Balkon nur bis OK Brüstung');

const gespeichert = await page.evaluate(() => {
  flushAutosave();
  const p = getCurrentProject();
  return { notizen: p.notizen, seiteNotiz: p.seiten[0].notiz, abschnittNotiz: p.seiten[0].abschnitte[0].notiz };
});
assert(/Hausmeister/.test(gespeichert.notizen), 'die Projekt-Notiz wird gespeichert');
assert(gespeichert.seiteNotiz === 'Zufahrt nur über den Hof', 'die Seiten-Notiz wird gespeichert');
assert(gespeichert.abschnittNotiz === 'Balkon nur bis OK Brüstung', 'die Abschnitts-Notiz wird gespeichert');

const nachNeuladen = await page.evaluate(() => {
  const id = currentProjectId;
  loadProjects();
  openProject(id);
  return {
    notizen: document.getElementById('fieldNotizen').value,
    seiteNotiz: document.querySelector('.seite-notiz').value,
    abschnittNotiz: document.querySelector('.abschnitt-notiz').value
  };
});
assert(/Hausmeister/.test(nachNeuladen.notizen) && /Brüstung/.test(nachNeuladen.abschnittNotiz),
  'beide Notizen stehen nach erneutem Öffnen des Projekts wieder da');
assert(/Hof/.test(nachNeuladen.seiteNotiz), 'auch die Seiten-Notiz steht nach erneutem Öffnen wieder da');

const summaryNotiz = await page.textContent('#summaryContent');
assert(/Brüstung/.test(summaryNotiz), 'die Abschnitts-Notiz erscheint in der Zusammenfassung');
assert(/Hof/.test(summaryNotiz), 'die Seiten-Notiz erscheint in der Zusammenfassung');

// ══ AUFGABE 1 – Parkplatz & Genehmigung ══════════════════════════════════
console.log('\nAUFGABE 1 – Positionsarten „Parkplatz" und „Genehmigung"\n');

const arten = await page.evaluate(() => {
  document.getElementById('addZusatzBtn').click();
  return [...document.querySelectorAll('.zusatz-row .zusatz-art option')].map(o => o.value);
});
assert(arten.includes('Parkplatz'),   'die Auswahl enthält „Parkplatz"');
assert(arten.includes('Genehmigung'), 'die Auswahl enthält „Genehmigung"');

await page.selectOption('.zusatz-row:first-child .zusatz-art', 'Parkplatz');
const parkplatz = await page.evaluate(() => {
  const row = document.querySelector('.zusatz-row');
  return {
    einheit: row.querySelector('.zusatz-einheit').value,
    mengePlatzhalter: row.querySelector('.zusatz-menge').placeholder,
    notizPlatzhalter: row.querySelector('.zusatz-notiz').placeholder,
    hatMassfelder: !!row.querySelector('.messung-laenge, .messung-hoehe')
  };
});
assert(parkplatz.einheit === 'Stk.', 'Parkplatz wird als Stückposition erfasst (Einheit Stk.)');
assert(parkplatz.mengePlatzhalter === 'Anzahl', 'statt eines Maßes wird die Anzahl abgefragt');
assert(!parkplatz.hatMassfelder, 'keine Länge/Fläche – Parkplatz ist eine Pauschalposition');
assert(/Zeitraum/.test(parkplatz.notizPlatzhalter), 'die Notiz schlägt den Zeitraum vor: ' + parkplatz.notizPlatzhalter);

await page.fill('.zusatz-row:first-child .zusatz-menge', '2');
await page.fill('.zusatz-row:first-child .zusatz-notiz', 'Halteverbot 3 Tage');

await page.evaluate(() => document.getElementById('addZusatzBtn').click());
await page.selectOption('.zusatz-row:nth-child(2) .zusatz-art', 'Genehmigung');
await page.fill('.zusatz-row:nth-child(2) .zusatz-menge', '1');
const genehmigung = await page.evaluate(() => {
  const row = document.querySelectorAll('.zusatz-row')[1];
  return { einheit: row.querySelector('.zusatz-einheit').value, notiz: row.querySelector('.zusatz-notiz').placeholder };
});
assert(genehmigung.einheit === 'Stk.', 'Genehmigung wird pauschal je Stück erfasst');
assert(/Behörde/.test(genehmigung.notiz), 'die Notiz schlägt die Behörde vor: ' + genehmigung.notiz);

const zusatzGespeichert = await page.evaluate(() => {
  flushAutosave();
  return getCurrentProject().zusatzpositionen;
});
assert(zusatzGespeichert.some(z => z.art === 'Parkplatz' && z.menge === 2 && z.einheit === 'Stk.'),
  'Parkplatz wird mit Anzahl und Einheit gespeichert');
assert(zusatzGespeichert.some(z => z.art === 'Genehmigung' && z.menge === 1),
  'Genehmigung wird mit Anzahl gespeichert');

const summaryText = await page.textContent('#summaryContent');
assert(/Parkplatz/.test(summaryText) && /Genehmigung/.test(summaryText),
  'beide Positionen stehen in der Zusammenfassung');

// ══ PDF – alle Erweiterungen landen im Bericht ═══════════════════════════
console.log('\nPDF-Ausgabe\n');

const pdf = await page.evaluate(() => {
  window.__pdfSaved = null;
  document.getElementById('exportPdfBtn').click();
  return (window.__pdfSaved?.calls || []).filter(c => c[0] === 'text').map(c => c[2]).join('\n');
});

assert(/Parkplatz/.test(pdf) && /Genehmigung/.test(pdf), 'PDF: die neuen Positionen erscheinen im Bericht');
assert(/Halteverbot 3 Tage/.test(pdf), 'PDF: die Notiz der Position wird mit ausgegeben');
assert(/Notizen \/ ALLGEMEINE INFORMATIONEN|NOTIZEN/i.test(pdf), 'PDF: es gibt einen Abschnitt für die Notizen');
assert(/Hausmeister/.test(pdf), 'PDF: der Notiztext steht im Bericht');
assert(/Zufahrt nur vormittags frei/.test(pdf), 'PDF: Zeilenumbrüche der Notiz bleiben erhalten');
assert(/Notiz: Balkon nur bis OK Brüstung/.test(pdf), 'PDF: die Abschnitts-Notiz steht beim Abschnitt');
assert(/Notiz: Zufahrt nur über den Hof/.test(pdf), 'PDF: die Seiten-Notiz steht bei der Hausseite');
assert(/Treppenturm/.test(pdf), 'PDF: der 50-m-Hinweis wird ausgegeben');
assert(/alle Seiten 60,00 m/.test(pdf), 'PDF: der 50-m-Hinweis über alle Seiten steht unter der Gesamtfläche');
// Höhe 3,00 m + Zuschlag 2,00 m = 5,00 m, Länge 20,00 m → „H × L"
assert(/5,00 m × 20,00 m/.test(pdf), 'PDF: Maße stehen in der neuen Reihenfolge Höhe × Länge');

// ══ AUFGABE 4b – 50-m-Hinweis über alle Hausseiten zusammen ══════════════
console.log('\nAUFGABE 4b – 50-m-Hinweis über alle Hausseiten zusammen\n');

// Frisches Projekt mit zwei Seiten à 30 m: jede einzeln unter 50 m, in Summe
// aber 60 m – genau der Fall, den erst die Projektebene aufdeckt.
await page.click('#backBtn');
await page.waitForSelector('#homeScreen:not(.hidden)');
await page.click('#newProjectBtn');
await page.waitForSelector('#projectScreen:not(.hidden)');

for (const nth of [1, 2]) {
  await page.click('#addSideBtn');
  await page.fill(`#seitenContainer .seite-card:nth-child(${nth}) .messung-hoehe`, '3');
  await page.fill(`#seitenContainer .seite-card:nth-child(${nth}) .messung-laenge`, '30');
}

const projektWarn = await page.evaluate(() => {
  const row   = document.querySelector('#summaryContent .summary-warn-row');
  const toast = document.getElementById('toastEl');
  return {
    hinweis: row ? row.textContent : '',
    seitenWarnungen: [...document.querySelectorAll('.seite-warn')]
      .filter(el => el.style.display !== 'none' && el.textContent.trim() !== '').length,
    toast: toast.classList.contains('show') ? toast.textContent : ''
  };
});
assert(projektWarn.seitenWarnungen === 0, 'keine einzelne Seite überschreitet 50 m');
assert(/Treppenturm/.test(projektWarn.hinweis),
  'die Summe aller Seiten weist auf den Treppenturm hin: ' + projektWarn.hinweis.trim());
assert(/60,00 m/.test(projektWarn.hinweis), 'der Hinweis nennt die Gesamtlänge aller Seiten');
assert(/zusammen/.test(projektWarn.toast), 'beim Überschreiten erscheint eine Meldung: ' + projektWarn.toast);

// Unter die Grenze zurück → Hinweis verschwindet wieder
await page.fill('#seitenContainer .seite-card:nth-child(2) .messung-laenge', '10');
assert(!(await page.evaluate(() => !!document.querySelector('#summaryContent .summary-warn-row'))),
  'unter 50 m Gesamtlänge verschwindet der Hinweis wieder');

// Warnt bereits eine einzelne Seite, kommt dieselbe Information nicht doppelt.
await page.fill('#seitenContainer .seite-card:nth-child(2) .messung-laenge', '60');
const doppelt = await page.evaluate(() => {
  const el = document.getElementById('toastEl');
  return el.classList.contains('show') ? el.textContent : '';
});
assert(/Seite über/.test(doppelt) && !/zusammen/.test(doppelt),
  'warnt schon eine einzelne Seite, erscheint die Meldung nicht doppelt: ' + doppelt);

// Erneutes Öffnen: Hinweis bleibt sichtbar, aber ohne neue Meldung.
await page.fill('#seitenContainer .seite-card:nth-child(2) .messung-laenge', '30');
const nachOeffnen = await page.evaluate(() => {
  document.getElementById('toastEl').classList.remove('show');
  const id = currentProjectId;
  flushAutosave();
  loadProjects();
  openProject(id);
  return {
    hinweis: !!document.querySelector('#summaryContent .summary-warn-row'),
    toast:   document.getElementById('toastEl').classList.contains('show')
  };
});
assert(nachOeffnen.hinweis, 'nach erneutem Öffnen steht der Hinweis weiterhin in der Zusammenfassung');
assert(!nachOeffnen.toast, 'beim Öffnen eines Projekts erscheint keine erneute Meldung');

// ── Keine Fehler auf der Seite ────────────────────────────────────────────
// „Failed to load resource" ignorieren: die Test-Seite hat kein favicon.ico.
const fehler = ctx.logs.filter(l =>
  (l.startsWith('[pageerror]') || l.startsWith('[error]')) && !/Failed to load resource/.test(l));
assert(fehler.length === 0, 'keine JavaScript-Fehler auf der Seite' + (fehler.length ? ':\n' + fehler.join('\n') : ''));

console.log('\nAlle Tests bestanden.');
await ctx.close();
