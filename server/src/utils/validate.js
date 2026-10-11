// Field validation shared by guardian onboarding, profile edits and bulk import.
// Nepal rules come first (98/97/96 mobile prefixes, +977). International numbers
// are accepted in E.164 form so the same code serves both markets.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns { ok: true, value } with E.164 form, or { ok: false, error }. */
export function normalizePhone(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null };
  const compact = String(raw).replace(/[\s\-().]/g, '');
  const nepal = compact.match(/^(?:\+?977|00977)?(9[678]\d{8})$/);
  if (nepal) return { ok: true, value: `+977${nepal[1]}` };
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return { ok: true, value: compact };
  if (/^00[1-9]\d{7,14}$/.test(compact)) return { ok: true, value: `+${compact.slice(2)}` };
  return { ok: false, error: 'phone must be a Nepal mobile (98/97/96 + 8 digits) or international format like +14155550123' };
}

export function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (!e || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const GUARDIAN_RELATIONSHIPS = ['father', 'mother', 'guardian', 'grandparent', 'other'];

/**
 * RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF or LF, optional BOM.
 * Returns an array of rows (arrays of strings). Blank lines are dropped.
 */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error('CSV has an unclosed quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}
