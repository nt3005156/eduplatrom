import { useEffect, useState } from 'react';
import {
  BookMarked, Plus, X, Trash2, Copy, Search, Upload, CheckSquare, Square, Sparkles, Pencil,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { usePermissions } from '../../context/PermissionContext.jsx';

const QUESTION_TYPES = [
  ['mcq', 'Multiple Choice'], ['true_false', 'True / False'], ['short_answer', 'Short Answer'],
  ['essay', 'Long Answer / Essay'], ['fill_blank', 'Fill in the Blank'], ['matching', 'Matching'],
  ['ordering', 'Ordering'], ['image', 'Image Question'], ['code', 'File / Code Question'],
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DIFF_BADGE = { easy: 'badge-green', medium: 'badge-orange', hard: 'badge-red' };

function CreateBankModal({ onClose, onSaved }) {
  const toast = useToast();
  const { allowedClasses } = usePermissions();
  const [form, setForm] = useState({ name: '', description: '', class_level: '', subject_id: '' });
  const [subjects, setSubjects] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.class_level) { setSubjects([]); return; }
    api.get(`/subjects/class/${form.class_level}`).then(({ data }) => setSubjects(data.subjects));
  }, [form.class_level]);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('A bank name is required'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/quizzes/question-banks', {
        ...form, class_level: form.class_level || null, subject_id: form.subject_id || null,
      });
      toast.success(`Question bank "${form.name}" created`);
      onSaved(data.bank);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create bank'); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 440 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3>New Question Bank</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label>Bank Name</label><input className="input" required placeholder='e.g. "Computer Basics", "Networking"' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Description (optional)</label><textarea className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}>
            <label>Class (optional)</label>
            <select className="input" value={form.class_level} onChange={e => setForm({ ...form, class_level: e.target.value, subject_id: '' })}>
              <option value="">Any Class</option>
              {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Subject (optional)</label>
            <select className="input" value={form.subject_id} disabled={!form.class_level} onChange={e => setForm({ ...form, subject_id: e.target.value })}>
              <option value="">{form.class_level ? 'Any Subject' : 'Select a Class first'}</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Creating...' : 'Create Bank'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddQuestionForm({ bankId, onAdded }) {
  const toast = useToast();
  const empty = { qtype: 'mcq', question: '', options: ['', '', '', ''], correctIndex: 0, topic: '', difficulty: 'medium', points: 1, explanation: '' };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.question.trim()) { toast.error('Question text is required'); return; }
    setSaving(true);
    let options = null, correct_answer = null;
    if (form.qtype === 'mcq') {
      options = form.options.filter(o => o.trim());
      correct_answer = { option: options[form.correctIndex] || options[0] };
    } else if (form.qtype === 'true_false') {
      correct_answer = { value: form.correctIndex === 0 };
    }
    try {
      await api.post(`/quizzes/question-banks/${bankId}/items`, {
        qtype: form.qtype, question: form.question, options, correct_answer,
        topic: form.topic || null, difficulty: form.difficulty, points: form.points, explanation: form.explanation || null,
      });
      toast.success('Question added to bank');
      setForm(empty);
      onAdded();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to add question'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="card card-pad" style={{ background: 'var(--surface-2)', marginBottom: 16 }}>
      <div className="flex gap-2" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 200 }} value={form.qtype} onChange={e => setForm({ ...form, qtype: e.target.value })}>
          {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input" style={{ width: 130 }} value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
          {DIFFICULTIES.map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
        </select>
        <input className="input" style={{ width: 150 }} placeholder="Topic / Chapter" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} />
        <input className="input" style={{ width: 90 }} type="number" min={1} placeholder="Points" value={form.points} onChange={e => setForm({ ...form, points: Number(e.target.value) })} />
      </div>
      <textarea className="input" required placeholder="Question text" style={{ marginBottom: 8 }} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} />

      {form.qtype === 'mcq' && (
        <div className="flex-col gap-2" style={{ marginBottom: 8 }}>
          {form.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" checked={form.correctIndex === i} onChange={() => setForm({ ...form, correctIndex: i })} />
              <input className="input" placeholder={`Option ${i + 1}`} value={opt} onChange={e => { const opts = [...form.options]; opts[i] = e.target.value; setForm({ ...form, options: opts }); }} />
            </div>
          ))}
        </div>
      )}
      {form.qtype === 'true_false' && (
        <div className="flex gap-3 items-center" style={{ marginBottom: 8 }}>
          <label className="flex items-center gap-1 text-sm"><input type="radio" name="tf" checked={form.correctIndex === 0} onChange={() => setForm({ ...form, correctIndex: 0 })} /> True</label>
          <label className="flex items-center gap-1 text-sm"><input type="radio" name="tf" checked={form.correctIndex === 1} onChange={() => setForm({ ...form, correctIndex: 1 })} /> False</label>
        </div>
      )}
      {['short_answer', 'essay', 'fill_blank', 'matching', 'ordering', 'image', 'code'].includes(form.qtype) && (
        <div className="text-xs text-dim" style={{ marginBottom: 8 }}>
          {['essay', 'short_answer', 'image', 'code'].includes(form.qtype)
            ? 'This question type is manually graded by the teacher.'
            : 'Configure exact matching rules after creating — for now this is stored as a plain question.'}
        </div>
      )}
      <input className="input" placeholder="Explanation (shown after grading, optional)" value={form.explanation} onChange={e => setForm({ ...form, explanation: e.target.value })} />
      <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={saving}><Plus size={14} /> {saving ? 'Adding...' : 'Add Question to Bank'}</button>
    </form>
  );
}

function ImportModal({ bankId, onClose, onImported }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
  };

  const doImport = async () => {
    if (!text.trim()) { toast.error('Paste CSV text or choose a .csv file first'); return; }
    setImporting(true);
    try {
      const { data } = await api.post(`/quizzes/question-banks/${bankId}/import`, { text });
      setResult(data);
      toast.success(`Imported ${data.imported} question(s)`);
      onImported();
    } catch (err) { toast.error(err.response?.data?.error || 'Import failed'); }
    finally { setImporting(false); }
  };

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 620, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <h3><Upload size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Bulk Import Questions</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-dim" style={{ marginBottom: 12, lineHeight: 1.6 }}>
          Upload a CSV file or paste comma/tab-separated rows. Required column: <strong>question</strong>. Optional columns:{' '}
          <code>qtype, option_a, option_b, option_c, option_d, correct, explanation, topic, difficulty, points</code>.
          For MCQ, <code>correct</code> is the option letter (a/b/c/d). For True/False, use <code>true</code> or <code>false</code>.
        </p>
        <div className="field">
          <label>Upload CSV file</label>
          <input className="input" type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Or paste CSV / TSV text</label>
          <textarea className="input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12.5 }}
            placeholder={'question,qtype,option_a,option_b,option_c,option_d,correct,topic,difficulty,points\nWhat is RAM?,mcq,Random Access Memory,Read Access Memory,,,a,Hardware,easy,1'}
            value={text} onChange={e => setText(e.target.value)} />
        </div>
        {result && (
          <div className="card card-pad" style={{ marginTop: 12, background: 'var(--surface-2)' }}>
            <div className="text-sm" style={{ fontWeight: 700 }}>{result.imported} question(s) imported</div>
            {result.errors?.length > 0 && (
              <div className="text-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-block" disabled={importing} onClick={doImport}>{importing ? 'Importing...' : 'Import Questions'}</button>
        </div>
      </div>
    </Modal>
  );
}

function GenerateQuizModal({ bank, selectedIds, onClose, onDone }) {
  const toast = useToast();
  const { allowedClasses } = usePermissions();
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState({
    title: `${bank.name} Quiz`, class_level: bank.class_level || '', subject_id: bank.subject_id || '',
    time_limit_min: 15, status: 'published', shuffle_questions: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.class_level) { setSubjects([]); return; }
    api.get(`/subjects/class/${form.class_level}`).then(({ data }) => setSubjects(data.subjects));
  }, [form.class_level]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.class_level || !form.subject_id) { toast.error('Select a Class and Subject first'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/quizzes/generate-from-bank', {
        ...form, item_ids: selectedIds,
      });
      toast.success(`Quiz "${form.title}" generated with ${data.question_count} question(s)`);
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to generate quiz'); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 460 }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3><Sparkles size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Generate Quiz from Bank</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="text-sm text-dim" style={{ marginBottom: 14 }}>{selectedIds.length} question(s) selected from "{bank.name}"</div>
        <div className="field"><label>Quiz Title</label><input className="input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}>
            <label>Class</label>
            <select className="input" required value={form.class_level} onChange={e => setForm({ ...form, class_level: e.target.value, subject_id: '' })}>
              <option value="">Select class</option>
              {allowedClasses.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Subject</label>
            <select className="input" required disabled={!form.class_level} value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value })}>
              <option value="">{form.class_level ? 'Select subject' : 'Select a Class first'}</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="field" style={{ flex: 1 }}><label>Time Limit (min)</label><input className="input" type="number" min={1} value={form.time_limit_min} onChange={e => setForm({ ...form, time_limit_min: Number(e.target.value) })} /></div>
          <div className="field" style={{ flex: 1 }}>
            <label>Publish</label>
            <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="published">Publish immediately</option>
              <option value="draft">Save as draft</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={form.shuffle_questions} onChange={e => setForm({ ...form, shuffle_questions: e.target.checked })} /> Shuffle question order per student
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Generating...' : 'Generate Quiz'}</button>
        </div>
      </form>
    </Modal>
  );
}

function BankDetail({ bank, onClose, onBankChanged }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (difficultyFilter) params.set('difficulty', difficultyFilter);
    if (topicFilter) params.set('topic', topicFilter);
    api.get(`/quizzes/question-banks/${bank.id}/items?${params.toString()}`).then(({ data }) => setItems(data.items));
  };
  useEffect(() => { load(); }, [bank.id, search, difficultyFilter, topicFilter]);

  const toggleSelect = (id) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAll = () => setSelected(new Set(items.map(i => i.id)));
  const clearSelection = () => setSelected(new Set());

  const removeItem = async () => {
    const item = confirmDeleteItem;
    setConfirmDeleteItem(null);
    try {
      await api.delete(`/quizzes/question-bank-items/${item.id}`);
      toast.success('Question removed');
      load();
      onBankChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete'); }
  };

  const topics = [...new Set(items.map(i => i.topic).filter(Boolean))];

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
          <h3><BookMarked size={16} style={{ verticalAlign: -2, marginRight: 6 }} />{bank.name}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {bank.description && <p className="text-sm text-dim" style={{ marginBottom: 12 }}>{bank.description}</p>}

        <div className="flex gap-2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(v => !v)}><Plus size={13} /> Add Question</button>
          <button className="btn btn-outline btn-sm" onClick={() => setShowImport(true)}><Upload size={13} /> Bulk Import (CSV / Paste)</button>
          <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={() => setShowGenerate(true)}>
            <Sparkles size={13} /> Generate Quiz ({selected.size} selected)
          </button>
        </div>

        {showAdd && <AddQuestionForm bankId={bank.id} onAdded={() => { load(); onBankChanged(); setShowAdd(false); }} />}

        <div className="flex gap-2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-dim)' }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search questions..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input" style={{ width: 140 }} value={difficultyFilter} onChange={e => setDifficultyFilter(e.target.value)}>
            <option value="">All Difficulties</option>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
          </select>
          {topics.length > 0 && (
            <select className="input" style={{ width: 160 }} value={topicFilter} onChange={e => setTopicFilter(e.target.value)}>
              <option value="">All Topics</option>
              {topics.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button className="btn-ghost btn-sm" onClick={selectAll}><CheckSquare size={13} /> Select All</button>
          <button className="btn-ghost btn-sm" onClick={clearSelection}><Square size={13} /> Clear</button>
        </div>

        <div className="flex-col gap-2">
          {items.map(i => (
            <div key={i.id} className="card card-pad flex items-start gap-3" style={{ background: 'var(--surface-2)' }}>
              <button type="button" className="btn-ghost" style={{ padding: 4, marginTop: 2 }} onClick={() => toggleSelect(i.id)}>
                {selected.has(i.id) ? <CheckSquare size={17} color="var(--primary)" /> : <Square size={17} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
                  <span className={`badge ${DIFF_BADGE[i.difficulty] || 'badge-gray'}`}>{i.difficulty}</span>
                  <span className="badge badge-gray">{QUESTION_TYPES.find(([v]) => v === i.qtype)?.[1] || i.qtype}</span>
                  {i.topic && <span className="badge badge-purple">{i.topic}</span>}
                  <span className="text-xs text-dim">{i.points} pt(s)</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{i.question}</div>
                {i.qtype === 'mcq' && i.options && (
                  <div className="text-xs text-dim" style={{ marginTop: 4 }}>
                    {i.options.map((o, idx) => (
                      <span key={idx} style={{ marginRight: 10, color: o === i.correct_answer?.option ? 'var(--knowledge)' : undefined, fontWeight: o === i.correct_answer?.option ? 700 : 400 }}>
                        {o === i.correct_answer?.option ? '✓ ' : ''}{o}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmDeleteItem(i)}><Trash2 size={14} color="var(--danger)" /></button>
            </div>
          ))}
          {items.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No questions in this bank yet — add one or bulk import.</div>}
        </div>
      </div>

      {showImport && <ImportModal bankId={bank.id} onClose={() => setShowImport(false)} onImported={() => { load(); onBankChanged(); }} />}
      {showGenerate && (
        <GenerateQuizModal
          bank={bank} selectedIds={[...selected]}
          onClose={() => setShowGenerate(false)}
          onDone={() => { setShowGenerate(false); clearSelection(); }}
        />
      )}
      {confirmDeleteItem && (
        <ConfirmDialog
          title="Remove this question?"
          message="It will be removed from this bank permanently."
          confirmLabel="Remove"
          onConfirm={removeItem}
          onCancel={() => setConfirmDeleteItem(null)}
        />
      )}
    </Modal>
  );
}

export default function QuestionBanks() {
  const toast = useToast();
  const [banks, setBanks] = useState([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    api.get(`/quizzes/question-banks?${params.toString()}`).then(({ data }) => setBanks(data.banks));
  };
  useEffect(() => { load(); }, [search]);

  const duplicate = async (bank) => {
    try {
      await api.post(`/quizzes/question-banks/${bank.id}/duplicate`);
      toast.success(`"${bank.name}" duplicated`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to duplicate'); }
  };

  const doDelete = async () => {
    const bank = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.delete(`/quizzes/question-banks/${bank.id}`);
      toast.success(`"${bank.name}" and all its questions deleted`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete'); }
  };

  return (
    <AppLayout title="Question Banks" subtitle="Create unlimited named question banks, bulk import, and generate quizzes from them">
      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search banks..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New Question Bank</button>
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {banks.map(b => (
          <div key={b.id} className="card card-pad flex-col gap-2">
            <div className="flex items-start justify-between">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookMarked size={16} color="var(--primary)" />
              </div>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => duplicate(b)} title="Duplicate bank"><Copy size={14} /></button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(b)} title="Delete bank"><Trash2 size={14} color="var(--danger)" /></button>
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</div>
            <div className="text-xs text-dim" style={{ minHeight: 32 }}>{b.description || 'No description'}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge badge-purple">{b.question_count} question{b.question_count === 1 ? '' : 's'}</span>
              {b.class_level && <span className="badge badge-gray">Class {b.class_level}</span>}
              {b.subject_name && <span className="badge badge-gray">{b.subject_name}</span>}
            </div>
            <button className="btn btn-outline btn-block btn-sm" style={{ marginTop: 6 }} onClick={() => setViewing(b)}>Open Bank</button>
          </div>
        ))}
        {banks.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30, gridColumn: '1 / -1' }}>No question banks yet — create one to get started.</div>}
      </div>

      {creating && <CreateBankModal onClose={() => setCreating(false)} onSaved={(b) => { setCreating(false); load(); setViewing(b); }} />}
      {viewing && <BankDetail bank={viewing} onClose={() => setViewing(null)} onBankChanged={load} />}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          message="This permanently deletes the bank and every question inside it. Quizzes already generated from it are unaffected."
          confirmLabel="Delete Bank"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppLayout>
  );
}
