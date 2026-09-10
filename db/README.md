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
- `cloud_projekte` – Die gesamte Projektakte (einschließlich der
  Aufmaßzeichnung) eines Eigentümers, mit Versionsnummer gegen versehentliches
  Überschreiben bei paralleler Bearbeitung.
- `cloud_projekt_freigaben` – Mitarbeiterfreigaben pro Projekt, jeweils mit
  Lese- oder Bearbeitungsrecht.
- `cloud_ordner` – Persönliche Ordner des Eigentümers.

## Was hier bewusst NICHT enthalten ist

Firma/Tenant und Benutzerprofile liegen weiterhin nicht in diesem Schema.
Benutzer und ihre Rollen verwaltet Clerk. Die Cloud-Projektakte ist bewusst
pro Clerk-Benutzer organisiert; eine Firmen-/Mandantenstruktur kann später
ergänzt werden, falls sie benötigt wird.
