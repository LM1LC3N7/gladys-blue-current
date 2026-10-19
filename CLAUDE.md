# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15) and to
Blue Current through `ws` (its two runtime dependencies). It holds one
WebSocket connection to the official Blue Current API (the one of Home
Assistant, ported from bluecurrent-api, MIT), shows each charge point as a
Gladys device, and offers start, stop, block and reboot behind off-by-default
options. Never tested with a real account, not affiliated with Blue Current.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          BlueCurrentApp: validation, connection, backoff, pauses and
                    stops, messages, devices, states, badges, button, commands
src/socket.js       one ws connection (bounded), the token validation, refusal kinds
src/protocol.js     messages: parsing (bounded, no prototype keys), reading, answers (pure)
src/time.js         Amsterdam dates, the midnight reset of the request limit (pure)
src/devices.js      -> the Gladys devices and their states (pure)
src/publisher.js    states within 300/min
src/store.js        /data/blue-current-state.json: request-limit pause, refused-token stop
src/config.js       config_schema normalized, token key (hash of the token)
src/constants.js    URL, commands, objects, feature roles, limits, timings
src/i18n.js         runtime texts, feature, activity and vehicle names (en/fr)
test/helpers/       a fake Blue Current ws server; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device `chargepoint:<evse_id>`, features
  `activity`, `connector-status`, `charging-state`, `vehicle-status`,
  `power`, `current-l1..3`, `voltage-l1..3`, `session-energy`,
  `session-duration`, `session-cost`, `max-current`, `start-session`,
  `stop-session`, `availability`, `reboot`. A device published again keeps
  every feature of the created device (`gladys.devices`).
- Manifest keys (`api_token`, `allow_commands`, `allow_reboot`, `language`,
  the action `test_connection`) are frozen.
- **Commands**: never a switch nor a binary; refused unless their option;
  decided on a fresh `GET_CH_STATUS` answer only (never merged with the
  memory), refused when a needed value is missing; the option checked again
  just before sending; never sent after 3.5 s, Gladys answered by 4.3 s, the
  publication of states never awaited; one at a time; a command that may
  have left is "sent, without confirmation", never "not sent".
- **Never connect in a loop**: every attempt waits for a timer (backoff,
  request-limit pause, refused-token stop). A Gladys reconnection
  (`connected`) clears neither pauses, stops nor the connection, but sends
  the status, Discovery and badges again.
- **Energy**: no cumulative index exists; never publish an `index`/`energy`
  feature nor `daily-consumption`.
- Never log or put in a message the API token, the auth token, or the free
  text of an answer (object names and error codes only).
- Messages bounded (256 KB), parsed without prototype keys; ids checked;
  charge points in a `Map`.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`; a `secret`
  field is kept by Gladys in its database, never write that it is encrypted.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
