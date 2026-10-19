// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the API token nor the auth token:
//   - the end of the request-limit pause (Blue Current resets it at midnight,
//     Amsterdam time): a restart never connects again before;
//   - a stop after a refused token, with the token it belongs to (a hash) and
//     its next try: a restart never sends a refused token again before.
// Every time read back is bounded: nothing holds more than 25 h after a
// restart. The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { TIMINGS } from './constants.js';

export const STATE_FILE = '/data/blue-current-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > 64 * 1024 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** A time read back from /data: in the future, at most 25 h away, else undefined. */
export const bounded = (value, now) =>
  Number.isFinite(value) && value > now ? Math.min(value, now + TIMINGS.persistedMax) : undefined;

/** The persisted state, repaired and bounded. */
export function normalizeMemory(raw, now) {
  const b = raw?.block;
  const retryAt = bounded(b?.retryAt, now);
  const block =
    typeof b?.account === 'string' &&
    /^[0-9a-f]{16}$/.test(b.account) &&
    b.kind === 'refused' &&
    retryAt !== undefined
      ? {
          account: b.account,
          kind: 'refused',
          retryAt,
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
        }
      : null;
  const until = bounded(raw?.pause?.until, now);
  return {
    block,
    pause: until !== undefined && raw.pause.kind === 'rate' ? { kind: 'rate', until } : null,
  };
}
