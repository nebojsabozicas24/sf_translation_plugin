"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The vscode module is provided by VS Code at extension runtime.
const vscode = require("vscode");
const DEFAULT_TRANSLATIONS_GLOB = '**/__generated__/translations*.json';
const DEFAULT_PANEL_TITLE = 'SF Translations Manager';
function activate(context) {
    const openCommand = vscode.commands.registerCommand('sfTranslationsManager.open', async () => {
        await openTranslationPanel(context);
    });
    const openSettingsCommand = vscode.commands.registerCommand('sfTranslationsManager.openSettings', () => {
        void openExtensionSettings();
    });
    context.subscriptions.push(openCommand, openSettingsCommand);
}
function deactivate() { }
function getTranslationsGlob() {
    return (vscode.workspace
        .getConfiguration('sfTranslationsManager')
        .get('translationsLocation') ?? DEFAULT_TRANSLATIONS_GLOB);
}
async function findTranslationFiles() {
    const files = await vscode.workspace.findFiles(getTranslationsGlob());
    return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}
async function openTranslationPanel(context) {
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'webview');
    const panelTitle = await getPanelTitleFromHtml(webviewRoot);
    const panel = vscode.window.createWebviewPanel('sfTranslationsManager', panelTitle, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
    });
    let snapshot;
    let validFilePaths = new Set();
    let loadState;
    const enqueueSave = createSaveQueue();
    let didSendContent = false;
    let didReportPostMessageFailure = false;
    const reportPostMessageFailure = (error) => {
        console.error('SF Translations Manager: failed to send content to webview.', error);
        if (didReportPostMessageFailure) {
            return;
        }
        didReportPostMessageFailure = true;
        vscode.window.showErrorMessage('Failed to send translations to the webview. The payload may be too large.');
    };
    const sendContent = async () => {
        if (didSendContent || !snapshot) {
            return;
        }
        const postStartedAt = Date.now();
        try {
            const sent = await panel.webview.postMessage({
                type: 'content',
                merged: snapshot.merged,
                files: snapshot.files,
                sourceFileIds: snapshot.sourceFileIds,
                localeFileIds: snapshot.localeFileIds,
                keyFileIds: snapshot.keyFileIds,
            });
            if (!sent) {
                throw new Error('Webview rejected the content message.');
            }
        }
        catch (error) {
            try {
                const sent = await panel.webview.postMessage({
                    type: 'content',
                    data: JSON.stringify(snapshot),
                });
                if (!sent) {
                    throw new Error('Webview rejected the fallback content message.');
                }
            }
            catch (fallbackError) {
                reportPostMessageFailure(fallbackError || error);
                return;
            }
        }
        didSendContent = true;
        console.log(`SF Translations Manager: posted translations to webview in ${Date.now() - postStartedAt}ms.`);
    };
    const sendLoadState = async () => {
        if (!loadState) {
            return;
        }
        await panel.webview.postMessage(loadState);
    };
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
            case 'ready':
                if (snapshot) {
                    void sendContent();
                }
                else {
                    void sendLoadState();
                }
                break;
            case 'save':
                if (!snapshot) {
                    await postSaveError(panel.webview, message.requestId, 'Translations are still loading.');
                    break;
                }
                await handleSaveMessage(message, panel.webview, snapshot, validFilePaths, enqueueSave);
                break;
            case 'openSettings':
                void openExtensionSettings();
                break;
        }
    }, undefined, context.subscriptions);
    panel.webview.html = await getWebviewHtml(panel.webview, webviewRoot);
    void loadAndSendTranslations();
    async function loadAndSendTranslations() {
        try {
            const findStartedAt = Date.now();
            const files = await findTranslationFiles();
            console.log(`SF Translations Manager: found ${files.length} files in ${Date.now() - findStartedAt}ms.`);
            if (files.length === 0) {
                const message = `No translation files found for pattern: ${getTranslationsGlob()}`;
                loadState = { type: 'empty', message };
                vscode.window.showWarningMessage(message);
                await sendLoadState();
                return;
            }
            const loadStartedAt = Date.now();
            snapshot = await loadTranslations(files);
            validFilePaths = new Set(files.map((uri) => uri.fsPath));
            console.log(`SF Translations Manager: loaded ${snapshot.files.length} files, ${countKeys(snapshot.merged)} keys, ${Object.keys(snapshot.merged).length} locales in ${Date.now() - loadStartedAt}ms.`);
            await sendContent();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load translations.';
            loadState = { type: 'loadError', message };
            console.error('SF Translations Manager: failed to load translations.', error);
            vscode.window.showErrorMessage(message);
            await sendLoadState();
        }
    }
}
async function handleSaveMessage(message, webview, snapshot, validFilePaths, enqueueSave) {
    if (!isSafeFileId(message.fileId) ||
        !isString(message.locale) ||
        !isString(message.key) ||
        !isString(message.value)) {
        await postSaveError(webview, message.requestId, 'Invalid save request from the translations webview.');
        return;
    }
    const saveRequest = {
        fileId: message.fileId,
        locale: message.locale,
        key: message.key,
        value: message.value,
    };
    const sourceFileId = resolveSourceFileId(snapshot, saveRequest.locale, saveRequest.key);
    const sourceFile = sourceFileId === undefined ? undefined : snapshot.files[sourceFileId];
    if (sourceFileId === undefined || !sourceFile) {
        await postSaveError(webview, message.requestId, `No source file found for ${saveRequest.locale}: ${saveRequest.key}.`);
        return;
    }
    if (saveRequest.fileId !== sourceFileId || !validFilePaths.has(sourceFile)) {
        await postSaveError(webview, message.requestId, 'Invalid source file for this translation.');
        return;
    }
    try {
        await enqueueSave(() => saveTranslationValue({
            filePath: sourceFile,
            locale: saveRequest.locale,
            key: saveRequest.key,
            value: saveRequest.value,
        }));
        setSourceFileId(snapshot, saveRequest.locale, saveRequest.key, sourceFileId);
        if (!snapshot.merged[saveRequest.locale]) {
            snapshot.merged[saveRequest.locale] = {};
        }
        snapshot.merged[saveRequest.locale][saveRequest.key] = saveRequest.value;
        await webview.postMessage({
            type: 'saved',
            requestId: message.requestId,
            fileId: sourceFileId,
            locale: saveRequest.locale,
            key: saveRequest.key,
            value: saveRequest.value,
        });
    }
    catch (error) {
        const messageText = error instanceof Error ? error.message : 'Failed to save translation.';
        vscode.window.showErrorMessage(messageText);
        await postSaveError(webview, message.requestId, messageText);
    }
}
async function postSaveError(webview, requestId, message) {
    await webview.postMessage({
        type: 'saveError',
        requestId,
        message,
    });
}
async function saveTranslationValue({ filePath, locale, key, value, }) {
    const uri = vscode.Uri.file(filePath);
    const content = await readTranslationFile(uri);
    const parsed = parseJsonObject(content, `Failed to parse ${basename(filePath)}.`);
    const localeTranslations = isRecord(parsed[locale]) ? parsed[locale] : {};
    localeTranslations[key] = value;
    parsed[locale] = localeTranslations;
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(JSON.stringify(parsed, null, 2)));
}
async function loadTranslations(files) {
    const merged = {};
    const filePaths = files.map((uri) => uri.fsPath);
    const sourceFileIds = {};
    const localeFileIds = {};
    const keyFileIds = {};
    for (const [fileId, uri] of files.entries()) {
        const content = await readFileOrSkip(uri);
        if (content === undefined) {
            continue;
        }
        const data = parseJsonObjectOrSkip(content);
        if (!data) {
            continue;
        }
        for (const [locale, keys] of Object.entries(data)) {
            if (!isRecord(keys)) {
                continue;
            }
            if (!merged[locale]) {
                merged[locale] = {};
            }
            if (!sourceFileIds[locale]) {
                sourceFileIds[locale] = {};
            }
            for (const [key, value] of Object.entries(keys)) {
                if (typeof value === 'string') {
                    merged[locale][key] = value;
                    sourceFileIds[locale][key] = fileId;
                    localeFileIds[locale] = fileId;
                    keyFileIds[key] = fileId;
                }
            }
        }
    }
    return { merged, files: filePaths, sourceFileIds, localeFileIds, keyFileIds };
}
function resolveSourceFileId(snapshot, locale, key) {
    return (snapshot.sourceFileIds[locale]?.[key] ??
        snapshot.localeFileIds[locale] ??
        snapshot.keyFileIds[key]);
}
function setSourceFileId(snapshot, locale, key, fileId) {
    if (!snapshot.sourceFileIds[locale]) {
        snapshot.sourceFileIds[locale] = {};
    }
    snapshot.sourceFileIds[locale][key] = fileId;
    snapshot.localeFileIds[locale] = fileId;
    snapshot.keyFileIds[key] = fileId;
}
function countKeys(translations) {
    const keys = new Set();
    for (const localeTranslations of Object.values(translations)) {
        for (const key of Object.keys(localeTranslations)) {
            keys.add(key);
        }
    }
    return keys.size;
}
function createSaveQueue() {
    let queue = Promise.resolve();
    return (operation) => {
        const run = queue.then(operation, operation);
        queue = run.catch(() => undefined);
        return run;
    };
}
async function readFileOrSkip(uri) {
    try {
        return await readTranslationFile(uri);
    }
    catch {
        return undefined;
    }
}
function parseJsonObjectOrSkip(content) {
    try {
        const parsed = JSON.parse(content);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function parseJsonObject(content, errorMessage) {
    try {
        const parsed = JSON.parse(content);
        if (isRecord(parsed)) {
            return parsed;
        }
    }
    catch {
        // handled below
    }
    throw new Error(errorMessage);
}
async function readTranslationFile(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}
async function getPanelTitleFromHtml(webviewRoot) {
    try {
        const html = await readTranslationFile(vscode.Uri.joinPath(webviewRoot, 'index.html'));
        const match = html.match(/<meta\s+name="panel-title"\s+content="([^"]*)"/i);
        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }
    catch {
        // The title has a stable fallback when the webview asset is unavailable.
    }
    return DEFAULT_PANEL_TITLE;
}
async function getWebviewHtml(webview, webviewRoot) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'script.js'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'search-funnel-logo.png'));
    const nonce = createNonce();
    let html = await readTranslationFile(vscode.Uri.joinPath(webviewRoot, 'index.html'));
    html = html
        .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
        .replace(/\{\{NONCE\}\}/g, nonce)
        .replace(/\{\{LOGO_URI\}\}/g, logoUri.toString())
        .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
        .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
        .replace(/\{\{PANEL_TITLE\}\}/g, escapeHtml(DEFAULT_PANEL_TITLE));
    return html;
}
function openExtensionSettings() {
    return vscode.commands.executeCommand('workbench.action.openSettings', 'sfTranslationsManager');
}
function createNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i += 1) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
function basename(filePath) {
    return filePath.split(/[\\/]/).pop() || filePath;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function isString(value) {
    return typeof value === 'string';
}
function isSafeFileId(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=extension.js.map