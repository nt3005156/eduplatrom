import { useEffect, useState } from 'react';
import { Plus, Trash2, Megaphone } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import GlobalFilterBar from '../../components/GlobalFilterBar.jsx';
import { useModuleFilters } from '../../hooks/useModuleFilters.js';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

export default function AdminAnnouncements() {
  const toast = useToast();
  const { allowedClasses, hasPermission } = usePermissions();
  const { classLevel, setClassLevel } = useModuleFilters();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', class_level: '' });
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Announcements page uses the global class filter purely to narrow the *viewed* list
  // (server already returns class-specific + all-class items); creating a new
  // announcement still lets the author pick its own target class independently.
  const load = () => {
    const params = new URLSearchParams();
    if (classLevel) params.set('class_level', classLevel);
    api.get(`/announcements?${params.toString()}`).then(({ data }) => setItems(data.announcements));
  };
  useEffect(() => { load(); }, [classLevel]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/announcements', { ...form, class_level: form.class_level || null });
      toast.success(`Announcement published — ${form.class_level ? `Class ${form.class_level}` : 'all classes'} notified`);
      setForm({ title: '', body: '', class_level: '' }); setShowForm(false); load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to publish announcement');
    }
  };
  const remove = async () => {
    const a = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/announcements/${a.id}`);
      toast.success('Announcement deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete announcement');
    }
  };

  return (
    <AppLayout title="Announcements" subtitle="Broadcast updates to all students or a specific class">
      <GlobalFilterBar classLevel={classLevel} onClassChange={setClassLevel} showSection={false} showSubject={false} />

      <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16 }}>{classLevel ? `Class ${classLevel}` : 'All Classes'} Announcements</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}><Plus size={14} /> New Announcement</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="field"><label>Title</label><input className="input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
          <div className="field"><label>Message</label><textarea className="input" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
          <div className="field"><label>Target Class{hasPermission('communication.broadcast_school') ? ' (leave blank for all)' : ''}</label>
            <select className="input" required={!hasPermission('communication.broadcast_school')} value={form.class_level} onChange={e => setForm({ ...form, class_level: e.target.value })}>
              {hasPermission('communication.broadcast_school') && <option value="">All Classes (school-wide)</option>}
              {!hasPermission('communication.broadcast_school') && <option value="">Select a class</option>}
              {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
            {!hasPermission('communication.broadcast_school') && (
              <div className="text-xs text-dim" style={{ marginTop: 6 }}>You can only announce to classes you are assigned to.</div>
            )}
          </div>
          <button className="btn btn-primary btn-block">Publish</button>
        </form>
      )}

      <div className="flex-col gap-2">
        {items.map(a => (
          <div key={a.id} className="card card-pad flex justify-between items-start gap-2">
            <div className="flex gap-3">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Megaphone size={16} color="var(--primary)" />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{a.title} {a.class_level ? <span className="badge badge-gray" style={{ marginLeft: 6 }}>Class {a.class_level}</span> : <span className="badge badge-purple" style={{ marginLeft: 6 }}>All Classes</span>}</div>
                <div className="text-sm text-dim" style={{ marginTop: 4 }}>{a.body}</div>
                <div className="text-xs text-dim" style={{ marginTop: 6 }}>{new Date(a.created_at).toLocaleString()}</div>
              </div>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(a)}><Trash2 size={14} color="var(--danger)" /></button>
          </div>
        ))}
        {items.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No announcements published yet.</div>}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this announcement?"
          message={`Are you sure you want to delete "${confirmDelete.title}"?`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
