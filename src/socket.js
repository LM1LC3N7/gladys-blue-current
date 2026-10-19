// -----------------------------------------------------------------------------
// One WebSocket connection to Blue Current (the `ws` package, MIT): opened
// with a handshake timeout, messages bounded (maxPayload, no compression),
// parsed by src/protocol.js. The connection never reopens by itself: the app
// decides when (src/app.js, backoff and pauses).
//
// Why `ws` and not the WebSocket of Node 22: Blue Current refuses a
// connection at the handshake with an HTTP status and an
// `x-websocket-reject-reason` header ("Request limit reached", "Already
// connected"), which only `ws` lets us read ('unexpected-response'); `ws`
// also bounds the size of a message (maxPayload) and sends pings.
//
// The API token and the auth token travel in the messages, never in the URL;
// nothing here logs a message, only object names and codes.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { CLOSE_REQUEST_LIMIT, LIMITS, OBJECTS, TIMINGS, URL, USER_AGENT } from './constants.js';
import { errorCode, errorKind, isTokenAnswer, parseMessage, tokenOf } from './protocol.js';

/** An error of the connection, with a kind the app understands (never a server text). */
export class ChannelError extends Error {
  constructor(kind, { status, code } = {}) {
    super(kind);
    this.name = 'ChannelError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** The options of every connection: bounded handshake and messages, no compression. */
export const SOCKET_OPTIONS = Object.freeze({
  handshakeTimeout: TIMINGS.handshakeTimeout,
  maxPayload: LIMITS.messageBytes,
  perMessageDeflate: false,
  headers: Object.freeze({ 'User-Agent': USER_AGENT }),
});

/** The default socket factory: a `ws` client. */
export function defaultSocketFactory(url, options) {
  return new WebSocket(url, { ...options, headers: { ...options.headers } });
}

/** The kind of a handshake refused by Blue Current, from its status and reject reason. */
export function rejectKind(status, reason) {
  const text = String(reason ?? '');
  if (/request limit/i.test(text)) {
    return 'rate_limited';
  }
  if (/already connected/i.test(text)) {
    return 'already_connected';
  }
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  return 'http';
}

/** The kind of a closed connection, from its close code. */
export const closeKind = (code) => (code === CLOSE_REQUEST_LIMIT ? 'rate_limited' : 'closed');

export class Channel {
  /**
   * @param {object} options
   * @param {Function} options.factory - (url) => a `ws`-like socket.
   * @param {Function} options.onMessage - (message) => void, every parsed message.
   * @param {Function} options.onClose - (ChannelError) => void, once, after the open.
   * @param {Function} [options.onIgnored] - () => void, a message not usable.
   */
  constructor({ factory = defaultSocketFactory, onMessage, onClose, onIgnored = () => {} }) {
    this.factory = factory;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.onIgnored = onIgnored;
    this.socket = undefined;
    this.isOpen = false;
    this.ended = false;
    this.waitingPong = false;
  }

  /** Opens the connection: resolves once open, rejects with a ChannelError. */
  open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let refusal;
      let socket;
      try {
        socket = this.factory(URL, SOCKET_OPTIONS);
      } catch {
        reject(new ChannelError('network'));
        return;
      }
      this.socket = socket;
      socket.on('unexpected-response', (_request, response) => {
        const status = Number(response?.statusCode) || undefined;
        const reason = response?.headers?.['x-websocket-reject-reason'];
        refusal = new ChannelError(rejectKind(status, reason), { status });
        try {
          response?.resume?.();
        } catch {
          // nothing to drain
        }
        socket.terminate();
      });
      socket.on('open', () => {
        settled = true;
        this.isOpen = true;
        resolve();
      });
      socket.on('message', (data) => {
        if (this.socket !== socket) {
          return;
        }
        const message = parseMessage(data);
        if (message) {
          this.onMessage(message);
        } else {
          this.onIgnored();
        }
      });
      socket.on('pong', () => {
        this.waitingPong = false;
      });
      // An 'error' is always followed by a 'close': the close decides.
      socket.on('error', (err) => {
        if (!refusal && /timeout|timed out/i.test(String(err?.message))) {
          refusal = new ChannelError('timeout');
        }
      });
      socket.on('close', (code) => {
        const wasOpen = this.isOpen;
        this.isOpen = false;
        if (!settled) {
          settled = true;
          reject(
            refusal ?? new ChannelError(code === 1006 ? 'network' : closeKind(code), { code }),
          );
          return;
        }
        if (wasOpen && !this.ended) {
          this.ended = true;
          this.onClose(new ChannelError(closeKind(code), { code }));
        }
      });
    });
  }

  /**
   * Sends one command. Returns true when the socket took it (it may have left),
   * false when it could not have left (not open).
   */
  send(command) {
    if (!this.isOpen || !this.socket) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(command));
      return true;
    } catch {
      // ws throws only before writing (not open): nothing left.
      return false;
    }
  }

  /** A ping; false when the previous one got no pong (the connection is dead). */
  ping() {
    if (!this.isOpen) {
      return false;
    }
    if (this.waitingPong) {
      return false;
    }
    this.waitingPong = true;
    try {
      this.socket.ping();
    } catch {
      return false;
    }
    return true;
  }

  /** Closes without calling onClose (a close we asked for). */
  close() {
    this.ended = true;
    this.isOpen = false;
    const socket = this.socket;
    if (socket) {
      try {
        socket.terminate();
      } catch {
        // already closed
      }
    }
  }

  /** Cuts a dead connection: onClose is called, as for a close from the server. */
  kill() {
    const socket = this.socket;
    if (socket) {
      try {
        socket.terminate();
      } catch {
        // already closed
      }
    }
  }
}

/**
 * Validates an API token on its own short connection, as bluecurrent-api
 * does: VALIDATE_API_TOKEN, the first answer, close. Resolves with the auth
 * token; rejects with a ChannelError: 'refused' (the token is not accepted),
 * 'rate_limited', 'server_error', 'timeout', 'network', 'bad_response'.
 */
export async function validateToken({ factory, apiToken, timers = globalThis }) {
  let answer;
  let message;
  let timer;
  const done = new Promise((resolve) => {
    answer = resolve;
  });
  const channel = new Channel({
    factory,
    onMessage: (message) => answer({ message }),
    onClose: (err) => answer({ err }),
    onIgnored: () => answer({ err: new ChannelError('bad_response') }),
  });
  try {
    await channel.open();
  } catch (err) {
    throw err instanceof ChannelError ? err : new ChannelError('network');
  }
  try {
    if (!channel.send({ command: 'VALIDATE_API_TOKEN', token: apiToken })) {
      throw new ChannelError('network');
    }
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(
        () => resolve({ err: new ChannelError('timeout') }),
        TIMINGS.validateTimeout,
      );
    });
    const result = await Promise.race([done, timeout]);
    if (result.err) {
      throw result.err;
    }
    message = result.message;
  } finally {
    timers.clearTimeout(timer);
    channel.close();
  }
  if (message.object === OBJECTS.ERROR) {
    const kind = errorKind(message);
    throw new ChannelError(kind === 'unauthorized' ? 'refused' : kind, {
      code: errorCode(message),
    });
  }
  if (!isTokenAnswer(message)) {
    throw new ChannelError('bad_response');
  }
  const token = tokenOf(message);
  if (!token) {
    // `success` false: the token is not accepted (InvalidApiToken).
    throw new ChannelError(message.success === false ? 'refused' : 'bad_response');
  }
  return token;
}
