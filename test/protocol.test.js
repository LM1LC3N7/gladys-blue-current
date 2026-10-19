import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_COMMANDS, LIMITS } from '../src/constants.js';
import {
  actionAnswer,
  errorKind,
  parseMessage,
  readChargePoints,
  readStatus,
  tokenOf,
} from '../src/protocol.js';
import { normalizeConfig } from '../src/config.js';
import { closeKind, rejectKind } from '../src/socket.js';
import { normalizeMemory } from '../src/store.js';

test('messages: bounded, JSON objects with an object name, no prototype pollution', () => {
  assert.deepEqual(parseMessage('{"object":"HELLO"}'), { object: 'HELLO' });
  assert.deepEqual(parseMessage(Buffer.from('{"object":"HELLO"}')), { object: 'HELLO' });
  for (const bad of [
    'nope',
    '[]',
    '{"a":1}',
    '{"object":""}',
    '{"object":"x y"}',
    '{"object":1}',
    `{"object":"HELLO","pad":"${'x'.repeat(LIMITS.messageBytes)}"}`,
    42,
  ]) {
    assert.equal(parseMessage(bad), undefined, String(bad).slice(0, 40));
  }
  const message = parseMessage(
    '{"object":"CH_STATUS","__proto__":{"polluted":true},"data":{"constructor":{"prototype":{"x":1}},"activity":"charging"}}',
  );
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(message), Object.prototype);
  assert.equal(Object.hasOwn(message, '__proto__'), false);
  assert.equal(Object.hasOwn(message.data, 'constructor'), false);
  assert.equal(message.data.activity, 'charging');
});

test('charge points: valid ids only, no duplicates, bounded, texts cleaned', () => {
  const points = readChargePoints({
    object: 'CHARGE_POINTS',
    data: [
      {
        evse_id: 'BCU1',
        name: 'Garage\u0007 ',
        model_type: 'U:MOVE22',
        activity: 'Charging',
        default_card: { uid: 'BCU-APP' },
      },
      { evse_id: 'BCU1', name: 'dup' },
      { evse_id: 'a:b' },
      { evse_id: '__proto__' },
      null,
      'x',
      { evse_id: 'BCU2', default_card: { uid: 'bad uid!' } },
    ],
  });
  assert.deepEqual(points, [
    { evseId: 'BCU1', name: 'Garage', model: 'U:MOVE22', activity: 'charging', card: 'BCU-APP' },
    {
      evseId: '__proto__',
      name: undefined,
      model: undefined,
      activity: undefined,
      card: undefined,
    },
    { evseId: 'BCU2', name: undefined, model: undefined, activity: undefined, card: undefined },
  ]);
  const many = readChargePoints({
    data: Array.from({ length: 80 }, (_, i) => ({ evse_id: `B${i}` })),
  });
  assert.equal(many.length, LIMITS.chargePoints);
  assert.deepEqual(readChargePoints({ data: 'x' }), []);
});

test('a status: only the fields it carries, unusable values are null', () => {
  const status = readStatus(
    {
      data: {
        activity: 'charging',
        vehicle_status: 'C',
        actual_p1: 16,
        actual_p2: '16',
        actual_v1: null,
        actual_kwh: 3.5,
        total_cost: -1,
        start_datetime: '20261018 11:00:00',
      },
    },
    1,
  );
  assert.deepEqual(status, {
    receivedAt: 1,
    activity: 'charging',
    vehicle: 'ready',
    current1: 16,
    current2: null,
    voltage1: null,
    energy: 3.5,
    cost: null,
    start: Date.UTC(2026, 9, 18, 9, 0, 0),
  });
  assert.deepEqual(readStatus({ data: { activity: 'dancing', vehicle_status: 'Z' } }, 1), {
    receivedAt: 1,
    activity: null,
    vehicle: null,
  });
});

test('answers to the commands, attributed by their object and evse id', () => {
  const a = (message) => actionAnswer(message, ACTION_COMMANDS);
  assert.deepEqual(a({ object: 'RECEIVED_START_SESSION', evse_id: 'BCU1', error: '' }), {
    command: 'START_SESSION',
    stage: 'received',
    ok: true,
    evseId: 'BCU1',
  });
  assert.equal(a({ object: 'STATUS_STOP_SESSION', success: true, error: '' }).ok, true);
  assert.equal(a({ object: 'STATUS_STOP_SESSION', success: false }).ok, false);
  assert.equal(a({ object: 'STATUS_REBOOT', success: true, error: 'FAILED' }).ok, false);
  assert.equal(a({ object: 'RECEIVED_REBOOT', error: 3 }).ok, false);
  assert.equal(a({ object: 'STATUS_API_TOKEN', success: true }), undefined);
  assert.equal(a({ object: 'CH_STATUS' }), undefined);
  assert.equal(a({ object: 'STATUS_SET_PLUG_AND_CHARGE' }), undefined);
});

test('errors, refusals and the validation answer', () => {
  assert.equal(errorKind({ object: 'ERROR', error: 1 }), 'unauthorized');
  assert.equal(errorKind({ object: 'ERROR', error: 2 }), 'unauthorized');
  assert.equal(errorKind({ object: 'ERROR', error: 42 }), 'rate_limited');
  assert.equal(errorKind({ object: 'ERROR', error: 9 }), 'server_error');
  assert.equal(rejectKind(403, 'Request limit reached'), 'rate_limited');
  assert.equal(rejectKind(403, 'Already connected'), 'already_connected');
  assert.equal(rejectKind(401), 'unauthorized');
  assert.equal(rejectKind(502), 'http');
  assert.equal(closeKind(4001), 'rate_limited');
  assert.equal(closeKind(1006), 'closed');
  assert.equal(tokenOf({ object: 'STATUS_API_TOKEN', success: true, token: 'abc' }), 'abc');
  assert.equal(tokenOf({ object: 'STATUS_API_TOKEN', success: false, token: 'abc' }), undefined);
  assert.equal(tokenOf({ object: 'STATUS_API_TOKEN', success: true, token: 'a b' }), undefined);
});

test('the configuration: a token is printable and bounded; commands off unless true', () => {
  assert.equal(normalizeConfig({ api_token: '  abc  ' }).apiToken, 'abc');
  assert.equal(normalizeConfig({ api_token: 'a b' }).apiToken, '');
  assert.equal(normalizeConfig({ api_token: 'x'.repeat(600) }).apiToken, '');
  assert.equal(normalizeConfig({}).allowCommands, false);
  assert.equal(normalizeConfig({ allow_commands: 'yes' }).allowCommands, false);
  assert.equal(normalizeConfig({ allow_commands: 'true' }).allowCommands, true);
  assert.equal(normalizeConfig({ allow_reboot: true }).allowReboot, true);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});

test('/data read back: bounded to 25 h, repaired', () => {
  const now = 1_000_000;
  const memory = normalizeMemory(
    {
      block: { account: '0123456789abcdef', kind: 'refused', retryAt: now + 1e12, retries: 99 },
      pause: { kind: 'rate', until: now + 1e12 },
    },
    now,
  );
  assert.equal(memory.block.retryAt, now + 25 * 3_600_000);
  assert.equal(memory.block.retries, 10);
  assert.equal(memory.pause.until, now + 25 * 3_600_000);
  assert.deepEqual(normalizeMemory({ block: { kind: 'x' }, pause: { until: now - 1 } }, now), {
    block: null,
    pause: null,
  });
  assert.deepEqual(normalizeMemory('garbage', now), { block: null, pause: null });
});
