import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { formatNPR } from '../../utils/money.js';

const STATUS_LABEL = {
  pending: { text: 'Awaiting sign-off', color: 'var(--warning)' },
  returned: { text: 'Returned to finance', color: 'var(--danger)' },
  signed_off: { text: 'Signed off', color: 'var(--accent)' },
};

const FILTERS = [
  { id: 'open', label: 'Needs action' },
  { id: 'all', label: 'All days' },
  { id: 'signed_off', label: 'Signed off' },
];

function errorText(err, fallback) {
  return err.response?.data?.error || fallback;
}

function Figure({ label, value }) {
  return (
    <div>
      <div className="text-dim" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function SignoffCard({ row, focused, note, onNote, onDecide, busy }) {
  const s = row.summary || {};
  const status = STATUS_LABEL[row.status] || { text: row.status, color: 'var(--text-dim)' };
  const open = row.status !== 'signed_off';
  const outstanding = row.open_exceptions > 0 || row.pending_verifications > 0;
  return (
    <section
      id={`signoff-${row.reconciled_date}`}
      aria-label={`Fee audit for ${row.reconciled_date}`}
      className="card card-pad"
      style={{ display: 'grid', gap: 12, outline: focused ? '2px solid var(--accent)' : 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Fees for {row.reconciled_date}</div>
          <div className="text-dim text-sm">Reconciled by the job that ran on {row.run_date}. All amounts in NPR.</div>
        </div>
        <div style={{ fontWeight: 600, color: status.color }}>{status.text}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        <Figure label="Collected" value={`${formatNPR(row.payments_paisa)} (${row.payments_count})`} />
        <Figure label="Refunds" value={formatNPR(-row.refunds_paisa)} />
        <Figure label="Concessions approved" value={`${formatNPR(s.concessions_approved_paisa || 0)} (${s.concessions_approved || 0})`} />
        <Figure label="Mismatched transactions" value={row.mismatches} />
        <Figure label="Open exceptions" value={row.open_exceptions} />
        <Figure label="Awaiting verification" value={row.pending_verifications} />
        <Figure label="Overpayments" value={row.overpayments} />
        <Figure label="Automatic refunds" value={row.automatic_refunds} />
      </div>

      {!open && (
        <p className="text-sm text-dim" style={{ margin: 0 }}>
          {row.status === 'signed_off' ? 'Signed off' : 'Returned'} by {row.decided_by_emp_no || 'a staff member'}
          {row.decided_at ? ` on ${row.decided_at}` : ''}.{row.decision_note ? ` Note: ${row.decision_note}` : ''}
        </p>
      )}

      {open && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label className="text-sm" htmlFor={`note-${row.id}`}>
            Note {outstanding ? '(required to sign off, because items are open; required to return)' : '(required to return)'}
          </label>
          <textarea
            id={`note-${row.id}`}
            value={note}
            onChange={e => onNote(row.id, e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="For example: reviewed the open items with the bursar"
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecide(row, 'sign_off')}>
              <CheckCircle2 size={14} /> Sign off
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onDecide(row, 'return')}>
              <RotateCcw size={14} /> Return to finance
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function FeeSignoff() {
  const [params] = useSearchParams();
  const focusDate = params.get('date');
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState(focusDate ? 'all' : 'open');
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => (
    api.get('/fees/signoffs')
      .then(({ data }) => { setRows(data.signoffs); setError(''); })
      .catch(err => setError(errorText(err, 'Could not load the daily fee audits.')))
  ), []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!focusDate || !rows) return;
    document.getElementById(`signoff-${focusDate}`)?.scrollIntoView({ block: 'center' });
  }, [focusDate, rows]);

  async function decide(row, decision) {
    const note = (notes[row.id] || '').trim();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post(`/fees/signoffs/${row.id}/decision`, { decision, note });
      setNotes(n => ({ ...n, [row.id]: '' }));
      setMessage(decision === 'sign_off' ? `Signed off the fees for ${row.reconciled_date}.` : `Returned the fees for ${row.reconciled_date} to finance.`);
      await load();
    } catch (err) {
      setError(errorText(err, 'The decision was not recorded. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const visible = (rows || []).filter(r => {
    if (filter === 'all') return true;
    if (filter === 'signed_off') return r.status === 'signed_off';
    return r.status !== 'signed_off';
  });

  return (
    <AppLayout title="Daily fee sign-off" subtitle="The Finance Manager signs off each day's fee audit after the reconciliation job runs">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {message && <p role="status" style={{ color: 'var(--accent)' }}>{message}</p>}
      {rows === null && !error && <p className="text-dim">Loading...</p>}
      {rows && visible.length === 0 && (
        <div className="card card-pad">
          <p className="text-dim" style={{ margin: 0 }}>
            {filter === 'open' ? 'Nothing needs sign-off. Each morning the reconciliation job adds the previous day here.' : 'No daily audits to show.'}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {visible.map(row => (
          <SignoffCard
            key={row.id}
            row={row}
            focused={row.reconciled_date === focusDate}
            note={notes[row.id] || ''}
            onNote={(id, value) => setNotes(n => ({ ...n, [id]: value }))}
            onDecide={decide}
            busy={busy}
          />
        ))}
      </div>
    </AppLayout>
  );
}
