import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CalendarCheck, Megaphone, Lock, UserRound } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import GuardianLayout from './GuardianLayout.jsx';
import FeeAlerts from './FeeAlerts.jsx';

function pctColor(p) {
  if (p === null || p === undefined) return 'var(--text-faint)';
  if (p >= 90) return 'var(--accent)';
  if (p >= 75) return 'var(--warning)';
  return 'var(--danger)';
}

export default function GuardianHome() {
  const { user } = useAuth();
  const [children, setChildren] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/guardian/children')
      .then(({ data }) => setChildren(data.children))
      .catch(err => setError(err.response?.data?.error || 'Could not load your children.'));
    api.get('/guardian/announcements')
      .then(({ data }) => setAnnouncements(data.announcements))
      .catch(() => setAnnouncements([]));
  }, []);

  return (
    <GuardianLayout title={`Hello, ${user?.name?.split(' ')[0] || 'there'}`}>
      <FeeAlerts />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px' }}>
        <h4>Your children</h4>
        <Link to="/guardian/profile" className="btn btn-ghost btn-sm"><UserRound size={14} /> My profile</Link>
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {children === null && !error && <p className="text-dim">Loading...</p>}
      {children?.length === 0 && (
        <div className="card card-pad"><p className="text-dim">No children are linked to your account yet. Please contact the school office.</p></div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {(children || []).map(c => (
          <div key={c.student_id} className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
              <div className="text-dim text-sm">Class {c.class_level} · Section {c.section}{c.roll_no ? ` · Roll ${c.roll_no}` : ''}</div>
            </div>
            {c.can_view_attendance ? (
              <div style={{ textAlign: 'right' }}>
                <div className="text-dim" style={{ fontSize: 11.5 }}>Last 30 days</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: pctColor(c.attendance_last_30_days?.attendance_pct) }}>
                  {c.attendance_last_30_days?.attendance_pct != null ? `${c.attendance_last_30_days.attendance_pct}%` : '—'}
                </div>
              </div>
            ) : (
              <span className="badge badge-gray"><Lock size={12} /> Hidden</span>
            )}
            {c.can_view_attendance && (
              <Link to={`/guardian/children/${c.student_id}`} className="btn btn-outline btn-sm" aria-label={`Open attendance for ${c.name}`}>
                <CalendarCheck size={14} /> Attendance <ChevronRight size={14} />
              </Link>
            )}
          </div>
        ))}
      </div>

      <h4 style={{ margin: '26px 0 10px' }}><Megaphone size={16} style={{ verticalAlign: '-3px' }} /> School announcements</h4>
      {announcements.length === 0 ? (
        <div className="card card-pad"><p className="text-dim text-sm">No announcements yet.</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {announcements.map(a => (
            <div key={a.id} className="card card-pad">
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              {a.body && <p className="text-dim text-sm" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</p>}
              <div className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>{new Date(a.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu' })}</div>
            </div>
          ))}
        </div>
      )}
    </GuardianLayout>
  );
}
