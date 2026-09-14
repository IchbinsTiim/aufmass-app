import type { Abfrage } from '../einladungen/kern.ts';

/**
 * Aktivitätsprotokoll – „wer hat wann was angelegt".
 *
 * Absichtlich grobkörnig: Protokolliert werden Ereignisse, die man später
 * nachvollziehen will (Projekt angelegt, Zeichnung gespeichert, Rolle
 * geändert, Zugang deaktiviert) – NICHT jeder Autosave. Die 2D-App sichert
 * im Sekundentakt; ein Eintrag je Speichervorgang wäre nach einer Woche
 * unlesbar und nach einem Monat teuer. „Zuletzt geändert von wem" beantworten
 * die Spalten `geaendert_von`/`geaendert_am` am Datensatz selbst.
 *
 * Kein Protokolleintrag darf je einen Arbeitsschritt scheitern lassen: Alle
 * Funktionen hier schlucken ihre Fehler. Ein Projekt zu speichern ist
 * wichtiger als die Notiz darüber.
 */

export type Aktivitaetsart =
  | 'projekt.angelegt'
  | 'projekt.geloescht'
  | 'zeichnung.gespeichert'
  | 'mitarbeiter.rolle'
  | 'mitarbeiter.deaktiviert'
  | 'mitarbeiter.aktiviert'
  | 'rolle.gespeichert'
  | 'rolle.geloescht';

export type Aktivitaet = {
  id: string;
  userId: string;
  art: string;
  objektId: string | null;
  objektTitel: string | null;
  zeitpunkt: string;
};

export const AKTIVITAET_TEXT: Record<string, string> = {
  'projekt.angelegt': 'Projekt angelegt',
  'projekt.geloescht': 'Projekt gelöscht',
  'zeichnung.gespeichert': '2D-Zeichnung gespeichert',
  'mitarbeiter.rolle': 'Rolle eines Mitarbeiters geändert',
  'mitarbeiter.deaktiviert': 'Mitarbeiter deaktiviert',
  'mitarbeiter.aktiviert': 'Mitarbeiter wieder freigeschaltet',
  'rolle.gespeichert': 'Rolle gespeichert',
  'rolle.geloescht': 'Rolle gelöscht'
};

export async function aktivitaetNotieren(
  abfrage: Abfrage | null,
  eintrag: { userId: string; art: Aktivitaetsart; objektId?: string | null; objektTitel?: string | null }
): Promise<void> {
  if (!abfrage || !eintrag.userId) return;
  try {
    await abfrage(
      `INSERT INTO aktivitaeten (user_id, art, objekt_id, objekt_titel)
       VALUES ($1, $2, $3, $4)`,
      [
        eintrag.userId, eintrag.art,
        eintrag.objektId ? String(eintrag.objektId).slice(0, 120) : null,
        eintrag.objektTitel ? String(eintrag.objektTitel).slice(0, 240) : null
      ]
    );
  } catch {
    // Siehe oben: Das Protokoll hält die Arbeit nie auf.
  }
}

function alsText(wert: unknown): string {
  return wert instanceof Date ? wert.toISOString() : String(wert);
}

export async function aktivitaetenLesen(
  abfrage: Abfrage | null, userId: string, grenze = 40
): Promise<Aktivitaet[]> {
  if (!abfrage) return [];
  const zeilen = await abfrage(
    `SELECT id, user_id, art, objekt_id, objekt_titel, zeitpunkt
       FROM aktivitaeten WHERE user_id = $1
      ORDER BY zeitpunkt DESC, id DESC LIMIT $2`,
    [userId, Math.min(Math.max(grenze, 1), 200)]
  );
  return zeilen.map(z => ({
    id: String(z.id),
    userId: String(z.user_id),
    art: String(z.art),
    objektId: z.objekt_id == null ? null : String(z.objekt_id),
    objektTitel: z.objekt_titel == null ? null : String(z.objekt_titel),
    zeitpunkt: alsText(z.zeitpunkt)
  }));
}
