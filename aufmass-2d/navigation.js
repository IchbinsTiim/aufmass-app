'use strict';

// ============================================================================
//  Navigation der 2D-Aufmaß-App
// ============================================================================
// Die App ist eine eigene Seite (/app/aufmass-2d) mit zwei Bildschirmen:
//
//     #/projekte    Zeichnungsübersicht (Vorgabe ohne Adresse)
//     #/zeichnung   die geöffnete Zeichnung
//
// Deep-Link, Neuladen und der Zurück-Button des Browsers landen immer im
// richtigen Bildschirm. Welcher Bildschirm was zeigt, entscheidet
// ZweiDModul.aktiviere() in viewer2d.js – hier steht nur, WANN.
//
// Diese Datei wird als letzte geladen: sie startet die App.
// ============================================================================

const Navigation2d = (() => {
  const UEBERSICHT = '#/projekte';
  const ZEICHNUNG  = '#/zeichnung';

  // Adressen aus der Zeit, als beide Anwendungen in einem Dokument lagen.
  const ALT = { '#/2d/projekte': UEBERSICHT, '#/2d': ZEICHNUNG };

  /** Ist gerade die Zeichnungsübersicht dran? Alles außer `#/zeichnung`
   *  gilt als Übersicht – eine unbekannte Adresse endet nie auf einer
   *  leeren Seite. */
  function istUebersicht() {
    return window.location.hash !== ZEICHNUNG;
  }

  /** Wechselt den Bildschirm. Der Wechsel läuft über `hashchange`, damit der
   *  Zurück-Button des Browsers immer dasselbe Verhalten zeigt. Ist der
   *  Bildschirm schon der richtige, bleibt alles, wie es ist. */
  function gehe(hash) {
    if (window.location.hash === hash) return;
    window.location.hash = hash;
  }

  function start() {
    const alt = ALT[window.location.hash];
    if (alt) history.replaceState(null, '', alt);
    else if (window.location.hash !== ZEICHNUNG && window.location.hash !== UEBERSICHT) {
      history.replaceState(null, '', UEBERSICHT);
    }

    window.addEventListener('hashchange', () => ZweiDModul.aktiviere());
    ZweiDModul.aktiviere();

    // Beim Verlassen der Seite (Tab schließen, anderes Programm, Neuladen)
    // alles sofort schreiben. Nachgefragt wird nur, wenn das nicht mehr ging.
    window.addEventListener('pagehide', () => ZweiDModul.sichern());
    window.addEventListener('beforeunload', e => {
      if (!ZweiDModul.hatUngespeicherte()) return;
      ZweiDModul.sichern();
      if (!ZweiDModul.hatUngespeicherte()) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return {
    UEBERSICHT, ZEICHNUNG,
    istUebersicht,
    gehe,
    zurUebersicht: () => gehe(UEBERSICHT),
    zurZeichnung:  () => gehe(ZEICHNUNG)
  };
})();
