import { useEffect, useMemo, useState } from 'react';
import {
  Clock, CheckCircle2, Upload, FileDown, ListTodo, History, RotateCcw, AlertCircle,
  ExternalLink, X, TrendingUp,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import SubjectIcon from '../../components/IconMap.jsx';
import { SkeletonRow } from '../../components/Skeleton.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useGamification } from '../../context/GamificationContext.jsx';

const STATUS_META = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  not_started: { label: 'Not Started', cls: 'badge-orange' },
  missing: { label: 'Missing', cls: 'badge-red' },
  submitted: { label: 'Submitted', cls: 'badge-purple' },
  under_review: { label: 'Under Review', cls: 'badge-purple' },
  graded: { label: 'Graded', cls: 'badge-green' },
  resubmission_requested: { label: 'Resubmission Requested', cls: 'badge-orange' },
  resubmitted: { label: 'Resubmitted', cls: 'badge-purple' },
  regraded: { label: 'Regraded', cls: 'badge-green' },
  closed: { label: 'Closed', cls: 'badge-gray' },
  rejected_invalid: { label: 'Invalid — Please Resubmit', cls: 'badge-red' },
};

function effectiveStatus(a) {
  if (a.student_status) return a.student_status;
  if (!a.submission) return 'not_started';
  return a.submission.status;
}

function StatusBadge({ status, isLate }) {
  const meta = STATUS_META[status] || { label: status, cls: 'badge-gray' };
  return (
    <span className={`badge ${meta.cls}`}>
      {meta.label}{isLate ? ' (Late)' : ''}
    </span>
  );
}

function Countdown({ dueDate }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  if (!dueDate) return null;
  const diffMs = new Date(dueDate).getTime() - now;
  if (diffMs <= 0) return <span className="text-xs" style={{ color: 'var(--danger)' }}>Past due</span>;
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return <span className="text-xs text-dim">{days > 0 ? `${days}d ${hours}h left` : `${hours}h left`}</span>;
}

function AssignmentCard({ a, onOpen }) {
  const status = effectiveStatus(a);
  return (
    <div className="card card-pad" onClick={() => onOpen(a)} style={{ cursor: 'pointer' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: a.subject_color, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
            <div className="text-xs text-dim">{a.subject_name} • Max {a.max_score}</div>
          </div>
        </div>
        <StatusBadge status={status} isLate={a.submission?.is_late} />
      </div>
      <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
        {a.due_date && (
          <div className="text-xs text-dim flex items-center gap-1">
            <Clock size={11} /> Due {new Date(a.due_date).toLocaleDateString()}
          </div>
        )}
        {a.due_date && status !== 'graded' && status !== 'regraded' && <Countdown dueDate={a.due_date} />}
      </div>
      {a.submission?.status === 'graded' || a.submission?.status === 'regraded' ? (
        <div className="mono text-sm" style={{ marginTop: 8, fontWeight: 700, color: 'var(--knowledge)' }}>
          {a.submission.grade}/{a.max_score}
        </div>
      ) : null}
    </div>
  );
}

function VersionHistoryPanel({ submissionId, versionCount }) {
  const [versions, setVersions] = useState(null);
  // Re-fetch whenever the submission's version count changes too — not just
  // when submissionId first becomes available. A resubmission reuses the
  // SAME submission row (same id), so relying on submissionId alone as the
  // effect dependency meant this panel never refreshed after a resubmit while
  // the modal stayed open — this was the real "version history is broken" bug.
  useEffect(() => {
    if (submissionId) api.get(`/assignments/submissions/${submissionId}/versions`).then(({ data }) => setVersions(data.versions));
  }, [submissionId, versionCount]);
  if (!submissionId) return null;
  if (!versions) return <div className="text-xs text-dim">Loading version history...</div>;
  return (
    <div className="card card-pad" style={{ background: 'var(--surface-2)', marginTop: 10 }}>
      <div className="flex items-center gap-2 text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>
        <History size={13} /> SUBMISSION VERSION HISTORY ({versions.length})
      </div>
      <div className="flex-col gap-2">
        {versions.map(v => (
          <div key={v.id} className="flex items-center justify-between text-xs" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <span>v{v.version_number} — {new Date(v.created_at).toLocaleString()}{v.is_late ? ' (late)' : ''}</span>
            {v.file_path && <a href={v.file_path} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" style={{ padding: 4 }}><FileDown size={12} /></a>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RubricBreakdown({ submissionId, hasRubric }) {
  const [rubric, setRubric] = useState(null);
  useEffect(() => {
    if (hasRubric && submissionId) api.get(`/assignments/submissions/${submissionId}/rubric-scores`).then(({ data }) => setRubric(data.rubric));
  }, [submissionId, hasRubric]);
  if (!hasRubric || !rubric || rubric.length === 0) return null;
  return (
    <div className="card card-pad" style={{ background: 'var(--surface)', marginTop: 8 }}>
      <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 6 }}>RUBRIC BREAKDOWN</div>
      <div className="flex-col gap-1">
        {rubric.map(r => (
          <div key={r.id} className="flex items-center justify-between text-sm">
            <span>{r.criterion}</span>
            <span style={{ fontWeight: 700 }}>{r.score ?? '—'} / {r.max_points}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegradeRequestForm({ assignment, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    fd.append('reason', reason);
    if (file) fd.append('attachment', file);
    try {
      await api.post(`/assignments/submissions/${assignment.submission.id}/regrade-request`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Regrade request submitted — your teacher will review it.');
      setOpen(false); setReason(''); setFile(null);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit regrade request');
    } finally { setSaving(false); }
  };

  if (!open) {
    return <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}><RotateCcw size={13} /> Request Regrade</button>;
  }
  return (
    <form onSubmit={submit} className="card card-pad" style={{ background: 'var(--surface-2)', marginTop: 10 }}>
      <div className="field"><label>Why should this be regraded?</label><textarea className="input" required value={reason} onChange={e => setReason(e.target.value)} /></div>
      <div className="field"><label>Attach evidence (optional)</label><input className="input" type="file" onChange={e => setFile(e.target.files[0])} /></div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline btn-block" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</button>
      </div>
    </form>
  );
}

function AssignmentDetailModal({ assignment, onClose, onSubmitted }) {
  const toast = useToast();
  const { applyGamificationResult } = useGamification();
  const [note, setNote] = useState(assignment.submission?.note || '');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [myAnalytics, setMyAnalytics] = useState(null);

  useEffect(() => {
    if (assignment.submission?.status === 'graded' || assignment.submission?.status === 'regraded') {
      api.get(`/assignments/${assignment.id}/my-analytics`).then(({ data }) => setMyAnalytics(data)).catch(() => {});
    }
  }, [assignment.id, assignment.submission?.status]);

  const doSubmit = async (asDraft) => {
    const setBusy = asDraft ? setSavingDraft : setSubmitting;
    setBusy(true);
    const fd = new FormData();
    fd.append('note', note);
    fd.append('save_as_draft', asDraft ? 'true' : 'false');
    files.forEach(f => fd.append('attachments', f));
    try {
      const { data } = await api.post(`/assignments/${assignment.id}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(asDraft ? 'Draft saved' : 'Assignment submitted successfully!');
      if (!asDraft) applyGamificationResult(data);
      onSubmitted();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit assignment');
    } finally { setBusy(false); }
  };

  const status = effectiveStatus(assignment);
  const canEdit = !assignment.due_date || new Date() <= new Date(assignment.due_date) || assignment.allow_late;
  const referenceLinks = assignment.reference_links || [];

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <SubjectIcon name="BookOpen" size={16} color={assignment.subject_color} />
          <span className="text-xs text-dim" style={{ fontWeight: 700 }}>{assignment.subject_name}{assignment.chapter ? ` • ${assignment.chapter}` : ''}</span>
        </div>
        <h3 style={{ fontSize: 19, marginBottom: 6 }}>{assignment.title}</h3>
        <div className="flex items-center gap-2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <StatusBadge status={status} isLate={assignment.submission?.is_late} />
          {assignment.due_date && <span className="badge badge-gray"><Clock size={11} /> Due {new Date(assignment.due_date).toLocaleString()}</span>}
          <span className="badge badge-purple">Max {assignment.max_score}{assignment.passing_score ? ` • Pass ${assignment.passing_score}` : ''}</span>
        </div>

        {assignment.description && (
          <div
            className="text-sm text-dim"
            style={{ lineHeight: 1.6, marginBottom: 12 }}
            // Sanitized client-side with DOMPurify before rendering — the description
            // field allows basic rich-text HTML (per the Assignment redesign spec) but
            // must never be trusted as-is, since it originates from teacher input.
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(assignment.description) }}
          />
        )}
        {assignment.instructions && (
          <div className="card card-pad" style={{ background: 'var(--surface-2)', marginBottom: 14 }}>
            <div className="text-xs" style={{ fontWeight: 700, marginBottom: 4 }}>INSTRUCTIONS</div>
            <p className="text-sm text-dim" style={{ whiteSpace: 'pre-wrap' }}>{assignment.instructions}</p>
          </div>
        )}

        {(assignment.attachments?.length > 0) && (
          <div className="flex-col gap-2" style={{ marginBottom: 14 }}>
            {assignment.attachments.map(att => (
              <a key={att.id} href={att.file_path} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }}>
                <FileDown size={13} /> {att.original_name || 'Attachment'}
              </a>
            ))}
          </div>
        )}

        {referenceLinks.length > 0 && (
          <div className="flex-col gap-1" style={{ marginBottom: 14 }}>
            {referenceLinks.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer" className="text-sm" style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <ExternalLink size={12} /> {l.label || l.url}
              </a>
            ))}
          </div>
        )}

        {assignment.submission && (
          <div className="card card-pad" style={{ background: 'var(--surface-2)', marginBottom: 16 }}>
            <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 6, letterSpacing: '.03em' }}>YOUR SUBMISSION</div>
            <div className="text-sm" style={{ marginBottom: 6 }}>Submitted {new Date(assignment.submission.submitted_at).toLocaleString()} (v{assignment.submission.version_count})</div>
            {assignment.submission.note && <p className="text-sm text-dim" style={{ marginBottom: 8 }}>{assignment.submission.note}</p>}
            {(assignment.submission.attachments || []).map((att, i) => (
              <a key={i} href={att.path} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ marginRight: 6, marginBottom: 6 }}>
                <FileDown size={13} /> {att.name || 'File'}
              </a>
            ))}

            {(assignment.submission.status === 'graded' || assignment.submission.status === 'regraded') && (
              <>
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(var(--knowledge-rgb),.12)' }}>
                  <div className="mono" style={{ fontWeight: 700, color: 'var(--knowledge)', fontSize: 15 }}>
                    {assignment.submission.grade}/{assignment.max_score}
                  </div>
                  {assignment.submission.feedback && <div className="text-sm text-dim" style={{ marginTop: 4 }}>Feedback: {assignment.submission.feedback}</div>}
                </div>
                <RubricBreakdown submissionId={assignment.submission.id} hasRubric={(assignment.rubric || []).length > 0} />
                {myAnalytics && (
                  <div className="flex items-center gap-2 text-xs text-dim" style={{ marginTop: 8 }}>
                    <TrendingUp size={12} /> Class average: {myAnalytics.classAvg ?? '—'}% • Your score: {myAnalytics.myPct ?? '—'}%
                  </div>
                )}
                {assignment.allow_regrade_requests !== 0 && (
                  <div style={{ marginTop: 10 }}><RegradeRequestForm assignment={assignment} onDone={onSubmitted} /></div>
                )}
              </>
            )}

            {assignment.submission.status === 'resubmission_requested' && (
              <div className="flex items-center gap-2 text-sm" style={{ marginTop: 10, color: 'var(--flame)' }}>
                <AlertCircle size={14} /> Your teacher requested a resubmission — please review and resubmit below.
              </div>
            )}
            {assignment.submission.status === 'rejected_invalid' && (
              <div className="flex items-center gap-2 text-sm" style={{ marginTop: 10, color: 'var(--danger)' }}>
                <AlertCircle size={14} /> This submission was marked invalid: {assignment.submission.feedback}
              </div>
            )}

            <VersionHistoryPanel submissionId={assignment.submission.id} versionCount={assignment.submission.version_count} />
          </div>
        )}

        {canEdit ? (
          <div>
            <div className="field">
              <label>{assignment.submission ? 'Update your notes' : 'Notes (optional)'}</label>
              <textarea className="input" placeholder="Add a note for your teacher..." value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="field">
              <label>{assignment.submission ? 'Add / replace files' : 'Attach files'}</label>
              <input className="input" type="file" multiple onChange={e => setFiles(Array.from(e.target.files))} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-outline btn-block" disabled={savingDraft} onClick={() => doSubmit(true)}>{savingDraft ? 'Saving...' : 'Save Draft'}</button>
              <button type="button" className="btn btn-primary btn-block" disabled={submitting} onClick={() => doSubmit(false)}>
                <Upload size={15} /> {submitting ? 'Submitting...' : assignment.submission ? 'Resubmit' : 'Submit'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Close</button>
        )}
      </div>
    </Modal>
  );
}

export default function Assignments() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState('all');
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get(`/assignments/class/${user.class_level}`).then(({ data }) => { setAssignments(data.assignments); setLoading(false); });
    api.get(`/subjects/class/${user.class_level}`).then(({ data }) => setSubjects(data.subjects));
  };
  useEffect(() => { load(); }, [user.class_level]);

  const filtered = useMemo(
    () => activeSubject === 'all' ? assignments : assignments.filter(a => a.subject_id === activeSubject),
    [assignments, activeSubject]
  );
  // "Completed" means the student has actually SUBMITTED the assignment at
  // least once — never just opened/viewed it, and never just saved a draft.
  // A `draft` submission row (created by Save Draft, or auto-created when the
  // detail modal is opened) must stay in "To Do" until a real Submit happens.
  // This was a real bug: drafts were previously bucketed into "Completed"
  // just because a submissions row existed at all.
  const SUBMITTED_STATUSES = ['submitted', 'under_review', 'graded', 'resubmitted', 'regraded', 'closed'];
  const isActuallySubmitted = (a) => !!a.submission && SUBMITTED_STATUSES.includes(a.submission.status);
  const todo = filtered.filter(a => !isActuallySubmitted(a));
  const done = filtered.filter(a => isActuallySubmitted(a));

  return (
    <AppLayout title="Assignments" subtitle="Organized by subject — submitted work on the right, to-do on the left">
      <div className="flex gap-2" style={{ overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
        <button
          onClick={() => setActiveSubject('all')}
          className="btn-sm"
          style={{
            padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13.5,
            border: activeSubject === 'all' ? 'none' : '1.5px solid var(--border)',
            background: activeSubject === 'all' ? 'linear-gradient(135deg, var(--flame), #ff8a4c)' : 'var(--surface)',
            color: activeSubject === 'all' ? '#241407' : 'var(--text)',
          }}
        >
          All Subjects
        </button>
        {subjects.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSubject(s.id)}
            className="btn-sm"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap',
              border: activeSubject === s.id ? 'none' : '1.5px solid var(--border)',
              background: activeSubject === s.id ? s.color : 'var(--surface)',
              color: activeSubject === s.id ? '#fff' : 'var(--text)', fontWeight: 700, fontSize: 13.5,
            }}
          >
            <SubjectIcon name={s.icon} size={15} color={activeSubject === s.id ? '#fff' : s.color} />
            {s.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="flex-col gap-2"><SkeletonRow /><SkeletonRow /></div>
          <div className="flex-col gap-2"><SkeletonRow /><SkeletonRow /></div>
        </div>
      ) : (
        <div className="grid assignments-columns" style={{ gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
              <ListTodo size={16} color="var(--flame)" />
              <h3 style={{ fontSize: 16 }}>To Do</h3>
              <span className="badge badge-orange">{todo.length}</span>
            </div>
            <div className="flex-col gap-2 stagger">
              {todo.map(a => <AssignmentCard key={a.id} a={a} onOpen={setActive} />)}
              {todo.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>You're all caught up! 🎉</div>}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
              <CheckCircle2 size={16} color="var(--knowledge)" />
              <h3 style={{ fontSize: 16 }}>Completed</h3>
              <span className="badge badge-green">{done.length}</span>
            </div>
            <div className="flex-col gap-2 stagger">
              {done.map(a => <AssignmentCard key={a.id} a={a} onOpen={setActive} />)}
              {done.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>Nothing submitted yet.</div>}
            </div>
          </div>
        </div>
      )}

      {active && (
        <AssignmentDetailModal
          assignment={active}
          onClose={() => setActive(null)}
          onSubmitted={() => {
            api.get(`/assignments/class/${user.class_level}`).then(({ data }) => {
              setAssignments(data.assignments);
              const updated = data.assignments.find(a => a.id === active.id);
              setActive(updated || null);
            });
          }}
        />
      )}

      <style>{`@media (max-width: 780px){ .assignments-columns{ grid-template-columns: 1fr !important; } }`}</style>
    </AppLayout>
  );
}
