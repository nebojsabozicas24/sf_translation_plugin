import * as vscode from 'vscode';

import { createSaveQueue, SaveOperationQueue } from '../../application/saveQueue';
import {
  loadTranslationSnapshot,
  saveTranslationValue,
  TranslationFileStore,
} from '../../application/translationFiles';
import {
  countUniqueKeys,
  isSafeFileId,
  resolveSourceFileId,
  setSourceFileId,
  TranslationSnapshot,
} from '../../domain/translations';
import { getTranslationsGlob, openExtensionSettings } from './settings';
import { VscodeTranslationFileStore } from './translationFileStore';
import { getPanelTitleFromHtml, getWebviewHtml } from './webviewHtml';

interface TranslationFileFinder extends TranslationFileStore {
  findTranslationFiles(): Promise<string[]>;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openSettings' }
  | {
      type: 'save';
      fileId?: unknown;
      locale?: unknown;
      key?: unknown;
      value?: unknown;
      requestId?: unknown;
    };

export async function openTranslationPanel(
  context: vscode.ExtensionContext,
  fileStore: TranslationFileFinder = new VscodeTranslationFileStore(),
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

  let snapshot: TranslationSnapshot | undefined;
  let validFilePaths: ReadonlySet<string> = new Set();
  let loadState: { type: 'empty' | 'loadError'; message: string } | undefined;
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
    console.log(
      `SF Translations Manager: posted translations to webview in ${
        Date.now() - postStartedAt
      }ms.`,
    );
  };

  const sendLoadState = async (): Promise<void> => {
    if (!loadState) {
      return;
    }

    await panel.webview.postMessage(loadState);
  };

  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          if (snapshot) {
            void sendContent();
          } else {
            void sendLoadState();
          }
          break;

        case 'save':
          if (!snapshot) {
            await postSaveError(
              panel.webview,
              message.requestId,
              'Translations are still loading.',
            );
            break;
          }

          await handleSaveMessage(
            message,
            panel.webview,
            snapshot,
            validFilePaths,
            enqueueSave,
            fileStore,
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
  void loadAndSendTranslations();

  async function loadAndSendTranslations(): Promise<void> {
    try {
      const findStartedAt = Date.now();
      const files = await fileStore.findTranslationFiles();
      console.log(
        `SF Translations Manager: found ${files.length} files in ${
          Date.now() - findStartedAt
        }ms.`,
      );

      if (files.length === 0) {
        const message = `No translation files found for pattern: ${getTranslationsGlob()}`;
        loadState = { type: 'empty', message };
        vscode.window.showWarningMessage(message);
        await sendLoadState();
        return;
      }

      const loadStartedAt = Date.now();
      snapshot = await loadTranslationSnapshot(files, fileStore);
      validFilePaths = new Set(files);
      console.log(
        `SF Translations Manager: loaded ${snapshot.files.length} files, ${countUniqueKeys(
          snapshot.merged,
        )} keys, ${Object.keys(snapshot.merged).length} locales in ${
          Date.now() - loadStartedAt
        }ms.`,
      );

      await sendContent();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load translations.';
      loadState = { type: 'loadError', message };
      console.error('SF Translations Manager: failed to load translations.', error);
      vscode.window.showErrorMessage(message);
      await sendLoadState();
    }
  }
}

async function handleSaveMessage(
  message: Extract<WebviewMessage, { type: 'save' }>,
  webview: vscode.Webview,
  snapshot: TranslationSnapshot,
  validFilePaths: ReadonlySet<string>,
  enqueueSave: SaveOperationQueue,
  fileStore: TranslationFileStore,
): Promise<void> {
  if (
    !isSafeFileId(message.fileId) ||
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
    fileId: message.fileId,
    locale: message.locale,
    key: message.key,
    value: message.value,
  };

  const sourceFileId = resolveSourceFileId(
    snapshot,
    saveRequest.locale,
    saveRequest.key,
  );
  const sourceFile = sourceFileId === undefined ? undefined : snapshot.files[sourceFileId];

  if (sourceFileId === undefined || !sourceFile) {
    await postSaveError(
      webview,
      message.requestId,
      `No source file found for ${saveRequest.locale}: ${saveRequest.key}.`,
    );
    return;
  }

  if (saveRequest.fileId !== sourceFileId || !validFilePaths.has(sourceFile)) {
    await postSaveError(
      webview,
      message.requestId,
      'Invalid source file for this translation.',
    );
    return;
  }

  try {
    await enqueueSave(() =>
      saveTranslationValue(
        {
          filePath: sourceFile,
          locale: saveRequest.locale,
          key: saveRequest.key,
          value: saveRequest.value,
        },
        fileStore,
      ),
    );

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

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
