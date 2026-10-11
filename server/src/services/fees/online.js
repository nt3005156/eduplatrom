// Online payment through Khalti: start a payment, and confirm it when the browser returns.
//
// Trust rules:
//   1. The browser return carries query parameters (status, transaction_id). They are never trusted.
//      Only the pidx is used, to find our gateway row. The outcome comes from a server-to-server lookup.
//   2. Paid requires: lookup status 'Completed', total_amount equal to our gateway amount, and a
//      transaction id that no other attempt has used.
//   3. Idempotent. A second return for a completed attempt gives the same answer and writes nothing.
//   4. Concurrent returns: the lookups run in parallel, but the write re-reads the row inside one
//      synchronous transaction, so only one payment is created.
import { randomUUID } from 'crypto';
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { GatewayError, khaltiClient, khaltiConfig } from './khalti.js';
import { FeeError, paidTotal, postPayment, writeTx } from './ledger.js';

const selInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?');
const selGatewayByPidx = db.prepare('SELECT * FROM gateway_transactions WHERE pidx = ?');
const insGateway = db.prepare(`INSERT INTO gateway_transactions (provider, pidx, purchase_order_id, invoice_id, student_id, amount_paisa, status, initiated_by)
  VALUES ('khalti', ?, ?, ?, ?, ?, 'initiated', ?)`);

function publicBase() {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base.startsWith('https://') && !base.startsWith('http://localhost') && !base.startsWith('http://127.0.0.1')) {
    throw new GatewayError('not_configured', 'PUBLIC_BASE_URL must be set to the https address of the school portal');
  }
  return base;
}

/**
 * Starts a Khalti payment for an invoice balance (or part of it). Returns the payment URL for the browser to open.
 * @param {{invoice_id:number, amount_paisa?:number}} input
 * @param {{id:number, name?:string}} user - who is paying (for the audit log)
 * @param {object} req - for the audit log
 */
export async function startOnlinePayment(input, user, req) {
  const cfg = khaltiConfig();
  if (!cfg.configured) throw new GatewayError('not_configured', 'Online payment is not set up for this school yet');
  const base = publicBase();
  const inv = selInvoice.get(Number(input.invoice_id));
  if (!inv) throw new FeeError(404, 'Invoice not found');
  const balance = inv.net_paisa - paidTotal(inv.id);
  if (balance <= 0) throw new FeeError(409, 'Invoice has no balance to pay');
  const amount = input.amount_paisa === undefined ? balance : input.amount_paisa;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new FeeError(400, 'amount_paisa must be a positive whole number of paisa');
  if (amount > balance) throw new FeeError(409, `Amount is more than the balance of ${balance} paisa`);

  const purchaseOrderId = `NTX-${inv.id}-${randomUUID().slice(0, 8)}`;
  const student = db.prepare('SELECT name FROM users WHERE id = ?').get(inv.student_id);
  const response = await khaltiClient().initiate({
    return_url: `${base}/api/fees/khalti/return`,
    website_url: base,
    amount,
    purchase_order_id: purchaseOrderId,
    purchase_order_name: `${inv.invoice_no} ${inv.period}`.slice(0, 100),
    customer_info: { name: String(student?.name || 'Student').slice(0, 100) },
  });
  if (!response.pidx || !response.payment_url) throw new GatewayError('unavailable', 'Khalti did not return a payment link');

  const r = insGateway.run(response.pidx, purchaseOrderId, inv.id, inv.student_id, amount, user?.id ?? null);
  logAudit(req, { module: 'fees', action: 'online_payment_started', description: `Khalti attempt on ${inv.invoice_no}`,
    newValue: { gateway_id: Number(r.lastInsertRowid), amount_paisa: amount } });
  return { gateway_id: Number(r.lastInsertRowid), payment_url: response.payment_url, expires_at: response.expires_at || null, amount_paisa: amount };
}

/**
 * Confirms a Khalti return by looking the payment up at Khalti. Records the payment only if it is verified.
 * @returns {{outcome: string, payment_id?: number, receipt_no?: number, already?: boolean}}
 *   outcome: paid | pending | canceled | expired | amount_mismatch | duplicate_transaction | unknown_payment | unverified
 */
export async function verifyKhaltiReturn(pidx) {
  const key = String(pidx || '');
  if (!key || key.length > 100) return { outcome: 'unknown_payment' };
  const gw = selGatewayByPidx.get(key);
  if (!gw) return { outcome: 'unknown_payment' };
  if (gw.status === 'completed') {
    return { outcome: 'paid', already: true, payment_id: gw.payment_id, receipt_no: receiptFor(gw.payment_id) };
  }

  let look;
  try {
    look = await khaltiClient().lookup(key);
  } catch (err) {
    // Lookup failed. Do not change the attempt; the user can retry the return link. Counted in the ops summary.
    logAudit(null, { module: 'fees', action: 'lookup_unavailable', status: 'failure', description: 'Khalti lookup did not complete',
      actorOverride: { name: 'Khalti return', role: 'system' }, newValue: { gateway_id: gw.id, reason: err.code || 'error' } });
    return { outcome: 'unverified', reason: err.code || 'error' };
  }
  const providerStatus = String(look.status || '');
  db.prepare("UPDATE gateway_transactions SET provider_status = ?, updated_at = datetime('now') WHERE id = ?").run(providerStatus, gw.id);

  if (providerStatus !== 'Completed') {
    if (providerStatus === 'Expired' || providerStatus === 'User canceled') {
      const next = providerStatus === 'Expired' ? 'expired' : 'canceled';
      db.prepare("UPDATE gateway_transactions SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'initiated'").run(next, gw.id);
      return { outcome: next === 'expired' ? 'expired' : 'canceled' };
    }
    return { outcome: 'pending' };
  }

  if (Number(look.total_amount) !== gw.amount_paisa) {
    db.prepare("UPDATE gateway_transactions SET status = 'failed', failure_reason = 'amount_mismatch', updated_at = datetime('now') WHERE id = ? AND status = 'initiated'").run(gw.id);
    logAudit(null, { module: 'fees', action: 'online_payment_rejected', description: 'Khalti amount did not match the attempt',
      status: 'failure', actorOverride: { name: 'Khalti return', role: 'system' }, newValue: { gateway_id: gw.id, expected: gw.amount_paisa, got: look.total_amount } });
    return { outcome: 'amount_mismatch' };
  }
  const txnId = String(look.transaction_id || '');
  if (!txnId) return { outcome: 'unverified', reason: 'no_transaction_id' };

  return writeTx(() => {
    // Re-read inside the transaction. A concurrent return may have recorded this payment while we were waiting.
    const fresh = db.prepare('SELECT * FROM gateway_transactions WHERE id = ?').get(gw.id);
    if (fresh.status === 'completed') return { outcome: 'paid', already: true, payment_id: fresh.payment_id, receipt_no: receiptFor(fresh.payment_id) };
    const dup = db.prepare('SELECT id FROM gateway_transactions WHERE provider_transaction_id = ?').get(txnId);
    if (dup) {
      db.prepare("UPDATE gateway_transactions SET status = 'failed', failure_reason = 'duplicate_transaction', updated_at = datetime('now') WHERE id = ?").run(gw.id);
      return { outcome: 'duplicate_transaction' };
    }
    const inv = selInvoice.get(fresh.invoice_id);
    // Anything above the balance (the balance moved since the payment started) becomes credit, not a refused payment.
    const written = postPayment(inv, { amount: fresh.amount_paisa, method: 'khalti', reference: txnId, recordedBy: null });
    db.prepare(`UPDATE gateway_transactions SET status = 'completed', provider_transaction_id = ?, payment_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(txnId, written.payment_id, fresh.id);
    logAudit(null, { module: 'fees', action: 'online_payment_received', description: `Khalti payment verified on ${inv.invoice_no}`,
      actorOverride: { name: 'Khalti return', role: 'system' },
      newValue: { payment_id: written.payment_id, receipt_no: written.receipt_no, amount_paisa: fresh.amount_paisa, gateway_id: fresh.id, credit_added_paisa: written.credit_added_paisa } });
    return { outcome: 'paid', payment_id: written.payment_id, receipt_no: written.receipt_no, credit_added_paisa: written.credit_added_paisa };
  })();
}

function receiptFor(paymentId) {
  return db.prepare('SELECT receipt_no FROM receipts WHERE payment_id = ?').get(paymentId)?.receipt_no ?? null;
}
