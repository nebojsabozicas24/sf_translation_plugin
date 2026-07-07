export type TranslationsByLocale = Record<string, Record<string, string>>;
export type FileId = number;
export type KeyToFileIdMap = Record<string, FileId>;
export type LocaleToFileIdMap = Record<string, FileId>;
export type SourceFileIdsByLocale = Record<string, Record<string, FileId>>;

export interface TranslationSnapshot {
  merged: TranslationsByLocale;
  files: string[];
  sourceFileIds: SourceFileIdsByLocale;
  localeFileIds: LocaleToFileIdMap;
  keyFileIds: KeyToFileIdMap;
}

export interface TranslationFileLoad {
  path: string;
  content?: string;
}

export interface UpdateTranslationValueInput {
  locale: string;
  key: string;
  value: string;
  parseErrorMessage?: string;
}

export function buildTranslationSnapshot(
  files: readonly TranslationFileLoad[],
): TranslationSnapshot {
  const merged: TranslationsByLocale = {};
  const filePaths = files.map((file) => file.path);
  const sourceFileIds: SourceFileIdsByLocale = {};
  const localeFileIds: LocaleToFileIdMap = {};
  const keyFileIds: KeyToFileIdMap = {};

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

export function updateTranslationValue(
  content: string,
  input: UpdateTranslationValueInput,
): string {
  const parsed = parseJsonObject(
    content,
    input.parseErrorMessage ?? 'Failed to parse translation file.',
  );
  const currentLocaleTranslations = parsed[input.locale];
  const localeTranslations: Record<string, unknown> = isRecord(
    currentLocaleTranslations,
  )
    ? currentLocaleTranslations
    : {};

  localeTranslations[input.key] = input.value;
  parsed[input.locale] = localeTranslations;

  return JSON.stringify(parsed, null, 2);
}

export function resolveSourceFileId(
  snapshot: TranslationSnapshot,
  locale: string,
  key: string,
): FileId | undefined {
  return (
    snapshot.sourceFileIds[locale]?.[key] ??
    snapshot.localeFileIds[locale] ??
    snapshot.keyFileIds[key]
  );
}

export function setSourceFileId(
  snapshot: TranslationSnapshot,
  locale: string,
  key: string,
  fileId: FileId,
): void {
  if (!snapshot.sourceFileIds[locale]) {
    snapshot.sourceFileIds[locale] = {};
  }

  snapshot.sourceFileIds[locale][key] = fileId;
  snapshot.localeFileIds[locale] = fileId;
  snapshot.keyFileIds[key] = fileId;
}

export function countUniqueKeys(translations: TranslationsByLocale): number {
  const keys = new Set<string>();

  for (const localeTranslations of Object.values(translations)) {
    for (const key of Object.keys(localeTranslations)) {
      keys.add(key);
    }
  }

  return keys.size;
}

export function isSafeFileId(value: unknown): value is FileId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
