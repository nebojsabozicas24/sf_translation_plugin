import * as vscode from 'vscode';

export const DEFAULT_TRANSLATIONS_GLOB = '**/__generated__/translations*.json';

export function getTranslationsGlob(): string {
  return (
    vscode.workspace
      .getConfiguration('sfTranslationsManager')
      .get<string>('translationsLocation') ?? DEFAULT_TRANSLATIONS_GLOB
  );
}

export function openExtensionSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand(
    'workbench.action.openSettings',
    'sfTranslationsManager',
  );
}
