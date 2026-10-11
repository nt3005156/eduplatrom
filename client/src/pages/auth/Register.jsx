import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, User, Mail, Lock, ArrowRight, Clock3, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import AuthFooterStrip from '../../components/AuthFooterStrip.jsx';

function PendingApprovalNotice({ name, siteName }) {
  return (
    <div className="card card-pad fade-up" style={{ width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)', textAlign: 'center' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
        background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Clock3 size={30} color="var(--flame)" />
      </div>
      <h2 style={{ fontSize: 22, marginBottom: 8 }}>Thank you for registering, {name.split(' ')[0]}!</h2>
      <p className="text-dim" style={{ fontSize: 14.5, lineHeight: 1.6, marginBottom: 18 }}>
        Your account has been created and is now waiting for an administrator to review it.
        Once approved, you'll get full access to your class's study materials, assignments, and quizzes on {siteName}.
      </p>
      <div className="flex items-center gap-2" style={{
        justifyContent: 'center', padding: '10px 14px', borderRadius: 999, background: 'rgba(var(--knowledge-rgb),.12)',
        color: 'var(--knowledge)', fontSize: 13, fontWeight: 700, marginBottom: 22,
      }}>
        <CheckCircle2 size={15} /> Registration received
      </div>
      <Link to="/login" className="btn btn-outline btn-block">Back to Sign In</Link>
    </div>
  );
}

export default function Register() {
  const { register } = useAuth();
  const { settings } = useSettings();
  const [form, setForm] = useState({ name: '', email: '', password: '', class_level: 6, gender: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingResult, setPendingResult] = useState(null);

  const siteName = settings?.site_name || 'NITEX';

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await register(form);
      setPendingResult(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 20, right: 24 }}><ThemeToggle /></div>

      {pendingResult ? (
        <PendingApprovalNotice name={pendingResult.name} siteName={siteName} />
      ) : (
        <form onSubmit={submit} className="card card-pad fade-up" style={{ width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: settings?.logo_url ? 'transparent' : 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {settings?.logo_url ? <img src={settings.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GraduationCap size={20} color="#241407" />}
            </div>
            <span style={{ fontFamily: "'Fraunces'", fontWeight: 700, fontSize: 19 }}>{siteName}</span>
          </div>
          <h2 style={{ fontSize: 22, marginBottom: 4 }}>Create your student account</h2>
          <p className="text-dim text-sm" style={{ marginBottom: 22 }}>Join thousands of students learning smarter. Your account will need admin approval before you can sign in.</p>

          {error && <div style={{ background: 'rgba(255,107,129,.14)', color: 'var(--error)', padding: '10px 14px', borderRadius: 10, fontSize: 13.5, marginBottom: 18 }}>{error}</div>}

          <div className="field">
            <label>Full Name</label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 13, top: 14, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 38 }} required placeholder="Your full name"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Email address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 13, top: 14, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 38 }} type="email" required placeholder="you@example.com"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 13, top: 14, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 38 }} type="password" required minLength={6} placeholder="At least 6 characters"
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="field" style={{ flex: 1 }}>
              <label>Class</label>
              <select className="input" value={form.class_level} onChange={e => setForm({ ...form, class_level: Number(e.target.value) })}>
                {[6,7,8,9,10,11,12].map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Gender (optional)</label>
              <select className="input" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <button className="btn btn-primary btn-block" disabled={loading} type="submit" style={{ marginTop: 6 }}>
            {loading ? 'Creating account...' : 'Create Account'} <ArrowRight size={16} />
          </button>

          <p className="text-sm text-dim" style={{ textAlign: 'center', marginTop: 20 }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--flame)', fontWeight: 700 }}>Sign in</Link>
          </p>
        </form>
      )}
      <AuthFooterStrip />
    </div>
  );
}
