# Module Recommendations: what to keep, add, defer, or drop

Date: 2026-10-11. Builds on `docs/MARKET_RESEARCH_AND_MODULES.md`. This document answers: which modules this app should keep, and which other modules it should add.

## 1. What the research says

- **Most-used features.** Attendance is used every school day, so it gets the most use. Student information comes next, then fees, parent communication, exams and grading, timetable, library, and transport ([GegoK12](https://gegok12.com/top-10-school-erp-features-schools-actually-use-in-2026/)).
- **What K-12 buyers rank as critical.** Gradebook (56% of reviewers), attendance tracking (49%), and student information records (45%) ([Capterra, MySchool listing](https://www.capterra.com/p/114989/MySchool/)).
- **Parent communication.** In a US survey, text messages and school portals ranked as parents' top digital tools ([K-12 Dive](https://www.k12dive.com/news/parent-survey-reveals-school-communication-preferences/428711/)). A second survey found SMS preferred for alerts, email for general information and teacher messages, and WhatsApp used too ([Springdale National School](https://www.springdale.ie/2018/09/04/communications-survey/)). Both are dated or from one school, so treat them as direction. **We have no Nepal parent survey.**
- **Nepal grading.** SEE uses a 4.0 letter scale per subject, with NG below 35% and a supplementary exam for NG grades. Theory and internal marks are converted to grades ([Educate Nepal, 2083 directive](https://blog.educatenepal.com/2026/05/see-letter-grading-guidelines-system.html), [Nepal News](https://english.nepalnews.com/s/explainers/see-everything-you-need-to-know-about-nepals-national-secondary-examination/)). Most compulsory subjects use a 75:25 theory-to-internal split ([Nepal News](https://english.nepalnews.com/s/explainers/see-everything-you-need-to-know-about-nepals-national-secondary-examination/)). **Sources disagree on the D band (35–39% vs 30–39%). Check the official NEB directive before coding it.**
- **Nepal payments and alerts.** Vendors describe eSewa, Khalti and IME Pay as standard, with SMS as the fallback for parents without the app ([pdpspectra](https://pdpspectra.com/solutions/student-experience-nepal/)).
- **International.** IB schools need planning and portfolio modules ([Toddle](https://www.toddleapp.com/ib-pyp/)). Early-years buyers need daily feed, photos and check-in ([Capterra, Brightwheel](https://www.capterra.com/p/144060/brightwheel/)).

## 2. What the app has now

Confirmed in the repo and schema:

Attendance (with absence notifications), assignments with rubrics, versions, resubmission and regrade requests, quizzes and question banks, materials with view tracking, announcements and in-app notifications, academic sessions, sections and subjects, teacher-subject assignments, roles and permissions with scope and overrides, approval requests, admissions applications, audit log, privacy export and erasure, behaviour records (table exists), XP and streaks (table exists), and an academic head and coordinator dashboard.

## 3. Recommendations

### KEEP (core, already built)

| Module | Why | Action |
|---|---|---|
| Attendance | Most-used feature in the market | Keep. Add SMS and WhatsApp alerts to parents |
| Student information | Foundation for every other module | Keep. Extend the profile (section 4) |
| Assignments, rubrics, submissions | Gradebook is the top-rated feature | Keep |
| Quizzes and question banks | Assessment and practice | Keep |
| Materials | Teachers share resources | Keep |
| Announcements and notifications | Parent communication core | Keep. Add SMS and email channels |
| Roles, permissions, scope | Required for schools with many staff | Keep |
| Audit log and privacy tools | Required for international buyers and trust in Nepal | Keep |
| Admissions and applications | Common module, already built | Keep |
| Regrade and resubmission workflow | Schools need a formal re-check process | Keep |
| Behaviour records | Toddle and other IB platforms include it | Keep. Give it a UI, currently missing |
| Approvals | Needed for account and registration control | Keep |

### KEEP BUT CHANGE

| Module | Issue | Recommendation |
|---|---|---|
| XP and streaks (gamification) | Useful for students but adds a points system for minors | Keep as an opt-in per school, off by default. Turn off for under-13 users in international deployments (COPPA and GDPR) |

### ADD: Phase 1 (required to sell in Nepal)

1. **Guardian and parent accounts.** Parents are the paying customer and the main user. Link guardians to students with permissions: view attendance, view fees, pay fees, receive alerts.
2. **Student profile fields.** Date of birth (AD and BS), phone, address, admission number, roll number, IEMIS ID, NEB ID, blood group, emergency contact. Required by IEMIS and used by every platform.
3. **Fees and payments.** Fee heads, class-wise structures, invoices, receipts, dues report, late fees, discounts and scholarships. Online payment through one gateway first (eSewa or Khalti), with server-side verification and a webhook.
4. **SMS and WhatsApp alerts.** Absence alerts, fee-due reminders, and urgent notices. SMS first, since it reaches parents without a smartphone.
5. **Timetable.** Class schedule, teacher assignment, substitutions. Needed for attendance by period and for exam scheduling.
6. **Exams and report cards.** Exam terms, marks entry, SEE-style letter grades with GPA and NG handling, 75:25 theory and internal split, printable report cards. Build the grading table from the official directive, not from blogs.
7. **IEMIS-ready export.** Student status (passed, repeated, transfer, dropout), exam results, and transfers in the format CEHRD requires.

### ADD: Phase 2 (strong adoption drivers)

8. **Transport.** Routes, stops, vehicles, drivers, bus fees. Listed in most platforms and often bundled with fees in Nepal.
9. **Library.** Catalogue, issue and return, due dates, fines.
10. **Leave.** Student leave requests with approval, and staff leave.
11. **Health records.** Medical conditions, allergies, vaccination record, incident log. Some schools require this for safety.
12. **Parent communication preferences.** Each guardian picks language (English or Nepali) and channels (app, SMS, email).

### DEFER (build when a paying school asks)

- Hostel and canteen management.
- Staff payroll and HR.
- Visitor log and gate pass.
- Inventory and assets.
- Biometric or QR attendance hardware.
- Full double-entry accounting and ledger.
- Live video classes or an LMS to compete with Google Classroom or Canvas.
- AI features such as dropout-risk scores and auto-written report comments. These need several terms of clean data first.

### INTERNATIONAL TRACK (after the first foreign pilot)

- IB PYP and MYP templates: unit planning, portfolios, standards tracking. This is a separate product category. Do not build it before a paying IB school asks.
- Multi-tenant isolation (one school's data cannot be seen by another), tested.
- Multi-currency billing and tax handling.
- FERPA and GDPR consent flows, under-13 consent, data residency.
- Languages beyond English and Nepali, once buyers name them.

### DROP OR DO NOT BUILD

- A second copy of Google Classroom or Canvas. Integrate with them instead.
- Payroll and accounting before schools ask for them. They take a long time and are not where the early revenue is.
- Marketplace or content library. Only consider it after there are many active schools.

## 4. Recommended order of work

1. Guardian accounts and student profile fields (unblocks everything else).
2. Fees with one gateway, plus SMS alerts (what Nepali schools pay for).
3. Timetable, exams and report cards with SEE grading, IEMIS export.
4. Transport, library, leave, health records.
5. Deferred and international modules, driven by signed pilots.

## 5. Open questions for you

1. Should XP and streaks stay on by default for Nepali schools, or be opt-in?
2. Which SMS and WhatsApp provider will we use? WhatsApp Business has its own approval and cost rules.
3. Do you want a short parent interview round (around 20 parents in Bagmati) before building Phase 1? This would confirm the SMS-versus-app choice, which the research could not settle for Nepal.
4. Which gateway first, eSewa or Khalti?

## 6. Caveats

- Feature rankings come from vendor-linked surveys and review sites. They show direction, not proof.
- The SEE grading bands differ between sources. Verify against the official NEB directive before coding.
- No Nepal-specific parent communication survey was found.
