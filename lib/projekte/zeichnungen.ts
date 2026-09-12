import type { Abfrage } from '../einladungen/kern.ts';

export class ZeichnungsFehler extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function pruefeZeichnung(daten: unknown): Record<string, unknown> {
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) throw new ZeichnungsFehler(400, 'Ungültige Zeichnungsdatei.');
  const z = daten as Record<string, unknown>;
  if (!Array.isArray(z.sections) || z.sections.length > 2000 ||
      typeof z.depth !== 'number' || !Number.isFinite(z.depth) || z.depth <= 0 ||
      z.sections.some((s: any) => !s || !Array.isArray(s.bays) || !['N','E','S','W'].includes(s.dir) || !Number.isFinite(s.x0) || !Number.isFinite(s.y0) ||
        s.bays.some((b: any) => !b || typeof b.len !== 'number' || !Number.isFinite(b.len) || b.len <= 0))) {
    throw new ZeichnungsFehler(400, 'Die Datei enthält keine gültige AufmaßX-2D-Zeichnung.');
  }
  for (const key of ['abschnitte','bordbrettLinien','bordbrettKanten','bordbretter']) {
    if (z[key] != null && !Array.isArray(z[key])) throw new ZeichnungsFehler(400, 'Ungültige Zeichnungsstruktur.');
  }
  if (Buffer.byteLength(JSON.stringify(z), 'utf8') > 1_500_000) throw new ZeichnungsFehler(413, 'Zeichnung zu groß (maximal 1,5 MB).');
  return z;
}

const zugriff = `EXISTS (SELECT 1 FROM cloud_projekte p WHERE p.id = $1 AND
  ($3::boolean OR p.owner_user_id = $2 OR EXISTS (SELECT 1 FROM cloud_projekt_freigaben f
   WHERE f.projekt_id = p.id AND f.user_id = $2`;

export async function zeichnungenLesen(db: Abfrage, projektId: string, userId: string, admin: boolean, id?: string) {
  const erlaubt = await db(`SELECT id FROM cloud_projekte WHERE id = $1 AND ${zugriff})))`, [projektId, userId, admin]);
  if (!erlaubt.length) throw new ZeichnungsFehler(404, 'Projekt nicht gefunden oder nicht freigegeben.');
  const rows = await db(`SELECT id, name, erstellt_am, quelle, dateiname${id ? ', inhalt' : ''}
    FROM cloud_zeichnungen WHERE projekt_id = $1 AND ${zugriff})))
    ${id ? 'AND id = $4' : ''} ORDER BY erstellt_am DESC, id DESC`, id ? [projektId,userId,admin,id] : [projektId,userId,admin]);
  if (id && !rows.length) throw new ZeichnungsFehler(404, 'Zeichnung nicht gefunden.');
  return rows;
}

export async function zeichnungAnlegen(db: Abfrage, projektId: string, userId: string, admin: boolean, body: any) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120 ||
      typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{10,120}$/.test(body.id) ||
      !['zeichnung','upload'].includes(body.quelle)) throw new ZeichnungsFehler(400, 'Name oder Zeichnungsangaben sind ungültig.');
  const inhalt = pruefeZeichnung(body.inhalt);
  const name = body.name.trim();
  const dateiname = typeof body.dateiname === 'string' ? body.dateiname.slice(0,240) : null;
  // Jede Aktion ist append-only. Eine Wiederholung mit derselben ID ist idempotent.
  const rows = await db(`INSERT INTO cloud_zeichnungen (id, projekt_id, name, inhalt, erstellt_von, quelle, dateiname)
    SELECT $4, $1, $5, $6::jsonb, $2, $7, $8 WHERE ${zugriff} AND f.rolle = 'bearbeiten')))
    ON CONFLICT (id) DO NOTHING RETURNING id, name, erstellt_am, quelle, dateiname`,
    [projektId,userId,admin,body.id,name,JSON.stringify(inhalt),body.quelle,dateiname]);
  if (rows.length) return rows[0];
  const existing = await db(`SELECT id, name, erstellt_am, quelle, dateiname FROM cloud_zeichnungen
    WHERE id = $4 AND projekt_id = $1 AND name = $5 AND inhalt = $6::jsonb AND ${zugriff} AND f.rolle = 'bearbeiten')))`,
    [projektId,userId,admin,body.id,name,JSON.stringify(inhalt)]);
  if (existing.length) return existing[0];
  throw new ZeichnungsFehler(409, 'Speichern nicht möglich. Projekt zuerst synchronisieren und Bearbeitungsrecht prüfen.');
}
