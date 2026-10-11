// Phase 1 fix: who may open a file under /uploads.
//
// Before this module, any signed-in non-guardian could open any upload by its path. Now the file is
// judged by the records that point at it (a material, an assignment, a submission, a quiz question,
// an application, and so on). Each record carries its owner and its scope (class, section, subject).
// Access is granted only if one of those records allows this user. Denied and missing files look the
// same to the caller, so the server does not reveal which file names exist.
//
// Rules (fail closed):
//   admin                       -> everything
//   the uploader / creator       -> their own uploads
//   student                      -> material, assignment, quiz media for their class (and section, for assignments)
//                                   and their own submissions, resubmissions and regrade requests
//   teacher                      -> class and subject they are assigned to (teacher_assignments), and their
//                                   students' submissions for those assignments
//   teacher with staff role academic_head or coordinator -> school-wide, as their oversight role
//   applicant                    -> their own application documents
//   branding (school logo, favicon, hero image) -> any signed-in, non-guardian user
//   guardian                     -> nothing (refused earlier)
//   a student's photo            -> the student, and teachers of their class (see studentPhotos.js)
//   a file no record references  -> admins only
import path from 'path';
import db from '../db/index.js';

const SCHOOL_WIDE_STAFF = new Set(['academic_head', 'coordinator']);

/** The bare file name from a stored value such as "/uploads/a.pdf", "a.pdf?x=1" or a JSON attachment path. */
export function fileName(value) {
  if (!value) return null;
  const clean = String(value).split('?')[0].split('#')[0];
  return path.basename(clean);
}

function sameFile(stored, name) {
  return fileName(stored) === name;
}

/** Find every record that refers to this file name. Each reference carries the fields the rules need. */
export function referencesFor(name) {
  const like = `%${name}%`;
  const refs = [];

  for (const r of db.prepare('SELECT * FROM materials WHERE file_path LIKE ?').all(like)) {
    if (sameFile(r.file_path, name)) refs.push({ kind: 'material', uploaded_by: r.uploaded_by, subject_id: r.subject_id, class_level: r.class_level, section: null });
  }

  for (const r of db.prepare('SELECT * FROM assignments WHERE file_path LIKE ?').all(like)) {
    if (sameFile(r.file_path, name)) refs.push({ kind: 'assignment', uploaded_by: r.created_by, subject_id: r.subject_id, class_level: r.class_level, section: r.section, assignment_id: r.id });
  }
  for (const r of db.prepare(`SELECT aa.file_path, a.id AS assignment_id, a.subject_id, a.class_level, a.section, a.created_by
    FROM assignment_attachments aa JOIN assignments a ON a.id = aa.assignment_id WHERE aa.file_path LIKE ?`).all(like)) {
    if (sameFile(r.file_path, name)) refs.push({ kind: 'assignment', uploaded_by: r.created_by, subject_id: r.subject_id, class_level: r.class_level, section: r.section, assignment_id: r.assignment_id });
  }

  for (const r of db.prepare(`SELECT s.file_path, s.attachments, s.student_id, s.assignment_id, a.subject_id, a.class_level, a.section
    FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.file_path LIKE ? OR s.attachments LIKE ?`).all(like, like)) {
    if (sameFile(r.file_path, name) || jsonHasFile(r.attachments, name)) {
      refs.push({ kind: 'submission', owner_id: r.student_id, subject_id: r.subject_id, class_level: r.class_level, section: r.section, assignment_id: r.assignment_id });
    }
  }
  for (const r of db.prepare(`SELECT sv.file_path, sv.student_id, sv.assignment_id, a.subject_id, a.class_level, a.section
    FROM submission_versions sv JOIN assignments a ON a.id = sv.assignment_id WHERE sv.file_path LIKE ?`).all(like)) {
    if (sameFile(r.file_path, name)) refs.push({ kind: 'submission', owner_id: r.student_id, subject_id: r.subject_id, class_level: r.class_level, section: r.section, assignment_id: r.assignment_id });
  }
  for (const r of db.prepare(`SELECT rr.attachment_path, rr.student_id, a.subject_id, a.class_level, a.section, s.assignment_id
    FROM regrade_requests rr JOIN submissions s ON s.id = rr.submission_id JOIN assignments a ON a.id = s.assignment_id
    WHERE rr.attachment_path LIKE ?`).all(like)) {
    if (sameFile(r.attachment_path, name)) refs.push({ kind: 'submission', owner_id: r.student_id, subject_id: r.subject_id, class_level: r.class_level, section: r.section, assignment_id: r.assignment_id });
  }

  for (const r of db.prepare(`SELECT qq.media_url, q.subject_id, q.class_level, q.created_by FROM quiz_questions qq
    JOIN quizzes q ON q.id = qq.quiz_id WHERE qq.media_url LIKE ?`).all(like)) {
    if (sameFile(r.media_url, name)) refs.push({ kind: 'quiz', uploaded_by: r.created_by, subject_id: r.subject_id, class_level: r.class_level, section: null });
  }
  for (const r of db.prepare('SELECT media_url, subject_id, created_by FROM question_bank_items WHERE media_url LIKE ?').all(like)) {
    if (sameFile(r.media_url, name)) refs.push({ kind: 'bank', uploaded_by: r.created_by, subject_id: r.subject_id });
  }

  for (const r of db.prepare('SELECT applicant_user_id, data FROM applications WHERE data LIKE ?').all(like)) {
    if (jsonHasFile(r.data, name)) refs.push({ kind: 'application', owner_id: r.applicant_user_id });
  }

  for (const r of db.prepare('SELECT id, photo_path, class_level, section FROM users WHERE photo_path LIKE ?').all(like)) {
    if (sameFile(r.photo_path, name)) refs.push({ kind: 'photo', owner_id: r.id, class_level: r.class_level, section: r.section });
  }

  const brand = db.prepare('SELECT logo_url, favicon_url, hero_image_url FROM settings WHERE id = 1').get();
  if (brand && [brand.logo_url, brand.favicon_url, brand.hero_image_url].some(v => sameFile(v, name))) {
    refs.push({ kind: 'branding' });
  }

  return refs;
}

function jsonHasFile(json, name) {
  if (!json) return false;
  let found = false;
  const walk = (v) => {
    if (found || v == null) return;
    if (typeof v === 'string') { if (sameFile(v, name)) found = true; return; }
    if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  try { walk(JSON.parse(json)); } catch { return String(json).includes(name); }
  return found;
}

/** Does this user teach this class at all (any subject, or the given section)? */
export function teachesClass(userId, classLevel, section = null) {
  if (!classLevel) return false;
  return !!db.prepare(`SELECT 1 FROM teacher_assignments
    WHERE teacher_id = ? AND class_level = ? AND (section IS NULL OR ? IS NULL OR section = ?)`).get(userId, classLevel, section, section);
}

/** Is this user assigned to teach this class and subject (and section, when one is given)? */
export function teaches(userId, classLevel, subjectId, section = null) {
  if (!classLevel || !subjectId) return false;
  return !!db.prepare(`SELECT 1 FROM teacher_assignments
    WHERE teacher_id = ? AND class_level = ? AND subject_id = ?
      AND (section IS NULL OR ? IS NULL OR section = ?)`).get(userId, classLevel, subjectId, section, section);
}

function teachesSubjectAnywhere(userId, subjectId) {
  if (!subjectId) return false;
  return !!db.prepare('SELECT 1 FROM teacher_assignments WHERE teacher_id = ? AND subject_id = ?').get(userId, subjectId);
}

/** Decide whether this user may read one file, given one reference to it. */
export function allowedByReference(user, ref) {
  const isStudent = user.role === 'student';
  const isTeacher = user.role === 'teacher';
  const schoolWide = isTeacher && SCHOOL_WIDE_STAFF.has(user.staff_role);

  if (ref.uploaded_by != null && ref.uploaded_by === user.id) return true;
  if (ref.owner_id != null && ref.owner_id === user.id) return true;
  if (ref.kind === 'branding') return true;
  if (ref.kind === 'application') return schoolWide;
  if (schoolWide) return true;

  const studentInScope = isStudent && ref.class_level === user.class_level
    && (ref.section == null || ref.section === user.section);

  switch (ref.kind) {
    case 'material':
    case 'quiz':
      return studentInScope || teaches(user.id, ref.class_level, ref.subject_id, null);
    case 'assignment':
      return studentInScope || teaches(user.id, ref.class_level, ref.subject_id, ref.section);
    case 'submission':
      // A teacher sees a student's file only for an assignment they teach.
      return teaches(user.id, ref.class_level, ref.subject_id, ref.section);
    case 'photo':
      // A student's photo: the student, admins, and teachers of the student's class.
      return teachesClass(user.id, ref.class_level, ref.section);
    case 'bank':
      return isTeacher && teachesSubjectAnywhere(user.id, ref.subject_id);
    default:
      return false;
  }
}

/** Single entry point. True only if the user is active and at least one record allows the file. */
export function canReadUpload(userId, name) {
  // A single plain file name only: no folders, no traversal, no hidden files.
  if (!name || typeof name !== 'string' || /[\\/]/.test(name) || name.includes('..') || name.startsWith('.')) return false;

  const user = db.prepare(`SELECT id, role, class_level, section, staff_role, account_status FROM users WHERE id = ?`).get(userId);
  if (!user || (user.account_status && user.account_status !== 'active')) return false;
  if (user.role === 'guardian') return false;
  if (user.role === 'admin') return true;

  const refs = referencesFor(name);
  if (refs.length === 0) return false; // orphan file: nobody but admins
  return refs.some(ref => allowedByReference(user, ref));
}
