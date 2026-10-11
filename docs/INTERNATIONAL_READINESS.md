# International Readiness

Status as of commit `43d6f8d`. Target: **USD 10M per year** (USD 1 crore), a 3–5 year goal. This document lists what is done, what is still missing before selling outside Nepal, how we will price in USD, and the roadmap.

## 1. Done in this round

| Area | Change | Verified |
|---|---|---|
| File exposure | Uploads (assignments, materials, application documents) were served publicly from `/uploads`. Now only `uploads/public` is open; everything else needs sign-in. | Automated tests (401 without sign-in, 200 with cookie or Bearer, traversal blocked, 404 for missing files) |
| Guessable filenames | Upload names used timestamp plus a small random number. Now random UUIDs. | Code review; no automated test |
| Browser file links | HttpOnly `nitex_file` cookie scoped to `/uploads`, set at login, cleared at logout. Lets normal file links work without putting tokens in URLs. | Automated test for the cookie attributes and access |
| Disabled accounts | A valid token kept working for up to 7 days after an account was disabled or archived. Every request now checks account status. | Automated test |
| Data export | `GET /api/privacy/me/export` (any user) and `GET /api/privacy/users/:id/export` (admin). Password hashes are never included. | Automated test |
| Erasure | `POST /api/privacy/users/:id/anonymize` requires typing `ANONYMIZE`. Removes identity, files and notifications, and locks the account. Academic records are kept unlinked from identity. | Automated test |
| Audit | Export and erasure actions are written to the audit log. | Automated test |

Test result: 26/26 server tests pass. Client production build passes.

Not verified here: the Docker image (Docker is not available in the build sandbox).

## 2. Remaining gaps before international sales

Ordered by how much they block a first paying foreign school.

1. **Rotate the GitHub token.** A fine-grained token was pasted into chat during the push. Revoke it and create a new one with the smallest scope.
2. **Data processing agreement (DPA) and privacy policy.** Needed by any school in the EU, UK, US or Australia. Draft text is not written yet; a lawyer should review it.
3. **Hosting region.** Choose an EU region and a US region, or start with one and say so in the DPA. Data-residency promises must match where the database actually runs.
4. **Backups and restore test.** No tested restore procedure yet.
5. **Multi-tenant isolation.** Each school must be fully separated (its own data, branding and admins). The current code is built for one school per deployment. Either deploy one instance per school at first, or add a `school_id` to every table with tests that prove no cross-school reads.
6. **Consent flows.** Under-13 students (COPPA in the US, age thresholds under GDPR Art. 8) need verifiable parent or school consent. The school can give this for educational use, but the platform must not show ads or share data with third parties for those users.
7. **Translation.** The UI is English plus Nepali (partial). Add Spanish, French, Arabic (right-to-left) and others only after the first buyers name their languages.
8. **Payments in USD.** Add Stripe (or equivalent) for card and invoice billing in USD, with tax handling (VAT/GST) through a merchant-of-record or a tax engine.
9. **Security review.** Penetration test and a dependency audit before the first international school signs.
10. **Support and status page.** Support email, uptime monitoring, and an incident-response runbook.

## 3. USD pricing proposal

These are starting prices to test, not final. Competitor figures were taken from public pages in 2025 and may have changed.

| Plan | Price | Who it is for | Notes |
|---|---|---|---|
| Free (teachers) | USD 0 | Individual teachers, up to a class limit | Matches the free-use proposal from earlier work. Reduces churn and builds word of mouth. |
| Free (students) | USD 0 | All students | Students never pay. |
| School | USD 99/month, or USD 1,000/year | Small schools (under 500 students) | About USD 1,188/year at monthly pricing; annual is cheaper and preferred. |
| District / Multi-school | Custom, from USD 3,000/year | Groups of schools | Needs multi-tenant admin. |
| Add-ons | USD 1–2 per student per year | Fee collection, parent messaging, SMS | Optional modules, priced per student. |

Competitor reference points (from earlier research):
- ClassDojo: free for teachers; Plus about USD 110/year (price change Nov 2024).
- Remind: free for teachers; school hub reported at USD 4k–15k/year. Being absorbed into ParentSquare.
- Seesaw: school plan about USD 1,200/year per school; individual teacher licenses discontinued in 2024.
- Google Classroom: free with Google Workspace for Education; paid tiers up to about USD 4 per student per year.
- Canvas: custom quotes, about USD 8–12 per user per year for small institutions.
- Schoology: about USD 30–40 per user per year (third-party benchmark).

Our differentiators to test: attendance with parent alerts, fee collection, a bilingual interface (English and Nepali), and documented compliance. Free-core, low-price school software is a crowded market, so these must be proven with buyers, not assumed.

## 4. Revenue arithmetic for USD 10M per year

| Route | What it takes |
|---|---|
| Schools at USD 1,188/year | About 8,400 paying schools |
| Schools at USD 3,000/year | About 3,333 schools |
| Students at USD 10/student/year | About 1M paying students |
| Students at USD 5/student/year | About 2M paying students |

Realistic view: USD 10M per year is top-tier software scale. It needs a sales team, a multi-tenant product, support staff, and most likely outside funding. Treat it as a long-term plan with milestones, not a promise.

Suggested milestones (illustrative):
- Year 1: 20 paying schools in Nepal and 3 abroad, USD 150k ARR.
- Year 2: 200 schools, USD 1.2M ARR, first district deal.
- Year 3: 1,000 schools, USD 4M ARR, compliance certifications in place.
- Year 4–5: 3,000+ schools, USD 10M ARR.

## 5. Compliance matrix

| Requirement | Applies when | Status | Next step |
|---|---|---|---|
| FERPA (US) | Serving US schools that take federal funds | Not started | Sign a DPA as a "school official" with use limits and a ban on re-disclosure. |
| COPPA (US) | Users under 13 | Partial (no ads; consent not built) | School consent for educational use; no ads or third-party sharing for these users. |
| GDPR (EU/UK) | Any EU or UK user | Partial (export and erasure built) | Privacy notice, lawful-basis record, DPA, EU hosting, transfer terms (SCCs) if data leaves the EU. |
| Nepal Individual Privacy Act 2018 | Nepali users | Not reviewed | Legal review of obligations and any registration duties. |
| Access control | All | Improved | Uploads gated; account status enforced on every request. |
| Audit trail | All | Present | Export and erasure now logged. |

This matrix is an engineering checklist, not legal advice. Have a qualified lawyer in each target market review the DPA, privacy policy and terms.

## 6. Roadmap

Next (engineering, 2–4 weeks):
1. Multi-tenant isolation with `school_id` and cross-school tests.
2. Under-13 consent flow.
3. Data retention settings per school.
4. Automated backup and a tested restore.
5. USD billing with Stripe and a pricing page.

Then (go-to-market, in parallel):
1. Ten pilot schools in Nepal, free or discounted, in exchange for case studies.
2. Three international pilot schools (one each in the US, EU and Gulf/South Asia) with a signed DPA.
3. A public compliance page and security summary.

Later:
1. Penetration test and SOC 2 or ISO 27001 readiness.
2. Additional languages once buyers request them.
3. Integrations with existing student information systems.
