'use strict';

// ============================================================================
//  Gemeinsame Basis beider Module (Aufmaß + 2D-Aufmaß)
// ============================================================================
// Diese Datei wird VOR script.js und viewer2d.js geladen. Sie enthält nur das,
// was sich beide Module wirklich teilen:
//
//   • Speicher-Schlüssel mit Namensraum  (geruest.aufmass.* / geruest.2d.* /
//     geruest.app.*) samt einmaliger Migration der alten, unpräfixierten
//     Schlüssel – bestehende Daten gehen dabei nicht verloren.
//   • Toast-Meldungen (vorher doppelt in script.js und viewer2d.js).
//   • Zahlenformat für Maße.
//
// Die Fachlogik der Module bleibt bewusst getrennt: hier steht nichts über
// Positionen, Aufmaßregeln oder Zeichnungen.
// ============================================================================

const GK = {
  // App-weit (von beiden Modulen genutzt)
  aktuellesProjekt:     'geruest.app.aktuellesProjekt',

  // Modul „Aufmaß"
  projekte:             'geruest.aufmass.projekte',
  ordner:               'geruest.aufmass.ordner',
  ueberstandWert:       'geruest.aufmass.ueberstandWert',
  letztesBackup:        'geruest.aufmass.letztesBackup',
  backupErinnerungBis:  'geruest.aufmass.backupErinnerungBis',

  // Modul „2D-Aufmaß"
  favoriten:            'geruest.2d.favoriten',
  einfuegenOptionen:    'geruest.2d.einfuegenOptionen',
  pdfDesign:            'geruest.2d.pdfDesign',
  pdfMitAusgeblendeten: 'geruest.2d.pdfMitAusgeblendeten',
  geraetemodus:         'geruest.2d.geraetemodus'
};

// Alte Schlüssel → neue Schlüssel. Beim ersten Start nach dem Zusammenführen
// werden vorhandene Daten umgehängt (kopieren, dann alten Schlüssel entfernen).
// Fehlt ein alter Schlüssel, passiert nichts; ist der neue schon belegt, hat
// der neue Vorrang – die Migration überschreibt nie neuere Daten.
const GERUEST_MIGRATION = [
  ['aufmass_projects_v2',                      GK.projekte],
  ['aufmass_folders_v1',                       GK.ordner],
  ['aufmass_current_project_id',               GK.aktuellesProjekt],
  ['aufmass_ueberstand_wert',                  GK.ueberstandWert],
  ['aufmass_last_backup_ts',                   GK.letztesBackup],
  ['aufmass_backup_reminder_dismissed_until',  GK.backupErinnerungBis],
  ['av_2d_favorites_v1',                       GK.favoriten],
  ['av_2d_paste_opts_v1',                      GK.einfuegenOptionen],
  ['av_2d_pdf_theme',                          GK.pdfDesign],
  ['av_2d_pdf_include_hidden',                 GK.pdfMitAusgeblendeten],
  ['av_deviceMode',                            GK.geraetemodus]
];

// Beide Module haben diesen Schlüssel bisher jeweils selbst deklariert (mit
// identischem Wert) – daraus wäre beim Zusammenführen ein doppelt deklarierter
// Bezeichner geworden. Jetzt steht er genau einmal hier.
const CURRENT_PROJECT_STORAGE_KEY = GK.aktuellesProjekt;

function migriereSpeicher() {
  let umgezogen = 0;
  GERUEST_MIGRATION.forEach(([alt, neu]) => {
    try {
      const wert = localStorage.getItem(alt);
      if (wert === null) return;
      if (localStorage.getItem(neu) === null) {
        localStorage.setItem(neu, wert);
        umgezogen++;
      }
      localStorage.removeItem(alt);
    } catch (_) { /* privater Modus / Speicher voll → still weiterarbeiten */ }
  });
  return umgezogen;
}

// Läuft sofort beim Laden – vor jedem Modul-Code, der Daten liest.
migriereSpeicher();

// ── Gemeinsamer Toast ───────────────────────────────────────────────────────
// Beide Module riefen bisher ein eigenes, identisches showToast() auf. Jetzt
// gibt es genau eines; das Ziel-Element (#toastEl) liegt in der Shell.

let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toastEl');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Zahlen ──────────────────────────────────────────────────────────────────
// Deutsches Format mit zwei Nachkommastellen (Maße, Flächen, Mengen).

function geruestFmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0,00';
  return Number(n).toFixed(2).replace('.', ',');
}
