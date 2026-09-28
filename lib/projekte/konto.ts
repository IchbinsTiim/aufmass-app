import { ALLE_RECHTE, RECHT_KEYS, rolleBeschriftung } from '@/lib/rollen';
import type { rollenHolen } from '@/lib/zugang';

/**
 * Name, Rolle und Rechte des angemeldeten Benutzers – reine ANZEIGE-
 * Information für die Oberflächen unter /app. Jede Seite und jede Route
 * prüft ihr Recht selbst noch einmal.
 */
export function kontoAuskunft(
  zugriff: { userId: string; rolle: string; rechte: Set<string> },
  rollen: Awaited<ReturnType<typeof rollenHolen>>
) {
  return {
    userId: zugriff.userId,
    rolle: zugriff.rolle,
    rolleName: rolleBeschriftung(zugriff.rolle, rollen),
    // Administratoren tragen intern nur den Platzhalter "*". Für die
    // Oberfläche werden daraus die konkreten Rechte, damit sie dieselben
    // vorgesehenen Funktionen wie eine eigene, gleichberechtigte Rolle
    // sieht. Die Routen selbst prüfen weiterhin serverseitig.
    rechte: zugriff.rechte.has(ALLE_RECHTE) ? RECHT_KEYS : [...zugriff.rechte]
  };
}
