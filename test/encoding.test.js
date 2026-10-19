// -----------------------------------------------------------------------------
// The texts users and contributors read are UTF-8 without BOM, and never
// mojibake: UTF-8 bytes read as Latin-1 / Windows-1252 and saved again ("é"
// becoming "Ã" + "©", the apostrophe "’" becoming "â" + "€" + "™").
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Â and Ã never appear in these English and French texts, nor Å followed by
// ’ or “ (œ, Œ read as Windows-1252): each is a UTF-8 sequence read as Latin-1.
const MOJIBAKE = /Ã|Â|â€|Å[’“]/;
const FILES = [
  'gladys-assistant-integration.json',
  'package.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'TODO.md',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'index.js',
  ...readdirSync(new URL('../src/', import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `src/${name}`),
];

for (const file of FILES) {
  test(`${file}: UTF-8 without BOM, no mojibake`, () => {
    const bytes = readFileSync(new URL(`../${file}`, import.meta.url));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), 'invalid UTF-8');
    const line = text.split('\n').findIndex((l) => MOJIBAKE.test(l));
    assert.equal(line, -1, `mojibake on line ${line + 1}`);
  });
}

test('the mojibake pattern catches what it should', () => {
  assert.match('FranÃ§ais', MOJIBAKE, 'ç read as Latin-1');
  assert.match('Â«', MOJIBAKE, '« read as Latin-1');
  assert.match('lâ€™app', MOJIBAKE, '’ read as Windows-1252');
  assert.match('finâ€¦', MOJIBAKE, '… read as Windows-1252');
  assert.match('Å“uvre', MOJIBAKE, 'œ read as Windows-1252');
  assert.match('Å’uvre', MOJIBAKE, 'Œ read as Windows-1252');
  assert.doesNotMatch('Français « Découverte » 800×534 — l’app… 14:45–15:05 œuvre', MOJIBAKE);
});
