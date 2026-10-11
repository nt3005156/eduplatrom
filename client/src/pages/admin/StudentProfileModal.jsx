import { useEffect, useState } from 'react';
import { X, Award, PenSquare, BookOpen, Flame, TrendingUp, FileDown } from 'lucide-react';
import api from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';

const TAB_LABELS = { submissions: 'Assignments', quizzes: 'Quizzes', materials: 'Materials Viewed' };

export default function StudentProfileModal({ studentId, onClose }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('submissions');

  useEffect(() => {
    api.get(`/dashboard/admin/students/${studentId}`).then(({ data }) => setData(data));
  }, [studentId]);

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}>
        {!data ? (
          <div className="flex-col gap-2">
            <Skeleton height={40} width="60%" />
            <Skeleton height={80} />
            <Skeleton height={200} />
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start" style={{ marginBottom: 18 }}>
              <div className="flex items-center gap-3">
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', background: 'var(--flame)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, color: '#241407',
                }}>
                  {data.student.name[0]?.toUpperCase()}
                </div>
                <div>
                  <h3 style={{ fontSize: 19 }}>{data.student.name}</h3>
                  <div className="text-sm text-dim">{data.student.email}</div>
                  <div className="flex gap-1" style={{ marginTop: 4 }}>
                    <span className="badge badge-purple">Class {data.student.class_level}</span>
                    {data.student.gender && <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{data.student.gender}</span>}
                    <span className={`badge ${data.student.approval_status === 'approved' ? 'badge-green' : 'badge-orange'}`}>{data.student.approval_status}</span>
                  </div>
                </div>
              </div>
              <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
              <div className="card card-pad" style={{ textAlign: 'center', padding: 14 }}>
                <Flame size={16} color="var(--flame)" style={{ marginBottom: 4 }} />
                <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{data.student.streak_count}</div>
                <div className="text-xs text-dim">Streak</div>
              </div>
              <div className="card card-pad" style={{ textAlign: 'center', padding: 14 }}>
                <TrendingUp size={16} color="var(--knowledge)" style={{ marginBottom: 4 }} />
                <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{data.student.xp}</div>
                <div className="text-xs text-dim">XP</div>
              </div>
              <div className="card card-pad" style={{ textAlign: 'center', padding: 14 }}>
                <PenSquare size={16} color="var(--flame)" style={{ marginBottom: 4 }} />
                <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{data.summary.quizAvg != null ? `${data.summary.quizAvg}%` : '—'}</div>
                <div className="text-xs text-dim">Quiz Avg</div>
              </div>
              <div className="card card-pad" style={{ textAlign: 'center', padding: 14 }}>
                <Award size={16} color="var(--knowledge)" style={{ marginBottom: 4 }} />
                <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{data.summary.assignmentAvg != null ? `${data.summary.assignmentAvg}%` : '—'}</div>
                <div className="text-xs text-dim">Assignment Avg</div>
              </div>
            </div>

            {data.bySubject.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8, letterSpacing: '.03em' }}>ACTIVITY BY SUBJECT</div>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {data.bySubject.map(s => (
                    <div key={s.subject_name} className="badge badge-gray" style={{ padding: '6px 12px' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.subject_color, display: 'inline-block', marginRight: 5 }} />
                      {s.subject_name}: {s.materials}📘 {s.assignments}📋 {s.quizzes}✏️
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2" style={{ marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
              {Object.entries(TAB_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    background: 'none', border: 'none', padding: '8px 4px', marginRight: 16, fontSize: 13.5, fontWeight: 700,
                    color: tab === key ? 'var(--flame)' : 'var(--text-dim)',
                    borderBottom: tab === key ? '2px solid var(--flame)' : '2px solid transparent',
                  }}
                >
                  {label} ({data[key === 'submissions' ? 'assignmentSubmissions' : key === 'quizzes' ? 'quizAttempts' : 'materialViews'].length})
                </button>
              ))}
            </div>

            <div className="flex-col gap-2">
              {tab === 'submissions' && (
                data.assignmentSubmissions.length ? data.assignmentSubmissions.map(s => (
                  <div key={s.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.assignment_title}</div>
                      <div className="text-xs text-dim">{s.subject_name} • {new Date(s.submitted_at).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.file_path && <a href={s.file_path} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" style={{ padding: 6 }}><FileDown size={14} /></a>}
                      <span className={`badge ${s.status === 'graded' ? 'badge-green' : 'badge-orange'}`}>{s.status === 'graded' ? `${s.grade}/${s.max_score}` : s.status}</span>
                    </div>
                  </div>
                )) : <div className="text-dim text-sm" style={{ textAlign: 'center', padding: 20 }}>No assignment submissions yet.</div>
              )}
              {tab === 'quizzes' && (
                data.quizAttempts.length ? data.quizAttempts.map(q => {
                  const pct = Math.round((q.score / q.total) * 100);
                  return (
                    <div key={q.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{q.quiz_title}</div>
                        <div className="text-xs text-dim">{q.subject_name} {q.topic && `• ${q.topic}`} • {new Date(q.attempted_at).toLocaleDateString()}</div>
                      </div>
                      <span className={`badge ${pct >= 70 ? 'badge-green' : 'badge-orange'}`}>{pct}%</span>
                    </div>
                  );
                }) : <div className="text-dim text-sm" style={{ textAlign: 'center', padding: 20 }}>No quiz attempts yet.</div>
              )}
              {tab === 'materials' && (
                data.materialViews.length ? data.materialViews.map((m, i) => (
                  <div key={i} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
                    <div className="flex items-center gap-2">
                      <BookOpen size={14} color={m.subject_color} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{m.material_title}</div>
                        <div className="text-xs text-dim">{m.subject_name} • {new Date(m.viewed_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <span className="badge badge-gray">{m.type}</span>
                  </div>
                )) : <div className="text-dim text-sm" style={{ textAlign: 'center', padding: 20 }}>No materials viewed yet.</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
