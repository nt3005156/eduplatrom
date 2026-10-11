import { useEffect, useState } from 'react';
import { UserCog, Save, Check } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

export default function MyPreferences() {
  const { user, updateUser } = useAuth();
  const { allowedClasses } = usePermissions();
  const toast = useToast();
  const [classLevel, setClassLevel] = useState(user?.pref_class_level || '');
  const [section, setSection] = useState(user?.pref_section || '');
  const [subjectId, setSubjectId] = useState(user?.pref_subject_id || '');
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Cascading rule: never load Section/Subject options until a Class is
  // actually selected — no "all sections/subjects across every class" list.
  useEffect(() => {
    if (!classLevel) { setSections([]); setSubjects([]); return; }
    api.get(`/settings/sections?class_level=${classLevel}`).then(({ data }) => setSections(data.sections)).catch(() => {});
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => setSubjects(data.subjects)).catch(() => {});
  }, [classLevel]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      const { data } = await api.put('/auth/me/preferences', {
        pref_class_level: classLevel || null,
        pref_section: section || null,
        pref_subject_id: subjectId || null,
      });
      updateUser(data.user);
      setSaved(true);
      toast.success('Your default class, section, and subject preference has been saved.');
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save preferences');
    } finally { setSaving(false); }
  };

  return (
    <AppLayout title="My Preferences" subtitle="Choose the class, section, and subject that should load automatically whenever you open an academic module">
      <form onSubmit={save} className="card card-pad" style={{ maxWidth: 520 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 18 }}>
          <UserCog size={18} color="var(--primary)" />
          <h3 style={{ fontSize: 16 }}>Default Class, Section & Subject</h3>
        </div>
        <p className="text-sm text-dim" style={{ marginBottom: 20, lineHeight: 1.6 }}>
          Whenever you open Assignments, Quizzes, Content, or any other academic module, it will
          automatically filter to this class/section/subject instead of showing everything.
          Leave any field blank to keep seeing <strong>All Classes</strong> / <strong>All Sections</strong> / <strong>All Subjects</strong> by default.
        </p>

        <div className="field">
          <label>Default Class</label>
          <select className="input" value={classLevel} onChange={e => { setClassLevel(e.target.value); setSubjectId(''); setSection(''); }}>
            <option value="">No preference (All Classes)</option>
            {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Default Section</label>
          <select className="input" value={section} onChange={e => setSection(e.target.value)} disabled={!classLevel}>
            <option value="">{classLevel ? 'No preference (All Sections)' : 'Select a Class first'}</option>
            {sections.map(s => <option key={s.id} value={s.name}>Section {s.name}</option>)}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Default Subject</label>
          <select className="input" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={!classLevel}>
            <option value="">{classLevel ? 'No preference (All Subjects)' : 'Select a Class first'}</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <button className="btn btn-primary btn-block" disabled={saving} type="submit" style={{ marginTop: 20 }}>
          {saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> {saving ? 'Saving...' : 'Save Preferences'}</>}
        </button>
      </form>
    </AppLayout>
  );
}
