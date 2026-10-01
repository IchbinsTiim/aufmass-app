// Cloud-Abgleich: Änderungen, die WÄHREND einer laufenden Übertragung
// entstehen, dürfen nicht vom alten Sendestand überschrieben werden.
//
// Seit der Trennung der Anwendungen hat jede ihren eigenen Adapter mit
// eigenem Speicher und eigenem Namensraum in der Cloud – geprüft werden
// beide: aufmass/cloud.js (app=aufmass) und aufmass-2d/cloud.js (app=2d).
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

async function pruefe(datei, gk, app) {
  const schluessel = Object.values(gk)[0];
  const values = new Map([[schluessel, JSON.stringify([{ id: 'p', name: 'Original' }])], [gk.ordner, '[]']]);
  const status = { textContent: '', dataset: {} };
  const urls = [];
  let finish, sending;
  const started = new Promise(r => sending = r);
  const context = {
    AbortController, console,
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
    GK: gk, GERUEST_DATEN_EVENT: 'data',
    navigator: { onLine: true }, CustomEvent: class {},
    document: { readyState: 'complete', getElementById: id => id === 'cloudStatus' ? status : null,
                addEventListener() {}, dispatchEvent() {} },
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url) => {
      urls.push(url);
      if (url.includes('/arbeitsbereich')) return { ok: true, status: 200, json: async () => ({ projects: [], folders: [] }) };
      sending(); await new Promise(r => finish = r);
      return { ok: true, status: 200, json: async () => ({ projekt: { revision: 1, ownerUserId: 'owner', rolle: 'owner' } }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../' + datei, import.meta.url), 'utf8'), context);
  await started;
  values.set(schluessel, JSON.stringify([{ id: 'p', name: 'Weitergezeichnet' }]));
  finish();
  await new Promise(r => setImmediate(r));
  const result = JSON.parse(values.get(schluessel))[0];
  assert.equal(result.name, 'Weitergezeichnet');
  assert.equal(result._cloud.revision, 1);
  assert.equal(result._cloud.dirty, true);
  assert.ok(urls.length >= 2 && urls.every(u => u.includes('app=' + app)),
    `${datei} spricht ausschließlich den Namensraum app=${app} an: ${urls.join(', ')}`);
  console.log(`  ✓ ${datei}: Änderungen während laufender Übertragung bleiben erhalten (app=${app})`);
}

await pruefe('aufmass/cloud.js', { projekte: 'geruest.aufmass.projekte', ordner: 'geruest.aufmass.ordner' }, 'aufmass');
await pruefe('aufmass-2d/cloud.js', { zeichnungen: 'geruest.2d.zeichnungen', ordner: 'geruest.2d.ordner' }, '2d');
console.log('Cloud-Abgleich behält Änderungen während laufender Übertragung.');
