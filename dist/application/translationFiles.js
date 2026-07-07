"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTranslationSnapshot = loadTranslationSnapshot;
exports.saveTranslationValue = saveTranslationValue;
const translations_1 = require("../domain/translations");
async function loadTranslationSnapshot(filePaths, store) {
    const files = [];
    for (const filePath of filePaths) {
        files.push({
            path: filePath,
            content: await readFileOrSkip(store, filePath),
        });
    }
    return (0, translations_1.buildTranslationSnapshot)(files);
}
async function saveTranslationValue(input, store) {
    const content = await store.readFile(input.filePath);
    const updatedContent = (0, translations_1.updateTranslationValue)(content, {
        locale: input.locale,
        key: input.key,
        value: input.value,
        parseErrorMessage: `Failed to parse ${basename(input.filePath)}.`,
    });
    await store.writeFile(input.filePath, updatedContent);
}
async function readFileOrSkip(store, filePath) {
    try {
        return await store.readFile(filePath);
    }
    catch {
        return undefined;
    }
}
function basename(filePath) {
    return filePath.split(/[\\/]/).pop() || filePath;
}
//# sourceMappingURL=translationFiles.js.map