import { neon } from '@neondatabase/serverless';
import type { Abfrage } from './kern.ts';

/**
 * Verbindung zur Datenbank.
 *
 * Neon über HTTP: jeder Aufruf ist eine eigene Anfrage, es gibt keinen
 * Verbindungspool, der in einer Serverless-Funktion aufgebraucht werden
 * könnte. Genau dafür ist dieser Treiber gebaut.
 *
 * Fehlt DATABASE_URL, gibt es hier `null` statt eines Fehlers: die
 * Aufmaß-App und die Anmeldung laufen auch ohne Datenbank weiter, nur die
 * Einladungsfunktion meldet dann „nicht eingerichtet". So lässt sich die
 * Vorschau auf Vercel bauen, bevor die Datenbank angelegt ist.
 */
let zwischenspeicher: Abfrage | null | undefined;

export function abfrageHolen(): Abfrage | null {
  if (zwischenspeicher !== undefined) return zwischenspeicher;

  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    zwischenspeicher = null;
    return null;
  }

  const sql = neon(url);
  zwischenspeicher = async (text: string, werte: unknown[] = []) =>
    (await sql.query(text, werte)) as Record<string, unknown>[];
  return zwischenspeicher;
}

/** Der Pepper für die Code-Hashes. Ohne ihn wird nicht gearbeitet. */
export function pepperHolen(): string | null {
  const pepper = process.env.EINLADUNG_PEPPER;
  return pepper && pepper.length >= 16 ? pepper : null;
}

export function einladungenBereit(): boolean {
  return abfrageHolen() !== null && pepperHolen() !== null;
}
