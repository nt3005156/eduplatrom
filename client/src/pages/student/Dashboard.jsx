import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ClipboardCheck, Award, TrendingUp, Clock, Sparkles, ArrowRight, FileText, Video, LinkIcon } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import AdSlot from '../../components/AdSlot.jsx';
import { Skeleton, SkeletonCard, SkeletonRow } from '../../components/Skeleton.jsx';
import XpBar from '../../components/XpBar.jsx';
import StreakFlame from '../../components/StreakFlame.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const TYPE_ICON = { pdf: FileText, note: FileText, doc: FileText, video: Video, slide: FileText, link: LinkIcon };

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="card card-pad" style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="text-dim text-sm" style={{ marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{value}</div>
          {sub && <div className="text-xs text-dim" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={color} />
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/dashboard/student').then(({ data }) => setData(data)); }, []);

  if (!data) return (
    <AppLayout title="Dashboard" subtitle="Loading your learning snapshot...">
      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card card-pad" style={{ flex: 1, minWidth: 200 }}>
            <Skeleton width="60%" height={13} style={{ marginBottom: 10 }} />
            <Skeleton width="40%" height={26} />
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <div className="flex-col gap-3">
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </div>
        <SkeletonCard />
      </div>
    </AppLayout>
  );

  return (
    <AppLayout title={`Welcome back, ${user.name.split(' ')[0]}`} subtitle={`Class ${data.class_level} • Here's your learning snapshot`}>
      <div className="card card-pad" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <XpBar level={user?.level} xp={user?.xp || 0} />
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} className="streak-divider" />
        <div className="flex-col gap-1" style={{ minWidth: 140 }}>
          <span className="text-xs text-dim" style={{ fontWeight: 700, letterSpacing: '.03em' }}>STUDY STREAK</span>
          <div className="flex items-center gap-2">
            <StreakFlame
              streakCount={user?.streak_count || 0}
              studiedToday={user?.streak?.studiedToday}
              atRisk={user?.streak?.atRisk}
              size={26}
              showCount={false}
            />
            <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: user?.streak?.studiedToday ? 'var(--flame)' : 'var(--text-faint)' }}>
              {user?.streak_count || 0}
            </span>
            <span className="text-sm text-dim">day{(user?.streak_count || 0) === 1 ? '' : 's'}</span>
          </div>
          <span className="text-xs text-dim">
            {user?.streak?.studiedToday ? 'Studied today — keep it going!' : user?.streak?.atRisk ? 'Study something today to keep your streak alive!' : 'Complete an activity today to build your streak'}
          </span>
        </div>
      </div>

      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard icon={BookOpen} label="Materials Explored" value={`${data.materials.viewed}/${data.materials.total}`} sub={`${data.materials.pct}% coverage`} color="var(--primary)" />
        <StatCard icon={ClipboardCheck} label="Assignments Done" value={`${data.assignments.done}/${data.assignments.total}`} sub={`${data.assignments.pct}% complete`} color="var(--accent)" />
        <StatCard icon={Award} label="Avg Assignment Grade" value={data.avgGradePct != null ? `${data.avgGradePct}%` : '—'} sub="Based on graded work" color="#f0932b" />
        <StatCard icon={TrendingUp} label="Avg Quiz Score" value={data.avgQuizPct != null ? `${data.avgQuizPct}%` : '—'} sub="Across all attempts" color="#0984e3" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="flex-col gap-3">
          <div className="card card-pad">
            <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 17 }}>Progress Overview</h3>
            </div>
            <div className="flex-col gap-3">
              <div>
                <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                  <span className="text-dim">Study Materials</span><span style={{ fontWeight: 700 }}>{data.materials.pct}%</span>
                </div>
                <div className="progress"><div style={{ width: `${data.materials.pct}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                  <span className="text-dim">Assignments</span><span style={{ fontWeight: 700 }}>{data.assignments.pct}%</span>
                </div>
                <div className="progress"><div style={{ width: `${data.assignments.pct}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-sm" style={{ marginBottom: 6 }}>
                  <span className="text-dim">Quiz Performance</span><span style={{ fontWeight: 700 }}>{data.avgQuizPct ?? 0}%</span>
                </div>
                <div className="progress"><div style={{ width: `${data.avgQuizPct ?? 0}%` }} /></div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 17 }}>Upcoming Assignments</h3>
              <Link to="/assignments" className="text-sm" style={{ color: 'var(--primary)', fontWeight: 700 }}>View all</Link>
            </div>
            {data.upcomingAssignments.length === 0 && <div className="text-dim text-sm">You're all caught up! 🎉</div>}
            <div className="flex-col gap-2">
              {data.upcomingAssignments.map(a => (
                <div key={a.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-2">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.subject_color }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</div>
                      <div className="text-xs text-dim">{a.subject_name}</div>
                    </div>
                  </div>
                  <div className="badge badge-orange"><Clock size={11} /> {a.due_date ? new Date(a.due_date).toLocaleDateString() : 'No due date'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ fontSize: 17, marginBottom: 14 }}>Recent Quiz Results</h3>
            {data.recentQuizzes.length === 0 && <div className="text-dim text-sm">No quiz attempts yet. Try one from the Quizzes tab!</div>}
            <div className="flex-col gap-2">
              {data.recentQuizzes.map((q, i) => {
                const pct = Math.round((q.score / q.total) * 100);
                return (
                  <div key={i} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{q.title}</div>
                      <div className="text-xs text-dim">{q.subject_name} • {q.topic}</div>
                    </div>
                    <div className={`badge ${pct >= 70 ? 'badge-green' : pct >= 40 ? 'badge-orange' : 'badge-red'}`}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card card-pad" style={{ background: 'linear-gradient(160deg, var(--primary-light), var(--surface))', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
            <Sparkles size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 17 }}>Recommended For You</h3>
          </div>
          <div className="flex-col gap-2">
            {data.recommendations.map(r => {
              const Icon = TYPE_ICON[r.type] || FileText;
              return (
                <Link key={r.id} to="/materials" className="flex items-center gap-2" style={{ padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: r.subject_color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color={r.subject_color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div className="text-xs text-dim">{r.subject_name} {r.reason === 'weak_topic' && '• Focus area'}</div>
                  </div>
                  <ArrowRight size={14} color="var(--text-dim)" />
                </Link>
              );
            })}
            {data.recommendations.length === 0 && <div className="text-dim text-sm">Explore more materials to get personalized picks!</div>}
          </div>
          <div style={{ marginTop: 16 }}>
            <AdSlot />
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px){ .page-container .grid[style]{ grid-template-columns: 1fr !important; } }
        @media (max-width: 560px){ .streak-divider{ display:none; } }
      `}</style>
    </AppLayout>
  );
}
