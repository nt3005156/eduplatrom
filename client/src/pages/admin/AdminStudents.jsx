import { useEffect, useState } from 'react';
import { Search, Check, X, Clock3 } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import ClassPicker from '../../components/ClassPicker.jsx';
import StreakFlame from '../../components/StreakFlame.jsx';
import StudentProfileModal from './StudentProfileModal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

function PendingApprovalsPanel({ pending, onDecision }) {
  if (pending.length === 0) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 20, border: '1.5px solid var(--flame-dim)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
        <Clock3 size={17} color="var(--flame)" />
        <h3 style={{ fontSize: 16 }}>Pending Approvals</h3>
        <span className="badge badge-orange">{pending.length}</span>
      </div>
      <div className="flex-col gap-2 stagger">
        {pending.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface-2)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
              <div className="text-xs text-dim">{p.email} • Class {p.class_level} • Registered {new Date(p.created_at).toLocaleDateString()}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => onDecision(p.id, 'approve')}><Check size={13} /> Approve</button>
              <button className="btn btn-danger btn-sm" onClick={() => onDecision(p.id, 'reject')}><X size={13} /> Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminStudents() {
  const toast = useToast();
  const { user } = useAuth();
  // Only a true Admin reviews/approves new registrations (see
  // server/src/routes/users.js — requireAdmin). A Subject/Class Teacher's
  // API responses now never include pending/rejected students at all (see
  // the approval_status='approved' filter added to GET /dashboard/admin/students
  // for scoped, non-admin callers), so hide the now-meaningless "Pending"/
  // "Rejected" filter options and the approvals panel for them too — a
  // teacher should never even see the concept of an unapproved student.
  const isAdmin = user?.role === 'admin';
  const [classLevel, setClassLevel] = useState(null);
  const [genderFilter, setGenderFilter] = useState('all');
  const [students, setStudents] = useState([]);
  const [pending, setPending] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewingId, setViewingId] = useState(null);
  const [confirmReject, setConfirmReject] = useState(null);

  // BUG FIX: /users/pending is admin-only (approving new student registrations
  // is an admin/Academic-Head concern, not something a Subject/Class Teacher
  // does), but this page is shared by both roles and previously called it
  // unconditionally with no .catch() — every teacher who opened "Students"
  // got an uncaught 403 promise rejection. Only fetch it for admins.
  const load = () => {
    const params = new URLSearchParams();
    if (classLevel) params.set('class_level', classLevel);
    if (genderFilter !== 'all') params.set('gender', genderFilter);
    const qs = params.toString();
    api.get(`/dashboard/admin/students${qs ? `?${qs}` : ''}`).then(({ data }) => setStudents(data.students)).catch(() => {});
    if (user?.role === 'admin') {
      api.get('/users/pending').then(({ data }) => setPending(data.pending)).catch(() => {});
    }
  };
  useEffect(() => { load(); }, [classLevel, genderFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (id, action) => {
    if (action === 'reject') { setConfirmReject(id); return; }
    try {
      await api.put(`/users/${id}/approve`);
      toast.success('Student approved — they can now sign in.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  };

  const doReject = async () => {
    const id = confirmReject;
    setConfirmReject(null);
    try {
      await api.put(`/users/${id}/reject`);
      toast.success('Registration rejected.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  };

  const filtered = students.filter(s =>
    (statusFilter === 'all' || s.approval_status === statusFilter) &&
    (s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AppLayout title="Students" subtitle="Review new registrations and monitor student progress across classes">
      {isAdmin && <PendingApprovalsPanel pending={pending} onDecision={decide} />}

      <div className="flex gap-2" style={{ marginBottom: 14, overflowX: 'auto' }}>
        <button className="btn-sm" style={{ padding: '8px 16px', borderRadius: 999, fontWeight: 700, border: classLevel === null ? 'none' : '1.5px solid var(--border)', background: classLevel === null ? 'linear-gradient(135deg, var(--flame), #ff8a4c)' : 'var(--surface)', color: classLevel === null ? '#241407' : 'var(--text)' }} onClick={() => setClassLevel(null)}>All Classes</button>
        <ClassPicker value={classLevel} onChange={setClassLevel} />
      </div>

      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 160 }} value={genderFilter} onChange={e => setGenderFilter(e.target.value)}>
          <option value="all">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
        {isAdmin && (
          <select className="input" style={{ width: 170 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              {['S/N', 'Name', 'Email', 'Class', 'Gender', 'Status', 'Streak', 'XP', 'Quiz Avg', 'Assignments'].map(h => (
                <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, idx) => (
              <tr
                key={s.id}
                onClick={() => setViewingId(s.id)}
                style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                className="student-row"
              >
                <td className="mono text-sm text-dim" style={{ padding: '12px 16px' }}>{idx + 1}</td>
                <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>{s.name}</td>
                <td className="text-sm text-dim" style={{ padding: '12px 16px' }}>{s.email}</td>
                <td style={{ padding: '12px 16px' }}><span className="badge badge-purple">Class {s.class_level}</span></td>
                <td className="text-sm text-dim" style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{s.gender || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`badge ${s.approval_status === 'approved' ? 'badge-green' : s.approval_status === 'rejected' ? 'badge-red' : 'badge-orange'}`}>
                    {s.approval_status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}><StreakFlame streakCount={s.streak_count || 0} studiedToday={true} size={15} /></td>
                <td className="mono text-sm" style={{ padding: '12px 16px', color: 'var(--flame)' }}>{s.xp || 0}</td>
                <td style={{ padding: '12px 16px' }}>{s.quiz_avg != null ? <span className={`badge ${s.quiz_avg >= 70 ? 'badge-green' : 'badge-orange'}`}>{s.quiz_avg}%</span> : <span className="text-dim text-sm">—</span>}</td>
                <td className="text-sm" style={{ padding: '12px 16px' }}>{s.assignments_done}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-dim text-sm" style={{ padding: 30, textAlign: 'center' }}>No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {viewingId && <StudentProfileModal studentId={viewingId} onClose={() => setViewingId(null)} />}
      {confirmReject && (
        <ConfirmDialog
          title="Reject this registration?"
          message="The student will not be able to sign in unless approved later."
          confirmLabel="Reject"
          onConfirm={doReject}
          onCancel={() => setConfirmReject(null)}
        />
      )}

      <style>{`.student-row:hover{ background: var(--surface-2); }`}</style>
    </AppLayout>
  );
}
