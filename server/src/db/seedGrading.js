// Seeds the built-in SEE grading scale. Idempotent: runs on every boot.
// Only the SEE scale is seeded. A–F and IB stay config-only until their boundaries are confirmed
// against an official directive. Custom scales are created through POST /api/exams/grading-scales.
import { SEE_BANDS, SEE_SCALE_NAME, SEE_COMPONENT_MINS } from '../services/exams/grading.js';

export function seedGradingScales(db) {
  const existing = db.prepare('SELECT id, theory_min_percent FROM grading_scales WHERE name = ?').get(SEE_SCALE_NAME);
  if (existing) {
    // Databases created before the component minimums existed: fill them in once. Never overwrite a value.
    if (existing.theory_min_percent === null) {
      db.prepare('UPDATE grading_scales SET theory_min_percent = ?, internal_min_percent = ? WHERE id = ?')
        .run(SEE_COMPONENT_MINS.theory_min_percent, SEE_COMPONENT_MINS.internal_min_percent, existing.id);
    }
    return existing.id;
  }
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO grading_scales (name, theory_min_percent, internal_min_percent) VALUES (?,?,?)')
      .run(SEE_SCALE_NAME, SEE_COMPONENT_MINS.theory_min_percent, SEE_COMPONENT_MINS.internal_min_percent).lastInsertRowid);
    const ins = db.prepare('INSERT INTO grading_bands (scale_id, min_percent, grade, grade_point, is_pass) VALUES (?,?,?,?,?)');
    for (const b of SEE_BANDS) ins.run(id, b.min_percent, b.grade, b.grade_point, b.is_pass);
    return id;
  })();
}
