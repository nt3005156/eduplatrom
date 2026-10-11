import { useEffect, useState } from 'react';
import {
  ShieldCheck, Plus, X, Check, Minus, Users, Search, Clock3, Trash2, Eye,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const MODULE_LABELS = {
  content: 'Content Management', assignments: 'Assignments', quizzes: 'Quizzes',
  gradebook: 'Gradebook', users: 'Teacher Management', audit: 'Audit Log',
  reports: 'Analytics & Reports', communication: 'Communication', settings: 'Settings',
};

// Three-state toggle: allow (green check) / deny (red X) / unset (dash, inherits fail-closed deny).
function EffectToggle({ effect, onChange, disabled }) {
  const next = { null: 'allow', allow: 'deny', deny: null };
  const display = {
    allow: { icon: Check, color: 'var(--knowledge)', bg: 'rgba(var(--knowledge-rgb),.15)', label: 'Allow' },
    deny: { icon: X, color: 'var(--danger)', bg: 'rgba(255,107,129,.15)', label: 'Deny' },
    null: { icon: Minus, color: 'var(--text-dim)', bg: 'var(--surface-2)', label: 'Inherit (deny)' },
  }[effect ?? 'null'];
  const Icon = display.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(next[effect ?? 'null'])}
      title={disabled ? 'System Admin only' : display.label}
      style={{
        width: 34, height: 28, borderRadius: 8, border: 'none', background: display.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon size={15} color={display.color} />
    </button>
  );
}

function CreateRoleModal({ roles, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ key: '', label: '', rank: 5, description: '', clone_from_role_id: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^[a-z][a-z0-9_]*$/.test(form.key)) { toast.error('Key must be lowercase snake_case, e.g. vice_principal'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/roles', { ...form, rank: Number(form.rank), clone_from_role_id: form.clone_from_role_id || null });
      toast.success(`Role "${form.label}" created`);
      onSaved(data.role);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create role'); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 440 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>New Custom Role</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label>Display Name</label><input className="input" required placeholder="e.g. Vice Principal, Librarian" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
        <div className="field"><label>Key (lowercase, no spaces)</label><input className="input" required placeholder="e.g. vice_principal" value={form.key} onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })} /></div>
        <div className="field"><label>Description (optional)</label><textarea className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="field">
          <label>Clone permissions from (optional)</label>
          <select className="input" value={form.clone_from_role_id} onChange={e => setForm({ ...form, clone_from_role_id: e.target.value })}>
            <option value="">Start with no permissions</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Rank (authority level — lower = more authority)</label>
          <input className="input" type="number" min={1} value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })} />
        </div>
        <div className="flex gap-2" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Creating...' : 'Create Role'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PreviewModal({ role, onClose }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!search.trim()) { setUsers([]); return; }
    api.get(`/teachers?search=${encodeURIComponent(search)}`).then(({ data }) => setUsers(data.teachers)).catch(() => {});
  }, [search]);

  const loadPreview = (userId) => {
    api.get(`/roles/users/${userId}/effective-permissions`).then(({ data }) => setPreview(data));
  };

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
          <h3><Eye size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Preview As Teacher</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search teacher by name/email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {users.length > 0 && !preview && (
          <div className="flex-col gap-1">
            {users.map(u => (
              <button key={u.id} type="button" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => loadPreview(u.id)}>
                {u.name} — {u.email}
              </button>
            ))}
          </div>
        )}
        {preview && (
          <div>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 700 }}>{preview.user.name}</span>
              <span className="badge badge-purple">{preview.role?.role_label || 'No role'}</span>
              <button className="btn-ghost btn-sm" onClick={() => setPreview(null)}>Change</button>
            </div>
            <div className="text-xs text-dim" style={{ marginBottom: 10 }}>
              Scope: {preview.scope.unrestricted ? 'Whole school (unrestricted)' : `${preview.scope.subjectAssignments.length} subject assignment(s), ${preview.scope.classSections.length} homeroom class(es)`}
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {Object.entries(preview.permissions).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  {val ? <Check size={13} color="var(--knowledge)" /> : <X size={13} color="var(--danger)" />}
                  <span className="text-xs" style={{ opacity: val ? 1 : 0.5 }}>{key}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function RolesPermissions() {
  const toast = useToast();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [grants, setGrants] = useState({}); // permission_id -> effect
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    api.get('/roles').then(({ data }) => {
      setRoles(data.roles);
      if (!selectedRoleId && data.roles.length) setSelectedRoleId(data.roles[0].id);
    });
    api.get('/permissions').then(({ data }) => setPermissions(data.permissions));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!selectedRoleId) return;
    api.get(`/roles/${selectedRoleId}/permissions`).then(({ data }) => {
      setGrants(Object.fromEntries(data.permissions.map(p => [p.id, p.effect])));
      setDirty(false);
    });
  }, [selectedRoleId]);

  const selectedRole = roles.find(r => r.id === selectedRoleId);
  const isSystemAdminRole = selectedRole?.key === 'system_admin';

  const setEffect = (permId, effect) => {
    setGrants(g => ({ ...g, [permId]: effect }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const grantsPayload = Object.entries(grants).map(([permission_id, effect]) => ({ permission_id: Number(permission_id), effect }));
      const { data } = await api.put(`/roles/${selectedRoleId}/permissions`, { grants: grantsPayload });
      toast.success(`Permission matrix saved — applies immediately to ${data.affected_user_count} user(s) holding this role`);
      setDirty(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const doDeleteRole = async () => {
    const role = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/roles/${role.id}`);
      toast.success(`Role "${role.label}" deleted`);
      setSelectedRoleId(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete role'); }
  };

  const byModule = permissions.reduce((acc, p) => {
    (acc[p.module] = acc[p.module] || []).push(p);
    return acc;
  }, {});

  return (
    <AppLayout title="Roles & Permissions" subtitle="Configure exactly what each role can do — changes apply immediately, school-wide">
      <div className="flex gap-2" style={{ marginBottom: 18 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setPreviewing(true)}><Eye size={14} /> Preview As Teacher</button>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New Custom Role</button>
      </div>

      <div className="flex gap-4" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ width: 260, flexShrink: 0, overflow: 'hidden' }}>
          {roles.map(r => (
            <div
              key={r.id}
              onClick={() => setSelectedRoleId(r.id)}
              style={{
                padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: selectedRoleId === r.id ? 'var(--primary-light)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-between">
                <span style={{ fontWeight: 700, fontSize: 14 }}>{r.label}</span>
                {!r.is_system_role && (
                  <button className="btn-ghost btn-sm" style={{ padding: 4 }} onClick={(e) => { e.stopPropagation(); setConfirmDelete(r); }}>
                    <Trash2 size={12} color="var(--danger)" />
                  </button>
                )}
              </div>
              <div className="text-xs text-dim flex items-center gap-2" style={{ marginTop: 4 }}>
                <span>{r.allow_count} allowed</span>
                <span className="flex items-center gap-1"><Users size={10} /> {r.user_count}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          {selectedRole && (
            <>
              <div className="card card-pad flex items-center justify-between" style={{ marginBottom: 14 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>{selectedRole.label}</h3>
                  <p className="text-sm text-dim">{selectedRole.description}</p>
                </div>
                {dirty && <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save Changes'}</button>}
              </div>

              {isSystemAdminRole && (
                <div className="card card-pad text-sm text-dim" style={{ marginBottom: 14 }}>
                  System Admin always has full access — this role's grants are shown for reference and cannot be edited.
                </div>
              )}

              {Object.entries(byModule).map(([module, perms]) => (
                <div key={module} className="card card-pad" style={{ marginBottom: 12 }}>
                  <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 10, letterSpacing: '.03em' }}>{(MODULE_LABELS[module] || module).toUpperCase()}</div>
                  <div className="flex-col gap-2">
                    {perms.map(p => (
                      <div key={p.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{p.label}</span>
                          {!!p.admin_only && <span className="badge badge-gray" style={{ fontSize: 10 }}>System Admin only</span>}
                          {!!p.is_dangerous && !p.admin_only && <span className="badge badge-orange" style={{ fontSize: 10 }}>Sensitive</span>}
                        </div>
                        <EffectToggle
                          effect={p.admin_only ? (isSystemAdminRole ? 'allow' : null) : grants[p.id]}
                          disabled={isSystemAdminRole || !!p.admin_only}
                          onChange={(effect) => setEffect(p.id, effect)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {creating && <CreateRoleModal roles={roles} onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); load(); setSelectedRoleId(r.id); }} />}
      {previewing && <PreviewModal role={selectedRole} onClose={() => setPreviewing(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete role "${confirmDelete.label}"?`}
          message="This cannot be undone. Any users holding this role must be reassigned first."
          confirmLabel="Delete Role"
          onConfirm={doDeleteRole}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
