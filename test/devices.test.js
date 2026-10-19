import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_UNITS_BY_CATEGORY } from './helpers/coreUnits.js';
import {
  CHARGING_STATE,
  CONNECTOR_STATUS,
  DEFINITIONS,
  buildDevice,
  chargingStateOf,
  connectorOf,
  deviceStates,
  durationOf,
  powerOf,
} from '../src/devices.js';
import { FEATURES } from '../src/constants.js';

const gladys = {
  externalIds: (type, id) => {
    const device = `ext:test:${type}:${id}`;
    return { device, feature: (role) => `${device}:${role}` };
  },
};
const ids = gladys.externalIds('chargepoint', 'BCU1');

test('units are those the core lists for each category', () => {
  for (const [role, definition] of Object.entries(DEFINITIONS)) {
    if (definition.unit) {
      assert.ok(
        DEVICE_FEATURE_UNITS_BY_CATEGORY[definition.category]?.includes(definition.unit),
        `${role}: ${definition.unit} on ${definition.category}`,
      );
    }
  }
});

test('connector and charging state from the activity and the vehicle', () => {
  assert.equal(
    connectorOf({ activity: 'available', vehicle: 'standby' }),
    CONNECTOR_STATUS.AVAILABLE,
  );
  assert.equal(
    connectorOf({ activity: 'available', vehicle: 'vehicle_detected' }),
    CONNECTOR_STATUS.OCCUPIED,
  );
  assert.equal(connectorOf({ activity: 'charging' }), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(connectorOf({ activity: 'unavailable' }), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(connectorOf({ activity: 'error' }), CONNECTOR_STATUS.FAULTED);
  assert.equal(connectorOf({ activity: 'offline' }), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(chargingStateOf({ activity: 'charging' }), CHARGING_STATE.CHARGING);
  assert.equal(
    chargingStateOf({ activity: 'available', vehicle: 'ready' }),
    CHARGING_STATE.EV_CONNECTED,
  );
  assert.equal(chargingStateOf({ activity: 'available', vehicle: 'standby' }), CHARGING_STATE.IDLE);
});

test('power: the sum of voltage x current over the phases known', () => {
  assert.equal(powerOf({ voltage1: 230, current1: 10, voltage2: 230, current2: 10 }), 4600);
  assert.equal(powerOf({ voltage1: 230, current1: null }), undefined);
  assert.equal(powerOf({}), undefined);
});

test('duration: to now while charging, to the stop otherwise, nothing without a start', () => {
  const start = 1_000_000_000;
  assert.equal(durationOf({ activity: 'charging', start }, start + 90 * 60_000), 90);
  assert.equal(
    durationOf({ activity: 'available', start, stop: start + 30 * 60_000 }, start + 1e9),
    30,
  );
  assert.equal(durationOf({ activity: 'available', start }, start + 60_000), undefined);
  assert.equal(durationOf({ activity: 'charging', start: null }, start), undefined);
  assert.equal(durationOf({ activity: 'charging', start }, start - 60_000), undefined);
  // An old stop before the start of a session in progress: counted from the start.
  assert.equal(durationOf({ activity: 'charging', start, stop: start - 5 }, start + 120_000), 2);
});

test('offline: only the status, the connector and nothing else', () => {
  const states = deviceStates(ids, { activity: 'offline', energy: 3 }, { language: 'en' }, 0);
  assert.deepEqual(
    states.map((s) => s.device_feature_external_id.split(':').at(-1)),
    [FEATURES.ACTIVITY, FEATURES.CONNECTOR],
  );
});

test('the cost: never 0 for a session with energy (documented as disabled)', () => {
  const roles = (status) =>
    deviceStates(ids, { activity: 'available', ...status }, { language: 'en' }, 0).map((s) =>
      s.device_feature_external_id.split(':').at(-1),
    );
  assert.ok(!roles({ cost: 0, energy: 4 }).includes(FEATURES.SESSION_COST));
  assert.ok(roles({ cost: 0, energy: 0 }).includes(FEATURES.SESSION_COST));
  assert.ok(roles({ cost: 1.2, energy: 4 }).includes(FEATURES.SESSION_COST));
});

test('a device keeps the features of the created one, never fewer', () => {
  const point = { evseId: 'BCU1', name: 'Garage' };
  const fresh = buildDevice(gladys, point, { language: 'en' });
  const created = {
    features: [...fresh.features, { external_id: `${ids.device}:legacy`, name: 'Legacy' }],
  };
  const again = buildDevice(gladys, point, { language: 'fr' }, created);
  assert.equal(again.features.length, fresh.features.length + 1);
  assert.ok(again.features.some((f) => f.external_id === `${ids.device}:legacy`));
  assert.equal(
    buildDevice(gladys, { evseId: 'BCU9' }, { language: 'en' }).name,
    'Blue Current BCU9',
  );
});
