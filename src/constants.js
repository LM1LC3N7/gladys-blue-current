// -----------------------------------------------------------------------------
// Blue Current constants, manifest keys, limits and timings.
//
// The URL, the commands, the message objects, the error codes and the request
// limit (reset at midnight, Europe/Amsterdam) are those of bluecurrent-api
// (MIT, Blue Current, https://github.com/bluecurrent/HomeAssistantAPI), the
// library of the Blue Current integration of Home Assistant.
// -----------------------------------------------------------------------------

/** The WebSocket API of Blue Current for home automation (bluecurrent-api). */
export const URL = 'wss://motown.bluecurrent.nl/haserver';

/**
 * The client kind sent in the HELLO command. bluecurrent-api sends
 * "homeassistant": this endpoint is made for it, and no other value is
 * documented, so the same one is sent (see TODO.md, Decisions).
 */
export const HELLO_HEADER = 'homeassistant';

/** An honest User-Agent on the WebSocket handshake. */
export const USER_AGENT =
  'gladys-blue-current/0.1 (+https://github.com/LM1LC3N7/gladys-blue-current)';

/** Commands sent to Blue Current. */
export const COMMANDS = {
  VALIDATE: 'VALIDATE_API_TOKEN',
  HELLO: 'HELLO',
  CHARGE_POINTS: 'GET_CHARGE_POINTS',
  STATUS: 'GET_CH_STATUS',
  START: 'START_SESSION',
  STOP: 'STOP_SESSION',
  OPERATIVE: 'SET_OPERATIVE',
  INOPERATIVE: 'SET_INOPERATIVE',
  REBOOT: 'REBOOT',
};

/** The commands whose answers (RECEIVED_x, STATUS_x) are awaited. */
export const ACTION_COMMANDS = [
  COMMANDS.START,
  COMMANDS.STOP,
  COMMANDS.OPERATIVE,
  COMMANDS.INOPERATIVE,
  COMMANDS.REBOOT,
];

/** Message objects read from Blue Current. */
export const OBJECTS = {
  ERROR: 'ERROR',
  TOKEN: 'STATUS_API_TOKEN',
  CHARGE_POINTS: 'CHARGE_POINTS',
  STATUS: 'CH_STATUS',
};

/** Codes of an ERROR object (bluecurrent-api, utils.ERRORS). */
export const ERROR_CODES = {
  UNKNOWN_COMMAND: 0,
  INVALID_AUTH_TOKEN: 1,
  NOT_AUTHORIZED: 2,
  UNKNOWN: 9,
  REQUEST_LIMIT: 42,
};

/** The close code of a connection cut for the request limit. */
export const CLOSE_REQUEST_LIMIT = 4001;

/** The `activity` of a charge point, as Blue Current and Home Assistant name them. */
export const ACTIVITIES = ['available', 'charging', 'unavailable', 'error', 'offline'];

/** The `vehicle_status` letters (IEC 61851 states) and their names (bluecurrent-api). */
export const VEHICLE_STATUS = {
  A: 'standby',
  B: 'vehicle_detected',
  C: 'ready',
  D: 'ready',
  E: 'no_power',
  F: 'vehicle_error',
};

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  ACTIVITY: 'activity',
  CONNECTOR: 'connector-status',
  CHARGING_STATE: 'charging-state',
  VEHICLE: 'vehicle-status',
  POWER: 'power',
  CURRENT_L1: 'current-l1',
  CURRENT_L2: 'current-l2',
  CURRENT_L3: 'current-l3',
  VOLTAGE_L1: 'voltage-l1',
  VOLTAGE_L2: 'voltage-l2',
  VOLTAGE_L3: 'voltage-l3',
  SESSION_ENERGY: 'session-energy',
  SESSION_DURATION: 'session-duration',
  SESSION_COST: 'session-cost',
  MAX_CURRENT: 'max-current',
  START: 'start-session',
  STOP: 'stop-session',
  AVAILABILITY: 'availability',
  REBOOT: 'reboot',
};

/** The options of the availability select (set_operative / set_inoperative). */
export const AVAILABILITY = {
  OPERATIVE: 'operative',
  BLOCKED: 'blocked',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Largest message accepted from Blue Current (a list of charge points is a few KB). */
  messageBytes: 256 * 1024,
  /** Charge points read from one list. */
  chargePoints: 50,
  /** Longest text kept from an answer (names, models). */
  textLength: 60,
  /** Longest token accepted back from the validation. */
  tokenLength: 512,
  /** Longest API token accepted from the configuration. */
  apiTokenLength: 512,
};

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** WebSocket handshake. */
  handshakeTimeout: 15 * SECOND,
  /** The answer to VALIDATE_API_TOKEN (bluecurrent-api waits 5 s). */
  validateTimeout: 10 * SECOND,
  /** The list of charge points after the HELLO. */
  chargePointsTimeout: 30 * SECOND,
  /** A ping every minute; no pong before the next one: the connection is cut and opened again. */
  pingInterval: MINUTE,
  /** Without any message for an hour, the status of each charge point is asked again. */
  silenceRefresh: HOUR,
  /** Reconnection: 5 s, 15 s, 30 s, 1, 2, 5 then 10 min, with jitter (half to the whole). */
  backoff: [5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE],
  /** "Already connected": another client holds the connection, two minutes at least. */
  alreadyConnected: 2 * MINUTE,
  /** The request limit: until 00:00:30 Europe/Amsterdam, bounded. */
  rateLimitMin: MINUTE,
  rateLimitMax: 25 * HOUR,
  /** A refused API token: one new try after 6 h, then every 24 h. */
  refusedRetry: [6 * HOUR, 24 * HOUR],
  /** Longest a persisted pause or stop may still hold at a restart. */
  persistedMax: 25 * HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button acts at most this often. */
  testCooldown: 30 * SECOND,
  /** The test button waits this long for the connection (60 s for Gladys). */
  testWait: 40 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the fresh status and the command
   * must be sent within 3.5 s of the click, or the command is refused unsent;
   * Gladys is answered at 4.3 s at the latest.
   */
  commandSendBy: 3_500,
  commandAck: 4_300,
  commandMinRead: 1_200,
  commandMinSend: 700,
  /** The status asked again after a command, to show its effect. */
  refreshAfterCommand: 5 * SECOND,
  /** A session longer than this is not shown (a wrong date, not a session). */
  sessionMax: 14 * 24 * HOUR,
};
