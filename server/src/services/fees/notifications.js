// Fee notifications through the Phase 2 outbox. Called inside the payment transaction, so the payment and its
// notification are written together or not at all.
// Overpayment email is a mandatory fee notice: opt-outs do not block it (see MANDATORY_EVENT_KINDS in outbox.js).
// It still obeys the pause switch, the channel switch, and the monthly quota.
import db from '../../db/index.js';
import { enqueue, normalizeRecipient } from '../messaging/outbox.js';
import { overpaymentNotice } from './notices.js';

export const FEE_TEMPLATE_IDS = { overpayment: 'fees.overpayment.v1' };

/**
 * Queues the overpayment email to each guardian who may view the student's fees.
 * A guardian with no valid email is recorded as skipped_no_contact, so staff can see the gap.
 * A repeat for the same notice is ignored (dedupe key), so a retry cannot send twice.
 */
export function queueOverpaymentEmails({ noticeId, studentId, amount_paisa }) {
  const guardians = db.prepare(`
    SELECT DISTINCT u.id AS guardian_id, u.name, u.email
    FROM guardian_students gs JOIN users u ON u.id = gs.guardian_id
    WHERE gs.student_id = ? AND gs.can_view_fees = 1 AND gs.restricted = 0
      AND u.role = 'guardian' AND u.account_status = 'active'`).all(Number(studentId));
  const summary = { queued: 0, skipped_no_contact: 0, duplicate: 0 };
  for (const g of guardians) {
    const addr = normalizeRecipient('email', g.email);
    const msg = overpaymentNotice({ parentName: g.name, amount_paisa });
    const res = enqueue({
      channel: 'email', recipient: addr.ok ? addr.value : null, user_id: g.guardian_id, student_id: Number(studentId),
      template_id: FEE_TEMPLATE_IDS.overpayment, subject: msg.subject, body: msg.body,
      dedupe_key: `email|${addr.ok ? addr.value : `none:${g.guardian_id}`}|fee_notice|${Number(noticeId)}`,
      event_kind: 'fee_notice', contact_missing: !addr.ok,
    });
    if (!res.inserted) summary.duplicate++;
    else if (!addr.ok) summary.skipped_no_contact++;
    else summary.queued++;
  }
  return summary;
}
