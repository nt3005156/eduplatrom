import { Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext.jsx';

export default function ThemeToggle({ compact = false }) {
  const { t } = useTranslation('common');
  const { theme, toggleTheme } = useSettings();
  const isDark = theme === 'dark';
  const label = isDark ? t('theme.toLight') : t('theme.toDark');

  return (
    <button
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      style={{
        position: 'relative', width: compact ? 40 : 52, height: compact ? 22 : 28, borderRadius: 999,
        border: '1.5px solid var(--border)', background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', padding: 3, transition: 'background-color .2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: isDark ? (compact ? 20 : 26) : 2,
          width: compact ? 16 : 22, height: compact ? 16 : 22, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'left .25s cubic-bezier(.4,0,.2,1)', boxShadow: '0 2px 6px rgba(0,0,0,.25)',
        }}
      >
        {isDark ? <Moon size={compact ? 9 : 12} color="#fff" /> : <Sun size={compact ? 9 : 12} color="#fff" />}
      </span>
    </button>
  );
}
