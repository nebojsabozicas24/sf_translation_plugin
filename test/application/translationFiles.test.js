const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadTranslationSnapshot,
  saveTranslationValue,
} = require('../../dist/application/translationFiles');

test('loadTranslationSnapshot keeps file ids stable while skipping unreadable files', async () => {
  const store = {
    async readFile(filePath) {
      if (filePath === '/repo/b/unreadable.json') {
        throw new Error('Cannot read file');
      }

      if (filePath === '/repo/c/translations.json') {
        return JSON.stringify({
          de: {
            'common.save': 'Speichern',
          },
        });
      }

      return JSON.stringify({
        en: {
          'common.save': 'Save',
        },
      });
    },
  };

  const snapshot = await loadTranslationSnapshot(
    [
      '/repo/a/translations.json',
      '/repo/b/unreadable.json',
      '/repo/c/translations.json',
    ],
    store,
  );

  assert.deepEqual(snapshot.files, [
    '/repo/a/translations.json',
    '/repo/b/unreadable.json',
    '/repo/c/translations.json',
  ]);
  assert.equal(snapshot.sourceFileIds.en['common.save'], 0);
  assert.equal(snapshot.sourceFileIds.de['common.save'], 2);
});

test('saveTranslationValue reads, updates, and writes through the file store', async () => {
  let write;
  const store = {
    async readFile(filePath) {
      assert.equal(filePath, '/repo/translations.json');
      return JSON.stringify({
        en: {
          'common.save': 'Save',
        },
      });
    },
    async writeFile(filePath, content) {
      write = { filePath, content };
    },
  };

  await saveTranslationValue(
    {
      filePath: '/repo/translations.json',
      locale: 'de',
      key: 'common.save',
      value: 'Speichern',
    },
    store,
  );

  assert.equal(write.filePath, '/repo/translations.json');
  assert.deepEqual(JSON.parse(write.content), {
    en: {
      'common.save': 'Save',
    },
    de: {
      'common.save': 'Speichern',
    },
  });
});
