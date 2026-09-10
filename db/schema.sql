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
