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
node tests/t3-pdf.mjs           # PDF: Seite 1 Zeichnung / Seite 2 Aufmaß, Blatteinteilung,
                                #      Achsen auf einer Seite, Tabellenumbruch, zwei Ausgaben
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
```

Der frühere `r3-t2-grundriss.mjs` ist mit der Grundriss-Funktion entfallen:
ein Hintergrundbild unter der Zeichnung wurde auf der Baustelle nicht genutzt
und kostete in der Werkzeugleiste einen Platz, den das Zeichnen besser braucht.

Runde 4 (Aufmaß-Programm, nicht 2D-Zeichner):

```bash
node tests/r4-aufmass-positionen.mjs   # Parkplatz/Genehmigung, Umlauf-„+" mit Höhen-Übernahme,
                                       # Notizfelder (Projekt/Seite/Abschnitt), H vor L,
                                       # 50-m-Warnung je Abschnitt, Seite und über alle Seiten
```

Runde 5:

```bash
node tests/r5-bordbretter.mjs      # Bordbrett als markierte Gerüstkante: Menge aus der
                                   # tatsächlichen Kantenlänge, gedrehte Felder, keine
                                   # doppelt gezählte Kante, Tippen und Wischen,
                                   # Aufmaß je Achse, Altdaten-Übernahme
```

`r5` rechnet die Abnahmefälle nach: ein Feld 2,57 × 0,73 ergibt 2,57 m an der
langen Kante, 3,30 m mit einer kurzen Seite dazu und 6,60 m im vollen Umlauf;
drei Felder nebeneinander an der Unterseite 7,71 m. Ein um 90° gedrehtes Feld
liefert an seiner echten 2,57-m-Kante weiterhin 2,57 m (nicht 0,73 m), und eine
Kante, die sich zwei Felder teilen, zählt auch dann nur einmal, wenn sie von
beiden Feldern aus markiert wurde. Bei 1,09 m Gerüsttiefe ändert sich der
Umlauf entsprechend – die Tiefe ist keine Konstante.

Runde 6:

```bash
node tests/r6-blaetter-verbreiterung.mjs   # Blatteinteilung (so wenige Blätter wie möglich,
                                           # links → rechts), Verbreiterungen (Rahmen mit Rohr,
                                           # Modul-Abstützung), Ecken an gemeinsamen Feldanfängen,
                                           # Bordbretter über mehrere Achsen
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
  komplett); ein Umlauf an einer Außenecke wird direkt am Eck-Symbol festgelegt
  (+ Gerüsttiefe je Seite); Bordbretter rund um ein Gerüst verteilen sich auf
  alle Achsen, ohne dass eine gemeinsame Kante doppelt zählt.

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
                                    # Projekt-Sheet), leere Zeichenfläche und leere
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
Zusammenführen und einmal in der heutigen App durch. Verglichen werden alle
Rechenergebnisse: Aufmaßregeln, Ecken, Eckkorrekturen, Achsen, Flächen,
Positionen und Seitenzuordnung.

Nicht mehr verglichen werden **Bordbrett** und **PDF-Aufbau**: beide wurden
bewusst neu gebaut (Bordbrett rechnet aus der markierten Gerüstkante statt aus
dem Verlauf einer gezeichneten Linie; das Dokument besteht aus Zeichnung und
Aufmaßtabelle). Ein Vergleich könnte dort nur den gewollten Unterschied
melden – geprüft werden sie in `r5-bordbretter.mjs` und `t3-pdf.mjs`.

```bash
git worktree add /tmp/vorher <commit-vor-der-zusammenfuehrung>
node tests/ab-vergleich-2d.mjs      /tmp/vorher   # Aufmaßregeln ATV DIN 18451,
                                                  # Eckenkorrektur, Achsen, Positionen
node tests/ab-vergleich-aufmass.mjs /tmp/vorher   # Flächen, Längen, 50-m-Hinweise,
                                                  # Zusammenfassung, Angebots-PDF
```

Beide melden „rechnerisch identisch – keine einzige Abweichung", solange an der
Fachlogik nichts geändert wurde. Genau das ist die Abnahmebedingung für jede
Umbaumaßnahme an der Hülle.

`r3-t1` rechnet das Referenzbeispiel nach: drei Felder à 2,57 m an einer
Innenecke ergeben 2,57 + 2,57 + (2,57 − 0,73) = 6,98 m, die ausfüllende Achse
2,57 + 0,73 = 3,30 m, eine unbeteiligte Achse unverändert 3 × 2,57 = 7,71 m.

Jede Datei bricht beim ersten fehlgeschlagenen Test mit `ASSERT FAILED` ab.
