# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## bluecurrent-api

<https://github.com/bluecurrent/HomeAssistantAPI> (package `bluecurrent-api`,
version 1.3.2), by Blue Current, the library of the Blue Current integration
of Home Assistant. MIT License (`LICENSE` of the repository). Its notice:

```
Copyright (c) 2022 Blue Current

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported, in `src/constants.js`, `src/protocol.js`, `src/socket.js`,
`src/time.js` and `src/app.js`: the WebSocket URL, the token validation on its
own connection (`VALIDATE_API_TOKEN`, the `Token <token>` authorization of
every request), the `HELLO` command, the commands (`GET_CHARGE_POINTS`,
`GET_CH_STATUS`, `START_SESSION` with the card uid as `session_token`,
`STOP_SESSION`, `SET_OPERATIVE`/`SET_INOPERATIVE`, `REBOOT`), the message
objects and their `RECEIVED_`/`STATUS_` answers, the error codes (1, 2, 42),
the close code 4001 and the `x-websocket-reject-reason` header, the vehicle
status letters, the date format and the reset of the request limit at
midnight, Amsterdam time.

Changed: written in JavaScript for Node.js; messages bounded in size and
parsed without prototype pollution; answers attributed to their request by
their object and charge point; a refused token stops (kept in `/data`,
spaced new tries) instead of raising; reconnection with a backoff, pauses
kept in `/data`; the power is the sum over the phases of voltage times current
(bluecurrent-api: average current times average voltage times √3); smart
charging, grid status, settings and current overrides are not ported.

## Runtime dependencies

Installed by npm with their own license files, shipped in the image under
`node_modules/`:

- [`ws`](https://github.com/websockets/ws), MIT License, the WebSocket client.
- [`@gladysassistant/integration-sdk`](https://www.npmjs.com/package/@gladysassistant/integration-sdk),
  the Gladys integration SDK, and its dependencies.
