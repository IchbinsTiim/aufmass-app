-- AufmaßX – Einladungscodes
--
-- Einmal ausführen, bevor die Einladungsfunktion genutzt wird:
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- oder den Inhalt im Neon-/Vercel-SQL-Editor ausführen. Die Anweisungen sind
-- wiederholbar (IF NOT EXISTS) – ein zweiter Lauf schadet nicht.

CREATE TABLE IF NOT EXISTS einladungscodes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Der Code selbst wird NIE gespeichert. Hier steht HMAC-SHA256(code, Pepper).
  -- Der Pepper liegt als Umgebungsvariable auf dem Server; wer die Datenbank
  -- allein in die Hände bekommt, kann daraus keinen gültigen Code ableiten.
  code_hash             text        NOT NULL UNIQUE,

  -- Die ersten vier Zeichen im Klartext, damit ein Code in der Liste
  -- wiedererkennbar ist („X7K4-…"). Vier Zeichen sind zu wenig zum Raten.
  code_praefix          text        NOT NULL,

  -- aktiv | wird_eingeloest | verwendet | widerrufen
  status                text        NOT NULL DEFAULT 'aktiv',

  rolle                 text        NOT NULL DEFAULT 'mitarbeiter',
  notiz                 text,

  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  laeuft_ab_am          timestamptz NOT NULL,
  verwendet_am          timestamptz,
  reserviert_bis        timestamptz,

  erstellt_von_user_id  text        NOT NULL,
  verwendet_von_user_id text,

  CONSTRAINT einladungscodes_status_gueltig
    CHECK (status IN ('aktiv', 'wird_eingeloest', 'verwendet', 'widerrufen')),
  CONSTRAINT einladungscodes_rolle_gueltig
    CHECK (rolle IN ('admin', 'mitarbeiter'))
);

CREATE INDEX IF NOT EXISTS einladungscodes_status_idx
  ON einladungscodes (status, erstellt_am DESC);

-- Fehlversuche beim Einlösen. Grundlage für die Sperre nach zu vielen
-- Fehleingaben. Die Kennung ist ein Hash der Herkunft, keine Klartext-IP.
CREATE TABLE IF NOT EXISTS einladung_versuche (
  id         bigserial   PRIMARY KEY,
  kennung    text        NOT NULL,
  zeitpunkt  timestamptz NOT NULL DEFAULT now(),
  erfolg     boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS einladung_versuche_kennung_idx
  ON einladung_versuche (kennung, zeitpunkt DESC);

-- Cloud-Projekte ------------------------------------------------------------
--
-- Der Browser bleibt ein schneller, lokaler Zwischenspeicher. Diese Tabellen
-- sind die gemeinsame, dauerhafte Projektakte: Aufmaß und 2D-Zeichnung liegen
-- weiterhin gemeinsam in `inhalt`, genau wie bisher im lokalen Projektobjekt.
-- `revision` verhindert, dass ein älterer Stand einen inzwischen geänderten
-- Cloud-Stand unbemerkt überschreibt.

CREATE TABLE IF NOT EXISTS cloud_projekte (
  id              text        PRIMARY KEY,
  owner_user_id   text        NOT NULL,
  titel           text        NOT NULL DEFAULT '',
  inhalt          jsonb       NOT NULL,
  revision        integer     NOT NULL DEFAULT 1,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  geaendert_am    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloud_projekte_revisions_gueltig CHECK (revision > 0),
  CONSTRAINT cloud_projekte_id_laenge CHECK (char_length(id) BETWEEN 1 AND 120),
  CONSTRAINT cloud_projekte_titel_laenge CHECK (char_length(titel) <= 240)
);

CREATE INDEX IF NOT EXISTS cloud_projekte_owner_idx
  ON cloud_projekte (owner_user_id, geaendert_am DESC);

-- Ein Projekt kann gezielt für einen eingeladenden Mitarbeiter freigegeben
-- werden. Der Eigentümer und Administratoren dürfen verwalten; `bearbeiten`
-- darf den Projektinhalt ändern, aber nicht weitergeben oder löschen.
CREATE TABLE IF NOT EXISTS cloud_projekt_freigaben (
  projekt_id      text        NOT NULL REFERENCES cloud_projekte(id) ON DELETE CASCADE,
  user_id         text        NOT NULL,
  rolle           text        NOT NULL DEFAULT 'bearbeiten',
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (projekt_id, user_id),
  CONSTRAINT cloud_projekt_freigaben_rolle_gueltig CHECK (rolle IN ('lesen', 'bearbeiten'))
);

CREATE INDEX IF NOT EXISTS cloud_projekt_freigaben_user_idx
  ON cloud_projekt_freigaben (user_id, projekt_id);

-- Ordner gehören zum jeweiligen Konto. Geteilte Projekte ohne eigenen Ordner
-- bleiben für Mitarbeitende sichtbar; ein fremder Ordnername wird nie
-- offengelegt.
CREATE TABLE IF NOT EXISTS cloud_ordner (
  id              text        PRIMARY KEY,
  owner_user_id   text        NOT NULL,
  inhalt          jsonb       NOT NULL,
  revision        integer     NOT NULL DEFAULT 1,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  geaendert_am    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloud_ordner_revisions_gueltig CHECK (revision > 0),
  CONSTRAINT cloud_ordner_id_laenge CHECK (char_length(id) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS cloud_ordner_owner_idx
  ON cloud_ordner (owner_user_id, geaendert_am DESC);

-- Benannte, unveränderliche 2D-Speicherstände; unabhängig vom Projekt-Autosave.
CREATE TABLE IF NOT EXISTS cloud_zeichnungen (
  id text PRIMARY KEY,
  projekt_id text NOT NULL REFERENCES cloud_projekte(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  inhalt jsonb NOT NULL,
  erstellt_von text NOT NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  quelle text NOT NULL CHECK (quelle IN ('zeichnung', 'upload')),
  dateiname text
);
CREATE INDEX IF NOT EXISTS cloud_zeichnungen_projekt_idx ON cloud_zeichnungen(projekt_id, erstellt_am DESC);

-- Mitarbeiterverwaltung und eigene Rollen ------------------------------------
--
-- Wortgleich mit db/migrations/20260913_mitarbeiter_rollen.sql; wer eine neue
-- Datenbank aufsetzt, braucht nur diese Datei.

-- ── Rollen ──────────────────────────────────────────────────────────────────
-- `rechte` ist eine JSON-Liste von Rechte-Schlüsseln aus lib/rollen.ts,
-- oder ["*"] für „darf alles". Bewusst jsonb und keine Verknüpfungstabelle:
-- Rechte sind eine geschlossene Liste im Code, kein Stammdatum – und ein
-- neues Recht soll keine Migration kosten.
CREATE TABLE IF NOT EXISTS rollen (
  id            text        PRIMARY KEY,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  beschreibung  text        NOT NULL DEFAULT '',
  rechte        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Mitgelieferte Rolle: umbenennbar, aber nicht löschbar.
  system        boolean     NOT NULL DEFAULT false,
  sortierung    integer     NOT NULL DEFAULT 100,
  erstellt_am   timestamptz NOT NULL DEFAULT now(),
  geaendert_am  timestamptz NOT NULL DEFAULT now(),
  geaendert_von text,
  CONSTRAINT rollen_id_form CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT rollen_rechte_liste CHECK (jsonb_typeof(rechte) = 'array')
);

-- ── Aktivitäten ─────────────────────────────────────────────────────────────
-- Ein schlankes Protokoll: WER hat WANN WAS angelegt, geändert oder gelöscht.
-- Bewusst nicht jeder Autosave – die Spalten `geaendert_am`/`geaendert_von`
-- am Datensatz beantworten „zuletzt geändert von" bereits. Hier stehen die
-- Ereignisse, die man später nachvollziehen will.
CREATE TABLE IF NOT EXISTS aktivitaeten (
  id            bigserial   PRIMARY KEY,
  user_id       text        NOT NULL,
  art           text        NOT NULL,
  objekt_id     text,
  objekt_titel  text,
  zeitpunkt     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aktivitaeten_user_idx
  ON aktivitaeten (user_id, zeitpunkt DESC);

-- ── Herkunft der Projektdaten ───────────────────────────────────────────────
-- Wer hat den Datensatz angelegt, wer zuletzt geändert. `cloud_zeichnungen`
-- hat `erstellt_von`/`erstellt_am` bereits von Anfang an.
ALTER TABLE cloud_projekte ADD COLUMN IF NOT EXISTS erstellt_von  text;
ALTER TABLE cloud_projekte ADD COLUMN IF NOT EXISTS geaendert_von text;
ALTER TABLE cloud_ordner   ADD COLUMN IF NOT EXISTS erstellt_von  text;
ALTER TABLE cloud_ordner   ADD COLUMN IF NOT EXISTS geaendert_von text;

-- Altbestand: Wer ein Projekt besitzt, hat es angelegt. Das ist die einzige
-- Angabe, die sich rückwirkend belegen lässt – und sie stimmt für jedes
-- Projekt, das vor dieser Migration entstanden ist.
UPDATE cloud_projekte SET erstellt_von = owner_user_id WHERE erstellt_von IS NULL;
UPDATE cloud_ordner   SET erstellt_von = owner_user_id WHERE erstellt_von IS NULL;

CREATE INDEX IF NOT EXISTS cloud_projekte_erstellt_von_idx
  ON cloud_projekte (erstellt_von, geaendert_am DESC);
CREATE INDEX IF NOT EXISTS cloud_zeichnungen_erstellt_von_idx
  ON cloud_zeichnungen (erstellt_von, erstellt_am DESC);

-- ── Einladungen dürfen jede Rolle vergeben ──────────────────────────────────
-- Bis zur Rollenverwaltung ließ die Prüfbedingung nur 'admin' und
-- 'mitarbeiter' zu. Jetzt darf dort jede Rollenkennung stehen – geprüft wird
-- nur noch die FORM, damit nichts Unerwartetes in die Metadaten eines
-- Clerk-Kontos wandert. Ob es die Rolle wirklich gibt, entscheidet die
-- Anwendung beim Anlegen der Einladung.
ALTER TABLE einladungscodes DROP CONSTRAINT IF EXISTS einladungscodes_rolle_gueltig;
ALTER TABLE einladungscodes DROP CONSTRAINT IF EXISTS einladungscodes_rolle_form;
ALTER TABLE einladungscodes ADD CONSTRAINT einladungscodes_rolle_form
  CHECK (rolle ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- ── Mitgelieferte Rollen und Vorlagen ───────────────────────────────────────
-- Dieselben Werte wie in lib/rollen.ts. Sie stehen ZUSÄTZLICH hier, damit die
-- Rollenverwaltung nicht mit einer leeren Liste beginnt. `ON CONFLICT DO
-- NOTHING`: Eine bereits angepasste Rolle wird nie zurückgesetzt.
INSERT INTO rollen (id, name, beschreibung, rechte, system, sortierung) VALUES
  ('admin', 'Administrator', 'Darf alles – einschließlich aller künftigen Rechte.',
   '["*"]'::jsonb, true, 10),
  ('bauleiter', 'Bauleiter', 'Sieht alle Baustellen und darf Mitarbeiterdaten einsehen.',
   '["mitarbeiter.ansehen","projekte.erstellen","projekte.bearbeiten","projekte.loeschen","aufmasse.erstellen","aufmasse.bearbeiten","aufmasse.loeschen","zeichnungen.erstellen","pdf.exportieren","fremde.daten.ansehen"]'::jsonb,
   false, 20),
  ('aufmasstechniker', 'Aufmaßtechniker', 'Misst auf, zeichnet und erzeugt PDFs.',
   '["projekte.erstellen","projekte.bearbeiten","aufmasse.erstellen","aufmasse.bearbeiten","zeichnungen.erstellen","pdf.exportieren"]'::jsonb,
   false, 30),
  ('mitarbeiter', 'Mitarbeiter', 'Arbeitet an eigenen und freigegebenen Projekten.',
   '["projekte.erstellen","projekte.bearbeiten","projekte.loeschen","aufmasse.erstellen","aufmasse.bearbeiten","aufmasse.loeschen","zeichnungen.erstellen","pdf.exportieren"]'::jsonb,
   true, 50),
  ('nur-lesen', 'Nur Lesen', 'Darf ansehen und drucken, aber nichts ändern.',
   '["pdf.exportieren"]'::jsonb, false, 90)
ON CONFLICT (id) DO NOTHING;
