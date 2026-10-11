// Message text for parent alerts. Pure functions, so they are easy to test.
// The Nepali text is a first draft. A native speaker must review it before a pilot.

export const TEMPLATE_IDS = { absent: 'attendance.absent.v1', late: 'attendance.late.v1', notice: 'notice.v1' };

function english(kind, { student, date, school }) {
  if (kind === 'absent') return `${school}: ${student} was marked ABSENT on ${date}. Contact the school if this is wrong.`;
  if (kind === 'late') return `${school}: ${student} was marked LATE on ${date}.`;
  throw new Error(`unknown template ${kind}`);
}

function nepali(kind, { student, date, school }) {
  if (kind === 'absent') return `${school}: ${student} लाई ${date} मा अनुपस्थित जनाइएको छ। गलत भएमा विद्यालयमा सम्पर्क गर्नुहोला।`;
  if (kind === 'late') return `${school}: ${student} लाई ${date} मा ढिलो भएको जनाइएको छ।`;
  throw new Error(`unknown template ${kind}`);
}

/** Renders an attendance alert in the school's chosen language: 'en', 'ne', or 'both'. */
export function renderAttendanceAlert(kind, vars, language = 'en') {
  if (language === 'ne') return nepali(kind, vars);
  if (language === 'both') return `${english(kind, vars)}\n${nepali(kind, vars)}`;
  return english(kind, vars);
}

/**
 * Counts SMS segments the way carriers bill them: 160 characters per single GSM-7 message
 * (153 when concatenated) and 70 for UCS-2 (67 when concatenated). Nepali text is UCS-2.
 */
export function smsSegments(text) {
  const s = String(text);
  const gsm = /^[\x20-\x7E\r\n]*$/.test(s);
  const len = [...s].length;
  if (gsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
