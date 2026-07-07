// The vscode module is provided by VS Code at extension runtime.
import * as vscode from 'vscode';

import { openExtensionSettings } from './infrastructure/vscode/settings';
import { openTranslationPanel } from './infrastructure/vscode/translationPanel';

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand(
    'sfTranslationsManager.open',
    async () => {
      await openTranslationPanel(context);
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
