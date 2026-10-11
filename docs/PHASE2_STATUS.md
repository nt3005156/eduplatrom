# Phase 2 status: parent alerts (SMS, WhatsApp, email)

Date: 2026-10-11. Roadmap section: [PRODUCTION_ROADMAP.md, Phase 2](PRODUCTION_ROADMAP.md#phase-2-alerts-that-reach-parents-sms-whatsapp-email).

**Status: built and tested with a fake provider. Not yet connected to a real SMS, WhatsApp, or email provider. The pilot exit gate is not met.** The admin can turn alerts on, but nothing reaches a real phone until a provider is chosen and configured (see "Open decisions").

---

## 1. What was built

| Area | File | What it does |
|---|---|---|
| Schema | `server/src/db/schema.sql` (appended) | `messaging_config` (one row: switches, language, monthly limits), `message_outbox` (queue and delivery log), `message_optouts`. Indexes for the worker and for usage reports. |
| Templates | `server/src/services/messaging/templates.js` | Absence and late alerts in English, Nepali, or both. SMS segment counter (GSM-7 and UCS-2 rules). |
| Providers | `server/src/services/messaging/providers.js` | Adapters: `log` (simulated), `none` (held), `smtp` (email through `nodemailer`). Fake-provider hook for tests. |
| Outbox and worker | `server/src/services/messaging/outbox.js` | Queue with dedupe, send worker, retries with backoff, opt-out check, quota check, stale-event check, recovery of interrupted sends, delivery summary. |
| Alert builders | `server/src/services/messaging/alerts.js` | Attendance alerts from the daily register. Class notices with an idempotency key. |
| Attendance hook | `server/src/routes/attendance.js` | After a daily register is saved, queues absence and late alerts. Subject registers do not alert. A failure here is logged and never blocks the register. |
| Admin API | `server/src/routes/messages.js`, mounted at `/api/messages` | Settings, summary, recent messages, class notices, opt-outs, and "send queued now". Admin only. |
| Worker | `server/src/index.js` | Runs the worker every 30 seconds. Set `MESSAGING_WORKER=off` to disable it. |
| Admin page | `client/src/pages/admin/Messages.jsx`, route `/admin/messages`, sidebar item "Messages" | Settings with a master switch, monthly usage against limits, delivery rates, notice form, opt-out list, recent messages. |
| Tests | `server/test/messaging.test.js` | 22 tests. Fake provider, no real sends. |

### Behaviour that is fixed in code

- **Dedupe.** Each message has a unique `dedupe_key` (channel, address, event, student, date, status). Marking the same absence twice queues one message per channel.
- **No duplicate after success.** A message that was sent is never picked up again.
- **Retry with backoff.** Transient errors wait 1, 5, 30, then 120 minutes. After 5 attempts the message is marked `failed`.
- **Permanent errors.** A bad address (SMTP 5xx) is marked `failed` at once, with no retry.
- **Held, not failed, when no provider is set up.** In production the default is `none`. Messages stay queued, do not use up attempts, and are retried every 10 minutes. Nothing is lost while the provider is being set up.
- **Opt-out at send time.** An opt-out added after a message was queued still stops it.
- **Monthly quota per channel.** Counted on messages sent this month. When the limit is reached, that channel waits and other channels keep going.
- **Stale alerts are not sent.** If the register is corrected before sending, or the guardian's link is removed or restricted, the alert is marked `skipped_stale`.
- **Master switch.** `alerts_enabled = 0` (the default) stops all sending. Absence and late alerts are not queued while the switch is off, so turning it on does not send a backlog of old absences.
- **Who gets alerts.** Only active guardians with a non-restricted link and `can_view_attendance = 1`. This is the same rule the guardian portal uses.
- **Queued messages expire** after 72 hours if they still have not been sent.
- **Interrupted sends are recovered.** A message stuck in `sending` for more than 5 minutes goes back to the queue.

## 2. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MESSAGING_WORKER` | on | Set to `off` to run the API without the worker. |
| `MESSAGING_SMS_PROVIDER` | `log` outside production, `none` in production | `log` records as simulated. `none` holds. A real provider name must be implemented first (no real SMS adapter exists yet). |
| `MESSAGING_WHATSAPP_PROVIDER` | same as above | Same rules. No WhatsApp adapter exists yet. WhatsApp also needs approved message templates. |
| `MESSAGING_EMAIL_PROVIDER` | same as above | Set to `smtp` to send email. |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | none | SMTP settings. Put these in the environment, not in the database. |

Settings are per school and live in `messaging_config` (admin only). They are not in the public `settings` row, because `GET /api/settings` is public.

## 3. Verification

| Check | Result |
|---|---|
| Messaging tests (`node --test test/messaging.test.js`) | 22 of 22 pass |
| Full server suite (`npm test`) | 115 of 115 pass (93 from Phase 1 and 22 new) |
| Load test, 1,000 queued SMS, batches of 100, fake provider | All 1,000 sent once each, no duplicates, 98 ms. This measures the worker only, not a real provider. |
| Client build (`npm run build`) | Exit 0 |
| Client lint (`npm run lint`) | 0 errors, 37 warnings (same count as before Phase 2) |

Tests covered: queueing and dedupe; one send, no repeat; transient retry with backoff; maximum attempts; permanent error; opt-out; quota; not-configured hold; corrected register; removed link; pause and resume; no-contact recorded; English, Nepali, and both-language rendering; SMS segment counts; class notice and idempotent retry; input validation; admin-only access; SMTP not configured; interrupted send recovery; 1,000-message load.

## 4. Roadmap acceptance, item by item

| Roadmap item | Status | Notes |
|---|---|---|
| Tests with a fake provider: retries on failure | Met | Transient retry test. |
| No duplicate sends on retry | Met | Dedupe test and the "sent is never sent again" check. |
| Opt-out respected | Met | Opt-out test, checked at send time. |
| Quota blocks sending when exhausted | Met | Quota test. |
| Load test: 1,000 messages in 10 minutes, none lost | Met with the fake provider only | Worker handled 1,000 in 98 ms. Real provider throughput and rate limits are not tested yet. |
| Cost check: real per-message cost for at least one provider | **Not met** | No provider is chosen. SMS cost is estimated by segment count only. Email `cost_units` is set to 1 per message, which is a placeholder. |
| Exit gate: 95% delivery for valid numbers in a pilot month | **Not met** | No pilot school yet, and no real provider. |
| Adapters for SMS, WhatsApp, and email | **Partly met** | Email (SMTP) is written and its error handling is tested with a stub, but it has not been run against a real mail server. SMS and WhatsApp have no real adapter. |
| Background worker | Met | Interval worker, unit-tested logic. |
| Per-school quota and monthly usage report | Met | Counts come from the database the server runs on. Under Phase 7 each school has its own database, so counts are per school. The usage report is on the Messages page. |
| Bilingual templates for absence, late, fee due, and notice | **Partly met** | Absence and late are in English and Nepali. Fee-due is Phase 3, when the fee module exists. Notices are written by the admin in whatever language they choose. |
| Delivery reports on the admin dashboard | Met | On the Messages page. Not yet on the main dashboard. |
| Announcements can be sent by SMS or WhatsApp | **Not done** | The class notice form is a separate endpoint (`POST /api/messages/notices`). It is not yet an option inside `routes/announcements.js`. |
| In-app notifications kept alongside | Met | Existing `notifications` behaviour is unchanged. |

## 5. Limits and known risks

1. **Crash window, at-least-once.** If the process dies after a provider accepted a message but before the database was updated, the message is sent again after recovery. Dedupe stops duplicates from being queued, not from being resent in this window. Some providers accept an idempotency key. The dedupe key is stored, so it can be sent once the chosen provider supports it.
2. **Billing month uses UTC.** The monthly usage reset uses `datetime('now', 'start of month')`, which is UTC midnight. Nepal is UTC+5:45, so the reset falls at 05:45 local time on the 1st. Usage reports for billing should use the `Asia/Kathmandu` month boundary before the first invoice (Phase 3). This is a known bug.
3. **Personal data in the queue.** `message_outbox` stores phone numbers, email addresses, and message text, including the child's name. A retention rule (for example, delete after 12 months) is not built yet. This needs a decision and legal review before a pilot.
4. **Workers and recovery.** The claim step is atomic (`UPDATE ... WHERE status = 'queued'`), so two workers on the same database do not claim the same message. The remaining risk is recovery: a send that takes more than 5 minutes is put back in the queue and could be sent a second time. The worker runs inside the API process, so with more than one API instance (Phase 9) the recovery threshold and worker placement need a decision.
5. **Attendance alerts are daily-register only.** A student absent from every subject but marked present in the daily register gets no alert. This is deliberate, so parents do not get one message per lesson.
6. **Templates are a first draft.** The Nepali text needs review by a native speaker before any pilot. The SMS segment count for Nepali assumes UCS-2 (70 characters per segment), which is the usual rule, but this must be confirmed with the chosen provider.
7. **Email is not tested against a real server.** SMTP error mapping (5xx permanent, 4xx retry) is written from the protocol. It needs a test with a real SMTP sandbox.
8. **Recipients in the admin list are not masked.** Admins see full numbers and addresses, which they already see on the guardian pages. Masking is a possible later change.

## 6. Open decisions (from the roadmap)

- **SMS provider.** Required before any real SMS. Choose one Nepal aggregator, check its per-message price and template rules, then add it as an adapter in `providers.js`.
- **WhatsApp.** Needs a Business API provider (BSP) and approved message templates. Template approval can take days. Start it in parallel with the SMS choice.
- **Email provider.** The SMTP adapter works with any SMTP service (for example, a transactional mail provider). Choose one before the pilot.
- **Price model.** Message usage is metered, so the add-on price depends on the cost per message. Cost is not known until a provider is chosen.

## 7. Next steps

1. Choose the SMS provider and WhatsApp BSP (decision owner: the user). Implement the first adapter and record real per-message cost.
2. Run a real SMTP test (for example, a sandbox mailbox) and confirm the error mapping.
3. Native-speaker review of the Nepali templates.
4. Fix the billing month boundary to `Asia/Kathmandu`, before Phase 3 invoices.
5. Decide the retention rule for `message_outbox`.
6. Add the fee-due template in Phase 3, and add "send by SMS" to announcements.
7. Pilot with 1 to 3 schools. Measure delivery rate for valid numbers against the 95% gate.
