// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Blue Current WebSocket server behind the socket factory.
// Timers and Date are mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { BlueCurrentApp } from '../src/app.js';
import { ACTIONS, FEATURES, TIMINGS } from '../src/constants.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/devices.js';
import { ERRORS } from '../src/i18n.js';
import { registerHandlers } from '../src/handlers.js';
import { tokenKey } from '../src/config.js';
import {
  API_TOKEN,
  AUTH,
  EVSE,
  charging,
  chargePoint,
  fakeBlueCurrent,
  memoryStore,
  settle,
  status,
} from './helpers/fakeBlueCurrent.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2026-10-18 12:00:00 UTC = 14:00 in Amsterdam (CEST). */
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const CONFIG = { api_token: API_TOKEN };
const COMMANDS_ON = { api_token: API_TOKEN, allow_commands: true };
const DEVICE = `ext:test-integration:chargepoint:${EVSE}`;
const feature = (role) => `${DEVICE}:${role}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeBlueCurrent(),
    now = NOW,
    create = true,
    logs = [],
  } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const gladys = createFakeGladys({ config });
  const app = new BlueCurrentApp({
    gladys,
    logger: recorder(logs),
    socketFactory: server.factory,
    now: () => Date.now(),
    store,
    random: () => 1,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 1_000) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle(5);
    }
    await settle();
  };
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

const last = (gladys, role) => gladys.fake.lastState(feature(role));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const deviceOf = (gladys) => gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
const featureOf = (gladys, role) =>
  deviceOf(gladys).features.find((f) => f.external_id === feature(role));
const press = (gladys, role, value = 1) =>
  gladys.fake.setValue(deviceOf(gladys), featureOf(gladys, role), value);
const errorOf = (ack) => JSON.stringify(ack);

test('without a token, the status asks for it and nothing is opened', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.sockets.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /API token/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /jeton/);
  assert.equal(server.sockets.length, 0);
});

test('validation, one connection, HELLO, the list and the statuses: device, states, status', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  assert.equal(server.validations, 1);
  assert.equal(server.open.length, 1, 'the validation connection is closed, one connection stays');
  assert.deepEqual(
    server.main.sent.map((m) => m.command),
    ['HELLO', 'GET_CHARGE_POINTS', 'GET_CH_STATUS'],
  );
  assert.equal(server.main.sent[0].header, 'homeassistant');
  assert.ok(server.main.sent.every((m) => m.Authorization === `Token ${AUTH}`));
  assert.equal(server.main.sent[2].evse_id, EVSE);
  assert.equal(server.main.options.maxPayload, 256 * 1024, 'messages bounded');
  assert.equal(server.main.url, 'wss://motown.bluecurrent.nl/haserver');

  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /1 charge point\b/);
  const device = deviceOf(gladys);
  assert.equal(device.name, 'Garage');
  assert.equal(device.model, 'U:MOVE22');
  const roles = device.features.map((f) => f.external_id.slice(DEVICE.length + 1));
  assert.deepEqual(roles, Object.values(FEATURES));
  for (const role of [FEATURES.START, FEATURES.STOP, FEATURES.REBOOT]) {
    assert.equal(featureOf(gladys, role).category, 'button', `${role} is a button`);
  }
  assert.ok(
    device.features.every((f) => f.category !== 'switch' && f.type !== 'binary'),
    'never a switch nor a binary',
  );

  assert.equal(last(gladys, FEATURES.ACTIVITY), 'Disponible');
  assert.equal(last(gladys, FEATURES.CONNECTOR), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(last(gladys, FEATURES.CHARGING_STATE), CHARGING_STATE.IDLE);
  assert.equal(last(gladys, FEATURES.VOLTAGE_L2), 231);
  assert.equal(last(gladys, FEATURES.POWER), 0);
  assert.equal(last(gladys, FEATURES.MAX_CURRENT), 16);
  assert.equal(last(gladys, FEATURES.AVAILABILITY), 'operative');
  assert.equal(last(gladys, FEATURES.SESSION_COST), 0, 'a 0 cost without energy');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: DEVICE_TRANSPORTS.CLOUD,
  });

  const everything = JSON.stringify([logs, store.data, gladys.fake.requests]);
  assert.ok(!everything.includes(API_TOKEN), 'the API token never reaches logs, /data or Gladys');
  assert.ok(!everything.includes(AUTH), 'nor the auth token');
});

test('pushed statuses (partial ones too) update the states; charging is computed per phase', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.push({ object: 'CH_STATUS', evse_id: EVSE, data: charging() });
  await advance(2_000);
  assert.equal(last(gladys, FEATURES.ACTIVITY), 'En charge');
  assert.equal(last(gladys, FEATURES.CONNECTOR), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(last(gladys, FEATURES.CHARGING_STATE), CHARGING_STATE.CHARGING);
  assert.equal(last(gladys, FEATURES.POWER), Math.round(230 * 16 + 231 * 16 + 229 * 15.5));
  assert.equal(last(gladys, FEATURES.CURRENT_L3), 15.5);
  assert.equal(last(gladys, FEATURES.SESSION_ENERGY), 7.25);
  assert.equal(last(gladys, FEATURES.SESSION_COST), 2.1);
  // 11:00 in Amsterdam (CEST) = 09:00 UTC; now 12:00 UTC (+2 s): 180 minutes.
  assert.equal(last(gladys, FEATURES.SESSION_DURATION), 180);
  assert.equal(last(gladys, FEATURES.VEHICLE), 'Véhicule prêt à charger');

  // A partial push: only the energy moves, the rest stays.
  server.push({ object: 'CH_STATUS', evse_id: EVSE, data: { actual_kwh: 8.5 } });
  await advance(2_000);
  assert.equal(last(gladys, FEATURES.SESSION_ENERGY), 8.5);
  assert.equal(last(gladys, FEATURES.ACTIVITY), 'En charge');

  // Offline: the readings keep their value, the badge says unreachable.
  server.push({ object: 'CH_STATUS', evse_id: EVSE, data: { activity: 'offline' } });
  await advance(2_000);
  assert.equal(last(gladys, FEATURES.ACTIVITY), 'Hors ligne');
  assert.equal(last(gladys, FEATURES.CONNECTOR), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(last(gladys, FEATURES.SESSION_ENERGY), 8.5);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
});

test('a status of an unknown charge point, an unusable or a huge message: ignored', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const before = gladys.fake.states.length;
  server.push({ object: 'CH_STATUS', evse_id: 'OTHER1', data: charging() });
  server.push('not json');
  server.push({
    object: 'CH_STATUS',
    evse_id: EVSE,
    data: { activity: 'charging' },
    pad: 'x'.repeat(300_000),
  });
  server.push(
    '{"object":"CH_STATUS","evse_id":"BCU100186","data":{"__proto__":{"polluted":1},"activity":"error"}}',
  );
  await advance(2_000);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  assert.equal(last(gladys, FEATURES.ACTIVITY), 'Erreur', 'the safe fields of a message are read');
  assert.ok(gladys.fake.states.length > before);
  assert.equal(server.open.length, 1, 'the connection stays');
});

test('a refused token: a persisted stop, no loop, one new try after 6 h; a new token goes at once', async (t) => {
  const store = memoryStore();
  const server = fakeBlueCurrent();
  server.apiToken = 'another-token';
  const { gladys, advance } = await setup(t, { store, server });
  assert.equal(server.validations, 1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /refused the API token/);
  assert.equal(store.data.block.kind, 'refused');
  assert.equal(store.data.block.account, tokenKey(API_TOKEN));
  assert.ok(!JSON.stringify(store.data).includes(API_TOKEN));

  await advance(5 * HOUR, MINUTE);
  assert.equal(server.validations, 1, 'never sent again before its time');
  await advance(HOUR + MINUTE, MINUTE);
  assert.equal(server.validations, 2, 'one new try after 6 h');
  await advance(23 * HOUR, 10 * MINUTE);
  assert.equal(server.validations, 2, 'then every 24 h');

  // A restart with the same token keeps the stop.
  const gladys2 = createFakeGladys({ config: CONFIG });
  const app2 = new BlueCurrentApp({
    gladys: gladys2,
    logger: recorder([]),
    socketFactory: server.factory,
    now: () => Date.now(),
    store,
    random: () => 1,
  });
  registerHandlers(gladys2, app2);
  t.after(() => app2.stop());
  await gladys2.connect();
  await settle();
  assert.equal(server.validations, 2, 'no try at a restart');
  assert.match(gladys2.fake.connectionStatus.message.en, /refused/);

  // A new token: at once.
  server.apiToken = 'new-token';
  await gladys.fake.configUpdated({ api_token: 'new-token' });
  await settle();
  assert.equal(server.validations, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.block, null);
});

test('the test button tries a refused token again at once, once per 30 s', async (t) => {
  const server = fakeBlueCurrent();
  server.apiToken = 'another-token';
  const { gladys, advance } = await setup(t, { server });
  server.apiToken = API_TOKEN;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  await settle();
  assert.equal(server.validations, 2);
  assert.match(ack.data.message.en, /Connected to Blue Current: 1 charge point/);
  await advance(1_000);
  const again = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(again.data.message.en, /1 charge point/);
  assert.equal(server.validations, 2);
});

test('an auth token refused later is validated again once, never in a loop', async (t) => {
  const { gladys, server, advance } = await setup(t);
  assert.equal(server.validations, 1);
  server.push({ object: 'ERROR', error: 1, message: 'Invalid Auth Token' });
  await advance(2_000);
  assert.equal(server.open.length, 0, 'the connection is closed');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await advance(TIMINGS.backoff[0]);
  assert.equal(server.validations, 2, 'validated again after the backoff');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a token accepted then refused on the connection itself: a stop, not a loop', async (t) => {
  const server = fakeBlueCurrent();
  server.auth = 'other-auth'; // validation gives AUTH... the server expects another one
  server.validateAnswer = { object: 'STATUS_API_TOKEN', success: true, token: AUTH };
  const { gladys, advance } = await setup(t, { server });
  assert.match(message(gladys).en, /refused the API token/);
  await advance(HOUR, MINUTE);
  assert.equal(server.validations, 1);
});

test('the request limit: a pause until midnight in Amsterdam, kept across a restart', async (t) => {
  const store = memoryStore();
  const { gladys, server, advance } = await setup(t, { store });
  server.push({ object: 'ERROR', error: 42, message: 'Request limit reached' });
  await advance(2_000);
  assert.match(message(gladys).en, /daily request limit/);
  // 14:00 CEST -> 00:00:30 CEST = 10 h later (minus the 2 s).
  const midnight = Date.UTC(2026, 9, 18, 22, 0, 30);
  assert.equal(store.data.pause.until, midnight);
  const sockets = server.sockets.length;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /daily request limit/);
  await advance(9 * HOUR, 10 * MINUTE);
  assert.equal(server.sockets.length, sockets, 'nothing before midnight');
  await advance(HOUR - 2 * MINUTE, MINUTE);
  assert.equal(server.sockets.length, sockets, 'nor at 23:58');
  await advance(3 * MINUTE, 10_000);
  assert.ok(server.sockets.length > sockets, 'connected again after 00:00:30');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a close 4001 and a handshake "Request limit reached" are the request limit too', async (t) => {
  const store = memoryStore();
  const { server, advance } = await setup(t, { store });
  server.refusals.push({ status: 403, reason: 'Request limit reached' });
  server.main.drop(4001);
  await advance(2_000);
  assert.equal(store.data.pause.kind, 'rate');
  const sockets = server.sockets.length;
  await advance(HOUR, MINUTE);
  assert.equal(server.sockets.length, sockets);
});

test('a lost connection comes back with a backoff, never at once; "Already connected" waits 2 min', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.unreachable = 3;
  server.main.drop(1006);
  await advance(500, 100);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /lost/);
  const sockets = server.sockets.length;
  await advance(4_000);
  assert.equal(server.sockets.length, sockets, 'not before the first step');
  await advance(TIMINGS.backoff[0] + TIMINGS.backoff[1] + TIMINGS.backoff[2] + TIMINGS.backoff[3]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(server.validations, 1, 'the auth token is kept across reconnections');

  server.refusals.push({ status: 403, reason: 'Already connected' });
  server.main.drop(1006);
  await advance(TIMINGS.backoff[0] + 1_000);
  assert.match(message(gladys).en, /already open elsewhere/);
  const after = server.sockets.length;
  await advance(MINUTE);
  assert.equal(server.sockets.length, after, 'two minutes at least');
  await advance(2 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('no pong: the connection is cut and opened again', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.answerPings = false;
  const first = server.main;
  await advance(2 * TIMINGS.pingInterval + 1_000, 10_000);
  assert.equal(first.readyState, 3);
  server.answerPings = true;
  await advance(TIMINGS.backoff[0] + 1_000);
  assert.notEqual(server.main, first);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a reconnection to Gladys sends the status and Discovery again, keeps the connection', async (t) => {
  const { gladys, server } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const main = server.main;
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(server.main, main);
  assert.equal(server.validations, 1);
});

test('a reconnection to Gladys keeps the request-limit pause and the refused-token stop', async (t) => {
  const server = fakeBlueCurrent();
  server.apiToken = 'other';
  const { gladys } = await setup(t, { server });
  await gladys.connect();
  await settle();
  assert.equal(server.validations, 1);
  assert.match(message(gladys).en, /refused/);
});

test('a device published again keeps every feature of the created device', async (t) => {
  const { gladys, app } = await setup(t, { create: false });
  const device = deviceOf(gladys);
  const extra = {
    ...device.features[0],
    external_id: `${DEVICE}:from-another-version`,
    name: 'Old',
  };
  await gladys.fake.deviceCreated({ ...device, features: [...device.features, extra] });
  await settle();
  await app.scan();
  assert.ok(deviceOf(gladys).features.some((f) => f.external_id === extra.external_id));
});

// --- Commands --------------------------------------------------------------------

test('commands are off by default: refused, nothing sent', async (t) => {
  const { gladys, server } = await setup(t);
  const sent = server.received.length;
  for (const role of [FEATURES.START, FEATURES.STOP, FEATURES.REBOOT]) {
    const ack = await press(gladys, role);
    assert.equal(ack.success, false);
  }
  const ack = await press(gladys, FEATURES.AVAILABILITY, 'blocked');
  assert.equal(ack.success, false);
  assert.match(errorOf(ack), /Autoriser les commandes/);
  assert.equal(server.received.length, sent);
  const reading = await gladys.fake.setValue(
    deviceOf(gladys),
    featureOf(gladys, FEATURES.POWER),
    1,
  );
  assert.match(errorOf(reading), /lecture seule/);
});

test('start: the status read again, then START_SESSION with the default card; acked on its result', async (t) => {
  const { gladys, server } = await setup(t, { config: COMMANDS_ON });
  const ack = await press(gladys, FEATURES.START);
  assert.equal(ack.success, true, errorOf(ack));
  const tail = server.main.sent.slice(-2);
  assert.deepEqual(
    tail.map((m) => m.command),
    ['GET_CH_STATUS', 'START_SESSION'],
  );
  assert.equal(tail[1].evse_id, EVSE);
  assert.equal(tail[1].session_token, 'BCU-APP');
});

test('start while charging, stop without vehicle, already available: nothing sent', async (t) => {
  const server = fakeBlueCurrent();
  server.statuses[EVSE] = charging();
  const { gladys } = await setup(t, { config: COMMANDS_ON, server });
  let ack = await press(gladys, FEATURES.START);
  assert.equal(ack.success, true);
  assert.equal(server.commands('START_SESSION').length, 0);
  ack = await press(gladys, FEATURES.AVAILABILITY, 'operative');
  assert.equal(ack.success, true);
  assert.equal(server.commands('SET_OPERATIVE').length, 0);

  server.statuses[EVSE] = status();
  ack = await press(gladys, FEATURES.STOP);
  assert.equal(ack.success, true);
  assert.equal(server.commands('STOP_SESSION').length, 0);
  server.statuses[EVSE] = status({ vehicle_status: 'B' });
  ack = await press(gladys, FEATURES.STOP);
  assert.equal(ack.success, true);
  assert.equal(server.commands('STOP_SESSION').length, 1, 'a plugged vehicle may hold a session');
});

test('decided on the status read again, never on the memory', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: COMMANDS_ON });
  // Memory says available, the charge point is now offline.
  server.statuses[EVSE] = status({ activity: 'offline' });
  let ack = await press(gladys, FEATURES.START);
  assert.match(errorOf(ack), /hors ligne/);
  assert.equal(server.commands('START_SESSION').length, 0);
  // A status without activity: refused.
  server.statuses[EVSE] = { actual_kwh: 1 };
  ack = await press(gladys, FEATURES.START);
  assert.match(errorOf(ack), /pas pu être lu/);
  // No answer to the status: refused, not sent.
  server.silentStatus = true;
  const pending = press(gladys, FEATURES.START);
  await advance(5_000, 100);
  ack = await pending;
  assert.match(errorOf(ack), /pas pu être lu/);
  assert.equal(server.commands('START_SESSION').length, 0);
});

test('block and unblock: SET_INOPERATIVE / SET_OPERATIVE from the select; strict values', async (t) => {
  const server = fakeBlueCurrent();
  const { gladys } = await setup(t, { config: COMMANDS_ON, server });
  let ack = await press(gladys, FEATURES.AVAILABILITY, 'blocked');
  assert.equal(ack.success, true, errorOf(ack));
  assert.equal(server.commands('SET_INOPERATIVE').length, 1);
  server.statuses[EVSE] = status({ activity: 'unavailable' });
  ack = await press(gladys, FEATURES.AVAILABILITY, 'operative');
  assert.equal(ack.success, true);
  assert.equal(server.commands('SET_OPERATIVE').length, 1);
  for (const value of ['', 'on', 'BLOCKED']) {
    ack = await press(gladys, FEATURES.AVAILABILITY, value);
    assert.match(errorOf(ack), /Valeur invalide/, String(value));
  }
  ack = await press(gladys, FEATURES.START, 0);
  assert.match(errorOf(ack), /Valeur invalide/);
});

test('reboot needs its own option', async (t) => {
  const { gladys, server, app } = await setup(t, { config: COMMANDS_ON });
  let ack = await press(gladys, FEATURES.REBOOT);
  assert.match(errorOf(ack), /redémarrage/);
  assert.equal(server.commands('REBOOT').length, 0);
  await app.configUpdated({ ...COMMANDS_ON, allow_reboot: true });
  ack = await press(gladys, FEATURES.REBOOT);
  assert.equal(ack.success, true, errorOf(ack));
  assert.equal(server.commands('REBOOT').length, 1);
});

test('a refused result is said refused; no answer at all is "sent, without confirmation"', async (t) => {
  const server = fakeBlueCurrent();
  const { gladys, advance } = await setup(t, { config: COMMANDS_ON, server });
  server.commandAnswers.START_SESSION = [
    { object: 'RECEIVED_START_SESSION', evse_id: EVSE, error: '' },
    { object: 'STATUS_START_SESSION', success: false, evse_id: EVSE, error: 'NO_CARD' },
  ];
  let ack = await press(gladys, FEATURES.START);
  assert.match(errorOf(ack), /Blue Current a refusé la commande/);
  assert.ok(!errorOf(ack).includes('NO_CARD'), 'never the free text of an answer');

  server.silentCommands.add('START_SESSION');
  let pending = press(gladys, FEATURES.START);
  await advance(5_000, 100);
  ack = await pending;
  assert.equal(ack.success, false);
  assert.ok(errorOf(ack).includes(ERRORS.sentNoConfirmation.fr));

  server.silentCommands.delete('START_SESSION');
  server.commandAnswers.START_SESSION = [
    { object: 'RECEIVED_START_SESSION', evse_id: EVSE, error: '' },
  ];
  pending = press(gladys, FEATURES.START);
  await advance(5_000, 100);
  ack = await pending;
  assert.ok(errorOf(ack).includes(ERRORS.receivedNoResult.fr));
  // The status is read again a few seconds later.
  const reads = server.commands('GET_CH_STATUS').length;
  await advance(TIMINGS.refreshAfterCommand + 1_000);
  assert.ok(server.commands('GET_CH_STATUS').length > reads);
});

test('the connection lost after sending: "sent, without confirmation", never "not sent"', async (t) => {
  const server = fakeBlueCurrent();
  const { gladys, advance } = await setup(t, { config: COMMANDS_ON, server });
  server.silentCommands.add('STOP_SESSION');
  server.statuses[EVSE] = charging();
  const pending = press(gladys, FEATURES.STOP);
  await settle();
  server.main.drop(1006);
  await advance(1_000, 100);
  const ack = await pending;
  assert.ok(errorOf(ack).includes(ERRORS.sentNoConfirmation.fr), errorOf(ack));
});

test('the option turned off during the read: refused, not sent', async (t) => {
  const server = fakeBlueCurrent();
  const { gladys, app, advance } = await setup(t, { config: COMMANDS_ON, server });
  server.silentStatus = true;
  const pending = press(gladys, FEATURES.START);
  await settle();
  await app.configUpdated(CONFIG);
  server.silentStatus = false;
  server.push({ object: 'CH_STATUS', evse_id: EVSE, data: status() });
  await advance(1_000, 100);
  const ack = await pending;
  assert.match(errorOf(ack), /Autoriser les commandes/);
  assert.equal(server.commands('START_SESSION').length, 0);
});

test('one command at a time', async (t) => {
  const server = fakeBlueCurrent();
  const { gladys, advance } = await setup(t, { config: COMMANDS_ON, server });
  server.silentCommands.add('START_SESSION');
  const first = press(gladys, FEATURES.START);
  await settle();
  const second = await press(gladys, FEATURES.STOP);
  assert.match(errorOf(second), /Une autre commande est en cours/);
  await advance(5_000, 100);
  await first;
});

test('not connected or no default card: refused, nothing sent', async (t) => {
  const server = fakeBlueCurrent({ points: [chargePoint(EVSE, { default_card: null })] });
  const { gladys, advance } = await setup(t, { config: COMMANDS_ON, server });
  let ack = await press(gladys, FEATURES.START);
  assert.match(errorOf(ack), /carte de recharge/);
  assert.equal(server.commands('START_SESSION').length, 0);
  server.unreachable = 10;
  server.main.drop(1006);
  await advance(1_000, 100);
  ack = await press(gladys, FEATURES.STOP);
  assert.match(errorOf(ack), /Non connecté/);
});
