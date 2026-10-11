import db from './index.js';
import bcrypt from 'bcryptjs';

const subjectCount = db.prepare('SELECT COUNT(*) c FROM subjects').get().c;
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;

const SUBJECTS_BY_CLASS = {
  6: [['Mathematics', 'Calculator'], ['Science', 'FlaskConical'], ['English', 'BookOpen'], ['Social Studies', 'Globe2'], ['Computer', 'Laptop']],
  7: [['Mathematics', 'Calculator'], ['Science', 'FlaskConical'], ['English', 'BookOpen'], ['Social Studies', 'Globe2'], ['Computer', 'Laptop']],
  8: [['Mathematics', 'Calculator'], ['Science', 'FlaskConical'], ['English', 'BookOpen'], ['Social Studies', 'Globe2'], ['Computer', 'Laptop']],
  9: [['Mathematics', 'Calculator'], ['Physics', 'Atom'], ['Chemistry', 'FlaskConical'], ['Biology', 'Dna'], ['English', 'BookOpen'], ['Computer Science', 'Laptop']],
  10: [['Mathematics', 'Calculator'], ['Physics', 'Atom'], ['Chemistry', 'FlaskConical'], ['Biology', 'Dna'], ['English', 'BookOpen'], ['Computer Science', 'Laptop']],
  11: [['Physics', 'Atom'], ['Chemistry', 'FlaskConical'], ['Biology', 'Dna'], ['Mathematics', 'Calculator'], ['English', 'BookOpen'], ['Computer Science', 'Laptop'], ['Economics', 'TrendingUp']],
  12: [['Physics', 'Atom'], ['Chemistry', 'FlaskConical'], ['Biology', 'Dna'], ['Mathematics', 'Calculator'], ['English', 'BookOpen'], ['Computer Science', 'Laptop'], ['Economics', 'TrendingUp']],
};

const COLORS = ['#6C5CE7', '#00B894', '#0984E3', '#E17055', '#FDCB6E', '#E84393', '#00CEC9'];

if (subjectCount === 0) {
  const insert = db.prepare('INSERT INTO subjects (class_level, name, description, icon, color) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const [cls, subs] of Object.entries(SUBJECTS_BY_CLASS)) {
      subs.forEach(([name, icon], i) => {
        insert.run(Number(cls), name, `${name} curriculum for Class ${cls}`, icon, COLORS[i % COLORS.length]);
      });
    }
  });
  tx();
  console.log('Seeded subjects for classes 6-12');
}

if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role, class_level, section, avatar_color, staff_role) VALUES (?,?,?,?,?,?,?,?)');
  const adminHash = bcrypt.hashSync('Admin@123', 10);
  const teacherHash = bcrypt.hashSync('Teacher@123', 10);
  const studentHash = bcrypt.hashSync('Student@123', 10);
  insertUser.run('Admin User', 'admin@nitex.com', adminHash, 'admin', null, null, '#2D3436', null);
  const teacherInfo = insertUser.run('Priya Sharma', 'teacher@nitex.com', teacherHash, 'teacher', null, null, '#0984E3', 'subject_teacher');
  insertUser.run('Aarav Sharma', 'student@nitex.com', studentHash, 'student', 10, 'A', '#6C5CE7', null);
  console.log('Seeded demo admin (admin@nitex.com / Admin@123), demo teacher (teacher@nitex.com / Teacher@123), and demo student (student@nitex.com / Student@123)');

  // Assign the demo teacher to Class 10 Mathematics, Section A, using the new
  // Teacher -> Class -> Section -> Subject relationship table.
  const mathSubjectForTeacher = db.prepare("SELECT id FROM subjects WHERE class_level=10 AND name='Mathematics'").get();
  if (mathSubjectForTeacher) {
    db.prepare('INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id, is_class_teacher) VALUES (?,?,?,?,1)')
      .run(teacherInfo.lastInsertRowid, 10, 'A', mathSubjectForTeacher.id);
  }
}

// Seed a default academic session if none exists
const sessionCount = db.prepare('SELECT COUNT(*) c FROM academic_sessions').get().c;
if (sessionCount === 0) {
  const info = db.prepare('INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?,?,?,1)')
    .run('2025-2026', '2025-04-01', '2026-03-31');
  db.prepare('UPDATE settings SET active_session_id = ? WHERE id = 1').run(info.lastInsertRowid);
  console.log('Seeded default academic session 2025-2026');
}

// Seed a few default sections per class if none exist
const sectionCount = db.prepare('SELECT COUNT(*) c FROM sections').get().c;
if (sectionCount === 0) {
  const insertSection = db.prepare('INSERT INTO sections (class_level, name) VALUES (?,?)');
  for (const cls of [6, 7, 8, 9, 10, 11, 12]) {
    insertSection.run(cls, 'A');
    insertSection.run(cls, 'B');
  }
  console.log('Seeded default sections (A, B) for classes 6-12');
}

// Seed a sample quiz + questions + a couple of materials for class 10 Mathematics if empty
const mathSubject = db.prepare("SELECT id FROM subjects WHERE class_level=10 AND name='Mathematics'").get();
if (mathSubject) {
  const quizCount = db.prepare('SELECT COUNT(*) c FROM quizzes WHERE subject_id=?').get(mathSubject.id).c;
  if (quizCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
    const quizInsert = db.prepare('INSERT INTO quizzes (subject_id, class_level, title, description, topic, time_limit_min, created_by) VALUES (?,?,?,?,?,?,?)');
    const info = quizInsert.run(mathSubject.id, 10, 'Quadratic Equations Basics', 'Test your understanding of quadratic equations', 'Algebra', 10, admin?.id);
    const qId = info.lastInsertRowid;
    const qInsert = db.prepare('INSERT INTO quiz_questions (quiz_id, question, option_a, option_b, option_c, option_d, correct_option, points) VALUES (?,?,?,?,?,?,?,?)');
    qInsert.run(qId, 'What is the standard form of a quadratic equation?', 'ax + b = 0', 'ax² + bx + c = 0', 'ax³ + bx² = 0', 'a/x + b = 0', 'b', 1);
    qInsert.run(qId, 'The discriminant formula is:', 'b² - 4ac', '2b - 4ac', 'b² + 4ac', '4ac - b', 'a', 1);
    qInsert.run(qId, 'If discriminant is 0, roots are:', 'Imaginary', 'Real and equal', 'Real and unequal', 'Undefined', 'b', 1);
    qInsert.run(qId, 'Sum of roots of ax²+bx+c=0 is:', '-b/a', 'c/a', 'b/a', '-c/a', 'a', 1);
    qInsert.run(qId, 'Product of roots of ax²+bx+c=0 is:', '-b/a', 'c/a', 'b/a', '-c/a', 'b', 1);

    const matInsert = db.prepare('INSERT INTO materials (subject_id, class_level, title, description, type, external_url, topic, difficulty, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)');
    matInsert.run(mathSubject.id, 10, 'Introduction to Quadratic Equations', 'Comprehensive notes covering the basics', 'note', null, 'Algebra', 'easy', admin?.id);
    matInsert.run(mathSubject.id, 10, 'Quadratic Formula Explained (Video)', 'Step-by-step video walkthrough', 'video', 'https://www.youtube.com/embed/COQKyeAqaZg', 'Algebra', 'medium', admin?.id);
    console.log('Seeded sample quiz and materials for Class 10 Mathematics');
  }
}
