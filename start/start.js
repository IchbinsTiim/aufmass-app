'use strict';

// ============================================================================
//  Startseite: Auswahl zwischen den beiden Anwendungen
// ============================================================================
// Die Startseite ist nur noch ein Wegweiser:
//
//     /app/aufmass      Aufmaß – Positionen erfassen & kalkulieren
//     /app/aufmass-2d   2D-Aufmaß – Gerüst zeichnen & PDF erzeugen
//
// Beide Anwendungen sind eigene Seiten mit eigenem Code und eigenen Daten.
// Diese Datei liest und schreibt keine davon – sie leitet höchstens alte
// Adressen weiter und blendet den Zugang zur Mitarbeiterverwaltung ein.
// ============================================================================

(() => {
  /* ── Alte Adressen ──────────────────────────────────────────────────────
     Als beide Programme noch in EINEM Dokument lagen, hießen ihre Adressen
     /app#/aufmass, /app#/2d und /app#/2d/projekte. Lesezeichen und geteilte
     Links darauf führen weiterhin an die richtige Stelle.                 */
  const ALTE_ROUTEN = {
    '#/aufmass':     '/app/aufmass',
    '#/2d':          '/app/aufmass-2d#/zeichnung',
    '#/2d/projekte': '/app/aufmass-2d#/projekte'
  };

  function alteAdresseWeiterleiten() {
    const ziel = ALTE_ROUTEN[window.location.hash];
    if (ziel) { window.location.replace(ziel); return true; }
    // `?resume=1` öffnete das zuletzt bearbeitete Aufmaß-Projekt.
    if (new URLSearchParams(window.location.search).get('resume')) {
      window.location.replace('/app/aufmass?resume=1');
      return true;
    }
    return false;
  }

  /* ── Kachel öffnet sich in die Anwendung hinein ──────────────────────────
     Die angetippte Kachel wächst kurz auf die Fläche des Fensters, während
     die Anwendung lädt. Bei `prefers-reduced-motion: reduce` entfällt die
     Animation komplett. Die Navigation selbst wartet nicht darauf.        */
  const reduziert = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function oeffneMitUebergang(kachel, ziel) {
    if (kachel && !reduziert() && kachel.animate) {
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
      anim.onfinish = anim.oncancel = () => {
        geist.remove();
        kachel.classList.remove('hub-tile-startet');
      };
    }
    window.location.href = ziel;
  }

  /* ── Mitarbeiterverwaltung ──────────────────────────────────────────────
     Der Link erscheint nur für Rollen mit dem Recht „Mitarbeiter ansehen".
     Die Seite dahinter prüft das Recht selbst noch einmal; hier geht es
     allein darum, niemandem einen Link vor die Nase zu setzen, der ihn zu
     einer Absage führt. */
  async function kontoAnzeigen() {
    try {
      const res = await fetch('/api/konto', { credentials: 'same-origin' });
      if (!res.ok) return;
      const daten = await res.json();
      const rechte = Array.isArray(daten?.konto?.rechte) ? daten.konto.rechte : [];
      const darf = rechte.includes('mitarbeiter.ansehen');
      ['hubMitarbeiterBtn', 'hubMitarbeiterSep'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !darf);
      });
    } catch (_) { /* offline: der Link bleibt einfach verborgen */ }
  }

  function start() {
    if (alteAdresseWeiterleiten()) return;
    // Auch ein Sprung innerhalb der Seite (#/aufmass eingetippt, Verlauf)
    // führt an die richtige Stelle.
    window.addEventListener('hashchange', alteAdresseWeiterleiten);

    document.querySelectorAll('.hub-tile').forEach(kachel => {
      kachel.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // neuer Tab: Browser machen lassen
        e.preventDefault();
        oeffneMitUebergang(kachel, kachel.getAttribute('href'));
      });
    });

    void kontoAnzeigen();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
