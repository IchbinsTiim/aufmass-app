// Runde 23 – Cloud: getrennte Namensräume für Aufmaß und 2D-Aufmaß.
//
// Läuft gegen ein echtes Postgres im Speicher (PGlite) mit dem Schema aus
// db/schema.sql, der Migration db/migrations/20260928_app_trennung.sql und
// den SQL-Anweisungen aus lib/projekte/cloud.ts – also gegen dieselben
// Anweisungen, die später auf Neon laufen.
//
//   1. Die Migration übernimmt den Altbestand verlustfrei: die Zeichnung
//      wird ein eigener Datensatz der 2D-App (z2d_<Projekt-ID>) samt Ordner,
//      Freigaben und benannten Speicherständen; das Aufmaß-Projekt verliert
//      nur das Feld `zeichnung2d`. Ein zweiter Lauf ändert nichts.
//   2. Die Cloud-Funktionen trennen strikt: jede Anwendung sieht und ändert
//      nur ihre eigenen Datensätze.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// cloud.ts nutzt TypeScript-Syntax, die Node nur mit Transformation lädt.
if (!process.execArgv.includes('--experimental-transform-types')) {
  const lauf = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(lauf.status ?? 1);
}

const { register } = await import('node:module');
const { PGlite } = await import('@electric-sql/pglite');
const fs = await import('node:fs');
const { assert } = await import('./harness.mjs');
// jsonb ordnet Schlüssel neu – verglichen wird der Inhalt, nicht die Reihenfolge.
const { isDeepStrictEqual: gleich } = await import('node:util');

const WURZEL = new URL('..', import.meta.url).href;
// `@/…` wie in tsconfig.json; die Datenbankverbindung zeigt auf PGlite.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@/lib/einladungen/db') return { url: 'data:text/javascript,export const abfrageHolen = () => globalThis.__testAbfrage;', shortCircuit: true };
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + '.ts', ${JSON.stringify(WURZEL)}).href, ctx);
    return next(spec, ctx);
  }`));

const db = new PGlite();
const sql = async (q, p) => (await db.query(q, p)).rows;
globalThis.__testAbfrage = sql;
const lies = datei => fs.readFileSync(new URL('../' + datei, import.meta.url), 'utf8');

console.log('RUNDE 23 – Cloud: Trennung der Anwendungen\n');

// ── Ausgangslage: Datenbank VOR der Trennung ───────────────────────────────
await db.exec(lies('db/schema.sql'));
await db.exec('ALTER TABLE cloud_projekte DROP COLUMN app; ALTER TABLE cloud_ordner DROP COLUMN app;');

const zeichnung = {
  depth: 1.09,
  sections: [{ id: 1, name: 'A', dir: 'E', x0: 0, y0: 0, bays: [{ id: 1, len: 2.57, hL: 8, hR: null, positions: [] }] }],
  abschnitte: [], ecken: { 'E1-2': { stirnseite: { netz: '2' } } }, _sId: 1, _bId: 1
};
const projekt = (id, owner, inhalt) => sql(
  `INSERT INTO cloud_projekte (id, owner_user_id, titel, inhalt, revision, erstellt_von, geaendert_von)
   VALUES ($1, $2, $3, $4::jsonb, 3, $2, $2)`, [id, owner, inhalt.name, JSON.stringify(inhalt)]);
await projekt('p1', 'anna', { id: 'p1', name: 'Hofstraße', folderId: 'f1', erstellt: '2026-03-01',
  geaendert: '2026-03-02', anschrift: { ort: 'Stuttgart' }, seiten: [{ name: 'Nord' }], zeichnung2d: zeichnung });
await projekt('p2', 'anna', { id: 'p2', name: 'Nur Aufmaß', folderId: 'f2', seiten: [], zeichnung2d: null });
await projekt('p3', 'anna', { id: 'p3', name: 'Nur Speicherstand', seiten: [] });
await sql(`INSERT INTO cloud_ordner (id, owner_user_id, inhalt, erstellt_von) VALUES
  ('f1', 'anna', '{"id":"f1","name":"Baustellen"}', 'anna'),
  ('f2', 'anna', '{"id":"f2","name":"Nur Aufmaß"}', 'anna')`);
await sql(`INSERT INTO cloud_projekt_freigaben (projekt_id, user_id, rolle) VALUES ('p1', 'bernd', 'lesen')`);
await sql(`INSERT INTO cloud_zeichnungen (id, projekt_id, name, inhalt, erstellt_von, quelle) VALUES
  ('s1', 'p1', 'Stand 1', '{}', 'anna', 'zeichnung'),
  ('s3', 'p3', 'Stand 3', '{}', 'anna', 'upload')`);

// ── 1. Migration ────────────────────────────────────────────────────────────
console.log('1 · Migration\n');
const migration = lies('db/migrations/20260928_app_trennung.sql');
await db.exec(migration);
const stand = async () => ({
  projekte: await sql('SELECT id, app, revision, owner_user_id, erstellt_von, inhalt FROM cloud_projekte ORDER BY id'),
  ordner: await sql('SELECT id, app, inhalt FROM cloud_ordner ORDER BY id'),
  freigaben: await sql('SELECT projekt_id, user_id, rolle FROM cloud_projekt_freigaben ORDER BY projekt_id'),
  staende: await sql('SELECT id, projekt_id FROM cloud_zeichnungen ORDER BY id')
});
const nach1 = await stand();
const zeile = id => nach1.projekte.find(p => p.id === id);

assert(nach1.projekte.map(p => `${p.id}:${p.app}`).join() === 'p1:aufmass,p2:aufmass,p3:aufmass,z2d_p1:2d,z2d_p3:2d',
  'je Zeichnung ein eigener 2D-Datensatz; ein Projekt ohne Zeichnung bekommt keinen: '
  + nach1.projekte.map(p => `${p.id}:${p.app}`).join());
assert(gleich(zeile('z2d_p1').inhalt.zeichnung2d, zeichnung),
  'die Zeichnung ist Zeichen für Zeichen übernommen (auch null-Werte und Eck-Einstellungen)');
const z1 = zeile('z2d_p1').inhalt;
assert(z1.id === 'z2d_p1' && z1.name === 'Hofstraße' && z1.folderId === 'z2d_f1'
  && z1.anschrift.ort === 'Stuttgart' && z1.ausAufmass === 'p1',
  'Name, Ordner, Anschrift und Herkunft stehen im 2D-Datensatz');
assert(zeile('z2d_p1').owner_user_id === 'anna' && zeile('z2d_p1').erstellt_von === 'anna',
  'Eigentümer und Ersteller bleiben');
assert(Array.isArray(zeile('z2d_p3').inhalt.zeichnung2d.sections)
  && zeile('z2d_p3').inhalt.zeichnung2d.sections.length === 0,
  'ein Projekt mit Speicherstand, aber ohne laufende Zeichnung bekommt eine leere Zeichnung');
assert(['p1', 'p2', 'p3'].every(id => !('zeichnung2d' in zeile(id).inhalt)),
  'Aufmaß-Projekte tragen keine Zeichnung mehr');
assert(zeile('p1').inhalt.seiten.length === 1 && zeile('p1').revision === 3,
  'der Aufmaß-Inhalt und die Revision bleiben unverändert');
assert(nach1.ordner.map(o => `${o.id}:${o.app}`).join() === 'f1:aufmass,f2:aufmass,z2d_f1:2d'
  && nach1.ordner.find(o => o.id === 'z2d_f1').inhalt.id === 'z2d_f1',
  'der Ordner mit Zeichnung wird ein eigener 2D-Ordner; die Aufmaß-Ordner bleiben');
assert(nach1.freigaben.some(f => f.projekt_id === 'z2d_p1' && f.user_id === 'bernd' && f.rolle === 'lesen')
  && nach1.freigaben.some(f => f.projekt_id === 'p1' && f.user_id === 'bernd'),
  'Freigaben gelten für Projekt UND Zeichnung');
assert(nach1.staende.map(s => `${s.id}>${s.projekt_id}`).join() === 's1>z2d_p1,s3>z2d_p3',
  'benannte Speicherstände hängen jetzt an der Zeichnung');

await db.exec(migration);
const nach2 = await stand();
assert(gleich(nach2, nach1), 'ein zweiter Lauf ändert nichts');

// ── 2. Cloud-Funktionen: strikt getrennt ────────────────────────────────────
console.log('\n2 · Getrennte Namensräume\n');
const cloud = await import('../lib/projekte/cloud.ts');

const aufmass = await cloud.arbeitsbereichAuflisten('anna', false, 'aufmass');
const zweiD = await cloud.arbeitsbereichAuflisten('anna', false, '2d');
assert(aufmass.projects.map(p => p.id).sort().join() === 'p1,p2,p3'
  && aufmass.folders.map(o => o.id).sort().join() === 'f1,f2',
  'die Aufmaß-App sieht nur Aufmaß-Projekte und -Ordner');
assert(zweiD.projects.map(p => p.id).sort().join() === 'z2d_p1,z2d_p3'
  && zweiD.folders.map(o => o.id).join() === 'z2d_f1',
  'die 2D-App sieht nur Zeichnungen und 2D-Ordner');
assert(zweiD.projects.every(p => p.app === '2d') && aufmass.projects.every(p => p.app === 'aufmass'),
  'jeder Datensatz nennt seine Anwendung');
const bernd2d = await cloud.arbeitsbereichAuflisten('bernd', false, '2d');
assert(bernd2d.projects.map(p => `${p.id}:${p.rolle}`).join() === 'z2d_p1:lesen',
  'die übernommene Freigabe wirkt in der 2D-App');
assert((await cloud.arbeitsbereichAuflisten('anna', false)).projects.length === 3,
  'ohne Angabe gilt der Namensraum der Aufmaß-App (ältere Aufrufer)');

const fehler = async (fn, status, text) => {
  try { await fn(); } catch (e) { return e.status === status && (!text || text.test(e.message)); }
  return false;
};
assert(await fehler(() => cloud.projektSpeichern('anna', false,
  { id: 'z2d_p1', inhalt: { name: 'x' }, revision: 1 }, undefined, 'aufmass'), 409, /anderen Anwendung/),
  'die Aufmaß-App kann keine Zeichnung überschreiben');
assert(await fehler(() => cloud.projektSpeichern('anna', false,
  { id: 'p1', inhalt: { name: 'x' }, revision: 3 }, undefined, '2d'), 409, /anderen Anwendung/),
  'die 2D-App kann kein Aufmaß-Projekt überschreiben');
const gespeichert = await cloud.projektSpeichern('anna', false,
  { id: 'z2d_p1', inhalt: { ...z1, name: 'Hofstraße neu' }, revision: 1 }, undefined, '2d');
assert(gespeichert.revision === 2 && gespeichert.app === '2d', 'im eigenen Namensraum wird normal gespeichert');
const neu = await cloud.projektSpeichern('anna', false,
  { id: 'z2d_neu', inhalt: { id: 'z2d_neu', name: 'Neu', zeichnung2d: zeichnung } }, undefined, '2d');
assert(neu.app === '2d' && (await sql(`SELECT app FROM cloud_projekte WHERE id = 'z2d_neu'`))[0].app === '2d',
  'eine neue Zeichnung landet im Namensraum 2d');
assert(await fehler(() => cloud.projektLoeschen('anna', false, 'p1', 3, undefined, '2d'), 404),
  'die 2D-App kann kein Aufmaß-Projekt löschen');
assert(await fehler(() => cloud.ordnerSpeichern('anna', { id: 'z2d_f1', inhalt: { id: 'z2d_f1' }, revision: 1 }, 'aufmass'), 409),
  'die Aufmaß-App kann keinen 2D-Ordner überschreiben');
assert(await fehler(() => cloud.ordnerLoeschen('anna', 'f1', 1, '2d'), 409),
  'die 2D-App kann keinen Aufmaß-Ordner löschen');
await cloud.ordnerLoeschen('anna', 'z2d_f1', 1, '2d');
assert((await sql(`SELECT count(*)::int AS n FROM cloud_ordner WHERE id = 'z2d_f1'`))[0].n === 0,
  'im eigenen Namensraum wird normal gelöscht');
assert(cloud.cloudApp(null) === 'aufmass' && cloud.cloudApp('2d') === '2d'
  && await fehler(async () => cloud.cloudApp('fremd'), 400),
  'nur die beiden bekannten Namensräume sind zulässig');

// ── 3. Mitarbeiter-Akte ─────────────────────────────────────────────────────
console.log('\n3 · Mitarbeiter-Akte\n');
const daten = await import('../lib/mitarbeiter/daten.ts');
const zeilen = await daten.projekteVonMitarbeiter(sql, 'anna');
assert(zeilen.filter(z => z.app === 'aufmass').length === 3 && zeilen.filter(z => z.app === '2d').length === 3,
  'die Akte unterscheidet Aufmaß-Projekte und Zeichnungen');
assert(zeilen.find(z => z.id === 'z2d_p1').felder2d === 1 && zeilen.find(z => z.id === 'p1').felder2d === 0,
  'Felder zählen bei der Zeichnung, nicht mehr beim Aufmaß-Projekt');
const kenn = await daten.kennzahlenVonMitarbeiter(sql, 'anna');
assert(kenn.projekte === 3, `„Angelegte Projekte" zählt nur Aufmaß-Projekte (${kenn.projekte})`);

await db.close();
console.log('\nAlle Tests zu Runde 23 bestanden.');
