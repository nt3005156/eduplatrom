import db from '../db/index.js';
import { schoolDate, daysBetweenDates } from './schoolTime.js';

// Phase 0: gamification is a per-school switch, off by default for pilots. When it is on, only students
// who are at least 13 earn XP and streaks. A student with no date of birth is excluded (fail closed).
export const GAMIFICATION_MIN_AGE = 13;

/** Age in whole years on a given day, from a YYYY-MM-DD date of birth. Returns 0 for anything unreadable. */
export function ageOn(dob, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  if (!m) return 0;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // "Today" is the school's calendar date, so the age does not change at the server's midnight.
  const [ty, tm, td] = schoolDate(today).split('-').map(Number);
  let age = ty - y;
  const beforeBirthday = tm < mo || (tm === mo && td < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function gamificationEligible(userId) {
  const school = db.prepare('SELECT gamification_enabled FROM settings WHERE id = 1').get();
  if (!school?.gamification_enabled) return false;
  const u = db.prepare('SELECT role, dob_ad FROM users WHERE id = ?').get(userId);
  if (!u || u.role !== 'student') return false;
  return ageOn(u.dob_ad) >= GAMIFICATION_MIN_AGE;
}

const XP_RULES = {
  material_view: 5,
  assignment_submit: 20,
  quiz_attempt: 10,
  quiz_perfect_bonus: 25,
};

function todayStr() {
  return schoolDate(); // YYYY-MM-DD in the school's timezone, so a streak day starts at school midnight
}

function daysBetween(a, b) {
  return daysBetweenDates(a, b);
}

/**
 * Award XP to a user and log the event. Returns the user's new xp/level info
 * plus whether this event triggered a level-up (for celebratory UI).
 */
export function awardXp(userId, reason, relatedType = null, relatedId = null) {
  const amount = XP_RULES[reason] ?? 0;
  if (amount <= 0) return null;
  if (!gamificationEligible(userId)) return null;

  const before = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
  if (!before) return null;
  const prevLevel = levelForXp(before.xp);

  db.prepare('INSERT INTO xp_events (user_id, amount, reason, related_type, related_id) VALUES (?,?,?,?,?)')
    .run(userId, amount, reason, relatedType, relatedId);
  db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);

  const after = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
  const newLevel = levelForXp(after.xp);

  return { xpAwarded: amount, totalXp: after.xp, leveledUp: newLevel.level > prevLevel.level, level: newLevel };
}

/**
 * Update a student's daily study streak. Call this once per "study action" per day
 * (e.g. viewing material, submitting an assignment, attempting a quiz).
 * Idempotent within a day — calling multiple times same day won't double count.
 */
export function touchStreak(userId) {
  if (!gamificationEligible(userId)) return null;
  const user = db.prepare('SELECT streak_count, longest_streak, streak_last_date FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const today = todayStr();
  if (user.streak_last_date === today) {
    // Already counted today
    return { streak_count: user.streak_count, longest_streak: user.longest_streak, isNewDay: false };
  }

  let newStreak;
  if (!user.streak_last_date) {
    newStreak = 1;
  } else {
    const gap = daysBetween(user.streak_last_date, today);
    newStreak = gap === 1 ? user.streak_count + 1 : 1; // consecutive day continues streak, otherwise resets
  }
  const newLongest = Math.max(newStreak, user.longest_streak || 0);

  db.prepare('UPDATE users SET streak_count = ?, longest_streak = ?, streak_last_date = ? WHERE id = ?')
    .run(newStreak, newLongest, today, userId);

  const isMilestone = [3, 7, 14, 30, 60, 100].includes(newStreak);

  return { streak_count: newStreak, longest_streak: newLongest, isNewDay: true, isMilestone };
}

// XP required to reach level N grows gradually: 100, 250, 450, 700, 1000, ...
const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];

export function levelForXp(xp) {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] ?? (currentThreshold + 1000);
  const progressPct = Math.min(100, Math.round(((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100));
  return { level, xp, currentThreshold, nextThreshold, progressPct };
}
