'use strict';

// ============================================================================
//  Dateiverwaltung – Dokument- und Ordnerspeicher
// ============================================================================
// Diese Datei liegt eine Ebene ÜBER den beiden Modulen: sie weiß nichts über
// Aufmaßregeln, Positionen oder Gerüstfelder. Sie verwaltet nur:
//
//   • Dokumente   – eine Metahülle (Name, Ordner, Datumsangaben, Papierkorb,
//                   Vorschaubild) um das unveränderte Projektformat `data`.
//   • Ordner      – je Modul ein eigener, beliebig tief verschachtelbarer Baum.
//
// Warum IndexedDB statt localStorage?
//   Bisher lag die komplette Projektliste – inklusive aller 2D-Zeichnungen –
//   als eine einzige JSON-Zeichenkette in localStorage. Dessen Limit liegt je
//   nach Browser bei rund 5 MB, und zwar für ALLES zusammen. Mit Vorschau-
//   bildern je Zeichnung und einem Papierkorb, der gelöschte Dokumente 30 Tage
//   aufbewahrt, ist das zu eng: ein volles localStorage wirft beim Schreiben
//   eine Ausnahme, und die letzte Änderung wäre verloren. IndexedDB hat kein
//   vergleichbar hartes Limit, speichert je Dokument getrennt (es muss nicht
//   die ganze Liste neu geschrieben werden) und liegt in derselben Herkunft
//   wie die bereits genutzte Fotodatenbank.
//
// Damit die beiden Editoren möglichst wenig angefasst werden müssen, hält der
// Speicher alles zusätzlich im Arbeitsspeicher: Lesen ist synchron (genau wie
// vorher bei localStorage), nur das Schreiben läuft gebündelt im Hintergrund.
// ============================================================================

/** Version des Metaformats. Erhöhen, sobald sich die Hülle ändert – `data`
 *  bleibt davon unberührt und behält sein eigenes Format. */
const DOK_SCHEMA_VERSION = 1;

const Speicher = (() => {

  const DB_NAME    = 'geruest_dateien_db';
  const DB_VERSION = 1;
  const S_DOK      = 'dokumente';
  const S_ORD      = 'ordner';
  const S_META     = 'meta';

  /** Aufbewahrungsfrist des Papierkorbs in Tagen. */
  const PAPIERKORB_TAGE = 30;

  /** Schlüssel des einmaligen Sicherheits-Backups vor der Migration. */
  const BACKUP_KEY = 'geruest.backup.vor-dateiverwaltung';

  /** Ausweichspeicher, falls IndexedDB nicht zur Verfügung steht
   *  (privates Fenster, alter Browser, blockierte Datenbank). */
  const FALLBACK_KEY = 'geruest.dateien.fallback';

  // ── Zustand im Arbeitsspeicher ────────────────────────────────────────────
  let db          = null;
  let dokumente   = [];      // ALLE Dokumente, auch die im Papierkorb
  let ordnerAlle  = [];
  let istBereit   = false;
  let nutzeFallback = false;

  // Gebündeltes Schreiben: was sich geändert hat, wird gesammelt und kurz
  // darauf in einem Rutsch geschrieben.
  let schreibTimer = null;
  let schreibLauf  = Promise.resolve();
  const dreckigDok = new Set();
  const dreckigOrd = new Set();
  const wegDok     = new Set();
  const wegOrd     = new Set();

  const horcher = new Set();

  // ── Kleine Helfer ─────────────────────────────────────────────────────────

  const jetzt = () => new Date().toISOString();

  function neueId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Tiefe Kopie ohne Verweise auf den Ursprung (für Snapshots/Duplikate). */
  function kopie(wert) {
    return wert == null ? wert : JSON.parse(JSON.stringify(wert));
  }

  /** 'YYYY-MM-DD' (altes Format) → ISO-Zeitstempel. Alles andere bleibt. */
  function alsIso(wert, ersatz) {
    if (!wert) return ersatz || jetzt();
    const s = String(wert);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00.000Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? (ersatz || jetzt()) : d.toISOString();
  }

  /** ISO-Zeitstempel → 'YYYY-MM-DD' (Format der bestehenden Projektdaten). */
  function alsTag(iso) {
    return String(iso || jetzt()).slice(0, 10);
  }

  function melde() {
    horcher.forEach(fn => { try { fn(); } catch (_) { /* ein Horcher darf den Rest nicht aufhalten */ } });
  }

  // ── Anzeigename ───────────────────────────────────────────────────────────
  // Ein Dokument ohne eigenen Namen zeigt die Anschrift – so wie es die
  // Projektübersicht bisher schon gemacht hat.

  function nameAusDaten(data) {
    if (!data) return '';
    if (data.name && String(data.name).trim()) return String(data.name).trim();
    const a = data.anschrift || {};
    const strasse = [a.strasse, a.nummer].filter(Boolean).join(' ');
    const ort     = [a.plz, a.ort].filter(Boolean).join(' ');
    const adresse = [strasse, ort].filter(Boolean).join(', ');
    if (adresse) return adresse;
    if (a.bauherr) return a.bauherr;
    return '';
  }

  /** Anzeigename eines Dokuments – nie leer. */
  function anzeigename(dok) {
    return (dok && (String(dok.name || '').trim() || nameAusDaten(dok.data))) || 'Ohne Namen';
  }

  // ── Datenbank ─────────────────────────────────────────────────────────────

  function oeffneDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('keine IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(S_DOK))  d.createObjectStore(S_DOK,  { keyPath: 'id' });
        if (!d.objectStoreNames.contains(S_ORD))  d.createObjectStore(S_ORD,  { keyPath: 'id' });
        if (!d.objectStoreNames.contains(S_META)) d.createObjectStore(S_META, { keyPath: 'schluessel' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blockiert'));
    });
  }

  function alleAus(store) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  function metaLies(schluessel) {
    return new Promise(resolve => {
      const tx  = db.transaction(S_META, 'readonly');
      const req = tx.objectStore(S_META).get(schluessel);
      req.onsuccess = () => resolve(req.result ? req.result.wert : null);
      req.onerror   = () => resolve(null);
    });
  }

  function metaSchreib(schluessel, wert) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(S_META, 'readwrite');
      tx.objectStore(S_META).put({ schluessel, wert });
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  // ── Schreiben (gebündelt) ─────────────────────────────────────────────────

  function plane() {
    if (schreibTimer) clearTimeout(schreibTimer);
    schreibTimer = setTimeout(() => { schreibTimer = null; schreibeJetzt(); }, 250);
  }

  function schreibeJetzt() {
    // Was gerade ansteht, wird eingesammelt; alles danach landet im nächsten Lauf.
    const dokIds = [...dreckigDok]; dreckigDok.clear();
    const ordIds = [...dreckigOrd]; dreckigOrd.clear();
    const dokWeg = [...wegDok];     wegDok.clear();
    const ordWeg = [...wegOrd];     wegOrd.clear();
    if (!dokIds.length && !ordIds.length && !dokWeg.length && !ordWeg.length) return schreibLauf;

    if (nutzeFallback) {
      schreibLauf = schreibLauf.then(() => schreibeFallback());
      return schreibLauf;
    }

    schreibLauf = schreibLauf.then(() => new Promise((resolve) => {
      if (!db) { resolve(); return; }
      let tx;
      try {
        tx = db.transaction([S_DOK, S_ORD], 'readwrite');
      } catch (_) { resolve(); return; }
      const sd = tx.objectStore(S_DOK);
      const so = tx.objectStore(S_ORD);
      dokIds.forEach(id => {
        const dok = dokumente.find(d => d.id === id);
        // `kopie` löst die Verweise auf die lebenden Editor-Objekte auf:
        // IndexedDB klont ohnehin, aber so kann eine spätere Änderung im
        // Editor die laufende Transaktion nicht mehr beeinflussen.
        if (dok) { try { sd.put(kopie(dok)); } catch (_) { /* einzelnes Dokument überspringen */ } }
      });
      ordIds.forEach(id => {
        const ord = ordnerAlle.find(o => o.id === id);
        if (ord) { try { so.put(kopie(ord)); } catch (_) { /* s. o. */ } }
      });
      dokWeg.forEach(id => { try { sd.delete(id); } catch (_) {} });
      ordWeg.forEach(id => { try { so.delete(id); } catch (_) {} });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    }));
    return schreibLauf;
  }

  function schreibeFallback() {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify({ dokumente, ordner: ordnerAlle }));
    } catch (_) { /* Speicher voll – der Arbeitsspeicher bleibt gültig */ }
  }

  function markiereDok(dok, beruehren) {
    if (!dok) return;
    if (beruehren !== false) dok.updatedAt = jetzt();
    // Der Editor liest `geaendert` aus den Projektdaten – beides gleich halten.
    if (dok.data && typeof dok.data === 'object') dok.data.geaendert = alsTag(dok.updatedAt);
    dreckigDok.add(dok.id);
    plane();
  }

  function markiereOrd(ord) {
    if (!ord) return;
    ord.updatedAt = jetzt();
    dreckigOrd.add(ord.id);
    plane();
  }

  // ── Migration aus dem bisherigen localStorage-Format ──────────────────────

  /** Legt den kompletten Altstand unangetastet als Backup ab. Der alte
   *  Schlüssel selbst wird NICHT entfernt – solange er da ist, ließe sich der
   *  Stand vor der Umstellung jederzeit von Hand wiederherstellen. */
  function legeBackupAn(rohProjekte, rohOrdner) {
    try {
      if (localStorage.getItem(BACKUP_KEY)) return;   // schon vorhanden
      localStorage.setItem(BACKUP_KEY, JSON.stringify({
        zeitpunkt: jetzt(),
        hinweis: 'Automatisches Backup vor der Umstellung auf die Dateiverwaltung.',
        projekte: rohProjekte,
        ordner:   rohOrdner
      }));
    } catch (_) { /* Backup ist eine Zugabe – es darf die Migration nicht verhindern */ }
  }

  function leseAlt(schluessel) {
    try {
      const roh = localStorage.getItem(schluessel);
      return roh ? JSON.parse(roh) : null;
    } catch (_) { return null; }
  }

  /** Baut aus einem bestehenden Projektdatensatz ein Dokument. */
  function dokAusProjekt(data, opt) {
    const o = opt || {};
    const erstellt = alsIso(data.erstellt, o.jetzt);
    const geaendert = alsIso(data.geaendert, erstellt);
    return {
      id:        neueId('dok'),
      name:      nameAusDaten(data),
      ordner:    { aufmass: data.folderId || null, zweid: o.ordner2d || null },
      createdAt: erstellt,
      updatedAt: geaendert,
      zuletztGeoeffnet: { aufmass: null, zweid: null },
      deletedAt: null,
      thumbnail: null,
      schemaVersion: DOK_SCHEMA_VERSION,
      data
    };
  }

  async function migriereFallsNoetig() {
    const schonGelaufen = nutzeFallback
      ? !!localStorage.getItem(FALLBACK_KEY)
      : await metaLies('migriert.v1');
    if (schonGelaufen && (dokumente.length || ordnerAlle.length)) return 0;
    if (schonGelaufen) return 0;

    const rohProjekte = leseAlt(GK.projekte);
    const rohOrdner   = leseAlt(GK.ordner);
    const projekte = Array.isArray(rohProjekte) ? rohProjekte : [];
    const altOrdner = Array.isArray(rohOrdner) ? rohOrdner : [];

    if (projekte.length || altOrdner.length) legeBackupAn(rohProjekte, rohOrdner);

    const t = jetzt();

    // Die bisherigen Ordner waren flach und gehörten der Aufmaß-Übersicht.
    // Sie behalten ihre ID – dadurch bleibt `folderId` in den Projektdaten
    // gültig und niemand landet nach dem Update im falschen Ordner.
    altOrdner.forEach(f => {
      if (!f || !f.id) return;
      ordnerAlle.push({
        id: String(f.id),
        name: String(f.name || 'Ordner'),
        parentId: null,
        modul: 'aufmass',
        createdAt: t,
        updatedAt: t
      });
      dreckigOrd.add(String(f.id));
    });

    projekte.forEach(data => {
      if (!data || typeof data !== 'object') return;
      const dok = dokAusProjekt(data, { jetzt: t });
      dokumente.push(dok);
      dreckigDok.add(dok.id);
    });

    if (!nutzeFallback) await metaSchreib('migriert.v1', { zeitpunkt: t, dokumente: dokumente.length });
    await schreibeJetzt();
    return dokumente.length;
  }

  // ── Papierkorb aufräumen ──────────────────────────────────────────────────

  function raeumePapierkorbAuf() {
    const grenze = Date.now() - PAPIERKORB_TAGE * 86400000;
    let weg = 0;
    dokumente = dokumente.filter(d => {
      if (!d.deletedAt) return true;
      if (new Date(d.deletedAt).getTime() > grenze) return true;
      wegDok.add(d.id); weg++;
      return false;
    });
    if (weg) plane();
    return weg;
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  let initLauf = null;

  function init() {
    if (initLauf) return initLauf;
    initLauf = (async () => {
      try {
        db = await oeffneDb();
        dokumente  = await alleAus(S_DOK);
        ordnerAlle = await alleAus(S_ORD);
      } catch (_) {
        // Kein IndexedDB (privates Fenster o. Ä.): auf localStorage ausweichen.
        // Die App bleibt vollständig bedienbar, nur der Platz ist knapper.
        nutzeFallback = true;
        db = null;
        try {
          const roh = JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null');
          dokumente  = (roh && roh.dokumente) || [];
          ordnerAlle = (roh && roh.ordner)    || [];
        } catch (_) { dokumente = []; ordnerAlle = []; }
      }

      try { await migriereFallsNoetig(); } catch (_) { /* nie mit Datenverlust abbrechen */ }

      // Ältere Dokumente auf den aktuellen Stand der Hülle heben.
      dokumente.forEach(d => {
        if (!d.ordner) d.ordner = { aufmass: null, zweid: null };
        if (!d.zuletztGeoeffnet) d.zuletztGeoeffnet = { aufmass: null, zweid: null };
        if (d.deletedAt === undefined) d.deletedAt = null;
        if (d.thumbnail === undefined) d.thumbnail = null;
        if (!d.schemaVersion) d.schemaVersion = DOK_SCHEMA_VERSION;
      });

      raeumePapierkorbAuf();
      istBereit = true;
      return dokumente.length;
    })();
    return initLauf;
  }

  // ── Lesen ─────────────────────────────────────────────────────────────────

  function aktive() { return dokumente.filter(d => !d.deletedAt); }

  /** Alle sichtbaren Dokumente eines Moduls. Beide Module arbeiten am selben
   *  Bestand – jedes bringt aber seine eigene Ordnerzuordnung mit. */
  function liste(modul) {
    void modul;
    return aktive();
  }

  function papierkorb() {
    return dokumente.filter(d => !!d.deletedAt)
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  }

  function dok(id) { return dokumente.find(d => d.id === id) || null; }

  /** Findet das Dokument, dessen Projektdaten die übergebene ID tragen. */
  function dokZuDaten(datenId) {
    return dokumente.find(d => d.data && d.data.id === datenId) || null;
  }

  /** Die reinen Projektdatensätze – das, womit die Editoren bisher schon
   *  gearbeitet haben. Bewusst die lebenden Objekte, keine Kopien: der Editor
   *  darf direkt darauf schreiben, der Speicher schreibt sie danach weg. */
  function datenListe() {
    return aktive().map(d => d.data).filter(Boolean);
  }

  /** Zuletzt in diesem Modul geöffnete Dokumente (neueste zuerst). */
  function zuletzt(modul, anzahl) {
    const schl = modulSchluessel(modul);
    return aktive()
      .filter(d => d.zuletztGeoeffnet && d.zuletztGeoeffnet[schl])
      .sort((a, b) => String(b.zuletztGeoeffnet[schl]).localeCompare(String(a.zuletztGeoeffnet[schl])))
      .slice(0, anzahl || 5);
  }

  function modulSchluessel(modul) {
    return (modul === '2d' || modul === 'zweid') ? 'zweid' : 'aufmass';
  }

  /** Ordner eines Moduls (optional nur die eines Elternordners). */
  function ordner(modul, parentId) {
    const m = modulSchluessel(modul);
    return ordnerAlle
      .filter(o => o.modul === m && (parentId === undefined || (o.parentId || null) === (parentId || null)))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  function ordnerVon(id) { return ordnerAlle.find(o => o.id === id) || null; }

  /** Pfad von der Wurzel bis zum Ordner – Grundlage der Brotkrumen-Leiste. */
  function ordnerPfad(id) {
    const pfad = [];
    let o = ordnerVon(id);
    let schutz = 0;
    while (o && schutz++ < 50) { pfad.unshift(o); o = o.parentId ? ordnerVon(o.parentId) : null; }
    return pfad;
  }

  /** Ordner-ID eines Dokuments im jeweiligen Modul. */
  function ordnerIdVon(d, modul) {
    return (d && d.ordner && d.ordner[modulSchluessel(modul)]) || null;
  }

  // ── Schreiben: Dokumente ──────────────────────────────────────────────────

  /** Legt ein neues Dokument an. `data` ist das Projektformat des Moduls. */
  function neu({ modul, name, ordnerId, data }) {
    const t = jetzt();
    const m = modulSchluessel(modul);
    const nutzdaten = data || {};
    const d = {
      id: neueId('dok'),
      name: (name || '').trim(),
      ordner: { aufmass: null, zweid: null },
      createdAt: t,
      updatedAt: t,
      zuletztGeoeffnet: { aufmass: null, zweid: null },
      deletedAt: null,
      thumbnail: null,
      schemaVersion: DOK_SCHEMA_VERSION,
      data: nutzdaten
    };
    d.ordner[m] = ordnerId || null;
    if (m === 'aufmass') nutzdaten.folderId = ordnerId || null;
    if (d.name) nutzdaten.name = d.name;
    nutzdaten.erstellt = alsTag(t);
    nutzdaten.geaendert = alsTag(t);
    dokumente.push(d);
    markiereDok(d, false);
    dreckigDok.add(d.id);
    plane();
    melde();
    return d;
  }

  /** Übernimmt Änderungen an einem Dokument (Editor hat `data` verändert). */
  function schreibe(id) {
    const d = dok(id);
    if (!d) return null;
    d.name = d.name || nameAusDaten(d.data);
    markiereDok(d);
    return d;
  }

  function umbenenne(id, name) {
    const d = dok(id);
    if (!d) return null;
    d.name = String(name || '').trim();
    if (d.data && typeof d.data === 'object') d.data.name = d.name;
    markiereDok(d);
    melde();
    return d;
  }

  function verschiebe(id, modul, ordnerId) {
    const d = dok(id);
    if (!d) return null;
    const m = modulSchluessel(modul);
    d.ordner[m] = ordnerId || null;
    // `folderId` im Projektdatensatz bleibt die Aufmaß-Zuordnung (Altformat).
    if (m === 'aufmass' && d.data && typeof d.data === 'object') d.data.folderId = ordnerId || null;
    markiereDok(d);
    melde();
    return d;
  }

  function dupliziere(id, modul) {
    const quelle = dok(id);
    if (!quelle) return null;
    const t = jetzt();
    const daten = kopie(quelle.data) || {};
    // Neue Identität: sonst zeigen Original und Kopie auf denselben Datensatz.
    if (daten.id) daten.id = neueId('proj');
    const neuerName = (anzeigename(quelle) + ' (Kopie)').trim();
    daten.name = neuerName;
    daten.erstellt = alsTag(t);
    daten.geaendert = alsTag(t);
    const d = {
      id: neueId('dok'),
      name: neuerName,
      ordner: { aufmass: quelle.ordner.aufmass || null, zweid: quelle.ordner.zweid || null },
      createdAt: t,
      updatedAt: t,
      zuletztGeoeffnet: { aufmass: null, zweid: null },
      deletedAt: null,
      thumbnail: quelle.thumbnail || null,
      schemaVersion: DOK_SCHEMA_VERSION,
      data: daten
    };
    void modul;
    dokumente.push(d);
    dreckigDok.add(d.id);
    plane();
    melde();
    return d;
  }

  /** In den Papierkorb legen (30 Tage wiederherstellbar). */
  function inPapierkorb(id) {
    const d = dok(id);
    if (!d || d.deletedAt) return null;
    d.deletedAt = jetzt();
    markiereDok(d, false);
    melde();
    return d;
  }

  function wiederherstellen(id) {
    const d = dok(id);
    if (!d) return null;
    d.deletedAt = null;
    markiereDok(d, false);
    melde();
    return d;
  }

  function endgueltigLoeschen(id) {
    const i = dokumente.findIndex(d => d.id === id);
    if (i < 0) return false;
    dokumente.splice(i, 1);
    wegDok.add(id);
    dreckigDok.delete(id);
    plane();
    melde();
    return true;
  }

  function papierkorbLeeren() {
    const ids = papierkorb().map(d => d.id);
    ids.forEach(endgueltigLoeschen);
    return ids.length;
  }

  /** Merkt sich, wann ein Dokument in welchem Modul zuletzt geöffnet wurde. */
  function merkeGeoeffnet(id, modul) {
    const d = dok(id);
    if (!d) return null;
    d.zuletztGeoeffnet[modulSchluessel(modul)] = jetzt();
    markiereDok(d, false);
    return d;
  }

  function setzeVorschau(id, dataUrl) {
    const d = dok(id);
    if (!d) return null;
    if (d.thumbnail === dataUrl) return d;
    d.thumbnail = dataUrl || null;
    markiereDok(d, false);
    return d;
  }

  // ── Schreiben: Ordner ─────────────────────────────────────────────────────

  function neuerOrdner(modul, name, parentId) {
    const t = jetzt();
    const o = {
      id: neueId('ord'),
      name: String(name || 'Neuer Ordner').trim(),
      parentId: parentId || null,
      modul: modulSchluessel(modul),
      createdAt: t,
      updatedAt: t
    };
    ordnerAlle.push(o);
    dreckigOrd.add(o.id);
    plane();
    melde();
    return o;
  }

  function benenneOrdnerUm(id, name) {
    const o = ordnerVon(id);
    if (!o) return null;
    o.name = String(name || '').trim() || o.name;
    markiereOrd(o);
    melde();
    return o;
  }

  /** Verschiebt einen Ordner. Ein Ordner darf nicht in sich selbst oder in
   *  einen seiner eigenen Unterordner wandern – sonst hinge der Ast frei. */
  function verschiebeOrdner(id, zielId) {
    const o = ordnerVon(id);
    if (!o) return null;
    if (zielId === id) return null;
    if (zielId && istNachfahre(zielId, id)) return null;
    o.parentId = zielId || null;
    markiereOrd(o);
    melde();
    return o;
  }

  function istNachfahre(kandidatId, ahnId) {
    let o = ordnerVon(kandidatId);
    let schutz = 0;
    while (o && schutz++ < 50) {
      if (o.parentId === ahnId) return true;
      o = o.parentId ? ordnerVon(o.parentId) : null;
    }
    return false;
  }

  /** Löscht einen Ordner samt Unterordnern. Die enthaltenen Dokumente bleiben
   *  erhalten und rutschen in die Wurzel – gelöscht wird nur die Schublade,
   *  nie ihr Inhalt. */
  function loescheOrdner(id) {
    const m = modulSchluessel(ordnerVon(id) ? ordnerVon(id).modul : 'aufmass');
    const zuLoeschen = [id];
    for (let i = 0; i < zuLoeschen.length; i++) {
      ordnerAlle.filter(o => o.parentId === zuLoeschen[i]).forEach(o => zuLoeschen.push(o.id));
    }
    const menge = new Set(zuLoeschen);
    dokumente.forEach(d => {
      if (d.ordner && menge.has(d.ordner[m])) {
        d.ordner[m] = null;
        if (m === 'aufmass' && d.data) d.data.folderId = null;
        markiereDok(d, false);
      }
    });
    ordnerAlle = ordnerAlle.filter(o => !menge.has(o.id));
    menge.forEach(oid => { wegOrd.add(oid); dreckigOrd.delete(oid); });
    plane();
    melde();
    return zuLoeschen.length;
  }

  /** Zählt Dokumente in einem Ordner (ohne Unterordner). */
  function anzahlImOrdner(modul, ordnerId) {
    const m = modulSchluessel(modul);
    return aktive().filter(d => (d.ordner[m] || null) === (ordnerId || null)).length;
  }

  // ── Abgleich mit der Projektliste der Aufmaß-App ──────────────────────────
  // `script.js` arbeitet unverändert auf einem Array `projects`. Diese Funktion
  // führt dieses Array und den Dokumentenspeicher zusammen: neue Einträge
  // werden zu Dokumenten, entfernte wandern in den Papierkorb. Dadurch bleibt
  // der bestehende Code (duplizieren, löschen, importieren) gültig.

  /** @param liste  die Projektliste des Aufmaß-Moduls
   *  @param nurId  ID des Projekts, das tatsächlich verändert wurde. Nur
   *                dieses bekommt einen neuen Änderungszeitstempel und wird
   *                geschrieben. Ohne Angabe gilt das für alle Einträge.
   *
   *  Bewusst wird hier NICHTS gelöscht: Ein Dokument, das in dieser Liste
   *  fehlt, ist kein Löschwunsch – es kann genauso gut gerade im 2D-Modul
   *  angelegt worden sein, während `projects` noch den älteren Stand hielt.
   *  Gelöscht wird ausschließlich über `inPapierkorb()`. */
  function uebernimmDaten(liste, nurId) {
    const nachDatenId = new Map();
    aktive().forEach(d => { if (d.data && d.data.id) nachDatenId.set(d.data.id, d); });

    (liste || []).forEach(data => {
      if (!data || !data.id) return;
      let d = nachDatenId.get(data.id);
      const istNeu = !d;
      if (istNeu) {
        d = dokAusProjekt(data, {});
        dokumente.push(d);
      } else if (d.data !== data) {
        d.data = data;
      }
      if (!istNeu && nurId !== undefined && nurId !== null && data.id !== nurId) return;

      // Name und Ordner folgen den Projektdaten (Altpfade schreiben dort hinein).
      const name = nameAusDaten(data);
      if (name) d.name = name;
      d.ordner.aufmass = data.folderId || null;
      markiereDok(d);
    });

    melde();
  }

  // ── Export / Import einzelner Dokumente ───────────────────────────────────

  function exportPaket(id) {
    const d = dok(id);
    if (!d) return null;
    return {
      typ: 'geruest-dokument',
      exportiertAm: jetzt(),
      schemaVersion: d.schemaVersion || DOK_SCHEMA_VERSION,
      dokument: {
        name: anzeigename(d),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        thumbnail: d.thumbnail || null,
        data: kopie(d.data)
      }
    };
  }

  /** Nimmt sowohl das neue Paketformat als auch einen blanken Projekt-
   *  datensatz an (so wie ihn „JSON exportieren" im Editor erzeugt). */
  function importPaket(roh, modul, ordnerId) {
    let name = '', data = null, thumb = null, erstellt = null;
    if (roh && roh.typ === 'geruest-dokument' && roh.dokument) {
      name  = roh.dokument.name || '';
      data  = roh.dokument.data || null;
      thumb = roh.dokument.thumbnail || null;
      erstellt = roh.dokument.createdAt || null;
    } else if (roh && (roh.seiten || roh.zeichnung2d || roh.anschrift)) {
      data = roh;
      name = nameAusDaten(roh);
    } else {
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    data = kopie(data);
    // Immer eine frische Identität: ein Import darf nie ein vorhandenes
    // Dokument überschreiben.
    data.id = neueId('proj');
    const d = neu({ modul, name, ordnerId, data });
    if (erstellt) { d.createdAt = alsIso(erstellt, d.createdAt); }
    if (thumb) d.thumbnail = thumb;
    markiereDok(d, false);
    return d;
  }

  // ── Sofort schreiben ──────────────────────────────────────────────────────

  function flush() {
    if (schreibTimer) { clearTimeout(schreibTimer); schreibTimer = null; }
    return schreibeJetzt();
  }

  function beobachte(fn) { horcher.add(fn); return () => horcher.delete(fn); }

  // Beim Wegschalten des Tabs (Bildschirm sperren, App wechseln) sofort
  // schreiben – auf dem Tablet ist das der Normalfall, nicht die Ausnahme.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', () => flush());
  }

  return {
    init, flush, beobachte,
    bereit: () => istBereit,
    imFallback: () => nutzeFallback,

    // Lesen
    liste, papierkorb, dok, dokZuDaten, datenListe, zuletzt, anzeigename,
    ordner, ordnerVon, ordnerPfad, ordnerIdVon, anzahlImOrdner, modulSchluessel,

    // Schreiben
    neu, schreibe, umbenenne, verschiebe, dupliziere,
    inPapierkorb, wiederherstellen, endgueltigLoeschen, papierkorbLeeren,
    merkeGeoeffnet, setzeVorschau,
    neuerOrdner, benenneOrdnerUm, verschiebeOrdner, loescheOrdner,
    uebernimmDaten,

    // Austausch
    exportPaket, importPaket,

    // Hilfen für die Oberfläche
    neueId, kopie, alsTag,
    PAPIERKORB_TAGE
  };
})();
