# db/schema.sql

Postgres-Schema für AufmaßX (Neon): Einladungscodes und Cloud-Projekte.

## Ausführen

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Oder den Inhalt im SQL-Editor von Neon/Vercel einfügen. Alle Anweisungen
sind idempotent (`IF NOT EXISTS`) – ein zweiter Lauf schadet nicht.

## Herkunft

Übernommen unverändert aus Branch `claude/aufmassx-nextjs-clerk-migration-9oyc81`
(Commit `b9402dd`). Verifiziert, indem `tests/r13-einladungscodes.mjs` aus
diesem Branch gegen ein In-Memory-Postgres (PGlite) mit genau diesem Schema
gelaufen ist – alle 46 Tests bestanden.

## Tabellen

- `einladungscodes` – Einmal-Einladungscodes (Hash, Rolle, Status, Ablauf).
- `einladung_versuche` – Fehlversuche beim Einlösen, Grundlage der Sperre
  nach zu vielen Fehleingaben.
- `cloud_projekte` – Die Datensätze beider Anwendungen, getrennt über die
  Spalte `app`: Aufmaß-Projekte (`'aufmass'`) und 2D-Zeichnungen (`'2d'`),
  jeweils mit Versionsnummer gegen versehentliches Überschreiben bei
  paralleler Bearbeitung.
- `cloud_projekt_freigaben` – Mitarbeiterfreigaben pro Projekt, jeweils mit
  Lese- oder Bearbeitungsrecht.
- `cloud_ordner` – Persönliche Ordner des Eigentümers, ebenfalls je
  Anwendung (`app`).
- `cloud_zeichnungen` – Benannte, unveränderliche 2D-Speicherstände.
- `rollen` – Frei definierbare Rollen mit ihren Rechten (`rechte` als
  JSON-Liste von Schlüsseln aus `lib/rollen.ts`, oder `["*"]` für „darf
  alles"). Die beiden mitgelieferten Rollen stehen zusätzlich im Code, damit
  die Anwendung auch ohne Datenbank arbeitsfähig bleibt.
- `aktivitaeten` – Schlankes Ereignisprotokoll je Benutzer (Projekt angelegt,
  Zeichnung gespeichert, Rolle geändert, Zugang deaktiviert). Bewusst NICHT
  jeder Autosave: „zuletzt geändert von wem" beantworten die Spalten
  `geaendert_von` / `geaendert_am` am Datensatz selbst.

## Migrationen

`db/migrations/` enthält die einzelnen Schritte für eine bereits bestehende
Datenbank. `db/schema.sql` ist immer der vollständige Endstand – eine neue
Datenbank braucht nur diese Datei.

```bash
psql "$DATABASE_URL" -f db/migrations/20260913_mitarbeiter_rollen.sql
```

Die Migration legt `rollen` und `aktivitaeten` an, ergänzt `erstellt_von` /
`geaendert_von` an `cloud_projekte` und `cloud_ordner` und trägt beim
Altbestand den Eigentümer als Ersteller nach. Sie ist wiederholbar und setzt
eine bereits angepasste Rolle nicht zurück; geprüft wird das in
`tests/r19-rollen-rechte.mjs` gegen ein echtes Postgres im Speicher.

### Trennung der Anwendungen (2026-09-28)

```bash
psql "$DATABASE_URL" -f db/migrations/20260928_app_trennung.sql
```

**Vor dem Ausrollen des Codes ausführen** – der Code fragt nach der neuen
Spalte `app`. Aufmaß und 2D-Aufmaß sind seitdem getrennte Anwendungen:
`cloud_projekte.app` und `cloud_ordner.app` sind `'aufmass'` oder `'2d'`,
und jede App sieht nur ihren Namensraum. Die Migration übernimmt den
Altbestand in einer Transaktion: je laufende Zeichnung (`inhalt ->
'zeichnung2d'`) ein eigener Datensatz `z2d_<Projekt-ID>` im Namensraum `2d`,
dazu der Ordner (`z2d_<Ordner-ID>`), die Freigaben und die benannten
Speicherstände aus `cloud_zeichnungen`. Erst danach verliert das
Aufmaß-Projekt das Feld `zeichnung2d`; seine Revision bleibt. Wiederholbar,
ein zweiter Lauf ändert nichts – geprüft in `tests/r23-cloud-app-trennung.mjs`.

### Löschschutz (2026-10-01)

```bash
psql "$DATABASE_URL" -f db/migrations/20261001_cloud_loeschschutz.sql
```

Vor dem App-Update ausführen. Voraussetzung ist die App-Trennung vom 28.09.
Die wiederholbare Transaktion ergänzt `cloud_geloeschte_projekte` und zwei
Trigger. Beim DELETE entsteht atomar ein kleiner Sperrvermerk (ID, App,
Eigentümer und Löschzeit), während Projektinhalt, Freigaben und benannte
Speicherstände wirklich entfernt werden. INSERT prüft auch nach dem Warten
auf eine gleichzeitige Löschung, ob eine alte ID gesperrt ist.
Bestehende Projekte werden bei der Migration weder verändert noch gelöscht.
Die Vermerke nicht unabhängig vom Projektbestand zurücksetzen: Sie schützen
gegen alte Geräte und noch offene Tabs. Ein bewusster Restore verwendet eine
neue ID. Tests: `tests/r26-cloud-loeschschutz-db.mjs`.

## Was hier bewusst NICHT enthalten ist

Benutzerstammdaten. Name, E-Mail, Registrierungsdatum, letzter Login und die
zugewiesene Rolle führt Clerk; hier liegt nur, was Clerk nicht kennt – welche
Rechte eine Rolle hat, wer welchen Datensatz angelegt hat und das
Ereignisprotokoll. Eine gespiegelte Benutzertabelle wäre eine zweite Wahrheit,
die auseinanderlaufen kann; bei Zugängen ist das die schlechteste aller
Eigenschaften.

Eine Firmen-/Mandantenstruktur gibt es weiterhin nicht: Die Cloud-Projektakte
ist pro Clerk-Benutzer organisiert und wird über Freigaben geteilt. Sie kann
später ergänzt werden, falls sie benötigt wird.
