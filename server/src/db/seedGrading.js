// Seeds the built-in SEE grading scale. Idempotent: runs on every boot and does nothing once it exists.
// Only the SEE scale is seeded. A–F and IB scales stay config-only until their boundaries are confirmed
// against an official directive. Custom scales are created through POST /api/exams/grading-scales.
import { SEE_BANDS, SEE_SCALE_NAME } from '../services/exams/grading.js';

export function seedGradingScales(db) {
  const existing = db.prepare('SELECT id FROM grading_scales WHERE name = ?').get(SEE_SCALE_NAME);
  if (existing) return existing.id;
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO grading_scales (name) VALUES (?)').run(SEE_SCALE_NAME).lastInsertRowid);
    const ins = db.prepare('INSERT INTO grading_bands (scale_id, min_percent, grade, grade_point, is_pass) VALUES (?,?,?,?,?)');
    for (const b of SEE_BANDS) ins.run(id, b.min_percent, b.grade, b.grade_point, b.is_pass);
    return id;
  })();
}
