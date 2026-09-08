import { auth, currentUser } from '@clerk/nextjs/server';
import { STANDARD_ROLLE, type Rolle } from './rollen';

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
 */

export type Zugangsgrund =
  | 'nicht-angemeldet'
  | 'rolle'
  | 'admin-liste'
  | 'nicht-freigeschaltet';

export type Zugang = {
  erlaubt: boolean;
  rolle: Rolle;
  grund: Zugangsgrund;
};

function adminListe(): string[] {
  return (process.env.AUFMASSX_ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

function istRolle(wert: unknown): wert is Rolle {
  return wert === 'admin' || wert === 'mitarbeiter';
}

const GESPERRT: Zugang = { erlaubt: false, rolle: STANDARD_ROLLE, grund: 'nicht-freigeschaltet' };

/**
 * Prüft Anmeldung UND Freischaltung.
 *
 * Der Regelfall kostet keinen Netzaufruf: Rolle und E-Mail stehen im
 * Session-Token, sofern im Clerk-Dashboard die Vorlage aus MIGRATION.md
 * hinterlegt ist. Fehlt sie, wird der Benutzerdatensatz nachgeladen – das
 * kostet, ist aber nie falsch. So bleibt die Sperre auch bei
 * unvollständiger Einrichtung wirksam.
 */
export async function zugangPruefen(): Promise<Zugang> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { erlaubt: false, rolle: STANDARD_ROLLE, grund: 'nicht-angemeldet' };

  const claims = sessionClaims as
    | { metadata?: { rolle?: unknown }; email?: unknown }
    | null
    | undefined;

  const rolleAusClaim = claims?.metadata?.rolle;
  if (istRolle(rolleAusClaim)) {
    return { erlaubt: true, rolle: rolleAusClaim, grund: 'rolle' };
  }

  const emailAusClaim = typeof claims?.email === 'string' ? claims.email.toLowerCase() : null;
  if (emailAusClaim && adminListe().includes(emailAusClaim)) {
    return { erlaubt: true, rolle: 'admin', grund: 'admin-liste' };
  }

  // Kein brauchbarer Claim – am Benutzerdatensatz nachsehen.
  const user = await currentUser();
  if (!user) return GESPERRT;

  const rolleAusMetadata = user.publicMetadata?.rolle;
  if (istRolle(rolleAusMetadata)) {
    return { erlaubt: true, rolle: rolleAusMetadata, grund: 'rolle' };
  }

  const liste = adminListe();
  const trefferAdmin = user.emailAddresses.some(a =>
    liste.includes(a.emailAddress.toLowerCase())
  );
  if (trefferAdmin) return { erlaubt: true, rolle: 'admin', grund: 'admin-liste' };

  return GESPERRT;
}
