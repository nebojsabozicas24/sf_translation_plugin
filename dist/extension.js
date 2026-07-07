"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The vscode module is provided by VS Code at extension runtime.
const vscode = require("vscode");
const settings_1 = require("./infrastructure/vscode/settings");
const translationPanel_1 = require("./infrastructure/vscode/translationPanel");
function activate(context) {
    const openCommand = vscode.commands.registerCommand('sfTranslationsManager.open', async () => {
        await (0, translationPanel_1.openTranslationPanel)(context);
    });
    const openSettingsCommand = vscode.commands.registerCommand('sfTranslationsManager.openSettings', () => {
        void (0, settings_1.openExtensionSettings)();
    });
    context.subscriptions.push(openCommand, openSettingsCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map