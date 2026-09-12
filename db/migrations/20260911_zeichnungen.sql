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
