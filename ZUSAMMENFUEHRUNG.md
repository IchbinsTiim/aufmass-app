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
| Achsen | Achse anlegen, **inline umbenennen**, löschen, ein-/ausblenden, Zähler, Farbe | ✅ |
| Achsen | Achse für die Auswahl zuweisen bzw. entfernen, aktive Achse markiert | ✅ |
| Felder | die Feldliste (im Handy-Modus; sonst links) | ✅ |
| Ansicht | Automatisch / Handy / Tablet | ✅ |

Alle Sektionen steuern dieselbe Kernlogik an (`bulkMode`/`bulkSelected`,
`state.abschnitte`, `POSITIONS`). Das Panel ist reine Oberfläche: Zuklappen
ändert weder die Auswahl noch die markierten Felder.

**Der Achsname ist ein reines Anzeigeattribut.** Jede Verknüpfung läuft über
die **Achsen-ID**: Feld → Achse (`bay.abschnittId`), Bordbrett → Achse
(`linie.achsId`), die Gruppierung im PDF (`aufmassGruppen()`) und die Farbe.
Der Name lässt sich deshalb jederzeit ändern – auch wenn längst Felder,
Bordbretter und Aufmaßzahlen daran hängen; nichts davon wird berührt.
Bearbeitet wird ohne Dialog: in der Achsenliste ist das Namensfeld ein
Eingabefeld, auf der Zeichenfläche öffnet **langes Tippen auf das Achslabel**
dasselbe Feld an Ort und Stelle. Ein leerer Name ist zulässig und wird als
„Achse {n}" angezeigt; doppelte Namen sind erlaubt, bekommen aber einen
dezenten Hinweis, weil das PDF dann zwei gleich betitelte Blöcke erzeugt.

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
| Feld antippen in der Mehrfachauswahl → an-/abhaken (Toggle) | ✅ |
| Auswahlrahmen nimmt DAZU – eine bestehende Auswahl bleibt erhalten | ✅ |
| Auswahl bleibt nach einer Aktion stehen; geleert wird sie nur über „Auswahl aufheben" oder einen Tipp auf leere Fläche | ✅ |
| Ab EINEM ausgewählten Feld: Aktionsleiste am UNTEREN RAND über die volle Breite mit Anzahl, Höhe, Zusatzbauteilen, Kopieren, Einfügen, Löschen, Auswahl aufheben | ✅ |
| In der Mehrfachauswahl entfallen „+"-Knöpfe und Drehgriff: jeder Tipp gehört der Auswahl | ✅ |
| Kein Neuaufbau des SVG, solange ein Finger aufliegt – sonst geht der Tipp verloren | ✅ |
| Ausgewähltes Feld: kräftiger Ring in fester Bildschirmstärke + Leuchten | ✅ |
| Mehrfachauswahl: violetter Ring **und** Haken je Feld, Zahl am Werkzeug-Knopf | ✅ |
| Orangener Griff: Feld frei verschieben (mit Vorschau + Einrasten) | ✅ |
| Violetter ↻-Griff: Tipp = 90°, Ziehen = frei | ✅ |
| Blaue „+"-Knöpfe links/rechts: Feld anfügen | ✅ |
| Pan, Pinch-Zoom, Mausrad/Trackpad-Zoom, Doppeltipp-Zoom | ✅ |
| Auswahl-Anzeige oben MITTIG als schmale Pille (exakte Anzahl + beteiligte Achsen) | ✅ |
| Achslabel am Objekt im Canvas: Tipp wählt die Achse, langes Tippen benennt sie um | ✅ |
| Maßstabsleiste, Eck-Symbole, Bordbrettlinien mit Anfassern | ✅ |
| Gebäudeecken als markierte Fangpunkte („Ecke") | ✅ |
| „Alle anzeigen" passt in den FREIEN Teil ein, nicht unter das offene Menü | ✅ |
| Leerhinweis mit „Feld hinzufügen" | ✅ |

**Overlay-Zonen auf der Zeichenfläche.** Bis Runde 7 lagen Auswahl-Anzeige,
Achsangabe und die aufgeklappten Werkzeuge alle oben links übereinander – man
sah nie alles gleichzeitig. Jetzt hat jedes Element seine feste, kollisions-
freie Zone:

| Element | Position | Verhalten |
|---|---|---|
| Achslabel | direkt an der Achse auf dem Canvas | bleibt am Objekt, nicht in der Ecke |
| Auswahl-Anzeige | oben mittig, schmale Pille | erscheint nur bei aktiver Auswahl |
| Aktionsleiste der Auswahl | unten über die volle Breite (iPad: daumennah) | verdeckt nichts: die Zeichenfläche wird um die Leistenhöhe kleiner (`--leiste-h`), der Zoom bleibt |
| Feldübersicht | links, ein-/ausblendbar | unverändert |

Alle Overlays liegen auf halbtransparentem Grund mit leichter Unschärfe, damit
sie auch über Zeichnungslinien lesbar bleiben.

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
| **Bordbrett-Sheet: Aufmaßlänge, Seite wechseln, Lagen anlegen/ändern/löschen, Achszuordnung** | ✅ |
| PDF-Sheet: Farbe / Schwarz-Weiß, Blattzahl der Skizze, ausgeblendete Achsen einbeziehen | ✅ |

**Bordbrett** – nicht nur ein Bauteil, sondern die Aufmaßlänge einer Seite

| Funktion | |
|---|---|
| Linie auf der Feldkante ziehen; Anfang und Ende dürfen **mitten im Feld** liegen | ✅ |
| Länge live in Metern während des Ziehens | ✅ |
| Magnetisches Einrasten an Feldkanten, Feldmitten, Eckpunkten und **Gebäudeecken** – mit kleiner Toleranz übersteuerbar | ✅ |
| Feineingabe der Länge über ein Zahlenfeld | ✅ |
| Beide Endpunkte über Anfasser nachträglich verschiebbar | ✅ |
| **Stützpunkte**: im Bordbrett-Modus setzt ein Tipp auf die Linie einen Zwischenpunkt, ziehen verschiebt ihn, langes Tippen entfernt ihn wieder | ✅ |
| **Feste Seite** je Linie (`seite`), einmal beim Anlegen bestimmt; „Seite wechseln" kippt die GESAMTE Linie | ✅ |
| Linie in der (um 20 % abgedunkelten) Achsfarbe, leicht nach außen versetzt; ohne Achszuordnung neutrales Grau | ✅ |
| Eine Kante antippen belegt sie ganz (wie bisher), nochmal antippen entfernt sie | ✅ |
| Antippen der Linie außerhalb des Modus öffnet den Editor: Länge, Seite, Lagen, Achszuordnung | ✅ |
| **Mehrere Lagen** je Linie: anlegen, ändern, einzeln löschen; jede Lage mit eigener Länge | ✅ |
| Kennzahl oben rechts summiert über alle Lagen aller Linien | ✅ |
| Eine geometrische Kante zählt höchstens einmal (geteilte Stirnkanten) | ✅ |

**Die Seite steht fest, sie wird nicht gerechnet.** Bei längeren Linien kippte
die Bordbrettlinie an manchen Stellen auf die andere Seite der Achse. Ursache
war nicht das Zeichnen, sondern die Wegsuche: sie kannte nur Längen, und an
einer Ecke oder bei fast gleich langen Alternativen war der Weg über die
Gegenseite mitunter der billigere. Zwei Maßnahmen, beide nötig:

* Jede Linie trägt ein **persistentes Attribut `seite`** ('links' | 'rechts',
  bezogen auf die Zeichenrichtung ihrer Achse). Es wird EINMAL beim Anlegen
  aus der zuerst getroffenen Kante bestimmt und danach nie wieder abgeleitet.
  Intern löst es sich in die Kantenlage 'aussen' / 'wand' auf – der Außenrand
  eines Gerüsts ist ein durchgehender Zug, der Wandrand ebenso, während
  „links/rechts" von Achse zu Achse die Richtung wechseln kann. Die Wegsuche
  (`kantenPfad`) darf nur Kanten dieser Lage und die seitenneutralen
  Stirnkanten benutzen; nur wenn es dort gar keinen Weg gibt (bewusster Umlauf
  um ein Gerüstende), greift der ungefilterte Versuch.
* **Stützpunkte** (`punkte`): der Nutzer setzt zusätzliche Punkte auf der
  Linie und zieht sie – mit derselben Fangwirkung wie beim Zeichnen
  (Feldkanten, Feldmitten, Gebäudeecken). Die Linie ist eine Polylinie über
  diese Punkte; zwischen zwei Punkten wird stur der Weg auf der festgelegten
  Seite genommen, ohne jede weitere Seitenlogik.

Ältere Zeichnungen brauchen keine Migration: `seite` und `punkte` entstehen
beim Laden aus dem, was schon da ist – die Linie sieht danach exakt aus wie
zuvor, sie ist ab jetzt nur festgelegt.

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

Das Dokument besteht aus der **Skizze** und dem **Aufmaß**.

| Bestandteil | |
|---|---|
| Kopf- und Fußzeile auf jedem Blatt („Seite X von Y"), Legende | ✅ |
| Kopfbereich mit Projektname, Datum, Bauvorhaben, Gerüsttiefe | ✅ |
| Übersichts-Thumbnail (Locator) mit markiertem Ausschnitt, ohne Überlagerungen | ✅ |
| **Blattzahl der Skizze wählbar**: 1 / 2 / 3 Blätter oder „Automatisch" | ✅ |
| Plan-Beschriftungen ohne Überlappung, nicht in Kopf/Fuß/Legende | ✅ |
| Zwei Ausgaben (Farbe, Schwarz-Weiß), Auswahl wird gemerkt | ✅ |

**Skizze auf frei wählbare Blattzahl.** Die Wahl steht im Export-Dialog neben
der Vorschau und wird gemerkt (`geruest.2d.pdfBlaetter`):

* **1 Blatt** – die gesamte Zeichnung wird auf eine Seite skaliert.
* **2 / 3 Blätter** – geteilt entlang der **längeren Ausdehnung**, an einer
  möglichst leeren Stelle: innerhalb von ±10 % der Blattbreite wird eine
  Schnittkante gesucht, die kein Feld zerschneidet. Jedes Blatt reicht an
  jeder Schnittkante rund **5 %** seiner Breite über den Schnitt hinaus – der
  gemeinsame Streifen zweier Nachbarblätter ist damit rund 10 % breit, und die
  Blätter lassen sich sicher aneinanderlegen.
* **Automatisch** – die kleinste dieser Blattzahlen, bei der die Feld-
  beschriftung noch mindestens **6 pt** groß bleibt und der Maßstab nicht
  unter die kleinste lesbare Stufe fällt. Reicht das nicht (sehr große
  Gerüste), greift die Aufteilung in Leserichtung mit den Maßstabsstufen
  11 → 9 → 8 mm/m.

Der Maßstab ist auf allen Blättern identisch und steht auf jedem Blatt; oben
rechts trägt jedes die Kennung „Skizze 1 von 2" und die Felder, die es zeigt.
Ein Feld liegt immer vollständig auf genau einem Blatt.

**Was ersatzlos entfallen ist**

| entfernt | Begründung |
|---|---|
| Regeltext nach ATV DIN 18451 („Grundlage: …") | die Korrekturlogik rechnet weiter, sie wird nur nicht mehr abgedruckt |
| Auswahlmöglichkeiten am Ende des PDF-Dialogs (Eck-/Feldzuschlag, Innenecke) | lieferten durchgehend falsche Werte; erst raus, später sauber neu |
| Position „Bordbrett" in laufenden Metern | das Bordbrett wird nicht abgerechnet, es ist die Grundlage der Aufmaßlänge |
| **Das Bordbrett in der Skizze** (Balken und Legendeneintrag) | es ist ein reines Konstruktions- und Eingabehilfsmittel der Zeichenfläche; die daraus abgeleiteten Rechnungen bleiben vollständig erhalten |
| **Alle Zwischenüberschriften unterhalb der Achse** (Abschnitte, Einheiten, Feldgruppen) | vier Überschriftenebenen für eine Mengenliste; gesucht wird „wie viel Innengeländer auf der linken Seite", nicht „wie viel auf Feld A4" |
| **Die feldweise Auflistung mit Einzelflächen** | machte das Dokument lang und schwer lesbar, ohne eine Frage zu beantworten |

**Aufmaß – EINE Ebene, EINE Überschrift je Achse**

```
ACHSE 2 · LINKE SEITE            7 Felder · 36,48 m · 238,60 m²   ← Kopfbalken (dunkel, weiße Schrift)
  Höhen: 4 Felder à 8,00 m · 3 Felder à 6,00 m
  · davon positioniert: 210,40 m² (Aufmaßlänge 26,30 m)           ← schmale Metazeile, grau
│ ■  Position          Anzahl   Menge          lfd. Meter         ← Spaltenkopf (grau hinterlegt)
│ ■  Innengeländer         6×   6 Lagen           15,42 m         ← Zebra-Streifen
│ ■  Konsole 0,30          4×   8 Lagen           20,56 m
GESAMT · ALLE SEITEN             21 Felder · 98,74 m · 712,30 m²
```

* Links im Kopfbalken steht der **vom Nutzer vergebene Achsname**, davor die
  laufende Nummer („Achse 2 · linke Seite"). Trägt die Achse ohnehin einen
  Namen, der mit „Achse" beginnt, entfällt die Nummer. Ohne angelegte Achsen
  bleiben die geometrischen Wände die Gliederung.
* Rechts stehen die **Kennzahlen der Achse** in einer Zeile: Feldzahl,
  Achslänge (Achsmaß samt Eckenkorrektur) und die Gesamt-Gerüstfläche.
* Die **Metazeile** darunter fängt genau das auf, was eine Ebene sonst
  verschlucken würde: unterschiedliche Höhen innerhalb der Achse und die
  positionierte (abzurechnende) Fläche samt der Aufmaßlänge, aus der sie
  stammt. Bei einheitlicher Höhe und ohne Bordbrettlinie entfällt sie ganz.
* Die **Positionstabelle** hat eine Zeile je Positionsart, über die gesamte
  Achse aggregiert – mit dem Farbquadrat des Bauteils aus der Zeichnung.
  Keine Feldzeilen, keine m²-Angabe pro Feld.
* Ein **Achsblock wird nie über zwei Seiten getrennt**: passt er nicht mehr
  aufs Blatt, wandert er komplett auf das nächste. Nur ein Block, der auch
  allein auf keine Seite passt, läuft weiter – dann mit eigenem Kopfbalken
  „(Fortsetzung)".
* Zum Schluss derselbe Aufbau als **„Gesamt · alle Seiten"**.

**Gestaltung.** Eine Akzentfarbe für den Kopfbalken, ein heller Ton für die
Metazeile, ein neutraler für den Zeilenwechsel (Zebra). Farbe ist nie
alleiniger Bedeutungsträger: der Kopfbalken ist zusätzlich fett und invers,
das Farbquadrat steht neben dem ausgeschriebenen Positionsnamen,
Hilfsangaben sind klein und grau. In der Schwarz-Weiß-Ausgabe werden alle
Farben über `pdfCol()` auf neutrale Grautöne gestaucht – das Blatt bleibt in
Graustufen und auf A4 lesbar.

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

**21 Testdateien, alle grün.** Neu ist `r14-runde8`: es geht die acht
Änderungen dieser Runde einzeln ab – aus 21 Feldern genau drei nicht
benachbarte auswählen (und ein viertes Tippen nimmt eines wieder heraus), eine
Achse mit sieben Feldern, Mengen und Bordbrett umbenennen, ohne dass sich eine
Zahl bewegt, die drei Overlay-Zonen paarweise auf Überlappung nachmessen, die
abgedunkelte Achsfarbe des Bordbretts, eine Linie über sieben Felder mit zwei
Richtungswechseln, die nach Zeichnen, Zoomen, Speichern und erneutem Öffnen
durchgehend auf derselben Seite bleibt, das PDF ohne Bordbrett mit einer Ebene
je Achse und die wählbare Blattzahl der Skizze (bei jeder Wahl liegt jedes Feld
auf genau einem Blatt, keines wird angeschnitten, an jeder Schnittkante stehen
rund 5 % Überlappung).

`r12-runde7` geht die Abnahmeliste der Vorrunde Punkt für Punkt durch –
Soll-Belegung der Werkzeugleiste, das Hauptmenü hinter dem Projektnamen,
„+ Achse" in einem Schritt, ein einziger Begriff für Achse/Abschnitt, die vier
Sektionen des Werkzeug-Panels samt gleich großer Bauteil-Karten, die
ein-/ausklappbare Feldübersicht mit gemerktem Zustand, mehrere Bordbrettlagen,
ein Bordbrett mit freiem Anfang und Ende, den Eckfall aus dem Beispielfoto
(Bordbrett endet an der Gebäudeecke, Eckfeld anteilig geteilt, anschließende
Achse mit eigener Aufmaßlänge) und das Aufmaßblatt – bis hin zum Nachweis, dass
die Schwarz-Weiß-Ausgabe ausschließlich neutrale Grautöne verwendet.

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
