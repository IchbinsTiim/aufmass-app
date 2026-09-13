# Geführtes Tutorial der 2D-App – Umsetzung vom 13.09.2026

Basis: aktueller GitHub-main `9a61acd`; Arbeitszweig `claude/aufmassx-2d-tutorial-jykxnp`.

## Ist-Zustand vorher

Die 2D-App erklärte sich ausschließlich über Tooltips, Platzhaltertexte und die
Hinweiszeilen im Werkzeug-Menü. Wer sie zum ersten Mal öffnete, fand keinen
Einstieg – weder eine Hilfe-Schaltfläche noch eine Tour. Eine Hilfeseite hätte
das Problem nicht gelöst: die Bedienung ist räumlich („der Griff in der
Feldmitte", „die Karte im Menü"), und ein Text daneben zeigt auf nichts.

## Implementiert

* **„?"-Knopf** in der Werkzeugleiste der Zeichnung, rechts neben „Werkzeuge".
  Dezent (nur ein Fragezeichen, keine Füllfarbe, kein Wort), 44 px Trefferfläche.
  Er startet und beendet das Tutorial; es ist jederzeit beliebig oft startbar.
* **Elf Schritte direkt in der bestehenden Oberfläche.** Jeder Schritt dunkelt
  den Bildschirm ab, lässt genau an der Stelle des erklärten Bedienelements ein
  Loch frei und stellt eine Karte daneben: kurze Überschrift, ein bis drei
  Sätze, „Zurück", „Weiter" bzw. „Fertig", „Tutorial beenden" und die
  Fortschrittsanzeige „4 / 11" samt Balken.

  | # | Schritt | hervorgehoben wird |
  |---|---|---|
  | 1 | Felder hinzufügen | `#addSectionBtn` + das geöffnete Blatt (`#sheetSizeBtns`, eigenes Maß) |
  | 2 | Auswählen, verschieben, drehen | `#viewerPanel` (mit sichtbaren Verschiebe-/Drehgriffen) |
  | 3 | Magnet: Felder docken an | `#snapToggleBtn` |
  | 4 | Höhe und Höhenpunkte | `#wzMasse` („H links"/„H rechts", „=", „Höhe übernehmen") |
  | 5 | Mehrere Felder gemeinsam bearbeiten | `#wzAuswahl` |
  | 6 | Achsen und Positionen | `#addAchseBtn` + `#abschnittBar` |
  | 7 | Kategorien und Zusatzbauteile | `#wzBauteile` |
  | 8 | Bordbrett | `#bordbrettBtn` |
  | 9 | Zoom und Navigation | `#fitViewBtn` |
  | 10 | Speichern und Laden | „Zeichnung speichern" + Hauptmenü `#tdMenuBtn` |
  | 11 | PDF und Aufmaß | `#td-exportPdfBtn` |

* **Menüs öffnen sich von selbst.** Was ein Schritt zum Zeigen braucht, leitet
  der Ablauf aus dem Ziel ab, nicht aus einer zweiten Liste: Liegt das Ziel im
  Werkzeug-Menü, wird das Menü aufgeklappt; liegt es in einer eingeklappten
  Sektion, wird sie aufgeklappt; liegt es in einem Scroll-Bereich, wird dorthin
  gescrollt. Damit stimmt das Tutorial auch im **Handy-Modus**, in dem
  „Bordbrett" und „PDF" aus der Werkzeugleiste ins Menü umziehen
  (`syncToolbarOrt`). Schritt 1 öffnet das echte Einstellblatt „Feld
  hinzufügen" und schließt es beim Weiterblättern wieder.
* **Es ändert keine Projektdaten.** Ein unsichtbarer Deckel (`touch-action:
  none`) liegt über der Seite, solange das Tutorial läuft: kein Tipp, kein
  Wisch und kein Pinch erreicht die Zeichenfläche. Geöffnet werden nur
  Oberflächen-Zustände, und jeder davon wird beim Beenden zurückgenommen –
  Menü, eingeklappte Sektionen, das Einstellblatt und die Beispiel-Auswahl.
* **Beispiel-Auswahl.** Die Sektionen „Abmessungen", „Auswahl" und
  „Zusatzbauteile" zeigen ihre Eingabefelder nur bei vorhandener Auswahl. Hat
  der Nutzer keine, wählt das Tutorial das erste sichtbare Feld aus – damit die
  erklärten Bedienelemente wirklich zu sehen sind – und hebt die Auswahl beim
  Beenden wieder auf. Auswahl ist Ansichts-, nicht Projektzustand: sie steht in
  keiner gespeicherten Zeichnung (`aktuelleZeichnungsDaten`).
* **Abschluss wird gemerkt.** `geruest.2d.tutorial` (Namensraum der App,
  `GK.tutorial2d`) hält fest, dass das Tutorial einmal durchlaufen wurde. Daran
  hängt ausschließlich ein kleiner Hinweis-Punkt am „?"; es öffnet sich nie
  ungefragt ein Dialog. Fehlender oder voller Speicher ist unkritisch.
* **Bedienung** per Tipp, Maus und Tastatur: `←`/`→` blättern, `Esc` beendet.
  Alle Knöpfe der Karte sind mindestens 44 px hoch (Baustellen-Handschuhe).
* **Responsiv** geprüft auf Desktop, iPad quer/hoch, Smartphone hoch und einem
  320-px-Gerät: die Karte bleibt vollständig im Bild, weicht der Hervorhebung
  aus und läuft nie seitlich heraus.

## Wie die Hervorhebung gebaut ist

Das hervorgehobene Element wird **nicht angefasst** – kein `z-index`, keine
Klasse, kein Umhängen im DOM, kein Klon. Die Abdunkelung ist ein eigenes `<svg>`
über der Seite, dessen Maske an der Stelle des Elements ein Loch lässt; darüber
liegt ein Ring in der Akzentfarbe. Dadurch kann das Tutorial weder die
Stapelreihenfolge noch die Ereignis-Zuordnung noch die Zeichenlogik der App
durcheinanderbringen. Bewegt sich etwas (iPad drehen, Blatt fährt ein,
Bildschirmtastatur), wird alle 220 ms nachgemessen und nachgezogen.

## Dateien

| Datei | Rolle |
|---|---|
| `legacy-app/tutorial.js` | Ablauf, die elf Schritte, Hervorhebung, Aufräumen; Schnittstelle `window.Tutorial2D` |
| `legacy-app/tutorial.css` | „?"-Knopf, Abdunkelung, Ring, Erklärkarte – Farben und Radien aus den Design-Tokens |
| `legacy-app/index.html` | ein Knopf in der Werkzeugleiste, ein `<link>`, ein `<script>` |
| `legacy-app/core.js` | ein Speicher-Schlüssel mehr (`GK.tutorial2d`) |
| `tests/r18-tutorial.mjs` | Abnahmetest |

Keine neue Bibliothek, kein Build-Schritt, keine neue Abhängigkeit – wie im
Rest der Suite. An `viewer2d.js` wurde keine Zeile geändert; das Tutorial ruft
dessen vorhandene Funktionen auf (`openAddSheet`, `closeSheet`,
`setWerkzeugPanel`), statt sie nachzubauen.

## Test

```bash
node tests/r18-tutorial.mjs
```

Geprüft werden: der Knopf (Ort, Größe, Hinweis-Punkt, unveränderte Soll-Belegung
der Werkzeuge aus Runde 7), Start und Aufbau, die Lage des Lochs über dem
erklärten Knopf, dass die Karte die Hervorhebung nicht verdeckt, dass ein Tipp
auf die Zeichenfläche während des Tutorials nichts auslöst, alle elf Schritte
mit Überschrift, Satzzahl und echtem Ziel, das selbsttätige Öffnen von Menü und
Sektion ohne Überschreiben der gemerkten Einstellung, das vollständige Aufräumen
beim Beenden (inklusive unverändertem `aktuelleZeichnungsDaten()`), die
Touch-Bedienung danach (Fingertipp wählt ein Feld, Pinch-Zoom mit zwei Fingern),
das Merken des Abschlusses und der Neustart – dazu der komplette Durchlauf auf
Smartphone hoch, 320-px-Gerät und iPad hochkant.

## Nicht umgesetzt / bewusste Entscheidungen

* **Kein automatischer Start beim ersten Öffnen.** Auf der Baustelle wird die
  App oft mitten in einem Auftrag geöffnet; ein Tutorial, das sich dabei vor die
  Zeichnung legt, ist eine Störung. Stattdessen der Hinweis-Punkt am „?".
* **Das Tutorial legt nichts an.** Es zeigt das Blatt „Feld hinzufügen", tippt
  darin aber nichts an – es gibt keine „Übungszeichnung", die hinterher wieder
  entfernt werden müsste.
* **Schritt 2 hebt die ganze Zeichenfläche hervor**, nicht einzelne Griffe: die
  Griffe hängen am ausgewählten Feld und wandern mit ihm. Durch die
  Beispiel-Auswahl sind sie im Loch trotzdem zu sehen.
