# Market Research: School Platforms, Modules and Data Fields

Prepared: 2026-10-11. Scope: what international and Nepali school platforms include, which data fields they store, and how the NITEX/eduplatrom repo compares.

**Honest note on depth.** Earlier work looked at pricing and compliance only. This report covers product modules, data fields, the Nepal market and regulation. Most sources are vendor marketing pages, comparison blogs or review sites, so feature lists show what vendors claim, not what schools use. A few sources are old (2019–2023). Treat the numbers as directional and verify before pricing decisions.

---

## 1. Summary

1. Every school platform, from a US K-12 SIS to a Nepali ERP, has the same core: **student record, attendance, fees, exams/report cards, timetable, communication, and a parent portal.** Transport, library, hostel, leave and payroll are the next layer.
2. In Nepal the **fee module with eSewa, Khalti, ConnectIPS or IME Pay** and the **SMS or app alert to parents** are the features vendors lead with. Nepali vendors describe these as standard.
3. Our repo has strong **attendance, assignments, quizzes, materials, announcements, audit, and roles/permissions**. It has **no parent role, no fees or payments, no timetable, no transport/library/hostel, no SMS, and almost no student profile fields** (no date of birth, guardian, phone, address or roll number).
4. The biggest gap is the **parent account**. In every market the parent is the paying customer and the main user. Without guardians, the product cannot take fees or send alerts.
5. **Revenue reality check:** Nepal's private-school market alone cannot reach USD 10M per year at our planned price. See section 6.

---

## 2. Market scale

- Nepal has about 35,951 schools in the 2025-26 Economic Survey: 25,623 community, 8,941 institutional (private), 1,387 religious ([Kathmandu Post](https://kathmandupost.com/national/2026/05/28/economic-survey-shows-falling-enrollment-in-community-schools-and-rapid-growth-in-public-health-facilities)). Another official dataset counts 35,447 schools for 2024/25 ([EduSanjal](https://edusanjal.com/blog/education-levels-nepal/)). The two differ, so quote a range.
- 7.04 million students in grades 1–12. 62% (4.38M) are in community schools and 38% (2.66M) in private schools ([Kathmandu Post](https://kathmandupost.com/national/2026/05/28/economic-survey-shows-falling-enrollment-in-community-schools-and-rapid-growth-in-public-health-facilities)).
- Private share is rising. Five years ago private schools were 19% of schools. Now they are about 25% (8,941 of 35,951), with religious institutions at 4% ([Vietnam News, citing Economic Survey](https://vietnamnews.vn/world/1782624/community-schools-shrink-as-private-education-expands-in-nepal.html)).
- Bagmati Province (ours) has the highest share of institutional schools, 31.5% ([EduSanjal](https://edusanjal.com/blog/education-levels-nepal/)). This is the right first market.
- Community schools are publicly funded. Buying power and procurement there are different from private schools. Not verified in this research.

---

## 3. What platforms include (module map)

### 3.1 Core modules seen across vendors

| Module | What it does | Seen in |
|---|---|---|
| Student information (SIS) | One record per student: personal, family, academic history, documents | [1](https://www.panoramicinfotech.com/school-management-software), [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101), [5](https://www.edumerge.com/blog/what-is-a-school-management-system) |
| Admissions / enrollment | Online application, pipeline, waitlist, transfer in/out | [5](https://www.edumerge.com/blog/what-is-a-school-management-system), [1](https://research.com/software/best-student-information-systems) (Infinite Campus, Veracross) |
| Attendance | Daily, by period, biometric/QR, absence alerts to parents | [1](https://www.panoramicinfotech.com/school-management-software), [3](https://camudigitalcampus.com/blogs/school-management-system-software-guide/), [4](https://www.gartner.com/reviews/market/k-12-education-student-information-systems) |
| Fees and billing | Fee heads, structures, invoices, receipts, dues, late fees, discounts, online payment | [1](https://www.panoramicinfotech.com/school-management-software), [5](https://www.edumerge.com/blog/what-is-a-school-management-system), [6](https://nimble.com.np/school-college-software) |
| Exams and report cards | Exam schedule, marks entry, grading, report card generation | [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101), [6](https://medium.com/@jessica-38866/the-most-important-modules-of-school-management-software-a234850222bf) |
| Timetable | Class schedules, teacher assignment, substitutions | [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101), [5](https://www.edumerge.com/blog/what-is-a-school-management-system) |
| Communication | Notices, messages, SMS, email, parent app | [1](https://www.panoramicinfotech.com/school-management-software), [3](https://camudigitalcampus.com/blogs/school-management-system-software-guide/) |
| Parent / student portal | Parents see attendance, exams, fees, and documents | [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101), [5](https://www.edumerge.com/blog/what-is-a-school-management-system) |
| Transport | Vehicles, drivers, routes, stops, bus fees, GPS | [5](https://www.edumerge.com/blog/what-is-a-school-management-system), [6](https://medium.com/@jessica-38866/the-most-important-modules-of-school-management-software-a234850222bf) |
| Library | Book catalogue, issue/return, due dates, fines | [1](https://www.panoramicinfotech.com/school-management-software), [3](https://camudigitalcampus.com/blogs/school-management-system-software-guide/) |
| Hostel | Rooms, beds, allocation, mess fees | [1](https://www.panoramicinfotech.com/school-management-software), [5](https://www.edumerge.com/blog/what-is-a-school-management-system) |
| Visitor / front office | Visitor log, passes, certificates, ID cards | [5](https://www.edumerge.com/blog/what-is-a-school-management-system) |
| Staff / HR / payroll | Staff records, attendance, payroll, leave | [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101), [3](https://camudigitalcampus.com/blogs/school-management-system-software-guide/) |
| Accounts | Ledger, cash book, income and expense, balance sheet | [2](https://www.slideshare.net/slideshow/school-management-system-73646101/73646101) |
| Health and behaviour | Medical records, incidents, behaviour logs | [5](https://www.edumerge.com/blog/what-is-a-school-management-system), [Toddle](https://www.toddleapp.com/ib-pyp/) |
| Analytics / reports | Attendance %, fee aging, at-risk flags, custom reports | [1](https://www.panoramicinfotech.com/school-management-software), [Nimble](https://nimble.com.np/school-college-software) |

### 3.2 International segments

- **K-12 SIS (US-style):** PowerSchool, Infinite Campus, Blackbaud, Skyward. Strengths: state reporting, gradebook, attendance, enrollment, mobile apps for parents and students ([1](https://research.com/software/best-student-information-systems), [4](https://www.gartner.com/reviews/market/k-12-education-student-information-systems)).
- **Private and international schools:** Veracross and Blackbaud. Modules include admissions, academics, development (fundraising), billing and payment, plus tuition and attendance ([trustradius](https://www.trustradius.com/compare-products/on-products-vs-veracross)).
- **IB schools (PYP/MYP/DP):** Toddle and ManageBac. Add curriculum planning mapped to IB frameworks, student portfolios, standards-and-practices tracking, AI-assisted grading and report writing, behaviour tracking, and accreditation management ([Toddle PYP](https://www.toddleapp.com/ib-pyp/), [Toddle MYP](https://www.toddleapp.com/ib-myp/)). Toddle reports 40,000+ PYP educators ([Toddle](https://www.toddleapp.com/ib-candidate-schools/)).
- **Early years / childcare:** Brightwheel, Lillio, Procare. Strong on parent feed, photos, daily reports, check-in/out, and autopay ([Capterra](https://www.capterra.com/p/144060/brightwheel/), [Illumine comparison](https://illumine.app/blog/brightwheel-vs-lillio-vs-procare)). Reviewers describe Brightwheel as having a generous free version and say parents use it free; premium plans and transaction fees are common complaints ([GetApp](https://www.getapp.com/education-childcare-software/a/brightwheel/)).
- **Indian school ERP:** Fedena, Teachmint, Edunext, iVake, Classe365. Common modules: admissions, fees, exams, timetable, attendance, parent portal, library, transport, hostel, HR. Fedena publishes flat plans of ₹50,000 to ₹1,00,000 a year plus GST. iVake publishes a per-student rate. Teachmint and Edunext do not publish prices ([iVake](https://www.ivake.com/erp-software-published-pricing), [Intelcampus](https://intelcampus.com/blog/top-10-school-erp-software-india-2026)).

### 3.3 Nepali platforms

- **Nimble Educational ERP:** academic, finance, HRMS, assets, inventory and office automation. Billing covers fee titles, fee structures, discounts and scholarships, late-fine policies, bus/hostel/canteen fees, receipts, advance payments, dues aging, and online payment via eSewa, Khalti and ConnectIPS ([Nimble](https://nimble.com.np/school-college-software)).
- **inSchoolERP (Web Zone):** student finance, scholarships, expenses, student permits, RFID/biometric attendance, GPS vehicle tracking, SMS alerts, fee receipts, parent app, teacher app, online classes and exams, and payments through ConnectIPS, NCHL, Fonepay, Khalti and eSewa ([Web Zone](https://webzonenepal.com/schoolerp/)).
- **pdpspectra:** SIS, attendance (biometric or QR, with absent-student SMS), exams and transcripts, fee management with eSewa, Khalti and IME Pay, late-fee automation. Offers SaaS or self-hosted. Its student app stresses that SMS is still needed for parents without a smartphone, and that two payment gateways are needed because wallets have outages ([ERP](https://pdpspectra.com/solutions/school-erp-nepal/), [Parent app](https://pdpspectra.com/solutions/student-experience-nepal/)).
- **Payment integration cost:** a single eSewa or Khalti integration added to an existing site is quoted at NPR 20,000–35,000. Dual gateway: NPR 40,000–65,000 ([WebApp Nepal](https://webappnepal.com/service/payment-gateway)). This is a vendor quote, so treat it as a benchmark.

### 3.4 Nepal regulatory data that the product must support

- **IEMIS (CEHRD):** every school must update student records on IEMIS. Required actions include student status (Passed, Passed & Transfer, Repeated, Repeated & Transfer, Dropout), transfer-out and transfer-in, enrollment in ECED/PPC and Grade 1, final exam results, and special flags (technical stream, special schools, resource classes) ([EduSanjal, CEHRD notice](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/)). **Implication:** our student status and exam-result fields must match these categories. An IEMIS-ready export is a strong selling point.
- **NEB (Grades 9–12):** NEB is moving to a single registration number from Grade 9 through Grade 12, and to online certificates. Registration is tied to district, province, municipality and school ([myRepublica](https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12)). Earlier guidance required an SEE GPA of at least 1.6 for Class 11 entry and a school-endorsed grade sheet ([Slicejob, 2023](https://www.slicejob.com/blog/neb-class-11-registration-application-form-2080)). **Implication:** store SEE/GPA results and the school code.
- **Identifiers:** schools carry a CEHRD/IEMIS code and an NEB code, and these are often different. One source reports this causes confusion ([myRepublica](https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12)). Store both.

---

## 4. Data fields these platforms store

This is the field list to build from. "Nepal" marks fields needed for IEMIS, NEB or local practice.

### 4.1 Student
| Group | Fields |
|---|---|
| Identity | Full name (English and Nepali), gender, date of birth (AD and BS), photo, nationality, birth certificate or citizenship number (optional, per school policy) |
| Enrollment | Admission number, admission date, class, section, roll number, academic session, status (active, transferred, passed, repeated, dropout), previous school, transfer certificate |
| Identifiers (Nepal) | IEMIS / CEHRD student ID, NEB registration number, UDISE-style school code |
| Contact | Permanent and temporary address, phone, email |
| Guardians | Up to two or more guardians: name, relationship, phone, email, occupation, address, emergency contact flag, who can pick up |
| Health | Blood group, allergies, medical conditions, doctor contact, vaccination record |
| Special needs | Disability or special-needs flag, learning support plan (Nepal flags resource and special classes) |
| Services | Transport route and stop, hostel room, canteen, library card |
| Fees | Fee category, concession or scholarship, outstanding balance |

### 4.2 Guardian (parent account)
- Login, phone (SMS OTP later), email, preferred language (English or Nepali), notification channels, linked students with relationship, permissions (view attendance, view fees, pay fees, receive alerts), consent records.

### 4.3 Staff
- Employee ID, name, phone, email, qualification, subjects, assigned classes, joining date, status, staff role, leave balance, payroll and bank details (restricted), IEMIS teacher ID.

### 4.4 Attendance
- Date, period, student, class/section, status (present, absent, late, leave), reason, marked by, source (manual, biometric, QR), alert sent (yes/no, channel, time), edit history.

### 4.5 Fees and payments
- Fee head (tuition, exam, bus, hostel, library, uniform, admission), fee structure per class and session, due date, late-fee rule, discount or scholarship, invoice number, amount, paid, balance, receipt number, payment method (cash, bank, eSewa, Khalti, ConnectIPS, IME Pay, card), gateway transaction ID, refund or deposit, advance balance, cashier, reconciliation status.

### 4.6 Exams, marks and report cards
- Exam term, exam name, date, subject, full marks, pass marks, theory and practical split, internal and external marks, grade, GPA (SEE), rank, remarks, teacher comment, report card template, publish status.

### 4.7 Timetable
- Period number, day, time slot, class, subject, teacher, room, substitution teacher, holiday or event.

### 4.8 Communication
- Notice title, body, audience (class, section, guardian group, staff), channel (app, SMS, email), language, read receipt, sent time, scheduled time.

### 4.9 Transport
- Vehicle number, type, capacity, driver name, licence, phone, route, stops with times, student-to-stop mapping, bus fee, GPS device ID.

### 4.10 Library
- Book title, author, ISBN, copies, barcode, category, member (student or staff), issue date, due date, return date, fine.

### 4.11 Hostel
- Building, room, bed, capacity, student, check-in and check-out, mess plan, mess fee, warden.

### 4.12 Leave, visitors, audit
- Leave request (type, dates, reason, approver, status). Visitor log (name, purpose, who they meet, time in and out, pass). Audit (actor, action, object, timestamp, old and new values).

---

## 5. Repo coverage

Based on the current code (commit `7fdd469`). Tables confirmed in `server/src/db/`.

| Module | Status | Notes |
|---|---|---|
| Student identity and roles | Partial | `users` has name, email, role, class level, section, gender, account status, staff role. **Missing:** DOB, phone, address, admission number, roll number, guardian, medical, photo |
| Guardian / parent account | **Missing** | No parent role; attendance and quiz code mention "parent" only in comments |
| Attendance | **Present** | Records per student per subject or class, reports, notifications for absences, audit. **Missing:** SMS, biometric or QR input |
| Assignments and submissions | **Present** | Rubrics, versions, resubmission, regrade |
| Quizzes and question banks | **Present** | Attempts, question pools |
| Materials | **Present** | Views tracked |
| Announcements and notifications | **Present** | In-app. **Missing:** SMS and email delivery |
| Academic sessions, sections, subjects | **Present** | Teacher-subject assignment |
| Exams and report cards | Partial | Quiz-based. **Missing:** exam schedules, marks entry by exam term, report card templates, GPA |
| Timetable | **Missing** | |
| Fees, invoices, receipts | **Missing** | Highest priority for Nepal |
| Online payment (eSewa, Khalti, ConnectIPS, IME Pay) | **Missing** | |
| Transport | **Missing** | |
| Library | **Missing** | Only a passing reference |
| Hostel | **Missing** | |
| Leave | Partial | Code references exist; module not confirmed |
| Admissions / applications | **Present** | Online applications with documents |
| Privacy (export, erasure) | **Present** | Added in `7fdd469` |
| Audit log | **Present** | |
| IEMIS export | **Missing** | Required by CEHRD |
| Multi-tenant (per school) | **Missing** | Required before international sales |

---

## 6. Revenue reality check

The target is USD 10M per year. Using the sources above:

| Scenario | Maths | Result |
|---|---|---|
| All Nepali private schools at our planned USD 1,188/year (school plan) | 8,941 × USD 1,188 | **≈ USD 10.6M/year** |
| All private-school students at USD 5 per student per year | 2,657,170 × USD 5 | **≈ USD 13.3M/year** |
| Nepal's community schools (publicly funded) | Procurement is different and unverified | Not sized |

Conclusion: **Nepal's private sector alone, at a 100% win rate, roughly equals the target at our planned price.** Realistically, a market share of 10–20% of Nepal's private schools gives about USD 1–2M per year. The target needs either international customers or a higher price per school. This must be in the plan.

Pricing benchmarks: Fedena ₹50k–1L/year flat (India); Brightwheel-style models are free for parents; Canvas, Schoology and Seesaw have school-level pricing from about USD 1,200/year for Seesaw ([see earlier research](../docs/INTERNATIONAL_READINESS.md)).

---

## 7. Recommended module build order

**Build order is driven by what makes a Nepali school pay**, then by what international schools require.

### Phase 1 — make the product saleable in Nepal (about 6–8 weeks)
1. **Guardian accounts** linked to students, with permissions and a parent login. This is the foundation for everything else.
2. **Student profile fields** from section 4.1 (DOB in AD and BS, phone, address, admission and roll number, IEMIS code, guardian details).
3. **Fees module:** fee heads, class-wise structures, invoices, manual receipts, dues report, late fees.
4. **One online payment gateway** (eSewa or Khalti) with server-side verification and a webhook. A second gateway later for redundancy.
5. **SMS alerts** for absence and fee dues. Attendance alerts are the strongest feature in the market.

### Phase 2 — make it a complete school system (about 2–3 months)
6. **Timetable** with substitutions.
7. **Exams and report cards** by exam term, with marks entry, grading, and printable report cards. SEE GPA support.
8. **IEMIS-ready export** (student status, exam results, transfers).
9. **Transport** (routes, stops, bus fees).
10. **Library** (catalogue, issue and return, fines).
11. **Leave** (formal request and approval workflow).

### Phase 3 — expansion (later)
12. Hostel and canteen.
13. Visitor and front-office log, ID cards.
14. Staff payroll and HR.
15. Biometric or QR attendance hardware integration.
16. Accounts and ledger (for schools that need full bookkeeping).
17. Health and behaviour records.

### International add-ons (after the first foreign pilot)
- Multi-tenant isolation (`school_id` on every table, tested).
- Multi-currency billing in USD and EUR, plus tax handling.
- FERPA and GDPR consent and data residency (see `docs/INTERNATIONAL_READINESS.md`).
- IB PYP and MYP templates (portfolio, unit planning, report comments). Toddle shows this is a separate product category.
- Multi-language UI (English, Nepali, then Spanish, French, Arabic).

---

## 8. Decisions needed from you

1. **Phase 1 payments:** start with eSewa or Khalti? Each needs a merchant account and an agreement with the provider.
2. **Parent accounts:** one login per guardian, or one per family?
3. **SMS provider:** which Nepali SMS gateway will we use? Costs vary and must be checked before pricing.
4. **Pilot schools:** do we have named schools in Bagmati Province willing to pilot Phase 1?
5. **Price model:** per-school flat fee, per-student fee, or a free core with paid fee and SMS modules? Earlier research favours a free core with paid modules.

---

## Sources

Product and vendor pages and comparison blogs. Use for direction, not as verified facts.

- [1] Panoramic Infotech: school management software — https://www.panoramicinfotech.com/school-management-software
- [2] SlideShare: school management system modules — https://www.slideshare.net/slideshow/school-management-system-73646101/73646101
- [3] Camu Digital Campus: school management software guide — https://camudigitalcampus.com/blogs/school-management-system-software-guide/
- [4] Gartner: K-12 student information systems — https://www.gartner.com/reviews/market/k-12-education-student-information-systems
- [5] Edumerge: what is a school management system — https://www.edumerge.com/blog/what-is-a-school-management-system
- [6] Medium: most important modules of school management software — https://medium.com/@jessica-38866/the-most-important-modules-of-school-management-software-a234850222bf
- Research.com: 20 best student information systems — https://research.com/software/best-student-information-systems
- TrustRadius: Veracross vs Blackbaud — https://www.trustradius.com/compare-products/on-products-vs-veracross
- Toddle PYP — https://www.toddleapp.com/ib-pyp/ ; Toddle MYP — https://www.toddleapp.com/ib-myp/ ; Toddle IB candidate schools — https://www.toddleapp.com/ib-candidate-schools/
- Capterra: brightwheel — https://www.capterra.com/p/144060/brightwheel/
- GetApp: brightwheel — https://www.getapp.com/education-childcare-software/a/brightwheel/
- Illumine: Brightwheel vs Lillio vs Procare — https://illumine.app/blog/brightwheel-vs-lillio-vs-procare
- iVake: published ERP pricing (India) — https://www.ivake.com/erp-software-published-pricing
- Intelcampus: top 10 school ERP India 2026 — https://intelcampus.com/blog/top-10-school-erp-software-india-2026
- Nimble Educational ERP (Nepal) — https://nimble.com.np/school-college-software
- Web Zone inSchoolERP (Nepal) — https://webzonenepal.com/schoolerp/
- pdpspectra School ERP Nepal — https://pdpspectra.com/solutions/school-erp-nepal/
- pdpspectra Student Experience App Nepal — https://pdpspectra.com/solutions/student-experience-nepal/
- WebApp Nepal payment gateway integration — https://webappnepal.com/service/payment-gateway
- Kathmandu Post: Economic Survey 2025-26 — https://kathmandupost.com/national/2026/05/28/economic-survey-shows-falling-enrollment-in-community-schools-and-rapid-growth-in-public-health-facilities
- Vietnam News (citing Economic Survey) — https://vietnamnews.vn/world/1782624/community-schools-shrink-as-private-education-expands-in-nepal.html
- EduSanjal: school and higher education system in Nepal — https://edusanjal.com/blog/education-levels-nepal/
- EduSanjal: CEHRD notice on IEMIS update — https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/
- myRepublica: NEB single registration system — https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12
- Slicejob: NEB Class 11 registration guide (2023) — https://www.slicejob.com/blog/neb-class-11-registration-application-form-2080
