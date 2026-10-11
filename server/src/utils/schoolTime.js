// School-local dates. Every "today", "last 30 days", streak day, or late-in-the-day check uses the
// school's timezone, not the server's and not UTC. Timestamps stay in UTC in the database.
export const SCHOOL_TZ = process.env.SCHOOL_TZ || 'Asia/Kathmandu';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TZ, hour: '2-digit', hourCycle: 'h23' });

function asDate(value) {
  if (value instanceof Date) return value;
  if (value === undefined || value === null) return new Date();
  // SQLite CURRENT_TIMESTAMP style ("2026-10-11 20:18:53") is UTC with no zone marker.
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s);
}

/** School-local calendar date, YYYY-MM-DD, for an instant (default: now). */
export function schoolDate(value) {
  return dayFormat.format(asDate(value));
}

/** School-local hour of day, 0 to 23, for an instant (default: now). */
export function schoolHour(value) {
  return Number(hourFormat.format(asDate(value))) % 24;
}

/** Adds whole days to a YYYY-MM-DD calendar date. Pure calendar arithmetic, so no timezone is involved. */
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (both YYYY-MM-DD). */
export function daysBetweenDates(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
