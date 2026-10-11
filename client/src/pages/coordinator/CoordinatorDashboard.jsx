import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, GraduationCap, ClipboardList, ShieldCheck, AlertTriangle, Activity,
  LogIn, LogOut, XCircle, TrendingUp,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';

const ACTION_ICON = { login: LogIn, logout: LogOut, failed_login: XCircle };

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="card card-pad" style={{ flex: 1, minWidth: 180 }}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-dim text-sm" style={{ marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{value ?? '—'}</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={19} color={color} />
        </div>
      </div>
    </div>
  );
}

function WorkloadTable({ teachers }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
            {['Teacher', 'Role', 'Classes', 'Assignments', 'Quizzes', 'Pending Grading', 'Last Login', 'Status'].map(h => (
              <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.map(t => (
            <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>{t.name}</td>
              <td className="text-sm text-dim" style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{(t.staff_role || '').replace('_', ' ')}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.class_count}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.assignments_created}</td>
              <td className="text-sm" style={{ padding: '12px 16px' }}>{t.quizzes_created}</td>
              <td style={{ padding: '12px 16px' }}>
                {t.pending_grading > 0 ? <span className="badge badge-orange">{t.pending_grading}</span> : <span className="text-dim text-sm">0</span>}
              </td>
              <td className="text-xs text-dim" style={{ padding: '12px 16px' }}>{t.last_login_at ? new Date(t.last_login_at.replace(' ', 'T') + 'Z').toLocaleString() : 'Never'}</td>
              <td style={{ padding: '12px 16px' }}>
                <span className={`badge ${t.account_status === 'disabled' ? 'badge-red' : 'badge-green'}`}>{t.account_status}</span>
              </td>
            </tr>
          ))}
          {teachers.length === 0 && <tr><td colSpan={8} className="text-dim text-sm" style={{ padding: 24, textAlign: 'center' }}>No teachers found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function CoordinatorDashboard() {
  const [overview, setOverview] = useState(null);
  const [workload, setWorkload] = useState([]);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [inactive, setInactive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    Promise.all([
      api.get('/coordinator/overview'),
      api.get('/coordinator/teacher-workload'),
      api.get('/coordinator/pending-reviews'),
      api.get('/coordinator/inactive-teachers?days=7'),
    ]).then(([ov, wl, pr, ia]) => {
      setOverview(ov.data);
      setWorkload(wl.data.teachers);
      setPendingReviews(pr.data.submissions);
      setInactive(ia.data.teachers);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppLayout title="Coordinator Dashboard" subtitle="School-wide academic monitoring — read-only oversight">
        <div className="flex gap-2"><Skeleton height={90} /><Skeleton height={90} /><Skeleton height={90} /><Skeleton height={90} /></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Coordinator Dashboard" subtitle="School-wide academic monitoring — read-only oversight">
      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <StatCard icon={Users} label="Active Teachers" value={overview.totalTeachers} color="#0984E3" />
        <StatCard icon={GraduationCap} label="Total Students" value={overview.totalStudents} color="#00B894" />
        <StatCard icon={ClipboardList} label="Pending Grading (school-wide)" value={overview.pendingGrading} color="#F0932B" />
        <StatCard icon={TrendingUp} label="Avg Quiz Score" value={overview.avgQuizPct != null ? `${overview.avgQuizPct}%` : '—'} color="#6C5CE7" />
      </div>

      {inactive.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 18, border: '1.5px solid var(--flame-dim)' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <AlertTriangle size={16} color="var(--flame)" />
            <h3 style={{ fontSize: 15 }}>Inactive Teachers (no login in 7+ days)</h3>
            <span className="badge badge-orange">{inactive.length}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {inactive.map(t => (
              <span key={t.id} className="badge badge-gray">{t.name}{t.last_login_at ? '' : ' (never logged in)'}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        {[['overview', 'Teacher Workload'], ['reviews', 'Pending Reviews'], ['audit', 'Recent Audit Activity']].map(([id, label]) => (
          <button key={id} className={tab === id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && <WorkloadTable teachers={workload} />}

      {tab === 'reviews' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                {['Student', 'Assignment', 'Subject', 'Class', 'Teacher', 'Submitted', 'Status'].map(h => (
                  <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pendingReviews.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>{s.student_name}</td>
                  <td className="text-sm" style={{ padding: '12px 16px' }}>{s.assignment_title}</td>
                  <td className="text-sm text-dim" style={{ padding: '12px 16px' }}>{s.subject_name}</td>
                  <td className="text-sm text-dim" style={{ padding: '12px 16px' }}>Class {s.class_level}{s.section ? ` ${s.section}` : ''}</td>
                  <td className="text-sm text-dim" style={{ padding: '12px 16px' }}>{s.teacher_name || '—'}</td>
                  <td className="text-xs text-dim" style={{ padding: '12px 16px' }}>{new Date(s.submitted_at).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}><span className={`badge ${s.is_late ? 'badge-orange' : 'badge-purple'}`}>{s.is_late ? 'Late' : 'Pending'}</span></td>
                </tr>
              ))}
              {pendingReviews.length === 0 && <tr><td colSpan={7} className="text-dim text-sm" style={{ padding: 24, textAlign: 'center' }}>No pending reviews across the school. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card card-pad">
          <div className="flex-col gap-2">
            {overview.recentAudit.map(a => {
              const Icon = ACTION_ICON[a.action] || Activity;
              return (
                <div key={a.id} className="flex items-center gap-3" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <Icon size={14} color="var(--text-dim)" />
                  <div style={{ flex: 1 }}>
                    <div className="text-sm">{a.description}</div>
                    <div className="text-xs text-dim">{a.user_name} • {a.module} • {new Date(a.created_at).toLocaleString()}</div>
                  </div>
                  <span className={`badge ${a.status === 'failure' ? 'badge-red' : 'badge-green'}`}>{a.status}</span>
                </div>
              );
            })}
          </div>
          <Link to="/admin/audit-log" className="btn btn-outline btn-sm btn-block" style={{ marginTop: 14 }}>
            <ShieldCheck size={13} /> View Full Audit Log
          </Link>
        </div>
      )}
    </AppLayout>
  );
}
