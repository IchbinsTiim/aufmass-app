'use strict';

// ============================================================================
//  Cloud-Speicher
// ============================================================================
// Die Fachlogik bleibt in den beiden bestehenden Modulen. Dieser kleine
// Adapter beobachtet nur deren gemeinsamen lokalen Projektspeicher, sichert
// Änderungen in der Cloud und zieht sie auf einem zweiten Gerät wieder herein.
// So bleibt die App bei schlechtem Empfang sofort bedienbar; ein fehlender
// Funkkontakt bedeutet "später sichern", nicht "nicht arbeiten".

const CloudSpeicher = (() => {
  const STATUS_ID = 'hubCloudStatus';
  const META = '_cloud';
  let snapshotsProjekt = new Map();
  let snapshotsOrdner = new Map();
  let bekannteProjektIds = new Map();
  let bekannteOrdnerIds = new Map();
  let timer = null;
  let laeuft = false;
  let bereit = false;
  let unterdrueckt = false;

  const lesen = (schluessel, fallback) => {
    try {
      const wert = JSON.parse(localStorage.getItem(schluessel) || 'null');
      return Array.isArray(wert) ? wert : fallback;
    } catch (_) { return fallback; }
  };

  const schreiben = (schluessel, wert) => localStorage.setItem(schluessel, JSON.stringify(wert));

  function ohneMeta(eintrag) {
    const kopie = JSON.parse(JSON.stringify(eintrag));
    delete kopie[META];
    return kopie;
  }

  function fingerabdruck(eintrag) {
    return JSON.stringify(ohneMeta(eintrag));
  }

  function mitMeta(inhalt, cloud) {
    const lokal = { ...inhalt };
    lokal[META] = {
      revision: cloud.revision,
      ownerUserId: cloud.ownerUserId || null,
      rolle: cloud.rolle || 'owner',
      dirty: false
    };
    return lokal;
  }

  function status(text, art) {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = text;
    el.dataset.status = art || '';
  }

  async function anfrage(url, opt) {
    const res = await fetch(url, {
      ...opt,
      headers: { 'Content-Type': 'application/json', ...(opt && opt.headers) },
      credentials: 'same-origin'
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const fehler = new Error(body?.error || 'Cloud-Speicher nicht erreichbar.');
      fehler.status = res.status;
      fehler.aktuell = body?.aktuell || null;
      throw fehler;
    }
    return body;
  }

  function lokaleProjekte() { return lesen(GK.projekte, []); }
  function lokaleOrdner() { return lesen(GK.ordner, []); }

  function aktualisiereOberflaeche() {
    if (typeof AufmassModul !== 'undefined') AufmassModul.frischeDatenLaden?.();
    if (typeof Shell !== 'undefined') Shell.aktualisiereHub?.();
    document.dispatchEvent(new CustomEvent(GERUEST_DATEN_EVENT, { detail: { quelle: 'cloud' } }));
  }

  function cloudStandMerken(projekte, ordner) {
    snapshotsProjekt = new Map(projekte.map(p => [p.id, fingerabdruck(p)]));
    snapshotsOrdner = new Map(ordner.map(o => [o.id, fingerabdruck(o)]));
    bekannteProjektIds = new Map(projekte
      .filter(p => p[META]?.revision)
      .map(p => [p.id, p[META].revision]));
    bekannteOrdnerIds = new Map(ordner
      .filter(o => o[META]?.revision)
      .map(o => [o.id, o[META].revision]));
  }

  function lokaleAenderungenMarkieren() {
    const projekte = lokaleProjekte();
    const ordner = lokaleOrdner();
    let geaendert = false;
    projekte.forEach(projekt => {
      const meta = projekt[META] || (projekt[META] = { revision: null, rolle: 'owner', dirty: true });
      if (!meta.revision || snapshotsProjekt.get(projekt.id) !== fingerabdruck(projekt)) {
        meta.dirty = true;
        geaendert = true;
      }
    });
    ordner.forEach(ordnerEintrag => {
      const meta = ordnerEintrag[META] || (ordnerEintrag[META] = { revision: null, dirty: true });
      if (!meta.revision || snapshotsOrdner.get(ordnerEintrag.id) !== fingerabdruck(ordnerEintrag)) {
        meta.dirty = true;
        geaendert = true;
      }
    });
    if (geaendert) {
      unterdrueckt = true;
      schreiben(GK.projekte, projekte);
      schreiben(GK.ordner, ordner);
      unterdrueckt = false;
    }
  }

  function arbeitsbereichEinspielen(cloud) {
    const lokalProjekte = lokaleProjekte();
    const lokalOrdner = lokaleOrdner();
    const remoteProjekte = new Map((cloud.projects || []).map(p => [p.id, p]));
    const remoteOrdner = new Map((cloud.folders || []).map(o => [o.id, o]));

    // Neuere Cloud-Daten kommen herein. Nur lokal noch nicht gesicherte
    // Änderungen behalten Vorrang; sie werden im Anschluss versucht zu senden.
    const zusammenProjekte = lokalProjekte.map(lokal => {
      const remote = remoteProjekte.get(lokal.id);
      if (!remote) return lokal;
      remoteProjekte.delete(lokal.id);
      const lokalRevision = lokal[META]?.revision;
      const lokalGeaendert = snapshotsProjekt.has(lokal.id) &&
        snapshotsProjekt.get(lokal.id) !== fingerabdruck(lokal);
      return lokal[META]?.dirty || lokalGeaendert || (lokalRevision && lokalRevision === remote.revision)
        ? lokal : mitMeta(remote.inhalt, remote);
    });
    remoteProjekte.forEach(remote => zusammenProjekte.push(mitMeta(remote.inhalt, remote)));

    const zusammenOrdner = lokalOrdner.map(lokal => {
      const remote = remoteOrdner.get(lokal.id);
      if (!remote) return lokal;
      remoteOrdner.delete(lokal.id);
      const lokalRevision = lokal[META]?.revision;
      const lokalGeaendert = snapshotsOrdner.has(lokal.id) &&
        snapshotsOrdner.get(lokal.id) !== fingerabdruck(lokal);
      return lokal[META]?.dirty || lokalGeaendert || (lokalRevision && lokalRevision === remote.revision)
        ? lokal : mitMeta(remote.inhalt, remote);
    });
    remoteOrdner.forEach(remote => zusammenOrdner.push(mitMeta(remote.inhalt, remote)));

    unterdrueckt = true;
    schreiben(GK.projekte, zusammenProjekte);
    schreiben(GK.ordner, zusammenOrdner);
    unterdrueckt = false;
    // Lokale Altprojekte haben noch keine Cloud-Fassung und werden nach dem
    // ersten Laden hochgeladen, statt still nur auf diesem Gerät zu bleiben.
    zusammenProjekte.forEach(p => {
      if (!p[META]) p[META] = { revision: null, rolle: 'owner', dirty: true };
    });
    zusammenOrdner.forEach(o => {
      if (!o[META]) o[META] = { revision: null, dirty: true };
    });
    cloudStandMerken(zusammenProjekte, zusammenOrdner);
    aktualisiereOberflaeche();
  }

  function konflikt(text) {
    status('Konflikt – Cloud-Stand zuerst laden', 'fehler');
    if (typeof showToast === 'function') showToast(text + ' Cloud aktualisieren, bevor Sie weiterschreiben.');
  }

  async function projektSichern(projekt) {
    const revision = projekt[META]?.revision;
    const body = await anfrage('/api/cloud/projekte/' + encodeURIComponent(projekt.id), {
      method: 'PUT', body: JSON.stringify({ inhalt: ohneMeta(projekt), revision })
    });
    const cloud = body.projekt;
    projekt[META] = { revision: cloud.revision, ownerUserId: cloud.ownerUserId, rolle: cloud.rolle };
    snapshotsProjekt.set(projekt.id, fingerabdruck(projekt));
    bekannteProjektIds.set(projekt.id, cloud.revision);
  }

  async function ordnerSichern(ordner) {
    const revision = ordner[META]?.revision;
    const body = await anfrage('/api/cloud/ordner/' + encodeURIComponent(ordner.id), {
      method: 'PUT', body: JSON.stringify({ inhalt: ohneMeta(ordner), revision })
    });
    const cloud = body.ordner;
    ordner[META] = { revision: cloud.revision, dirty: false };
    snapshotsOrdner.set(ordner.id, fingerabdruck(ordner));
    bekannteOrdnerIds.set(ordner.id, cloud.revision);
  }

  async function jetztSynchronisieren(laut) {
    if (laeuft || !bereit) return;
    laeuft = true;
    status('Cloud wird gesichert …', 'laeuft');
    try {
      const projekte = lokaleProjekte();
      const ordner = lokaleOrdner();
      for (const projekt of projekte) {
        if (projekt[META]?.dirty || !projekt[META]?.revision || snapshotsProjekt.get(projekt.id) !== fingerabdruck(projekt)) await projektSichern(projekt);
      }
      for (const ordnerEintrag of ordner) {
        if (ordnerEintrag[META]?.dirty || !ordnerEintrag[META]?.revision || snapshotsOrdner.get(ordnerEintrag.id) !== fingerabdruck(ordnerEintrag)) await ordnerSichern(ordnerEintrag);
      }

      const ids = new Set(projekte.map(p => p.id));
      for (const [id, revision] of bekannteProjektIds) {
        if (!ids.has(id)) {
          await anfrage('/api/cloud/projekte/' + encodeURIComponent(id) + '?revision=' + encodeURIComponent(revision), { method: 'DELETE' });
          bekannteProjektIds.delete(id); snapshotsProjekt.delete(id);
        }
      }
      const ordnerIds = new Set(ordner.map(o => o.id));
      for (const [id, revision] of bekannteOrdnerIds) {
        if (!ordnerIds.has(id)) {
          await anfrage('/api/cloud/ordner/' + encodeURIComponent(id) + '?revision=' + encodeURIComponent(revision), { method: 'DELETE' });
          bekannteOrdnerIds.delete(id); snapshotsOrdner.delete(id);
        }
      }
      // Während HTTP-Anfragen weitergezeichnete Daten niemals mit dem alten
      // Sendestand ersetzen. Nur die bestätigte Revision übernehmen.
      const abgleichen = (aktuell, gesendet) => aktuell.map(eintrag => {
        const alt = gesendet.find(p => p.id === eintrag.id);
        if (!alt) return eintrag;
        return { ...eintrag, [META]: { ...alt[META], dirty: fingerabdruck(eintrag) !== fingerabdruck(alt) } };
      });
      schreiben(GK.projekte, abgleichen(lokaleProjekte(), projekte));
      schreiben(GK.ordner, abgleichen(lokaleOrdner(), ordner));
      status('Cloud gespeichert', 'ok');
      if (laut && typeof showToast === 'function') showToast('Cloud-Projekte sind aktuell');
    } catch (fehler) {
      if (fehler.status === 409) konflikt('Dieses Projekt wurde auf einem anderen Gerät geändert.');
      else {
        status(navigator.onLine ? 'Cloud gerade nicht erreichbar' : 'Offline – Änderungen bleiben auf diesem Gerät', 'fehler');
        if (laut && typeof showToast === 'function') showToast(fehler.message || 'Cloud-Speicher nicht erreichbar');
      }
    } finally {
      laeuft = false;
      if (document.getElementById(STATUS_ID)?.dataset.status === 'ok' && lokaleProjekte().some(p => p[META]?.dirty && snapshotsProjekt.get(p.id) !== fingerabdruck(p))) {
        clearTimeout(timer);
        timer = setTimeout(() => void jetztSynchronisieren(false), 3000);
      }
    }
  }

  function spaeterSichern() {
    if (unterdrueckt || !bereit) return;
    lokaleAenderungenMarkieren();
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void jetztSynchronisieren(false); }, 1100);
  }

  async function aktualisieren() {
    status('Cloud wird geladen …', 'laeuft');
    try {
      const cloud = await anfrage('/api/cloud/arbeitsbereich');
      arbeitsbereichEinspielen(cloud);
      bereit = true;
      status('Cloud aktuell', 'ok');
      await jetztSynchronisieren(true);
    } catch (fehler) {
      bereit = true; // lokale Arbeit bleibt möglich und wird beim nächsten Online-Moment gesichert
      status(navigator.onLine ? 'Cloud noch nicht eingerichtet' : 'Offline – nur auf diesem Gerät', 'fehler');
      if (typeof showToast === 'function') showToast(fehler.message || 'Cloud-Speicher nicht erreichbar');
    }
  }

  async function freigeben(projekt) {
    const meta = projekt?.[META];
    if (!projekt || !meta?.revision) {
      if (typeof showToast === 'function') showToast('Bitte das Projekt zuerst in der Cloud sichern.');
      return;
    }
    if (meta.rolle === 'lesen' || meta.rolle === 'bearbeiten') {
      if (typeof showToast === 'function') showToast('Nur Eigentümer oder Administratoren dürfen freigeben.');
      return;
    }
    const email = prompt('E-Mail-Adresse des Mitarbeiters, der dieses Projekt sehen soll:');
    if (email === null) return;
    const rolle = confirm('Darf der Mitarbeiter das Projekt bearbeiten?\n\nOK = bearbeiten, Abbrechen = nur lesen')
      ? 'bearbeiten' : 'lesen';
    try {
      await anfrage('/api/cloud/projekte/' + encodeURIComponent(projekt.id) + '/freigaben', {
        method: 'PUT', body: JSON.stringify({ email, rolle })
      });
      if (typeof showToast === 'function') showToast('Projekt freigegeben');
    } catch (fehler) {
      if (typeof showToast === 'function') showToast(fehler.message || 'Freigabe nicht möglich');
    }
  }

  function start() {
    const btn = document.getElementById('hubCloudBtn');
    btn?.addEventListener('click', () => void aktualisieren());
    document.addEventListener(GERUEST_DATEN_EVENT, spaeterSichern);
    window.addEventListener('online', () => void aktualisieren());
    void aktualisieren();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { aktualisieren, freigeben, status: () => document.getElementById(STATUS_ID)?.textContent || '' };
})();

// Andere Bestands-Skripte greifen bewusst über `window` darauf zu.
window.CloudSpeicher = CloudSpeicher;
