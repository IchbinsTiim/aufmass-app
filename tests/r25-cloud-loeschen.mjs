// Beide produktiven Adapter: verspätete Antworten, Teilfehler, Reload und Konflikte.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const tick = () => new Promise(r => setImmediate(r));
const antwort = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

for (const [app, datei, gk] of [
  ['aufmass', 'aufmass/cloud.js', { projekte: 'test.aufmass', ordner: 'test.aufmass.ordner' }],
  ['2d', 'aufmass-2d/cloud.js', { zeichnungen: 'test.2d', ordner: 'test.2d.ordner' }]
]) {
  const key = gk.projekte || gk.zeichnungen;
  const quelltext = fs.readFileSync(new URL('../' + datei, import.meta.url), 'utf8');
  function browser(projekte, fetch, values = new Map()) {
    if (projekte) values.set(key, JSON.stringify(projekte));
    const events = new Map();
    const status = { textContent: '', dataset: {} };
    const ctx = {
      AbortController, console: { warn() {} }, GK: gk, GERUEST_DATEN_EVENT: 'data',
      localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
      document: { readyState: 'loading', getElementById: id => id === 'cloudStatus' ? status : null,
        addEventListener: (t, cb) => events.set(t, cb), dispatchEvent() {} },
      window: { addEventListener() {} }, navigator: { onLine: true },
      CustomEvent: class {}, setTimeout: () => 1, clearTimeout() {}, fetch
    };
    vm.runInNewContext(quelltext, ctx);
    return { cloud: ctx.window.CloudSpeicher, values, status,
      projekte: () => JSON.parse(values.get(key) || '[]'),
      setzen: list => values.set(key, JSON.stringify(list)),
      start: () => events.get('DOMContentLoaded')() };
  }
  const leer = () => antwort(200, { projects: [], folders: [], vollstaendig: true });
  const remote = (p, revision = 1) => ({ id: p.id, inhalt: p, revision, rolle: 'owner' });

  // A wird bestätigt, B schlägt fehl: A darf seine Revision nicht verlieren.
  let bFehler = true;
  const calls = [];
  const gespeichert = new Map();
  const teil = browser([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], async (url, opt = {}) => {
    if (url.includes('arbeitsbereich')) return antwort(200, { projects: [...gespeichert.values()], folders: [], vollstaendig: true });
    const { inhalt, revision } = JSON.parse(opt.body);
    calls.push({ id: inhalt.id, revision });
    if (inhalt.id === 'b' && bFehler) return antwort(503, { error: 'Testausfall' });
    const projekt = remote(inhalt, (revision || 0) + 1);
    gespeichert.set(inhalt.id, projekt);
    return antwort(200, { projekt });
  });
  await teil.cloud.aktualisieren(false);
  assert.equal(teil.projekte()[0]._cloud.revision, 1);
  assert.equal(teil.projekte()[1]._cloud, undefined);
  bFehler = false;
  // Kein erneutes GET hier: vollständige echte Serverliste simulieren.
  teil.start(); await tick();
  assert.equal(calls.filter(x => x.id === 'a').length, 1, 'Bestätigung A bleibt trotz Fehler B erhalten');
  assert.equal(teil.projekte().length, 2);
  assert.ok(teil.projekte().every(p => p._cloud.revision === 1));

  // Löschen wartet auf einen schon laufenden ersten Upload und nutzt DESSEN Revision.
  const put = defer(), del = defer(), started = defer();
  const reihenfolge = [];
  const langsam = browser([{ id: 'x', name: 'X' }], async (url, opt = {}) => {
    if (url.includes('arbeitsbereich')) return leer();
    reihenfolge.push(opt.method);
    if (opt.method === 'PUT') { started.resolve(); await put.promise; return antwort(200, { projekt: remote({ id: 'x', name: 'X' }, 7) }); }
    assert.match(url, /revision=7/);
    await del.promise;
    return antwort(204);
  });
  const sync = langsam.cloud.aktualisieren(false);
  await started.promise;
  const loeschung = langsam.cloud.loeschen({ id: 'x' });
  await tick();
  assert.deepEqual(reihenfolge, ['PUT']);
  assert.equal(langsam.projekte().length, 1);
  assert.equal(langsam.cloud.wirdGeloescht('x'), true);
  put.resolve(); await sync; await tick();
  assert.deepEqual(reihenfolge, ['PUT', 'DELETE']);
  assert.equal(langsam.projekte().length, 1, 'vor Cloud-Bestätigung bleibt die Karte bestehen');
  del.resolve();
  assert.equal(await loeschung, true);
  assert.equal(langsam.projekte().length, 0);
  assert.equal(langsam.cloud.istGeloescht('x'), true);

  // Alter lokaler Stand nach Reload darf die bestätigte Löschung nicht reaktivieren.
  const alt = { id: 'x', name: 'Alter Tab', _cloud: { revision: 7, dirty: true } };
  const reloadCalls = [];
  const reload = browser([alt], async (url, opt) => { reloadCalls.push(opt?.method || 'GET'); return leer(); }, langsam.values);
  await reload.cloud.aktualisieren(false);
  assert.equal(reload.projekte().length, 0);
  assert.deepEqual(reloadCalls, ['GET']);

  // Echte Fehler/Authentifizierungsfehler/Timeout lassen Projekt und Löschstatus korrekt stehen.
  for (const code of [401, 403, 503, 'timeout']) {
    const p = { id: 'f', name: 'Nicht gelöscht', _cloud: { revision: 3 } };
    const fehl = browser([p], async () => {
      if (code === 'timeout') { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
      return antwort(code, { error: 'Testfehler' });
    });
    assert.equal(await fehl.cloud.loeschen(p), false);
    assert.equal(fehl.projekte().length, 1);
    assert.equal(fehl.cloud.istGeloescht('f'), false);
    assert.equal(fehl.cloud.wirdGeloescht('f'), false);
    assert.equal(fehl.status.dataset.status, 'fehler');
    if (code === 401) assert.match(fehl.status.textContent, /anmelden/);
    if (code === 'timeout') assert.match(fehl.status.textContent, /langsam/);
  }

  // Revisionskonflikt beim Löschen: neuen Stand zeigen, nicht heimlich erneut löschen.
  const html404 = browser([{ id: 'html', _cloud: { revision: 1 } }], async () => antwort(404, null));
  assert.equal(await html404.cloud.loeschen({ id: 'html' }), false, 'HTML-404 ist keine bestätigte Projektlöschung');
  assert.equal(html404.projekte().length, 1);
  let deletes = 0;
  const konflikt = browser([{ id: 'k', name: 'Lokal', _cloud: { revision: 1, dirty: true } }], async () => {
    deletes++; return antwort(409, { error: 'Neuerer Stand', aktuell: remote({ id: 'k', name: 'Vom Kollegen' }, 2) });
  });
  assert.equal(await konflikt.cloud.loeschen({ id: 'k' }), false);
  assert.equal(deletes, 1);
  assert.equal(konflikt.projekte()[0].name, 'Vom Kollegen');
  assert.equal(JSON.parse(konflikt.values.get(key + '.lokaleSicherungen'))[0].projekt.name, 'Lokal');

  // Entferntes Projekt auf anderem Gerät: aus Liste entfernen, Änderungen vorher sichern.
  const verschwunden = browser([{ id: 'weg', name: 'Lokale Änderung', _cloud: { revision: 3, dirty: true } }], async () => leer());
  await verschwunden.cloud.aktualisieren(false);
  assert.equal(verschwunden.projekte().length, 0);
  assert.equal(JSON.parse(verschwunden.values.get(key + '.lokaleSicherungen')).length, 1);

  // jsonb-Reihenfolge allein darf keinen PUT erzeugen.
  let puts = 0;
  const gleich = browser([{ id: 's', name: 'Gleich', daten: { b: 2, a: 1 }, _cloud: { revision: 1, dirty: true } }], async (url) => {
    if (!url.includes('arbeitsbereich')) { puts++; throw new Error('Unnötiger Upload'); }
    return antwort(200, { vollstaendig: true, folders: [], projects: [remote({ daten: { a: 1, b: 2 }, name: 'Gleich', id: 's' }, 5)] });
  });
  await gleich.cloud.aktualisieren(false);
  assert.equal(puts, 0);
  assert.equal(gleich.projekte()[0]._cloud.revision, 5);
  console.log('✓ ' + app + ': bestätigte Löschung, Upload-Rennen, Reload, Teilfehler, 401/403/503, Timeout, Konflikt und jsonb');
}
