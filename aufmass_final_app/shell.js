'use strict';

// ============================================================================
//  Shell: Startbildschirm (Hub), Routing, Modul-Lebenszyklus
// ============================================================================
// Ein Link, ein Dokument, drei Ansichten:
//
//     #/           Hub – Auswahl zwischen den beiden Modulen
//     #/aufmass    Modul 1 – Positionserfassung   (script.js)
//     #/2d         Modul 2 – Gerüst-Zeichnung     (viewer2d.js)
//
// Beide Module bleiben nach dem ersten Öffnen im Dokument und werden nur
// sichtbar/unsichtbar geschaltet. Dadurch bleibt der komplette Zustand beim
// Wechsel erhalten: wer im 2D-Modul zeichnet, zum Hub geht und zurückkommt,
// findet Zeichnung, Zoom, Auswahl und Abschnitte unverändert vor.
// ============================================================================

const Shell = (() => {

  const ROUTEN = {
    '#/':        'hub',
    '#/aufmass': 'aufmass',
    '#/2d':      '2d'
  };
  const ROUTE_VON_ANSICHT = { hub: '#/', aufmass: '#/aufmass', '2d': '#/2d' };

  const module = {
    aufmass: typeof AufmassModul !== 'undefined' ? AufmassModul : null,
    '2d':    typeof ZweiDModul  !== 'undefined' ? ZweiDModul  : null
  };

  let aktuelleAnsicht = null;

  // ── Routen lesen/schreiben ────────────────────────────────────────────────

  function ansichtAusHash() {
    const h = window.location.hash || '#/';
    if (ROUTEN[h]) return ROUTEN[h];
    // Unbekannte oder alte Hashes (#/viewer, Tippfehler) → Hub statt Leerseite.
    return 'hub';
  }

  /** Wechselt die Route. Der eigentliche Wechsel läuft über `hashchange`,
   *  damit der Zurück-Button des Browsers immer dasselbe Verhalten zeigt. */
  function gehe(hash) {
    if (window.location.hash === hash) { zeige(ROUTEN[hash] || 'hub'); return; }
    window.location.hash = hash;
  }

  // ── Ansicht umschalten ────────────────────────────────────────────────────

  function zeige(ansicht) {
    if (!ROUTE_VON_ANSICHT[ansicht]) ansicht = 'hub';
    if (ansicht === aktuelleAnsicht) return;

    const vorher = aktuelleAnsicht;
    if (vorher && module[vorher]) module[vorher].deaktiviere();

    document.querySelectorAll('.view').forEach(el => {
      el.classList.toggle('view--aktiv', el.dataset.view === ansicht);
    });
    document.body.dataset.modul = ansicht;
    aktuelleAnsicht = ansicht;

    // Umschalter-Pille und Kacheln nachziehen
    document.querySelectorAll('.mod-tab').forEach(t => {
      const aktiv = t.dataset.ziel === ansicht;
      t.classList.toggle('aktiv', aktiv);
      t.setAttribute('aria-selected', aktiv ? 'true' : 'false');
    });

    if (ansicht === 'hub') {
      aktualisiereHub();
      // Der Hub startet oben; die Module behalten ihre Scrollposition selbst.
      window.scrollTo(0, 0);
    } else if (module[ansicht]) {
      // Erst sichtbar schalten, dann aktivieren: das 2D-Modul misst beim
      // Aktivieren die Zeichenfläche, das geht nur an einer sichtbaren Fläche.
      module[ansicht].aktiviere();
    }

    document.dispatchEvent(new CustomEvent('shell:ansicht', { detail: { ansicht, vorher } }));
  }

  // ── Kachel öffnet sich in die Modulansicht hinein ─────────────────────────
  // Shared-Element-Transition: die angetippte Kachel wächst kurz auf die
  // Fläche des Fensters, danach übernimmt die Modulansicht. Bei
  // `prefers-reduced-motion: reduce` entfällt die Animation komplett.

  const reduziert = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function oeffneMitUebergang(kachel, hash) {
    if (!kachel || reduziert() || !kachel.animate) { gehe(hash); return; }

    const box = kachel.getBoundingClientRect();
    const geist = kachel.cloneNode(true);
    geist.classList.add('hub-tile-geist');
    Object.assign(geist.style, {
      top: box.top + 'px', left: box.left + 'px',
      width: box.width + 'px', height: box.height + 'px'
    });
    document.body.appendChild(geist);
    kachel.classList.add('hub-tile-startet');

    const anim = geist.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      {
        transform: `translate(${-box.left + window.innerWidth / 2 - box.width / 2}px,` +
                   `${-box.top + window.innerHeight / 2 - box.height / 2}px) ` +
                   `scale(${Math.max(window.innerWidth / box.width, window.innerHeight / box.height) * 1.05})`,
        opacity: 0
      }
    ], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });

    // Route sofort wechseln – die Animation liegt nur darüber.
    gehe(hash);
    anim.onfinish = anim.oncancel = () => {
      geist.remove();
      kachel.classList.remove('hub-tile-startet');
    };
  }

  // ── Hub-Kennzahlen ────────────────────────────────────────────────────────

  function aktualisiereHub() {
    let liste = [];
    try { liste = JSON.parse(localStorage.getItem(GK.projekte)) || []; } catch (_) { liste = []; }

    const anzahl = liste.length;
    const mitZeichnung = liste.filter(p => p.zeichnung2d &&
      Array.isArray(p.zeichnung2d.sections) && p.zeichnung2d.sections.length).length;
    const felder = liste.reduce((n, p) => n + (p.zeichnung2d && Array.isArray(p.zeichnung2d.sections)
      ? p.zeichnung2d.sections.reduce((m, s) => m + ((s.bays || []).length), 0) : 0), 0);

    const setzeText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setzeText('hubProjektzahl', String(anzahl));
    setzeText('hubMetaAufmass', anzahl === 0
      ? 'Noch kein Projekt angelegt'
      : `${anzahl} Projekt${anzahl === 1 ? '' : 'e'} · zuletzt ${zuletztGeaendert(liste)}`);
    setzeText('hubMeta2d', mitZeichnung === 0
      ? 'Noch keine Zeichnung vorhanden'
      : `${mitZeichnung} Zeichnung${mitZeichnung === 1 ? '' : 'en'} · ${felder} Feld${felder === 1 ? '' : 'er'}`);
  }

  function zuletztGeaendert(liste) {
    const daten = liste.map(p => p.geaendert).filter(Boolean).sort();
    if (!daten.length) return 'unbekannt';
    const d = daten[daten.length - 1];
    const teile = String(d).slice(0, 10).split('-');
    return teile.length === 3 ? `${teile[2]}.${teile[1]}.${teile[0]}` : String(d);
  }

  // ── Projekt-Auswahldialog (früher start.js) ───────────────────────────────
  // Beim Öffnen eines Projekts aus der Übersicht fragt die App, ob das
  // Angebots-Aufmaß oder die 2D-Zeichnung dieses Projekts gemeint ist.

  let offenesProjekt = null;

  function oeffneAuswahl(proj) {
    const overlay = document.getElementById('appChooserOverlay');
    const nameEl  = document.getElementById('appChooserProjectName');
    if (!overlay) { AufmassModul.oeffneProjekt(proj.id); return; }
    offenesProjekt = proj;
    if (nameEl) nameEl.textContent = getProjectName(proj);
    overlay.classList.remove('hidden');
    // Ein gerade neu angelegtes Projekt soll auch dann als Karte sichtbar
    // sein, wenn der Dialog abgebrochen wird.
    renderProjectOverview();
  }

  function schliesseAuswahl() {
    const overlay = document.getElementById('appChooserOverlay');
    if (overlay) overlay.classList.add('hidden');
    offenesProjekt = null;
  }

  function verknuepfeAuswahl() {
    const overlay = document.getElementById('appChooserOverlay');
    if (!overlay) return;

    overlay.querySelectorAll('.app-chooser-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!offenesProjekt) return;
        const ziel = btn.dataset.ziel;
        const id   = offenesProjekt.id;
        localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, id);
        schliesseAuswahl();
        AufmassModul.oeffneProjekt(id);       // Projektakte in Modul 1 öffnen
        gehe(ziel === '2d' ? '#/2d' : '#/aufmass');
      });
    });

    document.getElementById('appChooserCancelBtn')?.addEventListener('click', schliesseAuswahl);
    overlay.addEventListener('click', e => { if (e.target === overlay) schliesseAuswahl(); });
  }

  // ── Ungespeicherte Änderungen ─────────────────────────────────────────────
  // Innerhalb der App geht nichts verloren (beide Module schreiben beim
  // Verlassen sofort). Nur beim echten Verlassen der Seite – Tab schließen,
  // Adresse ändern, neu laden – wird gefragt, falls noch ein gebündelter
  // Schreibvorgang aussteht.

  function ungespeicherte() {
    return Object.values(module).some(m => m && m.hatUngespeicherte && m.hatUngespeicherte());
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  function start() {
    // Aus der Projektübersicht heraus: Auswahl-Dialog statt direktem Sprung.
    window.onProjectOpenRequest = oeffneAuswahl;
    verknuepfeAuswahl();

    // Kacheln des Hubs
    document.querySelectorAll('.hub-tile').forEach(kachel => {
      kachel.addEventListener('click', e => {
        e.preventDefault();
        oeffneMitUebergang(kachel, kachel.dataset.ziel === '2d' ? '#/2d' : '#/aufmass');
      });
    });

    // Gesamt-Backup direkt vom Hub aus
    document.getElementById('hubBackupBtn')?.addEventListener('click', () => {
      AufmassModul.mount();
      exportAllProjectsBackup();
    });

    window.addEventListener('hashchange', () => zeige(ansichtAusHash()));

    window.addEventListener('beforeunload', e => {
      if (!ungespeicherte()) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    // Das Aufmaß-Modul verwaltet die Projektliste und ist die günstige Hälfte –
    // es wird direkt aufgebaut, damit Hub-Kennzahlen und Projektübersicht ohne
    // Verzögerung stimmen. Das 2D-Modul startet erst beim ersten Öffnen.
    AufmassModul.mount();

    // Alte Verknüpfung „index.html?resume=1" (Rücksprung aus dem früheren
    // 2D-Fenster): sie öffnet weiterhin das zuletzt bearbeitete Projekt – und
    // landet dafür jetzt in Modul 1 statt auf dem Startbildschirm.
    if (!window.location.hash && new URLSearchParams(window.location.search).get('resume')) {
      window.location.hash = '#/aufmass';
      return;                       // der hashchange übernimmt das Anzeigen
    }

    zeige(ansichtAusHash());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return { gehe, zeige, aktualisiereHub, ansicht: () => aktuelleAnsicht };
})();
