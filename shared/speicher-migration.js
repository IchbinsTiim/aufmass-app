'use strict';

// ============================================================================
//  Speicher-Migration – die EINZIGE Stelle, die beide Anwendungen kennt
// ============================================================================
// Die Aufmaß-App (/aufmass) und die 2D-Aufmaß-App (/aufmass-2d) sind getrennte
// Anwendungen mit getrennten Daten:
//
//   Aufmaß     geruest.aufmass.projekte / .ordner / .aktuellesProjekt …
//   2D-Aufmaß  geruest.2d.zeichnungen   / .ordner / .aktuelleZeichnung …
//
// Früher lag die 2D-Zeichnung als `zeichnung2d` IM Aufmaß-Projekt, und beide
// Programme teilten sich Projektliste und Ordner. Diese Datei übernimmt den
// Bestand einmalig in die getrennten Speicher. Sie enthält keine Fachlogik
// und wird von keiner App aufgerufen – sie läuft vor jedem App-Code auf
// jeder Seite (Start, Aufmaß, 2D), damit es egal ist, welche zuerst geöffnet
// wird.
//
// Grundsätze:
//   • Erst kopieren, dann entfernen – beides in einem Durchlauf, bevor
//     irgendeine App Daten liest. Geht das Schreiben schief, bleibt alles, wie
//     es war.
//   • Je Datensatz wiederholbar: Was schon übernommen wurde, steht in
//     `geruest.migration.appTrennung` und wird nie ein zweites Mal angelegt
//     (auch dann nicht, wenn der Nutzer die Zeichnung inzwischen gelöscht hat).
//   • Nichts überschreibt neuere Daten: gibt es die 2D-Zeichnung schon, bleibt
//     sie, wie sie ist.
//
// Die Kennungen der übernommenen Zeichnungen sind fest abgeleitet
// ('z2d_' + Projekt-ID). Genau so verfährt auch die Datenbank-Migration
// (db/migrations/20260928_app_trennung.sql) – dadurch treffen sich lokaler und
// Cloud-Bestand ohne Doppelungen.
// ============================================================================

(() => {
  const ALT = {
    // Schlüssel vor der Zusammenführung (bis 2026-09) → Schlüssel der Suite.
    aufmass_projects_v2:                     'geruest.aufmass.projekte',
    aufmass_folders_v1:                      'geruest.aufmass.ordner',
    aufmass_current_project_id:              'geruest.app.aktuellesProjekt',
    aufmass_ueberstand_wert:                 'geruest.aufmass.ueberstandWert',
    aufmass_last_backup_ts:                  'geruest.aufmass.letztesBackup',
    aufmass_backup_reminder_dismissed_until: 'geruest.aufmass.backupErinnerungBis',
    av_2d_favorites_v1:                      'geruest.2d.favoriten',
    av_2d_paste_opts_v1:                     'geruest.2d.einfuegenOptionen',
    av_2d_pdf_theme:                         'geruest.2d.pdfDesign',
    av_2d_pdf_include_hidden:                'geruest.2d.pdfMitAusgeblendeten',
    av_deviceMode:                           'geruest.2d.geraetemodus'
  };

  const K = {
    gemeinsamAktuell:  'geruest.app.aktuellesProjekt',   // bis zur Trennung beiden gemeinsam
    aufmassProjekte:   'geruest.aufmass.projekte',
    aufmassOrdner:     'geruest.aufmass.ordner',
    aufmassAktuell:    'geruest.aufmass.aktuellesProjekt',
    zeichnungen:       'geruest.2d.zeichnungen',
    zeichnungsOrdner:  'geruest.2d.ordner',
    zeichnungAktuell:  'geruest.2d.aktuelleZeichnung',
    marker:            'geruest.migration.appTrennung'
  };

  const PRAEFIX = 'z2d_';

  const lies = (schluessel, fallback) => {
    try {
      const wert = JSON.parse(localStorage.getItem(schluessel) || 'null');
      return wert == null ? fallback : wert;
    } catch (_) { return fallback; }
  };

  // ── 1. Schlüssel aus der Zeit vor der Zusammenführung ─────────────────────
  // Kopieren, dann den alten Schlüssel entfernen. Ist der neue schon belegt,
  // hat er Vorrang – eine Migration überschreibt nie neuere Daten.
  function alteSchluesselUmziehen() {
    Object.entries(ALT).forEach(([alt, neu]) => {
      try {
        const wert = localStorage.getItem(alt);
        if (wert === null) return;
        if (localStorage.getItem(neu) === null) localStorage.setItem(neu, wert);
        localStorage.removeItem(alt);
      } catch (_) { /* privater Modus / Speicher voll → still weiterarbeiten */ }
    });
  }

  /** Cloud-Stand der Quelle, übertragen auf die neue Zeichnung. Eine
   *  Zeichnung, deren Projekt schon sauber in der Cloud lag, wartet auf die
   *  Cloud-Kopie derselben Kennung (siehe SQL-Migration) statt sie doppelt
   *  anzulegen; alles andere ist eine lokale Änderung und wird hochgeladen. */
  function cloudMeta(quelle) {
    const meta = quelle && quelle._cloud;
    if (!meta) return undefined;
    const sauber = !!meta.revision && !meta.dirty;
    return {
      revision: null,
      rolle: meta.rolle || 'owner',
      ownerUserId: meta.ownerUserId || null,
      eigenes: meta.eigenes !== false,
      erstelltVon: meta.erstelltVon || undefined,
      dirty: !sauber,
      uebernommen: true
    };
  }

  // ── 2. Zeichnungen aus den Aufmaß-Projekten lösen ─────────────────────────
  function zeichnungenTrennen() {
    const projekte = lies(K.aufmassProjekte, []);
    if (!Array.isArray(projekte)) return;

    const marker   = lies(K.marker, {});
    const erledigt = new Set(Array.isArray(marker.projekte) ? marker.projekte : []);
    const zeichnungen = lies(K.zeichnungen, []);
    const zOrdner     = lies(K.zeichnungsOrdner, []);
    const aOrdner     = lies(K.aufmassOrdner, []);
    if (!Array.isArray(zeichnungen) || !Array.isArray(zOrdner)) return;

    const vorhanden  = new Set(zeichnungen.map(z => z && z.id));
    const ordnerDa   = new Set(zOrdner.map(o => o && o.id));
    let aufmassGeaendert = false, zweiDGeaendert = false;

    projekte.forEach(p => {
      if (!p || typeof p !== 'object' || !('zeichnung2d' in p)) return;
      const z = p.zeichnung2d;
      const echteZeichnung = z && typeof z === 'object' && Array.isArray(z.sections);

      if (echteZeichnung && !erledigt.has(p.id)) {
        const id = PRAEFIX + p.id;
        if (!vorhanden.has(id)) {
          // Den Ordner mitnehmen, in dem die Zeichnung lag – als Ordner der
          // 2D-App (eigene Kennung, eigener Datensatz).
          let folderId = null;
          if (p.folderId) {
            const quelle = Array.isArray(aOrdner) ? aOrdner.find(o => o && o.id === p.folderId) : null;
            if (quelle) {
              folderId = PRAEFIX + quelle.id;
              if (!ordnerDa.has(folderId)) {
                const kopie = { id: folderId, name: quelle.name || 'Ordner' };
                if (quelle.erstellt) kopie.erstellt = quelle.erstellt;
                if (quelle._cloud) kopie._cloud = { revision: null, dirty: !(quelle._cloud.revision && !quelle._cloud.dirty) };
                zOrdner.push(kopie);
                ordnerDa.add(folderId);
              }
            }
          }
          const neu = {
            id,
            name: p.name || '',
            folderId,
            erstellt: p.erstellt || null,
            geaendert: p.geaendert || null,
            anschrift: p.anschrift || null,
            ausAufmass: p.id,
            zeichnung2d: JSON.parse(JSON.stringify(z))
          };
          const meta = cloudMeta(p);
          if (meta) neu._cloud = meta;
          zeichnungen.push(neu);
          vorhanden.add(id);
          zweiDGeaendert = true;
        }
        erledigt.add(p.id);
      }

      // Die Aufmaß-App kennt keine Zeichnung mehr. Entfernt wird erst, wenn
      // die Zeichnung sicher übernommen ist (oder es gar keine war).
      if (!echteZeichnung || erledigt.has(p.id)) {
        delete p.zeichnung2d;
        aufmassGeaendert = true;
      }
    });

    // Reihenfolge: zuerst die 2D-Daten schreiben. Schlägt das fehl (Speicher
    // voll), bleibt das Aufmaß-Projekt unverändert – nichts geht verloren.
    try {
      if (zweiDGeaendert) {
        localStorage.setItem(K.zeichnungsOrdner, JSON.stringify(zOrdner));
        localStorage.setItem(K.zeichnungen, JSON.stringify(zeichnungen));
      }
      localStorage.setItem(K.marker, JSON.stringify({ version: 1, projekte: Array.from(erledigt) }));
      if (aufmassGeaendert) localStorage.setItem(K.aufmassProjekte, JSON.stringify(projekte));
    } catch (_) { /* nächster Seitenaufruf versucht es erneut */ }
  }

  // ── 3. „Zuletzt geöffnet" gehört jetzt jeder App selbst ───────────────────
  function aktuellesProjektTrennen() {
    try {
      const alt = localStorage.getItem(K.gemeinsamAktuell);
      if (alt === null) return;
      if (localStorage.getItem(K.aufmassAktuell) === null) localStorage.setItem(K.aufmassAktuell, alt);
      if (localStorage.getItem(K.zeichnungAktuell) === null) {
        const zeichnungen = lies(K.zeichnungen, []);
        const id = PRAEFIX + alt;
        if (Array.isArray(zeichnungen) && zeichnungen.some(z => z && z.id === id)) {
          localStorage.setItem(K.zeichnungAktuell, id);
        }
      }
      localStorage.removeItem(K.gemeinsamAktuell);
    } catch (_) { /* siehe oben */ }
  }

  alteSchluesselUmziehen();
  zeichnungenTrennen();
  aktuellesProjektTrennen();
})();
