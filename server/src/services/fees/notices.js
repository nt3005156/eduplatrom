// Parent-facing fee notices. Templates only: sending is not wired yet (see docs/PHASE3_STATUS.md, section 10.1).
import { formatNPR } from './money.js';

/**
 * Overpayment notice, in NPR. The user's wording, with the amount in NPR.
 * `refundUrl` is required. The "Click here" link must go to a live refund-preference page, so the template
 * refuses to render without one. That keeps a broken link from ever reaching a parent.
 */
export function overpaymentNotice({ parentName = null, amount_paisa, refundUrl }) {
  if (!Number.isSafeInteger(amount_paisa) || amount_paisa <= 0) throw new TypeError('amount_paisa must be a positive integer');
  if (!refundUrl || !/^https:\/\//.test(refundUrl)) {
    throw new Error('refundUrl must be an https link to the refund-preference page');
  }
  const amount = formatNPR(amount_paisa);
  return {
    subject: 'Overpayment credited to your account',
    body: [
      parentName ? `Dear ${parentName},` : 'Dear parent or guardian,',
      '',
      `An overpayment of ${amount} was detected and credited to your account. Click here if you prefer a direct refund to your original payment method: ${refundUrl}`,
      '',
      'Regards,',
      'School Finance Office',
    ].join('\n'),
  };
}
