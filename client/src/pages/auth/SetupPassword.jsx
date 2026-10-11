import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import api from '../../api/client.js';
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx';

// Opened from a one-time link sent by the school. The person chooses their own password.
export default function SetupPassword() {
  const { t } = useTranslation(['auth', 'common']);
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [check, setCheck] = useState({ loading: true, valid: false, name: '', error: '', fallback: '' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setCheck({ loading: false, valid: false, error: '', fallback: 'setup.needsLink' }); return; }
    api.get(`/auth/setup/${encodeURIComponent(token)}`)
      .then(({ data }) => setCheck({ loading: false, valid: true, name: data.name, error: '', fallback: '' }))
      .catch(err => setCheck({ loading: false, valid: false, error: err.response?.data?.error || '', fallback: 'setup.invalidLink' }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError(t('setup.mismatch')); return; }
    setSaving(true);
    try {
      await api.post('/auth/setup', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || t('setup.saveFailed'));
    } finally { setSaving(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg)' }}>
      <div style={{ position: 'absolute', top: 20, right: 24 }}><LanguageSwitcher /></div>
      <div className="glass-card card-pad" style={{ width: '100%', maxWidth: 420 }}>
        {check.loading ? (
          <p className="text-dim">{t('setup.checking')}</p>
        ) : done ? (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle2 size={40} color="var(--accent)" style={{ marginBottom: 10 }} />
            <h3 style={{ marginBottom: 8 }}>{t('setup.savedTitle')}</h3>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>{t('setup.savedText')}</p>
            <Link to="/login" className="btn btn-primary btn-block"><ArrowRight size={15} /> {t('setup.goToSignIn')}</Link>
          </div>
        ) : !check.valid ? (
          <div style={{ textAlign: 'center' }}>
            <AlertTriangle size={40} color="var(--warning)" style={{ marginBottom: 10 }} />
            <h3 style={{ marginBottom: 8 }}>{t('setup.notValidTitle')}</h3>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>{check.error || t(check.fallback)}</p>
            <Link to="/login" className="btn btn-outline btn-block">{t('setup.backToSignIn')}</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <KeyRound size={18} /> <h3>{t('setup.setTitle')}</h3>
            </div>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>{t('setup.welcome', { name: check.name })}</p>
            <div className="field"><label htmlFor="pw">{t('setup.newPassword')}</label>
              <input id="pw" className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw2">{t('setup.confirmPassword')}</label>
              <input id="pw2" className="input" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
            {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary btn-block" disabled={saving}>{saving ? t('setup.saving') : t('setup.save')}</button>
          </form>
        )}
      </div>
    </div>
  );
}
