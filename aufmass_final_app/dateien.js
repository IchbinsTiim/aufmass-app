'use strict';

// ============================================================================
//  Dateiübersicht – eine Komponente für beide Module
// ============================================================================
// Aufmaß und 2D-Aufmaß bekommen exakt dieselbe Übersicht: gleicher Aufbau,
// gleiche Bedienung, gleiche Dialoge. Unterschiedlich ist nur, was beim
// Parametrisieren mitgegeben wird (Beschriftungen, Vorschaubilder, die
// Zusatzangaben auf der Karte). Alles, was mit Aufmaßregeln oder Zeichnen zu
// tun hat, bleibt in den Modulen – hier steht ausschließlich Dateiverwaltung.
//
//   Dateibrowser.erstelle({ modul, host, … })  →  { rendere, zerstoere, … }
//
// Der Speicher (store.js) liefert Dokumente und Ordner; diese Datei kümmert
// sich um Darstellung, Auswahl, Ziehen & Ablegen, Menüs und Dialoge.
// ============================================================================

// ── Zeitangaben in Alltagssprache ───────────────────────────────────────────

function dvRelativeZeit(iso) {
  if (!iso) return 'unbekannt';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return 'unbekannt';
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'gerade eben';
  if (min < 60) return `vor ${min} Minute${min === 1 ? '' : 'n'}`;
  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Stunde${std === 1 ? '' : 'n'}`;
  const tage = Math.floor(std / 24);
  if (tage === 1) return 'gestern';
  if (tage < 30)  return `vor ${tage} Tagen`;
  const monate = Math.floor(tage / 30);
  if (monate < 12) return `vor ${monate} Monat${monate === 1 ? '' : 'en'}`;
  const jahre = Math.floor(monate / 12);
  return `vor ${jahre} Jahr${jahre === 1 ? '' : 'en'}`;
}

function dvDatum(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dvEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Dialoge ─────────────────────────────────────────────────────────────────
// Bewusst eigene Dialoge statt prompt()/confirm(): auf dem Tablet sind die
// Browser-Dialoge winzig, nicht gestaltbar und reißen aus dem Bild.

const DvDialog = (() => {

  function huelle(titel, text) {
    const overlay = document.createElement('div');
    overlay.className = 'dv-dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dv-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      <h2 class="dv-dialog-titel">${dvEsc(titel)}</h2>
      ${text ? `<p class="dv-dialog-text">${dvEsc(text)}</p>` : ''}
      <div class="dv-dialog-feld"></div>
      <div class="dv-dialog-knoepfe"></div>`;
    overlay.appendChild(box);
    return { overlay, box };
  }

  function zeige(overlay, aufraeumen) {
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('offen'));
    const schliessen = () => {
      overlay.classList.remove('offen');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', beiTaste);
      if (aufraeumen) aufraeumen();
    };
    const beiTaste = e => { if (e.key === 'Escape') { e.preventDefault(); overlay.__abbruch(); } };
    document.addEventListener('keydown', beiTaste);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.__abbruch(); });
    return schliessen;
  }

  function knopf(label, stil) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dv-dialog-btn' + (stil ? ' ' + stil : '');
    b.textContent = label;
    return b;
  }

  /** Texteingabe (neuer Name, neuer Ordner). Auflösung: Text oder null. */
  function text({ titel, hinweis, wert, ok = 'Speichern', platzhalter = '' }) {
    return new Promise(resolve => {
      const { overlay, box } = huelle(titel, hinweis);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'dv-dialog-input';
      inp.value = wert || '';
      inp.placeholder = platzhalter;
      box.querySelector('.dv-dialog-feld').appendChild(inp);

      const abbr = knopf('Abbrechen', 'still');
      const bes  = knopf(ok, 'primaer');
      box.querySelector('.dv-dialog-knoepfe').append(abbr, bes);

      const schliessen = zeige(overlay);
      const fertig = w => { schliessen(); resolve(w); };
      overlay.__abbruch = () => fertig(null);
      abbr.addEventListener('click', () => fertig(null));
      bes.addEventListener('click', () => fertig(inp.value.trim()));
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); fertig(inp.value.trim()); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
  }

  /** Sicherheitsabfrage. Auflösung: true / false. */
  function bestaetige({ titel, hinweis, ok = 'Löschen', gefahr = true }) {
    return new Promise(resolve => {
      const { overlay, box } = huelle(titel, hinweis);
      const abbr = knopf('Abbrechen', 'still');
      const bes  = knopf(ok, gefahr ? 'gefahr' : 'primaer');
      box.querySelector('.dv-dialog-knoepfe').append(abbr, bes);
      const schliessen = zeige(overlay);
      const fertig = w => { schliessen(); resolve(w); };
      overlay.__abbruch = () => fertig(false);
      abbr.addEventListener('click', () => fertig(false));
      bes.addEventListener('click', () => fertig(true));
      setTimeout(() => bes.focus(), 60);
    });
  }

  /** Mehrfachauswahl, z. B. „Speichern / Verwerfen / Abbrechen".
   *  Auflösung: die `id` des gedrückten Knopfes oder null (Abbruch). */
  function auswahl({ titel, hinweis, knoepfe }) {
    return new Promise(resolve => {
      const { overlay, box } = huelle(titel, hinweis);
      const leiste = box.querySelector('.dv-dialog-knoepfe');
      leiste.classList.add('dv-dialog-knoepfe-spalte');
      knoepfe.forEach(k => {
        const b = knopf(k.label, k.stil || 'still');
        b.addEventListener('click', () => { schliessen(); resolve(k.id); });
        leiste.appendChild(b);
      });
      const schliessen = zeige(overlay);
      overlay.__abbruch = () => { schliessen(); resolve(null); };
    });
  }

  return { text, bestaetige, auswahl };
})();

// ── Toast mit Rückgängig-Knopf ──────────────────────────────────────────────
// Der einfache Toast aus core.js bleibt, wie er ist. Für Löschvorgänge braucht
// es aber eine Handlungsmöglichkeit direkt in der Meldung.

let dvToastTimer = null;

function dvToast(text, aktion) {
  let el = document.getElementById('dvToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dvToast';
    el.className = 'dv-toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="dv-toast-text"></span>`;
  el.querySelector('.dv-toast-text').textContent = text;
  if (aktion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dv-toast-btn';
    b.textContent = aktion.label;
    b.addEventListener('click', () => {
      el.classList.remove('offen');
      aktion.onClick();
    });
    el.appendChild(b);
  }
  el.classList.add('offen');
  if (dvToastTimer) clearTimeout(dvToastTimer);
  dvToastTimer = setTimeout(() => el.classList.remove('offen'), aktion ? 6000 : 2400);
}

// ── Ziehen & Ablegen (Maus und Finger) ──────────────────────────────────────
// Eine eigene, zeigerbasierte Umsetzung statt der HTML5-Schnittstelle: die
// funktioniert auf iPad/Android nicht. Am Finger startet der Zug erst nach
// kurzem Halten, damit Wischen zum Scrollen weiterhin geht.

const DvZiehen = (() => {
  let aktiv = null;

  function starte(el, daten, beiAblage) {
    el.addEventListener('pointerdown', e => {
      if (e.button != null && e.button > 0) return;
      if (e.target.closest('button, a, input, select')) return;
      const start = { x: e.clientX, y: e.clientY };
      const istFinger = e.pointerType === 'touch';
      let gestartet = false;
      let halteTimer = null;

      const losgeht = () => {
        gestartet = true;
        aktiv = { daten, geist: null, ziel: null };
        el.classList.add('dv-zieht');
        const geist = el.cloneNode(true);
        geist.classList.add('dv-geist');
        const box = el.getBoundingClientRect();
        Object.assign(geist.style, {
          width: box.width + 'px', height: box.height + 'px',
          left: box.left + 'px', top: box.top + 'px'
        });
        document.body.appendChild(geist);
        aktiv.geist = geist;
        aktiv.versatz = { x: start.x - box.left, y: start.y - box.top };
        document.body.classList.add('dv-zieht-laeuft');
      };

      if (istFinger) halteTimer = setTimeout(losgeht, 320);

      const beiBewegung = ev => {
        if (!gestartet) {
          const weit = Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8;
          if (istFinger) { if (weit) { clearTimeout(halteTimer); ende(); } return; }
          if (!weit) return;
          losgeht();
        }
        ev.preventDefault();
        aktiv.geist.style.transform =
          `translate(${ev.clientX - start.x}px, ${ev.clientY - start.y}px)`;
        const unten = document.elementFromPoint(ev.clientX, ev.clientY);
        const ziel  = unten && unten.closest('[data-ablage]');
        if (aktiv.ziel !== ziel) {
          if (aktiv.ziel) aktiv.ziel.classList.remove('dv-ablage-aktiv');
          aktiv.ziel = ziel;
          if (ziel) ziel.classList.add('dv-ablage-aktiv');
        }
      };

      const beiEnde = ev => {
        if (halteTimer) clearTimeout(halteTimer);
        if (gestartet) {
          ev.preventDefault();
          const ziel = aktiv.ziel;
          if (ziel) ziel.classList.remove('dv-ablage-aktiv');
          aktiv.geist.remove();
          el.classList.remove('dv-zieht');
          document.body.classList.remove('dv-zieht-laeuft');
          if (ziel) beiAblage(ziel.dataset.ablage, daten);
        }
        ende();
      };

      const ende = () => {
        aktiv = null;
        window.removeEventListener('pointermove', beiBewegung);
        window.removeEventListener('pointerup', beiEnde);
        window.removeEventListener('pointercancel', beiEnde);
      };

      window.addEventListener('pointermove', beiBewegung, { passive: false });
      window.addEventListener('pointerup', beiEnde);
      window.addEventListener('pointercancel', beiEnde);
    });
  }

  return { starte };
})();

// ── Der Browser selbst ──────────────────────────────────────────────────────

const Dateibrowser = (() => {

  const SORT_LABEL = {
    geaendert: 'Zuletzt geändert',
    erstellt:  'Erstelldatum',
    name:      'Name'
  };

  function erstelle(cfg) {
    const modul     = cfg.modul;                         // 'aufmass' | 'zweid'
    const host      = cfg.host;
    const prefKey   = 'geruest.dateien.ansicht.' + modul;

    const zustand = {
      ordnerId: null,
      suche: '',
      sortierung: 'geaendert',
      ansicht: 'kachel',
      papierkorb: false,
      status: ''
    };
    try {
      const p = JSON.parse(localStorage.getItem(prefKey) || 'null');
      if (p) {
        if (p.ansicht) zustand.ansicht = p.ansicht;
        if (p.sortierung) zustand.sortierung = p.sortierung;
      }
    } catch (_) { /* Voreinstellung genügt */ }

    const merkePref = () => {
      try {
        localStorage.setItem(prefKey, JSON.stringify({
          ansicht: zustand.ansicht, sortierung: zustand.sortierung
        }));
      } catch (_) { /* Voreinstellungen sind entbehrlich */ }
    };

    // ── Gerüst aufbauen ─────────────────────────────────────────────────────
    host.innerHTML = `
      <div class="dv" data-dv-modul="${dvEsc(modul)}">
        <header class="dv-head">
          <div class="dv-head-text">
            <span class="dv-eyebrow">${dvEsc(cfg.eyebrow || '')}</span>
            <h1 class="dv-titel">${dvEsc(cfg.titel || 'Dateien')}</h1>
            <p class="dv-sub" data-dv="zusammenfassung"></p>
          </div>
          <div class="dv-head-aktionen">
            <button type="button" class="dv-btn dv-btn-primaer" data-dv="neu">${dvEsc(cfg.neuLabel || 'Neu')}</button>
            <button type="button" class="dv-btn dv-btn-still dv-btn-icon" data-dv="mehr" aria-label="Weitere Aktionen">⋯</button>
          </div>
        </header>

        <div class="dv-tools">
          <div class="dv-suche-wrap">
            <span class="dv-suche-icon" aria-hidden="true">⌕</span>
            <input type="search" class="dv-suche" data-dv="suche" placeholder="Dateien durchsuchen …" />
          </div>
          <select class="dv-select" data-dv="sort" aria-label="Sortierung">
            <option value="geaendert">Zuletzt geändert</option>
            <option value="erstellt">Erstelldatum</option>
            <option value="name">Name</option>
          </select>
          ${cfg.statusFilter ? `
          <select class="dv-select" data-dv="status" aria-label="Status">
            <option value="">Alle Status</option>
            <option value="in_bearbeitung">In Bearbeitung</option>
            <option value="abgeschlossen">Abgeschlossen</option>
            <option value="archiviert">Archiviert</option>
          </select>` : ''}
          <div class="dv-ansicht-schalter" role="group" aria-label="Ansicht">
            <button type="button" class="dv-ansicht-btn" data-dv="ansicht-kachel" title="Kachelansicht" aria-label="Kachelansicht">▦</button>
            <button type="button" class="dv-ansicht-btn" data-dv="ansicht-liste" title="Listenansicht" aria-label="Listenansicht">☰</button>
          </div>
          <button type="button" class="dv-btn dv-btn-still" data-dv="neuer-ordner">+ Ordner</button>
        </div>

        <nav class="dv-crumbs" data-dv="crumbs" aria-label="Ordnerpfad"></nav>

        <section class="dv-zuletzt" data-dv="zuletzt" hidden>
          <h2 class="dv-abschnitt-titel">Zuletzt bearbeitet</h2>
          <div class="dv-zuletzt-reihe" data-dv="zuletzt-reihe"></div>
        </section>

        <section class="dv-ordner-block" data-dv="ordner-block" hidden>
          <h2 class="dv-abschnitt-titel">Ordner</h2>
          <div class="dv-ordner-gitter" data-dv="ordner"></div>
        </section>

        <section class="dv-dateien-block">
          <h2 class="dv-abschnitt-titel" data-dv="dateien-titel">Dateien</h2>
          <div class="dv-gitter" data-dv="dateien"></div>
        </section>

        <div class="dv-leer" data-dv="leer" hidden></div>
        <input type="file" accept="application/json" class="dv-datei-input" data-dv="import" hidden />
      </div>`;

    const el = s => host.querySelector(`[data-dv="${s}"]`);
    const wurzel = host.querySelector('.dv');

    // ── Daten holen ─────────────────────────────────────────────────────────

    function sichtbareDokumente() {
      let liste = zustand.papierkorb ? Speicher.papierkorb() : Speicher.liste(modul);

      if (!zustand.papierkorb) {
        if (zustand.suche) {
          // Bei aktiver Suche wird über alle Ordner hinweg gesucht – wer sucht,
          // weiß meist nicht mehr, wo etwas liegt.
          const q = zustand.suche.toLowerCase();
          liste = liste.filter(d => {
            const treffer = [Speicher.anzeigename(d)];
            if (cfg.suchfelder) treffer.push(...cfg.suchfelder(d));
            return treffer.join(' ').toLowerCase().includes(q);
          });
        } else {
          liste = liste.filter(d => (Speicher.ordnerIdVon(d, modul) || null) === (zustand.ordnerId || null));
        }
        if (zustand.status && cfg.status) liste = liste.filter(d => cfg.status(d) === zustand.status);
      }

      const nameVon = d => Speicher.anzeigename(d);
      if (zustand.sortierung === 'name') {
        liste = liste.slice().sort((a, b) => nameVon(a).localeCompare(nameVon(b), 'de'));
      } else if (zustand.sortierung === 'erstellt') {
        liste = liste.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      } else {
        liste = liste.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      }
      return liste;
    }

    // ── Karten ──────────────────────────────────────────────────────────────

    function vorschauMarkup(d) {
      if (!cfg.thumbnails) return '';
      if (d.thumbnail) {
        // `data-dv-lazy`: das Bild wird erst gesetzt, wenn die Karte wirklich
        // im Blickfeld ist (siehe beobachter unten).
        return `<div class="dv-vorschau"><img alt="" data-dv-lazy="${dvEsc(d.thumbnail)}" /></div>`;
      }
      return `<div class="dv-vorschau dv-vorschau-leer"><span aria-hidden="true">📐</span></div>`;
    }

    function karte(d) {
      const div = document.createElement('article');
      div.className = 'dv-karte';
      div.dataset.dokId = d.id;
      div.tabIndex = 0;
      const zusatz = cfg.karteZusatz ? cfg.karteZusatz(d) : '';
      const marken = cfg.karteMarken ? cfg.karteMarken(d) : '';
      div.innerHTML = `
        ${vorschauMarkup(d)}
        <div class="dv-karte-body">
          <div class="dv-karte-kopf">
            <div class="dv-karte-marken">${marken}</div>
            <button type="button" class="dv-karte-menue" aria-label="Aktionen">⋯</button>
          </div>
          <h3 class="dv-karte-name">${dvEsc(Speicher.anzeigename(d))}</h3>
          <div class="dv-karte-ort">${dvEsc(ordnerName(d))}</div>
          ${zusatz}
          <div class="dv-karte-zeit">
            <span title="Erstellt am ${dvEsc(dvDatum(d.createdAt))}">Erstellt ${dvEsc(dvDatum(d.createdAt))}</span>
            <span title="Zuletzt geändert am ${dvEsc(dvDatum(d.updatedAt))}">Geändert ${dvEsc(dvRelativeZeit(d.updatedAt))}</span>
          </div>
        </div>`;
      verknuepfeKarte(div, d);
      return div;
    }

    function ordnerName(d) {
      const id = Speicher.ordnerIdVon(d, modul);
      if (!id) return 'Nicht zugeordnet';
      const pfad = Speicher.ordnerPfad(id);
      return pfad.map(o => o.name).join(' / ') || 'Nicht zugeordnet';
    }

    function verknuepfeKarte(div, d) {
      div.querySelector('.dv-karte-menue').addEventListener('click', ev => {
        ev.stopPropagation();
        dateiMenue(d, ev.currentTarget);
      });
      div.addEventListener('click', ev => {
        if (ev.target.closest('.dv-karte-menue')) return;
        if (zustand.papierkorb) { papierkorbMenue(d, div); return; }
        oeffne(d);
      });
      div.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); div.click(); }
      });
      if (!zustand.papierkorb) {
        DvZiehen.starte(div, { art: 'dokument', id: d.id }, ablegen);
      }
    }

    function ordnerKarte(o) {
      const div = document.createElement('article');
      div.className = 'dv-ordner';
      div.dataset.ablage = o.id;
      div.dataset.ordnerId = o.id;
      div.tabIndex = 0;
      const anzahl = Speicher.anzahlImOrdner(modul, o.id);
      const unter  = Speicher.ordner(modul, o.id).length;
      const teile  = [];
      if (anzahl) teile.push(`${anzahl} Datei${anzahl === 1 ? '' : 'en'}`);
      if (unter)  teile.push(`${unter} Ordner`);
      div.innerHTML = `
        <span class="dv-ordner-icon" aria-hidden="true"></span>
        <div class="dv-ordner-text">
          <h3 class="dv-ordner-name">${dvEsc(o.name)}</h3>
          <span class="dv-ordner-meta">${teile.join(' · ') || 'leer'}</span>
        </div>
        <button type="button" class="dv-karte-menue" aria-label="Ordneraktionen">⋯</button>`;
      div.querySelector('.dv-karte-menue').addEventListener('click', ev => {
        ev.stopPropagation();
        ordnerMenue(o, ev.currentTarget);
      });
      div.addEventListener('click', ev => {
        if (ev.target.closest('.dv-karte-menue')) return;
        geheZuOrdner(o.id);
      });
      div.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); geheZuOrdner(o.id); }
      });
      DvZiehen.starte(div, { art: 'ordner', id: o.id }, ablegen);
      return div;
    }

    // ── Ablegen (Ziel: Ordnerkarte oder Brotkrume) ──────────────────────────

    function ablegen(zielId, daten) {
      const ziel = zielId === '__wurzel__' ? null : zielId;
      if (daten.art === 'dokument') {
        Speicher.verschiebe(daten.id, modul, ziel);
        dvToast('Verschoben nach „' + (ziel ? Speicher.ordnerVon(ziel).name : 'Nicht zugeordnet') + '"');
      } else if (daten.art === 'ordner') {
        if (daten.id === ziel) return;
        const ok = Speicher.verschiebeOrdner(daten.id, ziel);
        if (!ok) { dvToast('Ein Ordner kann nicht in sich selbst liegen'); return; }
        dvToast('Ordner verschoben');
      }
      rendere();
    }

    // ── Menüs ───────────────────────────────────────────────────────────────

    function ordnerZielListe(aktuellId, beiWahl, ausserhalb) {
      // Flache, eingerückte Liste aller Ordner des Moduls – so lässt sich auch
      // tief verschachtelt zielsicher ablegen.
      const eintraege = [{
        label: (aktuellId ? '' : '✓ ') + 'Nicht zugeordnet',
        active: !aktuellId,
        onClick: () => beiWahl(null)
      }];
      const gehe = (parentId, tiefe) => {
        Speicher.ordner(modul, parentId).forEach(o => {
          if (ausserhalb && (o.id === ausserhalb || istUnterhalb(o.id, ausserhalb))) return;
          eintraege.push({
            label: (aktuellId === o.id ? '✓ ' : '') + '　'.repeat(tiefe) + o.name,
            active: aktuellId === o.id,
            onClick: () => beiWahl(o.id)
          });
          gehe(o.id, tiefe + 1);
        });
      };
      gehe(null, 0);
      eintraege.push('---');
      eintraege.push({ label: '+ Neuer Ordner …', onClick: async () => {
        const name = await DvDialog.text({ titel: 'Neuer Ordner', ok: 'Anlegen', platzhalter: 'z. B. Musterstraße' });
        if (!name) return;
        const o = Speicher.neuerOrdner(modul, name, zustand.ordnerId);
        beiWahl(o.id);
      } });
      return eintraege;
    }

    function istUnterhalb(id, ahnId) {
      let o = Speicher.ordnerVon(id);
      let schutz = 0;
      while (o && schutz++ < 50) {
        if (o.parentId === ahnId) return true;
        o = o.parentId ? Speicher.ordnerVon(o.parentId) : null;
      }
      return false;
    }

    function dateiMenue(d, anker) {
      if (zustand.papierkorb) { papierkorbMenue(d, anker); return; }
      const eintraege = [
        { label: 'Öffnen', onClick: () => oeffne(d) },
        ...(cfg.zusatzAktionen ? cfg.zusatzAktionen(d) : []),
        { label: 'Umbenennen', onClick: () => benenneUm(d) },
        { label: 'Duplizieren', onClick: () => dupliziere(d) },
        { label: 'In Ordner verschieben …', onClick: () => openFloatingMenu(anker,
            ordnerZielListe(Speicher.ordnerIdVon(d, modul), ziel => {
              Speicher.verschiebe(d.id, modul, ziel);
              dvToast('Verschoben');
              rendere();
            })) },
        { label: 'Exportieren (JSON)', onClick: () => exportiere(d) },
        '---',
        { label: 'Löschen', danger: true, onClick: () => loesche(d) }
      ];
      openFloatingMenu(anker, eintraege);
    }

    function papierkorbMenue(d, anker) {
      openFloatingMenu(anker, [
        { label: 'Wiederherstellen', onClick: () => {
          Speicher.wiederherstellen(d.id);
          dvToast('Wiederhergestellt');
          rendere();
        } },
        '---',
        { label: 'Endgültig löschen', danger: true, onClick: async () => {
          const ok = await DvDialog.bestaetige({
            titel: 'Endgültig löschen?',
            hinweis: `„${Speicher.anzeigename(d)}" wird unwiderruflich entfernt.`,
            ok: 'Endgültig löschen'
          });
          if (!ok) return;
          Speicher.endgueltigLoeschen(d.id);
          dvToast('Endgültig gelöscht');
          rendere();
        } }
      ]);
    }

    function ordnerMenue(o, anker) {
      openFloatingMenu(anker, [
        { label: 'Öffnen', onClick: () => geheZuOrdner(o.id) },
        { label: 'Umbenennen', onClick: async () => {
          const name = await DvDialog.text({ titel: 'Ordner umbenennen', wert: o.name });
          if (!name) return;
          Speicher.benenneOrdnerUm(o.id, name);
          dvToast('Ordner umbenannt');
          rendere();
        } },
        { label: 'Verschieben …', onClick: () => openFloatingMenu(anker,
            ordnerZielListe(o.parentId, ziel => {
              const ok = Speicher.verschiebeOrdner(o.id, ziel);
              dvToast(ok ? 'Ordner verschoben' : 'Nicht möglich: Ordner läge in sich selbst');
              rendere();
            }, o.id)) },
        '---',
        { label: 'Ordner löschen', danger: true, onClick: async () => {
          const anzahl = Speicher.anzahlImOrdner(modul, o.id);
          const ok = await DvDialog.bestaetige({
            titel: `Ordner „${o.name}" löschen?`,
            hinweis: anzahl
              ? `${anzahl} Datei(en) darin bleiben erhalten und liegen danach unter „Nicht zugeordnet".`
              : 'Der Ordner ist leer.',
            ok: 'Ordner löschen'
          });
          if (!ok) return;
          Speicher.loescheOrdner(o.id);
          if (zustand.ordnerId === o.id) zustand.ordnerId = o.parentId || null;
          dvToast('Ordner gelöscht');
          rendere();
        } }
      ]);
    }

    function mehrMenue(anker) {
      openFloatingMenu(anker, [
        { label: 'Datei importieren (JSON) …', onClick: () => el('import').click() },
        ...(cfg.mehrAktionen ? cfg.mehrAktionen() : []),
        '---',
        { label: zustand.papierkorb ? 'Zurück zur Übersicht' : `Papierkorb (${Speicher.papierkorb().length})`,
          onClick: () => { zustand.papierkorb = !zustand.papierkorb; rendere(); } }
      ]);
    }

    // ── Aktionen ────────────────────────────────────────────────────────────

    function oeffne(d) {
      Speicher.merkeGeoeffnet(d.id, modul);
      cfg.oeffnen(d);
    }

    async function benenneUm(d) {
      const name = await DvDialog.text({
        titel: 'Umbenennen', wert: Speicher.anzeigename(d), platzhalter: 'Name der Datei'
      });
      if (name === null) return;
      Speicher.umbenenne(d.id, name);
      dvToast('Umbenannt');
      rendere();
      if (cfg.nachAenderung) cfg.nachAenderung();
    }

    function dupliziere(d) {
      const kopie = Speicher.dupliziere(d.id, modul);
      dvToast('Kopie angelegt: ' + Speicher.anzeigename(kopie));
      rendere();
      if (cfg.nachAenderung) cfg.nachAenderung();
    }

    async function loesche(d) {
      const ok = await DvDialog.bestaetige({
        titel: `„${Speicher.anzeigename(d)}" löschen?`,
        hinweis: `Die Datei wandert in den Papierkorb und lässt sich dort ${Speicher.PAPIERKORB_TAGE} Tage lang wiederherstellen.`,
        ok: 'In den Papierkorb'
      });
      if (!ok) return;
      Speicher.inPapierkorb(d.id);
      rendere();
      if (cfg.nachAenderung) cfg.nachAenderung();
      dvToast('Gelöscht', { label: 'Rückgängig', onClick: () => {
        Speicher.wiederherstellen(d.id);
        rendere();
        if (cfg.nachAenderung) cfg.nachAenderung();
        dvToast('Wiederhergestellt');
      } });
    }

    function exportiere(d) {
      const paket = Speicher.exportPaket(d.id);
      if (!paket) return;
      const blob = new Blob([JSON.stringify(paket, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (Speicher.anzeigename(d).replace(/[^a-z0-9äöüß ]/gi, '_').trim() || 'Dokument') + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dvToast('Exportiert');
    }

    function importiere(datei) {
      const leser = new FileReader();
      leser.onload = ev => {
        let roh = null;
        try { roh = JSON.parse(ev.target.result); }
        catch (_) { dvToast('Datei konnte nicht gelesen werden'); return; }
        const d = Speicher.importPaket(roh, modul, zustand.ordnerId);
        if (!d) { dvToast('Unbekanntes Dateiformat'); return; }
        rendere();
        if (cfg.nachAenderung) cfg.nachAenderung();
        dvToast('Importiert: ' + Speicher.anzeigename(d));
      };
      leser.readAsText(datei);
    }

    function geheZuOrdner(id) {
      zustand.ordnerId = id || null;
      zustand.suche = '';
      const s = el('suche'); if (s) s.value = '';
      rendere();
    }

    // ── Zeichnen ────────────────────────────────────────────────────────────

    let beobachter = null;

    function ladeVorschauNach(behälter) {
      if (!cfg.thumbnails) return;
      if (!('IntersectionObserver' in window)) {
        behälter.querySelectorAll('img[data-dv-lazy]').forEach(img => {
          img.src = img.dataset.dvLazy; img.removeAttribute('data-dv-lazy');
        });
        return;
      }
      if (beobachter) beobachter.disconnect();
      beobachter = new IntersectionObserver(eintraege => {
        eintraege.forEach(e => {
          if (!e.isIntersecting) return;
          const img = e.target;
          img.src = img.dataset.dvLazy;
          img.removeAttribute('data-dv-lazy');
          beobachter.unobserve(img);
        });
      }, { rootMargin: '200px' });
      behälter.querySelectorAll('img[data-dv-lazy]').forEach(img => beobachter.observe(img));
    }

    function zeichneCrumbs() {
      const nav = el('crumbs');
      nav.innerHTML = '';
      if (zustand.papierkorb) {
        const zurueck = document.createElement('button');
        zurueck.type = 'button';
        zurueck.className = 'dv-crumb';
        zurueck.textContent = '← Zurück zur Übersicht';
        zurueck.addEventListener('click', () => { zustand.papierkorb = false; rendere(); });
        nav.appendChild(zurueck);
        const jetzt = document.createElement('span');
        jetzt.className = 'dv-crumb dv-crumb-aktiv';
        jetzt.textContent = 'Papierkorb';
        nav.appendChild(jetzt);
        return;
      }

      const wurzelBtn = document.createElement('button');
      wurzelBtn.type = 'button';
      wurzelBtn.className = 'dv-crumb' + (zustand.ordnerId ? '' : ' dv-crumb-aktiv');
      wurzelBtn.textContent = cfg.wurzelName || 'Alle Dateien';
      wurzelBtn.dataset.ablage = '__wurzel__';
      wurzelBtn.addEventListener('click', () => geheZuOrdner(null));
      nav.appendChild(wurzelBtn);

      Speicher.ordnerPfad(zustand.ordnerId).forEach((o, i, arr) => {
        const trenner = document.createElement('span');
        trenner.className = 'dv-crumb-sep';
        trenner.textContent = '/';
        nav.appendChild(trenner);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dv-crumb' + (i === arr.length - 1 ? ' dv-crumb-aktiv' : '');
        b.textContent = o.name;
        b.dataset.ablage = o.id;
        b.addEventListener('click', () => geheZuOrdner(o.id));
        nav.appendChild(b);
      });
    }

    function zeichneZuletzt() {
      const block = el('zuletzt');
      const reihe = el('zuletzt-reihe');
      const zeigen = !zustand.papierkorb && !zustand.suche && !zustand.ordnerId;
      const liste = zeigen ? Speicher.zuletzt(modul, 5) : [];
      block.hidden = liste.length === 0;
      reihe.innerHTML = '';
      liste.forEach(d => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dv-zuletzt-karte';
        b.innerHTML = `
          <span class="dv-zuletzt-name">${dvEsc(Speicher.anzeigename(d))}</span>
          <span class="dv-zuletzt-zeit">${dvEsc(dvRelativeZeit(d.zuletztGeoeffnet[Speicher.modulSchluessel(modul)]))}</span>`;
        b.addEventListener('click', () => oeffne(d));
        reihe.appendChild(b);
      });
    }

    function rendere() {
      const dateien = sichtbareDokumente();
      const ordnerListe = (zustand.papierkorb || zustand.suche) ? [] : Speicher.ordner(modul, zustand.ordnerId);

      wurzel.classList.toggle('dv-liste', zustand.ansicht === 'liste');
      wurzel.classList.toggle('dv-papierkorb', zustand.papierkorb);
      host.querySelector('[data-dv="ansicht-kachel"]').classList.toggle('aktiv', zustand.ansicht === 'kachel');
      host.querySelector('[data-dv="ansicht-liste"]').classList.toggle('aktiv', zustand.ansicht === 'liste');

      zeichneCrumbs();
      zeichneZuletzt();

      // Ordner
      const ordnerBlock = el('ordner-block');
      const ordnerGitter = el('ordner');
      ordnerBlock.hidden = ordnerListe.length === 0;
      ordnerGitter.innerHTML = '';
      const of = document.createDocumentFragment();
      ordnerListe.forEach(o => of.appendChild(ordnerKarte(o)));
      ordnerGitter.appendChild(of);

      // Dateien
      const gitter = el('dateien');
      gitter.innerHTML = '';
      const df = document.createDocumentFragment();
      dateien.forEach(d => df.appendChild(karte(d)));
      gitter.appendChild(df);
      ladeVorschauNach(gitter);

      el('dateien-titel').textContent = zustand.papierkorb
        ? `Papierkorb – ${Speicher.PAPIERKORB_TAGE} Tage wiederherstellbar`
        : (zustand.suche ? `Treffer (${dateien.length})` : (cfg.dateienTitel || 'Dateien'));
      el('dateien-titel').hidden = dateien.length === 0;

      // Leerzustand
      const leer = el('leer');
      leer.hidden = dateien.length > 0 || ordnerListe.length > 0;
      if (!leer.hidden) {
        if (zustand.papierkorb) {
          leer.innerHTML = `
            <div class="dv-leer-icon" aria-hidden="true">🗑️</div>
            <h2>Papierkorb ist leer</h2>
            <p>Gelöschte Dateien liegen hier ${Speicher.PAPIERKORB_TAGE} Tage lang, bevor sie endgültig verschwinden.</p>`;
        } else if (zustand.suche) {
          leer.innerHTML = `
            <div class="dv-leer-icon" aria-hidden="true">⌕</div>
            <h2>Keine Treffer</h2>
            <p>Für „${dvEsc(zustand.suche)}" wurde nichts gefunden.</p>`;
        } else {
          leer.innerHTML = `
            <div class="dv-leer-icon" aria-hidden="true">${cfg.leerIcon || '📄'}</div>
            <h2>${dvEsc(cfg.leerTitel || 'Noch keine Dateien')}</h2>
            <p>${dvEsc(cfg.leerText || '')}</p>
            <button type="button" class="dv-btn dv-btn-primaer dv-leer-btn">${dvEsc(cfg.neuLabel || 'Neu')}</button>`;
          leer.querySelector('.dv-leer-btn').addEventListener('click', () => cfg.neuAktion());
        }
      }

      // Kopfzeile
      const gesamt = Speicher.liste(modul).length;
      const imPapierkorb = Speicher.papierkorb().length;
      el('zusammenfassung').textContent = gesamt === 0
        ? 'Noch keine Dateien angelegt'
        : `${gesamt} Datei${gesamt === 1 ? '' : 'en'}${imPapierkorb ? ` · ${imPapierkorb} im Papierkorb` : ''}`;
    }

    // ── Bedienelemente verknüpfen ───────────────────────────────────────────

    el('neu').addEventListener('click', () => cfg.neuAktion());
    el('mehr').addEventListener('click', ev => mehrMenue(ev.currentTarget));
    el('neuer-ordner').addEventListener('click', async () => {
      const name = await DvDialog.text({
        titel: 'Neuer Ordner', ok: 'Anlegen',
        hinweis: zustand.ordnerId ? 'Wird in „' + Speicher.ordnerVon(zustand.ordnerId).name + '" angelegt.' : '',
        platzhalter: 'z. B. Baustelle Musterstraße'
      });
      if (!name) return;
      Speicher.neuerOrdner(modul, name, zustand.ordnerId);
      dvToast('Ordner angelegt');
      rendere();
    });

    el('suche').addEventListener('input', e => { zustand.suche = e.target.value.trim(); rendere(); });
    el('sort').value = zustand.sortierung;
    el('sort').addEventListener('change', e => { zustand.sortierung = e.target.value; merkePref(); rendere(); });
    if (cfg.statusFilter) {
      el('status').addEventListener('change', e => { zustand.status = e.target.value; rendere(); });
    }
    host.querySelector('[data-dv="ansicht-kachel"]').addEventListener('click', () => {
      zustand.ansicht = 'kachel'; merkePref(); rendere();
    });
    host.querySelector('[data-dv="ansicht-liste"]').addEventListener('click', () => {
      zustand.ansicht = 'liste'; merkePref(); rendere();
    });
    el('import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importiere(f);
      e.target.value = '';
    });

    return {
      rendere,
      zustand,
      geheZuOrdner,
      zeigePapierkorb: () => { zustand.papierkorb = true; rendere(); },
      SORT_LABEL
    };
  }

  return { erstelle };
})();
