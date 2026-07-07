(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    merged: {},
    sourceFiles: {},
    localeToFile: {},
    keyToFile: {},
    locales: [],
    keys: [],
    dirty: new Map(),
    pending: new Map(),
    hasContent: false,
  };

  const searchInput = document.getElementById('searchInput');
  const saveAllButton = document.getElementById('saveAllButton');
  const openSettingsButton = document.getElementById('openSettingsButton');
  const summary = document.getElementById('summary');
  const status = document.getElementById('status');
  const tableHost = document.getElementById('tableHost');

  openSettingsButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

  saveAllButton.addEventListener('click', () => {
    saveDirtyTranslations();
  });

  searchInput.addEventListener('input', () => {
    renderTable();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'content':
        applyContentMessage(message);
        break;
      case 'saved':
        applySavedMessage(message);
        break;
      case 'saveError':
        applySaveErrorMessage(message);
        break;
    }
  });

  function applyContentMessage(message) {
    if (state.hasContent && (state.dirty.size > 0 || state.pending.size > 0)) {
      return;
    }

    const payload =
      typeof message.data === 'string'
        ? parseJson(message.data, {
            merged: {},
            sourceFiles: {},
            localeToFile: {},
            keyToFile: {},
          })
        : message;

    state.merged = isObject(payload.merged) ? payload.merged : {};
    state.sourceFiles = isObject(payload.sourceFiles) ? payload.sourceFiles : {};
    state.localeToFile = isObject(payload.localeToFile) ? payload.localeToFile : {};
    state.keyToFile = isObject(payload.keyToFile) ? payload.keyToFile : {};
    state.dirty.clear();
    state.pending.clear();
    state.hasContent = true;

    rebuildIndex();
    renderTable();
    updateDirtyState();
    setStatus('', 'neutral');
  }

  function applySavedMessage(message) {
    const pending = state.pending.get(String(message.requestId));

    if (!pending) {
      return;
    }

    state.pending.delete(String(message.requestId));

    if (!state.merged[pending.locale]) {
      state.merged[pending.locale] = {};
    }

    state.merged[pending.locale][pending.key] = pending.value;
    setSourceFile(pending.locale, pending.key, pending.filePath);
    state.keyToFile[pending.key] = pending.filePath;

    const dirty = state.dirty.get(pending.id);

    if (dirty && dirty.value === pending.value) {
      state.dirty.delete(pending.id);
    }

    updateDirtyState();

    if (state.pending.size === 0 && state.dirty.size === 0) {
      setStatus('Saved changes.', 'success');
      renderTable();
    }
  }

  function applySaveErrorMessage(message) {
    const requestId = String(message.requestId);
    state.pending.delete(requestId);
    setStatus(message.message || 'Failed to save translation.', 'error');
    updateDirtyState();
    renderTable();
  }

  function rebuildIndex() {
    state.locales = Object.keys(state.merged).sort((a, b) => a.localeCompare(b));

    const keys = new Set();

    for (const locale of state.locales) {
      const translations = state.merged[locale];

      if (!isObject(translations)) {
        continue;
      }

      for (const key of Object.keys(translations)) {
        keys.add(key);
      }
    }

    state.keys = Array.from(keys).sort((a, b) => a.localeCompare(b));
  }

  function renderTable() {
    if (state.locales.length === 0) {
      tableHost.innerHTML = '<div class="emptyState">No translations loaded.</div>';
      updateSummary(0);
      return;
    }

    const visibleKeys = getVisibleKeys();
    updateSummary(visibleKeys.length);

    if (visibleKeys.length === 0) {
      tableHost.innerHTML = '<div class="emptyState">No matching translations.</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'translationsTable';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(createHeaderCell('Key', 'keyColumn'));
    headerRow.appendChild(createHeaderCell('Files', 'fileColumn'));

    for (const locale of state.locales) {
      headerRow.appendChild(createHeaderCell(locale, 'localeColumn'));
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (const key of visibleKeys) {
      const row = document.createElement('tr');
      const filePaths = getSourceFilesForKey(key);

      row.appendChild(createTextCell(key, 'keyCell', key));
      row.appendChild(
        createTextCell(formatFileNames(filePaths), 'fileCell', filePaths.join('\n')),
      );

      for (const locale of state.locales) {
        row.appendChild(createTranslationCell(locale, key));
      }

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    tableHost.replaceChildren(table);
  }

  function createHeaderCell(text, className) {
    const cell = document.createElement('th');
    cell.className = className;
    cell.scope = 'col';
    cell.textContent = text;
    return cell;
  }

  function createTextCell(text, className, title) {
    const cell = document.createElement('td');
    cell.className = className;
    cell.textContent = text || '-';
    cell.title = title || '';
    return cell;
  }

  function createTranslationCell(locale, key) {
    const cell = document.createElement('td');
    const id = cellId(locale, key);
    const originalValue = getTranslationValue(locale, key);
    const filePath = getSourceFile(locale, key);
    const dirty = state.dirty.get(id);

    const textarea = document.createElement('textarea');
    textarea.className = 'translationInput';
    textarea.value = dirty ? dirty.value : originalValue;
    textarea.rows = 2;
    textarea.spellcheck = false;
    textarea.dataset.locale = locale;
    textarea.dataset.key = key;
    textarea.dataset.filePath = filePath;
    textarea.title = `${locale}: ${key}`;
    textarea.classList.toggle('dirtyInput', Boolean(dirty));

    if (!filePath) {
      textarea.disabled = true;
      textarea.placeholder = 'No source file';
    }

    textarea.addEventListener('input', () => {
      markDirty({
        id,
        locale,
        key,
        filePath,
        value: textarea.value,
        originalValue,
      });
      textarea.classList.toggle('dirtyInput', state.dirty.has(id));
    });

    cell.appendChild(textarea);
    return cell;
  }

  function markDirty(entry) {
    if (entry.value === entry.originalValue) {
      state.dirty.delete(entry.id);
    } else {
      state.dirty.set(entry.id, entry);
    }

    updateDirtyState();
  }

  function saveDirtyTranslations() {
    if (state.dirty.size === 0 || state.pending.size > 0) {
      return;
    }

    let sent = 0;

    for (const dirty of state.dirty.values()) {
      if (!dirty.filePath) {
        setStatus(`Cannot save ${dirty.key}: missing source file.`, 'error');
        continue;
      }

      const requestId = `${Date.now()}-${sent}-${Math.random().toString(36).slice(2)}`;
      const pending = { ...dirty, requestId };
      state.pending.set(requestId, pending);

      vscode.postMessage({
        type: 'save',
        requestId,
        filePath: dirty.filePath,
        locale: dirty.locale,
        key: dirty.key,
        value: dirty.value,
      });

      sent += 1;
    }

    if (sent > 0) {
      setStatus(`Saving ${sent} change${sent === 1 ? '' : 's'}...`, 'neutral');
    }

    updateDirtyState();
    renderTable();
  }

  function getVisibleKeys() {
    const query = searchInput.value.trim().toLocaleLowerCase();

    if (!query) {
      return state.keys;
    }

    return state.keys.filter((key) => {
      if (key.toLocaleLowerCase().includes(query)) {
        return true;
      }

      return state.locales.some((locale) =>
        getTranslationValue(locale, key).toLocaleLowerCase().includes(query),
      );
    });
  }

  function updateSummary(visibleCount) {
    const localeCount = state.locales.length;
    const keyCount = state.keys.length;
    summary.textContent = `${visibleCount} of ${keyCount} keys across ${localeCount} locale${
      localeCount === 1 ? '' : 's'
    }`;
  }

  function updateDirtyState() {
    const dirtyCount = state.dirty.size;
    const pendingCount = state.pending.size;
    saveAllButton.disabled = dirtyCount === 0 || pendingCount > 0;
    saveAllButton.textContent =
      pendingCount > 0
        ? `Saving ${pendingCount}`
        : dirtyCount > 0
          ? `Save ${dirtyCount}`
          : 'Save all';
  }

  function setStatus(message, tone) {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function getTranslationValue(locale, key) {
    const translations = state.merged[locale];

    if (!isObject(translations)) {
      return '';
    }

    const value = translations[key];
    return typeof value === 'string' ? value : '';
  }

  function getSourceFilesForKey(key) {
    const filePaths = new Set();

    for (const locale of state.locales) {
      const filePath = getSourceFile(locale, key);

      if (filePath) {
        filePaths.add(filePath);
      }
    }

    return Array.from(filePaths);
  }

  function getSourceFile(locale, key) {
    const localeSources = state.sourceFiles[locale];

    if (isObject(localeSources) && typeof localeSources[key] === 'string') {
      return localeSources[key];
    }

    if (typeof state.localeToFile[locale] === 'string') {
      return state.localeToFile[locale];
    }

    if (typeof state.keyToFile[key] === 'string') {
      return state.keyToFile[key];
    }

    return '';
  }

  function setSourceFile(locale, key, filePath) {
    if (!isObject(state.sourceFiles[locale])) {
      state.sourceFiles[locale] = {};
    }

    state.sourceFiles[locale][key] = filePath;
    state.localeToFile[locale] = filePath;
    state.keyToFile[key] = filePath;
  }

  function cellId(locale, key) {
    return `${locale}\u0000${key}`;
  }

  function basename(filePath) {
    if (!filePath) {
      return '';
    }

    return filePath.split(/[\\/]/).pop() || filePath;
  }

  function formatFileNames(filePaths) {
    if (filePaths.length === 0) {
      return '-';
    }

    return filePaths.map((filePath) => basename(filePath)).join(', ');
  }

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  vscode.postMessage({ type: 'ready' });
  setTimeout(() => vscode.postMessage({ type: 'ready' }), 500);
})();
