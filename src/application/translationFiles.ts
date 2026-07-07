import {
  buildTranslationSnapshot,
  TranslationSnapshot,
  updateTranslationValue,
} from '../domain/translations';

export interface TranslationFileStore {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
}

export interface SaveTranslationValueInput {
  filePath: string;
  locale: string;
  key: string;
  value: string;
}

export async function loadTranslationSnapshot(
  filePaths: readonly string[],
  store: Pick<TranslationFileStore, 'readFile'>,
): Promise<TranslationSnapshot> {
  const files = [];

  for (const filePath of filePaths) {
    files.push({
      path: filePath,
      content: await readFileOrSkip(store, filePath),
    });
  }

  return buildTranslationSnapshot(files);
}

export async function saveTranslationValue(
  input: SaveTranslationValueInput,
  store: TranslationFileStore,
): Promise<void> {
  const content = await store.readFile(input.filePath);
  const updatedContent = updateTranslationValue(content, {
    locale: input.locale,
    key: input.key,
    value: input.value,
    parseErrorMessage: `Failed to parse ${basename(input.filePath)}.`,
  });

  await store.writeFile(input.filePath, updatedContent);
}

async function readFileOrSkip(
  store: Pick<TranslationFileStore, 'readFile'>,
  filePath: string,
): Promise<string | undefined> {
  try {
    return await store.readFile(filePath);
  } catch {
    return undefined;
  }
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
