import { chromium } from 'playwright';
import { serve } from './harness.mjs';
import assert from 'node:assert/strict';
const { server, port } = await serve();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
try {
  for (const cfg of [
    { app: 'aufmass', path: 'aufmass', key: 'geruest.aufmass.projekte', card: '.project-card2', check: '.project-select', bar: '#projectBulkBar', move: '#projectBulkMove', clear: '#projectBulkClear', del: '#projectBulkDelete' },
    { app: '2d', path: 'aufmass-2d#/projekte', key: 'geruest.2d.zeichnungen', card: '.td-project-card', check: '.td-project-haken', bar: '#tdBulkBar', move: '#tdBulkVerschieben', clear: '#tdBulkAufheben', del: '#tdBulkLoeschen' }
  ]) {
    const selected = cfg.card + (cfg.app === '2d' ? '.gewaehlt' : '.selected');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const remote = new Map(['a', 'b', 'c'].map((id, i) => [id, {
      id, revision: 1, ownerUserId: 'owner', rolle: 'owner', eigenes: true,
      inhalt: { id, name: ['Baustelle Nord', 'Hofstraße', 'Altbau West'][i], status: 'aktiv',
        erstellt: '2026-10-01', geaendert: '2026-10-01', anschrift: {}, seiten: [],
        ...(cfg.app === '2d' ? { zeichnung2d: { depth: 0.73, sections: [], abschnitte: [] } } : {}) }
    }]));
    let release, deleteStarted;
    const started = new Promise(r => deleteStarted = r);
    const gate = new Promise(r => release = r);
    const deleted = [];
    await page.route('**/api/cloud/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const id = url.pathname.split('/').pop();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.searchParams.get('app') !== cfg.app) return json(400, { error: 'falsche App' });
      if (id === 'arbeitsbereich') return json(200, {
        vollstaendig: true, konto: { userId: 'owner' }, projects: [...remote.values()],
        folders: [{ id: 'f1', revision: 1, inhalt: { id: 'f1', name: '2026' } }]
      });
      if (req.method() === 'PUT') {
        const body = req.postDataJSON(), old = remote.get(id);
        assert.equal(body.revision, old.revision);
        const neu = { ...old, revision: old.revision + 1, inhalt: body.inhalt };
        remote.set(id, neu); return json(200, { projekt: neu });
      }
      if (req.method() === 'DELETE') {
        deleted.push(id);
        if (deleted.length === 1) { deleteStarted(); await gate; remote.delete(id); return route.fulfill({ status: 204 }); }
        return json(403, { error: 'Löschen verweigert (Test)' });
      }
      return json(404, { error: 'Test' });
    });
    await page.goto('http://127.0.0.1:' + port + '/app/' + cfg.path);
    await page.locator(cfg.card).nth(2).waitFor();
    assert.equal(await page.locator(cfg.bar).isVisible(), false);
    await page.locator(cfg.check).nth(0).click();
    await page.locator(cfg.card).nth(2).click({ modifiers: ['Shift'] });
    assert.equal(await page.locator(selected).count(), 3, 'Umschalt-Bereich markiert drei Karten');
    assert.equal(await page.locator(cfg.bar).isVisible(), true);
    await page.locator(cfg.move).click();
    await page.locator('#floatingMenu .floating-menu-item', { hasText: '2026' }).click();
    assert.ok((await page.evaluate(k => JSON.parse(localStorage.getItem(k)), cfg.key)).every(p => p.folderId === 'f1'));
    await page.waitForFunction(() => document.getElementById('cloudStatus').dataset.status === 'ok');
    assert.ok([...remote.values()].every(p => p.inhalt.folderId === 'f1'), 'gemeinsames Verschieben in Cloud bestätigt');
    await page.locator(cfg.clear).click();
    await page.locator(cfg.card).nth(0).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await page.locator(cfg.check).nth(1).click();
    assert.equal(await page.locator(selected).count(), 2);
    await page.screenshot({ path: '/tmp/aufmass-' + cfg.app + '-auswahl-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 768, height: 1024 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'kein horizontaler Überlauf auf iPad');
    await page.screenshot({ path: '/tmp/aufmass-' + cfg.app + '-auswahl-ipad.png', fullPage: true });
    if (cfg.app === 'aufmass') page.once('dialog', d => d.accept());
    await page.locator(cfg.del).click();
    if (cfg.app === '2d') await page.locator('#tdLoeschBestaetigen').click();
    await started;
    assert.equal(await page.locator(cfg.card).count(), 3, 'keine Karte vor Serverbestätigung verschwunden');
    assert.equal(await page.locator(cfg.card + '[aria-busy="true"]').count(), 1);
    assert.equal(await page.locator(cfg.del).isDisabled(), true);
    release();
    await page.waitForFunction(({ card }) => document.querySelectorAll(card).length === 2, cfg);
    await page.waitForFunction(del => !document.querySelector(del).disabled, cfg.del);
    assert.match(await page.locator('#cloudStatus').textContent(), /Berechtigung/);
    assert.equal(await page.locator(selected).count(), 1, 'fehlgeschlagenes Projekt bleibt ausgewählt');
    assert.equal(remote.size, 2);
    await page.reload();
    await page.locator(cfg.card).nth(1).waitFor();
    assert.equal(await page.locator(cfg.card).count(), 2, 'bestätigt gelöschtes Projekt kommt nach Reload nicht wieder');
    const offenId = await page.locator(cfg.card).first().getAttribute('data-id');
    await page.locator(cfg.card).first().click();
    await page.evaluate(() => window.CloudSpeicher.aktualisieren(false));
    const alt = remote.get(offenId);
    remote.set(offenId, { ...alt, revision: alt.revision + 1,
      inhalt: { ...alt.inhalt, name: 'Vom anderen Gerät',
        ...(cfg.app === '2d' ? { zeichnung2d: { ...alt.inhalt.zeichnung2d, depth: 1.09 } } : {}) } });
    await page.evaluate(() => window.CloudSpeicher.aktualisieren(false));
    if (cfg.app === '2d') {
      assert.equal(await page.evaluate(() => state.depth), 1.09, 'geöffnete Zeichnung lädt neue Cloud-Maße');
      assert.equal(await page.evaluate(() => state.project), 'Vom anderen Gerät');
    } else {
      assert.equal(await page.locator('#projectScreenTitle').textContent(), 'Vom anderen Gerät', 'geöffnetes Formular lädt Cloud-Stand');
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('✓ ' + cfg.app + ': Checkbox/Strg/Umschalt, Stapel-Verschieben, Teilfehler-Löschung, Bestätigung und Reload, iPad');
    await page.close();
  }
} finally { await browser.close(); server.close(); }
