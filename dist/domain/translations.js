"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTranslationSnapshot = buildTranslationSnapshot;
exports.updateTranslationValue = updateTranslationValue;
exports.resolveSourceFileId = resolveSourceFileId;
exports.setSourceFileId = setSourceFileId;
exports.countUniqueKeys = countUniqueKeys;
exports.isSafeFileId = isSafeFileId;
function buildTranslationSnapshot(files) {
    const merged = {};
    const filePaths = files.map((file) => file.path);
    const sourceFileIds = {};
    const localeFileIds = {};
    const keyFileIds = {};
    for (const [fileId, file] of files.entries()) {
        if (file.content === undefined) {
            continue;
        }
        const data = parseJsonObjectOrSkip(file.content);
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
            if (!sourceFileIds[locale]) {
                sourceFileIds[locale] = {};
            }
            for (const [key, value] of Object.entries(keys)) {
                if (typeof value === 'string') {
                    merged[locale][key] = value;
                    sourceFileIds[locale][key] = fileId;
                    localeFileIds[locale] = fileId;
                    keyFileIds[key] = fileId;
                }
            }
        }
    }
    return { merged, files: filePaths, sourceFileIds, localeFileIds, keyFileIds };
}
function updateTranslationValue(content, input) {
    const parsed = parseJsonObject(content, input.parseErrorMessage ?? 'Failed to parse translation file.');
    const currentLocaleTranslations = parsed[input.locale];
    const localeTranslations = isRecord(currentLocaleTranslations)
        ? currentLocaleTranslations
        : {};
    localeTranslations[input.key] = input.value;
    parsed[input.locale] = localeTranslations;
    return JSON.stringify(parsed, null, 2);
}
function resolveSourceFileId(snapshot, locale, key) {
    return (snapshot.sourceFileIds[locale]?.[key] ??
        snapshot.localeFileIds[locale] ??
        snapshot.keyFileIds[key]);
}
function setSourceFileId(snapshot, locale, key, fileId) {
    if (!snapshot.sourceFileIds[locale]) {
        snapshot.sourceFileIds[locale] = {};
    }
    snapshot.sourceFileIds[locale][key] = fileId;
    snapshot.localeFileIds[locale] = fileId;
    snapshot.keyFileIds[key] = fileId;
}
function countUniqueKeys(translations) {
    const keys = new Set();
    for (const localeTranslations of Object.values(translations)) {
        for (const key of Object.keys(localeTranslations)) {
            keys.add(key);
        }
    }
    return keys.size;
}
function isSafeFileId(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function parseJsonObjectOrSkip(content) {
    try {
        const parsed = JSON.parse(content);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function parseJsonObject(content, errorMessage) {
    try {
        const parsed = JSON.parse(content);
        if (isRecord(parsed)) {
            return parsed;
        }
    }
    catch {
        // handled below
    }
    throw new Error(errorMessage);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=translations.js.map