import { abfrageHolen } from '@/lib/einladungen/db';
import type { Abfrage } from '@/lib/einladungen/kern';

export type CloudRolle = 'lesen' | 'bearbeiten';
export type CloudProjekt = {
  id: string;
  revision: number;
  ownerUserId: string;
  rolle: 'owner' | 'admin' | CloudRolle;
  inhalt: Record<string, unknown>;
};
export type CloudOrdner = {
  id: string;
  revision: number;
  inhalt: Record<string, unknown>;
};

export class CloudFehler extends Error {
  constructor(public status: number, message: string, public aktuell?: CloudProjekt | CloudOrdner) {
    super(message);
  }
}

function db(): Abfrage {
  const verbindung = abfrageHolen();
  if (!verbindung) throw new CloudFehler(503, 'Der Cloud-Speicher ist noch nicht eingerichtet.');
  return verbindung;
}

function textId(wert: unknown, feld: string): string {
  if (typeof wert !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(wert)) {
    throw new CloudFehler(400, `${feld} ist ungültig.`);
  }
  return wert;
}

function objekt(wert: unknown, feld: string): Record<string, unknown> {
  if (!wert || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new CloudFehler(400, `${feld} ist ungültig.`);
  }
  const serialisiert = JSON.stringify(wert);
  if (serialisiert.length > 2_000_000) throw new CloudFehler(413, 'Das Projekt ist für die Cloud zu groß.');
  return wert as Record<string, unknown>;
}

function json(wert: unknown): Record<string, unknown> {
  if (typeof wert === 'string') return JSON.parse(wert) as Record<string, unknown>;
  return objekt(wert, 'Cloud-Daten');
}

function zahl(wert: unknown): number {
  const n = Number(wert);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function zeileZuProjekt(zeile: Record<string, unknown>, userId: string, istAdmin: boolean): CloudProjekt {
  const owner = String(zeile.owner_user_id);
  const freigabe = zeile.freigabe === 'lesen' || zeile.freigabe === 'bearbeiten'
    ? zeile.freigabe : null;
  return {
    id: String(zeile.id), revision: zahl(zeile.revision), ownerUserId: owner,
    rolle: istAdmin ? 'admin' : owner === userId ? 'owner' : freigabe!, inhalt: json(zeile.inhalt)
  };
}

function zeileZuOrdner(zeile: Record<string, unknown>): CloudOrdner {
  return { id: String(zeile.id), revision: zahl(zeile.revision), inhalt: json(zeile.inhalt) };
}

async function projektHolen(id: string, userId: string, istAdmin: boolean): Promise<CloudProjekt | null> {
  const zeilen = await db()(
    `SELECT p.id, p.owner_user_id, p.inhalt, p.revision, f.rolle AS freigabe
       FROM cloud_projekte p
       LEFT JOIN cloud_projekt_freigaben f ON f.projekt_id = p.id AND f.user_id = $2
      WHERE p.id = $1
        AND ($3::boolean OR p.owner_user_id = $2 OR f.user_id IS NOT NULL)`,
    [id, userId, istAdmin]
  );
  return zeilen[0] ? zeileZuProjekt(zeilen[0], userId, istAdmin) : null;
}

export async function arbeitsbereichAuflisten(userId: string, istAdmin: boolean) {
  const verbindung = db();
  const [projektZeilen, ordnerZeilen] = await Promise.all([
    verbindung(
      `SELECT p.id, p.owner_user_id, p.inhalt, p.revision, f.rolle AS freigabe
         FROM cloud_projekte p
         LEFT JOIN cloud_projekt_freigaben f ON f.projekt_id = p.id AND f.user_id = $1
        WHERE $2::boolean OR p.owner_user_id = $1 OR f.user_id IS NOT NULL
        ORDER BY p.geaendert_am DESC
        LIMIT 500`, [userId, istAdmin]
    ),
    verbindung(
      `SELECT id, inhalt, revision FROM cloud_ordner
        WHERE owner_user_id = $1 ORDER BY geaendert_am DESC LIMIT 200`, [userId]
    )
  ]);
  return {
    projects: projektZeilen.map(z => zeileZuProjekt(z, userId, istAdmin)),
    folders: ordnerZeilen.map(zeileZuOrdner)
  };
}

export async function projektSpeichern(
  userId: string, istAdmin: boolean, eingabe: { id: unknown; inhalt: unknown; revision?: unknown }
): Promise<CloudProjekt> {
  const id = textId(eingabe.id, 'Projekt-ID');
  const inhalt = objekt(eingabe.inhalt, 'Projekt');
  const titel = String(inhalt.name ?? '').trim().slice(0, 240);
  const vorher = await projektHolen(id, userId, istAdmin);
  const verbindung = db();

  if (!vorher) {
    const neu = await verbindung(
      `INSERT INTO cloud_projekte (id, owner_user_id, titel, inhalt)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, owner_user_id, inhalt, revision, NULL::text AS freigabe`,
      [id, userId, titel, JSON.stringify(inhalt)]
    );
    if (neu[0]) return zeileZuProjekt(neu[0], userId, istAdmin);
    // Die ID gehört inzwischen einem anderen Konto; kein Projekt übernehmen.
    const inzwischen = await projektHolen(id, userId, istAdmin);
    if (!inzwischen) throw new CloudFehler(403, 'Für dieses Projekt fehlt die Berechtigung.');
    throw new CloudFehler(409, 'Das Projekt wurde inzwischen angelegt.', inzwischen);
  }

  if (vorher.rolle === 'lesen') throw new CloudFehler(403, 'Dieses Projekt ist nur lesbar freigegeben.');
  const revision = Number(eingabe.revision);
  if (!Number.isInteger(revision) || revision !== vorher.revision) {
    throw new CloudFehler(409, 'Das Projekt wurde auf einem anderen Gerät geändert.', vorher);
  }
  const zeilen = await verbindung(
    `UPDATE cloud_projekte p SET titel = $1, inhalt = $2::jsonb,
       revision = p.revision + 1, geaendert_am = now()
      WHERE p.id = $3 AND p.revision = $4
        AND ($6::boolean OR p.owner_user_id = $5 OR EXISTS (
          SELECT 1 FROM cloud_projekt_freigaben f
           WHERE f.projekt_id = p.id AND f.user_id = $5 AND f.rolle = 'bearbeiten'
        ))
      RETURNING p.id, p.owner_user_id, p.inhalt, p.revision,
        (SELECT rolle FROM cloud_projekt_freigaben WHERE projekt_id = p.id AND user_id = $5) AS freigabe`,
    [titel, JSON.stringify(inhalt), id, revision, userId, istAdmin]
  );
  if (!zeilen[0]) {
    const aktuell = await projektHolen(id, userId, istAdmin);
    throw new CloudFehler(409, 'Das Projekt wurde gleichzeitig geändert.', aktuell ?? undefined);
  }
  return zeileZuProjekt(zeilen[0], userId, istAdmin);
}

export async function projektLoeschen(userId: string, istAdmin: boolean, idWert: string, revisionWert: unknown) {
  const id = textId(idWert, 'Projekt-ID');
  const vorher = await projektHolen(id, userId, istAdmin);
  if (!vorher) throw new CloudFehler(404, 'Projekt nicht gefunden.');
  if (!istAdmin && vorher.ownerUserId !== userId) throw new CloudFehler(403, 'Nur der Eigentümer darf das Projekt löschen.');
  const revision = Number(revisionWert);
  if (!Number.isInteger(revision) || revision !== vorher.revision) {
    throw new CloudFehler(409, 'Das Projekt wurde auf einem anderen Gerät geändert.', vorher);
  }
  const zeilen = await db()('DELETE FROM cloud_projekte WHERE id = $1 AND revision = $2 RETURNING id', [id, revision]);
  if (!zeilen[0]) throw new CloudFehler(409, 'Das Projekt wurde gleichzeitig geändert.');
}

export async function ordnerSpeichern(
  userId: string, eingabe: { id: unknown; inhalt: unknown; revision?: unknown }
): Promise<CloudOrdner> {
  const id = textId(eingabe.id, 'Ordner-ID');
  const inhalt = objekt(eingabe.inhalt, 'Ordner');
  const verbindung = db();
  const vorher = await verbindung(
    'SELECT id, inhalt, revision FROM cloud_ordner WHERE id = $1 AND owner_user_id = $2', [id, userId]
  );
  if (!vorher[0]) {
    const neu = await verbindung(
      `INSERT INTO cloud_ordner (id, owner_user_id, inhalt) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id, inhalt, revision`, [id, userId, JSON.stringify(inhalt)]
    );
    if (neu[0]) return zeileZuOrdner(neu[0]);
    throw new CloudFehler(409, 'Der Ordner wurde inzwischen angelegt.');
  }
  const revision = Number(eingabe.revision);
  if (!Number.isInteger(revision) || revision !== zahl(vorher[0].revision)) {
    throw new CloudFehler(409, 'Der Ordner wurde auf einem anderen Gerät geändert.', zeileZuOrdner(vorher[0]));
  }
  const neu = await verbindung(
    `UPDATE cloud_ordner SET inhalt = $1::jsonb, revision = revision + 1, geaendert_am = now()
      WHERE id = $2 AND owner_user_id = $3 AND revision = $4 RETURNING id, inhalt, revision`,
    [JSON.stringify(inhalt), id, userId, revision]
  );
  if (!neu[0]) throw new CloudFehler(409, 'Der Ordner wurde gleichzeitig geändert.');
  return zeileZuOrdner(neu[0]);
}

export async function ordnerLoeschen(userId: string, idWert: string, revisionWert: unknown) {
  const id = textId(idWert, 'Ordner-ID');
  const revision = Number(revisionWert);
  const zeilen = await db()(
    'DELETE FROM cloud_ordner WHERE id = $1 AND owner_user_id = $2 AND revision = $3 RETURNING id',
    [id, userId, revision]
  );
  if (!zeilen[0]) throw new CloudFehler(409, 'Der Ordner wurde auf einem anderen Gerät geändert.');
}

export async function freigabeSetzen(
  userId: string, istAdmin: boolean, projektId: string, zielUserId: string, rolle: unknown
) {
  const id = textId(projektId, 'Projekt-ID');
  const ziel = textId(zielUserId, 'Benutzer-ID');
  if (rolle !== 'lesen' && rolle !== 'bearbeiten') throw new CloudFehler(400, 'Freigaberolle ist ungültig.');
  const projekt = await projektHolen(id, userId, istAdmin);
  if (!projekt) throw new CloudFehler(404, 'Projekt nicht gefunden.');
  if (!istAdmin && projekt.ownerUserId !== userId) throw new CloudFehler(403, 'Nur der Eigentümer darf freigeben.');
  if (ziel === projekt.ownerUserId) throw new CloudFehler(400, 'Der Eigentümer hat bereits Zugriff.');
  await db()(
    `INSERT INTO cloud_projekt_freigaben (projekt_id, user_id, rolle) VALUES ($1, $2, $3)
     ON CONFLICT (projekt_id, user_id) DO UPDATE SET rolle = EXCLUDED.rolle`, [id, ziel, rolle]
  );
}
