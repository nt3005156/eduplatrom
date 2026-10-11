import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { notifyClass, notifyUser } from '../utils/notify.js';
import { awardXp, touchStreak } from '../utils/gamification.js';
import { logAudit } from '../utils/audit.js';
import { resolveScope, isWithinScope, scopeWhereClause } from '../services/scope.js';

const router = Router();

/**
 * Blocks a staff request from touching a quiz outside their own assigned
 * class/subject. CRITICAL FIX: quizzes had exactly the same unscoped-access
 * bug as assignments — a Subject Teacher could list/create/edit/delete/grade
 * quizzes for any class/subject in the school. Quizzes have no `section`
 * column (class-wide only), unlike assignments.
 */
function assertQuizInScope(req, quiz) {
  if (req.user.role === 'admin') return null;
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return null;
  const inScope = isWithinScope(scope, { classLevel: quiz.class_level, subjectId: quiz.subject_id });
  return inScope ? null : { status: 403, error: 'This quiz is outside your assigned classes/subjects.' };
}

function assertQuizTargetInScope(req, { class_level, subject_id }) {
  if (req.user.role === 'admin') return null;
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return null;
  const inScope = isWithinScope(scope, { classLevel: class_level, subjectId: subject_id });
  return inScope ? null : { status: 403, error: 'You can only create quizzes for classes/subjects assigned to you.' };
}

const QUESTION_TYPES = [
  'mcq', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'essay',
  'matching', 'ordering', 'numerical', 'image', 'audio', 'video', 'code',
];
const MANUAL_GRADE_TYPES = new Set(['essay', 'short_answer', 'image', 'audio', 'video', 'code']);

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeQuestionForStorage(q) {
  const qtype = QUESTION_TYPES.includes(q.qtype) ? q.qtype : 'mcq';
  const needsManual = MANUAL_GRADE_TYPES.has(qtype) ? 1 : 0;

  // Legacy MCQ columns stay populated for qtype 'mcq' so old client code / old data keeps working.
  let option_a = null, option_b = null, option_c = null, option_d = null, correct_option = null;
  if (qtype === 'mcq' && q.option_a !== undefined) {
    option_a = q.option_a; option_b = q.option_b; option_c = q.option_c; option_d = q.option_d;
    correct_option = q.correct_option;
  }

  return {
    qtype,
    question: q.question,
    option_a, option_b, option_c, option_d, correct_option,
    options: JSON.stringify(q.options ?? null),
    correct_answer: JSON.stringify(q.correct_answer ?? (qtype === 'mcq' ? { option: q.correct_option } : null)),
    explanation: q.explanation || null,
    difficulty: q.difficulty || 'medium',
    points: q.points || 1,
    order_index: q.order_index || 0,
    needs_manual_grading: needsManual,
  };
}

function questionForStudent(q) {
  // Never leak the answer key to students before they submit.
  const { correct_option, correct_answer, ...rest } = q;
  return { ...rest, options: safeParse(q.options) };
}

function questionWithAnswer(q) {
  return { ...q, options: safeParse(q.options), correct_answer: safeParse(q.correct_answer) };
}

/** Auto-grade a single answer against a question. Returns { isCorrect, awardedPoints } or null if manual grading is required. */
function gradeAnswer(question, answer) {
  const points = question.points || 1;
  if (MANUAL_GRADE_TYPES.has(question.qtype)) return null; // needs a human

  if (question.qtype === 'mcq') {
    const correctOpt = question.correct_option || safeParse(question.correct_answer)?.option;
    const isCorrect = answer === correctOpt;
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'multiple_choice') {
    // multi-select: correct_answer = { options: ['a','c'] }; award full points only if the set matches exactly.
    const correct = new Set(safeParse(question.correct_answer)?.options || []);
    const given = new Set(Array.isArray(answer) ? answer : []);
    const isCorrect = correct.size === given.size && [...correct].every(o => given.has(o));
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'true_false') {
    const correctVal = safeParse(question.correct_answer)?.value;
    const isCorrect = String(answer) === String(correctVal);
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'fill_blank') {
    const accepted = (safeParse(question.correct_answer)?.answers || []).map(a => String(a).trim().toLowerCase());
    const isCorrect = accepted.includes(String(answer ?? '').trim().toLowerCase());
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'numerical') {
    const target = safeParse(question.correct_answer);
    const tol = target?.tolerance ?? 0;
    const val = Number(answer);
    const isCorrect = !Number.isNaN(val) && Math.abs(val - Number(target?.value)) <= tol;
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'matching') {
    const correctPairs = safeParse(question.correct_answer)?.pairs || [];
    const given = answer && typeof answer === 'object' ? answer : {};
    const isCorrect = correctPairs.length > 0 && correctPairs.every(([l, r]) => given[l] === r);
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  if (question.qtype === 'ordering') {
    const correctOrder = safeParse(question.correct_answer)?.order || [];
    const given = Array.isArray(answer) ? answer : [];
    const isCorrect = correctOrder.length > 0 && JSON.stringify(correctOrder) === JSON.stringify(given);
    return { isCorrect, awardedPoints: isCorrect ? points : 0 };
  }
  return { isCorrect: false, awardedPoints: 0 };
}

// --- Question Bank ---
// Named, reusable collections of questions (e.g. "Computer Basics",
// "Networking"). A teacher can create unlimited banks, each holding hundreds
// of questions, then generate a quiz by picking questions from one or more
// banks (with optional randomization) instead of retyping everything.

const QUESTION_BANK_QTYPES = [
  'mcq', 'true_false', 'short_answer', 'essay', 'fill_blank', 'matching', 'ordering', 'image', 'code',
];

function bankItemOut(i) {
  return { ...i, options: safeParse(i.options), correct_answer: safeParse(i.correct_answer) };
}

/**
 * A question bank with a NULL class_level/subject_id is a general-purpose
 * bank not tied to any specific class/subject (e.g. a cross-topic revision
 * bank) — those remain visible to every staff member, same as before. A
 * bank that DOES have a class_level/subject_id set is only visible to staff
 * whose scope actually covers that class+subject; System Admin/Academic
 * Head remain unrestricted as always.
 */
function assertBankInScope(req, bank) {
  if (!bank.class_level && !bank.subject_id) return null; // general-purpose bank, no owner subject
  if (req.user.role === 'admin') return null;
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return null;
  const inScope = isWithinScope(scope, { classLevel: bank.class_level, subjectId: bank.subject_id });
  return inScope ? null : { status: 403, error: 'This question bank belongs to a class/subject you are not assigned to.' };
}

// GET /api/quizzes/question-banks — list every named bank (with item counts),
// optionally scoped by subject/class so teachers see only relevant banks.
// CRITICAL FIX: previously returned every bank in the school to any staff
// member regardless of which subject it belonged to.
router.get('/question-banks', requireAuth, requireStaff, (req, res) => {
  const { subject_id, class_level, search } = req.query;
  const clauses = [];
  const params = [];
  if (subject_id) { clauses.push('qb.subject_id = ?'); params.push(subject_id); }
  if (class_level) { clauses.push('qb.class_level = ?'); params.push(class_level); }
  if (search) { clauses.push('qb.name LIKE ?'); params.push(`%${search}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const banks = db.prepare(`
    SELECT qb.*, s.name as subject_name, s.color as subject_color, u.name as created_by_name,
      (SELECT COUNT(*) FROM question_bank_items WHERE bank_id = qb.id) as question_count
    FROM question_banks qb
    LEFT JOIN subjects s ON qb.subject_id = s.id
    LEFT JOIN users u ON qb.created_by = u.id
    ${where}
    ORDER BY qb.updated_at DESC
  `).all(...params);

  const scope = resolveScope(req.user);
  const visible = scope.unrestricted ? banks : banks.filter(b => !assertBankInScope(req, b));
  res.json({ banks: visible });
});

router.get('/question-banks/:id', requireAuth, requireStaff, (req, res) => {
  const bank = db.prepare(`
    SELECT qb.*, s.name as subject_name, s.color as subject_color
    FROM question_banks qb LEFT JOIN subjects s ON qb.subject_id = s.id WHERE qb.id = ?
  `).get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeError = assertBankInScope(req, bank);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  res.json({ bank });
});

router.post('/question-banks', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const { name, description, subject_id, class_level } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'A bank name is required' });
  if (class_level && subject_id) {
    const scopeError = assertBankInScope(req, { class_level, subject_id });
    if (scopeError) return res.status(403).json({ error: 'You can only create a question bank for a class/subject assigned to you.' });
  }
  const info = db.prepare(`
    INSERT INTO question_banks (name, description, subject_id, class_level, created_by)
    VALUES (?,?,?,?,?)
  `).run(name.trim(), description || null, subject_id || null, class_level || null, req.user.id);
  logAudit(req, { module: 'quizzes', action: 'question_bank_created', description: `${req.user.name} created question bank "${name}"` });
  res.json({ bank: db.prepare('SELECT * FROM question_banks WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/question-banks/:id', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const { name, description, subject_id, class_level } = req.body;
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeError = assertBankInScope(req, bank);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare(`
    UPDATE question_banks SET name = COALESCE(?, name), description = COALESCE(?, description),
      subject_id = COALESCE(?, subject_id), class_level = COALESCE(?, class_level), updated_at = datetime('now')
    WHERE id = ?
  `).run(name || null, description, subject_id || null, class_level || null, bank.id);
  res.json({ bank: db.prepare('SELECT * FROM question_banks WHERE id = ?').get(bank.id) });
});

router.delete('/question-banks/:id', requireAuth, requireStaff, requirePermission('quiz.delete'), (req, res) => {
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeError = assertBankInScope(req, bank);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare('DELETE FROM question_banks WHERE id = ?').run(bank.id); // ON DELETE CASCADE removes its items
  logAudit(req, { module: 'quizzes', action: 'question_bank_deleted', description: `${req.user.name} deleted question bank "${bank.name}" and all its questions` });
  res.json({ ok: true });
});

// POST /api/quizzes/question-banks/:id/duplicate — clone a bank + all its
// questions, so a teacher can start a variant of an existing bank quickly.
router.post('/question-banks/:id/duplicate', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const original = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Question bank not found' });
  const scopeErrorDup = assertBankInScope(req, original);
  if (scopeErrorDup) return res.status(scopeErrorDup.status).json({ error: scopeErrorDup.error });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO question_banks (name, description, subject_id, class_level, created_by)
      VALUES (?,?,?,?,?)
    `).run(`${original.name} (Copy)`, original.description, original.subject_id, original.class_level, req.user.id);
    const newBankId = info.lastInsertRowid;
    const items = db.prepare('SELECT * FROM question_bank_items WHERE bank_id = ?').all(original.id);
    const insert = db.prepare(`
      INSERT INTO question_bank_items (bank_id, subject_id, class_level, topic, learning_outcome, qtype, question, options, correct_answer, explanation, media_url, difficulty, points, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const it of items) {
      insert.run(newBankId, it.subject_id, it.class_level, it.topic, it.learning_outcome, it.qtype, it.question, it.options, it.correct_answer, it.explanation, it.media_url, it.difficulty, it.points, req.user.id);
    }
    return newBankId;
  });
  const newBankId = tx();
  logAudit(req, { module: 'quizzes', action: 'question_bank_duplicated', description: `${req.user.name} duplicated question bank "${original.name}"` });
  res.json({ bank: db.prepare('SELECT * FROM question_banks WHERE id = ?').get(newBankId) });
});

// GET /api/quizzes/question-banks/:id/items — list/search/filter questions
// inside one bank (by topic/difficulty/qtype/learning outcome/free-text search).
router.get('/question-banks/:id/items', requireAuth, requireStaff, (req, res) => {
  const parentBank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!parentBank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeErrorItems = assertBankInScope(req, parentBank);
  if (scopeErrorItems) return res.status(scopeErrorItems.status).json({ error: scopeErrorItems.error });

  const { topic, difficulty, qtype, learning_outcome, search } = req.query;
  const clauses = ['bank_id = ?'];
  const params = [req.params.id];
  if (topic) { clauses.push('topic = ?'); params.push(topic); }
  if (difficulty) { clauses.push('difficulty = ?'); params.push(difficulty); }
  if (qtype) { clauses.push('qtype = ?'); params.push(qtype); }
  if (learning_outcome) { clauses.push('learning_outcome = ?'); params.push(learning_outcome); }
  if (search) { clauses.push('question LIKE ?'); params.push(`%${search}%`); }
  const items = db.prepare(`SELECT * FROM question_bank_items WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...params);
  res.json({ items: items.map(bankItemOut) });
});

router.post('/question-banks/:id/items', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeErrorAddItem = assertBankInScope(req, bank);
  if (scopeErrorAddItem) return res.status(scopeErrorAddItem.status).json({ error: scopeErrorAddItem.error });
  const { topic, learning_outcome, qtype, question, options, correct_answer, explanation, media_url, difficulty, points } = req.body;
  if (!question || !question.trim()) return res.status(400).json({ error: 'question text is required' });
  if (qtype && !QUESTION_BANK_QTYPES.includes(qtype)) return res.status(400).json({ error: `qtype must be one of: ${QUESTION_BANK_QTYPES.join(', ')}` });

  const info = db.prepare(`
    INSERT INTO question_bank_items (bank_id, subject_id, class_level, topic, learning_outcome, qtype, question, options, correct_answer, explanation, media_url, difficulty, points, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    bank.id, bank.subject_id, bank.class_level, topic || null, learning_outcome || null, qtype || 'mcq', question.trim(),
    JSON.stringify(options ?? null), JSON.stringify(correct_answer ?? null), explanation || null, media_url || null,
    difficulty || 'medium', points || 1, req.user.id
  );
  db.prepare("UPDATE question_banks SET updated_at = datetime('now') WHERE id = ?").run(bank.id);
  res.json({ item: bankItemOut(db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(info.lastInsertRowid)) });
});

router.put('/question-bank-items/:id', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const item = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Question not found' });
  const scopeErrorEditItem = assertBankInScope(req, item);
  if (scopeErrorEditItem) return res.status(scopeErrorEditItem.status).json({ error: scopeErrorEditItem.error });
  const { topic, learning_outcome, qtype, question, options, correct_answer, explanation, media_url, difficulty, points } = req.body;
  db.prepare(`
    UPDATE question_bank_items SET
      topic = COALESCE(?, topic), learning_outcome = COALESCE(?, learning_outcome), qtype = COALESCE(?, qtype),
      question = COALESCE(?, question), options = COALESCE(?, options), correct_answer = COALESCE(?, correct_answer),
      explanation = COALESCE(?, explanation), media_url = COALESCE(?, media_url), difficulty = COALESCE(?, difficulty),
      points = COALESCE(?, points)
    WHERE id = ?
  `).run(
    topic ?? null, learning_outcome ?? null, qtype ?? null, question ?? null,
    options !== undefined ? JSON.stringify(options) : null, correct_answer !== undefined ? JSON.stringify(correct_answer) : null,
    explanation ?? null, media_url ?? null, difficulty ?? null, points ?? null, item.id
  );
  res.json({ item: bankItemOut(db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(item.id)) });
});

router.delete('/question-bank-items/:id', requireAuth, requireStaff, requirePermission('quiz.delete'), (req, res) => {
  const item = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Question not found' });
  const scopeErrorDeleteItem = assertBankInScope(req, item);
  if (scopeErrorDeleteItem) return res.status(scopeErrorDeleteItem.status).json({ error: scopeErrorDeleteItem.error });
  db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(req.params.id);
  logAudit(req, { module: 'quizzes', action: 'question_bank_item_deleted', description: `${req.user.name} removed a question from a question bank` });
  res.json({ ok: true });
});

// POST /api/quizzes/question-banks/:id/import — bulk import via CSV text or
// pasted tab/pipe-delimited rows. Expected columns (header row required):
//   question, qtype, option_a, option_b, option_c, option_d, correct, explanation, topic, difficulty, points
// `correct` for mcq is the letter (a/b/c/d); for true_false is true/false;
// for short_answer/essay it's ignored (manually graded).
router.post('/question-banks/:id/import', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Question bank not found' });
  const scopeErrorImport = assertBankInScope(req, bank);
  if (scopeErrorImport) return res.status(scopeErrorImport.status).json({ error: scopeErrorImport.error });
  const { text, delimiter } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Paste CSV/TSV text or upload a CSV file' });

  const sep = delimiter || (text.includes('\t') ? '\t' : ',');
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return res.status(400).json({ error: 'Need a header row plus at least one question row' });

  // Simple CSV/TSV line splitter that respects double-quoted fields containing the delimiter.
  function splitLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === sep && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  const header = splitLine(lines[0]).map(h => h.toLowerCase());
  const required = ['question'];
  const missing = required.filter(r => !header.includes(r));
  if (missing.length) return res.status(400).json({ error: `Missing required column(s): ${missing.join(', ')}` });

  const rows = lines.slice(1).map(splitLine);
  const insert = db.prepare(`
    INSERT INTO question_bank_items (bank_id, subject_id, class_level, topic, qtype, question, options, correct_answer, explanation, difficulty, points, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let imported = 0;
  const errors = [];
  const tx = db.transaction(() => {
    rows.forEach((cols, idx) => {
      const get = (col) => { const i = header.indexOf(col); return i >= 0 ? cols[i] : ''; };
      const questionText = get('question');
      if (!questionText) { errors.push(`Row ${idx + 2}: missing question text — skipped`); return; }

      let qtype = (get('qtype') || 'mcq').toLowerCase();
      if (!QUESTION_BANK_QTYPES.includes(qtype)) qtype = 'mcq';

      let options = null, correct_answer = null;
      if (qtype === 'mcq') {
        const opts = [get('option_a'), get('option_b'), get('option_c'), get('option_d')].filter(Boolean);
        options = opts.length ? opts : null;
        const correctLetter = (get('correct') || '').trim().toLowerCase();
        const letterIndex = { a: 0, b: 1, c: 2, d: 3 }[correctLetter];
        correct_answer = letterIndex !== undefined && opts[letterIndex] ? { option: opts[letterIndex] } : null;
      } else if (qtype === 'true_false') {
        correct_answer = { value: /^true$/i.test(get('correct')) };
      } else if (qtype === 'fill_blank') {
        correct_answer = { answers: (get('correct') || '').split('|').map(s => s.trim()).filter(Boolean) };
      }

      insert.run(
        bank.id, bank.subject_id, bank.class_level, get('topic') || null, qtype, questionText,
        JSON.stringify(options), JSON.stringify(correct_answer), get('explanation') || null,
        get('difficulty') || 'medium', Number(get('points')) || 1, req.user.id
      );
      imported++;
    });
  });
  tx();
  db.prepare("UPDATE question_banks SET updated_at = datetime('now') WHERE id = ?").run(bank.id);

  logAudit(req, { module: 'quizzes', action: 'question_bank_imported', description: `${req.user.name} imported ${imported} question(s) into "${bank.name}"` });
  res.json({ imported, errors });
});

// Legacy flat endpoints kept for back-compat with any existing unfiled
// (bank_id = NULL) questions from before named banks existed.
router.get('/question-bank', requireAuth, requireStaff, (req, res) => {
  const { subject_id, class_level, topic, qtype } = req.query;
  const clauses = [];
  const params = [];
  if (subject_id) { clauses.push('subject_id = ?'); params.push(subject_id); }
  if (class_level) { clauses.push('class_level = ?'); params.push(class_level); }
  if (topic) { clauses.push('topic = ?'); params.push(topic); }
  if (qtype) { clauses.push('qtype = ?'); params.push(qtype); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const items = db.prepare(`SELECT * FROM question_bank_items ${where} ORDER BY created_at DESC`).all(...params);
  res.json({ items: items.map(i => ({ ...i, options: safeParse(i.options), correct_answer: safeParse(i.correct_answer) })) });
});

router.post('/question-bank', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const { subject_id, class_level, topic, qtype, question, options, correct_answer, explanation, difficulty, points } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });
  const info = db.prepare(`
    INSERT INTO question_bank_items (subject_id, class_level, topic, qtype, question, options, correct_answer, explanation, difficulty, points, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    subject_id || null, class_level || null, topic || null, qtype || 'mcq', question,
    JSON.stringify(options ?? null), JSON.stringify(correct_answer ?? null), explanation || null,
    difficulty || 'medium', points || 1, req.user.id
  );
  logAudit(req, { module: 'quizzes', action: 'question_bank_created', description: `${req.user.name} added a question to the bank` });
  res.json({ item: db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/question-bank/:id', requireAuth, requireStaff, requirePermission('quiz.delete'), (req, res) => {
  db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(req.params.id);
  logAudit(req, { module: 'quizzes', action: 'question_bank_deleted', description: `${req.user.name} removed a question bank item` });
  res.json({ ok: true });
});

// POST /api/quizzes/generate-from-bank — "Question Bank -> Select Questions
// -> Generate Quiz" flow. Accepts either explicit item_ids, or a random-pick
// spec ({ bank_id, count, difficulty }), builds real quiz_questions rows from
// the selected bank items (tracking provenance via source_bank_item_id), and
// creates the quiz in one step.
router.post('/generate-from-bank', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const {
    subject_id, class_level, title, description, topic, time_limit_min, status,
    item_ids, random_pick, shuffle_questions, shuffle_answers, max_attempts, passing_pct,
  } = req.body;
  if (!subject_id || !class_level || !title) return res.status(400).json({ error: 'subject_id, class_level, title required' });

  const targetScopeError = assertQuizTargetInScope(req, { class_level, subject_id });
  if (targetScopeError) return res.status(targetScopeError.status).json({ error: targetScopeError.error });

  let selected = [];
  if (Array.isArray(item_ids) && item_ids.length) {
    const placeholders = item_ids.map(() => '?').join(',');
    selected = db.prepare(`SELECT * FROM question_bank_items WHERE id IN (${placeholders})`).all(...item_ids);
    // Every selected item must itself be from a bank/subject in scope — a
    // teacher can't pick items out of someone else's bank by id even if
    // they never listed it.
    const outOfScope = selected.find(it => assertBankInScope(req, it));
    if (outOfScope) return res.status(403).json({ error: 'One or more selected questions belong to a subject you are not assigned to.' });
  } else if (random_pick?.bank_id) {
    const parentBank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(random_pick.bank_id);
    if (!parentBank) return res.status(404).json({ error: 'Question bank not found' });
    const bankScopeError = assertBankInScope(req, parentBank);
    if (bankScopeError) return res.status(bankScopeError.status).json({ error: bankScopeError.error });

    const clauses = ['bank_id = ?'];
    const params = [random_pick.bank_id];
    if (random_pick.difficulty) { clauses.push('difficulty = ?'); params.push(random_pick.difficulty); }
    const pool = db.prepare(`SELECT * FROM question_bank_items WHERE ${clauses.join(' AND ')}`).all(...params);
    selected = shuffle(pool).slice(0, random_pick.count || pool.length);
  }
  if (!selected.length) return res.status(400).json({ error: 'No questions selected — provide item_ids or a random_pick spec' });

  const finalStatus = ['draft', 'published', 'archived'].includes(status) ? status : 'published';
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO quizzes (
        subject_id, class_level, title, description, topic, time_limit_min, status, shuffle_questions,
        shuffle_answers, max_attempts, grading_strategy, auto_grade, show_review, passing_pct, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,'highest',1,1,?,?)
    `).run(
      subject_id, class_level, title, description || '', topic || null, time_limit_min || 10, finalStatus,
      shuffle_questions ? 1 : 0, shuffle_answers ? 1 : 0, max_attempts ?? 1, passing_pct ?? 40, req.user.id
    );
    const quizId = info.lastInsertRowid;
    const qInsert = db.prepare(`
      INSERT INTO quiz_questions (quiz_id, qtype, question, options, correct_answer, explanation, media_url, difficulty, points, order_index, needs_manual_grading, source_bank_item_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    selected.forEach((item, idx) => {
      const needsManual = MANUAL_GRADE_TYPES.has(item.qtype) ? 1 : 0;
      qInsert.run(quizId, item.qtype, item.question, item.options, item.correct_answer, item.explanation, item.media_url, item.difficulty, item.points, idx, needsManual, item.id);
    });
    return quizId;
  });
  const quizId = tx();
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);

  if (finalStatus === 'published') {
    const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subject_id);
    notifyClass({
      class_level: Number(class_level), type: 'quiz', title: `New quiz: ${title}`,
      body: `${subject?.name || 'Subject'}${topic ? ` • ${topic}` : ''}`, link: '/quizzes', related_id: quizId,
    });
  }

  logAudit(req, {
    module: 'quizzes', action: 'created',
    description: `${req.user.name} generated quiz "${title}" from a question bank (${selected.length} questions)`,
    newValue: { title, subject_id, class_level, question_count: selected.length, status: finalStatus },
  });

  res.json({ quiz, question_count: selected.length });
});


// --- Quizzes ---

// GET /api/quizzes — cross-class listing for staff, honoring the global
// class/subject filter pattern (omit class_level/subject_id for "All Classes"/"All Subjects").
// CRITICAL FIX: previously returned every quiz school-wide to any staff
// member regardless of their actual class/subject assignments.
router.get('/', requireAuth, requireStaff, (req, res) => {
  const { class_level, subject_id, status } = req.query;
  const clauses = [];
  const params = [];
  if (class_level) { clauses.push('q.class_level = ?'); params.push(class_level); }
  if (subject_id) { clauses.push('q.subject_id = ?'); params.push(subject_id); }
  if (status) { clauses.push('q.status = ?'); params.push(status); }

  const scope = resolveScope(req.user);
  const scopeClause = scopeWhereClause(scope, { classLevel: 'q.class_level', section: null, subjectId: 'q.subject_id' });
  clauses.push(scopeClause.sql);
  params.push(...scopeClause.params);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const quizzes = db.prepare(`
    SELECT q.*, s.name as subject_name, s.color as subject_color,
      (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) as question_count
    FROM quizzes q JOIN subjects s ON q.subject_id = s.id
    ${where} ORDER BY q.created_at DESC
  `).all(...params);
  res.json({ quizzes });
});

router.get('/class/:cls', requireAuth, (req, res) => {
  let quizzes = db.prepare(`
    SELECT q.*, s.name as subject_name, s.color as subject_color,
      (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) as question_count
    FROM quizzes q JOIN subjects s ON q.subject_id = s.id
    WHERE q.class_level = ? ORDER BY q.created_at DESC
  `).all(req.params.cls);

  if (req.user.role === 'student') {
    quizzes = quizzes.filter(q => q.status === 'published');
    const withAttempts = quizzes.map(q => {
      const best = db.prepare('SELECT MAX(score) as best_score, total FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND status != ?').get(q.id, req.user.id, 'in_progress');
      const attempts = db.prepare("SELECT COUNT(*) c FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND status != 'in_progress'").get(q.id, req.user.id).c;
      const inProgress = db.prepare("SELECT id FROM quiz_attempts WHERE quiz_id=? AND student_id=? AND status = 'in_progress'").get(q.id, req.user.id);
      return { ...q, best_score: best?.best_score ?? null, total: best?.total ?? null, attempts, canResume: !!inProgress, attemptsRemaining: q.max_attempts ? Math.max(0, q.max_attempts - attempts) : null };
    });
    return res.json({ quizzes: withAttempts });
  }

  // Staff branch: scoped too, so a direct API call can't bypass the
  // class/subject restriction the UI already enforces.
  const scope = resolveScope(req.user);
  if (!scope.unrestricted) {
    quizzes = quizzes.filter(q => isWithinScope(scope, { classLevel: q.class_level, subjectId: q.subject_id }));
  }
  res.json({ quizzes });
});

router.get('/:id', requireAuth, (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (req.user.role === 'student' && quiz.status !== 'published') return res.status(404).json({ error: 'Quiz not found' });

  let questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC, id ASC').all(req.params.id);

  if (req.user.role !== 'student') {
    const scopeError = assertQuizInScope(req, quiz);
    if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
    return res.json({ quiz, questions: questions.map(questionWithAnswer) });
  }

  // Student-facing: check for an in-progress attempt to resume (autosave/resume).
  const inProgress = db.prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status = 'in_progress'").get(req.params.id, req.user.id);

  // Randomize question count (question pools / random subset) if configured.
  if (quiz.randomize_count && quiz.randomize_count < questions.length && !inProgress) {
    questions = shuffle(questions).slice(0, quiz.randomize_count);
  }
  if (quiz.shuffle_questions && !inProgress) {
    questions = shuffle(questions);
  }
  let studentQuestions = questions.map(questionForStudent);
  if (quiz.shuffle_answers) {
    studentQuestions = studentQuestions.map(q => {
      if ((q.qtype === 'mcq' || q.qtype === 'multiple_choice') && Array.isArray(q.options)) {
        return { ...q, options: shuffle(q.options) };
      }
      return q;
    });
  }

  res.json({
    quiz, questions: studentQuestions,
    resumeAttempt: inProgress ? { id: inProgress.id, autosave_state: safeParse(inProgress.autosave_state, {}), started_at: inProgress.started_at } : null,
  });
});

router.post('/', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const {
    subject_id, class_level, title, description, topic, time_limit_min, questions, status,
    shuffle_questions, shuffle_answers, max_attempts, grading_strategy, auto_grade, show_review,
    randomize_count, passing_pct,
  } = req.body;
  if (!subject_id || !class_level || !title) return res.status(400).json({ error: 'subject_id, class_level, title required' });

  const scopeError = assertQuizTargetInScope(req, { class_level, subject_id });
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const finalStatus = ['draft', 'published', 'archived'].includes(status) ? status : 'published';

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO quizzes (
        subject_id, class_level, title, description, topic, time_limit_min, status, shuffle_questions,
        shuffle_answers, max_attempts, grading_strategy, auto_grade, show_review, randomize_count, passing_pct, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      subject_id, class_level, title, description || '', topic || null, time_limit_min || 10, finalStatus,
      shuffle_questions ? 1 : 0, shuffle_answers ? 1 : 0, max_attempts ?? 1, grading_strategy || 'highest',
      auto_grade === undefined ? 1 : (auto_grade ? 1 : 0), show_review === undefined ? 1 : (show_review ? 1 : 0),
      randomize_count || null, passing_pct ?? 40, req.user.id
    );
    const quizId = info.lastInsertRowid;
    if (Array.isArray(questions)) {
      const qInsert = db.prepare(`
        INSERT INTO quiz_questions (quiz_id, qtype, question, option_a, option_b, option_c, option_d, correct_option, options, correct_answer, explanation, difficulty, points, order_index, needs_manual_grading)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      questions.forEach((q, idx) => {
        const n = normalizeQuestionForStorage(q);
        qInsert.run(quizId, n.qtype, n.question, n.option_a, n.option_b, n.option_c, n.option_d, n.correct_option, n.options, n.correct_answer, n.explanation, n.difficulty, n.points, idx, n.needs_manual_grading);
      });
    }
    return quizId;
  });
  const quizId = tx();
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);

  const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subject_id);
  if (finalStatus === 'published') {
    notifyClass({
      class_level: Number(class_level),
      type: 'quiz',
      title: `New quiz: ${title}`,
      body: `${subject?.name || 'Subject'}${topic ? ` • ${topic}` : ''}`,
      link: '/quizzes',
      related_id: quizId,
    });
  }

  logAudit(req, {
    module: 'quizzes', action: 'created',
    description: `${req.user.name} created quiz "${title}" (Class ${class_level}, ${subject?.name || 'subject'}) as ${finalStatus}`,
    newValue: { title, subject_id, class_level, question_count: questions?.length || 0, status: finalStatus },
  });

  res.json({ quiz });
});

router.put('/:id', requireAuth, requireStaff, requirePermission('quiz.publish'), (req, res) => {
  const existing = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quiz not found' });
  let scopeError = assertQuizInScope(req, existing);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  // If the request would move this quiz to a different class/subject, that
  // target must ALSO be in scope — same "reassignment" protection as assignments.
  const targetClass = req.body.class_level !== undefined ? req.body.class_level : existing.class_level;
  const targetSubject = req.body.subject_id !== undefined ? req.body.subject_id : existing.subject_id;
  scopeError = assertQuizTargetInScope(req, { class_level: targetClass, subject_id: targetSubject });
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const fields = [
    'title', 'description', 'topic', 'time_limit_min', 'status', 'shuffle_questions', 'shuffle_answers',
    'max_attempts', 'grading_strategy', 'auto_grade', 'show_review', 'randomize_count', 'passing_pct',
  ];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  const tx = db.transaction(() => {
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    if (setClause) {
      db.prepare(`UPDATE quizzes SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(updates), req.params.id);
    }
    if (Array.isArray(req.body.questions)) {
      db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(req.params.id);
      const qInsert = db.prepare(`
        INSERT INTO quiz_questions (quiz_id, qtype, question, option_a, option_b, option_c, option_d, correct_option, options, correct_answer, explanation, difficulty, points, order_index, needs_manual_grading)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      req.body.questions.forEach((q, idx) => {
        const n = normalizeQuestionForStorage(q);
        qInsert.run(req.params.id, n.qtype, n.question, n.option_a, n.option_b, n.option_c, n.option_d, n.correct_option, n.options, n.correct_answer, n.explanation, n.difficulty, n.points, idx, n.needs_manual_grading);
      });
    }
  });
  tx();

  const wasDraft = existing.status === 'draft';
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (wasDraft && quiz.status === 'published') {
    const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(quiz.subject_id);
    notifyClass({
      class_level: quiz.class_level, type: 'quiz', title: `New quiz: ${quiz.title}`,
      body: `${subject?.name || 'Subject'}${quiz.topic ? ` • ${quiz.topic}` : ''}`, link: '/quizzes', related_id: quiz.id,
    });
  }

  logAudit(req, { module: 'quizzes', action: 'edited', description: `${req.user.name} edited quiz "${quiz.title}"` });
  res.json({ quiz });
});

router.put('/:id/archive', requireAuth, requireStaff, requirePermission('quiz.publish'), (req, res) => {
  const existing = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Quiz not found' });
  const scopeError = assertQuizInScope(req, existing);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare("UPDATE quizzes SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req, { module: 'quizzes', action: 'archived', description: `${req.user.name} archived quiz "${existing.title}"` });
  res.json({ ok: true });
});

router.post('/:id/duplicate', requireAuth, requireStaff, requirePermission('quiz.create'), (req, res) => {
  const original = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Quiz not found' });
  const scopeError = assertQuizInScope(req, original);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO quizzes (subject_id, class_level, title, description, topic, time_limit_min, status, shuffle_questions,
        shuffle_answers, max_attempts, grading_strategy, auto_grade, show_review, randomize_count, passing_pct, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      original.subject_id, original.class_level, `${original.title} (Copy)`, original.description, original.topic,
      original.time_limit_min, 'draft', original.shuffle_questions, original.shuffle_answers, original.max_attempts,
      original.grading_strategy, original.auto_grade, original.show_review, original.randomize_count, original.passing_pct, req.user.id
    );
    const newId = info.lastInsertRowid;
    const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ?').all(original.id);
    const qInsert = db.prepare(`
      INSERT INTO quiz_questions (quiz_id, qtype, question, option_a, option_b, option_c, option_d, correct_option, options, correct_answer, explanation, difficulty, points, order_index, needs_manual_grading)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const q of questions) {
      qInsert.run(newId, q.qtype, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.options, q.correct_answer, q.explanation, q.difficulty, q.points, q.order_index, q.needs_manual_grading);
    }
    return newId;
  });
  const newId = tx();

  logAudit(req, { module: 'quizzes', action: 'duplicated', description: `${req.user.name} duplicated quiz "${original.title}"` });
  res.json({ quiz: db.prepare('SELECT * FROM quizzes WHERE id = ?').get(newId) });
});

router.delete('/:id', requireAuth, requireStaff, requirePermission('quiz.delete'), (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const scopeError = assertQuizInScope(req, quiz);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);
  logAudit(req, {
    module: 'quizzes', action: 'deleted',
    description: `${req.user.name} deleted quiz "${quiz.title}"`,
    previousValue: { title: quiz.title },
  });
  res.json({ ok: true });
});

// --- Attempts: auto-save, resume, submit, manual grading ---

// Auto-save progress for an in-progress attempt (called periodically by the client).
router.post('/:id/autosave', requireAuth, (req, res) => {
  const { answers, attemptId } = req.body;
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  let attempt = attemptId ? db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND student_id = ?').get(attemptId, req.user.id) : null;
  if (!attempt) {
    attempt = db.prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status = 'in_progress'").get(req.params.id, req.user.id);
  }
  if (!attempt) {
    const info = db.prepare(`
      INSERT INTO quiz_attempts (quiz_id, student_id, status, autosave_state, score, total)
      VALUES (?,?, 'in_progress', ?, 0, 0)
    `).run(req.params.id, req.user.id, JSON.stringify(answers || {}));
    return res.json({ attemptId: info.lastInsertRowid, saved: true });
  }
  db.prepare('UPDATE quiz_attempts SET autosave_state = ? WHERE id = ?').run(JSON.stringify(answers || {}), attempt.id);
  res.json({ attemptId: attempt.id, saved: true });
});

// Student submits final answers: { answers: { questionId: answerValue }, attemptId?, timeTakenSec? }
router.post('/:id/submit', requireAuth, (req, res) => {
  const { answers, attemptId, timeTakenSec, autoSubmitted } = req.body;
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const priorAttempts = db.prepare("SELECT COUNT(*) c FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status != 'in_progress'").get(req.params.id, req.user.id).c;
  if (quiz.max_attempts && priorAttempts >= quiz.max_attempts) {
    return res.status(400).json({ error: `Maximum attempts (${quiz.max_attempts}) reached for this quiz.` });
  }

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ?').all(req.params.id);
  let score = 0;
  let total = 0;
  let needsManualGrading = false;
  const detail = [];

  for (const q of questions) {
    total += q.points;
    const given = answers?.[q.id];
    const result = gradeAnswer(q, given);
    if (result === null) {
      needsManualGrading = true;
      detail.push({ question_id: q.id, qtype: q.qtype, given, pendingManualGrade: true });
    } else {
      score += result.awardedPoints;
      detail.push({ question_id: q.id, qtype: q.qtype, given, isCorrect: result.isCorrect, awardedPoints: result.awardedPoints, points: q.points });
    }
  }

  // Reuse the in-progress attempt row (from autosave) if one exists, else create fresh.
  let attempt = attemptId ? db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND student_id = ?').get(attemptId, req.user.id) : null;
  if (!attempt) attempt = db.prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status = 'in_progress'").get(req.params.id, req.user.id);

  const attemptNumber = priorAttempts + 1;
  const status = autoSubmitted ? 'auto_submitted' : 'completed';

  let attemptId_;
  if (attempt) {
    db.prepare(`
      UPDATE quiz_attempts SET score=?, total=?, answers=?, status=?, attempt_number=?, time_taken_sec=?, needs_manual_grading=?, attempted_at=datetime('now')
      WHERE id = ?
    `).run(score, total, JSON.stringify(answers || {}), status, attemptNumber, timeTakenSec || null, needsManualGrading ? 1 : 0, attempt.id);
    attemptId_ = attempt.id;
  } else {
    const info = db.prepare(`
      INSERT INTO quiz_attempts (quiz_id, student_id, attempt_number, score, total, answers, status, time_taken_sec, needs_manual_grading)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(req.params.id, req.user.id, attemptNumber, score, total, JSON.stringify(answers || {}), status, timeTakenSec || null, needsManualGrading ? 1 : 0);
    attemptId_ = info.lastInsertRowid;
  }

  // Persist per-question answer rows for manual grading + detailed analytics.
  db.prepare('DELETE FROM quiz_attempt_answers WHERE attempt_id = ?').run(attemptId_);
  const insertAns = db.prepare('INSERT INTO quiz_attempt_answers (attempt_id, question_id, answer, is_correct, awarded_points) VALUES (?,?,?,?,?)');
  for (const d of detail) {
    insertAns.run(attemptId_, d.question_id, JSON.stringify(d.given ?? null), d.pendingManualGrade ? null : (d.isCorrect ? 1 : 0), d.awardedPoints || 0);
  }

  const streak = touchStreak(req.user.id);
  const isPerfect = total > 0 && score === total && !needsManualGrading;
  let xpResult = awardXp(req.user.id, 'quiz_attempt', 'quiz', req.params.id);
  if (isPerfect) {
    const bonus = awardXp(req.user.id, 'quiz_perfect_bonus', 'quiz', req.params.id);
    if (bonus && xpResult) {
      xpResult = { xpAwarded: xpResult.xpAwarded + bonus.xpAwarded, totalXp: bonus.totalXp, leveledUp: xpResult.leveledUp || bonus.leveledUp, level: bonus.level };
    }
  }

  logAudit(req, {
    module: 'quizzes', action: autoSubmitted ? 'auto_submitted' : 'attempt_completed',
    description: `${req.user.name} ${autoSubmitted ? 'was auto-submitted for' : 'completed'} quiz "${quiz?.title || ''}" — scored ${score}/${total}`,
    metadata: { quiz_id: req.params.id, score, total, needsManualGrading },
  });

  res.json({ score, total, detail, xp: xpResult, streak, needsManualGrading, attemptId: attemptId_ });
});

// Student: review a completed attempt (with correct answers, if quiz allows review mode)
router.get('/attempts/:attemptId/review', requireAuth, (req, res) => {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (req.user.role === 'student' && attempt.student_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(attempt.quiz_id);
  if (req.user.role === 'student' && !quiz.show_review) return res.status(403).json({ error: 'Review mode is disabled for this quiz' });

  const answers = db.prepare(`
    SELECT qaa.*, qq.question, qq.qtype, qq.options, qq.correct_answer, qq.explanation, qq.points
    FROM quiz_attempt_answers qaa JOIN quiz_questions qq ON qaa.question_id = qq.id
    WHERE qaa.attempt_id = ?
  `).all(req.params.attemptId).map(a => ({ ...a, answer: safeParse(a.answer), options: safeParse(a.options), correct_answer: safeParse(a.correct_answer) }));

  res.json({ attempt, answers });
});

// --- Manual grading (essay / short answer / media types) ---

router.get('/:id/pending-manual-grading', requireAuth, requireStaff, (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const scopeError = assertQuizInScope(req, quiz);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  const attempts = db.prepare(`
    SELECT qa.*, u.name as student_name
    FROM quiz_attempts qa JOIN users u ON qa.student_id = u.id
    WHERE qa.quiz_id = ? AND qa.needs_manual_grading = 1 AND qa.manually_graded = 0
    ORDER BY qa.attempted_at ASC
  `).all(req.params.id);
  res.json({ attempts });
});

/** Resolves attempt -> quiz and scope-checks it, for the two endpoints below
 * that operate on a single attempt/answer rather than a quiz id directly. */
function loadAttemptQuizInScope(req, attemptId) {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attemptId);
  if (!attempt) return { error: { status: 404, error: 'Attempt not found' } };
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(attempt.quiz_id);
  if (!quiz) return { error: { status: 404, error: 'Quiz not found' } };
  const scopeError = assertQuizInScope(req, quiz);
  if (scopeError) return { error: scopeError };
  return { attempt, quiz };
}

router.get('/attempts/:attemptId/answers', requireAuth, requireStaff, (req, res) => {
  const scoped = loadAttemptQuizInScope(req, req.params.attemptId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  const answers = db.prepare(`
    SELECT qaa.*, qq.question, qq.qtype, qq.points, qq.correct_answer
    FROM quiz_attempt_answers qaa JOIN quiz_questions qq ON qaa.question_id = qq.id
    WHERE qaa.attempt_id = ?
  `).all(req.params.attemptId).map(a => ({ ...a, answer: safeParse(a.answer), correct_answer: safeParse(a.correct_answer) }));
  res.json({ answers });
});

router.put('/attempt-answers/:id/grade', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const { awarded_points, manual_feedback } = req.body;
  const answer = db.prepare('SELECT * FROM quiz_attempt_answers WHERE id = ?').get(req.params.id);
  if (!answer) return res.status(404).json({ error: 'Answer not found' });
  const scoped = loadAttemptQuizInScope(req, answer.attempt_id);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });

  db.prepare(`
    UPDATE quiz_attempt_answers SET awarded_points = ?, manual_feedback = ?, graded_by = ?, graded_at = datetime('now'), is_correct = ?
    WHERE id = ?
  `).run(Number(awarded_points) || 0, manual_feedback || null, req.user.id, Number(awarded_points) > 0 ? 1 : 0, req.params.id);

  // Recompute the attempt's total score from all its answer rows.
  const allAnswers = db.prepare('SELECT awarded_points FROM quiz_attempt_answers WHERE attempt_id = ?').all(answer.attempt_id);
  const newScore = allAnswers.reduce((sum, a) => sum + (a.awarded_points || 0), 0);
  const stillPending = db.prepare('SELECT COUNT(*) c FROM quiz_attempt_answers WHERE attempt_id = ? AND is_correct IS NULL').get(answer.attempt_id).c;

  db.prepare('UPDATE quiz_attempts SET score = ?, manually_graded = ? WHERE id = ?')
    .run(newScore, stillPending === 0 ? 1 : 0, answer.attempt_id);

  if (stillPending === 0) {
    const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(answer.attempt_id);
    const quiz = db.prepare('SELECT title FROM quizzes WHERE id = ?').get(attempt.quiz_id);
    notifyUser({
      user_id: attempt.student_id, type: 'grade',
      title: `Quiz graded: ${quiz?.title || ''}`, body: `Your final score is ${newScore}/${attempt.total}`,
      link: '/quizzes', related_id: attempt.quiz_id,
    });
  }

  logAudit(req, { module: 'quizzes', action: 'manually_graded', description: `${req.user.name} manually graded a quiz answer` });
  res.json({ ok: true, newScore });
});

// --- Analytics ---

router.get('/:id/analytics', requireAuth, requireStaff, (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const scopeError = assertQuizInScope(req, quiz);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const attempts = db.prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? AND status != 'in_progress'").all(req.params.id);
  const totalStudents = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND class_level=? AND approval_status='approved'").get(quiz.class_level).c;
  const uniqueAttempters = new Set(attempts.map(a => a.student_id)).size;

  const pcts = attempts.filter(a => a.total > 0).map(a => (a.score / a.total) * 100);
  const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const highPct = pcts.length ? Math.round(Math.max(...pcts)) : null;
  const lowPct = pcts.length ? Math.round(Math.min(...pcts)) : null;

  // Per-question difficulty/statistics: % of attempts answering correctly.
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ?').all(req.params.id);
  const questionStats = questions.map(q => {
    const answers = db.prepare('SELECT is_correct FROM quiz_attempt_answers WHERE question_id = ? AND is_correct IS NOT NULL').all(q.id);
    const correctCount = answers.filter(a => a.is_correct).length;
    return {
      question_id: q.id, question: q.question, qtype: q.qtype, difficulty: q.difficulty,
      totalAnswered: answers.length, correctCount,
      correctPct: answers.length ? Math.round((correctCount / answers.length) * 100) : null,
    };
  });

  // Weak-topic analysis across ALL quizzes in this subject for students who attempted this quiz.
  const attempterIds = [...new Set(attempts.map(a => a.student_id))];
  let weakTopics = [];
  if (attempterIds.length) {
    const placeholders = attempterIds.map(() => '?').join(',');
    weakTopics = db.prepare(`
      SELECT qz.topic, AVG(CAST(qa.score AS FLOAT)/qa.total) as avg_pct, COUNT(*) as attempts
      FROM quiz_attempts qa JOIN quizzes qz ON qa.quiz_id = qz.id
      WHERE qz.subject_id = ? AND qa.student_id IN (${placeholders}) AND qz.topic IS NOT NULL AND qa.status != 'in_progress'
      GROUP BY qz.topic HAVING avg_pct < 0.7 ORDER BY avg_pct ASC LIMIT 5
    `).all(quiz.subject_id, ...attempterIds).map(t => ({ topic: t.topic, avgPct: Math.round(t.avg_pct * 100), attempts: t.attempts }));
  }

  const pendingManualGrading = db.prepare("SELECT COUNT(*) c FROM quiz_attempts WHERE quiz_id = ? AND needs_manual_grading = 1 AND manually_graded = 0").get(req.params.id).c;

  res.json({
    totalStudents, uniqueAttempters, totalAttempts: attempts.length,
    participationPct: totalStudents ? Math.round((uniqueAttempters / totalStudents) * 100) : 0,
    avgPct, highPct, lowPct, passingPct: quiz.passing_pct,
    passRate: pcts.length ? Math.round((pcts.filter(p => p >= quiz.passing_pct).length / pcts.length) * 100) : null,
    questionStats, weakTopics, pendingManualGrading,
  });
});

router.get('/:id/my-analytics', requireAuth, (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const myAttempts = db.prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status != 'in_progress' ORDER BY attempted_at ASC").all(req.params.id, req.user.id);
  const allAttempts = db.prepare("SELECT score, total FROM quiz_attempts WHERE quiz_id = ? AND status != 'in_progress'").all(req.params.id);
  const classAvgPct = allAttempts.length
    ? Math.round(allAttempts.reduce((s, a) => s + (a.total ? (a.score / a.total) * 100 : 0), 0) / allAttempts.length)
    : null;

  const best = myAttempts.reduce((best, a) => (!best || a.score > best.score ? a : best), null);
  const trend = myAttempts.map(a => ({ attempt_number: a.attempt_number, pct: a.total ? Math.round((a.score / a.total) * 100) : 0, attempted_at: a.attempted_at }));

  res.json({
    myBestScore: best?.score ?? null, myBestTotal: best?.total ?? null,
    myBestPct: best && best.total ? Math.round((best.score / best.total) * 100) : null,
    classAvgPct, attemptsUsed: myAttempts.length, maxAttempts: quiz.max_attempts, trend,
  });
});

export default router;
