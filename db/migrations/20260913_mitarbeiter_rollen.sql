-- AufmaßX – Mitarbeiterverwaltung, eigene Rollen, Herkunft der Daten
--
--   psql "$DATABASE_URL" -f db/migrations/20260913_mitarbeiter_rollen.sql
--
-- Alle Anweisungen sind wiederholbar (IF NOT EXISTS / ON CONFLICT). Ein
-- zweiter Lauf schadet nicht; ein Lauf gegen eine bereits befüllte Datenbank
-- verliert nichts.
--
-- Die BENUTZER selbst liegen unverändert bei Clerk – Name, E-Mail,
-- Registrierungsdatum, letzter Login und die zugewiesene Rolle stehen dort.
-- Hier liegt nur, was Clerk nicht kennt: die frei definierbaren Rollen, das
-- Aktivitätsprotokoll und die Herkunft der Projektdaten.

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
