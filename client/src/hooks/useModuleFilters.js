import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Shared filter state for any staff module that works with classes/subjects
 * (Assignments, Quizzes, Content, Announcements, Reports, etc).
 *
 * Behavior (per the "Global Subject & Class Selection" requirement):
 *  - By default every module shows ALL classes and ALL subjects.
 *  - If the signed-in staff member has saved a preferred class/section/subject
 *    (Settings > My Preferences), that preference is applied automatically
 *    instead of forcing them to pick every time.
 *  - Users can still change the filters per-visit; that in-session choice is
 *    not persisted unless they explicitly update their preference.
 */
export function useModuleFilters() {
  const { user } = useAuth();

  const [classLevel, setClassLevel] = useState(null); // null = All Classes
  const [section, setSection] = useState(null); // null = All Sections
  const [subjectId, setSubjectId] = useState(null); // null = All Subjects

  // Apply the user's saved preference once, on first load / when it becomes available.
  useEffect(() => {
    if (!user) return;
    if (user.pref_class_level) setClassLevel(user.pref_class_level);
    if (user.pref_section) setSection(user.pref_section);
    if (user.pref_subject_id) setSubjectId(user.pref_subject_id);
    // Intentionally only run when the user identity changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const reset = () => { setClassLevel(null); setSection(null); setSubjectId(null); };

  return { classLevel, setClassLevel, section, setSection, subjectId, setSubjectId, reset };
}
