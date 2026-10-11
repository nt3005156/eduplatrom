import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { KeyRound, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import api from '../../api/client.js';

// Opened from a one-time link sent by the school. The person chooses their own password.
export default function SetupPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [check, setCheck] = useState({ loading: true, valid: false, name: '', error: '' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setCheck({ loading: false, valid: false, error: 'This page needs a setup link from your school.' }); return; }
    api.get(`/auth/setup/${encodeURIComponent(token)}`)
      .then(({ data }) => setCheck({ loading: false, valid: true, name: data.name, error: '' }))
      .catch(err => setCheck({ loading: false, valid: false, error: err.response?.data?.error || 'This link is not valid.' }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/setup', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the password. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg)' }}>
      <div className="glass-card card-pad" style={{ width: '100%', maxWidth: 420 }}>
        {check.loading ? (
          <p className="text-dim">Checking your link...</p>
        ) : done ? (
          <div style={{ textAlign: 'center' }}>
            <CheckCircle2 size={40} color="var(--accent)" style={{ marginBottom: 10 }} />
            <h3 style={{ marginBottom: 8 }}>Password saved</h3>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>You can now sign in with your email and the new password.</p>
            <Link to="/login" className="btn btn-primary btn-block"><ArrowRight size={15} /> Go to sign in</Link>
          </div>
        ) : !check.valid ? (
          <div style={{ textAlign: 'center' }}>
            <AlertTriangle size={40} color="var(--warning)" style={{ marginBottom: 10 }} />
            <h3 style={{ marginBottom: 8 }}>Link not valid</h3>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>{check.error}</p>
            <Link to="/login" className="btn btn-outline btn-block">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <KeyRound size={18} /> <h3>Set your password</h3>
            </div>
            <p className="text-dim text-sm" style={{ marginBottom: 18 }}>Welcome, {check.name}. Choose a password of at least 12 characters. Do not use a password you use elsewhere.</p>
            <div className="field"><label htmlFor="pw">New password</label>
              <input id="pw" className="input" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw2">Confirm password</label>
              <input id="pw2" className="input" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
            {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : 'Save password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
