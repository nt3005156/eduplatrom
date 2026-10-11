import { useEffect, useState } from 'react';
import {
  Plus, Trash2, FileDown, ClipboardCheck, X, Award, AlertCircle, Copy, Archive,
  Pencil, BarChart3, RotateCcw, ShieldAlert, Clock3,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import GlobalFilterBar from '../../components/GlobalFilterBar.jsx';
import { useModuleFilters } from '../../hooks/useModuleFilters.js';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

const STATUS_BADGE = { draft: 'badge-gray', scheduled: 'badge-purple', published: 'badge-green', archived: 'badge-gray' };

function AssignmentFormModal({ existing, defaultClassLevel, onClose, onSaved }) {
  const toast = useToast();
  // Never offer a Class option this teacher isn't assigned to — backend-
  // computed via allowedClasses (see PermissionContext), not hardcoded.
  const { allowedClasses } = usePermissions();
  const [classLevel, setClassLevel] = useState(existing?.class_level || defaultClassLevel || allowedClasses[allowedClasses.length - 1]);
  const [subjects, setSubjects] = useState([]);
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({
    subject_id: existing?.subject_id || '', title: existing?.title || '', section: existing?.section || '',
    chapter: existing?.chapter || '', description: existing?.description || '', instructions: existing?.instructions || '',
    due_date: existing?.due_date ? existing.due_date.slice(0, 16) : '', max_score: existing?.max_score ?? 100,
    passing_score: existing?.passing_score ?? '', allow_late: existing?.allow_late ?? 1, late_penalty_pct: existing?.late_penalty_pct ?? 0,
    allow_resubmission: existing?.allow_resubmission ?? 1, max_resubmissions: existing?.max_resubmissions ?? 3,
    allow_regrade_requests: existing?.allow_regrade_requests ?? 1, allowed_file_types: existing?.allowed_file_types || '',
    max_upload_size_mb: existing?.max_upload_size_mb ?? 25, visibility: existing?.visibility || 'visible',
    status: existing?.status || 'published',
  });
  const [referenceLinks, setReferenceLinks] = useState(existing?.reference_links?.length ? existing.reference_links : [{ label: '', url: '' }]);
  const [rubric, setRubric] = useState(existing?.rubric?.length ? existing.rubric.map(r => ({ criterion: r.criterion, max_points: r.max_points })) : []);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => {
      setSubjects(data.subjects);
      if (!existing) setForm(f => ({ ...f, subject_id: data.subjects[0]?.id || '' }));
    });
    api.get(`/settings/sections?class_level=${classLevel}`).then(({ data }) => setSections(data.sections)).catch(() => {});
  }, [classLevel]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async (submitStatus) => {
    setSaving(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (v !== '' && v !== undefined) fd.append(k, v); });
    fd.set('status', submitStatus || form.status);
    fd.append('class_level', classLevel);
    fd.append('reference_links', JSON.stringify(referenceLinks.filter(l => l.label || l.url)));
    fd.append('rubric', JSON.stringify(rubric.filter(r => r.criterion && r.criterion.trim())));
    files.forEach(f => fd.append('attachments', f));
    try {
      if (existing) {
        await api.put(`/assignments/${existing.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success(`Assignment "${form.title}" updated`);
      } else {
        await api.post('/assignments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success(`Assignment "${form.title}" ${submitStatus === 'draft' ? 'saved as draft' : 'created — students have been notified'}`);
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save assignment');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); save(form.status); }} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>{existing ? 'Edit Assignment' : 'New Assignment'}</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Class</label>
            <select className="input" value={classLevel} onChange={e => setClassLevel(Number(e.target.value))}>
              {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Section (optional)</label>
            <select className="input" value={form.section} onChange={e => set('section', e.target.value)}>
              <option value="">All Sections</option>
              {sections.map(s => <option key={s.id} value={s.name}>Section {s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Subject</label>
            <select className="input" required value={form.subject_id} onChange={e => set('subject_id', e.target.value)}>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="field"><label>Title</label><input className="input" required value={form.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="field"><label>Chapter (optional)</label><input className="input" value={form.chapter} onChange={e => set('chapter', e.target.value)} /></div>
        <div className="field"><label>Description</label><textarea className="input" placeholder="Rich description (basic HTML like <b>, <p> supported)" value={form.description} onChange={e => set('description', e.target.value)} /></div>
        <div className="field"><label>Instructions</label><textarea className="input" value={form.instructions} onChange={e => set('instructions', e.target.value)} /></div>

        <div className="field">
          <label>Reference Links</label>
          {referenceLinks.map((l, i) => (
            <div key={i} className="flex gap-2" style={{ marginBottom: 6 }}>
              <input className="input" placeholder="Label" value={l.label} onChange={e => setReferenceLinks(rl => rl.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
              <input className="input" placeholder="https://..." value={l.url} onChange={e => setReferenceLinks(rl => rl.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setReferenceLinks(rl => [...rl, { label: '', url: '' }])}>+ Add Link</button>
        </div>

        <div className="field">
          <label>Grading Rubric (optional)</label>
          <p className="text-xs text-dim" style={{ marginTop: -4, marginBottom: 8 }}>Define criteria the teacher will score this assignment against instead of (or alongside) a single overall grade.</p>
          {rubric.map((r, i) => (
            <div key={i} className="flex gap-2" style={{ marginBottom: 6 }}>
              <input className="input" placeholder="Criterion (e.g. Grammar, Content, Structure)" style={{ flex: 2 }} value={r.criterion} onChange={e => setRubric(rb => rb.map((x, idx) => idx === i ? { ...x, criterion: e.target.value } : x))} />
              <input className="input" type="number" min={1} placeholder="Max pts" style={{ flex: 1 }} value={r.max_points} onChange={e => setRubric(rb => rb.map((x, idx) => idx === i ? { ...x, max_points: Number(e.target.value) } : x))} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setRubric(rb => rb.filter((_, idx) => idx !== i))}><Trash2 size={13} color="var(--danger)" /></button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setRubric(rb => [...rb, { criterion: '', max_points: 10 }])}>+ Add Rubric Criterion</button>
          {rubric.length > 0 && <div className="text-xs text-dim" style={{ marginTop: 6 }}>Total rubric points: {rubric.reduce((s, r) => s + (Number(r.max_points) || 0), 0)}</div>}
        </div>

        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Due Date & Time</label><input className="input" type="datetime-local" value={form.due_date} onChange={e => set('due_date', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Max Marks</label><input className="input" type="number" value={form.max_score} onChange={e => set('max_score', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Passing Marks</label><input className="input" type="number" value={form.passing_score} onChange={e => set('passing_score', e.target.value)} /></div>
        </div>

        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm" style={{ flex: 1, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!Number(form.allow_late)} onChange={e => set('allow_late', e.target.checked ? 1 : 0)} /> Allow Late Submission
          </label>
          {!!Number(form.allow_late) && (
            <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Late Penalty (%)</label><input className="input" type="number" value={form.late_penalty_pct} onChange={e => set('late_penalty_pct', e.target.value)} /></div>
          )}
        </div>

        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm" style={{ flex: 1, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!Number(form.allow_resubmission)} onChange={e => set('allow_resubmission', e.target.checked ? 1 : 0)} /> Allow Resubmission
          </label>
          {!!Number(form.allow_resubmission) && (
            <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Max Resubmissions</label><input className="input" type="number" value={form.max_resubmissions} onChange={e => set('max_resubmissions', e.target.value)} /></div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!Number(form.allow_regrade_requests)} onChange={e => set('allow_regrade_requests', e.target.checked ? 1 : 0)} /> Allow Students to Request Regrades
        </label>

        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Allowed File Types (comma-sep, blank=any)</label><input className="input" placeholder="pdf,docx,jpg" value={form.allowed_file_types} onChange={e => set('allowed_file_types', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Max Upload Size (MB)</label><input className="input" type="number" value={form.max_upload_size_mb} onChange={e => set('max_upload_size_mb', e.target.value)} /></div>
        </div>

        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Visibility</label>
            <select className="input" value={form.visibility} onChange={e => set('visibility', e.target.value)}>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Attach Files</label><input className="input" type="file" multiple onChange={e => setFiles(Array.from(e.target.files))} /></div>
        </div>

        <div className="flex gap-2" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-outline btn-block" disabled={saving} onClick={() => save('draft')}>Save as Draft</button>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : existing ? 'Save Changes' : 'Publish'}</button>
        </div>
      </form>
    </Modal>
  );
}

function GradeRow({ submission, assignment, onSaved }) {
  const toast = useToast();
  const { hasPermission } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [grade, setGrade] = useState(submission.grade ?? '');
  const [feedback, setFeedback] = useState(submission.feedback || '');
  const [confirmRegrade, setConfirmRegrade] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideGrade, setOverrideGrade] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [showResubmit, setShowResubmit] = useState(false);
  const [resubmitReason, setResubmitReason] = useState('Wrong File');
  const [resubmitCustom, setResubmitCustom] = useState('');
  const [resubmitDeadline, setResubmitDeadline] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState(null);
  const hasRubric = (assignment.rubric || []).length > 0;
  const [rubricScores, setRubricScores] = useState(null); // [{ rubric_id, criterion, max_points, score, comment }]
  const [useRubric, setUseRubric] = useState(hasRubric);
  const isGraded = submission.status === 'graded' || submission.status === 'regraded';

  const openEditor = () => {
    if (isGraded && !editing) { setConfirmRegrade(true); return; }
    setEditing(true);
    if (hasRubric && !rubricScores) {
      api.get(`/assignments/submissions/${submission.id}/rubric-scores`).then(({ data }) => {
        setRubricScores(data.rubric.map(r => ({ rubric_id: r.id, criterion: r.criterion, max_points: r.max_points, score: r.score ?? 0, comment: r.comment || '' })));
      });
    }
  };

  const rubricTotal = (rubricScores || []).reduce((s, r) => s + (Number(r.score) || 0), 0);

  const saveGrade = async (asDraft = false) => {
    if (useRubric && hasRubric) {
      setSaving(true);
      try {
        await api.put(`/assignments/submissions/${submission.id}/grade`, {
          feedback, save_as_draft: asDraft,
          rubric_scores: rubricScores.map(r => ({ rubric_id: r.rubric_id, score: r.score, comment: r.comment })),
        });
        toast.success(asDraft ? 'Draft grade saved' : `Grade published: ${rubricTotal}/${assignment.max_score} — the student has been notified`);
        setEditing(false);
        onSaved();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to save grade');
      } finally { setSaving(false); }
      return;
    }
    if (grade === '' || Number.isNaN(Number(grade))) { toast.error('Please enter a numeric grade before saving'); return; }
    setSaving(true);
    try {
      await api.put(`/assignments/submissions/${submission.id}/grade`, { grade: Number(grade), feedback, save_as_draft: asDraft });
      toast.success(asDraft ? 'Draft grade saved' : `Grade published: ${grade}/${assignment.max_score} — the student has been notified`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save grade');
    } finally { setSaving(false); }
  };

  const requestResubmission = async () => {
    try {
      await api.post(`/assignments/submissions/${submission.id}/request-resubmission`, {
        reason: resubmitReason, custom_reason: resubmitReason === 'Other' ? resubmitCustom : null,
        new_deadline: resubmitDeadline || null,
      });
      toast.success('Resubmission requested — the student has been notified');
      setShowResubmit(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to request resubmission');
    }
  };

  const rejectInvalid = async () => {
    try {
      await api.put(`/assignments/submissions/${submission.id}/reject-invalid`, { reason: 'Marked invalid by teacher' });
      toast.success('Submission marked invalid');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const markLate = async () => {
    try {
      await api.put(`/assignments/submissions/${submission.id}/mark-late`);
      toast.success('Marked as late');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const loadVersions = async () => {
    setShowVersions(v => !v);
    if (!versions) {
      const { data } = await api.get(`/assignments/submissions/${submission.id}/versions`);
      setVersions(data.versions);
    }
  };

  // Overriding an already-finalized (graded/regraded) submission's grade —
  // an Academic Head/System Admin (holding 'grade.override') applies it
  // immediately; anyone else with school-wide monitoring access
  // (Coordinator/Exam Coordinator) instead files a request that lands in
  // the Academic Head's Approval Queue. Both paths hit real, live-tested
  // backend endpoints, not a UI-only affordance.
  const canOverrideDirectly = hasPermission('grade.override');
  const canRequestOverride = hasPermission('analytics.view_school_wide');
  const submitOverride = async () => {
    if (overrideGrade === '' || Number.isNaN(Number(overrideGrade))) { toast.error('Enter a numeric grade'); return; }
    if (!overrideReason.trim()) { toast.error('A reason is required'); return; }
    setOverrideBusy(true);
    try {
      if (canOverrideDirectly) {
        await api.put(`/academic-head/submissions/${submission.id}/override-grade`, { new_grade: Number(overrideGrade), reason: overrideReason.trim() });
        toast.success('Grade overridden and applied — the student has been notified.');
      } else {
        await api.post(`/academic-head/submissions/${submission.id}/request-override`, { proposed_grade: Number(overrideGrade), reason: overrideReason.trim() });
        toast.success('Override request sent to the Academic Head for approval.');
      }
      setShowOverride(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit override');
    } finally { setOverrideBusy(false); }
  };

  return (
    <div className="card card-pad" style={!isGraded ? { border: '1.5px solid var(--flame-dim)' } : undefined}>
      <div className="flex justify-between items-center">
        <div>
          <div style={{ fontWeight: 700 }}>{submission.student_name}</div>
          <div className="text-xs text-dim">{new Date(submission.submitted_at).toLocaleString()} • v{submission.version_count}</div>
        </div>
        {isGraded ? (
          <span className="badge badge-green"><Award size={11} /> Graded: {submission.grade}/{assignment.max_score}</span>
        ) : (
          <span className={`badge ${submission.is_late ? 'badge-orange' : 'badge-purple'}`}>
            <AlertCircle size={11} /> {submission.status === 'resubmission_requested' ? 'Resubmission requested' : submission.is_late ? 'Late — needs grading' : 'Needs grading'}
          </span>
        )}
      </div>
      {submission.note && <p className="text-sm" style={{ marginTop: 8 }}>{submission.note}</p>}
      <div className="flex gap-2 flex-wrap" style={{ marginTop: 10 }}>
        {(submission.attachments || []).map((att, i) => (
          <a key={i} href={att.path} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><FileDown size={13} /> {att.name || 'File'}</a>
        ))}
        {!editing && <button className="btn btn-primary btn-sm" onClick={openEditor}><ClipboardCheck size={13} /> {isGraded ? 'Re-grade' : 'Grade Submission'}</button>}
        <button className="btn btn-outline btn-sm" onClick={() => setShowResubmit(v => !v)}><RotateCcw size={13} /> Request Resubmission</button>
        <button className="btn btn-outline btn-sm" onClick={rejectInvalid}><ShieldAlert size={13} /> Mark Invalid</button>
        {!submission.is_late && <button className="btn btn-outline btn-sm" onClick={markLate}><Clock3 size={13} /> Mark Late</button>}
        {isGraded && canRequestOverride && (
          <button className="btn btn-outline btn-sm" onClick={() => { setShowOverride(v => !v); setOverrideGrade(String(submission.grade)); }}>
            <ShieldAlert size={13} /> {canOverrideDirectly ? 'Override Grade' : 'Request Override'}
          </button>
        )}
        <button className="btn-ghost btn-sm" onClick={loadVersions}>{showVersions ? 'Hide' : 'View'} Versions</button>
      </div>

      {showOverride && (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div className="text-xs text-dim" style={{ marginBottom: 10 }}>
            {canOverrideDirectly
              ? 'As Academic Head / System Admin, this applies immediately and is logged with a full audit trail.'
              : 'This sends a request to the Academic Head\u2019s Approval Queue \u2014 it will not change the grade until approved.'}
          </div>
          <div className="field"><label>New Grade (out of {assignment.max_score})</label>
            <input className="input" type="number" value={overrideGrade} onChange={e => setOverrideGrade(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>Reason (required)</label>
            <textarea className="input" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="e.g. Documented illness, moderation review, appeal upheld..." />
          </div>
          <div className="flex gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowOverride(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={overrideBusy} onClick={submitOverride}>
              {overrideBusy ? 'Submitting...' : canOverrideDirectly ? 'Apply Override' : 'Send Request'}
            </button>
          </div>
        </div>
      )}

      {showVersions && versions && (
        <div className="card card-pad" style={{ background: 'var(--surface-2)', marginTop: 10 }}>
          {versions.map(v => (
            <div key={v.id} className="flex items-center justify-between text-xs" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span>v{v.version_number} — {new Date(v.created_at).toLocaleString()}</span>
              {v.file_path && <a href={v.file_path} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" style={{ padding: 4 }}><FileDown size={12} /></a>}
            </div>
          ))}
        </div>
      )}

      {showResubmit && (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div className="field"><label>Reason</label>
            <select className="input" value={resubmitReason} onChange={e => setResubmitReason(e.target.value)}>
              {['Wrong File', 'Missing Questions', 'Formatting Issues', 'Incomplete Work', 'Poor Quality', 'Plagiarism', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {resubmitReason === 'Other' && <div className="field"><label>Custom reason</label><input className="input" value={resubmitCustom} onChange={e => setResubmitCustom(e.target.value)} /></div>}
          <div className="field" style={{ marginBottom: 0 }}><label>New Deadline (optional)</label><input className="input" type="datetime-local" value={resubmitDeadline} onChange={e => setResubmitDeadline(e.target.value)} /></div>
          <div className="flex gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowResubmit(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={requestResubmission}>Send Request</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          {hasRubric && (
            <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={useRubric} onChange={e => setUseRubric(e.target.checked)} /> Grade using rubric ({assignment.rubric.length} criteria)
            </label>
          )}
          {useRubric && hasRubric ? (
            !rubricScores ? <div className="text-sm text-dim">Loading rubric...</div> : (
              <div className="flex-col gap-2" style={{ marginBottom: 10 }}>
                {rubricScores.map((r, i) => (
                  <div key={r.rubric_id} className="flex gap-2 items-center">
                    <span className="text-sm" style={{ flex: 1 }}>{r.criterion}</span>
                    <input className="input" type="number" min={0} max={r.max_points} style={{ width: 90 }}
                      value={r.score} onChange={e => setRubricScores(rs => rs.map((x, idx) => idx === i ? { ...x, score: Number(e.target.value) } : x))} />
                    <span className="text-xs text-dim">/ {r.max_points}</span>
                  </div>
                ))}
                <div className="text-sm" style={{ fontWeight: 700 }}>Total: {rubricTotal} / {assignment.max_score}</div>
              </div>
            )
          ) : (
            <div className="flex gap-2" style={{ marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0, width: 130 }}>
                <label>Grade (out of {assignment.max_score})</label>
                <input className="input" type="number" min={0} max={assignment.max_score} value={grade} onChange={e => setGrade(e.target.value)} autoFocus />
              </div>
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Feedback (optional)</label>
            <input className="input" value={feedback} onChange={e => setFeedback(e.target.value)} />
          </div>
          <div className="flex gap-2" style={{ marginTop: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-outline btn-sm" onClick={() => saveGrade(true)} disabled={saving}>Save Draft Grade</button>
            <button className="btn btn-primary btn-sm" onClick={() => saveGrade(false)} disabled={saving}><Award size={13} /> {saving ? 'Saving...' : 'Publish Grade'}</button>
          </div>
        </div>
      )}

      {confirmRegrade && (
        <ConfirmDialog
          title="Re-grade this submission?"
          message={`${submission.student_name} already has a grade of ${submission.grade}/${assignment.max_score}. Do you want to change it?`}
          confirmLabel="Yes, re-grade" danger={false}
          onConfirm={() => { setConfirmRegrade(false); setEditing(true); }}
          onCancel={() => setConfirmRegrade(false)}
        />
      )}
    </div>
  );
}

function AnalyticsModal({ assignment, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/assignments/${assignment.id}/analytics`).then(({ data }) => setData(data)); }, [assignment.id]);
  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3><BarChart3 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Analytics — {assignment.title}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!data ? <div className="text-dim text-sm">Loading...</div> : (
          <div className="flex-col gap-3">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.submissionRatePct}%</div><div className="text-xs text-dim">Submission Rate</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.avgScore ?? '—'}</div><div className="text-xs text-dim">Avg Score</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.lateCount}</div><div className="text-xs text-dim">Late Submissions</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.highScore ?? '—'}</div><div className="text-xs text-dim">Highest</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.lowScore ?? '—'}</div><div className="text-xs text-dim">Lowest</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.resubmissionCount}</div><div className="text-xs text-dim">Resubmissions</div></div>
            </div>
            <div className="card card-pad">
              <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>GRADE DISTRIBUTION</div>
              {data.gradeDistribution.map(g => (
                <div key={g.label} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <span className="text-xs" style={{ width: 60 }}>{g.label}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, g.count * 20)}%`, height: '100%', background: 'var(--primary)' }} />
                  </div>
                  <span className="text-xs mono">{g.count}</span>
                </div>
              ))}
            </div>
            {data.missingStudents.length > 0 && (
              <div className="card card-pad">
                <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>MISSING STUDENTS ({data.missingStudents.length})</div>
                <div className="flex gap-1 flex-wrap">{data.missingStudents.map(s => <span key={s.id} className="badge badge-orange">{s.name}</span>)}</div>
              </div>
            )}
            <div className="text-xs text-dim">{data.regradeRequestCount} regrade request{data.regradeRequestCount === 1 ? '' : 's'} on this assignment</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RegradeRequestsPanel() {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [respondingTo, setRespondingTo] = useState(null);
  const [newGrade, setNewGrade] = useState('');
  const [response, setResponse] = useState('');

  const load = () => api.get('/assignments/regrade-requests?status=pending').then(({ data }) => setRequests(data.requests));
  useEffect(() => { load(); }, []);

  const decide = async (id, decision) => {
    try {
      await api.put(`/assignments/regrade-requests/${id}/decide`, { decision, new_grade: decision === 'approved' ? Number(newGrade) : undefined, teacher_response: response });
      toast.success(`Regrade request ${decision}`);
      setRespondingTo(null); setNewGrade(''); setResponse('');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  if (requests.length === 0) return null;

  return (
    <div className="card card-pad" style={{ marginBottom: 20, border: '1.5px solid var(--flame-dim)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
        <RotateCcw size={17} color="var(--flame)" />
        <h3 style={{ fontSize: 16 }}>Pending Regrade Requests</h3>
        <span className="badge badge-orange">{requests.length}</span>
      </div>
      <div className="flex-col gap-2">
        {requests.map(r => (
          <div key={r.id} className="card card-pad" style={{ background: 'var(--surface-2)' }}>
            <div style={{ fontWeight: 700 }}>{r.student_name} — {r.assignment_title}</div>
            <div className="text-sm text-dim" style={{ margin: '4px 0' }}>{r.reason}</div>
            {respondingTo === r.id ? (
              <div className="flex gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <input className="input" style={{ width: 100 }} type="number" placeholder="New grade" value={newGrade} onChange={e => setNewGrade(e.target.value)} />
                <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Response to student" value={response} onChange={e => setResponse(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={() => decide(r.id, 'approved')}>Approve</button>
                <button className="btn btn-outline btn-sm" onClick={() => decide(r.id, 'rejected')}>Reject</button>
                <button className="btn-ghost btn-sm" onClick={() => setRespondingTo(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => setRespondingTo(r.id)}>Review</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminAssignments() {
  const toast = useToast();
  const { classLevel, setClassLevel, section, setSection, subjectId, setSubjectId } = useModuleFilters();
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [analyticsFor, setAnalyticsFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  const load = () => {
    const params = new URLSearchParams();
    if (classLevel) params.set('class_level', classLevel);
    if (subjectId) params.set('subject_id', subjectId);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/assignments?${params.toString()}`).then(({ data }) => setAssignments(data.assignments));
  };
  useEffect(() => { load(); }, [classLevel, subjectId, statusFilter]);

  useEffect(() => {
    if (viewing) api.get(`/assignments/${viewing.id}/submissions`).then(({ data }) => setSubmissions(data.submissions));
  }, [viewing]);

  const remove = async () => {
    const a = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/assignments/${a.id}`);
      toast.success(`Assignment "${a.title}" deleted`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete assignment');
    }
  };

  const duplicate = async (a) => {
    try {
      await api.post(`/assignments/${a.id}/duplicate`);
      toast.success(`"${a.title}" duplicated as a draft`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to duplicate'); }
  };

  const archive = async (a) => {
    try {
      await api.put(`/assignments/${a.id}/archive`);
      toast.success(`"${a.title}" archived`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to archive'); }
  };

  const scopeLabel = classLevel ? `Class ${classLevel}` : 'All Classes';

  return (
    <AppLayout title="Assignments" subtitle="Create, publish, and grade assignments with full version history and analytics">
      <RegradeRequestsPanel />

      <GlobalFilterBar classLevel={classLevel} onClassChange={setClassLevel} section={section} onSectionChange={setSection} subjectId={subjectId} onSubjectChange={setSubjectId} />

      <div className="flex justify-between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="flex items-center gap-2">
          <h3 style={{ fontSize: 16 }}>{scopeLabel} Assignments</h3>
          <select className="input" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> New Assignment</button>
      </div>

      <div className="flex-col gap-2">
        {assignments.map(a => (
          <div key={a.id} className="card card-pad flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <span className="badge badge-gray">Class {a.class_level}{a.section ? `-${a.section}` : ''}</span>
                <span className={`badge ${STATUS_BADGE[a.status] || 'badge-gray'}`}>{a.status}</span>
                {a.pending_grading > 0 && <span className="badge badge-orange"><AlertCircle size={11} /> {a.pending_grading} to grade</span>}
              </div>
              <div className="text-sm text-dim">{a.subject_name} • Due {a.due_date ? new Date(a.due_date).toLocaleString() : 'N/A'} • Max {a.max_score} • {a.submission_count || 0} submitted</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-secondary btn-sm" onClick={() => setViewing(a)}>Review Submissions</button>
              <button className="btn-ghost btn-sm" onClick={() => setAnalyticsFor(a)}><BarChart3 size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => { setEditing(a); setShowForm(true); }}><Pencil size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => duplicate(a)}><Copy size={14} /></button>
              {a.status !== 'archived' && <button className="btn-ghost btn-sm" onClick={() => archive(a)}><Archive size={14} /></button>}
              <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(a)}><Trash2 size={14} color="var(--danger)" /></button>
            </div>
          </div>
        ))}
        {assignments.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No assignments found for the selected filters.</div>}
      </div>

      {showForm && (
        <AssignmentFormModal
          existing={editing}
          defaultClassLevel={classLevel}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {viewing && (
        <Modal onClose={() => setViewing(null)}>
          <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
              <h3>Submissions — {viewing.title}</h3>
              <button className="btn-ghost" onClick={() => setViewing(null)}><X size={18} /></button>
            </div>
            <div className="flex-col gap-2">
              {submissions.map(s => <GradeRow key={s.id} submission={s} assignment={viewing} onSaved={() => { api.get(`/assignments/${viewing.id}/submissions`).then(({ data }) => setSubmissions(data.submissions)); load(); }} />)}
              {submissions.length === 0 && <div className="text-dim text-sm">No submissions yet.</div>}
            </div>
          </div>
        </Modal>
      )}

      {analyticsFor && <AnalyticsModal assignment={analyticsFor} onClose={() => setAnalyticsFor(null)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this assignment?"
          message={`Are you sure you want to delete "${confirmDelete.title}"? All student submissions for it will also be removed.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
