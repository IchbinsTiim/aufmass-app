import { redirect } from 'next/navigation';
import { hatRecht } from '@/lib/rollen';
import { zugangMitRechten, type ZugangMitRechten } from '@/lib/zugang';

/**
 * Der Türsteher jeder geschützten Seite.
 *
 * Eine Seite, die etwas zeigt oder ändert, ruft ihn als ERSTES auf. Damit
 * hängt die Absicherung nicht daran, dass jemand den Link kennt oder nicht:
 * Wer das Recht nicht hat, bekommt die Seite gar nicht erst gerendert.
 *
 * Die Server Actions daneben prüfen NOCH EINMAL selbst (siehe
 * app/mitarbeiter/aktionen.ts). Das ist keine doppelte Arbeit aus
 * Vorsicht, sondern notwendig: Eine Server Action ist ein eigener Endpunkt
 * und lässt sich aufrufen, ohne je die Seite geöffnet zu haben.
 */
export async function seiteSchuetzen(recht: string): Promise<ZugangMitRechten> {
  const zugang = await zugangMitRechten();
  if (zugang.grund === 'nicht-angemeldet') redirect('/sign-in');
  if (!zugang.erlaubt) redirect('/kein-zugang');
  if (!hatRecht(zugang.rechte, recht)) redirect('/app');
  return zugang;
}

/** Wie seiteSchuetzen, nur für Server Actions: wirft statt umzuleiten. */
export async function aktionSchuetzen(recht: string): Promise<ZugangMitRechten> {
  const zugang = await zugangMitRechten();
  if (!zugang.erlaubt || !hatRecht(zugang.rechte, recht)) {
    throw new Error('Dafür fehlt Ihrer Rolle die Berechtigung.');
  }
  return zugang;
}
