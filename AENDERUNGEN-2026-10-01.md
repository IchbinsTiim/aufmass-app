# AufmaßX – Reparatur vom 01.10.2026

## Ausgangslage und Ursachen

Die Trennung in `aufmass/` und `aufmass-2d/`, getrennte lokale
Speicherschlüssel und Cloud-Namensräume waren bereits auf main vorhanden.
Auch Plane nutzte bereits dieselbe Bekleidungslogik wie Netz. Deshalb wurden
diese Funktionen nicht nochmals parallel eingebaut; die Trennung bleibt
erhalten. `shared/` enthält weiterhin nur technische Grundlagen und die
einmalige Altbestandsmigration.

- **73 cm / Stirnseite:** Ein einzelner 73-cm-Fall funktionierte bereits.
  Reproduzierbar falsch war die Auflistung, wenn dasselbe Feld zu zwei Ecken
  gehört: die Mengen wurden addiert, der Rechenweg der zweiten Stirnseite
  überschrieb jedoch den ersten. Jetzt erhält jede Ecke eine eigene Zeile,
  für Netz und Plane getrennt. Die freie Tiefeneingabe akzeptiert
  Dezimalkomma und explizite Zentimeter sowie eine sichtbare Einheitenwahl.
  Auch 73,5 cm werden nicht still auf 73 oder 74 cm gerundet.
- **Mehrfachauswahl:** In der Aufmaß-Übersicht fehlte sie; die 2D-App hatte
  nur einen eingeschränkten Auswahlmodus. Beide haben jetzt Checkboxen,
  sichtbare Markierung, Umschalt-Bereichsauswahl und Strg/Cmd-Auswahl.
  Eine Aktionsleiste erscheint erst mit Auswahl. Gemeinsames Verschieben
  und Löschen ist in beiden Apps möglich, Statusänderung zusätzlich im Aufmaß.
- **Wiederkehrende Projekte:** Veraltete Geräte konnten fehlende IDs neu
  anlegen; der Abgleich bewahrte lokal fehlende Serverprojekte und lud sie
  wieder hoch. Zudem waren Laden, Speichern und Löschen nicht durchgängig
  koordiniert. Jetzt werden diese Vorgänge serialisiert, mit Web Locks auch
  zwischen Tabs. Ein Löschvermerk in Postgres sperrt gelöschte IDs, während
  Projektinhalte und abhängige Datensätze tatsächlich entfernt werden.
  Die Karte verschwindet erst nach Bestätigung. Fehlerhafte Löschungen
  bleiben sichtbar; Teilerfolge werden ausdrücklich genannt.
- **Cloud-Konflikte:** Nach erfolgreichen Uploads gingen Bestätigungen
  verloren, wenn ein späterer Upload scheiterte. Außerdem wurde unterschiedliche
  JSON-Schlüsselreihenfolge als Inhaltsänderung behandelt. Bestätigungen
  werden jetzt sofort je Projekt gespeichert; Vergleiche sind unabhängig
  von der Schlüsselreihenfolge. Echte gleichzeitige Änderungen erzeugen
  eine benannte Konfliktkopie. Noch offene lokale Änderungen an inzwischen
  entfernten Projekten bleiben als exportierbare JSON-Notfallsicherungen.
- **Fehlermeldungen:** Zeitüberschreitungen, fehlende Anmeldung,
  Berechtigungsfehler und Revisionskonflikte werden unterschieden.
  Automatische Wiederholungen sind begrenzt und umgehen den vorhandenen
  Speichern-/Verwerfen-Dialog nicht.

Die geprüften Vercel-Laufzeitlogs zeigten wiederholte PUT-Konflikte (409)
neben erfolgreichen PUT (200), Arbeitsbereichsabrufen (200) und DELETE (204).
In diesem beobachteten Zeitfenster wurden keine Server-Timeouts oder
Cloud-Authentifizierungsfehler festgestellt; das ist keine Aussage über die
gesamte bisherige Betriebszeit.

## Prüfung und Veröffentlichung

Alle 35 Testdateien der Gesamtsuite sind bestanden. Neue gezielte Prüfungen:
50, 73, 73,5, 81, 97, 109 und 123 cm; beide Bekleidungen; unterschiedliche
Feldhöhen; zwei Stirnseiten am selben Feld; getrennte PDF-Rechenzeilen;
deutsches Dezimalkomma; verzögerte Löschung; Fehler und Reload; beide
Projektübersichten auf Desktop und iPad. Bestehende Tests decken Zeichnen,
Feldauswahl, Undo/Redo, Navigation, PDF-Aufbau, Rechte und App-Trennung ab.

Browser-Cloudtests verwenden kontrollierte API-Antworten. SQL-Tests führen die
produktiven Funktionen und Trigger mit PGlite aus. Die PDF-Tests prüfen die
Ausgabeaufrufe mit dem vorhandenen jsPDF-Testdouble, nicht einen externen
PDF-Viewer. Der Live-Betrieb ist zusätzlich nach der Veröffentlichung zu prüfen.

Reihenfolge: `db/migrations/20261001_cloud_loeschschutz.sql` in der
bestehenden Produktionsdatenbank ausführen, dann App veröffentlichen.
Die Migration löscht und verändert keine bestehenden Projektinhalte.
Alte Tabs anschließend neu laden; die geänderten Skripte haben neue
Cache-Versionen. Die Standardoption der Stirnseite bleibt AUS.

## Alle geänderten und neuen Dateien

### Anwendungen

- Geändert: `aufmass/index.html`
- Geändert: `aufmass/script.js`
- Geändert: `aufmass/cloud.js`
- Neu: `aufmass/auswahl.css`
- Geändert: `aufmass-2d/index.html`
- Geändert: `aufmass-2d/viewer2d.js`
- Geändert: `aufmass-2d/cloud.js`
- Neu: `aufmass-2d/auswahl.css`

### Server und Datenbank

- Geändert: `lib/projekte/cloud.ts`
- Geändert: `app/api/cloud/arbeitsbereich/route.ts`
- Geändert: `db/schema.sql`
- Neu: `db/migrations/20261001_cloud_loeschschutz.sql`

### Tests

- Geändert: `tests/alle.mjs`
- Geändert: `tests/harness.mjs`
- Geändert: `tests/r9-2d-zeichnungen.mjs`
- Geändert: `tests/r12-huelle-schutz.mjs`
- Geändert: `tests/r17-cloud-parallel.mjs`
- Neu: `tests/r24-stirn-breiten.mjs`
- Neu: `tests/r25-cloud-loeschen.mjs`
- Neu: `tests/r26-cloud-loeschschutz-db.mjs`
- Neu: `tests/r27-projekt-mehrfachauswahl.mjs`

### Dokumentation

- Geändert: `README.md`
- Geändert: `db/README.md`
- Geändert: `tests/README.md`
- Neu: `AENDERUNGEN-2026-10-01.md`
