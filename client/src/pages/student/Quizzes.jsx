import { useEffect, useMemo, useRef, useState } from 'react';
import { PenSquare, Clock, CheckCircle2, XCircle, Trophy, RotateCcw, Eye } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import SubjectIcon from '../../components/IconMap.jsx';
import { SkeletonGrid } from '../../components/Skeleton.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useGamification } from '../../context/GamificationContext.jsx';

/** Renders the answer input for any supported question type. */
function QuestionInput({ q, value, onChange }) {
  switch (q.qtype) {
    case 'mcq': {
      // Two storage shapes exist: legacy per-letter columns (option_a..d +
      // a lettered correct_option), used by quizzes built question-by-question
      // in the old Quiz form; and a generic `options` JSON array (used by
      // quizzes generated from a Question Bank, where correct_answer.option
      // is the option's literal text, not a letter). This was a real bug:
      // bank-generated MCQ questions rendered with NO options at all because
      // this component only ever looked at option_a/b/c/d.
      const hasLegacyOptions = q.option_a !== undefined && q.option_a !== null && q.option_a !== '';
      if (hasLegacyOptions) {
        return (
          <div className="flex-col gap-2">
            {['a', 'b', 'c', 'd'].map(k => q[`option_${k}`] && (
              <button key={k} type="button" onClick={() => onChange(k)}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, fontSize: 14.5, border: value === k ? '2px solid var(--primary)' : '1.5px solid var(--border)', background: value === k ? 'var(--primary-light)' : 'var(--surface)', fontWeight: value === k ? 700 : 500 }}>
                <b style={{ marginRight: 8, opacity: .6 }}>{k.toUpperCase()}.</b> {q[`option_${k}`]}
              </button>
            ))}
          </div>
        );
      }
      const opts = Array.isArray(q.options) ? q.options : [];
      return (
        <div className="flex-col gap-2">
          {opts.map((opt, i) => (
            <button key={i} type="button" onClick={() => onChange(opt)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, fontSize: 14.5, border: value === opt ? '2px solid var(--primary)' : '1.5px solid var(--border)', background: value === opt ? 'var(--primary-light)' : 'var(--surface)', fontWeight: value === opt ? 700 : 500 }}>
              <b style={{ marginRight: 8, opacity: .6 }}>{String.fromCharCode(65 + i)}.</b> {opt}
            </button>
          ))}
          {opts.length === 0 && <div className="text-sm text-dim">This question has no answer options configured.</div>}
        </div>
      );
    }
    case 'multiple_choice': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex-col gap-2">
          {(q.options || []).map((opt, i) => {
            const key = opt.key || String(i);
            const checked = selected.includes(key);
            return (
              <label key={key} className="flex items-center gap-2" style={{ padding: '12px 14px', borderRadius: 12, border: checked ? '2px solid var(--primary)' : '1.5px solid var(--border)', background: checked ? 'var(--primary-light)' : 'var(--surface)', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter(k => k !== key) : [...selected, key])} />
                {opt.label || opt.text || opt}
              </label>
            );
          })}
        </div>
      );
    }
    case 'true_false':
      return (
        <div className="flex gap-2">
          {['true', 'false'].map(v => (
            <button key={v} type="button" onClick={() => onChange(v)} className="btn" style={{ flex: 1, textTransform: 'capitalize', border: value === v ? '2px solid var(--primary)' : '1.5px solid var(--border)', background: value === v ? 'var(--primary-light)' : 'var(--surface)' }}>{v}</button>
          ))}
        </div>
      );
    case 'fill_blank':
    case 'short_answer':
      return <input className="input" placeholder="Type your answer..." value={value || ''} onChange={e => onChange(e.target.value)} />;
    case 'numerical':
      return <input className="input" type="number" step="any" placeholder="Enter a number..." value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'essay':
      return <textarea className="input" style={{ minHeight: 160 }} placeholder="Write your answer..." value={value || ''} onChange={e => onChange(e.target.value)} />;
    case 'ordering': {
      const order = Array.isArray(value) && value.length ? value : (q.options || []).map((o, i) => o.key || String(i));
      const move = (idx, dir) => {
        const next = [...order];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j], next[idx]];
        onChange(next);
      };
      const labelFor = (key) => (q.options || []).find((o, i) => (o.key || String(i)) === key)?.label
        || (q.options || []).find((o, i) => (o.key || String(i)) === key)?.text || key;
      return (
        <div className="flex-col gap-2">
          {order.map((key, idx) => (
            <div key={key} className="flex items-center justify-between" style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)' }}>
              <span>{idx + 1}. {labelFor(key)}</span>
              <div className="flex gap-1">
                <button type="button" className="btn-ghost btn-sm" onClick={() => move(idx, -1)}>↑</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => move(idx, 1)}>↓</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'matching': {
      const pairs = value && typeof value === 'object' ? value : {};
      const lefts = (q.options || []).map(o => o.left).filter(Boolean);
      const rights = [...new Set((q.options || []).map(o => o.right).filter(Boolean))];
      return (
        <div className="flex-col gap-2">
          {lefts.map(l => (
            <div key={l} className="flex items-center gap-2">
              <span style={{ width: 140 }}>{l}</span>
              <select className="input" value={pairs[l] || ''} onChange={e => onChange({ ...pairs, [l]: e.target.value })}>
                <option value="">Select match...</option>
                {rights.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case 'code':
      return <textarea className="input mono" style={{ minHeight: 180, fontFamily: 'monospace' }} placeholder="Write your code..." value={value || ''} onChange={e => onChange(e.target.value)} />;
    case 'image':
    case 'audio':
    case 'video':
      return (
        <div>
          {q.media_url && (q.qtype === 'image' ? <img src={q.media_url} alt="" style={{ maxWidth: '100%', borderRadius: 10, marginBottom: 10 }} /> : q.qtype === 'audio' ? <audio controls src={q.media_url} style={{ width: '100%', marginBottom: 10 }} /> : <video controls src={q.media_url} style={{ width: '100%', borderRadius: 10, marginBottom: 10 }} />)}
          <textarea className="input" placeholder="Your answer / observations..." value={value || ''} onChange={e => onChange(e.target.value)} />
        </div>
      );
    default:
      return <input className="input" value={value || ''} onChange={e => onChange(e.target.value)} />;
  }
}

function QuizRunner({ quiz, onClose, onDone }) {
  const toast = useToast();
  const { applyGamificationResult } = useGamification();
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [attemptId, setAttemptId] = useState(null);
  const [result, setResult] = useState(null);
  const [idx, setIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const startedRef = useRef(Date.now());
  const submittedRef = useRef(false);

  useEffect(() => {
    api.get(`/quizzes/${quiz.id}`).then(({ data }) => {
      setQuestions(data.questions);
      if (data.resumeAttempt) {
        setAnswers(data.resumeAttempt.autosave_state || {});
        setAttemptId(data.resumeAttempt.id);
      }
      if (quiz.time_limit_min) setSecondsLeft(quiz.time_limit_min * 60);
    });
  }, [quiz.id]);

  // Autosave every 8 seconds while the quiz is open.
  useEffect(() => {
    const t = setInterval(() => {
      if (!submittedRef.current && Object.keys(answers).length) {
        api.post(`/quizzes/${quiz.id}/autosave`, { answers, attemptId }).then(({ data }) => {
          if (!attemptId) setAttemptId(data.attemptId);
        }).catch(() => {});
      }
    }, 8000);
    return () => clearInterval(t);
  }, [answers, attemptId, quiz.id]);

  // Countdown timer with auto-submit at zero.
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) { submit(true); return; }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const choose = (qid, val) => setAnswers(prev => ({ ...prev, [qid]: val }));

  const submit = async (autoSubmitted = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const timeTakenSec = Math.round((Date.now() - startedRef.current) / 1000);
    try {
      const { data } = await api.post(`/quizzes/${quiz.id}/submit`, { answers, attemptId, timeTakenSec, autoSubmitted });
      setResult(data);
      onDone();
      applyGamificationResult(data);
      if (data.needsManualGrading) {
        toast.info('Submitted! Some answers need teacher review before your final score is ready.');
      } else {
        const pct = Math.round((data.score / data.total) * 100);
        toast[pct >= 70 ? 'success' : 'info'](`Quiz complete — you scored ${pct}%!`);
      }
    } catch (err) {
      submittedRef.current = false;
      toast.error(err.response?.data?.error || 'Failed to submit quiz');
    }
  };

  if (result) {
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
        <Trophy size={40} color="var(--primary)" style={{ marginBottom: 12 }} />
        <h2 style={{ fontSize: 24, marginBottom: 6 }}>{result.needsManualGrading ? 'Submitted' : `${pct}% Score`}</h2>
        <p className="text-dim" style={{ marginBottom: 20 }}>
          {result.needsManualGrading ? 'Some questions need teacher review — check back soon for your final score.' : `You scored ${result.score} out of ${result.total} points`}
        </p>
        <div className="flex-col gap-2" style={{ textAlign: 'left', marginBottom: 20, maxHeight: 260, overflowY: 'auto' }}>
          {result.detail.map((d, i) => (
            <div key={i} className="flex items-center gap-2" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
              {d.pendingManualGrade ? <Eye size={16} color="var(--flame)" /> : d.isCorrect ? <CheckCircle2 size={16} color="var(--accent)" /> : <XCircle size={16} color="var(--danger)" />}
              <span className="text-sm">Question {i + 1}: {d.pendingManualGrade ? 'Awaiting review' : d.isCorrect ? 'Correct' : 'Incorrect'}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-block" onClick={onClose}>Close</button>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="glass-card card-pad" style={{ width: '100%', maxWidth: 560 }}>
        <div className="flex-col gap-2">
          <div className="skeleton" style={{ height: 14, width: '40%' }} />
          <div className="skeleton" style={{ height: 20, width: '80%', marginTop: 8 }} />
          <div className="skeleton" style={{ height: 44, width: '100%', marginTop: 16 }} />
          <div className="skeleton" style={{ height: 44, width: '100%' }} />
          <div className="skeleton" style={{ height: 44, width: '100%' }} />
        </div>
      </div>
    );
  }
  const q = questions[idx];
  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : null;
  const secs = secondsLeft !== null ? secondsLeft % 60 : null;

  return (
    <div className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 560 }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
        <span className="badge badge-purple">Question {idx + 1} / {questions.length}</span>
        {secondsLeft !== null && (
          <span className={`badge ${secondsLeft < 60 ? 'badge-red' : 'badge-gray'}`}>
            <Clock size={11} /> {mins}:{String(secs).padStart(2, '0')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2" style={{ margin: '10px 0' }}>
        <span className="badge badge-gray" style={{ textTransform: 'capitalize' }}>{q.qtype.replace('_', ' ')}</span>
        <span className="text-xs text-dim">{q.points} pt{q.points === 1 ? '' : 's'}</span>
      </div>
      <h3 style={{ fontSize: 17, margin: '4px 0 18px' }}>{q.question}</h3>
      <div style={{ marginBottom: 20 }}>
        <QuestionInput q={q} value={answers[q.id]} onChange={v => choose(q.id, v)} />
      </div>
      <div className="flex gap-2">
        {idx > 0 && <button className="btn btn-outline" onClick={() => setIdx(idx - 1)}>Back</button>}
        {idx < questions.length - 1
          ? <button className="btn btn-primary btn-block" onClick={() => setIdx(idx + 1)}>Next</button>
          : <button className="btn btn-primary btn-block" onClick={() => submit(false)}>Submit Quiz</button>}
      </div>
    </div>
  );
}

function ReviewModal({ attemptId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/quizzes/attempts/${attemptId}/review`).then(({ data }) => setData(data)).catch(() => setData({ error: true })); }, [attemptId]);

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 14 }}>Review Attempt</h3>
        {!data ? <div className="text-dim text-sm">Loading...</div> : data.error ? <div className="text-dim text-sm">Review is not available for this attempt.</div> : (
          <div className="flex-col gap-2">
            {data.answers.map((a, i) => (
              <div key={a.id} className="card card-pad" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  {a.is_correct === 1 ? <CheckCircle2 size={15} color="var(--accent)" /> : a.is_correct === 0 ? <XCircle size={15} color="var(--danger)" /> : <Eye size={15} color="var(--flame)" />}
                  <span className="text-sm" style={{ fontWeight: 700 }}>Q{i + 1}. {a.question}</span>
                </div>
                <div className="text-xs text-dim">Your answer: {JSON.stringify(a.answer)}</div>
                {a.correct_answer && <div className="text-xs text-dim">Correct: {JSON.stringify(a.correct_answer)}</div>}
                {a.manual_feedback && <div className="text-xs" style={{ marginTop: 4 }}>Feedback: {a.manual_feedback}</div>}
                <div className="text-xs" style={{ marginTop: 4 }}>Points: {a.awarded_points}/{a.points}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Quizzes() {
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState('all');
  const [taking, setTaking] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get(`/quizzes/class/${user.class_level}`).then(({ data }) => { setQuizzes(data.quizzes); setLoading(false); });
    api.get(`/subjects/class/${user.class_level}`).then(({ data }) => setSubjects(data.subjects));
  };
  useEffect(() => { load(); }, [user.class_level]);

  const filtered = useMemo(
    () => activeSubject === 'all' ? quizzes : quizzes.filter(q => q.subject_id === activeSubject),
    [quizzes, activeSubject]
  );

  if (loading) return <AppLayout title="Interactive Quizzes" subtitle="Test your knowledge and track your improvement"><SkeletonGrid count={6} /></AppLayout>;

  return (
    <AppLayout title="Interactive Quizzes" subtitle="Organized by subject — test your knowledge and track your improvement">
      <div className="flex gap-2" style={{ overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
        <button
          onClick={() => setActiveSubject('all')}
          className="btn-sm"
          style={{
            padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13.5,
            border: activeSubject === 'all' ? 'none' : '1.5px solid var(--border)',
            background: activeSubject === 'all' ? 'linear-gradient(135deg, var(--flame), #ff8a4c)' : 'var(--surface)',
            color: activeSubject === 'all' ? '#241407' : 'var(--text)',
          }}
        >
          All Subjects
        </button>
        {subjects.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSubject(s.id)}
            className="btn-sm"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap',
              border: activeSubject === s.id ? 'none' : '1.5px solid var(--border)',
              background: activeSubject === s.id ? s.color : 'var(--surface)',
              color: activeSubject === s.id ? '#fff' : 'var(--text)', fontWeight: 700, fontSize: 13.5,
            }}
          >
            <SubjectIcon name={s.icon} size={15} color={activeSubject === s.id ? '#fff' : s.color} />
            {s.name}
          </button>
        ))}
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {filtered.map(q => (
          <div key={q.id} className="card card-pad flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="badge badge-purple" style={{ background: q.subject_color + '20', color: q.subject_color }}>{q.subject_name}</span>
              <span className="badge badge-gray"><Clock size={11} /> {q.time_limit_min}m</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{q.title}</div>
            <div className="text-sm text-dim">{q.description}</div>
            <div className="text-xs text-dim">{q.question_count} questions {q.topic && `• ${q.topic}`} {q.max_attempts ? `• ${q.attemptsRemaining ?? q.max_attempts} attempt(s) left` : ''}</div>
            {q.attempts > 0 && (
              <div className={`badge ${(q.best_score / q.total) >= 0.7 ? 'badge-green' : 'badge-orange'}`} style={{ alignSelf: 'flex-start' }}>
                Best: {Math.round((q.best_score / q.total) * 100)}%
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="btn btn-primary"
                style={{ marginTop: 6, flex: 1 }}
                disabled={q.max_attempts > 0 && q.attemptsRemaining === 0 && !q.canResume}
                onClick={() => setTaking(q)}
              >
                <PenSquare size={15} /> {q.canResume ? 'Resume Quiz' : q.attempts > 0 ? 'Retake Quiz' : 'Start Quiz'}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="card card-pad text-dim" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>No quizzes available{activeSubject !== 'all' ? ' for this subject' : ''} yet.</div>}
      </div>

      {taking && (
        <Modal onClose={() => {}} closeOnBackdrop={false}>
          <QuizRunner quiz={taking} onClose={() => { setTaking(null); load(); }} onDone={load} />
        </Modal>
      )}
      {reviewing && <ReviewModal attemptId={reviewing} onClose={() => setReviewing(null)} />}
    </AppLayout>
  );
}
