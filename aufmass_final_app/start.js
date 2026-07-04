'use strict';

// ============================================================
//  Hub-Auswahl: Aufmaß vs. 2D-Aufmaß
// ============================================================
// Ergänzt script.js (unverändert mitgenutzt für Projektübersicht, Ordner,
// Suche/Filter/Sortierung sowie die Projekt-Datenverwaltung) um einen kleinen
// Auswahl-Dialog. script.js ruft beim Öffnen eines Projekts `requestOpenProject`
// auf, die wiederum `window.onProjectOpenRequest` nutzt, falls vorhanden –
// genau das setzen wir hier. Auf index.html existiert dieser Hook nicht,
// dort bleibt also alles beim Alten.

(function () {
  const overlay    = document.getElementById('appChooserOverlay');
  const nameEl      = document.getElementById('appChooserProjectName');
  const aufmassBtn  = document.getElementById('chooseAufmassBtn');
  const zweiDBtn    = document.getElementById('choose2dBtn');
  const cancelBtn   = document.getElementById('appChooserCancelBtn');
  if (!overlay || !aufmassBtn || !zweiDBtn || !cancelBtn) return;

  let pendingProject = null;

  function openChooser(proj) {
    pendingProject = proj;
    nameEl.textContent = getProjectName(proj);
    overlay.classList.remove('hidden');
    // Sorgt dafür, dass z. B. ein gerade neu angelegtes Projekt schon als
    // Karte sichtbar ist, falls der Dialog abgebrochen wird.
    renderProjectOverview();
  }

  function closeChooser() {
    overlay.classList.add('hidden');
    pendingProject = null;
  }

  window.onProjectOpenRequest = openChooser;

  aufmassBtn.addEventListener('click', () => {
    if (!pendingProject) return;
    localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, pendingProject.id);
    window.location.href = 'index.html?resume=1';
  });

  zweiDBtn.addEventListener('click', () => {
    if (!pendingProject) return;
    localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, pendingProject.id);
    window.location.href = 'viewer2d.html';
  });

  cancelBtn.addEventListener('click', closeChooser);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeChooser(); });
})();
