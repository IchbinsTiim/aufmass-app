/**
 * Rollen und Rechte – der eine Ort, an dem steht, WER WAS DARF.
 *
 * Bis Runde 18 gab es genau zwei feste Rollen („admin", „mitarbeiter") und
 * keine Rechtelogik: Was ein Admin darf, stand verstreut als
 * `rolle === 'admin'` in Seiten und Routen. Jede neue Rolle hätte jede dieser
 * Stellen angefasst.
 *
 * Jetzt gilt umgekehrt:
 *
 *   • Ein RECHT ist ein Schlüssel aus RECHTE – „mitarbeiter.verwalten",
 *     „projekte.loeschen" …  Ein neues Recht ist ein Eintrag in dieser Liste
 *     und sonst nichts; es taucht automatisch in der Rollenverwaltung auf.
 *   • Eine ROLLE ist ein Name plus eine Menge solcher Schlüssel. Die beiden
 *     mitgelieferten Rollen stehen hier im Code (damit die Anwendung auch
 *     ohne Datenbank arbeitet), alle weiteren legt der Betrieb selbst an
 *     (Tabelle `rollen`, siehe lib/mitarbeiter/rollen-db.ts).
 *   • Die Rolle eines Benutzers steht weiterhin in Clerks
 *     `publicMetadata.rolle` – neu ist nur, dass dort jetzt auch die Kennung
 *     einer selbst angelegten Rolle stehen darf.
 *
 * Diese Datei ist bewusst frei von Next.js, Clerk und Datenbank: Sie lässt
 * sich damit unmittelbar prüfen (tests/r19-rollen-rechte.mjs).
 */

export type Bereich = {
  key: string;
  label: string;
};

export type Recht = {
  key: string;
  label: string;
  bereich: string;
  /** Kurze Erklärung für die Rollenverwaltung – was geht damit, was nicht. */
  hinweis: string;
};

export type Rolle = {
  id: string;
  name: string;
  beschreibung: string;
  /** Rechte-Schlüssel, oder ALLE_RECHTE für „darf alles". */
  rechte: string[];
  /** Mitgeliefert: umbenennbar, aber nicht löschbar. */
  system: boolean;
  sortierung: number;
};

/** Platzhalter in `rechte`: diese Rolle darf alles – auch künftige Rechte. */
export const ALLE_RECHTE = '*';

export const BEREICHE: Bereich[] = [
  { key: 'mitarbeiter', label: 'Mitarbeiter & Rollen' },
  { key: 'projekte', label: 'Projekte' },
  { key: 'aufmasse', label: 'Aufmaße' },
  { key: 'zeichnungen', label: '2D-Zeichnungen & PDF' },
  { key: 'daten', label: 'Daten anderer Mitarbeiter' }
];

/**
 * Der Rechtekatalog.
 *
 * Reihenfolge = Reihenfolge in der Rollenverwaltung. Ein Schlüssel wird nie
 * umbenannt: Er steht in der Datenbank in den angelegten Rollen. Kommt ein
 * Recht dazu, haben bestehende Rollen es schlicht nicht – bis es jemand
 * anhakt. Das ist die sichere Richtung.
 */
export const RECHTE: Recht[] = [
  { key: 'mitarbeiter.ansehen', bereich: 'mitarbeiter', label: 'Mitarbeiter ansehen',
    hinweis: 'Öffnet die Mitarbeiterübersicht und die Detailseiten.' },
  { key: 'mitarbeiter.verwalten', bereich: 'mitarbeiter', label: 'Mitarbeiter verwalten',
    hinweis: 'Rolle eines Mitarbeiters ändern und Einladungen ausstellen.' },
  { key: 'mitarbeiter.loeschen', bereich: 'mitarbeiter', label: 'Mitarbeiter löschen',
    hinweis: 'Zugänge deaktivieren und wieder freischalten. Die Daten bleiben dem Betrieb.' },
  { key: 'rollen.verwalten', bereich: 'mitarbeiter', label: 'Rollen verwalten',
    hinweis: 'Eigene Rollen anlegen, umbenennen und ihre Rechte festlegen.' },

  { key: 'projekte.erstellen', bereich: 'projekte', label: 'Projekte erstellen',
    hinweis: 'Neue Projekte anlegen und in die Cloud sichern.' },
  { key: 'projekte.bearbeiten', bereich: 'projekte', label: 'Projekte bearbeiten',
    hinweis: 'Bestehende Projekte ändern und speichern.' },
  { key: 'projekte.loeschen', bereich: 'projekte', label: 'Projekte löschen',
    hinweis: 'Projekte endgültig aus der Cloud entfernen.' },

  { key: 'aufmasse.erstellen', bereich: 'aufmasse', label: 'Aufmaße erstellen',
    hinweis: 'Positionen und Seiten in einem Projekt neu erfassen.' },
  { key: 'aufmasse.bearbeiten', bereich: 'aufmasse', label: 'Aufmaße bearbeiten',
    hinweis: 'Erfasste Mengen und Positionen ändern.' },
  { key: 'aufmasse.loeschen', bereich: 'aufmasse', label: 'Aufmaße löschen',
    hinweis: 'Erfasste Positionen wieder entfernen.' },

  { key: 'zeichnungen.erstellen', bereich: 'zeichnungen', label: '2D-Zeichnungen erstellen',
    hinweis: 'Im 2D-Aufmaß zeichnen und Stände benannt speichern.' },
  { key: 'pdf.exportieren', bereich: 'zeichnungen', label: 'PDFs exportieren',
    hinweis: 'Angebots- und Aufmaß-PDF erzeugen.' },

  { key: 'fremde.daten.ansehen', bereich: 'daten', label: 'Daten anderer Mitarbeiter ansehen',
    hinweis: 'Sieht alle Projekte des Betriebs, nicht nur die eigenen und freigegebenen.' }
];

export const RECHT_KEYS: string[] = RECHTE.map(r => r.key);

export const ADMIN_ROLLE = 'admin';
export const STANDARD_ROLLE = 'mitarbeiter';

/**
 * Die beiden mitgelieferten Rollen.
 *
 * Sie stehen im Code und nicht nur in der Datenbank: Ohne sie käme bei
 * fehlender oder frisch aufgesetzter Datenbank niemand mehr in die
 * Anwendung – auch der Administrator nicht. Umbenennen und (beim
 * Mitarbeiter) die Rechte ändern geht trotzdem, die Datenbankfassung hat
 * dann Vorrang; nur löschen lassen sie sich nicht.
 */
export const SYSTEM_ROLLEN: Rolle[] = [
  {
    id: ADMIN_ROLLE,
    name: 'Administrator',
    beschreibung: 'Darf alles – einschließlich aller künftigen Rechte.',
    rechte: [ALLE_RECHTE],
    system: true,
    sortierung: 10
  },
  {
    id: STANDARD_ROLLE,
    name: 'Mitarbeiter',
    beschreibung: 'Arbeitet an eigenen und freigegebenen Projekten.',
    rechte: [
      'projekte.erstellen', 'projekte.bearbeiten', 'projekte.loeschen',
      'aufmasse.erstellen', 'aufmasse.bearbeiten', 'aufmasse.loeschen',
      'zeichnungen.erstellen', 'pdf.exportieren'
    ],
    system: true,
    sortierung: 50
  }
];

/**
 * Vorschläge, die die Rollenverwaltung zum Anlegen anbietet.
 *
 * Bewusst KEINE Systemrollen: Sie lassen sich ändern und löschen wie jede
 * selbst angelegte Rolle. Sie stehen hier nur, damit niemand mit einer
 * leeren Liste anfangen muss.
 */
export const ROLLEN_VORLAGEN: Rolle[] = [
  {
    id: 'bauleiter',
    name: 'Bauleiter',
    beschreibung: 'Sieht alle Baustellen und darf Mitarbeiterdaten einsehen.',
    rechte: [
      'mitarbeiter.ansehen',
      'projekte.erstellen', 'projekte.bearbeiten', 'projekte.loeschen',
      'aufmasse.erstellen', 'aufmasse.bearbeiten', 'aufmasse.loeschen',
      'zeichnungen.erstellen', 'pdf.exportieren', 'fremde.daten.ansehen'
    ],
    system: false,
    sortierung: 20
  },
  {
    id: 'aufmasstechniker',
    name: 'Aufmaßtechniker',
    beschreibung: 'Misst auf, zeichnet und erzeugt PDFs.',
    rechte: [
      'projekte.erstellen', 'projekte.bearbeiten',
      'aufmasse.erstellen', 'aufmasse.bearbeiten',
      'zeichnungen.erstellen', 'pdf.exportieren'
    ],
    system: false,
    sortierung: 30
  },
  {
    id: 'nur-lesen',
    name: 'Nur Lesen',
    beschreibung: 'Darf ansehen und drucken, aber nichts ändern.',
    rechte: ['pdf.exportieren'],
    system: false,
    sortierung: 90
  }
];

/**
 * Prüft eine Rollenkennung.
 *
 * Kennungen sind Kleinbuchstaben, Ziffern, Bindestrich – sie stehen in
 * Clerks Metadaten, in URLs und in der Datenbank. Alles andere wird hier
 * abgewiesen, damit es gar nicht erst irgendwo landet.
 */
export function rollenIdGueltig(wert: unknown): wert is string {
  return typeof wert === 'string' && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(wert);
}

/** Freitext → Rollenkennung („Bauleiter Nord" → „bauleiter-nord"). */
export function rollenIdAus(name: string): string {
  const roh = (name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return rollenIdGueltig(roh) ? roh : '';
}

/** Nur bekannte Rechte übernehmen – und den Alles-Platzhalter. */
export function rechteBereinigen(werte: unknown): string[] {
  if (!Array.isArray(werte)) return [];
  const erlaubt = new Set(RECHT_KEYS);
  const out: string[] = [];
  for (const w of werte) {
    if (typeof w !== 'string') continue;
    if (w === ALLE_RECHTE) return [ALLE_RECHTE];
    if (erlaubt.has(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Die Rechte einer Rolle als Menge. Unbekannte Rolle = keine Rechte. */
export function rechteVonRolle(rolle: Rolle | null | undefined): Set<string> {
  if (!rolle) return new Set();
  if (rolle.rechte.includes(ALLE_RECHTE)) return new Set([ALLE_RECHTE, ...RECHT_KEYS]);
  return new Set(rolle.rechte);
}

/** Hat diese Rechtemenge das verlangte Recht? */
export function hatRecht(rechte: Set<string> | string[] | null | undefined, recht: string): boolean {
  if (!rechte) return false;
  const menge = rechte instanceof Set ? rechte : new Set(rechte);
  return menge.has(ALLE_RECHTE) || menge.has(recht);
}

/** Hat die Menge mindestens eines der verlangten Rechte? */
export function hatEinesDerRechte(
  rechte: Set<string> | string[] | null | undefined, verlangt: string[]
): boolean {
  return verlangt.some(r => hatRecht(rechte, r));
}

/** Rolle aus einer Liste holen; `null`, wenn es sie nicht gibt. */
export function rolleFinden(rollen: Rolle[], id: string | null | undefined): Rolle | null {
  if (!id) return null;
  return rollen.find(r => r.id === id) ?? null;
}

/**
 * Anzeigename einer Rollenkennung.
 *
 * Auch für Kennungen, zu denen es keine Rolle (mehr) gibt: Dann steht die
 * Kennung selbst da, statt eines leeren Feldes. Eine gelöschte Rolle soll in
 * der Mitarbeiterliste sichtbar bleiben, nicht verschwinden.
 */
export function rolleBeschriftung(id: string | null | undefined, rollen?: Rolle[]): string {
  if (!id) return 'Ohne Rolle';
  const liste = rollen && rollen.length ? rollen : SYSTEM_ROLLEN;
  return rolleFinden(liste, id)?.name ?? id;
}

/** Alle Rollen (System + eigene), ohne Dubletten, in Anzeigereihenfolge. */
export function rollenZusammenfuehren(eigene: Rolle[]): Rolle[] {
  const map = new Map<string, Rolle>();
  SYSTEM_ROLLEN.forEach(r => map.set(r.id, r));
  eigene.forEach(r => {
    const system = SYSTEM_ROLLEN.find(s => s.id === r.id);
    // Eine Systemrolle darf umbenannt werden; „darf alles" bleibt beim Admin
    // aber bestehen – sonst könnte sich der Betrieb selbst aussperren.
    map.set(r.id, system
      ? { ...r, system: true, rechte: system.id === ADMIN_ROLLE ? system.rechte : r.rechte }
      : { ...r, system: false });
  });
  return [...map.values()].sort((a, b) => (a.sortierung - b.sortierung) || a.name.localeCompare(b.name, 'de'));
}
