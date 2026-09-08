import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Einladungscodes: Erzeugung, Schreibweise, Hash.
 *
 * Der Code IST das Geheimnis – wer ihn hat, darf ein Konto anlegen. Er wird
 * deshalb kryptografisch zufällig erzeugt und nie im Klartext gespeichert.
 */

// 32 Zeichen ohne I, O, 0, 1 – auf einem Zettel oder in WhatsApp darf sich
// niemand zwischen „O" und „0" entscheiden müssen.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GRUPPEN = 3;
const GRUPPENLAENGE = 4;

/** Länge in Zeichen ohne Trennstriche. 12 Zeichen à 5 Bit = 60 Bit Entropie. */
export const CODE_LAENGE = GRUPPEN * GRUPPENLAENGE;

/**
 * Neuer Code, Format `X7K4-P9QM-2L8F`.
 *
 * `randomInt` stammt aus dem Zufallsgenerator des Betriebssystems und ist
 * gleichverteilt (kein Modulo-Bias). `Math.random` wäre hier ein Fehler.
 */
export function codeErzeugen(): string {
  const zeichen: string[] = [];
  for (let i = 0; i < CODE_LAENGE; i++) {
    zeichen.push(ALPHABET[randomInt(ALPHABET.length)]);
  }
  const gruppen: string[] = [];
  for (let i = 0; i < GRUPPEN; i++) {
    gruppen.push(zeichen.slice(i * GRUPPENLAENGE, (i + 1) * GRUPPENLAENGE).join(''));
  }
  return gruppen.join('-');
}

/**
 * Schreibweise vereinheitlichen: Groß-/Kleinschreibung, Leerzeichen und
 * Trennstriche sind egal. Wer den Code abtippt, soll nicht an der Form
 * scheitern.
 */
export function codeNormalisieren(eingabe: string): string {
  return (eingabe || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Sieht die Eingabe überhaupt wie ein Code aus? Spart der Datenbank die Arbeit. */
export function codeFormGueltig(normalisiert: string): boolean {
  return normalisiert.length === CODE_LAENGE &&
    [...normalisiert].every(z => ALPHABET.includes(z));
}

/** Anzeigeform mit Trennstrichen – nur für die einmalige Anzeige nach dem Anlegen. */
export function codeFormatieren(normalisiert: string): string {
  return (normalisiert.match(/.{1,4}/g) || []).join('-');
}

export function codePraefix(normalisiert: string): string {
  return normalisiert.slice(0, GRUPPENLAENGE);
}

/**
 * HMAC-SHA256 mit serverseitigem Pepper.
 *
 * Warum kein bcrypt/argon2: der Code muss NACHGESCHLAGEN werden. Ein Hash mit
 * Zufallssalz erzwänge, jede Zeile der Tabelle einzeln zu prüfen. Bei 60 Bit
 * Entropie ist ein gekeytes, deterministisches Verfahren richtig – dasselbe
 * Vorgehen wie bei API-Schlüsseln: das Geheimnis ist der Code, nicht seine
 * Ableitung. Gegen Raten hilft die Entropie, nicht die Rechenzeit.
 */
export function codeHash(normalisiert: string, pepper: string): string {
  if (!pepper) throw new Error('EINLADUNG_PEPPER fehlt – ohne Pepper wird nichts gehasht.');
  return createHmac('sha256', pepper).update(normalisiert).digest('hex');
}

/** Vergleich ohne Zeitunterschied – für Vergleiche außerhalb der Datenbank. */
export function hashGleich(a: string, b: string): boolean {
  const pa = Buffer.from(a, 'utf8');
  const pb = Buffer.from(b, 'utf8');
  return pa.length === pb.length && timingSafeEqual(pa, pb);
}
