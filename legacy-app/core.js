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
  // Ergebnis der Gerätewahl („iphone"/„ipad") – wird geschrieben, damit ältere
  // Auswertungen und Tests weiterhin ablesen können, wie die App gerade läuft.
  geraetemodus:         'geruest.2d.geraetemodus',
  // Die WAHL des Nutzers: „auto" (Bildschirm entscheidet), „handy", „tablet".
  ansichtsmodus:        'geruest.2d.ansichtsmodus',
  // Werkzeug-Menü offen/zu – bleibt über Neuladen hinweg erhalten.
  werkzeugMenue:        'geruest.2d.werkzeugMenue'
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

let toastTimer  = null;
// Ein Toast mit Aktion („Rückgängig") hält eine noch offene Aufräumarbeit
// zurück: Läuft er ab oder wird er von einem neuen Toast verdrängt, gilt die
// Aktion als nicht genutzt und die Aufräumarbeit wird nachgeholt.
let toastAblauf = null;

/** Beendet den sichtbaren Toast. `ablaufAusfuehren` = true, wenn die
 *  Rückgängig-Frist damit verstrichen ist. */
function toastBeenden(ablaufAusfuehren) {
  const el = document.getElementById('toastEl');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  const ablauf = toastAblauf;
  toastAblauf = null;
  if (el) el.classList.remove('show', 'toast--aktion');
  if (ablaufAusfuehren && typeof ablauf === 'function') ablauf();
}

/**
 * Kurzmeldung am unteren Bildschirmrand.
 * @param {string} msg
 * @param {{label:string, onClick:Function, onAblauf?:Function, dauer?:number}} [aktion]
 *        Optionaler Knopf im Toast (z. B. „Rückgängig"). `onAblauf` läuft,
 *        wenn der Toast verschwindet, ohne dass der Knopf gedrückt wurde.
 */
function showToast(msg, aktion) {
  const el = document.getElementById('toastEl');
  if (!el) return;

  // Ein vorheriger Toast mit offener Frist wird jetzt endgültig – seine
  // Aufräumarbeit darf nicht verloren gehen.
  toastBeenden(true);

  el.textContent = '';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = msg;
  el.appendChild(text);

  let dauer = 2000;
  if (aktion && aktion.label && typeof aktion.onClick === 'function') {
    dauer = aktion.dauer || 6000;
    toastAblauf = typeof aktion.onAblauf === 'function' ? aktion.onAblauf : null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-aktion';
    btn.textContent = aktion.label;
    btn.addEventListener('click', () => {
      toastAblauf = null;          // Aktion genutzt → nichts nachzuholen
      toastBeenden(false);
      aktion.onClick();
    });
    el.appendChild(btn);
    el.classList.add('toast--aktion');
  }

  el.classList.add('show');
  toastTimer = setTimeout(() => { toastTimer = null; toastBeenden(true); }, dauer);
}

// ── Datenänderungen zwischen den Modulen bekannt machen ─────────────────────
// Projektliste und Ordner liegen in localStorage, beide Module halten aber
// zusätzlich eine Kopie im Speicher (script.js: `projects`/`folders`). Wer
// schreibt, meldet das hier; das jeweils andere Modul liest neu ein, statt
// später mit einem veralteten Stand darüberzuschreiben.

const GERUEST_DATEN_EVENT = 'geruest:daten';

/** @param {'aufmass'|'2d'} quelle – wer geschrieben hat. */
function meldeDatenAenderung(quelle) {
  document.dispatchEvent(new CustomEvent(GERUEST_DATEN_EVENT, { detail: { quelle } }));
}

// ── Gemeinsames Aktionsmenü ─────────────────────────────────────────────────
// Kleines, an einem Knopf verankertes Popup (Aktionen, ggf. mit Untermenüs) –
// touch-tauglich, ohne Abhängigkeit von Browser-Kontextmenüs. Stand früher in
// script.js und war damit nur dem Aufmaß-Modul zugänglich; die Zeichnungsliste
// des 2D-Moduls braucht dasselbe Menü.

function closeFloatingMenu() {
  document.getElementById('floatingMenu')?.remove();
  document.getElementById('floatingMenuOverlay')?.remove();
}

/**
 * @param {HTMLElement|{getBoundingClientRect:Function}} anchorEl Verankerung –
 *        ein Element oder ein rect-artiges Objekt (für Rechtsklick-Position).
 * @param {Array<'---'|{label:string,onClick:Function,danger?:boolean,active?:boolean}>} items
 */
function openFloatingMenu(anchorEl, items) {
  closeFloatingMenu();

  const overlay = document.createElement('div');
  overlay.id = 'floatingMenuOverlay';
  overlay.className = 'floating-menu-overlay';
  overlay.addEventListener('click', closeFloatingMenu);
  overlay.addEventListener('contextmenu', e => { e.preventDefault(); closeFloatingMenu(); });

  const menu = document.createElement('div');
  menu.id = 'floatingMenu';
  menu.className = 'floating-menu';

  items.forEach(item => {
    if (item === '---') {
      const sep = document.createElement('div');
      sep.className = 'floating-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'floating-menu-item' + (item.danger ? ' danger' : '') + (item.active ? ' active' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeFloatingMenu(); item.onClick(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(overlay);
  document.body.appendChild(menu);

  const r = anchorEl.getBoundingClientRect();
  const menuW = 240;
  let left = r.right - menuW;
  if (left < 8) left = 8;
  if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
  const top = r.bottom + 6;
  menu.style.left = left + 'px';
  menu.style.top  = top + 'px';
  // Falls das Menü unten aus dem Bildschirm ragen würde: oberhalb öffnen
  requestAnimationFrame(() => {
    const mh = menu.getBoundingClientRect().height;
    if (top + mh > window.innerHeight - 8) {
      menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
    }
  });
}

// ── Zahlen ──────────────────────────────────────────────────────────────────
// Deutsches Format mit zwei Nachkommastellen (Maße, Flächen, Mengen).

function geruestFmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0,00';
  return Number(n).toFixed(2).replace('.', ',');
}
