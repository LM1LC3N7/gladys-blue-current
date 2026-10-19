# Blue Current

Shows your **Blue Current** charge points (Netherlands, Belgium) in Gladys,
in real time, through the official API Blue Current makes for home
automation (the one of its Home Assistant integration).

**Never tested with a real account**: this integration was written from the
library Blue Current publishes for Home Assistant, and tested against
simulated answers only. Not affiliated with Blue Current.

## What you get

One Gladys device per charge point, with:

- **Status**: available, charging, blocked, error, offline;
- **Connector** and **charging state** (the charging-station features of Gladys);
- **Vehicle**: no vehicle, vehicle connected, ready to charge, error;
- **Power** (W), **current** and **voltage** per phase (L1, L2, L3);
- **Energy of the session** (kWh), **duration of the session** (minutes),
  **cost of the session** (€, when Blue Current gives it: it documents this
  value as disabled for now), **maximum current** (A).

And, only if you allow them (see below):

- **Start a session** and **Stop the session** (buttons);
- **Availability** (a list: available / blocked), to block or unblock the
  charge point;
- **Reboot the charge point** (a button), behind its own option.

The commands are buttons and a list, never on/off switches: a "turn
everything off" of a voice assistant or a scene cannot reach them.

## Create the API token

1. Sign in to the Blue Current driver portal,
   [my.bluecurrent.nl](https://my.bluecurrent.nl), with the account of your
   charge point.
2. Open the settings, then **Advanced**, and create the **Home Assistant
   API token**. (The Blue Current app may offer it too; not verified.)
3. Copy the token.

## Set up

1. In Gladys, open the integration, paste the token in **Blue Current API
   token**, save. The token is kept by Gladys in its database, never shown
   again, and sent only to Blue Current.
2. The status says how many charge points Blue Current lists. Open the
   **Discovery** tab and add them.
3. To use the commands, turn on **Allow the commands** (start, stop, block,
   unblock) and, separately, **Allow rebooting the charge point**. Both are
   off by default.

## Good to know

- **One connection**: Blue Current pushes the changes, nothing is polled. A
  lost connection comes back by itself, after a few seconds then longer and
  longer (up to 10 minutes).
- **Daily request limit**: Blue Current limits the requests per day. When it
  is reached, the integration waits until midnight (Amsterdam time) before
  connecting again, even after a restart.
- **"Already open elsewhere"**: Blue Current may refuse a second connection
  (another Gladys, a Home Assistant with the same account). The integration
  then waits at least two minutes between tries.
- **Refused token**: the integration stops and tries again after 6 hours,
  then every 24 hours. Save a new token, or click **Test the connection**,
  to try again at once.
- **Commands**: before each one, the status of the charge point is read
  again; the command is refused if it cannot be read, if the charge point is
  offline, or if there is nothing to do (start while charging...). One
  command at a time. A session is started with the default charge card of the
  charge point, as Blue Current gives it. Gladys waits 5 seconds: if Blue
  Current has not confirmed by then, Gladys shows "Command sent, without
  confirmation": the command may have been carried out, the state follows.
- **Reboot**: the charge point restarts and a session in progress is cut.
- The power is the sum, over the phases, of voltage times current (the Home
  Assistant integration shows a slightly different estimate).
- **Not handled yet**: smart charging, plug and charge, linked cards only,
  the choice of the charge card, the grid status (building load).

## Privacy

The integration talks only to Blue Current
(`wss://motown.bluecurrent.nl`). It never logs the token. In `/data` it keeps
only the end of a request-limit pause and, after a refusal, a hash of the
refused token with the time of the next try.
