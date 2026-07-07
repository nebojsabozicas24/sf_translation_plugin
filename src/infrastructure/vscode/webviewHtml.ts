import * as vscode from 'vscode';

import { readTextFile } from './translationFileStore';

export const DEFAULT_PANEL_TITLE = 'SF Translations Manager';

export async function getPanelTitleFromHtml(
  webviewRoot: vscode.Uri,
): Promise<string> {
  try {
    const html = await readTextFile(vscode.Uri.joinPath(webviewRoot, 'index.html'));
    const match = html.match(/<meta\s+name="panel-title"\s+content="([^"]*)"/i);

    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  } catch {
    // The title has a stable fallback when the webview asset is unavailable.
  }

  return DEFAULT_PANEL_TITLE;
}

export async function getWebviewHtml(
  webview: vscode.Webview,
  webviewRoot: vscode.Uri,
): Promise<string> {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'script.js'));
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(webviewRoot, 'search-funnel-logo.png'),
  );
  const nonce = createNonce();

  let html = await readTextFile(vscode.Uri.joinPath(webviewRoot, 'index.html'));

  html = html
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{LOGO_URI\}\}/g, logoUri.toString())
    .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
    .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
    .replace(/\{\{PANEL_TITLE\}\}/g, escapeHtml(DEFAULT_PANEL_TITLE));

  return html;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
