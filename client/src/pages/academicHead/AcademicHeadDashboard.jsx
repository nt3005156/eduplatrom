import { useCallback, useEffect, useState } from 'react';
import {
  Users, GraduationCap, School, ClipboardCheck, TrendingUp, TrendingDown,
  CheckCircle2, XCircle, ShieldCheck, ChevronRight,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="card card-pad" style={{ flex: 1, minWidth: 190 }}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-dim text-sm" style={{ marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{value ?? '—'}</div>
          {sub && <div className="text-xs text-dim" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={19} color={color} />
        </div>
      </div>
    </div>
  );
}

function PctBar({ pct }) {
  if (pct == null) return <span className="text-dim text-sm">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden', minWidth: 60 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 70 ? '#00B894' : pct >= 50 ? '#F0932B' : '#E17055' }} />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

// --- Compare Classes ---
function CompareClasses() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/academic-head/compare/classes').then(({ data }) => setRows(data.classes)); }, []);
  if (!rows) return <Skeleton height={220} />;

  const best = rows.reduce((a, b) => (b.avg_grade_pct ?? -1) > (a?.avg_grade_pct ?? -1) ? b : a, null);
  const worst = rows.reduce((a, b) => (b.avg_grade_pct ?? 101) < (a?.avg_grade_pct ?? 101) ? b : a, null);

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {rows.length > 1 && best && worst && best.class_level !== worst.class_level && (
        <div className="flex gap-2" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span className="badge badge-green"><TrendingUp size={12} style={{ verticalAlign: -2 }} /> Strongest: Class {best.class_level} ({best.avg_grade_pct}%)</span>
          <span className="badge badge-red"><TrendingDown size={12} style={{ verticalAlign: -2 }} /> Needs attention: Class {worst.class_level} ({worst.avg_grade_pct ?? '—'}%)</span>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
            {['Class', 'Students', 'Avg Quiz Score', 'Avg Assignment Grade', 'Assignment Completion'].map(h => (
              <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.class_level} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 700 }}>Class {r.class_level}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{r.student_count}</td>
              <td style={{ padding: '12px 16px', width: 160 }}><PctBar pct={r.avg_quiz_pct} /></td>
              <td style={{ padding: '12px 16px', width: 160 }}><PctBar pct={r.avg_grade_pct} /></td>
              <td style={{ padding: '12px 16px', width: 160 }}><PctBar pct={r.assignment_completion_pct} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-dim text-sm" style={{ padding: 24, textAlign: 'center' }}>No classes with students yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// --- Compare Subjects ---
function CompareSubjects() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/academic-head/compare/subjects').then(({ data }) => setRows(data.subjects)); }, []);
  if (!rows) return <Skeleton height={220} />;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
            {['Subject', 'Class', 'Avg Quiz Score', 'Avg Grade', 'Weak Chapters (Quiz Topics < 60%)'].map(h => (
              <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.subject_id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.subject_color, marginRight: 8 }} />
                {r.subject_name}
              </td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>Class {r.class_level}</td>
              <td style={{ padding: '12px 16px', width: 150 }}><PctBar pct={r.avg_quiz_pct} /></td>
              <td style={{ padding: '12px 16px', width: 150 }}><PctBar pct={r.avg_grade_pct} /></td>
              <td style={{ padding: '12px 16px' }}>
                {r.weak_topics.length === 0
                  ? <span className="text-dim text-sm">None flagged</span>
                  : <div className="flex gap-1 flex-wrap">{r.weak_topics.map(t => (
                      <span key={t.topic} className="badge badge-orange" title={`${t.attempts} attempts`}>{t.topic} ({t.avg_pct}%)</span>
                    ))}</div>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-dim text-sm" style={{ padding: 24, textAlign: 'center' }}>No subjects found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// --- Compare Teachers ---
function CompareTeachers() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/academic-head/compare/teachers').then(({ data }) => setRows(data.teachers)); }, []);
  if (!rows) return <Skeleton height={220} />;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
            {['Teacher', 'Role', 'Classes', 'Content Created', 'Avg Student Outcome', 'Grading Turnaround'].map(h => (
              <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 700 }}>{t.name}</td>
              <td className="text-sm text-dim" style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{(t.staff_role || '').replace('_', ' ')}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.classes_taught}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.assignments_created + t.quizzes_created} ({t.assignments_created} assign. / {t.quizzes_created} quiz)</td>
              <td style={{ padding: '12px 16px', width: 150 }}><PctBar pct={t.avg_student_outcome_pct} /></td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.avg_grading_turnaround_days != null ? `${t.avg_grading_turnaround_days}d` : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-dim text-sm" style={{ padding: 24, textAlign: 'center' }}>No teachers found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// --- Approval Queue ---
function ApprovalQueue({ canDecide }) {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => api.get(`/academic-head/approval-queue?status=${status}`).then(({ data }) => setRows(data.requests)), [status]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const decide = async (id, decision) => {
    setBusyId(id);
    try {
      const note = decision === 'rejected' ? window.prompt('Optional reason for rejecting:') || '' : 'Reviewed and approved.';
      await api.put(`/academic-head/approval-queue/${id}/decide`, { decision, decision_note: note });
      toast.success(`Request ${decision}.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to decide');
    } finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>
      {!rows ? <Skeleton height={160} /> : (
        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <div className="card card-pad text-dim text-sm" style={{ textAlign: 'center' }}>No {status} requests.</div>
          )}
          {rows.map(r => (
            <div key={r.id} className="card card-pad">
              <div className="flex justify-between items-start" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                    Grade override — {r.context?.assignment_title} ({r.context?.subject_name}, Class {r.context?.class_level}{r.context?.section ? `-${r.context.section}` : ''})
                  </div>
                  <div className="text-xs text-dim" style={{ marginTop: 3 }}>
                    Student: {r.context?.student_name} &middot; Requested by {r.requested_by_name} &middot; {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                  </div>
                </div>
                <span className={`badge ${r.status === 'pending' ? 'badge-orange' : r.status === 'approved' ? 'badge-green' : 'badge-red'}`} style={{ textTransform: 'capitalize' }}>{r.status}</span>
              </div>
              <div className="flex items-center gap-3" style={{ marginBottom: 8, fontSize: 13.5 }}>
                <span className="text-dim">Current: <strong>{r.previous_value?.grade ?? r.context?.current_grade ?? '—'}/{r.context?.max_score}</strong></span>
                <ChevronRight size={14} className="text-dim" />
                <span style={{ color: 'var(--primary)', fontWeight: 700 }}>Proposed: {r.proposed_value?.grade}/{r.context?.max_score}</span>
              </div>
              <div className="text-sm" style={{ marginBottom: r.status === 'pending' && canDecide ? 12 : 0 }}>
                <span className="text-dim">Reason: </span>{r.reason}
              </div>
              {r.decision_note && (
                <div className="text-xs text-dim" style={{ marginBottom: 8 }}>Decision note: {r.decision_note}{r.decided_by_name ? ` — ${r.decided_by_name}` : ''}</div>
              )}
              {r.status === 'pending' && canDecide && (
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => decide(r.id, 'approved')}>
                    <CheckCircle2 size={14} /> Approve
                  </button>
                  <button className="btn btn-sm btn-ghost" disabled={busyId === r.id} onClick={() => decide(r.id, 'rejected')}>
                    <XCircle size={14} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AcademicHeadDashboard() {
  const { hasPermission } = usePermissions();
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState('classes');
  const canDecide = hasPermission('grade.override');

  useEffect(() => { api.get('/academic-head/overview').then(({ data }) => setOverview(data)); }, []);

  const tabs = [
    ['classes', 'Compare Classes', School],
    ['subjects', 'Compare Subjects', GraduationCap],
    ['teachers', 'Compare Teachers', Users],
    ['approvals', 'Approval Queue', ClipboardCheck],
  ];

  return (
    <AppLayout title="Academic Head Dashboard" subtitle="School-wide oversight — compare classes, subjects, and teachers; review and approve grade overrides">
      {!overview ? (
        <div className="flex gap-2" style={{ marginBottom: 18 }}><Skeleton height={90} /><Skeleton height={90} /><Skeleton height={90} /><Skeleton height={90} /></div>
      ) : (
        <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
          <StatCard icon={GraduationCap} label="Total Students" value={overview.totalStudents} color="#00B894" />
          <StatCard icon={Users} label="Active Teachers" value={overview.totalTeachers} color="#0984E3" />
          <StatCard icon={TrendingUp} label="School Avg Grade" value={overview.schoolAvgGradePct != null ? `${overview.schoolAvgGradePct}%` : '—'} color="#6C5CE7" sub={overview.schoolAvgQuizPct != null ? `Avg quiz score: ${overview.schoolAvgQuizPct}%` : undefined} />
          <StatCard icon={ClipboardCheck} label="Pending Approvals" value={overview.pendingApprovals + overview.pendingRegrades} color="#F0932B" sub={overview.pendingStudentApprovals ? `+${overview.pendingStudentApprovals} student registrations` : undefined} />
        </div>
      )}

      {!canDecide && (
        <div className="card card-pad" style={{ marginBottom: 18, display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--border)' }}>
          <ShieldCheck size={16} color="var(--text-dim)" />
          <div className="text-sm text-dim">You have read-only monitoring access to this dashboard. Grade override decisions require Academic Head or System Admin — you can still submit an override <em>request</em> from a submission's grading screen for their review.</div>
        </div>
      )}

      <div className="flex gap-2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(([id, label, Icon]) => (
          <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'classes' && <CompareClasses />}
      {tab === 'subjects' && <CompareSubjects />}
      {tab === 'teachers' && <CompareTeachers />}
      {tab === 'approvals' && <ApprovalQueue canDecide={canDecide} />}
    </AppLayout>
  );
}
