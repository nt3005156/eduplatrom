import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/client.js';
import { formatCalendarDate } from '../../i18n/format.js';
import GuardianLayout from './GuardianLayout.jsx';

// Badge colours are fixed per status. Labels are looked up at render time so they follow the language switch.
const STATUS_BADGE = { present: 'badge-green', absent: 'badge-red', late: 'badge-orange', excused: 'badge-blue', half_day: 'badge-purple' };

const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function ChildAttendance() {
  const { t } = useTranslation('guardian');
  const { studentId } = useParams();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [data, setData] = useState(null);
  const [child, setChild] = useState(null);
  const [error, setError] = useState(null); // { text: server message, key: fallback translation key }

  const statusLabel = {
    present: t('attendance.status.present'),
    absent: t('attendance.status.absent'),
    late: t('attendance.status.late'),
    excused: t('attendance.status.excused'),
    half_day: t('attendance.status.half_day'),
  };

  useEffect(() => {
    api.get(`/guardian/children/${studentId}`)
      .then(({ data }) => setChild(data.child))
      .catch(err => setError({ text: err.response?.data?.error, key: 'attendance.openFailed' }));
  }, [studentId]);

  useEffect(() => {
    setError(null);
    api.get(`/guardian/children/${studentId}/attendance`, { params: { from, to } })
      .then(({ data }) => setData(data))
      .catch(err => { setData(null); setError({ text: err.response?.data?.error, key: 'attendance.loadFailed' }); });
  }, [studentId, from, to]);

  const d = data?.daily;
  const byDate = {};
  (data?.records || []).forEach(r => { (byDate[r.date] ||= []).push(r); });

  return (
    <GuardianLayout title={child ? child.name : t('attendance.title')} back="/guardian">
      {error && <p role="alert" className="card card-pad" style={{ color: 'var(--danger)' }}>{error.text || t(error.key)}</p>}

      <div className="card card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><label htmlFor="from">{t('attendance.from')}</label>
          <input id="from" className="input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><label htmlFor="to">{t('attendance.to')}</label>
          <input id="to" className="input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      </div>

      {d && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="text-dim text-sm">{t('attendance.daily')}</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{d.attendance_pct != null ? `${d.attendance_pct}%` : '—'}</div>
            <div className="text-dim text-sm">{t('attendance.schoolDays', { count: d.total })}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 12 }}>
              {Object.keys(statusLabel).map(k => (
                <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                  <div className="text-dim" style={{ fontSize: 12 }}>{statusLabel[k]}</div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>{d[k]}</div>
                </div>
              ))}
            </div>
          </div>

          {data.subjects.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <h4 style={{ marginBottom: 8 }}>{t('attendance.bySubject')}</h4>
              {data.subjects.map(s => (
                <div key={s.subject_id} className="flex justify-between items-center" style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                  <span>{s.subject_name}</span>
                  <span className="text-dim text-sm">{s.attendance_pct != null ? `${s.attendance_pct}%` : '—'} · {t('attendance.classes', { count: s.total })}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card card-pad">
            <h4 style={{ marginBottom: 8 }}>{t('attendance.dayByDay')}</h4>
            {Object.keys(byDate).length === 0 && <p className="text-dim text-sm">{t('attendance.noRecords')}</p>}
            {Object.keys(byDate).sort().reverse().map(date => (
              <div key={date} style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{formatCalendarDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {byDate[date].map(r => (
                    <span key={r.id} className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>
                      {r.subject_name ? `${r.subject_name}: ` : ''}{statusLabel[r.status] || r.status}
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
