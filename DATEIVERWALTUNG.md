# Dateiverwaltung: Modul-Auswahl, Ordner, Dokumente

Beide Module haben jetzt dieselbe Dateiübersicht, dieselben Ordner und
denselben Dokument-Lebenszyklus. Eine neue Zeichnung lässt sich jederzeit
beginnen – auch mitten in einer offenen.

```
#/                  Startseite: Auswahl zwischen den Modulen
#/aufmass           Modul 1 – Dateiübersicht
#/aufmass/editor    Modul 1 – Projektakte
#/2d                Modul 2 – Dateiübersicht
#/2d/editor         Modul 2 – Zeichner
```

Nach der Modulauswahl landet man in der **Dateiübersicht**, nicht im leeren
Editor. Der Modul-Umschalter oben links führt jederzeit ins jeweils andere
Modul – ohne Datenverlust (siehe § 4).

---

## 1. Was neu ist

| Datei | Rolle |
|---|---|
| `store.js` | **neu** – Dokument- und Ordnerspeicher (IndexedDB), Migration, Papierkorb, Import/Export |
| `dateien.js` | **neu** – die Dateiübersicht: eine Komponente, beide Module. Dazu Dialoge, Toast mit „Rückgängig", Ziehen & Ablegen |
| `dateien.css` | **neu** – Aussehen der Übersicht |
| `shell.js` | Routing um die Unteransichten erweitert, Hub-Kennzahlen je Modul, Schnellzugriff, Verlassen-Dialog |
| `script.js` | Projektliste kommt aus dem Speicher; alte Übersicht ersetzt; Papierkorb statt Sofortlöschung |
| `viewer2d.js` | Dokument-Lebenszyklus, „Neue Zeichnung", Dateiübersicht, Vorschaubilder |
| `index.html` | Kacheln mit Schnellzugriff, zwei Ansichten je Modul |

Kein Framework, kein Build-Schritt, keine neue Abhängigkeit – wie bisher.

**Unverändert geblieben:** die gesamte Fachlogik beider Module. Aufmaßregeln
nach ATV DIN 18451, Eckenkorrektur, Bordbretter, Positionsarten, Zeichen-
werkzeuge und beide PDF-Exporte sind nicht angefasst worden. Der A/B-Vergleich
gegen den Stand vor der Zusammenführung meldet weiterhin **jeden einzelnen
Zeichenaufruf identisch** (403 im 2D-Modul, 83 im Aufmaß-Modul).

---

## 2. Datenmodell

```jsonc
Ordner {
  id, name,
  parentId: string | null,        // beliebig tief verschachtelbar
  modul: "aufmass" | "zweid",     // jedes Modul hat seinen eigenen Baum
  createdAt, updatedAt            // ISO-Zeitstempel
}

Dokument {
  id, name,
  ordner: { aufmass: id|null, zweid: id|null },   // je Modul eine Ablage
  createdAt, updatedAt,
  zuletztGeoeffnet: { aufmass: ISO|null, zweid: ISO|null },
  deletedAt: ISO | null,          // Papierkorb, 30 Tage
  thumbnail: string | null,       // Data-URL, nur 2D
  schemaVersion: 1,
  data: { /* unverändertes bestehendes Projektformat */ }
}
```

**Ein Dokument ist eine Baustelle.** `data` bleibt exakt der bisherige
Projektdatensatz (Anschrift, Hausseiten, Positionen und die eingebettete
`zeichnung2d`); die Metadaten liegen als Hülle drumherum. Deshalb mussten die
Editoren kaum angefasst werden: `projects` in `script.js` ist weiterhin ein
Array genau dieser Datensätze – es sind dieselben (lebenden) Objekte, die im
Speicher unter `dokument.data` hängen.

Jedes Modul bringt seine **eigene Ordnerstruktur** über denselben Bestand mit:
dieselbe Baustelle darf im Aufmaß unter „Kunde Müller" und im 2D-Modul unter
„2026" liegen. Dadurch bleiben die bestehenden Verknüpfungen erhalten –
„2D-Ansicht öffnen" aus der Projektakte, die 2D-Kennzahlen auf der Projekt-
karte und „Öffnen mit …" funktionieren unverändert.

---

## 3. Speicherung: warum IndexedDB

Bisher lag die komplette Projektliste – inklusive **aller** 2D-Zeichnungen –
als eine einzige JSON-Zeichenkette in `localStorage`. Dessen Limit liegt je
nach Browser bei rund 5 MB für alles zusammen. Mit Vorschaubildern je Zeichnung
und einem Papierkorb, der 30 Tage aufbewahrt, ist das zu eng: ein volles
`localStorage` wirft beim Schreiben eine Ausnahme – und die letzte Änderung
wäre verloren.

IndexedDB (`geruest_dateien_db`) hat kein vergleichbar hartes Limit, speichert
jedes Dokument getrennt (es muss nicht die ganze Liste neu geschrieben werden)
und liegt in derselben Herkunft wie die bereits genutzte Fotodatenbank
`av2d_photos_db`.

Damit die Editoren synchron lesen können wie zuvor, hält `store.js` alles
zusätzlich im Arbeitsspeicher; nur das Schreiben läuft gebündelt (250 ms) im
Hintergrund – und sofort beim Wegschalten des Tabs (`visibilitychange`,
`pagehide`, `beforeunload`).

Steht IndexedDB nicht zur Verfügung (privates Fenster, blockierte Datenbank),
weicht der Speicher automatisch auf `localStorage` aus. Die App bleibt
vollständig bedienbar, nur der Platz ist knapper.

### Migration – kein Datenverlust

Beim ersten Start nach dem Update:

1. `geruest.aufmass.projekte` und `geruest.aufmass.ordner` werden gelesen.
2. Der komplette Altstand wird **unverändert** unter
   `geruest.backup.vor-dateiverwaltung` abgelegt.
3. Jedes Projekt wird zu einem Dokument, jeder Ordner zu einem Aufmaß-Ordner –
   **mit seiner bisherigen ID**, damit `folderId` in den Projektdaten gültig
   bleibt und niemand im falschen Ordner landet.
4. Der **alte Schlüssel wird nicht gelöscht**. Er bleibt als zweite Sicherung
   liegen; der Stand vor der Umstellung ließe sich jederzeit von Hand
   zurückholen.

Zeichnungen aus der Zeit vor der Dateiverwaltung bekommen ihr Vorschaubild
beim ersten Öffnen der 2D-Übersicht nachgereicht.

---

## 4. Der Fehler „keine neue Zeichnung möglich" – Ursache und Behebung

Der Fehler hatte drei Ursachen, alle an der Wurzel behoben:

**1 · Es gab schlicht keinen Einstieg.** Die 2D-Werkzeugleiste kannte
„Speichern" und „Laden" (Dateiexport/-import), aber kein „Neue Zeichnung". Der
einzige Weg führte über Modul 1 → neues Projekt → 2D öffnen.
→ Jetzt: **„＋ Neue Zeichnung"** in der Werkzeugleiste *und* in der
Dateiübersicht. Beide sind immer verfügbar, auch bei offener Zeichnung.

**2 · Der Guard.** `ZweiDModul.aktiviere()` setzte den Zustand nur zurück,
wenn sich die ID des verknüpften Projekts geändert hatte:

```js
const id = localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || null;
if (id !== linkedProjectId) { … resetState2d() … }   // vorher
```

Blieb die ID gleich – oder waren beide `null` –, blieb die alte Zeichnung
stehen. → Jetzt entscheidet nicht mehr ein ID-Vergleich, sondern ein
ausdrücklicher Lebenszyklus: `oeffneDokument2d()` / `neueZeichnung2d()` /
`schliesseDokument2d()`.

**3 · `resetState2d()` räumte nur halb auf.** Rückgängig-Stapel, Zwischen-
ablage, Kamera, Zeichenmodi und offene Dialoge blieben unberührt – genau der
Weg, auf dem Zustand durchsickerte. → Jetzt setzt `resetState2d()` alles
zurück: Zeichnung, Abschnitte, ID-Zähler, Auswahl, Mehrfachauswahl, Undo/Redo
samt Debounce-Timer, Zwischenablage, laufende Eingaben, ausstehender Autosave
und Kamera. `schliesseDokument2d()` schließt zusätzlich Sheets, bricht
Bordbrett- und Grundriss-Modus ab und leert die Formularfelder.

Nebenbefund, ebenfalls behoben: „Laden" (JSON-Datei) überschrieb den Zustand,
ließ aber Rückgängig-Historie und Verknüpfung stehen – man konnte in die
vorherige Zeichnung „zurückspulen" und beim nächsten Autosave die verknüpfte
Zeichnung stillschweigend überschreiben.

### Ungespeicherte Änderungen

* **Autosave** schreibt laufend mit (gebündelt) und zusätzlich beim Schließen
  des Tabs. Es geht unter keinen Umständen etwas verloren.
* **„Zurück" / „🗂 Dateien"** sind die hauseigenen Wege aus einem Dokument
  heraus: sie *speichern* und wechseln – ohne Rückfrage. Ein Dialog bei jedem
  Antippen von „Zurück" wäre Lärm, keine Sicherheit.
* **Jeder andere Weg** aus einem geänderten Dokument heraus – Modulwechsel,
  Startbildschirm, Zurück-Taste des Browsers – fragt:
  **Speichern / Verwerfen / Abbrechen**. „Verwerfen" stellt den Stand beim
  Öffnen wieder her, „Abbrechen" dreht auch die Adresse zurück.
* **„＋ Neue Zeichnung"** fragt bewusst nicht: das ist eine Anlege-Aktion, keine
  Aufgabe-Aktion. Die laufende Zeichnung wird gesichert und bleibt als eigenes
  Dokument bestehen.

### Warum keine Tab-Leiste

Beide Editoren stehen auf globalen Singletons: `viewer2d.js` auf einem `state`,
`_sId`/`_bId`/`_aId`, `undoStack` und einer Kamera; `script.js` auf `projects`
+ `currentProjectId` + dem DOM-Formular. Echte Parallelität hieße, rund 10.000
Zeilen Zeichenlogik auf Instanzen umzubauen – viel Risiko an genau der
Fachlogik, die laut Nicht-Zielen unangetastet bleiben soll, für einen Komfort,
den der schnelle Wechsel über die Dateiübersicht weitgehend ersetzt. Statt-
dessen: **ein Dokument zur Zeit, dafür restlos sauber geöffnet und geschlossen.**

---

## 5. Testliste zum Durchklicken

Vorbereitung: App öffnen mit vorhandenen Projekten aus der bisherigen Fassung.

### Startseite
- [ ] Beim Öffnen erscheint die Startseite mit **zwei Kacheln**: Aufmaß oben, 2D-Aufmaß darunter.
- [ ] Jede Kachel nennt die Anzahl gespeicherter Dateien.
- [ ] Jede Kachel zeigt „Zuletzt: … · vor N Tagen"; ein Tipp darauf öffnet diese Datei direkt im Editor.

### Migration
- [ ] **Alle** bisherigen Projekte stehen in der Aufmaß-Übersicht.
- [ ] Die bisherigen Ordner sind da, die Projekte liegen im richtigen Ordner.
- [ ] Ein Projekt mit 2D-Zeichnung öffnen → die Zeichnung ist vollständig.
- [ ] In den Entwicklerwerkzeugen: `localStorage['geruest.backup.vor-dateiverwaltung']` existiert.

### Dateiübersicht (in **beiden** Modulen gleich durchspielen)
- [ ] Modul wählen → es erscheint die Dateiübersicht, nicht der leere Editor.
- [ ] „+ Ordner" anlegen; im Ordner noch einen Ordner anlegen → Brotkrumen zeigen den Pfad.
- [ ] Ordner umbenennen (⋯-Menü) und verschieben.
- [ ] Ordner löschen → Sicherheitsabfrage; die Dateien darin bleiben erhalten und liegen unter „Nicht zugeordnet".
- [ ] Datei per **Ziehen & Ablegen** auf einen Ordner ziehen (Maus: ziehen; Finger: kurz halten, dann ziehen).
- [ ] Datei über ⋯ → „In Ordner verschieben …" verschieben.
- [ ] Suche nach Dateiname – findet auch Dateien in Unterordnern.
- [ ] Im Aufmaß-Modul zusätzlich: Suche nach Bauherr oder Straße.
- [ ] Sortierung auf „Name" und „Erstelldatum" umstellen.
- [ ] Ansicht auf **Liste** umschalten und zurück auf **Kacheln** – die Wahl wird gemerkt.
- [ ] Status-Filter im Aufmaß-Modul (Alle / In Bearbeitung / Abgeschlossen / Archiviert).
- [ ] Bereich „Zuletzt bearbeitet" erscheint oben, sobald Dateien geöffnet wurden.

### Dateiaktionen
- [ ] Umbenennen (⋯-Menü) → Toast „Umbenannt".
- [ ] Duplizieren → „… (Kopie)"; Änderungen an der Kopie wirken sich **nicht** auf das Original aus.
- [ ] Exportieren (JSON) → Datei wird heruntergeladen.
- [ ] ⋯ → „Datei importieren (JSON) …" mit der eben exportierten Datei → sie erscheint zusätzlich, nichts wird überschrieben.
- [ ] Löschen → Sicherheitsabfrage → Toast mit **„Rückgängig"**; Rückgängig holt die Datei zurück.
- [ ] ⋯ → „Papierkorb" → gelöschte Datei ist da, „Wiederherstellen" holt sie zurück, „Endgültig löschen" entfernt sie.

### 2D-Modul
- [ ] Die Übersicht zeigt eine **Miniaturvorschau** jeder Zeichnung.
- [ ] Zeichnungen ohne Felder zeigen „Noch nichts gezeichnet".

### Neue Zeichnung bei offener Zeichnung (der Kernpunkt)
- [ ] Eine Zeichnung öffnen, ein paar Felder anlegen, ein Feld auswählen, etwas rückgängig machen können.
- [ ] **„＋ Neue Zeichnung"** in der Werkzeugleiste tippen.
- [ ] Die Zeichenfläche ist **leer**, die Seitenleiste zeigt keine Abschnitte.
- [ ] Der Rückgängig-Knopf ist **gesperrt** (keine Historie aus der alten Zeichnung).
- [ ] Es ist nichts ausgewählt, die Gesamtfläche steht auf 0,00 m².
- [ ] Zurück in die Dateiübersicht: die alte Zeichnung ist **vollständig erhalten**, die neue steht daneben.
- [ ] Dasselbe noch einmal über „+ Neue Zeichnung" in der Dateiübersicht.

### Verlassen mit ungespeicherten Änderungen
- [ ] In einer Zeichnung etwas ändern, dann **auf die Modul-Pille „Aufmaß"** tippen → Dialog **Speichern / Verwerfen / Abbrechen**.
- [ ] „Abbrechen" → man bleibt in der Zeichnung, auch die Adresse bleibt.
- [ ] „Verwerfen" → der Stand von vor der Änderung ist zurück.
- [ ] „Speichern" → Wechsel wie gewünscht, Änderung erhalten.
- [ ] Dasselbe in der Projektakte des Aufmaß-Moduls.
- [ ] „Zurück" bzw. „🗂 Dateien" speichert ohne Rückfrage.

### Bestandsfunktionen (Stichproben – hier darf sich nichts geändert haben)
- [ ] Aufmaß: Hausseite anlegen, Maße erfassen, Konsolen, Positionen, Zusammenfassung, **PDF erstellen**.
- [ ] Aufmaß: 50-m-Hinweis erscheint wie gewohnt.
- [ ] 2D: Vorlagen L/U/Rechteck, Feld drehen, verschieben, Abschnitte, Bordbrett-Linie, Grundriss, Fotos.
- [ ] 2D: **PDF** in allen drei Layouts.
- [ ] 2D: Rückgängig/Wiederholen, `Strg/Cmd+Z`, Taste `R`.
- [ ] Aus der Projektakte „2D-Ansicht öffnen" → die Zeichnung dieses Projekts erscheint.
- [ ] In der Aufmaß-Übersicht ⋯ → „Öffnen mit …" → 2D-Aufmaß.

### Nach dem Neuladen
- [ ] Seite neu laden → alle Dateien, Ordner und Zuordnungen sind unverändert da.
- [ ] Ein Deep-Link auf `#/2d/editor` landet im Zeichner, `#/aufmass` in der Übersicht.

---

## 6. Automatische Prüfungen

```bash
npm install playwright
node tests/<datei>.mjs
```

**455 Prüfungen, alle grün** – 389 aus dem Bestand und 66 neue in
`tests/r8-dateien.mjs` (Migration, Startseite, Übersicht beider Module,
Ordner, Papierkorb, Import/Export, neue Zeichnung ohne Reste, Vorschaubilder,
Verlassen-Dialog, Neustart).

Dazu die beiden A/B-Vergleiche gegen den Stand **vor** der Zusammenführung –
sie belegen, dass an der Fachlogik nichts verändert wurde:

```bash
git worktree add /tmp/vorher 8644d5d
node tests/ab-vergleich-2d.mjs      /tmp/vorher   # 403 Zeichenaufrufe – identisch
node tests/ab-vergleich-aufmass.mjs /tmp/vorher   #  83 Zeichenaufrufe – identisch
```

---

## 7. Bewusste Abweichungen

**1 · Ein Bestand, zwei Übersichten.** Die Vorgabe lautete „getrennte
Datenräume". Umgesetzt ist: ein Dokument je Baustelle, aber je Modul eine
eigene Ordnerstruktur, eigene Sortierung, eigene Suche und eigene Darstellung.
Eine echte Trennung hätte dieselbe Baustelle doppelt geführt – mit zwei Namen
in zwei Bäumen – und die bestehenden Verknüpfungen zwischen den Modulen
zerstört, die laut Akzeptanzkriterien unverändert arbeiten sollen. Abgestimmt
und so entschieden.

**2 · Keine Tab-Leiste.** Begründung siehe § 4.

**3 · Vorschaubilder werden gezeichnet, nicht abfotografiert.** Ein Abzug der
Zeichenfläche trüge Beschriftungen, Maßketten und Eck-Symbole – als Miniatur
unleserlich und unnötig groß. Stattdessen entsteht aus den Feldern selbst ein
schlanker Umriss als SVG-Data-URL: wenige hundert Byte, sofort erkennbar.

**4 · Der alte Speicherschlüssel bleibt liegen.** Er kostet wenig Platz und ist
die letzte Rückfalllinie, falls mit der IndexedDB etwas nicht stimmt.
