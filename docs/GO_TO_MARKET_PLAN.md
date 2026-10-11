# NITEX: path to NPR 1 crore per year

Target: **NPR 10,000,000 gross revenue per year** (about USD 70k at ~NPR 140/USD).
Revenue is not guaranteed by code. This plan shows what the number requires.

## 1. What the target means in schools

Local price benchmarks (vendor pages, 2026 unless noted):
- Gurukul: NPR 900/month for up to 300 students; NPR 2,500/month with no student cap. [Gurukul](https://gurukulhq.com/blog/school-management-software-cost-nepal)
- Teachmint (India, Capterra listing): from USD 5 per user per year. [Capterra](https://www.capterra.com/p/163105/Teachmint/pricing/)

| Pricing model | Price | Paying customers for NPR 1 crore/yr |
|---|---|---|
| Flat per school, mid tier | NPR 60,000/yr (NPR 5,000/mo) | **167 schools** |
| Flat per school, Academy-like | NPR 30,000/yr (NPR 2,500/mo) | 334 schools |
| Per student | NPR 300/student/yr | 33,334 students, about **67 schools** at 500 students each |

Recommended: **NPR 5,000/month flat for up to 500 students** plus a setup fee. It is simple to explain and close.

## 2. Revenue levers (in order of priority)

1. **School subscription** (core). Recurring, annual prepaid where possible.
2. **Fee management with eSewa / Khalti / Fonepay**: the most-requested feature in Nepal. Competitors such as NepEdu settle payments straight to the school's account. [NepEdu](https://nepedu.com/) Do not hold school money unless you have the required payment licence.
3. **Parent alerts** (SMS / WhatsApp for absences and fee dues), sold as a paid add-on above a monthly message allowance.
4. **Setup and training fee** (one-time, NPR 10,000–25,000 per school).
5. **Premium add-ons**: report cards, Nepali (BS) calendar, bulk SMS, custom branding.

## 3. Funnel assumptions (replace with your real numbers)

- Target: 167 paying schools in 18 months.
- Close rate from demo to paid: 10%. Needs about 1,670 qualified demos.
- Demos per week needed: about 20 for 16 weeks, then sustained.
- Churn: plan for 10% per year. To stay at 167 schools, you need about 17 new schools a year just to replace churn.

## 4. Blockers to fix before selling to a real school (in order)

1. **Student files are public.** `/uploads/*` serves submissions and application documents without login. Fix: authenticated file endpoint with per-record access checks.
2. **Single-school architecture.** One deployment = one school, one database. This is fine for the first 20 schools if each gets its own managed instance. Multi-tenant (`school_id` on every table) comes later.
3. **Backups.** SQLite on a single VM needs automated daily backups with a tested restore.
4. **Data protection.** Privacy policy, data-processing agreement, and clear data-ownership terms for schools.
5. **Fee module.** Receipts, dues, reminders, concessions, and reconciliation. This is the feature schools pay for.
6. **Nepali (BS) calendar and Nepali-language UI.** Nepali schools run on the BS calendar.
7. **Support and uptime.** Status page, error monitoring, and a response-time commitment in the contract.
8. **Pricing page, demo video, and onboarding wizard** (create school, import students, set up classes).

## 5. Next features, ranked by sales impact

1. Fee management (ledger, receipts, dues, eSewa/Khalti/Fonepay links).
2. Parent accounts and absence alerts (SMS/WhatsApp).
3. Timetable and exam results / report cards.
4. Student file security (blocker 1) and backups (blocker 3).
5. Multi-tenant mode, once there are 20+ paying schools.

## 6. Sales plan (first 90 days)

- Pick 10 schools in Kathmandu Valley you can visit in person. Show a live demo using the attendance module.
- Offer a 60-day free pilot with one class. Convert pilots to annual contracts with a setup fee.
- Ask every pilot for two referrals. Local referrals close faster than cold outreach.
