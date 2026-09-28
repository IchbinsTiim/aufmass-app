'use strict';

// ============================================================================
//  Aufmaß-App – Basis
// ============================================================================
// Wird VOR script.js geladen und enthält die technischen Bausteine dieser App:
//
//   • Speicher-Schlüssel der Aufmaß-App (Namensraum geruest.aufmass.*).
//   • Toast-Meldungen und Aktionsmenü.
//   • Die Meldung „Daten haben sich geändert" für den Cloud-Abgleich.
//
// Die 2D-Aufmaß-App hat ihre eigene, getrennte Basis (aufmass-2d/basis.js).
// Gemeinsam sind beiden nur die Design-Tokens (shared/tokens.css) und die
// einmalige Speicher-Migration (shared/speicher-migration.js), die vor dieser
// Datei läuft.
// ============================================================================

const GK = {
  projekte:             'geruest.aufmass.projekte',
  ordner:               'geruest.aufmass.ordner',
  // Zuletzt geöffnetes Projekt – Wiedereinstieg mit `?resume=1`.
  aktuellesProjekt:     'geruest.aufmass.aktuellesProjekt',
  ueberstandWert:       'geruest.aufmass.ueberstandWert',
  letztesBackup:        'geruest.aufmass.letztesBackup',
  backupErinnerungBis:  'geruest.aufmass.backupErinnerungBis'
};

// Früherer Name des Schlüssels – script.js greift darüber zu.
const CURRENT_PROJECT_STORAGE_KEY = GK.aktuellesProjekt;

// ── Toast ───────────────────────────────────────────────────────────────────
// Kurzmeldungen am unteren Rand; das Ziel-Element (#toastEl) steht in der
// index.html dieser App.

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

// ── Datenänderungen bekannt machen ─────────────────────────────────────────
// Wer Projekte oder Ordner schreibt, meldet das hier. Der Cloud-Abgleich
// (cloud.js) hört darauf und sichert die Änderung.

const GERUEST_DATEN_EVENT = 'geruest:daten';

/** @param {'aufmass'|'cloud'} quelle – wer geschrieben hat. */
function meldeDatenAenderung(quelle) {
  document.dispatchEvent(new CustomEvent(GERUEST_DATEN_EVENT, { detail: { quelle } }));
}

// ── Aktionsmenü ─────────────────────────────────────────────────────────────
// Kleines, an einem Knopf verankertes Popup (Aktionen, ggf. mit Untermenüs) –
// touch-tauglich, ohne Abhängigkeit von Browser-Kontextmenüs.

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
