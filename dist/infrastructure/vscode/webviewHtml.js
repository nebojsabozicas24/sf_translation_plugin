"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PANEL_TITLE = void 0;
exports.getPanelTitleFromHtml = getPanelTitleFromHtml;
exports.getWebviewHtml = getWebviewHtml;
const vscode = require("vscode");
const translationFileStore_1 = require("./translationFileStore");
exports.DEFAULT_PANEL_TITLE = 'SF Translations Manager';
async function getPanelTitleFromHtml(webviewRoot) {
    try {
        const html = await (0, translationFileStore_1.readTextFile)(vscode.Uri.joinPath(webviewRoot, 'index.html'));
        const match = html.match(/<meta\s+name="panel-title"\s+content="([^"]*)"/i);
        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }
    catch {
        // The title has a stable fallback when the webview asset is unavailable.
    }
    return exports.DEFAULT_PANEL_TITLE;
}
async function getWebviewHtml(webview, webviewRoot) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'script.js'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'search-funnel-logo.png'));
    const nonce = createNonce();
    let html = await (0, translationFileStore_1.readTextFile)(vscode.Uri.joinPath(webviewRoot, 'index.html'));
    html = html
        .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
        .replace(/\{\{NONCE\}\}/g, nonce)
        .replace(/\{\{LOGO_URI\}\}/g, logoUri.toString())
        .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
        .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
        .replace(/\{\{PANEL_TITLE\}\}/g, escapeHtml(exports.DEFAULT_PANEL_TITLE));
    return html;
}
function createNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i += 1) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
//# sourceMappingURL=webviewHtml.js.map