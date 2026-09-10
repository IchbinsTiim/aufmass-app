# db/schema.sql

Postgres-Schema für die AufmaßX-Einladungscodes (Neon).

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

## Was hier bewusst NICHT enthalten ist

Firma/Tenant, Benutzer, Projekte, Projektzuweisungen und Dokumente gibt es
in diesem Schema nicht. Benutzer verwaltet Clerk, nicht Postgres. Projekte
liegen laut `MIGRATION.md` (Abschnitt 9) weiterhin im Browser
(`localStorage`/`IndexedDB`) – eine Cloud-Datenbank dafür ist explizit noch
nicht gebaut. Es gibt im gesamten Repository keinen Code, der eine dieser
Tabellen abfragt oder erwartet. Tabellen ohne einen einzigen lesenden oder
schreibenden Aufrufer würden nur Struktur vortäuschen, die es nicht gibt –
deshalb fehlen sie hier, bis der zugehörige Code existiert.
