'use strict';

// ============================================================================
//  2D-Aufmaß-App – Basis
// ============================================================================
// Wird VOR viewer2d.js geladen und enthält die technischen Bausteine dieser
// App:
//
//   • Speicher-Schlüssel der 2D-App (Namensraum geruest.2d.*). Die
//     Zeichnungen liegen in einer EIGENEN Liste (geruest.2d.zeichnungen) mit
//     eigenen Ordnern – nicht mehr in den Projekten der Aufmaß-App.
//   • Toast-Meldungen, Aktionsmenü, Zahlenformat.
//   • Die Meldung „Daten haben sich geändert" für den Cloud-Abgleich.
//
// Die Aufmaß-App hat ihre eigene, getrennte Basis (aufmass/basis.js).
// Gemeinsam sind beiden nur die Design-Tokens (shared/tokens.css) und die
// einmalige Speicher-Migration (shared/speicher-migration.js), die vor dieser
// Datei läuft.
// ============================================================================

const GK = {
  // Die Zeichnungen und ihre Ordner.
  zeichnungen:          'geruest.2d.zeichnungen',
  ordner:               'geruest.2d.ordner',
  // Zuletzt geöffnete Zeichnung – wird beim nächsten Start wieder geöffnet.
  aktuelleZeichnung:    'geruest.2d.aktuelleZeichnung',

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
  werkzeugMenue:        'geruest.2d.werkzeugMenue',
  // Feldübersicht am linken Rand ein-/ausgeklappt – bleibt über Sitzung und
  // Zeichnungswechsel hinweg erhalten.
  feldliste:            'geruest.2d.feldliste',
  // Ob das geführte Tutorial schon einmal komplett durchlaufen wurde. Nur ein
  // Hinweis-Punkt am „?"-Knopf hängt daran – das Tutorial selbst ist
  // jederzeit über diesen Knopf erreichbar.
  tutorial2d:           'geruest.2d.tutorial'
};

// Früherer Name des Schlüssels – viewer2d.js greift darüber zu. Er zeigt auf
// die zuletzt geöffnete ZEICHNUNG dieser App.
const CURRENT_PROJECT_STORAGE_KEY = GK.aktuelleZeichnung;

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
// Wer Zeichnungen oder Ordner schreibt, meldet das hier. Der Cloud-Abgleich
// (cloud.js) hört darauf und sichert die Änderung; die Zeichnungsübersicht
// liest nach einem Cloud-Abgleich neu ein.

const GERUEST_DATEN_EVENT = 'geruest:daten';

/** @param {'2d'|'cloud'} quelle – wer geschrieben hat. */
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

// ── Zahlen ──────────────────────────────────────────────────────────────────
// Deutsches Format mit zwei Nachkommastellen (Maße, Flächen, Mengen).

function geruestFmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0,00';
  return Number(n).toFixed(2).replace('.', ',');
}
