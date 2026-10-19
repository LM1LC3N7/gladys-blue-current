// -----------------------------------------------------------------------------
// A charge point -> one Gladys device and its states (pure).
//
// `ext:<selector>:chargepoint:<evse_id>`: one device per Blue Current charge
// point. Readings are read only. The commands are `button`/`push` features
// and one `text`/`select` (never a switch nor a binary: a "turn everything
// off" of a voice assistant or a scene must not reach them), refused unless
// the configuration allows them (src/app.js).
//
// Every device carries all its features, whatever the charge point reports
// (one or three phases), and a device published again keeps every feature of
// the device the user created: a missing feature would read as a change of
// structure, and "Update" would drop its history.
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): W, A and V on `energy-sensor` (never an
// index), kWh on `electrical-vehicle-charge` (the energy of the session, not
// an index), minutes on `duration`, euro on `currency`. No energy index:
// Blue Current gives no cumulative meter.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { AVAILABILITY, FEATURES, TIMINGS } from './constants.js';
import { ACTIVITY_NAMES, AVAILABILITY_NAMES, FEATURE_NAMES, VEHICLE_NAMES, word } from './i18n.js';

/** CHARGING_STATION_CONNECTOR_STATUS of the core (server/utils/constants.js). */
export const CONNECTOR_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
  UNAVAILABLE: 3,
  FAULTED: 4,
};

/** CHARGING_STATION_CHARGING_STATE of the core (OCPP 2.0.1 chargingState). */
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

/** BUTTON_PUSH.PRESSED of the core: the only value a button sends. */
export const PRESSED = 1;

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});

const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });

const energy = (type, unit, max) => sensor({ category: C.ENERGY_SENSOR, type, unit, min: 0, max });

const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

/** The read-only features, by role (the last part of their external id), in display order. */
export const DEFINITIONS = {
  [FEATURES.ACTIVITY]: text,
  [FEATURES.CONNECTOR]: sensor({
    category: C.CHARGING_STATION,
    type: T.CHARGING_STATION.CONNECTOR_STATUS,
    min: 0,
    max: 4,
  }),
  [FEATURES.CHARGING_STATE]: sensor({
    category: C.CHARGING_STATION,
    type: T.CHARGING_STATION.CHARGING_STATE,
    min: 0,
    max: 5,
  }),
  [FEATURES.VEHICLE]: text,
  [FEATURES.POWER]: energy(T.ENERGY_SENSOR.POWER, U.WATT, 100_000),
  [FEATURES.CURRENT_L1]: energy(T.ENERGY_SENSOR.CURRENT, U.AMPERE, 100),
  [FEATURES.CURRENT_L2]: energy(T.ENERGY_SENSOR.CURRENT, U.AMPERE, 100),
  [FEATURES.CURRENT_L3]: energy(T.ENERGY_SENSOR.CURRENT, U.AMPERE, 100),
  [FEATURES.VOLTAGE_L1]: energy(T.ENERGY_SENSOR.VOLTAGE, U.VOLT, 500),
  [FEATURES.VOLTAGE_L2]: energy(T.ENERGY_SENSOR.VOLTAGE, U.VOLT, 500),
  [FEATURES.VOLTAGE_L3]: energy(T.ENERGY_SENSOR.VOLTAGE, U.VOLT, 500),
  [FEATURES.SESSION_ENERGY]: sensor({
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 1000,
  }),
  [FEATURES.SESSION_DURATION]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: TIMINGS.sessionMax / 60_000,
  }),
  [FEATURES.SESSION_COST]: sensor({
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.EURO,
    min: 0,
    max: 10_000,
  }),
  [FEATURES.MAX_CURRENT]: energy(T.ENERGY_SENSOR.CURRENT, U.AMPERE, 100),
};

/** The commands, refused unless allowed (src/app.js); the reboot has its own option. */
export const COMMAND_ROLES = [
  FEATURES.START,
  FEATURES.STOP,
  FEATURES.AVAILABILITY,
  FEATURES.REBOOT,
];

export const availabilityOptions = (language) =>
  Object.values(AVAILABILITY).map((value) => ({
    value,
    label: word(AVAILABILITY_NAMES[value], language),
  }));

export const chargePointIds = (gladys, evseId) => gladys.externalIds('chargepoint', evseId);

/** The device of a charge point, with every feature of the created device kept. */
export function buildDevice(gladys, point, { language }, created) {
  const ids = chargePointIds(gladys, point.evseId);
  const features = [
    ...Object.entries(DEFINITIONS).map(([role, definition]) => ({ role, ...definition })),
    { role: FEATURES.START, ...button },
    { role: FEATURES.STOP, ...button },
    {
      role: FEATURES.AVAILABILITY,
      category: C.TEXT,
      type: T.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: availabilityOptions(language),
    },
    { role: FEATURES.REBOOT, ...button },
  ].map(({ role, ...definition }) => ({
    name: word(FEATURE_NAMES[role], language),
    external_id: ids.feature(role),
    ...definition,
  }));
  // Never fewer features than the created device (a feature of a later or
  // earlier version stays, as the user created it).
  const known = new Set(features.map((f) => f.external_id));
  for (const feature of created?.features ?? []) {
    if (typeof feature?.external_id === 'string' && !known.has(feature.external_id)) {
      known.add(feature.external_id);
      features.push(feature);
    }
  }
  return {
    name: point.name ?? `Blue Current ${point.evseId}`,
    external_id: ids.device,
    ...(point.model ? { model: point.model } : {}),
    should_poll: false,
    features,
    params: [{ name: 'evse_id', value: point.evseId }],
  };
}

const known = (value) => value !== undefined && value !== null;

/** The connector, as the core's charging-station category reads it. */
export function connectorOf(status) {
  switch (status.activity) {
    case 'offline':
    case 'unavailable':
      return CONNECTOR_STATUS.UNAVAILABLE;
    case 'error':
      return CONNECTOR_STATUS.FAULTED;
    case 'charging':
      return CONNECTOR_STATUS.OCCUPIED;
    case 'available':
      return !known(status.vehicle) || status.vehicle === 'standby'
        ? CONNECTOR_STATUS.AVAILABLE
        : CONNECTOR_STATUS.OCCUPIED;
    default:
      return undefined;
  }
}

/**
 * The charging state (OCPP's chargingState). No vehicle: IDLE, so a scene
 * never keeps reading "charging" after the car left.
 */
export function chargingStateOf(status) {
  if (status.activity === 'charging') {
    return CHARGING_STATE.CHARGING;
  }
  if (status.vehicle === 'vehicle_detected' || status.vehicle === 'ready') {
    return CHARGING_STATE.EV_CONNECTED;
  }
  return CHARGING_STATE.IDLE;
}

/** The power (W): the sum over the phases of voltage x current, when a pair is known. */
export function powerOf(status) {
  let watts;
  for (const n of [1, 2, 3]) {
    const v = status[`voltage${n}`];
    const i = status[`current${n}`];
    if (known(v) && known(i)) {
      watts = (watts ?? 0) + v * i;
    }
  }
  return watts === undefined ? undefined : Math.round(watts);
}

/**
 * The duration of the session (minutes): from its start to now while
 * charging, else to its stop; undefined without a usable start.
 */
export function durationOf(status, now) {
  const start = status.start;
  if (!known(start)) {
    return undefined;
  }
  const stop = known(status.stop) && status.stop >= start ? status.stop : undefined;
  const end = status.activity === 'charging' && stop === undefined ? now : stop;
  if (end === undefined) {
    return undefined;
  }
  const ms = end - start;
  return ms >= 0 && ms <= TIMINGS.sessionMax ? Math.floor(ms / 60_000) : undefined;
}

/** The availability shown by the select: blocked (`unavailable`) or not, else unknown. */
export function availabilityOf(activity) {
  if (activity === 'unavailable') {
    return AVAILABILITY.BLOCKED;
  }
  return activity === 'available' || activity === 'charging' ? AVAILABILITY.OPERATIVE : undefined;
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The current values of a charge point device (sent when they change). */
export function deviceStates(ids, status, { language }, now) {
  const states = [];
  const activity = known(status.activity) ? status.activity : undefined;
  states.push([FEATURES.ACTIVITY, { text: word(ACTIVITY_NAMES[activity ?? 'unknown'], language) }]);
  const connector = activity ? connectorOf(status) : undefined;
  if (connector !== undefined) {
    states.push([FEATURES.CONNECTOR, { state: connector }]);
  }
  const availability = availabilityOf(activity);
  if (availability) {
    states.push([FEATURES.AVAILABILITY, { text: availability }]);
  }
  if (activity === 'offline' || activity === undefined) {
    // Offline or unknown: the readings keep their last value.
    return states.map(([role, value]) => ({
      device_feature_external_id: ids.feature(role),
      ...value,
    }));
  }
  states.push([FEATURES.CHARGING_STATE, { state: chargingStateOf(status) }]);
  if (known(status.vehicle)) {
    states.push([FEATURES.VEHICLE, { text: word(VEHICLE_NAMES[status.vehicle], language) }]);
  }
  const power = powerOf(status);
  if (power !== undefined) {
    states.push([FEATURES.POWER, { state: power }]);
  }
  for (const n of [1, 2, 3]) {
    if (known(status[`current${n}`])) {
      states.push([FEATURES[`CURRENT_L${n}`], { state: round(status[`current${n}`], 1) }]);
    }
    if (known(status[`voltage${n}`])) {
      states.push([FEATURES[`VOLTAGE_L${n}`], { state: Math.round(status[`voltage${n}`]) }]);
    }
  }
  if (known(status.energy)) {
    states.push([FEATURES.SESSION_ENERGY, { state: round(status.energy, 3) }]);
  }
  const duration = durationOf(status, now);
  if (duration !== undefined) {
    states.push([FEATURES.SESSION_DURATION, { state: duration }]);
  }
  // The cost: Blue Current documents it as "currently disabled" (always 0):
  // a 0 is shown only when no energy was charged, never as the cost of a charge.
  if (known(status.cost) && (status.cost > 0 || status.energy === 0)) {
    states.push([FEATURES.SESSION_COST, { state: round(status.cost, 2) }]);
  }
  if (known(status.maxUsage)) {
    states.push([FEATURES.MAX_CURRENT, { state: Math.round(status.maxUsage) }]);
  }
  return states.map(([role, value]) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
