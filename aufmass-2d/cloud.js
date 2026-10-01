'use strict';

// Cloud-Abgleich dieser Anwendung. Laden, Speichern und Löschen laufen
// nacheinander; Web Locks koordinieren zusätzlich mehrere Tabs desselben Kontos.
const CloudSpeicher = (() => {
  const APP = '2d';
  const KEY = GK.zeichnungen;
  const META = '_cloud';
  const GELOESCHT = KEY + '.geloescht';
  const RETTUNG = KEY + '.lokaleSicherungen';
  let konto = null, bereit = false, unterdrueckt = false;
  let timer = null, versuche = 0, syncPromise = null;
  let kette = Promise.resolve();
  const loeschend = new Set();
  const snapshotsProjekt = new Map();
  const snapshotsOrdner = new Map();
  const bekannteOrdnerIds = new Map();

  function lesen(key) {
    try {
      const wert = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(wert) ? wert : [];
    } catch (_) { return []; }
  }
  const schreiben = (key, wert) => localStorage.setItem(key, JSON.stringify(wert));
  const lokaleProjekte = () => lesen(KEY);
  const lokaleOrdner = () => lesen(GK.ordner);
  const geloescht = () => new Set(lesen(GELOESCHT));
  function ohneMeta(p) {
    const kopie = JSON.parse(JSON.stringify(p));
    delete kopie[META];
    return kopie;
  }
  // Postgres jsonb ordnet Objektschlüssel neu. Diese Reihenfolge ist kein
  // Inhaltsunterschied und darf keinen Konflikt oder erneuten Upload erzeugen.
  function stabil(v) {
    if (Array.isArray(v)) return v.map(stabil);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, stabil(v[k])]));
  }
  function fingerabdruck(p) {
    return JSON.stringify(stabil(ohneMeta(p)));
  }
  function signatur(p) {
    const text = fingerabdruck(p);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ text.charCodeAt(i);
    }
    return text.length + ':' + (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
  }
  function metaFuer(p, cloud) {
    return {
      revision: cloud.revision, ownerUserId: cloud.ownerUserId || p[META]?.ownerUserId || null,
      rolle: cloud.rolle || p[META]?.rolle || 'owner',
      eigenes: cloud.eigenes ?? p[META]?.eigenes ?? true,
      erstelltVon: cloud.erstelltVon || p[META]?.erstelltVon || 'Du',
      basis: signatur(p), dirty: false
    };
  }
  function mitMeta(cloud) {
    const p = { ...cloud.inhalt, id: cloud.id };
    p[META] = metaFuer(p, cloud);
    return p;
  }
  function geaendert(p, snapshots) {
    if (!p[META]?.revision) return true;
    if (p[META].dirty) return true;
    if (p[META].basis) return p[META].basis !== signatur(p);
    return snapshots.has(p.id) && snapshots.get(p.id) !== fingerabdruck(p);
  }
  function status(text, art) {
    const el = document.getElementById('cloudStatus');
    if (el) { el.textContent = text; el.dataset.status = art || ''; }
  }
  function melden(text) {
    if (typeof showToast === 'function') showToast(text);
  }
  function oberflaeche() {
    unterdrueckt = true;
    try {
      // Die Zeichnungsübersicht liest nach diesem Ereignis ihren eigenen Speicher neu.
      document.dispatchEvent(new CustomEvent(GERUEST_DATEN_EVENT, { detail: { quelle: 'cloud' } }));
    } finally { unterdrueckt = false; }
  }
  function editorSichern() {
    if (typeof ZweiDModul !== 'undefined') ZweiDModul.sichern?.();
  }
  function serie(aktion) {
    const lauf = () => navigator.locks?.request
      ? navigator.locks.request('aufmassx-cloud-' + APP, aktion) : aktion();
    const ergebnis = kette.then(lauf, lauf);
    kette = ergebnis.catch(() => {});
    return ergebnis;
  }
  async function anfrage(url, opt = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        ...opt, headers: { 'Content-Type': 'application/json', ...opt.headers },
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal
      });
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok || (res.status !== 204 && !body)) {
        const fehler = new Error(body?.error || 'Keine gültige Antwort vom Cloud-Speicher.');
        fehler.status = res.status;
        fehler.api = !!body && typeof body.error === 'string';
        fehler.aktuell = body?.aktuell || null;
        throw fehler;
      }
      return body;
    } catch (fehler) {
      if (fehler.name === 'AbortError') {
        const timeoutFehler = new Error('Die Cloud antwortet zu langsam. Bitte erneut versuchen.');
        timeoutFehler.status = 408;
        throw timeoutFehler;
      }
      throw fehler;
    } finally { clearTimeout(timeout); }
  }
  function fehlerZeigen(fehler, laut) {
    let text;
    if (fehler.status === 401) text = 'Bitte erneut anmelden – Änderungen bleiben lokal gespeichert';
    else if (fehler.status === 403) text = 'Keine Berechtigung für diesen Vorgang';
    else if (fehler.status === 409) text = 'Neuerer Cloud-Stand – bitte prüfen und erneut versuchen';
    else if (fehler.status === 408) text = 'Cloud antwortet zu langsam – Änderungen bleiben lokal';
    else text = navigator.onLine ? 'Cloud nicht erreichbar – Änderungen bleiben lokal' : 'Offline – Änderungen bleiben auf diesem Gerät';
    status(text, 'fehler');
    // Keine Projektdaten, Namen oder Zugangsdaten in der Diagnose.
    console.warn('[cloud]', APP, fehler.status || 'netzwerk');
    if (laut) melden(fehler.message || text);
  }
  function erneut(fehler) {
    if ([401, 403, 409, 410, 400, 413].includes(fehler.status) || !navigator.onLine || versuche >= 4) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void aktualisieren(false); }, [3000, 10000, 30000, 60000][versuche++]);
  }
  function lokalSichern(p, grund) {
    const sicherungen = lesen(RETTUNG);
    if (!sicherungen.some(s => s.projekt.id === p.id && signatur(s.projekt) === signatur(p))) {
      sicherungen.push({ zeit: new Date().toISOString(), grund, projekt: p });
      schreiben(RETTUNG, sicherungen);
    }
  }
  function entferntMerken(id) {
    const ids = geloescht();
    ids.add(id);
    schreiben(GELOESCHT, Array.from(ids));
  }
  function lokalEntfernen(p, sichern) {
    if (sichern) lokalSichern(p, 'In der Cloud gelöscht oder Zugriff entzogen');
    entferntMerken(p.id);
    schreiben(KEY, lokaleProjekte().filter(x => x.id !== p.id));
    snapshotsProjekt.delete(p.id);
    oberflaeche();
  }

  function arbeitsbereichEinspielen(cloud) {
    konto = cloud.konto || konto;
    const remote = new Map((cloud.projects || []).map(p => [p.id, p]));
    const entfernt = geloescht();
    const zusammen = [];
    for (const p of lokaleProjekte()) {
      const r = remote.get(p.id);
      remote.delete(p.id);
      if (entfernt.has(p.id)) continue;
      if (!r) {
        // Nur eine ausdrücklich vollständige Liste belegt das Fehlen.
        if (cloud.vollstaendig && (p[META]?.revision || p[META]?.uebernommen)) {
          if (geaendert(p, snapshotsProjekt)) lokalSichern(p, 'In der Cloud gelöscht oder Zugriff entzogen');
          entferntMerken(p.id);
        } else zusammen.push(p);
        continue;
      }
      const cloudP = mitMeta(r);
      if (fingerabdruck(p) === fingerabdruck(cloudP)) zusammen.push(cloudP);
      else if (geaendert(p, snapshotsProjekt) && !p[META]?.uebernommen) zusammen.push(p);
      else if (p[META]?.uebernommen && p[META]?.dirty) {
        // Migration behält lokale, noch ungesicherte Änderungen als Änderung
        // der neuen 2D-Kopie. Deren Cloud-Revision war im Altspeicher unbekannt.
        p[META] = { ...cloudP[META], dirty: true };
        zusammen.push(p);
      } else zusammen.push(cloudP);
      snapshotsProjekt.set(p.id, fingerabdruck(cloudP));
    }
    remote.forEach(p => { if (!entfernt.has(p.id)) zusammen.push(mitMeta(p)); });
    schreiben(KEY, zusammen);

    const remoteOrdner = new Map((cloud.folders || []).map(o => [o.id, o]));
    const ordner = [];
    for (const o of lokaleOrdner()) {
      const r = remoteOrdner.get(o.id);
      remoteOrdner.delete(o.id);
      if (!r) {
        if (!cloud.vollstaendig || !o[META]?.revision) ordner.push(o);
        continue;
      }
      const neu = mitMeta(r);
      ordner.push(geaendert(o, snapshotsOrdner) && fingerabdruck(o) !== fingerabdruck(neu) ? o : neu);
      snapshotsOrdner.set(o.id, fingerabdruck(neu));
    }
    remoteOrdner.forEach(o => ordner.push(mitMeta(o)));
    schreiben(GK.ordner, ordner);
    bekannteOrdnerIds.clear();
    ordner.forEach(o => { if (o[META]?.revision) bekannteOrdnerIds.set(o.id, o[META].revision); });
    bereit = true;
    oberflaeche();
  }

  // Jede Bestätigung wird sofort gespeichert, bevor die nächste Anfrage
  // beginnt. Ein Fehler an Projekt B darf die neue Revision von A nicht verlieren.
  function bestaetigen(key, gesendet, cloud, snapshots) {
    const liste = lesen(key).map(p => {
      if (p.id !== gesendet.id) return p;
      return { ...p, [META]: { ...metaFuer(gesendet, cloud), dirty: fingerabdruck(p) !== fingerabdruck(gesendet) } };
    });
    schreiben(key, liste);
    snapshots.set(gesendet.id, fingerabdruck(gesendet));
    oberflaeche();
  }
  function konfliktKopie(p, aktuell) {
    if (!aktuell?.inhalt || aktuell.id !== p.id) return false;
    const neu = mitMeta(aktuell);
    const lokal = lokaleProjekte().find(x => x.id === p.id);
    if (!lokal || geloescht().has(p.id)) return true;
    if (fingerabdruck(lokal) === fingerabdruck(neu)) {
      bestaetigen(KEY, lokal, aktuell, snapshotsProjekt);
      return true;
    }
    const kopie = ohneMeta(lokal);
    kopie.id = 'z2d_' + (globalThis.crypto?.randomUUID?.() || Date.now() + '_' + Math.random().toString(36).slice(2));
    kopie.name = (String(kopie.name || 'Zeichnung').trim() || 'Zeichnung') + ' (lokale Konfliktkopie)';
    kopie[META] = { revision: null, dirty: true, eigenes: true, rolle: 'owner' };
    const liste = lokaleProjekte().map(x => x.id === p.id ? neu : x);
    liste.push(kopie);
    schreiben(KEY, liste);
    snapshotsProjekt.set(p.id, fingerabdruck(neu));
    oberflaeche();
    melden('Neuerer Cloud-Stand geladen. Deine Änderungen stehen in „' + kopie.name + '“.');
    return true;
  }

  async function sichern(laut) {
    if (!bereit) return false;
    status('Cloud wird gesichert …', 'laeuft');
    let ersterFehler = null;
    for (const p of lokaleProjekte()) {
      if (geloescht().has(p.id) || loeschend.has(p.id)) continue;
      if (p[META]?.uebernommen && !p[META]?.revision && p[META]?.eigenes === false) continue;
      if (!geaendert(p, snapshotsProjekt)) continue;
      try {
        const body = await anfrage('/api/cloud/projekte/' + encodeURIComponent(p.id) + '?app=' + APP, {
          method: 'PUT', body: JSON.stringify({ inhalt: ohneMeta(p), revision: p[META]?.revision })
        });
        bestaetigen(KEY, p, body.projekt, snapshotsProjekt);
      } catch (fehler) {
        if (fehler.status === 409 && konfliktKopie(p, fehler.aktuell)) continue;
        if (fehler.status === 410) {
          lokalEntfernen(lokaleProjekte().find(x => x.id === p.id) || p, true);
          melden('In der Cloud bereits gelöscht. Der lokale Stand liegt unter „Lokale Sicherungen“.');
          continue;
        }
        ersterFehler ||= fehler;
        if (!fehler.status || [401, 408, 500, 503].includes(fehler.status)) break;
      }
    }
    if (!ersterFehler) {
      for (const o of lokaleOrdner()) {
        if (!geaendert(o, snapshotsOrdner)) continue;
        try {
          const body = await anfrage('/api/cloud/ordner/' + encodeURIComponent(o.id) + '?app=' + APP, {
            method: 'PUT', body: JSON.stringify({ inhalt: ohneMeta(o), revision: o[META]?.revision })
          });
          bestaetigen(GK.ordner, o, body.ordner, snapshotsOrdner);
          bekannteOrdnerIds.set(o.id, body.ordner.revision);
        } catch (fehler) { ersterFehler ||= fehler; break; }
      }
    }
    // Bestehende Ordner-Verwaltung: ausdrücklich lokal entfernte Ordner
    // löschen. Projekte werden NIE aus dem bloßen Fehlen einer ID gelöscht.
    if (!ersterFehler) {
      const ids = new Set(lokaleOrdner().map(o => o.id));
      for (const [id, revision] of bekannteOrdnerIds) {
        if (ids.has(id)) continue;
        try {
          await anfrage('/api/cloud/ordner/' + encodeURIComponent(id) + '?app=' + APP + '&revision=' + revision, { method: 'DELETE' });
          bekannteOrdnerIds.delete(id); snapshotsOrdner.delete(id);
        } catch (fehler) { ersterFehler ||= fehler; }
      }
    }
    if (ersterFehler) {
      fehlerZeigen(ersterFehler, laut); erneut(ersterFehler);
      return false;
    }
    versuche = 0;
    const offen = lokaleProjekte().some(p => !loeschend.has(p.id) && geaendert(p, snapshotsProjekt) &&
      !(p[META]?.uebernommen && p[META]?.eigenes === false));
    status(offen ? 'Weitere Änderungen werden gesichert …' : 'Cloud gespeichert', offen ? 'laeuft' : 'ok');
    if (offen) {
      clearTimeout(timer);
      timer = setTimeout(() => void jetztSynchronisieren(false), 1100);
    } else if (laut) melden('Cloud-Daten sind aktuell');
    return true;
  }
  function jetztSynchronisieren(laut) {
    if (syncPromise) return syncPromise;
    syncPromise = serie(() => sichern(laut)).finally(() => { syncPromise = null; });
    return syncPromise;
  }
  function spaeterSichern(e) {
    if (unterdrueckt || e?.detail?.quelle === 'cloud') return;
    status('Änderungen warten auf Cloud-Sicherung …', 'laeuft');
    // Revisionen/Basis bleiben erhalten; der Inhalt entscheidet, ob Arbeit offen ist.
    const projekte = lokaleProjekte().filter(p => !geloescht().has(p.id));
    schreiben(KEY, projekte);
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void (bereit ? jetztSynchronisieren(false) : aktualisieren(false)); }, 1100);
  }
  async function aktualisieren(laut = true) {
    // Nur der bewusste Knopf schreibt eine noch offene Eingabe sofort.
    // Ein Netzwerk-Retry darf einen Speichern/Verwerfen-Dialog nicht umgehen.
    if (laut) editorSichern();
    return serie(async () => {
      status('Cloud wird geladen …', 'laeuft');
      try {
        // Noch offene Ordner-Löschungen vor dem Abruf abschließen.
        if (bereit) await sichern(false);
        const cloud = await anfrage('/api/cloud/arbeitsbereich?app=' + APP);
        arbeitsbereichEinspielen(cloud);
        return await sichern(laut);
      } catch (fehler) { fehlerZeigen(fehler, laut); erneut(fehler); return false; }
    });
  }

  async function loeschen(projekt) {
    if (!projekt?.id || loeschend.has(projekt.id)) return false;
    editorSichern();
    loeschend.add(projekt.id);
    status('Zeichnung wird gelöscht …', 'laeuft');
    oberflaeche();
    try {
      return await serie(async () => {
        const aktuell = lokaleProjekte().find(p => p.id === projekt.id);
        if (!aktuell || geloescht().has(projekt.id)) return true;
        if (['lesen', 'bearbeiten'].includes(aktuell[META]?.rolle)) {
          status('Keine Berechtigung zum Löschen', 'fehler');
          melden('Nur Eigentümer oder Administratoren dürfen löschen.');
          return false;
        }
        const revision = aktuell[META]?.revision;
        try {
          await anfrage('/api/cloud/projekte/' + encodeURIComponent(projekt.id) +
            '?app=' + APP + (revision ? '&revision=' + encodeURIComponent(revision) : ''), { method: 'DELETE' });
        } catch (fehler) {
          if (![404, 410].includes(fehler.status) || !fehler.api) {
            if (fehler.status === 409 && fehler.aktuell?.inhalt) {
              // Keine automatische Wiederholung gegen eine unbekannte neue
              // Revision: erst aktuellen Stand zeigen, erneut bestätigen lassen.
              if (geaendert(aktuell, snapshotsProjekt)) lokalSichern(aktuell, 'Löschkonflikt');
              const neu = mitMeta(fehler.aktuell);
              schreiben(KEY, lokaleProjekte().map(p => p.id === neu.id ? neu : p));
              snapshotsProjekt.set(neu.id, fingerabdruck(neu));
            }
            fehlerZeigen(fehler, true);
            return false;
          }
        }
        // Erst die bestätigte Löschung dauerhaft merken und lokal entfernen,
        // dann die Sperre freigeben. Kein PUT darf dazwischen stattfinden.
        lokalEntfernen(aktuell, false);
        status('Löschung bestätigt', 'ok');
        return true;
      });
    } finally { loeschend.delete(projekt.id); oberflaeche(); }
  }

  async function freigeben(projekt) {
    const p = lokaleProjekte().find(p => p.id === projekt?.id);
    if (!p?.[META]?.revision) { melden('Bitte zuerst in der Cloud sichern.'); return; }
    if (['lesen', 'bearbeiten'].includes(p[META]?.rolle)) { melden('Nur Eigentümer oder Administratoren dürfen freigeben.'); return; }
    const email = prompt('E-Mail-Adresse des Mitarbeiters:');
    if (email === null) return;
    const rolle = confirm('Darf der Mitarbeiter bearbeiten?\n\nOK = bearbeiten, Abbrechen = nur lesen') ? 'bearbeiten' : 'lesen';
    try {
      await anfrage('/api/cloud/projekte/' + encodeURIComponent(p.id) + '/freigaben', {
        method: 'PUT', body: JSON.stringify({ email, rolle })
      });
      melden('Freigegeben');
    } catch (fehler) { fehlerZeigen(fehler, true); }
  }
  function lokaleSicherungenExportieren() {
    const daten = lesen(RETTUNG);
    if (!daten.length) { melden('Keine lokalen Sicherungen vorhanden.'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'aufmassx-' + APP + '-lokale-sicherungen.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function start() {
    document.getElementById('cloudAktualisierenBtn')?.addEventListener('click', () => void aktualisieren());
    document.getElementById('cloudSicherungenBtn')?.addEventListener('click', lokaleSicherungenExportieren);
    document.addEventListener(GERUEST_DATEN_EVENT, spaeterSichern);
    window.addEventListener('online', () => { versuche = 0; void aktualisieren(false); });
    window.addEventListener('storage', e => {
      if ([KEY, GK.ordner, GELOESCHT].includes(e.key)) oberflaeche();
    });
    void aktualisieren(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return {
    aktualisieren, freigeben, loeschen, lokaleSicherungenExportieren,
    wirdGeloescht: id => loeschend.has(id),
    istGeloescht: id => geloescht().has(id),
    status: () => document.getElementById('cloudStatus')?.textContent || '',
    konto: () => konto,
    darf: recht => Array.isArray(konto?.rechte) && konto.rechte.includes(recht),
    istEigenes: p => !p?.[META]?.ownerUserId || !konto?.userId || p[META].ownerUserId === konto.userId,
    ersteller: p => p?.[META]?.erstelltVon || 'Mitarbeiter'
  };
})();
window.CloudSpeicher = CloudSpeicher;
