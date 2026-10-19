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
- The HELLO `header` value (`homeassistant`) and whether another value is
  accepted.

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
- **Refused token**: a validation answering `success: false` or error 1/2,
  or error 1/2 on a connection whose token was just validated, stops (kept in
  `/data` with a hash of the token): one new try after 6 h, then every 24 h;
  a new token or the test button tries at once. Error 1/2 later on (an auth
  token that expired): validated again once after the backoff.
- **Reconnection**: 5 s, 15 s, 30 s, 1, 2, 5, 10 min, jitter half to whole;
  "Already connected" at least 2 min; ping every minute, a missing pong cuts
  the connection; no list within 30 s cuts it too.
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
- **Answers**: one command at a time; the result `STATUS_x` (with the evse id
  when it carries one) acks success or "refused"; only `RECEIVED_x`:
  "sent and received, without a result"; nothing, or the connection lost
  after sending: "Command sent, without confirmation". Never the free text
  of an answer.
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
