# Phase 2 status: parent alerts (SMS, WhatsApp, email)

Date: 2026-10-11. Roadmap section: [PRODUCTION_ROADMAP.md, Phase 2](PRODUCTION_ROADMAP.md#phase-2-alerts-that-reach-parents-sms-whatsapp-email).

**Status: complete in code, tested, and run end to end on a live local server with a real database.** Real messages to real parents need three things that only the school or the vendor can supply: a Sparrow SMS account with an approved sender ID, a WhatsApp Business account with an approved template, and an SMTP account. The pilot exit gate (95% delivery in a pilot month) cannot be measured until a pilot school runs. Those items are listed in section 6.

---

## 1. What exists

| Area | File | What it does |
|---|---|---|
| Schema | `server/src/db/schema.sql` | `messaging_config` (one row: switches, language, monthly limits), `message_outbox` (queue and delivery log), `message_optouts`. |
| Templates | `server/src/services/messaging/templates.js` | Absence and late alerts in English, Nepali, or both. SMS segment counter (GSM-7 and UCS-2 rules). |
| Providers | `server/src/services/messaging/providers.js` | Real adapters: **Sparrow SMS** (SMS, Nepal), **WhatsApp Cloud API** (approved templates), **SMTP** (email). Plus `log` (simulated) and `none` (held). |
| Outbox and worker | `server/src/services/messaging/outbox.js` | Queue with dedupe, send worker, retries with backoff, opt-out and stale checks at send time, monthly quota in Nepal time, recovery of interrupted sends, 365-day retention, test sends, delivery summary. |
| Alert builders | `server/src/services/messaging/alerts.js` | Attendance alerts from the daily register. Class and school-wide notices with an idempotency key. |
| Attendance hook | `server/src/routes/attendance.js` | After a daily register is saved, queues absence and late alerts. Subject registers do not alert. A failure is logged and never blocks the register. |
| Announcements | `server/src/routes/announcements.js` | Optional `parent_channels`. Validated before anything is saved. Uses the same permission and scope checks as before. |
| Admin API | `server/src/routes/messages.js`, mounted at `/api/messages` | Settings, providers (no secrets), summary, recent messages, notices, opt-outs, test send, "send queued now". Admin only. |
| Worker | `server/src/index.js` | Every 30 seconds sends due messages. Every 24 hours deletes old finished messages. `MESSAGING_WORKER=off` disables both. |
| Admin page | `client/src/pages/admin/Messages.jsx`, route `/admin/messages` | Provider status, settings with a master switch, usage against limits, delivery rates, test send, class notice, opt-outs, recent messages. |
| Announcements page | `client/src/pages/admin/AdminAnnouncements.jsx` | "Also send to parents" checkboxes (SMS, WhatsApp, email). |
| Tests | `server/test/messaging.test.js` (28), `server/test/messaging-providers.test.js` (22) | See section 3. |

## 2. Configuration

Settings are per school and live in `messaging_config`, which only admins can read. They are not on the public `settings` row.

| Variable | Default | Purpose |
|---|---|---|
| `MESSAGING_WORKER` | on | `off` runs the API without the worker or the retention purge. |
| `MESSAGING_SMS_PROVIDER` | `log` outside production, `none` in production | `sparrow` for Sparrow SMS. `log` records as simulated. `none` holds. |
| `SPARROW_TOKEN`, `SPARROW_FROM` | none | Sparrow API token and approved sender ID. |
| `SPARROW_API_URL` | `https://api.sparrowsms.com/v2/sms/` | Override if the vendor issues a different base URL. The vendor's public docs show `http://`; confirm which one the account uses. |
| `MESSAGING_WHATSAPP_PROVIDER` | `log` / `none` (as above) | `cloud` for the WhatsApp Cloud API. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` | none | Permanent system-user token, sending phone number ID, and the approved template name. |
| `WHATSAPP_TEMPLATE_LANG` (`en`), `WHATSAPP_API_VERSION` (`v21.0`), `WHATSAPP_API_BASE` | defaults shown | Optional overrides. |
| `MESSAGING_EMAIL_PROVIDER` | `log` / `none` (as above) | `smtp` to send email. |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | none | SMTP settings. Put secrets in the environment, never in the database. |
| `MESSAGING_RETENTION_DAYS` | 365 (minimum 30) | Finished messages older than this are deleted daily. Queued messages are never deleted. |

**Template rule for WhatsApp.** The approved template must have exactly one body variable (`{{1}}`). The alert text is sent as that variable. WhatsApp parameters cannot contain newlines, so the adapter replaces them with " · " and limits the text to 1,024 characters.

## 3. Verification

| Check | Result |
|---|---|
| `server/test/messaging.test.js` | 28 of 28 pass. Fake provider at the adapter seam. Covers dedupe, retries, the attempt cap, permanent errors, opt-outs, quotas, the not-configured hold, corrected registers, removed links, pause, no-contact, language rendering, notices, validation, admin-only access, the Nepal-time quota boundary, retention, announcements to parents, test send, provider status, and a 1,000-message load test. |
| `server/test/messaging-providers.test.js` | 22 of 22 pass. Sparrow, WhatsApp, and SMTP adapters against local servers. Email goes through a **real SMTP exchange** on localhost (smtp-server), including a 550 (permanent) and a 421 (transient). Checks error classes, request format, segment counts, and that secrets never appear in status output. |
| Full server suite (`npm test`) | **143 of 143 pass** at Phase 2 close (93 from Phase 1, 50 new). Now **241 of 241** with Phase 3 (see `PHASE3_STATUS.md`). |
| Live end-to-end run | Real server on a fresh database, real HTTP, real 30-second worker, Sparrow-protocol endpoint on localhost. See section 4. |
| Client build and lint | Build exit 0. Lint 0 errors, 37 warnings (same count as before Phase 2). |

## 4. Live end-to-end run

Run on 2026-10-11 with `MESSAGING_SMS_PROVIDER=sparrow` pointing at a local stand-in for the Sparrow API:

1. The principal signed in and turned alerts on (SMS on, language "both").
2. The provider endpoint reported `sms: sparrow, configured: true`, and no secret values.
3. Marking Asha Sharma absent created one queued SMS to her guardian's Nepal mobile.
4. The worker, on its own timer, sent it. The request had the documented fields (`token`, `from`, `to` as a 10-digit number, `text`). The outbox row became `sent`, with 3 segments recorded.
5. Marking her absent again created no second message (dedupe).
6. A test send through Sparrow returned `sent`. A test send over WhatsApp (mode `none`) returned a clear "held" message.
7. A class notice was queued once and sent by the worker.

**Cost finding.** A bilingual SMS (English and Nepali) is UCS-2 and produced 3 SMS segments. Sending both languages doubles or triples the SMS cost. Recommendation: use English or Nepali alone for SMS, and use "both" for email and WhatsApp. This is a product decision for the school.

## 5. Roadmap acceptance, item by item

| Roadmap item | Status | Notes |
|---|---|---|
| Tests with a fake provider: retries on failure | Met | Transient retry, backoff, and the attempt cap. |
| No duplicate sends on retry | Met | Dedupe, plus "sent is never sent again". |
| Opt-out respected | Met | Checked at send time. |
| Quota blocks sending when exhausted | Met | Quota counted in Nepal time. |
| Load test: 1,000 messages in 10 minutes, none lost | Met on the worker | 1,000 messages in 98 ms with the test provider. Vendor rate limits are not measured. |
| Adapters for SMS, WhatsApp, and email | Met in code | Sparrow SMS, WhatsApp Cloud API, SMTP. Each is tested against its protocol. None has been run against a live vendor account yet. |
| Cost check: real per-message cost for at least one provider | **Not met** | Needs a live account. The cost recorded is the segment count (SMS) or 1 (WhatsApp and email), not the invoiced amount. The per-message price in NPR must be taken from the vendor's invoice. |
| Exit gate: 95% delivery for valid numbers in a pilot month | **Not met** | Needs a pilot school and live accounts. |
| Background worker | Met | 30-second worker, daily retention. |
| Per-school quota and monthly usage report | Met | Counts come from the school's own database. Under Phase 7 each school has its own database. |
| Bilingual templates (absence, late, fee due, notice) | Partly met | Absence and late are in English and Nepali. Fee-due is Phase 3. Notices are written by the admin in the language they choose. |
| Delivery reports on the admin dashboard | Met | On the Messages page. Not yet on the main dashboard. |
| Announcements can be sent by SMS or WhatsApp | Met | Optional on the announcements page and in the API. |

## 6. What the school or vendor must supply (cannot be done in code)

1. **Sparrow SMS account.** API token and an approved sender ID. Confirm the base URL (`http` or `https`) and the response format on a live account. Confirm the Nepal rate per SMS from the invoice.
2. **WhatsApp Business.** A Meta Business account, a phone number, a permanent system-user token, and an approved utility template with one body variable. Template approval can take days. Business-initiated messages to parents are blocked without an approved template.
3. **SMTP.** A transactional email account (for example, a school domain). Confirm SPF and DKIM on the sending domain so messages do not land in spam.
4. **Nepali review.** A native speaker must review the Nepali text in `templates.js` before a pilot.
5. **Pilot school.** Run one month. Record the delivery rate for valid numbers and the real cost per message. These are the two numbers the roadmap gate needs.

## 7. Known limits

1. **At-least-once in one window.** If the process dies after a provider accepted a message but before the database was updated, the message is sent again after recovery. Dedupe stops duplicate queueing, not this resend. Sparrow and WhatsApp do not accept an idempotency key in the way used here, so this window remains. It is rare, but a pilot should watch for it.
2. **Recovery threshold.** A send that takes more than 5 minutes is put back in the queue. A very slow provider response could cause a second send. Keep the provider timeout (15 seconds) well below this.
3. **Unknown error codes.** An unknown 4xx from WhatsApp is treated as permanent, so the message is marked failed. An unknown non-200 response code from Sparrow is treated as transient. Both need checking against live responses.
4. **One worker per database.** The claim step is atomic, so two workers on one database do not claim the same message. With more than one API instance (Phase 9), decide where the worker runs.
5. **Attendance alerts are daily-register only.** A subject-only absence does not alert. This is deliberate.
6. **Personal data.** The outbox stores phone numbers, email addresses, message text, and the child's name. Retention is 365 days by default. The school's privacy notice must cover this before a pilot.
7. **Admin test sends** are not stored and are not rate-limited. Only admins can use them. Consider a limit before a pilot.
8. **Recipients in the admin list are not masked.** Admins already see the same numbers on the guardian pages.
9. **Usage counts messages, not cost.** Cost fields hold segment counts. Invoices need the real rate, which is not in the code.

## 8. Decisions still open

- **Confirm the SMS provider.** Sparrow is implemented because it is a Nepal aggregator with a documented HTTP API. If the school prefers another, the adapter is a small addition in `providers.js`.
- **WhatsApp route.** The adapter calls Meta's Cloud API directly. A business solution provider (BSP) is an alternative that also handles onboarding. The choice affects cost and setup time.
- **SMS language.** English or Nepali alone for SMS, to avoid the UCS-2 cost (section 4).
- **Price model.** Message usage is metered. The add-on price depends on the cost per message, which is known only after a live account is used.

## 9. Source

Sparrow SMS API: `POST /v2/sms/` with `token`, `from`, `to` (comma-separated 10-digit numbers), and `text`. Documented at docs.sparrowsms.com (outgoing SMS). WhatsApp Cloud API: `POST /{version}/{phone-number-id}/messages` with a `template` message, bearer authentication, and a `components` list. Documented at developers.facebook.com (WhatsApp Cloud API, Message API).
