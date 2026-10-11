# Phase 3 status: fees, invoices, receipts, and online payment (Khalti)

Date: 2026-10-11. Roadmap section: [PRODUCTION_ROADMAP.md, Phase 3](PRODUCTION_ROADMAP.md#phase-3-fees-invoices-receipts-and-online-payment).

**Status: backend complete in code and tested (31 new tests, server suite 229 of 229). The phase exit gate is not met.** The gate needs a live Khalti merchant account (sandbox end to end), a month of real fee data reconciled to the penny at a pilot school, and a first paying school. None of these can be done from this environment. The parent-facing payment screen, the admin fee screens, and the receipt PDF are not built.

Khalti is the only gateway. It stays in `none` mode (no network calls, online payment refused with 503) until `KHALTI_SECRET_KEY` is set. eSewa is deferred, as decided.

---

## 1. What exists

| Area | File | What it does |
|---|---|---|
| Permissions | `server/src/db/seedRbac.js` | `fees.view`, `fees.collect`, `fees.manage` (staff roles, per matrix). `fees.approve_concession` and `fees.refund` are `admin_only`, hard-locked to the system admin in `hasPermission`. Academic head gets `fees.view` by default. |
| Schema | `server/src/db/schema.sql` | `fee_heads`, `fee_structures`, `invoices`, `invoice_items`, `concessions`, `payments` (append-only, triggers block UPDATE and DELETE), `receipts` (unique `receipt_no`), `gateway_transactions` (unique `pidx`, unique `provider_transaction_id`, unique `purchase_order_id`). |
| Ledger | `server/src/services/fees/ledger.js` | Fee heads and structures, invoice generation, concession rules, cash and bank payments, refunds, dues report, collection report, reconciliation. |
| Khalti client | `server/src/services/fees/khalti.js` | The only module that calls Khalti. Config from env. Fake client injectable for tests. |
| Online flow | `server/src/services/fees/online.js` | Starts a payment and verifies returns by server-side lookup. Records a payment only when the lookup confirms it. |
| Routes (staff) | `server/src/routes/fees.js`, mounted at `/api/fees` | Heads, structures, generate invoices, invoices, payments, refunds, concessions, dues and collection reports, reconcile, Khalti return. |
| Routes (guardian) | same file, mounted at `/api/guardian` | `GET /api/guardian/fees/invoices`, `GET /api/guardian/fees/invoices/:id`, `POST /api/guardian/fees/invoices/:id/pay-online`. Inside the existing guardian allowlist. |
| Tests | `server/test/fees.test.js` | 31 tests. Khalti is a fake. |

## 2. Configuration

| Variable | Purpose |
|---|---|
| `KHALTI_SECRET_KEY` | Sandbox or live secret key. Unset means online payment is off (503 `not_configured`). |
| `KHALTI_ENV` | `sandbox` (default) or `production`. Sandbox calls `dev.khalti.com`, production calls `khalti.com`. |
| `PUBLIC_BASE_URL` | Origin the browser returns to after paying. Must be `https://` (or localhost for development). Used for the return URL and `website_url`. |

No Khalti secret is written to a file, to git, or to logs.

## 3. Rules the code enforces (and the test that proves each one)

| Rule | Where | Test |
|---|---|---|
| Amounts are integer paisa. Floats, strings, zero, and negatives are refused. | `assertPaisa` in `ledger.js` | "fee structure is saved with integer paisa…", "cash and bank payments validate amounts…" |
| Duplicate Khalti returns (concurrent and repeated) create exactly one payment and one receipt. | `verifyKhaltiReturn`, re-read inside `writeTx` | "duplicate Khalti returns create exactly one payment and one receipt" |
| Amount mismatch between Khalti's total and our attempt is rejected. Nothing is recorded. | `verifyKhaltiReturn` | "amount mismatch between Khalti and the invoice is rejected…" |
| Provider status overrides a forged success. A return that says `Completed` but a lookup that says `Pending` records nothing. | `verifyKhaltiReturn` (only the lookup counts) | "provider status overrides a forged success in the return link" |
| Canceled and expired payments are recorded as such and write no payment. | `verifyKhaltiReturn` | "a user who cancels at Khalti…" |
| An unreachable lookup records nothing. A later return can still succeed. | `verifyKhaltiReturn` | "if the lookup is unreachable…" |
| A provider transaction id cannot be used by two attempts. | `verifyKhaltiReturn` plus a unique index | "a second attempt that reuses a provider transaction id…" |
| Payments are append-only at the database level. | triggers in `schema.sql` | "payments cannot be updated or deleted at the database level" |
| Receipt numbers have no gaps under concurrent payments. The number is taken in the same write transaction as the payment. | `writePaymentWithReceipt`, `writeTx` (BEGIN IMMEDIATE) | "receipt numbers have no gaps under concurrent payments" (12 parallel payments) |
| A concession needs a second person to approve it. The requester cannot approve their own request. Only the admin can approve. | `decideConcession`, `fees.approve_concession` | "a concession does nothing until a different person approves it", "the clerk cannot approve…" |
| A concession cannot take an invoice below what was already paid. The approval rolls back. | `recomputeInvoice` | "a concession cannot push an invoice below what was already paid…" |
| A concession must match a fee charged to the student's class for that period. | `requestConcession` | "a concession must match a fee charged to the student's class…" |
| Refunds reverse cleanly: a negative row linked to the payment, capped at what is refundable, partial allowed, admin only, audited. | `refundPayment` | "a refund reverses cleanly, can be partial, is capped, and is audited" |
| A Khalti refund also needs a refund in the Khalti dashboard. The API says so (`gateway_refund_required`). | `refundPayment` | "a Khalti payment refund tells the admin…" |
| Guardians see a child's fees only with `can_view_fees`, and pay only with `can_pay_fees`. Restricted guardians see nothing. | `accessibleLink` (existing helper) | "a guardian who can view but not pay…", "a restricted guardian sees no fees…" |
| Guardians cannot reach staff fee routes. | guardian allowlist in `middleware/auth.js` | "a guardian cannot reach the staff fee routes…" |
| Students see their own invoice and nothing else. | route check | "a student sees their own invoice…" |
| Online payment is refused with 503 and starts nothing when no key is set. | `startOnlinePayment` | "online payment is refused with 503…" |
| Invoice generation is idempotent. One invoice per student, session, and period. | UNIQUE constraint, `generateInvoices` | "invoices are generated per student…", "the same student and period cannot get two invoices…" |
| Dues aging: 0–30, 31–60, 61–90, 90+ days past due, using the school's date (Asia/Kathmandu). Future due dates are "not_due". | `bucketFor`, `duesReport` | "bucket boundaries…", "dues report ages open balances on the school date" |
| Collection rate by class. Overpayment is shown separately and not counted as collected. | `collectionReport` | "collection report gives a rate per class…" |
| Reconciliation lists every mismatch: payment without receipt, Khalti payment without gateway record, gateway amount mismatch, completed attempt without payment, and (when a provider settlement list is supplied) settlement without payment, amount mismatch, and payment missing from settlement. | `reconcile` | "reconciliation flags a settlement…", "a settlement that matches our records to the paisa…", "a payment with no receipt is reported…" |

Every money action writes an audit row (`module = 'fees'`): payment recorded, refund, online payment started, online payment received (system actor), rejected amounts, concession requested, approved, rejected, structure saved, invoices generated, fee head created.

## 4. API summary

Staff, under `/api/fees`:

| Method and path | Permission | Notes |
|---|---|---|
| GET `/heads` | `fees.view` | |
| POST `/heads` | `fees.manage` | `code` unique, `category` from the eight categories |
| GET `/structures?session_id&class_level` | `fees.view` | |
| PUT `/structures` | `fees.manage` | Body: `session_id`, `class_level`, `period`, `items[{fee_head_id, amount_paisa, due_date}]` |
| POST `/invoices/generate` | `fees.manage` | Body: `session_id`, `class_level`, `period`, optional `section`. Safe to re-run. |
| GET `/invoices?session_id&class_level&section&student_id&status` | `fees.view` | Each row has `paid_paisa`, `balance_paisa`, `status`, `days_past_due` |
| GET `/invoices/:id` | `fees.view`, or the student | Items, payments, receipts, online attempts (without `pidx`) |
| POST `/payments` | `fees.collect` | `invoice_id`, `amount_paisa`, `method` (`cash` or `bank`), `reference` (required for bank). Returns `receipt_no`. |
| POST `/payments/:id/refund` | `fees.refund` (admin) | `reason`, optional `amount_paisa` (default: all that is refundable) |
| GET `/concessions` | `fees.view` | |
| POST `/concessions` | `fees.manage` | Creates a request |
| POST `/concessions/:id/decision` | `fees.approve_concession` (admin) | `decision`: `approve` or `reject`. Requester cannot decide. |
| GET `/reports/dues?session_id&class_level&as_of` | `fees.view` | Buckets and rows. `as_of` defaults to today in Nepal. |
| GET `/reports/collection?session_id` | `fees.view` | Per class and total |
| POST `/reconcile` | `fees.view` | Body: `from`, `to`, optional `settlements[{provider_transaction_id, amount_paisa}]`. Returns `ok` and `mismatches`. |
| GET `/khalti/return?pidx=` | public | Khalti's browser return. Returns `{outcome, payment_id, receipt_no}`. Trusts only the lookup. |

Guardian, under `/api/guardian/fees`: see section 2 of the table above.

## 5. Verification

| Check | Result |
|---|---|
| `server/test/fees.test.js` | **31 of 31 pass.** Khalti is a fake client at the adapter seam. Concurrency is real (parallel HTTP requests). |
| Full server suite (`npm test`) | **229 of 229 pass** (198 before Phase 3, 31 new). Exit 0. |
| Syntax check of every new file | Pass |

The fake client is not a test of Khalti's real API. The field names and status strings in `khalti.js` and `online.js` come from public documentation and community guides. They are **not verified against a live merchant account** (see section 6).

## 6. Khalti assumptions to check before go-live

These came from the public docs and guides. Check each one against the Khalti merchant dashboard and the current API documentation.

1. Initiate: `POST /api/v2/epayment/initiate/` with `Authorization: Key <secret>`. Body fields: `return_url`, `website_url`, `amount` (paisa), `purchase_order_id`, `purchase_order_name`, `customer_info`. Response fields used: `pidx`, `payment_url`, `expires_at`.
2. Lookup: `POST /api/v2/epayment/lookup/` with `{pidx}`. Response fields used: `status`, `total_amount` (paisa), `transaction_id`.
3. Status strings used: `Completed` (paid), `Pending` (not yet), `Expired`, `User canceled`. Any other value is treated as not paid.
4. Minimum payment amount and any per-transaction maximum. The code does not enforce either, because the limit was not verified.
5. Whether Khalti sends a webhook. The code does not depend on one. It verifies on return. If the browser never returns, the payment is never recorded, so there is **no background sweep yet** that re-checks old `initiated` attempts (see section 7).
6. Refund: Khalti refunds are made in the Khalti dashboard. This code records the refund in the ledger only.

## 7. Not built, not met

| Item | Status |
|---|---|
| Sandbox end-to-end payment on Khalti | **Not met.** Needs a Khalti sandbox merchant account and a public HTTPS `PUBLIC_BASE_URL`. |
| Sample month reconciled to the penny | **Not met.** The reconcile function is built and tested with small data. A real month needs pilot data and the provider's settlement file. |
| Receipt PDF (Nepali and English) | **Not built.** Receipts exist as numbers in the database. No PDF is generated. Planned for a later round, as decided. |
| Parent-facing payment button and fee screens | **Not built.** The guardian API exists. No client page. |
| Admin fee screens (structures, invoice generation, collection, concession approval, dues) | **Not built.** API only. |
| Dues reminders through the Phase 2 outbox | **Not built.** Roadmap item. |
| Privacy export of payment history and erasure rules for financial records | **Not built.** Roadmap item. Anonymizing a student still keeps their invoices and payments (foreign keys stay), with the name removed from the user row. |
| Background sweep for `initiated` attempts that never returned | **Not built.** Needed before pilot. |
| Daily scheduled reconciliation job | **Not scheduled.** The report can be run through the API. A cron entry or a timer in `index.js` is still needed. |
| Settlement file import | **Not built.** Reconcile accepts a settlement list in the request body. A file upload and parser are needed once the vendor provides the format. |
| Gateway merchant approval and licence questions | **For counsel before go-live**, as the roadmap says. Not reviewed. |
| Phase 3 exit gate (first paying school, a month of reconciled data) | **Not met.** |

## 8. Design notes

- **Payments and receipts in one write transaction, taking the lock first** (`BEGIN IMMEDIATE`). The server runs one process on one SQLite file, so this is safe now. The rule still holds if a second process is ever added (Phase 7 moves to one database per school).
- **Refunds keep the original receipt.** A refund is a new negative row. Receipts are never edited, so the paper trail stays true.
- **Overpayment is possible** when a Khalti payment completes after the balance was reduced by a concession. The money is recorded and shown as overpaid, not refused. The concession rule prevents the reverse case (a concession that makes the invoice smaller than what was paid).
- **The return link is public** on purpose. A browser may arrive without a session cookie. The only thing the public route can do is confirm a payment that our lookup confirms. Repeating it is harmless.
- **Invoice due date** is the earliest due date among the fee lines for that period. Lines with later due dates are shown on the same invoice.
- **School dates.** Dues aging and the reconciliation date range use Asia/Kathmandu dates, not UTC.

## 9. Decisions still needed from the user

- Khalti sandbox merchant account and the production merchant application. Counsel review first.
- Whether an overpayment should be refunded automatically or kept as a credit for the next invoice.
- Whether bank deposits need a second approver, as concessions do.
- Whether the reconciliation runs daily and who receives the mismatch list.
