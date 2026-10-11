-- NITEX Database Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher','admin','guardian')),
  class_level INTEGER, -- 6-12 for students, NULL for staff
  section TEXT, -- e.g. 'A', 'B' for students
  gender TEXT CHECK(gender IN ('male','female','other')),
  avatar_color TEXT DEFAULT '#6C5CE7',
  theme_preference TEXT DEFAULT 'light' CHECK(theme_preference IN ('light','dark')),
  approval_status TEXT DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected')),
  xp INTEGER DEFAULT 0,
  streak_count INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  streak_last_date TEXT,
  -- Staff (admin/teacher) module preferences: when set, modules auto-filter
  -- to these instead of forcing "All Classes / All Subjects" every time.
  pref_class_level INTEGER,
  pref_section TEXT,
  pref_subject_id INTEGER,
  -- Teacher Management: sub-role within role='teacher'. NULL for admin/student.
  -- 'class_teacher' | 'subject_teacher' | 'coordinator' | 'exam_controller' | 'academic_head'
  staff_role TEXT,
  -- 'active' | 'disabled' — admin can disable a teacher account without deleting it.
  account_status TEXT DEFAULT 'active' CHECK(account_status IN ('active','disabled','archived')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Application Review, Rejection & Reapplication Workflow.
-- Every application submission (initial registration or a reapply) becomes a
-- permanent, versioned row here. Rejected applications are NEVER deleted —
-- they stay forever for historical record, and a new version is created when
-- the applicant reapplies (V1 -> rejected -> V2 -> rejected -> V3 ...).
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_user_id INTEGER NOT NULL, -- the user account this application belongs to
  version INTEGER NOT NULL DEFAULT 1, -- 1, 2, 3... increasing per applicant
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected')),
  -- Snapshot of submitted data for this version (name/email/class/section/gender/etc + any uploaded doc paths)
  data TEXT NOT NULL, -- JSON blob
  reviewer_id INTEGER, -- admin who reviewed it
  reviewer_name TEXT,
  rejection_reason TEXT, -- one of a fixed set of reasons, or 'Other'
  reviewer_comments TEXT,
  reviewed_at TEXT,
  is_current INTEGER DEFAULT 1, -- 1 for the latest version of this applicant, 0 for superseded historical versions
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(applicant_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_level INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(class_level, name)
);

CREATE TABLE IF NOT EXISTS academic_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, -- e.g. "2025-2026"
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_level INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'BookOpen',
  color TEXT DEFAULT '#6C5CE7',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  class_level INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK(type IN ('pdf','slide','doc','video','link','note')),
  file_path TEXT,
  external_url TEXT,
  topic TEXT,
  difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY(uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS material_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  viewed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  class_level INTEGER NOT NULL,
  section TEXT, -- optional: NULL means all sections of the class
  title TEXT NOT NULL,
  chapter TEXT,
  description TEXT, -- rich text description (HTML)
  instructions TEXT,
  reference_links TEXT, -- JSON array of {label, url}
  file_path TEXT, -- kept for backward compatibility (first/legacy attachment)
  due_date TEXT,
  publish_at TEXT, -- when status='scheduled', becomes visible at this time
  max_score INTEGER DEFAULT 100,
  passing_score INTEGER,
  allow_late INTEGER DEFAULT 1,
  late_penalty_pct INTEGER DEFAULT 0,
  allow_resubmission INTEGER DEFAULT 1,
  max_resubmissions INTEGER DEFAULT 3,
  allow_regrade_requests INTEGER DEFAULT 1,
  allowed_file_types TEXT, -- comma-separated extensions, empty = any
  max_upload_size_mb INTEGER DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'published', -- draft | scheduled | published | archived
  visibility TEXT NOT NULL DEFAULT 'visible', -- visible | hidden
  duplicated_from INTEGER, -- id of the assignment this was duplicated from, if any
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  file_path TEXT,
  attachments TEXT, -- JSON array of {path, name} for multiple files
  note TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', -- draft | submitted | under_review | graded | resubmission_requested | resubmitted | regraded | closed | rejected_invalid
  is_late INTEGER DEFAULT 0,
  version_count INTEGER DEFAULT 1,
  grade INTEGER,
  feedback TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  graded_at TEXT,
  graded_by INTEGER,
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(graded_by) REFERENCES users(id),
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  class_level INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  topic TEXT,
  time_limit_min INTEGER DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'published', -- draft | published | archived
  shuffle_questions INTEGER DEFAULT 0,
  shuffle_answers INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 1, -- 0 = unlimited
  grading_strategy TEXT DEFAULT 'highest', -- highest | latest | average
  auto_grade INTEGER DEFAULT 1,
  show_review INTEGER DEFAULT 1, -- allow students to review answers after submitting
  randomize_count INTEGER, -- if set, randomly serve this many questions out of the full bank
  passing_pct INTEGER DEFAULT 40,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  qtype TEXT NOT NULL DEFAULT 'mcq', -- mcq | multiple_choice | true_false | fill_blank | short_answer | essay | numerical | matching | ordering | image | audio | video | code
  question TEXT NOT NULL,
  -- Legacy MCQ columns kept for backward compatibility with existing quizzes.
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  correct_option TEXT, -- a|b|c|d, only used by legacy 'mcq' rows
  options TEXT, -- JSON — generic option list, shape depends on qtype
  correct_answer TEXT, -- JSON — generic correct-answer shape, depends on qtype
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  points INTEGER DEFAULT 1,
  order_index INTEGER DEFAULT 0,
  pool_id INTEGER, -- if part of a question pool for randomization
  needs_manual_grading INTEGER DEFAULT 0, -- essay/short_answer default to 1
  media_url TEXT, -- for image/audio/video/file-based questions
  source_bank_item_id INTEGER, -- if this question was pulled in from a Question Bank
  FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY(pool_id) REFERENCES question_pools(id) ON DELETE SET NULL,
  FOREIGN KEY(source_bank_item_id) REFERENCES question_bank_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  attempt_number INTEGER DEFAULT 1,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  answers TEXT, -- JSON of {question_id: answer}
  status TEXT NOT NULL DEFAULT 'completed', -- in_progress | completed | auto_submitted
  autosave_state TEXT, -- JSON snapshot for resume-in-progress attempts
  started_at TEXT DEFAULT (datetime('now')),
  time_taken_sec INTEGER,
  needs_manual_grading INTEGER DEFAULT 0,
  manually_graded INTEGER DEFAULT 0,
  attempted_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Per-question grading detail for an attempt — needed for manual grading of
-- essay/short-answer questions and for detailed per-question analytics.
CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer TEXT, -- JSON
  is_correct INTEGER, -- NULL until graded (manual types) or auto-computed
  awarded_points INTEGER DEFAULT 0,
  manual_feedback TEXT,
  graded_by INTEGER,
  graded_at TEXT,
  FOREIGN KEY(attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY(question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
  FOREIGN KEY(graded_by) REFERENCES users(id)
);

-- Reusable question bank (teacher/admin authored questions independent of any
-- one quiz) so questions can be pulled into multiple quizzes without retyping.
-- A named, reusable collection of questions (e.g. "Computer Basics", "Networking").
-- Teachers can create unlimited banks; each bank can hold hundreds of questions.
CREATE TABLE IF NOT EXISTS question_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  subject_id INTEGER,
  class_level INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS question_bank_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER, -- which named Question Bank this question belongs to (NULL = unfiled, legacy)
  subject_id INTEGER,
  class_level INTEGER,
  topic TEXT, -- chapter/topic tag
  learning_outcome TEXT, -- tag: learning outcome / objective
  qtype TEXT NOT NULL DEFAULT 'mcq',
  question TEXT NOT NULL,
  options TEXT, -- JSON — shape depends on qtype
  correct_answer TEXT, -- JSON — shape depends on qtype
  explanation TEXT,
  media_url TEXT, -- for image/file-based questions
  difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  points INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(bank_id) REFERENCES question_banks(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

-- A pool groups several questions in a quiz so the server can randomly pick
-- N of them per student attempt ("Question Pools" / randomization).
CREATE TABLE IF NOT EXISTS question_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  pick_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

-- One row per resubmission-reason / request-for-resubmission workflow event
CREATE TABLE IF NOT EXISTS resubmission_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  requested_by INTEGER, -- teacher
  reason TEXT NOT NULL, -- Wrong File / Missing Questions / Formatting Issues / Incomplete Work / Poor Quality / Plagiarism / Other
  custom_reason TEXT,
  new_deadline TEXT,
  fulfilled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(requested_by) REFERENCES users(id)
);

-- Student-initiated regrade requests
CREATE TABLE IF NOT EXISTS regrade_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  attachment_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  teacher_response TEXT,
  previous_grade INTEGER,
  new_grade INTEGER,
  requested_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_by) REFERENCES users(id)
);

-- Every submission version ever made (never overwritten) — Submission Version History.
CREATE TABLE IF NOT EXISTS submission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL, -- points at the "current" logical submission row
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  file_path TEXT,
  note TEXT,
  is_late INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Every grade/regrade event ever recorded (full grading history, never overwritten).
CREATE TABLE IF NOT EXISTS grade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  grade INTEGER,
  feedback TEXT,
  is_regrade INTEGER DEFAULT 0,
  graded_by INTEGER,
  graded_by_name TEXT,
  graded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(graded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assignment_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);

-- Rubric criteria for an assignment (e.g. "Grammar - 10 pts", "Content - 20 pts").
-- Optional: an assignment with no rows here is simply graded out of max_score directly.
CREATE TABLE IF NOT EXISTS assignment_rubrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  criterion TEXT NOT NULL,
  max_points INTEGER NOT NULL DEFAULT 10,
  order_index INTEGER DEFAULT 0,
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);

-- Per-criterion score for a graded submission, when the assignment uses a rubric.
CREATE TABLE IF NOT EXISTS submission_rubric_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  rubric_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(rubric_id) REFERENCES assignment_rubrics(id) ON DELETE CASCADE,
  UNIQUE(submission_id, rubric_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_level INTEGER, -- NULL means all classes
  title TEXT NOT NULL,
  body TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT DEFAULT 'NITEX',
  tagline TEXT DEFAULT 'Learn. Practice. Excel.',
  logo_url TEXT,
  favicon_url TEXT,
  hero_image_url TEXT,
  primary_color TEXT DEFAULT '#FFB454',
  accent_color TEXT DEFAULT '#5EEAD4',
  font_family TEXT DEFAULT 'Fraunces',
  body_font TEXT DEFAULT 'Inter',
  ui_density TEXT DEFAULT 'comfortable' CHECK(ui_density IN ('comfortable','compact')),
  corner_style TEXT DEFAULT 'rounded' CHECK(corner_style IN ('rounded','sharp')),
  default_theme TEXT DEFAULT 'dark' CHECK(default_theme IN ('light','dark')),
  -- Legacy footer/contact fields: superseded by the dedicated Footer & Contact
  -- module. Kept only so older data isn't lost; no longer editable from
  -- Branding & Settings and not required for new installs.
  footer_about TEXT DEFAULT 'NITEX is a modern learning platform helping students from Class 6 to 12 study smarter with rich resources, quizzes and progress tracking.',
  contact_email TEXT DEFAULT 'support@nitex.com',
  contact_phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  social_facebook TEXT DEFAULT '',
  social_twitter TEXT DEFAULT '',
  social_instagram TEXT DEFAULT '',
  social_youtube TEXT DEFAULT '',
  social_linkedin TEXT DEFAULT '',
  -- Enterprise configuration
  school_name TEXT DEFAULT '',
  school_registration_no TEXT DEFAULT '',
  school_address TEXT DEFAULT '',
  default_language TEXT DEFAULT 'en',
  date_format TEXT DEFAULT 'DD/MM/YYYY',
  time_format TEXT DEFAULT '24h' CHECK(time_format IN ('12h','24h')),
  timezone TEXT DEFAULT 'Asia/Kathmandu',
  active_session_id INTEGER,
  homepage_headline TEXT DEFAULT '',
  homepage_subheadline TEXT DEFAULT '',
  email_from_name TEXT DEFAULT '',
  email_from_address TEXT DEFAULT '',
  email_smtp_host TEXT DEFAULT '',
  email_smtp_port INTEGER,
  notify_new_registration INTEGER DEFAULT 1,
  notify_new_submission INTEGER DEFAULT 1,
  notify_grading_complete INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Which subjects/classes a teacher is assigned to teach (many-to-many)
-- Teacher Management: the full Teacher -> Class -> Section -> Subject relationship.
-- One row = "this teacher teaches this subject, to this class, in this section"
-- (section NULL means "all sections of that class"). This table is the single
-- source of truth every module (Assignments, Quizzes, Content, Reports,
-- Attendance, etc) should join against instead of re-implementing its own
-- teacher-scoping logic.
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  class_level INTEGER NOT NULL,
  section TEXT, -- NULL = all sections of this class
  subject_id INTEGER NOT NULL,
  is_class_teacher INTEGER DEFAULT 0, -- 1 if this teacher is the homeroom/Class Teacher for this class+section
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(teacher_id, class_level, section, subject_id)
);

-- Legacy table kept only so any pre-existing data isn't silently dropped;
-- superseded by teacher_assignments above. No new code writes to this table.
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  class_level INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(teacher_id, subject_id)
);

-- Enterprise audit log: every important action across the system
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  user_role TEXT,
  module TEXT NOT NULL, -- e.g. 'auth', 'users', 'assignments', 'quizzes', 'content', 'settings', 'applications'
  action TEXT NOT NULL, -- e.g. 'login', 'created', 'updated', 'deleted', 'approved', 'rejected'
  description TEXT,
  ip_address TEXT,
  user_agent TEXT,
  status TEXT DEFAULT 'success' CHECK(status IN ('success','failure')),
  previous_value TEXT, -- JSON snapshot before the change
  new_value TEXT, -- JSON snapshot after the change
  metadata TEXT, -- JSON blob for anything else relevant
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('material','assignment','quiz','announcement','grade','general')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  related_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_materials_class ON materials(class_level);
CREATE INDEX IF NOT EXISTS idx_subjects_class ON subjects(class_level);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_level);
CREATE INDEX IF NOT EXISTS idx_quizzes_class ON quizzes(class_level);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class ON teacher_assignments(class_level, section);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject ON teacher_assignments(subject_id);
CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_level);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_level);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_current ON applications(is_current);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submission_versions_submission ON submission_versions(submission_id);
CREATE INDEX IF NOT EXISTS idx_grade_history_submission ON grade_history(submission_id);
CREATE INDEX IF NOT EXISTS idx_resubmission_requests_submission ON resubmission_requests(submission_id);
CREATE INDEX IF NOT EXISTS idx_regrade_requests_submission ON regrade_requests(submission_id);
CREATE INDEX IF NOT EXISTS idx_regrade_requests_status ON regrade_requests(status);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank_items(subject_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_items_bank ON question_bank_items(bank_id);
CREATE INDEX IF NOT EXISTS idx_question_banks_subject ON question_banks(subject_id);
CREATE INDEX IF NOT EXISTS idx_assignment_rubrics_assignment ON assignment_rubrics(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submission_rubric_scores_submission ON submission_rubric_scores(submission_id);
CREATE INDEX IF NOT EXISTS idx_users_staff_role ON users(staff_role);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);

-- ===========================================================================
-- ENTERPRISE RBAC ENGINE (roles / permissions / grants / overrides)
-- See docs/RBAC_ENTERPRISE_ARCHITECTURE.md for the full design rationale.
-- Additive only — existing users.role / users.staff_role columns are kept
-- and remain the fast-path/back-compat identity; users.role_id below is the
-- new source of truth for fine-grained permission resolution.
-- ===========================================================================

-- Extensible role catalogue. rank: lower number = higher authority.
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  rank INTEGER NOT NULL,
  is_system_role INTEGER DEFAULT 0,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Atomic capability catalogue (e.g. 'assignment.create', 'audit.view').
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  module TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_dangerous INTEGER DEFAULT 0,
  admin_only INTEGER DEFAULT 0, -- hard-locked to system_admin regardless of role_permissions/overrides
  created_at TEXT DEFAULT (datetime('now'))
);

-- Role -> permission default grants. effect='deny' lets a role explicitly
-- deny something even though the permission key exists globally.
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  UNIQUE(role_id, permission_id)
);

-- Per-user overrides — always win over role defaults. expires_at makes an
-- override temporary; NULL = permanent until explicitly revoked.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  reason TEXT,
  granted_by INTEGER REFERENCES users(id),
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, permission_id)
);

-- Generalized scope grants for roles/dimensions teacher_assignments can't
-- express (whole-department, whole-campus). teacher_assignments remains the
-- primary table for the common class+section+subject case.
CREATE TABLE IF NOT EXISTS scope_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('school','campus','department','class_level','section','subject','student')),
  scope_value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_scope_assignments_user ON scope_assignments(user_id, scope_type);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_user_overrides_user ON user_permission_overrides(user_id);

-- ===========================================================================
-- ATTENDANCE (required by Class Teacher / Coordinator / Academic Head)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL,
  section TEXT,
  subject_id INTEGER REFERENCES subjects(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused','half_day')),
  marked_by INTEGER REFERENCES users(id),
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, date, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance_records(class_level, section, date);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance_records(subject_id);

-- ===========================================================================
-- BEHAVIOUR / DISCIPLINE (required by Class Teacher dashboard)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS behaviour_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('positive','negative','neutral')),
  type TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'low' CHECK(severity IN ('low','medium','high')),
  action_taken TEXT,
  reported_by INTEGER REFERENCES users(id),
  parent_notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_behaviour_student ON behaviour_records(student_id);

-- ===========================================================================
-- APPROVAL WORKFLOW (Academic Head / Principal) — generic queue for actions
-- that require sign-off from the highest academic authority before taking
-- effect: a grade override on an already-graded/regraded submission, or an
-- attendance-record correction after the fact. Kept intentionally generic
-- (entity_type/entity_id) rather than one table per approval kind, so a
-- future approval kind (e.g. exam result publication) can reuse this same
-- table + UI with zero schema changes.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('grade_override', 'attendance_correction')),
  entity_id INTEGER NOT NULL, -- submission_id for grade_override, attendance_records.id for attendance_correction
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  proposed_value TEXT, -- JSON, e.g. {"grade": 92}
  previous_value TEXT, -- JSON snapshot at time of request
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entity ON approval_requests(entity_type, entity_id);

-- NOTE: idx_submissions_status, idx_assignments_status, idx_quizzes_status are
-- created in db/index.js AFTER the addColumnIfMissing migrations run, because
-- on pre-existing databases the `status` column on assignments/quizzes/submissions
-- may not exist yet at the time this schema.sql is first executed.

-- Phase 1: guardians (parents and other responsible adults) and their links to students.
-- A guardian sees a child only through an active row here, with the matching flag set.
-- Access is checked in one place: services/guardians.js.
CREATE TABLE IF NOT EXISTS guardian_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'guardian' CHECK(relationship IN ('father','mother','guardian','grandparent','other')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  can_view_attendance INTEGER NOT NULL DEFAULT 1,
  can_view_fees INTEGER NOT NULL DEFAULT 0,
  can_pay_fees INTEGER NOT NULL DEFAULT 0,
  can_pickup INTEGER NOT NULL DEFAULT 0,
  -- Custody or record restriction. When 1, the guardian sees nothing about this child.
  restricted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guardian_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_guardian_students_student ON guardian_students(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_students_guardian ON guardian_students(guardian_id);

-- One-time links that let a new account (guardian or student) set its own password.
-- Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS account_setup_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_setup_tokens_user ON account_setup_tokens(user_id);


-- Phase 2: parent alerts. Admin-only configuration. Kept out of the public settings row on purpose.
CREATE TABLE IF NOT EXISTS messaging_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  alerts_enabled INTEGER NOT NULL DEFAULT 0,
  sms_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','ne','both')),
  sms_monthly_quota INTEGER NOT NULL DEFAULT 1000,
  whatsapp_monthly_quota INTEGER NOT NULL DEFAULT 1000,
  email_monthly_quota INTEGER NOT NULL DEFAULT 5000,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO messaging_config (id) VALUES (1);

-- One row per message. dedupe_key is unique, so enqueueing the same event twice cannot send twice.
-- Each school has its own database (Phase 7), so there is no school_id column.
CREATE TABLE IF NOT EXISTS message_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','email')),
  recipient TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  template_id TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('attendance','notice')),
  event_date TEXT,
  event_status TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN
    ('queued','sending','sent','simulated','failed','skipped_optout','skipped_stale','skipped_no_contact')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT DEFAULT (datetime('now')),
  last_error TEXT,
  provider_message_id TEXT,
  cost_units INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON message_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_usage ON message_outbox(channel, status, sent_at);

-- Anyone listed here never receives that channel. The worker checks this at send time, not only at enqueue.
CREATE TABLE IF NOT EXISTS message_optouts (
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','email')),
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  PRIMARY KEY (recipient, channel)
);

-- Phase 0: refresh tokens. Only a hash is stored. Rotated on each use; a family is revoked on reuse.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- Phase 0: in-app error log. One row per distinct error (fingerprint). Stores a redacted message and
-- the route only. Never stores request bodies, headers, cookies, or stack lines that contain user data.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  location TEXT,
  route TEXT,
  status INTEGER,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_events_last_seen ON error_events(last_seen);

-- Phase 3: fees. Money is stored in paisa (1 NPR = 100 paisa) as integers, never as floats.
CREATE TABLE IF NOT EXISTS fee_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'tuition' CHECK(category IN ('tuition','exam','transport','hostel','library','admission','uniform','other')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  class_level INTEGER NOT NULL,
  period TEXT NOT NULL,            -- e.g. 'Term 1', 'Annual'
  fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
  due_date TEXT NOT NULL,          -- YYYY-MM-DD
  UNIQUE(session_id, class_level, period, fee_head_id)
);

-- One invoice per student, session and period. Totals are recomputed from the items.
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  period TEXT NOT NULL,
  class_level INTEGER NOT NULL,
  section TEXT,
  gross_paisa INTEGER NOT NULL DEFAULT 0,
  concession_paisa INTEGER NOT NULL DEFAULT 0,
  net_paisa INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, session_id, period)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  description TEXT NOT NULL,
  gross_paisa INTEGER NOT NULL CHECK(gross_paisa >= 0),
  concession_paisa INTEGER NOT NULL DEFAULT 0 CHECK(concession_paisa >= 0),
  net_paisa INTEGER NOT NULL CHECK(net_paisa >= 0),
  UNIQUE(invoice_id, fee_head_id)
);

-- Discounts and scholarships. A second person must approve them (maker and checker are different people).
CREATE TABLE IF NOT EXISTS concessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
  period TEXT NOT NULL,
  fee_head_id INTEGER NOT NULL REFERENCES fee_heads(id),
  amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
  requested_by INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Payments are append-only. A refund is a negative row that points at the payment it reverses.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
  amount_paisa INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('cash','bank','khalti')),
  reference TEXT,
  refund_of_id INTEGER REFERENCES payments(id),
  recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK((kind = 'payment' AND amount_paisa > 0) OR (kind = 'refund' AND amount_paisa < 0))
);
CREATE TRIGGER IF NOT EXISTS payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END;

-- One receipt per payment. Numbers run 1, 2, 3 with no gaps, assigned inside the payment transaction.
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no INTEGER NOT NULL UNIQUE,
  payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Online payment attempts. The pidx and the provider transaction id each identify at most one payment.
CREATE TABLE IF NOT EXISTS gateway_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'khalti',
  pidx TEXT UNIQUE,
  purchase_order_id TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
  status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','completed','failed','expired','canceled')),
  provider_status TEXT,
  provider_transaction_id TEXT UNIQUE,
  payment_id INTEGER UNIQUE REFERENCES payments(id),
  failure_reason TEXT,
  initiated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Phase 3 controls: bank deposits need verification by a second person before they are posted.
CREATE TABLE IF NOT EXISTS bank_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  amount_paisa INTEGER NOT NULL CHECK(amount_paisa > 0),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted','rejected')),
  recorded_by INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  payment_id INTEGER UNIQUE REFERENCES payments(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Overpayments and refunds. A credit is positive. An application to an invoice and a refund are negative.
-- Append-only, like payments.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('credit','apply','refund')),
  amount_paisa INTEGER NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  source_payment_id INTEGER REFERENCES payments(id),
  reference TEXT,
  reason TEXT,
  recorded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK((kind = 'credit' AND amount_paisa > 0) OR (kind IN ('apply','refund') AND amount_paisa < 0))
);
CREATE TRIGGER IF NOT EXISTS credit_ledger_no_update BEFORE UPDATE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'credit ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS credit_ledger_no_delete BEFORE DELETE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'credit ledger is append-only'); END;

-- One row per scheduled job per school date. Stops the daily job from running twice.
CREATE TABLE IF NOT EXISTS fee_job_runs (
  job TEXT NOT NULL,
  run_date TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  summary TEXT,
  PRIMARY KEY (job, run_date)
);

-- Reconciliation mismatches. Kept until someone resolves them, so an old mismatch does not disappear from the list.
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  amount_paisa INTEGER,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  first_seen_date TEXT NOT NULL,
  last_seen_date TEXT NOT NULL,
  escalated_at TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_note TEXT
);

-- Internal reports sent to finance and ops. Status records what actually happened to each one.
CREATE TABLE IF NOT EXISTS fee_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('finance','ops','head_of_finance')),
  recipient TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sent','simulated','held','failed')),
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
