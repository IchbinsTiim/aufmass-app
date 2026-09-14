// Runde 12 – die Hülle: ist die Aufmaß-App ohne Anmeldung wirklich zu?
//
// Diese Datei prüft nicht die Fachlogik, sondern die Zugangssperre. Sie
// startet die gebaute Next.js-Anwendung und ruft sie ab, wie es ein
// Unbeteiligter täte: ohne Sitzung, ohne Cookie, über die Adresse.
//
//   node tests/r12-huelle-schutz.mjs
//
// Dass die Anmeldung selbst funktioniert, prüft Clerk; hier geht es um die
// Gegenrichtung – dass NICHTS von der Anwendung herausfällt, solange
// niemand angemeldet ist.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from './harness.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Platzhalter im Format, das Clerk erwartet – echte Schlüssel gehören weder
// ins Repository noch in einen Testlauf. Zum Prüfen der Sperre genügt das:
// ohne gültige Sitzung lehnt die Anwendung so oder so ab.
const UMGEBUNG = {
  ...process.env,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || 'pk_test_Y2xlcmsuYXVmbWFzc3guY29tJA',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || 'sk_test_platzhalter_fuer_den_testlauf'
};

console.log('\nRUNDE 12 – Hülle: Zugangssperre\n');

// ── 1. Keine Geheimnisse im Repository ──────────────────────────────────────
// Der teuerste Fehler dieser Umbaumaßnahme wäre ein Schlüssel in Git. Also
// wird zuerst danach gesucht – in dem, was Git tatsächlich kennt.
const verfolgt = spawnSync('git', ['ls-files', '-z'], { cwd: WURZEL, encoding: 'utf8' })
  .stdout.split('\0').filter(Boolean);

assert(!verfolgt.some(d => d === '.env' || d.startsWith('.env.') && d !== '.env.example'),
  'keine .env-Datei mit Schlüsseln unter Versionskontrolle');

const echteSchluessel = [];
for (const datei of verfolgt) {
  const voll = path.join(WURZEL, datei);
  let inhalt;
  try { inhalt = fs.readFileSync(voll, 'utf8'); } catch { continue; }
  // sk_live/sk_test mit echter Länge; die Platzhalter in .env.example und in
  // dieser Datei sind kurz bzw. als solche erkennbar.
  const treffer = inhalt.match(/sk_(?:live|test)_[A-Za-z0-9]{24,}/g);
  if (treffer) echteSchluessel.push(datei + ': ' + treffer[0].slice(0, 12) + '…');
}
assert(echteSchluessel.length === 0,
  'kein Clerk-Secret-Key im Quellcode: ' + JSON.stringify(echteSchluessel));

// Die Aufmaß-App darf nicht unter public/ liegen – von dort läge sie am
// Server vorbei im Netz.
assert(!verfolgt.some(d => d.startsWith('public/')),
  'nichts von der Anwendung liegt in public/');
assert(verfolgt.some(d => d.startsWith('legacy-app/')),
  'die Aufmaß-App liegt in legacy-app/ und wird ausgeliefert');

// Die alte, ungeschützte Veröffentlichung über GitHub Pages darf es nicht
// mehr geben: sie wäre eine zweite, anmeldefreie Ausgabe derselben App.
assert(!verfolgt.some(d => d === '.github/workflows/pages.yml' || d === 'CNAME'),
  'keine GitHub-Pages-Veröffentlichung mehr im Repository');

// ── 2. Anwendung bauen und starten ──────────────────────────────────────────
if (!fs.existsSync(path.join(WURZEL, '.next', 'BUILD_ID'))) {
  console.log('  … kein Build vorhanden, npx next build läuft');
  const bau = spawnSync('npx', ['next', 'build'], { cwd: WURZEL, env: UMGEBUNG, stdio: 'inherit' });
  if (bau.status !== 0) throw new Error('next build fehlgeschlagen');
}

const port = await freierPort();
const server = spawn('npx', ['next', 'start', '-p', String(port)], {
  cwd: WURZEL, env: UMGEBUNG, stdio: ['ignore', 'pipe', 'pipe']
});
let serverAusgabe = '';
server.stdout.on('data', d => { serverAusgabe += d; });
server.stderr.on('data', d => { serverAusgabe += d; });

try {
  await warteAufServer(port);

  const basis = `http://127.0.0.1:${port}`;
  const hole = (pfad) => fetch(basis + pfad, { redirect: 'manual' });

  // ── 3. Nichts von der Anwendung ohne Anmeldung ────────────────────────────
  // Für jede dieser Adressen gilt: kein 200, und im Rumpf nichts, woran man
  // die App erkennt. Die Marker sind bewusst Zeichenketten aus dem INHALT
  // der App – die Zeichenfläche, der Modul-Umschalter, die Modulnamen. Ein
  // Dateiname wie `viewer2d.js` taugt nicht: den enthält schon die
  // Weiterleitungsadresse selbst, die im Rumpf eines 307 wiederholt wird.
  const MARKER = [
    'planSvg', 'modSwitcher', 'AufmassModul', 'ZweiDModul',
    'hub-tile', 'geruest.aufmass.projekte'
  ];

  const geschuetzt = [
    '/',
    '/app',
    '/app/',
    '/app/index.html',
    '/app/core.js',
    '/app/script.js',
    '/app/viewer2d.js',
    '/app/shell.js',
    '/app/core.css',
    '/app/style.css',
    '/app/viewer2d.css',
    '/app/start.html',
    '/app/viewer2d.html',
    '/konto',
    '/kein-zugang',
    '/admin/einladungen',
    // Die Mitarbeiterverwaltung zeigt Namen, E-Mail-Adressen und
    // Anmeldezeitpunkte – sie ist ohne Anmeldung genauso zu wie die App.
    '/mitarbeiter',
    '/mitarbeiter/user_beispiel',
    '/rollen'
  ];

  for (const pfad of geschuetzt) {
    const antwort = await hole(pfad);
    const rumpf = await antwort.text();
    const verraeterisch = MARKER.filter(m => rumpf.includes(m));
    assert(antwort.status !== 200 && verraeterisch.length === 0,
      `${pfad} ist ohne Anmeldung zu (${antwort.status}${verraeterisch.length ? ', verrät: ' + verraeterisch : ''})`);
    // Eine Weiterleitung hat einen kurzen Rumpf. Ein langer wäre der Hinweis,
    // dass trotz 3xx etwas mitgeliefert wird.
    assert(rumpf.length < 2000, `${pfad} liefert keinen Inhalt mit (${rumpf.length} Zeichen)`);
  }

  // ── 4. Die alten Adressen sind kein Schlupfloch mehr ──────────────────────
  // Vor der Umstellung lag die App unter /aufmass_final_app/. Wer sich das
  // gemerkt hat, darf damit nicht an der Anmeldung vorbeikommen.
  const alteAdressen = [
    '/aufmass_final_app/index.html',
    '/aufmass_final_app/viewer2d.html',
    '/aufmass_final_app/start.html',
    '/aufmass_final_app/viewer2d.js',
    '/aufmass_final_app/script.js',
    '/aufmass_final_app/style.css'
  ];

  for (const pfad of alteAdressen) {
    const antwort = await hole(pfad);
    const rumpf = await antwort.text();
    assert(antwort.status !== 200 && !MARKER.some(m => rumpf.includes(m)),
      `${pfad} liefert die App nicht mehr aus (${antwort.status})`);
    assert([301, 302, 307, 308].includes(antwort.status),
      `${pfad} leitet weiter statt zu antworten (${antwort.status})`);
  }

  // ── 5. Pfad-Ausbruch aus dem App-Ordner ──────────────────────────────────
  // Der Route Handler liest Dateien vom Dateisystem. Er darf dabei den
  // Ordner legacy-app/ unter keinen Umständen verlassen.
  const ausbrueche = [
    '/app/../package.json',
    '/app/..%2Fpackage.json',
    '/app/%2e%2e/proxy.ts',
    '/app/../../etc/passwd',
    '/app/../.env.local'
  ];
  for (const pfad of ausbrueche) {
    const antwort = await hole(pfad);
    const rumpf = await antwort.text();
    assert(antwort.status !== 200 && !rumpf.includes('CLERK_SECRET') && !rumpf.includes('root:'),
      `Ausbruchsversuch ${pfad} bleibt erfolglos (${antwort.status})`);
  }

  // ── 6. Was offen sein MUSS, ist offen ────────────────────────────────────
  const anmeldung = await hole('/sign-in');
  const anmeldeRumpf = await anmeldung.text();
  assert(anmeldung.status === 200, 'die Anmeldeseite ist ohne Anmeldung erreichbar');
  assert(!MARKER.some(m => anmeldeRumpf.includes(m)),
    'die Anmeldeseite enthält nichts aus der Aufmaß-App');

  // ── 7. Keine öffentliche Registrierung ───────────────────────────────────
  // Die frühere Clerk-Registrierungsseite gibt es nicht mehr. Wer sie aufruft,
  // bekommt kein Formular, sondern die Anmeldung.
  const altesSignUp = await hole('/sign-up');
  assert(altesSignUp.status !== 200, `/sign-up ist keine offene Registrierung mehr (${altesSignUp.status})`);

  // Der Weg über den Einladungscode ist offen – er muss es sein, sonst käme
  // ein neuer Mitarbeiter nie herein. Er gibt aber nichts preis.
  const einladung = await hole('/einladung');
  const einladungRumpf = await einladung.text();
  assert(einladung.status === 200, 'die Einladungsseite ist ohne Anmeldung erreichbar');
  assert(!MARKER.some(m => einladungRumpf.includes(m)),
    'die Einladungsseite enthält nichts aus der Aufmaß-App');
  assert(/Einladungscode/i.test(einladungRumpf),
    'die Einladungsseite fragt nach dem Code');

  // Die Verwaltung ist keine offene Tür – weder für Codes noch für
  // Mitarbeiterdaten oder Rollen.
  for (const pfad of ['/admin/einladungen', '/mitarbeiter', '/rollen']) {
    const verwaltung = await hole(pfad);
    const rumpf = await verwaltung.text();
    assert(verwaltung.status !== 200, `${pfad} ist ohne Anmeldung zu (${verwaltung.status})`);
    assert(!/Mitarbeiter verwalten|Rollen &amp; Rechte|Einladungscode erstellen/.test(rumpf),
      `${pfad} gibt ohne Anmeldung nichts preis`);
  }

  // ── 8. Registrierung ohne gültigen Code ──────────────────────────────────
  // Die Route legt ohne Code kein Konto an – weder mit leerem Code, noch mit
  // erfundenem, noch ganz ohne Feld.
  //
  // Hinweis zum Lesen der Ausgabe: läuft dieser Test ohne DATABASE_URL, lehnt
  // die Route schon deshalb ab (503). Dass sie AUCH mit eingerichteter
  // Datenbank ablehnt – und dass ein Code nur einmal zieht, abläuft, sich
  // widerrufen lässt und einen Wettlauf übersteht – weist
  // tests/r13-einladungscodes.mjs gegen ein echtes Postgres nach.
  const versuche = [
    { name: 'ohne Code',        rumpf: { benutzername: 'eindringling', passwort: 'GeheimGenug123' } },
    { name: 'mit leerem Code',  rumpf: { code: '', benutzername: 'eindringling', passwort: 'GeheimGenug123' } },
    { name: 'mit Fantasiecode', rumpf: { code: 'XXXX-XXXX-XXXX', benutzername: 'eindringling', passwort: 'GeheimGenug123' } },
    { name: 'mit ok:true',      rumpf: { code: 'XXXX-XXXX-XXXX', ok: true, geprueft: true, benutzername: 'eindringling', passwort: 'GeheimGenug123' } }
  ];

  for (const versuch of versuche) {
    const antwort = await fetch(basis + '/api/einladung/registrieren', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(versuch.rumpf),
      redirect: 'manual'
    });
    const daten = await antwort.json().catch(() => ({}));
    assert(antwort.status !== 200 && daten.ok !== true,
      `Registrierung ${versuch.name} wird abgelehnt (${antwort.status})`);
  }

  // Die Ablehnung verrät nicht, WORAN es lag – sonst wäre die Route ein
  // Auskunftsdienst darüber, welche Codes es gibt.
  const pruefAntwort = await fetch(basis + '/api/einladung/pruefen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'XXXX-XXXX-XXXX' }),
    redirect: 'manual'
  });
  const pruefDaten = await pruefAntwort.json().catch(() => ({}));
  assert(pruefAntwort.status !== 200 && pruefDaten.ok !== true,
    `ein erfundener Code besteht die Prüfung nicht (${pruefAntwort.status})`);
  assert(!/abgelaufen|verwendet|widerrufen|unbekannt/i.test(String(pruefDaten.meldung || '')),
    'die Ablehnung nennt keinen Grund: ' + JSON.stringify(pruefDaten.meldung));

  // ── 9. Der Secret Key bleibt auf dem Server ──────────────────────────────
  // Das Browser-Bündel wird durchsucht: weder der Schlüssel selbst noch der
  // Name der Variablen dürfen dort auftauchen.
  const geheim = UMGEBUNG.CLERK_SECRET_KEY;
  const funde = [];
  for (const datei of dateienUnter(path.join(WURZEL, '.next', 'static'))) {
    const inhalt = fs.readFileSync(datei, 'utf8');
    if (inhalt.includes(geheim) || /sk_(live|test)_[A-Za-z0-9]{10,}/.test(inhalt)) {
      funde.push(path.relative(WURZEL, datei));
    }
  }
  assert(funde.length === 0,
    'kein Clerk-Secret-Key im Browser-Bündel: ' + JSON.stringify(funde));

  const oeffentlich = await (await hole('/sign-in')).text();
  assert(!oeffentlich.includes(geheim) && !oeffentlich.includes('CLERK_SECRET_KEY'),
    'auch die ausgelieferte Seite enthält den Secret Key nicht');

  console.log('\nAlle Tests zur Zugangssperre bestanden.');
} finally {
  server.kill('SIGTERM');
}

// Der gestartete Server hält den Prozess sonst offen.
process.exit(process.exitCode ?? 0);

// ── Hilfen ──────────────────────────────────────────────────────────────────

/** Alle Dateien unterhalb eines Ordners, flach aufgelistet. */
function dateienUnter(ordner) {
  if (!fs.existsSync(ordner)) return [];
  const gefunden = [];
  for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
    const voll = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) gefunden.push(...dateienUnter(voll));
    else gefunden.push(voll);
  }
  return gefunden;
}

function freierPort() {
  return new Promise((fertig, fehler) => {
    const s = net.createServer();
    s.on('error', fehler);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => fertig(port));
    });
  });
}

async function warteAufServer(port) {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/sign-in`, { redirect: 'manual' });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('Server ist nicht gestartet:\n' + serverAusgabe);
}
