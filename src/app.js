// -----------------------------------------------------------------------------
// The integration: the API token, ONE WebSocket connection to Blue Current
// (validated first on a short connection, as bluecurrent-api does), the
// charge points and their pushed statuses, the Gladys devices and their
// states, the transport badges, the "Test the connection" button, and the
// commands (start, stop, block, reboot), refused unless the configuration
// allows them. index.js only wires the SDK handlers to it.
//
// Never a loop: every new connection waits for a timer (backoff with jitter,
// the request-limit pause until midnight in Amsterdam, or the spaced new try
// of a refused token), and the refused token and the request-limit pause are
// kept in /data across restarts.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACTION_COMMANDS,
  AVAILABILITY,
  COMMANDS,
  FEATURES,
  HELLO_HEADER,
  OBJECTS,
  TIMINGS,
} from './constants.js';
import {
  COMMAND_ROLES,
  PRESSED,
  availabilityOf,
  buildDevice,
  chargePointIds,
  deviceStates,
} from './devices.js';
import { ERRORS, T, age, word } from './i18n.js';
import {
  actionAnswer,
  errorCode,
  errorKind,
  evseOf,
  readChargePoints,
  readStatus,
} from './protocol.js';
import { Channel, ChannelError, defaultSocketFactory, validateToken } from './socket.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { nextReset } from './time.js';

/** The commands of each role, and the option that allows it. */
const OPTION_OF = {
  [FEATURES.START]: 'allowCommands',
  [FEATURES.STOP]: 'allowCommands',
  [FEATURES.AVAILABILITY]: 'allowCommands',
  [FEATURES.REBOOT]: 'allowReboot',
};

export class BlueCurrentApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'blue-current' }),
    socketFactory = defaultSocketFactory,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    random = Math.random,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.socketFactory = socketFactory;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.random = random;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    this.generation = 0;
    this.started = false;
    /** The open connection (after its open), and the attempt in progress. */
    this.channel = undefined;
    this.linking = undefined;
    /** The auth token of the validation ("Token <token>" is sent), kept for the reconnections. */
    this.authToken = undefined;
    /** The auth token was validated by this attempt and no list came yet: a refusal is final. */
    this.authFresh = false;
    /** evseId -> { evseId, name, model, card, status } (a Map: no prototype). */
    this.points = new Map();
    /** The list of charge points came on the open connection. */
    this.listed = false;
    this.attempts = 0;
    this.timer = undefined;
    this.pingTimer = undefined;
    this.listTimer = undefined;
    this.refreshTimer = undefined;
    this.lastMessageAt = 0;
    /** The handling of the last message. */
    this.handling = undefined;
    /** 'rate' (the request limit), 'wait' (backoff or "already connected"). */
    this.pauseKind = undefined;
    this.pausedUntil = 0;
    /** A refused token: { kind, retryAt, retries }. */
    this.block = undefined;
    this.retrying = undefined;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    /** Answers awaited (fresh status, command answers): { match, resolve }. */
    this.waiters = new Set();
    this.commanding = false;
    this.lastTestAt = -Infinity;
    this.ignoredLogged = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}, { clearBlock = false } = {}) {
    this.stop();
    await this.linking?.catch(() => {});
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (clearBlock && this.memory.block) {
      this.memory.block = null;
      await this.saveMemory();
    }
    // The request-limit pause survives a restart and a change of token.
    if (this.memory.pause && this.memory.pause.until > this.now()) {
      this.pausedUntil = this.memory.pause.until;
      this.pauseKind = 'rate';
    }
    const block = this.memory.block;
    this.block =
      block && block.account === this.config.account
        ? { kind: block.kind, retryAt: block.retryAt, retries: block.retries }
        : undefined;
    this.publisher.start();
    if (!this.config.apiToken) {
      await this.setStatus(false, T.noToken);
      return;
    }
    if (this.block) {
      await this.setStatus(false, this.blockMessage());
      this.schedule(this.block.retryAt - this.now());
      return;
    }
    if (this.pauseKind === 'rate') {
      await this.setStatus(false, this.pauseMessage());
      this.schedule(this.pausedUntil - this.now());
      return;
    }
    await this.setStatus(false, T.connecting);
    this.connect();
  }

  stop() {
    this.generation += 1;
    for (const name of ['timer', 'listTimer', 'refreshTimer']) {
      if (this[name]) {
        this.timers.clearTimeout(this[name]);
        this[name] = undefined;
      }
    }
    this.stopPing();
    if (this.channel) {
      this.channel.close();
      this.channel = undefined;
    }
    this.listed = false;
    this.endWaiters();
    this.publisher.stop();
  }

  /** Forgets the token's state: a new token, or a restart. The request-limit pause stays. */
  reset() {
    this.authToken = undefined;
    this.authFresh = false;
    this.points = new Map();
    this.listed = false;
    this.attempts = 0;
    this.block = undefined;
    this.retrying = undefined;
    this.published = undefined;
    this.badge = undefined;
    if (this.pauseKind !== 'rate' || this.now() >= this.pausedUntil) {
      this.pauseKind = undefined;
      this.pausedUntil = 0;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The pauses, the stops and the
   * connection to Blue Current stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    const restarted = await this.configUpdated(raw);
    if (restarted) {
      return;
    }
    this.published = undefined;
    this.badge = undefined;
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
  }

  /** A new token restarts (and lifts a stop); a new language renames. Returns true on a restart. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.apiToken !== previous.apiToken) {
      await this.start(raw, { clearBlock: true });
      return true;
    }
    this.config = next;
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
      this.queueStates();
      await this.flush();
    }
    return false;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) =>
        this.logger.warn(`Saving the state to /data failed (${err?.code ?? 'error'})`),
      );
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Connection ------------------------------------------------------------------

  /** The next connection attempt, in `wait` ms (never at once from a failure). */
  schedule(wait) {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.run();
        }
      },
      Math.max(0, wait),
    );
  }

  /** A timer fired: the spaced new try of a stop, or the end of a pause. */
  run() {
    if (!this.config.apiToken) {
      return;
    }
    if (this.block) {
      if (this.now() < this.block.retryAt) {
        this.schedule(this.block.retryAt - this.now());
        return;
      }
      this.logger.info('Blue Current: trying the API token again after a refusal');
      this.retrying = this.block;
      this.block = undefined;
    }
    if (this.now() < this.pausedUntil) {
      this.schedule(this.pausedUntil - this.now());
      return;
    }
    this.connect();
  }

  /** One attempt at a time: validation if needed, then the connection, HELLO and the list. */
  connect() {
    if (this.linking || this.channel || !this.config.apiToken) {
      return this.linking ?? Promise.resolve();
    }
    const generation = this.generation;
    this.linking = this.link(generation).finally(() => {
      this.linking = undefined;
    });
    return this.linking;
  }

  async link(generation) {
    try {
      if (!this.authToken) {
        const token = await validateToken({
          factory: this.socketFactory,
          apiToken: this.config.apiToken,
          timers: this.timers,
        });
        if (generation !== this.generation) {
          return;
        }
        this.authToken = `Token ${token}`;
        this.authFresh = true;
      }
      const channel = new Channel({
        factory: this.socketFactory,
        onMessage: (message) => this.onMessage(channel, message),
        onClose: (err) => this.onClosed(channel, err),
        onIgnored: () => this.ignored(),
      });
      await channel.open();
      if (generation !== this.generation) {
        channel.close();
        return;
      }
      this.channel = channel;
      this.listed = false;
      this.lastMessageAt = this.now();
      this.request(COMMANDS.HELLO, { header: HELLO_HEADER });
      this.request(COMMANDS.CHARGE_POINTS);
      this.startPing();
      this.listTimer = this.timers.setTimeout(() => {
        this.listTimer = undefined;
        if (this.channel === channel && !this.listed) {
          this.logger.warn('Blue Current sent no list of charge points: reconnecting');
          channel.kill();
        }
      }, TIMINGS.chargePointsTimeout);
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err instanceof ChannelError ? err : new ChannelError('network'));
      }
    }
  }

  /** Sends a command with the auth token; false when it could not leave. */
  request(command, fields = {}) {
    if (!this.channel || !this.authToken) {
      return false;
    }
    return this.channel.send({ command, ...fields, Authorization: this.authToken });
  }

  startPing() {
    this.stopPing();
    const channel = this.channel;
    this.pingTimer = this.timers.setInterval(() => {
      if (this.channel !== channel) {
        return;
      }
      if (!channel.ping()) {
        this.logger.warn('Blue Current did not answer the ping: reconnecting');
        channel.kill();
        return;
      }
      // Silent for an hour: the statuses are asked again (a push may have been missed).
      if (this.listed && this.now() - this.lastMessageAt >= TIMINGS.silenceRefresh) {
        this.lastMessageAt = this.now();
        for (const evseId of this.points.keys()) {
          this.request(COMMANDS.STATUS, { evse_id: evseId });
        }
      }
    }, TIMINGS.pingInterval);
  }

  stopPing() {
    if (this.pingTimer) {
      this.timers.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  ignored() {
    if (!this.ignoredLogged) {
      this.ignoredLogged = true;
      this.logger.warn(
        'Blue Current sent a message that is not usable; the next ones are not logged',
      );
    }
  }

  onClosed(channel, err) {
    if (this.channel !== channel) {
      return;
    }
    this.channel = undefined;
    this.listed = false;
    this.stopPing();
    if (this.listTimer) {
      this.timers.clearTimeout(this.listTimer);
      this.listTimer = undefined;
    }
    this.endWaiters();
    this.failed(err).catch(() =>
      this.logger.error('Blue Current: handling a closed connection failed'),
    );
  }

  /** Every awaited answer ends: the connection is gone. */
  endWaiters() {
    for (const waiter of this.waiters) {
      waiter.resolve({ closed: true });
    }
    this.waiters.clear();
  }

  blockMessage() {
    return T.refused(age(Math.max(0, this.block.retryAt - this.now())));
  }

  /** The request-limit pause holds for every path, the button and the commands included. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    return this.pauseKind === 'rate' && left > 0 ? T.rateLimited(age(left)) : undefined;
  }

  backoff() {
    const base = TIMINGS.backoff[Math.min(this.attempts, TIMINGS.backoff.length - 1)];
    this.attempts += 1;
    // Jitter: between half and the whole of the step.
    return Math.round(base / 2 + (this.random() * base) / 2);
  }

  async failed(err) {
    const wasListed = this.points.size > 0;
    this.listed = false;
    let kind = err.kind;
    if (kind === 'unauthorized') {
      // The auth token is no longer accepted: validated again on the next
      // attempt; just validated, the API token itself is refused.
      kind = this.authFresh ? 'refused' : 'expired';
      this.authToken = undefined;
    }
    if (kind === 'refused') {
      // Never sent again in a loop: one new try after 6 h, then every 24 h.
      this.authToken = undefined;
      this.authFresh = false;
      const retries = this.retrying?.retries ?? 0;
      const wait = TIMINGS.refusedRetry[Math.min(retries, TIMINGS.refusedRetry.length - 1)];
      this.block = { kind: 'refused', retryAt: this.now() + wait, retries: retries + 1 };
      this.retrying = undefined;
      this.memory.block = { account: this.config.account, ...this.block };
      await this.saveMemory();
      this.logger.warn(
        `Blue Current refused the API token; one new try in ${Math.round(wait / 60_000)} min`,
      );
      await this.setStatus(false, this.blockMessage());
      await this.publishBadges();
      this.schedule(wait);
      return;
    }
    let wait;
    let message;
    if (kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, nextReset(this.now()) - this.now()),
      );
      this.pauseKind = 'rate';
      this.pausedUntil = this.now() + wait;
      this.memory.pause = { kind: 'rate', until: this.pausedUntil };
      await this.saveMemory();
      message = T.rateLimited(age(wait));
    } else if (kind === 'already_connected') {
      wait = Math.max(TIMINGS.alreadyConnected, this.backoff());
      message = T.alreadyConnected(age(wait));
    } else {
      wait = this.backoff();
      message = wasListed ? T.lost(age(wait)) : T.unreachable(age(wait));
    }
    if (this.pauseKind !== 'rate') {
      this.pauseKind = 'wait';
      this.pausedUntil = this.now() + wait;
    }
    this.logger.warn(`Blue Current: ${kind}; next try in ${Math.round(wait / 1000)} s`);
    await this.setStatus(false, message);
    await this.publishBadges();
    this.schedule(wait);
  }

  /** The connection works: failures and the stop are forgotten. */
  async succeeded() {
    this.attempts = 0;
    this.authFresh = false;
    this.retrying = undefined;
    if (this.pauseKind === 'wait') {
      this.pauseKind = undefined;
      this.pausedUntil = 0;
    }
    if (this.memory.block) {
      this.memory.block = null;
      await this.saveMemory();
    }
  }

  // --- Messages --------------------------------------------------------------------

  onMessage(channel, message) {
    if (this.channel !== channel) {
      return;
    }
    this.lastMessageAt = this.now();
    this.handling = this.handle(channel, message).catch(() =>
      this.logger.error(`Blue Current: handling ${message.object} failed`),
    );
  }

  async handle(channel, message) {
    for (const waiter of [...this.waiters]) {
      if (waiter.match(message)) {
        this.waiters.delete(waiter);
        waiter.resolve({ message });
      }
    }
    switch (message.object) {
      case OBJECTS.ERROR:
        return this.serverError(channel, message);
      case OBJECTS.CHARGE_POINTS:
        return this.chargePoints(message);
      case OBJECTS.STATUS:
        return this.status(message);
      default: {
        const answer = actionAnswer(message, ACTION_COMMANDS);
        if (answer && answer.stage === 'result') {
          this.logger.info(`Blue Current: ${answer.command} ${answer.ok ? 'done' : 'refused'}`);
        }
        return undefined;
      }
    }
  }

  async serverError(channel, message) {
    const kind = errorKind(message);
    this.logger.warn(`Blue Current error ${errorCode(message)} (${kind})`);
    if (kind === 'server_error') {
      return;
    }
    // A refused auth token or the request limit: this connection ends here.
    this.channel = undefined;
    this.listed = false;
    this.stopPing();
    this.endWaiters();
    channel.close();
    await this.failed(new ChannelError(kind));
  }

  async chargePoints(message) {
    const list = readChargePoints(message);
    const points = new Map();
    for (const point of list) {
      const before = this.points.get(point.evseId);
      const status = before?.status ?? { receivedAt: this.now() };
      if (point.activity && !before?.status?.activity) {
        status.activity = point.activity;
      }
      points.set(point.evseId, { ...point, status });
    }
    this.points = points;
    this.listed = true;
    if (this.listTimer) {
      this.timers.clearTimeout(this.listTimer);
      this.listTimer = undefined;
    }
    await this.succeeded();
    for (const evseId of points.keys()) {
      this.request(COMMANDS.STATUS, { evse_id: evseId });
    }
    await this.setStatus(true, points.size > 0 ? T.connected(points.size) : T.noChargePoint);
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
  }

  async status(message) {
    const point = this.points.get(evseOf(message));
    if (!point) {
      return;
    }
    this.merge(point, readStatus(message, this.now()));
    this.queueStates();
    await this.publishBadges();
  }

  /** The fields of a status (possibly partial) onto the known one. */
  merge(point, status) {
    point.status = { ...point.status, ...status };
  }

  // --- Gladys ----------------------------------------------------------------------

  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  async publishDevices() {
    if (this.points.size === 0) {
      return;
    }
    const devices = [...this.points.values()].map((point) =>
      buildDevice(
        this.gladys,
        point,
        this.config,
        this.createdDevice(chargePointIds(this.gladys, point.evseId).device),
      ),
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    const now = this.now();
    for (const point of this.points.values()) {
      const ids = chargePointIds(this.gladys, point.evseId);
      for (const { device_feature_external_id: id, ...value } of deviceStates(
        ids,
        point.status,
        this.config,
        now,
      )) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  async publishBadges() {
    const entries = [];
    for (const point of this.points.values()) {
      const externalId = chargePointIds(this.gladys, point.evseId).device;
      if (!this.createdDevice(externalId)) {
        continue;
      }
      const online = this.channel && this.listed && point.status.activity !== 'offline';
      entries.push({
        external_id: externalId,
        transport: online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
      });
    }
    if (entries.length === 0) {
      return;
    }
    const json = JSON.stringify(entries);
    if (json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the charge points known (no extra request). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button ------------------------------------------------------

  async testConnection() {
    if (!this.config.apiToken) {
      return T.noToken;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last
        ? { en: `${T.test.cooldown.en} ${last.en}`, fr: `${T.test.cooldown.fr} ${last.fr}` }
        : T.test.cooldown;
    }
    this.lastTestAt = this.now();
    if (this.channel && this.listed) {
      return this.points.size > 0 ? T.connected(this.points.size) : T.noChargePoint;
    }
    // One try per click: the button is how a refused token is tried again,
    // and how a backoff is cut short.
    if (this.block) {
      this.retrying = this.block;
      this.block = undefined;
    }
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pauseKind = undefined;
    this.pausedUntil = 0;
    await this.setStatus(false, T.connecting);
    let handle;
    const waited = await Promise.race([
      this.connect().then(() => this.listedOrClosed()),
      new Promise((resolve) => {
        handle = this.timers.setTimeout(() => resolve('timeout'), TIMINGS.testWait);
      }),
    ]);
    this.timers.clearTimeout(handle);
    if (waited === 'timeout') {
      return T.test.waiting;
    }
    return this.lastMessage ?? T.test.waiting;
  }

  /** Resolves once the list came, or the connection is gone. */
  listedOrClosed() {
    if (!this.channel || this.listed) {
      return Promise.resolve();
    }
    // The waiter is resolved at the start of the handling: its end is awaited too.
    return this.waitFor((message) => message.object === OBJECTS.CHARGE_POINTS).promise.then(
      () => this.handling,
    );
  }

  // --- Commands --------------------------------------------------------------------

  /** An awaited answer: `promise` resolves with { message } or { closed }; `cancel()` drops it. */
  waitFor(match) {
    let waiter;
    const promise = new Promise((resolve) => {
      waiter = { match, resolve };
    });
    this.waiters.add(waiter);
    return {
      promise,
      cancel: () => {
        this.waiters.delete(waiter);
        waiter.resolve({ cancelled: true });
      },
    };
  }

  /** Waits for an answer at most `ms`; resolves with { timeout } after. */
  async within(wait, ms) {
    let handle;
    const timeout = new Promise((resolve) => {
      handle = this.timers.setTimeout(() => resolve({ timeout: true }), Math.max(0, ms));
    });
    const result = await Promise.race([wait.promise, timeout]);
    this.timers.clearTimeout(handle);
    if (result.timeout) {
      wait.cancel();
    }
    return result;
  }

  /** The feature of one of our charge points: { point, role }, else undefined. */
  featureOf(externalId) {
    if (typeof externalId !== 'string') {
      return undefined;
    }
    for (const point of this.points.values()) {
      const ids = chargePointIds(this.gladys, point.evseId);
      if (!externalId.startsWith(`${ids.device}:`)) {
        continue;
      }
      const role = externalId.slice(ids.device.length + 1);
      return { point, role };
    }
    return undefined;
  }

  error(text) {
    return new Error(word(text, this.config.language));
  }

  /** A command value, strictly: a button sends 1; the select one of its options. */
  wanted(role, value) {
    if (role === FEATURES.AVAILABILITY) {
      return value === AVAILABILITY.OPERATIVE || value === AVAILABILITY.BLOCKED ? value : undefined;
    }
    return value === PRESSED || value === String(PRESSED) ? PRESSED : undefined;
  }

  /** A command from Gladys: checks, a fresh status, then one request. */
  async setValue(device, feature, value) {
    const received = this.now();
    const target = this.featureOf(feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      // A feature of a charge point no longer listed, or a reading.
      throw this.error(target ? ERRORS.readOnly : ERRORS.unknownChargePoint);
    }
    const { point, role } = target;
    const option = OPTION_OF[role];
    if (!this.config[option]) {
      throw this.error(role === FEATURES.REBOOT ? ERRORS.rebootDisabled : ERRORS.disabled);
    }
    const wanted = this.wanted(role, value);
    if (wanted === undefined) {
      throw this.error(ERRORS.invalidValue);
    }
    const paused = this.pauseMessage();
    if (paused) {
      throw this.error(paused);
    }
    if (!this.channel || !this.listed) {
      throw this.error(ERRORS.notConnected);
    }
    if (this.commanding) {
      throw this.error(ERRORS.stillRunning);
    }
    this.commanding = true;
    try {
      await this.command({ point, role, option, wanted, received, generation: this.generation });
    } finally {
      this.commanding = false;
    }
  }

  /** The status of a charge point, asked now: the fields of that answer only, never merged. */
  async freshStatus(evseId, deadline) {
    const wait = this.waitFor(
      (message) => message.object === OBJECTS.STATUS && evseOf(message) === evseId,
    );
    if (!this.request(COMMANDS.STATUS, { evse_id: evseId })) {
      wait.cancel();
      return undefined;
    }
    const result = await this.within(wait, deadline - this.now());
    return result.message ? readStatus(result.message, this.now()) : undefined;
  }

  /** The request a command needs, from the status just read; null when nothing is to do. */
  plan(role, wanted, fresh, point) {
    const activity = fresh.activity;
    if (activity === undefined || activity === null) {
      throw this.error(ERRORS.unknownState);
    }
    if (activity === 'offline') {
      throw this.error(ERRORS.offline);
    }
    switch (role) {
      case FEATURES.START:
        if (activity === 'error') {
          throw this.error(ERRORS.inError);
        }
        if (activity === 'unavailable') {
          throw this.error(ERRORS.blocked);
        }
        if (activity === 'charging') {
          return null;
        }
        if (!point.card) {
          throw this.error(ERRORS.noCard);
        }
        // bluecurrent-api: start_session(evse_id, session_token = the card uid).
        return { command: COMMANDS.START, fields: { session_token: point.card } };
      case FEATURES.STOP: {
        if (activity === 'charging') {
          return { command: COMMANDS.STOP, fields: {} };
        }
        const vehicle = fresh.vehicle;
        if (vehicle === undefined || vehicle === null) {
          throw this.error(ERRORS.unknownState);
        }
        // A vehicle plugged in may hold a session that is not charging (smart charging).
        return vehicle === 'standby' ? null : { command: COMMANDS.STOP, fields: {} };
      }
      case FEATURES.AVAILABILITY: {
        const current = availabilityOf(activity);
        if (current === undefined) {
          throw this.error(activity === 'error' ? ERRORS.inError : ERRORS.unknownState);
        }
        if (current === wanted) {
          return null;
        }
        // bluecurrent-api: block(evse_id, True) sends SET_INOPERATIVE.
        return {
          command: wanted === AVAILABILITY.BLOCKED ? COMMANDS.INOPERATIVE : COMMANDS.OPERATIVE,
          fields: {},
        };
      }
      default:
        return { command: COMMANDS.REBOOT, fields: {} };
    }
  }

  /**
   * Reads the status, decides, sends. Gladys waits 5 s: nothing is sent later
   * than 3.5 s after the click, and Gladys is answered at 4.3 s at the latest,
   * whatever the publication of the states (which is never awaited here).
   */
  async command({ point, role, option, wanted, received, generation }) {
    const sendBy = received + TIMINGS.commandSendBy;
    if (sendBy - this.now() < TIMINGS.commandMinRead) {
      throw this.error(ERRORS.tooSlow);
    }
    const fresh = await this.freshStatus(point.evseId, sendBy - TIMINGS.commandMinSend);
    if (generation !== this.generation || !this.channel) {
      throw this.error(ERRORS.notConnected);
    }
    if (!fresh) {
      throw this.error(ERRORS.unknownState);
    }
    const plan = this.plan(role, wanted, fresh, point);
    if (!plan) {
      // Already so: the state just read is shown (not awaited).
      this.flush();
      return;
    }
    // The option again, just before sending: it may have been turned off meanwhile.
    if (!this.config[option]) {
      throw this.error(role === FEATURES.REBOOT ? ERRORS.rebootDisabled : ERRORS.disabled);
    }
    if (sendBy - this.now() < TIMINGS.commandMinSend) {
      throw this.error(ERRORS.tooSlow);
    }
    let received_ = false;
    const answer = this.waitFor((message) => {
      const a = actionAnswer(message, [plan.command]);
      if (!a || (a.evseId !== undefined && a.evseId !== point.evseId)) {
        return false;
      }
      if (a.stage === 'received' && a.ok) {
        received_ = true;
        return false; // the result is still awaited
      }
      return true;
    });
    if (!this.request(plan.command, { evse_id: point.evseId, ...plan.fields })) {
      answer.cancel();
      throw this.error(ERRORS.notSent);
    }
    this.logger.info(`Blue Current command: ${plan.command}`);
    const outcome = await this.within(answer, received + TIMINGS.commandAck - this.now());
    this.refreshSoon(point.evseId, generation);
    if (outcome.message) {
      const a = actionAnswer(outcome.message, [plan.command]);
      if (a.ok) {
        return;
      }
      this.logger.warn(`Blue Current refused ${plan.command}`);
      throw this.error(ERRORS.refused);
    }
    // It may have left: never announced "not sent".
    throw this.error(received_ ? ERRORS.receivedNoResult : ERRORS.sentNoConfirmation);
  }

  /** The status asked again a few seconds after a command, to show its effect. */
  refreshSoon(evseId, generation) {
    if (this.refreshTimer) {
      this.timers.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = this.timers.setTimeout(() => {
      this.refreshTimer = undefined;
      if (generation === this.generation) {
        this.request(COMMANDS.STATUS, { evse_id: evseId });
      }
    }, TIMINGS.refreshAfterCommand);
  }
}
