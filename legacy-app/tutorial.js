'use strict';

/* ============================================================================
   Geführtes Tutorial des 2D-Moduls
   ----------------------------------------------------------------------------
   Elf Schritte, die die Zeichenoberfläche NICHT nachbauen, sondern sie
   erklären: Jeder Schritt zeigt auf genau das Bedienelement, das es schon
   gibt – „＋ Feld", den Magnet, die Sektion „Abmessungen" im Werkzeug-Menü,
   „PDF" – dunkelt den Rest ab und schreibt zwei Sätze dazu.

   Drei Entscheidungen, die den Rest des Aufbaus erklären:

   1  Das hervorgehobene Element wird NICHT angefasst. Kein z-index, keine
      Klasse, kein Umhängen im DOM, kein Klon. Die Abdunkelung ist ein eigenes
      <svg> mit einer Maske, die an der Stelle des Elements ein Loch lässt.
      Damit kann das Tutorial weder Stapelreihenfolge noch Ereignis-Zuordnung
      noch die Zeichenlogik durcheinanderbringen.

   2  Solange das Tutorial läuft, liegt ein unsichtbarer Deckel über der Seite
      (`.tut-sperre`, `touch-action: none`). Kein Tipp, kein Wisch und kein
      Pinch erreicht die Zeichenfläche – das Tutorial kann keine Projektdaten
      verändern, und die Gesten-Erkennung des Zeichners bleibt unberührt.

   3  Was ein Schritt zum Zeigen braucht, leitet der Ablauf aus den Zielen
      selbst ab: Liegt ein Ziel im Werkzeug-Menü, wird das Menü geöffnet;
      liegt es in einer eingeklappten Sektion, wird sie aufgeklappt; liegt es
      in einem Scroll-Bereich, wird dorthin gescrollt. Das deckt auch den
      Handy-Modus ab, in dem „Bordbrett" und „PDF" aus der Werkzeugleiste ins
      Menü umziehen (siehe syncToolbarOrt in viewer2d.js). Am Ende wird jeder
      dieser Eingriffe zurückgenommen – der Nutzer findet sein Menü so vor,
      wie er es verlassen hat.

   Aufgerufen wird das Ganze über den „?"-Knopf in der Werkzeugleiste; dieselbe
   Schnittstelle steht als `window.Tutorial2D` für Tests bereit.
   ============================================================================ */

const Tutorial2D = (() => {

  // Ob das Tutorial schon einmal komplett durchlaufen wurde. Liegt im
  // Namensraum der App (core.js), nicht als loser Schlüssel daneben.
  const SPEICHER = (typeof GK === 'object' && GK && GK.tutorial2d) || 'geruest.2d.tutorial';
  const FASSUNG  = 1;

  const SVG_NS_TUT = 'http://www.w3.org/2000/svg';

  /* ── Die Schritte ─────────────────────────────────────────────────────────
     `ziele`  Selektoren der Elemente, die hervorgehoben werden. Das ERSTE ist
              der Bezugspunkt für die Karte; weitere Ziele bekommen ebenfalls
              ein Loch (z. B. Knopf in der Leiste + das Blatt, das er öffnet).
     `titel`  kurze Überschrift
     `text`   ein bis drei kurze Sätze
     `vorbereiten` / `aufraeumen`  nur dort nötig, wo erst etwas geöffnet
              werden muss, das kein Dauerzustand ist (das Einstellblatt).
     `warten` Millisekunden, die eine Einblend-Animation braucht, bevor
              gemessen werden darf.                                           */
  const SCHRITTE = [
    {
      ziele: ['#addSectionBtn', '#sheetSizeBtns', '#bottomSheet .sheet-adj-row'],
      titel: 'Felder hinzufügen',
      text: '„＋ Feld" öffnet dieses Blatt: zuerst die Richtung, dann die Feldlänge. '
          + 'Die gängigen Systemmaße von 0,73 m bis 3,07 m liegen als Tasten bereit – '
          + 'darunter lässt sich jedes eigene Maß eintippen.',
      warten: 300,
      vorbereiten() {
        if (typeof openAddSheet !== 'function') return;
        // Wie ein Tipp auf „＋ Feld": ohne Ankerpunkt, ohne feste Richtung.
        // Das Blatt legt nichts an – angelegt wird erst mit „Hinzufügen",
        // und bis dahin ist das Tutorial längst weitergeblättert.
        if (typeof addCtx !== 'undefined') addCtx = null;
        openAddSheet();
      },
      aufraeumen() { if (typeof closeSheet === 'function') closeSheet(); }
    },
    {
      ziele: ['#viewerPanel'],
      titel: 'Auswählen, verschieben, drehen',
      text: 'Ein Tipp auf ein Feld wählt es aus. Am Griff in der Feldmitte wird es '
          + 'verschoben, am Griff mit dem Bogen gedreht – am Rechner dreht „R" in '
          + '90°-Schritten.'
    },
    {
      ziele: ['#snapToggleBtn'],
      titel: 'Magnet: Felder docken an',
      text: 'Mit eingeschaltetem Magnet rasten neue und verschobene Felder an '
          + 'vorhandenen Feldkanten ein und folgen dem 25-cm-Raster. Ein Tipp '
          + 'schaltet ihn aus, wenn ein Feld frei stehen soll.'
    },
    {
      ziele: ['#wzMasse'],
      titel: 'Höhe und Höhenpunkte',
      text: 'Jedes Feld hat zwei Höhenpunkte: „H links" und „H rechts" – damit sind '
          + 'Dachschrägen und Geländesprünge abgebildet. „=" setzt beide gleich, '
          + '„Höhe übernehmen" schreibt sie in die ganze Auswahl.'
    },
    {
      ziele: ['#wzAuswahl'],
      titel: 'Mehrere Felder gemeinsam bearbeiten',
      text: 'Lange auf ein Feld tippen – oder zwei Finger ruhig aufliegen lassen und '
          + 'einen Rahmen aufziehen – nimmt mehrere Felder in die Auswahl; '
          + '„⬚ Alle Felder auswählen" nimmt alle. Höhe, Bauteile und Achse gelten '
          + 'dann für die gesamte Auswahl, die auch nach einer Aktion stehen bleibt.'
    },
    {
      ziele: ['#addAchseBtn', '#abschnittBar'],
      titel: 'Achsen und Positionen',
      text: '„＋ Achse" legt eine Achse an; ausgewählte Felder wandern gleich hinein. '
          + 'Im Menü lassen sich Achsen umbenennen, ein- und ausblenden und komplett '
          + 'auswählen – Aufmaß und PDF gliedern sich nach ihnen.'
    },
    {
      ziele: ['#wzBauteile'],
      titel: 'Kategorien und Zusatzbauteile',
      text: 'Konsole, Innengeländer, Netz, Dachfang, Treppenturm, Gerüsttreppe und '
          + 'alle weiteren Bauteile hängen an der Auswahl. Karte antippen, Menge oder '
          + 'Lagen festlegen – das Häkchen zeigt, was gesetzt ist.'
    },
    {
      ziele: ['#bordbrettBtn'],
      titel: 'Bordbrett',
      text: '„Bordbrett" schaltet den Zeichenmodus ein: auf einer Feldkante ziehen oder '
          + 'eine Kante antippen. Anfang und Ende dürfen mitten im Feld liegen, mehrere '
          + 'Lagen sind möglich; „Fertig" beendet den Modus.'
    },
    {
      ziele: ['#fitViewBtn'],
      titel: 'Zoom und Navigation',
      text: 'Mit zwei Fingern zoomen, mit einem Finger auf freier Fläche die Ansicht '
          + 'schieben; am Rechner Mausrad und Doppelklick. „Alle" passt die ganze '
          + 'Zeichnung wieder ins Bild.'
    },
    {
      ziele: ['#toolbar [data-zeichnungen]', '#tdMenuBtn'],
      titel: 'Speichern und Laden',
      text: 'Die offene Zeichnung wird laufend lokal gesichert. „Zeichnung speichern" '
          + 'legt zusätzlich einen benannten Stand in der Cloud ab; hinter dem Menü ⌄ '
          + 'liegen „Als Datei speichern" und „Aus Datei laden".'
    },
    {
      ziele: ['#td-exportPdfBtn'],
      titel: 'PDF und Aufmaß',
      text: '„PDF" erzeugt das fertige Dokument: zuerst die Zeichnung, danach das '
          + 'Aufmaß je Achse. Im Dialog lassen sich Design, Blattzahl und '
          + 'ausgeblendete Achsen festlegen.'
    }
  ];

  // ── Laufender Zustand ─────────────────────────────────────────────────────

  let aktiv    = false;
  let index    = -1;
  let sperre   = null;   // Deckel
  let schatten = null;   // <svg> mit Abdunkelung + Löchern
  let maske    = null;   // <mask> darin
  let grund    = null;   // weiße Grundfläche der Maske
  let flaeche  = null;   // abgedunkeltes Rechteck
  let ringGrp  = null;   // <g> mit den Umrandungen
  let karte    = null;   // Erklärkarte
  let teile    = null;   // { titel, text, zaehler, balken, zurueck, weiter }
  let loecher  = [];     // [{ loch, ring, aussen }]
  let rechtecke = [];    // letzte gemessene Zielrechtecke
  let takt     = null;   // Nachmessen während Animationen/Drehen
  let vorher   = null;   // Zustand vor dem Start (Menü offen?)
  const aufgeklappt = new Set();   // IDs der Sektionen, die WIR aufgeklappt haben
  let letzteAufraeumung = null;

  // ── Kleine Helfer ─────────────────────────────────────────────────────────

  const klemm = (v, min, max) => Math.max(min, Math.min(max, v));

  function sichtbar(el) {
    return !!el && el.getClientRects().length > 0;
  }

  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS_TUT, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  /** Schnittfläche zweier Rechtecke – das Maß dafür, wie schlecht eine
   *  Kartenposition ist (sie soll kein Loch verdecken). */
  function ueberlappung(a, b) {
    const w = Math.min(a.left + a.breite, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.top + a.hoehe, b.bottom) - Math.max(a.top, b.top);
    return (w > 0 && h > 0) ? w * h : 0;
  }

  /** Scrollt das Ziel in seinem NÄCHSTEN Scroll-Bereich in die Mitte – nie im
   *  Fenster selbst, damit die Editor-Ansicht nicht wegrutscht. */
  function inSichtHolen(el) {
    let p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const scrollbarY = /(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2;
      const scrollbarX = /(auto|scroll)/.test(cs.overflowX) && p.scrollWidth  > p.clientWidth  + 2;
      if (scrollbarY || scrollbarX) {
        const pr = p.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        if (scrollbarY) {
          // Passt der Block ganz hinein, wird er mittig gestellt; ist er höher
          // als der Bereich (eine lange Bauteil-Liste), zählt sein ANFANG –
          // sonst stünde die Überschrift oben aus dem Bild heraus.
          const rand = er.height >= p.clientHeight - 8 ? 8 : (p.clientHeight - er.height) / 2;
          p.scrollTop = Math.max(0, p.scrollTop + (er.top - pr.top) - rand);
        }
        if (scrollbarX) {
          p.scrollLeft = Math.max(0, p.scrollLeft + (er.left - pr.left) - (p.clientWidth - er.width) / 2);
        }
        return;
      }
      p = p.parentElement;
    }
  }

  // ── Menü und Sektionen so weit öffnen, wie der Schritt es braucht ─────────

  /* Die Sektionen des Werkzeug-Menüs zeigen ihre Bedienelemente nur, wenn
     etwas ausgewählt ist („Kein Feld ausgewählt – Länge und Höhe wirken auf
     die Auswahl"). Damit die Schritte 4, 5 und 7 die ECHTEN Eingabefelder
     zeigen und nicht deren Platzhalter, wählt das Tutorial ein Feld aus –
     aber nur, wenn der Nutzer selbst keines ausgewählt hat, und nur als
     Auswahl: Auswahl ist Ansichts-, nicht Projektzustand (sie steht in keiner
     gespeicherten Zeichnung). Beim Beenden wird sie zurückgenommen. */
  function beispielFeldWaehlen() {
    if (typeof state === 'undefined' || !state || !Array.isArray(state.sections)) return;
    if (typeof selectedSi === 'undefined') return;
    if (selectedSi != null) return;                                          // eigene Auswahl steht
    if (typeof bulkMode !== 'undefined' && bulkMode
        && typeof bulkSelected !== 'undefined' && bulkSelected.size) return; // Mehrfachauswahl steht
    for (let si = 0; si < state.sections.length; si++) {
      const bays = state.sections[si].bays || [];
      for (let bi = 0; bi < bays.length; bi++) {
        if (typeof isBayVisible === 'function' && !isBayVisible(bays[bi])) continue;
        selectedSi = si; selectedBi = bi;
        vorher.auswahlGesetzt = true;
        if (typeof renderAll === 'function') renderAll();
        return;
      }
    }
  }

  function auswahlZurueck() {
    if (!vorher || !vorher.auswahlGesetzt) return;
    if (typeof selectedSi !== 'undefined') { selectedSi = null; selectedBi = null; }
    if (typeof renderAll === 'function') renderAll();
  }

  function menueOeffnen() {
    if (typeof setWerkzeugPanel !== 'function') return;
    if (typeof werkzeugOffen !== 'undefined' && werkzeugOffen) return;
    // `merken: false`: das Aufklappen ist eine Notwendigkeit des Tutorials,
    // nicht die Wahl des Nutzers – sie darf seine Einstellung nicht ersetzen.
    setWerkzeugPanel(true, { merken: false });
  }

  /** Klappt die Sektion auf, in der ein Ziel liegt – über denselben Knopf, den
   *  auch der Nutzer benutzt. Gemerkt wird, was WIR geöffnet haben. */
  function sektionAufklappen(el) {
    const gruppe = el.closest && el.closest('.wz-gruppe');
    if (!gruppe || !gruppe.classList.contains('wz-zu')) return;
    const klapp = gruppe.querySelector('.wz-klapp');
    if (!klapp) return;
    klapp.click();
    if (gruppe.id) aufgeklappt.add(gruppe.id);
  }

  function sektionenZurueck() {
    aufgeklappt.forEach(id => {
      const gruppe = document.getElementById(id);
      if (gruppe && !gruppe.classList.contains('wz-zu')) gruppe.querySelector('.wz-klapp')?.click();
    });
    aufgeklappt.clear();
  }

  // ── Aufbau der Oberfläche ─────────────────────────────────────────────────

  function baueOberflaeche() {
    sperre = document.createElement('div');
    sperre.className = 'tut-sperre';
    // Der Deckel verschluckt alles, was ihn erreicht. Die Karte liegt darüber
    // und bekommt ihre Ereignisse direkt – hier muss nichts durchgelassen
    // werden.
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu']
      .forEach(typ => sperre.addEventListener(typ, e => { e.preventDefault(); e.stopPropagation(); },
                                             { passive: false }));

    schatten = svg('svg', { class: 'tut-schatten', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    const defs = svg('defs', {});
    maske = svg('mask', { id: 'tutLochMaske', maskUnits: 'userSpaceOnUse' });
    grund = svg('rect', { class: 'tut-maske-grund', x: 0, y: 0, width: 0, height: 0 });
    maske.appendChild(grund);
    defs.appendChild(maske);
    schatten.appendChild(defs);
    flaeche = svg('rect', { class: 'tut-flaeche', x: 0, y: 0, width: 0, height: 0, mask: 'url(#tutLochMaske)' });
    schatten.appendChild(flaeche);
    ringGrp = svg('g', { class: 'tut-ringe' });
    schatten.appendChild(ringGrp);

    karte = document.createElement('div');
    karte.className = 'tut-karte';
    karte.setAttribute('role', 'dialog');
    karte.setAttribute('aria-modal', 'true');
    karte.setAttribute('aria-labelledby', 'tutTitel');
    // Übliches Dialog-Muster: der Rahmen selbst nimmt den Fokus auf, damit
    // Vorlesehilfen den Schritt ansagen und die Pfeiltasten sofort wirken –
    // ohne einen Knopf mit einem Fokusring zu markieren, den niemand gedrückt hat.
    karte.tabIndex = -1;
    karte.innerHTML = `
      <div class="tut-kopf">
        <span class="tut-marke">Tutorial</span>
        <span class="tut-zaehler" id="tutZaehler" aria-live="polite"></span>
        <button type="button" class="tut-schliessen" id="tutSchliessen"
                title="Tutorial beenden" aria-label="Tutorial beenden">✕</button>
      </div>
      <div class="tut-balken" id="tutBalken" aria-hidden="true"></div>
      <h2 class="tut-titel" id="tutTitel"></h2>
      <p class="tut-text" id="tutText"></p>
      <div class="tut-fuss">
        <button type="button" class="tut-btn" id="tutZurueck">Zurück</button>
        <button type="button" class="tut-btn leise" id="tutEnde">Tutorial beenden</button>
        <button type="button" class="tut-btn primaer" id="tutWeiter">Weiter</button>
      </div>
    `;

    document.body.appendChild(sperre);
    document.body.appendChild(schatten);
    document.body.appendChild(karte);

    teile = {
      titel:   karte.querySelector('#tutTitel'),
      text:    karte.querySelector('#tutText'),
      zaehler: karte.querySelector('#tutZaehler'),
      balken:  karte.querySelector('#tutBalken'),
      zurueck: karte.querySelector('#tutZurueck'),
      weiter:  karte.querySelector('#tutWeiter')
    };

    SCHRITTE.forEach(() => teile.balken.appendChild(document.createElement('span')));

    teile.zurueck.addEventListener('click', () => geheZu(index - 1));
    teile.weiter.addEventListener('click', () => {
      if (index >= SCHRITTE.length - 1) beende(true); else geheZu(index + 1);
    });
    karte.querySelector('#tutEnde').addEventListener('click', () => beende(false));
    karte.querySelector('#tutSchliessen').addEventListener('click', () => beende(false));
  }

  // ── Löcher und Ringe ──────────────────────────────────────────────────────

  function anzahlLoecher(n) {
    while (loecher.length > n) {
      const alt = loecher.pop();
      alt.loch.remove(); alt.ring.remove(); alt.aussen.remove();
    }
    while (loecher.length < n) {
      const loch   = svg('rect', { class: 'tut-loch', x: 0, y: 0, width: 0, height: 0, rx: 14 });
      const aussen = svg('rect', { class: 'tut-ring-aussen', x: 0, y: 0, width: 0, height: 0, rx: 14 });
      const ring   = svg('rect', { class: 'tut-ring', x: 0, y: 0, width: 0, height: 0, rx: 14 });
      maske.appendChild(loch);
      ringGrp.appendChild(aussen);
      ringGrp.appendChild(ring);
      loecher.push({ loch, ring, aussen });
    }
  }

  function zeichne(rects) {
    const vw = window.innerWidth, vh = window.innerHeight;
    schatten.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    [grund, flaeche].forEach(r => { r.setAttribute('width', vw); r.setAttribute('height', vh); });

    anzahlLoecher(rects.length);
    rects.forEach((r, i) => {
      // Auf den sichtbaren Bereich beschnitten: ein Ziel, das (noch) neben dem
      // Bildschirm liegt – etwa während eine Sektion des Menüs einfährt –
      // ergibt sonst negative Maße, und <rect> weist die zurück.
      const luft = 6;
      const x = klemm(r.left - luft, 0, vw);
      const y = klemm(r.top  - luft, 0, vh);
      const w = Math.max(0, klemm(r.right  + luft, 0, vw) - x);
      const h = Math.max(0, klemm(r.bottom + luft, 0, vh) - y);
      const rx = Math.max(0, Math.min(14, w / 2, h / 2));
      const { loch, ring, aussen } = loecher[i];
      [loch, ring, aussen].forEach(el => {
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', w); el.setAttribute('height', h);
        el.setAttribute('rx', rx);
      });
    });
  }

  /** Setzt die Karte so, dass sie kein Loch verdeckt und im Bild bleibt. */
  function platziere(rects) {
    const L = 12, abstand = 14;
    const vw = window.innerWidth, vh = window.innerHeight;
    karte.style.maxHeight = (vh - 2 * L) + 'px';
    const kb = karte.getBoundingClientRect();
    const kw = kb.width, kh = kb.height;
    const xMax = Math.max(L, vw - L - kw);
    const yMax = Math.max(L, vh - L - kh);

    const setze = (x, y) => {
      karte.style.left = Math.round(klemm(x, L, xMax)) + 'px';
      karte.style.top  = Math.round(klemm(y, L, yMax)) + 'px';
    };

    if (!rects.length) { setze((vw - kw) / 2, (vh - kh) / 2); return; }

    const z = rects[0];
    const mittig = klemm(z.left + z.width / 2 - kw / 2, L, xMax);
    const kandidaten = [
      { x: mittig,                        y: z.bottom + abstand },
      { x: mittig,                        y: z.top - abstand - kh },
      { x: z.right + abstand,             y: klemm(z.top, L, yMax) },
      { x: z.left - abstand - kw,         y: klemm(z.top, L, yMax) },
      { x: klemm((vw - kw) / 2, L, xMax), y: yMax },
      { x: klemm((vw - kw) / 2, L, xMax), y: L }
    ];

    let beste = null;
    for (const k of kandidaten) {
      // Nur Positionen, die vollständig ins Bild passen.
      if (k.y < L - 0.5 || k.y > yMax + 0.5 || k.x < L - 0.5 || k.x > xMax + 0.5) continue;
      const ueber = rects.reduce((s, r) =>
        s + ueberlappung({ left: k.x, top: k.y, breite: kw, hoehe: kh }, r), 0);
      if (!beste || ueber < beste.ueber) beste = { x: k.x, y: k.y, ueber };
      if (ueber === 0) break;
    }
    if (beste) setze(beste.x, beste.y);
    else       setze((vw - kw) / 2, (vh - kh) / 2);
  }

  // ── Schritt zeigen ────────────────────────────────────────────────────────

  function zieleDesSchritts(schritt) {
    return schritt.ziele
      .map(sel => document.querySelector(sel))
      .filter(el => !!el);
  }

  function messe(els) {
    return els.filter(sichtbar).map(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               width: r.width, height: r.height };
    });
  }

  function gleich(a, b) {
    if (a.length !== b.length) return false;
    return a.every((r, i) => Math.abs(r.left - b[i].left) < 1 && Math.abs(r.top - b[i].top) < 1
                          && Math.abs(r.width - b[i].width) < 1 && Math.abs(r.height - b[i].height) < 1);
  }

  function geheZu(neu) {
    if (!aktiv) return;
    neu = klemm(neu, 0, SCHRITTE.length - 1);

    // Was der vorige Schritt geöffnet hat, schließt er selbst – sonst bliebe
    // ein Einstellblatt über dem nächsten Schritt liegen.
    if (typeof letzteAufraeumung === 'function') { letzteAufraeumung(); letzteAufraeumung = null; }

    index = neu;
    const schritt = SCHRITTE[index];

    // Text zuerst: die Karte soll beim Blättern nie leer stehen.
    teile.titel.textContent   = schritt.titel;
    teile.text.textContent    = schritt.text;
    teile.zaehler.textContent = `${index + 1} / ${SCHRITTE.length}`;
    [...teile.balken.children].forEach((s, i) => {
      s.className = i < index ? 'erledigt' : i === index ? 'jetzt' : '';
    });
    teile.zurueck.disabled  = index === 0;
    teile.weiter.textContent = index === SCHRITTE.length - 1 ? 'Fertig' : 'Weiter';

    if (typeof schritt.vorbereiten === 'function') schritt.vorbereiten();
    if (typeof schritt.aufraeumen  === 'function') letzteAufraeumung = schritt.aufraeumen;

    // Liegt ein Ziel im Werkzeug-Menü, muss das Menü auf – im Handy-Modus
    // stehen „Bordbrett" und „PDF" genau dort.
    const ziele = zieleDesSchritts(schritt);
    if (ziele.some(el => el.closest('#werkzeugPanel'))) menueOeffnen();

    const warten = schritt.warten || 70;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!aktiv || index !== neu) return;
      // Jetzt stehen die Sektionen des Menüs; eingeklappte aufklappen.
      zieleDesSchritts(schritt).forEach(sektionAufklappen);
      setTimeout(() => {
        if (!aktiv || index !== neu) return;
        const els = zieleDesSchritts(schritt);
        els.forEach(el => { if (sichtbar(el)) inSichtHolen(el); });
        requestAnimationFrame(() => {
          if (!aktiv || index !== neu) return;
          rechtecke = messe(els);
          zeichne(rechtecke);
          platziere(rechtecke);
          karte.classList.add('sichtbar');
        });
      }, warten);
    }));
  }

  /** Nachmessen: Drehen des iPads, einfahrende Blätter, Bildschirmtastatur. */
  function aktualisiere() {
    if (!aktiv) return;
    const els = zieleDesSchritts(SCHRITTE[index]);
    const neu = messe(els);
    if (gleich(neu, rechtecke) && schatten.getAttribute('viewBox') === `0 0 ${window.innerWidth} ${window.innerHeight}`) return;
    rechtecke = neu;
    zeichne(rechtecke);
    platziere(rechtecke);
  }

  // ── Tastatur ──────────────────────────────────────────────────────────────

  function aufTaste(e) {
    if (!aktiv) return;
    /* Der Deckel hält Finger und Maus ab – die Tastatur muss hier abgefangen
       werden: „R" dreht in der Zeichnung, Strg/Cmd+Z macht rückgängig. Beides
       darf während des Tutorials nicht passieren. Die Ereignisse werden
       deshalb in der EINFANG-Phase gestoppt, bevor sie die Listener der App
       erreichen. `preventDefault()` steht bewusst nur bei den eigenen Tasten:
       Tab, Enter und Leertaste sollen die Karte weiter normal bedienen. */
    e.stopPropagation();
    if (e.key === 'Escape')     { e.preventDefault(); beende(false); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (index < SCHRITTE.length - 1) geheZu(index + 1); else beende(true); }
    else if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   { e.preventDefault(); geheZu(index - 1); }
  }

  function aufAnsichtswechsel() { if (aktiv) beende(false); }

  // ── Start und Ende ────────────────────────────────────────────────────────

  function starte(abSchritt) {
    if (aktiv) return;
    // Das Tutorial erklärt die Zeichenfläche – ohne sie gibt es nichts zu zeigen.
    const editor = document.getElementById('td-zeichnung');
    if (!editor || editor.classList.contains('hidden')) return;

    // Alles, was über der Zeichnung liegen könnte, zuerst schließen: ein
    // offenes Blatt oder Aktionsmenü würde die Hervorhebung verdecken.
    if (typeof closeSheet === 'function') closeSheet();
    if (typeof closeFloatingMenu === 'function') closeFloatingMenu();

    vorher = {
      werkzeugOffen: (typeof werkzeugOffen !== 'undefined') ? !!werkzeugOffen : false,
      auswahlGesetzt: false
    };
    beispielFeldWaehlen();

    aktiv = true;
    index = -1;
    letzteAufraeumung = null;
    aufgeklappt.clear();
    document.body.classList.add('tut-laeuft');
    baueOberflaeche();
    markiereKnopf();

    window.addEventListener('resize', aktualisiere);
    window.addEventListener('orientationchange', aktualisiere);
    window.addEventListener('scroll', aktualisiere, { passive: true });
    window.addEventListener('hashchange', aufAnsichtswechsel);
    document.addEventListener('shell:ansicht', aufAnsichtswechsel);
    document.addEventListener('keydown', aufTaste, true);
    takt = setInterval(aktualisiere, 220);

    geheZu(typeof abSchritt === 'number' ? abSchritt : 0);
    try { karte.focus({ preventScroll: true }); } catch (_) { karte.focus(); }
  }

  function beende(abgeschlossen) {
    if (!aktiv) return;
    aktiv = false;

    clearInterval(takt); takt = null;
    window.removeEventListener('resize', aktualisiere);
    window.removeEventListener('orientationchange', aktualisiere);
    window.removeEventListener('scroll', aktualisiere);
    window.removeEventListener('hashchange', aufAnsichtswechsel);
    document.removeEventListener('shell:ansicht', aufAnsichtswechsel);
    document.removeEventListener('keydown', aufTaste, true);

    if (typeof letzteAufraeumung === 'function') { letzteAufraeumung(); letzteAufraeumung = null; }

    // Die Oberfläche genau so hinterlassen, wie sie vorgefunden wurde.
    sektionenZurueck();
    auswahlZurueck();
    if (vorher && typeof setWerkzeugPanel === 'function'
        && typeof werkzeugOffen !== 'undefined' && werkzeugOffen !== vorher.werkzeugOffen) {
      setWerkzeugPanel(vorher.werkzeugOffen, { merken: false });
    }
    vorher = null;

    sperre?.remove();   sperre = null;
    schatten?.remove(); schatten = null;
    karte?.remove();    karte = null;
    maske = grund = flaeche = ringGrp = teile = null;
    loecher = []; rechtecke = [];
    index = -1;
    document.body.classList.remove('tut-laeuft');

    if (abgeschlossen) {
      merkeAbschluss();
      if (typeof showToast === 'function') showToast('Tutorial beendet – das „?" oben startet es jederzeit neu');
    }
    markiereKnopf();
    // Der Fokus lag im Dialog; er gehört zurück auf den Knopf, der ihn geöffnet hat.
    const btn = document.getElementById('tutorialBtn');
    if (btn && document.activeElement === document.body) {
      try { btn.focus({ preventScroll: true }); } catch (_) { /* egal */ }
    }
  }

  // ── Merken, ob schon durchlaufen ──────────────────────────────────────────

  function gelesen() {
    try {
      const roh = localStorage.getItem(SPEICHER);
      if (!roh) return null;
      const d = JSON.parse(roh);
      return (d && typeof d === 'object') ? d : null;
    } catch (_) { return null; }
  }

  function abgeschlossen() {
    const d = gelesen();
    return !!(d && d.abgeschlossen);
  }

  function merkeAbschluss() {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify({
        abgeschlossen: true, fassung: FASSUNG, datum: new Date().toISOString()
      }));
    } catch (_) { /* privater Modus / Speicher voll – kein Grund für einen Fehler */ }
  }

  /** Der Punkt am „?" verschwindet, sobald das Tutorial einmal durch ist. */
  function markiereKnopf() {
    const btn = document.getElementById('tutorialBtn');
    if (!btn) return;
    btn.classList.toggle('neu', !abgeschlossen());
    btn.classList.toggle('laeuft', aktiv);
    btn.setAttribute('aria-pressed', String(aktiv));
  }

  // ── Verknüpfung mit dem Knopf ─────────────────────────────────────────────

  function verknuepfe() {
    const btn = document.getElementById('tutorialBtn');
    if (!btn || btn.dataset.tutVerknuepft === '1') return;
    btn.dataset.tutVerknuepft = '1';
    btn.addEventListener('click', () => { if (aktiv) beende(false); else starte(0); });
    markiereKnopf();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verknuepfe);
  else verknuepfe();

  return {
    starte,
    beende,
    istAktiv:  () => aktiv,
    schritt:   () => index,
    anzahl:    () => SCHRITTE.length,
    schritte:  () => SCHRITTE.map(s => ({ titel: s.titel, ziele: s.ziele.slice() })),
    abgeschlossen,
    zuruecksetzen() {
      try { localStorage.removeItem(SPEICHER); } catch (_) {}
      markiereKnopf();
    }
  };
})();

window.Tutorial2D = Tutorial2D;
