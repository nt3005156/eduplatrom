// Bikram Sambat (BS, Nepali calendar) dates. The database stores AD (Gregorian) ISO dates, and BS is
// converted at the edges: when staff enter a date, and when a date is printed in Nepali.
// Library: bikram-sambat 1.8.1 (Apache-2.0). Its month-length table covers BS 1970 to 2090.
// Checked: every day from BS 2070-01-01 to 2083-12-31 agrees with a second library (nepali-date-converter).
// Not checked against the official Nepal government calendar; see test/golden/bs-month-starts.json.
import * as bik from 'bikram-sambat';

export const BS_MIN_YEAR = 2070;
export const BS_MAX_YEAR = 2090; // inclusive; the library has no month lengths beyond this
export const BS_VERIFIED_MAX_YEAR = 2083; // the range checked against a second library

const BS_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = n => String(n).padStart(2, '0');

/** True when a BS year/month/day exists in the supported range. */
export function isValidBs(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < BS_MIN_YEAR || year > BS_MAX_YEAR || month < 1 || month > 12) return false;
  try {
    return day >= 1 && day <= bik.daysInMonth(year, month);
  } catch {
    return false;
  }
}

/** Parses a "YYYY-MM-DD" BS string. Returns { year, month, day } or null. */
export function parseBs(s) {
  const m = BS_RE.exec(String(s || ''));
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidBs(parts.year, parts.month, parts.day) ? parts : null;
}

/** BS "YYYY-MM-DD" to AD "YYYY-MM-DD". Returns null for an invalid or unsupported date. */
export function bsToAd(bsString) {
  const p = parseBs(bsString);
  if (!p) return null;
  const greg = bik.toGreg(p.year, p.month, p.day); // { year, month, day } in AD
  return `${greg.year}-${pad(greg.month)}-${pad(greg.day)}`;
}

/** AD "YYYY-MM-DD" to BS "YYYY-MM-DD". Returns null for an invalid or unsupported date. */
export function adToBs(adString) {
  const m = AD_RE.exec(String(adString || ''));
  if (!m) return null;
  const probe = new Date(`${adString}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== adString) return null;
  try {
    const b = bik.toBik(adString);
    if (b.year < BS_MIN_YEAR || b.year > BS_MAX_YEAR) return null;
    return `${b.year}-${pad(b.month)}-${pad(b.day)}`;
  } catch {
    return null;
  }
}

/** Nepali display with Devanagari digits and month name, e.g. "२६ असोज २०८३". Returns '' for an invalid date. */
export function formatBsNepali(bsString) {
  const ad = bsToAd(bsString);
  if (!ad) return '';
  return bik.toBik_text(ad);
}
