// -----------------------------------------------------------------------------
// Blue Current messages (pure): parsing, bounded and without prototype
// pollution, and the reading of the objects the integration uses.
//
// Every message is a JSON object with an `object` field: the name of the
// answer (CHARGE_POINTS, CH_STATUS, RECEIVED_START_SESSION,
// STATUS_START_SESSION, ERROR...). It is how an answer is attributed to its
// request, with the `evse_id` when the answer carries one (bluecurrent-api,
// websocket._message_handler and utils.handle_*).
// -----------------------------------------------------------------------------

import { ACTIVITIES, ERROR_CODES, LIMITS, OBJECTS, VEHICLE_STATUS } from './constants.js';
import { parseDate } from './time.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A message from Blue Current -> a plain object, else undefined: too large,
 * not JSON, not an object, or without a usable `object` name. The keys
 * `__proto__`, `constructor` and `prototype` are dropped while parsing.
 */
export function parseMessage(data) {
  let text;
  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (bytes.length > LIMITS.messageBytes) {
      return undefined;
    }
    text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('utf8');
  } else if (Array.isArray(data)) {
    // ws may hand fragments as an array of buffers.
    return parseMessage(Buffer.concat(data.filter((d) => d instanceof Uint8Array)));
  } else {
    return undefined;
  }
  if (text.length > LIMITS.messageBytes) {
    return undefined;
  }
  let message;
  try {
    message = JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
  } catch {
    return undefined;
  }
  if (!isObject(message) || typeof message.object !== 'string') {
    return undefined;
  }
  if (message.object === '' || message.object.length > 64 || !/^[A-Z0-9_]+$/.test(message.object)) {
    return undefined;
  }
  return message;
}

/** A charge point id: what Blue Current names an EVSE id (BCU100186), safe in an external id. */
export const EVSE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const validEvse = (value) =>
  typeof value === 'string' && EVSE_ID.test(value) && !FORBIDDEN_KEYS.has(value);

/** A short text from an answer: control characters removed, bounded; undefined when empty. */
export function shortText(value, max = LIMITS.textLength) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean === '' ? undefined : clean.slice(0, max);
}

/** A finite number within bounds, else undefined (null, '', true are no numbers). */
export function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= min && value <= max ? value : undefined;
}

export const activityOf = (value) =>
  typeof value === 'string' && ACTIVITIES.includes(value.toLowerCase())
    ? value.toLowerCase()
    : undefined;

/** The vehicle status: a letter (A..F) or an already named status. */
export function vehicleOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (Object.hasOwn(VEHICLE_STATUS, value)) {
    return VEHICLE_STATUS[value];
  }
  const named = value.toLowerCase();
  return Object.values(VEHICLE_STATUS).includes(named) ? named : undefined;
}

/** The charge points of a CHARGE_POINTS answer: [{ evseId, name, model, activity, card }]. */
export function readChargePoints(message) {
  const list = Array.isArray(message?.data) ? message.data : [];
  const seen = new Set();
  const points = [];
  for (const entry of list) {
    if (points.length >= LIMITS.chargePoints) {
      break;
    }
    if (!isObject(entry) || !validEvse(entry.evse_id) || seen.has(entry.evse_id)) {
      continue;
    }
    seen.add(entry.evse_id);
    const card = isObject(entry.default_card) ? shortText(entry.default_card.uid, 64) : undefined;
    points.push({
      evseId: entry.evse_id,
      name: shortText(entry.name),
      model: shortText(entry.model_type),
      activity: activityOf(entry.activity),
      card: card && /^[A-Za-z0-9_-]+$/.test(card) ? card : undefined,
    });
  }
  return points;
}

/**
 * The evse id a message is about (top level, else in its data); undefined
 * when absent, or when present but malformed (never the other one then).
 */
export function evseOf(message) {
  if (isObject(message) && Object.hasOwn(message, 'evse_id')) {
    return validEvse(message.evse_id) ? message.evse_id : undefined;
  }
  const data = message?.data;
  return isObject(data) && validEvse(data.evse_id) ? data.evse_id : undefined;
}

const own = (object, key) => isObject(object) && Object.hasOwn(object, key);

/**
 * The fields of a CH_STATUS answer. Only the fields the answer carries are
 * set (a push may be partial); a field present but unusable is `null`.
 */
export function readStatus(message, now) {
  const data = isObject(message?.data) ? message.data : {};
  const status = { receivedAt: now };
  const set = (name, key, read) => {
    if (own(data, key)) {
      const value = read(data[key]);
      status[name] = value === undefined ? null : value;
    }
  };
  set('activity', 'activity', activityOf);
  set('vehicle', 'vehicle_status', vehicleOf);
  for (const n of [1, 2, 3]) {
    set(`current${n}`, `actual_p${n}`, (v) => number(v, 0, 1000));
    set(`voltage${n}`, `actual_v${n}`, (v) => number(v, 0, 1000));
  }
  set('energy', 'actual_kwh', (v) => number(v, 0, 100_000));
  set('maxUsage', 'max_usage', (v) => number(v, 0, 1000));
  set('cost', 'total_cost', (v) => number(v, 0, 100_000));
  set('start', 'start_datetime', parseDate);
  set('stop', 'stop_datetime', parseDate);
  return status;
}

/** The kind of an ERROR object: refused token, request limit, or another error. */
export function errorKind(message) {
  switch (message?.error) {
    case ERROR_CODES.INVALID_AUTH_TOKEN:
    case ERROR_CODES.NOT_AUTHORIZED:
      return 'unauthorized';
    case ERROR_CODES.REQUEST_LIMIT:
      return 'rate_limited';
    default:
      return 'server_error';
  }
}

/** The error code of an ERROR object, for the logs (a number only, never its free text). */
export const errorCode = (message) =>
  Number.isInteger(message?.error) && message.error >= 0 && message.error < 1000
    ? message.error
    : '?';

/** The text of an `error` field, upper case, '' when there is none. */
function errorText(error) {
  if (error === undefined || error === null || error === '') {
    return '';
  }
  return typeof error === 'string' ? error.trim().toUpperCase().slice(0, 64) : 'ERROR';
}

/**
 * The answer to an action command: `{ command, stage, outcome, ok, evseId }`,
 * else undefined (another object, or an `evse_id` present but malformed).
 * `stage`: 'received' (RECEIVED_x: Blue Current got it) or 'result'
 * (STATUS_x: the charge point answered). `outcome`: 'ok'; 'timeout' (the
 * charge point did not answer Blue Current in time: the command may still be
 * carried out); 'refused' (REJECTED, or `success` false); 'unknown' (another
 * error text, never shown).
 */
export function actionAnswer(message, commands) {
  const name = message?.object;
  if (typeof name !== 'string') {
    return undefined;
  }
  let stage;
  let command;
  if (name.startsWith('RECEIVED_')) {
    stage = 'received';
    command = name.slice('RECEIVED_'.length);
  } else if (name.startsWith('STATUS_')) {
    stage = 'result';
    command = name.slice('STATUS_'.length);
  } else {
    return undefined;
  }
  if (!commands.includes(command)) {
    return undefined;
  }
  if (Object.hasOwn(message, 'evse_id') && !validEvse(message.evse_id)) {
    return undefined; // attributed to no charge point, so to no command
  }
  const text = errorText(message.error);
  let outcome;
  if (text.includes('TIMEOUT')) {
    outcome = 'timeout';
  } else if (text.includes('REJECTED') || message.success === false) {
    outcome = 'refused';
  } else if (text !== '') {
    outcome = 'unknown';
  } else {
    outcome = 'ok';
  }
  return {
    command,
    stage,
    outcome,
    ok: outcome === 'ok',
    evseId: validEvse(message.evse_id) ? message.evse_id : undefined,
  };
}

/** Whether a message is the answer to the token validation. */
export const isTokenAnswer = (message) => message?.object === OBJECTS.TOKEN;

/** The token of a successful validation, else undefined. */
export function tokenOf(message) {
  if (!isTokenAnswer(message) || message.success !== true) {
    return undefined;
  }
  const token = message.token;
  return typeof token === 'string' && /^[\x21-\x7e]{1,512}$/.test(token) ? token : undefined;
}
