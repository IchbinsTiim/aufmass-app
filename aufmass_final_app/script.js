/*
 * Script für die Fassaden‑Aufmaß‑App.
 * Erstellt dynamisch Wände und Öffnungen, berechnet die Flächen und stellt
 * eine Zusammenfassung bereit. Die Logik basiert auf dem DOM und liest die
 * aktuellen Werte direkt aus den Formularfeldern aus.
 */

// Hilfsfunktion, um eine neue Wand anzulegen
function createWall(index) {
  const wallDiv = document.createElement('div');
  wallDiv.className = 'wall';

  // Kopfbereich mit fortlaufender Nummer und Entfernen‑Button
  const header = document.createElement('div');
  header.className = 'wall-header';
  const title = document.createElement('h3');
  title.textContent = `Wand ${index}`;
  header.appendChild(title);
  const removeWallBtn = document.createElement('button');
  removeWallBtn.className = 'remove-btn';
  removeWallBtn.type = 'button';
  removeWallBtn.textContent = 'Entfernen';
  removeWallBtn.addEventListener('click', () => {
    wallDiv.remove();
    renumberWalls();
    updateSummary();
  });
  header.appendChild(removeWallBtn);

  // Container für die Eingaben
  const body = document.createElement('div');
  body.className = 'wall-body';

  // Auswahl der Hausseite mit einer manuellen Eingabeoption
  const sideWrapper = document.createElement('div');
  const sideLabel = document.createElement('label');
  sideLabel.textContent = 'Seite:';
  const sideSelect = document.createElement('select');
  sideSelect.className = 'wall-side';
  [
    { value: '', text: 'Bitte wählen' },
    { value: 'Straßenseite', text: 'Straßenseite' },
    { value: 'Linke Seite', text: 'Linke Seite' },
    { value: 'Rechte Seite', text: 'Rechte Seite' },
    { value: 'Rückseite', text: 'Rückseite' },
    // fünfte Option für eine manuelle Eingabe. Die Bezeichnung "Andere (manuell)"
    // lässt direkt erkennen, dass eine eigene Eingabe möglich ist.
    { value: '__manual__', text: 'Andere (manuell)' }
  ].forEach(optData => {
    const opt = document.createElement('option');
    opt.value = optData.value;
    opt.textContent = optData.text;
    sideSelect.appendChild(opt);
  });
  // Eingabefeld für manuelle Bezeichnung der Seite
  const manualSideInput = document.createElement('input');
  manualSideInput.type = 'text';
  manualSideInput.placeholder = 'Seitenname';
  manualSideInput.className = 'wall-side-manual';
  manualSideInput.style.display = 'none';
  manualSideInput.addEventListener('input', updateSummary);
  // Seitenwechsel: Zeige oder verstecke das manuelle Eingabefeld
  sideSelect.addEventListener('change', () => {
    if (sideSelect.value === '__manual__') {
      manualSideInput.style.display = '';
    } else {
      manualSideInput.style.display = 'none';
      manualSideInput.value = '';
    }
    updateSummary();
  });
  sideWrapper.appendChild(sideLabel);
  sideWrapper.appendChild(sideSelect);
  sideWrapper.appendChild(manualSideInput);

  // Auswahl des Typs (Traufe, Giebel, Sonstige)
  const typeWrapper = document.createElement('div');
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Typ:';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'wall-type';
  [
    { value: '', text: 'Bitte wählen' },
    { value: 'Traufe', text: 'Traufe' },
    { value: 'Giebel', text: 'Giebel' },
    { value: 'Sonstige', text: 'Sonstige' }
  ].forEach(optData => {
    const opt = document.createElement('option');
    opt.value = optData.value;
    opt.textContent = optData.text;
    typeSelect.appendChild(opt);
  });
  // Button zum Kopieren der Länge von der ersten Traufe/Giebel usw.
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Länge übernehmen';
  copyBtn.className = 'copy-length-btn';
  copyBtn.style.display = 'none';
  // Kopierfunktion
  copyBtn.addEventListener('click', () => {
    // Suche erste Wand mit gleichem Typ (Traufe oder Giebel) vor dieser Wand
    const allWalls = document.querySelectorAll('#wallsContainer .wall');
    let referenceWall = null;
    for (const otherWall of allWalls) {
      if (otherWall === wallDiv) break;
      const otherType = otherWall.querySelector('.wall-type');
      if (otherType && otherType.value === typeSelect.value && typeSelect.value) {
        referenceWall = otherWall;
        break;
      }
    }
    if (referenceWall) {
      // hole Länge(n) aus referenz
      const refLengthRows = referenceWall.querySelectorAll('.length-row');
      // leere aktuelle längen und extras
      const currentContainer = lengthsContainer;
      currentContainer.innerHTML = '';
      refLengthRows.forEach(refRow => {
        // erstelle neue reihe
        const newRow = document.createElement('div');
        newRow.className = 'dimension-row length-row';
        const lenInput = document.createElement('input');
        lenInput.type = 'number';
        lenInput.min = '0';
        lenInput.step = '0.01';
        lenInput.placeholder = 'Länge (m)';
        lenInput.className = 'length';
        lenInput.addEventListener('input', () => {
          updateScaffoldingLength(wallDiv);
          updateSummary();
        });
        // extras select
        const extraSelect = document.createElement('select');
        extraSelect.className = 'length-extra';
        [
          { value: '0', text: '+0 m' },
          { value: '1', text: '+1 m' },
          { value: '2', text: '+2 m' }
        ].forEach(optData => {
          const opt = document.createElement('option');
          opt.value = optData.value;
          opt.textContent = optData.text;
          extraSelect.appendChild(opt);
        });
        extraSelect.addEventListener('change', () => {
          updateScaffoldingLength(wallDiv);
          updateSummary();
        });
        // entfernen button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Länge entfernen';
        removeBtn.addEventListener('click', () => {
          newRow.remove();
          updateScaffoldingLength(wallDiv);
          updateSummary();
        });
        // setze werte von referenz
        const refLen = parseFloat(refRow.querySelector('.length')?.value) || 0;
        lenInput.value = refLen ? refLen.toFixed(2) : '';
        const refExtra = refRow.querySelector('.length-extra')?.value;
        if (refExtra !== undefined) {
          extraSelect.value = refExtra;
        }
        newRow.appendChild(lenInput);
        newRow.appendChild(extraSelect);
        newRow.appendChild(removeBtn);
        currentContainer.appendChild(newRow);
      });
      updateScaffoldingLength(wallDiv);
      updateSummary();
    }
  });
  typeSelect.addEventListener('change', () => {
    // Bei Wahl von "Giebel" automatisch eine zweite Höhe hinzufügen,
    // falls noch nicht vorhanden. Ein Giebel benötigt zwei Höhen (Anfang und Spitze).
    if (typeSelect.value === 'Giebel') {
      const existingHeights = wallDiv.querySelectorAll('.height-row');
      if (existingHeights.length < 2) {
        // füge zusätzliche Höhe hinzu (nutze definierte Funktion addHeightField)
        addHeightField();
      }
    }

    // Zeige Kopierbutton nur, wenn Traufe oder Giebel und es gibt bereits eine Wand mit diesem Typ
    const val = typeSelect.value;
    if (val === 'Traufe' || val === 'Giebel') {
      // Prüfe, ob es eine andere Wand mit gleichem Typ gibt
      const allWalls = document.querySelectorAll('#wallsContainer .wall');
      let found = false;
      for (const otherWall of allWalls) {
        if (otherWall === wallDiv) continue;
        const otherType = otherWall.querySelector('.wall-type');
        if (otherType && otherType.value === val) {
          found = true;
          break;
        }
      }
      copyBtn.style.display = found ? '' : 'none';
    } else {
      copyBtn.style.display = 'none';
    }
    updateSummary();
  });
  typeWrapper.appendChild(typeLabel);
  typeWrapper.appendChild(typeSelect);
  typeWrapper.appendChild(copyBtn);

  // Container für mehrere Längen
  const lengthsContainer = document.createElement('div');
  lengthsContainer.className = 'lengths';
  // Hilfsfunktion zum Erstellen eines Längen‑Eingabefelds
  function addLengthField() {
    const row = document.createElement('div');
    row.className = 'dimension-row length-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = 'Länge (m)';
    input.className = 'length';
    input.addEventListener('input', () => {
      updateScaffoldingLength(wallDiv);
      updateSummary();
    });
    // Extra-Zuschlag pro Länge: Auswahl 0, 1 oder 2 Meter
    const extraSelect = document.createElement('select');
    extraSelect.className = 'length-extra';
    // Definiere Optionen für 0, 1 und 2 Meter
    [
      { value: '0', text: '+0 m' },
      { value: '1', text: '+1 m' },
      { value: '2', text: '+2 m' }
    ].forEach(optData => {
      const opt = document.createElement('option');
      opt.value = optData.value;
      opt.textContent = optData.text;
      extraSelect.appendChild(opt);
    });
    // Setze standardmäßig den Zuschlag auf +2 m,
    // da die oberste Lage bei der Gerüststellung üblicherweise berücksichtigt wird.
    extraSelect.value = '2';
    extraSelect.addEventListener('change', () => {
      updateScaffoldingLength(wallDiv);
      updateSummary();
    });
    // Entfernen‑Button für diese Länge
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Länge entfernen';
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateScaffoldingLength(wallDiv);
      updateSummary();
    });
    // Zusammenbauen: Reihenfolge: Eingabe, Extra, Entfernen
    row.appendChild(input);
    row.appendChild(extraSelect);
    row.appendChild(removeBtn);
    lengthsContainer.appendChild(row);
  }
  // Anfangs eine Länge anlegen
  addLengthField();
  // Button zum Hinzufügen weiterer Längen
  const addLengthBtn = document.createElement('button');
  addLengthBtn.className = 'primary';
  addLengthBtn.type = 'button';
  addLengthBtn.textContent = 'Länge hinzufügen';
  addLengthBtn.addEventListener('click', () => {
    addLengthField();
  });

  // Container für mehrere Höhen
  const heightsContainer = document.createElement('div');
  heightsContainer.className = 'heights';
  function addHeightField() {
    const row = document.createElement('div');
    row.className = 'dimension-row height-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = 'Höhe (m)';
    input.className = 'height';
    input.addEventListener('input', updateSummary);
    // Extra: Oberste Lage +2 m pro Höhe
    const extrasContainer = document.createElement('div');
    extrasContainer.className = 'height-extras';
    const topCheck = document.createElement('input');
    topCheck.type = 'checkbox';
    topCheck.className = 'height-top-extra';
    topCheck.title = 'Oberste Lage +2,00 m';
    // Standardmäßig ist die +2 m für die oberste Lage aktiviert
    topCheck.checked = true;
    topCheck.addEventListener('change', updateSummary);
    const topLabel = document.createElement('label');
    topLabel.appendChild(topCheck);
    topLabel.appendChild(document.createTextNode(' +2 m oben'));
    extrasContainer.appendChild(topLabel);
    // Entfernen‑Button für diese Höhe
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Höhe entfernen';
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateSummary();
    });
    row.appendChild(input);
    row.appendChild(extrasContainer);
    row.appendChild(removeBtn);
    heightsContainer.appendChild(row);
  }
  // Anfangs eine Höhe anlegen
  addHeightField();
  // Button zum Hinzufügen weiterer Höhen
  const addHeightBtn = document.createElement('button');
  addHeightBtn.className = 'primary';
  addHeightBtn.type = 'button';
  addHeightBtn.textContent = 'Höhe hinzufügen';
  addHeightBtn.addEventListener('click', () => {
    addHeightField();
  });

  // Checkbox für Giebelmittelwert
  const meanWrapper = document.createElement('div');
  meanWrapper.className = 'mean-wrapper';
  const meanCheck = document.createElement('input');
  meanCheck.type = 'checkbox';
  meanCheck.className = 'use-mean-height';
  meanCheck.addEventListener('change', updateSummary);
  const meanLabel = document.createElement('label');
  meanLabel.appendChild(meanCheck);
  meanLabel.appendChild(document.createTextNode(' Mittelwert für Giebel berechnen'));
  meanWrapper.appendChild(meanLabel);

  // Gerüst‑Anzeige für diese Wand
  const scaffWrapper = document.createElement('div');
  scaffWrapper.className = 'scaffolding';
  // Anzeige der Gerüstlänge
  const scaffLenDisplay = document.createElement('div');
  scaffLenDisplay.className = 'scaff-length';
  scaffLenDisplay.textContent = 'Gerüstlänge: 0,00 m';
  scaffWrapper.appendChild(scaffLenDisplay);

  // Ordnen der Eingabeelemente im Body
  // Füge Seite und Typ Auswahl als gemeinsame Zeile hinzu
  const sideTypeRow = document.createElement('div');
  sideTypeRow.className = 'side-type-row';
  sideTypeRow.appendChild(sideWrapper);
  sideTypeRow.appendChild(typeWrapper);
  body.appendChild(sideTypeRow);
  // Höhenabschnitt
  body.appendChild(heightsContainer);
  body.appendChild(addHeightBtn);
  // Längenabschnitt
  body.appendChild(lengthsContainer);
  body.appendChild(addLengthBtn);
  // Mittelwert für Giebel
  body.appendChild(meanWrapper);
  // Gerüst‑Optionen
  body.appendChild(scaffWrapper);

  // Zusatzoptionen wie Treppenturm, Netze, Lampen, Parkplatz, Tunnelrahmen
  const optionsWrapper = document.createElement('div');
  optionsWrapper.className = 'wall-options';
  // Treppenturm
  const ttRow = document.createElement('div');
  ttRow.className = 'option-row';
  const ttCheck = document.createElement('input');
  ttCheck.type = 'checkbox';
  ttCheck.className = 'tt-check';
  ttCheck.title = 'Treppenturm hinzufügen';
  const ttLabel = document.createElement('label');
  ttLabel.appendChild(ttCheck);
  ttLabel.appendChild(document.createTextNode(' Treppenturm'));
  // Höhe für TT (wird automatisch höchste Höhe +2 m, veränderbar)
  const ttHeight = document.createElement('input');
  ttHeight.type = 'number';
  ttHeight.min = '0';
  ttHeight.step = '0.01';
  ttHeight.placeholder = 'TT‑Höhe (m)';
  ttHeight.className = 'tt-height';
  ttHeight.style.display = 'none';
  // Kennzeichen für manuelle Anpassung
  ttHeight.dataset.manual = 'false';
  ttHeight.addEventListener('input', () => {
    ttHeight.dataset.manual = 'true';
    updateSummary();
  });
  // Käfig für TT
  const cageCheck = document.createElement('input');
  cageCheck.type = 'checkbox';
  cageCheck.className = 'tt-cage';
  cageCheck.style.display = 'none';
  const cageLabel = document.createElement('label');
  cageLabel.appendChild(cageCheck);
  cageLabel.appendChild(document.createTextNode(' Käfig'));
  cageLabel.style.display = 'none';
  cageCheck.addEventListener('change', updateSummary);
  // Extra +2 m für TT (standardmäßig ausgewählt)
  const ttExtraCheck = document.createElement('input');
  ttExtraCheck.type = 'checkbox';
  ttExtraCheck.className = 'tt-extra';
  ttExtraCheck.title = '+2 m beim Treppenturm';
  ttExtraCheck.checked = true;
  const ttExtraLabel = document.createElement('label');
  ttExtraLabel.appendChild(ttExtraCheck);
  ttExtraLabel.appendChild(document.createTextNode(' +2 m'));
  ttExtraLabel.style.display = 'none';
  // Wenn ttExtra geändert wird, Standardhöhe ggf. aktualisieren
  ttExtraCheck.addEventListener('change', () => {
    // Beim Wechsel setzen wir die manuellen Flags zurück, damit die Höhe neu berechnet wird
    if (ttHeight.dataset.manual !== 'true') {
      // Der Wert wird in updateSummary neu gesetzt
    }
    updateSummary();
  });
  // Umschalten der Sichtbarkeit von Höhe und Käfig
  ttCheck.addEventListener('change', () => {
    if (ttCheck.checked) {
      ttHeight.style.display = '';
      cageCheck.style.display = '';
      cageLabel.style.display = '';
      ttExtraLabel.style.display = '';
    } else {
      ttHeight.style.display = 'none';
      cageCheck.style.display = 'none';
      cageLabel.style.display = 'none';
      ttExtraLabel.style.display = 'none';
    }
    updateSummary();
  });
  ttRow.appendChild(ttLabel);
  ttRow.appendChild(ttHeight);
  ttRow.appendChild(ttExtraLabel);
  ttRow.appendChild(cageLabel);
  // Staubschutznetz
  const netRow = document.createElement('div');
  netRow.className = 'option-row';
  const netCheck = document.createElement('input');
  netCheck.type = 'checkbox';
  netCheck.className = 'net-check';
  netCheck.title = 'Staubschutznetz';
  const netLabel = document.createElement('label');
  netLabel.appendChild(netCheck);
  netLabel.appendChild(document.createTextNode(' Staubschutznetz'));
  // Eingabefeld für Netzfläche (manuell anpassbar)
  const netInput = document.createElement('input');
  netInput.type = 'number';
  netInput.min = '0';
  netInput.step = '0.01';
  netInput.className = 'net-area';
  netInput.dataset.manual = 'false';
  netInput.style.display = 'none';
  netInput.addEventListener('input', () => {
    netInput.dataset.manual = 'true';
    updateSummary();
  });
  // Ein-/Ausblenden des Eingabefelds bei Checkbox
  netCheck.addEventListener('change', () => {
    if (netCheck.checked) {
      netInput.style.display = '';
    } else {
      netInput.style.display = 'none';
      netInput.value = '';
      netInput.dataset.manual = 'false';
    }
    updateSummary();
  });
  netRow.appendChild(netLabel);
  netRow.appendChild(netInput);
  // Lampen (auswählbar mit Checkbox)
  const lampRow = document.createElement('div');
  lampRow.className = 'option-row';
  // Lampen-Checkbox
  const lampCheck = document.createElement('input');
  lampCheck.type = 'checkbox';
  lampCheck.className = 'lamp-check';
  lampCheck.title = 'Lampen hinzuschalten';
  const lampCheckLabel = document.createElement('label');
  lampCheckLabel.appendChild(lampCheck);
  lampCheckLabel.appendChild(document.createTextNode(' Lampen'));
  // Lampen-Eingabefeld
  const lampInput = document.createElement('input');
  lampInput.type = 'number';
  lampInput.min = '0';
  lampInput.step = '1';
  lampInput.className = 'lamp-count';
  lampInput.dataset.manual = 'false';
  lampInput.style.display = 'none';
  lampInput.addEventListener('input', () => {
    lampInput.dataset.manual = 'true';
    updateSummary();
  });
  // Wenn man Lampen-Checkbox klickt, Eingabe ein-/ausblenden
  lampCheck.addEventListener('change', () => {
    if (lampCheck.checked) {
      lampInput.style.display = '';
    } else {
      lampInput.style.display = 'none';
      lampInput.value = '';
      lampInput.dataset.manual = 'false';
    }
    updateSummary();
  });
  lampRow.appendChild(lampCheckLabel);
  lampRow.appendChild(lampInput);
  // Parkplatz und Genehmigung (zwei separate Optionen)
  const parkingRow = document.createElement('div');
  parkingRow.className = 'option-row';
  // Parkplatz
  const parkCheck = document.createElement('input');
  parkCheck.type = 'checkbox';
  parkCheck.className = 'parking-check';
  const parkLabel = document.createElement('label');
  parkLabel.appendChild(parkCheck);
  parkLabel.appendChild(document.createTextNode(' Parkplatz'));
  // Genehmigung
  const permitCheck = document.createElement('input');
  permitCheck.type = 'checkbox';
  permitCheck.className = 'permit-check';
  const permitLabel = document.createElement('label');
  permitLabel.appendChild(permitCheck);
  permitLabel.appendChild(document.createTextNode(' Genehmigung'));
  // Event Listener
  parkCheck.addEventListener('change', updateSummary);
  permitCheck.addEventListener('change', updateSummary);
  // Zusammenbauen
  parkingRow.appendChild(parkLabel);
  parkingRow.appendChild(permitLabel);
  // Tunnelrahmen (auswählbar mit Checkbox)
  const tunnelRow = document.createElement('div');
  tunnelRow.className = 'option-row';
  // Tunnel-Checkbox
  const tunnelCheck = document.createElement('input');
  tunnelCheck.type = 'checkbox';
  tunnelCheck.className = 'tunnel-check';
  tunnelCheck.title = 'Tunnelrahmen hinzufügen';
  const tunnelCheckLabel = document.createElement('label');
  tunnelCheckLabel.appendChild(tunnelCheck);
  tunnelCheckLabel.appendChild(document.createTextNode(' Tunnelrahmen'));
  // Tunnel-Längenfeld
  const tunnelInput = document.createElement('input');
  tunnelInput.type = 'number';
  tunnelInput.min = '0';
  tunnelInput.step = '0.01';
  tunnelInput.className = 'tunnel-length';
  tunnelInput.dataset.manual = 'false';
  tunnelInput.style.display = 'none';
  tunnelInput.addEventListener('input', () => {
    tunnelInput.dataset.manual = 'true';
    updateSummary();
  });
  // Ein-/Ausblenden bei Checkbox
  tunnelCheck.addEventListener('change', () => {
    if (tunnelCheck.checked) {
      tunnelInput.style.display = '';
    } else {
      tunnelInput.style.display = 'none';
      tunnelInput.value = '';
      tunnelInput.dataset.manual = 'false';
    }
    updateSummary();
  });
  tunnelRow.appendChild(tunnelCheckLabel);
  tunnelRow.appendChild(tunnelInput);

  // Füge die Optionzeilen zum Wrapper hinzu
  optionsWrapper.appendChild(ttRow);
  optionsWrapper.appendChild(netRow);
  optionsWrapper.appendChild(lampRow);
  optionsWrapper.appendChild(parkingRow);
  optionsWrapper.appendChild(tunnelRow);

  // Dachfang (DF) mit Konsolen 0,50 und DF-Netzen
  const dfRow = document.createElement('div');
  dfRow.className = 'option-row';
  const dfCheck = document.createElement('input');
  dfCheck.type = 'checkbox';
  dfCheck.className = 'df-check';
  dfCheck.title = 'Dachfang (DF) auswählen';
  const dfLabel = document.createElement('label');
  dfLabel.appendChild(dfCheck);
  dfLabel.appendChild(document.createTextNode(' DF'));
  // Konsolen 0,50 (Anzahl oder Länge?)
  const dfConsoleInput = document.createElement('input');
  dfConsoleInput.type = 'number';
  dfConsoleInput.min = '0';
  dfConsoleInput.step = '0.01';
  dfConsoleInput.placeholder = 'Konsolen 0,50';
  dfConsoleInput.className = 'df-console';
  dfConsoleInput.style.display = 'none';
  dfConsoleInput.dataset.manual = 'false';
  dfConsoleInput.addEventListener('input', () => {
    dfConsoleInput.dataset.manual = 'true';
    updateSummary();
  });
  // DF Netze – Länge der Seite
  const dfNetInput = document.createElement('input');
  dfNetInput.type = 'number';
  dfNetInput.min = '0';
  dfNetInput.step = '0.01';
  dfNetInput.placeholder = 'DF‑Netze (m)';
  dfNetInput.className = 'df-net';
  dfNetInput.style.display = 'none';
  dfNetInput.dataset.manual = 'false';
  dfNetInput.addEventListener('input', () => {
    dfNetInput.dataset.manual = 'true';
    updateSummary();
  });
  // Umschalten der Sichtbarkeit der DF-Felder
  dfCheck.addEventListener('change', () => {
    if (dfCheck.checked) {
      dfConsoleInput.style.display = '';
      dfNetInput.style.display = '';
    } else {
      dfConsoleInput.style.display = 'none';
      dfConsoleInput.value = '';
      dfConsoleInput.dataset.manual = 'false';
      dfNetInput.style.display = 'none';
      dfNetInput.value = '';
      dfNetInput.dataset.manual = 'false';
    }
    updateSummary();
  });
  dfRow.appendChild(dfLabel);
  dfRow.appendChild(dfConsoleInput);
  dfRow.appendChild(dfNetInput);
  optionsWrapper.appendChild(dfRow);

  // ------- Konsolen -------
  const consRow = document.createElement('div');
  consRow.className = 'option-row';
  const consCheck = document.createElement('input');
  consCheck.type = 'checkbox';
  consCheck.className = 'cons-check';
  consCheck.title = 'Konsolen hinzufügen';
  const consLabel = document.createElement('label');
  consLabel.appendChild(consCheck);
  consLabel.appendChild(document.createTextNode(' Konsole'));
  // Container für Konsolen-Einträge
  const consContainer = document.createElement('div');
  consContainer.className = 'cons-container';
  consContainer.style.display = 'none';
  // Schaltfläche zum Hinzufügen einer neuen Konsole
  const addConsBtn = document.createElement('button');
  addConsBtn.type = 'button';
  addConsBtn.textContent = 'Konsole hinzufügen';
  addConsBtn.className = 'secondary';
  // Funktion zum Hinzufügen einer Konsole
  function addConsoleRow() {
    const row = document.createElement('div');
    row.className = 'console-row';
    // Dropdown für Konsolentypen
    const typeSel = document.createElement('select');
    typeSel.className = 'console-type';
    // Liste der verfügbaren Konsolen zur Auswahl. Der Begriff "Konsole"
    // wird in der Anzeige weggelassen; nur die Längen (ggf. mit Hinweis
    // auf Rohrverbinder oder Stecksystem) werden gezeigt.
    [
      '0,22 m',
      '0,36 m (ohne Rohrverbinder)',
      '0,36 m (mit Rohrverbinder)',
      '0,22 m Steck',
      '0,36 m Steck',
      '0,50 m',
      '0,73 m'
    ].forEach(optText => {
      const opt = document.createElement('option');
      opt.value = optText;
      opt.textContent = optText;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', updateSummary);
    // Länge
    const lenInput = document.createElement('input');
    lenInput.type = 'number';
    lenInput.min = '0';
    lenInput.step = '0.01';
    lenInput.placeholder = 'Länge (m)';
    lenInput.className = 'console-length';
    lenInput.addEventListener('input', () => {
      lenInput.dataset.manual = 'true';
      updateSummary();
    });
    // Gesamtlänge übernehmen
    const lenAuto = document.createElement('input');
    lenAuto.type = 'checkbox';
    lenAuto.className = 'console-auto';
    lenAuto.title = 'Gesamtlänge übernehmen';
    lenAuto.addEventListener('change', () => {
      if (lenAuto.checked) {
        const totalLen = computeTotalScaffoldLength(wallDiv);
        if (!isNaN(totalLen)) {
          lenInput.value = totalLen.toFixed(2);
        }
        lenInput.disabled = true;
      } else {
        lenInput.disabled = false;
      }
      updateSummary();
    });
    // Lagenanzahl mit Label
    const layerLabel = document.createElement('span');
    layerLabel.textContent = 'Lagen';
    const layerInput = document.createElement('input');
    layerInput.type = 'number';
    layerInput.min = '1';
    layerInput.step = '1';
    layerInput.value = '1';
    layerInput.className = 'console-layers';
    layerInput.addEventListener('input', updateSummary);
    // Entfernen-Schaltfläche
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = '×';
    rmBtn.className = 'remove-row-btn';
    rmBtn.addEventListener('click', () => {
      row.remove();
      updateSummary();
    });
    // Zeile zusammensetzen
    row.appendChild(typeSel);
    // Füge Längeingabe und Auto-Checkbox direkt an
    row.appendChild(lenInput);
    row.appendChild(lenAuto);
    // Füge Label und Eingabe für Lagen hinzu (Wrapper bleibt zur Gruppe)
    const layerWrapper = document.createElement('span');
    layerWrapper.style.display = 'flex';
    layerWrapper.style.alignItems = 'center';
    layerWrapper.style.gap = '0.25rem';
    layerWrapper.appendChild(layerLabel);
    layerWrapper.appendChild(layerInput);
    row.appendChild(layerWrapper);
    row.appendChild(rmBtn);
    consContainer.insertBefore(row, addConsBtn);
    updateSummary();
  }
  addConsBtn.addEventListener('click', addConsoleRow);
  // Umschalten der Sichtbarkeit des Konsolen-Containers
  consCheck.addEventListener('change', () => {
    if (consCheck.checked) {
      consContainer.style.display = '';
      if (consContainer.querySelectorAll('.console-row').length === 0) {
        addConsoleRow();
      }
    } else {
      consContainer.style.display = 'none';
      consContainer.querySelectorAll('.console-row').forEach(r => r.remove());
    }
    updateSummary();
  });
  consRow.appendChild(consLabel);
  consRow.appendChild(consContainer);
  consContainer.appendChild(addConsBtn);
  optionsWrapper.appendChild(consRow);

  // ------- Innengeländer -------
  const innerRow = document.createElement('div');
  innerRow.className = 'option-row';
  const innerCheck = document.createElement('input');
  innerCheck.type = 'checkbox';
  innerCheck.className = 'inner-check';
  innerCheck.title = 'Innengeländer hinzufügen';
  const innerLabel = document.createElement('label');
  innerLabel.appendChild(innerCheck);
  innerLabel.appendChild(document.createTextNode(' Innengeländer'));
  // Container für Innengeländer mit dynamischen Einträgen
  const innerContainer = document.createElement('div');
  innerContainer.className = 'inner-container';
  innerContainer.style.display = 'none';
  // Button zum Hinzufügen einer Innengeländer-Zeile
  const addInnerBtn = document.createElement('button');
  addInnerBtn.type = 'button';
  addInnerBtn.textContent = 'Innengeländer hinzufügen';
  addInnerBtn.className = 'secondary';
  // Funktion zum Hinzufügen einer Innengeländer-Zeile
  function addInnerRow() {
    const row = document.createElement('div');
    row.className = 'inner-row';
    // Länge
    const lenInput = document.createElement('input');
    lenInput.type = 'number';
    lenInput.min = '0';
    lenInput.step = '0.01';
    lenInput.placeholder = 'Länge (m)';
    lenInput.className = 'inner-length';
    lenInput.addEventListener('input', () => {
      lenInput.dataset.manual = 'true';
      updateSummary();
    });
    // Gesamtlänge übernehmen
    const autoChk = document.createElement('input');
    autoChk.type = 'checkbox';
    autoChk.className = 'inner-auto';
    autoChk.title = 'Gesamtlänge übernehmen';
    autoChk.addEventListener('change', () => {
      if (autoChk.checked) {
        const totalLen = computeTotalScaffoldLength(wallDiv);
        if (!isNaN(totalLen)) {
          lenInput.value = totalLen.toFixed(2);
        }
        lenInput.disabled = true;
      } else {
        lenInput.disabled = false;
      }
      updateSummary();
    });
    // Lagen
    const layerLabel = document.createElement('span');
    layerLabel.textContent = 'Lagen';
    const layerInput = document.createElement('input');
    layerInput.type = 'number';
    layerInput.min = '1';
    layerInput.step = '1';
    layerInput.value = '1';
    layerInput.className = 'inner-layers';
    layerInput.addEventListener('input', updateSummary);
    const layerWrapper = document.createElement('span');
    layerWrapper.style.display = 'flex';
    layerWrapper.style.alignItems = 'center';
    layerWrapper.style.gap = '0.25rem';
    layerWrapper.appendChild(layerLabel);
    layerWrapper.appendChild(layerInput);
    // Entfernen-Button
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = '×';
    rmBtn.className = 'remove-row-btn';
    rmBtn.addEventListener('click', () => {
      row.remove();
      updateSummary();
    });
    // Zeile zusammenbauen
    row.appendChild(lenInput);
    row.appendChild(autoChk);
    row.appendChild(layerWrapper);
    row.appendChild(rmBtn);
    // In Container vor dem Hinzufügen-Button einfügen
    innerContainer.insertBefore(row, addInnerBtn);
    updateSummary();
  }
  addInnerBtn.addEventListener('click', addInnerRow);
  // Umschalten der Sichtbarkeit der Innengeländer-Optionen
  innerCheck.addEventListener('change', () => {
    if (innerCheck.checked) {
      innerContainer.style.display = '';
      // Falls noch keine Zeilen vorhanden, eine hinzufügen
      if (innerContainer.querySelectorAll('.inner-row').length === 0) {
        addInnerRow();
      }
    } else {
      innerContainer.style.display = 'none';
      // Alle vorhandenen Zeilen entfernen
      innerContainer.querySelectorAll('.inner-row').forEach(r => r.remove());
    }
    updateSummary();
  });
  // Elemente zusammenfügen
  innerRow.appendChild(innerLabel);
  innerRow.appendChild(innerContainer);
  innerContainer.appendChild(addInnerBtn);
  optionsWrapper.appendChild(innerRow);

  body.appendChild(optionsWrapper);

  // Container für Öffnungen
  const openingsContainer = document.createElement('div');
  openingsContainer.className = 'openings';

  // Button zum Hinzufügen von Öffnungen
  const addOpeningBtn = document.createElement('button');
  addOpeningBtn.className = 'primary';
  addOpeningBtn.type = 'button';
  addOpeningBtn.textContent = 'Öffnung hinzufügen';
  addOpeningBtn.addEventListener('click', () => {
    addOpening(openingsContainer);
  });

  // Zusammenführen aller Teile
  wallDiv.appendChild(header);
  wallDiv.appendChild(body);
  wallDiv.appendChild(addOpeningBtn);
  wallDiv.appendChild(openingsContainer);
  // Initial Gerüstlänge berechnen
  updateScaffoldingLength(wallDiv);
  return wallDiv;
}

// Fügt eine Öffnung (Fenster/Tür) zu einer Wand hinzu
function addOpening(container) {
  const row = document.createElement('div');
  row.className = 'opening-row';
  // Breite der Öffnung
  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.min = '0';
  wInput.step = '0.01';
  wInput.placeholder = 'Breite (m)';
  wInput.className = 'opening-width';
  wInput.addEventListener('input', updateSummary);
  // Höhe der Öffnung
  const hInput = document.createElement('input');
  hInput.type = 'number';
  hInput.min = '0';
  hInput.step = '0.01';
  hInput.placeholder = 'Höhe (m)';
  hInput.className = 'opening-height';
  hInput.addEventListener('input', updateSummary);
  // Entfernen‑Button für die Öffnung
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.type = 'button';
  removeBtn.textContent = '×';
  removeBtn.title = 'Öffnung entfernen';
  removeBtn.addEventListener('click', () => {
    row.remove();
    updateSummary();
  });
  row.appendChild(wInput);
  row.appendChild(hInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
  updateSummary();
}

// Berechnet die Gerüstlänge für eine Wand und aktualisiert die Anzeige
function updateScaffoldingLength(wallDiv) {
  const scaffLenDisplay = wallDiv.querySelector('.scaff-length');
  // Berechne die Gerüstlänge als Summe aller Längen inklusive individueller Zuschläge
  let scaffLen = 0;
  const lengthRows = wallDiv.querySelectorAll('.length-row');
  lengthRows.forEach(row => {
    const lenInput = row.querySelector('.length');
    const extraSelect = row.querySelector('.length-extra');
    const val = parseFloat(lenInput?.value) || 0;
    let extra = 0;
    if (extraSelect) {
      extra = parseFloat(extraSelect.value) || 0;
    }
    scaffLen += val + extra;
  });
  if (scaffLenDisplay) {
    scaffLenDisplay.textContent = `Gerüstlänge: ${scaffLen.toFixed(2)} m`;
  }
}

/**
 * Berechnet die gesamte Gerüstlänge einer Wand aus allen Längenangaben
 * inklusive der pro Länge gewählten Zuschläge. Diese Funktion wird
 * beispielsweise von den Konsolen- und Innengeländeroptionen verwendet,
 * um die Standardlänge zu bestimmen.
 *
 * @param {HTMLElement} wallDiv Das DOM-Element der Wand
 * @returns {number} Gesamtlänge der Wand inklusive Zuschläge
 */
function computeTotalScaffoldLength(wallDiv) {
  let total = 0;
  const lengthRows = wallDiv.querySelectorAll('.length-row');
  lengthRows.forEach(row => {
    const lenInput = row.querySelector('.length');
    const extraSelect = row.querySelector('.length-extra');
    let val = parseFloat(lenInput?.value);
    if (isNaN(val)) val = 0;
    let extra = parseFloat(extraSelect?.value);
    if (isNaN(extra)) extra = 0;
    total += val + extra;
  });
  return total;
}

// Aktualisiert die Nummerierung der Wände nach dem Löschen
function renumberWalls() {
  const walls = document.querySelectorAll('#wallsContainer .wall');
  walls.forEach((wall, idx) => {
    const title = wall.querySelector('.wall-header h3');
    title.textContent = `Wand ${idx + 1}`;
  });
}

// Berechnet die Flächen und aktualisiert die Zusammenfassung
function updateSummary() {
  const summaryDiv = document.getElementById('summary');
  const wallElements = document.querySelectorAll('#wallsContainer .wall');
  if (wallElements.length === 0) {
    summaryDiv.innerHTML = '<p>Noch keine Wände erfasst.</p>';
    return;
  }
  let totalArea = 0;
  let totalTunnel = 0;
  // Globale Summen für Extras über alle Wände
  const globalTotals = {
    lamp: 0,
    cage: 0,
    netArea: 0,
    dfNet: 0,
    consoleLen: 0,
    tunnel: 0,
    parking: 0,
    permit: 0,
    consoles: 0,
    inner: 0
  };
  let html = '';
  wallElements.forEach((wall, i) => {
    // Verwende Seite und Typ für die Bezeichnung
    let name = '';
    const sideSel = wall.querySelector('.wall-side');
    const manualSideInput = wall.querySelector('.wall-side-manual');
    const typeSel = wall.querySelector('.wall-type');
    // Bestimme den Namen basierend auf der Seite (oder manueller Eingabe) und dem Typ
    if (sideSel) {
      if (sideSel.value === '__manual__' && manualSideInput && manualSideInput.value.trim() !== '') {
        name = manualSideInput.value.trim();
      } else if (sideSel.value) {
        name = sideSel.value;
      }
    }
    if (typeSel && typeSel.value) {
      name = name ? `${name} ${typeSel.value}` : typeSel.value;
    }
    if (!name) {
      name = `Wand ${i + 1}`;
    }
    // Sammle Längen und ihre individuellen Zuschläge
    const lengthRows = wall.querySelectorAll('.length-row');
    let lengths = [];
    let lengthExtras = [];
    let baseLengthSum = 0;
    let lengthExtraSum = 0;
    lengthRows.forEach(row => {
      const lenInput = row.querySelector('.length');
      const extraSelect = row.querySelector('.length-extra');
      const val = parseFloat(lenInput?.value);
      if (!isNaN(val) && val > 0) {
        lengths.push(val);
        baseLengthSum += val;
      } else {
        lengths.push(0);
      }
      // Zusatzmeter pro Länge (0,1,2)
      let extra = 0;
      if (extraSelect) {
        extra = parseFloat(extraSelect.value);
        if (isNaN(extra)) extra = 0;
      }
      lengthExtras.push(extra);
      lengthExtraSum += extra;
    });

    // Sammle Höhen und ihre individuellen Top‑Zuschläge
    const heightRows = wall.querySelectorAll('.height-row');
    let heights = [];
    let heightExtras = [];
    heightRows.forEach(row => {
      const hInput = row.querySelector('.height');
      const topExtChk = row.querySelector('.height-top-extra');
      const val = parseFloat(hInput?.value);
      if (!isNaN(val) && val > 0) {
        heights.push(val);
      } else {
        heights.push(0);
      }
      const hExt = topExtChk?.checked ? 2 : 0;
      heightExtras.push(hExt);
    });

    // Mittelwertoption
    const meanCheck = wall.querySelector('.use-mean-height');
    // Berechne angepasste Höhen = Höhe + individueller Zuschlag
    const adjustedHeights = heights.map((h, idx) => h + heightExtras[idx]);
    const validAdjusted = adjustedHeights.filter(h => h > 0);
    let heightForArea = 0;
    if (validAdjusted.length > 0) {
      if (meanCheck?.checked && validAdjusted.length >= 2) {
        const minH = Math.min(...validAdjusted);
        const maxH = Math.max(...validAdjusted);
        heightForArea = (minH + maxH) / 2;
      } else {
        heightForArea = Math.max(...validAdjusted);
      }
    }

    // Aktualisiere Standardwerte für Treppenturm‑Höhe, Lampen und Tunnelrahmen
    // Maximale tatsächliche Höhe (für Treppenturm). Es soll die höchste
    // eingegebene Höhe ohne Berücksichtigung des Top‑Zuschlags verwendet werden,
    // damit der +2 m‑Zuschlag nicht doppelt addiert wird.
    const maxOriginal = heights.length > 0 ? Math.max(...heights.filter(h => h > 0)) : 0;
    // Lampenanzahl (1 pro 5 m Gerüstlänge)
    // Lampenanzahl: eine am Anfang, alle 5 m und am Ende
    const scaffLenForLamps = baseLengthSum + lengthExtraSum;
    /*
     * Lampenberechnung: immer eine am Anfang und eine am Ende sowie alle 5 m.
     * Beispiel: bei 7 m Gerüstlänge erhält man Lampen bei 0 m, 5 m und 7 m, also 3 Stück.
     * Dies entspricht floor(L / 5) + 2.
     */
    const defaultLampCount = scaffLenForLamps > 0 ? Math.floor(scaffLenForLamps / 5) + 2 : 0;
    // Tunnelrahmenlänge (gesamte Länge)
    const defaultTunnelLen = baseLengthSum + lengthExtraSum;
    // Greife auf optionale Felder zu
    const ttCheckField = wall.querySelector('.tt-check');
    const ttHeightField = wall.querySelector('.tt-height');
    const ttExtraField = wall.querySelector('.tt-extra');
    if (ttCheckField && ttCheckField.checked && ttHeightField && ttHeightField.dataset.manual !== 'true') {
      const extraVal = ttExtraField && ttExtraField.checked ? 2 : 0;
      // Verwende die maximale Originalhöhe (ohne Top‑Extras) + ggf. TT‑Extra
      const defTTHeight = maxOriginal > 0 ? maxOriginal + extraVal : 0;
      if (defTTHeight > 0) {
        ttHeightField.value = defTTHeight.toFixed(2);
      } else {
        ttHeightField.value = '';
      }
    }
    // Lampen: nur wenn ausgewählt
    const lampCheckField = wall.querySelector('.lamp-check');
    const lampField = wall.querySelector('.lamp-count');
    if (lampCheckField && lampField) {
      if (lampCheckField.checked) {
        if (lampField.dataset.manual !== 'true') {
          lampField.value = defaultLampCount > 0 ? defaultLampCount : '';
        }
      } else {
        // Reset value if not selected
        lampField.value = '';
        lampField.dataset.manual = 'false';
      }
    }
    // Tunnelrahmen: nur wenn ausgewählt
    const tunnelCheckField = wall.querySelector('.tunnel-check');
    const tunnelField = wall.querySelector('.tunnel-length');
    if (tunnelCheckField && tunnelField) {
      if (tunnelCheckField.checked) {
        if (tunnelField.dataset.manual !== 'true') {
          tunnelField.value = defaultTunnelLen > 0 ? defaultTunnelLen.toFixed(2) : '';
        }
      } else {
        tunnelField.value = '';
        tunnelField.dataset.manual = 'false';
      }
    }

    // Gerüstfläche berechnen: Summe der Längen + Zuschläge multipliziert mit der maßgeblichen Höhe
    const area = (baseLengthSum + lengthExtraSum) * heightForArea;
    totalArea += area;

    // Darstellung: Liste der Höhen mit Zuschlägen
    let heightsLines = '';
    heightRows.forEach((row, idx) => {
      const hVal = parseFloat(row.querySelector('.height')?.value) || 0;
      heightsLines += `H${idx + 1}: ${hVal.toFixed(2)} m`;
      const hExt = heightExtras[idx];
      if (hVal > 0 && hExt > 0) {
        heightsLines += ` + ${hExt.toFixed(2)} m`;
      }
      heightsLines += '<br />';
    });
    // Mittelwertanzeige wird in der Zusammenfassung nicht mehr ausgegeben,
    // aber die Berechnung (heightForArea) bleibt erhalten, falls der Nutzer den Mittelwert nutzt.
    let meanLine = '';
    // Darstellung: Liste der Längen mit Zuschlägen
    let lengthsLines = '';
    lengthRows.forEach((row, idx) => {
      const lVal = parseFloat(row.querySelector('.length')?.value) || 0;
      lengthsLines += `L${idx + 1}: ${lVal.toFixed(2)} m`;
      const lExt = lengthExtras[idx];
      if (lVal > 0 && lExt > 0) {
        lengthsLines += ` + ${lExt.toFixed(2)} m`;
      }
      lengthsLines += '<br />';
    });
    // Extra‑Zeile für Gesamtlänge: nur ausgeben, wenn mehr als eine Länge erfasst wurde
    let lengthExtraLine = '';
    if (lengthRows.length > 1) {
      if (lengthExtraSum > 0) {
        lengthExtraLine = `Gesamtlänge: ${baseLengthSum.toFixed(2)} m + ${lengthExtraSum.toFixed(2)} m<br />`;
      } else {
        lengthExtraLine = `Gesamtlänge: ${baseLengthSum.toFixed(2)} m<br />`;
      }
    }

    // Fläche pro Wand anzeigen
    const areaLine = `Fläche: ${area.toFixed(2)} m²`;

    // Zusätzliche Optionen auswerten und sammeln
    const extrasList = [];
    // Treppenturm
    const ttCheck = wall.querySelector('.tt-check');
    const ttHeightInput = wall.querySelector('.tt-height');
    const ttCage = wall.querySelector('.tt-cage');
    if (ttCheck && ttCheck.checked) {
      const ttHeightVal = parseFloat(ttHeightInput?.value) || 0;
      if (ttHeightVal > 0) {
        extrasList.push(`Treppenturm: ${ttHeightVal.toFixed(2)} m`);
      }
      if (ttCage && ttCage.checked) {
        extrasList.push(`Käfig: 1 x`);
        globalTotals.cage += 1;
      }
    }
    // Staubschutznetz: nutze die gesamte Fläche dieser Wand als Standard,
    // aber ermögliche manuelle Anpassung über das Eingabefeld
    const netCheck = wall.querySelector('.net-check');
    const netInput = wall.querySelector('.net-area');
    if (netCheck && netInput) {
      if (netCheck.checked) {
        // Wenn nicht manuell gesetzt, Standardwert auf Flächeninhalt setzen
        if (netInput.dataset.manual !== 'true') {
          netInput.value = area > 0 ? area.toFixed(2) : '';
        }
        const netVal = parseFloat(netInput.value);
        if (!isNaN(netVal) && netVal > 0) {
          extrasList.push(`Staubschutznetz: ${netVal.toFixed(2)} m²`);
          globalTotals.netArea += netVal;
        }
      } else {
        // Reset bei deaktiviertem Netz
        netInput.value = '';
        netInput.dataset.manual = 'false';
      }
    }
    // Lampen
    const lampCheck = wall.querySelector('.lamp-check');
    const lampInput = wall.querySelector('.lamp-count');
    if (lampCheck && lampCheck.checked && lampInput) {
      const lampVal = parseFloat(lampInput.value);
      if (!isNaN(lampVal) && lampVal > 0) {
        extrasList.push(`Lampen: ${lampVal.toFixed(0)}`);
        globalTotals.lamp += lampVal;
      }
    }
    // Parkplatz/Genehmigung (getrennt)
    const parkCheck = wall.querySelector('.parking-check');
    const permitCheck = wall.querySelector('.permit-check');
    if (parkCheck && parkCheck.checked) {
      extrasList.push(`Parkplatz`);
      globalTotals.parking += 1;
    }
    if (permitCheck && permitCheck.checked) {
      extrasList.push(`Genehmigung`);
      globalTotals.permit += 1;
    }
    // Tunnelrahmen
    const tunnelCheck = wall.querySelector('.tunnel-check');
    const tunnelInput = wall.querySelector('.tunnel-length');
    if (tunnelCheck && tunnelCheck.checked && tunnelInput) {
      const tunnelVal = parseFloat(tunnelInput.value);
      if (!isNaN(tunnelVal) && tunnelVal > 0) {
        extrasList.push(`Tunnelrahmen: ${tunnelVal.toFixed(2)} m`);
        totalTunnel += tunnelVal;
        globalTotals.tunnel += tunnelVal;
      }
    }
    // Dachfang (DF): Konsolen 0,50 und DF‑Netze
    const dfCheck = wall.querySelector('.df-check');
    const dfConsoleInput = wall.querySelector('.df-console');
    const dfNetInput = wall.querySelector('.df-net');
    if (dfCheck && dfCheck.checked) {
      // Standard DF‑Konsolen: gleiche Länge wie DF‑Netze (Gesamtlänge) sofern nicht manuell verändert
      if (dfConsoleInput && dfConsoleInput.dataset.manual !== 'true') {
        // Verwende die Standard-Netzlänge für Konsolen
        const defConsoleLen = (baseLengthSum + lengthExtraSum) > 0 ? (baseLengthSum + lengthExtraSum).toFixed(2) : '';
        dfConsoleInput.value = defConsoleLen;
      }
      // Standard DF‑Netze: gesamte Länge dieser Wand, sofern nicht manuell angepasst
      if (dfNetInput && dfNetInput.dataset.manual !== 'true') {
        const defNetLen = (baseLengthSum + lengthExtraSum) > 0 ? (baseLengthSum + lengthExtraSum).toFixed(2) : '';
        dfNetInput.value = defNetLen;
      }
      // Standard DF‑Konsolen: kein automatischer Vorschlag (bleibt leer oder 0)
      // Sammle Konsolen-Wert
      if (dfNetInput) {
        const netVal = parseFloat(dfNetInput.value);
        if (!isNaN(netVal) && netVal > 0) {
          // DF Netze wird mit Länge angegeben
          extrasList.push(`DF Netze: ${netVal.toFixed(2)} m`);
          globalTotals.dfNet += netVal;
        }
      }
      if (dfConsoleInput) {
        const consoleVal = parseFloat(dfConsoleInput.value);
        if (!isNaN(consoleVal) && consoleVal > 0) {
          // Konsole 0,50 wird mit derselben Länge wie DF Netze ausgegeben (ohne 'l')
          extrasList.push(`Konsole 0,50: ${consoleVal.toFixed(2)} m`);
          globalTotals.consoleLen += consoleVal;
        }
      }
    }

    // Konsolen: mehrere Einträge möglich
    const consCheck = wall.querySelector('.cons-check');
    if (consCheck && consCheck.checked) {
      const consRows = wall.querySelectorAll('.console-row');
      consRows.forEach(row => {
        const typeSel = row.querySelector('.console-type');
        const lenInput = row.querySelector('.console-length');
        const layerInput = row.querySelector('.console-layers');
        const lenVal = parseFloat(lenInput?.value);
        const layVal = parseInt(layerInput?.value) || 1;
        if (!isNaN(lenVal) && lenVal > 0 && typeSel) {
        const totalLen = lenVal * layVal;
        extrasList.push(`${typeSel.value}: ${totalLen.toFixed(2)} m (${layVal} Lagen)`);
        globalTotals.consoles += totalLen;
        }
      });
    }
    // Innengeländer – mehrere Einträge möglich
    const innerCheck = wall.querySelector('.inner-check');
    if (innerCheck && innerCheck.checked) {
      const innerRows = wall.querySelectorAll('.inner-row');
      innerRows.forEach(row => {
        const lenInput = row.querySelector('.inner-length');
        const layersInput = row.querySelector('.inner-layers');
        const lenVal = parseFloat(lenInput?.value);
        const layVal = parseInt(layersInput?.value) || 1;
        if (!isNaN(lenVal) && lenVal > 0) {
          const totalLen = lenVal * layVal;
          extrasList.push(`Innengeländer: ${totalLen.toFixed(2)} m (${layVal} Lagen)`);
          globalTotals.inner += totalLen;
        }
      });
    }
    // Zusammenbauen des HTML-Blocks für diese Wand
    html += `<div class="summary-item"><strong>${name}</strong><br />`;
    html += `${heightsLines}${meanLine}${lengthsLines}${lengthExtraLine}${areaLine}`;
    if (extrasList.length > 0) {
      // Leere Zeile zwischen Hauptmaßen und Extras
      html += `<br /><br />${extrasList.join('<br />')}`;
    }
    html += `</div>`;
  });
  html += `<hr /><div class="summary-item"><strong>Gesamt Fläche:</strong> ${totalArea.toFixed(2)} m²</div>`;
  // Wenn Tunnelrahmen über mehrere Wände hinweg ausgewählt wurde, Gesamtlänge ausgeben
  // Gesamter Tunnelrahmen wird über die Extras-Summe ausgegeben (Konsole 0,50/Tunnel), daher hier kein separater Eintrag
  // Ausgabe der summierten Extras (z. B. Lampen, Käfige, Netze etc.)
  const extrasSummaryLines = [];
  if (globalTotals.lamp > 0) {
    extrasSummaryLines.push(`Lampen: ${globalTotals.lamp.toFixed(0)} ×`);
  }
  if (globalTotals.cage > 0) {
    extrasSummaryLines.push(`Käfig: ${globalTotals.cage.toFixed(0)} ×`);
  }
  if (globalTotals.netArea > 0) {
    extrasSummaryLines.push(`Staubschutznetz: ${globalTotals.netArea.toFixed(2)} m²`);
  }
  if (globalTotals.dfNet > 0) {
    extrasSummaryLines.push(`DF Netze: ${globalTotals.dfNet.toFixed(2)} m`);
  }
  if (globalTotals.consoleLen > 0) {
    extrasSummaryLines.push(`Konsole 0,50: ${globalTotals.consoleLen.toFixed(2)} m`);
  }
  if (globalTotals.tunnel > 0) {
    extrasSummaryLines.push(`Tunnelrahmen: ${globalTotals.tunnel.toFixed(2)} m`);
  }
  if (globalTotals.parking > 0) {
    extrasSummaryLines.push(`Parkplatz: ${globalTotals.parking.toFixed(0)}`);
  }
  if (globalTotals.permit > 0) {
    extrasSummaryLines.push(`Genehmigung: ${globalTotals.permit.toFixed(0)}`);
  }
  if (extrasSummaryLines.length > 0) {
    html += `<div class="summary-item"><strong>Gesamt Extras:</strong><br />${extrasSummaryLines.join('<br />')}</div>`;
  }
  summaryDiv.innerHTML = html;
}

/**
 * Serialisiert das aktuell erfasste Projekt in ein einfaches JSON-Objekt.
 * Das Objekt enthält den Projektnamen sowie eine Liste aller Wände mit
 * ihren Längen, Höhen und Zusatzoptionen. Dieses Format kann später
 * wieder eingelesen werden, um das Projekt erneut zu laden.
 */
function serializeProject() {
  const projectNameInput = document.getElementById('projectName');
  const data = {
    projectName: projectNameInput ? projectNameInput.value.trim() : '',
    walls: []
  };
  const wallElements = document.querySelectorAll('#wallsContainer .wall');
  wallElements.forEach(wall => {
    const wallData = {};
    // Seite / Typ
    const sideSel = wall.querySelector('.wall-side');
    const manualSideInput = wall.querySelector('.wall-side-manual');
    const typeSel = wall.querySelector('.wall-type');
    wallData.side = sideSel ? sideSel.value : '';
    wallData.manualSide = manualSideInput ? manualSideInput.value : '';
    wallData.type = typeSel ? typeSel.value : '';
    // Längen und Extras
    wallData.lengths = [];
    const lengthRows = wall.querySelectorAll('.length-row');
    lengthRows.forEach(row => {
      const lenInput = row.querySelector('.length');
      const extraSelect = row.querySelector('.length-extra');
      const val = parseFloat(lenInput?.value);
      const extra = parseFloat(extraSelect?.value) || 0;
      wallData.lengths.push({ value: isNaN(val) ? '' : val, extra: extra });
    });
    // Höhen und Extras
    wallData.heights = [];
    const heightRows = wall.querySelectorAll('.height-row');
    heightRows.forEach(row => {
      const hInput = row.querySelector('.height');
      const topCheck = row.querySelector('.height-top-extra');
      const val = parseFloat(hInput?.value);
      const extra = topCheck && topCheck.checked ? 2 : 0;
      wallData.heights.push({ value: isNaN(val) ? '' : val, extra: extra });
    });
    // Mittelwertoption
    const meanCheck = wall.querySelector('.use-mean-height');
    wallData.useMeanHeight = !!(meanCheck && meanCheck.checked);
    // Treppenturm
    const ttCheck = wall.querySelector('.tt-check');
    wallData.tt = {};
    if (ttCheck && ttCheck.checked) {
      const ttHeight = wall.querySelector('.tt-height');
      const ttExtra = wall.querySelector('.tt-extra');
      const ttCage = wall.querySelector('.tt-cage');
      wallData.tt.enabled = true;
      wallData.tt.height = ttHeight ? ttHeight.value : '';
      wallData.tt.heightManual = ttHeight ? ttHeight.dataset.manual === 'true' : false;
      wallData.tt.extra = ttExtra && ttExtra.checked;
      wallData.tt.cage = ttCage && ttCage.checked;
    } else {
      wallData.tt.enabled = false;
    }
    // Staubschutznetz
    const netCheck = wall.querySelector('.net-check');
    wallData.net = {};
    if (netCheck && netCheck.checked) {
      const netInput = wall.querySelector('.net-area');
      wallData.net.enabled = true;
      wallData.net.value = netInput ? netInput.value : '';
      wallData.net.manual = netInput ? netInput.dataset.manual === 'true' : false;
    } else {
      wallData.net.enabled = false;
    }
    // Lampen
    const lampCheck = wall.querySelector('.lamp-check');
    wallData.lamp = {};
    if (lampCheck && lampCheck.checked) {
      const lampInput = wall.querySelector('.lamp-count');
      wallData.lamp.enabled = true;
      wallData.lamp.count = lampInput ? lampInput.value : '';
      wallData.lamp.manual = lampInput ? lampInput.dataset.manual === 'true' : false;
    } else {
      wallData.lamp.enabled = false;
    }
    // Parkplatz / Genehmigung
    const parkCheck = wall.querySelector('.parking-check');
    const permitCheck = wall.querySelector('.permit-check');
    wallData.parking = !!(parkCheck && parkCheck.checked);
    wallData.permit = !!(permitCheck && permitCheck.checked);
    // Tunnelrahmen
    const tunnelCheck = wall.querySelector('.tunnel-check');
    wallData.tunnel = {};
    if (tunnelCheck && tunnelCheck.checked) {
      const tunnelInput = wall.querySelector('.tunnel-length');
      wallData.tunnel.enabled = true;
      wallData.tunnel.length = tunnelInput ? tunnelInput.value : '';
      wallData.tunnel.manual = tunnelInput ? tunnelInput.dataset.manual === 'true' : false;
    } else {
      wallData.tunnel.enabled = false;
    }
    // Dachfang
    const dfCheck = wall.querySelector('.df-check');
    wallData.df = {};
    if (dfCheck && dfCheck.checked) {
      const dfConsole = wall.querySelector('.df-console');
      const dfNet = wall.querySelector('.df-net');
      wallData.df.enabled = true;
      wallData.df.console = dfConsole ? dfConsole.value : '';
      wallData.df.consoleManual = dfConsole ? dfConsole.dataset.manual === 'true' : false;
      wallData.df.net = dfNet ? dfNet.value : '';
      wallData.df.netManual = dfNet ? dfNet.dataset.manual === 'true' : false;
    } else {
      wallData.df.enabled = false;
    }

    // Konsolen (mehrere möglich)
    const consCheckEl = wall.querySelector('.cons-check');
    wallData.consoles = [];
    if (consCheckEl && consCheckEl.checked) {
      const consRows = wall.querySelectorAll('.console-row');
      consRows.forEach(row => {
        const typeSel = row.querySelector('.console-type');
        const lenInput = row.querySelector('.console-length');
        const layerInput = row.querySelector('.console-layers');
        const autoBox = row.querySelector('.console-auto');
        const val = parseFloat(lenInput?.value);
        wallData.consoles.push({
          type: typeSel ? typeSel.value : '',
          length: isNaN(val) ? '' : val,
          layers: layerInput ? parseInt(layerInput.value) || 1 : 1,
          auto: autoBox ? autoBox.checked : false
        });
      });
    }
    // Innengeländer: kann mehrere Zeilen haben
    const innerCheckEl = wall.querySelector('.inner-check');
    wallData.inners = [];
    if (innerCheckEl && innerCheckEl.checked) {
      const rows = wall.querySelectorAll('.inner-row');
      rows.forEach(row => {
        const lenInput = row.querySelector('.inner-length');
        const layersInput = row.querySelector('.inner-layers');
        const autoBox = row.querySelector('.inner-auto');
        const val = parseFloat(lenInput?.value);
        wallData.inners.push({
          length: isNaN(val) ? '' : val,
          layers: layersInput ? parseInt(layersInput.value) || 1 : 1,
          auto: autoBox ? autoBox.checked : false
        });
      });
    }
    data.walls.push(wallData);
  });
  return data;
}

/**
 * Lädt ein Projekt aus einem JSON-Objekt und rekonstruiert die Wände.
 * Vor dem Laden werden vorhandene Wände gelöscht. Alle relevanten
 * Eingabefelder werden mit den gespeicherten Werten befüllt.
 * @param {Object} data Das geladene Projektobjekt
 */
function loadProject(data) {
  const wallsContainer = document.getElementById('wallsContainer');
  // Alte Wände entfernen
  wallsContainer.innerHTML = '';
  // Projektname setzen
  const projName = document.getElementById('projectName');
  if (projName && data.projectName !== undefined) {
    projName.value = data.projectName;
  }
  if (!data.walls || !Array.isArray(data.walls)) {
    updateSummary();
    return;
  }
  data.walls.forEach((wallObj, idx) => {
      // Neue Wand hinzufügen
      const wall = createWall(idx + 1);
      wallsContainer.appendChild(wall);
      // Setze Seite und Typ (oder manuelle Seite)
      const sideSel = wall.querySelector('.wall-side');
      const manualSide = wall.querySelector('.wall-side-manual');
      const typeSel = wall.querySelector('.wall-type');
      if (sideSel) {
        if (wallObj.side === '__manual__') {
          sideSel.value = '__manual__';
          manualSide.style.display = '';
          manualSide.value = wallObj.manualSide || '';
        } else {
          sideSel.value = wallObj.side || '';
          manualSide.style.display = 'none';
          manualSide.value = wallObj.manualSide || '';
        }
      }
      if (typeSel) {
        typeSel.value = wallObj.type || '';
        // Trigger change to show copy button or auto add height for Giebel
        typeSel.dispatchEvent(new Event('change'));
      }
      // Setze Höhen
      const heightsContainer = wall.querySelector('.heights');
      const hRows = heightsContainer.querySelectorAll('.height-row');
      // Entferne vorhandene Höhen bis auf erste, dann füge je nach Daten hinzu
      hRows.forEach((r, i) => {
        if (i === 0) {
          // Keep first row
        } else {
          r.remove();
        }
      });
      wallObj.heights = wallObj.heights || [];
      // Wir gehen Höhe für Höhe durch. Für die erste bestehende Zeile setzen wir den Wert,
      // für weitere Höhen klicken wir auf "Höhe hinzufügen" und setzen anschließend den Wert.
      wallObj.heights.forEach((hObj, i) => {
        // Wenn i > 0, füge eine neue Zeile hinzu
        if (i > 0) {
          // Suche den Höhe-Hinzufügen-Button nach seinem Text
          const heightAddBtn = Array.from(wall.querySelectorAll('button.primary')).find(btn => btn.textContent.includes('Höhe'));
          if (heightAddBtn) {
            heightAddBtn.click();
          }
        }
        // Jetzt gibt es ausreichend Zeilen; hole die aktuelle Zeile
        const currentRow = heightsContainer.querySelectorAll('.height-row')[i];
        if (currentRow) {
          const input = currentRow.querySelector('.height');
          const topCheck = currentRow.querySelector('.height-top-extra');
          if (input && hObj.value !== '') input.value = hObj.value;
          if (topCheck) topCheck.checked = (hObj.extra === 2);
        }
      });
      // Setze Mittelwert-Checkbox
      const meanCheck = wall.querySelector('.use-mean-height');
      if (meanCheck) meanCheck.checked = !!wallObj.useMeanHeight;

      // Setze Längen
      const lengthsContainer = wall.querySelector('.lengths');
      const lRows = lengthsContainer.querySelectorAll('.length-row');
      // Entferne alle zusätzlichen Längen außer der ersten
      lRows.forEach((r, i) => {
        if (i === 0) {
          // Keep first
        } else {
          r.remove();
        }
      });
      wallObj.lengths = wallObj.lengths || [];
      wallObj.lengths.forEach((lObj, i) => {
        if (i > 0) {
          // Klicke auf "Länge hinzufügen"
          const lengthAddBtn = Array.from(wall.querySelectorAll('button.primary')).find(btn => btn.textContent.includes('Länge'));
          if (lengthAddBtn) {
            lengthAddBtn.click();
          }
        }
        const currentRow = lengthsContainer.querySelectorAll('.length-row')[i];
        if (currentRow) {
          const input = currentRow.querySelector('.length');
          const extraSel = currentRow.querySelector('.length-extra');
          if (input && lObj.value !== '') input.value = lObj.value;
          if (extraSel) {
            // Umwandlung in String zur Auswahl
            extraSel.value = (lObj.extra !== undefined && lObj.extra !== null) ? String(lObj.extra) : '0';
          }
        }
      });
      // Aktualisiere Gerüstlänge nach Änderungen an Längen
      updateScaffoldingLength(wall);
      // Treppenturm
      const ttCheckEl = wall.querySelector('.tt-check');
      const ttHeightEl = wall.querySelector('.tt-height');
      const ttExtraEl = wall.querySelector('.tt-extra');
      const ttCageEl = wall.querySelector('.tt-cage');
      if (wallObj.tt && wallObj.tt.enabled) {
        if (ttCheckEl) {
          ttCheckEl.checked = true;
          // Zeige Eingabefelder
          if (ttHeightEl) ttHeightEl.style.display = '';
          if (ttExtraEl) ttExtraEl.style.display = '';
          if (ttCageEl) ttCageEl.style.display = '';
        }
        if (ttHeightEl) {
          ttHeightEl.value = wallObj.tt.height || '';
          ttHeightEl.dataset.manual = wallObj.tt.heightManual ? 'true' : 'false';
        }
        if (ttExtraEl) {
          ttExtraEl.checked = !!wallObj.tt.extra;
        }
        if (ttCageEl) {
          ttCageEl.checked = !!wallObj.tt.cage;
        }
      } else {
        if (ttCheckEl) ttCheckEl.checked = false;
      }
      // Staubschutznetz
      const netCheckEl = wall.querySelector('.net-check');
      const netInputEl = wall.querySelector('.net-area');
      if (wallObj.net && wallObj.net.enabled) {
        if (netCheckEl) {
          netCheckEl.checked = true;
          if (netInputEl) netInputEl.style.display = '';
        }
        if (netInputEl) {
          netInputEl.value = wallObj.net.value || '';
          netInputEl.dataset.manual = wallObj.net.manual ? 'true' : 'false';
        }
      } else {
        if (netCheckEl) netCheckEl.checked = false;
        if (netInputEl) {
          netInputEl.value = '';
          netInputEl.dataset.manual = 'false';
          netInputEl.style.display = 'none';
        }
      }
      // Lampen
      const lampCheckEl = wall.querySelector('.lamp-check');
      const lampInputEl = wall.querySelector('.lamp-count');
      if (wallObj.lamp && wallObj.lamp.enabled) {
        if (lampCheckEl) lampCheckEl.checked = true;
        if (lampInputEl) {
          lampInputEl.value = wallObj.lamp.count || '';
          lampInputEl.dataset.manual = wallObj.lamp.manual ? 'true' : 'false';
          lampInputEl.style.display = '';
        }
      } else {
        if (lampCheckEl) lampCheckEl.checked = false;
        if (lampInputEl) {
          lampInputEl.value = '';
          lampInputEl.dataset.manual = 'false';
          lampInputEl.style.display = 'none';
        }
      }
      // Parkplatz
      const parkEl = wall.querySelector('.parking-check');
      const permitEl = wall.querySelector('.permit-check');
      if (parkEl) parkEl.checked = !!wallObj.parking;
      if (permitEl) permitEl.checked = !!wallObj.permit;
      // Tunnelrahmen
      const tunnelCheckEl = wall.querySelector('.tunnel-check');
      const tunnelInputEl = wall.querySelector('.tunnel-length');
      if (wallObj.tunnel && wallObj.tunnel.enabled) {
        if (tunnelCheckEl) tunnelCheckEl.checked = true;
        if (tunnelInputEl) {
          tunnelInputEl.value = wallObj.tunnel.length || '';
          tunnelInputEl.dataset.manual = wallObj.tunnel.manual ? 'true' : 'false';
          tunnelInputEl.style.display = '';
        }
      } else {
        if (tunnelCheckEl) tunnelCheckEl.checked = false;
        if (tunnelInputEl) {
          tunnelInputEl.value = '';
          tunnelInputEl.dataset.manual = 'false';
          tunnelInputEl.style.display = 'none';
        }
      }
      // DF (Dachfang)
      const dfCheckEl = wall.querySelector('.df-check');
      const dfConsoleEl = wall.querySelector('.df-console');
      const dfNetEl = wall.querySelector('.df-net');
      if (wallObj.df && wallObj.df.enabled) {
        if (dfCheckEl) dfCheckEl.checked = true;
        if (dfConsoleEl) {
          dfConsoleEl.value = wallObj.df.console || '';
          dfConsoleEl.dataset.manual = wallObj.df.consoleManual ? 'true' : 'false';
          dfConsoleEl.style.display = '';
        }
        if (dfNetEl) {
          dfNetEl.value = wallObj.df.net || '';
          dfNetEl.dataset.manual = wallObj.df.netManual ? 'true' : 'false';
          dfNetEl.style.display = '';
        }
      } else {
        if (dfCheckEl) dfCheckEl.checked = false;
        if (dfConsoleEl) {
          dfConsoleEl.value = '';
          dfConsoleEl.dataset.manual = 'false';
          dfConsoleEl.style.display = 'none';
        }
        if (dfNetEl) {
          dfNetEl.value = '';
          dfNetEl.dataset.manual = 'false';
          dfNetEl.style.display = 'none';
        }
      }

      // Konsolen
      const consCheckEl = wall.querySelector('.cons-check');
      const consContainer = wall.querySelector('.cons-container');
      if (wallObj.consoles && Array.isArray(wallObj.consoles) && wallObj.consoles.length > 0) {
        if (consCheckEl) consCheckEl.checked = true;
        if (consContainer) {
          consContainer.style.display = '';
          // Entferne vorhandene Reihen (es sollte nur der Add-Button vorhanden sein)
          consContainer.querySelectorAll('.console-row').forEach(r => r.remove());
          const addConsBtn = consContainer.querySelector('button.secondary');
          // Füge jede Konsole hinzu
          wallObj.consoles.forEach((consObj, idx) => {
            // Klicke den Hinzufügen-Button
            if (addConsBtn) {
              addConsBtn.click();
            }
            // Aktuell wurde eine neue Zeile vor dem Button eingefügt
            const rows = consContainer.querySelectorAll('.console-row');
            const row = rows[rows.length - 1];
            if (row) {
              const typeSel = row.querySelector('.console-type');
              const lenInput = row.querySelector('.console-length');
              const layersInput = row.querySelector('.console-layers');
              const autoBox = row.querySelector('.console-auto');
              if (typeSel) typeSel.value = consObj.type || typeSel.value;
              if (lenInput) lenInput.value = consObj.length !== '' ? consObj.length : '';
              if (layersInput) layersInput.value = consObj.layers || 1;
              if (autoBox) autoBox.checked = !!consObj.auto;
              // Wenn auto aktiviert, setze disable state
              if (autoBox && autoBox.checked) {
                lenInput.disabled = true;
              }
            }
          });
        }
      } else {
        if (consCheckEl) consCheckEl.checked = false;
        if (consContainer) {
          consContainer.style.display = 'none';
          // Entferne alle console rows except Add button
          consContainer.querySelectorAll('.console-row').forEach(r => r.remove());
        }
      }
      // Innengeländer
      const innerCheckEl = wall.querySelector('.inner-check');
      const innerContainer = wall.querySelector('.inner-container');
      if (innerCheckEl) {
        // Entferne bereits vorhandene inner rows
        innerContainer.querySelectorAll('.inner-row').forEach(r => r.remove());
        if (wallObj.inners && Array.isArray(wallObj.inners) && wallObj.inners.length > 0) {
          innerCheckEl.checked = true;
          innerContainer.style.display = '';
          // Für jede gespeicherte Innengeländer-Zeile den Hinzufügen-Button klicken
          const addInnerBtn = innerContainer.querySelector('button.secondary');
          wallObj.inners.forEach((innerObj, idx) => {
            if (addInnerBtn) {
              addInnerBtn.click();
            }
            // Die neue Zeile ist jeweils vor dem Button eingefügt, also letzte .inner-row nehmen
            const rows = innerContainer.querySelectorAll('.inner-row');
            const row = rows[rows.length - 1];
            if (row) {
              const lenInput = row.querySelector('.inner-length');
              const layersInput = row.querySelector('.inner-layers');
              const autoBox = row.querySelector('.inner-auto');
              if (lenInput) lenInput.value = innerObj.length !== '' ? innerObj.length : '';
              if (layersInput) layersInput.value = innerObj.layers || 1;
              if (autoBox) {
                autoBox.checked = !!innerObj.auto;
                if (autoBox.checked) {
                  lenInput.disabled = true;
                }
              }
            }
          });
        } else {
          innerCheckEl.checked = false;
          innerContainer.style.display = 'none';
        }
      }
  });
  // After constructing all walls, update summary
  updateSummary();
}

// Initialisierung nach dem Laden des Dokuments
document.addEventListener('DOMContentLoaded', () => {
  const addWallBtn = document.getElementById('addWallBtn');
  const wallsContainer = document.getElementById('wallsContainer');
  addWallBtn.addEventListener('click', () => {
    const wallCount = wallsContainer.children.length + 1;
    const wall = createWall(wallCount);
    wallsContainer.appendChild(wall);
    updateSummary();
  });

  // PDF‑Button verknüpfen
  const pdfBtn = document.getElementById('pdfBtn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', generatePDF);
  }

  // Projekt speichern / laden
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const fileInput = document.getElementById('loadFileInput');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const data = serializeProject();
      if (!data) return;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      // Verwende den Projektnamen als Dateinamen, ansonsten generisch
      const name = data.projectName && data.projectName.trim() !== '' ? data.projectName.trim().replace(/\s+/g, '_') : 'projekt';
      a.href = url;
      a.download = `${name}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
  if (loadBtn && fileInput) {
    loadBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(ev) {
        try {
          const obj = JSON.parse(ev.target.result);
          loadProject(obj);
        } catch (err) {
          alert('Die Projektdatei konnte nicht gelesen werden. Bitte stellen Sie sicher, dass es sich um eine gültige JSON-Datei handelt.');
        }
      };
      reader.readAsText(file);
    });
  }
});

// Erstellt eine PDF‑Datei mit den erfassten Maßen
function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 10;
  doc.setFontSize(16);
  doc.text('Aufmaßbericht', 10, y);
  y += 10;
  // Projekttitel hinzufügen, falls vorhanden
  const projectName = document.getElementById('projectName').value.trim();
  if (projectName) {
    doc.setFontSize(12);
    doc.text(`Projekt: ${projectName}`, 10, y);
    y += 8;
  }
  const wallElements = document.querySelectorAll('#wallsContainer .wall');
  if (wallElements.length === 0) {
    doc.setFontSize(12);
    doc.text('Es wurden keine Wände erfasst.', 10, y);
    doc.save('aufmass.pdf');
    return;
  }
  doc.setFontSize(12);
  let totalArea = 0;
  let totalTunnel = 0;
  // Globale Summen für Extras (analog zur HTML-Zusammenfassung)
  const globalTotalsPDF = {
    lamp: 0,
    cage: 0,
    netArea: 0,
    dfNet: 0,
    consoleLen: 0,
    tunnel: 0,
    parking: 0,
    permit: 0
    , consoles: 0,
    inner: 0
  };
  wallElements.forEach((wall, i) => {
    // Ermittele den Namen aus Seite (mit optionaler manueller Eingabe) und Typ
    let name = '';
    const sideSel = wall.querySelector('.wall-side');
    const manualSide = wall.querySelector('.wall-side-manual');
    const typeSel = wall.querySelector('.wall-type');
    if (sideSel) {
      if (sideSel.value === '__manual__' && manualSide && manualSide.value.trim()) {
        name = manualSide.value.trim();
      } else if (sideSel.value) {
        name = sideSel.value;
      }
    }
    if (typeSel && typeSel.value) {
      name = name ? `${name} ${typeSel.value}` : typeSel.value;
    }
    if (!name) {
      name = `Wand ${i + 1}`;
    }
    // Sammle Längen und ihre individuellen Zuschläge
    const lengthRows = wall.querySelectorAll('.length-row');
    let lengths = [];
    let lengthExtras = [];
    let baseLengthSum = 0;
    let lengthExtraSum = 0;
    lengthRows.forEach(row => {
      const lenInput = row.querySelector('.length');
      const extraSelect = row.querySelector('.length-extra');
      const val = parseFloat(lenInput?.value);
      if (!isNaN(val) && val > 0) {
        lengths.push(val);
        baseLengthSum += val;
      } else {
        lengths.push(0);
      }
      let extra = 0;
      if (extraSelect) {
        extra = parseFloat(extraSelect.value);
        if (isNaN(extra)) extra = 0;
      }
      lengthExtras.push(extra);
      lengthExtraSum += extra;
    });
    // Sammle Höhen und ihre individuellen Top‑Zuschläge
    const heightRows = wall.querySelectorAll('.height-row');
    let heights = [];
    let heightExtras = [];
    heightRows.forEach(row => {
      const hInput = row.querySelector('.height');
      const topExtChk = row.querySelector('.height-top-extra');
      const val = parseFloat(hInput?.value);
      if (!isNaN(val) && val > 0) {
        heights.push(val);
      } else {
        heights.push(0);
      }
      const hExt = topExtChk?.checked ? 2 : 0;
      heightExtras.push(hExt);
    });
    // Mittelwertoption
    const meanCheck = wall.querySelector('.use-mean-height');
    // Berechne angepasste Höhen
    const adjustedHeights = heights.map((h, idx) => h + heightExtras[idx]);
    const validAdjusted = adjustedHeights.filter(h => h > 0);
    let heightForArea = 0;
    if (validAdjusted.length > 0) {
      if (meanCheck?.checked && validAdjusted.length >= 2) {
        const minH = Math.min(...validAdjusted);
        const maxH = Math.max(...validAdjusted);
        heightForArea = (minH + maxH) / 2;
      } else {
        heightForArea = Math.max(...validAdjusted);
      }
    }
    const area = (baseLengthSum + lengthExtraSum) * heightForArea;
    totalArea += area;
    // Baue die Zeilen für das PDF
    let lines = [];
    lines.push(`${name}:`);
    // Höhen mit Zuschlägen
    heightRows.forEach((row, idx) => {
      const hVal = parseFloat(row.querySelector('.height')?.value) || 0;
      let line = `H${idx + 1}: ${hVal.toFixed(2)} m`;
      const hExt = heightExtras[idx];
      if (hVal > 0 && hExt > 0) {
        line += ` + ${hExt.toFixed(2)} m`;
      }
      lines.push(line);
    });
    // Der Mittelwert wird im PDF nicht gesondert aufgeführt, die Berechnung erfolgt dennoch.
    // Längen mit Zuschlägen
    lengthRows.forEach((row, idx) => {
      const lVal = parseFloat(row.querySelector('.length')?.value) || 0;
      let line = `L${idx + 1}: ${lVal.toFixed(2)} m`;
      const lExt = lengthExtras[idx];
      if (lVal > 0 && lExt > 0) {
        line += ` + ${lExt.toFixed(2)} m`;
      }
      lines.push(line);
    });
    if (lengthExtraSum > 0) {
      lines.push(`Gesamtlänge: ${baseLengthSum.toFixed(2)} m + ${lengthExtraSum.toFixed(2)} m`);
    } else {
      lines.push(`Gesamtlänge: ${baseLengthSum.toFixed(2)} m`);
    }
    lines.push(`Fläche: ${area.toFixed(2)} m²`);
    // Zusätzliche Optionen sammeln
    const extras = [];
    const ttCheck = wall.querySelector('.tt-check');
    const ttHeightInput = wall.querySelector('.tt-height');
    const ttCage = wall.querySelector('.tt-cage');
    if (ttCheck && ttCheck.checked) {
      const ttHeightVal = parseFloat(ttHeightInput?.value) || 0;
      if (ttHeightVal > 0) {
        extras.push(`Treppenturm: ${ttHeightVal.toFixed(2)} m`);
      }
      if (ttCage && ttCage.checked) {
        extras.push(`Käfig: 1 x`);
        globalTotalsPDF.cage += 1;
      }
    }
    const netCheck = wall.querySelector('.net-check');
    const netInput = wall.querySelector('.net-area');
    if (netCheck && netCheck.checked) {
      // Netzfläche: nutze manuelle Eingabe oder Standard (Fläche)
      let netVal = area;
      if (netInput) {
        const manualVal = parseFloat(netInput.value);
        if (!isNaN(manualVal) && manualVal > 0) {
          netVal = manualVal;
        }
      }
      extras.push(`Staubschutznetz: ${netVal.toFixed(2)} m²`);
      globalTotalsPDF.netArea += netVal;
    }
    const lampCheck = wall.querySelector('.lamp-check');
    const lampInput = wall.querySelector('.lamp-count');
    if (lampCheck && lampCheck.checked && lampInput) {
      const lampVal = parseFloat(lampInput.value);
      if (!isNaN(lampVal) && lampVal > 0) {
        extras.push(`Lampen: ${lampVal.toFixed(0)}`);
        globalTotalsPDF.lamp += lampVal;
      }
    }
    // Parkplatz und Genehmigung einzeln
    const parkCheck = wall.querySelector('.parking-check');
    const permitCheck = wall.querySelector('.permit-check');
    if (parkCheck && parkCheck.checked) {
      extras.push(`Parkplatz`);
      globalTotalsPDF.parking += 1;
    }
    if (permitCheck && permitCheck.checked) {
      extras.push(`Genehmigung`);
      globalTotalsPDF.permit += 1;
    }
    const tunnelCheckField = wall.querySelector('.tunnel-check');
    const tunnelInputField = wall.querySelector('.tunnel-length');
    if (tunnelCheckField && tunnelCheckField.checked && tunnelInputField) {
      const tunnelVal = parseFloat(tunnelInputField.value);
      if (!isNaN(tunnelVal) && tunnelVal > 0) {
        extras.push(`Tunnelrahmen: ${tunnelVal.toFixed(2)} m`);
        totalTunnel += tunnelVal;
        globalTotalsPDF.tunnel += tunnelVal;
      }
    }
    // DF (Dachfang): Konsolen 0,50 und Netze
    const dfCheckField = wall.querySelector('.df-check');
    const dfConsoleField = wall.querySelector('.df-console');
    const dfNetField = wall.querySelector('.df-net');
    if (dfCheckField && dfCheckField.checked) {
      // DF Netze: berechne Länge (manuell oder gesamte Wandlänge)
      let dfNetVal = 0;
      if (dfNetField) {
        const manualNet = parseFloat(dfNetField.value);
        if (isNaN(manualNet) || manualNet <= 0) {
          dfNetVal = baseLengthSum + lengthExtraSum;
        } else {
          dfNetVal = manualNet;
        }
        if (dfNetVal > 0) {
          extras.push(`DF Netze: ${dfNetVal.toFixed(2)} m`);
          globalTotalsPDF.dfNet += dfNetVal;
        }
      }
      // DF Konsolen: Standard = gleiche Länge wie DF Netze, sofern keine manuelle Eingabe vorhanden
      if (dfConsoleField) {
        let consoleVal = parseFloat(dfConsoleField.value);
        if (isNaN(consoleVal) || consoleVal <= 0) {
          consoleVal = dfNetVal;
        }
        if (!isNaN(consoleVal) && consoleVal > 0) {
          extras.push(`Konsole 0,50: ${consoleVal.toFixed(2)} m`);
          globalTotalsPDF.consoleLen += consoleVal;
        }
      }
    }

    // Konsolen (mehrere möglich)
    const consCheck = wall.querySelector('.cons-check');
    if (consCheck && consCheck.checked) {
      const consRows = wall.querySelectorAll('.console-row');
      consRows.forEach(row => {
        const typeSel = row.querySelector('.console-type');
        const lenInput = row.querySelector('.console-length');
        const layersInput = row.querySelector('.console-layers');
        const lenVal = parseFloat(lenInput?.value);
        const layVal = parseInt(layersInput?.value) || 1;
        if (!isNaN(lenVal) && lenVal > 0) {
          const totalLen = lenVal * layVal;
          extras.push(`${typeSel && typeSel.value ? typeSel.value : 'Konsole'}: ${totalLen.toFixed(2)} m (${layVal} Lagen)`);
          globalTotalsPDF.consoles += totalLen;
        }
      });
    }
    // Innengeländer – mehrere Zeilen möglich
    const innerCheck = wall.querySelector('.inner-check');
    if (innerCheck && innerCheck.checked) {
      const innerRows = wall.querySelectorAll('.inner-row');
      innerRows.forEach(row => {
        const lenInput = row.querySelector('.inner-length');
        const layersInput = row.querySelector('.inner-layers');
        const lenVal = parseFloat(lenInput?.value);
        const layVal = parseInt(layersInput?.value) || 1;
        if (!isNaN(lenVal) && lenVal > 0) {
          const totalLen = lenVal * layVal;
          extras.push(`Innengeländer: ${totalLen.toFixed(2)} m (${layVal} Lagen)`);
          globalTotalsPDF.inner += totalLen;
        }
      });
    }
    // Leere Zeile zwischen Hauptteil und Extras
    if (extras.length > 0) {
      lines.push('');
      extras.forEach(ex => lines.push(ex));
    }
    // Gib die Zeilen aus
    const pdfLines = doc.splitTextToSize(lines.join('\n'), 190);
    pdfLines.forEach(l => {
      if (y > 280) {
        doc.addPage();
        y = 10;
      }
      doc.text(l, 10, y);
      y += 6;
    });
  });
  // Gesamtsumme der Fläche ausgeben
  if (y > 280) {
    doc.addPage();
    y = 10;
  }
  doc.setFontSize(12);
  doc.text('---', 10, y);
  y += 6;
  doc.text(`Gesamt Fläche: ${totalArea.toFixed(2)} m²`, 10, y);
  // Ausgabe der summierten Extras
  let extrasLines = [];
  if (globalTotalsPDF.lamp > 0) {
    extrasLines.push(`Lampen: ${globalTotalsPDF.lamp.toFixed(0)} ×`);
  }
  if (globalTotalsPDF.cage > 0) {
    extrasLines.push(`Käfig: ${globalTotalsPDF.cage.toFixed(0)} ×`);
  }
  if (globalTotalsPDF.netArea > 0) {
    extrasLines.push(`Staubschutznetz: ${globalTotalsPDF.netArea.toFixed(2)} m²`);
  }
  if (globalTotalsPDF.dfNet > 0) {
    extrasLines.push(`DF Netze: ${globalTotalsPDF.dfNet.toFixed(2)} m`);
  }
  if (globalTotalsPDF.consoleLen > 0) {
    extrasLines.push(`Konsole 0,50: ${globalTotalsPDF.consoleLen.toFixed(2)} m`);
  }
  if (globalTotalsPDF.tunnel > 0) {
    extrasLines.push(`Tunnelrahmen: ${globalTotalsPDF.tunnel.toFixed(2)} m`);
  }
  if (globalTotalsPDF.parking > 0) {
    extrasLines.push(`Parkplatz: ${globalTotalsPDF.parking.toFixed(0)}`);
  }
  if (globalTotalsPDF.permit > 0) {
    extrasLines.push(`Genehmigung: ${globalTotalsPDF.permit.toFixed(0)}`);
  }
  // Konsolen und Innengeländer (Summe aller Wände)
  if (globalTotalsPDF.consoles > 0) {
    extrasLines.push(`Konsolen: ${globalTotalsPDF.consoles.toFixed(2)} m`);
  }
  if (globalTotalsPDF.inner > 0) {
    extrasLines.push(`Innengeländer: ${globalTotalsPDF.inner.toFixed(2)} m`);
  }
  if (extrasLines.length > 0) {
    y += 6;
    doc.text('Gesamt Extras:', 10, y);
    y += 6;
    extrasLines.forEach(line => {
      if (y > 280) {
        doc.addPage();
        y = 10;
      }
      doc.text(line, 10, y);
      y += 6;
    });
  }
  doc.save('aufmass.pdf');
}