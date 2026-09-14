// Führt alle Testdateien nacheinander aus und meldet am Ende, was gelaufen ist.
//
//   node tests/alle.mjs
//
// Die beiden A/B-Vergleiche brauchen eine alte Arbeitskopie als Argument und
// laufen deshalb nicht mit – wie sie zu starten sind, steht in tests/README.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));

const DATEIEN = [
  't1-abschnitte.mjs',
  't2-rotation.mjs',
  't3-pdf.mjs',
  'fitcheck.mjs',
  'e2e.mjs',
  'r2-t1-sichtbarkeit.mjs',
  'r2-t2-mehrfach.mjs',
  'r2-t4-pdf-overlap.mjs',
  'r2-t6-aufmass.mjs',
  'r3-t1-innenecken.mjs',
  'r4-aufmass-positionen.mjs',
  'r5-bordbretter.mjs',
  'r6-blaetter-verbreiterung.mjs',
  'r7-shell-routing.mjs',
  'r8-2d-projektliste.mjs',
  'r9-2d-zeichnungen.mjs',
  'r10-werkzeugmenue.mjs',
  'r11-aufmass-hoehenkorrektur.mjs',
  'r12-runde7.mjs',
  'r12-huelle-schutz.mjs',
  'r15-cloud-zeichnungen.mjs',
  'r17-cloud-parallel.mjs',
  'r16-cloud-zeichnungen-ui.mjs',
  'r13-einladungscodes.mjs',
  'r14-runde8.mjs',
  'r18-tutorial.mjs',
  'r19-rollen-rechte.mjs',
  'r20-pdf-beschriftung.mjs',
  'r21-zeichnung-navigation.mjs'
];

const fehlgeschlagen = [];

for (const datei of DATEIEN) {
  console.log(`\n──────── ${datei} ────────`);
  const lauf = spawnSync(process.execPath, [path.join(HIER, datei)], { stdio: 'inherit' });
  if (lauf.status !== 0) fehlgeschlagen.push(datei);
}

console.log('\n════════════════════════════════════════');
if (fehlgeschlagen.length === 0) {
  console.log(`Alle ${DATEIEN.length} Testdateien bestanden.`);
} else {
  console.log(`${fehlgeschlagen.length} von ${DATEIEN.length} fehlgeschlagen:`);
  fehlgeschlagen.forEach(d => console.log('  ✗ ' + d));
  process.exitCode = 1;
}
