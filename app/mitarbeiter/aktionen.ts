'use server';

import { revalidatePath } from 'next/cache';
import { abfrageHolen } from '@/lib/einladungen/db';
import { aktivitaetNotieren } from '@/lib/mitarbeiter/aktivitaet';
import {
  MitarbeiterFehler, mitarbeiterHolen, mitarbeiterListe, rolleZuweisen,
  zugangAktivieren, zugangDeaktivieren
} from '@/lib/mitarbeiter/verzeichnis';
import { hatRecht, rechteVonRolle, rolleFinden } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';
import { aktionSchuetzen } from '../schutz';

/**
 * Die Aktionen der Mitarbeiterverwaltung.
 *
 * Jede prüft ihr Recht selbst. Server Actions sind eigene Endpunkte – sie
 * hinter einer Seite zu verstecken, die nur Berechtigte sehen, wäre keine
 * Absicherung, sondern eine Verabredung.
 *
 * Dazu kommen zwei Regeln, die verhindern, dass sich ein Betrieb aus seiner
 * eigenen Verwaltung aussperrt. Beide gelten serverseitig, nicht als Hinweis
 * in der Oberfläche:
 *
 *   • Niemand deaktiviert sich selbst oder ändert die eigene Rolle. Wer das
 *     täte, wäre im selben Moment draußen – und könnte es nicht rückgängig
 *     machen, weil ihm dafür genau das Recht fehlt, das er sich eben
 *     genommen hat.
 *   • Der letzte Zugang, der Mitarbeiter verwalten darf, bleibt bestehen.
 *     Sonst gäbe es niemanden mehr, der irgendjemanden freischalten kann.
 */

export type AktionsErgebnis = { ok?: string; fehler?: string };

const VERWALTEN = 'mitarbeiter.verwalten';

async function zaehleVerwalter(): Promise<Map<string, boolean>> {
  const [liste, rollen] = await Promise.all([mitarbeiterListe(), rollenHolen()]);
  const map = new Map<string, boolean>();
  liste.forEach(m => {
    const rechte = rechteVonRolle(rolleFinden(rollen, m.rolle));
    map.set(m.id, m.aktiv && hatRecht(rechte, VERWALTEN));
  });
  return map;
}

/** Bliebe nach dieser Änderung noch jemand übrig, der verwalten darf? */
async function bleibtEinVerwalter(userId: string): Promise<boolean> {
  const verwalter = await zaehleVerwalter();
  return [...verwalter.entries()].some(([id, darfEs]) => darfEs && id !== userId);
}

function fehlertext(fehler: unknown): string {
  return fehler instanceof MitarbeiterFehler || fehler instanceof Error
    ? fehler.message
    : 'Der Vorgang ist fehlgeschlagen.';
}

export async function mitarbeiterRolleSetzen(
  _vorher: AktionsErgebnis | null, formular: FormData
): Promise<AktionsErgebnis> {
  try {
    const zugang = await aktionSchuetzen(VERWALTEN);
    const userId = String(formular.get('userId') || '');
    const rolleId = String(formular.get('rolle') || '');
    if (!userId) return { fehler: 'Kein Mitarbeiter angegeben.' };
    if (userId === zugang.userId) {
      return { fehler: 'Die eigene Rolle lässt sich hier nicht ändern.' };
    }

    const rollen = await rollenHolen();
    const ziel = rolleFinden(rollen, rolleId);
    if (!ziel) return { fehler: 'Diese Rolle gibt es nicht.' };

    // Nimmt die neue Rolle dem letzten Verwalter sein Recht? Dann nicht.
    const behaeltRecht = hatRecht(rechteVonRolle(ziel), VERWALTEN);
    if (!behaeltRecht && !(await bleibtEinVerwalter(userId))) {
      return { fehler: 'Das wäre der letzte Zugang, der Mitarbeiter verwalten darf.' };
    }

    await rolleZuweisen(userId, rolleId);
    await aktivitaetNotieren(abfrageHolen(), {
      userId: zugang.userId || 'unbekannt', art: 'mitarbeiter.rolle',
      objektId: userId, objektTitel: ziel.name
    });
    revalidatePath('/mitarbeiter');
    revalidatePath(`/mitarbeiter/${userId}`);
    return { ok: `Rolle auf „${ziel.name}" geändert.` };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}

/**
 * Zugang deaktivieren – ausdrücklich KEIN Löschen der Daten.
 *
 * Projekte, Aufmaße und Zeichnungen dieses Mitarbeiters bleiben unverändert
 * bestehen; sie gehören dem Betrieb. Auch die Herkunftsangabe bleibt, sonst
 * wäre hinterher nicht mehr nachvollziehbar, wer was aufgemessen hat.
 */
export async function mitarbeiterDeaktivieren(
  _vorher: AktionsErgebnis | null, formular: FormData
): Promise<AktionsErgebnis> {
  try {
    const zugang = await aktionSchuetzen('mitarbeiter.loeschen');
    const userId = String(formular.get('userId') || '');
    if (!userId) return { fehler: 'Kein Mitarbeiter angegeben.' };
    if (userId === zugang.userId) {
      return { fehler: 'Der eigene Zugang lässt sich nicht deaktivieren.' };
    }
    if (!(await bleibtEinVerwalter(userId))) {
      return { fehler: 'Das wäre der letzte Zugang, der Mitarbeiter verwalten darf.' };
    }

    const person = await mitarbeiterHolen(userId);
    await zugangDeaktivieren(userId);
    await aktivitaetNotieren(abfrageHolen(), {
      userId: zugang.userId || 'unbekannt', art: 'mitarbeiter.deaktiviert',
      objektId: userId, objektTitel: person?.name ?? userId
    });
    revalidatePath('/mitarbeiter');
    revalidatePath(`/mitarbeiter/${userId}`);
    return { ok: 'Zugang deaktiviert. Die Daten des Mitarbeiters bleiben erhalten.' };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}

export async function mitarbeiterAktivieren(
  _vorher: AktionsErgebnis | null, formular: FormData
): Promise<AktionsErgebnis> {
  try {
    const zugang = await aktionSchuetzen('mitarbeiter.loeschen');
    const userId = String(formular.get('userId') || '');
    if (!userId) return { fehler: 'Kein Mitarbeiter angegeben.' };

    const gewuenscht = String(formular.get('rolle') || '');
    const rollen = await rollenHolen();
    const ziel = rolleFinden(rollen, gewuenscht);

    const person = await mitarbeiterHolen(userId);
    await zugangAktivieren(userId, ziel?.id);
    await aktivitaetNotieren(abfrageHolen(), {
      userId: zugang.userId || 'unbekannt', art: 'mitarbeiter.aktiviert',
      objektId: userId, objektTitel: person?.name ?? userId
    });
    revalidatePath('/mitarbeiter');
    revalidatePath(`/mitarbeiter/${userId}`);
    return { ok: 'Zugang wieder freigeschaltet.' };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}
