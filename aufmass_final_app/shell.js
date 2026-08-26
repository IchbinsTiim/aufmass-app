'use strict';

// ============================================================================
//  Shell: Startbildschirm (Hub), Routing, Modul-Lebenszyklus
// ============================================================================
// Ein Link, ein Dokument, fünf Ansichten:
//
//     #/                 Hub – Auswahl zwischen den beiden Modulen
//     #/aufmass          Modul 1 – Dateiübersicht
//     #/aufmass/editor   Modul 1 – Projektakte (script.js)
//     #/2d               Modul 2 – Dateiübersicht
//     #/2d/editor        Modul 2 – Gerüst-Zeichnung (viewer2d.js)
//
// Nach der Modulauswahl landet man bewusst NICHT im leeren Editor, sondern in
// der Dateiübersicht des Moduls – dort wird entschieden, woran gearbeitet wird.
//
// Beide Module bleiben nach dem ersten Öffnen im Dokument und werden nur
// sichtbar/unsichtbar geschaltet. Dadurch bleibt der Zustand beim Wechsel
// erhalten: wer im 2D-Modul zeichnet, zum Hub geht und zurückkommt, findet
// Zeichnung, Zoom, Auswahl und Abschnitte unverändert vor.
// ============================================================================

const Shell = (() => {

  // Route → { modul, unter }.  `modul: null` ist der Hub.
  const ROUTEN = {
    '#/':               { modul: null,      unter: null },
    '#/aufmass':        { modul: 'aufmass', unter: 'dateien' },
    '#/aufmass/editor': { modul: 'aufmass', unter: 'editor'  },
    '#/2d':             { modul: '2d',      unter: 'dateien' },
    '#/2d/editor':      { modul: '2d',      unter: 'editor'  }
  };

  const HASH_VON = (modul, unter) =>
    !modul ? '#/' : ('#/' + modul + (unter === 'editor' ? '/editor' : ''));

  const module = {
    aufmass: typeof AufmassModul !== 'undefined' ? AufmassModul : null,
    '2d':    typeof ZweiDModul  !== 'undefined' ? ZweiDModul  : null
  };

  let aktuellesModul  = null;
  let aktuelleUnter   = null;
  let letzterHash     = '#/';
  let hashRuecknahme  = false;   // eigene Korrektur der Adresse ignorieren

  // ── Routen lesen/schreiben ────────────────────────────────────────────────

  function routeVon(hash) {
    // Unbekannte oder alte Adressen (#/viewer, Tippfehler) → Hub statt Leerseite.
    return ROUTEN[hash || '#/'] || ROUTEN['#/'];
  }

  /** Wechselt die Route. Der eigentliche Wechsel läuft über `hashchange`,
   *  damit der Zurück-Button des Browsers immer dasselbe Verhalten zeigt. */
  function gehe(hash) {
    if (window.location.hash === hash || (!window.location.hash && hash === '#/')) {
      const r = routeVon(hash);
      zeige(r.modul, r.unter);
      return;
    }
    window.location.hash = hash;
  }

  const geheZuDateien = modul => gehe(HASH_VON(modul, 'dateien'));
  const geheZuEditor  = modul => gehe(HASH_VON(modul, 'editor'));

  // ── Ansicht umschalten ────────────────────────────────────────────────────

  function zeige(modul, unter) {
    const ansicht = modul || 'hub';
    const wechsel = modul !== aktuellesModul;

    if (wechsel && aktuellesModul && module[aktuellesModul]) {
      module[aktuellesModul].deaktiviere();
    }

    document.querySelectorAll('.view').forEach(el => {
      el.classList.toggle('view--aktiv', el.dataset.view === ansicht);
    });
    document.body.dataset.modul   = ansicht;
    document.body.dataset.ansicht = unter || 'hub';

    const vorherModul = aktuellesModul;
    aktuellesModul = modul;
    aktuelleUnter  = unter;

    // Umschalter-Pille nachziehen
    document.querySelectorAll('.mod-tab').forEach(t => {
      const aktiv = t.dataset.ziel === ansicht;
      t.classList.toggle('aktiv', aktiv);
      t.setAttribute('aria-selected', aktiv ? 'true' : 'false');
    });

    if (!modul) {
      aktualisiereHub();
      // Der Hub startet oben; die Module behalten ihre Scrollposition selbst.
      window.scrollTo(0, 0);
    } else if (module[modul]) {
      // Erst sichtbar schalten, dann aktivieren: das 2D-Modul misst beim
      // Aktivieren die Zeichenfläche, das geht nur an einer sichtbaren Fläche.
      module[modul].aktiviere(unter);
    }

    document.dispatchEvent(new CustomEvent('shell:ansicht', {
      detail: { ansicht, unter, vorher: vorherModul }
    }));
  }

  // ── Verlassen eines Editors ───────────────────────────────────────────────
  // Wer ein Dokument mit ungesicherten Änderungen verlässt, wird gefragt –
  // Speichern, Verwerfen oder doch dableiben. Die Module beantworten das
  // selbst, weil nur sie wissen, was sich geändert hat.

  async function darfWechseln(vonRoute, nachRoute) {
    if (!vonRoute.modul || vonRoute.unter !== 'editor') return true;
    // Innerhalb desselben Editors bleiben: nichts zu fragen.
    if (nachRoute.modul === vonRoute.modul && nachRoute.unter === 'editor') return true;
    const m = module[vonRoute.modul];
    if (!m || typeof m.darfVerlassen !== 'function') return true;
    try { return await m.darfVerlassen(); } catch (_) { return true; }
  }

  async function beiHashwechsel() {
    if (hashRuecknahme) { hashRuecknahme = false; return; }
    const neuHash = window.location.hash || '#/';
    const ziel    = routeVon(neuHash);
    const quelle  = routeVon(letzterHash);

    if (!(await darfWechseln(quelle, ziel))) {
      // Abgebrochen: Adresse zurückdrehen, Ansicht bleibt stehen.
      hashRuecknahme = true;
      window.location.hash = letzterHash;
      return;
    }
    letzterHash = neuHash;
    zeige(ziel.modul, ziel.unter);
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
  // Jede Kachel zeigt, wie viele Dateien das Modul verwaltet und welche zuletzt
  // bearbeitet wurde – letztere als Schnellzugriff direkt zum Weiterarbeiten.

  function aktualisiereHub() {
    if (typeof Speicher === 'undefined' || !Speicher.bereit()) return;

    const alle = Speicher.liste('aufmass');
    const mitZeichnung = alle.filter(d => d.data && d.data.zeichnung2d &&
      Array.isArray(d.data.zeichnung2d.sections) && d.data.zeichnung2d.sections.length);

    const setzeText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setzeText('hubProjektzahl', String(alle.length));
    setzeText('hubMetaAufmass', alle.length === 0
      ? 'Noch kein Projekt angelegt'
      : `${alle.length} Projekt${alle.length === 1 ? '' : 'e'} gespeichert`);
    setzeText('hubMeta2d', mitZeichnung.length === 0
      ? 'Noch keine Zeichnung vorhanden'
      : `${mitZeichnung.length} Zeichnung${mitZeichnung.length === 1 ? '' : 'en'} gespeichert`);

    schnellzugriff('hubQuickAufmass', 'aufmass', alle);
    schnellzugriff('hubQuick2d', 'zweid', mitZeichnung);
  }

  /** „Zuletzt: Baustelle Musterstraße · vor 2 Tagen" – ein Tipp öffnet die
   *  Datei direkt im Editor des jeweiligen Moduls. */
  function schnellzugriff(id, modulSchluessel, ersatzliste) {
    const btn = document.getElementById(id);
    if (!btn) return;

    const zuletzt = Speicher.zuletzt(modulSchluessel, 1)[0]
      // Noch nie in diesem Modul geöffnet? Dann die zuletzt geänderte Datei.
      || ersatzliste.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];

    if (!zuletzt) { btn.hidden = true; return; }

    const zeitpunkt = (zuletzt.zuletztGeoeffnet && zuletzt.zuletztGeoeffnet[modulSchluessel]) || zuletzt.updatedAt;
    btn.hidden = false;
    btn.innerHTML = '';
    btn.append('Zuletzt: ' + Speicher.anzeigename(zuletzt) + ' · ');
    const zeit = document.createElement('span');
    zeit.className = 'hub-quick-zeit';
    zeit.textContent = dvRelativeZeit(zeitpunkt);
    btn.appendChild(zeit);
    btn.onclick = e => {
      e.stopPropagation();
      const modul = modulSchluessel === 'zweid' ? '2d' : 'aufmass';
      if (module[modul] && module[modul].oeffneDokument) module[modul].oeffneDokument(zuletzt.id);
    };
  }

  // ── Projekt-Auswahldialog („Öffnen mit …") ────────────────────────────────
  // Aus der Dateiübersicht heraus lässt sich ein Projekt wahlweise im Aufmaß
  // oder direkt in der 2D-Zeichnung öffnen.

  let offenesProjekt = null;

  function oeffneAuswahl(proj) {
    const overlay = document.getElementById('appChooserOverlay');
    const nameEl  = document.getElementById('appChooserProjectName');
    if (!overlay) { AufmassModul.oeffneProjekt(proj.id); return; }
    offenesProjekt = proj;
    if (nameEl) nameEl.textContent = getProjectName(proj);
    overlay.classList.remove('hidden');
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
        schliesseAuswahl();
        if (ziel === '2d') {
          const dok = Speicher.dokZuDaten(id);
          if (dok && module['2d'] && module['2d'].oeffneDokument) { module['2d'].oeffneDokument(dok.id); return; }
        }
        localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, id);
        AufmassModul.oeffneProjekt(id);
      });
    });

    document.getElementById('appChooserCancelBtn')?.addEventListener('click', schliesseAuswahl);
    overlay.addEventListener('click', e => { if (e.target === overlay) schliesseAuswahl(); });
  }

  // ── Ungespeicherte Änderungen beim Schließen des Fensters ─────────────────
  // Innerhalb der App geht nichts verloren (beide Module schreiben beim
  // Verlassen sofort). Nur beim echten Verlassen der Seite – Tab schließen,
  // Adresse ändern, neu laden – wird gefragt, falls noch ein gebündelter
  // Schreibvorgang aussteht.

  function ungespeicherte() {
    return Object.values(module).some(m => m && m.hatUngespeicherte && m.hatUngespeicherte());
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async function start() {
    // Der Speicher muss stehen, bevor irgendein Modul Daten liest.
    try { await Speicher.init(); } catch (_) { /* Fallback greift im Speicher selbst */ }

    window.onProjectOpenRequest = oeffneAuswahl;
    verknuepfeAuswahl();

    // Kacheln des Hubs – sie führen in die Dateiübersicht des Moduls.
    document.querySelectorAll('.hub-tile').forEach(kachel => {
      const ziel = kachel.dataset.ziel === '2d' ? '#/2d' : '#/aufmass';
      kachel.addEventListener('click', e => {
        if (e.target.closest('.hub-quick')) return;   // Schnellzugriff hat Vorrang
        e.preventDefault();
        oeffneMitUebergang(kachel, ziel);
      });
      kachel.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oeffneMitUebergang(kachel, ziel); }
      });
    });

    // Gesamt-Backup direkt vom Hub aus
    document.getElementById('hubBackupBtn')?.addEventListener('click', () => {
      AufmassModul.mount();
      exportAllProjectsBackup();
    });

    // Der Modul-Umschalter führt immer in die Dateiübersicht – dort wird
    // entschieden, woran gearbeitet wird.
    document.querySelectorAll('.mod-tab').forEach(tab => {
      tab.addEventListener('click', e => {
        e.preventDefault();
        gehe(tab.dataset.ziel === '2d' ? '#/2d' : '#/aufmass');
      });
    });

    window.addEventListener('hashchange', beiHashwechsel);

    window.addEventListener('beforeunload', e => {
      // Beim Schließen des Tabs den letzten Stand noch wegschreiben.
      Object.values(module).forEach(m => { if (m && m.speichereJetzt) m.speichereJetzt(); });
      if (typeof Speicher !== 'undefined') Speicher.flush();
      if (!ungespeicherte()) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    // Das Aufmaß-Modul verwaltet die Projektliste und ist die günstige Hälfte –
    // es wird direkt aufgebaut, damit Hub-Kennzahlen und Dateiübersicht ohne
    // Verzögerung stimmen. Das 2D-Modul startet erst beim ersten Öffnen.
    AufmassModul.mount();

    // Alte Verknüpfung „index.html?resume=1" (Rücksprung aus dem früheren
    // 2D-Fenster): sie öffnet weiterhin das zuletzt bearbeitete Projekt.
    if (!window.location.hash && new URLSearchParams(window.location.search).get('resume')) {
      window.location.hash = '#/aufmass/editor';
      letzterHash = '#/aufmass/editor';
      return;                       // der hashchange übernimmt das Anzeigen
    }

    letzterHash = window.location.hash || '#/';
    const r = routeVon(letzterHash);
    zeige(r.modul, r.unter);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return {
    gehe, geheZuDateien, geheZuEditor, zeige, aktualisiereHub,
    ansicht: () => aktuellesModul || 'hub',
    unteransicht: () => aktuelleUnter,
    /** Merkt die aktuelle Adresse, ohne einen Wechsel auszulösen – nötig,
     *  wenn ein Modul die Route selbst gesetzt hat. */
    merkeRoute: hash => { letzterHash = hash; }
  };
})();
