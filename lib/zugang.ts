import { auth, currentUser } from '@clerk/nextjs/server';
import { abfrageHolen } from './einladungen/db';
import { rollenLaden } from './mitarbeiter/rollen-db';
import { STANDARD_ROLLE, hatRecht, rechteVonRolle, rolleFinden, type Rolle } from './rollen';
import {
  DEAKTIVIERT, GESPERRT, STATUS_DEAKTIVIERT, adminEmailsAus, zugangAusAngaben,
  type Zugang, type Zugangsgrund
} from './zugang-regeln';

// Die Regeln selbst stehen in lib/zugang-regeln.ts – ohne Clerk, ohne Next.js
// und damit für sich prüfbar. Hier werden sie nur mit den Angaben gefüttert,
// die der Anmeldedienst liefert. Wiederausgegeben, damit Aufrufer weiterhin
// alles aus einer Datei beziehen.
export { STATUS_DEAKTIVIERT, zugangAusAngaben };
export type { Zugang, Zugangsgrund };

/**
 * Zugang – AufmaßX ist eine interne Anwendung. Wer nicht eingeladen wurde,
 * kommt nicht hinein.
 *
 * Das wird an ZWEI voneinander unabhängigen Stellen durchgesetzt:
 *
 *  1. In Clerk selbst: „Restricted" (nur auf Einladung). Damit kann bei Clerk
 *     gar kein Konto entstehen, das niemand eingeladen hat – auch nicht durch
 *     einen direkten Aufruf der Clerk-API an unserer Oberfläche vorbei.
 *     Einzurichten im Dashboard, siehe MIGRATION.md.
 *
 *  2. Hier, serverseitig, bei jedem Zugriff auf die Anwendung: ein Konto
 *     reicht nicht, es muss auch freigeschaltet sein. Freigeschaltet ist,
 *     wer eine Rolle in `publicMetadata.rolle` trägt – die setzt der Admin
 *     beim Einladen. Damit ist Schritt 2 auch dann noch eine echte Sperre,
 *     wenn die Einstellung aus Schritt 1 versehentlich zurückgestellt wird.
 *
 * Der erste Admin ist das Henne-Ei-Problem: er kann sich die Rolle nicht
 * selbst geben, bevor er hineinkommt. Dafür gibt es AUFMASSX_ADMIN_EMAILS –
 * eine kommagetrennte Liste von E-Mail-Adressen, die immer als Admin gelten.
 *
 * SEIT DER MITARBEITERVERWALTUNG kommen zwei Dinge dazu:
 *
 *  • In `publicMetadata.rolle` darf jede Rollenkennung stehen, auch die einer
 *    selbst angelegten Rolle. Was diese Rolle DARF, steht in der Tabelle
 *    `rollen` – abgefragt wird das nur dort, wo ein Recht gebraucht wird
 *    (siehe `rechteHolen`), nicht bei jedem Seitenaufruf.
 *  • Ein DEAKTIVIERTER Zugang kommt nicht mehr hinein. Beim Deaktivieren
 *    nimmt die Verwaltung dem Konto die Rolle weg und merkt sie sich in
 *    `publicMetadata.rolleVorher`; zusätzlich wird das Konto bei Clerk
 *    gesperrt. Ohne Rolle greift die Sperre unten schon beim nächsten
 *    Aufruf – auch dann, wenn die Sperre bei Clerk einmal nicht durchgeht.
 */

function adminListe(): string[] {
  return adminEmailsAus(process.env.AUFMASSX_ADMIN_EMAILS);
}

/**
 * Prüft Anmeldung UND Freischaltung.
 *
 * Der Regelfall kostet keinen Netzaufruf: Rolle, Status und E-Mail stehen im
 * Session-Token, sofern im Clerk-Dashboard die Vorlage aus MIGRATION.md
 * hinterlegt ist. Fehlt sie, wird der Benutzerdatensatz nachgeladen – das
 * kostet, ist aber nie falsch. So bleibt die Sperre auch bei
 * unvollständiger Einrichtung wirksam.
 */
export async function zugangPruefen(): Promise<Zugang> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { erlaubt: false, rolle: STANDARD_ROLLE, grund: 'nicht-angemeldet' };

  const claims = sessionClaims as
    | { metadata?: { rolle?: unknown; status?: unknown }; email?: unknown }
    | null
    | undefined;

  const ausToken = zugangAusAngaben(
    claims?.metadata,
    typeof claims?.email === 'string' ? [claims.email] : [],
    adminListe()
  );
  if (ausToken) return ausToken;

  // Keine Metadaten im Token – am Benutzerdatensatz nachsehen.
  const user = await currentUser();
  if (!user) return GESPERRT;

  return zugangAusAngaben(
    user.publicMetadata ?? {},
    user.emailAddresses.map(a => a.emailAddress),
    adminListe()
  ) ?? GESPERRT;
}

/* ── Rechte ─────────────────────────────────────────────────────────────────
   Was eine Rolle darf, steht in der Datenbank und ändert sich selten – eine
   Abfrage je Anfrage wäre trotzdem spürbar, weil die 2D-App im Sekundentakt
   speichert. Deshalb ein kurzer Zwischenspeicher je Serverinstanz: Eine
   Rechteänderung greift damit spätestens nach ROLLEN_FRISCH Millisekunden.
   Länger zu puffern wäre eine Sicherheitsfrage, kürzer brächte nichts.      */

const ROLLEN_FRISCH = 30_000;
let rollenCache: { zeit: number; rollen: Rolle[] } | null = null;

export async function rollenHolen(): Promise<Rolle[]> {
  const jetzt = Date.now();
  if (rollenCache && jetzt - rollenCache.zeit < ROLLEN_FRISCH) return rollenCache.rollen;
  let rollen: Rolle[];
  try {
    rollen = await rollenLaden(abfrageHolen());
  } catch {
    // Datenbank gerade nicht erreichbar: Mit den mitgelieferten Rollen
    // weiterarbeiten ist richtig – sie sind die engere Annahme, nicht die
    // weitere: Eigene Rollen mit zusätzlichen Rechten greifen dann nicht.
    rollen = await rollenLaden(null);
  }
  rollenCache = { zeit: jetzt, rollen };
  return rollen;
}

/** Nur für Tests und nach dem Speichern einer Rolle. */
export function rollenCacheLeeren(): void {
  rollenCache = null;
}

export type ZugangMitRechten = Zugang & {
  userId: string | null;
  rechte: Set<string>;
  rolleObjekt: Rolle | null;
};

/**
 * Zugang samt aufgelöster Rechte – die Grundlage jeder serverseitigen
 * Prüfung. Ein ausgeblendeter Knopf ist keine Absicherung; erlaubt ist, was
 * hier herauskommt.
 */
export async function zugangMitRechten(): Promise<ZugangMitRechten> {
  const [zugang, anmeldung] = await Promise.all([zugangPruefen(), auth()]);
  if (!zugang.erlaubt) {
    return { ...zugang, userId: anmeldung.userId ?? null, rechte: new Set(), rolleObjekt: null };
  }
  const rollen = await rollenHolen();
  const rolleObjekt = rolleFinden(rollen, zugang.rolle);
  return {
    ...zugang,
    userId: anmeldung.userId ?? null,
    rolleObjekt,
    rechte: rechteVonRolle(rolleObjekt)
  };
}

/** Kurzform für Seiten: „darf der angemeldete Benutzer das?" */
export async function darf(recht: string): Promise<boolean> {
  const zugang = await zugangMitRechten();
  return zugang.erlaubt && hatRecht(zugang.rechte, recht);
}
