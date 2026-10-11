import { useEffect, useState } from 'react';
import { Users, BookOpen, ClipboardList, PenSquare, AlertCircle, Trophy, ChevronDown, FileText, Video, LinkIcon, Clock, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { Skeleton, SkeletonRow } from '../../components/Skeleton.jsx';

const TYPE_ICON = { pdf: FileText, note: FileText, doc: FileText, video: Video, slide: FileText, link: LinkIcon };

function StatCard({ icon: Icon, label, value, color, expanded, onToggle, loading, children, hasDetail = true }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 180, overflow: 'hidden' }}>
      <button
        onClick={hasDetail ? onToggle : undefined}
        style={{
          width: '100%', background: 'transparent', border: 'none', padding: 22, textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        <div>
          <div className="text-dim text-sm" style={{ marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{value}</div>
        </div>
        <div className="flex items-center gap-1">
          <div style={{ width: 40, height: 40, borderRadius: 11, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={19} color={color} />
          </div>
          {hasDetail && (
            <ChevronDown size={16} color="var(--text-dim)" style={{ transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
          )}
        </div>
      </button>
      {expanded && (
        <div className="fade-in" style={{ borderTop: '1px solid var(--border)', padding: '14px 18px 18px', maxHeight: 320, overflowY: 'auto' }}>
          {loading ? <div className="flex-col gap-2"><Skeleton height={36} /><Skeleton height={36} /><Skeleton height={36} /></div> : children}
        </div>
      )}
    </div>
  );
}

function EmptyRow({ text }) {
  return <div className="text-dim text-sm" style={{ padding: '10px 0', textAlign: 'center' }}>{text}</div>;
}

export default function AdminOverview() {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { api.get('/dashboard/admin').then(({ data }) => setData(data)); }, []);

  const toggle = (key, endpoint) => {
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!details[key]) {
      setDetailLoading(true);
      api.get(endpoint).then(({ data }) => {
        setDetails(d => ({ ...d, [key]: data }));
        setDetailLoading(false);
      }).catch(() => setDetailLoading(false));
    }
  };

  if (!data) return (
    <AppLayout title="Admin Overview" subtitle="Loading platform activity...">
      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card card-pad" style={{ flex: 1, minWidth: 180 }}>
            <Skeleton width="60%" height={13} style={{ marginBottom: 10 }} />
            <Skeleton width="40%" height={24} />
          </div>
        ))}
      </div>
      <div className="flex-col gap-2"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
    </AppLayout>
  );

  const chartData = data.studentsByClass.map(s => ({ class: `Class ${s.class_level}`, students: s.c }));

  return (
    <AppLayout title="Admin Overview" subtitle="Monitor platform activity and student engagement — click any card to view details instantly">
      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 24, alignItems: 'flex-start' }}>
        <StatCard
          icon={Users} label="Total Students" value={data.totalStudents} color="var(--primary)"
          expanded={expanded === 'students'} onToggle={() => toggle('students', '/dashboard/admin/students')}
          loading={detailLoading && expanded === 'students'}
        >
          {details.students?.students.length ? (
            <div className="flex-col gap-2">
              {details.students.students.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                    <div className="text-xs text-dim">Class {s.class_level} • {s.email}</div>
                  </div>
                  {s.quiz_avg != null && <span className="badge badge-green" style={{ flexShrink: 0 }}>{s.quiz_avg}%</span>}
                </div>
              ))}
            </div>
          ) : <EmptyRow text="No students registered yet." />}
        </StatCard>

        <StatCard
          icon={BookOpen} label="Study Materials" value={data.totalMaterials} color="#0984e3"
          expanded={expanded === 'materials'} onToggle={() => toggle('materials', '/dashboard/admin/details/materials')}
          loading={detailLoading && expanded === 'materials'}
        >
          {details.materials?.materials.length ? (
            <div className="flex-col gap-2">
              {details.materials.materials.map(m => {
                const Icon = TYPE_ICON[m.type] || FileText;
                return (
                  <div key={m.id} className="flex items-center gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                    <Icon size={14} color={m.subject_color} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                      <div className="text-xs text-dim">{m.subject_name} • Class {m.class_level}</div>
                    </div>
                    <span className="badge badge-gray" style={{ flexShrink: 0 }}>{m.type}</span>
                  </div>
                );
              })}
            </div>
          ) : <EmptyRow text="No materials uploaded yet." />}
        </StatCard>

        <StatCard
          icon={ClipboardList} label="Assignments" value={data.totalAssignments} color="var(--accent)"
          expanded={expanded === 'assignments'} onToggle={() => toggle('assignments', '/dashboard/admin/details/assignments')}
          loading={detailLoading && expanded === 'assignments'}
        >
          {details.assignments?.assignments.length ? (
            <div className="flex-col gap-2">
              {details.assignments.assignments.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                    <div className="text-xs text-dim">{a.subject_name} • Class {a.class_level}</div>
                  </div>
                  <span className="badge badge-purple" style={{ flexShrink: 0 }}>{a.submission_count} sub.</span>
                </div>
              ))}
            </div>
          ) : <EmptyRow text="No assignments created yet." />}
        </StatCard>

        <StatCard
          icon={PenSquare} label="Quizzes" value={data.totalQuizzes} color="#f0932b"
          expanded={expanded === 'quizzes'} onToggle={() => toggle('quizzes', '/dashboard/admin/details/quizzes')}
          loading={detailLoading && expanded === 'quizzes'}
        >
          {details.quizzes?.quizzes.length ? (
            <div className="flex-col gap-2">
              {details.quizzes.quizzes.map(q => (
                <div key={q.id} className="flex items-center justify-between gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</div>
                    <div className="text-xs text-dim">{q.subject_name} • Class {q.class_level} • {q.question_count} Qs</div>
                  </div>
                  <span className="badge badge-orange" style={{ flexShrink: 0 }}>{q.attempt_count} attempts</span>
                </div>
              ))}
            </div>
          ) : <EmptyRow text="No quizzes created yet." />}
        </StatCard>

        <StatCard
          icon={AlertCircle} label="Pending Grading" value={data.pendingGrading} color="var(--danger)"
          expanded={expanded === 'pending'} onToggle={() => toggle('pending', '/dashboard/admin/details/pending-grading')}
          loading={detailLoading && expanded === 'pending'}
        >
          {details.pending?.submissions.length ? (
            <div className="flex-col gap-2">
              {details.pending.submissions.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.student_name} → {s.assignment_title}</div>
                    <div className="text-xs text-dim">Class {s.class_level}</div>
                  </div>
                  <span className={`badge ${s.status === 'late' ? 'badge-orange' : 'badge-purple'}`} style={{ flexShrink: 0 }}>{s.status}</span>
                </div>
              ))}
            </div>
          ) : <EmptyRow text="Nothing pending — all caught up! 🎉" />}
        </StatCard>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 17, marginBottom: 16 }}>Students by Class</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="class" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="students" fill="var(--brand-primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
            <Trophy size={17} color="var(--primary)" />
            <h3 style={{ fontSize: 17 }}>Top Performers</h3>
          </div>
          <div className="flex-col gap-2">
            {data.topPerformers.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontWeight: 800, color: 'var(--primary)' }}>#{i + 1}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div className="text-xs text-dim">Class {p.class_level}</div>
                  </div>
                </div>
                <span className="badge badge-green">{Math.round(p.avg_score)}%</span>
              </div>
            ))}
            {data.topPerformers.length === 0 && <div className="text-dim text-sm">No quiz data yet.</div>}
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 17, marginBottom: 14 }}>Recent Submissions</h3>
        <div className="flex-col gap-2">
          {data.recentSubmissions.map(s => (
            <div key={s.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.student_name} → {s.assignment_title}</div>
                <div className="text-xs text-dim">Class {s.class_level} • {new Date(s.submitted_at).toLocaleString()}</div>
              </div>
              <span className={`badge ${s.status === 'graded' ? 'badge-green' : s.status === 'late' ? 'badge-orange' : 'badge-purple'}`}>{s.status}</span>
            </div>
          ))}
          {data.recentSubmissions.length === 0 && <div className="text-dim text-sm">No submissions yet.</div>}
        </div>
      </div>

      <style>{`@media (max-width: 980px){ .page-container .grid[style]{ grid-template-columns: 1fr !important; } }`}</style>
    </AppLayout>
  );
}
