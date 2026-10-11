// Interface translations (English and Nepali). Every visible string in the parent portal and the sign-in flow
// comes from these files. Keys must exist in both languages: `npm run i18n:check` enforces it before a build.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enGuardian from './locales/en/guardian.json';
import neCommon from './locales/ne/common.json';
import neAuth from './locales/ne/auth.json';
import neGuardian from './locales/ne/guardian.json';

export const UI_LANGUAGES = ['en', 'ne'];
export const NAMESPACES = ['common', 'auth', 'guardian'];
const STORAGE_KEY = 'nitex_lang';

/** Language to use before a user has signed in: the last choice on this device, else English. */
export function readStoredLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return UI_LANGUAGES.includes(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

/** Switches the interface language, remembers it on this device, and sets the page language for fonts and hyphenation. */
export function applyLanguage(lang) {
  const next = UI_LANGUAGES.includes(lang) ? lang : 'en';
  document.documentElement.lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode: keep the in-memory choice only */ }
  return i18n.changeLanguage(next);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, auth: enAuth, guardian: enGuardian },
    ne: { common: neCommon, auth: neAuth, guardian: neGuardian },
  },
  lng: readStoredLanguage(),
  fallbackLng: 'en',
  supportedLngs: UI_LANGUAGES,
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React escapes output already
  returnNull: false,
  react: { useSuspense: false },
});

document.documentElement.lang = i18n.language;

export default i18n;
