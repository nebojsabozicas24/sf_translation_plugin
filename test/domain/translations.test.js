const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTranslationSnapshot,
  countUniqueKeys,
  resolveSourceFileId,
  setSourceFileId,
  updateTranslationValue,
} = require('../../dist/domain/translations');

test('buildTranslationSnapshot merges string translations and keeps source ownership', () => {
  const snapshot = buildTranslationSnapshot([
    {
      path: '/repo/a/translations.json',
      content: JSON.stringify({
        en: {
          'common.save': 'Save',
          'common.count': 12,
        },
        de: {
          'common.save': 'Speichern',
        },
      }),
    },
    {
      path: '/repo/b/broken.json',
      content: '{',
    },
    {
      path: '/repo/c/translations.json',
      content: JSON.stringify({
        en: {
          'common.save': 'Save override',
          'checkout.title': 'Checkout',
        },
        fr: {
          'common.save': 'Enregistrer',
        },
      }),
    },
  ]);

  assert.deepEqual(snapshot.files, [
    '/repo/a/translations.json',
    '/repo/b/broken.json',
    '/repo/c/translations.json',
  ]);
  assert.equal(snapshot.merged.en['common.save'], 'Save override');
  assert.equal(snapshot.merged.de['common.save'], 'Speichern');
  assert.equal(snapshot.merged.en['common.count'], undefined);
  assert.equal(snapshot.sourceFileIds.en['common.save'], 2);
  assert.equal(snapshot.sourceFileIds.de['common.save'], 0);
  assert.equal(snapshot.localeFileIds.en, 2);
  assert.equal(snapshot.keyFileIds['checkout.title'], 2);
  assert.equal(countUniqueKeys(snapshot.merged), 2);
});

test('resolveSourceFileId prefers exact cell ownership before fallbacks', () => {
  const snapshot = buildTranslationSnapshot([
    {
      path: '/repo/a/translations.json',
      content: JSON.stringify({
        en: {
          'common.save': 'Save',
        },
      }),
    },
    {
      path: '/repo/b/translations.json',
      content: JSON.stringify({
        de: {
          'common.save': 'Speichern',
        },
      }),
    },
  ]);

  assert.equal(resolveSourceFileId(snapshot, 'en', 'common.save'), 0);
  assert.equal(resolveSourceFileId(snapshot, 'de', 'common.cancel'), 1);
  assert.equal(resolveSourceFileId(snapshot, 'fr', 'common.save'), 1);
  assert.equal(resolveSourceFileId(snapshot, 'fr', 'missing.key'), undefined);
});

test('setSourceFileId updates exact ownership and fallback indexes', () => {
  const snapshot = buildTranslationSnapshot([
    {
      path: '/repo/a/translations.json',
      content: JSON.stringify({
        en: {
          'common.save': 'Save',
        },
      }),
    },
    {
      path: '/repo/b/translations.json',
      content: JSON.stringify({
        de: {
          'common.save': 'Speichern',
        },
      }),
    },
  ]);

  setSourceFileId(snapshot, 'fr', 'common.save', 0);

  assert.equal(snapshot.sourceFileIds.fr['common.save'], 0);
  assert.equal(snapshot.localeFileIds.fr, 0);
  assert.equal(snapshot.keyFileIds['common.save'], 0);
});

test('updateTranslationValue updates or creates locale keys and formats JSON', () => {
  const updated = updateTranslationValue(
    JSON.stringify({
      en: {
        'common.save': 'Save',
      },
      metadata: {
        owner: 'team',
      },
    }),
    {
      locale: 'de',
      key: 'common.save',
      value: 'Speichern',
    },
  );

  assert.deepEqual(JSON.parse(updated), {
    en: {
      'common.save': 'Save',
    },
    metadata: {
      owner: 'team',
    },
    de: {
      'common.save': 'Speichern',
    },
  });
  assert.match(updated, /\n  "de": \{/);
});

test('updateTranslationValue throws the provided parse error message', () => {
  assert.throws(
    () =>
      updateTranslationValue('{', {
        locale: 'en',
        key: 'common.save',
        value: 'Save',
        parseErrorMessage: 'Failed to parse translations.json.',
      }),
    /Failed to parse translations\.json\./,
  );
});
