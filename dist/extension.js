"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
// eslint-disable-next-line import/no-unresolved -- vscode is provided at runtime
const vscode = __importStar(require("vscode"));
function getTranslationsGlob() {
    return (vscode.workspace.getConfiguration('sfTranslationsManager').get('translationsLocation') ??
        '**/__generated__/translations*.json');
}
function activate(context) {
    const openCommand = vscode.commands.registerCommand('sfTranslationsManager.open', async () => {
        const files = await findTranslationFiles();
        if (files.length === 0) {
            vscode.window.showWarningMessage(`No translation files found for pattern: ${getTranslationsGlob()}`);
            return;
        }
        await openTranslationPanel(context, files);
    });
    const openSettingsCommand = vscode.commands.registerCommand('sfTranslationsManager.openSettings', () => {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'sfTranslationsManager');
    });
    context.subscriptions.push(openCommand, openSettingsCommand);
}
function deactivate() { }
async function findTranslationFiles() {
    const glob = getTranslationsGlob();
    const files = await vscode.workspace.findFiles(glob);
    return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}
const DEFAULT_PANEL_TITLE = 'SF Translations Manager';
async function getPanelTitleFromHtml(webviewDir) {
    try {
        const html = await fs.readFile(path.join(webviewDir, 'index.html'), 'utf-8');
        const match = html.match(/<meta\s+name="panel-title"\s+content="([^"]*)"/i);
        if (match && match[1].trim())
            return match[1].trim();
    }
    catch {
        // ignore
    }
    return DEFAULT_PANEL_TITLE;
}
async function openTranslationPanel(context, files) {
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'webview');
    const extensionPath = typeof context.extensionPath === 'string'
        ? context.extensionPath
        : context.extensionUri.fsPath;
    const webviewDir = path.join(extensionPath, 'webview');
    const panelTitle = await getPanelTitleFromHtml(webviewDir);
    const panel = vscode.window.createWebviewPanel('sfTranslationsManager', panelTitle, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
    });
    const merged = {};
    const keyToFile = {};
    for (const uri of files) {
        let content;
        try {
            content = await readTranslationFile(uri);
        }
        catch {
            continue;
        }
        let data;
        try {
            data = JSON.parse(content);
        }
        catch {
            continue;
        }
        const filePath = uri.fsPath;
        for (const [locale, keys] of Object.entries(data)) {
            if (typeof keys !== 'object' || keys === null)
                continue;
            if (!merged[locale])
                merged[locale] = {};
            for (const [key, value] of Object.entries(keys)) {
                if (typeof value === 'string') {
                    merged[locale][key] = value;
                    keyToFile[key] = filePath;
                }
            }
        }
    }
    let didReportPostMessageFailure = false;
    const reportPostMessageFailure = (error) => {
        console.error('SF Translations Manager: failed to send content to webview.', error);
        if (didReportPostMessageFailure)
            return;
        didReportPostMessageFailure = true;
        vscode.window.showErrorMessage('Failed to send translations to the webview. The payload may be too large.');
    };
    const sendContent = async () => {
        try {
            const sent = await panel.webview.postMessage({
                type: 'content',
                merged,
                keyToFile,
            });
            if (!sent)
                throw new Error('Webview rejected the content message.');
        }
        catch (error) {
            try {
                const sent = await panel.webview.postMessage({
                    type: 'content',
                    data: JSON.stringify({ merged, keyToFile }),
                });
                if (!sent)
                    throw new Error('Webview rejected the fallback content message.');
            }
            catch (fallbackError) {
                reportPostMessageFailure(fallbackError instanceof Error ? fallbackError : error);
            }
        }
    };
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
            case 'ready':
                void sendContent();
                break;
            case 'save': {
                if (message.filePath === undefined ||
                    message.locale === undefined ||
                    message.key === undefined ||
                    message.value === undefined)
                    break;
                const uri = vscode.Uri.file(message.filePath);
                const content = await readTranslationFile(uri);
                let data;
                try {
                    data = JSON.parse(content);
                }
                catch {
                    vscode.window.showErrorMessage('Failed to parse file for save.');
                    break;
                }
                if (!data[message.locale])
                    data[message.locale] = {};
                data[message.locale][message.key] = message.value;
                const encoder = new TextEncoder();
                await vscode.workspace.fs.writeFile(uri, encoder.encode(JSON.stringify(data, null, 2)));
                vscode.window.showInformationMessage(`Saved ${message.key} (${message.locale}) in ${path.basename(message.filePath)}`);
                break;
            }
            case 'openSettings': {
                void vscode.commands.executeCommand('workbench.action.openSettings', 'sfTranslationsManager');
                break;
            }
        }
    }, undefined, context.subscriptions);
    panel.webview.html = await getWebviewHtml(context, panel.webview, webviewRoot, webviewDir, panelTitle);
    setTimeout(() => void sendContent(), 100);
    setTimeout(() => void sendContent(), 800);
    setTimeout(() => void sendContent(), 2000);
}
async function readTranslationFile(uri) {
    const p = uri.fsPath;
    if (typeof p === 'string' && p) {
        try {
            return await fs.readFile(p, 'utf-8');
        }
        catch {
            // fallback to workspace API
        }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return doc.getText();
}
async function getWebviewHtml(context, webview, webviewRoot, webviewDir, panelTitle) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'style.css'));
    const scriptPath = path.join(webviewDir, 'script.js');
    const indexPath = path.join(webviewDir, 'index.html');
    let scriptContent = await fs.readFile(scriptPath, 'utf-8');
    scriptContent = scriptContent.replace(/<\/script>/gi, '<\\/script>');
    const titleEscaped = panelTitle
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    let html = await fs.readFile(indexPath, 'utf-8');
    html = html
        .replace('{{STYLE_URI}}', styleUri.toString())
        .replace(/\{\{PANEL_TITLE\}\}/g, titleEscaped)
        .replace(/<script\s+src="{{SCRIPT_URI}}"\s*>\s*<\/script>\s*/i, '<script>\n' + scriptContent + '\n</script>')
        .replace('{{INITIAL_DATA_SCRIPT}}', '');
    return html;
}
//# sourceMappingURL=extension.js.map
