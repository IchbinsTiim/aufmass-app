'use strict';
(() => {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'bestandTitel');
  dialog.className = 'zeichnungs-bestand';
  dialog.style.cssText = 'width:min(680px,94vw);max-height:85vh;overflow:auto;border:1px solid #cad4df;border-radius:16px;padding:24px;color:#172b40;background:#fff';
  dialog.innerHTML = `<form method="dialog"><button style="float:right" aria-label="Schließen">✕</button></form>
    <h2 id="bestandTitel">Zeichnungen im Projekt</h2>
    <p>Öffnen legt eine bearbeitbare Kopie als neues Projekt an. Benannte Speicherstände bleiben unverändert. Die laufende Zeichnung wird weiterhin automatisch lokal gesichert.</p>
    <p id="bestandQuelle"></p><label>Zielprojekt <select id="bestandProjekt" style="width:100%;padding:10px;margin:8px 0"></select></label>
    <label>Name der Zeichnung <input id="bestandName" maxlength="120" style="width:100%;box-sizing:border-box;padding:10px;margin:8px 0" placeholder="z. B. Nordfassade – Stand 1"></label>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0"><button type="button" id="bestandSpeichern">Zeichnung speichern</button>
    <label>Zeichnung hochladen <input id="bestandDatei" type="file" accept=".json,application/json"></label></div>
    <p>Upload: AufmaßX-2D-Datei (.json), maximal 1,5 MB. PDF und Bilder werden hier nicht als Zeichnung importiert.</p>
    <p id="bestandStatus" role="status" aria-live="polite"></p>
    <h3>Gespeicherte Zeichnungen</h3><button type="button" id="bestandRefresh">Liste aktualisieren</button><div id="bestandListe"></div>`;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  document.body.append(dialog);
  const el = id => dialog.querySelector('#bestand' + id);
  let aktuell, busy = false, generation = 0, versuch = null;
  const meldung = text => { el('Status').textContent = text; };
  const endpoint = () => '/api/cloud/projekte/' + encodeURIComponent(el('Projekt').value) + '/zeichnungen';
  async function request(url, options) {
    const response = await fetch(url, { credentials:'same-origin', ...options });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Cloud nicht erreichbar. Lokal weiterarbeiten oder erneut versuchen.');
    return data;
  }
  function sperren(wert) {
    busy = wert;
    for (const node of dialog.querySelectorAll('button,input,select')) node.disabled = wert;
  }
  async function liste() {
    const token = ++generation;
    el('Liste').replaceChildren();
    if (!el('Projekt').value) { meldung('Bitte zuerst ein Projekt anlegen.'); return; }
    meldung('Gespeicherte Zeichnungen werden geladen …');
    try {
      const data = await request(endpoint());
      if (token !== generation) return;
      meldung(data.zeichnungen.length ? '' : 'Noch keine gespeicherten Zeichnungen in diesem Projekt.');
      for (const z of data.zeichnungen) {
        const row = document.createElement('article'); row.style.cssText='border-top:1px solid #ddd;padding:14px 0';
        const title = document.createElement('strong'); title.textContent=z.name;
        const meta = document.createElement('p'); meta.textContent = `${new Date(z.erstellt_am).toLocaleString('de-DE')} · ${el('Projekt').selectedOptions[0].textContent} · ${z.quelle === 'upload' ? 'Upload' : 'Speicherstand'}`;
        const open = document.createElement('button'); open.textContent='Als Kopie öffnen';
        open.addEventListener('click', async () => {
          if (busy) return;
          sperren(true);
          try {
            const data = await request(endpoint() + '?zeichnung=' + encodeURIComponent(z.id));
            window.ZeichnungsBestand.oeffnen(data.zeichnungen[0].inhalt, z.name);
            dialog.close(); showToast('Zeichnung als neues Projekt geöffnet – Original bleibt erhalten');
          } catch (error) { meldung(error.message); } finally { sperren(false); }
        });
        row.append(title,meta,open);el('Liste').append(row);
      }
    } catch (error) { if (token === generation) meldung(error.message); }
  }
  async function speichern(inhalt, quelle, dateiname) {
    if (busy) return;
    const name = el('Name').value.trim();
    if (!name || !el('Projekt').value) { meldung('Bitte Projekt und Zeichnungsnamen angeben.'); return; }
    sperren(true);
    try {
      const signatur = JSON.stringify({projekt:el('Projekt').value,name,inhalt,quelle,dateiname});
      if (!versuch || versuch.signatur !== signatur) versuch = {signatur,id:crypto.randomUUID()};
      await request(endpoint(), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:versuch.id,name,inhalt,quelle,dateiname}) });
      versuch = null;
      await liste(); meldung('In der Cloud gespeichert. Vorhandene Speicherstände bleiben erhalten.');
    } catch (error) { meldung(error.message + ' Die aktuelle Zeichnung bleibt erhalten.'); }
    finally { sperren(false); el('Datei').value=''; }
  }
  el('Speichern').addEventListener('click', () => speichern(aktuell.inhalt,'zeichnung'));
  el('Datei').addEventListener('change', async () => {
    const file = el('Datei').files[0]; if (!file) return;
    try {
      if (file.size > 1_500_000) throw new Error('Datei zu groß (maximal 1,5 MB).');
      const data = JSON.parse(await file.text());
      if (data.version != null && ![1,2,3].includes(data.version)) throw new Error('Diese Dateiversion wird nicht unterstützt.');
      const inhalt = data.state || data;
      // Alte Exporte enthalten Koordinaten noch nicht. Die bestehende Ladefunktion normalisiert sie nicht: daher klar ablehnen.
      if (!Array.isArray(inhalt.sections) || inhalt.sections.some(s => s.x0 == null || s.y0 == null)) throw new Error('Bitte die ältere Datei lokal laden und mit „Als Datei speichern“ erneut exportieren.');
      inhalt._sId = data._sId ?? inhalt._sId; inhalt._bId = data._bId ?? inhalt._bId;
      if (!el('Name').value.trim()) el('Name').value = file.name.replace(/\.json$/i,'').slice(0,120);
      await speichern(inhalt,'upload',file.name);
    } catch (error) { meldung(error instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : error.message); el('Datei').value=''; }
  });
  el('Projekt').addEventListener('change',liste); el('Refresh').addEventListener('click',liste);
  document.querySelectorAll('[data-zeichnungen]').forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    aktuell = window.ZeichnungsBestand.aktuell();
    const projects = JSON.parse(localStorage.getItem(GK.projekte) || '[]');
    el('Projekt').replaceChildren();
    projects.forEach(p => { const option = document.createElement('option');option.value=p.id;option.textContent=p.name || 'Unbenannt';el('Projekt').append(option); });
    if (aktuell.projektId) el('Projekt').value=aktuell.projektId;
    el('Quelle').textContent = 'Aktuelle Zeichnung: ' + (projects.find(p => p.id === aktuell.projektId)?.name || 'Freie Zeichnung');
    el('Name').value='';dialog.showModal();void liste();
  }));
})();
