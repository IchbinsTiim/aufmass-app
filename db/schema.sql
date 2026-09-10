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
