import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CheckCheck, Download, Save } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const STATUSES = [
  { key: 'present', label: 'P', name: 'Present', color: '#00B894' },
  { key: 'absent', label: 'A', name: 'Absent', color: '#D63031' },
  { key: 'late', label: 'L', name: 'Late', color: '#E17055' },
  { key: 'excused', label: 'E', name: 'Excused', color: '#0984E3' },
  { key: 'half_day', label: 'HD', name: 'Half day', color: '#6C5CE7' },
];

const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });

function Filters({ classLevel, setClassLevel, section, setSection, subjectId, setSubjectId, classes, sections, subjects, children }) {
  const sel = { minWidth: 140 };
  return (
    <div className="card card-pad flex gap-3" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
      <label className="text-sm" style={sel}>Class
        <select className="input" value={classLevel} onChange={e => { setClassLevel(e.target.value); setSection(''); setSubjectId(''); }}>
          <option value="">Choose class…</option>
          {classes.map(c => <option key={c} value={c}>Class {c}</option>)}
        </select>
      </label>
      <label className="text-sm" style={sel}>Section
        <select className="input" value={section} disabled={!classLevel} onChange={e => setSection(e.target.value)}>
          <option value="">All sections</option>
          {sections.map(s => <option key={s.id} value={s.name}>Section {s.name}</option>)}
        </select>
      </label>
      <label className="text-sm" style={{ ...sel, minWidth: 200 }}>Register
        <select className="input" value={subjectId} disabled={!classLevel} onChange={e => setSubjectId(e.target.value)}>
          <option value="">Daily (homeroom)</option>
          {subjects.map(s => <option key={s.id} value={s.id}>Subject: {s.name}</option>)}
        </select>
      </label>
      {children}
    </div>
  );
}

function RegisterTab({ classes, subjectsFor }) {
  const toast = useToast();
  const [classLevel, setClassLevel] = useState('');
  const [section, setSection] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [roster, setRoster] = useState(null);
  const [marks, setMarks] = useState({});  // student_id -> { status, remarks }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classLevel) { setSections([]); setSubjects([]); return; }
    api.get(`/settings/sections?class_level=${classLevel}`).then(({ data }) => setSections(data.sections)).catch(() => {});
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => setSubjects(subjectsFor(classLevel, data.subjects))).catch(() => {});
  }, [classLevel, subjectsFor]);

  useEffect(() => {
    if (!classLevel) { setRoster(null); return; }
    api.get('/attendance/roster', { params: { class_level: classLevel, section: section || undefined, subject_id: subjectId || undefined, date } })
      .then(({ data }) => {
        setRoster(data);
        setMarks(Object.fromEntries(data.students.map(s => [s.id, { status: s.status, remarks: s.remarks || '' }])));
      })
      .catch(err => { setRoster(null); toast.error(err.response?.data?.error || 'Could not load the register'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLevel, section, subjectId, date]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map(s => [s.key, 0]));
    let unmarked = 0;
    Object.values(marks).forEach(m => { if (m.status) c[m.status]++; else unmarked++; });
    return { ...c, unmarked };
  }, [marks]);

  const setStatus = (id, status) => setMarks(m => ({ ...m, [id]: { ...m[id], status } }));
  const setRemarks = (id, remarks) => setMarks(m => ({ ...m, [id]: { ...m[id], remarks } }));
  const markAllPresent = () => setMarks(m => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, { ...v, status: v.status || 'present' }])));

  const save = async () => {
    const records = Object.entries(marks).filter(([, v]) => v.status).map(([id, v]) => ({ student_id: Number(id), status: v.status, remarks: v.remarks }));
    if (records.length === 0) return toast.error('Mark at least one student first');
    setSaving(true);
    try {
      const { data } = await api.post('/attendance', { class_level: Number(classLevel), section: section || null, subject_id: subjectId ? Number(subjectId) : null, date, records });
      toast.success(`Saved: ${data.created} new, ${data.updated} updated`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save attendance');
    } finally { setSaving(false); }
  };

  if (!roster) return (
    <>
      <Filters classLevel={classLevel} setClassLevel={setClassLevel} section={section} setSection={setSection} subjectId={subjectId} setSubjectId={setSubjectId} classes={classes} sections={sections} subjects={subjects}>
        <label className="text-sm" style={{ minWidth: 160 }}>Date
          <input className="input" type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
        </label>
      </Filters>
      <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 40 }}>Choose a class to open its register.</div>
    </>
  );

  return (
    <>
      <Filters classLevel={classLevel} setClassLevel={setClassLevel} section={section} setSection={setSection} subjectId={subjectId} setSubjectId={setSubjectId} classes={classes} sections={sections} subjects={subjects}>
        <label className="text-sm" style={{ minWidth: 160 }}>Date
          <input className="input" type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
        </label>
      </Filters>

      <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {STATUSES.map(s => (
          <span key={s.key} className="badge" style={{ background: `${s.color}22`, color: s.color, fontWeight: 700 }}>
            {s.name}: {counts[s.key]}
          </span>
        ))}
        <span className="badge badge-gray">Unmarked: {counts.unmarked}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={markAllPresent} disabled={roster.students.length === 0}><CheckCheck size={15} /> Mark unmarked as present</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || roster.students.length === 0}><Save size={15} /> {saving ? 'Saving…' : 'Save register'}</button>
      </div>

      {roster.edit_window_days && (
        <div className="text-sm text-dim" style={{ marginBottom: 12 }}>
          Registers older than {roster.edit_window_days} days are locked for your role. Ask an Academic Head or Admin for corrections.
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {roster.students.length === 0 ? (
          <div className="text-dim" style={{ padding: 32, textAlign: 'center' }}>No active students in this class yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                <th style={{ padding: '12px 14px' }}>Student</th>
                <th style={{ padding: '12px 14px' }}>Status</th>
                <th style={{ padding: '12px 14px' }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {roster.students.map(s => {
                const cur = marks[s.id]?.status;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border, #eef0f3)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div className="text-xs text-dim">Section {s.section}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div className="flex gap-1" role="radiogroup" aria-label={`Status for ${s.name}`}>
                        {STATUSES.map(st => {
                          const on = cur === st.key;
                          return (
                            <button key={st.key} type="button" role="radio" aria-checked={on} title={st.name}
                              onClick={() => setStatus(s.id, st.key)}
                              style={{
                                minWidth: 40, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12.5,
                                border: `1.5px solid ${st.color}`, background: on ? st.color : 'transparent', color: on ? '#fff' : st.color,
                              }}>{st.label}</button>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {['absent', 'late', 'excused'].includes(cur) && (
                        <input className="input" style={{ padding: '6px 10px', fontSize: 13 }} placeholder="Reason (optional)"
                          value={marks[s.id]?.remarks || ''} onChange={e => setRemarks(s.id, e.target.value)} maxLength={300} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ReportsTab({ classes, subjectsFor }) {
  const toast = useToast();
  const [classLevel, setClassLevel] = useState('');
  const [section, setSection] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!classLevel) { setSections([]); setSubjects([]); return; }
    api.get(`/settings/sections?class_level=${classLevel}`).then(({ data }) => setSections(data.sections)).catch(() => {});
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => setSubjects(subjectsFor(classLevel, data.subjects))).catch(() => {});
  }, [classLevel, subjectsFor]);

  const params = { class_level: classLevel, section: section || undefined, subject_id: subjectId || undefined, from: from || undefined, to: to || undefined };

  useEffect(() => {
    if (!classLevel) { setReport(null); return; }
    api.get('/attendance/summary', { params }).then(({ data }) => setReport(data))
      .catch(err => { setReport(null); toast.error(err.response?.data?.error || 'Could not load report'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLevel, section, subjectId, from, to]);

  const exportCsv = async () => {
    try {
      const { data } = await api.get('/attendance/summary', { params: { ...params, format: 'csv' }, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `attendance-class-${classLevel}${section || ''}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  return (
    <>
      <Filters classLevel={classLevel} setClassLevel={setClassLevel} section={section} setSection={setSection} subjectId={subjectId} setSubjectId={setSubjectId} classes={classes} sections={sections} subjects={subjects}>
        <label className="text-sm" style={{ minWidth: 150 }}>From<input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm" style={{ minWidth: 150 }}>To<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!report} style={{ marginBottom: 2 }}><Download size={15} /> Export CSV</button>
      </Filters>

      {!report ? (
        <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 40 }}>Choose a class to see its attendance report. Leave dates empty to use the active academic session.</div>
      ) : (
        <>
          <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="card card-pad" style={{ minWidth: 180 }}>
              <div className="text-xs text-dim">Class average</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{report.class_average_pct ?? '—'}{report.class_average_pct != null && '%'}</div>
            </div>
            <div className="card card-pad" style={{ minWidth: 180 }}>
              <div className="text-xs text-dim">Below 75% (at risk)</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: report.at_risk_count ? '#D63031' : 'inherit' }}>{report.at_risk_count}</div>
            </div>
            <div className="card card-pad" style={{ minWidth: 180 }}>
              <div className="text-xs text-dim">Period</div>
              <div className="text-sm" style={{ fontWeight: 600 }}>{report.from} → {report.to}</div>
              <div className="text-xs text-dim">{report.register === 'subject' ? 'Subject register' : 'Daily register'}</div>
            </div>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                  <th style={{ padding: '12px 14px' }}>Student</th>
                  <th style={{ padding: '12px 14px' }}>Days</th>
                  <th style={{ padding: '12px 14px' }}>Present</th>
                  <th style={{ padding: '12px 14px' }}>Absent</th>
                  <th style={{ padding: '12px 14px' }}>Late</th>
                  <th style={{ padding: '12px 14px' }}>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {report.students.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border, #eef0f3)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.name}<div className="text-xs text-dim">Section {s.section}</div></td>
                    <td style={{ padding: '10px 14px' }}>{s.total}</td>
                    <td style={{ padding: '10px 14px' }}>{s.present}</td>
                    <td style={{ padding: '10px 14px' }}>{s.absent}</td>
                    <td style={{ padding: '10px 14px' }}>{s.late}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {s.attendance_pct == null ? <span className="text-dim">No records</span> : (
                        <span className="badge" style={{ background: s.attendance_pct < 75 ? '#D6303122' : '#00B89422', color: s.attendance_pct < 75 ? '#D63031' : '#00B894', fontWeight: 700 }}>
                          {s.attendance_pct}%{s.attendance_pct < 75 ? ' · at risk' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function AdminAttendance() {
  const { hasPermission, allowedClasses, scope, loading } = usePermissions();
  const canMark = hasPermission('attendance.mark');
  const canView = hasPermission('attendance.view');
  const [tab, setTab] = useState(null);
  const activeTab = tab || (canMark ? 'register' : 'reports');
  const classes = allowedClasses;
  // Only offer subjects this teacher actually teaches (admins/unrestricted see all).
  const subjectsFor = useCallback((cls, subs) => {
    if (!subs) return [];
    if (!scope || scope.unrestricted) return subs;
    const c = Number(cls);
    if (scope.classSections?.some(cs => cs.class_level === c)) return subs;
    return subs.filter(s => scope.subjectAssignments?.some(a => a.class_level === c && a.subject_id === s.id));
  }, [scope]);

  if (loading) return <AppLayout title="Attendance"><div className="text-dim">Loading…</div></AppLayout>;

  return (
    <AppLayout title="Attendance" subtitle="Take the daily register, mark subject periods, and review attendance">
      <div className="flex gap-2" style={{ marginBottom: 16 }}>
        {canMark && <button className={`btn btn-sm ${activeTab === 'register' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('register')}><CalendarCheck size={15} /> Take register</button>}
        {canView && <button className={`btn btn-sm ${activeTab === 'reports' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('reports')}>Reports</button>}
      </div>
      {activeTab === 'register' && canMark && <RegisterTab classes={classes} subjectsFor={subjectsFor} />}
      {activeTab === 'reports' && canView && <ReportsTab classes={classes} subjectsFor={subjectsFor} />}
    </AppLayout>
  );
}
