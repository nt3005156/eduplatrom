// Guardian accounts and links.
//   /api/guardians/*         admin: create guardians, link children, set access flags
//   /api/guardian/*          guardian portal: read-only view of linked children
// Every write is audited. Each portal read goes through services/guardians.js.
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { invalidateUserRoleCache } from '../services/permissions.js';
import { normalizeEmail, normalizePhone, isIsoDate, GUARDIAN_RELATIONSHIPS } from '../utils/validate.js';
import { createSetupToken, unknownPasswordHash } from '../services/accountSetup.js';
import { accessibleLink, visibleChildren, attendanceTally, guardianRoleId } from '../services/guardians.js';

export const adminRouter = Router();
export const portalRouter = Router();

const FLAGS = ['is_primary', 'can_view_attendance', 'can_view_fees', 'can_view_results', 'can_pay_fees', 'can_pickup', 'restricted'];

function setupUrl(req, raw) {
  const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${origin}/setup?token=${raw}`;
}

function parseFlags(input = {}, base = {}) {
  const out = { ...base };
  for (const f of FLAGS) if (input[f] !== undefined) out[f] = input[f] ? 1 : 0;
  if (input.relationship !== undefined) {
    if (!GUARDIAN_RELATIONSHIPS.includes(input.relationship)) throw Object.assign(new Error(`relationship must be one of: ${GUARDIAN_RELATIONSHIPS.join(', ')}`), { status: 400 });
    out.relationship = input.relationship;
  }
  return out;
}

function studentOrThrow(studentId) {
  const id = Number(studentId);
  if (!Number.isInteger(id)) throw Object.assign(new Error('student_id must be a number'), { status: 400 });
  const s = db.prepare("SELECT id, name, class_level, section FROM users WHERE id = ? AND role = 'student' AND account_status != 'archived'").get(id);
  if (!s) throw Object.assign(new Error('Student not found'), { status: 404 });
  return s;
}

function guardianOr404(id) {
  const g = db.prepare("SELECT id, name, email, phone, phone_verified, account_status, created_at FROM users WHERE id = ? AND role = 'guardian'").get(Number(id));
  return g || null;
}

function linksFor(guardianId) {
  return db.prepare(`
    SELECT gs.id, gs.student_id, gs.relationship, gs.is_primary, gs.can_view_attendance, gs.can_view_fees, gs.can_view_results,
           gs.can_pay_fees, gs.can_pickup, gs.restricted, s.name AS student_name, s.class_level, s.section, s.roll_no
    FROM guardian_students gs JOIN users s ON s.id = gs.student_id
    WHERE gs.guardian_id = ? ORDER BY s.class_level, s.section, s.name`).all(guardianId);
}

function handle(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

// --- Admin -----------------------------------------------------------------

adminRouter.get('/student-search', requireAuth, requireAdmin, handle((req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`
    SELECT id, name, class_level, section, roll_no, admission_no FROM users
    WHERE role = 'student' AND account_status != 'archived' AND (name LIKE ? OR roll_no LIKE ? OR admission_no LIKE ?)
    ORDER BY class_level, section, name LIMIT 25`).all(q, q, q);
  res.json({ students: rows });
}));

adminRouter.get('/', requireAuth, requireAdmin, handle((req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.phone_verified, u.account_status, u.created_at,
           (SELECT COUNT(*) FROM guardian_students gs WHERE gs.guardian_id = u.id) AS children,
           EXISTS (SELECT 1 FROM account_setup_tokens t WHERE t.user_id = u.id AND t.used_at IS NULL AND t.expires_at > datetime('now')) AS setup_pending
    FROM users u WHERE u.role = 'guardian' ORDER BY u.name`).all();
  res.json({ guardians: rows });
}));

adminRouter.get('/:id', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  res.json({ guardian: g, links: linksFor(g.id) });
}));

// Creates the account, links the children and returns a one-time setup link. All in one transaction.
adminRouter.post('/', requireAuth, requireAdmin, handle((req, res) => {
  const { name, email: rawEmail, phone: rawPhone, student_links = [] } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'name is required' });
  const email = normalizeEmail(rawEmail);
  if (!email) return res.status(400).json({ error: 'A valid email is required (guardians sign in with it)' });
  const phone = normalizePhone(rawPhone);
  if (!phone.ok) return res.status(400).json({ error: phone.error });
  if (!Array.isArray(student_links)) return res.status(400).json({ error: 'student_links must be a list' });

  const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
  if (existing) {
    const msg = existing.role === 'guardian'
      ? 'A guardian with this email already exists. Open that guardian and add the children there.'
      : 'This email already belongs to another account.';
    return res.status(409).json({ error: msg, existing_id: existing.role === 'guardian' ? existing.id : undefined });
  }

  const plan = student_links.map(l => ({ student: studentOrThrow(l.student_id), flags: parseFlags(l, { relationship: l.relationship || 'guardian' }) }));

  let raw;
  let guardianId;
  db.transaction(() => {
    const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, avatar_color, approval_status, account_status, phone, phone_verified, role_id)
      VALUES (?, ?, ?, 'guardian', '#00B894', 'approved', 'active', ?, 0, ?)`)
      .run(String(name).trim(), email, unknownPasswordHash(), phone.value, guardianRoleId());
    guardianId = Number(info.lastInsertRowid);
    for (const { student, flags } of plan) {
      db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, can_view_results, can_pay_fees, can_pickup, restricted, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(guardianId, student.id, flags.relationship, flags.is_primary ?? 0, flags.can_view_attendance ?? 1, flags.can_view_fees ?? 0,
          flags.can_view_results ?? 1, flags.can_pay_fees ?? 0, flags.can_pickup ?? 0, flags.restricted ?? 0, req.user.id);
    }
    raw = createSetupToken(guardianId, req.user.id);
    logAudit(req, {
      module: 'guardians', action: 'created', description: `Created guardian ${name} with ${plan.length} linked child(ren)`,
      newValue: { guardian_id: guardianId, name, email, children: plan.map(p => p.student.id) },
    });
  })();
  invalidateUserRoleCache(guardianId);
  const guardian = guardianOr404(guardianId);
  res.status(201).json({ guardian, links: linksFor(guardianId), setup_url: setupUrl(req, raw), setup_expires_in_days: 7 });
}));

adminRouter.put('/:id', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : g.name;
  if (name.length < 2) return res.status(400).json({ error: 'name is required' });
  const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : { ok: true, value: g.phone };
  if (!phone.ok) return res.status(400).json({ error: phone.error });
  const changedPhone = phone.value !== g.phone;
  db.prepare('UPDATE users SET name = ?, phone = ?, phone_verified = ? WHERE id = ?')
    .run(name, phone.value, changedPhone ? 0 : g.phone_verified, g.id);
  logAudit(req, { module: 'guardians', action: 'updated', description: `Updated guardian ${name}`,
    previousValue: { name: g.name, phone: g.phone }, newValue: { name, phone: phone.value } });
  res.json({ guardian: guardianOr404(g.id), links: linksFor(g.id) });
}));

adminRouter.post('/:id/students', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  const student = studentOrThrow(req.body?.student_id);
  const flags = parseFlags(req.body, { relationship: req.body?.relationship || 'guardian' });
  const before = db.prepare('SELECT * FROM guardian_students WHERE guardian_id = ? AND student_id = ?').get(g.id, student.id);
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, can_view_results, can_pay_fees, can_pickup, restricted, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guardian_id, student_id) DO UPDATE SET relationship = excluded.relationship, is_primary = excluded.is_primary,
      can_view_attendance = excluded.can_view_attendance, can_view_fees = excluded.can_view_fees, can_view_results = excluded.can_view_results,
      can_pay_fees = excluded.can_pay_fees, can_pickup = excluded.can_pickup, restricted = excluded.restricted`)
    .run(g.id, student.id, flags.relationship, flags.is_primary ?? 0, flags.can_view_attendance ?? 1, flags.can_view_fees ?? 0,
      flags.can_view_results ?? 1, flags.can_pay_fees ?? 0, flags.can_pickup ?? 0, flags.restricted ?? 0, req.user.id);
  logAudit(req, { module: 'guardians', action: before ? 'updated' : 'linked',
    description: `${before ? 'Updated link to' : 'Linked'} ${student.name} for guardian ${g.name}`,
    previousValue: before || null, newValue: { guardian_id: g.id, student_id: student.id, ...flags } });
  res.json({ links: linksFor(g.id) });
}));

adminRouter.patch('/:id/students/:studentId', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  const before = db.prepare('SELECT * FROM guardian_students WHERE guardian_id = ? AND student_id = ?').get(g.id, Number(req.params.studentId));
  if (!before) return res.status(404).json({ error: 'This child is not linked to this guardian' });
  const flags = parseFlags(req.body, before);
  db.prepare(`UPDATE guardian_students SET relationship = ?, is_primary = ?, can_view_attendance = ?, can_view_fees = ?,
      can_view_results = ?, can_pay_fees = ?, can_pickup = ?, restricted = ? WHERE id = ?`)
    .run(flags.relationship, flags.is_primary, flags.can_view_attendance, flags.can_view_fees, flags.can_view_results ?? 1,
      flags.can_pay_fees, flags.can_pickup, flags.restricted, before.id);
  logAudit(req, { module: 'guardians', action: 'updated', description: `Changed access for guardian ${g.name} on student #${before.student_id}`,
    previousValue: before, newValue: flags });
  res.json({ links: linksFor(g.id) });
}));

// Takes effect on the next request: every portal read checks the link row.
adminRouter.delete('/:id/students/:studentId', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  const before = db.prepare('SELECT * FROM guardian_students WHERE guardian_id = ? AND student_id = ?').get(g.id, Number(req.params.studentId));
  if (!before) return res.status(404).json({ error: 'This child is not linked to this guardian' });
  db.prepare('DELETE FROM guardian_students WHERE id = ?').run(before.id);
  logAudit(req, { module: 'guardians', action: 'unlinked', description: `Unlinked student #${before.student_id} from guardian ${g.name}`,
    previousValue: before });
  res.json({ links: linksFor(g.id) });
}));

adminRouter.post('/:id/setup-link', requireAuth, requireAdmin, handle((req, res) => {
  const g = guardianOr404(req.params.id);
  if (!g) return res.status(404).json({ error: 'Guardian not found' });
  const raw = createSetupToken(g.id, req.user.id);
  logAudit(req, { module: 'guardians', action: 'updated', description: `Issued a new sign-in setup link for guardian ${g.name}` });
  res.json({ setup_url: setupUrl(req, raw), setup_expires_in_days: 7 });
}));

// --- Guardian portal -------------------------------------------------------

function requireGuardian(req, res, next) {
  if (req.user?.role !== 'guardian') return res.status(403).json({ error: 'Guardian accounts only' });
  next();
}

portalRouter.get('/children', requireAuth, requireGuardian, handle((req, res) => {
  const children = visibleChildren(req.user.id).map(c => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const t = c.can_view_attendance ? attendanceTally(c.student_id, from, to).daily : null;
    return {
      student_id: c.student_id, name: c.name, class_level: c.class_level, section: c.section, roll_no: c.roll_no,
      relationship: c.relationship, is_primary: !!c.is_primary, can_view_attendance: !!c.can_view_attendance,
      attendance_last_30_days: t ? { total: t.total, attendance_pct: t.attendance_pct } : null,
    };
  });
  res.json({ children });
}));

function childOr403(req, res, flag) {
  const link = accessibleLink(req.user.id, Number(req.params.studentId), flag);
  if (!link) {
    res.status(403).json({ error: 'You do not have access to this child\'s records' });
    return null;
  }
  return link;
}

portalRouter.get('/children/:studentId', requireAuth, requireGuardian, handle((req, res) => {
  const link = childOr403(req, res, null);
  if (!link) return;
  const s = db.prepare('SELECT id, name, class_level, section, roll_no, admission_no, avatar_color FROM users WHERE id = ?').get(link.student_id);
  res.json({ child: { ...s, relationship: link.relationship, can_view_attendance: !!link.can_view_attendance } });
}));

portalRouter.get('/children/:studentId/attendance', requireAuth, requireGuardian, handle((req, res) => {
  if (!childOr403(req, res, 'can_view_attendance')) return;
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates with from <= to' });
  res.json(attendanceTally(Number(req.params.studentId), from, to));
}));

portalRouter.get('/announcements', requireAuth, requireGuardian, handle((req, res) => {
  // School announcements are not child records, so any unrestricted child's class is enough.
  const classes = [...new Set(visibleChildren(req.user.id).map(c => c.class_level))];
  if (classes.length === 0) return res.json({ announcements: [] });
  const marks = classes.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, class_level, title, body, created_at FROM announcements
    WHERE class_level IN (${marks}) OR class_level IS NULL ORDER BY created_at DESC LIMIT 30`).all(...classes);
  res.json({ announcements: rows });
}));

portalRouter.get('/profile', requireAuth, requireGuardian, handle((req, res) => {
  const g = guardianOr404(req.user.id);
  res.json({ guardian: g });
}));
