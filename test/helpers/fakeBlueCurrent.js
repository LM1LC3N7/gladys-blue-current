// -----------------------------------------------------------------------------
// A fake Blue Current WebSocket server behind the socket factory: `ws`-like
// sockets (EventEmitter: open, message, close, error, pong,
// unexpected-response), answering as bluecurrent-api expects. Answers go
// through setImmediate (never the mocked timers): settle() delivers them.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const API_TOKEN = 'api-token-secret-123';
export const AUTH = 'auth-token-secret-456';
export const EVSE = 'BCU100186';
export const EVSE2 = 'BCU102728';

/** Lets the pending promises and the fake answers settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export const chargePoint = (evseId = EVSE, extra = {}) => ({
  evse_id: evseId,
  name: 'Garage',
  model_type: 'U:MOVE22',
  chargepoint_type: 'UMOVE',
  activity: 'available',
  default_card: { uid: 'BCU-APP', id: 'BCU-APP', name: '', customer_name: 'Someone' },
  smart_charging: false,
  ...extra,
});

export const status = (extra = {}) => ({
  actual_p1: 0,
  actual_p2: 0,
  actual_p3: 0,
  activity: 'available',
  actual_v1: 230,
  actual_v2: 231,
  actual_v3: 229,
  actual_kwh: 0,
  max_usage: 16,
  smartcharging_max_usage: 6,
  max_offline: 7,
  offline_since: '',
  start_datetime: '',
  stop_datetime: '',
  total_cost: 0,
  vehicle_status: 'A',
  ...extra,
});

export const charging = (extra = {}) =>
  status({
    activity: 'charging',
    vehicle_status: 'C',
    actual_p1: 16,
    actual_p2: 16,
    actual_p3: 15.5,
    actual_kwh: 7.25,
    start_datetime: '20261018 11:00:00',
    stop_datetime: '',
    total_cost: 2.1,
    ...extra,
  });

class FakeSocket extends EventEmitter {
  constructor(server, url, options) {
    super();
    this.server = server;
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
  }

  later(fn) {
    setImmediate(() => {
      if (this.readyState !== 3) {
        fn();
      }
    });
  }

  send(text) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open');
    }
    const message = JSON.parse(text);
    this.sent.push(message);
    this.server.received.push(message);
    for (const answer of this.server.answer(message, this)) {
      this.later(() => this.deliver(answer));
    }
  }

  deliver(answer) {
    if (this.readyState === 1) {
      this.emit(
        'message',
        Buffer.from(typeof answer === 'string' ? answer : JSON.stringify(answer)),
      );
    }
  }

  ping() {
    if (this.server.answerPings) {
      this.later(() => this.emit('pong'));
    }
  }

  /** The server closes the connection. */
  drop(code = 1006) {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    setImmediate(() => this.emit('close', code, Buffer.alloc(0)));
  }

  terminate() {
    if (this.readyState === 3) {
      return;
    }
    const connecting = this.readyState === 0;
    this.readyState = 3;
    setImmediate(() => {
      if (connecting) {
        this.emit('error', new Error('WebSocket was closed before the connection was established'));
      }
      this.emit('close', 1006, Buffer.alloc(0));
    });
  }

  close() {
    this.terminate();
  }
}

export function fakeBlueCurrent({ points = [chargePoint()], statuses } = {}) {
  const server = {
    apiToken: API_TOKEN,
    auth: AUTH,
    points,
    statuses: statuses ?? { [EVSE]: status(), [EVSE2]: status() },
    sockets: [],
    received: [],
    answerPings: true,
    /** Handshake refusals for the next sockets: [{ status, reason }]. */
    refusals: [],
    /** Next sockets that fail to connect (network). */
    unreachable: 0,
    /** Commands left unanswered (no RECEIVED, no STATUS). */
    silentCommands: new Set(),
    /** Command answers: command -> [answers] (default RECEIVED_x then STATUS_x success). */
    commandAnswers: {},
    /** Status requests left unanswered. */
    silentStatus: false,
    validations: 0,
    get open() {
      return this.sockets.filter((s) => s.readyState === 1);
    },
    get main() {
      return this.open.at(-1);
    },
    commands(name) {
      return this.received.filter((m) => m.command === name);
    },
    factory: (url, options) => {
      const socket = new FakeSocket(server, url, options);
      server.sockets.push(socket);
      const refusal = server.refusals.shift();
      setImmediate(() => {
        if (socket.readyState === 3) {
          return;
        }
        if (refusal) {
          const response = new EventEmitter();
          response.statusCode = refusal.status;
          response.headers = refusal.reason ? { 'x-websocket-reject-reason': refusal.reason } : {};
          response.resume = () => {};
          socket.emit('unexpected-response', {}, response);
          return;
        }
        if (server.unreachable > 0) {
          server.unreachable -= 1;
          socket.readyState = 3;
          socket.emit('error', new Error('connect ECONNREFUSED'));
          socket.emit('close', 1006, Buffer.alloc(0));
          return;
        }
        socket.readyState = 1;
        socket.emit('open');
      });
      return socket;
    },
    answer(message) {
      if (message.command === 'VALIDATE_API_TOKEN') {
        server.validations += 1;
        if (server.validateAnswer) {
          return [server.validateAnswer];
        }
        return message.token === server.apiToken
          ? [{ object: 'STATUS_API_TOKEN', success: true, token: server.auth, customer_id: 'c1' }]
          : [{ object: 'STATUS_API_TOKEN', success: false, error: '' }];
      }
      if (message.Authorization !== `Token ${server.auth}`) {
        return [{ object: 'ERROR', error: 1, message: 'Invalid Auth Token' }];
      }
      switch (message.command) {
        case 'HELLO':
          return [];
        case 'GET_CHARGE_POINTS':
          return [{ object: 'CHARGE_POINTS', data: server.points }];
        case 'GET_CH_STATUS': {
          const data = server.statuses[message.evse_id];
          if (server.silentStatus || !data) {
            return [];
          }
          return [
            {
              object: 'CH_STATUS',
              evse_id: message.evse_id,
              data: { ...data, evse_id: message.evse_id },
            },
          ];
        }
        default: {
          if (server.silentCommands.has(message.command)) {
            return [];
          }
          return (
            server.commandAnswers[message.command] ?? [
              { object: `RECEIVED_${message.command}`, evse_id: message.evse_id, error: '' },
              {
                object: `STATUS_${message.command}`,
                success: true,
                evse_id: message.evse_id,
                result: {},
                error: '',
              },
            ]
          );
        }
      }
    },
    /** A message pushed by the server on the main connection. */
    push(message) {
      server.main?.deliver(message);
    },
  };
  return server;
}

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}
