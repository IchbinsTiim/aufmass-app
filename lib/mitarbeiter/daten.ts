import type { Abfrage } from '../einladungen/kern.ts';

/**
 * „Was hat dieser Mitarbeiter angelegt?"
 *
 * Die Antwort steckt in den Cloud-Tabellen. Wichtig ist, was in dieser
 * Anwendung überhaupt ein eigener Datensatz ist – sonst listet man Dinge auf,
 * die es gar nicht gibt:
 *
 *   Projekt      `cloud_projekte`. Enthält die ganze Projektakte: Anschrift,
 *                Technik, Aufmaßseiten UND die zugehörige 2D-Zeichnung.
 *   Aufmaß       kein eigener Datensatz, sondern der Teil `seiten` im
 *                Projekt. Deshalb wird es je Projekt ausgewiesen – mit der
 *                Zahl der Seiten und Positionen, damit die Zeile etwas sagt.
 *   Zeichnung    zweierlei: die benannten Speicherstände in
 *                `cloud_zeichnungen` und die laufende Zeichnung im Projekt
 *                selbst (`inhalt -> zeichnung2d`). Beides wird gezeigt und
 *                auseinandergehalten.
 *
 * Alle Abfragen laufen über `erstellt_von`. Für Projekte, die vor der
 * Einführung dieser Spalte entstanden sind, hat die Migration den Eigentümer
 * eingetragen – siehe db/migrations/20260913_mitarbeiter_rollen.sql.
 */

export type ProjektZeile = {
  id: string;
  titel: string;
  erstelltAm: string;
  geaendertAm: string;
  geaendertVon: string | null;
  /** Zahl der Aufmaßseiten im Projekt (0 = noch kein Aufmaß erfasst). */
  seiten: number;
  positionen: number;
  felder2d: number;
  istEigentuemer: boolean;
};

export type ZeichnungsZeile = {
  id: string;
  name: string;
  projektId: string;
  projektTitel: string;
  erstelltAm: string;
  quelle: string;
};

function alsText(wert: unknown): string {
  return wert instanceof Date ? wert.toISOString() : String(wert ?? '');
}

function zahl(wert: unknown): number {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Projekte, die dieser Benutzer angelegt hat.
 *
 * Seiten-, Positions- und Feldzahl werden in SQL aus dem JSON gezählt und
 * nicht in der Anwendung: Sonst müsste für eine Übersichtsseite die gesamte
 * Projektakte jedes Projekts über die Leitung – bei zwanzig Projekten
 * schnell ein paar Megabyte für drei Zahlen.
 */
export async function projekteVonMitarbeiter(
  abfrage: Abfrage | null, userId: string, grenze = 100
): Promise<ProjektZeile[]> {
  if (!abfrage) return [];
  const zeilen = await abfrage(
    `SELECT p.id,
            p.titel,
            p.owner_user_id,
            p.erstellt_am,
            p.geaendert_am,
            p.geaendert_von,
            COALESCE(jsonb_array_length(
              CASE WHEN jsonb_typeof(p.inhalt -> 'seiten') = 'array'
                   THEN p.inhalt -> 'seiten' ELSE '[]'::jsonb END), 0) AS seiten,
            COALESCE((
              SELECT sum(COALESCE(jsonb_array_length(
                       CASE WHEN jsonb_typeof(s -> 'positionen') = 'array'
                            THEN s -> 'positionen' ELSE '[]'::jsonb END), 0))
                FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(p.inhalt -> 'seiten') = 'array'
                            THEN p.inhalt -> 'seiten' ELSE '[]'::jsonb END) AS s
            ), 0) AS positionen,
            COALESCE((
              SELECT sum(COALESCE(jsonb_array_length(
                       CASE WHEN jsonb_typeof(sec -> 'bays') = 'array'
                            THEN sec -> 'bays' ELSE '[]'::jsonb END), 0))
                FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(p.inhalt -> 'zeichnung2d' -> 'sections') = 'array'
                            THEN p.inhalt -> 'zeichnung2d' -> 'sections' ELSE '[]'::jsonb END) AS sec
            ), 0) AS felder2d
       FROM cloud_projekte p
      WHERE p.erstellt_von = $1
      ORDER BY p.geaendert_am DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(grenze, 1), 500)]
  );
  return zeilen.map(z => ({
    id: String(z.id),
    titel: String(z.titel || '').trim() || 'Ohne Namen',
    erstelltAm: alsText(z.erstellt_am),
    geaendertAm: alsText(z.geaendert_am),
    geaendertVon: z.geaendert_von == null ? null : String(z.geaendert_von),
    seiten: zahl(z.seiten),
    positionen: zahl(z.positionen),
    felder2d: zahl(z.felder2d),
    istEigentuemer: String(z.owner_user_id) === userId
  }));
}

/** Benannte 2D-Speicherstände, die dieser Benutzer gesichert hat. */
export async function zeichnungenVonMitarbeiter(
  abfrage: Abfrage | null, userId: string, grenze = 100
): Promise<ZeichnungsZeile[]> {
  if (!abfrage) return [];
  const zeilen = await abfrage(
    `SELECT z.id, z.name, z.projekt_id, z.erstellt_am, z.quelle,
            COALESCE(NULLIF(p.titel, ''), z.projekt_id) AS projekt_titel
       FROM cloud_zeichnungen z
       LEFT JOIN cloud_projekte p ON p.id = z.projekt_id
      WHERE z.erstellt_von = $1
      ORDER BY z.erstellt_am DESC, z.id DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(grenze, 1), 500)]
  );
  return zeilen.map(z => ({
    id: String(z.id),
    name: String(z.name || ''),
    projektId: String(z.projekt_id),
    projektTitel: String(z.projekt_titel || ''),
    erstelltAm: alsText(z.erstellt_am),
    quelle: String(z.quelle || 'zeichnung')
  }));
}

/** Kennzahlen für den Kopf der Detailseite – eine Abfrage, drei Zahlen. */
export async function kennzahlenVonMitarbeiter(
  abfrage: Abfrage | null, userId: string
): Promise<{ projekte: number; zeichnungen: number; zuletzt: string | null }> {
  if (!abfrage) return { projekte: 0, zeichnungen: 0, zuletzt: null };
  const zeilen = await abfrage(
    `SELECT
       (SELECT count(*) FROM cloud_projekte    WHERE erstellt_von = $1) AS projekte,
       (SELECT count(*) FROM cloud_zeichnungen WHERE erstellt_von = $1) AS zeichnungen,
       (SELECT max(geaendert_am) FROM cloud_projekte
         WHERE erstellt_von = $1 OR geaendert_von = $1)                 AS zuletzt`,
    [userId]
  );
  const z = zeilen[0] || {};
  return {
    projekte: zahl(z.projekte),
    zeichnungen: zahl(z.zeichnungen),
    zuletzt: z.zuletzt ? alsText(z.zuletzt) : null
  };
}

/** Wie oft ist eine Rolle vergeben? Grundlage der Löschsperre für Rollen. */
export function rolleImEinsatz(
  mitarbeiter: { rolle: string | null; rolleVorher: string | null }[], rolleId: string
): number {
  return mitarbeiter.filter(m => m.rolle === rolleId || m.rolleVorher === rolleId).length;
}
