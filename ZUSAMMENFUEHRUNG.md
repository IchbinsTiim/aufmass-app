# Zusammenführung: Aufmaß + 2D-Aufmaß zu einer Suite

Beide Programme laufen ab sofort unter **einem Link** in **einer Anwendung**.
Einstiegspunkt ist `aufmass_final_app/index.html`.

```
#/            Startbildschirm (Hub) – Auswahl zwischen den Modulen
#/aufmass     Modul 1 – Aufmaß: Positionen erfassen & kalkulieren
#/2d          Modul 2 – 2D-Aufmaß: Gerüst zeichnen & PDF erzeugen
```

Deep-Link, Neuladen und der Zurück-Button des Browsers landen immer in der
richtigen Ansicht. Der Modul-Umschalter (Pille oben links) ist überall sichtbar
und trägt die Farbe des aktiven Moduls.

---

## 1. Architektur

Ein Dokument, drei Ansichten. Beide Module bleiben nach dem ersten Öffnen im
Dokument und werden nur sichtbar bzw. unsichtbar geschaltet – deshalb bleibt der
komplette Zustand beim Wechsel erhalten (Zeichnung, Zoom, Auswahl, Abschnitte,
Formularinhalte, geöffnetes Projekt). Beim Verlassen schreibt jedes Modul seine
gebündelten Änderungen sofort weg; nur beim echten Verlassen der Seite fragt der
Browser nach.

### Dateien

| Datei | Rolle | Herkunft |
|---|---|---|
| `index.html` | **einziger Einstiegspunkt**: Hub + beide Modulansichten + Umschalter | neu (enthält das Markup beider Alt-Apps) |
| `core.js` | gemeinsame Basis: Speicher-Schlüssel, Migration, Toast (auch mit „Rückgängig"), Aktionsmenü, Datenmeldung zwischen den Modulen, Zahlenformat | neu |
| `core.css` | Design-Tokens: Farben, Schriften, Radien, Tiefe, Bewegung | neu |
| `shell.js` | Hash-Routing, Modul-Lebenszyklus, Hub-Kennzahlen, Auswahl-Dialog | neu |
| `shell.css` | Hub, Kacheln mit Vorschau, Umschalter, Ansichtswechsel | neu |
| `theme.css` | Oberflächen-Überarbeitung beider Module (eigene Ebene) | neu |
| `script.js` | **Modul 1** – Fachlogik unverändert | bestand |
| `style.css` | Modul 1 + gemeinsame Bauteile (Buttons, Formulare, Toast) | bestand |
| `viewer2d.js` | **Modul 2** – Fachlogik unverändert | bestand |
| `viewer2d.css` | Modul 2, auf das aktive Modul eingegrenzt | bestand |
| `viewer2d.html`, `start.html` | Weiterleitungen für alte Lesezeichen | reduziert |
| ~~`start.js`~~ | entfällt – Aufgabe übernimmt `shell.js` | entfernt |

Sechs Dateien statt einer großen: die Trennung verläuft entlang der Zuständigkeit
(Tokens / Hülle / Oberfläche / Modul 1 / Modul 2). Kein Framework, kein
Build-Schritt, keine zusätzliche Abhängigkeit – die Bestands-Apps kamen ohne aus,
die Suite kommt es auch.

### Isolation

* **JavaScript** – die vier echten Namenskollisionen sind aufgelöst (siehe § 3).
  Jedes Modul stellt der Shell eine schmale Schnittstelle bereit
  (`AufmassModul` / `ZweiDModul` mit `mount` · `aktiviere` · `deaktiviere` ·
  `hatUngespeicherte`).
* **CSS** – jede Regel aus `viewer2d.css` ist auf `body[data-modul="2d"]`
  eingegrenzt (388 Selektoren, maschinell umgestellt). `style.css` bleibt die
  gemeinsame Basis, so wie es die 2D-App schon vorher genutzt hat.
* **Element-IDs** – im gemeinsamen Dokument gibt es keine doppelte ID
  (per Test geprüft).
* **Speicher** – alle Schlüssel im Namensraum `geruest.*` (siehe § 4).

---

## 2. Funktionsliste – Bestandsaufnahme und Abnahme

Alles unten Aufgeführte war vorher da und ist nachher da. ✅ = in der
zusammengeführten App geprüft.

### Modul 1 – Aufmaß

**Projektübersicht**

| Funktion | |
|---|---|
| Neues Projekt anlegen | ✅ |
| Suche über Name, Kunde, Adresse | ✅ |
| Status-Filter (alle / in Bearbeitung / abgeschlossen / archiviert) | ✅ |
| Sortierung (zuletzt geändert / alphabetisch) | ✅ |
| Ordnerleiste: „Alle Projekte", „Ohne Ordner", je Ordner, „+ Ordner" | ✅ |
| Ordner anlegen / umbenennen / löschen | ✅ |
| Projektkarte: Typ-Marke, Status, Name, Bauherr, Adresse, Telefon, Verwendungszweck-Tags, Kennzahlen (Seiten · Felder · m²), Erstellt/Geändert | ✅ |
| ⋯-Menü: Öffnen · Umbenennen · Duplizieren · In Ordner verschieben · Status ändern · Löschen | ✅ |
| ⋯-Menü: **„Öffnen mit…"** (Auswahl Aufmaß/2D) | ✅ neu platziert, s. § 6 |
| Leerzustände „Keine Projekte" / „Keine Treffer" | ✅ |
| Backup-Erinnerung nach 7 Tagen, „Jetzt exportieren", 3 Tage später erinnern | ✅ |
| Gesamt-Backup aller Projekte (JSON) | ✅ zusätzlich vom Hub aus erreichbar |

**Projektakte**

| Funktion | |
|---|---|
| Zurück · Projekttitel · Projekt löschen | ✅ |
| Projektname, Status (3 Zustände) | ✅ |
| Anschrift: Straße, Nr., PLZ, Ort, Bauherr, Telefon | ✅ |
| Gerüsttyp Fassade / Dach / Sonder (+ freie Bezeichnung) | ✅ |
| Technik DIN 18451: Lastklasse 1–6, Breitenklasse W06/W09/W12 | ✅ |
| Verwendungszweck – Mehrfachauswahl (Fenster, Maler, Putz, Klempner, Dach, WDVS) | ✅ |
| Verankerungsgrund, Ankeranzahl | ✅ |
| Logistik: Anfahrt km mit Auto-Berechnung, Untergrund, Stellflächen-Notiz | ✅ |
| Transport: LKW→Objekt, Höhenmeter, Treppen | ✅ |
| Schalter: Öffentlicher Grund, Verkehrssicherung, Genehmigung, Parkplatz | ✅ |
| 2D-Zeichnung: Kennzahlen + „2D-Ansicht öffnen" | ✅ |
| Hausseiten: „+ Seite" oben und unten | ✅ |
| Standard-Zuschlag der „+"-Taste (projektweit) + individueller Zuschlag je Maßfeld | ✅ |
| Seite: Name (Auswahl oder manuell), Notiz, Wandabstand, WDVS | ✅ |
| Abschnitte je Seite: Bezeichnung, Einzelfeld (Mindestmaß 2,50 m), Giebel (zwei Höhen), Notiz | ✅ |
| Messungen H × L, mehrere je Abschnitt, „+ Maß", duplizieren, löschen | ✅ |
| Laser-Höhenkorrektur je Höhenfeld: +1,60 m · +2,00 m · +3,60 m, zurücksetzbar (nur Höhen) | ✅ |
| Zubehör: Konsolen (0/19/30/50/70/109 cm + Dachfang), Lagen L1–L3, Länge automatisch oder frei | ✅ |
| Zubehör: Treppenturm, Dachfang, Gitterträger, Fußgängertunnel, Netze, KS-Wert | ✅ |
| Kennzahlen je Seite: Fläche, Länge, größte Höhe | ✅ |
| 50-m-Hinweis (Treppenturm) je Abschnitt, je Seite und über alle Seiten | ✅ nur in der App, nicht mehr im PDF |
| Treppenturm-Hinweis an der Position selbst (was beim Aufmaß zu beachten ist) | ✅ |
| Positionen: 16 Arten, Menge, Einheit (m · m² · Stk.), Notiz, Pauschal-Arten | ✅ |
| Notizen auf drei Ebenen: Projekt, Hausseite, Abschnitt | ✅ |
| Zusammenfassung: Tabelle je Seite + Gesamtfläche | ✅ |
| Speichern · PDF erstellen · JSON exportieren · JSON laden | ✅ |
| Automatisches Speichern (gebündelt) | ✅ + sofortiges Schreiben beim Modulwechsel |

### Modul 2 – 2D-Aufmaß

**Hauptleiste** – nur, was beim Zeichnen selbst ständig gebraucht wird

```
[←] Projektname [⌄]  |  + Feld  |  + Achse  |  ↶ ↷  |  Alle  |  Magnet  |  Bordbrett  |  PDF  |  Werkzeuge  |  [Fläche m²] [Bordbrett m]
```

| Funktion | |
|---|---|
| Rücksprung, Name der Zeichnung | ✅ |
| **Hauptmenü** hinter dem Projektnamen: Gerüsttiefe, Vorlagen, Zeichnung wechseln, Datei | ✅ |
| Feld hinzufügen | ✅ |
| **Achse hinzufügen** – ein Tipp, keine Rückfrage | ✅ |
| Rückgängig / Wiederholen (Stapel, 60 Schritte) | ✅ |
| Alle Felder anzeigen · Magnet | ✅ |
| Bordbrett | ✅ |
| PDF | ✅ |
| **Werkzeuge (Pfeil-Knopf)** – klappt das Werkzeug-Panel auf und zu | ✅ |
| Gesamtfläche, Bordbrett-Summe, Hinweis-Zähler | ✅ |

Der frühere Knopf **„Projekt"** ist aus der Leiste verschwunden; seine Inhalte
liegen unverändert im Hauptmenü oben links. Der Knopf **„Mehrere auswählen"**
ist ersatzlos entfallen – die Mehrfachauswahl entsteht jetzt aus der Geste
(siehe *Zeichenfläche*).

Bei schmalerem Viewport fallen sekundäre Knöpfe auf ihr Symbol zusammen;
**„+ Feld", „+ Achse" und „Bordbrett" behalten immer ihr Wort**. Reicht die
Breite nicht, bricht die Leiste in eine zweite Zeile um – kein Knopf wird
weggescrollt und keiner schrumpft unter 44 px.

Im Handy-Modus ziehen **Bordbrett und PDF** ins Werkzeug-Panel um – dieselben
Knöpfe, nur an einem Ort, an dem sie nicht aus dem Bildschirm laufen. Es gibt
keine zweite PDF-Taste.

**Werkzeug-Panel** – rechts angedockt, feste Breite 360 pt, sauber scrollbar

Sticky-Kopf mit Titel „Werkzeuge", Griff und Schließen-X; darunter der
Scrollbereich mit oberem und unterem Sicherheitsabstand. Ein Wisch nach rechts
auf dem Kopf schließt es. **Jede Sektion ist einzeln einklappbar** (der
Zustand steht in `geruest.2d.wzSektionen`). Angedockt überdeckt es die
Zeichnung nicht – die schiebt sich beim Öffnen nach links.

| Sektion | Funktion | |
|---|---|---|
| **1 Auswahl** | Zähler, welche Felder aktiv sind, Richtung N/O/S/W, Länge, Höhe | ✅ |
| Auswahl | Alle Felder auswählen · Auswahl aufheben · bei Einzelauswahl „Feld bearbeiten" | ✅ |
| Auswahl | ganze Achse auswählen · alle Felder eines Bauteils auswählen | ✅ |
| **2 Abmessungen** | Feldlänge (Schnellwahl + freie Eingabe) | ✅ |
| Abmessungen | Höhe links/rechts, „="-Kopplung, Höhe aus Auswahl übernehmen | ✅ |
| Abmessungen | Gerüsttiefe der ganzen Zeichnung | ✅ |
| **3 Zusatzbauteile** | alle Bauteile als gleich große Karten im 2-spaltigen Raster | ✅ |
| Zusatzbauteile | Farbe kodiert den ZUSTAND (aktiv/inaktiv), nicht den Typ | ✅ |
| Zusatzbauteile | aktive Karten mit Häkchen und Wert als Untertitel („Konsole 0,30 · 4 Lagen · 10,28 m") | ✅ |
| Zusatzbauteile | jede Karte öffnet ihr Einstellblatt für Länge bzw. Lagen – auch die Konsole | ✅ |
| **4 Aktionen** | Kopieren · Einfügen (Umfang wählbar) · Duplizieren · Löschen | ✅ |
| Aktionen | Vorlage auf Auswahl anwenden · Auswahl spiegeln | ✅ |
| Achsen | Achse anlegen, umbenennen, löschen, ein-/ausblenden, Zähler, Farbe | ✅ |
| Achsen | Achse für die Auswahl zuweisen bzw. entfernen, aktive Achse markiert | ✅ |
| Felder | die Feldliste (im Handy-Modus; sonst links) | ✅ |
| Ansicht | Automatisch / Handy / Tablet | ✅ |

Alle Sektionen steuern dieselbe Kernlogik an (`bulkMode`/`bulkSelected`,
`state.abschnitte`, `POSITIONS`). Das Panel ist reine Oberfläche: Zuklappen
ändert weder die Auswahl noch die markierten Felder.

**Achse und Abschnitt sind EIN Ding.** Es gab nie zwei Objekte – nur zwei
Namen für dasselbe (`state.abschnitte`): der Knopf hieß „+ Achse", der Dialog
fragte nach dem „Namen der Achse / des Abschnitts", die Chips sagten „Ohne
Abschnitt". Nach außen heißt es jetzt durchgängig **Achse**. Der interne
Begriff `achsenListe()` bleibt davon unberührt: das ist die aus der Geometrie
abgeleitete Wand (Kette gleich gerichteter Felder), kein Bedienelement.

**Feldliste** (links; im Handy-Modus im Werkzeug-Panel)

Sie lässt sich **ein- und ausklappen**: über den schmalen Griff (28 px) mit
Chevron am Rand oder per Wisch – nach links klappt ein, nach rechts aus.
Eingeklappt bleibt nur der Streifen stehen, die volle Zeichenfläche gehört der
Zeichnung. Der Zustand steht in `geruest.2d.feldliste` und überlebt damit
Sitzung und Projektwechsel.

| Funktion | |
|---|---|
| Feldzeile: Länge, Höhe links/rechts mit „="-Kopplung, Standardlängen, Warnzeichen | ✅ |
| Ankreuzfeld je Feld während der Mehrfachauswahl | ✅ |
| Achs-Marke je Feld, Hinweis auf ausgeblendete Felder | ✅ |
| Positionen je Feld, Kopieren / Einfügen (Umfang wählbar) | ✅ |
| Feld hinzufügen / entfernen, Richtung N/O/S/W, Gesamtlänge je Achse | ✅ |

**Zeichenfläche**

| Funktion | |
|---|---|
| Feld antippen → Bearbeiten-Sheet | ✅ |
| **Langes Tippen auf ein Feld** startet die Mehrfachauswahl | ✅ |
| **Zwei Finger ruhig aufliegen lassen** → Auswahlrahmen aufziehen | ✅ |
| Langes Tippen auf leere Fläche → derselbe Rahmen mit einem Finger | ✅ |
| Feld antippen in der Mehrfachauswahl → an-/abhaken | ✅ |
| Ab zwei ausgewählten Feldern: Aktionsleiste am OBEREN RAND der Zeichenfläche mit Anzahl, Höhe, Zusatzbauteilen, Kopieren, Einfügen, Löschen, Auswahl aufheben | ✅ |
| In der Mehrfachauswahl entfallen „+"-Knöpfe und Drehgriff: jeder Tipp gehört der Auswahl | ✅ |
| Kein Neuaufbau des SVG, solange ein Finger aufliegt – sonst geht der Tipp verloren | ✅ |
| Ausgewähltes Feld: kräftiger Ring in fester Bildschirmstärke + Leuchten | ✅ |
| Mehrfachauswahl: violetter Ring **und** Haken je Feld, Zahl am Werkzeug-Knopf | ✅ |
| Orangener Griff: Feld frei verschieben (mit Vorschau + Einrasten) | ✅ |
| Violetter ↻-Griff: Tipp = 90°, Ziehen = frei | ✅ |
| Blaue „+"-Knöpfe links/rechts: Feld anfügen | ✅ |
| Pan, Pinch-Zoom, Mausrad/Trackpad-Zoom, Doppeltipp-Zoom | ✅ |
| Auswahl-Info oben links (Anzahl + beteiligte Achsen) | ✅ |
| Maßstabsleiste, Eck-Symbole, Bordbrettlinien mit Anfassern | ✅ |
| Gebäudeecken als markierte Fangpunkte („Ecke") | ✅ |
| „Alle anzeigen" passt in den FREIEN Teil ein, nicht unter das offene Menü | ✅ |
| Leerhinweis mit „Feld hinzufügen" | ✅ |

**Ansicht / Handy-Modus**

| Fall | Verhalten |
|---|---|
| Wahl „Automatisch" (Vorgabe) | Handy-Modus ab ≤ 480 px Breite **oder** ≤ 450 px Höhe (liegendes Handy) |
| Wahl „Handy" | immer Handy-Modus, auch auf dem iPad |
| Wahl „Tablet" | nie Handy-Modus |
| Handy-Modus | Werkzeugleiste zweizeilig, Seitenleiste aus, Menü als Blatt von unten |
| Fenster ≤ 899 px | Menü als Blatt von unten statt angedockt |
| Fenster ≤ 520 px hoch | Menü seitlich angedockt statt von unten (liegendes Handy) |
| Fenster < 1300 px, Menü offen | die Feldliste zieht ins Menü, damit die Zeichnung Platz behält |

Die Wahl steht in `geruest.2d.ansichtsmodus`; `geruest.2d.geraetemodus` trägt
nur noch das Ergebnis. Die Vorgängerfassung las die Wahl aus demselben
Schlüssel, in den sie den erkannten Modus schrieb – wer einmal in einem
schmalen Fenster war, blieb danach überall im Handy-Modus.

**Dialoge**

| Dialog | |
|---|---|
| Feld hinzufügen (Richtung, Standardlängen, −/+, freie Länge) | ✅ |
| Feld bearbeiten (Richtung, Länge, Drehung mit Regler und 90/180/270, Achse, Höhen, Positionen, Notiz, Kopieren/Einfügen, Favoriten, Löschen) | ✅ |
| Ecken-Sheet: Umlauf je Seite festlegen | ✅ |
| Hauptmenü-Sheet: Gerüsttiefe, Vorlagen, Zeichnung wechseln, Datei | ✅ |
| Mehrfach-Positionen-Sheet (Menge/Lagen einmal für die ganze Auswahl) | ✅ |
| Konsolen-Sheet für die Auswahl (Breite, Abrechnung, Lagen bzw. Meter) | ✅ |
| Zusatzbauteil-Sheet aus der Kontextleiste (Karten-Raster) | ✅ |
| Höhen-Sheet aus der Kontextleiste | ✅ |
| **Bordbrett-Sheet: Aufmaßlänge, Lagen anlegen/ändern/löschen, Achszuordnung** | ✅ |
| PDF-Sheet: Farbe / Schwarz-Weiß, ausgeblendete Achsen einbeziehen | ✅ |

**Bordbrett** – nicht nur ein Bauteil, sondern die Aufmaßlänge einer Seite

| Funktion | |
|---|---|
| Linie auf der Feldkante ziehen; Anfang und Ende dürfen **mitten im Feld** liegen | ✅ |
| Länge live in Metern während des Ziehens | ✅ |
| Magnetisches Einrasten an Feldkanten, Feldmitten, Eckpunkten und **Gebäudeecken** – mit kleiner Toleranz übersteuerbar | ✅ |
| Feineingabe der Länge über ein Zahlenfeld | ✅ |
| Beide Endpunkte über Anfasser nachträglich verschiebbar | ✅ |
| Eine Kante antippen belegt sie ganz (wie bisher), nochmal antippen entfernt sie | ✅ |
| Antippen der Linie öffnet den Editor: Länge, Lagen, Achszuordnung | ✅ |
| **Mehrere Lagen** je Linie: anlegen, ändern, einzeln löschen; jede Lage mit eigener Länge | ✅ |
| Kennzahl oben rechts summiert über alle Lagen aller Linien | ✅ |
| Eine geometrische Kante zählt höchstens einmal (geteilte Stirnkanten) | ✅ |

**Eckensituation.** Läuft eine Achse auf eine Gebäudeecke zu, darf ihr
Bordbrett **exakt an der Ecke** enden – am Schnittpunkt der beiden
Gebäudeseiten, nicht an der äußeren Feldkante davor. Zwei Fälle:

* Zwischen den Achsen sitzt ein **Eckstück** (computeLayout bildet es
  ohnehin): dessen Kanten gehören zum Bordbrett-Kantennetz, die Linie läuft
  über sie bis an die Ecke. Die Ecklänge fällt beim angrenzenden Feld an.
* Ein Feld steht **quer über der Ecke** (der Fall aus dem Beispielfoto): dann
  gibt es kein Eckstück, aber die Ecke bleibt der Schnittpunkt der beiden
  äußeren Achslinien. Die Linie läuft über die Kante des Eckfeldes bis dorthin,
  und das Eckfeld wird **anteilig geteilt**: der Teil vor der Ecke gehört zur
  ersten Achse (mit der Höhe DIESES Feldes), der Rest zur anschließenden. Die
  anschließende Achse bekommt ihre eigene Bordbrettlinie und damit ihre eigene
  Aufmaßlänge.

**Rechnen (ATV DIN 18451)**

| Regel | |
|---|---|
| Achsmaß, Feldaufschlag, Mindestmaße | ✅ nachgerechnet |
| Außenecke **+ Gerüsttiefe**, Innenecke **− Gerüsttiefe** (dynamisch, keine Konstante) | ✅ nachgerechnet |
| Ecke auch bei zwei Feldern mit gemeinsamem Anfangs-/Endpunkt | ✅ |
| Bordbrettlinie wirkt auf jede berührte Achse, Eckenrollen automatisch | ✅ |
| Aufmaß je Gerüsthöhe getrennt zusammengefasst | ✅ |
| Gesamtfläche, Warnungen bei unvollständigen Feldern | ✅ |

Die Regeln rechnen im Hintergrund weiter, **werden aber nicht mehr
abgedruckt** und nicht mehr im PDF-Dialog eingestellt (siehe unten).

**PDF-Export**

Blatt 1 (Zeichnung) bleibt in Aufbau und Funktion. Blatt 2 ist neu.

| Bestandteil | |
|---|---|
| Kopf- und Fußzeile auf jedem Blatt („Seite X von Y"), Legende | ✅ |
| Kopfbereich mit Projektname, Datum, Bauvorhaben, Gerüsttiefe | ✅ |
| Übersichtskarte (Locator) ohne Überlagerungen | ✅ |
| Blatteinteilung: möglichst wenige Blätter, Leserichtung, Maßstabsstufen 11 → 9 → 8 mm/m | ✅ |
| Plan-Beschriftungen ohne Überlappung, nicht in Kopf/Fuß/Legende | ✅ |
| Zwei Ausgaben (Farbe, Schwarz-Weiß), Auswahl wird gemerkt | ✅ |

**Was ersatzlos entfallen ist**

| entfernt | Begründung |
|---|---|
| Regeltext nach ATV DIN 18451 („Grundlage: …") | die Korrekturlogik rechnet weiter, sie wird nur nicht mehr abgedruckt |
| Auswahlmöglichkeiten am Ende des PDF-Dialogs (Eck-/Feldzuschlag, Innenecke) | lieferten durchgehend falsche Werte; erst raus, später sauber neu |
| Position „Bordbrett" in laufenden Metern | das Bordbrett wird nicht abgerechnet, es ist die Grundlage der Aufmaßlänge |

**Blatt 2 – zwei Flächen je Achse**

```
ACHSE A                                              4 Felder     ← Kopfband (Akzentfarbe)
│ Position 1 – Gerüstfläche (gesamt)     Feldlänge × Feldhöhe     ← Zwischenüberschrift
│ Feld   Länge (m)  Höhe (m)  Fläche (m²)  Bemerkung              ← Spaltenkopf
│ A1        2,57      8,20        21,07                           ← Zebra-Streifen
│ …
│ Summe Gerüstfläche (gesamt)                    84,28 m²         ← hervorgehoben
│ Position 2 – Positionierte Gerüstfläche   Aufmaßlänge 11,01 m
│ A1        2,57      8,20        21,07
│ A5        0,73      6,00         4,38   anteilig                ← geteiltes Eckfeld
│ Summe Positionierte Gerüstfläche (Aufmaß)      88,66 m²
GESAMT ÜBER ALLE ACHSEN
```

* **Position 1** ist die ungekürzte Bruttofläche: Summe über alle Felder aus
  Feldlänge × Feldhöhe.
* **Position 2** ist die abzurechnende Fläche aus der Bordbrettlinie:
  Aufmaßlänge × Höhe des Abschnitts. Bei **einer** Höhe eine Zeile, bei
  **mehreren** Höhen feldweise aufgeschlüsselt – jedes Feld mit genau dem
  Längenanteil, den die Linie über ihm abdeckt.
* Alle Längen und Flächen auf zwei Nachkommastellen, Einheiten immer dabei.
* Zusatzbauteile (Konsole, Netz …) stehen darunter – sie sind Mengen, keine
  Flächen.

**Gestaltung.** Eine Akzentfarbe für Kopfbänder und Summen, ein zweiter
neutraler Ton für den Zeilenwechsel (Zebra), Grau für Hilfsangaben. Farbe ist
nie alleiniger Bedeutungsträger: Kopfbänder sind zusätzlich fett und invers,
Summen fett mit Oberlinie, Bemerkungen klein und grau. In der Schwarz-Weiß-
Ausgabe werden alle Farben über `pdfCol()` auf neutrale Grautöne gestaucht –
das Blatt bleibt in Graustufen und auf A4 lesbar.

**Zeichnungsübersicht (`#/2d/projekte`)**

Die Übersicht zeigt dieselben Projekte und Ordner wie das Aufmaß-Modul, aber
auf das Zeichnen zugeschnitten. Sie war zunächst nur lesend – öffnen ging,
anlegen und löschen nicht. Beides liegt jetzt hier, auf demselben Speicher und
in demselben Datenformat (ein Projektdatensatz, die Zeichnung darin unter
`zeichnung2d`); eine Migration war dafür nicht nötig.

| Funktion | |
|---|---|
| „Neue Zeichnung": Primärknopf der Übersicht, Leerzustand und Datei-Menü – immer sichtbar, nie gesperrt | ✅ |
| Anlege-Dialog: Namensvorschlag + Zielordner (vorbelegt), Anlegen öffnet die leere Zeichnung sofort | ✅ |
| Löschen je Zeichnung über ⋯-Menü und Rechtsklick, mit Nennung des Namens | ✅ |
| Mehrfachauswahl mit Sammel-Löschen | ✅ |
| Toast mit „Rückgängig"; erst nach Ablauf der Frist fallen auch die Projektfotos weg | ✅ |
| Gelöschte offene Zeichnung → Editor schließt sauber, zurück zur Übersicht | ✅ |
| Umbenennen, Duplizieren, zwischen Ordnern verschieben | ✅ |
| Ordner anlegen, umbenennen, löschen (Inhalt wandert nach „Ohne Ordner") | ✅ |
| Ungespeicherte Änderungen → Speichern / Verwerfen / Abbrechen | ✅ |

**Zustandsisolierung beim Dokumentwechsel**

Ein Dokumentwechsel läuft über genau eine Stelle (`oeffneZeichnung`), die
`resetState2d()` aufruft: Zeichenobjekte, Gerüstfelder, Achsen, Abschnitte,
Auswahl und Mehrfachauswahl, Zwischenablage, Undo-/Redo-Stapel, laufende
Gesten, Bordbrett-Modus samt seiner Event-Listener, Kamera und Zoom werden
dabei vollständig geleert. Das Werkzeug-Menü bleibt bewusst außen vor: es ist
Oberfläche, kein Dokumentzustand – ein Wechsel klappt es nicht zu. Ein ausstehender Autosave gehört zum
alten Dokument und wird vorher ausgeführt oder verworfen – er kann nie in das
neue hineinschreiben.

---

**Tastatur**

| Kürzel | |
|---|---|
| `Strg/Cmd + Z` rückgängig | ✅ |
| `Strg/Cmd + Umschalt + Z` bzw. `Strg/Cmd + Y` wiederholen | ✅ |
| `R` / `Umschalt + R`: ausgewähltes Feld um ±90° drehen | ✅ |
| Kürzel greifen bewusst nicht in Text-/Zahlenfeldern | ✅ |

---

## 3. Aufgelöste Namenskollisionen

Ein maschineller Abgleich aller Bezeichner auf oberster Ebene (128 in `script.js`,
402 in `viewer2d.js`) ergab **genau vier** echte Kollisionen. Alle vier hätten im
gemeinsamen Dokument sofort zum Abbruch geführt oder still falsch gerechnet.

| Bezeichner | Problem | Lösung |
|---|---|---|
| `CURRENT_PROJECT_STORAGE_KEY` | in beiden Modulen als `const` deklariert (gleicher Wert) → doppelte Deklaration | steht einmal in `core.js`, beide nutzen ihn |
| `showToast` / `toastTimer` | zwei identische Kopien | eine gemeinsame Fassung in `core.js` |
| `KONSOLE_TYPES` | **verschiedene Wertelisten**: Modul 1 `0/19/30/50/70/109` (cm), Modul 2 `0,19 … 1,09` (m) | Modul 2 heißt jetzt `KONSOLE_TYPES_2D` |
| DOM-ID `exportPdfBtn` | in beiden Modulen vergeben (Angebots-PDF vs. Plan-PDF) | Modul 2: `td-exportPdfBtn` |

Dazu eine CSS-Kollision: `.empty-state` ist in beiden Stylesheets definiert
(Modul 1: zentrierter Block, Modul 2: Flex-Spalte). Durch die Eingrenzung von
`viewer2d.css` auf das aktive 2D-Modul schlägt keine der beiden Fassungen mehr in
das jeweils andere Modul durch – per Test abgesichert.

---

## 4. Datenmigration

Beim ersten Start nach dem Zusammenführen zieht `core.js` die vorhandenen Daten
in den neuen Namensraum um und entfernt den alten Schlüssel. Ist der neue
Schlüssel bereits belegt, hat er Vorrang – die Migration überschreibt nie neuere
Daten. **Es geht nichts verloren.**

| vorher | nachher |
|---|---|
| `aufmass_projects_v2` | `geruest.aufmass.projekte` |
| `aufmass_folders_v1` | `geruest.aufmass.ordner` |
| `aufmass_current_project_id` | `geruest.app.aktuellesProjekt` |
| `aufmass_ueberstand_wert` | `geruest.aufmass.ueberstandWert` |
| `aufmass_last_backup_ts` | `geruest.aufmass.letztesBackup` |
| `aufmass_backup_reminder_dismissed_until` | `geruest.aufmass.backupErinnerungBis` |
| `av_2d_favorites_v1` | `geruest.2d.favoriten` |
| `av_2d_paste_opts_v1` | `geruest.2d.einfuegenOptionen` |
| `av_2d_pdf_theme` | `geruest.2d.pdfDesign` |
| `av_2d_pdf_include_hidden` | `geruest.2d.pdfMitAusgeblendeten` |
| `av_deviceMode` | `geruest.2d.geraetemodus` |

Zwei Schlüssel sind seit der Werkzeug-Menü-Überarbeitung hinzugekommen; sie
haben keine Vorgänger und beginnen leer:

| Schlüssel | Inhalt |
|---|---|
| `geruest.2d.ansichtsmodus` | die Wahl des Nutzers: `auto` (Vorgabe) · `handy` · `tablet` |
| `geruest.2d.werkzeugMenue` | Werkzeug-Panel offen (`1`) oder zu (`0`) |
| `geruest.2d.feldliste` | Feldübersicht links ausgeklappt (`1`, Vorgabe) oder eingeklappt (`0`) |
| `geruest.2d.wzSektionen` | welche Sektionen des Werkzeug-Panels eingeklappt sind |

**Bordbretter in der Zeichnung.** Das Datenmodell ist gewachsen; ältere
Zeichnungen werden beim Laden EINMAL überführt, verlustfrei und ohne Zutun:

| Fassung | Feld | Übernahme |
|---|---|---|
| ältestes | `state.bordbretter` – frei gezeichnete Linien | alle Kanten, die vollständig unter der Linie liegen, werden markiert |
| bisher | `state.bordbrettKanten` – markierte ganze Kanten | gleich liegende Kanten werden entdoppelt und zu ZUSAMMENHÄNGENDEN Ketten verbunden |
| jetzt | `state.bordbrettLinien` – Linien mit Lagen | `{ id, stuecke: [{ b, k, t0, t1 }], lagen: [{ id, laenge }], achsId }` |

Aus vier nebeneinanderliegenden Kanten wird so EINE Linie mit einer
Aufmaßlänge statt vier Einzelstücken. Die Längen bleiben dabei exakt erhalten –
es geht kein Meter verloren.

Die Projekt-Fotos liegen unverändert in der IndexedDB-Datenbank `av2d_photos_db`
(siehe § 6).

---

## 5. Verifikation

```bash
npm install playwright
node tests/<datei>.mjs
```

**19 Testdateien, alle grün.** Neu ist `r12-runde7`: es geht die Abnahmeliste
dieser Runde Punkt für Punkt durch – Soll-Belegung der Werkzeugleiste, das
Hauptmenü hinter dem Projektnamen, „+ Achse" in einem Schritt, ein einziger
Begriff für Achse/Abschnitt, die vier Sektionen des Werkzeug-Panels samt
gleich großer Bauteil-Karten, die ein-/ausklappbare Feldübersicht mit
gemerktem Zustand, mehrere Bordbrettlagen, ein Bordbrett mit freiem Anfang und
Ende, den Eckfall aus dem Beispielfoto (Bordbrett endet an der Gebäudeecke,
Eckfeld anteilig geteilt, anschließende Achse mit eigener Aufmaßlänge) und das
neue Blatt 2 – bis hin zum Nachweis, dass die Schwarz-Weiß-Ausgabe
ausschließlich neutrale Grautöne verwendet.

`r10-werkzeugmenue` prüft
die Werkzeug-Menü-Überarbeitung: den Pfeil-Knopf, die Mehrfachauswahl über den
Plan (fünf Felder → gemeinsame Höhe 9,40 m → Achse → Position), das Fortbestehen
der Auswahl über das Zuklappen hinweg, Speichern/Laden, das PDF und den
Handy-Modus. Sechs Bildschirmgrößen (Desktop, iPad quer/hoch, Smartphone
hoch/quer, 320 px) werden nachgemessen statt beschrieben: kein Knopf darf aus
dem Bild ragen, keiner unter 36 px schrumpfen, und bei offenem Menü müssen
mindestens 140 px Zeichenfläche frei bleiben. Ein eigener Abschnitt tippt auf
jedem dieser Bildschirme sechs Felder nacheinander an und prüft, dass sechs
markiert sind – das war vorher nur auf breiten Bildschirmen verlässlich.

Zusätzlich zwei A/B-Vergleiche gegen die Fassung **vor** dem Zusammenführen. Sie
rechnen dasselbe Aufmaß in beiden Ständen durch und vergleichen jede Rechengröße
sowie **jeden einzelnen Zeichenaufruf des PDF-Exports** (Text, Position,
Reihenfolge, Seite):

```bash
git worktree add /tmp/vorher <commit-vor-der-zusammenfuehrung>
node tests/ab-vergleich-2d.mjs      /tmp/vorher   # 403 Zeichenaufrufe – identisch
node tests/ab-vergleich-aufmass.mjs /tmp/vorher   #  83 Zeichenaufrufe – identisch
```

Beide melden: *rechnerisch identisch – keine einzige Abweichung.* Damit ist
belegt, dass Aufmaßregeln, Eckenkorrektur und PDF-Ausgabe unverändert sind.

---

## 6. Bewusste Abweichungen und offene Punkte

**1 · „Öffnen mit…" ist umgezogen.**
Der frühere Startbildschirm (`start.html`) fragte bei *jedem* Antippen eines
Projekts „Aufmaß oder 2D-Aufmaß?". In der Suite hat der Nutzer das Modul bereits
am Hub gewählt – die Rückfrage wäre ein Klick zu viel. Die Projektkarte öffnet
daher direkt die Projektakte (so wie in der bisherigen `index.html`), und der
Auswahl-Dialog steckt unverändert im ⋯-Menü als **„Öffnen mit…"**. Damit lässt
sich ein Projekt aus der Liste heraus weiterhin direkt in der 2D-Zeichnung
öffnen. Nichts entfällt, der Weg ist nur einen Schritt tiefer.

**2 · Die Zeichenfläche bleibt hell.**
Die Suite ist dunkel gehalten, der Plan selbst nicht: er ist die Papierfläche,
die genau so im PDF landet, und alle Zeichnungsfarben (Achsen, Ecken,
Bordbretter, Warnungen) sind auf hellen Grund abgestimmt. Ein dunkler Plan hätte
entweder den PDF-Abgleich gekostet oder die Farbcodierung. Dunkle Werkzeuge,
helles Blatt – wie am Zeichenbrett.

**3 · Klassen-Präfixe als Eingrenzung statt als Umbenennung.**
Gefordert waren CSS-Präfixe `am-`/`td-`. Umgesetzt ist die Eingrenzung über die
Modul-Wurzeln `#am-root` / `.am-scope` bzw. `body[data-modul="2d"]` /
`#td-root` / `.td-scope`. Der Zweck – kein Durchschlagen zwischen den Modulen –
ist vollständig erreicht und getestet. Ein Umbenennen aller ~600 Klassennamen
hätte zusätzlich jede Zeichenkette in beiden JS-Dateien anfassen müssen: viel
Risiko an der Fachlogik für null Gewinn an Isolation.

**4 · Die Modul-Bezeichner bleiben global.**
Beide Module halten ihre Funktionen weiterhin im globalen Namensraum; sie
kollidieren nachweislich nicht (§ 3) und die Modul-Schnittstellen zur Shell sind
gekapselt. Eine echte Kapselung in einen IIFE hätte die 15 Testdateien
unbrauchbar gemacht, die genau über diese Bezeichner prüfen – und damit den
Nachweis „keine Funktion verschwindet" zerstört, den sie liefern.

**5 · Projekt-Fotos behalten ihre Datenbank.**
`av2d_photos_db` (IndexedDB) wurde nicht umbenannt. Ein Umbenennen hieße, alle
gespeicherten Fotos zu kopieren; der Gewinn wäre kosmetisch, das Risiko real.

**6 · Webschriften kommen aus dem Netz.**
Space Grotesk, Inter und JetBrains Mono werden von Google Fonts nachgeladen –
asynchron, mit vollständigen Ersatzschriften. Ohne Verbindung (Baustelle,
Funkloch) startet die App sofort mit den Systemschriften. Wer die Schriften auch
offline haben will, legt die Dateien lokal ab und ersetzt den `<link>`.
