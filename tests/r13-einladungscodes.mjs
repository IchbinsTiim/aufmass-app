// Runde 13 – Einladungscodes: einmalig, ablaufend, nicht zu erraten.
//
//   node tests/r13-einladungscodes.mjs
//
// Getestet wird gegen ein echtes Postgres (PGlite, im Speicher) mit dem
// Schema aus db/schema.sql und den SQL-Anweisungen aus lib/einladungen/kern.ts.
// Also genau die Anweisungen, die später auf Neon laufen – kein Nachbau.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { assert } from './harness.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  codeErzeugen, codeFormGueltig, codeFormatieren, codeHash, codeNormalisieren, CODE_LAENGE
} = await import(path.join(WURZEL, 'lib/einladungen/code.ts'));

const kern = await import(path.join(WURZEL, 'lib/einladungen/kern.ts'));
const reg  = await import(path.join(WURZEL, 'lib/einladungen/registrierung.ts'));

const PEPPER = 'testpepper-nur-fuer-den-testlauf-0123456789';

const db = new PGlite();
const abfrage = async (sql, werte = []) => (await db.query(sql, werte)).rows;
await db.exec(fs.readFileSync(path.join(WURZEL, 'db/schema.sql'), 'utf8'));

console.log('\nRUNDE 13 – Einladungscodes\n');

// ── 1. Die Codes selbst ─────────────────────────────────────────────────────
console.log('  Form und Zufall');

const beispiel = codeErzeugen();
assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(beispiel),
  `Code hat die Form X7K4-P9QM-2L8F (${beispiel})`);
assert(!/[IO01]/.test(beispiel),
  'Code enthält keine verwechselbaren Zeichen (I, O, 0, 1)');

// Vorhersehbarkeit ist der Angriff, gegen den hier alles gebaut ist: 2000
// Codes ohne eine einzige Wiederholung, und jede Stelle wechselt tatsächlich.
const viele = new Set();
for (let i = 0; i < 2000; i++) viele.add(codeErzeugen());
assert(viele.size === 2000, 'keine zwei gleichen Codes unter 2000 Stück');

const ersteZeichen = new Set([...viele].map(c => c[0]));
assert(ersteZeichen.size > 20, `die erste Stelle streut (${ersteZeichen.size} verschiedene Zeichen)`);

assert(codeNormalisieren(' x7k4 p9qm-2l8f ') === codeNormalisieren('X7K4-P9QM-2L8F'),
  'Kleinschreibung, Leerzeichen und Striche sind beim Eintippen egal');
assert(codeFormGueltig(codeNormalisieren(beispiel)), 'ein erzeugter Code besteht die Formprüfung');
assert(!codeFormGueltig('ZUKURZ'), 'zu kurze Eingabe fällt vor der Datenbank durch');
assert(!codeFormGueltig(codeNormalisieren('IIII-OOOO-0000')), 'unbekannte Zeichen fallen durch');
assert(codeFormatieren(codeNormalisieren(beispiel)) === beispiel, 'Anzeigeform ist verlustfrei');

// ── 2. Hash ─────────────────────────────────────────────────────────────────
console.log('\n  Hash statt Klartext');

const n = codeNormalisieren(beispiel);
assert(codeHash(n, PEPPER) === codeHash(n, PEPPER), 'derselbe Code ergibt denselben Hash');
assert(codeHash(n, PEPPER) !== codeHash(n, PEPPER + 'x'),
  'ein anderer Pepper ergibt einen anderen Hash');
assert(!codeHash(n, PEPPER).includes(n), 'der Klartext steckt nicht im Hash');

// ── 3. Anlegen und Prüfen ───────────────────────────────────────────────────
console.log('\n  Anlegen, prüfen, einlösen');

const codeA = codeErzeugen();
const angelegt = await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeA),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin', notiz: 'Kolonne Nord'
});
assert(angelegt.status === 'aktiv', 'neuer Code ist aktiv');
assert(angelegt.codePraefix === codeNormalisieren(codeA).slice(0, 4),
  'nur die ersten vier Zeichen stehen im Klartext in der Liste');

const roh = await abfrage('SELECT code_hash, code_praefix FROM einladungscodes WHERE id = $1', [angelegt.id]);
assert(!roh[0].code_hash.includes(codeNormalisieren(codeA)),
  'in der Datenbank steht kein Klartext-Code');

assert((await kern.codePruefen(abfrage, codeA, PEPPER)).ok, 'gültiger Code wird angenommen');
assert((await kern.codePruefen(abfrage, codeErzeugen(), PEPPER)).grund === 'ungueltig',
  'ein unbekannter Code wird abgelehnt');
assert((await kern.codePruefen(abfrage, 'ABC', PEPPER)).grund === 'form',
  'Unsinn fällt schon an der Form durch');
assert((await kern.codePruefen(abfrage, codeA, PEPPER + 'anders')).grund === 'ungueltig',
  'mit falschem Pepper passt kein Code');

// ── 4. Genau einmal ─────────────────────────────────────────────────────────
console.log('\n  Ein Code, ein Konto');

const ersteEinloesung = await kern.codeReservieren(abfrage, codeA, PEPPER);
assert(ersteEinloesung.ok, 'der Code lässt sich reservieren');
await kern.reservierungAbschliessen(abfrage, ersteEinloesung.id, 'user_neu_1');

const nachher = await abfrage('SELECT status, verwendet_von_user_id FROM einladungscodes WHERE id = $1', [ersteEinloesung.id]);
assert(nachher[0].status === 'verwendet', 'nach dem Anlegen des Kontos ist der Code verwendet');
assert(nachher[0].verwendet_von_user_id === 'user_neu_1', 'der Benutzer ist am Code vermerkt');

assert((await kern.codeReservieren(abfrage, codeA, PEPPER)).grund === 'ungueltig',
  'derselbe Code ein zweites Mal: abgelehnt');
assert((await kern.codePruefen(abfrage, codeA, PEPPER)).grund === 'ungueltig',
  'ein verwendeter Code besteht auch die Vorprüfung nicht mehr');
assert(!(await kern.einladungWiderrufen(abfrage, ersteEinloesung.id)),
  'ein verwendeter Code lässt sich nicht mehr widerrufen (und damit nicht wiederbeleben)');

// ── 5. Zwei gleichzeitige Einlösungen ───────────────────────────────────────
console.log('\n  Wettlauf zweier Anfragen');

const codeB = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeB),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});

const gleichzeitig = await Promise.all([
  kern.codeReservieren(abfrage, codeB, PEPPER),
  kern.codeReservieren(abfrage, codeB, PEPPER),
  kern.codeReservieren(abfrage, codeB, PEPPER)
]);
const gewonnen = gleichzeitig.filter(e => e.ok);
assert(gewonnen.length === 1,
  `von drei gleichzeitigen Einlösungen gewinnt genau eine (${gewonnen.length})`);

// ── 6. Ablauf ───────────────────────────────────────────────────────────────
console.log('\n  Ablaufdatum');

const codeAlt = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeAlt),
  pepper: PEPPER, gueltigTage: -1, erstelltVonUserId: 'user_admin'
});
assert((await kern.codePruefen(abfrage, codeAlt, PEPPER)).grund === 'ungueltig',
  'ein abgelaufener Code wird abgelehnt');
assert((await kern.codeReservieren(abfrage, codeAlt, PEPPER)).grund === 'ungueltig',
  'ein abgelaufener Code lässt sich auch nicht einlösen');

const listeMitAltem = await kern.einladungenAuflisten(abfrage);
const alterEintrag = listeMitAltem.find(e => e.codePraefix === codeNormalisieren(codeAlt).slice(0, 4));
assert(alterEintrag?.abgelaufen === true, 'die Verwaltung zeigt ihn als abgelaufen');

// ── 7. Widerrufen ───────────────────────────────────────────────────────────
console.log('\n  Widerrufen');

const codeC = codeErzeugen();
const c = await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeC),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});
assert(await kern.einladungWiderrufen(abfrage, c.id), 'ein aktiver Code lässt sich widerrufen');
assert((await kern.codeReservieren(abfrage, codeC, PEPPER)).grund === 'ungueltig',
  'ein widerrufener Code ist wertlos');
assert(!(await kern.einladungWiderrufen(abfrage, c.id)),
  'zweimal widerrufen ändert nichts mehr');

// ── 8. Gescheiterte Kontoerstellung ─────────────────────────────────────────
console.log('\n  Wenn Clerk die Eingabe ablehnt');

const codeD = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeD),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});
const res = await kern.codeReservieren(abfrage, codeD, PEPPER);
assert(res.ok, 'Code reserviert');
assert((await kern.codeReservieren(abfrage, codeD, PEPPER)).grund === 'ungueltig',
  'während der Reservierung ist der Code für andere zu');
await kern.reservierungFreigeben(abfrage, res.id);
assert((await kern.codePruefen(abfrage, codeD, PEPPER)).ok,
  'nach nachweislich gescheiterter Eingabe ist der Code wieder gültig');

// ── 9. Sperre gegen Durchprobieren ──────────────────────────────────────────
console.log('\n  Sperre nach zu vielen Fehlversuchen');

const kennung = kern.kennungAusHerkunft('203.0.113.7', PEPPER);
assert(!kennung.includes('203.0.113.7'), 'die Herkunft wird nicht im Klartext abgelegt');
assert(!(await kern.istGesperrt(abfrage, kennung)), 'anfangs ist nichts gesperrt');

for (let i = 0; i < kern.MAX_FEHLVERSUCHE - 1; i++) {
  await kern.versuchNotieren(abfrage, kennung, false);
}
assert(!(await kern.istGesperrt(abfrage, kennung)),
  `nach ${kern.MAX_FEHLVERSUCHE - 1} Fehlversuchen noch offen`);

await kern.versuchNotieren(abfrage, kennung, false);
assert(await kern.istGesperrt(abfrage, kennung),
  `nach ${kern.MAX_FEHLVERSUCHE} Fehlversuchen gesperrt`);

const andere = kern.kennungAusHerkunft('198.51.100.4', PEPPER);
assert(!(await kern.istGesperrt(abfrage, andere)),
  'die Sperre trifft nur die auffällige Herkunft, nicht alle');

// ── 10. Der komplette Registrierablauf ──────────────────────────────────────
// Dieselbe Entscheidung, die hinter POST /api/einladung/registrieren steht –
// nur ohne HTTP und mit einem Clerk-Ersatz, der auch scheitern darf.
console.log('\n  Registrierung von Anfang bis Ende');

const angelegteKonten = [];
const clerkErsatz = async (auftrag) => {
  if (angelegteKonten.some(k => k.benutzername === auftrag.benutzername)) {
    throw { eingabefehler: true, meldung: 'Dieser Benutzername ist bereits vergeben.' };
  }
  angelegteKonten.push(auftrag);
  return { userId: 'user_' + angelegteKonten.length };
};

const frischerKennung = () => kern.kennungAusHerkunft('192.0.2.' + Math.floor(Math.random() * 250 + 1), PEPPER);

async function versuchRegistrierung(daten, konto = clerkErsatz) {
  return reg.registrieren({
    abfrage, pepper: PEPPER, kennung: frischerKennung(), daten, kontoAnlegen: konto
  });
}

// Ohne gültigen Code entsteht kein Konto – egal, was sonst im Auftrag steht.
const ohneCode = await versuchRegistrierung({
  code: '', benutzername: 'eindringling', passwort: 'GeheimGenug123'
});
assert(!ohneCode.ok && ohneCode.meldung === reg.ABLEHNUNG,
  'ohne Code kein Konto');

const mitFantasie = await versuchRegistrierung({
  code: codeErzeugen(), benutzername: 'eindringling', passwort: 'GeheimGenug123'
});
assert(!mitFantasie.ok, 'mit erfundenem Code kein Konto');
assert(angelegteKonten.length === 0, 'bis hierher wurde kein einziges Konto angelegt');

// Gültiger Code: das Konto entsteht, der Code ist danach verbraucht.
const codeE = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeE),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});

const gut = await versuchRegistrierung({
  code: codeE, benutzername: 'monteur.klaus', passwort: 'GeruestBau2026!',
  email: 'klaus@example.com', vorname: 'Klaus', nachname: 'Berger'
});
assert(gut.ok, 'mit gültigem Code entsteht ein Konto');
assert(angelegteKonten.length === 1, 'genau ein Konto');
assert(angelegteKonten[0].rolle === 'mitarbeiter',
  'das Konto bekommt die Rolle aus der Einladung – erst damit lässt lib/zugang.ts es hinein');

const nochmal = await versuchRegistrierung({
  code: codeE, benutzername: 'monteur.zweit', passwort: 'GeruestBau2026!'
});
assert(!nochmal.ok && nochmal.meldung === reg.ABLEHNUNG,
  'derselbe Code ein zweites Mal: kein zweites Konto');
assert(angelegteKonten.length === 1, 'es blieb bei einem Konto');

// Zwei gleichzeitige Einlösungen desselben Codes.
const codeF = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeF),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});
const vorher = angelegteKonten.length;
const parallel = await Promise.all([
  versuchRegistrierung({ code: codeF, benutzername: 'gleichzeitig.a', passwort: 'GeruestBau2026!' }),
  versuchRegistrierung({ code: codeF, benutzername: 'gleichzeitig.b', passwort: 'GeruestBau2026!' })
]);
assert(parallel.filter(e => e.ok).length === 1,
  'von zwei gleichzeitigen Registrierungen gelingt genau eine');
assert(angelegteKonten.length === vorher + 1,
  'und es entsteht auch nur ein einziges Konto');

// Tippfehler verbrennen keinen Code.
const codeG = codeErzeugen();
await kern.einladungAnlegen(abfrage, {
  codeNormalisiert: codeNormalisieren(codeG),
  pepper: PEPPER, gueltigTage: 7, erstelltVonUserId: 'user_admin'
});
const zuKurz = await versuchRegistrierung({
  code: codeG, benutzername: 'x', passwort: 'kurz'
});
assert(!zuKurz.ok, 'unbrauchbare Angaben werden abgelehnt');
assert((await kern.codePruefen(abfrage, codeG, PEPPER)).ok,
  'der Code ist dabei nicht verbraucht worden');

// Benutzername schon vergeben: Clerk lehnt ab, der Code wird wieder frei.
const vergeben = await versuchRegistrierung({
  code: codeG, benutzername: 'monteur.klaus', passwort: 'GeruestBau2026!'
});
assert(!vergeben.ok && /vergeben/i.test(vergeben.meldung),
  'ein vergebener Benutzername wird gemeldet');
assert((await kern.codePruefen(abfrage, codeG, PEPPER)).ok,
  'nach dieser nachweislichen Ablehnung ist der Code wieder gültig');

// Unklarer Ausgang (Netz weg, während Clerk vielleicht schon angelegt hat):
// der Code bleibt reserviert und wird NICHT von selbst wieder gültig.
const unklar = await versuchRegistrierung(
  { code: codeG, benutzername: 'monteur.neu', passwort: 'GeruestBau2026!' },
  async () => { throw new Error('Verbindung abgebrochen'); }
);
assert(!unklar.ok && unklar.status === 502, 'ein unklarer Ausgang wird als solcher gemeldet');
assert((await kern.codePruefen(abfrage, codeG, PEPPER)).grund === 'ungueltig',
  'der Code bleibt danach gesperrt – lieber verbrannt als doppelt eingelöst');

// Die Sperre greift auch hier.
const gesperrteKennung = kern.kennungAusHerkunft('198.51.100.99', PEPPER);
for (let i = 0; i < kern.MAX_FEHLVERSUCHE; i++) {
  await kern.versuchNotieren(abfrage, gesperrteKennung, false);
}
const gesperrt = await reg.registrieren({
  abfrage, pepper: PEPPER, kennung: gesperrteKennung,
  daten: { code: codeErzeugen(), benutzername: 'brute.force', passwort: 'GeruestBau2026!' },
  kontoAnlegen: clerkErsatz
});
assert(!gesperrt.ok && gesperrt.status === 429,
  'wer durchprobiert, wird abgewiesen, bevor die Datenbank überhaupt gefragt wird');

await db.close();
console.log('\nAlle Tests zu den Einladungscodes bestanden.');
