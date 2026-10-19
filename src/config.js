// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { LIMITS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  allow_commands: false,
  allow_reboot: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the API token: the token a stop belongs to, without the token itself. */
export const tokenKey = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

/** A boolean field: only `true` (or the strings Gladys may send) turns it on. */
const flag = (value) => value === true || value === 'true' || value === 1 || value === '1';

export function normalizeConfig(raw = {}) {
  let apiToken = typeof raw?.api_token === 'string' ? raw.api_token.trim() : '';
  // A token is printable ASCII without spaces, bounded: anything else is not sent.
  if (!/^[\x21-\x7e]+$/.test(apiToken) || apiToken.length > LIMITS.apiTokenLength) {
    apiToken = '';
  }
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    apiToken,
    /** The hash of the token: a stop in /data belongs to it. */
    account: apiToken === '' ? '' : tokenKey(apiToken),
    allowCommands: flag(raw?.allow_commands),
    allowReboot: flag(raw?.allow_reboot),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
