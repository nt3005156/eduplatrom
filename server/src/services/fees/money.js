// Money helpers for fee amounts shown to people. Amounts are stored as integer paisa (1 NPR = 100 paisa).
// All school amounts are in Nepalese rupees (NPR), with Nepali digit grouping (1,00,000.00).

const nprFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** formatNPR(500000) -> "NPR 5,000.00"; formatNPR(10000000) -> "NPR 1,00,000.00" */
export function formatNPR(paisa) {
  if (!Number.isSafeInteger(paisa)) throw new TypeError('formatNPR needs an integer amount in paisa');
  const sign = paisa < 0 ? '-' : '';
  return `${sign}NPR ${nprFormat.format(Math.abs(paisa) / 100)}`;
}

function intEnv(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number of paisa`);
  return n;
}

/**
 * Escalation tiers for billing issues and overpayments (in paisa):
 *   below `supervisor`             -> low: handled by front desk or finance operations, no escalation
 *   `supervisor` to `head`, incl.  -> medium: Finance Supervisor / Manager
 *   above `head`                   -> high: Head of Finance
 * Defaults: NPR 10,000 and NPR 50,000. The user confirmed these values.
 */
export function escalationTiers(env = process.env) {
  const supervisor = intEnv(env.FEES_TIER_SUPERVISOR_PAISA, 1000000, 'FEES_TIER_SUPERVISOR_PAISA');
  const head = intEnv(env.FEES_TIER_HEAD_PAISA, 5000000, 'FEES_TIER_HEAD_PAISA');
  if (head <= supervisor) throw new Error('FEES_TIER_HEAD_PAISA must be greater than FEES_TIER_SUPERVISOR_PAISA');
  return { supervisor, head };
}

/** Returns 'low', 'supervisor' (medium tier), or 'head_of_finance' (high tier). An unknown amount is treated as medium, so a person looks at it. */
export function tierFor(paisa, tiers = escalationTiers()) {
  if (paisa == null) return 'supervisor';
  if (paisa < tiers.supervisor) return 'low';
  if (paisa <= tiers.head) return 'supervisor';
  return 'head_of_finance';
}
