import { useCallback, useEffect, useState } from 'react';
import {
  Search, Plus, X, Ban, CheckCircle2, KeyRound, Layers, Trash2, Pencil, ShieldCheck,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

const ROLE_BADGE = {
  class_teacher: 'badge-purple',
  subject_teacher: 'badge-blue',
  coordinator: 'badge-green',
  exam_controller: 'badge-orange',
  academic_head: 'badge-red',
};

function RoleBadge({ role, label }) {
  if (!role) return <span className="text-dim text-sm">—</span>;
  return <span className={`badge ${ROLE_BADGE[role] || 'badge-gray'}`}>{label || role}</span>;
}

// One row of a Class -> Section -> Subject assignment, with cascading
// Section (loaded once a Class is picked) — never shows unscoped data.
function AssignmentRow({ row, sections, onChange, onRemove, subjects }) {
  return (
    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
      <select className="input" style={{ width: 130 }} value={row.class_level || ''} onChange={e => onChange({ ...row, class_level: e.target.value ? Number(e.target.value) : null, section: null })}>
        <option value="">Select class</option>
        {CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
      </select>

      <select className="input" style={{ width: 150 }} value={row.section || ''} disabled={!row.class_level} onChange={e => onChange({ ...row, section: e.target.value || null })}>
        <option value="">{row.class_level ? 'All sections' : 'Select class first'}</option>
        {row.class_level && sections(row.class_level).map(s => <option key={s.id} value={s.name}>Section {s.name}</option>)}
      </select>

      <select className="input" style={{ width: 180 }} disabled={!row.class_level} value={row.subject_id || ''} onChange={e => onChange({ ...row, subject_id: e.target.value ? Number(e.target.value) : null })}>
        <option value="">{row.class_level ? 'Select subject' : 'Select class first'}</option>
        {row.class_level && subjects(row.class_level).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <label className="flex items-center gap-1 text-xs text-dim" style={{ fontWeight: 600, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!row.is_class_teacher} onChange={e => onChange({ ...row, is_class_teacher: e.target.checked })} />
        Class Teacher for this section
      </label>

      <button type="button" className="btn-ghost btn-sm" onClick={onRemove} style={{ marginLeft: 'auto' }}><Trash2 size={14} /></button>
    </div>
  );
}

function AssignmentsModal({ teacher, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(teacher.assignments.map(a => ({ class_level: a.class_level, section: a.section, subject_id: a.subject_id, is_class_teacher: !!a.is_class_teacher })));
  const [sectionsByClass, setSectionsByClass] = useState({});
  const [subjectsByClass, setSubjectsByClass] = useState({});
  const [saving, setSaving] = useState(false);

  const ensureClassData = async (cls) => {
    if (!cls) return;
    if (!sectionsByClass[cls]) {
      const { data } = await api.get(`/settings/sections?class_level=${cls}`);
      setSectionsByClass(prev => ({ ...prev, [cls]: data.sections }));
    }
    if (!subjectsByClass[cls]) {
      const { data } = await api.get(`/subjects/class/${cls}`);
      setSubjectsByClass(prev => ({ ...prev, [cls]: data.subjects }));
    }
  };

  useEffect(() => { rows.forEach(r => r.class_level && ensureClassData(r.class_level)); }, []); // eslint-disable-line

  const updateRow = (idx, next) => {
    setRows(prev => prev.map((r, i) => (i === idx ? next : r)));
    if (next.class_level) ensureClassData(next.class_level);
  };

  const addRow = () => setRows(prev => [...prev, { class_level: null, section: null, subject_id: null, is_class_teacher: false }]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    const incomplete = rows.some(r => !r.class_level || !r.subject_id);
    if (incomplete) { toast.error('Every row needs at least a Class and Subject selected'); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/teachers/${teacher.id}/assignments`, { assignments: rows });
      toast.success('Class / Section / Subject assignments updated');
      onSaved(data.teacher);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save assignments');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 700, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
          <h3><Layers size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Assign Classes, Sections &amp; Subjects — {teacher.name}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-dim" style={{ marginBottom: 14 }}>
          Every module (Assignments, Quizzes, Content, Reports) automatically scopes this teacher's access using
          these rows — no manual filtering needed elsewhere. Leave Section blank to cover every section of that class.
        </p>
        <div className="flex-col">
          {rows.map((row, idx) => (
            <AssignmentRow
              key={idx}
              row={row}
              sections={(cls) => sectionsByClass[cls] || []}
              subjects={(cls) => subjectsByClass[cls] || []}
              onChange={(next) => updateRow(idx, next)}
              onRemove={() => removeRow(idx)}
            />
          ))}
          {rows.length === 0 && <div className="text-dim text-sm" style={{ padding: '14px 0' }}>No assignments yet — add one below.</div>}
        </div>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={addRow}><Plus size={13} /> Add Class / Section / Subject</button>
        <div className="flex gap-2" style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save Assignments'}</button>
        </div>
      </div>
    </Modal>
  );
}

function TeacherFormModal({ teacher, staffRoles, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = !!teacher;
  const [form, setForm] = useState({
    name: teacher?.name || '', email: teacher?.email || '', password: '',
    staff_role: teacher?.staff_role || 'subject_teacher',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        const { data } = await api.put(`/teachers/${teacher.id}`, { name: form.name, email: form.email, staff_role: form.staff_role });
        toast.success('Teacher account updated');
        onSaved(data.teacher);
      } else {
        const { data } = await api.post('/teachers', form);
        toast.success(`Teacher account created for ${form.name}`);
        onSaved(data.teacher);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save teacher');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 440 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>{isEdit ? 'Edit Teacher' : 'Create Teacher Account'}</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label>Full Name</label><input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Email</label><input className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        {!isEdit && (
          <div className="field"><label>Temporary Password</label><input className="input" type="text" required minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Staff Role</label>
          <select className="input" value={form.staff_role} onChange={e => setForm({ ...form, staff_role: e.target.value })}>
            {staffRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div className="text-xs text-dim" style={{ marginTop: 6 }}>
            {form.staff_role === 'class_teacher' && 'Homeroom teacher — sees all subjects/grades for their class+section.'}
            {form.staff_role === 'subject_teacher' && 'Default tier — full access only to assigned classes/sections/subjects.'}
            {form.staff_role === 'coordinator' && 'Subject Teacher access + read-only school-wide analytics + broad Question Bank management.'}
            {form.staff_role === 'exam_controller' && 'Can create/schedule/publish quizzes & exams across classes, with school-wide exam analytics.'}
            {form.staff_role === 'academic_head' && 'Broadest teacher tier — can view all classes/sections (read + grade) and the Teacher directory (read-only).'}
          </div>
        </div>
        <div className="flex gap-2" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Teacher'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ teacher, onClose }) {
  const toast = useToast();
  const [customPassword, setCustomPassword] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const doReset = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/teachers/${teacher.id}/reset-password`, customPassword ? { new_password: customPassword } : {});
      setResult(data.temporary_password);
      toast.success('Password reset — share the new password securely with the teacher');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 400 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
          <h3><KeyRound size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Reset Password — {teacher.name}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!result ? (
          <>
            <div className="field"><label>New Password (optional — leave blank to auto-generate)</label>
              <input className="input" value={customPassword} onChange={e => setCustomPassword(e.target.value)} placeholder="Auto-generate a secure password" />
            </div>
            <div className="flex gap-2" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary btn-block" disabled={saving} onClick={doReset}>{saving ? 'Resetting...' : 'Reset Password'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-dim" style={{ marginBottom: 8 }}>New temporary password (shown once — copy it now):</div>
            <div className="mono" style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', fontWeight: 700, fontSize: 16, textAlign: 'center', letterSpacing: '.05em' }}>{result}</div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function TeacherManagement() {
  const toast = useToast();
  const [teachers, setTeachers] = useState([]);
  const [staffRoles, setStaffRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (roleFilter) params.set('staff_role', roleFilter);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/teachers?${params.toString()}`).then(({ data }) => { setTeachers(data.teachers); setStaffRoles(data.staff_roles); });
  }, [search, roleFilter, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const upsert = (t) => {
    setTeachers(prev => {
      const exists = prev.some(p => p.id === t.id);
      return exists ? prev.map(p => (p.id === t.id ? t : p)) : [...prev, t].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const doToggleStatus = async () => {
    const t = confirmToggle;
    setConfirmToggle(null);
    const next = t.account_status === 'disabled' ? 'active' : 'disabled';
    try {
      const { data } = await api.put(`/teachers/${t.id}/status`, { account_status: next });
      upsert(data.teacher);
      toast.success(next === 'disabled' ? `${t.name}'s account disabled` : `${t.name}'s account re-enabled`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const doDelete = async () => {
    const t = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/teachers/${t.id}`);
      setTeachers(prev => prev.filter(p => p.id !== t.id));
      toast.success(`${t.name}'s account permanently removed`);
    } catch (err) { toast.error(err.response?.data?.error || 'Cannot delete — this teacher has existing history. Disable the account instead.'); }
  };

  // Group teachers by class, section-by-section, with the HIGHEST class a
  // teacher is assigned to determining which section they appear in —
  // sections are ordered highest class first (Class 12 down to Class 6), so
  // a newly-added Class 10 teacher always shows up in the "Class 10"
  // section regardless of when they were created relative to a Class 6
  // teacher, rather than everyone being lumped together in one flat,
  // creation-order list. A teacher with assignments spanning multiple
  // classes (e.g. Class 10 AND Class 7) is grouped under their highest
  // class only, to avoid listing the same teacher twice; a teacher with
  // zero assignments yet goes in its own "Not Yet Assigned" group at the end.
  const groupedByClass = (() => {
    const groups = new Map(); // class_level -> teacher[]
    const unassigned = [];
    for (const t of teachers) {
      const classes = (t.assignments || []).map(a => a.class_level);
      if (classes.length === 0) { unassigned.push(t); continue; }
      const highest = Math.max(...classes);
      if (!groups.has(highest)) groups.set(highest, []);
      groups.get(highest).push(t);
    }
    const sortedClasses = [...groups.keys()].sort((a, b) => b - a);
    const result = sortedClasses.map(cls => ({ label: `Class ${cls}`, teachers: groups.get(cls) }));
    if (unassigned.length) result.push({ label: 'Not Yet Assigned', teachers: unassigned });
    return result;
  })();

  return (
    <AppLayout title="Teacher Management" subtitle="Create, edit, and assign teachers — role-based access, Class/Section/Subject linking, all in one place">
      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 190 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All Staff Roles</option>
          {staffRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New Teacher</button>
      </div>

      <div className="flex-col gap-4">
        {groupedByClass.map(group => (
          <div key={group.label}>
            <div className="flex items-center gap-2" style={{ margin: '4px 0 10px' }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '.02em' }}>{group.label}</h3>
              <span className="badge badge-gray">{group.teachers.length}</span>
            </div>
            <div className="flex-col gap-2">
              {group.teachers.map(t => (
                <div key={t.id} className="card card-pad" style={{ opacity: t.account_status === 'disabled' ? 0.65 : 1 }}>
                  <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: t.avatar_color || 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                        {t.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ fontWeight: 700 }}>{t.name}</span>
                          <RoleBadge role={t.staff_role} label={t.staff_role_label} />
                          {t.account_status === 'disabled' && <span className="badge badge-red"><Ban size={10} /> Disabled</span>}
                        </div>
                        <div className="text-sm text-dim">{t.email}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => setAssigning(t)}><Layers size={13} /> Assignments ({t.assignments.length})</button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                      <button className="btn-ghost btn-sm" onClick={() => setResetting(t)} title="Reset password"><KeyRound size={14} /></button>
                      <button className="btn-ghost btn-sm" onClick={() => setConfirmToggle(t)} title={t.account_status === 'disabled' ? 'Enable account' : 'Disable account'}>
                        {t.account_status === 'disabled' ? <CheckCircle2 size={14} color="var(--knowledge)" /> : <Ban size={14} color="var(--danger)" />}
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(t)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {t.assignments.length > 0 && (
                    <div className="flex gap-2 flex-wrap" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {t.assignments.map(a => (
                        <span key={a.id} className="badge badge-gray" style={{ fontWeight: 600 }}>
                          {!!a.is_class_teacher && <ShieldCheck size={10} style={{ marginRight: 3, verticalAlign: -1 }} />}
                          Class {a.class_level}{a.section ? ` · Sec ${a.section}` : ' · All Sections'} · {a.subject_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {teachers.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No teachers found for this filter.</div>}
      </div>

      {creating && <TeacherFormModal staffRoles={staffRoles} onClose={() => setCreating(false)} onSaved={(t) => { upsert(t); setCreating(false); }} />}
      {editing && <TeacherFormModal teacher={editing} staffRoles={staffRoles} onClose={() => setEditing(null)} onSaved={(t) => { upsert(t); setEditing(null); }} />}
      {assigning && <AssignmentsModal teacher={assigning} onClose={() => setAssigning(null)} onSaved={(t) => { upsert(t); setAssigning(null); }} />}
      {resetting && <ResetPasswordModal teacher={resetting} onClose={() => setResetting(null)} />}
      {confirmToggle && (
        <ConfirmDialog
          title={confirmToggle.account_status === 'disabled' ? 'Re-enable this account?' : 'Disable this account?'}
          message={confirmToggle.account_status === 'disabled' ? 'The teacher will be able to log in again.' : 'The teacher will not be able to log in until re-enabled. All their history (assignments, quizzes, grades) is preserved.'}
          confirmLabel={confirmToggle.account_status === 'disabled' ? 'Enable' : 'Disable'}
          danger={confirmToggle.account_status !== 'disabled'}
          onConfirm={doToggleStatus}
          onCancel={() => setConfirmToggle(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Permanently delete this teacher?"
          message="This only works for accounts with zero created assignments/quizzes. For real accounts, disable instead to preserve history."
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
