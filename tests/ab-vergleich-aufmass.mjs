// A/B-Nachweis für Modul 1 (Aufmaß/Positionserfassung): dieselbe Projektakte
// in der Fassung VOR dem Zusammenführen und in der zusammengeführten App –
// Flächen, Längen, 50-m-Hinweise, Zusammenfassung und der komplette PDF-Aufbau
// werden verglichen.
//
//   node tests/_ab-vergleich-aufmass.mjs <pfad-zur-alten-arbeitskopie>

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ALT_ROOT = path.join(process.argv[2], 'aufmass_final_app');
const NEU_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'aufmass_final_app');
const STUB     = path.join(path.dirname(new URL(import.meta.url).pathname), 'jspdf-stub.js');
const MIME     = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve(root) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__jspdf.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(STUB)); return;
    }
    if (url.pathname === '/__fonts.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('/* keine Webschriften */'); return;
    }
    const p = path.join(root, decodeURIComponent(url.pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end('nf'); return; }
    let body = fs.readFileSync(p);
    if (p.endsWith('.html')) {
      body = body.toString()
        .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+/, '/__jspdf.js')
        .replace(/https:\/\/fonts\.googleapis\.com\/css2[^"]*/, '/__fonts.css')
        .replace(/<link rel="preconnect"[^>]*>/g, '');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise(r => server.listen(0, () => r({ server, port: server.address().port })));
}

// ── Prüfprojekt ───────────────────────────────────────────────────────────
// Deckt ab: mehrere Hausseiten, Abschnitte mit mehreren Messungen, Zuschläge,
// Einzelfeld-Mindestmaß, Giebel (zwei Höhen), Konsolen mit Lagen, Treppenturm,
// Dachfang/Netze/Gitterträger, KS-Wert, Zusatzpositionen (Meter/Stück/pauschal),
// Notizen auf drei Ebenen und Längen jenseits der 50-m-Grenze.
const PROJEKT = {
  id: 'ab-test-projekt',
  name: 'A/B-Prüfobjekt',
  status: 'in_bearbeitung',
  folderId: null,
  erstellt: '2026-01-05',
  geaendert: '2026-01-09',
  anschrift: { strasse: 'Prüfstraße', nummer: '7a', plz: '70173', ort: 'Stuttgart',
               bauherr: 'Prüf GmbH & Co. KG', telefon: '0711 1234567' },
  geruesttyp: 'fassade',
  geruesttypName: '',
  technik: { lastklasse: '3', breitenklasse: 'W09',
             verwendungszweck: ['Maler', 'Putz', 'WDVS'],
             verankerungsgrund: 'Mauerwerk', ankerAnzahl: 48 },
  logistik: { anfahrtKm: 23.5, untergrund: 'Pflaster', stellflaecheNotiz: 'Gehweg gesperrt',
              transportM: 35, hoehenmeter: 4, treppen: 2,
              oeffentlich: true, verkehr: true, genehmigung: false },
  notizen: 'Zufahrt nur vormittags. Aufbau ab KW 12 möglich.',
  zusatzpositionen: [
    { art: 'Gerüsttreppe',      menge: 2,    einheit: 'Stk.', notiz: 'beidseitig' },
    { art: 'Bautenschutzmatte', menge: 42.5, einheit: 'm²',   notiz: '' },
    { art: 'Parkplatz',         menge: 1,    einheit: 'Stk.', notiz: 'pauschal' },
    { art: 'Genehmigung',       menge: 1,    einheit: 'Stk.', notiz: '' },
    { art: 'Bauzaun',           menge: 18,   einheit: 'm',    notiz: '' }
  ],
  seiten: [
    {
      id: 's1', name: 'Straßenseite', manualName: '', notiz: 'Erker beachten',
      wandabstand: 0.30, wdvs: 16, ks: null, ksManual: false,
      treppenturm: true, dachfang: null, gittertraeger: null,
      fussgaengertunnel: null, netze: null,
      abschnitte: [
        { id: 'a1', bezeichnung: 'Hauptfläche', einzelfeld: false, giebel: false, notiz: '',
          messungen: [
            { id: 'm1', laenge: 24.60, laengeZuschlag: 2,    hoehe: 10.20, hoeheZuschlag: null },
            { id: 'm2', laenge: 18.40, laengeZuschlag: null, hoehe:  8.20, hoeheZuschlag: 2 }
          ] },
        { id: 'a2', bezeichnung: 'Erker', einzelfeld: true, giebel: false, notiz: 'schmal',
          messungen: [ { id: 'm3', laenge: 1.20, laengeZuschlag: null, hoehe: 6.00, hoeheZuschlag: null } ] }
      ],
      konsolen: [
        { typ: '30',   laenge: 24.60, autoL1: true,  lage: { l1: true, l2: false, l3: false } },
        { typ: '50df', laenge: 12.00, autoL1: false, lage: { l1: false, l2: true, l3: false } }
      ]
    },
    {
      id: 's2', name: 'Giebelseite Ost', manualName: '', notiz: '',
      wandabstand: 0.25, wdvs: null, ks: 3.4, ksManual: true,
      treppenturm: false, dachfang: 'df1', gittertraeger: null,
      fussgaengertunnel: null, netze: 'ne1',
      abschnitte: [
        { id: 'a3', bezeichnung: 'Giebel', einzelfeld: false, giebel: true, notiz: '',
          messungen: [ { id: 'm4', laenge: 9.80, laengeZuschlag: null,
                         hoehe: 7.00, hoeheZuschlag: null, hoehe2: 12.40, hoehe2Zuschlag: 2 } ] },
        { id: 'a4', bezeichnung: '', einzelfeld: false, giebel: false, notiz: '',
          messungen: [ { id: 'm5', laenge: 12.85, laengeZuschlag: null, hoehe: 10.20, hoeheZuschlag: null } ] }
      ],
      konsolen: [ { typ: '70', laenge: 9.80, autoL1: false, lage: { l1: true, l2: true, l3: false } } ]
    },
    {
      id: 's3', name: 'Hofseite', manualName: 'Hof / Anlieferung', notiz: 'Container steht davor',
      wandabstand: null, wdvs: null, ks: null, ksManual: false,
      treppenturm: false, dachfang: null, gittertraeger: 'gt1',
      fussgaengertunnel: 'ft1', netze: null,
      abschnitte: [
        { id: 'a5', bezeichnung: 'Rückwand', einzelfeld: false, giebel: false, notiz: '',
          messungen: [
            { id: 'm6', laenge: 31.20, laengeZuschlag: 2, hoehe: 10.20, hoeheZuschlag: null },
            { id: 'm7', laenge:  6.40, laengeZuschlag: null, hoehe: 4.00, hoeheZuschlag: null }
          ] }
      ],
      konsolen: []
    }
  ],
  zeichnung2d: null
};

const AUSWERTUNG = () => {
  const rein = v => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)));
  // Datenseite: das, was die App aus dem ausgefüllten Formular liest.
  const proj = {};
  collectProjectFromForm(proj);          // füllt `proj` aus dem Formular
  // Anzeigeseite: die Kennzahlen, die an jeder Hausseiten-Karte stehen.
  const karten = [...document.querySelectorAll('#seitenContainer .seite-card')];

  return rein({
    projektLaenge: projektLaenge(),
    warn50:        projektWarn50,
    kartenwerte: karten.map(card => ({
      flaeche:   computeCardFlaeche(card),
      laenge:    computeCardLaenge(card),
      maxHoehe:  computeCardMaxHoehe(card)
    })),
    seiten: (proj.seiten || []).map(s => ({
      name:      getSeiteName(s),
      ttHinweis: treppenturmHinweis(computeCardLaenge(karten[(proj.seiten || []).indexOf(s)]), 'dieser Seite'),
      wandabstand: s.wandabstand, wdvs: s.wdvs, ks: s.ks,
      treppenturm: s.treppenturm, dachfang: s.dachfang, netze: s.netze,
      gittertraeger: s.gittertraeger, fussgaengertunnel: s.fussgaengertunnel,
      notiz: s.notiz,
      abschnitte: (s.abschnitte || []).map(a => ({
        flaeche: berechneAbschnitt(a),
        laenge:  abschnittLaenge(a),
        // Zeilen-IDs entstehen aus Zeitstempel + Zufall (genId) und sind
        // absichtlich bei jedem Lauf anders – für den Vergleich ohne Belang.
        messungen: (a.messungen || []).map(({ id, ...rest }) => rest)
      })),
      konsolen: (s.konsolen || []).map(k => ({
        meter: konsoleTypMeter(k.typ),
        label: konsoleTypLabel(k.typ),
        lagen: lagenAnzahl(k.lage),
        lage:  lageLabel(k.lage),
        eff:   effektiveLaenge(k.laenge, k.lage)
      }))
    })),
    zusatzpositionen: proj.zusatzpositionen,
    technik:          proj.technik,
    logistik:         proj.logistik,
    notizen:          proj.notizen,
    zusammenfassung:  document.getElementById('summaryContent').textContent.replace(/\s+/g, ' ').trim()
  });
};

async function lauf(root, ziel) {
  const { server, port } = await serve(root);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } });
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  // Über den ALTEN Schlüssel säen: die alte App liest ihn direkt, die
  // zusammengeführte migriert ihn beim Start – genau der vorgesehene Weg.
  await page.addInitScript(p => localStorage.setItem('aufmass_projects_v2', JSON.stringify([p])), PROJEKT);
  await page.goto(`http://127.0.0.1:${port}/${ziel}`);
  await page.waitForFunction(() => !!document.getElementById('projectGrid') && typeof window.jspdf !== 'undefined');
  await page.waitForTimeout(500);

  await page.evaluate(() => { openProject('ab-test-projekt'); updateSummary(); });
  await page.waitForTimeout(400);
  const werte = await page.evaluate(AUSWERTUNG);

  await page.evaluate(() => generatePDF());
  await page.waitForFunction(() => !!window.__pdfSaved, null, { timeout: 20000 });
  const pdf = await page.evaluate(() => ({
    seiten: window.__pdfSaved.pages,
    aufrufe: window.__pdfSaved.calls.map(a => a.join(''))
  }));

  await browser.close();
  server.close();
  return { werte, pdf, fehler };
}

const alt = await lauf(ALT_ROOT, 'index.html');
const neu = await lauf(NEU_ROOT, 'index.html#/aufmass');

let abweichungen = 0;
function pruefe(name, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { console.log('  ✓ ' + name); return; }
  abweichungen++;
  console.log('  ✗ ' + name);
  console.log('      vorher : ' + String(sa).slice(0, 500));
  console.log('      nachher: ' + String(sb).slice(0, 500));
}

console.log('\nA/B-VERGLEICH MODUL 1 (Aufmaß)  vorher ↔ nachher\n');
console.log('Rechenergebnisse:');
Object.keys(alt.werte).forEach(k => pruefe(k, alt.werte[k], neu.werte[k]));

console.log('\nPDF-Export:');
pruefe('Seitenzahl', alt.pdf.seiten, neu.pdf.seiten);
pruefe('Anzahl Zeichenaufrufe', alt.pdf.aufrufe.length, neu.pdf.aufrufe.length);
const n = Math.max(alt.pdf.aufrufe.length, neu.pdf.aufrufe.length);
let ersteAbw = -1;
for (let i = 0; i < n; i++) if (alt.pdf.aufrufe[i] !== neu.pdf.aufrufe[i]) { ersteAbw = i; break; }
if (ersteAbw < 0) console.log('  ✓ alle ' + n + ' Zeichenaufrufe identisch (Text, Position, Reihenfolge, Seite)');
else {
  abweichungen++;
  console.log('  ✗ erste Abweichung bei Aufruf #' + ersteAbw);
  console.log('      vorher : ' + alt.pdf.aufrufe[ersteAbw]);
  console.log('      nachher: ' + neu.pdf.aufrufe[ersteAbw]);
}

if (alt.fehler.length || neu.fehler.length) {
  console.log('\nJS-Fehler vorher: ' + JSON.stringify(alt.fehler));
  console.log('JS-Fehler nachher: ' + JSON.stringify(neu.fehler));
}

console.log('\n' + (abweichungen === 0
  ? 'Ergebnis: rechnerisch identisch – keine einzige Abweichung.'
  : `Ergebnis: ${abweichungen} Abweichung(en).`));
process.exit(abweichungen === 0 ? 0 : 1);
