/**
 * Rollen – bewusst klein gehalten.
 *
 * Phase 1 braucht zwei Rollen und keine Rechtelogik. Was hier steht, ist der
 * eine Ort, an dem später Rechte hängen werden: Mitarbeiter verwalten,
 * fremde Projekte sehen, einladen.
 *
 * Die Rolle steht in Clerks `publicMetadata.rolle`. Der Admin setzt sie beim
 * Einladen (Clerk-Dashboard → Invitations → Public metadata) oder nachträglich
 * am Benutzer. Sie ist zugleich der Nachweis, dass jemand eingeladen wurde –
 * siehe lib/zugang.ts.
 */
export type Rolle = 'admin' | 'mitarbeiter';

export const STANDARD_ROLLE: Rolle = 'mitarbeiter';

export function rolleBeschriftung(rolle: Rolle): string {
  return rolle === 'admin' ? 'Administrator' : 'Mitarbeiter';
}
