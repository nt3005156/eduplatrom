import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, FileText, Video, LinkIcon, UploadCloud, X } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import GlobalFilterBar from '../../components/GlobalFilterBar.jsx';
import { useModuleFilters } from '../../hooks/useModuleFilters.js';
import SubjectIcon from '../../components/IconMap.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const TYPE_ICON = { pdf: FileText, note: FileText, doc: FileText, video: Video, slide: FileText, link: LinkIcon };
const TYPE_LABEL = { pdf: 'PDF', note: 'Notes', doc: 'Document', video: 'Video', slide: 'Slides', link: 'Link' };

function NewSubjectModal({ classLevel, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', icon: 'BookOpen', color: '#6C5CE7' });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/subjects', { ...form, class_level: classLevel });
      toast.success(`Subject "${form.name}" created`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create subject');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 420 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>New Subject for Class {classLevel}</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label>Name</label><input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Description</label><textarea className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="field"><label>Color</label><input className="input" type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

function UploadModal({ subject, classLevel, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', description: '', type: 'pdf', external_url: '', topic: '', difficulty: 'medium' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append('subject_id', subject.id);
    fd.append('class_level', classLevel);
    if (file) fd.append('file', file);
    try {
      await api.post('/materials', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`"${form.title}" content uploaded successfully.`, 4500);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>Add Material — {subject.name}</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label>Title</label><input className="input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field"><label>Description</label><textarea className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}>
            <label>Type</label>
            <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="pdf">PDF</option><option value="slide">Slides</option><option value="note">Notes</option>
              <option value="doc">Document</option><option value="video">Video (link)</option><option value="link">External Link</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Difficulty</label>
            <select className="input" value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Topic (used for smart recommendations)</label><input className="input" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Algebra, Photosynthesis" /></div>
        {(form.type === 'video' || form.type === 'link') ? (
          <div className="field"><label>External URL</label><input className="input" placeholder="https://..." value={form.external_url} onChange={e => setForm({ ...form, external_url: e.target.value })} /></div>
        ) : (
          <div className="field"><label>Upload File</label><input className="input" type="file" onChange={e => setFile(e.target.files[0])} /></div>
        )}
        <div className="flex gap-2" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}><UploadCloud size={15} /> {saving ? 'Uploading...' : 'Upload'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MaterialDetailModal({ material, onClose }) {
  const Icon = TYPE_ICON[material.type] || FileText;
  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-start" style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-2">
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={18} color="var(--primary)" />
            </div>
            <h3 style={{ fontSize: 17 }}>{material.title}</h3>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex gap-1" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="badge badge-purple">{TYPE_LABEL[material.type] || material.type}</span>
          <span className="badge badge-gray">{material.difficulty}</span>
          {material.topic && <span className="badge badge-orange">{material.topic}</span>}
        </div>
        <p className="text-dim text-sm" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {material.description || 'No description provided for this material.'}
        </p>
        {(material.file_path || material.external_url) && (
          <a href={material.file_path || material.external_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-block" style={{ marginTop: 20 }}>
            Open Material
          </a>
        )}
      </div>
    </Modal>
  );
}

export default function ManageContent() {
  const toast = useToast();
  const { user } = useAuth();
  // Creating/editing/deleting a SUBJECT (the curriculum structure itself,
  // e.g. adding "Robotics" as a new Class 8 subject) is an Admin/Academic
  // Head decision, not something a Subject/Class Teacher does — a teacher
  // is assigned to existing subjects by an admin and should only ever
  // manage the content *inside* the subjects they're already assigned to.
  // Previously every staff member saw "New Subject" here even though they
  // were already assigned a subject by admin, which was confusing and (via
  // a since-fixed backend gap) let them silently create unrelated subjects.
  const canManageSubjects = user?.role === 'admin' || user?.staff_role === 'academic_head';
  // Content is organized subject-by-class, so this module always operates on one
  // concrete class (subjects list can't be "all classes" at once) — but it still
  // honors the shared class-preference default via useModuleFilters, falling back
  // to Class 10 only when the staff member has no saved preference at all.
  const { classLevel: preferredClass, setClassLevel: setPreferredClass } = useModuleFilters();
  const [classLevel, setClassLevelState] = useState(preferredClass || 10);
  const setClassLevel = (val) => { setClassLevelState(val); setPreferredClass(val); };
  // BUG FIX: `useModuleFilters()` only learns the signed-in user's saved
  // pref_class_level asynchronously (after /auth/me resolves), which happens
  // AFTER this component's `useState(preferredClass || 10)` initializer has
  // already run and locked in Class 10. That meant a saved "My Preferences"
  // class was silently ignored on every load of Manage Content — this was
  // the reported "preference settings are broken" bug. Fix: once the saved
  // preference actually arrives, adopt it — but only the first time, so it
  // never overwrites a class the staff member has since manually switched to.
  const appliedPreferenceRef = useRef(false);
  useEffect(() => {
    if (preferredClass && !appliedPreferenceRef.current) {
      appliedPreferenceRef.current = true;
      setClassLevelState(preferredClass);
    }
  }, [preferredClass]);

  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [viewingMaterial, setViewingMaterial] = useState(null);
  const [confirmSubjectDelete, setConfirmSubjectDelete] = useState(null);
  const [confirmMaterialDelete, setConfirmMaterialDelete] = useState(null);

  const loadSubjects = useCallback(() => api.get(`/subjects/class/${classLevel}`).then(({ data }) => {
    setSubjects(data.subjects);
    setActiveSubject(prev => data.subjects.find(s => s.id === prev?.id) || data.subjects[0] || null);
  }), [classLevel]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);
  useEffect(() => {
    if (activeSubject) api.get(`/materials/subject/${activeSubject.id}`).then(({ data }) => setMaterials(data.materials));
    else setMaterials([]);
  }, [activeSubject]);

  const doDeleteSubject = async () => {
    const s = confirmSubjectDelete;
    setConfirmSubjectDelete(null);
    try {
      await api.delete(`/subjects/${s.id}`);
      toast.success(`Subject "${s.name}" deleted`);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete subject');
    }
  };

  const doDeleteMaterial = async () => {
    const m = confirmMaterialDelete;
    setConfirmMaterialDelete(null);
    try {
      await api.delete(`/materials/${m.id}`);
      toast.success(`"${m.title}" deleted`);
      api.get(`/materials/subject/${activeSubject.id}`).then(({ data }) => setMaterials(data.materials));
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete material');
    }
  };

  return (
    <AppLayout title="Manage Content" subtitle="Organize subjects and study materials for each class">
      <GlobalFilterBar classLevel={classLevel} onClassChange={v => setClassLevel(v || 10)} showSection={false} showSubject={false} />

      <div className="flex justify-between items-center" style={{ margin: '20px 0 14px' }}>
        <h3 style={{ fontSize: 16 }}>Subjects — Class {classLevel}</h3>
        {canManageSubjects && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowNewSubject(true)}><Plus size={14} /> New Subject</button>
        )}
      </div>

      <div className="flex gap-2" style={{ overflowX: 'auto', paddingBottom: 6, marginBottom: 18 }}>
        {subjects.map(s => (
          <div key={s.id} style={{ position: 'relative' }}>
            <button
              onClick={() => setActiveSubject(s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 34px 9px 16px', borderRadius: 999, whiteSpace: 'nowrap',
                border: activeSubject?.id === s.id ? 'none' : '1.5px solid var(--border)',
                background: activeSubject?.id === s.id ? s.color : 'var(--surface)',
                color: activeSubject?.id === s.id ? '#fff' : 'var(--text)', fontWeight: 700, fontSize: 13.5,
              }}
            >
              <SubjectIcon name={s.icon} size={16} color={activeSubject?.id === s.id ? '#fff' : s.color} />
              {s.name} <span style={{ opacity: .8 }}>({s.materials_count})</span>
            </button>
            {canManageSubjects && (
              <button onClick={() => setConfirmSubjectDelete(s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: activeSubject?.id === s.id ? '#fff' : 'var(--text-dim)' }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {subjects.length === 0 && (
          <div className="text-dim text-sm">
            {canManageSubjects ? 'No subjects yet for this class. Create one!' : 'No subjects assigned to you for this class yet — ask an admin to assign you a subject.'}
          </div>
        )}
      </div>

      {activeSubject && (
        <>
          <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 16 }}>Materials in {activeSubject.name}</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}><Plus size={14} /> Add Material</button>
          </div>
          <div className="grid stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {materials.map(m => {
              const Icon = TYPE_ICON[m.type] || FileText;
              return (
                <div
                  key={m.id}
                  className="card card-pad flex-col gap-2"
                  onClick={() => setViewingMaterial(m)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="flex justify-between items-start">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} color="var(--primary)" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmMaterialDelete(m); }}
                      className="btn-ghost btn-sm"
                      style={{ padding: 6 }}
                    >
                      <Trash2 size={14} color="var(--danger)" />
                    </button>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{m.title}</div>
                  <div className="text-xs text-dim" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{m.description || 'No description'}</div>
                  <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                    <span className="badge badge-purple">{m.type}</span>
                    <span className="badge badge-gray">{m.difficulty}</span>
                    {m.topic && <span className="badge badge-orange">{m.topic}</span>}
                  </div>
                </div>
              );
            })}
            {materials.length === 0 && <div className="card card-pad text-dim" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 30 }}>No materials yet — add the first one!</div>}
          </div>
        </>
      )}

      {showNewSubject && <NewSubjectModal classLevel={classLevel} onClose={() => setShowNewSubject(false)} onSaved={() => { setShowNewSubject(false); loadSubjects(); }} />}
      {showUpload && activeSubject && (
        <UploadModal
          subject={activeSubject}
          classLevel={classLevel}
          onClose={() => setShowUpload(false)}
          onSaved={() => { setShowUpload(false); api.get(`/materials/subject/${activeSubject.id}`).then(({ data }) => setMaterials(data.materials)); loadSubjects(); }}
        />
      )}
      {viewingMaterial && <MaterialDetailModal material={viewingMaterial} onClose={() => setViewingMaterial(null)} />}
      {confirmSubjectDelete && (
        <ConfirmDialog
          title="Delete this subject?"
          message={`This will permanently delete "${confirmSubjectDelete.name}" and all of its materials, assignments, and quizzes.`}
          confirmLabel="Delete Subject"
          onConfirm={doDeleteSubject}
          onCancel={() => setConfirmSubjectDelete(null)}
        />
      )}
      {confirmMaterialDelete && (
        <ConfirmDialog
          title="Delete this material?"
          message={`Are you sure you want to delete "${confirmMaterialDelete.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={doDeleteMaterial}
          onCancel={() => setConfirmMaterialDelete(null)}
        />
      )}
    </AppLayout>
  );
}
