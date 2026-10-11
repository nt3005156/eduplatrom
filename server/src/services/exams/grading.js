// Grading engine. Pure functions only: no database, no clock, no I/O.
// Everything here is decided from the marks and the scale bands passed in, so the
// boundary tests in test/exams-grading.test.js can pin every rule.
//
// Rules:
//  - A band applies when percent >= band.min_percent (lower bound inclusive).
//    89.99 is A, 90 is A+. 34.99 is NG, 35 is D.
//  - Percent = total / full_marks * 100, compared as entered. No rounding up.
//    A tiny epsilon absorbs float noise (e.g. 67.5 + 22.5 computed in binary).
//  - SEE split: theory (out of 75) + internal (out of 25) = total (out of 100).
//  - Component minimums (Letter Grading Directive): theory must reach 35% of its full marks, and
//    internal/practical must reach 40%. Falling short of either makes the subject NG, even when the
//    total is 35 or more. Stored per scale (theory_min_percent, internal_min_percent). NULL = no gate.
//    Checked on the unrounded percentage, so 26.25 of 75 passes and 26 does not.
//  - A total below the pass band (NG for SEE) also fails the subject.
//  - Overall result and GPA across subjects are a report-card concern: see summarizeResults().
//  - Absent is its own state (grade 'AB'), never a band. It is not a score of 0.

export const ABSENT_GRADE = 'AB';
const EPS = 1e-9;

// NEB SEE letter grades, 4.0 scale. Versioned by academic year in grading_scales.
// Confirm against the official directive for each year before go-live.
export const SEE_SCALE_NAME = 'SEE letter grades (NEB, 4.0 scale)';
export const SEE_BANDS = Object.freeze([
  { min_percent: 90, grade: 'A+', grade_point: 4.0, is_pass: 1 },
  { min_percent: 80, grade: 'A', grade_point: 3.6, is_pass: 1 },
  { min_percent: 70, grade: 'B+', grade_point: 3.2, is_pass: 1 },
  { min_percent: 60, grade: 'B', grade_point: 2.8, is_pass: 1 },
  { min_percent: 50, grade: 'C+', grade_point: 2.4, is_pass: 1 },
  { min_percent: 40, grade: 'C', grade_point: 2.0, is_pass: 1 },
  { min_percent: 35, grade: 'D', grade_point: 1.6, is_pass: 1 },
  { min_percent: 0, grade: 'NG', grade_point: null, is_pass: 0 },
]);

export const SEE_SPLIT = Object.freeze({ theory_full: 75, internal_full: 25 });

// Component minimums for SEE, in percent of each component's full marks.
// Sources agree on 35% theory and 40% internal (10 of 25). Confirm against the 2083 directive before go-live.
export const SEE_COMPONENT_MINS = Object.freeze({ theory_min_percent: 35, internal_min_percent: 40 });

export class GradingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GradingError';
  }
}

const isNum = x => typeof x === 'number' && Number.isFinite(x);
// At most two decimal places. Compared with a tolerance so 33.33 is accepted.
const twoDp = x => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

/**
 * Validates and normalises a scale's bands. Returns them sorted high to low.
 * Rules: 1..20 bands, min_percent in [0,100] with at most 2 dp and unique,
 * a band at 0 (so every mark has a grade), unique grade codes, no 'AB'
 * (reserved for absent), grade_point null or >= 0, is_pass 0 or 1.
 */
export function validateBands(bands) {
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 20) {
    throw new GradingError('A scale needs between 1 and 20 bands');
  }
  const seenMin = new Set();
  const seenGrade = new Set();
  const out = bands.map((b, i) => {
    if (!b || typeof b !== 'object') throw new GradingError(`Band ${i + 1} is not an object`);
    const min = b.min_percent;
    if (!isNum(min) || min < 0 || min > 100 || !twoDp(min)) {
      throw new GradingError(`Band ${i + 1}: min_percent must be a number from 0 to 100 with at most 2 decimals`);
    }
    if (seenMin.has(min)) throw new GradingError(`Band ${i + 1}: min_percent ${min} is used twice`);
    seenMin.add(min);
    const grade = typeof b.grade === 'string' ? b.grade.trim() : '';
    if (!grade || grade.length > 5) throw new GradingError(`Band ${i + 1}: grade must be 1 to 5 characters`);
    if (grade.toUpperCase() === ABSENT_GRADE) throw new GradingError(`'${ABSENT_GRADE}' is reserved for absent`);
    if (seenGrade.has(grade)) throw new GradingError(`Grade '${grade}' appears twice`);
    seenGrade.add(grade);
    const gp = b.grade_point ?? null;
    if (gp !== null && (!isNum(gp) || gp < 0)) throw new GradingError(`Band ${i + 1}: grade_point must be empty or >= 0`);
    if (b.is_pass !== 0 && b.is_pass !== 1) throw new GradingError(`Band ${i + 1}: is_pass must be 0 or 1`);
    return { min_percent: min, grade, grade_point: gp, is_pass: b.is_pass };
  });
  if (!seenMin.has(0)) throw new GradingError('The scale needs a band starting at 0 so every mark has a grade');
  return out.sort((a, b) => b.min_percent - a.min_percent);
}

/** Component minimums must be null or a number from 0 to 100 with at most 2 decimals. */
export function validateComponentMins(mins = {}) {
  const out = {
    theory_min_percent: mins?.theory_min_percent ?? null,
    internal_min_percent: mins?.internal_min_percent ?? null,
  };
  for (const [k, v] of Object.entries(out)) {
    if (v !== null && (!isNum(v) || v < 0 || v > 100 || !twoDp(v))) {
      throw new GradingError(`${k} must be empty or a number from 0 to 100 with at most 2 decimals`);
    }
  }
  return out;
}

/**
 * Which component failed its minimum, or null. Only split exams have components.
 * v is the validated mark from validateMarkInput.
 */
export function componentGate(exam, v, mins) {
  if (exam.theory_full === null || exam.theory_full === undefined) return null;
  if (mins.theory_min_percent !== null && (v.theory / exam.theory_full) * 100 + EPS < mins.theory_min_percent) return 'theory';
  if (mins.internal_min_percent !== null && (v.internal / exam.internal_full) * 100 + EPS < mins.internal_min_percent) return 'internal';
  return null;
}

/** Band for a percentage. Bands must be sorted high to low (validateBands does this). */
export function gradeFor(percent, bands) {
  if (!isNum(percent) || percent < 0) throw new GradingError('percent must be a number >= 0');
  for (const b of bands) {
    if (percent + EPS >= b.min_percent) return b;
  }
  throw new GradingError('No band covers this percentage (scale has no band at 0)');
}

/**
 * Validates an exam's marks configuration.
 * Split exams (SEE) have theory_full + internal_full = full_marks.
 * Non-split exams have theory_full and internal_full both null.
 */
export function validateExamMarks({ full_marks, theory_full = null, internal_full = null }) {
  if (!isNum(full_marks) || full_marks <= 0 || full_marks > 1000 || !twoDp(full_marks)) {
    throw new GradingError('full_marks must be a number above 0 and up to 1000');
  }
  const hasTheory = theory_full !== null && theory_full !== undefined;
  const hasInternal = internal_full !== null && internal_full !== undefined;
  if (!hasTheory && !hasInternal) return { split: false, full_marks, theory_full: null, internal_full: null };
  if (!hasTheory || !hasInternal) throw new GradingError('Give both theory_full and internal_full, or neither');
  if (!isNum(theory_full) || theory_full <= 0 || !isNum(internal_full) || internal_full <= 0) {
    throw new GradingError('theory_full and internal_full must be above 0');
  }
  if (Math.abs(theory_full + internal_full - full_marks) > EPS) {
    throw new GradingError('theory_full + internal_full must equal full_marks');
  }
  return { split: true, full_marks, theory_full, internal_full };
}

/**
 * Validates one mark entry against the exam's config.
 * Input: { student_id, absent?, theory?, internal?, mark? }
 * Returns { absent: 0|1, theory, internal, total }. total is null when absent.
 */
export function validateMarkInput(exam, input) {
  if (input.absent === true) return { absent: 1, theory: null, internal: null, total: null };
  const checkRange = (v, max, label) => {
    if (!isNum(v) || v < 0 || v > max || !twoDp(v)) {
      throw new GradingError(`${label} must be a number from 0 to ${max} (at most 2 decimals)`);
    }
    return v;
  };
  if (exam.theory_full !== null && exam.theory_full !== undefined) {
    const theory = checkRange(input.theory, exam.theory_full, 'theory');
    const internal = checkRange(input.internal, exam.internal_full, 'internal');
    // Marks have at most 2 decimals, so round the sum to remove binary float noise (24.99 + 10 is not exact).
    return { absent: 0, theory, internal, total: Math.round((theory + internal) * 100) / 100 };
  }
  const total = checkRange(input.mark, exam.full_marks, 'mark');
  return { absent: 0, theory: null, internal: null, total };
}

/**
 * Full result for one mark row, given the exam, the scale bands, and the scale's component minimums.
 * Stored on exam_marks so report cards do not change when a scale is edited later.
 * ng_reason: 'theory' or 'internal' (component minimum), 'total' (below the lowest pass band), or null.
 */
export function computeResult(exam, input, bands, mins = {}) {
  const v = validateMarkInput(exam, input);
  if (v.absent) {
    return { ...v, percent: null, grade: ABSENT_GRADE, grade_point: null, is_pass: 0, ng_reason: null };
  }
  const raw = (v.total / exam.full_marks) * 100;
  const band = gradeFor(raw, bands); // the band is decided on the unrounded value
  const gate = componentGate(exam, v, validateComponentMins(mins));
  const percent = Math.round(raw * 1e4) / 1e4; // stored for display, 4 dp
  if (gate) {
    return { ...v, percent, grade: 'NG', grade_point: null, is_pass: 0, ng_reason: gate };
  }
  return {
    ...v, percent, grade: band.grade, grade_point: band.grade_point, is_pass: band.is_pass,
    ng_reason: band.is_pass ? null : 'total',
  };
}

/**
 * Term summary for one student's subjects (marksheet, guardian view).
 * Credit-weighted, as in the directive: GPA = sum(grade point x credit hours) / sum(credit hours).
 *  - Any NG or absent subject: status 'incomplete' ("Incomplete / Not Fully Graded"). GPA is withheld (null).
 *    NG counts as 0.00 in the arithmetic, so a plain AVG() is never used (SQL AVG skips NULL and would inflate it).
 *  - A subject with no credit hours: status 'not_calculable'. GPA is withheld.
 *  - Otherwise 'complete', and the GPA is returned to 2 decimals.
 * Confirm the formula and the status wording against the directive before go-live.
 */
export const TERM_STATUS_LABEL = Object.freeze({
  complete: 'Complete',
  incomplete: 'Incomplete / Not Fully Graded',
  not_calculable: 'Not calculable: credit hours missing',
  no_results: 'No results',
});

export function summarizeResults(rows) {
  if (rows.length === 0) {
    return { status: 'no_results', label: TERM_STATUS_LABEL.no_results, subjects: 0, ng_count: 0, absent_count: 0,
      missing_credit_count: 0, credit_total: 0, weighted_points: null, gpa: null, all_graded: false };
  }
  const ng_count = rows.filter(r => r.grade !== ABSENT_GRADE && !r.is_pass).length;
  const absent_count = rows.filter(r => r.grade === ABSENT_GRADE).length;
  const missing_credit_count = rows.filter(r => !(Number(r.credit_hours) > 0)).length;
  const credit_total = rows.reduce((acc, r) => acc + (Number(r.credit_hours) || 0), 0);
  const weighted = rows.reduce((acc, r) => acc + (r.is_pass ? (r.grade_point ?? 0) : 0) * (Number(r.credit_hours) || 0), 0);

  let status;
  if (ng_count > 0 || absent_count > 0) status = 'incomplete';
  else if (missing_credit_count > 0) status = 'not_calculable';
  else status = 'complete';

  const gpa = status === 'complete' ? Math.round((weighted / credit_total) * 100) / 100 : null;
  return {
    status, label: TERM_STATUS_LABEL[status], subjects: rows.length, ng_count, absent_count, missing_credit_count,
    credit_total, weighted_points: Math.round(weighted * 10000) / 10000, gpa, all_graded: status === 'complete',
  };
}
