// Parent-facing overpayment notice, in NPR. Version 1 has no refund link: a direct bank refund goes through the accounts desk.
// The refund link is planned for version 2, once the refund workflow is tested.
// Sending is not wired yet: parent email must go through the outbox, which does not carry fee notices yet.
import { formatNPR } from './money.js';

export function overpaymentNotice({ parentName = null, amount_paisa }) {
  if (!Number.isSafeInteger(amount_paisa) || amount_paisa <= 0) throw new TypeError('amount_paisa must be a positive integer');
  const amount = formatNPR(amount_paisa);
  return {
    subject: 'Overpayment credited to your account',
    body: [
      parentName ? `Dear ${parentName},` : 'Dear parent or guardian,',
      '',
      `An overpayment of ${amount} was detected and credited to your account. The credit is applied automatically to your next fee invoice, and it is shown on your fee account.`,
      '',
      'If you need a direct bank refund or a physical refund instead, please contact the school accounts desk.',
      '',
      'Regards,',
      'School Finance Office',
      '',
      'This is an automated billing and financial balance notification regarding your institutional account.',
    ].join('\n'),
  };
}
