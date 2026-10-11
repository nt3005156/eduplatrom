# Phase 5 status: Nepal localisation and government reporting

**Status: in progress. Two of five build items are done (BS calendar, Devanagari in PDFs). Not started: i18n, IEMIS export, NEB fields in the UI. The exit gate is not met.**

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
- `bs-calendar.test.js` (8 tests), `pdf-devanagari.test.js` (4 tests). Full server suite: 346 pass.

## What is not done, and why

| Item | Status | Blocker |
|---|---|---|
| IEMIS export | Not built | Needs the **current official CEHRD IEMIS template** from the school or CEHRD. The roadmap says to confirm the version before each export. Field mapping cannot be finished without it. |
| i18n (English and Nepali) | Not started | Client UI is English-only. Needs a decision on the library (react-i18next, MIT, is available) and a **native Nepali reviewer** for the translations. Estimated several engineer-days of string extraction alone. |
| BS in the UI | Server only | DOB entry and display in BS need the client. Depends on i18n decisions. |
| Nepali SMS and WhatsApp templates | Not started | Needs approved Nepali template text from the school and provider approval (Phase 2 accounts). |
| NEB registration fields | Columns exist (`neb_reg_no`, `iemis_id`, `dob_bs`) | No UI or validation for the single NEB registration number yet. |
| School-code mismatch (CEHRD vs NEB) | Not started | Needs the school's codes. |

## Exit gate (roadmap)

> A school can run a full year, including its government reporting, inside NITEX.

**Not met.** The IEMIS export does not exist, and the UI is English-only.

## Acceptance (roadmap) against what exists

- BS conversion tests against a reference table, at least 10 years around the current date: **met for BS 2070 to 2083 (14 years)**, with the caveat that the reference is two libraries, not the government calendar.
- IEMIS export validated on 200 students with zero format errors: **not started**.
- Every screen in the main flows renders in both languages with no untranslated keys: **not started**.

## Licences added
- `bikram-sambat` (Apache-2.0), in `server/package.json`.
- Noto Sans Devanagari (SIL OFL 1.1), in `server/assets/fonts/`.
