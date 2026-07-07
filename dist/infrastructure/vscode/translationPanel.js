"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openTranslationPanel = openTranslationPanel;
const vscode = require("vscode");
const saveQueue_1 = require("../../application/saveQueue");
const translationFiles_1 = require("../../application/translationFiles");
const translations_1 = require("../../domain/translations");
const settings_1 = require("./settings");
const translationFileStore_1 = require("./translationFileStore");
const webviewHtml_1 = require("./webviewHtml");
async function openTranslationPanel(context, fileStore = new translationFileStore_1.VscodeTranslationFileStore()) {
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'webview');
    const panelTitle = await (0, webviewHtml_1.getPanelTitleFromHtml)(webviewRoot);
    const panel = vscode.window.createWebviewPanel('sfTranslationsManager', panelTitle, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
    });
    let snapshot;
    let validFilePaths = new Set();
    let loadState;
    const enqueueSave = (0, saveQueue_1.createSaveQueue)();
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
                await handleSaveMessage(message, panel.webview, snapshot, validFilePaths, enqueueSave, fileStore);
                break;
            case 'openSettings':
                void (0, settings_1.openExtensionSettings)();
                break;
        }
    }, undefined, context.subscriptions);
    panel.webview.html = await (0, webviewHtml_1.getWebviewHtml)(panel.webview, webviewRoot);
    void loadAndSendTranslations();
    async function loadAndSendTranslations() {
        try {
            const findStartedAt = Date.now();
            const files = await fileStore.findTranslationFiles();
            console.log(`SF Translations Manager: found ${files.length} files in ${Date.now() - findStartedAt}ms.`);
            if (files.length === 0) {
                const message = `No translation files found for pattern: ${(0, settings_1.getTranslationsGlob)()}`;
                loadState = { type: 'empty', message };
                vscode.window.showWarningMessage(message);
                await sendLoadState();
                return;
            }
            const loadStartedAt = Date.now();
            snapshot = await (0, translationFiles_1.loadTranslationSnapshot)(files, fileStore);
            validFilePaths = new Set(files);
            console.log(`SF Translations Manager: loaded ${snapshot.files.length} files, ${(0, translations_1.countUniqueKeys)(snapshot.merged)} keys, ${Object.keys(snapshot.merged).length} locales in ${Date.now() - loadStartedAt}ms.`);
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
async function handleSaveMessage(message, webview, snapshot, validFilePaths, enqueueSave, fileStore) {
    if (!(0, translations_1.isSafeFileId)(message.fileId) ||
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
    const sourceFileId = (0, translations_1.resolveSourceFileId)(snapshot, saveRequest.locale, saveRequest.key);
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
        await enqueueSave(() => (0, translationFiles_1.saveTranslationValue)({
            filePath: sourceFile,
            locale: saveRequest.locale,
            key: saveRequest.key,
            value: saveRequest.value,
        }, fileStore));
        (0, translations_1.setSourceFileId)(snapshot, saveRequest.locale, saveRequest.key, sourceFileId);
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
function isString(value) {
    return typeof value === 'string';
}
//# sourceMappingURL=translationPanel.js.map