import { useEffect, useState } from 'react';
import { Plus, Search, X, Copy, Check, Link2, Trash2, UserPlus } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const RELATIONSHIPS = ['father', 'mother', 'guardian', 'grandparent', 'other'];

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the field is still selectable */ }
  };
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
      <input className="input" readOnly value={value} onFocus={e => e.target.select()} aria-label="Setup link" style={{ fontSize: 12 }} />
      <button type="button" className="btn btn-outline btn-sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function StudentPicker({ onPick, excludeIds = [] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/guardians/student-search', { params: { q: q.trim() } }).then(({ data }) => setResults(data.students)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-faint)' }} />
        <input className="input" style={{ paddingLeft: 32 }} placeholder="Search student by name, roll or admission no." value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" />
      </div>
      {results.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginTop: 6, maxHeight: 200, overflowY: 'auto' }}>
          {results.filter(s => !excludeIds.includes(s.id)).map(s => (
            <button type="button" key={s.id} onClick={() => { onPick(s); setQ(''); setResults([]); }}
              className="btn-ghost" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '8px 10px', textAlign: 'left' }}>
              <span>{s.name}</span>
              <span className="text-dim text-sm">Class {s.class_level}{s.section} {s.roll_no ? `· Roll ${s.roll_no}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateGuardian({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/guardians', {
        ...form,
        student_links: picked.map(p => ({ student_id: p.id, relationship: p.relationship || 'guardian', is_primary: p.is_primary })),
      });
      setResult(data);
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create the guardian');
    } finally { setSaving(false); }
  };

  if (result) {
    return (
      <Modal onClose={onClose}>
        <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 520 }}>
          <h3 style={{ marginBottom: 8 }}>Guardian added</h3>
          <p className="text-dim text-sm">Share this one-time link with {result.guardian.name} ({result.guardian.email}). They choose their own password when they open it. The link expires in {result.setup_expires_in_days} days and works once.</p>
          <CopyField value={result.setup_url} />
          <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <h3>Add guardian</h3><button type="button" className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="field"><label htmlFor="g-name">Full name</label><input id="g-name" className="input" required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="g-email">Email (used to sign in)</label><input id="g-email" className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="g-phone">Mobile (optional)</label><input id="g-phone" className="input" placeholder="98XXXXXXXX or +country code" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>

        <div className="field"><label>Children</label>
          <StudentPicker excludeIds={picked.map(p => p.id)} onPick={s => setPicked([...picked, { ...s, relationship: 'guardian' }])} />
          {picked.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 140 }}>{p.name} <span className="text-dim text-sm">Class {p.class_level}{p.section}</span></span>
              <select className="input" style={{ width: 140 }} value={p.relationship} aria-label={`Relationship to ${p.name}`}
                onChange={e => setPicked(picked.map((x, j) => j === i ? { ...x, relationship: e.target.value } : x))}>
                {RELATIONSHIPS.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
              <button type="button" className="btn-ghost" aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((_, j) => j !== i))}><X size={16} /></button>
            </div>
          ))}
        </div>

        <button className="btn btn-primary btn-block" disabled={saving} style={{ marginTop: 10 }}><UserPlus size={15} /> {saving ? 'Saving...' : 'Create guardian and get setup link'}</button>
      </form>
    </Modal>
  );
}

function GuardianDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [newLink, setNewLink] = useState(null);
  const [confirmUnlink, setConfirmUnlink] = useState(null);

  const load = () => api.get(`/guardians/${id}`).then(({ data }) => {
    setData(data); setForm({ name: data.guardian.name, phone: data.guardian.phone || '' });
  }).catch(() => toast.error('Could not load this guardian'));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const saveProfile = async () => {
    try { await api.put(`/guardians/${id}`, form); toast.success('Saved'); load(); onChanged(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };
  const patchLink = async (studentId, body) => {
    try { const { data: r } = await api.patch(`/guardians/${id}/students/${studentId}`, body); setData({ ...data, links: r.links }); onChanged(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not update access'); }
  };
  const addLink = async (s) => {
    try { const { data: r } = await api.post(`/guardians/${id}/students`, { student_id: s.id, relationship: 'guardian' }); setData({ ...data, links: r.links }); onChanged(); toast.success(`${s.name} linked`); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not link'); }
  };
  const unlink = async () => {
    const link = confirmUnlink; setConfirmUnlink(null);
    try { const { data: r } = await api.delete(`/guardians/${id}/students/${link.student_id}`); setData({ ...data, links: r.links }); onChanged(); toast.success('Unlinked. Access ends immediately.'); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not unlink'); }
  };
  const newSetup = async () => {
    try { const { data: r } = await api.post(`/guardians/${id}/setup-link`); setNewLink(r.setup_url); onChanged(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not create a link'); }
  };

  if (!data) return <Modal onClose={onClose}><div className="glass-card card-pad" style={{ width: 360 }}>Loading...</div></Modal>;
  const linkedIds = data.links.map(l => l.student_id);

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <h3>{data.guardian.name}</h3><button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}><label htmlFor="d-name">Name</label><input id="d-name" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label htmlFor="d-phone">Mobile</label><input id="d-phone" className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div className="flex gap-2" style={{ margin: '10px 0 18px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={saveProfile}>Save details</button>
          <button className="btn btn-outline btn-sm" onClick={newSetup}><Link2 size={14} /> New sign-in link</button>
          <span className="text-dim text-sm" style={{ alignSelf: 'center' }}>{data.guardian.email}</span>
        </div>
        {newLink && <div style={{ marginBottom: 16 }}><div className="text-dim text-sm">The previous link no longer works. Share this one:</div><CopyField value={newLink} /></div>}

        <h4 style={{ marginBottom: 8 }}>Children and access</h4>
        {data.links.length === 0 && <p className="text-dim text-sm">Not linked to any child. The guardian cannot see anything until a child is linked.</p>}
        {data.links.map(l => (
          <div key={l.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 8 }}>
              <strong>{l.student_name} <span className="text-dim text-sm">Class {l.class_level}{l.section}{l.roll_no ? ` · Roll ${l.roll_no}` : ''}</span></strong>
              <div className="flex items-center gap-2">
                <select className="input" style={{ width: 130 }} value={l.relationship} aria-label={`Relationship for ${l.student_name}`} onChange={e => patchLink(l.student_id, { relationship: e.target.value })}>
                  {RELATIONSHIPS.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                </select>
                <button className="btn-ghost" aria-label={`Unlink ${l.student_name}`} onClick={() => setConfirmUnlink(l)}><Trash2 size={16} color="var(--danger)" /></button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 13.5 }}>
              {[['is_primary', 'Primary contact'], ['can_view_attendance', 'Attendance'], ['can_view_fees', 'Fees (Phase 3)'], ['can_view_results', 'Exam results (published only)'], ['can_pickup', 'Pickup']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!l[k]} onChange={e => patchLink(l.student_id, { [k]: e.target.checked })} /> {label}
                </label>
              ))}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: l.restricted ? 'var(--danger)' : undefined }}>
                <input type="checkbox" checked={!!l.restricted} onChange={e => patchLink(l.student_id, { restricted: e.target.checked })} /> Restrict (custody or record hold: hides this child)
              </label>
            </div>
          </div>
        ))}
        <div className="field" style={{ marginTop: 12 }}><label>Link another child</label>
          <StudentPicker excludeIds={linkedIds} onPick={addLink} />
        </div>
      </div>
      {confirmUnlink && (
        <ConfirmDialog title="Unlink this child?" danger
          message={`${data.guardian.name} will lose access to ${confirmUnlink.student_name} immediately. The records themselves are kept.`}
          confirmLabel="Unlink" onConfirm={unlink} onCancel={() => setConfirmUnlink(null)} />
      )}
    </Modal>
  );
}

export default function Guardians() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = () => api.get('/guardians').then(({ data }) => setRows(data.guardians)).catch(() => toast.error('Could not load guardians'));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppLayout title="Guardians" subtitle="Parents and guardians who sign in to see their children. Each guardian sees only the children linked here.">
      <div className="flex justify-between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <span className="text-dim text-sm">{rows ? `${rows.length} guardian account(s)` : ''}</span>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> Add guardian</button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
              <th style={{ padding: '12px 14px' }}>Name</th><th>Email</th><th>Mobile</th><th>Children</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && <tr><td colSpan={6} style={{ padding: 18 }} className="text-dim">No guardians yet. Add one, or import students with guardian columns.</td></tr>}
            {(rows || []).map(g => (
              <tr key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px' }}>{g.name}</td>
                <td>{g.email}</td>
                <td>{g.phone || '—'}</td>
                <td>{g.children}</td>
                <td>{g.setup_pending ? <span className="badge badge-orange">Setup pending</span> : <span className="badge badge-green">Active</span>}</td>
                <td><button className="btn btn-outline btn-sm" onClick={() => setOpenId(g.id)}>Manage</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreateGuardian onClose={() => setCreating(false)} onCreated={load} />}
      {openId && <GuardianDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </AppLayout>
  );
}
