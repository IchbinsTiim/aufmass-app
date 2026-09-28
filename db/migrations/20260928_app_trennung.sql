-- AufmaßX – Trennung der beiden Anwendungen (Aufmaß / 2D-Aufmaß)
--
--   psql "$DATABASE_URL" -f db/migrations/20260928_app_trennung.sql
--
-- VOR dem Ausrollen des Codes ausführen: der neue Code fragt nach der Spalte
-- `app`. Die Anweisungen sind wiederholbar – ein zweiter Lauf ändert nichts.
-- Alles läuft in EINER Transaktion: entfernt wird nur, was im selben Zug
-- nachweislich kopiert wurde.
--
-- Bis hierher lag die 2D-Zeichnung als `inhalt -> 'zeichnung2d'` im
-- Aufmaß-Projekt, und beide Programme teilten sich Projekte und Ordner. Ab
-- jetzt hat jede Anwendung ihren eigenen Namensraum:
--
--   app = 'aufmass'   Projekte und Ordner der Aufmaß-App
--   app = '2d'        Zeichnungen und Ordner der 2D-Aufmaß-App
--
-- Die Kennung einer übernommenen Zeichnung ist fest abgeleitet:
-- 'z2d_' || Projekt-ID. Genau so verfährt die Speicher-Migration im Browser
-- (shared/speicher-migration.js) – lokaler Bestand und Cloud treffen sich
-- dadurch ohne Doppelungen.

BEGIN;

-- ── 1. Namensraum je Anwendung ──────────────────────────────────────────────
ALTER TABLE cloud_projekte ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'aufmass';
ALTER TABLE cloud_ordner   ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'aufmass';

ALTER TABLE cloud_projekte DROP CONSTRAINT IF EXISTS cloud_projekte_app_gueltig;
ALTER TABLE cloud_projekte ADD CONSTRAINT cloud_projekte_app_gueltig CHECK (app IN ('aufmass', '2d'));
ALTER TABLE cloud_ordner   DROP CONSTRAINT IF EXISTS cloud_ordner_app_gueltig;
ALTER TABLE cloud_ordner   ADD CONSTRAINT cloud_ordner_app_gueltig CHECK (app IN ('aufmass', '2d'));

CREATE INDEX IF NOT EXISTS cloud_projekte_app_owner_idx
  ON cloud_projekte (app, owner_user_id, geaendert_am DESC);
CREATE INDEX IF NOT EXISTS cloud_ordner_app_owner_idx
  ON cloud_ordner (app, owner_user_id, geaendert_am DESC);

-- ── 2. Ordner, in denen Zeichnungen liegen, als 2D-Ordner kopieren ──────────
-- Die Aufmaß-App behält ihre Ordner; die 2D-App bekommt eigene Datensätze.
INSERT INTO cloud_ordner (id, owner_user_id, inhalt, revision, erstellt_am, geaendert_am,
                          erstellt_von, geaendert_von, app)
SELECT 'z2d_' || o.id, o.owner_user_id,
       jsonb_set(o.inhalt, '{id}', to_jsonb('z2d_' || o.id)),
       1, o.erstellt_am, o.geaendert_am, o.erstellt_von, o.geaendert_von, '2d'
  FROM cloud_ordner o
 WHERE o.app = 'aufmass'
   AND EXISTS (SELECT 1 FROM cloud_projekte p
                WHERE p.app = 'aufmass'
                  AND p.inhalt ->> 'folderId' = o.id
                  AND (jsonb_typeof(p.inhalt -> 'zeichnung2d') = 'object'
                       OR EXISTS (SELECT 1 FROM cloud_zeichnungen s WHERE s.projekt_id = p.id)))
ON CONFLICT (id) DO NOTHING;

-- ── 3. Zeichnungen als eigene Datensätze der 2D-App ─────────────────────────
-- Auch Projekte mit benannten Speicherständen, aber ohne laufende Zeichnung,
-- bekommen einen Datensatz – sonst hingen ihre Speicherstände im Leeren.
INSERT INTO cloud_projekte (id, owner_user_id, titel, inhalt, revision, erstellt_am, geaendert_am,
                            erstellt_von, geaendert_von, app)
SELECT 'z2d_' || p.id, p.owner_user_id, p.titel,
       jsonb_build_object(
         'id',          'z2d_' || p.id,
         'name',        COALESCE(p.inhalt -> 'name', to_jsonb(p.titel)),
         'folderId',    CASE WHEN EXISTS (SELECT 1 FROM cloud_ordner o
                                           WHERE o.id = 'z2d_' || (p.inhalt ->> 'folderId') AND o.app = '2d')
                             THEN to_jsonb('z2d_' || (p.inhalt ->> 'folderId'))
                             ELSE 'null'::jsonb END,
         'erstellt',    COALESCE(p.inhalt -> 'erstellt', 'null'::jsonb),
         'geaendert',   COALESCE(p.inhalt -> 'geaendert', 'null'::jsonb),
         'anschrift',   COALESCE(p.inhalt -> 'anschrift', 'null'::jsonb),
         'ausAufmass',  to_jsonb(p.id),
         'zeichnung2d', CASE WHEN jsonb_typeof(p.inhalt -> 'zeichnung2d') = 'object'
                             THEN p.inhalt -> 'zeichnung2d'
                             ELSE '{"depth":0.73,"sections":[],"abschnitte":[],"hideUnassigned":false,"aufmass":null,"ecken":{},"bordbrettLinien":[],"_sId":0,"_bId":0}'::jsonb END
       ),
       1, p.erstellt_am, p.geaendert_am, p.erstellt_von, p.geaendert_von, '2d'
  FROM cloud_projekte p
 WHERE p.app = 'aufmass'
   AND (jsonb_typeof(p.inhalt -> 'zeichnung2d') = 'object'
        OR EXISTS (SELECT 1 FROM cloud_zeichnungen s WHERE s.projekt_id = p.id))
ON CONFLICT (id) DO NOTHING;

-- ── 4. Freigaben gelten weiter – jetzt für die Zeichnung selbst ─────────────
INSERT INTO cloud_projekt_freigaben (projekt_id, user_id, rolle, erstellt_am)
SELECT 'z2d_' || f.projekt_id, f.user_id, f.rolle, f.erstellt_am
  FROM cloud_projekt_freigaben f
  JOIN cloud_projekte z ON z.id = 'z2d_' || f.projekt_id AND z.app = '2d'
ON CONFLICT (projekt_id, user_id) DO NOTHING;

-- ── 5. Benannte Speicherstände hängen an der Zeichnung ──────────────────────
UPDATE cloud_zeichnungen s
   SET projekt_id = 'z2d_' || s.projekt_id
 WHERE EXISTS (SELECT 1 FROM cloud_projekte a WHERE a.id = s.projekt_id AND a.app = 'aufmass')
   AND EXISTS (SELECT 1 FROM cloud_projekte z WHERE z.id = 'z2d_' || s.projekt_id AND z.app = '2d');

-- ── 6. Aufmaß-Projekte tragen keine Zeichnung mehr ──────────────────────────
-- Nur dort, wo die Kopie aus Schritt 3 existiert (oder gar keine Zeichnung da
-- war). Die Revision bleibt: am Aufmaß selbst hat sich nichts geändert, und
-- Geräte, die ihre Kopie bereits bereinigt haben, sollen keinen Konflikt sehen.
UPDATE cloud_projekte a
   SET inhalt = a.inhalt - 'zeichnung2d'
 WHERE a.app = 'aufmass'
   AND a.inhalt ? 'zeichnung2d'
   AND (jsonb_typeof(a.inhalt -> 'zeichnung2d') <> 'object'
        OR EXISTS (SELECT 1 FROM cloud_projekte z WHERE z.id = 'z2d_' || a.id AND z.app = '2d'));

COMMIT;
