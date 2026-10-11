import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin, requireStaff } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { resolveScope, allowedSubjectIdsForClass, allowedClassLevels } from '../services/scope.js';

const router = Router();

// GET /api/subjects/my-classes — the exact list of class levels this staff
// member is allowed to select anywhere in the app (assignment/quiz/content
// creation forms, filters). Unrestricted roles get every class 6-12; a
// scoped Subject/Class Teacher gets ONLY the classes they actually have a
// teacher_assignments row for — this is what prevents a teacher from even
// seeing "Class 12" as an option when they're only assigned to Class 10.
router.get('/my-classes', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.json({ classLevels: [req.user.class_level] });
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return res.json({ classLevels: null }); // null = every class is selectable
  res.json({ classLevels: allowedClassLevels(scope) });
});

// GET /api/subjects — all subjects across all classes, for global class/subject
// filter dropdowns (Assignments, Quizzes, Content, Reports, etc.)
// CRITICAL FIX: this used to return literally every subject in the school to
// any authenticated user, including staff — meaning a Math teacher for
// Class 10 saw English/Science/Computer/Nepali/etc in every subject
// dropdown throughout the app. Students still see everything for their OWN
// class (a student needs to see all their subjects), but staff now only
// ever see the subjects/classes actually assigned to them.
router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'student') {
    const subjects = db.prepare('SELECT * FROM subjects WHERE class_level = ? ORDER BY name').all(req.user.class_level);
    return res.json({ subjects });
  }

  const scope = resolveScope(req.user);
  if (scope.unrestricted) {
    const subjects = db.prepare('SELECT * FROM subjects ORDER BY class_level, name').all();
    return res.json({ subjects });
  }

  const classLevels = allowedClassLevels(scope);
  if (!classLevels || classLevels.length === 0) return res.json({ subjects: [] });

  const subjects = [];
  for (const cls of classLevels) {
    const allowedIds = allowedSubjectIdsForClass(scope, cls);
    if (allowedIds === null) {
      // Class Teacher homeroom grant — every subject in that class.
      subjects.push(...db.prepare('SELECT * FROM subjects WHERE class_level = ? ORDER BY name').all(cls));
    } else if (allowedIds.length > 0) {
      const placeholders = allowedIds.map(() => '?').join(',');
      subjects.push(...db.prepare(`SELECT * FROM subjects WHERE class_level = ? AND id IN (${placeholders}) ORDER BY name`).all(cls, ...allowedIds));
    }
  }
  res.json({ subjects });
});

router.get('/class/:cls', requireAuth, (req, res) => {
  const cls = Number(req.params.cls);
  let subjects;

  if (req.user.role === 'student') {
    subjects = db.prepare('SELECT * FROM subjects WHERE class_level = ? ORDER BY name').all(cls);
  } else {
    const scope = resolveScope(req.user);
    if (scope.unrestricted) {
      subjects = db.prepare('SELECT * FROM subjects WHERE class_level = ? ORDER BY name').all(cls);
    } else {
      const allowedIds = allowedSubjectIdsForClass(scope, cls);
      if (allowedIds === null) {
        subjects = db.prepare('SELECT * FROM subjects WHERE class_level = ? ORDER BY name').all(cls);
      } else if (allowedIds.length === 0) {
        subjects = [];
      } else {
        const placeholders = allowedIds.map(() => '?').join(',');
        subjects = db.prepare(`SELECT * FROM subjects WHERE class_level = ? AND id IN (${placeholders}) ORDER BY name`).all(cls, ...allowedIds);
      }
    }
  }

  const withCounts = subjects.map(s => {
    const materials = db.prepare('SELECT COUNT(*) c FROM materials WHERE subject_id = ?').get(s.id).c;
    const assignments = db.prepare('SELECT COUNT(*) c FROM assignments WHERE subject_id = ?').get(s.id).c;
    const quizzes = db.prepare('SELECT COUNT(*) c FROM quizzes WHERE subject_id = ?').get(s.id).c;
    return { ...s, materials_count: materials, assignments_count: assignments, quizzes_count: quizzes };
  });
  res.json({ subjects: withCounts });
});

// POST /api/subjects — create a brand-new subject for a class. This is a
// curriculum-structure decision (defining what subjects exist for a class),
// not a day-to-day content-creation action — restricted to Admin/Academic
// Head only. A Subject/Class Teacher is assigned to EXISTING subjects by an
// admin (via Teacher Management's Class/Section/Subject assignment) and
// should never see an "Add New Subject" option themselves; they only
// create/manage content (materials, assignments, quizzes) inside the
// subjects they're already assigned to.
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { class_level, name, description, icon, color } = req.body;
  if (!class_level || !name) return res.status(400).json({ error: 'class_level and name required' });

  const info = db.prepare('INSERT INTO subjects (class_level, name, description, icon, color) VALUES (?,?,?,?,?)')
    .run(Number(class_level), name, description || '', icon || 'BookOpen', color || '#6C5CE7');
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(info.lastInsertRowid);
  logAudit(req, { module: 'content', action: 'created', description: `${req.user.name} created subject "${name}" (Class ${class_level})`, newValue: { name, class_level } });
  res.json({ subject });
});

// PUT /api/subjects/:id — edit an existing subject's name/description/
// icon/color. Same curriculum-structure reasoning as POST above: Admin/
// Academic Head only, not a per-teacher content permission.
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, description, icon, color } = req.body;
  const existing = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Subject not found' });

  db.prepare('UPDATE subjects SET name=COALESCE(?,name), description=COALESCE(?,description), icon=COALESCE(?,icon), color=COALESCE(?,color) WHERE id=?')
    .run(name, description, icon, color, req.params.id);
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  logAudit(req, { module: 'content', action: 'updated', description: `${req.user.name} updated subject "${subject?.name || ''}"`, newValue: { name, description, icon, color } });
  res.json({ subject });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  if (subject) {
    logAudit(req, { module: 'content', action: 'deleted', description: `${req.user.name} deleted subject "${subject.name}" and all its content`, previousValue: { name: subject.name } });
  }
  res.json({ ok: true });
});

export default router;
