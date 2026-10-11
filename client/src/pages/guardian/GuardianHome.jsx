import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, CalendarCheck, Megaphone, Lock, UserRound } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatSchoolDate } from '../../i18n/format.js';
import GuardianLayout from './GuardianLayout.jsx';
import FeeAlerts from './FeeAlerts.jsx';

function pctColor(p) {
  if (p === null || p === undefined) return 'var(--text-faint)';
  if (p >= 90) return 'var(--accent)';
  if (p >= 75) return 'var(--warning)';
  return 'var(--danger)';
}

export default function GuardianHome() {
  const { t } = useTranslation('guardian');
  const { user } = useAuth();
  const [children, setChildren] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [error, setError] = useState(null); // { text: server message, key: fallback translation key }

  useEffect(() => {
    api.get('/guardian/children')
      .then(({ data }) => setChildren(data.children))
      .catch(err => setError({ text: err.response?.data?.error, key: 'home.loadError' }));
    api.get('/guardian/announcements')
      .then(({ data }) => setAnnouncements(data.announcements))
      .catch(() => setAnnouncements([]));
  }, []);

  const firstName = user?.name?.split(' ')[0] || t('home.there');

  return (
    <GuardianLayout title={t('home.hello', { name: firstName })}>
      <FeeAlerts />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px' }}>
        <h4>{t('home.yourChildren')}</h4>
        <Link to="/guardian/profile" className="btn btn-ghost btn-sm"><UserRound size={14} /> {t('home.myProfile')}</Link>
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error.text || t(error.key)}</p>}
      {children === null && !error && <p className="text-dim">{t('home.loading')}</p>}
      {children?.length === 0 && (
        <div className="card card-pad"><p className="text-dim">{t('home.noChildren')}</p></div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {(children || []).map(c => {
          const classLine = c.roll_no
            ? t('home.classSectionRoll', { classLevel: c.class_level, section: c.section, roll: c.roll_no })
            : t('home.classSection', { classLevel: c.class_level, section: c.section });
          return (
            <div key={c.student_id} className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
                <div className="text-dim text-sm">{classLine}</div>
              </div>
              {c.can_view_attendance ? (
                <div style={{ textAlign: 'right' }}>
                  <div className="text-dim" style={{ fontSize: 11.5 }}>{t('home.last30')}</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: pctColor(c.attendance_last_30_days?.attendance_pct) }}>
                    {c.attendance_last_30_days?.attendance_pct != null ? `${c.attendance_last_30_days.attendance_pct}%` : '—'}
                  </div>
                </div>
              ) : (
                <span className="badge badge-gray"><Lock size={12} /> {t('home.hidden')}</span>
              )}
              {c.can_view_attendance && (
                <Link to={`/guardian/children/${c.student_id}`} className="btn btn-outline btn-sm" aria-label={t('home.openAttendance', { name: c.name })}>
                  <CalendarCheck size={14} /> {t('home.attendance')} <ChevronRight size={14} />
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <h4 style={{ margin: '26px 0 10px' }}><Megaphone size={16} style={{ verticalAlign: '-3px' }} /> {t('home.announcements')}</h4>
      {announcements.length === 0 ? (
        <div className="card card-pad"><p className="text-dim text-sm">{t('home.noAnnouncements')}</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {announcements.map(a => (
            <div key={a.id} className="card card-pad">
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              {a.body && <p className="text-dim text-sm" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</p>}
              <div className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>{formatSchoolDate(a.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </GuardianLayout>
  );
}
