import * as vscode from 'vscode';

import { TranslationFileStore } from '../../application/translationFiles';
import { getTranslationsGlob } from './settings';

export class VscodeTranslationFileStore implements TranslationFileStore {
  async findTranslationFiles(): Promise<string[]> {
    const files = await vscode.workspace.findFiles(getTranslationsGlob());
    return files.map((uri) => uri.fsPath).sort((a, b) => a.localeCompare(b));
  }

  async readFile(filePath: string): Promise<string> {
    return readTextFile(vscode.Uri.file(filePath));
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      encoder.encode(content),
    );
  }
}

export async function readTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}
