import type { Abfrage } from '../einladungen/kern.ts';
import {
  ADMIN_ROLLE, ALLE_RECHTE, SYSTEM_ROLLEN, rechteBereinigen, rollenIdGueltig,
  rollenZusammenfuehren, type Rolle
} from '../rollen.ts';

/**
 * Frei definierbare Rollen – die Datenbankseite.
 *
 * Die Fachlogik (welche Rechte es gibt, was eine Systemrolle ist) steht in
 * lib/rollen.ts und weiß nichts von SQL. Hier steht nur, wie Rollen gelesen
 * und geschrieben werden – gegen dieselben Anweisungen, die später auf Neon
 * laufen (geprüft in tests/r19-rollen-rechte.mjs gegen ein echtes Postgres
 * im Speicher).
 *
 * Ohne Datenbank bleibt die Anwendung arbeitsfähig: Dann gelten die beiden
 * mitgelieferten Rollen aus lib/rollen.ts. Das ist kein Notbehelf, sondern
 * die Bedingung dafür, dass eine Vorschau ohne DATABASE_URL startet – so
 * hält es die Anwendung schon bei den Einladungscodes.
 */

export class RollenFehler extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function zeileZuRolle(z: Record<string, unknown>): Rolle {
  const roh = z.rechte;
  const rechte = Array.isArray(roh)
    ? roh
    : typeof roh === 'string'
      ? (JSON.parse(roh) as unknown[])
      : [];
  return {
    id: String(z.id),
    name: String(z.name ?? ''),
    beschreibung: z.beschreibung == null ? '' : String(z.beschreibung),
    rechte: rechte.includes(ALLE_RECHTE) ? [ALLE_RECHTE] : rechteBereinigen(rechte),
    system: z.system === true,
    sortierung: Number(z.sortierung ?? 100)
  };
}

/** Alle Rollen: die mitgelieferten, überlagert von denen aus der Datenbank. */
export async function rollenLaden(abfrage: Abfrage | null): Promise<Rolle[]> {
  if (!abfrage) return rollenZusammenfuehren([]);
  const zeilen = await abfrage(
    'SELECT id, name, beschreibung, rechte, system, sortierung FROM rollen ORDER BY sortierung, name'
  );
  return rollenZusammenfuehren(zeilen.map(zeileZuRolle));
}

export async function rolleHolen(abfrage: Abfrage | null, id: string): Promise<Rolle | null> {
  const alle = await rollenLaden(abfrage);
  return alle.find(r => r.id === id) ?? null;
}

/**
 * Rolle anlegen oder ändern.
 *
 * Zwei Regeln, die nicht verhandelbar sind und deshalb hier stehen und nicht
 * in der Oberfläche:
 *
 *   • Die Rolle „admin" behält immer alle Rechte. Wer sie beschneiden könnte,
 *     könnte den Betrieb aus seiner eigenen Verwaltung aussperren – ohne Weg
 *     zurück, denn zum Reparieren bräuchte er genau dieses Recht.
 *   • Eine Systemrolle bleibt eine Systemrolle. Der Name darf sich ändern,
 *     die Kennung nicht – an ihr hängen die Benutzer.
 */
export async function rolleSpeichern(
  abfrage: Abfrage | null,
  eingabe: { id: string; name: string; beschreibung?: string; rechte: unknown; sortierung?: number },
  geaendertVon: string
): Promise<Rolle> {
  if (!abfrage) throw new RollenFehler(503, 'Eigene Rollen brauchen die Datenbank (DATABASE_URL).');
  if (!rollenIdGueltig(eingabe.id)) {
    throw new RollenFehler(400, 'Die Kennung der Rolle ist ungültig (Kleinbuchstaben, Ziffern, Bindestrich).');
  }
  const name = String(eingabe.name || '').trim().slice(0, 60);
  if (!name) throw new RollenFehler(400, 'Die Rolle braucht einen Namen.');

  const system = SYSTEM_ROLLEN.find(r => r.id === eingabe.id);
  const rechte = eingabe.id === ADMIN_ROLLE ? [ALLE_RECHTE] : rechteBereinigen(eingabe.rechte);
  const sortierung = Number.isFinite(Number(eingabe.sortierung))
    ? Math.min(Math.max(Math.trunc(Number(eingabe.sortierung)), 1), 999)
    : (system?.sortierung ?? 100);

  const zeilen = await abfrage(
    `INSERT INTO rollen (id, name, beschreibung, rechte, system, sortierung, geaendert_von)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           beschreibung = EXCLUDED.beschreibung,
           rechte = EXCLUDED.rechte,
           sortierung = EXCLUDED.sortierung,
           geaendert_am = now(),
           geaendert_von = EXCLUDED.geaendert_von
     RETURNING id, name, beschreibung, rechte, system, sortierung`,
    [
      eingabe.id, name, String(eingabe.beschreibung || '').trim().slice(0, 240),
      JSON.stringify(rechte), !!system, sortierung, geaendertVon
    ]
  );
  return zeileZuRolle(zeilen[0]);
}

/**
 * Rolle löschen.
 *
 * Systemrollen bleiben. Eine Rolle, die noch jemand trägt, wird ebenfalls
 * nicht gelöscht – sonst stünden Mitarbeiter plötzlich ohne Zuordnung da und
 * kämen nicht mehr hinein. Wer die Rolle loswerden will, weist ihren
 * Trägern zuerst eine andere zu; die Oberfläche sagt genau das.
 */
export async function rolleLoeschen(
  abfrage: Abfrage | null, id: string, imEinsatz: number
): Promise<void> {
  if (!abfrage) throw new RollenFehler(503, 'Eigene Rollen brauchen die Datenbank (DATABASE_URL).');
  if (SYSTEM_ROLLEN.some(r => r.id === id)) {
    throw new RollenFehler(400, 'Mitgelieferte Rollen lassen sich nicht löschen.');
  }
  if (imEinsatz > 0) {
    throw new RollenFehler(409,
      `Diese Rolle ist noch ${imEinsatz} Mitarbeiter${imEinsatz === 1 ? ' ' : 'n '}zugewiesen. `
      + 'Bitte zuerst eine andere Rolle zuweisen.');
  }
  await abfrage('DELETE FROM rollen WHERE id = $1 AND system = false', [id]);
}
