// Bulk student import from CSV (admin only).
//   POST /api/student-import/preview  { csv }  -> row-by-row report, writes nothing
//   POST /api/student-import          { csv }  -> all-or-nothing: any error and nothing is written
// Guardians are matched by email. Siblings with the same guardian email share one guardian account.
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { parseCsv, normalizeEmail, normalizePhone, isIsoDate, BLOOD_GROUPS, GUARDIAN_RELATIONSHIPS } from '../utils/validate.js';
import { createSetupToken, unknownPasswordHash } from '../services/accountSetup.js';
import { guardianRoleId } from '../services/guardians.js';

const router = Router();
export const MAX_IMPORT_ROWS = 2000;

export const COLUMNS = [
  'name', 'email', 'class_level', 'section', 'roll_no', 'admission_no', 'gender', 'dob_ad', 'dob_bs',
  'blood_group', 'phone', 'address', 'iemis_id', 'neb_reg_no', 'emergency_contact_name', 'emergency_contact_phone',
  'guardian_name', 'guardian_email', 'guardian_phone', 'guardian_relationship',
];
const REQUIRED = ['name', 'email', 'class_level', 'section'];
const GUARDIAN_COLS = ['guardian_name', 'guardian_email', 'guardian_phone', 'guardian_relationship'];

const trim = v => String(v ?? '').trim();

/** Validates the whole file. Pure except for reads. Returns the report. */
export function validateImport(csvText) {
  let grid;
  try { grid = parseCsv(csvText); } catch (e) { return { fatal: e.message }; }
  if (grid.length < 2) return { fatal: 'The file needs a header row and at least one student row.' };
  const header = grid[0].map(h => trim(h).toLowerCase());
  const fileErrors = [];
  const unknown = header.filter(h => !COLUMNS.includes(h));
  if (unknown.length) fileErrors.push(`Unknown column(s): ${unknown.join(', ')}. Remove them or check the spelling.`);
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) fileErrors.push(`Missing required column(s): ${missing.join(', ')}`);
  const dupHeader = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupHeader.length) fileErrors.push(`Repeated column(s): ${[...new Set(dupHeader)].join(', ')}`);
  if (fileErrors.length) return { fatal: fileErrors.join(' ') };
  const dataRows = grid.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) return { fatal: `Import at most ${MAX_IMPORT_ROWS} rows at a time (this file has ${dataRows.length}).` };

  const today = new Date().toISOString().slice(0, 10);
  const seenEmail = new Map();      // student email -> row
  const seenRoll = new Map();       // class|section|roll -> row
  const seenAdmission = new Map();  // admission_no -> row
  const guardianByEmail = new Map();// guardian email -> { name, relationship, row }
  const existingEmail = new Set(db.prepare('SELECT email FROM users').all().map(r => r.email));
  const existingAdmission = new Set(db.prepare("SELECT admission_no FROM users WHERE admission_no IS NOT NULL AND account_status != 'archived'").all().map(r => r.admission_no));
  const existingRoll = new Set(db.prepare("SELECT class_level || '|' || section || '|' || roll_no AS k FROM users WHERE role = 'student' AND roll_no IS NOT NULL AND account_status != 'archived'").all().map(r => r.k));
  const existingGuardian = new Map(db.prepare("SELECT id, email, name FROM users WHERE role = 'guardian'").all().map(g => [g.email, g]));

  const rows = dataRows.map((cells, idx) => {
    const row = idx + 1;
    const raw = Object.fromEntries(header.map((h, i) => [h, trim(cells[i])]));
    const errors = [];
    const warnings = [];
    const data = {};

    data.name = raw.name;
    if (data.name.length < 2 || data.name.length > 80) errors.push('name must be 2 to 80 characters');

    data.email = normalizeEmail(raw.email);
    if (!data.email) errors.push('email is missing or invalid');
    else {
      if (seenEmail.has(data.email)) errors.push(`email repeats row ${seenEmail.get(data.email)}`);
      else seenEmail.set(data.email, row);
      if (existingEmail.has(data.email)) errors.push('email already has an account');
    }

    const cls = Number(raw.class_level);
    if (!Number.isInteger(cls) || cls < 6 || cls > 12) errors.push('class_level must be a whole number from 6 to 12');
    data.class_level = cls;

    data.section = raw.section.toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(data.section)) errors.push('section must be 1 to 3 letters, e.g. A');

    data.roll_no = raw.roll_no || null;
    if (data.roll_no) {
      if (data.roll_no.length > 20) errors.push('roll_no is too long');
      const key = `${cls}|${data.section}|${data.roll_no}`;
      if (seenRoll.has(key)) errors.push(`roll_no already used in this class and section (row ${seenRoll.get(key)})`);
      else seenRoll.set(key, row);
      if (existingRoll.has(key)) errors.push('roll_no already used in this class and section');
    }

    data.admission_no = raw.admission_no || null;
    if (data.admission_no) {
      if (seenAdmission.has(data.admission_no)) errors.push(`admission_no repeats row ${seenAdmission.get(data.admission_no)}`);
      else seenAdmission.set(data.admission_no, row);
      if (existingAdmission.has(data.admission_no)) errors.push('admission_no already belongs to a student');
    }

    data.gender = raw.gender ? raw.gender.toLowerCase() : null;
    if (data.gender && !['male', 'female', 'other'].includes(data.gender)) errors.push('gender must be male, female or other');

    data.dob_ad = raw.dob_ad || null;
    if (data.dob_ad) {
      if (!isIsoDate(data.dob_ad)) errors.push('dob_ad must be YYYY-MM-DD');
      else if (data.dob_ad > today) errors.push('dob_ad cannot be in the future');
      else {
        const age = (Date.parse(today) - Date.parse(data.dob_ad)) / (365.25 * 86400000);
        if (age < 3 || age > 25) warnings.push(`date of birth gives age ${Math.floor(age)}; check it`);
      }
    }
    data.dob_bs = raw.dob_bs || null;
    if (data.dob_bs && !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(data.dob_bs)) errors.push('dob_bs must be YYYY-MM-DD in the Bikram Sambat calendar');

    data.blood_group = raw.blood_group ? raw.blood_group.toUpperCase() : null;
    if (data.blood_group && !BLOOD_GROUPS.includes(data.blood_group)) errors.push(`blood_group must be one of ${BLOOD_GROUPS.join(', ')}`);

    const phone = normalizePhone(raw.phone);
    if (!phone.ok) errors.push(`phone: ${phone.error}`); else data.phone = phone.value;
    const emPhone = normalizePhone(raw.emergency_contact_phone);
    if (!emPhone.ok) errors.push(`emergency_contact_phone: ${emPhone.error}`); else data.emergency_contact_phone = emPhone.value;

    data.address = raw.address || null;
    data.iemis_id = raw.iemis_id || null;
    data.neb_reg_no = raw.neb_reg_no || null;
    data.emergency_contact_name = raw.emergency_contact_name || null;

    // Guardian is optional, but if any guardian column is filled, the core fields are required.
    const hasGuardian = GUARDIAN_COLS.some(c => raw[c]);
    if (hasGuardian) {
      data.guardian_name = raw.guardian_name;
      if (data.guardian_name.length < 2) errors.push('guardian_name is required when a guardian is given');
      data.guardian_email = normalizeEmail(raw.guardian_email);
      if (!data.guardian_email) errors.push('guardian_email is required and must be valid (guardians sign in with it)');
      else if (data.guardian_email === data.email) errors.push('guardian_email cannot be the student\'s own email');
      data.guardian_relationship = (raw.guardian_relationship || 'guardian').toLowerCase();
      if (!GUARDIAN_RELATIONSHIPS.includes(data.guardian_relationship)) errors.push(`guardian_relationship must be one of ${GUARDIAN_RELATIONSHIPS.join(', ')}`);
      const gPhone = normalizePhone(raw.guardian_phone);
      if (!gPhone.ok) errors.push(`guardian_phone: ${gPhone.error}`); else data.guardian_phone = gPhone.value;

      if (data.guardian_email) {
        const existing = existingGuardian.get(data.guardian_email);
        if (existing === undefined && existingEmail.has(data.guardian_email)) {
          errors.push('guardian_email belongs to an account that is not a guardian');
        }
        const prior = guardianByEmail.get(data.guardian_email);
        if (prior && prior.name.toLowerCase() !== data.guardian_name.toLowerCase()) {
          warnings.push(`guardian name differs from row ${prior.row} for the same email; the first name is kept`);
        }
        if (!prior) guardianByEmail.set(data.guardian_email, { name: data.guardian_name, relationship: data.guardian_relationship, row });
        data.guardian_status = existing ? 'existing' : 'new';
        if (existing) warnings.push('guardian account already exists and will be linked');
      }
    }

    return { row, status: errors.length ? 'error' : 'ok', errors, warnings, data };
  });

  const summary = {
    total: rows.length,
    valid: rows.filter(r => r.status === 'ok').length,
    invalid: rows.filter(r => r.status === 'error').length,
    students_new: rows.filter(r => r.status === 'ok').length,
    guardians_new: [...guardianByEmail.keys()].filter(e => !existingGuardian.has(e)).length,
    guardians_existing: [...guardianByEmail.keys()].filter(e => existingGuardian.has(e)).length,
    links: rows.filter(r => r.status === 'ok' && r.data.guardian_email).length,
  };
  return { fileErrors: [], rows, summary };
}

function preview(req, res) {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'Send the CSV text in the csv field' });
  const report = validateImport(csv);
  if (report.fatal) return res.status(400).json({ error: report.fatal });
  res.json(report);
}

router.post('/preview', requireAuth, requireAdmin, preview);

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'Send the CSV text in the csv field' });
  const report = validateImport(csv);
  if (report.fatal) return res.status(400).json({ error: report.fatal });
  if (report.summary.invalid > 0) {
    return res.status(422).json({ error: `${report.summary.invalid} row(s) need fixing. Nothing was imported.`, ...report });
  }

  const setupLinks = [];
  const guardianIds = new Map();   // email -> id
  let linksCreated = 0;
  const roleId = guardianRoleId();
  // One placeholder hash for the whole import. Hashing per row would cost seconds per 100 students.
  const placeholder = unknownPasswordHash();
  const tx = db.transaction(() => {
    for (const { data } of report.rows) {
      const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, gender, avatar_color,
          approval_status, account_status, roll_no, admission_no, dob_ad, dob_bs, blood_group, phone, phone_verified, address,
          iemis_id, neb_reg_no, emergency_contact_name, emergency_contact_phone)
        VALUES (?,?,?,'student',?,?,?,'#6C5CE7','approved','active',?,?,?,?,?,?,0,?,?,?,?,?)`)
        .run(data.name, data.email, placeholder, data.class_level, data.section, data.gender,
          data.roll_no, data.admission_no, data.dob_ad, data.dob_bs, data.blood_group, data.phone,
          data.address, data.iemis_id, data.neb_reg_no, data.emergency_contact_name, data.emergency_contact_phone);
      const studentId = Number(info.lastInsertRowid);
      setupLinks.push({ role: 'student', name: data.name, email: data.email, setup_url: null, _uid: studentId });

      if (data.guardian_email) {
        let gid = guardianIds.get(data.guardian_email);
        if (!gid) {
          const existing = db.prepare("SELECT id FROM users WHERE email = ? AND role = 'guardian'").get(data.guardian_email);
          if (existing) {
            gid = existing.id;
          } else {
            const g = db.prepare(`INSERT INTO users (name, email, password_hash, role, avatar_color, approval_status, account_status, phone, phone_verified, role_id)
              VALUES (?, ?, ?, 'guardian', '#00B894', 'approved', 'active', ?, 0, ?)`)
              .run(data.guardian_name, data.guardian_email, placeholder, data.guardian_phone || null, roleId);
            gid = Number(g.lastInsertRowid);
            setupLinks.push({ role: 'guardian', name: data.guardian_name, email: data.guardian_email, setup_url: null, _uid: gid });
          }
          guardianIds.set(data.guardian_email, gid);
        }
        db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, relationship, can_view_attendance, created_by)
          VALUES (?, ?, ?, 1, ?)`).run(gid, studentId, data.guardian_relationship, req.user.id);
        linksCreated++;
      }
    }
    for (const link of setupLinks) {
      link.setup_url = `${process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/setup?token=${createSetupToken(link._uid, req.user.id)}`;
      delete link._uid;
    }
    logAudit(req, {
      module: 'users', action: 'imported',
      description: `${req.user.name} imported ${report.rows.length} student(s), ${guardianIds.size} guardian account(s), ${linksCreated} link(s)`,
      newValue: { students: report.rows.length, guardians: guardianIds.size, links: linksCreated },
    });
  });
  tx();
  res.status(201).json({
    created: { students: report.rows.length, guardians: guardianIds.size, links: linksCreated },
    setup_links: setupLinks,
    setup_expires_in_days: 7,
  });
});

export default router;
