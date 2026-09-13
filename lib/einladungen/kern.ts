import { createHash } from 'node:crypto';
import { codeFormGueltig, codeHash, codeNormalisieren, codePraefix } from './code.ts';

/**
 * Einladungscodes – die gesamte Fachlogik, unabhängig von Next.js, Clerk und
 * vom konkreten Datenbanktreiber.
 *
 * Alles läuft über eine übergebene `Abfrage`-Funktion. In der Produktion ist
 * das Neon/Postgres, im Testlauf ein echtes Postgres im Speicher (PGlite).
 * Damit prüfen die Tests genau die SQL-Anweisungen, die später auch laufen –
 * und nicht eine nachgebaute Sonderfassung.
 */

export type Abfrage = (sql: string, werte?: unknown[]) => Promise<Record<string, unknown>[]>;

export type CodeStatus = 'aktiv' | 'wird_eingeloest' | 'verwendet' | 'widerrufen';

export type Einladung = {
  id: string;
  codePraefix: string;
  status: CodeStatus;
  /* Kennung einer Rolle aus lib/rollen.ts – seit der Rollenverwaltung auch
     die einer selbst angelegten Rolle, nicht mehr nur 'admin'/'mitarbeiter'. */
  rolle: string;
  notiz: string | null;
  erstelltAm: string;
  laeuftAbAm: string;
  verwendetAm: string | null;
  erstelltVonUserId: string;
  verwendetVonUserId: string | null;
  /** Abgelaufen ist kein eigener Status in der Datenbank, sondern eine Frage der Uhr. */
  abgelaufen: boolean;
};

/** Absichtlich grobe Gründe: die Oberfläche verrät nie, WORAN es lag. */
export type Ablehnung =
  | 'form'          // sieht nicht wie ein Code aus
  | 'ungueltig'     // unbekannt, verwendet, widerrufen oder abgelaufen
  | 'gesperrt'      // zu viele Fehlversuche
  | 'nicht_bereit'; // keine Datenbank eingerichtet

export type Pruefergebnis =
  | { ok: true; rolle: string }
  | { ok: false; grund: Ablehnung };

export type Reservierung =
  | { ok: true; id: string; rolle: string }
  | { ok: false; grund: Ablehnung };

// ── Sperre gegen Durchprobieren ─────────────────────────────────────────────
// 60 Bit Entropie sind praktisch nicht zu erraten; diese Grenzen sorgen dafür,
// dass es auch nicht versucht wird, und halten die Datenbank frei.
export const MAX_FEHLVERSUCHE = 8;
export const FENSTER_MINUTEN = 15;

/** Herkunft nie im Klartext ablegen – für die Sperre genügt ein Hash. */
export function kennungAusHerkunft(herkunft: string, pepper: string): string {
  return createHash('sha256').update(pepper + '|' + (herkunft || 'unbekannt')).digest('hex');
}

export async function istGesperrt(abfrage: Abfrage, kennung: string): Promise<boolean> {
  const zeilen = await abfrage(
    `SELECT count(*)::int AS anzahl
       FROM einladung_versuche
      WHERE kennung = $1
        AND erfolg = false
        AND zeitpunkt > now() - ($2 || ' minutes')::interval`,
    [kennung, String(FENSTER_MINUTEN)]
  );
  return Number(zeilen[0]?.anzahl ?? 0) >= MAX_FEHLVERSUCHE;
}

export async function versuchNotieren(
  abfrage: Abfrage, kennung: string, erfolg: boolean
): Promise<void> {
  await abfrage(
    'INSERT INTO einladung_versuche (kennung, erfolg) VALUES ($1, $2)',
    [kennung, erfolg]
  );
  // Alte Einträge wegräumen – die Tabelle ist ein Kurzzeitgedächtnis.
  await abfrage(
    "DELETE FROM einladung_versuche WHERE zeitpunkt < now() - interval '1 day'"
  );
}

// ── Anlegen, auflisten, widerrufen (Admin) ──────────────────────────────────

export async function einladungAnlegen(
  abfrage: Abfrage,
  opt: {
    codeNormalisiert: string;
    pepper: string;
    gueltigTage: number;
    erstelltVonUserId: string;
    rolle?: string;
    notiz?: string | null;
  }
): Promise<Einladung> {
  const zeilen = await abfrage(
    `INSERT INTO einladungscodes
       (code_hash, code_praefix, rolle, notiz, laeuft_ab_am, erstellt_von_user_id)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)
     RETURNING *`,
    [
      codeHash(opt.codeNormalisiert, opt.pepper),
      codePraefix(opt.codeNormalisiert),
      opt.rolle ?? 'mitarbeiter',
      opt.notiz ?? null,
      String(opt.gueltigTage),
      opt.erstelltVonUserId
    ]
  );
  return zeileZuEinladung(zeilen[0]);
}

export async function einladungenAuflisten(
  abfrage: Abfrage, grenze = 100
): Promise<Einladung[]> {
  const zeilen = await abfrage(
    'SELECT * FROM einladungscodes ORDER BY erstellt_am DESC LIMIT $1',
    [grenze]
  );
  return zeilen.map(zeileZuEinladung);
}

/**
 * Widerrufen. Nur ein noch nicht eingelöster Code lässt sich widerrufen –
 * ein verwendeter bleibt für immer verwendet.
 */
export async function einladungWiderrufen(abfrage: Abfrage, id: string): Promise<boolean> {
  const zeilen = await abfrage(
    `UPDATE einladungscodes
        SET status = 'widerrufen'
      WHERE id = $1 AND status IN ('aktiv', 'wird_eingeloest')
      RETURNING id`,
    [id]
  );
  return zeilen.length === 1;
}

// ── Prüfen und Einlösen ─────────────────────────────────────────────────────

/**
 * Reine Vorprüfung für die Oberfläche („Einladung bestätigt ✓"). Sie ändert
 * nichts und ist deshalb KEIN Nachweis: der eigentliche Anspruch entsteht
 * erst beim Reservieren im selben Zug wie die Kontoerstellung.
 */
export async function codePruefen(
  abfrage: Abfrage, code: string, pepper: string
): Promise<Pruefergebnis> {
  const normalisiert = codeNormalisieren(code);
  if (!codeFormGueltig(normalisiert)) return { ok: false, grund: 'form' };

  const zeilen = await abfrage(
    `SELECT rolle FROM einladungscodes
      WHERE code_hash = $1 AND status = 'aktiv' AND laeuft_ab_am > now()`,
    [codeHash(normalisiert, pepper)]
  );
  if (zeilen.length !== 1) return { ok: false, grund: 'ungueltig' };
  return { ok: true, rolle: String(zeilen[0].rolle) };
}

/**
 * Reserviert den Code für genau eine Kontoerstellung.
 *
 * Das ist die Stelle, an der der Wettlauf entschieden wird: EINE einzige
 * SQL-Anweisung liest und schreibt zugleich. Postgres sperrt die Zeile dabei;
 * von zwei gleichzeitigen Anfragen bekommt genau eine eine Zeile zurück, die
 * andere geht leer aus. Es gibt kein Zeitfenster zwischen „ist frei" und
 * „ist belegt", in das ein zweiter Aufruf hineinpasst.
 */
export async function codeReservieren(
  abfrage: Abfrage, code: string, pepper: string
): Promise<Reservierung> {
  const normalisiert = codeNormalisieren(code);
  if (!codeFormGueltig(normalisiert)) return { ok: false, grund: 'form' };

  const zeilen = await abfrage(
    `UPDATE einladungscodes
        SET status = 'wird_eingeloest',
            reserviert_bis = now() + interval '5 minutes'
      WHERE code_hash = $1
        AND status = 'aktiv'
        AND laeuft_ab_am > now()
      RETURNING id, rolle`,
    [codeHash(normalisiert, pepper)]
  );
  if (zeilen.length !== 1) return { ok: false, grund: 'ungueltig' };
  return {
    ok: true,
    id: String(zeilen[0].id),
    rolle: String(zeilen[0].rolle)
  };
}

/** Konto steht: der Code ist endgültig verbraucht. */
export async function reservierungAbschliessen(
  abfrage: Abfrage, id: string, userId: string
): Promise<void> {
  await abfrage(
    `UPDATE einladungscodes
        SET status = 'verwendet',
            verwendet_am = now(),
            verwendet_von_user_id = $2,
            reserviert_bis = NULL
      WHERE id = $1 AND status = 'wird_eingeloest'`,
    [id, userId]
  );
}

/**
 * Kontoerstellung ist NACHWEISLICH gescheitert (Benutzername vergeben,
 * Passwort zu schwach) – der Code wird wieder frei.
 *
 * Bewusst gibt es keine automatische Freigabe nach Ablauf der Reservierung:
 * bricht die Verbindung ab, während Clerk das Konto vielleicht schon angelegt
 * hat, bleibt der Code hängen. Ein verbrannter Code kostet den Admin einen
 * Klick; ein zweites Konto auf denselben Code wäre der Fehler, den wir hier
 * ausschließen wollen.
 */
export async function reservierungFreigeben(abfrage: Abfrage, id: string): Promise<void> {
  await abfrage(
    `UPDATE einladungscodes
        SET status = 'aktiv', reserviert_bis = NULL
      WHERE id = $1 AND status = 'wird_eingeloest'`,
    [id]
  );
}

// ── Umformen ────────────────────────────────────────────────────────────────

function alsText(wert: unknown): string {
  return wert instanceof Date ? wert.toISOString() : String(wert);
}

function zeileZuEinladung(z: Record<string, unknown>): Einladung {
  const laeuftAbAm = alsText(z.laeuft_ab_am);
  const status = z.status as CodeStatus;
  return {
    id: String(z.id),
    codePraefix: String(z.code_praefix),
    status,
    rolle: String(z.rolle),
    notiz: z.notiz === null || z.notiz === undefined ? null : String(z.notiz),
    erstelltAm: alsText(z.erstellt_am),
    laeuftAbAm,
    verwendetAm: z.verwendet_am ? alsText(z.verwendet_am) : null,
    erstelltVonUserId: String(z.erstellt_von_user_id),
    verwendetVonUserId: z.verwendet_von_user_id ? String(z.verwendet_von_user_id) : null,
    abgelaufen: status === 'aktiv' && new Date(laeuftAbAm).getTime() <= Date.now()
  };
}
