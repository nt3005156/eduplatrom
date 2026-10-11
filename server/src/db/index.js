import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedRbac } from './seedRbac.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nitex.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const isNew = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// --- Lightweight migrations for columns/tables added after initial release ---
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}
function addColumnIfMissing(table, column, def) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

addColumnIfMissing('users', 'theme_preference', "TEXT DEFAULT 'light'");
// Bumped on password reset, disable, archive or anonymize. Tokens carry the version they were issued under.
addColumnIfMissing('users', 'session_version', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'approval_status', "TEXT DEFAULT 'approved'");
addColumnIfMissing('users', 'xp', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'streak_count', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'longest_streak', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'streak_last_date', 'TEXT');
addColumnIfMissing('users', 'gender', 'TEXT');
addColumnIfMissing('users', 'section', 'TEXT');
addColumnIfMissing('users', 'pref_class_level', 'INTEGER');
addColumnIfMissing('users', 'pref_section', 'TEXT');
addColumnIfMissing('users', 'pref_subject_id', 'INTEGER');
// 'active' | 'disabled' | 'archived' — separate from approval_status so admins
// can disable/archive accounts without touching their approval history.
addColumnIfMissing('users', 'account_status', "TEXT DEFAULT 'active'");
// Teacher Management sub-role (only meaningful when role='teacher'):
// 'class_teacher' | 'subject_teacher' | 'coordinator' | 'exam_controller' | 'academic_head'
addColumnIfMissing('users', 'staff_role', 'TEXT');
// Phase 1 student and guardian profile. Nepal fields (BS dates, IEMIS, NEB) are stored as entered.
addColumnIfMissing('users', 'phone', 'TEXT');
addColumnIfMissing('users', 'phone_verified', 'INTEGER DEFAULT 0');
// Phase 0: account lockout after repeated failed sign-ins.
addColumnIfMissing('users', 'failed_login_count', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'locked_until', 'TEXT');
// Phase 0: gamification is off by default. Pilots turn it on per school.
addColumnIfMissing('settings', 'gamification_enabled', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'dob_ad', 'TEXT');
addColumnIfMissing('users', 'dob_bs', 'TEXT');
addColumnIfMissing('users', 'address', 'TEXT');
addColumnIfMissing('users', 'admission_no', 'TEXT');
addColumnIfMissing('users', 'roll_no', 'TEXT');
addColumnIfMissing('users', 'iemis_id', 'TEXT');
addColumnIfMissing('users', 'neb_reg_no', 'TEXT');
addColumnIfMissing('users', 'blood_group', 'TEXT');
addColumnIfMissing('users', 'emergency_contact_name', 'TEXT');
addColumnIfMissing('users', 'emergency_contact_phone', 'TEXT');

addColumnIfMissing('settings', 'body_font', "TEXT DEFAULT 'Inter'");
addColumnIfMissing('settings', 'ui_density', "TEXT DEFAULT 'comfortable'");
addColumnIfMissing('settings', 'corner_style', "TEXT DEFAULT 'rounded'");
addColumnIfMissing('settings', 'school_name', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'school_registration_no', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'school_address', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'default_language', "TEXT DEFAULT 'en'");
addColumnIfMissing('settings', 'date_format', "TEXT DEFAULT 'DD/MM/YYYY'");
addColumnIfMissing('settings', 'time_format', "TEXT DEFAULT '24h'");
addColumnIfMissing('settings', 'timezone', "TEXT DEFAULT 'Asia/Kathmandu'");
addColumnIfMissing('settings', 'active_session_id', 'INTEGER');
addColumnIfMissing('settings', 'homepage_headline', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'homepage_subheadline', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'email_from_name', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'email_from_address', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'email_smtp_host', "TEXT DEFAULT ''");
addColumnIfMissing('settings', 'email_smtp_port', 'INTEGER');
addColumnIfMissing('settings', 'notify_new_registration', 'INTEGER DEFAULT 1');
addColumnIfMissing('settings', 'notify_new_submission', 'INTEGER DEFAULT 1');
addColumnIfMissing('settings', 'notify_grading_complete', 'INTEGER DEFAULT 1');

// --- Assignment Management redesign columns ---
addColumnIfMissing('assignments', 'section', 'TEXT');
addColumnIfMissing('assignments', 'chapter', 'TEXT');
addColumnIfMissing('assignments', 'instructions', 'TEXT');
addColumnIfMissing('assignments', 'reference_links', 'TEXT');
addColumnIfMissing('assignments', 'publish_at', 'TEXT');
addColumnIfMissing('assignments', 'passing_score', 'INTEGER');
addColumnIfMissing('assignments', 'allow_late', 'INTEGER DEFAULT 1');
addColumnIfMissing('assignments', 'late_penalty_pct', 'INTEGER DEFAULT 0');
addColumnIfMissing('assignments', 'allow_resubmission', 'INTEGER DEFAULT 1');
addColumnIfMissing('assignments', 'max_resubmissions', 'INTEGER DEFAULT 3');
addColumnIfMissing('assignments', 'allow_regrade_requests', 'INTEGER DEFAULT 1');
addColumnIfMissing('assignments', 'allowed_file_types', 'TEXT');
addColumnIfMissing('assignments', 'max_upload_size_mb', 'INTEGER DEFAULT 25');
addColumnIfMissing('assignments', 'status', "TEXT DEFAULT 'published'");
addColumnIfMissing('assignments', 'visibility', "TEXT DEFAULT 'visible'");
addColumnIfMissing('assignments', 'duplicated_from', 'INTEGER');
addColumnIfMissing('assignments', 'updated_at', 'TEXT');

addColumnIfMissing('submissions', 'attachments', 'TEXT');
addColumnIfMissing('submissions', 'is_late', 'INTEGER DEFAULT 0');
addColumnIfMissing('submissions', 'version_count', 'INTEGER DEFAULT 1');
addColumnIfMissing('submissions', 'graded_by', 'INTEGER');

// --- Quiz Management redesign columns ---
addColumnIfMissing('quizzes', 'status', "TEXT DEFAULT 'published'");
addColumnIfMissing('quizzes', 'shuffle_questions', 'INTEGER DEFAULT 0');
addColumnIfMissing('quizzes', 'shuffle_answers', 'INTEGER DEFAULT 0');
addColumnIfMissing('quizzes', 'max_attempts', 'INTEGER DEFAULT 1');
addColumnIfMissing('quizzes', 'grading_strategy', "TEXT DEFAULT 'highest'");
addColumnIfMissing('quizzes', 'auto_grade', 'INTEGER DEFAULT 1');
addColumnIfMissing('quizzes', 'show_review', 'INTEGER DEFAULT 1');
addColumnIfMissing('quizzes', 'randomize_count', 'INTEGER');
addColumnIfMissing('quizzes', 'passing_pct', 'INTEGER DEFAULT 40');
addColumnIfMissing('quizzes', 'updated_at', 'TEXT');

addColumnIfMissing('quiz_questions', 'qtype', "TEXT DEFAULT 'mcq'");
addColumnIfMissing('quiz_questions', 'options', 'TEXT');
addColumnIfMissing('quiz_questions', 'correct_answer', 'TEXT');
addColumnIfMissing('quiz_questions', 'explanation', 'TEXT');
addColumnIfMissing('quiz_questions', 'difficulty', "TEXT DEFAULT 'medium'");
addColumnIfMissing('quiz_questions', 'order_index', 'INTEGER DEFAULT 0');
addColumnIfMissing('quiz_questions', 'pool_id', 'INTEGER');
addColumnIfMissing('quiz_questions', 'needs_manual_grading', 'INTEGER DEFAULT 0');
addColumnIfMissing('quiz_questions', 'media_url', 'TEXT');
addColumnIfMissing('quiz_questions', 'source_bank_item_id', 'INTEGER');

// Audit Log: success/failure status column (e.g. failed_login actions are
// 'failure', everything else defaults to 'success') — supports the
// dedicated Status filter in the Audit Log UI.
addColumnIfMissing('audit_logs', 'status', "TEXT DEFAULT 'success'");

// Question Bank redesign columns (a bank_id-less question_bank_items table may
// already exist from an earlier session — add the new columns rather than
// dropping any teacher-authored questions).
addColumnIfMissing('question_bank_items', 'bank_id', 'INTEGER');
addColumnIfMissing('question_bank_items', 'learning_outcome', 'TEXT');
addColumnIfMissing('question_bank_items', 'media_url', 'TEXT');

addColumnIfMissing('quiz_attempts', 'attempt_number', 'INTEGER DEFAULT 1');
addColumnIfMissing('quiz_attempts', 'status', "TEXT DEFAULT 'completed'");
addColumnIfMissing('quiz_attempts', 'autosave_state', 'TEXT');
addColumnIfMissing('quiz_attempts', 'started_at', 'TEXT');
addColumnIfMissing('quiz_attempts', 'time_taken_sec', 'INTEGER');
addColumnIfMissing('quiz_attempts', 'needs_manual_grading', 'INTEGER DEFAULT 0');
addColumnIfMissing('quiz_attempts', 'manually_graded', 'INTEGER DEFAULT 0');


// The users.role CHECK constraint is baked into the table definition at
// creation time. Older databases were created with CHECK(role IN
// ('student','admin')) and won't accept 'teacher' until the table is
// rebuilt. Detect that case and migrate safely (SQLite's documented
// approach: create new table, copy data, swap names).
function usersTableAllowsTeacherRole() {
  try {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('__migration_probe__', '__migration_probe__', '__x__', 'teacher')").run();
    db.prepare("DELETE FROM users WHERE email = '__migration_probe__'").run();
    return true;
  } catch (e) {
    return false;
  }
}

if (!usersTableAllowsTeacherRole()) {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
        class_level INTEGER,
        section TEXT,
        gender TEXT CHECK(gender IN ('male','female','other')),
        avatar_color TEXT DEFAULT '#6C5CE7',
        theme_preference TEXT DEFAULT 'light' CHECK(theme_preference IN ('light','dark')),
        approval_status TEXT DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected')),
        xp INTEGER DEFAULT 0,
        streak_count INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        streak_last_date TEXT,
        pref_class_level INTEGER,
        pref_section TEXT,
        pref_subject_id INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const commonCols = cols.filter(c => [
      'id', 'name', 'email', 'password_hash', 'role', 'class_level', 'section', 'gender',
      'avatar_color', 'theme_preference', 'approval_status', 'xp', 'streak_count',
      'longest_streak', 'streak_last_date', 'pref_class_level', 'pref_section', 'pref_subject_id', 'created_at',
    ].includes(c));
    const colList = commonCols.join(', ');
    db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users;`);
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users_new RENAME TO users;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_level);');
  });
  migrate();
  console.log('Migrated users table to support the teacher role');
}

// Inspect the actual CREATE TABLE SQL stored by SQLite to see if a stale
// CHECK constraint from an earlier schema version is still baked into the
// table (more reliable than a probe INSERT, which can false-fail on FK
// constraints unrelated to the CHECK we actually care about).
function tableSqlHasCheck(table, needle) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!row || !row.sql) return false;
  return row.sql.includes(needle);
}

// Phase 1: add 'guardian' to users.role. SQLite cannot change a CHECK constraint in
// place, so the table is rebuilt from its own stored definition (which keeps every
// column, including ones added by earlier migrations). Foreign keys are switched off
// for the rebuild, because dropping a parent table with foreign keys on would cascade
// and delete every child row. A consistent backup is written first.
function usersTableAllowsGuardianRole() {
  return tableSqlHasCheck('users', "'guardian'");
}
if (!usersTableAllowsGuardianRole()) {
  const backupPath = `${DB_PATH}.pre-guardian-${Date.now()}.bak`;
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
  const rebuilt = stored
    .replace(/^CREATE TABLE\s+("?)users\1/i, 'CREATE TABLE users_new')
    .replace(/CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)\s*\)/i, (m, list) => `CHECK(role IN (${list}, 'guardian'))`);
  if (!/CREATE TABLE users_new/.test(rebuilt) || !/'guardian'/.test(rebuilt)) {
    throw new Error('Guardian migration: could not rewrite the users table definition');
  }
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(rebuilt);
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name).join(', ');
      db.exec(`INSERT INTO users_new (${cols}) SELECT ${cols} FROM users;`);
      db.exec('DROP TABLE users;');
      db.exec('ALTER TABLE users_new RENAME TO users;');
    })();
    const broken = db.pragma('foreign_key_check');
    if (broken.length) throw new Error(`Guardian migration left ${broken.length} broken foreign-key references`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  db.exec(schema); // recreates the users indexes that were dropped with the old table
  console.log(`Migrated users table to support the guardian role (backup: ${backupPath})`);
}

// The submissions.status CHECK constraint on older databases only allowed
// ('submitted','graded','late'). The redesigned Assignment workflow needs many
// more statuses (draft, under_review, resubmission_requested, resubmitted,
// regraded, closed, rejected_invalid). Detect and rebuild safely, same
// approach as the users/teacher-role migration above — never drop data.
function submissionsTableAllowsNewStatuses() {
  return !tableSqlHasCheck('submissions', "CHECK(status IN ('submitted','graded','late'))");
}

if (!submissionsTableAllowsNewStatuses()) {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE submissions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        file_path TEXT,
        attachments TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'submitted',
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
    `);
    const cols = db.prepare('PRAGMA table_info(submissions)').all().map(c => c.name);
    const commonCols = cols.filter(c => [
      'id', 'assignment_id', 'student_id', 'file_path', 'attachments', 'note', 'status',
      'is_late', 'version_count', 'grade', 'feedback', 'submitted_at', 'graded_at', 'graded_by',
    ].includes(c));
    const colList = commonCols.join(', ');
    db.exec(`INSERT INTO submissions_new (${colList}) SELECT ${colList} FROM submissions;`);
    db.exec('DROP TABLE submissions;');
    db.exec('ALTER TABLE submissions_new RENAME TO submissions;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);');
  });
  migrate();
  console.log('Migrated submissions table to support the redesigned assignment workflow statuses');
}

// quiz_questions.correct_option previously had CHECK(correct_option IN ('a','b','c','d'))
// which breaks inserts for non-MCQ question types (where correct_option is NULL/other).
// Older SQLite versions here don't enforce CHECK on NULL values by default, but to be
// fully safe across question types we rebuild if a probe insert fails.
function quizQuestionsAllowsNewTypes() {
  return !tableSqlHasCheck('quiz_questions', "CHECK(correct_option IN ('a','b','c','d'))");
}

if (!quizQuestionsAllowsNewTypes()) {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE quiz_questions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id INTEGER NOT NULL,
        qtype TEXT NOT NULL DEFAULT 'mcq',
        question TEXT NOT NULL,
        option_a TEXT,
        option_b TEXT,
        option_c TEXT,
        option_d TEXT,
        correct_option TEXT,
        options TEXT,
        correct_answer TEXT,
        explanation TEXT,
        difficulty TEXT DEFAULT 'medium',
        points INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0,
        pool_id INTEGER,
        needs_manual_grading INTEGER DEFAULT 0,
        FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
        FOREIGN KEY(pool_id) REFERENCES question_pools(id) ON DELETE SET NULL
      );
    `);
    const cols = db.prepare('PRAGMA table_info(quiz_questions)').all().map(c => c.name);
    const commonCols = cols.filter(c => [
      'id', 'quiz_id', 'qtype', 'question', 'option_a', 'option_b', 'option_c', 'option_d',
      'correct_option', 'options', 'correct_answer', 'explanation', 'difficulty', 'points',
      'order_index', 'pool_id', 'needs_manual_grading',
    ].includes(c));
    const colList = commonCols.join(', ');
    db.exec(`INSERT INTO quiz_questions_new (${colList}) SELECT ${colList} FROM quiz_questions;`);
    db.exec('DROP TABLE quiz_questions;');
    db.exec('ALTER TABLE quiz_questions_new RENAME TO quiz_questions;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);');
  });
  migrate();
  console.log('Migrated quiz_questions table to support additional question types');
}

// These indexes reference columns that are added via addColumnIfMissing above,
// so on a pre-existing (pre-redesign) database they must be created here —
// AFTER those columns exist — rather than in schema.sql (which runs first,
// before this file's migrations, and would fail with "no such column").
db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);');
db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);');
db.exec('CREATE INDEX IF NOT EXISTS idx_quizzes_status ON quizzes(status);');

// Ensure a single settings row always exists (id=1)
const settingsRow = db.prepare('SELECT id FROM settings WHERE id = 1').get();
if (!settingsRow) {
  db.prepare('INSERT INTO settings (id) VALUES (1)').run();
}

// role_id: new source of truth for fine-grained permission resolution.
// Kept alongside the existing users.role / users.staff_role text columns
// (never removed) so nothing that already reads those columns breaks.
addColumnIfMissing('users', 'role_id', 'INTEGER REFERENCES roles(id)');
addColumnIfMissing('users', 'failed_login_count', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'locked_until', 'TEXT');

// ---------------------------------------------------------------------
// RBAC SEED DATA — roles + full permission catalogue + role defaults.
// This runs on every boot but is idempotent (INSERT OR IGNORE / upsert),
// so it is safe to extend this list across future releases without a
// separate migration-numbering system, matching this codebase's existing
// "idempotent seed on boot" convention (see seed.js).
// ---------------------------------------------------------------------
seedRbac(db);

export default db;
export { isNew };

// Phase 1: student photo (a file under /uploads). Access is decided in services/fileAccess.js.
addColumnIfMissing('users', 'photo_path', 'TEXT');

// Staff numbers (EmpID) and the snapshot columns that carry them onto money and audit records.
// Added at the end, after the table rebuilds above, so a rebuild cannot drop them.
addColumnIfMissing('users', 'employee_no', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_employee_no_unique ON users(employee_no) WHERE employee_no IS NOT NULL');
addColumnIfMissing('audit_logs', 'employee_no', 'TEXT');
addColumnIfMissing('payments', 'recorded_by_emp_no', 'TEXT');
addColumnIfMissing('credit_ledger', 'recorded_by_emp_no', 'TEXT');
addColumnIfMissing('payment_verifications', 'recorded_by_emp_no', 'TEXT');
addColumnIfMissing('payment_verifications', 'decided_by_emp_no', 'TEXT');
addColumnIfMissing('reconciliation_exceptions', 'resolved_by_emp_no', 'TEXT');

// Fee notices (overpayment email) use event_kind 'fee_notice'. Older databases have an outbox CHECK that lists only
// attendance and notice, so rebuild the table once, copying every row. Same approach as the submissions migration.
if (!tableSqlHasCheck('message_outbox', "'fee_notice'")) {
  const migrateOutbox = db.transaction(() => {
    db.exec(`
      CREATE TABLE message_outbox_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','email')),
        recipient TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        template_id TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        dedupe_key TEXT UNIQUE NOT NULL,
        event_kind TEXT NOT NULL CHECK(event_kind IN ('attendance','notice','fee_notice')),
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
    `);
    const cols = db.prepare('PRAGMA table_info(message_outbox)').all().map(c => c.name).join(', ');
    db.exec(`INSERT INTO message_outbox_new (${cols}) SELECT ${cols} FROM message_outbox;`);
    db.exec('DROP TABLE message_outbox;');
    db.exec('ALTER TABLE message_outbox_new RENAME TO message_outbox;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_outbox_due ON message_outbox(status, next_attempt_at);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_outbox_usage ON message_outbox(channel, status, sent_at);');
  });
  migrateOutbox();
  console.log('Migrated message_outbox to accept fee notices');
}
// Daily sign-off digest uses audience 'signoff'. Older databases have a fee_dispatches CHECK without it, so rebuild the
// table once, copying every row (same approach as the outbox rebuild above).
if (!tableSqlHasCheck('fee_dispatches', "'signoff'")) {
  const migrateDispatches = db.transaction(() => {
    db.exec(`
      CREATE TABLE fee_dispatches_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_date TEXT NOT NULL,
        audience TEXT NOT NULL CHECK(audience IN ('finance','ops','supervisor','head_of_finance','signoff')),
        recipient TEXT,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('sent','simulated','held','failed')),
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const cols = db.prepare('PRAGMA table_info(fee_dispatches)').all().map(c => c.name).join(', ');
    db.exec(`INSERT INTO fee_dispatches_new (${cols}) SELECT ${cols} FROM fee_dispatches;`);
    db.exec('DROP TABLE fee_dispatches;');
    db.exec('ALTER TABLE fee_dispatches_new RENAME TO fee_dispatches;');
  });
  migrateDispatches();
  console.log("Migrated fee_dispatches to accept the sign-off digest");
}

// Per-row mandatory flag. A mandatory row (a fee notice) skips the opt-out check at send time. Set only by the
// caller that enqueues it, and only for fee_notice rows (enforced in outbox.enqueue).
addColumnIfMissing('message_outbox', 'mandatory', 'INTEGER NOT NULL DEFAULT 0');
