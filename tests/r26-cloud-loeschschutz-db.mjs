// Produktive SQL-Funktionen + Trigger, nicht nachgebaute Datenbanklogik.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { register } = await import('node:module');
const { PGlite } = await import('@electric-sql/pglite');
const fs = await import('node:fs');
const { default: assert } = await import('node:assert/strict');
const root = new URL('..', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@/lib/einladungen/db') return { url: 'data:text/javascript,export const abfrageHolen = () => globalThis.__testAbfrage;', shortCircuit: true };
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + '.ts', ${JSON.stringify(root)}).href, ctx);
    return next(spec, ctx);
  }`));
const db = new PGlite();
const sql = async (q, p) => (await db.query(q, p)).rows;
globalThis.__testAbfrage = sql;
const lesen = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
await db.exec(lesen('db/schema.sql'));
await db.exec(lesen('db/migrations/20261001_cloud_loeschschutz.sql'));
await db.exec(lesen('db/migrations/20261001_cloud_loeschschutz.sql'));
const { projektSpeichern, projektLoeschen, arbeitsbereichAuflisten } = await import('../lib/projekte/cloud.ts');
for (const app of ['aufmass', '2d']) {
  const id = 'delete_' + app;
  const p = await projektSpeichern('owner', false, { id, inhalt: { id, name: 'Test' } }, undefined, app);
  await sql("INSERT INTO cloud_projekt_freigaben(projekt_id,user_id,rolle) VALUES($1,'reader','lesen')", [id]);
  await sql("INSERT INTO cloud_zeichnungen(id,projekt_id,name,inhalt,erstellt_von,quelle) VALUES($1,$2,'Stand','{}','owner','zeichnung')", ['stand_' + app, id]);
  await assert.rejects(projektLoeschen('reader', false, id, 1, undefined, app), e => e.status === 403);
  await assert.rejects(projektLoeschen('owner', false, id, 9, undefined, app), e => e.status === 409);
  await assert.rejects(projektLoeschen('owner', false, id, 1, undefined, app === '2d' ? 'aufmass' : '2d'), e => e.status === 404);
  await projektLoeschen('owner', false, id, p.revision, undefined, app);
  assert.equal((await sql('SELECT id FROM cloud_projekte WHERE id=$1', [id])).length, 0);
  assert.equal((await sql('SELECT id FROM cloud_zeichnungen WHERE projekt_id=$1', [id])).length, 0);
  assert.equal((await sql('SELECT projekt_id FROM cloud_projekt_freigaben WHERE projekt_id=$1', [id])).length, 0);
  assert.equal((await sql('SELECT id FROM cloud_geloeschte_projekte WHERE id=$1 AND app=$2', [id, app])).length, 1);
  await projektLoeschen('owner', false, id, p.revision, undefined, app); // verlorene Antwort: Wiederholung
  await assert.rejects(projektSpeichern('owner', false, { id, revision: 1, inhalt: p.inhalt }, undefined, app), e => e.status === 410);
  await assert.rejects(projektSpeichern('owner', false, { id, inhalt: p.inhalt }, undefined, app), e => e.constraint === 'cloud_projekt_geloescht');
  await assert.rejects(sql("INSERT INTO cloud_projekte(id,owner_user_id,inhalt,app) VALUES($1,'owner','{}',$2)", [id, app]), e => e.constraint === 'cloud_projekt_geloescht');
  const kopie = await projektSpeichern('owner', false, { id: id + '_kopie', inhalt: { ...p.inhalt, id: id + '_kopie' } }, undefined, app);
  assert.equal(kopie.revision, 1);
  const liste = await arbeitsbereichAuflisten('owner', false, app);
  assert.equal(liste.vollstaendig, true);
  assert.ok(liste.projects.every(p => p.app === app && p.id !== id));
  console.log('✓ ' + app + ': echte Löschung inkl. Unterdaten, Rechte, Idempotenz, Altgeräte-Sperre, bewusste neue Kopie');
}
// Transaktions-Rollback darf keinen falschen Löschvermerk hinterlassen.
await sql("INSERT INTO cloud_projekte(id,owner_user_id,inhalt) VALUES('rollback','owner','{}')");
await db.exec("BEGIN; DELETE FROM cloud_projekte WHERE id='rollback'; ROLLBACK;");
assert.equal((await sql("SELECT id FROM cloud_projekte WHERE id='rollback'")).length, 1);
assert.equal((await sql("SELECT id FROM cloud_geloeschte_projekte WHERE id='rollback'")).length, 0);
await db.close();
console.log('✓ Migration wiederholbar; Löschvermerk und DELETE sind atomar');
