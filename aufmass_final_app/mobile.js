/* ===========================================================================
   Handy-Fassung – Verhalten
   ---------------------------------------------------------------------------
   Gegenstück zu `mobile.css`. Diese Datei ändert KEINE Fachlogik: sie legt
   kein zweites Speichern an, kein zweites PDF, keine zweite Projektliste.
   Sie ordnet ausschließlich um, was es schon gibt – nach demselben Muster,
   nach dem das 2D-Modul im Handy-Modus seine Werkzeuge umhängt
   (`syncToolbarOrt`): DASSELBE Element wandert an einen Ort, an dem der
   Daumen es erreicht, und wandert zurück, sobald der Bildschirm es hergibt.

   Vier Aufgaben:
     1  Handy erkennen und `body[data-handy]` setzen
     2  Navigationsleiste unten statt Umschalter-Pille oben
     3  Projektakte: Sprungleiste, faltbare Karten, feste Aktionsleiste
     4  Tastatur erkennen, damit feste Leisten nicht im Bild stehen

   Nichts davon läuft auf Tablet oder Desktop: dort bleibt `data-handy="0"`,
   jedes umgezogene Element steht wieder an seinem ursprünglichen Platz und
   `mobile.css` greift nicht.
   =========================================================================== */

(function () {
  'use strict';

  /* Dieselben Schwellen wie im 2D-Modul (HANDY_MAX_BREITE/-HOEHE), erweitert
     um die schmalen Tablets im Hochformat: bis 720 px wird einspaltig
     gearbeitet, das ist die Grenze, ab der die Module ohnehin umbrechen. */
  const HANDY_BREITE = 720;
  const HANDY_HOEHE  = 460;

  const SPEICHER_FALTUNG = 'geruest.handy.faltung';

  /* Kurzformen für die Sprungleiste: „Technik (DIN 18451)" ist als
     Überschrift richtig und als Sprungmarke zu lang. */
  const KURZ = {
    'Projekt':                            'Projekt',
    'Anschrift':                          'Adresse',
    'Gerüsttyp':                          'Typ',
    'Technik (DIN 18451)':                'Technik',
    'Baustelle / Logistik':               'Logistik',
    '2D-Zeichnung':                       '2D',
    'Hausseiten':                         'Seiten',
    'Positionen':                         'Positionen',
    'Notizen / Allgemeine Informationen': 'Notizen',
    'Zusammenfassung':                    'Summe'
  };

  /* Was beim ersten Öffnen aufgeklappt ist. Alles andere ist eingeklappt –
     nicht entfernt: die Überschrift bleibt als Griff stehen, ein Tipp
     öffnet sie. Die Wahl des Nutzers wird gemerkt. */
  const OFFEN_VORGABE = ['Projekt', 'Hausseiten', 'Positionen', 'Zusammenfassung'];

  /* ── kleine Helfer ────────────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);

  function svgIcon(d, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
         + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         + d + (extra || '') + '</svg>';
  }

  function ladeFaltung() {
    try { return JSON.parse(localStorage.getItem(SPEICHER_FALTUNG)) || {}; }
    catch (e) { return {}; }
  }
  function sichereFaltung(map) {
    try { localStorage.setItem(SPEICHER_FALTUNG, JSON.stringify(map)); } catch (e) { /* privater Modus */ }
  }

  /** Merkt sich, wo ein Element herkommt – damit es exakt dorthin zurückkann. */
  function merkeHeimat(el) {
    if (el && !el.__handyHeim) el.__handyHeim = { eltern: el.parentElement, danach: el.nextElementSibling };
  }
  function zurueckNachHause(el) {
    const h = el && el.__handyHeim;
    if (!h || !h.eltern) return;
    if (h.danach && h.danach.parentElement === h.eltern) h.eltern.insertBefore(el, h.danach);
    else h.eltern.appendChild(el);
  }


  /* ═══════════════════════════════════════════════════════════════════════
     1  Handy erkennen
     ═══════════════════════════════════════════════════════════════════════ */

  function istHandy() {
    return window.innerWidth <= HANDY_BREITE || window.innerHeight <= HANDY_HOEHE;
  }


  /* ═══════════════════════════════════════════════════════════════════════
     2  Navigationsleiste unten
     ---------------------------------------------------------------------
     Dieselben drei Ziele wie die Umschalter-Pille, dieselben Adressen,
     derselbe Hash-Router. Nur dort, wo der Daumen ohnehin liegt.
     ═══════════════════════════════════════════════════════════════════════ */

  const NAV = [
    { ziel: 'hub',     href: '#/',        text: 'Start',
      ico: svgIcon('<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10.5V20h12v-9.5"/>') },
    { ziel: 'aufmass', href: '#/aufmass', text: 'Aufmaß',
      ico: svgIcon('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>') },
    { ziel: '2d',      href: '#/2d',      text: '2D',
      ico: svgIcon('<path d="M3 20h18"/><path d="M5 20V9h5v11M14 20V5h5v15"/><path d="M5 14h5M14 12h5"/>') }
  ];

  function baueNav() {
    if ($('handyNav')) return $('handyNav');
    const nav = document.createElement('nav');
    nav.id = 'handyNav';
    nav.setAttribute('aria-label', 'Bereich wechseln');
    NAV.forEach(e => {
      const a = document.createElement('a');
      a.href = e.href;
      a.dataset.ziel = e.ziel;
      a.innerHTML = e.ico
        + '<span>' + e.text + '</span>'
        + '<span class="handy-nav-punkt" aria-hidden="true"></span>';
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
    return nav;
  }

  function markiereNav() {
    const modul = document.body.dataset.modul || 'hub';
    const nav = $('handyNav');
    if (!nav) return;
    nav.querySelectorAll('a').forEach(a => {
      if (a.dataset.ziel === modul) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     3  Projektakte: Sprungleiste, Faltkarten, Aktionsleiste
     ═══════════════════════════════════════════════════════════════════════ */

  /** Kopfzeile einer Karte: entweder die Überschrift selbst oder die
   *  Kopfzeile mit Überschrift und Aktion (》+ Seite《). */
  function kartenKopf(card) {
    return card.querySelector(':scope > .card-title, :scope > .section-header');
  }
  function kartenTitel(card) {
    const kopf = kartenKopf(card);
    if (!kopf) return null;
    return kopf.classList.contains('card-title') ? kopf : kopf.querySelector('.card-title');
  }

  function kurzName(text) {
    if (KURZ[text]) return KURZ[text];
    return text.split(/[(/]/)[0].trim() || text;
  }

  /* ── Faltkarten ─────────────────────────────────────────────────────── */

  function setzeFaltung(card, zustand, merken) {
    card.dataset.falt = zustand;
    const btn = card.querySelector(':scope > .card-title > .handy-falt-btn, :scope > .section-header > .handy-falt-btn');
    if (btn) btn.setAttribute('aria-expanded', zustand === 'auf' ? 'true' : 'false');
    if (merken !== false) {
      const map = ladeFaltung();
      map[card.dataset.handyKarte] = zustand;
      sichereFaltung(map);
    }
  }

  function ruesteFaltungAus(card) {
    const kopf  = kartenKopf(card);
    const titel = kartenTitel(card);
    if (!kopf || !titel) return false;

    if (!card.dataset.handyKarte) card.dataset.handyKarte = kurzName(titel.textContent.trim());

    if (!kopf.querySelector(':scope > .handy-falt-btn')) {
      const marke = document.createElement('span');
      marke.className = 'handy-falt-marke';
      marke.hidden = true;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'handy-falt-btn';
      btn.setAttribute('aria-label', 'Abschnitt auf- oder zuklappen');
      btn.innerHTML = svgIcon('<path d="M5 9l7 7 7-7"/>');

      /* Der ganze Kopf ist der Griff – nicht nur ein 40-px-Pfeil. Knöpfe
         und Eingaben in der Kopfzeile behalten aber ihre eigene Aufgabe. */
      kopf.addEventListener('click', (ev) => {
        if (document.body.dataset.handy !== '1') return;
        if (ev.target.closest('button, a, input, select, textarea') &&
            !ev.target.closest('.handy-falt-btn')) return;
        setzeFaltung(card, card.dataset.falt === 'zu' ? 'auf' : 'zu');
      });

      kopf.appendChild(marke);
      kopf.appendChild(btn);
    }
    return true;
  }

  /** Zeigt zugeklappt, dass hinter der Karte etwas steckt (》2 Seiten《). */
  function aktualisiereMarken() {
    const zaehle = (sel) => document.querySelectorAll(sel).length;
    const setze = (schluessel, text) => {
      const card = document.querySelector('#projectScreen .card[data-handy-karte="' + schluessel + '"]');
      const marke = card && card.querySelector('.handy-falt-marke');
      if (!marke) return;
      marke.textContent = text;
      marke.hidden = !text;
    };
    const seiten = zaehle('#seitenContainer > .seite-card, #seitenContainer > .card, #seitenContainer > div');
    const pos    = zaehle('#zusatzContainer > *');
    setze('Seiten',     seiten ? seiten + (seiten === 1 ? ' Seite' : ' Seiten') : '');
    setze('Positionen', pos ? pos + (pos === 1 ? ' Position' : ' Positionen') : '');
  }

  /* ── Sprungleiste ───────────────────────────────────────────────────── */

  let sprungKarten = [];

  function baueSprungleiste() {
    const schirm = $('projectScreen');
    if (!schirm) return;

    let leiste = $('handySprung');
    if (!leiste) {
      leiste = document.createElement('div');
      leiste.id = 'handySprung';
      leiste.setAttribute('aria-label', 'Zu einem Abschnitt springen');
      const rail = document.createElement('div');
      rail.className = 'handy-wischleiste';
      leiste.appendChild(rail);
      const kopf = schirm.querySelector(':scope > .app-header');
      if (kopf) kopf.after(leiste); else schirm.prepend(leiste);
    }

    const rail = leiste.firstElementChild;
    const gemerkt = ladeFaltung();
    sprungKarten = [];
    rail.textContent = '';

    schirm.querySelectorAll(':scope > .screen-content > .card').forEach(card => {
      if (!ruesteFaltungAus(card)) return;                     // z. B. die Aktionskarte
      const schluessel = card.dataset.handyKarte;
      const zustand = gemerkt[schluessel]
        || (OFFEN_VORGABE.indexOf(schluessel) >= 0 ? 'auf' : 'zu');
      setzeFaltung(card, zustand, false);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'handy-sprung-btn';
      btn.textContent = schluessel;
      btn.addEventListener('click', () => {
        setzeFaltung(card, 'auf');                             // Sprungziel steht offen
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      rail.appendChild(btn);
      sprungKarten.push({ card: card, btn: btn });
    });

    aktualisiereMarken();
    markiereSprung();
  }

  /** Hebt die Marke hervor, in deren Abschnitt gerade gelesen wird. */
  function markiereSprung() {
    if (!sprungKarten.length) return;
    const grenze = 140;                       // Kopfzeile + Sprungleiste
    let aktiv = sprungKarten[0];
    sprungKarten.forEach(e => {
      if (e.card.getBoundingClientRect().top <= grenze) aktiv = e;
    });
    sprungKarten.forEach(e => {
      if (e === aktiv) e.btn.setAttribute('aria-current', 'true');
      else e.btn.removeAttribute('aria-current');
    });

    /* Die Leiste zieht seitlich mit – aber nur seitlich: ein
       `scrollIntoView` würde beim Lesen auch die Seite verspringen lassen. */
    const rail = aktiv.btn.parentElement;
    const b = aktiv.btn;
    const links = b.offsetLeft - 12;
    const rechts = b.offsetLeft + b.offsetWidth + 12 - rail.clientWidth;
    if (links < rail.scrollLeft) rail.scrollLeft = links;
    else if (rechts > rail.scrollLeft) rail.scrollLeft = rechts;
  }

  /* ── Aktionsleiste ──────────────────────────────────────────────────── */

  /* Umzugsliste: [ID des Knopfes]. Es sind DIESELBEN Knöpfe wie in der
     Aktionskarte am Seitenende – kein zweites Speichern, kein zweites PDF. */
  const AKTION_HAUPT = ['saveProjectBtn', 'exportPdfBtn'];
  const AKTION_MEHR  = ['exportJsonBtn', 'importJsonBtn'];

  function baueAktionsleiste() {
    if ($('handyAktionen')) return;

    const mehr = document.createElement('div');
    mehr.id = 'handyMehr';

    const leiste = document.createElement('div');
    leiste.id = 'handyAktionen';

    const mehrBtn = document.createElement('button');
    mehrBtn.type = 'button';
    mehrBtn.className = 'handy-mehr-btn';
    mehrBtn.setAttribute('aria-expanded', 'false');
    mehrBtn.setAttribute('aria-controls', 'handyMehr');
    mehrBtn.setAttribute('aria-label', 'Weitere Aktionen: JSON exportieren oder laden');
    mehrBtn.textContent = '⋯';
    mehrBtn.addEventListener('click', () => {
      const offen = mehr.classList.toggle('offen');
      mehrBtn.setAttribute('aria-expanded', offen ? 'true' : 'false');
    });

    leiste.appendChild(mehrBtn);

    /* Beide Leisten hängen IN der Projektakte, nicht am <body>: nur dort
       greifen die Modul-Regeln (`#am-root .btn-primary` …), und nur dort
       trägt „Speichern" das Gelb des Aufmaßes statt eines Ersatztons. Am
       festen Sitz am Bildschirmrand ändert das nichts – `position: fixed`
       hängt nicht am Platz im Dokument. Nebeneffekt, der passt: verlässt
       man die Akte, ist die Leiste automatisch mit weg. */
    const akte = $('projectScreen') || document.body;
    akte.appendChild(mehr);
    akte.appendChild(leiste);

    /* Ein Tipp neben das Menü schließt es wieder. */
    document.addEventListener('click', (ev) => {
      if (!mehr.classList.contains('offen')) return;
      if (ev.target.closest('#handyMehr, .handy-mehr-btn')) return;
      mehr.classList.remove('offen');
      mehrBtn.setAttribute('aria-expanded', 'false');
    }, true);
  }

  function syncAktionsOrt(anHandy) {
    const leiste = $('handyAktionen');
    const mehr   = $('handyMehr');
    if (!leiste || !mehr) return;

    if (anHandy) {
      AKTION_HAUPT.forEach(id => {
        const b = $(id);
        if (!b) return;
        merkeHeimat(b);
        if (b.parentElement !== leiste) leiste.insertBefore(b, leiste.querySelector('.handy-mehr-btn'));
      });
      AKTION_MEHR.forEach(id => {
        const b = $(id);
        if (!b) return;
        merkeHeimat(b);
        if (b.parentElement !== mehr) mehr.appendChild(b);
      });
    } else {
      /* Rückwärts einhängen: der Anker steht dann garantiert schon wieder
         an seinem Platz (dasselbe Vorgehen wie im 2D-Modul). */
      AKTION_MEHR.concat(AKTION_HAUPT).reverse().forEach(id => {
        const b = $(id);
        if (b && b.__handyHeim && b.parentElement !== b.__handyHeim.eltern) zurueckNachHause(b);
      });
      mehr.classList.remove('offen');
      const mb = leiste.querySelector('.handy-mehr-btn');
      if (mb) mb.setAttribute('aria-expanded', 'false');
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     4  Zustand anwenden
     ═══════════════════════════════════════════════════════════════════════ */

  /** Sichtbar ist immer nur EINE untere Leiste – gestapelt fräßen sie den
   *  halben Bildschirm. In der Zeichnung selbst steht gar keine. */
  function bestimmeLeisten() {
    const modul = document.body.dataset.modul || 'hub';
    const akte  = modul === 'aufmass'
               && $('projectScreen') && !$('projectScreen').classList.contains('hidden');
    const zeichnung = modul === '2d'
               && $('td-projekte') && $('td-projekte').classList.contains('hidden');
    return { aktionen: !!akte, nav: !akte && !zeichnung };
  }

  let anHandyVorher = null;

  function anwenden() {
    const anHandy = istHandy();
    const koerper = document.body;
    koerper.dataset.handy = anHandy ? '1' : '0';

    if (anHandyVorher !== anHandy) syncAktionsOrt(anHandy);
    anHandyVorher = anHandy;

    if (!anHandy) {
      koerper.dataset.handyNav = '0';
      koerper.dataset.handyAktionen = '0';
      return;
    }

    const l = bestimmeLeisten();
    koerper.dataset.handyNav      = l.nav ? '1' : '0';
    koerper.dataset.handyAktionen = l.aktionen ? '1' : '0';
    if (!l.aktionen) {
      const mehr = $('handyMehr');
      if (mehr) mehr.classList.remove('offen');
    }
    markiereNav();
    if (l.aktionen) markiereSprung();
  }

  /* Anwenden zusammenfassen: mehrere Auslöser in einem Bildaufbau. */
  let geplant = false;
  function plane() {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; anwenden(); });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     5  Tastatur
     ---------------------------------------------------------------------
     Die Bildschirmtastatur verkleinert nicht das Fenster, sondern nur das
     sichtbare Fenster (visualViewport). Ohne diese Prüfung stünde die feste
     Aktionsleiste mitten im Bild – über dem Feld, in das getippt wird.
     ═══════════════════════════════════════════════════════════════════════ */

  function beobachteTastatur() {
    const vv = window.visualViewport;
    if (!vv) return;
    const pruefe = () => {
      const offen = (window.innerHeight - vv.height) > 140;
      document.body.dataset.handyTastatur = offen ? '1' : '0';
    };
    vv.addEventListener('resize', pruefe);
    pruefe();
  }


  /* ═══════════════════════════════════════════════════════════════════════
     6  Start
     ═══════════════════════════════════════════════════════════════════════ */

  function start() {
    /* Einmal aufbauen, gleich ob Handy oder nicht: sichtbar wird ohnehin
       nur, was `body[data-handy]` freigibt. So gibt es beim Drehen oder
       beim Verkleinern des Fensters nichts nachzubauen – und der erste
       Bildaufbau bleibt frei von Sprüngen. */
    baueNav();
    baueAktionsleiste();
    baueSprungleiste();

    anwenden();
    beobachteTastatur();

    window.addEventListener('resize', plane);
    window.addEventListener('orientationchange', plane);
    window.addEventListener('hashchange', plane);

    /* Modulwechsel (body[data-modul]) und Bildschirmwechsel innerhalb des
       Aufmaßes (.screen.hidden) sind die beiden Auslöser, an denen sich die
       untere Leiste ändert. */
    new MutationObserver(plane).observe(document.body, {
      attributes: true, attributeFilter: ['data-modul']
    });
    ['homeScreen', 'projectScreen', 'td-projekte'].forEach(id => {
      const el = $(id);
      if (el) new MutationObserver(plane).observe(el, {
        attributes: true, attributeFilter: ['class']
      });
    });

    /* Seiten und Positionen kommen und gehen – die Marken zeigen mit. */
    ['seitenContainer', 'zusatzContainer'].forEach(id => {
      const el = $(id);
      if (el) new MutationObserver(() => {
        if (document.body.dataset.handy === '1') aktualisiereMarken();
      }).observe(el, { childList: true });
    });

    let scrollGeplant = false;
    window.addEventListener('scroll', () => {
      if (scrollGeplant || document.body.dataset.handyAktionen !== '1') return;
      scrollGeplant = true;
      requestAnimationFrame(() => { scrollGeplant = false; markiereSprung(); });
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* Für die Tests und für das 2D-Modul einsehbar – nicht zum Fernsteuern. */
  window.HandyFassung = {
    istHandy: istHandy,
    anwenden: anwenden,
    baueSprungleiste: baueSprungleiste
  };
})();
