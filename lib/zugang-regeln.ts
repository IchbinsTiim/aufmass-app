import { ADMIN_ROLLE, STANDARD_ROLLE, rollenIdGueltig } from './rollen.ts';

/**
 * Die Zugangsregeln – als reine Entscheidung.
 *
 * Diese Datei kennt weder Clerk noch Next.js noch die Umgebung. Das ist
 * Absicht: Es ist die wichtigste Verzweigung der ganzen Anwendung („wer darf
 * hinein"), und sie soll ohne Anmeldedienst prüfbar sein
 * (tests/r19-rollen-rechte.mjs). `lib/zugang.ts` holt die Angaben zusammen
 * und ruft sie auf.
 */

export type Zugangsgrund =
  | 'nicht-angemeldet'
  | 'rolle'
  | 'admin-liste'
  | 'deaktiviert'
  | 'nicht-freigeschaltet';

export type Zugang = {
  erlaubt: boolean;
  rolle: string;
  grund: Zugangsgrund;
};

export const STATUS_DEAKTIVIERT = 'deaktiviert';

export const GESPERRT: Zugang =
  { erlaubt: false, rolle: STANDARD_ROLLE, grund: 'nicht-freigeschaltet' };
export const DEAKTIVIERT: Zugang =
  { erlaubt: false, rolle: STANDARD_ROLLE, grund: 'deaktiviert' };

/**
 * Taugt der Wert als Rollenkennung?
 *
 * Bewusst KEINE Prüfung gegen die Liste der angelegten Rollen: Die steht in
 * der Datenbank, und die Anmeldung darf nicht von ihr abhängen. Wer eine
 * Rolle trägt, ist eingeladen worden – das ist die Aussage, um die es hier
 * geht. Was die Rolle darf, ist eine andere Frage.
 */
export function istRollenkennung(wert: unknown): wert is string {
  return rollenIdGueltig(wert);
}

/**
 * Was folgt aus Metadaten und E-Mail-Adressen?
 *
 * Die Reihenfolge ist nicht beliebig:
 *
 *   1. DEAKTIVIERT schlägt alles. Auch eine Rolle, auch die Admin-Liste –
 *      sonst käme ein gesperrter Zugang über den Notzugang wieder herein.
 *   2. Die Admin-Liste aus AUFMASSX_ADMIN_EMAILS ist der Notzugang für den
 *      ersten Administrator. Sie muss auch dann greifen, wenn diese Person
 *      vorher bereits die Mitarbeiterrolle bekommen hat.
 *   3. Eine gültige Rollenkennung ist der reguläre Nachweis der Einladung.
 *
 * @param metadata Clerks `publicMetadata`, oder `undefined`, wenn sie an
 *        dieser Stelle NICHT vorliegen.
 * @returns `null` heißt „keine Auskunft" – der Aufrufer muss den
 *        Benutzerdatensatz nachladen. Das gilt für fehlende Metadaten (dann
 *        ist auch der Status unbekannt) ebenso wie für Metadaten ohne Rolle:
 *        Ein gerade erst freigeschaltetes Konto trägt seine Rolle im Token
 *        erst nach der nächsten Erneuerung, im Datensatz aber sofort.
 */
export function zugangAusAngaben(
  metadata: { rolle?: unknown; status?: unknown } | null | undefined,
  emails: string[],
  adminEmails: string[]
): Zugang | null {
  if (metadata === null || metadata === undefined) return null;
  if (metadata.status === STATUS_DEAKTIVIERT) return DEAKTIVIERT;
  const liste = adminEmails.map(e => String(e).trim().toLowerCase()).filter(Boolean);
  const treffer = emails.some(e => e && liste.includes(String(e).toLowerCase()));
  if (treffer) return { erlaubt: true, rolle: ADMIN_ROLLE, grund: 'admin-liste' };
  if (istRollenkennung(metadata.rolle)) {
    return { erlaubt: true, rolle: metadata.rolle, grund: 'rolle' };
  }
  return null;
}

/** Kommagetrennte Liste aus AUFMASSX_ADMIN_EMAILS in einzelne Adressen. */
export function adminEmailsAus(wert: string | undefined | null): string[] {
  return (wert ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}
