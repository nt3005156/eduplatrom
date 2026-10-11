# Phase 3 status: fees, invoices, receipts, and online payment (Khalti)

Date: 2026-10-11. Roadmap section: [PRODUCTION_ROADMAP.md, Phase 3](PRODUCTION_ROADMAP.md#phase-3-fees-invoices-receipts-and-online-payment).

**Status: backend complete in code and tested. Server suite 259 of 259 (exit 0). The phase exit gate is not met.** The controls decided on 2026-10-11 and 2026-10-12 are built (section 10): dual control, overpayment credit and its email, tiered reconciliation and the daily sign-off queue, EmpID on receipts, concession tiers, and the receipt PDF (English). The guardian dashboard shows credit and notices (client build passes; not yet tested in a browser). The gate needs a live Khalti merchant account (sandbox end to end), a month of real fee data reconciled to the penny at a pilot school, a first paying school, and a real SMTP test send with the App Password. None of these can be done from this environment. The parent payment button, the admin fee screens, and the sign-off screen are not built.

Khalti is the only gateway. It stays in `none` mode (no network calls, online payment refused with 503) until `KHALTI_SECRET_KEY` is set. eSewa is deferred, as decided.

---

## 1. What exists

| Area | File | What it does |
|---|---|---|
| Permissions | `server/src/db/seedRbac.js` | `fees.view`, `fees.collect`, `fees.manage` (staff roles, per matrix). New roles: `finance_officer` (view and verify, no collect) and `lead_cashier` (view and collect, no verify). `fees.approve_concession` and `fees.refund` are `admin_only`, hard-locked to the system admin in `hasPermission`. Academic head gets `fees.view` by default. |
| Schema | `server/src/db/schema.sql` | `fee_heads`, `fee_structures`, `invoices`, `invoice_items`, `concessions`, `payments` (append-only, triggers block UPDATE and DELETE), `receipts` (unique `receipt_no`), `gateway_transactions` (unique `pidx`, unique `provider_transaction_id`, unique `purchase_order_id`), `payment_verifications`, `credit_ledger` (append-only), `fee_job_runs`, `reconciliation_exceptions`, `fee_dispatches`, `fee_notices` (in-app overpayment notices), `fee_daily_signoffs` (daily audit sign-off). `message_outbox` has the `event_kind` `fee_notice` and the per-row `mandatory` flag. Staff numbers are the `employee_no` column on `users`, snapshotted on the rows above. |
| Ledger | `server/src/services/fees/ledger.js` | Fee heads and structures, invoice generation, concession rules, cash and bank payments, refunds, dues report, collection report, reconciliation. |
| Khalti client | `server/src/services/fees/khalti.js` | The only module that calls Khalti. Config from env. Fake client injectable for tests. |
| Online flow | `server/src/services/fees/online.js` | Starts a payment and verifies returns by server-side lookup. Records a payment only when the lookup confirms it. |
| Routes (staff) | `server/src/routes/fees.js`, mounted at `/api/fees` | Heads, structures, generate invoices, invoices, payments, refunds, concessions, dues and collection reports, reconcile, Khalti return. |
| Routes (guardian) | same file, mounted at `/api/guardian` | `GET /api/guardian/fees/invoices`, `GET /api/guardian/fees/invoices/:id`, `POST /api/guardian/fees/invoices/:id/pay-online`. Inside the existing guardian allowlist. |
| Controls | `server/src/services/fees/dailyJob.js`, `ledger.js`, `money.js`, `notices.js`, `notifications.js`, `signoff.js`, `receiptPdf.js` | Dual control for cash and bank, overpayment credit, automatic refunds, daily reconciliation job, tiered escalation, daily sign-off queue, NPR formatting, overpayment notice and email, receipt PDF. See section 10. |
| Guardian banner | `client/src/pages/guardian/FeeAlerts.jsx`, used by `GuardianHome.jsx` | Shows each linked child's credit balance and unread fee notices, with a "Got it" action. |
| SMTP check | `server/scripts/smtp-check.js` (`npm run smtp:check -- <address>`) | Sends one test message through the real relay settings and prints the result. See section 10.3. |
| Tests | `server/test/fees.test.js` (31), `server/test/fees-controls.test.js` (21), `server/test/fees-policy.test.js` (5), `server/test/smtp-check.test.js` (3) | Khalti is a fake. The job takes a fixed `now`, so the tests do not depend on the clock. The SMTP check runs against a local SMTP server. |

## 2. Configuration

| Variable | Purpose |
|---|---|
| `FEES_FINANCE_EMAILS`, `FEES_OPS_EMAILS`, `FEES_HEAD_FINANCE_EMAILS` | Comma-separated recipients for the daily job (section 10.3). |
| `FEES_SUPERVISOR_EMAILS` | Finance Supervisor / Manager, for medium-tier escalations (NPR 10,000 to 50,000). |
| `FEES_TIER_SUPERVISOR_PAISA` | Start of the medium tier, in paisa. Default 1000000 (NPR 10,000). |
| `FEES_TIER_HEAD_PAISA` | Start of the high tier, in paisa. Default 5000000 (NPR 50,000). |
| `FEES_CONCESSION_HIGH_PAISA` | Concessions above this amount, in paisa, need the Finance Manager. Default 500000 (NPR 5,000). Must be a whole number of paisa, or startup fails. |
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
| POST `/payments` | `fees.collect` | `invoice_id`, `amount_paisa`, `method` (`cash` or `bank`), `reference` (required for bank). Both return `pending_verification` with a `DRAFT-n` number. Nothing posts, and no receipt number is issued, until a second person finalizes it (section 10.2). |
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
| Full server suite (`npm test`) | **259 of 259 pass**, exit 0. Includes the Phase 3 files listed in section 1. See section 10.4. |
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
| Receipt PDF in Nepali | **Not built.** The receipt PDF is built in English only (`GET /api/fees/receipts/:receiptNo/pdf` for staff, and the guardian route). The Nepali version needs a font decision and native-speaker review. |
| Parent-facing payment button and fee screens | **Not built.** The guardian API exists. The dashboard banner (credit and notices) is built, but there is no payment button or invoice page yet. |
| Admin sign-off screen | **Not built.** The Finance Manager's daily queue is API only (`GET /api/fees/signoffs`). |
| Real SMTP test send | **Not run.** Needs the App Password in the server `.env`. Run `npm run smtp:check -- <address>` and report the output. |
| Admin fee screens (structures, invoice generation, collection, concession approval, dues) | **Not built.** API only. |
| Dues reminders through the Phase 2 outbox | **Not built.** Roadmap item. |
| Privacy export of payment history and erasure rules for financial records | **Not built.** Roadmap item. Anonymizing a student still keeps their invoices and payments (foreign keys stay), with the name removed from the user row. |
| Background sweep for `initiated` attempts that never returned | **Not built.** Needed before pilot. |
| Daily scheduled reconciliation job | **Built and scheduled** (section 10). It runs in the 00:00–02:00 Nepal window. Real delivery still needs the email provider, the recipient addresses, and the aliases to exist. |
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

The user answered four questions: overpayments (credit, with a refund on request), second approval for bank deposits, a daily reconciliation with alerts, and on 2026-10-12 the currency (NPR), the escalation tiers, dual control for cash, and the alias addresses. The answers are built in section 10. The open points are listed at the end of section 10.

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
- **Notice wording and currency (NPR, confirmed by the user).** Version 1 has **no refund link**. Its wording: "An overpayment of NPR 2,500.00 was detected and credited to your account." It goes on to say the credit is applied to the next fee invoice, and that a direct bank refund or physical refund is handled by contacting the school accounts desk. The template is `overpaymentNotice` in `services/fees/notices.js`. The refund link is planned for version 2.
- **Channels (the user's answer).** Two channels:
  - **In-app notice (built).** Each overpayment writes a row to `fee_notices`. `GET /api/guardian/fees/alerts` lists, for each linked child, the credit balance and the unseen notices, with the message text. `POST /api/guardian/fees/notices/:id/seen` marks a notice seen. The guardian dashboard shows them in a banner (`FeeAlerts.jsx`), with a "Got it" button that marks the notice seen. The client build passes; the banner has not been checked in a browser.
  - **Email (built, through the outbox).** Each overpayment queues one email per guardian who may view fees. The row is written in the same database transaction as the payment, so the payment and its notice are saved together or not at all. Event kind `fee_notice`, template `fees.overpayment.v1` (registered in `TEMPLATE_IDS`, `services/messaging/templates.js`), subject "Overpayment credited to your account". The guardian gets the NPR amount and the accounts-desk wording, with no link.
  - **Mandatory, as approved on 2026-10-12.** Opt-outs do not block a row whose `mandatory` flag is set. The flag is a column on `message_outbox`, and the overpayment email sets it explicitly. `enqueue` refuses the flag on any kind other than `fee_notice`. The send-time opt-out check still runs for every other row, so attendance and notice messages still honor opt-outs. The notice still obeys the pause switch, the email channel switch, and the monthly quota. A queued notice not sent within 72 hours expires (the outbox rule). The in-app notice stays. A guardian with no valid email is recorded as `skipped_no_contact`. A repeat for the same notice is ignored by the dedupe key.
  - **Counsel to confirm** that a mandatory exemption from opt-outs is acceptable for each market before go-live.
- **Credit is shown** on each invoice (`credit_balance_paisa` in the invoice detail), on the guardian alerts, and on the guardian dashboard.
- **Not built:** the refund-preference page and the link in the email (version 2).

### 10.2 Dual control: cash and bank payments need a second person

- **Both cash and bank** go to a verification queue (`payment_verifications`) at the counter. The counter staff member records the money and receives a draft number (`DRAFT-n`). No payment posts and no receipt number is issued yet.
- A second person finalizes it with `POST /api/fees/verifications/:id/decision` (`approve` or `reject`, with an optional note). They need `fees.verify_payment`. Approval posts the payment and issues the next gap-free receipt number. Rejection posts nothing, and a decided item cannot be decided again.
- **The counter person cannot finalize their own item** (403). Both user IDs and names are kept on the row, and the audit entry `payment_verified` records `recorded_by` and `verified_by`.
- **Bank references are unique.** The same slip cannot be recorded twice. Cash has no reference, so duplicate cash entries are caught by the second person, not by the system.
- **Automated bank feeds and gateway payments are exempt**, as the user answered. Khalti payments post only after the server-side lookup (section 3).
- **Who holds `fees.verify_payment`.** Granted by default to the **Finance Officer** role (`finance_officer`) only. Verification is kept apart from recording: the **Lead Cashier** (`lead_cashier`) records cash and bank money, and the Finance Officer verifies it. The Finance Officer has no `fees.collect`. The **Finance Manager** (`finance_manager`) approves high-value concessions (10.7). The Finance Manager signs off each day (`fees.signoff_daily`, section 10.3). The system admin keeps all fee permissions, as before.
- **Staff numbers (EmpID), built.** Each staff account can have a unique staff number (`users.employee_no`, 1 to 20 letters, digits, or hyphens, stored uppercase). Only the system admin sets it: `PUT /api/fees/staff/:id/employee-no`. Students and guardians cannot have one. The number is **snapshotted** when a row is written: on payments, credit rows, verification rows (recorder and decider), reconciliation resolutions, and the audit log. A later change does not rewrite older rows, so an old receipt keeps the number it was printed with. An account without a number prints as `Name (no staff number)`.
- **Receipts show who processed them.** `GET /api/fees/receipts/:receiptNo` (`fees.view`) returns the receipt with `processed_by` (`EMP-014 / Name`) and `verified_by`. The receipt PDF prints the same "Processed by" line (and "Verified by" when there is a second person). The PDF also has the student details, the fee breakdown, and the transaction status.
- **Not built:** a printed draft receipt. The `DRAFT-n` number is shown in the API response only.

### 10.3 Daily reconciliation, tiered escalation, and dispatch

- **When.** The job checks every 10 minutes. It acts only between 00:00 and 02:00 Asia/Kathmandu, and only once per school date (`fee_job_runs`). A manual run is available at `POST /api/fees/jobs/daily/run` (`fees.manage`), and it still runs only once per school date. `FEES_DAILY_JOB=off` disables the schedule.
- **What it reconciles.** Yesterday's school date: payments, Khalti attempts, and receipts. Missing or mismatched items become **exceptions** (`reconciliation_exceptions`). Each mismatch is one row, however many runs see it. An exception stays **open** until a person resolves it with a note (`POST /api/fees/reconciliation/exceptions/:id/resolve`). Nothing closes an exception automatically.
- **Tiers** (amounts in NPR; the user confirmed these values):

| Tier | Amount | Who is told | Escalation level |
|---|---|---|---|
| Low | below NPR 10,000 | Finance and Ops reports only | none. Front desk and finance operations handle it. |
| Medium | NPR 10,000 to NPR 50,000 (both included) | Finance Supervisor / Manager | `supervisor` |
| High | above NPR 50,000 | Head of Finance | `head_of_finance` |

- **48-hour rule.** An open exception that is 48 hours old goes to the Head of Finance, whatever its amount. Levels only go up. An exception already sent to the supervisor goes to the Head of Finance later, when it is 48 hours old.
- **Overpayments** are escalated by the same tiers on the day they occur. They are not stored as exceptions, so they appear in the escalation message for that day.
- **Who gets what** (recipients are set by env, comma-separated):
  - `FEES_FINANCE_EMAILS` (Finance and AR): the full itemized list of open exceptions, the day's overpayments, and the automatic refunds.
  - `FEES_OPS_EMAILS` (System Admin and Ops): a summary. Payments, mismatch count, open count, escalations by level, provider lookup failures, and automatic refunds.
  - `FEES_SUPERVISOR_EMAILS`: medium-tier items.
  - `FEES_HEAD_FINANCE_EMAILS`: high-tier items and 48-hour items.
- **Dispatch is recorded honestly.** Each send is a row in `fee_dispatches` with its real status: `sent`, `simulated` (email mode `log`), `held` (no provider configured, or no recipient address), or `failed` (with the error). A missing recipient list is recorded as `held`, not dropped. Outside production the default is `log`, which sends nothing.
- **Email transport: Google Workspace SMTP relay.** Set these in the server environment, never in the repository:

```
MESSAGING_EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_FROM=notifications@ranidevi.edu.np
SMTP_USER=notifications@ranidevi.edu.np
SMTP_PASS=<16-character app password>
```

  - **App Password (the user's recommendation, 2026-10-12).** (1) Turn on 2-Step Verification for `notifications@ranidevi.edu.np`. (2) Create an App Password for that account in the Google Account security settings. Copy the 16 characters once. (3) Set it as `SMTP_PASS` in the server `.env`. Never commit it, and never paste it into chat. The code sends with `SMTP_USER` and `SMTP_PASS` (`services/messaging/providers.js`).
  - **Admin console settings** (Google Admin, Apps, Google Workspace, Gmail, Routing, SMTP relay service):
    - *Allowed senders:* "Only addresses in my domains". The From address is on `ranidevi.edu.np`.
    - *Authentication:* check "Require SMTP Authentication". Google's help page says this option checks "the user Google Workspace email address and password". The page does not say App Passwords are accepted here. This is the one step that must be proven by a test send.
    - *Encryption:* check "Require TLS encryption". The code also refuses to send without STARTTLS on port 587.
  - **Test before go-live.** Send a test from the admin messaging page or `POST /api/messages/test` with `{ "channel": "email", "recipient": "<an address you own>" }`. Status `sent` means the relay accepted the message. `failed` with "SMTP login rejected" means the App Password was not accepted. The fallback is "Only accept mail from the specified IP addresses" with the server's static outbound IP. Then leave `SMTP_USER` and `SMTP_PASS` unset.
  - **Source.** Google Workspace Help, "Route outgoing SMTP relay messages through Google" (support.google.com/a/answer/2956491, now hosted at knowledge.workspace.google.com). Read on 2026-10-12. This replaces the earlier third-party guides as the basis for these steps.
  - **Not verified here:** a real relay exchange, and whether the App Password is accepted by the relay. The tests run against a local SMTP server.
- **Daily sign-off queue (built, API only).** The daily job creates one sign-off row per reconciled school date, inside the same claimed run, so a retry does not create a second one. The row holds the day's summary: payments, receipts, open exceptions, pending verifications, and automatic refunds. The Finance Manager (`fees.signoff_daily`) reads it at `GET /api/fees/signoffs` and decides with `POST /api/fees/signoffs/:id/decision` (`sign_off` or `return`). Returning needs a note of at least 3 characters. Signing off a day with open exceptions or pending verifications needs one too. A decided day cannot be decided again (409).
- **SMTP check (built).** `npm run smtp:check -- <address>` (in `server/`) sends one test message through the configured relay. Exit 0 means the relay accepted it. Exit 1 means it refused (a hint is printed). Exit 2 means SMTP is not configured or no address was given. It prints the relay response and never the password. This is the test to run before go-live.
- **Unhandled API errors.** The ops summary counts Khalti lookups that failed (each is an audit row, `lookup_unavailable`). Other errors are not counted.
- **Amounts in every report** use NPR with Nepali grouping, for example `NPR 1,00,000.00` (`services/fees/money.js`).
- **Not built:** a settlement file import (Khalti's settlement format is not known), and a bank statement feed. The settlement check runs only when a settlement list is supplied, and the report says so when it is skipped.

### 10.4 Verification

| Check | Result |
|---|---|
| `server/test/fees-controls.test.js` | **21 of 21 pass.** Covers concession tiers (the Finance Officer approves a standard concession, the Finance Manager approves a high-value one, the system admin approves one only as the recorded fallback, rejection allowed, the audit entry records the tier), the overpayment email (queued as a mandatory notice, sent despite a guardian opt-out, attendance opt-out still holds, the mandatory flag is refused on other kinds, no-address and duplicate cases), the receipt PDF (staff and guardian access, and the text on it), and the daily sign-off (return needs a note, a decided day cannot be decided again). Earlier: staff numbers, Finance Officer separation, receipts, guardian in-app notices. |
| `server/test/smtp-check.test.js` | **3 of 3 pass.** Real SMTP exchange against a local server: accepted, refused, and not configured. |
| `server/test/fees.test.js` | **31 of 31 pass.** Cash and bank now finalize through verification. The concurrency test finalizes 12 cash items at once and checks that receipt numbers have no gaps. |
| `server/test/fees-policy.test.js` | **5 of 5 pass.** NPR formatting with lakh grouping, tier boundaries and configuration, the overpayment notice wording (NPR, no link in version 1) and its amount check. |
| Full server suite (`npm test`) | **259 of 259 pass**, exit 0. |
| Client build | `vite build` in `client/`, exit 0 (includes `FeeAlerts.jsx`). |
| Migrations on a copy of the existing dev database | The staff-number columns are added. The outbox table is rebuilt once to accept `fee_notice`, with every row kept and both indexes restored. The `mandatory` column is then added. A second boot is clean. |
| Migration on an existing database | The new staff-number columns are added to a copy of the dev database with its data intact, and a second boot is clean. |
| Schema | `schema.sql` executes on a fresh SQLite file: the 15 fee tables and the outbox table, with 4 triggers (the append-only rules). Checked again after the `mandatory` change. |

Test note: the overpayment tests write with the real clock, so an earlier overpayment can fall on the same school date as a test run. The escalation test counts those first, so it does not depend on the date.

### 10.5 Decisions

Answered (2026-10-12):
- **Domain and aliases:** `ranidevi.edu.np`. `finance.ops@`, `operations@`, `head.finance@`, and `finance.supervisor@` for the Finance Supervisor. Please confirm the last one. The aliases must exist as Google Groups before they receive mail.
- **Finance Officer** holds `fees.verify_payment`. **Lead Cashier** records. **Finance Manager** approves high-value concessions.
- **EmpID** on each staff account, on receipts, and in the audit trail.
- **Overpayment notice:** in-app and by email, with no refund link in version 1. Email is mandatory (no opt-out) and goes through the outbox.
- **SMTP:** App Password, with the verification step in section 2.
- **Concession tiers:** standard at or below NPR 5,000 is approved by the Finance Officer or system admin. Above NPR 5,000 needs the Finance Manager, with the system admin as fallback (10.7). The NPR 5,000 value and the basis (the concession amount, not the invoice total) are **provisional** until the user confirms them.

Decided and built:
- **System admin fallback** for high-value concessions, when the Finance Manager is unavailable. Recorded in the audit entry (`fallback_approver`).
- **Finance Manager daily sign-off.** Built as a queue of daily summaries (10.3). A sign-off screen is not built.
- **Guardian banner** on the dashboard (10.1). The API is there, and the banner is built but not yet tested in a browser.

Still open:
1. **Counsel.** Confirm that the mandatory notice (no opt-out) is acceptable in each market.
2. **SMTP test.** Run `npm run smtp:check -- <address>` in `server/` with the App Password in `.env`, and report the output. If the App Password is rejected, use IP allowlisting instead, as the user has said.
3. **Concession threshold.** Confirm NPR 5,000 and that the basis is the concession amount.
4. **Sign-off screen.** Confirm whether the Finance Manager reviews the daily queue in the app, or whether a printed or emailed summary is needed too.

### 10.6 New endpoints

| Method and path | Permission | Notes |
|---|---|---|
| GET `/api/fees/verifications?status=&method=` | `fees.view` | Cash and bank payments: pending, posted, or rejected |
| POST `/api/fees/verifications/:id/decision` | `fees.verify_payment` | `approve` or `reject`. Not the person who recorded it. |
| GET `/api/fees/students/:id/credit` | `fees.view` | Credit balance and every credit row |
| POST `/api/fees/students/:id/credit/refund` | `fees.refund` (admin) | `reason`, `reference` (required), optional `amount_paisa` |
| POST `/api/fees/invoices/:id/apply-credit` | `fees.collect` | Applies available credit to an existing invoice |
| GET `/api/fees/reconciliation/exceptions?status=open\|resolved` | `fees.view` | |
| GET `/api/fees/concessions?status=&tier=standard\|high` | `fees.view` | Each row has `tier`. High means above `FEES_CONCESSION_HIGH_PAISA`. |
| POST `/api/fees/concessions/:id/decision` | `fees.approve_concession`, plus `fees.approve_concession_high` to approve above the threshold (the system admin passes as fallback) | `approve` or `reject`. The requester cannot approve their own. Approving a high-value one as the admin is recorded as `fallback_approver`. |
| GET `/api/fees/receipts/:receiptNo` | `fees.view` | Receipt with `processed_by` and `verified_by` (EmpID / name) |
| GET `/api/fees/receipts/:receiptNo/pdf` | `fees.view` | Receipt PDF (English) |
| GET `/api/guardian/fees/receipts/:receiptNo/pdf` | guardian (`can_view_fees`) | Receipt PDF for a linked child only |
| GET `/api/fees/signoffs` | `fees.view` | Daily sign-off queue |
| POST `/api/fees/signoffs/:id/decision` | `fees.signoff_daily` (Finance Manager) | `sign_off` or `return`, with a note where needed |
| PUT `/api/fees/staff/:id/employee-no` | system admin | Sets a unique staff number on a staff account. `{ employee_no }`, or empty to clear. Audited. |
| GET `/api/guardian/fees/alerts` | guardian (`can_view_fees`) | Per linked child: credit balance and unseen notices |
| POST `/api/guardian/fees/notices/:id/seen` | guardian (`can_view_fees`) | Marks a notice seen. Idempotent. |
| POST `/api/fees/reconciliation/exceptions/:id/resolve` | `fees.manage` | `note` of 3 to 500 characters. Audited. |
| POST `/api/fees/jobs/daily/run` | `fees.manage` | Runs the daily job now. Still once per school date. |

### 10.7 Concession approval tiers

- **Threshold.** `FEES_CONCESSION_HIGH_PAISA`, default 500000 paisa (NPR 5,000). Provisional until confirmed (10.5). It is compared with the concession amount, not the invoice total. At or below the threshold is **standard**. Above it is **high**. Exactly at the threshold is standard.
- **Standard.** Approved by anyone with `fees.approve_concession`: the Finance Officer, the Finance Manager, or the system admin.
- **High-value.** Approval needs `fees.approve_concession_high`, which the Finance Manager holds by default. The system admin is the fallback approver: the admin passes the permission check, and the audit entry records `fallback_approver: true`. Anyone with `fees.approve_concession` may **reject** a high-value request.
- **Maker-checker.** The requester can never approve their own request, at any tier. The check runs before the tier check.
- **Reading of the rule.** "Processed directly" by the Finance Officer or admin is read as: no Finance Manager step is needed, but the approver must still be a different person from the requester. The user's standing maker-checker rule is kept.
- **Queue.** `GET /api/fees/concessions?status=requested&tier=high` is the Finance Manager's pending-approval queue. It is an API list, not a screen yet.
- **Audit.** The `concession_approved` entry records the tier.
- **Admin fallback:** decided and built (10.5).
