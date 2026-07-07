"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VscodeTranslationFileStore = void 0;
exports.readTextFile = readTextFile;
const vscode = require("vscode");
const settings_1 = require("./settings");
class VscodeTranslationFileStore {
    async findTranslationFiles() {
        const files = await vscode.workspace.findFiles((0, settings_1.getTranslationsGlob)());
        return files.map((uri) => uri.fsPath).sort((a, b) => a.localeCompare(b));
    }
    async readFile(filePath) {
        return readTextFile(vscode.Uri.file(filePath));
    }
    async writeFile(filePath, content) {
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), encoder.encode(content));
    }
}
exports.VscodeTranslationFileStore = VscodeTranslationFileStore;
async function readTextFile(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}
//# sourceMappingURL=translationFileStore.js.map