import { useEffect, useState } from 'react';
import { CalendarCheck, AlertTriangle } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';

const LABELS = {
  present: { name: 'Present', color: '#00B894' },
  absent: { name: 'Absent', color: '#D63031' },
  late: { name: 'Late', color: '#E17055' },
  excused: { name: 'Excused', color: '#0984E3' },
  half_day: { name: 'Half day', color: '#6C5CE7' },
};

function Bar({ pct }) {
  const v = pct ?? 0;
  const color = pct == null ? '#b2bec3' : pct < 75 ? '#D63031' : '#00B894';
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'var(--border, #eef0f3)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, v)}%`, height: '100%', background: color, transition: 'width .4s' }} />
    </div>
  );
}

export default function StudentAttendance() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/attendance/me').then(({ data }) => setData(data)).catch(err => setError(err.response?.data?.error || 'Could not load attendance'));
  }, []);

  return (
    <AppLayout title="My Attendance" subtitle="Your daily and subject attendance this academic session">
      {error && <div className="card card-pad" style={{ color: '#D63031' }}>{error}</div>}
      {!data && !error && <div className="text-dim">Loading…</div>}
      {data && (
        <>
          {data.below_threshold && (
            <div className="card card-pad flex gap-2" style={{ alignItems: 'center', borderLeft: '4px solid #D63031', marginBottom: 16 }}>
              <AlertTriangle size={18} color="#D63031" />
              <div className="text-sm"><b>Your attendance is below 75%.</b> Please speak to your class teacher to avoid losing exam eligibility.</div>
            </div>
          )}

          <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="card card-pad" style={{ minWidth: 220, flex: '1 1 220px' }}>
              <div className="text-xs text-dim flex gap-1" style={{ alignItems: 'center' }}><CalendarCheck size={14} /> Overall (daily register)</div>
              <div style={{ fontSize: 34, fontWeight: 800, margin: '6px 0' }}>{data.daily.attendance_pct ?? '—'}{data.daily.attendance_pct != null && '%'}</div>
              <Bar pct={data.daily.attendance_pct} />
              <div className="text-xs text-dim" style={{ marginTop: 8 }}>{data.daily.total} school days marked · {data.from} to {data.to}</div>
            </div>
            <div className="card card-pad" style={{ flex: '2 1 320px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
              {Object.entries(LABELS).map(([k, l]) => (
                <div key={k} style={{ borderRadius: 10, padding: 12, background: `${l.color}18` }}>
                  <div className="text-xs" style={{ color: l.color, fontWeight: 700 }}>{l.name}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: l.color }}>{data.daily[k]}</div>
                </div>
              ))}
            </div>
          </div>

          {data.subjects.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>By subject</div>
              <div className="flex-col gap-3">
                {data.subjects.map(s => (
                  <div key={s.subject_id}>
                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{s.subject_name}</span>
                      <span className="text-sm">{s.attendance_pct ?? '—'}{s.attendance_pct != null && '%'} <span className="text-dim">({s.total} classes)</span></span>
                    </div>
                    <Bar pct={s.attendance_pct} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, padding: '14px 16px', borderBottom: '1px solid var(--border, #eef0f3)' }}>History</div>
            {data.records.length === 0 ? (
              <div className="text-dim" style={{ padding: 28, textAlign: 'center' }}>No attendance has been recorded yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  {data.records.slice(0, 120).map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border, #eef0f3)' }}>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{r.date}</td>
                      <td style={{ padding: '10px 16px' }}>{r.subject_name || 'Daily register'}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="badge" style={{ background: `${LABELS[r.status].color}22`, color: LABELS[r.status].color, fontWeight: 700 }}>{LABELS[r.status].name}</span>
                      </td>
                      <td style={{ padding: '10px 16px' }} className="text-dim">{r.remarks || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppLayout>
  );
}
