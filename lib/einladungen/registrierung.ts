import {
  codeReservieren,
  istGesperrt,
  reservierungAbschliessen,
  reservierungFreigeben,
  versuchNotieren,
  type Abfrage
} from './kern.ts';

/**
 * Der Ablauf „Konto mit Einladungscode anlegen" – als reine Entscheidung,
 * ohne HTTP, ohne Next.js, ohne Clerk.
 *
 * Genau hier wird entschieden, wer ein Konto bekommt. Die Route darüber ist
 * nur Zustellung: JSON lesen, diese Funktion rufen, Antwort schreiben. Damit
 * lässt sich die Entscheidung vollständig prüfen – gegen ein echtes Postgres
 * und einen Clerk-Ersatz, der auch mal scheitern darf.
 *
 * Reihenfolge, und warum sie so ist:
 *
 *   1. Sperre prüfen  – wer durchprobiert, kommt gar nicht erst zur Datenbank.
 *   2. Eingaben prüfen – damit kein Code an einem Tippfehler verbrennt.
 *   3. Code ATOMAR reservieren – hier wird der Wettlauf entschieden.
 *   4. Konto anlegen.
 *   5. Code endgültig verbrauchen.
 *
 * Scheitert 4 nachweislich an der Eingabe, wird der Code wieder frei. Bei
 * jedem anderen Fehler bleibt er reserviert: ein verbrannter Code kostet
 * einen Klick, ein zweites Konto auf denselben Code wäre der Fehler, den
 * diese Funktion ausschließen soll.
 */

export type Registrierdaten = {
  code: string;
  benutzername: string;
  passwort: string;
  email?: string;
  vorname?: string;
  nachname?: string;
};

/**
 * Legt das Konto beim Anmeldedienst an. Wirft bei Misserfolg; `eingabefehler`
 * unterscheidet „die Angaben taugen nicht" (Code wieder freigeben) von
 * „unklar, was passiert ist" (Code bleibt reserviert).
 */
export type KontoAnleger = (auftrag: {
  benutzername: string;
  passwort: string;
  email?: string;
  vorname?: string;
  nachname?: string;
  rolle: 'admin' | 'mitarbeiter';
  einladungId: string;
}) => Promise<{ userId: string }>;

export type Anlagefehler = {
  eingabefehler: boolean;
  meldung: string;
};

export type Registrierergebnis =
  | { ok: true; userId: string; benutzername: string }
  | { ok: false; status: number; meldung: string };

export const ABLEHNUNG = 'Dieser Einladungscode ist nicht gültig.';
export const GESPERRT = 'Zu viele Versuche. Bitte in einigen Minuten erneut probieren.';
export const UNKLAR =
  'Das Konto konnte nicht angelegt werden. Bitte den Administrator ansprechen.';

export function eingabenPruefen(daten: Registrierdaten): string | null {
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(daten.benutzername)) {
    return 'Der Benutzername braucht 3 bis 64 Zeichen (Buchstaben, Ziffern, . _ -).';
  }
  if (daten.passwort.length < 8) {
    return 'Das Passwort braucht mindestens 8 Zeichen.';
  }
  if (daten.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(daten.email)) {
    return 'Diese E-Mail-Adresse sieht nicht richtig aus.';
  }
  return null;
}

export async function registrieren(opt: {
  abfrage: Abfrage;
  pepper: string;
  kennung: string;
  daten: Registrierdaten;
  kontoAnlegen: KontoAnleger;
}): Promise<Registrierergebnis> {
  const { abfrage, pepper, kennung, daten } = opt;

  if (await istGesperrt(abfrage, kennung)) {
    return { ok: false, status: 429, meldung: GESPERRT };
  }

  const eingabefehler = eingabenPruefen(daten);
  if (eingabefehler) {
    return { ok: false, status: 400, meldung: eingabefehler };
  }

  const reservierung = await codeReservieren(abfrage, daten.code, pepper);
  await versuchNotieren(abfrage, kennung, reservierung.ok);
  if (!reservierung.ok) {
    return { ok: false, status: 400, meldung: ABLEHNUNG };
  }

  let userId: string;
  try {
    const konto = await opt.kontoAnlegen({
      benutzername: daten.benutzername,
      passwort: daten.passwort,
      email: daten.email || undefined,
      vorname: daten.vorname || undefined,
      nachname: daten.nachname || undefined,
      rolle: reservierung.rolle,
      einladungId: reservierung.id
    });
    userId = konto.userId;
  } catch (fehler: unknown) {
    const f = fehler as Partial<Anlagefehler>;
    if (f?.eingabefehler === true) {
      await reservierungFreigeben(abfrage, reservierung.id);
      return { ok: false, status: 400, meldung: f.meldung || ABLEHNUNG };
    }
    return { ok: false, status: 502, meldung: UNKLAR };
  }

  await reservierungAbschliessen(abfrage, reservierung.id, userId);
  return { ok: true, userId, benutzername: daten.benutzername };
}
