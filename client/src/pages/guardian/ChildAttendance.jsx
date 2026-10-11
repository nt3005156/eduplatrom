import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client.js';
import GuardianLayout from './GuardianLayout.jsx';

const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', half_day: 'Half day' };
const STATUS_BADGE = { present: 'badge-green', absent: 'badge-red', late: 'badge-orange', excused: 'badge-blue', half_day: 'badge-purple' };

const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function ChildAttendance() {
  const { studentId } = useParams();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [data, setData] = useState(null);
  const [child, setChild] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/guardian/children/${studentId}`).then(({ data }) => setChild(data.child)).catch(err => setError(err.response?.data?.error || 'Could not open this child.'));
  }, [studentId]);

  useEffect(() => {
    setError('');
    api.get(`/guardian/children/${studentId}/attendance`, { params: { from, to } })
      .then(({ data }) => setData(data))
      .catch(err => { setData(null); setError(err.response?.data?.error || 'Could not load attendance.'); });
  }, [studentId, from, to]);

  const d = data?.daily;
  const byDate = {};
  (data?.records || []).forEach(r => { (byDate[r.date] ||= []).push(r); });

  return (
    <GuardianLayout title={child ? child.name : 'Attendance'} back="/guardian">
      {error && <p role="alert" className="card card-pad" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="card card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><label htmlFor="from">From</label>
          <input id="from" className="input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><label htmlFor="to">To</label>
          <input id="to" className="input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      </div>

      {d && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="text-dim text-sm">Daily attendance</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{d.attendance_pct != null ? `${d.attendance_pct}%` : '—'}</div>
            <div className="text-dim text-sm">{d.total} school day(s) recorded</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 12 }}>
              {Object.keys(STATUS_LABEL).map(k => (
                <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                  <div className="text-dim" style={{ fontSize: 12 }}>{STATUS_LABEL[k]}</div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>{d[k]}</div>
                </div>
              ))}
            </div>
          </div>

          {data.subjects.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <h4 style={{ marginBottom: 8 }}>By subject</h4>
              {data.subjects.map(s => (
                <div key={s.subject_id} className="flex justify-between items-center" style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                  <span>{s.subject_name}</span>
                  <span className="text-dim text-sm">{s.attendance_pct != null ? `${s.attendance_pct}%` : '—'} · {s.total} class(es)</span>
                </div>
              ))}
            </div>
          )}

          <div className="card card-pad">
            <h4 style={{ marginBottom: 8 }}>Day by day</h4>
            {Object.keys(byDate).length === 0 && <p className="text-dim text-sm">No attendance recorded in this period.</p>}
            {Object.keys(byDate).sort().reverse().map(date => (
              <div key={date} style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {byDate[date].map(r => (
                    <span key={r.id} className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>
                      {r.subject_name ? `${r.subject_name}: ` : ''}{STATUS_LABEL[r.status] || r.status}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </GuardianLayout>
  );
}
