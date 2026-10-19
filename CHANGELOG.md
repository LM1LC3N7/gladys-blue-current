# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Blue Current charge points through the official WebSocket API (the one of
  Home Assistant), with an API token: one device per charge point with its
  status, connector and charging state, vehicle, power, current and voltage
  per phase, energy, duration and cost of the session, and maximum current,
  pushed in real time.
- Start and stop a session (buttons) and block or unblock the charge point
  (a list), behind "Allow the commands", off by default; reboot (a button)
  behind its own option, off by default. Each command reads the status again
  first and is answered within Gladys' 5 seconds.
- Reconnection with a backoff; the daily request limit waits until midnight
  (Amsterdam time); a refused token stops, with spaced new tries; both kept
  across restarts.
- "Test the connection" button, French and English documentation, cover.

[Unreleased]: https://github.com/LM1LC3N7/gladys-blue-current/commits/main
