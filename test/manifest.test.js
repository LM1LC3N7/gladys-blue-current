// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, and the version set by hand to 0.1.0 everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-blue-current:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.match(
    manifest.gladys_version,
    /^>=4\.86\.0$/,
    'charging-station and text/select need 4.86',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['energy']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(
      docs,
      /not[\s>]+affiliated[\s>]+with[\s>]+Blue[\s>]+Current|sans[\s>]+lien[\s>]+avec[\s>]+Blue[\s>]+Current/i,
    );
    assert.match(
      docs,
      /never[\s>]+tested[\s>]+with[\s>]+a[\s>]+real[\s>]+account|jamais[\s>]+testée?[\s>]+avec[\s>]+un[\s>]+vrai[\s>]+compte/i,
    );
    assert.match(docs, /my\.bluecurrent\.nl/, 'how to create the token');
    // M11 and M13: nothing sent when there is nothing to do; the HELLO identity explained.
    assert.match(
      docs,
      /Nothing is sent when there is nothing to do|Rien\s+n'est envoyé s'il n'y a rien à faire/,
    );
    assert.match(docs, /`homeassistant`/);
    assert.match(docs, /User-Agent/);
  }
  assert.match(read('TODO.md'), /Ask Blue Current whether `gladys` is accepted/);
  for (const file of [
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'gladys-assistant-integration.json',
  ]) {
    assert.doesNotMatch(
      read(file),
      /chiffr|encrypt/i,
      `${file}: a secret field is not encrypted by Gladys`,
    );
  }
});

test('the licenses ship in the image', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'no name of a person');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Copyright \(c\) 2022 Blue Current/);
  assert.match(notices, /bluecurrent\/HomeAssistantAPI/);
  assert.ok(existsSync(new URL('../cover.png', import.meta.url)));
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code; commands and reboot off by default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const key of ['allow_commands', 'allow_reboot']) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, false);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.api_token.type, 'secret', 'the token is never sent back to the browser');
  assert.ok(fields.api_token.required);
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
  }
  assert.ok(intro.links.every((l) => l.url.startsWith('https://')));
});

test('the actions are those of the code, within their timeout', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});
