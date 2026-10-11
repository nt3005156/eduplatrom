import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx';

// The parent portal has its own shell. It does not use the school sidebar, which is built for staff and students.
export default function GuardianLayout({ title, back = null, children }) {
  const { t } = useTranslation(['guardian', 'common']);
  const { logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px',
        borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 5 }}>
        <div style={{ minWidth: 0 }}>
          <div className="text-dim" style={{ fontSize: 12 }}>{settings.site_name || 'NITEX'} · {t('layout.portal')}</div>
          <strong style={{ fontSize: 17 }}>{title}</strong>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle compact />
          <button className="btn btn-ghost btn-sm" onClick={signOut} aria-label={t('common:actions.signOut')}><LogOut size={15} /> {t('common:actions.signOut')}</button>
        </div>
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '18px 16px 56px' }}>
        {back && <Link to={back} className="text-dim text-sm flex items-center gap-2" style={{ marginBottom: 12 }}><ArrowLeft size={15} /> {t('common:actions.back')}</Link>}
        {children}
      </main>
    </div>
  );
}
