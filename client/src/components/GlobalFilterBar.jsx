import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import api from '../api/client.js';
import { usePermissions } from '../context/PermissionContext.jsx';

/**
 * Consistent class / section / subject filter row used across every
 * academic module (Assignments, Quizzes, Content, Announcements, Reports...).
 * Defaults to "All Classes" / "All Sections" / "All Subjects" unless the
 * caller supplies a value (typically seeded from the user's saved preference
 * via useModuleFilters).
 *
 * Cascading rule (never show unscoped data before the parent is picked):
 *   Select Class -> Section options load (scoped to that class) -> Select
 *   Section -> Subject options load (scoped to that class). The Section and
 *   Subject selects are disabled, and no API request is fired for them, until
 *   a Class has actually been chosen.
 */
export default function GlobalFilterBar({
  classLevel, onClassChange,
  section, onSectionChange = () => {},
  subjectId, onSubjectChange = () => {},
  showSection = true,
  showSubject = true,
}) {
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  // Never show a Class filter option this user isn't assigned to — a
  // Subject Teacher scoped to Class 10 should never even see "Class 12" in
  // this dropdown, not just get an empty result after picking it.
  const { allowedClasses } = usePermissions();

  useEffect(() => {
    if (!showSection) return;
    if (!classLevel) { setSections([]); return; }
    api.get(`/settings/sections?class_level=${classLevel}`).then(({ data }) => setSections(data.sections)).catch(() => {});
  }, [classLevel, showSection]);

  useEffect(() => {
    if (!showSubject) return;
    if (!classLevel) { setSubjects([]); return; }
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => setSubjects(data.subjects)).catch(() => {});
  }, [classLevel, showSubject]);

  return (
    <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
      <div className="flex items-center gap-1 text-xs text-dim" style={{ fontWeight: 700, letterSpacing: '.03em', marginRight: 4 }}>
        <Layers size={13} /> FILTERS
      </div>
      <select className="input" style={{ width: 150 }} value={classLevel ?? ''} onChange={e => { const v = e.target.value ? Number(e.target.value) : null; onClassChange(v); onSectionChange?.(null); onSubjectChange?.(null); }}>
        <option value="">All Classes</option>
        {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
      </select>

      {showSection && (
        <select className="input" style={{ width: 150 }} value={section ?? ''} disabled={!classLevel} onChange={e => onSectionChange(e.target.value || null)} title={!classLevel ? 'Select a Class first' : undefined}>
          <option value="">{classLevel ? 'All Sections' : 'Select a Class first'}</option>
          {sections.map(s => <option key={s.id} value={s.name}>Section {s.name}</option>)}
        </select>
      )}

      {showSubject && (
        <select className="input" style={{ width: 190 }} value={subjectId ?? ''} disabled={!classLevel} onChange={e => onSubjectChange(e.target.value ? Number(e.target.value) : null)} title={!classLevel ? 'Select a Class first' : undefined}>
          <option value="">{classLevel ? 'All Subjects' : 'Select a Class first'}</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {(classLevel || section || subjectId) && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => { onClassChange(null); onSectionChange?.(null); onSubjectChange?.(null); }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

