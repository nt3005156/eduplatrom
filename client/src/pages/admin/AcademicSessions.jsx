import { useEffect, useState } from 'react';
import { Calendar, Plus, CheckCircle2 } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../context/ToastContext.jsx';

function NewSessionModal({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', is_active: false });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/settings/sessions', form);
      toast.success(`Academic session "${form.name}" created`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create session');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 420 }}>
        <h3 style={{ marginBottom: 16 }}>New Academic Session</h3>
        <div className="field"><label>Name</label><input className="input" required placeholder="e.g. 2026-2027" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Start Date</label><input className="input" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label>End Date</label><input className="input" type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 18, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
          Set as the active session
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function AcademicSessions() {
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const load = () => api.get('/settings/sessions').then(({ data }) => setSessions(data.sessions));
  useEffect(() => { load(); }, []);

  const activate = async (id) => {
    try {
      await api.put(`/settings/sessions/${id}/activate`);
      toast.success('Active academic session updated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to activate session');
    }
  };

  return (
    <AppLayout title="Academic Sessions" subtitle="Manage school years and mark which one is currently active">
      <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16 }}>All Sessions</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> New Session</button>
      </div>
      <div className="flex-col gap-2">
        {sessions.map(s => (
          <div key={s.id} className="card card-pad flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar size={18} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <div className="text-xs text-dim">{s.start_date || '—'} to {s.end_date || '—'}</div>
              </div>
            </div>
            {s.is_active ? (
              <span className="badge badge-green"><CheckCircle2 size={11} /> Active</span>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => activate(s.id)}>Set Active</button>
            )}
          </div>
        ))}
        {sessions.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No academic sessions yet.</div>}
      </div>
      {showNew && <NewSessionModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </AppLayout>
  );
}
