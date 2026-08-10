# Tests zum 2D-Zeichner und zum Aufmaß-Programm

Browser-Tests gegen `aufmass_final_app/viewer2d.html` (2D-Zeichner) und
`aufmass_final_app/index.html` (Aufmaß-Programm, Positionserfassung). Sie
starten einen kleinen statischen Server, öffnen die Seite in Chromium
(Playwright) und prüfen Verhalten statt Implementierungsdetails.

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

Runde 4 (Aufmaß-Programm, nicht 2D-Zeichner):

```bash
node tests/r4-aufmass-positionen.mjs   # Parkplatz/Genehmigung, Umlauf-„+" mit Höhen-Übernahme,
                                       # Notizfelder (Projekt/Seite/Abschnitt), H vor L,
                                       # 50-m-Warnung je Abschnitt, Seite und über alle Seiten
```

Runde 5:

```bash
node tests/r5-bordbretter.mjs      # Bordbretter-Linie zeichnen (Snapping an Feldkanten),
                                   # einer Achse zuordnen, Ecken automatisch korrigieren
                                   # (Innenecke − / Außenecke + Gerüsttiefe);
                                   # Aufmaß je Gerüsthöhe getrennt zusammengefasst
```

`r5` prüft das Testbeispiel bei 0,73 m Gerüsttiefe: eine Achse, deren
Bordbretter-Linie durch eine Innenecke läuft, verliert am letzten Feld vor der
Ecke 0,73 m (2,57 + 2,57 + (2,57 − 0,73) = 6,98 m); eine Achse, deren Linie um
eine Außenecke herumläuft, gewinnt am Feld an der Ecke 0,73 m
(2,57 + (2,57 + 0,73) = 5,87 m). Bei 1,09 m Gerüsttiefe wird entsprechend um
1,09 m korrigiert – der Wert ist keine Konstante. Zusätzlich: 10 Felder à
2,57 m auf einer Seite, davon 5 mit 10,20 m und 5 mit 8,20 m Höhe, erscheinen
im PDF getrennt als 12,85 m × 10,20 m und 12,85 m × 8,20 m.

`r3-t1` rechnet das Referenzbeispiel nach: drei Felder à 2,57 m an einer
Innenecke ergeben 2,57 + 2,57 + (2,57 − 0,73) = 6,98 m, die ausfüllende Achse
2,57 + 0,73 = 3,30 m, eine unbeteiligte Achse unverändert 3 × 2,57 = 7,71 m.

Jede Datei bricht beim ersten fehlgeschlagenen Test mit `ASSERT FAILED` ab.
