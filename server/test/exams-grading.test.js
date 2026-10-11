// Phase 4 grading engine: SEE bands, component minimums (35% theory, 40% internal), the 75:25 split,
// absent handling, validation, the GPA summary, and golden files per scale.
// The golden JSON files hold expected results written from the rules, not produced by the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SEE_BANDS, SEE_SCALE_NAME, SEE_COMPONENT_MINS, validateBands, validateExamMarks, validateMarkInput,
  validateComponentMins, computeResult, gradeFor, summarizeResults, GradingError, ABSENT_GRADE,
} from '../src/services/exams/grading.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = name => JSON.parse(fs.readFileSync(path.join(here, 'golden', name), 'utf-8'));

const SEE_EXAM = { full_marks: 100, theory_full: 75, internal_full: 25 };
const seeBands = validateBands(SEE_BANDS);
const seeMins = SEE_COMPONENT_MINS;

// ---------- SEE total bands (roadmap: 89.99, 90, 34.99, 35). Band logic only. ----------

test('band: 89.99 is A, 90 is A+ (A+ starts at 90)', () => {
  assert.equal(gradeFor(89.99, seeBands).grade, 'A');
  assert.equal(gradeFor(90, seeBands).grade, 'A+');
});

test('band: 34.99 is NG, 35 is D', () => {
  assert.equal(gradeFor(34.99, seeBands).grade, 'NG');
  assert.equal(gradeFor(35, seeBands).grade, 'D');
});

test('band: 39.99 is D and 40 is C', () => {
  assert.equal(gradeFor(39.99, seeBands).grade, 'D');
  assert.equal(gradeFor(40, seeBands).grade, 'C');
});

test('band: NG has no grade point and is not a pass', () => {
  const ng = gradeFor(10, seeBands);
  assert.equal(ng.grade, 'NG');
  assert.equal(ng.grade_point, null);
  assert.equal(ng.is_pass, 0);
});

// ---------- component minimums (Letter Grading Directive) ----------

test('component gate: theory below 35% of 75 is NG even when the total is 51', () => {
  // 26 of 75 is 34.67%, under the 35% minimum. Total 51 would be C+ without the gate.
  const r = computeResult(SEE_EXAM, { theory: 26, internal: 25 }, seeBands, seeMins);
  assert.equal(r.total, 51);
  assert.equal(r.grade, 'NG');
  assert.equal(r.is_pass, 0);
  assert.equal(r.ng_reason, 'theory');
});

test('component gate: theory at exactly 35% of 75 (26.25) passes the theory minimum', () => {
  const r = computeResult(SEE_EXAM, { theory: 26.25, internal: 10 }, seeBands, seeMins);
  assert.equal(r.total, 36.25);
  assert.equal(r.grade, 'D');
  assert.equal(r.ng_reason, null);
});

test('component gate: internal below 40% of 25 is NG (9.5 fails, 10 passes)', () => {
  const low = computeResult(SEE_EXAM, { theory: 75, internal: 9.5 }, seeBands, seeMins);
  assert.equal(low.grade, 'NG');
  assert.equal(low.ng_reason, 'internal');

  const exact = computeResult(SEE_EXAM, { theory: 75, internal: 10 }, seeBands, seeMins);
  assert.equal(exact.grade, 'A');
  assert.equal(exact.ng_reason, null);
});

test('component gate: a subject with theory 20 and internal 14 is NG, reason theory', () => {
  const r = computeResult(SEE_EXAM, { theory: 20, internal: 14 }, seeBands, seeMins);
  assert.equal(r.total, 34);
  assert.equal(r.grade, 'NG');
  assert.equal(r.ng_reason, 'theory');
});

test('component gate: no minimums on the scale means no gate', () => {
  const r = computeResult(SEE_EXAM, { theory: 26, internal: 25 }, seeBands, { theory_min_percent: null, internal_min_percent: null });
  assert.equal(r.grade, 'C+');
  assert.equal(r.ng_reason, null);
});

test('component gate does not apply to a non-split exam', () => {
  const single = validateBands([{ min_percent: 0, grade: 'F', grade_point: 0, is_pass: 0 }, { min_percent: 35, grade: 'D', grade_point: 1.6, is_pass: 1 }]);
  const r = computeResult({ full_marks: 100 }, { mark: 36 }, single, seeMins);
  assert.equal(r.grade, 'D');
});

test('total below the lowest pass band gives reason total (non-split exam)', () => {
  const single = validateBands([{ min_percent: 0, grade: 'F', grade_point: 0, is_pass: 0 }, { min_percent: 35, grade: 'D', grade_point: 1.6, is_pass: 1 }]);
  const r = computeResult({ full_marks: 100 }, { mark: 20 }, single);
  assert.equal(r.grade, 'F');
  assert.equal(r.ng_reason, 'total');
});

test('validateComponentMins: null or 0 to 100 with at most 2 decimals', () => {
  assert.deepEqual(validateComponentMins({}), { theory_min_percent: null, internal_min_percent: null });
  assert.throws(() => validateComponentMins({ theory_min_percent: 101 }), /theory_min_percent/);
  assert.throws(() => validateComponentMins({ internal_min_percent: 33.333 }), /internal_min_percent/);
});

// ---------- 75:25 split ----------

test('75:25 split: theory and internal add up to the total, out of 100', () => {
  const r = computeResult(SEE_EXAM, { theory: 60, internal: 20 }, seeBands, seeMins);
  assert.equal(r.total, 80);
  assert.equal(r.percent, 80);
  assert.equal(r.grade, 'A');
});

test('75:25 split: 67.5 + 22.5 is exactly 90 and gets A+', () => {
  const r = computeResult(SEE_EXAM, { theory: 67.5, internal: 22.5 }, seeBands, seeMins);
  assert.equal(r.total, 90);
  assert.equal(r.grade, 'A+');
});

test('75:25 split: theory cannot exceed 75 and internal cannot exceed 25', () => {
  assert.throws(() => computeResult(SEE_EXAM, { theory: 75.5, internal: 0 }, seeBands, seeMins), GradingError);
  assert.throws(() => computeResult(SEE_EXAM, { theory: 0, internal: 25.5 }, seeBands, seeMins), GradingError);
});

test('split exam config: theory_full + internal_full must equal full_marks', () => {
  assert.throws(() => validateExamMarks({ full_marks: 100, theory_full: 70, internal_full: 25 }), /must equal full_marks/);
  assert.throws(() => validateExamMarks({ full_marks: 100, theory_full: 75 }), /both/);
  assert.throws(() => validateExamMarks({ full_marks: 100, theory_full: 0, internal_full: 100 }), /above 0/);
  assert.deepEqual(validateExamMarks(SEE_EXAM), { split: true, full_marks: 100, theory_full: 75, internal_full: 25 });
});

test('non-split exam: a single mark out of full_marks', () => {
  assert.deepEqual(validateExamMarks({ full_marks: 50 }), { split: false, full_marks: 50, theory_full: null, internal_full: null });
  const r = computeResult({ full_marks: 50 }, { mark: 40 }, validateBands([
    { min_percent: 80, grade: 'A', grade_point: 4, is_pass: 1 },
    { min_percent: 0, grade: 'F', grade_point: 0, is_pass: 0 },
  ]));
  assert.equal(r.percent, 80);
  assert.equal(r.grade, 'A');
});

// ---------- absent ----------

test('absent is its own state: grade AB, no total, not a pass, not a band', () => {
  const r = computeResult(SEE_EXAM, { absent: true }, seeBands, seeMins);
  assert.equal(r.absent, 1);
  assert.equal(r.total, null);
  assert.equal(r.percent, null);
  assert.equal(r.grade, ABSENT_GRADE);
  assert.equal(r.is_pass, 0);
  assert.equal(r.ng_reason, null);
});

// ---------- mark validation ----------

test('mark validation: range, decimals, and type', () => {
  assert.throws(() => validateMarkInput(SEE_EXAM, { theory: -1, internal: 0 }), /theory must be/);
  assert.throws(() => validateMarkInput(SEE_EXAM, { theory: 1.234, internal: 0 }), /2 decimals|at most 2/);
  assert.throws(() => validateMarkInput(SEE_EXAM, { theory: '60', internal: 0 }), /theory must be/);
  assert.throws(() => validateMarkInput(SEE_EXAM, { theory: NaN, internal: 0 }), /theory must be/);
  assert.throws(() => validateMarkInput(SEE_EXAM, { theory: 10 }), /internal must be/);
  assert.throws(() => validateMarkInput({ full_marks: 50 }, { mark: 51 }), /mark must be/);
});

// ---------- GPA summary (NG is not dropped) ----------

test('summary: one NG among six A subjects gives GPA 3.09, not 3.60', () => {
  // A plain AVG(grade_point) skips the NULL and returns 3.60. That would hide the NG.
  const rows = [...Array(6)].map(() => ({ grade: 'A', grade_point: 3.6, is_pass: 1 }));
  rows.push({ grade: 'NG', grade_point: null, is_pass: 0 });
  const s = summarizeResults(rows);
  assert.equal(s.subjects, 7);
  assert.equal(s.ng_count, 1);
  assert.equal(s.gpa, 3.09);
  assert.equal(s.all_graded, false);
});

test('summary: all graded gives the mean of grade points', () => {
  const s = summarizeResults([
    { grade: 'A+', grade_point: 4.0, is_pass: 1 },
    { grade: 'B', grade_point: 2.8, is_pass: 1 },
  ]);
  assert.equal(s.gpa, 3.4);
  assert.equal(s.all_graded, true);
});

test('summary: an absent subject makes the GPA not computable', () => {
  const s = summarizeResults([
    { grade: 'A+', grade_point: 4.0, is_pass: 1 },
    { grade: ABSENT_GRADE, grade_point: null, is_pass: 0 },
  ]);
  assert.equal(s.absent_count, 1);
  assert.equal(s.gpa, null);
});

test('summary: no subjects gives no GPA', () => {
  assert.deepEqual(summarizeResults([]), { subjects: 0, ng_count: 0, absent_count: 0, gpa: null, all_graded: false });
});

// ---------- scale validation ----------

test('validateBands: rejects a scale that cannot grade every mark', () => {
  assert.throws(() => validateBands([{ min_percent: 50, grade: 'P', grade_point: 1, is_pass: 1 }]), /band starting at 0/);
});

test('validateBands: rejects duplicates, reserved grade, bad ranges, and bad flags', () => {
  const b = (min, grade, extra = {}) => ({ min_percent: min, grade, grade_point: 1, is_pass: 1, ...extra });
  assert.throws(() => validateBands([b(0, 'F'), b(0, 'G')]), /used twice/);
  assert.throws(() => validateBands([b(50, 'X'), b(0, 'X')]), /appears twice/);
  assert.throws(() => validateBands([b(0, 'AB')]), /reserved for absent/);
  assert.throws(() => validateBands([b(101, 'A'), b(0, 'F')]), /0 to 100/);
  assert.throws(() => validateBands([b(33.333, 'A'), b(0, 'F')]), /2 decimals/);
  assert.throws(() => validateBands([b(0, 'F', { grade_point: -1 })]), /grade_point/);
  assert.throws(() => validateBands([b(0, 'F', { is_pass: 2 })]), /is_pass/);
  assert.throws(() => validateBands([]), /between 1 and 20/);
});

test('validateBands: sorts bands high to low', () => {
  const bands = [{ min_percent: 0, grade: 'F', grade_point: 1, is_pass: 1 }, { min_percent: 60, grade: 'C', grade_point: 1, is_pass: 1 }, { min_percent: 80, grade: 'A', grade_point: 1, is_pass: 1 }];
  assert.deepEqual(validateBands(bands).map(x => x.grade), ['A', 'C', 'F']);
});

// ---------- golden files, one per scale ----------

test('golden: SEE bands and component minimums in the code match the golden file', () => {
  const g = golden('see-2083.json');
  assert.equal(SEE_SCALE_NAME, g.scale);
  assert.deepEqual(seeBands, validateBands(g.bands));
  assert.deepEqual(SEE_COMPONENT_MINS, g.component_mins);
});

test('golden: every SEE case matches grade, grade point, pass flag, and NG reason', () => {
  const g = golden('see-2083.json');
  const bands = validateBands(g.bands);
  for (const c of g.cases) {
    const r = computeResult(g.exam, { theory: c.theory, internal: c.internal }, bands, g.component_mins);
    assert.deepEqual(
      { grade: r.grade, grade_point: r.grade_point, is_pass: r.is_pass, ng_reason: r.ng_reason },
      { grade: c.grade, grade_point: c.grade_point, is_pass: c.is_pass, ng_reason: c.ng_reason },
      `SEE case "${c.note}" (theory ${c.theory}, internal ${c.internal})`,
    );
  }
});

function checkMarkGolden(file) {
  const g = golden(file);
  const bands = validateBands(g.bands);
  for (const c of g.cases) {
    const r = computeResult(g.exam, { mark: c.mark }, bands, g.component_mins);
    assert.deepEqual(
      { grade: r.grade, grade_point: r.grade_point, is_pass: r.is_pass, ng_reason: r.ng_reason },
      { grade: c.grade, grade_point: c.grade_point, is_pass: c.is_pass, ng_reason: c.ng_reason },
      `${file} case "${c.note}" (mark ${c.mark})`,
    );
  }
}

test('golden: custom percentage scale (school-defined) matches its expected grades', () => {
  checkMarkGolden('custom-percentage.json');
});

test('golden: custom scale on an out-of-50 exam is judged by percent, not raw marks', () => {
  checkMarkGolden('custom-percentage-out-of-50.json');
});
