# AufmaßX – Next.js, Clerk und Einladungscodes

Die Aufmaß-App ist unverändert. Was sich geändert hat, ist der Weg zu ihr:
sie wird jetzt nur noch an angemeldete, freigeschaltete Benutzer ausgeliefert.

---

## 1. Was aus was geworden ist

| vorher | nachher |
|---|---|
| `aufmass_final_app/` | `legacy-app/` – **inhaltlich unverändert**, nur die Asset-Pfade sind absolut (`/app/core.js`) |
| `index.html` (Weiterleitung im Wurzelverzeichnis) | `app/page.tsx` – angemeldet → `/app`, sonst → `/sign-in` |
| `/aufmass_final_app/index.html` | `/app` (geschützt); die alte Adresse leitet dauerhaft dorthin |
| GitHub Pages (`.github/workflows/pages.yml`, `CNAME`) | entfernt – siehe Abschnitt 6 |
| — | `proxy.ts`, `app/sign-in`, `app/einladung`, `app/konto`, `app/admin/einladungen` |

Nicht angefasst wurden: `script.js`, `viewer2d.js`, `core.js`, `shell.js` und
sämtliche CSS-Dateien. Aufmaß, 2D-Aufmaß, PDF, Projektverwaltung, Achsen,
Konsolen, Bordbretter, Magnet, Rotation und die Speicherung im Browser
arbeiten wie zuvor. Die Projektdaten liegen weiterhin in `localStorage` und
`IndexedDB` desselben Ursprungs (`aufmassx.com`) – beim Umstieg geht nichts
verloren.

---

## 2. Warum die App nicht in `public/` liegt

Alles unterhalb von `public/` liefert Vercel als statische Datei aus, **bevor**
Servercode läuft. Läge die Aufmaß-App dort, wäre die Anmeldung eine Empfehlung
und keine Sperre.

Sie liegt deshalb in `legacy-app/` und wird von `app/app/[[...pfad]]/route.ts`
ausgeliefert – nach `zugangPruefen()`. Jede einzelne Datei, auch jedes
Stylesheet, kommt durch diese Prüfung. Dazu die Middleware (`proxy.ts`) als
zweite Schicht. `tests/r12-huelle-schutz.mjs` weist beides nach.

---

## 3. Clerk einrichten

Die Anmeldung selbst macht Clerk. Diese Schritte sind im Dashboard zu
erledigen und lassen sich nicht aus dem Quellcode heraus setzen:

1. **Benutzername + Passwort einschalten**
   *User & Authentication → Email, Phone, Username*: „Username" als
   Identifier aktivieren, „Password" aktivieren. E-Mail auf *optional*
   stellen – der Registrierablauf fragt sie optional ab.

2. **Registrierung sperren**
   *User & Authentication → Restrictions → Sign-up mode:* **Restricted**.
   Damit entsteht bei Clerk kein Konto mehr über die Oberfläche – auch nicht
   über eine von Clerk gehostete Adresse. Konten legt nur noch der Server an
   (Backend-API), und der tut das ausschließlich gegen einen gültigen
   Einladungscode.

3. **Rolle in den Session-Token legen** (empfohlen, spart Netzaufrufe)
   *Sessions → Customize session token:*
   ```json
   { "metadata": "{{user.public_metadata}}", "email": "{{user.primary_email_address}}" }
   ```
   Ohne diesen Eintrag funktioniert alles ebenso, nur wird bei jedem Zugriff
   der Benutzerdatensatz nachgeladen.

4. **Schlüssel** aus *API Keys* übernehmen (Abschnitt 5).

### Der erste Administrator

Henne und Ei: der erste Admin kann sich selbst keine Rolle geben.
Zwei Wege, beide in Ordnung:

* **Über Clerk:** Benutzer im Dashboard anlegen (*Users → Create user*),
  danach *Metadata → Public* setzen: `{ "rolle": "admin" }`.
* **Über die Umgebungsvariable:** die eigene E-Mail-Adresse in
  `AUFMASSX_ADMIN_EMAILS` eintragen. Diese Adressen gelten immer als Admin,
  auch ohne gesetzte Metadaten.

---

## 4. Datenbank für die Einladungscodes

Einmalcodes brauchen einen serverseitigen, dauerhaften Speicher.
Gewählt: **Neon Postgres** über die Vercel-Integration.

*Warum Postgres und nicht ein Schlüssel-Wert-Speicher:* Ein Code darf genau
einmal eingelöst werden, auch wenn zwei Anfragen gleichzeitig ankommen. In
Postgres ist das eine einzige Anweisung, die liest und schreibt –
`UPDATE … WHERE status='aktiv' … RETURNING`. Damit gibt es kein Zeitfenster
zwischen „ist frei" und „ist belegt". Eine Datei oder SQLite scheidet auf
Vercel aus: das Dateisystem einer Serverless-Funktion überlebt keinen Aufruf.

**Einrichten:**

1. Im Vercel-Projekt: *Storage → Create Database → Neon (Postgres)*.
   Vercel legt `DATABASE_URL` automatisch in allen Umgebungen an.
2. Tabellen anlegen – einmalig:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   oder den Inhalt von `db/schema.sql` im SQL-Editor von Neon ausführen.
3. `EINLADUNG_PEPPER` setzen (Abschnitt 5).

Fehlt die Datenbank, läuft alles andere weiter – die Anmeldung, die Aufmaß-App,
die Vorschau-Deployments. Nur die Einladungsverwaltung meldet dann
„noch nicht eingerichtet".

---

## 5. Umgebungsvariablen

In Vercel unter *Settings → Environment Variables*, lokal in `.env.local`
(über `.gitignore` ausgeschlossen). Vorlage: `.env.example`.

| Variable | geheim | wofür |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | nein | Clerk im Browser |
| `CLERK_SECRET_KEY` | **ja** | Clerk auf dem Server, u. a. Kontoerstellung |
| `DATABASE_URL` | **ja** | Neon Postgres (setzt Vercel selbst) |
| `EINLADUNG_PEPPER` | **ja** | Schlüssel für den HMAC über die Codes |
| `AUFMASSX_ADMIN_EMAILS` | nein | Notzugang für den ersten Admin |

`EINLADUNG_PEPPER` erzeugen:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Wird der Pepper geändert, sind **alle bestehenden Codes ungültig** – die
gespeicherten Prüfsummen passen dann nicht mehr.

Kein Schlüssel steht im Quellcode. `tests/r12-huelle-schutz.mjs` durchsucht
sowohl die versionierten Dateien als auch das gebaute Browser-Bündel danach.

---

## 6. GitHub Pages ist abgeschaltet

`.github/workflows/pages.yml` hat bei jedem Push auf `main` eine vollständige,
**anmeldefreie** Kopie der App auf `*.github.io` veröffentlicht. Nach der
Umstellung wäre das ein zweiter Eingang an der Anmeldung vorbei gewesen. Der
Ablauf und die `CNAME`-Datei sind entfernt.

> **Noch zu tun, im Browser:** In den Repository-Einstellungen unter
> *Settings → Pages* die Veröffentlichung auf **None** stellen. Eine bereits
> veröffentlichte Seite verschwindet nicht dadurch, dass der Ablauf gelöscht
> wurde.

---

## 7. Wie ein Mitarbeiter hineinkommt

```
Admin: /konto → „Mitarbeiter einladen"
     → Gültigkeit (Tage), Rolle, Notiz → „Einladungscode erstellen"
     → X7K4-P9QM-2L8F  ← erscheint genau einmal
     → persönlich, per WhatsApp o. Ä. weitergeben

Mitarbeiter: aufmassx.com → „Einladungscode verwenden"
     → Code eingeben → „Einladung bestätigt ✓"
     → Benutzername, Passwort, optional E-Mail/Name → „Account erstellen"
     → Anmeldung → Aufmaß-App
```

Was dabei serverseitig passiert und warum:

* Der Code wird **nie im Klartext gespeichert**, sondern als HMAC-SHA256 mit
  `EINLADUNG_PEPPER`. Wer die Datenbank allein hat, kann daraus keinen
  gültigen Code ableiten. In der Liste stehen nur die ersten vier Zeichen.
* Erzeugt wird er aus dem Zufallsgenerator des Betriebssystems: 12 Zeichen aus
  einem 32er-Alphabet ohne `I`, `O`, `0`, `1` – 60 Bit, nicht zu erraten und
  am Telefon vorlesbar.
* Eingelöst wird er **atomar**. Von zwei gleichzeitigen Anfragen gewinnt genau
  eine; die andere bekommt dieselbe Ablehnung wie ein erfundener Code.
* Erst danach legt der Server das Konto über die Clerk-Backend-API an. Lehnt
  Clerk die Angaben ab (Benutzername vergeben, Passwort zu schwach), wird der
  Code wieder frei. Bei einem unklaren Ausgang bleibt er gesperrt – ein
  verbrannter Code kostet einen Klick, ein zweites Konto auf denselben Code
  wäre der Fehler, den das hier verhindern soll.
* Das neue Konto bekommt `publicMetadata.rolle`. Diese Rolle ist zugleich der
  Nachweis der Freischaltung: ohne sie lässt `lib/zugang.ts` niemanden in die
  Anwendung, selbst mit gültigem Clerk-Konto.
* Nach acht Fehlversuchen aus derselben Herkunft ist für 15 Minuten Schluss.
  Die Herkunft wird dabei nur gehasht abgelegt.
* Jede Ablehnung lautet gleich. Ob ein Code unbekannt, abgelaufen, widerrufen
  oder schon verwendet ist, erfährt der Aufrufer nicht.

Die Prüfung hängt an **keiner** Oberfläche: `POST /api/einladung/registrieren`
ohne gültigen Code legt kein Konto an, auch nicht mit erfundenen Feldern im
Rumpf. `POST /api/einladung/pruefen` ist reine Anzeige und verschafft keinen
Anspruch.

---

## 8. Bauen und prüfen

```bash
npm install
npm run build                       # Produktionsbau

export PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome   # nur falls nötig
node tests/alle.mjs                 # alle Testdateien nacheinander
node tests/r12-huelle-schutz.mjs    # Zugangssperre, Geheimnisse, alte Adressen
node tests/r13-einladungscodes.mjs  # Einladungscodes gegen echtes Postgres
```

`r13` läuft gegen ein Postgres im Speicher (PGlite) mit dem Schema aus
`db/schema.sql` und den SQL-Anweisungen aus `lib/einladungen/kern.ts` – also
gegen dieselben Anweisungen, die später auf Neon laufen.

Für den Bau ohne echte Schlüssel genügen Platzhalter:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuYXVmbWFzc3guY29tJA \
CLERK_SECRET_KEY=sk_test_platzhalter npm run build
```

---

## 9. Was bewusst noch nicht gebaut ist

Phase 1 endet hier. Nicht enthalten und auch nicht vorbereitet über das
Nötigste hinaus:

* Cloud-Datenbank für **Projekte** – die liegen weiter im Browser.
* Gemeinsame Projekte mehrerer Mitarbeiter.
* Cloud-PDFs und Dateiablage.
* Eine ausgebaute Rechteverwaltung. `lib/rollen.ts` und `lib/zugang.ts` sind
  die eine Stelle, an der das später hängen wird.
