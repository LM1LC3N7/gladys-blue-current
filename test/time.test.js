import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amsterdamEpoch, nextReset, parseDate } from '../src/time.js';

test('Blue Current dates are read in Amsterdam time, summer and winter', () => {
  // Summer (CEST, UTC+2) and winter (CET, UTC+1).
  assert.equal(parseDate('20261018 11:00:00'), Date.UTC(2026, 9, 18, 9, 0, 0));
  assert.equal(parseDate('20221110 11:41:32'), Date.UTC(2022, 10, 10, 10, 41, 32));
  // Around midnight: the day of Amsterdam, not of UTC.
  assert.equal(parseDate('20260101 00:30:00'), Date.UTC(2025, 11, 31, 23, 30, 0));
  assert.equal(parseDate('20260701 23:30:00'), Date.UTC(2026, 6, 1, 21, 30, 0));
});

test('an explicit offset wins', () => {
  assert.equal(parseDate('20261018 11:00:00+0100'), Date.UTC(2026, 9, 18, 10, 0, 0));
  assert.equal(parseDate('20261018 11:00:00-05:00'), Date.UTC(2026, 9, 18, 16, 0, 0));
});

test('the changes of time: the skipped hour and the repeated hour', () => {
  // 2026-03-29 02:30 does not exist in Amsterdam: the time after the jump (03:30 CEST).
  assert.equal(amsterdamEpoch(2026, 3, 29, 2, 30), Date.UTC(2026, 2, 29, 1, 30));
  // 2026-10-25 02:30 happens twice: the first (CEST).
  assert.equal(amsterdamEpoch(2026, 10, 25, 2, 30), Date.UTC(2026, 9, 25, 0, 30));
  assert.equal(amsterdamEpoch(2026, 10, 25, 3, 30), Date.UTC(2026, 9, 25, 2, 30));
});

test('empty, null and malformed dates give nothing', () => {
  for (const value of [
    '',
    null,
    undefined,
    0,
    '2026-10-18 11:00:00',
    '20260230 10:00:00',
    '20261018 25:00:00',
    'x'.repeat(100),
  ]) {
    assert.equal(parseDate(value), undefined, String(value));
  }
});

test('the request limit is reset at 00:00:30 in Amsterdam, the next day', () => {
  // 14:00 CEST -> 00:00:30 CEST.
  assert.equal(nextReset(Date.UTC(2026, 9, 18, 12, 0)), Date.UTC(2026, 9, 18, 22, 0, 30));
  // 23:59:50 CEST -> 40 s later.
  assert.equal(nextReset(Date.UTC(2026, 9, 18, 21, 59, 50)), Date.UTC(2026, 9, 18, 22, 0, 30));
  // 00:00:10 CEST: the next day (as bluecurrent-api), almost 24 h.
  assert.equal(nextReset(Date.UTC(2026, 9, 18, 22, 0, 10)), Date.UTC(2026, 9, 19, 22, 0, 30));
  // Over the change of time (25 October): midnight CET is 23:00 UTC.
  assert.equal(nextReset(Date.UTC(2026, 9, 25, 12, 0)), Date.UTC(2026, 9, 25, 23, 0, 30));
  // In winter, 23:30 UTC is already the next day in Amsterdam.
  assert.equal(nextReset(Date.UTC(2026, 11, 31, 23, 30)), Date.UTC(2027, 0, 1, 23, 0, 30));
});
