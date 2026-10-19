# TODO — Blue Current v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #275, lot 8) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-19): token validation, one WebSocket
      connection (HELLO, charge points, statuses, pushes), one device per
      charge point (status, connector, charging state, vehicle, power,
      current and voltage per phase, energy, duration and cost of the
      session, maximum current), start/stop buttons and availability select
      behind `allow_commands`, reboot button behind `allow_reboot` (both
      off), reconnection with backoff, request-limit pause and refused-token
      stop persisted and bounded, test button, docs en/fr, cover. Tested
      against a fake server only.
- [x] **Milestone 1 fixes — review** (2026-10-19): the xhigh review of
      8e1ad19 (B1, B2, I1–I4, M1–M13), each with its regression test; the
      reviewer's scenarios H1–H15 and the User-Agent check are in the tests.
- [ ] **Milestone 2 — real account**: run against a real account (see "To
      check"), turn the messages (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: choice of the charge card (GET_CHARGE_CARDS,
      a select, as Home Assistant plans), grid status (building load per
      phase, GET_GRID_STATUS), plug and charge and linked cards only (as
      selects behind the option, never switches), smart charging profiles.

## To check on a real account

- The objects of the answers to the commands: `RECEIVED_START_SESSION` then
  `STATUS_START_SESSION` (as the bluecurrent-api tests); what
  `SET_OPERATIVE`/`SET_INOPERATIVE` answer (the library ignores every object
  holding "OPERATIVE"; here, `RECEIVED_SET_x`/`STATUS_SET_x` are read, and
  without them Gladys shows "sent, without confirmation").
- Whether Blue Current pushes `CH_STATUS` on every change (Home Assistant
  relies on it and never polls), and whether pushes are partial (merged here,
  as Home Assistant does).
- The request limit: how many requests a day; whether pings count.
- `vehicle_status` letters or names; voltages phase-to-neutral (~230 V,
  assumed for the power) or phase-to-phase.
- `start_datetime`/`total_cost`: documented as "currently disabled".
- `default_card.uid` (`BCU-APP` in the examples) as `session_token` for
  `START_SESSION`.
- The `activity` while blocked: `unavailable` (as Home Assistant reads it).
- Ask Blue Current whether `gladys` is accepted as the HELLO `header`
  (today `homeassistant`, the only documented value). Never fall back from
  one to the other at run time: change it only on Blue Current's answer.
- Which error texts a `STATUS_x` carries besides `TIMEOUT` and `REJECTED`.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-blue-current:0.1.0`); the first patch release
  gives 0.1.1. `test/manifest.test.js` checks the four agree.
- **Reference**: bluecurrent-api 1.3.2 (MIT, Blue Current, the library of
  Home Assistant), checked not GPL, cloned read-only in
  `_ref/bluecurrent-api`, credited in `THIRD_PARTY_NOTICES.md` (copied in the
  image).
- **`ws` (MIT) rather than the WebSocket of Node 22**: Blue Current refuses
  handshakes with a reason in the `x-websocket-reject-reason` header (request
  limit, already connected), which only `ws` can read; `ws` also bounds the
  message size (`maxPayload` 256 KB, no compression) and sends pings. It has
  no dependency and was already in the tree through the SDK.
- **HELLO header `homeassistant`**: the endpoint is made for that client and
  no other value is documented; the honest identity goes in the User-Agent.
- **No polling**: Blue Current pushes; a status is asked only at connection,
  after an hour of silence, before a command (the fresh read) and 5 s after
  one, to spare the daily request limit.
- **Request limit**: error 42, close 4001 or a handshake refusal pauses every
  path until 00:00:30 Amsterdam (bluecurrent-api, `get_next_reset_delta`),
  bounded 1 min – 25 h, kept in `/data`.
- **Refused token** (review B1): a validation answering `success: false` or
  error 1/2, or an ERROR 1/2 less than 30 min after a validation, stops (kept
  in `/data` with a hash of the token): one new try after 6 h, then every
  24 h; a new token or the test button tries at once. An ERROR 1/2 later on
  (an auth token that expired): validated again once after the backoff. An
  ERROR 2 while a command is in flight refuses that command only. A handshake
  401/403 without a documented reason is an `http` error with the backoff,
  never a refused token (review I1).
- **Reconnection** (review B2): 5 s, 15 s, 30 s, 1, 2, 5, 10 min, jitter
  half to whole; reset only by a stable connection (open 3 min, listed, a
  pong since the open), never by the list. "Already connected" at least
  2 min; ping every minute, a missing pong cuts the connection; no list
  within 30 s cuts it too. Our own closes are a normal close (1000), cut
  after 2 s.
- **429** (review M6): a bare HTTP 429 at the handshake pauses every path
  for its Retry-After bounded to 1 min – 6 h (15 min without), kept in
  `/data`; "until midnight" only for the documented signals (error 42,
  close 4001, "Request limit reached").
- **Statuses asked** (review M4): all with the first list of a connection,
  then only for a new charge point; a list pushed again asks nothing. The
  same warning is logged at most once per 10 min.
- **Display while charging** (review M7): the duration is computed again
  every minute, without a request. A charge point no longer on the list
  shows unreachable (M10). A Gladys reconnection shows the pause and stop
  texts with the time left (M5).
- **User-Agent** `gladys-blue-current/<version of package.json>`; HELLO
  `homeassistant`, explained in the docs, never another value as a fallback.
- **Commands are buttons and a select**, never switches (lot 6 lesson);
  start/stop/availability behind `allow_commands`, reboot behind
  `allow_reboot` (heavy: it cuts a session). Only REBOOT is offered, not
  SOFT_RESET.
- **Decision on the fresh status only**: `GET_CH_STATUS`, then the fields of
  that answer alone. Start: refused offline, in error or blocked, nothing to
  do while charging, needs the default card of the charge point. Stop: sent
  while charging or with a vehicle plugged in (a session may be paused),
  nothing to do without vehicle, refused when the vehicle status is missing.
  Availability: from `activity` (`unavailable` = blocked), refused when it
  says neither. Reboot: refused offline.
- **Fresh status** (review I3): only a `CH_STATUS` of that charge point
  carrying the fields of the decision (`activity`, plus `vehicle_status` to
  start or stop) is taken; a partial push meanwhile is merged for the display
  only. **Start** (I2) is refused unless the vehicle is plugged in
  (`vehicle_detected` or `ready`): missing, standby, no power, vehicle error
  give "plug in the vehicle first".
- **Answers**: one command at a time, except a stop, which never waits for
  the queue (M9); the result `STATUS_x` acks success; "refused" only for
  `REJECTED` or `success: false`; `TIMEOUT` (I4): "sent and received,
  without a result from the charge point"; only `RECEIVED_x`: "sent and
  received, without a result"; nothing, another error text, or the
  connection lost after sending: "Command sent, without confirmation". An
  answer whose `evse_id` is present but malformed is attributed to nothing
  (M2); ids `__proto__`, `constructor`, `prototype` are refused (M3). After a
  command left without a result, the first `STATUS_x` of that command on
  that charge point within 2 min is ignored (M1): never the ack of the next
  one. Never the free text of an answer.
- **Power** = Σ voltage × current over the phases (W). bluecurrent-api gives
  avg current × avg voltage × √3, which undercounts a three-phase charge on
  phase-to-neutral voltages.
- **Cost**: Blue Current documents `total_cost` as disabled (0): a 0 is shown
  only when no energy was charged.
- **Duration**: from `start_datetime` to now while charging, else to
  `stop_datetime`; nothing without a start; at most 14 days.
- **Every device carries all its features** (three phases even on a
  single-phase charge point), and keeps every feature of the created device:
  nothing is ever lost on a republication.
- **Gladys 4.86.0** at least (charging-station features, text/select).
- **Offline**: the readings keep their last value; the status, the
  connector and the badge (unreachable) say it.
