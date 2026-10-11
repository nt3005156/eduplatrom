import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, X, Copy, Archive, Pencil, BarChart3, ClipboardCheck, BookMarked } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import GlobalFilterBar from '../../components/GlobalFilterBar.jsx';
import { useModuleFilters } from '../../hooks/useModuleFilters.js';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

const STATUS_BADGE = { draft: 'badge-gray', published: 'badge-green', archived: 'badge-gray' };
const QUESTION_TYPES = [
  ['mcq', 'Multiple Choice (single)'], ['multiple_choice', 'Multiple Choice (multi-select)'],
  ['true_false', 'True / False'], ['fill_blank', 'Fill in the Blank'], ['short_answer', 'Short Answer'],
  ['essay', 'Essay'], ['numerical', 'Numerical'], ['matching', 'Matching'], ['ordering', 'Ordering'],
  ['code', 'Code'], ['image', 'Image Response'], ['audio', 'Audio Response'], ['video', 'Video Response'],
];
const MANUAL_TYPES = new Set(['essay', 'short_answer', 'image', 'audio', 'video', 'code']);

const emptyQ = () => ({
  qtype: 'mcq', question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'a',
  options: [], correct_answer: null, points: 1, difficulty: 'medium', explanation: '',
});

function QuestionEditor({ q, onChange, onRemove, canRemove }) {
  const set = (k, v) => onChange({ ...q, [k]: v });

  return (
    <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 220 }} value={q.qtype} onChange={e => set('qtype', e.target.value)}>
          {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {canRemove && <button type="button" className="btn-ghost btn-sm" onClick={onRemove}><Trash2 size={13} color="var(--danger)" /></button>}
      </div>
      <input className="input" required placeholder="Question text" style={{ marginBottom: 8 }} value={q.question} onChange={e => set('question', e.target.value)} />

      {q.qtype === 'mcq' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {['a', 'b', 'c', 'd'].map(k => (
              <input key={k} className="input" required placeholder={`Option ${k.toUpperCase()}`} value={q[`option_${k}`]} onChange={e => set(`option_${k}`, e.target.value)} />
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-sm text-dim">Correct:</label>
            <select className="input" style={{ width: 90 }} value={q.correct_option} onChange={e => set('correct_option', e.target.value)}>
              <option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option>
            </select>
          </div>
        </>
      )}

      {q.qtype === 'multiple_choice' && (
        <div className="field">
          <label>Options (one per line) — prefix correct ones with *</label>
          <textarea className="input" placeholder={'*Correct option\nWrong option\n*Also correct'}
            value={(q.options || []).map(o => (q.correct_answer?.options || []).includes(o.key) ? `*${o.label}` : o.label).join('\n')}
            onChange={e => {
              const lines = e.target.value.split('\n');
              const options = lines.map((l, i) => ({ key: String(i), label: l.replace(/^\*/, '') }));
              const correctKeys = lines.map((l, i) => l.startsWith('*') ? String(i) : null).filter(Boolean);
              onChange({ ...q, options, correct_answer: { options: correctKeys } });
            }} />
        </div>
      )}

      {q.qtype === 'true_false' && (
        <div className="flex gap-2 items-center">
          <label className="text-sm text-dim">Correct:</label>
          <select className="input" style={{ width: 120 }} value={q.correct_answer?.value || 'true'} onChange={e => set('correct_answer', { value: e.target.value })}>
            <option value="true">True</option><option value="false">False</option>
          </select>
        </div>
      )}

      {q.qtype === 'fill_blank' && (
        <input className="input" placeholder="Accepted answers, comma-separated" value={(q.correct_answer?.answers || []).join(', ')}
          onChange={e => set('correct_answer', { answers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
      )}

      {q.qtype === 'numerical' && (
        <div className="flex gap-2">
          <input className="input" type="number" placeholder="Correct value" value={q.correct_answer?.value ?? ''} onChange={e => set('correct_answer', { ...q.correct_answer, value: Number(e.target.value) })} />
          <input className="input" type="number" placeholder="Tolerance (±)" value={q.correct_answer?.tolerance ?? 0} onChange={e => set('correct_answer', { ...q.correct_answer, tolerance: Number(e.target.value) })} />
        </div>
      )}

      {q.qtype === 'ordering' && (
        <div className="field">
          <label>Items in correct order (one per line)</label>
          <textarea className="input" value={(q.options || []).map(o => o.label).join('\n')}
            onChange={e => {
              const lines = e.target.value.split('\n');
              const options = lines.map((l, i) => ({ key: String(i), label: l }));
              onChange({ ...q, options, correct_answer: { order: options.map(o => o.key) } });
            }} />
        </div>
      )}

      {q.qtype === 'matching' && (
        <div className="field">
          <label>Pairs — one per line as "Left = Right"</label>
          <textarea className="input" placeholder={'Paris = France\nTokyo = Japan'}
            value={(q.options || []).map(o => `${o.left} = ${o.right}`).join('\n')}
            onChange={e => {
              const lines = e.target.value.split('\n').filter(Boolean);
              const options = lines.map(l => { const [left, right] = l.split('='); return { left: (left || '').trim(), right: (right || '').trim() }; });
              onChange({ ...q, options, correct_answer: { pairs: options.map(o => [o.left, o.right]) } });
            }} />
        </div>
      )}

      {MANUAL_TYPES.has(q.qtype) && (
        <div className="text-xs" style={{ color: 'var(--flame)', marginBottom: 4 }}><ClipboardCheck size={12} style={{ verticalAlign: -2 }} /> This question type requires manual teacher grading.</div>
      )}

      <div className="flex gap-2 items-center" style={{ marginTop: 8 }}>
        <label className="text-sm text-dim">Points:</label>
        <input className="input" type="number" style={{ width: 80 }} value={q.points} onChange={e => set('points', Number(e.target.value))} />
        <label className="text-sm text-dim">Difficulty:</label>
        <select className="input" style={{ width: 110 }} value={q.difficulty} onChange={e => set('difficulty', e.target.value)}>
          <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
        </select>
      </div>
      <input className="input" style={{ marginTop: 8 }} placeholder="Explanation shown after grading (optional)" value={q.explanation} onChange={e => set('explanation', e.target.value)} />
    </div>
  );
}

function QuizFormModal({ existing, defaultClassLevel, onClose, onSaved }) {
  const toast = useToast();
  const { allowedClasses } = usePermissions();
  const [classLevel, setClassLevel] = useState(existing?.class_level || defaultClassLevel || allowedClasses[allowedClasses.length - 1]);
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState({
    subject_id: existing?.subject_id || '', title: existing?.title || '', description: existing?.description || '',
    topic: existing?.topic || '', time_limit_min: existing?.time_limit_min ?? 10, status: existing?.status || 'published',
    shuffle_questions: existing?.shuffle_questions ?? 0, shuffle_answers: existing?.shuffle_answers ?? 0,
    max_attempts: existing?.max_attempts ?? 1, grading_strategy: existing?.grading_strategy || 'highest',
    show_review: existing?.show_review ?? 1, randomize_count: existing?.randomize_count ?? '', passing_pct: existing?.passing_pct ?? 40,
  });
  const [questions, setQuestions] = useState([emptyQ()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/subjects/class/${classLevel}`).then(({ data }) => {
      setSubjects(data.subjects);
      if (!existing) setForm(f => ({ ...f, subject_id: data.subjects[0]?.id || '' }));
    });
  }, [classLevel, existing]);

  useEffect(() => {
    if (existing) {
      api.get(`/quizzes/${existing.id}`).then(({ data }) => {
        setQuestions(data.questions.length ? data.questions : [emptyQ()]);
      });
    }
  }, [existing]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updateQ = (i, next) => setQuestions(qs => qs.map((q, idx) => idx === i ? next : q));
  const addQ = () => setQuestions(qs => [...qs, emptyQ()]);
  const removeQ = (i) => setQuestions(qs => qs.filter((_, idx) => idx !== i));

  const save = async (status) => {
    setSaving(true);
    const payload = { ...form, status: status || form.status, class_level: classLevel, questions, randomize_count: form.randomize_count || null };
    try {
      if (existing) {
        await api.put(`/quizzes/${existing.id}`, payload);
        toast.success(`Quiz "${form.title}" updated`);
      } else {
        await api.post('/quizzes', payload);
        toast.success(`Quiz "${form.title}" ${payload.status === 'draft' ? 'saved as draft' : 'created — students have been notified'}`);
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save quiz');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); save(form.status); }} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>{existing ? 'Edit Quiz' : 'New Quiz'}</h3><button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Class</label>
            <select className="input" value={classLevel} onChange={e => setClassLevel(Number(e.target.value))}>{allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}</select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Subject</label>
            <select className="input" required value={form.subject_id} onChange={e => set('subject_id', e.target.value)}>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
        </div>
        <div className="field"><label>Title</label><input className="input" required value={form.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Topic</label><input className="input" value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="e.g. Algebra" /></div>
          <div className="field" style={{ flex: 1 }}><label>Time limit (min)</label><input className="input" type="number" value={form.time_limit_min} onChange={e => set('time_limit_min', e.target.value)} /></div>
        </div>
        <div className="field"><label>Description</label><textarea className="input" value={form.description} onChange={e => set('description', e.target.value)} /></div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!Number(form.shuffle_questions)} onChange={e => set('shuffle_questions', e.target.checked ? 1 : 0)} /> Shuffle Qs</label>
          <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!Number(form.shuffle_answers)} onChange={e => set('shuffle_answers', e.target.checked ? 1 : 0)} /> Shuffle Answers</label>
          <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!Number(form.show_review)} onChange={e => set('show_review', e.target.checked ? 1 : 0)} /> Allow Review</label>
        </div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Max Attempts (0 = unlimited)</label><input className="input" type="number" value={form.max_attempts} onChange={e => set('max_attempts', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label>Grading Strategy</label>
            <select className="input" value={form.grading_strategy} onChange={e => set('grading_strategy', e.target.value)}>
              <option value="highest">Highest Attempt</option><option value="latest">Latest Attempt</option><option value="average">Average of Attempts</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Passing %</label><input className="input" type="number" value={form.passing_pct} onChange={e => set('passing_pct', e.target.value)} /></div>
        </div>
        <div className="field"><label>Random subset size (leave blank to use all questions)</label><input className="input" type="number" value={form.randomize_count} onChange={e => set('randomize_count', e.target.value)} /></div>

        <h4 style={{ fontSize: 14.5, margin: '18px 0 10px' }}>Questions</h4>
        <div className="flex-col gap-3">
          {questions.map((q, i) => (
            <QuestionEditor key={i} q={q} onChange={next => updateQ(i, next)} onRemove={() => removeQ(i)} canRemove={questions.length > 1} />
          ))}
        </div>
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={addQ}><Plus size={14} /> Add Question</button>

        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-outline btn-block" disabled={saving} onClick={() => save('draft')}>Save as Draft</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : existing ? 'Save Changes' : 'Publish Quiz'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ManualGradingModal({ quiz, onClose }) {
  const toast = useToast();
  const [attempts, setAttempts] = useState([]);
  const [openAttempt, setOpenAttempt] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [grades, setGrades] = useState({});

  const loadAttempts = useCallback(() => api.get(`/quizzes/${quiz.id}/pending-manual-grading`).then(({ data }) => setAttempts(data.attempts)), [quiz.id]);
  useEffect(() => { loadAttempts(); }, [loadAttempts]);

  const openGrading = async (attempt) => {
    setOpenAttempt(attempt);
    const { data } = await api.get(`/quizzes/attempts/${attempt.id}/answers`);
    setAnswers(data.answers);
    const initial = {};
    data.answers.forEach(a => { initial[a.id] = a.awarded_points || 0; });
    setGrades(initial);
  };

  const saveGrade = async (answerId, points) => {
    try {
      await api.put(`/quizzes/attempt-answers/${answerId}/grade`, { awarded_points: points });
      toast.success('Saved');
      const { data } = await api.get(`/quizzes/attempts/${openAttempt.id}/answers`);
      setAnswers(data.answers);
      loadAttempts();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>Manual Grading — {quiz.title}</h3><button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!openAttempt ? (
          <div className="flex-col gap-2">
            {attempts.map(a => (
              <div key={a.id} className="card card-pad flex items-center justify-between" style={{ background: 'var(--surface-2)' }}>
                <div>{a.student_name}</div>
                <button className="btn btn-primary btn-sm" onClick={() => openGrading(a)}>Grade</button>
              </div>
            ))}
            {attempts.length === 0 && <div className="text-dim text-sm">No attempts pending manual grading.</div>}
          </div>
        ) : (
          <div className="flex-col gap-3">
            <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpenAttempt(null)}>← Back to list</button>
            {(answers || []).filter(a => a.qtype === 'essay' || a.qtype === 'short_answer' || a.qtype === 'code' || ['image', 'audio', 'video'].includes(a.qtype)).map(a => (
              <div key={a.id} className="card card-pad" style={{ background: 'var(--surface-2)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{a.question}</div>
                <div className="text-sm text-dim" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{typeof a.answer === 'string' ? a.answer : JSON.stringify(a.answer)}</div>
                <div className="flex gap-2 items-center">
                  <label className="text-sm text-dim">Points (max {a.points}):</label>
                  <input className="input" style={{ width: 90 }} type="number" max={a.points} value={grades[a.id] ?? 0} onChange={e => setGrades(g => ({ ...g, [a.id]: Number(e.target.value) }))} />
                  <button className="btn btn-primary btn-sm" onClick={() => saveGrade(a.id, grades[a.id])}>Save</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AnalyticsModal({ quiz, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/quizzes/${quiz.id}/analytics`).then(({ data }) => setData(data)); }, [quiz.id]);
  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 600, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3><BarChart3 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Analytics — {quiz.title}</h3><button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!data ? <div className="text-dim text-sm">Loading...</div> : (
          <div className="flex-col gap-3">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.participationPct}%</div><div className="text-xs text-dim">Participation</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.avgPct ?? '—'}%</div><div className="text-xs text-dim">Avg Score</div></div>
              <div className="card card-pad" style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{data.passRate ?? '—'}%</div><div className="text-xs text-dim">Pass Rate</div></div>
            </div>
            <div className="card card-pad">
              <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>QUESTION STATISTICS / DIFFICULTY</div>
              {data.questionStats.map(qs => (
                <div key={qs.question_id} className="flex items-center justify-between text-sm" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qs.question}</span>
                  <span className={`badge ${qs.correctPct == null ? 'badge-gray' : qs.correctPct >= 70 ? 'badge-green' : 'badge-orange'}`}>{qs.correctPct != null ? `${qs.correctPct}%` : 'pending'}</span>
                </div>
              ))}
            </div>
            {data.weakTopics.length > 0 && (
              <div className="card card-pad">
                <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>WEAK TOPICS (across this subject)</div>
                {data.weakTopics.map(t => <div key={t.topic} className="flex justify-between text-sm" style={{ padding: '4px 0' }}><span>{t.topic}</span><span className="text-dim">{t.avgPct}%</span></div>)}
              </div>
            )}
            {data.pendingManualGrading > 0 && <div className="text-xs" style={{ color: 'var(--flame)' }}>{data.pendingManualGrading} attempt(s) still need manual grading.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function AdminQuizzes() {
  const toast = useToast();
  const { classLevel, setClassLevel, section, setSection, subjectId, setSubjectId } = useModuleFilters();
  const [quizzes, setQuizzes] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [gradingFor, setGradingFor] = useState(null);
  const [analyticsFor, setAnalyticsFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (classLevel) params.set('class_level', classLevel);
    if (subjectId) params.set('subject_id', subjectId);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/quizzes?${params.toString()}`).then(({ data }) => setQuizzes(data.quizzes));
  }, [classLevel, subjectId, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    const q = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/quizzes/${q.id}`);
      toast.success(`Quiz "${q.title}" deleted`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete quiz'); }
  };

  const duplicate = async (q) => {
    try { await api.post(`/quizzes/${q.id}/duplicate`); toast.success(`"${q.title}" duplicated as a draft`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const archive = async (q) => {
    try { await api.put(`/quizzes/${q.id}/archive`); toast.success(`"${q.title}" archived`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const scopeLabel = classLevel ? `Class ${classLevel}` : 'All Classes';

  return (
    <AppLayout title="Quizzes" subtitle="Enterprise quiz builder — question bank, randomization, auto & manual grading, analytics">
      <GlobalFilterBar classLevel={classLevel} onClassChange={setClassLevel} section={section} onSectionChange={setSection} subjectId={subjectId} onSubjectChange={setSubjectId} />

      <div className="flex justify-between items-center" style={{ margin: '0 0 14px', flexWrap: 'wrap', gap: 10 }}>
        <div className="flex items-center gap-2">
          <h3 style={{ fontSize: 16 }}>{scopeLabel} Quizzes</h3>
          <select className="input" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/question-banks" className="btn btn-outline btn-sm"><BookMarked size={14} /> Question Banks</Link>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> New Quiz</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {quizzes.map(q => (
          <div key={q.id} className="card card-pad flex-col gap-2">
            <div className="flex justify-between items-start">
              <div className="flex gap-1 flex-wrap">
                <span className="badge badge-purple" style={{ background: q.subject_color + '20', color: q.subject_color }}>{q.subject_name}</span>
                <span className="badge badge-gray">Class {q.class_level}</span>
                <span className={`badge ${STATUS_BADGE[q.status] || 'badge-gray'}`}>{q.status}</span>
              </div>
            </div>
            <div style={{ fontWeight: 700 }}>{q.title}</div>
            <div className="text-xs text-dim">{q.question_count} questions • {q.time_limit_min} min {q.topic && `• ${q.topic}`}</div>
            <div className="flex gap-1 flex-wrap" style={{ marginTop: 4 }}>
              <button className="btn-ghost btn-sm" onClick={() => setAnalyticsFor(q)}><BarChart3 size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => setGradingFor(q)}><ClipboardCheck size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => { setEditing(q); setShowForm(true); }}><Pencil size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={() => duplicate(q)}><Copy size={14} /></button>
              {q.status !== 'archived' && <button className="btn-ghost btn-sm" onClick={() => archive(q)}><Archive size={14} /></button>}
              <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(q)}><Trash2 size={14} color="var(--danger)" /></button>
            </div>
          </div>
        ))}
        {quizzes.length === 0 && <div className="card card-pad text-dim" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 30 }}>No quizzes found for the selected filters.</div>}
      </div>

      {showForm && <QuizFormModal existing={editing} defaultClassLevel={classLevel} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      {gradingFor && <ManualGradingModal quiz={gradingFor} onClose={() => setGradingFor(null)} />}
      {analyticsFor && <AnalyticsModal quiz={analyticsFor} onClose={() => setAnalyticsFor(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this quiz?"
          message={`Are you sure you want to delete "${confirmDelete.title}"? All student attempts for it will also be removed.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
