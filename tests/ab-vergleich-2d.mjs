// A/B-Nachweis: rechnet die zusammengeführte App und die Fassung VOR dem
// Zusammenführen mit demselben Aufmaß durch und vergleicht die Ergebnisse –
// Aufmaßregeln nach ATV DIN 18451, Eckenkorrektur, Bordbretter, Positionen
// und den kompletten PDF-Aufbau (jeder Zeichenaufruf mit Text und Koordinate).
//
//   node tests/_ab-vergleich.mjs <pfad-zur-alten-arbeitskopie>

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
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(fs.readFileSync(STUB));
      return;
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

// ── Prüfaufmaß ────────────────────────────────────────────────────────────
// Bewusst mit allem, was rechnerisch zählt: geschlossener Umlauf mit Außen-
// und Innenecken, verschiedene Feldlängen, unterschiedliche Höhen links/rechts,
// Konsolen/Netze/Verbreiterungen, zwei Abschnitte, eine Bordbretter-Linie.
const AUFBAU = () => {
  state.project = 'A/B-Prüfobjekt';
  state.depth   = 0.73;
  state.abschnitte = [];
  state.ecken = {};
  state.bordbretter = [];
  state.sections = [];
  _sId = 0; _bId = 0;

  // Der einzige umbenannte Bezeichner: in der alten Fassung KONSOLE_TYPES,
  // in der zusammengeführten KONSOLE_TYPES_2D (Kollision mit dem Aufmaß-Modul).
  const KT = (typeof KONSOLE_TYPES_2D !== 'undefined') ? KONSOLE_TYPES_2D : KONSOLE_TYPES;

  const mk = (dir, x0, y0, laengen, hL, hR) => {
    const s = mkSection(dir, x0, y0);
    setSectionAngle(s, { E: 0, S: 90, W: 180, N: 270 }[dir]);
    laengen.forEach(l => {
      const b = mkBay(l);
      b.hL = hL; b.hR = hR;
      s.bays.push(b);
    });
    state.sections.push(s);
    return s;
  };

  // Rechteckiger Umlauf (Außenecken) …
  const nord = mk('E',    0,    0, [2.57, 2.57, 2.57, 3.07], 10.20, 10.20);
  const ost  = mk('S',  1078,   0, [2.57, 2.57, 2.07],        8.20,  8.20);
  const sued = mk('W',  1078, 721, [3.07, 2.57, 2.57, 2.57], 10.20,  8.20);
  const west = mk('N',    0,  721, [2.57, 2.57, 2.07],        6.00,  6.00);

  // … plus ein einspringender Flügel (Innenecke)
  mk('S', 514, 0, [2.57, 2.57], 10.20, 10.20);

  // Abschnitte
  const a1 = addAbschnitt('Nordseite');
  const a2 = addAbschnitt('Hofseite');
  nord.bays.forEach(b => (b.abschnittId = a1.id));
  sued.bays.forEach(b => (b.abschnittId = a2.id));

  // Positionen: Konsolen (Lagen + Meter), Netz, Verbreiterung mit Rohr,
  // Modul-Abstützung mit eigenen Maßen, Innengeländer in laufenden Metern.
  ost.bays[0].positions.push({ id: ++_bId, cat: 'konsole', typ: KT[1], lagen: '2', billing: 'lagen' });
  ost.bays[1].positions.push({ id: ++_bId, cat: 'konsole', typ: KT[3], billing: 'meter', qty: '4,50' });
  ost.bays[2].positions.push({ id: ++_bId, cat: 'netz' });
  west.bays[0].positions.push({ id: ++_bId, cat: 'innengelaender', qty: '2,57' });
  west.bays[1].positions.push({ id: ++_bId, cat: 'verbreiterung_rohr' });
  west.bays[2].positions.push({ id: ++_bId, cat: 'modul_abstuetzung', len: '1,50', breite: '0,73', hoehe: '4,00' });
  nord.bays[3].positions.push({ id: ++_bId, cat: 'treppenturm' });

  normalizeState();
  renderAllNow();
};

// ── Auslesen aller rechnerischen Ergebnisse ───────────────────────────────
const AUSWERTUNG = () => {
  const rein = v => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)));
  return rein({
    gesamtflaeche:  computeTotalFlaeche(),
    warnungen:      computeTotalWarnings(),
    aufmassRegeln:  aufmassRules(),
    eckenListe:     eckenListe(),
    eckKorrekturen: eckKorrekturen(),
    aufmass:        computeAufmass(allBaysFlat()),
    aufmassAchsen:  aufmassAchsen(),
    achsenListe:    achsenListe(),
    positionen:     aggregatePositions(allBaysFlat()),
    felder:         collectFields(),
    feldSeiten:     fieldsBySide(),
    bordbretter:    bordbretterAufstellung(),
    eckZuschlag:    eckZuschlagWert(),
    innenEck:       innenEckWert()
  });
};

async function lauf(root, hash) {
  const { server, port } = await serve(root);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } });
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('av_deviceMode', 'ipad');
    localStorage.setItem('geruest.2d.geraetemodus', 'ipad');
  });
  await page.goto(`http://127.0.0.1:${port}/${hash}`);
  await page.waitForFunction(() => !!document.getElementById('planSvg'));
  await page.waitForTimeout(600);

  await page.evaluate(AUFBAU);
  await page.waitForTimeout(400);
  const werte = await page.evaluate(AUSWERTUNG);

  // PDF über die echte Exportstrecke erzeugen (jsPDF ist gestubbt).
  await page.evaluate(() => buildPdf());
  await page.waitForFunction(() => !!window.__pdfSaved, null, { timeout: 20000 });
  const pdf = await page.evaluate(() => ({
    seiten: window.__pdfSaved.pages,
    aufrufe: window.__pdfSaved.calls.map(a => a.join(''))
  }));

  await browser.close();
  server.close();
  return { werte, pdf, fehler };
}

const alt = await lauf(ALT_ROOT, 'viewer2d.html');
const neu = await lauf(NEU_ROOT, 'index.html#/2d');

let abweichungen = 0;
function pruefe(name, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { console.log('  ✓ ' + name); return; }
  abweichungen++;
  console.log('  ✗ ' + name);
  console.log('      vorher : ' + String(sa).slice(0, 400));
  console.log('      nachher: ' + String(sb).slice(0, 400));
}

console.log('\nA/B-VERGLEICH  vorher (zwei Apps)  ↔  nachher (zusammengeführt)\n');
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
