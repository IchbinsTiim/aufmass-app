# Cloud-Zeichnungen – Umsetzung vom 11.09.2026

Basis: aktueller GitHub-main d107f55; Arbeitszweig feat/cloud-zeichnungen.

## Ist-Zustand
Next.js 16 schützt die unveränderten Legacy-Module über Clerk. Der vorhandene
Cloud-Adapter synchronisiert ganze lokale Projekte nach Neon, inklusive eines
laufenden `zeichnung2d`-Dokuments. Ein benannter Zeichnungsbestand oder ein
Upload in diesen Bestand fehlte. Lokale JSON-Exporte und -Importe existierten.

## Implementiert
- Editor: „Zeichnung speichern“. Projektliste: „Gespeicherte Zeichnungen / Upload“.
- Dialog mit Zielprojekt, Name, Erstellungsdatum, Quelle und gespeicherten Ständen.
- Jeder Speichervorgang erzeugt einen eigenen unveränderlichen Datensatz in
  `cloud_zeichnungen`; gleiche Namen sind erlaubt, Datum unterscheidet die Stände.
- JSON-Uploads im aktuellen AufmaßX-Format (maximal 1,5 MB). Keine automatische
  Umwandlung von PDF, Bild oder CAD-Dateien in Gerüstgeometrie.
- „Als Kopie öffnen“ lädt die Geometrie in ein neues lokales Projekt. Bestehende
  Projekte und gespeicherte Originale bleiben erhalten. Kopien synchronisieren
  anschließend über den vorhandenen Cloud-Adapter. Das ist bewusst der einzige
  Ladeweg: kein stilles Ersetzen der aktuellen Zeichnung.
- Ältere JSON-Dateien ohne Koordinaten müssen zuerst über den bestehenden lokalen
  Dateiimport geöffnet und neu exportiert werden. Unbekannte Versionen werden abgelehnt.
- Clerk-Zugriff und Projektfreigaben auf jeder Route. Lesefreigabe darf laden,
  aber keine Stände anlegen. Eigentümer, Administrator und Bearbeitungsfreigabe dürfen speichern.
- UUID gegen doppelte Wiederholungen nach Verbindungsabbruch; keine Update- oder
  Löschroute für einzelne Speicherstände. Projektlöschung entfernt seinen Bestand
  entsprechend der bestehenden Projekt-Löschlogik.
- Größenprüfung während des Einlesens der Anfrage und Prüfung der Zeichnungsstruktur.
- Bestehende lokale Autosaves und Datei-Exporte bleiben erhalten. Cloud-Ausfall
  wird als Fehler angezeigt, niemals als erfolgreiche Cloud-Speicherung.
- Cloud-Abgleich übernimmt bestätigte Revisionen, ohne zwischenzeitlich weiter-
  gezeichnete lokale Daten durch den alten Sendestand zu ersetzen.

## Aktivierung
1. In der gewünschten Neon-Umgebung `db/migrations/20260911_zeichnungen.sql`
   ausführen. Die Migration ist additiv und wiederholbar; Bestandsdaten bleiben erhalten.
2. Änderung regulär auf Vercel bereitstellen. Keine neue Abhängigkeit und keine
   weitere Umgebungsvariable erforderlich; DATABASE_URL und Clerk bleiben bestehen.
3. Das Zielprojekt muss bereits über den vorhandenen Cloud-Adapter synchronisiert
   sein. Andernfalls meldet der Dialog, dass zuerst synchronisiert werden muss.
4. Mit zwei Konten prüfen: Eigentümer speichert, freigegebener Leser lädt auf einem
   anderen Gerät, fremdes Konto sieht den Bestand nicht.

Migration, Push und Produktionsdeployment wurden hier nicht durchgeführt.

## Tests und tatsächliche Grenzen
Bestanden: TypeScript-Prüfung, Produktionsbuild mit Clerk-Platzhaltern,
Datenbanktests gegen PGlite mit produktiven SQL-Funktionen (Rechte, ID-Wiederholung,
Unveränderlichkeit, ungültige Daten, Größenlimit, Projektlöschung), Test gegen
Datenverlust bei gleichzeitigem Zeichnen und Cloud-Übertragung.

Die komplette Testsuite wurde ausgeführt. 22 von 24 damaligen Testdateien konnten
wegen des lokal abbrechenden Chrome-Testprozesses (SIGABRT/EPERM) nicht erfolgreich
laufen; die zwei Datenbankdateien bestanden. Der danach ergänzte Parallelitätstest
bestand separat. Das ist keine bestandene vollständige Regression.

Über den App-Browser wurden Anlegen eines Feldes, Speichern, Bestandsanzeige,
Laden als Kopie, JSON-Upload mit anschließender Anzeige der korrekten Geometrie
(3,07 m × 6 m = 18,42 m²) und Persistenz nach Reload in einer lokalen Vorschau geprüft.
Diese Vorschau simuliert die Cloud-Antworten; sie ersetzt keinen Test gegen
produktives Clerk und Neon. Der automatisierte UI-Test liegt in
`tests/r16-cloud-zeichnungen-ui.mjs` für eine Umgebung mit funktionierendem Chromium.

## Geplanter Ausbau: PDF und Bilder als Projektanhänge
Dieser Teil ist geplant, nicht implementiert. Private Vercel Blob-Ablage verwenden;
keine Base64-Binärdateien in Projekt-JSON oder localStorage. Das SDK unterstützt
private Stores und authentifizierten Zugriff:
https://vercel.com/docs/vercel-blob/using-blob-sdk

Vorgesehener Ablauf:
1. Separate Neon-Tabelle `cloud_dateien`: UUID, projekt_id, blob_key, ursprünglicher
   Dateiname, MIME-Typ, Bytezahl, Prüfsumme, erstellt_von, erstellt_am, Status.
2. Upload-Start-Route prüft Clerk und Projekt-Bearbeitungsrecht. Server vergibt
   den Objektpfad `projekte/<id>/<uuid>` und einen kurzlebigen Uploadauftrag.
3. Browser überträgt direkt in einen privaten Store. Server/Callback bestätigt
   Eigentümer, Pfad, Größe und erlaubten Dateityp, bevor die Datei sichtbar wird.
   Vorläufiges Produktlimit: PDF/JPEG/PNG, maximal 20 MB pro Datei.
4. Download-Route prüft bei jedem Abruf Projekt-Leserecht und liefert die private
   Datei als Anhang aus. Keine frei zugänglichen URLs in der Projektliste.
5. Fehlgeschlagene Uploads bleiben „ausstehend“; verwaiste Objekte werden per
   Wiederholungsjob entfernt. Projektlöschung setzt eine Löschaufgabe, die Datenbank
   und Object Storage nachvollziehbar abgleicht. Keine vermeintliche Transaktion
   über zwei voneinander unabhängige Speicher.
6. UI trennt „Bearbeitbare Zeichnungen“ und „Projektanhänge“, zeigt Dateityp, Größe,
   Fortschritt und Wiederholen an. Eine angehängte PDF ist kein editierbarer 2D-Plan.
7. Vor Umsetzung privaten Store mit dem Vercel-Projekt verbinden, aktuelle SDK-
   Authentifizierung verwenden und die Konten-/Projekttrennung sowie unterbrochene
   Uploads in einer Preview-Umgebung testen.
