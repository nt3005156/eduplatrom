# Nepali strings: draft, pending native review

Every file in this folder (`common.json`, `auth.json`, `guardian.json`) is a machine-free first draft written by the engineering team. It has not been reviewed by a native Nepali speaker or by the school.

Before a school relies on the Nepali interface:

1. A native reviewer checks every value for meaning, register (formal address), and spelling.
2. Agreed school terms (for example the name for a section or a class level) replace any generic wording.
3. Run `npm run i18n:check` after each edit. Keys must stay in step with `en/`.

English is the reference. If a Nepali value is wrong, the English value still defines the meaning.
