import { clerkClient } from '@clerk/nextjs/server';
import { STATUS_DEAKTIVIERT } from '../zugang';
import { STANDARD_ROLLE, rollenIdGueltig } from '../rollen';

/**
 * Das Mitarbeiterverzeichnis.
 *
 * Die Benutzer selbst liegen bei Clerk – und bleiben dort. Es gibt bewusst
 * KEINE gespiegelte Benutzertabelle in Postgres: Name, E-Mail,
 * Registrierungsdatum und letzter Login kommen aus dem Anmeldedienst, der
 * sie ohnehin führt. Eine zweite Kopie wäre eine zweite Wahrheit, die
 * auseinanderlaufen kann – und genau das will man bei Zugängen nicht.
 *
 * Was AufmaßX selbst führt, steht in Clerks `publicMetadata`:
 *
 *   rolle        Kennung der Rolle (siehe lib/rollen.ts)
 *   status       fehlt = aktiv, 'deaktiviert' = gesperrt
 *   rolleVorher  die Rolle vor dem Deaktivieren, damit das Freischalten
 *                sie zurückgeben kann
 *
 * Diese Datei ist die EINZIGE Stelle, an der Clerk-Benutzer geschrieben
 * werden. Wer den Ablauf ändern will, ändert ihn hier.
 */

export type Mitarbeiter = {
  id: string;
  name: string;
  email: string;
  rolle: string | null;
  /** Rolle vor dem Deaktivieren – nur gesetzt, wenn der Zugang gesperrt ist. */
  rolleVorher: string | null;
  aktiv: boolean;
  /** Clerk-seitige Sperre; sie verhindert das Anmelden schon vor unserer Prüfung. */
  gesperrt: boolean;
  registriertAm: string;
  letzterLogin: string | null;
  bildUrl: string | null;
};

export class MitarbeiterFehler extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ClerkUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  banned: boolean;
  createdAt: number;
  lastSignInAt: number | null;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
  publicMetadata: Record<string, unknown>;
};

function alsIso(wert: number | null | undefined): string | null {
  return wert ? new Date(wert).toISOString() : null;
}

function zuMitarbeiter(user: ClerkUser): Mitarbeiter {
  const meta = user.publicMetadata || {};
  const primaer = user.emailAddresses.find(a => a.id === user.primaryEmailAddressId)
    ?? user.emailAddresses[0];
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || user.username
    || primaer?.emailAddress
    || user.id;
  const rolle = rollenIdGueltig(meta.rolle) ? meta.rolle : null;
  const deaktiviert = meta.status === STATUS_DEAKTIVIERT;
  return {
    id: user.id,
    name,
    email: primaer?.emailAddress ?? '',
    rolle,
    rolleVorher: rollenIdGueltig(meta.rolleVorher) ? meta.rolleVorher : null,
    aktiv: !deaktiviert && !user.banned,
    gesperrt: !!user.banned,
    registriertAm: alsIso(user.createdAt) ?? '',
    letzterLogin: alsIso(user.lastSignInAt),
    bildUrl: user.imageUrl || null
  };
}

/**
 * Alle Mitarbeiter, neueste zuerst.
 *
 * 200 ist die Obergrenze einer Clerk-Seite und für einen Gerüstbaubetrieb
 * reichlich; gibt es mehr, wird geblättert. Die Liste bleibt vollständig
 * sortierbar, weil sie am Stück kommt.
 */
export async function mitarbeiterListe(grenze = 200): Promise<Mitarbeiter[]> {
  const client = await clerkClient();
  const ergebnis = await client.users.getUserList({
    limit: Math.min(Math.max(grenze, 1), 500),
    orderBy: '-created_at'
  });
  return (ergebnis.data as unknown as ClerkUser[]).map(zuMitarbeiter);
}

export async function mitarbeiterHolen(userId: string): Promise<Mitarbeiter | null> {
  const client = await clerkClient();
  try {
    const user = await client.users.getUser(userId);
    return zuMitarbeiter(user as unknown as ClerkUser);
  } catch {
    return null;
  }
}

/** Rolle zuweisen. Eine leere Kennung ist kein gültiger Zustand. */
export async function rolleZuweisen(userId: string, rolleId: string): Promise<void> {
  if (!rollenIdGueltig(rolleId)) throw new MitarbeiterFehler(400, 'Diese Rolle gibt es nicht.');
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if ((user.publicMetadata || {}).status === STATUS_DEAKTIVIERT) {
    throw new MitarbeiterFehler(409,
      'Dieser Zugang ist deaktiviert. Bitte zuerst wieder freischalten.');
  }
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...(user.publicMetadata || {}), rolle: rolleId }
  });
}

/**
 * Zugang deaktivieren – der „Soft Delete".
 *
 * Gelöscht wird NICHTS. Projekte, Aufmaße und Zeichnungen gehören dem
 * Betrieb und bleiben, wo sie sind; auch die Herkunftsangabe
 * (`erstellt_von`) bleibt stehen, sonst wäre hinterher nicht mehr
 * nachvollziehbar, wer was aufgemessen hat.
 *
 * Gesperrt wird doppelt, und das mit Absicht:
 *
 *   1. Die Rolle wird entzogen (und in `rolleVorher` gemerkt). Damit greift
 *      die Sperre in lib/zugang.ts beim nächsten Aufruf – unabhängig davon,
 *      ob Clerk erreichbar ist.
 *   2. Das Konto wird bei Clerk gesperrt. Damit endet die laufende Sitzung
 *      sofort, statt bis zur nächsten Token-Erneuerung weiterzulaufen.
 *
 * Schritt 2 darf scheitern, ohne den Vorgang scheitern zu lassen: Schritt 1
 * allein sperrt bereits zuverlässig aus.
 */
export async function zugangDeaktivieren(userId: string): Promise<void> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata || {};
  const vorher = rollenIdGueltig(meta.rolle) ? meta.rolle
    : rollenIdGueltig(meta.rolleVorher) ? meta.rolleVorher
    : STANDARD_ROLLE;
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...meta, status: STATUS_DEAKTIVIERT, rolle: null, rolleVorher: vorher }
  });
  try {
    await client.users.banUser(userId);
  } catch {
    // Siehe oben: Die entzogene Rolle sperrt bereits.
  }
}

/** Zugang wieder freischalten – mit der Rolle von vorher. */
export async function zugangAktivieren(userId: string, rolleId?: string): Promise<void> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata || {};
  const ziel = rollenIdGueltig(rolleId) ? rolleId
    : rollenIdGueltig(meta.rolleVorher) ? meta.rolleVorher
    : STANDARD_ROLLE;
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...meta, status: null, rolle: ziel, rolleVorher: null }
  });
  try {
    await client.users.unbanUser(userId);
  } catch {
    // Ein nie gesperrtes Konto lässt sich nicht entsperren – kein Fehler.
  }
}
