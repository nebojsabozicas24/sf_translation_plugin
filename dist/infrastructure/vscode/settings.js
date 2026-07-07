"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TRANSLATIONS_GLOB = void 0;
exports.getTranslationsGlob = getTranslationsGlob;
exports.openExtensionSettings = openExtensionSettings;
const vscode = require("vscode");
exports.DEFAULT_TRANSLATIONS_GLOB = '**/__generated__/translations*.json';
function getTranslationsGlob() {
    return (vscode.workspace
        .getConfiguration('sfTranslationsManager')
        .get('translationsLocation') ?? exports.DEFAULT_TRANSLATIONS_GLOB);
}
function openExtensionSettings() {
    return vscode.commands.executeCommand('workbench.action.openSettings', 'sfTranslationsManager');
}
//# sourceMappingURL=settings.js.map