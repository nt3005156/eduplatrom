// One place for password rules. Raise PASSWORD_MIN_LENGTH here, not per route.
// NIST SP 800-63B favours length over composition rules, so the policy is a
// minimum length plus a short list of trivially guessable values.
export const PASSWORD_MIN_LENGTH = 12;

const COMMON = new Set([
  'password1234', 'password12345', 'welcome12345', 'nitex1234567', 'admin1234567',
  'teacher12345', 'student12345', 'qwerty123456', '123456789012', 'changeme1234',
]);

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (COMMON.has(password.toLowerCase())) return 'That password is too common. Choose another.';
  return null;
}
