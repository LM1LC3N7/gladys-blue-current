# gladys-blue-current

[Gladys Assistant](https://gladysassistant.com) external integration for
**Blue Current** charge points (Netherlands, Belgium) through the official
Blue Current WebSocket API (the one of its Home Assistant integration):
status, connector and charging state, vehicle, power, current and voltage per
phase, energy, duration and cost of the session, maximum current; start,
stop, block/unblock and reboot behind off-by-default options. **Never tested
with a real account. Not affiliated with Blue Current.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (BlueCurrentApp)
                                  ├─ src/socket.js     one ws connection, token validation, refusals
                                  ├─ src/protocol.js   messages: bounded parsing, reading, attribution (pure)
                                  ├─ src/time.js       Amsterdam dates, the midnight reset (pure)
                                  ├─ src/devices.js    the devices and their states (pure)
                                  ├─ src/publisher.js  states within 300/min
                                  └─ src/store.js      /data/blue-current-state.json
```

- **Token** (as bluecurrent-api): `VALIDATE_API_TOKEN` on a short connection
  gives an auth token, sent as `Authorization: Token <token>` in every
  request of the main connection (`wss://motown.bluecurrent.nl/haserver`):
  `HELLO`, `GET_CHARGE_POINTS`, then `GET_CH_STATUS` per charge point. Blue
  Current then pushes the statuses; nothing is polled (a status is asked
  again only after an hour of silence, and a few seconds after a command).
- **Connection**: a ping every minute, no pong: cut and reopened. Reconnection
  with a backoff (5 s to 10 min, jitter), reset only by a stable connection
  (open 3 min with a pong), never by the list; "Already connected": 2 minutes
  at least; the request limit (error 42, close 4001, "Request limit reached"):
  a pause until 00:00:30 in Amsterdam; a bare HTTP 429: its Retry-After
  (1 min – 6 h); both kept in `/data`. A refused API token (or an ERROR 1/2
  within 30 min of a validation) stops, kept in `/data` with a hash of the
  token: one new try after 6 h, then every 24 h, or at once with a new token
  or the test button. A handshake 401/403 without a documented reason is a
  plain backoff, never a refused token. The HELLO says `homeassistant` (the
  only documented value, explained in the docs); the User-Agent says
  `gladys-blue-current/<version>`.
- **Messages**: 256 KB at most (`maxPayload`, no compression), JSON parsed
  without `__proto__`/`constructor`/`prototype` keys, charge points kept in a
  `Map`, ids checked. Answers are attributed to their request by their
  `object` (`CH_STATUS`, `RECEIVED_x`, `STATUS_x`) and charge point.
- **Commands**: `button`/`push` and one `text`/`select`, never a switch.
  `allow_commands` (start, stop, block) and `allow_reboot` are off by
  default. Each command: the option, a fresh `GET_CH_STATUS` (decided on that
  answer only, which must carry the fields of the decision, never on the
  memory; a start needs a vehicle plugged in; nothing is sent when there is
  nothing to do; a stop never waits for another command), the option checked again just before
  sending, sent within 3.5 s of the click or refused unsent, Gladys answered
  within 4.3 s whatever the publication of states; a command that may have
  left is never said "not sent": "Command sent, without confirmation".
- **Energy**: Blue Current gives no cumulative meter: no `index`, no
  `publishEnergyConsumption`. The session energy is a plain
  `electrical-vehicle-charge` sensor.

### Why `ws`

The WebSocket of Node 22 cannot read why a handshake is refused: Blue
Current says "Request limit reached" or "Already connected" in an
`x-websocket-reject-reason` header, which `ws` exposes
(`unexpected-response`). `ws` (MIT, the most used WebSocket package of Node,
no dependency, already in the tree through the SDK) also bounds the size of
a message and sends pings.

## Credits

The protocol is ported from
[bluecurrent-api](https://github.com/bluecurrent/HomeAssistantAPI) (Blue
Current, MIT), the library of the Blue Current integration of Home Assistant.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled on the sibling
integrations [gladys-ohme](https://github.com/LM1LC3N7/gladys-ohme) (charger,
commands) and [gladys-sense](https://github.com/LM1LC3N7/gladys-sense)
(WebSocket).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: Blue Current is a fake `ws` server behind the
injected socket factory, Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the
Docker image).
