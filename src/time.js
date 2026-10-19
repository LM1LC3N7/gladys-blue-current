// -----------------------------------------------------------------------------
// Times of Blue Current (pure): its dates are "YYYYMMDD HH:MM:SS" in the time
// of Amsterdam, or "YYYYMMDD HH:MM:SS+hhmm" (bluecurrent-api, create_datetime),
// and its request limit is reset at midnight in Amsterdam
// (get_next_reset_delta: 00:00:30 of the next day).
// -----------------------------------------------------------------------------

export const ZONE = 'Europe/Amsterdam';

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The wall clock of Amsterdam at an instant: { year, month, day, hour, minute, second }. */
export function amsterdamClock(epoch) {
  const parts = {};
  for (const { type, value } of FORMAT.formatToParts(new Date(epoch))) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  return parts;
}

/** The offset of Amsterdam (ms, UTC+1 = 3 600 000) at an instant. */
function offsetAt(epoch) {
  const c = amsterdamClock(epoch);
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return wall - Math.floor(epoch / 1000) * 1000;
}

/**
 * The instant of a wall clock time in Amsterdam. In the hour skipped in
 * spring, the time after the jump; in the hour repeated in autumn, the first.
 */
export function amsterdamEpoch(year, month, day, hour = 0, minute = 0, second = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // The offset the day before and the day after: one of them is right.
  const before = wall - offsetAt(wall - 86_400_000);
  const after = wall - offsetAt(wall + 86_400_000);
  const valid = [before, after].filter((epoch) => offsetAt(epoch) === wall - epoch);
  // Both (the repeated hour): the first; none (the skipped hour): the offset of before the jump.
  return valid.length > 0 ? Math.min(...valid) : before;
}

const DATE = /^(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:([+-])(\d{2}):?(\d{2}))?$/;

/** A Blue Current date -> epoch (ms), else undefined (empty, null, malformed or impossible). */
export function parseDate(value) {
  if (typeof value !== 'string' || value.length > 32) {
    return undefined;
  }
  const m = DATE.exec(value.trim());
  if (!m) {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day) {
    return undefined; // 31 April, 30 February
  }
  if (m[7]) {
    const sign = m[7] === '-' ? -1 : 1;
    const offset = sign * (Number(m[8]) * 60 + Number(m[9])) * 60_000;
    return Date.UTC(year, month - 1, day, hour, minute, second) - offset;
  }
  return amsterdamEpoch(year, month, day, hour, minute, second);
}

/** The next reset of the request limit: 00:00:30 in Amsterdam, the day after `now`. */
export function nextReset(now) {
  const c = amsterdamClock(now);
  const tomorrow = new Date(Date.UTC(c.year, c.month - 1, c.day + 1));
  return (
    amsterdamEpoch(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()) +
    30_000
  );
}
