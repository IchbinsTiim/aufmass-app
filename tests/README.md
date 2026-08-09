# Tests zum 2D-Zeichner

Browser-Tests gegen `aufmass_final_app/viewer2d.html`. Sie starten einen
kleinen statischen Server, öffnen die Seite in Chromium (Playwright) und
prüfen Verhalten statt Implementierungsdetails.

## Voraussetzungen

```bash
npm install playwright          # Chromium wird von Playwright mitgebracht
# Alternativ auf einen vorhandenen Chromium zeigen:
export PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome
```

Der PDF-Export wird gegen einen kleinen jsPDF-Ersatz (`jspdf-stub.js`)
geprüft, der alle Zeichenaufrufe protokolliert – so lässt sich der
Seitenaufbau ohne echte PDF-Erzeugung nachvollziehen.

## Ausführen

```bash
node tests/t1-abschnitte.mjs    # Abschnitte: anlegen/zuordnen/löschen, Anzeige oben links, Persistenz
node tests/t2-rotation.mjs 80   # Auswahl/Drehen ohne Verzögerung, Renderaufwand (Argument = Feldanzahl)
node tests/t3-pdf.mjs           # PDF: Mehrseitigkeit, wiederholte Kopfzeile/Legende, Tabellen, Layouts
node tests/fitcheck.mjs         # geometrischer Nachweis: kein Blattinhalt ragt in Kopf-/Fußzeile
node tests/e2e.mjs              # durchgängiger Ablauf über die Oberfläche (Vorlage → Abschnitt → Drehen → PDF)
```

Runde 2:

```bash
node tests/r2-t1-sichtbarkeit.mjs   # Abschnitte ein-/ausblenden ohne Datenverlust, PDF-Umfang
node tests/r2-t2-mehrfach.mjs       # kopiertes Feld auf Mehrfachauswahl; Zusatzbauteile mit Länge + Lagen
node tests/r2-t4-pdf-overlap.mjs    # keine Beschriftung in Legende/Fußzeile oder auf der Übersichtskarte
node tests/r2-t6-aufmass.mjs        # Aufmaßregeln nach ATV DIN 18451 (Achsmaß, Außenecke, Feldaufschlag)
```

Runde 3:

```bash
node tests/r3-t1-innenecken.mjs     # Innenecken: durchlaufende Achse −0,73 m, ausfüllende +0,73 m
node tests/r3-t2-grundriss.mjs      # Grundriss als Hintergrundebene; Eckentyp aus dem Bild ableiten
```

`r3-t1` rechnet das Referenzbeispiel nach: drei Felder à 2,57 m an einer
Innenecke ergeben 2,57 + 2,57 + (2,57 − 0,73) = 6,98 m, die ausfüllende Achse
2,57 + 0,73 = 3,30 m, eine unbeteiligte Achse unverändert 3 × 2,57 = 7,71 m.

Jede Datei bricht beim ersten fehlgeschlagenen Test mit `ASSERT FAILED` ab.
