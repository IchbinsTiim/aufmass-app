import { redirect } from 'next/navigation';
import { zugangPruefen } from '@/lib/zugang';

/**
 * Die Adresse ohne Pfad – aufmassx.com/
 *
 * Angemeldet und freigeschaltet: direkt in die Anwendung. Sonst zur
 * Anmeldung bzw. zur Erklärung. Bewusst keine Zwischenseite: wer auf der
 * Baustelle die Adresse eintippt, will arbeiten und keine Auswahl treffen.
 */
export default async function Startseite() {
  const zugang = await zugangPruefen();
  if (zugang.grund === 'nicht-angemeldet') redirect('/sign-in');
  redirect(zugang.erlaubt ? '/app' : '/kein-zugang');
}
