(function () {
  const vscode = acquireVsCodeApi();

  const ROW_HEIGHT = 32;
  const OVERSCAN_ROWS = 6;
  const SEARCH_DEBOUNCE_MS = 120;

  const state = {
    merged: {},
    files: [],
    sourceFileIds: {},
    localeFileIds: {},
    keyFileIds: {},
    locales: [],
    selectedLocales: new Set(),
    keys: [],
    treeRoots: [],
    visibleRows: [],
    visibleKeyCount: 0,
    searchTextByKey: new Map(),
    expandedGroups: new Set(),
    dirty: new Map(),
    pending: new Map(),
    hasContent: false,
    tableBody: null,
    renderFrame: 0,
    searchTimer: 0,
  };

  const searchInput = document.getElementById('searchInput');
  const localeFilterButton = document.getElementById('localeFilterButton');
  const localeFilterPanel = document.getElementById('localeFilterPanel');
  const localeFilterList = document.getElementById('localeFilterList');
  const collapseAllButton = document.getElementById('collapseAllButton');
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

  collapseAllButton.addEventListener('click', () => {
    collapseAllGroups();
  });

  localeFilterButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleLocaleFilter();
  });

  localeFilterPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  searchInput.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.searchTimer = 0;
      rebuildVisibleRows();
      renderTable({ resetScroll: true });
      updateTreeControls();
    }, SEARCH_DEBOUNCE_MS);
  });

  tableHost.addEventListener('scroll', () => {
    scheduleVirtualRender();
  });

  window.addEventListener('click', () => {
    closeLocaleFilter();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeLocaleFilter();
    }
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
      case 'empty':
        applyLoadStateMessage(message, 'neutral');
        break;
      case 'loadError':
        applyLoadStateMessage(message, 'error');
        break;
    }
  });

  function applyContentMessage(message) {
    if (state.hasContent && (state.dirty.size > 0 || state.pending.size > 0)) {
      return;
    }

    const startedAt = performance.now();
    const payload =
      typeof message.data === 'string'
        ? parseJson(message.data, {
            merged: {},
            files: [],
            sourceFileIds: {},
            localeFileIds: {},
            keyFileIds: {},
          })
        : message;

    state.merged = isObject(payload.merged) ? payload.merged : {};
    state.files = Array.isArray(payload.files) ? payload.files.filter(isString) : [];
    state.sourceFileIds = isObject(payload.sourceFileIds) ? payload.sourceFileIds : {};
    state.localeFileIds = isObject(payload.localeFileIds) ? payload.localeFileIds : {};
    state.keyFileIds = isObject(payload.keyFileIds) ? payload.keyFileIds : {};
    state.dirty.clear();
    state.pending.clear();
    state.expandedGroups.clear();
    state.hasContent = true;

    rebuildIndex();
    state.selectedLocales = new Set(state.locales);
    renderLocaleFilter();
    rebuildTree();
    rebuildVisibleRows();
    renderTable({ resetScroll: true });
    updateDirtyState();
    updateTreeControls();
    setStatus('', 'neutral');

    console.log(
      `SF Translations Manager: indexed and rendered ${state.keys.length} keys in ${Math.round(
        performance.now() - startedAt,
      )}ms.`,
    );
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
    setSourceFileId(pending.locale, pending.key, pending.fileId);
    updateSearchText(pending.key);

    const dirty = state.dirty.get(pending.id);

    if (dirty && dirty.value === pending.value) {
      state.dirty.delete(pending.id);
    }

    updateDirtyState();

    if (state.pending.size === 0 && state.dirty.size === 0) {
      setStatus('Saved changes.', 'success');
      renderVisibleRows();
    }
  }

  function applySaveErrorMessage(message) {
    const requestId = String(message.requestId);
    state.pending.delete(requestId);
    setStatus(message.message || 'Failed to save translation.', 'error');
    updateDirtyState();
    renderVisibleRows();
  }

  function applyLoadStateMessage(message, tone) {
    const text = message.message || 'No translations loaded.';
    state.tableBody = null;
    tableHost.innerHTML = `<div class="emptyState">${escapeHtml(text)}</div>`;
    summary.textContent = 'No translations loaded.';
    setStatus(text, tone);
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
    state.searchTextByKey.clear();

    for (const key of state.keys) {
      updateSearchText(key);
    }
  }

  function rebuildTree() {
    const root = createTreeNode('', '', -1);

    for (const key of state.keys) {
      const parts = key.split('.');
      let current = root;
      let path = '';

      for (let index = 0; index < parts.length; index += 1) {
        const rawSegment = parts[index];
        const segment = rawSegment || '(empty)';
        path = index === 0 ? rawSegment : `${path}.${rawSegment}`;

        if (!current.childMap.has(rawSegment)) {
          current.childMap.set(rawSegment, createTreeNode(segment, path, index));
        }

        current = current.childMap.get(rawSegment);
      }

      current.leafKey = key;
    }

    sortTree(root);
    state.treeRoots = root.children;
  }

  function createTreeNode(segment, path, depth) {
    return {
      segment,
      path,
      depth,
      childMap: new Map(),
      children: [],
      leafKey: '',
    };
  }

  function sortTree(node) {
    node.children = Array.from(node.childMap.values()).sort((a, b) =>
      a.segment.localeCompare(b.segment),
    );

    for (const child of node.children) {
      sortTree(child);
    }
  }

  function rebuildVisibleRows() {
    const query = getSearchQuery();

    if (query) {
      const matchingKeys = state.keys.filter((key) => keyMatchesQuery(key, query));

      state.visibleRows = matchingKeys.map((key) =>
        createTranslationRow(key, key.split('.').length - 1, key),
      );
      state.visibleKeyCount = matchingKeys.length;
      updateSummary();
      return;
    }

    const rows = [];

    for (const node of state.treeRoots) {
      appendTreeRows(node, rows);
    }

    state.visibleRows = rows;
    state.visibleKeyCount = state.keys.length;
    updateSummary();
  }

  function appendTreeRows(node, rows) {
    const hasChildren = node.children.length > 0;

    if (hasChildren) {
      rows.push({
        kind: 'group',
        id: node.path,
        label: node.segment,
        path: node.path,
        depth: node.depth,
        expanded: state.expandedGroups.has(node.path),
      });

      if (!state.expandedGroups.has(node.path)) {
        return;
      }
    }

    if (node.leafKey) {
      rows.push(createTranslationRow(node.leafKey, node.depth, node.segment));
    }

    if (!hasChildren || !state.expandedGroups.has(node.path)) {
      return;
    }

    for (const child of node.children) {
      appendTreeRows(child, rows);
    }
  }

  function createTranslationRow(key, depth, label) {
    return {
      kind: 'translation',
      id: key,
      key,
      label,
      depth,
    };
  }

  function renderTable({ resetScroll = false } = {}) {
    state.tableBody = null;

    if (state.locales.length === 0) {
      tableHost.innerHTML = '<div class="emptyState">No translations loaded.</div>';
      updateSummary();
      return;
    }

    const visibleLocales = getVisibleLocales();

    if (state.visibleRows.length === 0) {
      tableHost.innerHTML = '<div class="emptyState">No matching translations.</div>';
      return;
    }

    const previousScrollTop = resetScroll ? 0 : tableHost.scrollTop;
    const table = document.createElement('table');
    table.className = 'translationsTable';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(createHeaderCell('Key', 'keyColumn'));

    for (const locale of visibleLocales) {
      headerRow.appendChild(createHeaderCell(locale, 'localeColumn'));
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    state.tableBody = document.createElement('tbody');
    table.appendChild(state.tableBody);
    tableHost.replaceChildren(table);
    tableHost.scrollTop = previousScrollTop;
    renderVisibleRows();
  }

  function scheduleVirtualRender() {
    if (state.renderFrame) {
      return;
    }

    state.renderFrame = window.requestAnimationFrame(() => {
      state.renderFrame = 0;
      renderVisibleRows();
    });
  }

  function renderVisibleRows() {
    if (!state.tableBody) {
      return;
    }

    const totalRows = state.visibleRows.length;
    const viewportHeight = tableHost.clientHeight || ROW_HEIGHT * 10;
    const startIndex = Math.max(
      0,
      Math.floor(tableHost.scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
    );
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2;
    const endIndex = Math.min(totalRows, startIndex + visibleCount);
    const fragment = document.createDocumentFragment();

    if (startIndex > 0) {
      fragment.appendChild(createSpacerRow(startIndex * ROW_HEIGHT));
    }

    for (let index = startIndex; index < endIndex; index += 1) {
      const row = state.visibleRows[index];
      fragment.appendChild(
        row.kind === 'group' ? createGroupRow(row) : createTranslationTableRow(row),
      );
    }

    if (endIndex < totalRows) {
      fragment.appendChild(createSpacerRow((totalRows - endIndex) * ROW_HEIGHT));
    }

    state.tableBody.replaceChildren(fragment);
  }

  function createSpacerRow(height) {
    const row = document.createElement('tr');
    row.className = 'spacerRow';

    const cell = document.createElement('td');
    cell.colSpan = getVisibleLocales().length + 1;
    cell.style.height = `${height}px`;
    row.appendChild(cell);

    return row;
  }

  function createGroupRow(rowData) {
    const row = document.createElement('tr');
    row.className = 'groupRow';
    row.style.height = `${ROW_HEIGHT}px`;
    row.addEventListener('click', () => {
      toggleGroup(rowData.path);
    });

    const keyCell = document.createElement('td');
    keyCell.className = 'keyCell groupKeyCell';
    keyCell.style.setProperty('--tree-indent', `${Math.max(0, rowData.depth) * 14}px`);

    const toggle = document.createElement('button');
    toggle.className = 'treeToggle';
    toggle.type = 'button';
    toggle.textContent = rowData.expanded ? '-' : '+';
    toggle.setAttribute(
      'aria-label',
      `${rowData.expanded ? 'Collapse' : 'Expand'} ${rowData.path}`,
    );

    const label = document.createElement('span');
    label.className = 'treeLabel';
    label.textContent = rowData.label;
    label.title = rowData.path;

    keyCell.append(toggle, label);
    row.appendChild(keyCell);

    const visibleLocaleCount = getVisibleLocales().length;

    if (visibleLocaleCount > 0) {
      const detailsCell = document.createElement('td');
      detailsCell.className = 'groupDetailsCell';
      detailsCell.colSpan = visibleLocaleCount;
      detailsCell.title = rowData.path;
      row.appendChild(detailsCell);
    }

    return row;
  }

  function createTranslationTableRow(rowData) {
    const row = document.createElement('tr');
    row.className = 'translationRow';
    row.style.height = `${ROW_HEIGHT}px`;

    row.appendChild(createKeyCell(rowData));

    for (const locale of getVisibleLocales()) {
      row.appendChild(createTranslationCell(locale, rowData.key));
    }

    return row;
  }

  function toggleGroup(path) {
    if (state.expandedGroups.has(path)) {
      state.expandedGroups.delete(path);
    } else {
      state.expandedGroups.add(path);
    }

    rebuildVisibleRows();
    renderTable();
    updateTreeControls();
  }

  function collapseAllGroups() {
    if (state.expandedGroups.size === 0) {
      return;
    }

    state.expandedGroups.clear();
    rebuildVisibleRows();
    renderTable({ resetScroll: true });
    updateTreeControls();
  }

  function createHeaderCell(text, className) {
    const cell = document.createElement('th');
    cell.className = className;
    cell.scope = 'col';
    cell.textContent = text;
    return cell;
  }

  function createKeyCell(rowData) {
    const cell = document.createElement('td');
    cell.className = 'keyCell translationKeyCell';
    cell.style.setProperty('--tree-indent', `${Math.max(0, rowData.depth) * 14}px`);
    cell.title = formatKeyTitle(rowData.key, getSourceFileIdsForKey(rowData.key));

    const label = document.createElement('span');
    label.className = 'treeLabel';
    label.textContent = rowData.label || rowData.key;

    cell.appendChild(label);
    return cell;
  }

  function createTranslationCell(locale, key) {
    const cell = document.createElement('td');
    const id = cellId(locale, key);
    const originalValue = getTranslationValue(locale, key);
    const fileId = getSourceFileId(locale, key);
    const dirty = state.dirty.get(id);

    const textarea = document.createElement('textarea');
    textarea.className = 'translationInput';
    textarea.value = dirty ? dirty.value : originalValue;
    textarea.rows = 2;
    textarea.spellcheck = false;
    textarea.dataset.locale = locale;
    textarea.dataset.key = key;
    textarea.title = `${locale}: ${key}`;
    textarea.classList.toggle('dirtyInput', Boolean(dirty));

    if (fileId === undefined) {
      textarea.disabled = true;
      textarea.placeholder = 'No source file';
    } else {
      textarea.dataset.fileId = String(fileId);
    }

    textarea.addEventListener('input', () => {
      markDirty({
        id,
        locale,
        key,
        fileId,
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
      if (dirty.fileId === undefined) {
        setStatus(`Cannot save ${dirty.key}: missing source file.`, 'error');
        continue;
      }

      const requestId = `${Date.now()}-${sent}-${Math.random().toString(36).slice(2)}`;
      const pending = { ...dirty, requestId };
      state.pending.set(requestId, pending);

      vscode.postMessage({
        type: 'save',
        requestId,
        fileId: dirty.fileId,
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
    renderVisibleRows();
  }

  function updateSummary() {
    const localeCount = state.locales.length;
    const visibleLocaleCount = getVisibleLocales().length;
    const keyCount = state.keys.length;
    const query = getSearchQuery();

    if (keyCount === 0 || localeCount === 0) {
      summary.textContent = 'No translations loaded.';
      return;
    }

    if (query) {
      summary.textContent = `${state.visibleKeyCount} of ${keyCount} keys across ${visibleLocaleCount} of ${localeCount} locale${
        localeCount === 1 ? '' : 's'
      }`;
      return;
    }

    summary.textContent = `${keyCount} keys across ${visibleLocaleCount} of ${localeCount} locale${
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

  function updateTreeControls() {
    collapseAllButton.disabled = state.expandedGroups.size === 0 || Boolean(getSearchQuery());
  }

  function renderLocaleFilter() {
    localeFilterList.replaceChildren();

    for (const locale of state.locales) {
      const label = document.createElement('label');
      label.className = 'localeFilterOption';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selectedLocales.has(locale);
      checkbox.addEventListener('change', () => {
        setLocaleSelected(locale, checkbox.checked);
      });

      const text = document.createElement('span');
      text.textContent = locale;

      label.append(checkbox, text);
      localeFilterList.appendChild(label);
    }

    updateLocaleFilterButton();
  }

  function setLocaleSelected(locale, selected) {
    if (selected) {
      state.selectedLocales.add(locale);
    } else {
      state.selectedLocales.delete(locale);
    }

    rebuildVisibleRows();
    renderTable();
    updateLocaleFilterButton();
  }

  function toggleLocaleFilter() {
    if (localeFilterPanel.hidden) {
      localeFilterPanel.hidden = false;
      localeFilterButton.setAttribute('aria-expanded', 'true');
      return;
    }

    closeLocaleFilter();
  }

  function closeLocaleFilter() {
    if (localeFilterPanel.hidden) {
      return;
    }

    localeFilterPanel.hidden = true;
    localeFilterButton.setAttribute('aria-expanded', 'false');
  }

  function updateLocaleFilterButton() {
    const selectedCount = getVisibleLocales().length;
    const localeCount = state.locales.length;
    localeFilterButton.disabled = localeCount === 0;
    localeFilterButton.textContent = `Locales ${selectedCount}/${localeCount}`;
  }

  function setStatus(message, tone) {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function getSearchQuery() {
    return searchInput.value.trim().toLocaleLowerCase();
  }

  function getVisibleLocales() {
    return state.locales.filter((locale) => state.selectedLocales.has(locale));
  }

  function keyMatchesQuery(key, query) {
    if (key.toLocaleLowerCase().includes(query)) {
      return true;
    }

    return getVisibleLocales().some((locale) =>
      getTranslationValue(locale, key).toLocaleLowerCase().includes(query),
    );
  }

  function getTranslationValue(locale, key) {
    const translations = state.merged[locale];

    if (!isObject(translations)) {
      return '';
    }

    const value = translations[key];
    return typeof value === 'string' ? value : '';
  }

  function updateSearchText(key) {
    const values = [key];

    for (const locale of state.locales) {
      values.push(getTranslationValue(locale, key));
    }

    state.searchTextByKey.set(key, values.join('\n').toLocaleLowerCase());
  }

  function getSourceFileIdsForKey(key) {
    const fileIds = new Set();

    for (const locale of state.locales) {
      const fileId = getSourceFileId(locale, key);

      if (fileId !== undefined) {
        fileIds.add(fileId);
      }
    }

    return Array.from(fileIds);
  }

  function getSourceFileId(locale, key) {
    const localeSources = state.sourceFileIds[locale];

    if (isObject(localeSources) && isSafeFileId(localeSources[key])) {
      return localeSources[key];
    }

    if (isSafeFileId(state.localeFileIds[locale])) {
      return state.localeFileIds[locale];
    }

    if (isSafeFileId(state.keyFileIds[key])) {
      return state.keyFileIds[key];
    }

    return undefined;
  }

  function setSourceFileId(locale, key, fileId) {
    if (!isObject(state.sourceFileIds[locale])) {
      state.sourceFileIds[locale] = {};
    }

    state.sourceFileIds[locale][key] = fileId;
    state.localeFileIds[locale] = fileId;
    state.keyFileIds[key] = fileId;
  }

  function cellId(locale, key) {
    return `${locale}\u0000${key}`;
  }

  function fileTitle(fileIds) {
    return fileIds
      .map((fileId) => basename(filePath(fileId)))
      .filter(Boolean)
      .join('\n');
  }

  function formatKeyTitle(key, fileIds) {
    const files = fileTitle(fileIds);

    if (!files) {
      return key;
    }

    return `${key}\n\nFiles:\n${files}`;
  }

  function filePath(fileId) {
    return isSafeFileId(fileId) ? state.files[fileId] || '' : '';
  }

  function basename(filePathValue) {
    if (!filePathValue) {
      return '';
    }

    return filePathValue.split(/[\\/]/).pop() || filePathValue;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function isString(value) {
    return typeof value === 'string';
  }

  function isSafeFileId(value) {
    return Number.isSafeInteger(value) && value >= 0 && value < state.files.length;
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  vscode.postMessage({ type: 'ready' });
  setTimeout(() => vscode.postMessage({ type: 'ready' }), 500);
})();
