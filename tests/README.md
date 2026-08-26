# Tests zum 2D-Zeichner und zum Aufmaß-Programm

Browser-Tests gegen die zusammengeführte Anwendung `aufmass_final_app/index.html`.
Beide Programme leben seit der Zusammenführung in dieser einen Seite und werden
über die Route angesteuert:

| Route | Modul |
|---|---|
| `index.html#/` | Startbildschirm (Hub) |
| `index.html#/aufmass` | Modul 1 – Aufmaß / Positionserfassung |
| `index.html#/2d` | Modul 2 – 2D-Aufmaß / Gerüst-Zeichnung |

`harness.open()` öffnet `#/2d`, `harness.openAufmass()` öffnet `#/aufmass`.
Die Tests starten einen kleinen statischen Server, öffnen die Seite in Chromium
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

Runde 6:

```bash
node tests/r6-blaetter-verbreiterung.mjs   # Blatteinteilung (so wenige Blätter wie möglich,
                                           # links → rechts), Verbreiterungen (Rahmen mit Rohr,
                                           # Modul-Abstützung), Ecken an gemeinsamen Feldanfängen,
                                           # Bordbretter-Linie über mehrere Achsen
```

`r6` deckt drei Punkte ab:

* **Blatteinteilung** – der Plan wird auf möglichst wenige Blätter verteilt und
  in Leserichtung aufgeteilt (Reihe für Reihe von oben nach unten, in der Reihe
  von links nach rechts). Ein Ring aus 40 Feldern kommt damit auf 2 statt 6
  Blätter; was auf ein Blatt passt, bleibt auf einem. Der Maßstab wird dafür
  stufenweise verkleinert (11 → 9 → 8 mm je Meter), aber nur so weit, wie es
  ein Blatt spart – und die Beschriftungen dürfen sich dabei nicht überlagern.
* **Verbreiterungen** – „Rahmen mit Rohr" (Strebendreieck an der offenen
  Feldseite) und „Modul-Abstützung" (gestricheltes Zusatzfeld mit eigener
  Länge/Breite/Höhe, leere Eingaben erben die Maße des Feldes).
* **Ecken/Bordbretter** – eine Ecke wird auch dort erkannt, wo zwei Felder am
  SELBEN Punkt beginnen oder enden (vorher fehlte dort die ±-Gerüsttiefe
  komplett); eine Bordbretter-Linie wirkt auf alle Achsen, an denen sie
  entlangläuft; ein Umlauf an einer Außenecke lässt sich direkt an der Ecke
  festlegen (+ Gerüsttiefe je Seite), ohne eine Linie zu zeichnen.

Runde 7 (Shell der zusammengeführten App):

```bash
node tests/r7-shell-routing.mjs   # Hash-Routing, Deep-Link, Neuladen, Zurück-Button,
                                  # Zustandserhalt beim Modulwechsel, Speicher-Migration,
                                  # Namensraum-Sauberkeit, 44-px-Trefferflächen
```

Runde 8 (Zeichnungsübersicht des 2D-Moduls):

```bash
node tests/r8-2d-projektliste.mjs   # Ordnerstruktur, Suche, Auswahl öffnet die
                                    # richtige Zeichnung, Wechseln, Zurück-Button
```

Runde 9 (Zeichnungen anlegen und löschen):

```bash
node tests/r9-2d-zeichnungen.mjs    # „Neue Zeichnung" (Liste, Leerzustand,
                                    # Datei-Menü), leere Zeichenfläche und leere
                                    # Undo-History, Persistenz über den Reload,
                                    # Löschen einzeln/mehrfach mit Bestätigung
                                    # und „Rückgängig", Editor schließt beim
                                    # Löschen der offenen Zeichnung, Speichern-
                                    # Dialog, Umbenennen/Duplizieren/Verschieben,
                                    # Ordner anlegen/löschen, Fotos ohne Projekt
```

`r9` prüft ausdrücklich, dass gelöschte Zeichnungen nach einem Reload nicht
wieder auftauchen und dass keine verwaisten Datensätze zurückbleiben: die
Projektfotos (IndexedDB) fallen mit der Zeichnung weg – aber erst nach Ablauf
der Rückgängig-Frist, damit „Rückgängig" die Zeichnung samt Bildern zurückholt.
Fotos, deren Projekt es nicht mehr gibt, räumt der Start des Moduls auf.

## Nachweis „rechnerisch identisch"

Zwei Vergleichsläufe rechnen dasselbe Aufmaß einmal in der Fassung **vor** dem
Zusammenführen und einmal in der zusammengeführten App durch. Verglichen werden
alle Rechenergebnisse **und jeder einzelne Zeichenaufruf des PDF-Exports**
(Text, Position, Reihenfolge, Seite).

```bash
git worktree add /tmp/vorher <commit-vor-der-zusammenfuehrung>
node tests/ab-vergleich-2d.mjs      /tmp/vorher   # Aufmaßregeln ATV DIN 18451,
                                                  # Eckenkorrektur, Bordbretter, Plan-PDF
node tests/ab-vergleich-aufmass.mjs /tmp/vorher   # Flächen, Längen, 50-m-Hinweise,
                                                  # Zusammenfassung, Angebots-PDF
```

Beide melden „rechnerisch identisch – keine einzige Abweichung", solange an der
Fachlogik nichts geändert wurde. Genau das ist die Abnahmebedingung für jede
Umbaumaßnahme an der Hülle.

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
