# Phase 3 status: fees, invoices, receipts, and online payment (Khalti)

Date: 2026-10-11. Roadmap section: [PRODUCTION_ROADMAP.md, Phase 3](PRODUCTION_ROADMAP.md#phase-3-fees-invoices-receipts-and-online-payment).

**Status: backend complete in code and tested. Server suite 241 of 241 (43 Phase 3 tests across two files). The phase exit gate is not met.** The three controls decided on 2026-10-11 are built (section 10). The gate needs a live Khalti merchant account (sandbox end to end), a month of real fee data reconciled to the penny at a pilot school, and a first paying school. None of these can be done from this environment. The parent-facing payment screen, the admin fee screens, and the receipt PDF are not built.

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
| Controls | `server/src/services/fees/dailyJob.js`, `ledger.js` (credit, deposits) | Bank deposit verification, overpayment credit, automatic refunds, daily reconciliation job, exceptions, dispatch. See section 10. |
| Tests | `server/test/fees.test.js` (31), `server/test/fees-controls.test.js` (12) | Khalti is a fake. The job takes a fixed `now`, so the tests do not depend on the clock. |

## 2. Configuration

| Variable | Purpose |
|---|---|
| `FEES_FINANCE_EMAILS`, `FEES_OPS_EMAILS`, `FEES_HEAD_FINANCE_EMAILS` | Comma-separated recipients for the daily job (section 10.3). |
| `FEES_ESCALATE_AMOUNT_PAISA` | Escalation threshold in paisa. Default 5000000 (NPR 50,000). Placeholder, to confirm. |
| `FEES_CREDIT_AUTO_REFUND_DAYS` | Days of no movement before credit is refunded automatically. Default 90. |
| `FEES_DAILY_JOB` | Set to `off` to stop the scheduled daily job. |
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
| POST `/payments` | `fees.collect` | `invoice_id`, `amount_paisa`, `method` (`cash` or `bank`), `reference` (required for bank). Cash posts at once and returns `receipt_no`. Bank returns `pending_verification` and posts nothing until verified (section 10). |
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
| Full server suite (`npm test`) | **241 of 241 pass** (198 before Phase 3, 43 new across two files). Exit 0. See section 10.4. |
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
| Daily scheduled reconciliation job | **Built and scheduled** (section 10). It runs in the 00:00–02:00 Nepal window. Real delivery still needs the email provider and recipient addresses to be configured. |
| Settlement file import | **Not built.** Reconcile accepts a settlement list in the request body. A file upload and parser are needed once the vendor provides the format. |
| Gateway merchant approval and licence questions | **For counsel before go-live**, as the roadmap says. Not reviewed. |
| Phase 3 exit gate (first paying school, a month of reconciled data) | **Not met.** |

## 8. Design notes

- **Payments and receipts in one write transaction, taking the lock first** (`BEGIN IMMEDIATE`). The server runs one process on one SQLite file, so this is safe now. The rule still holds if a second process is ever added (Phase 7 moves to one database per school).
- **Refunds keep the original receipt.** A refund is a new negative row. Receipts are never edited, so the paper trail stays true.
- **Overpayment is possible** when a Khalti payment completes after the balance was reduced by a concession. The excess is not refused. It is recorded as a payment, and the part above the balance moves to the student's credit (section 10). The concession rule prevents the reverse case (a concession that makes the invoice smaller than what was paid).
- **The return link is public** on purpose. A browser may arrive without a session cookie. The only thing the public route can do is confirm a payment that our lookup confirms. Repeating it is harmless.
- **Invoice due date** is the earliest due date among the fee lines for that period. Lines with later due dates are shown on the same invoice.
- **School dates.** Dues aging and the reconciliation date range use Asia/Kathmandu dates, not UTC.

## 9. Decisions (answered 2026-10-11)

The user answered three open questions: how to handle overpayments, whether bank deposits need a second approver (and concessions already did), and whether reconciliation runs daily with mismatch alerts. The answers are built in section 10. The open points are listed at the end of section 10.

## 10. Controls built after the user's answers

### 10.1 Overpayment: credit by default, explicit refund, automatic refund rules

- **Default: account credit.** An amount above an invoice balance is recorded as a payment, and the excess becomes credit on the student's account (`credit_ledger`, kind `credit`). The credit ledger is append-only (triggers).
- **Applied to future invoices automatically.** When a new invoice is generated for a student with credit, the credit is applied up to that invoice's balance (`credit_applied_paisa` on the invoice). Credit is **not** applied to invoices that already exist. The user asked for future invoices. An admin or fee clerk can apply credit to an existing invoice with `POST /api/fees/invoices/:id/apply-credit`.
- **Explicit refund.** `POST /api/fees/students/:id/credit/refund` (admin only, `fees.refund`). It needs a bank transfer or cheque reference, and it is capped at the credit balance.
- **Automatic refund, two rules** (daily job):
  1. The student's account is archived or disabled: refund the whole credit balance.
  2. The credit has not moved for 90 days (`FEES_CREDIT_AUTO_REFUND_DAYS`, default 90). "Moved" means any credit or application row. The clock restarts when credit is applied, so a partial application keeps the rest of the credit alive.
  An automatic refund carries no bank reference. Finance must record the payout reference before the money leaves. The job's finance report lists these refunds.
- **Settlement rule.** An invoice's settled amount is its payments, minus the part of a payment that became credit, minus the credit applied to it. Payments and credit are never counted twice. A test caught an earlier version that did count them twice.
- **Not built:** the customer notification ("An overpayment of X was detected… click here for a direct refund"). It needs a parent-facing email template, and the Phase 2 outbox cannot send it yet. A refund-preference link is also not built.

### 10.2 Bank deposits: verified by a second person

- A bank deposit is recorded as `bank_deposits` with status `pending`. It posts **no payment** until verified. The reference is unique, so the same slip cannot be recorded twice.
- A person with `fees.verify_deposit` verifies it: `POST /api/fees/deposits/:id/decision` with `approve` or `reject` and an optional note. Approval posts the payment and its receipt. Rejection posts nothing, and a decided deposit cannot be decided again.
- The person who recorded a deposit cannot verify it (403). The permission is not granted by default. The system admin has it, and the finance manager needs it granted in the permissions matrix.
- **Cash is not under this control.** Cash posts at once, as before. The user's answer covered bank deposits only. Section 10.5 asks whether cash should be included.
- **Automated bank feeds and gateway payments are exempt**, as the user answered. Khalti payments post only after the server-side lookup (section 3). No bank statement feed exists yet, so the reconciliation does not compare against bank statements. It compares against Khalti settlements, when a settlement list is supplied.

### 10.3 Daily reconciliation job, exceptions, and dispatch

- **When.** The job checks every 10 minutes. It acts only between 00:00 and 02:00 Asia/Kathmandu, and only once per school date (`fee_job_runs`). A manual run is available at `POST /api/fees/jobs/daily/run` (`fees.manage`). It still runs only once per school date. `FEES_DAILY_JOB=off` disables the schedule.
- **What it reconciles.** Yesterday's school date: payments, Khalti attempts, and receipts. Missing or mismatched items become **exceptions** (`reconciliation_exceptions`). Each mismatch is one row, however many runs see it. An exception stays **open** until a person resolves it with a note (`POST /api/fees/reconciliation/exceptions/:id/resolve`). Nothing closes an exception automatically.
- **Who gets what** (recipients are set by env, comma-separated):
  - `FEES_FINANCE_EMAILS` (Finance and AR): the full itemized list of open exceptions, the day's totals, and the automatic refunds.
  - `FEES_OPS_EMAILS` (System Admin and Ops): a summary. Payments and totals, mismatch count, open count, escalations, provider lookup failures, and automatic refunds.
  - `FEES_HEAD_FINANCE_EMAILS` (Head of Finance): escalations only.
- **Escalation.** An open exception escalates to the Head of Finance once, when it is **over the threshold** (`FEES_ESCALATE_AMOUNT_PAISA`, default **5,000,000 paisa = NPR 50,000**) or when it has been **open for 48 hours** (first seen two school dates ago or earlier). **The user did not give a threshold, so the NPR 50,000 default is a placeholder to confirm.**
- **Dispatch is recorded honestly.** Each send is a row in `fee_dispatches` with its real status: `sent`, `simulated` (email mode `log`), `held` (no provider configured, or no recipient address), or `failed` (with the error). With no Head of Finance address set, escalations are recorded as `held`, not dropped. The email provider is `MESSAGING_EMAIL_PROVIDER` (`smtp` with the SMTP settings from Phase 2). The default outside production is `log`, which sends nothing.
- **Unhandled API errors.** The ops summary counts Khalti lookups that failed (each is an audit row, `lookup_unavailable`). Other errors are not counted.
- **Not built:** a settlement file import (Khalti's settlement format is not known), and a bank statement feed. The job runs the settlement check only when a settlement list is supplied, and the report says so when it is skipped.

### 10.4 Verification

| Check | Result |
|---|---|
| `server/test/fees-controls.test.js` | **12 of 12 pass.** Deposit pending state, maker-checker, reject, overpayment to credit and application to the next invoice, explicit refund rules, automatic refunds (closed account and 90 days), job window, once per date, exception creation and escalation by threshold and by 48 hours, resolution with a note. |
| `server/test/fees.test.js` | **31 of 31 pass** (updated: bank payments now go through verification). |
| Full server suite (`npm test`) | **241 of 241 pass**, exit 0. |

### 10.5 Decisions still needed from the user

1. **Escalation threshold.** The default is NPR 50,000. Confirm the real amount.
2. **Cash.** Should cash receipts also need a second person? Cash is the riskiest form of money at a school counter. It is posted at once for now.
3. **Recipients.** The Finance, Ops, and Head of Finance email addresses for each school.
4. **Email provider.** Gmail or another SMTP service for these internal reports. Gmail needs an app password or OAuth, and it is not configured here.
5. **Customer overpayment notice.** The wording and channel (email, SMS, or the portal), and whether the refund link is part of the first release.

### 10.6 New endpoints

| Method and path | Permission | Notes |
|---|---|---|
| GET `/api/fees/deposits?status=` | `fees.view` | Pending, posted, or rejected bank deposits |
| POST `/api/fees/deposits/:id/decision` | `fees.verify_deposit` | `approve` or `reject`. Not the recorder. |
| GET `/api/fees/students/:id/credit` | `fees.view` | Credit balance and every credit row |
| POST `/api/fees/students/:id/credit/refund` | `fees.refund` (admin) | `reason`, `reference` (required), optional `amount_paisa` |
| POST `/api/fees/invoices/:id/apply-credit` | `fees.collect` | Applies available credit to an existing invoice |
| GET `/api/fees/reconciliation/exceptions?status=open\|resolved` | `fees.view` | |
| POST `/api/fees/reconciliation/exceptions/:id/resolve` | `fees.manage` | `note` of 3 to 500 characters. Audited. |
| POST `/api/fees/jobs/daily/run` | `fees.manage` | Runs the daily job now. Still once per school date. |

