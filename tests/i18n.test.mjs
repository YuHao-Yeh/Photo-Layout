import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, LANGUAGES } from '../js/i18n.js';

const keys = (lang) => Object.keys(STRINGS[lang]).sort();

test('every language has the same keys', () => {
  for (const lang of LANGUAGES) assert.deepEqual(keys(lang), keys('en'), lang);
});

test('every data-i18n key used in index.html exists', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const used = [...html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const key of used) assert.ok(key in STRINGS.en, `missing key: ${key}`);
});

test('message templates fill in their values', () => {
  for (const lang of LANGUAGES) {
    const text = STRINGS[lang].partialAdd({ room: 3, max: 12 });
    assert.match(text, /3/);
    assert.match(text, /12/);
  }
});
