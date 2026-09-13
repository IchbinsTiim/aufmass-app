import { hatRecht } from '@/lib/rollen';
import { zugangMitRechten } from '@/lib/zugang';
import { CloudFehler } from './cloud';

export type CloudKontext = {
  userId: string;
  /** Darf Daten anderer Mitarbeiter sehen und bearbeiten (früher: „ist Admin"). */
  istAdmin: boolean;
  rechte: Set<string>;
  rolle: string;
};

/**
 * Einheitliche Zugangskontrolle für jede Cloud-Route.
 *
 * Zwei Stufen, beide serverseitig:
 *
 *   1. Angemeldet UND freigeschaltet – sonst 401. Unverändert.
 *   2. Das für den Vorgang nötige RECHT – sonst 403. Neu. Die Oberfläche
 *      blendet Knöpfe aus, die jemand nicht braucht; verlassen kann man sich
 *      darauf nicht. Erlaubt ist, was diese Funktion durchlässt.
 *
 * `istAdmin` heißt seit der Rechteverwaltung nicht mehr „trägt die Rolle
 * admin", sondern „darf fremde Daten sehen". Für die mitgelieferten Rollen
 * ändert sich dadurch nichts (nur der Administrator hat dieses Recht); eine
 * eigene Rolle kann es jetzt aber ebenfalls bekommen – genau darum ging es
 * bei „Daten anderer Mitarbeiter ansehen".
 */
export async function cloudZugriff(recht?: string | string[]): Promise<CloudKontext> {
  const zugang = await zugangMitRechten();
  if (!zugang.userId || !zugang.erlaubt) {
    throw new CloudFehler(401, zugang.grund === 'deaktiviert'
      ? 'Dieser Zugang ist deaktiviert.'
      : 'Anmeldung erforderlich.');
  }
  const verlangt = recht == null ? [] : Array.isArray(recht) ? recht : [recht];
  if (verlangt.length && !verlangt.some(r => hatRecht(zugang.rechte, r))) {
    throw new CloudFehler(403, 'Dafür fehlt Ihrer Rolle die Berechtigung.');
  }
  return {
    userId: zugang.userId,
    istAdmin: hatRecht(zugang.rechte, 'fremde.daten.ansehen'),
    rechte: zugang.rechte,
    rolle: zugang.rolle
  };
}
