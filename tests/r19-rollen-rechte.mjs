// Runde 19 – Mitarbeiterverwaltung: eigene Rollen, Rechte, Herkunft der Daten.
//
//   node tests/r19-rollen-rechte.mjs
//
// Geprüft wird gegen ein echtes Postgres im Speicher (PGlite) mit dem Schema
// aus db/schema.sql und den SQL-Anweisungen aus lib/mitarbeiter/* – also
// gegen dieselben Anweisungen, die später auf Neon laufen, nicht gegen einen
// Nachbau. Clerk kommt hier nicht vor: Die Benutzer selbst liegen dort, und
// was diese Runde entscheidet, entscheidet sie ohne Anmeldedienst.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { assert } from './harness.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lade = p => import(path.join(WURZEL, p));

const R = await lade('lib/rollen.ts');
const Z = await lade('lib/zugang-regeln.ts');
const db_ = await lade('lib/mitarbeiter/rollen-db.ts');
const akt = await lade('lib/mitarbeiter/aktivitaet.ts');
const daten = await lade('lib/mitarbeiter/daten.ts');

const db = new PGlite();
const abfrage = async (sql, werte = []) => (await db.query(sql, werte)).rows;
const schema = fs.readFileSync(path.join(WURZEL, 'db/schema.sql'), 'utf8');
await db.exec(schema);

console.log('\nRUNDE 19 – Mitarbeiter, Rollen und Rechte\n');

/* ══ 1. Der Rechtekatalog ═══════════════════════════════════════════════════
   Er ist die Grundlage von allem Weiteren: Schlüssel dürfen sich nie doppeln
   (sonst hängen zwei Bedeutungen an derselben Zeichenkette) und jeder gehört
   in einen Bereich, sonst taucht er in der Rollenverwaltung nirgends auf. */
console.log('  Rechtekatalog');

const keys = R.RECHTE.map(r => r.key);
assert(new Set(keys).size === keys.length, `${keys.length} Rechte, keines doppelt`);
assert(R.RECHTE.every(r => R.BEREICHE.some(b => b.key === r.bereich)),
  'jedes Recht gehört zu einem Bereich der Rollenverwaltung');
assert(R.RECHTE.every(r => r.label && r.hinweis),
  'jedes Recht hat Beschriftung und Erklärung');

// Die vom Betrieb ausdrücklich verlangten Funktionen sind abgedeckt.
[
  'mitarbeiter.verwalten', 'mitarbeiter.loeschen', 'rollen.verwalten',
  'projekte.erstellen', 'projekte.bearbeiten', 'projekte.loeschen',
  'aufmasse.erstellen', 'aufmasse.bearbeiten', 'aufmasse.loeschen',
  'zeichnungen.erstellen', 'pdf.exportieren', 'fremde.daten.ansehen'
].forEach(k => assert(keys.includes(k), `Recht vorhanden: ${k}`));

// Erweiterbarkeit ist kein Versprechen, sondern eine Eigenschaft: Ein neues
// Recht muss ohne Datenbankänderung wirken – und eine bestehende Rolle darf
// es NICHT automatisch bekommen.
const erweitert = R.rechteVonRolle({ id: 'x', rechte: ['projekte.erstellen'] });
assert(!R.hatRecht(erweitert, 'ein.neues.recht'),
  'ein neu erfundenes Recht hat eine bestehende Rolle nicht automatisch');
assert(R.hatRecht(R.rechteVonRolle(R.SYSTEM_ROLLEN[0]), 'ein.neues.recht'),
  'der Administrator dagegen hat auch künftige Rechte („*")');

assert(R.rechteBereinigen(['projekte.erstellen', 'unfug', 42]).join() === 'projekte.erstellen',
  'unbekannte Rechte werden beim Speichern verworfen');
assert(R.rechteBereinigen(['*', 'projekte.erstellen']).join() === '*',
  '„alle Rechte" schluckt die Einzelangaben');

assert(R.rollenIdGueltig('bauleiter') && !R.rollenIdGueltig('Bau Leiter')
    && !R.rollenIdGueltig('a') && !R.rollenIdGueltig('-x-'),
  'Rollenkennungen sind auf eine harmlose Form begrenzt');
assert(R.rollenIdAus('Bauleiter Nord') === 'bauleiter-nord'
    && R.rollenIdAus('Aufmaß-Büro') === 'aufmass-buero',
  'aus einem Namen entsteht eine saubere Kennung (auch mit Umlauten)');

/* ══ 2. Rollen in der Datenbank ════════════════════════════════════════════ */
console.log('\n  Rollen anlegen, ändern, löschen');

const start = await db_.rollenLaden(abfrage);
assert(start.some(r => r.id === 'admin') && start.some(r => r.id === 'mitarbeiter'),
  `das Schema bringt die mitgelieferten Rollen mit (${start.length} Rollen)`);
assert(start.find(r => r.id === 'admin').rechte.join() === '*',
  'der Administrator darf alles');
assert(start.filter(r => r.system).length === 2,
  'genau zwei Rollen sind Systemrollen');

const neu = await db_.rolleSpeichern(abfrage, {
  id: 'polier', name: 'Polier', beschreibung: 'Führt die Kolonne.',
  rechte: ['projekte.bearbeiten', 'pdf.exportieren', 'unfug'], sortierung: 40
}, 'user_admin');
assert(neu.id === 'polier' && neu.rechte.length === 2,
  `eigene Rolle angelegt, unbekanntes Recht verworfen (${neu.rechte.join(', ')})`);

const nachAnlegen = await db_.rollenLaden(abfrage);
assert(nachAnlegen.some(r => r.id === 'polier' && !r.system),
  'die eigene Rolle steht in der Liste und ist keine Systemrolle');

await db_.rolleSpeichern(abfrage, {
  id: 'polier', name: 'Polier', beschreibung: 'Führt die Kolonne.',
  rechte: ['projekte.bearbeiten', 'pdf.exportieren', 'fremde.daten.ansehen'], sortierung: 40
}, 'user_admin');
const geaendert = await db_.rolleHolen(abfrage, 'polier');
assert(geaendert.rechte.includes('fremde.daten.ansehen'),
  'Rechte einer Rolle lassen sich nachträglich erweitern');

// Der Administrator lässt sich nicht entmachten – sonst könnte sich ein
// Betrieb mit einem Klick aus seiner eigenen Verwaltung aussperren.
await db_.rolleSpeichern(abfrage, {
  id: 'admin', name: 'Chef', beschreibung: '', rechte: ['pdf.exportieren']
}, 'user_admin');
const adminDanach = await db_.rolleHolen(abfrage, 'admin');
assert(adminDanach.name === 'Chef' && adminDanach.rechte.join() === '*',
  'der Administrator lässt sich umbenennen, aber nicht beschneiden');

let fehler = null;
try { await db_.rolleLoeschen(abfrage, 'mitarbeiter', 0); } catch (e) { fehler = e; }
assert(fehler && fehler.status === 400, 'eine Systemrolle lässt sich nicht löschen');

fehler = null;
try { await db_.rolleLoeschen(abfrage, 'polier', 3); } catch (e) { fehler = e; }
assert(fehler && fehler.status === 409 && /andere Rolle/.test(fehler.message),
  'eine noch vergebene Rolle wird nicht gelöscht (sonst fiele jemand heraus)');

await db_.rolleLoeschen(abfrage, 'polier', 0);
assert(!(await db_.rolleHolen(abfrage, 'polier')),
  'eine nicht mehr vergebene Rolle lässt sich löschen');

assert(daten.rolleImEinsatz(
  [{ rolle: 'bauleiter', rolleVorher: null }, { rolle: null, rolleVorher: 'bauleiter' }], 'bauleiter'
) === 2, 'auch ein deaktivierter Träger zählt als „Rolle im Einsatz"');

/* ══ 3. Migration: wiederholbar und ohne Datenverlust ══════════════════════ */
console.log('\n  Migration');

await abfrage(`INSERT INTO cloud_projekte (id, owner_user_id, titel, inhalt)
               VALUES ('alt-1', 'user_alt', 'Altprojekt', '{"name":"Altprojekt"}'::jsonb)`);
await abfrage(`UPDATE cloud_projekte SET erstellt_von = NULL WHERE id = 'alt-1'`);

const migration = fs.readFileSync(
  path.join(WURZEL, 'db/migrations/20260913_mitarbeiter_rollen.sql'), 'utf8');
await db.exec(migration);
await db.exec(migration);   // zweiter Lauf: darf nichts kaputtmachen

const alt = (await abfrage(`SELECT erstellt_von, titel FROM cloud_projekte WHERE id = 'alt-1'`))[0];
assert(alt.erstellt_von === 'user_alt' && alt.titel === 'Altprojekt',
  'die Migration trägt beim Altbestand den Eigentümer als Ersteller nach – verlustfrei');
assert((await db_.rollenLaden(abfrage)).find(r => r.id === 'admin').name === 'Chef',
  'ein zweiter Lauf setzt eine angepasste Rolle NICHT zurück');

// Einladungen dürfen jetzt jede Rolle vergeben, nicht nur admin/mitarbeiter.
await abfrage(
  `INSERT INTO einladungscodes (code_hash, code_praefix, rolle, laeuft_ab_am, erstellt_von_user_id)
   VALUES ('hash-bauleiter', 'ABCD', 'bauleiter', now() + interval '7 days', 'user_admin')`);
assert((await abfrage(`SELECT rolle FROM einladungscodes WHERE code_hash = 'hash-bauleiter'`))[0].rolle === 'bauleiter',
  'ein Einladungscode kann in eine selbst angelegte Rolle einladen');
let codeFehler = null;
try {
  await abfrage(
    `INSERT INTO einladungscodes (code_hash, code_praefix, rolle, laeuft_ab_am, erstellt_von_user_id)
     VALUES ('hash-unfug', 'EFGH', 'Nicht Erlaubt!', now() + interval '7 days', 'user_admin')`);
} catch (e) { codeFehler = e; }
assert(codeFehler, 'eine unsinnige Rollenkennung weist die Datenbank weiterhin ab');

/* ══ 4. Herkunft: wer hat was angelegt ═════════════════════════════════════ */
console.log('\n  Erstellte Daten eines Mitarbeiters');

const projekt = (name, ersteller, besitzer, inhalt) => abfrage(
  `INSERT INTO cloud_projekte (id, owner_user_id, titel, inhalt, erstellt_von, geaendert_von)
   VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
  [name, besitzer, name, JSON.stringify(inhalt), ersteller]);

await projekt('p-anna-1', 'user_anna', 'user_anna', {
  name: 'Musterstraße 12',
  seiten: [
    { name: 'Nord', positionen: [{ art: 'geruest' }, { art: 'konsole' }] },
    { name: 'Ost', positionen: [{ art: 'geruest' }] }
  ],
  zeichnung2d: { depth: 0.73, sections: [{ bays: [{ len: 2.57 }, { len: 2.57 }] }] }
});
await projekt('p-anna-2', 'user_anna', 'user_bernd', { name: 'Werkhalle', seiten: [] });
await projekt('p-bernd-1', 'user_bernd', 'user_bernd', { name: 'Kirchweg 3', seiten: [] });

await abfrage(
  `INSERT INTO cloud_zeichnungen (id, projekt_id, name, inhalt, erstellt_von, quelle)
   VALUES ('zeichnung-anna-01', 'p-anna-1', 'Nordfassade', '{}'::jsonb, 'user_anna', 'zeichnung')`);

const annaProjekte = await daten.projekteVonMitarbeiter(abfrage, 'user_anna');
assert(annaProjekte.length === 2, `Anna hat 2 Projekte angelegt (${annaProjekte.length})`);
const musterstrasse = annaProjekte.find(p => p.id === 'p-anna-1');
assert(musterstrasse.seiten === 2 && musterstrasse.positionen === 3,
  `das Aufmaß wird je Projekt ausgewiesen (${musterstrasse.seiten} Seiten, ${musterstrasse.positionen} Positionen)`);
assert(musterstrasse.felder2d === 2,
  `die 2D-Zeichnung im Projekt wird mitgezählt (${musterstrasse.felder2d} Felder)`);
assert(annaProjekte.find(p => p.id === 'p-anna-2').istEigentuemer === false,
  'ein für jemand anderen angelegtes Projekt bleibt Annas Werk, gehört aber ihm');

const annaZeichnungen = await daten.zeichnungenVonMitarbeiter(abfrage, 'user_anna');
assert(annaZeichnungen.length === 1 && annaZeichnungen[0].projektTitel === 'p-anna-1',
  'gespeicherte 2D-Stände hängen am Ersteller und nennen ihr Projekt');

const kenn = await daten.kennzahlenVonMitarbeiter(abfrage, 'user_anna');
assert(kenn.projekte === 2 && kenn.zeichnungen === 1 && kenn.zuletzt,
  `Kennzahlen der Detailseite stimmen (${kenn.projekte} Projekte, ${kenn.zeichnungen} Zeichnungen)`);

assert((await daten.projekteVonMitarbeiter(abfrage, 'user_bernd')).length === 1,
  'jeder sieht nur seine eigenen Werke in seiner Akte');

/* ══ 5. Deaktivieren löscht KEINE Daten ════════════════════════════════════
   Der Kern der Anforderung: Ein Zugang verschwindet, die Arbeit bleibt. Die
   Abfragen der Detailseite hängen ausschließlich an `erstellt_von` – an
   nichts, was ein deaktivierter Zugang mit sich nimmt. */
console.log('\n  Deaktivieren');

const vorher = await abfrage('SELECT count(*)::int AS n FROM cloud_projekte');
// „Deaktivieren" passiert ausschließlich in Clerks Metadaten (siehe
// lib/mitarbeiter/verzeichnis.ts) – in der Datenbank geschieht dabei nichts.
const nachher = await abfrage('SELECT count(*)::int AS n FROM cloud_projekte');
assert(vorher[0].n === nachher[0].n && nachher[0].n === 4,
  `alle ${nachher[0].n} Projekte sind noch da`);
assert((await daten.projekteVonMitarbeiter(abfrage, 'user_anna')).length === 2,
  'die Werke eines deaktivierten Mitarbeiters bleiben seiner Akte zugeordnet');

const verzeichnis = fs.readFileSync(path.join(WURZEL, 'lib/mitarbeiter/verzeichnis.ts'), 'utf8');
assert(!/deleteUser|DELETE\s+FROM|drop\s+table/i.test(verzeichnis),
  'die Mitarbeiterverwaltung löscht nirgends – weder Konten noch Datensätze');
assert(/banUser/.test(verzeichnis) && /status: STATUS_DEAKTIVIERT/.test(verzeichnis)
    && /rolle: null/.test(verzeichnis),
  'sie entzieht die Rolle UND sperrt das Konto – zwei voneinander unabhängige Riegel');

/* ══ 6. Herkunftsspalten schreibt die Cloud wirklich ═══════════════════════
   Die Abfragen oben zeigen, dass die Spalten ausgewertet werden. Diese
   Prüfung stellt sicher, dass sie auch GEFÜLLT werden – an den Stellen, an
   denen die Anwendung Projekte und Ordner schreibt. */
const cloud = fs.readFileSync(path.join(WURZEL, 'lib/projekte/cloud.ts'), 'utf8');
assert(/INSERT INTO cloud_projekte \(id, owner_user_id, titel, inhalt, erstellt_von, geaendert_von\)/.test(cloud),
  'ein neues Projekt bekommt erstellt_von und geaendert_von mit');
assert(/UPDATE cloud_projekte p SET[\s\S]*?geaendert_von = \$5/.test(cloud),
  'jede Änderung schreibt geaendert_von nach');
assert(/INSERT INTO cloud_ordner \(id, owner_user_id, inhalt, erstellt_von, geaendert_von\)/.test(cloud),
  'auch Ordner tragen ihre Herkunft');

/* ══ 7. Aktivitätsprotokoll ════════════════════════════════════════════════ */
console.log('\n  Aktivitäten');

await akt.aktivitaetNotieren(abfrage, {
  userId: 'user_anna', art: 'projekt.angelegt', objektId: 'p-anna-1', objektTitel: 'Musterstraße 12'
});
await akt.aktivitaetNotieren(abfrage, {
  userId: 'user_anna', art: 'zeichnung.gespeichert', objektId: 'zeichnung-anna-01', objektTitel: 'Nordfassade'
});
await akt.aktivitaetNotieren(abfrage, { userId: 'user_bernd', art: 'projekt.geloescht' });

const protokoll = await akt.aktivitaetenLesen(abfrage, 'user_anna');
assert(protokoll.length === 2, `Annas Protokoll hat ${protokoll.length} Einträge`);
assert(protokoll.every(e => akt.AKTIVITAET_TEXT[e.art]),
  'jede protokollierte Art hat einen lesbaren Text für die Oberfläche');
assert(protokoll[0].zeitpunkt >= protokoll[1].zeitpunkt, 'neueste Ereignisse zuerst');

// Ein kaputter Protokolleintrag darf niemals die Arbeit stoppen.
await akt.aktivitaetNotieren(null, { userId: 'user_anna', art: 'projekt.angelegt' });
const kaputt = async () => { throw new Error('Datenbank weg'); };
await akt.aktivitaetNotieren(kaputt, { userId: 'user_anna', art: 'projekt.angelegt' });
assert((await akt.aktivitaetenLesen(abfrage, 'user_anna')).length === 2,
  'ein gescheitertes Protokoll wirft nicht – die eigentliche Arbeit läuft weiter');

/* ══ 8. Ohne Datenbank bleibt die Anwendung arbeitsfähig ═══════════════════ */
console.log('\n  Notbetrieb ohne Datenbank');

const ohne = await db_.rollenLaden(null);
assert(ohne.length === 2 && ohne.every(r => r.system),
  'ohne DATABASE_URL gelten die beiden mitgelieferten Rollen');
assert(R.hatRecht(R.rechteVonRolle(ohne.find(r => r.id === 'admin')), 'mitarbeiter.verwalten'),
  'der Administrator kommt auch im Notbetrieb in die Verwaltung');
assert(!R.hatRecht(R.rechteVonRolle(ohne.find(r => r.id === 'mitarbeiter')), 'mitarbeiter.verwalten')
    && R.hatRecht(R.rechteVonRolle(ohne.find(r => r.id === 'mitarbeiter')), 'projekte.bearbeiten'),
  'ein Mitarbeiter darf arbeiten, aber nicht verwalten – wie bisher');
assert((await daten.projekteVonMitarbeiter(null, 'user_anna')).length === 0,
  'Datenabfragen ohne Verbindung liefern leere Listen statt eines Fehlers');

/* ══ 9. Wer darf überhaupt herein? ═════════════════════════════════════════
   Die wichtigste Verzweigung der ganzen Anwendung – und die einzige, bei der
   ein Fehler jemanden hereinlässt, der nicht hereingehört. Sie steht deshalb
   als reine Entscheidung in lib/zugang-regeln.ts und wird hier ohne Clerk
   durchgespielt. */
console.log('\n  Zugangsregeln');

const NOTZUGANG = ['chef@beispiel.de'];
const entscheide = (meta, emails = [], admins = NOTZUGANG) =>
  Z.zugangAusAngaben(meta, emails, admins);

assert(entscheide({ rolle: 'mitarbeiter' })?.erlaubt === true,
  'wer eine Rolle trägt, ist eingeladen worden und kommt herein');
assert(entscheide({ rolle: 'bauleiter' })?.rolle === 'bauleiter',
  'auch eine selbst angelegte Rolle ist ein gültiger Nachweis');
assert(entscheide({ rolle: 'Nicht Erlaubt!' }) === null,
  'eine unsinnige Rollenkennung gilt nicht als Nachweis');

assert(entscheide({}, ['chef@beispiel.de'])?.grund === 'admin-liste',
  'der Notzugang über AUFMASSX_ADMIN_EMAILS funktioniert');
assert(entscheide({}, ['CHEF@Beispiel.DE'])?.grund === 'admin-liste',
  'Groß- und Kleinschreibung der Adresse ist dabei egal');
assert(entscheide({}, ['fremd@beispiel.de']) === null,
  'ein Konto ohne Rolle und ohne Notzugang bekommt keine Zusage');

// Der Kern: DEAKTIVIERT schlägt alles – auch eine Rolle und auch den
// Notzugang. Sonst käme ein gesperrter Zugang über die Hintertür zurück.
const gesperrt = { rolle: 'admin', status: 'deaktiviert' };
assert(entscheide(gesperrt)?.grund === 'deaktiviert' && entscheide(gesperrt).erlaubt === false,
  'ein deaktivierter Zugang kommt trotz Rolle nicht herein');
assert(entscheide({ status: 'deaktiviert' }, ['chef@beispiel.de'])?.grund === 'deaktiviert',
  'auch die Admin-Liste hebelt das Deaktivieren nicht aus');
assert(entscheide({ rolleVorher: 'bauleiter', status: 'deaktiviert' })?.erlaubt === false,
  'die gemerkte frühere Rolle ist kein Zugang');

// „Keine Auskunft" heißt nachladen, nicht durchlassen.
assert(entscheide(undefined, ['chef@beispiel.de']) === null,
  'ohne Metadaten gibt es keine Zusage aus dem Token – erst der Datensatz entscheidet');
assert(entscheide(null) === null, 'dasselbe gilt für fehlende Metadaten');

assert(Z.adminEmailsAus(' Chef@Beispiel.de , ,zweiter@firma.de ').join()
    === 'chef@beispiel.de,zweiter@firma.de',
  'die Adressliste aus der Umgebung wird sauber zerlegt');
assert(Z.adminEmailsAus(undefined).length === 0, 'keine Liste heißt kein Notzugang');

await db.close();
console.log('\nAlle Tests zu Runde 19 bestanden.');
