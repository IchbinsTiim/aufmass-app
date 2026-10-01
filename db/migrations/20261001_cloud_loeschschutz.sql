-- Gelöschte IDs dürfen durch veraltete Geräte nicht erneut entstehen.
-- Der Projektinhalt wird weiterhin wirklich gelöscht (inkl. Freigaben und
-- Speicherständen). Der kleine Löschvermerk enthält keinerlei Projektdaten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS cloud_geloeschte_projekte (
  id text PRIMARY KEY,
  app text NOT NULL CHECK (app IN ('aufmass', '2d')),
  owner_user_id text NOT NULL,
  geloescht_am timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION cloud_projekt_loeschschutz() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Der Merker entsteht in derselben Transaktion wie DELETE, auch für ältere
  -- API-Versionen. INSERT prüft vor UND nach dem möglichen Warten auf eine
  -- konkurrierende Löschung (Unique-Index); so kann kein alter Tab reaktivieren.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO cloud_geloeschte_projekte (id, app, owner_user_id)
      VALUES (OLD.id, OLD.app, OLD.owner_user_id) ON CONFLICT (id) DO NOTHING;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM cloud_geloeschte_projekte WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Dieses Projekt wurde gelöscht.'
      USING ERRCODE = '23514', CONSTRAINT = 'cloud_projekt_geloescht';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cloud_projekt_loeschschutz ON cloud_projekte;
CREATE TRIGGER cloud_projekt_loeschschutz BEFORE INSERT OR DELETE ON cloud_projekte
  FOR EACH ROW EXECUTE FUNCTION cloud_projekt_loeschschutz();
DROP TRIGGER IF EXISTS cloud_projekt_loeschschutz_nach_insert ON cloud_projekte;
CREATE TRIGGER cloud_projekt_loeschschutz_nach_insert AFTER INSERT ON cloud_projekte
  FOR EACH ROW EXECUTE FUNCTION cloud_projekt_loeschschutz();
COMMIT;
