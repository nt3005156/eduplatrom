import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import api from '../api/client.js';
import { applyLanguage, UI_LANGUAGES } from '../i18n/index.js';

// English / नेपाली toggle. Applies the choice at once on this device. When signed in, it also saves the choice to the account.
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const current = UI_LANGUAGES.includes(i18n.language) ? i18n.language : 'en';

  const choose = async (lang) => {
    if (lang === current) return;
    await applyLanguage(lang);
    if (!user) return;
    try {
      await api.put('/auth/me/language', { language: lang });
      updateUser({ language: lang });
    } catch {
      toast.error(t('language.saveFailed'));
    }
  };

  const labels = { en: t('language.english'), ne: t('language.nepali') };

  return (
    <div role="group" aria-label={t('language.switchTo')} className="flex items-center" style={{ gap: 2, padding: 3, borderRadius: 999, border: '1.5px solid var(--border)', background: 'var(--surface-2)' }}>
      {UI_LANGUAGES.map(lang => {
        const active = lang === current;
        return (
          <button
            key={lang}
            type="button"
            lang={lang}
            aria-pressed={active}
            title={t('language.switchTo')}
            onClick={() => choose(lang)}
            style={{
              border: 'none', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: active ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)',
            }}
          >
            {labels[lang]}
          </button>
        );
      })}
    </div>
  );
}
