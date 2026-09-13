'use server';

import { revalidatePath } from 'next/cache';
import { abfrageHolen } from '@/lib/einladungen/db';
import { aktivitaetNotieren } from '@/lib/mitarbeiter/aktivitaet';
import { rolleImEinsatz } from '@/lib/mitarbeiter/daten';
import { RollenFehler, rolleLoeschen, rolleSpeichern } from '@/lib/mitarbeiter/rollen-db';
import { mitarbeiterListe } from '@/lib/mitarbeiter/verzeichnis';
import { ROLLEN_VORLAGEN, rollenIdAus, rollenIdGueltig } from '@/lib/rollen';
import { rollenCacheLeeren, rollenHolen } from '@/lib/zugang';
import { aktionSchuetzen } from '../schutz';

/**
 * Rollen anlegen, ändern und löschen.
 *
 * Wie überall gilt: Die Prüfung steht hier, nicht in der Oberfläche. Wer
 * „rollen.verwalten" nicht hat, kommt auch mit einem direkten Aufruf nicht
 * durch.
 *
 * Nach jeder Änderung wird der Rollen-Zwischenspeicher geleert (siehe
 * lib/zugang.ts): Eine neue Rechteverteilung soll sofort greifen und nicht
 * erst, wenn der Zwischenspeicher von selbst abläuft.
 */

export type RollenErgebnis = { ok?: string; fehler?: string };

const VERWALTEN = 'rollen.verwalten';

export async function rolleSichern(
  _vorher: RollenErgebnis | null, formular: FormData
): Promise<RollenErgebnis> {
  try {
    const zugang = await aktionSchuetzen(VERWALTEN);
    const name = String(formular.get('name') || '').trim();
    if (!name) return { fehler: 'Die Rolle braucht einen Namen.' };

    // Eine bestehende Rolle behält ihre Kennung – an ihr hängen die
    // Mitarbeiter. Nur eine neue bekommt eine aus dem Namen abgeleitete.
    const vorhanden = String(formular.get('id') || '');
    const id = rollenIdGueltig(vorhanden) ? vorhanden : rollenIdAus(name);
    if (!id) {
      return { fehler: 'Aus diesem Namen lässt sich keine Kennung bilden. Bitte Buchstaben verwenden.' };
    }

    const rechte = formular.getAll('rechte').map(String);
    const rolle = await rolleSpeichern(abfrageHolen(), {
      id,
      name,
      beschreibung: String(formular.get('beschreibung') || ''),
      rechte,
      sortierung: Number(formular.get('sortierung') || 100)
    }, zugang.userId || 'unbekannt');

    rollenCacheLeeren();
    await aktivitaetNotieren(abfrageHolen(), {
      userId: zugang.userId || 'unbekannt', art: 'rolle.gespeichert',
      objektId: rolle.id, objektTitel: rolle.name
    });
    revalidatePath('/rollen');
    revalidatePath('/mitarbeiter');
    return { ok: `Rolle „${rolle.name}" gespeichert.` };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}

export async function rolleEntfernen(
  _vorher: RollenErgebnis | null, formular: FormData
): Promise<RollenErgebnis> {
  try {
    const zugang = await aktionSchuetzen(VERWALTEN);
    const id = String(formular.get('id') || '');
    if (!rollenIdGueltig(id)) return { fehler: 'Diese Rolle gibt es nicht.' };

    // Eine Rolle, die noch jemand trägt, wird nicht gelöscht – sonst stünden
    // Mitarbeiter ohne Zuordnung da und kämen nicht mehr hinein.
    const liste = await mitarbeiterListe();
    await rolleLoeschen(abfrageHolen(), id, rolleImEinsatz(liste, id));

    rollenCacheLeeren();
    await aktivitaetNotieren(abfrageHolen(), {
      userId: zugang.userId || 'unbekannt', art: 'rolle.geloescht', objektId: id
    });
    revalidatePath('/rollen');
    return { ok: 'Rolle gelöscht.' };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}

/** Legt eine der mitgelieferten Vorlagen an – ein Klick statt zehn Haken. */
export async function vorlageAnlegen(
  _vorher: RollenErgebnis | null, formular: FormData
): Promise<RollenErgebnis> {
  try {
    const zugang = await aktionSchuetzen(VERWALTEN);
    const id = String(formular.get('id') || '');
    const vorlage = ROLLEN_VORLAGEN.find(v => v.id === id);
    if (!vorlage) return { fehler: 'Diese Vorlage gibt es nicht.' };

    const schon = (await rollenHolen()).some(r => r.id === vorlage.id);
    if (schon) return { fehler: `„${vorlage.name}" gibt es bereits.` };

    await rolleSpeichern(abfrageHolen(), {
      id: vorlage.id, name: vorlage.name, beschreibung: vorlage.beschreibung,
      rechte: vorlage.rechte, sortierung: vorlage.sortierung
    }, zugang.userId || 'unbekannt');

    rollenCacheLeeren();
    revalidatePath('/rollen');
    return { ok: `Rolle „${vorlage.name}" angelegt.` };
  } catch (fehler) {
    return { fehler: fehlertext(fehler) };
  }
}

function fehlertext(fehler: unknown): string {
  return fehler instanceof RollenFehler || fehler instanceof Error
    ? fehler.message
    : 'Der Vorgang ist fehlgeschlagen.';
}
