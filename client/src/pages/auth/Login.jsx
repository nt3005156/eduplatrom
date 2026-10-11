import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, Mail, Lock, ArrowRight, ShieldCheck, RotateCcw, X, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx';
import AuthFooterStrip from '../../components/AuthFooterStrip.jsx';
import Modal from '../../components/Modal.jsx';
import api from '../../api/client.js';

function ReapplyModal({ email, password, onClose }) {
  const { t } = useTranslation(['auth', 'common']);
  const toast = useToast();
  const [form, setForm] = useState({ section: '', gender: '' });
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    fd.append('email', email); fd.append('password', password);
    if (form.section) fd.append('section', form.section);
    if (form.gender) fd.append('gender', form.gender);
    files.forEach(f => fd.append('documents', f));
    try {
      await api.post('/applications/reapply-public', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDone(true);
      toast.success(t('reapply.toastOk'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('reapply.toastFail'));
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      {done ? (
        <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
          <h3 style={{ marginBottom: 8 }}>{t('reapply.submitted')}</h3>
          <p className="text-dim text-sm" style={{ marginBottom: 18 }}>{t('reapply.submittedText')}</p>
          <button className="btn btn-primary btn-block" onClick={onClose}>{t('common:actions.close')}</button>
        </div>
      ) : (
        <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 440 }}>
          <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
            <h3>{t('reapply.title')}</h3><button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
          </div>
          <p className="text-dim text-sm" style={{ marginBottom: 16 }}>
            {t('reapply.rejectedNotice')}
          </p>
          <div className="field"><label>{t('reapply.section')}</label><input className="input" value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} /></div>
          <div className="field"><label>{t('reapply.gender')}</label>
            <select className="input" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
              <option value="">{t('reapply.noChange')}</option><option value="male">{t('reapply.male')}</option><option value="female">{t('reapply.female')}</option><option value="other">{t('reapply.other')}</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>{t('reapply.documents')}</label><input className="input" type="file" multiple onChange={e => setFiles(Array.from(e.target.files))} /></div>
          <button className="btn btn-primary btn-block" disabled={saving} style={{ marginTop: 16 }}><Upload size={15} /> {saving ? t('reapply.submitting') : t('reapply.submit')}</button>
        </form>
      )}
    </Modal>
  );
}

export default function Login() {
  const { t } = useTranslation(['auth', 'common']);
  const { login } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pendingStatus, setPendingStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showReapply, setShowReapply] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setPendingStatus(null); setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'admin' ? '/admin' : user.role === 'guardian' ? '/guardian' : '/dashboard');
    } catch (err) {
      if (err.response?.data?.approval_status) {
        setPendingStatus(err.response.data.approval_status);
      }
      setError(err.response?.data?.error || t('login.failed'));
    } finally { setLoading(false); }
  };

  const quickFill = (role) => {
    if (role === 'admin') { setEmail('admin@nitex.com'); setPassword('Admin@123'); }
    else { setEmail('student@nitex.com'); setPassword('Student@123'); }
  };

  const siteName = settings?.site_name || 'NITEX';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      <div
        className="login-hero"
        style={{
          flex: 1, background: settings?.hero_image_url
            ? `linear-gradient(135deg, rgba(var(--brand-primary-rgb),.88), rgba(0,0,0,.55)), url(${settings.hero_image_url}) center/cover`
            : 'linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 70%, black) 55%, color-mix(in srgb, var(--primary) 40%, black) 100%)',
          color: '#fff', padding: '60px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,.08)', top: -120, right: -100 }} />
        <div style={{ position: 'absolute', width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,.06)', bottom: -80, left: -60 }} />
        <div className="flex items-center gap-2" style={{ zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {settings?.logo_url ? <img src={settings.logo_url} alt={siteName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GraduationCap size={24} />}
          </div>
          <span style={{ fontFamily: "'Fraunces'", fontWeight: 700, fontSize: 22 }}>{siteName}</span>
        </div>

        <div style={{ zIndex: 1, maxWidth: 460 }}>
          <h1 style={{ fontSize: 40, lineHeight: 1.15, marginBottom: 18, color: '#fff' }}>{t('login.heroTitle')}</h1>
          <p style={{ fontSize: 15.5, opacity: .9, lineHeight: 1.6 }}>
            {t('login.heroText')}
          </p>
          <div className="flex gap-4" style={{ marginTop: 34 }}>
            {[['7', t('login.statClasses')], ['1000+', t('login.statResources')], ['24/7', t('login.statAccess')]].map(([n, l]) => (
              <div key={l}>
                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{n}</div>
                <div style={{ fontSize: 12.5, opacity: .8 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1" style={{ zIndex: 1, fontSize: 13, opacity: .85 }}>
          <ShieldCheck size={16} /> {t('login.secure')}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}>
        <div className="flex items-center gap-2" style={{ position: 'absolute', top: 20, right: 24 }}><LanguageSwitcher /><ThemeToggle /></div>
        <form onSubmit={submit} className="card card-pad fade-up" style={{ width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-lg)' }}>
          <h2 style={{ fontSize: 24, marginBottom: 6 }}>{t('login.title')}</h2>
          <p className="text-dim text-sm" style={{ marginBottom: 26 }}>{t('login.subtitle')}</p>

          {error && (
            <div style={{
              background: pendingStatus === 'pending' ? 'rgba(var(--flame-rgb),.14)' : 'rgba(255,107,129,.14)',
              color: pendingStatus === 'pending' ? 'var(--flame)' : 'var(--error)',
              padding: '10px 14px', borderRadius: 10, fontSize: 13.5, marginBottom: 18, lineHeight: 1.5,
            }}>
              {error}
              {pendingStatus === 'rejected' && (
                <button type="button" className="btn btn-outline btn-sm" style={{ display: 'flex', marginTop: 10 }} onClick={() => setShowReapply(true)}>
                  <RotateCcw size={13} /> {t('login.reapply')}
                </button>
              )}
            </div>
          )}

          <div className="field">
            <label>{t('login.email')}</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 13, top: 14, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 38 }} type="email" required placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>{t('login.password')}</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 13, top: 14, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 38 }} type="password" required placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>

          <button className="btn btn-primary btn-block" disabled={loading} type="submit" style={{ marginTop: 8 }}>
            {loading ? t('login.signingIn') : t('login.signIn')} <ArrowRight size={16} />
          </button>

          {import.meta.env.DEV && (
            <div className="flex gap-2" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => quickFill('student')}>{t('login.demoStudent')}</button>
              <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => quickFill('admin')}>{t('login.demoAdmin')}</button>
            </div>
          )}

          <p className="text-sm text-dim" style={{ textAlign: 'center', marginTop: 22 }}>
            {t('login.newStudent')} <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 700 }}>{t('login.createAccount')}</Link>
          </p>
        </form>
        <AuthFooterStrip />
      </div>

      {showReapply && <ReapplyModal email={email} password={password} onClose={() => setShowReapply(false)} />}

      <style>{`
        @media (max-width: 900px){ .login-hero{ display:none !important; } }
      `}</style>
    </div>
  );
}
