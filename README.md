# AufmaßX

Zwei **getrennte** Anwendungen für den Gerüstbau, hinter einer gemeinsamen
Anmeldung:

| Anwendung | Adresse | Ordner | Zweck |
|---|---|---|---|
| **Aufmaß** | `/app/aufmass` | [`aufmass/`](aufmass/) | tabellarisches Aufmaß: Projekte, Hausseiten, Positionen, Angebots-PDF |
| **2D-Aufmaß** | `/app/aufmass-2d` | [`aufmass-2d/`](aufmass-2d/) | Zeichenfläche mit Gerüstfeldern, Achsen, Plan-PDF |
| Startseite | `/app` | [`start/`](start/) | zwei Auswahl-Kacheln – verlinkt nur, liest keine Daten |

Jede Anwendung hat ihren **eigenen Code, eigene Styles, eigene Daten und ein
eigenes Speicherschema**. Zwischen `aufmass/` und `aufmass-2d/` wird nichts
geteilt – auch gleiche Logik (z. B. Netz/Plane) steht bewusst in beiden Apps
getrennt. Gemeinsam ist nur [`shared/`](shared/) mit rein technischen Basics.

## Ordnerstruktur

```
/
├── start/                    Startseite  →  /app
│   ├── index.html              zwei Kacheln + Umschalter (nur Links)
│   ├── start.css
│   └── start.js                Kachel-Übergang, Weiterleitung alter Adressen
│
├── aufmass/                  Aufmaß-App  →  /app/aufmass
│   ├── index.html
│   ├── basis.js                Speicher-Schlüssel (geruest.aufmass.*), Toast, Aktionsmenü
│   ├── script.js               Fachlogik: Projekte, Hausseiten, Positionen, PDF
│   ├── cloud.js                Cloud-Abgleich (Namensraum app=aufmass)
│   ├── style.css               Stylesheet der App
│   └── oberflaeche.css         Erscheinungsbild (Farben, Schrift, Umschalter)
│
├── aufmass-2d/               2D-Aufmaß-App  →  /app/aufmass-2d
│   ├── index.html                #/projekte = Zeichnungsübersicht, #/zeichnung = Zeichnung
│   ├── basis.js / basis.css      Speicher-Schlüssel (geruest.2d.*), Toast, Aktionsmenü
│   ├── viewer2d.js / .css        Fachlogik: Zeichenfläche, Aufmaßregeln, Positionen, PDF
│   ├── navigation.js             die zwei Bildschirme der App; startet die App
│   ├── cloud.js                  Cloud-Abgleich (Namensraum app=2d)
│   ├── zeichnungen.js / .css     benannte Speicherstände, JSON-Upload
│   ├── tutorial.js / .css        geführtes Tutorial (siehe TUTORIAL-2D.md)
│   └── oberflaeche.css           Erscheinungsbild (Farben, Schrift, Umschalter)
│
├── shared/                   NUR technische Basics
│   ├── tokens.css                Design-Tokens (Farben, Schriften, Radien, Bewegung)
│   └── speicher-migration.js     einmalige Übernahme des früheren gemeinsamen Speichers
│
├── app/                      Next.js-Hülle: Anmeldung (Clerk), geschützte Auslieferung
│   ├── app/[[...pfad]]/          der Route Handler, der /app/… aus den Ordnern oben liefert
│   ├── api/cloud/…               Cloud-API (Arbeitsbereich, Projekte, Ordner, Zeichnungsstände)
│   ├── api/konto/                Name und Rechte des angemeldeten Benutzers (für die Startseite)
│   └── mitarbeiter/, rollen/, …  Verwaltung
├── lib/                      Serverlogik (Zugang, Rollen, Cloud, Einladungen, Mitarbeiter)
├── db/                       Postgres-Schema und Migrationen (siehe db/README.md)
└── tests/                    Browser- und Datenbanktests (siehe tests/README.md)
```

Die Ordner der Anwendungen liegen bewusst **nicht** in `public/`: alles dort
würde am Server vorbei ausgeliefert. Jede Datei unter `/app/…` geht durch den
Route Handler `app/app/[[...pfad]]/route.ts`, der zuerst die Anmeldung prüft.
Er kennt genau die vier Ordner `start`, `aufmass`, `aufmass-2d` und `shared` –
einen Pfad aus einem Ordner heraus (`..`) oder in einen anderen gibt es nicht.
`next.config.mjs` gibt die vier Ordner dem Serverless-Bündel mit.

## Daten je Anwendung

Im Browser (lokaler Speicher, sofort bedienbar – auch ohne Netz):

| Aufmaß | 2D-Aufmaß |
|---|---|
| `geruest.aufmass.projekte` | `geruest.2d.zeichnungen` |
| `geruest.aufmass.ordner` | `geruest.2d.ordner` |
| `geruest.aufmass.aktuellesProjekt` | `geruest.2d.aktuelleZeichnung` |
| `geruest.aufmass.ueberstandWert`, `…letztesBackup`, `…backupErinnerungBis` | `geruest.2d.favoriten`, `…pdfDesign`, `…ansichtsmodus`, `…werkzeugMenue`, `…feldliste`, `…tutorial` … |

In der Cloud (Neon/Postgres) liegen beide in `cloud_projekte` bzw.
`cloud_ordner`, getrennt über die Spalte **`app`** (`'aufmass'` | `'2d'`). Jede
App fragt nur ihren eigenen Namensraum ab (`/api/cloud/…?app=…`), und die
Server-Funktionen weisen jeden Versuch ab, einen Datensatz der anderen
Anwendung zu lesen, zu überschreiben oder zu löschen.

### Übernahme des früheren gemeinsamen Bestands

Bis zur Trennung lag die 2D-Zeichnung als `zeichnung2d` **im** Aufmaß-Projekt.
Übernommen wird sie zweimal – verlustfrei und wiederholbar, beide Male unter
derselben Kennung `z2d_<Projekt-ID>`:

* **Im Browser:** `shared/speicher-migration.js` läuft vor jedem App-Code und
  legt für jede Zeichnung einen eigenen 2D-Datensatz an (mit Name, Ordner,
  Anschrift); erst danach verschwindet `zeichnung2d` aus dem Aufmaß-Projekt.
  Eine in der 2D-App gelöschte Zeichnung wird nicht wieder angelegt.
* **In der Cloud:** `db/migrations/20260928_app_trennung.sql` – **vor dem
  Ausrollen** des Codes ausführen:

  ```bash
  psql "$DATABASE_URL" -f db/migrations/20260928_app_trennung.sql
  ```

  Sie ergänzt die Spalte `app`, kopiert Zeichnungen, Ordner und Freigaben in
  den Namensraum `2d`, hängt die benannten Speicherstände an die Zeichnung
  und entfernt `zeichnung2d` erst danach aus den Aufmaß-Projekten – alles in
  einer Transaktion.

### Was sich durch die Trennung geändert hat

Die Funktionen beider Programme sind erhalten. Entfallen ist nur, was
ausschließlich aus dem gemeinsamen Datenbestand bestand:

* „Öffnen mit… (Aufmaß / 2D-Aufmaß)" an der Projektkarte und die Karte
  „2D-Zeichnung" in der Projektakte des Aufmaßes.
* Die Kennzahlen auf den Kacheln der Startseite (sie läse sonst die Daten
  beider Apps).

Umgezogen ist, was vorher auf der Startseite stand: **Cloud aktualisieren**
steht jetzt in der Fußzeile der Projektübersicht (Aufmaß) bzw. der
Zeichnungsübersicht (2D), **Alle Projekte sichern** in der Aufmaß-App.
**Für Mitarbeiter freigeben** gibt es jetzt auch direkt an der Zeichnung.
Der Zurück-Pfeil der Zeichnung führt immer in die Zeichnungsübersicht der
2D-App. Alte Adressen (`/app#/aufmass`, `/app#/2d`, `/app#/2d/projekte`,
`/app/viewer2d.html` …) leiten an die richtige Stelle weiter.

## Positionen Netz und Plane

In beiden Apps gibt es neben **Netz** die Position **Plane** – gleiche Eingabe,
gleiche Rechnung (Fläche), gleiche Darstellung, aber eigene Bezeichnung und
eigene Summenzeile. Beide laufen je App über eine gemeinsame Definition
(`huelle` in `aufmass-2d/viewer2d.js`, `HUELLEN` in `aufmass/script.js`).

Im 2D-Aufmaß lässt sich an einem **Eckfeld** zusätzlich die **Stirnseite**
(Gerüstbreite × Höhe des gewählten Feldes) abrechnen – je Ecke und je
Bekleidung, am Eck-Symbol oder im Feld-Blatt. Die Breite ist die eingestellte
Gerüsttiefe. Die Stirnseite steht als eigene Zeile mit Rechenweg in Feldliste
und PDF, bei der Achse ihres Feldes; die Achslänge bleibt unverändert.
Standardmäßig ist die Option aus.

## Entwickeln und Testen

```bash
npm install
npm run dev            # Next.js-Hülle mit Anmeldung (siehe .env.example, MIGRATION.md)
npm test               # alle Testdateien (Chromium über Playwright)
```

Ohne heruntergeladene Playwright-Browser: `PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome npm test`.
Einzelne Tests und die A/B-Vergleiche gegen ältere Stände beschreibt
[`tests/README.md`](tests/README.md).
