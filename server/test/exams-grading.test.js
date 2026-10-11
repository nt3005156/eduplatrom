// Phase 4 grading engine: SEE boundaries, the 75:25 split, the NG rule, absent handling,
// validation of scales and marks, and golden files per scale.
// The golden JSON files hold expected results written from the rules, not produced by the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SEE_BANDS, SEE_SCALE_NAME, validateBands, validateExamMarks, validateMarkInput,
  computeResult, gradeFor, GradingError, ABSENT_GRADE,
} from '../src/services/exams/grading.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = name => JSON.parse(fs.readFileSync(path.join(here, 'golden', name), 'utf-8'));

const SEE_EXAM = { full_marks: 100, theory_full: 75, internal_full: 25 };
const seeBands = validateBands(SEE_BANDS);

// ---------- SEE boundaries (roadmap: 89.99, 90, 34.99, 35) ----------

test('SEE: 89.99 is A, 90 is A+ (A+ starts at 90)', () => {
  assert.equal(gradeFor(89.99, seeBands).grade, 'A');
  assert.equal(gradeFor(90, seeBands).grade, 'A+');
});

test('SEE: 34.99 is NG, 35 is D (NG is below 35)', () => {
  assert.equal(gradeFor(34.99, seeBands).grade, 'NG');
  assert.equal(gradeFor(35, seeBands).grade, 'D');
});

test('SEE: 39.99 is D and 40 is C', () => {
  assert.equal(gradeFor(39.99, seeBands).grade, 'D');
  assert.equal(gradeFor(40, seeBands).grade, 'C');
});

test('SEE: NG has no grade point and is not a pass', () => {
  const ng = gradeFor(10, seeBands);
  assert.equal(ng.grade, 'NG');
  assert.equal(ng.grade_point, null);
  assert.equal(ng.is_pass, 0);
});

test('NG rule: a subject under 35 fails even when the other component is high', () => {
  // 20 theory + 14 internal = 34, so NG. Internal of 14 out of 25 is not enough to pass.
  const r = computeResult(SEE_EXAM, { theory: 20, internal: 14 }, seeBands);
  assert.equal(r.total, 34);
  assert.equal(r.grade, 'NG');
  assert.equal(r.is_pass, 0);
});

// ---------- 75:25 split ----------

test('75:25 split: theory and internal add up to the total, out of 100', () => {
  const r = computeResult(SEE_EXAM, { theory: 60, internal: 20 }, seeBands);
  assert.equal(r.total, 80);
  assert.equal(r.percent, 80);
  assert.equal(r.grade, 'A');
});

test('75:25 split: 67.5 + 22.5 is exactly 90 and gets A+', () => {
  const r = computeResult(SEE_EXAM, { theory: 67.5, internal: 22.5 }, seeBands);
  assert.equal(r.total, 90);
  assert.equal(r.grade, 'A+');
});

test('75:25 split: theory cannot exceed 75 and internal cannot exceed 25', () => {
  assert.throws(() => computeResult(SEE_EXAM, { theory: 75.5, internal: 0 }, seeBands), GradingError);
  assert.throws(() => computeResult(SEE_EXAM, { theory: 0, internal: 25.5 }, seeBands), GradingError);
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
  const r = computeResult(SEE_EXAM, { absent: true }, seeBands);
  assert.equal(r.absent, 1);
  assert.equal(r.total, null);
  assert.equal(r.percent, null);
  assert.equal(r.grade, ABSENT_GRADE);
  assert.equal(r.is_pass, 0);
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
  const out = validateBands([b2(0, 'F'), b2(60, 'C'), b2(80, 'A')]);
  assert.deepEqual(out.map(x => x.grade), ['A', 'C', 'F']);
});
function b2(min, grade) { return { min_percent: min, grade, grade_point: 1, is_pass: 1 }; }

// ---------- golden files, one per scale ----------

test('golden: SEE bands in the code match the golden file (any change must be deliberate)', () => {
  const g = golden('see-2083.json');
  assert.equal(SEE_SCALE_NAME, g.scale);
  assert.deepEqual(seeBands, validateBands(g.bands));
});

test('golden: every SEE case matches the expected grade, grade point and pass flag', () => {
  const g = golden('see-2083.json');
  const bands = validateBands(g.bands);
  for (const c of g.cases) {
    const r = computeResult(g.exam, { theory: c.theory, internal: c.internal }, bands);
    assert.deepEqual(
      { grade: r.grade, grade_point: r.grade_point, is_pass: r.is_pass },
      { grade: c.grade, grade_point: c.grade_point, is_pass: c.is_pass },
      `SEE case "${c.note}" (theory ${c.theory}, internal ${c.internal})`,
    );
  }
});

test('golden: custom percentage scale (school-defined) matches its expected grades', () => {
  const g = golden('custom-percentage.json');
  const bands = validateBands(g.bands);
  for (const c of g.cases) {
    const r = computeResult(g.exam, { mark: c.mark }, bands);
    assert.deepEqual(
      { grade: r.grade, grade_point: r.grade_point, is_pass: r.is_pass },
      { grade: c.grade, grade_point: c.grade_point, is_pass: c.is_pass },
      `custom case "${c.note}" (mark ${c.mark})`,
    );
  }
});

test('golden: custom scale on an out-of-50 exam is judged by percent, not raw marks', () => {
  const g = golden('custom-percentage-out-of-50.json');
  const bands = validateBands(g.bands);
  for (const c of g.cases) {
    const r = computeResult(g.exam, { mark: c.mark }, bands);
    assert.deepEqual(
      { grade: r.grade, grade_point: r.grade_point, is_pass: r.is_pass },
      { grade: c.grade, grade_point: c.grade_point, is_pass: c.is_pass },
      `out-of-50 case "${c.note}" (mark ${c.mark})`,
    );
  }
});
