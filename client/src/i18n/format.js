// Dates and numbers follow the interface language. Money stays formatted by utils/money.js (NPR).
import i18n from './index.js';

const SCHOOL_TZ = 'Asia/Kathmandu';

/** BCP-47 tag for the current interface language. */
export function localeTag() {
  return i18n.language === 'ne' ? 'ne-NP' : 'en-GB';
}

/** Formats a YYYY-MM-DD calendar date (no timezone shift) for display. */
export function formatCalendarDate(ymd, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!ymd) return '';
  const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), options);
}

/** Formats a server timestamp (SQLite UTC, "YYYY-MM-DD HH:MM:SS") in the school's timezone. */
export function formatSchoolDate(stamp, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!stamp) return '';
  const iso = String(stamp).includes('T') ? stamp : `${String(stamp).replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { ...options, timeZone: SCHOOL_TZ });
}
