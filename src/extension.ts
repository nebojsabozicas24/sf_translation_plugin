// The vscode module is provided by VS Code at extension runtime.
import * as vscode from 'vscode';

type TranslationsByLocale = Record<string, Record<string, string>>;
type KeyToFileMap = Record<string, string>;
type LocaleToFileMap = Record<string, string>;
type SourceFilesByLocale = Record<string, Record<string, string>>;

interface TranslationSnapshot {
  merged: TranslationsByLocale;
  sourceFiles: SourceFilesByLocale;
  localeToFile: LocaleToFileMap;
  keyToFile: KeyToFileMap;
}

type SaveOperationQueue = (operation: () => Promise<void>) => Promise<void>;

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openSettings' }
  | {
      type: 'save';
      filePath?: unknown;
      locale?: unknown;
      key?: unknown;
      value?: unknown;
      requestId?: unknown;
    };

const DEFAULT_TRANSLATIONS_GLOB = '**/__generated__/translations*.json';
const DEFAULT_PANEL_TITLE = 'SF Translations Manager';

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand(
    'sfTranslationsManager.open',
    async () => {
      const files = await findTranslationFiles();

      if (files.length === 0) {
        vscode.window.showWarningMessage(
          `No translation files found for pattern: ${getTranslationsGlob()}`,
        );
        return;
      }

      await openTranslationPanel(context, files);
    },
  );

  const openSettingsCommand = vscode.commands.registerCommand(
    'sfTranslationsManager.openSettings',
    () => {
      void openExtensionSettings();
    },
  );

  context.subscriptions.push(openCommand, openSettingsCommand);
}

export function deactivate(): void {}

function getTranslationsGlob(): string {
  return (
    vscode.workspace
      .getConfiguration('sfTranslationsManager')
      .get<string>('translationsLocation') ?? DEFAULT_TRANSLATIONS_GLOB
  );
}

async function findTranslationFiles(): Promise<vscode.Uri[]> {
  const files = await vscode.workspace.findFiles(getTranslationsGlob());
  return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

async function openTranslationPanel(
  context: vscode.ExtensionContext,
  files: vscode.Uri[],
): Promise<void> {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'webview');
  const panelTitle = await getPanelTitleFromHtml(webviewRoot);

  const panel = vscode.window.createWebviewPanel(
    'sfTranslationsManager',
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewRoot],
    },
  );

  const snapshot = await loadTranslations(files);
  const validFilePaths = new Set(files.map((uri) => uri.fsPath));
  const enqueueSave = createSaveQueue();
  let didSendContent = false;
  let didReportPostMessageFailure = false;

  const reportPostMessageFailure = (error: unknown): void => {
    console.error(
      'SF Translations Manager: failed to send content to webview.',
      error,
    );

    if (didReportPostMessageFailure) {
      return;
    }

    didReportPostMessageFailure = true;
    vscode.window.showErrorMessage(
      'Failed to send translations to the webview. The payload may be too large.',
    );
  };

  const sendContent = async (): Promise<void> => {
    if (didSendContent) {
      return;
    }

    try {
      const sent = await panel.webview.postMessage({
        type: 'content',
        merged: snapshot.merged,
        sourceFiles: snapshot.sourceFiles,
        localeToFile: snapshot.localeToFile,
        keyToFile: snapshot.keyToFile,
      });

      if (!sent) {
        throw new Error('Webview rejected the content message.');
      }
    } catch (error) {
      try {
        const sent = await panel.webview.postMessage({
          type: 'content',
          data: JSON.stringify(snapshot),
        });

        if (!sent) {
          throw new Error('Webview rejected the fallback content message.');
        }
      } catch (fallbackError) {
        reportPostMessageFailure(fallbackError || error);
        return;
      }
    }

    didSendContent = true;
  };

  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          void sendContent();
          break;

        case 'save':
          await handleSaveMessage(
            message,
            panel.webview,
            snapshot,
            validFilePaths,
            enqueueSave,
          );
          break;

        case 'openSettings':
          void openExtensionSettings();
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  panel.webview.html = await getWebviewHtml(panel.webview, webviewRoot);
}

async function handleSaveMessage(
  message: Extract<WebviewMessage, { type: 'save' }>,
  webview: vscode.Webview,
  snapshot: TranslationSnapshot,
  validFilePaths: ReadonlySet<string>,
  enqueueSave: SaveOperationQueue,
): Promise<void> {
  if (
    !isString(message.filePath) ||
    !isString(message.locale) ||
    !isString(message.key) ||
    !isString(message.value)
  ) {
    await postSaveError(
      webview,
      message.requestId,
      'Invalid save request from the translations webview.',
    );
    return;
  }

  const saveRequest = {
    filePath: message.filePath,
    locale: message.locale,
    key: message.key,
    value: message.value,
  };

  const sourceFile = resolveSourceFile(
    snapshot,
    saveRequest.locale,
    saveRequest.key,
  );

  if (!sourceFile) {
    await postSaveError(
      webview,
      message.requestId,
      `No source file found for ${saveRequest.locale}: ${saveRequest.key}.`,
    );
    return;
  }

  if (saveRequest.filePath !== sourceFile || !validFilePaths.has(sourceFile)) {
    await postSaveError(
      webview,
      message.requestId,
      'Invalid source file for this translation.',
    );
    return;
  }

  try {
    await enqueueSave(() =>
      saveTranslationValue({
        filePath: sourceFile,
        locale: saveRequest.locale,
        key: saveRequest.key,
        value: saveRequest.value,
      }),
    );

    setSourceFile(snapshot, saveRequest.locale, saveRequest.key, sourceFile);

    if (!snapshot.merged[saveRequest.locale]) {
      snapshot.merged[saveRequest.locale] = {};
    }

    snapshot.merged[saveRequest.locale][saveRequest.key] = saveRequest.value;

    await webview.postMessage({
      type: 'saved',
      requestId: message.requestId,
      filePath: sourceFile,
      locale: saveRequest.locale,
      key: saveRequest.key,
      value: saveRequest.value,
    });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : 'Failed to save translation.';

    vscode.window.showErrorMessage(messageText);
    await postSaveError(webview, message.requestId, messageText);
  }
}

async function postSaveError(
  webview: vscode.Webview,
  requestId: unknown,
  message: string,
): Promise<void> {
  await webview.postMessage({
    type: 'saveError',
    requestId,
    message,
  });
}

interface SaveTranslationValueInput {
  filePath: string;
  locale: string;
  key: string;
  value: string;
}

async function saveTranslationValue({
  filePath,
  locale,
  key,
  value,
}: SaveTranslationValueInput): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const content = await readTranslationFile(uri);
  const parsed = parseJsonObject(content, `Failed to parse ${basename(filePath)}.`);

  const localeTranslations = isRecord(parsed[locale]) ? parsed[locale] : {};
  localeTranslations[key] = value;
  parsed[locale] = localeTranslations;

  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(
    uri,
    encoder.encode(JSON.stringify(parsed, null, 2)),
  );
}

async function loadTranslations(files: vscode.Uri[]): Promise<TranslationSnapshot> {
  const merged: TranslationsByLocale = {};
  const sourceFiles: SourceFilesByLocale = {};
  const localeToFile: LocaleToFileMap = {};
  const keyToFile: KeyToFileMap = {};

  for (const uri of files) {
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

      if (!sourceFiles[locale]) {
        sourceFiles[locale] = {};
      }

      for (const [key, value] of Object.entries(keys)) {
        if (typeof value === 'string') {
          merged[locale][key] = value;
          sourceFiles[locale][key] = uri.fsPath;
          localeToFile[locale] = uri.fsPath;
          keyToFile[key] = uri.fsPath;
        }
      }
    }
  }

  return { merged, sourceFiles, localeToFile, keyToFile };
}

function resolveSourceFile(
  snapshot: TranslationSnapshot,
  locale: string,
  key: string,
): string | undefined {
  return (
    snapshot.sourceFiles[locale]?.[key] ??
    snapshot.localeToFile[locale] ??
    snapshot.keyToFile[key]
  );
}

function setSourceFile(
  snapshot: TranslationSnapshot,
  locale: string,
  key: string,
  filePath: string,
): void {
  if (!snapshot.sourceFiles[locale]) {
    snapshot.sourceFiles[locale] = {};
  }

  snapshot.sourceFiles[locale][key] = filePath;
  snapshot.localeToFile[locale] = filePath;
  snapshot.keyToFile[key] = filePath;
}

function createSaveQueue(): SaveOperationQueue {
  let queue: Promise<unknown> = Promise.resolve();

  return (operation) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };
}

async function readFileOrSkip(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return await readTranslationFile(uri);
  } catch {
    return undefined;
  }
}

function parseJsonObjectOrSkip(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObject(content: string, errorMessage: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // handled below
  }

  throw new Error(errorMessage);
}

async function readTranslationFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

async function getPanelTitleFromHtml(webviewRoot: vscode.Uri): Promise<string> {
  try {
    const html = await readTranslationFile(
      vscode.Uri.joinPath(webviewRoot, 'index.html'),
    );
    const match = html.match(/<meta\s+name="panel-title"\s+content="([^"]*)"/i);

    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  } catch {
    // The title has a stable fallback when the webview asset is unavailable.
  }

  return DEFAULT_PANEL_TITLE;
}

async function getWebviewHtml(
  webview: vscode.Webview,
  webviewRoot: vscode.Uri,
): Promise<string> {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'script.js'));
  const nonce = createNonce();

  let html = await readTranslationFile(vscode.Uri.joinPath(webviewRoot, 'index.html'));

  html = html
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{STYLE_URI\}\}/g, styleUri.toString())
    .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
    .replace(/\{\{PANEL_TITLE\}\}/g, escapeHtml(DEFAULT_PANEL_TITLE));

  return html;
}

function openExtensionSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand(
    'workbench.action.openSettings',
    'sfTranslationsManager',
  );
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
