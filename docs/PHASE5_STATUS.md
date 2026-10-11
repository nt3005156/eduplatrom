# Phase 5 status: Nepal localisation and government reporting

**Status: in progress. Three of the build items are done (BS calendar, Devanagari in PDFs, i18n for the parent portal and sign-in). Not started: IEMIS export, NEB fields in the UI, Nepali SMS templates. The exit gate is not met.**

Source: `docs/PRODUCTION_ROADMAP.md`, Phase 5.

## What is done

### 1. BS (Bikram Sambat) calendar, server side
- `server/src/utils/bsDate.js`: `bsToAd`, `adToBs`, `isValidBs`, `parseBs`, `formatBsNepali`.
- Library: `bikram-sambat` 1.8.1, Apache-2.0 (pinned). Its month-length table covers BS 1970 to 2090.
- Storage stays AD (ISO). BS is converted at the edges (entry and display).
- Verification:
  - `server/test/golden/bs-month-starts.json`: 168 month starts (BS 2070-01 to 2083-12) with their AD dates. Every day in that range agrees with a second, independent library (`nepali-date-converter` 3.4.0, MIT).
  - Round-trip test over every day in that range, plus a continuity check (day + 1 within a month, day 1 on a new month).
  - Anchors: Baisakh 1 of 2081, 2082, 2083 (2024-04-13, 2025-04-14, 2026-04-14).
  - Invalid input is refused (month 13, day 32, out-of-range years, non-padded dates).
- **Not verified:** BS 2084 and later. The two libraries disagree there (about 460 days, all in BS 2084 to 2086). The official Nepal government calendar must be checked before any date past 2083 is used.

### 2. Devanagari in PDFs
- `server/assets/fonts/`: Noto Sans Devanagari, static Regular and Bold, made from the Google Fonts variable font with fontTools (wght 400 and 700). Licence: SIL OFL 1.1 (`OFL.txt` included).
- `server/src/services/pdf/fonts.js`: Latin text stays in Helvetica (searchable, output unchanged). Any text run containing Devanagari switches to Noto. English-only receipts embed no Noto font.
- Applied to the fee receipt and the marksheet.
- Visual check: a Nepali receipt was rendered and inspected. Matras and conjuncts shape correctly.

### 3. Tests
- `bs-calendar.test.js` (8 tests), `pdf-devanagari.test.js` (4 tests). Full server suite: 351 pass (346 before the i18n work, plus 5 for the language endpoint).

### 4. i18n (English and Nepali), parent portal scope
- Library: `i18next` 26.4.3 and `react-i18next` 17.0.16, both MIT, pinned.
- Files: `client/src/i18n/index.js` (setup, `applyLanguage`, device choice in `localStorage` under `nitex_lang`), `client/src/i18n/format.js` (`localeTag`, school-timezone dates), `client/src/i18n/locales/{en,ne}/{common,auth,guardian}.json`.
- Account preference: `users.language` (NULL means the device choice applies). `PUT /api/auth/me/language` accepts `en`, `ne`, or `null`. The language is returned from `/me` and sign-in, and a saved value overrides the device on sign-in.
- Screens converted: sign-in (including the reapply modal), setup from the one-time link, the parent portal (home, child attendance, fee alerts, profile, shell), and the English/Nepali switcher. The switcher is on the sign-in, setup, and portal screens.
- Build gate: `npm run build` runs `i18n:check` first. It fails if a key is missing in either language, a value is empty, interpolation variables differ, or a literal `t('…')` key in source does not exist. Route pages are lazy-loaded, so the bundle has no chunk-size warning.
- Fonts: Noto Sans Devanagari 400, 600, 700 (OFL 1.1). Under `lang="ne"` the body and headings use it directly, because brand fonts are set inline by `SettingsContext`.
- Dates: parent-portal dates follow the interface language in the Gregorian calendar (AD). BS is not shown in the interface yet.
- Verification:
  - `e2e/phase5_i18n_e2e.py`: 20 browser checks, both languages, no raw keys, no uncaught errors, account language override, setup page. Passes on a clean database.
  - `e2e/phase1_guardian_e2e.py`: 17 of 17 pass on a clean database.
  - Server suite: 351 of 351.
- **Nepali strings are draft.** See `client/src/i18n/locales/ne/DRAFT.md`. A native reviewer must check them before a school uses Nepali.
- **Not translated yet:** staff and student screens, the registration page, API error text and server notices (these stay English because the server sends them), and the Nepali SMS/email templates.

## What is not done, and why

| Item | Status | Blocker |
|---|---|---|
| IEMIS export | Not built | Needs the **current official CEHRD IEMIS template** from the school or CEHRD. The roadmap says to confirm the version before each export. Field mapping cannot be finished without it. |
| i18n, staff and student screens | Not started | Parent portal, sign-in, and setup are translated (see section 4). Staff and student screens are English only. Each further screen needs its strings extracted and checked by the Nepali reviewer. |
| Nepali translation review | Pending | All Nepali strings are draft. A **native reviewer** must approve them. |
| BS in the UI | Server only | DOB entry and display in BS need the client. The i18n base is now in place. |
| Nepali SMS and WhatsApp templates | Not started | Needs approved Nepali template text from the school and provider approval (Phase 2 accounts). |
| NEB registration fields | Columns exist (`neb_reg_no`, `iemis_id`, `dob_bs`) | No UI or validation for the single NEB registration number yet. |
| School-code mismatch (CEHRD vs NEB) | Not started | Needs the school's codes. |

## Exit gate (roadmap)

> A school can run a full year, including its government reporting, inside NITEX.

**Not met.** The IEMIS export does not exist, and the UI is English-only.

## Acceptance (roadmap) against what exists

- BS conversion tests against a reference table, at least 10 years around the current date: **met for BS 2070 to 2083 (14 years)**, with the caveat that the reference is two libraries, not the government calendar.
- IEMIS export validated on 200 students with zero format errors: **not started**.
- Every screen in the main flows renders in English and Nepali with no untranslated keys: **in progress**. Met for sign-in, setup, and the parent portal (with the switcher). Staff and student screens are not yet covered, so this criterion stays open.

## Licences added
- `bikram-sambat` (Apache-2.0), in `server/package.json`.
- Noto Sans Devanagari (SIL OFL 1.1), in `server/assets/fonts/` and `@fontsource/noto-sans-devanagari` in the client.
- `i18next` and `react-i18next` (MIT), in `client/package.json`.
