import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, Wallet } from 'lucide-react';
import api from '../../api/client.js';

// Amounts arrive as integer paisa. Show NPR with Nepali grouping, for example NPR 1,00,000.00.
export function formatNPR(paisa) {
  const rupees = Number(paisa || 0) / 100;
  return `NPR ${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Shows each child's credit balance and any unread fee notices (for example an overpayment notice).
// Renders nothing when there is nothing to show, so the dashboard stays unchanged for most families.
export default function FeeAlerts() {
  const [children, setChildren] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => (
    api.get('/guardian/fees/alerts')
      .then(({ data }) => setChildren(data.children || []))
      .catch(() => setChildren([]))
  ), []);

  useEffect(() => { load(); }, [load]);

  async function markSeen(id) {
    setBusy(id);
    setError('');
    try {
      await api.post(`/guardian/fees/notices/${id}/seen`, {});
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark this notice as read. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const visible = (children || []).filter(c => c.notices.length > 0 || c.credit_balance_paisa > 0);
  if (visible.length === 0 && !error) return null;

  return (
    <section aria-label="Fee account updates" style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {visible.map(c => (
        <div key={c.student_id} className="card card-pad" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="text-dim text-sm">Fee account for</div>
              <div style={{ fontWeight: 600 }}>{c.name || 'your child'}</div>
            </div>
            {c.credit_balance_paisa > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div className="text-dim" style={{ fontSize: 11.5 }}>Credit on account</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent)' }}>
                  <Wallet size={14} aria-hidden="true" /> {formatNPR(c.credit_balance_paisa)}
                </div>
              </div>
            )}
          </div>
          {c.notices.map(n => (
            <div
              key={n.id}
              role="status"
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 8, background: 'var(--surface-2, #f5f7fa)' }}
            >
              <BellRing size={16} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div style={{ flex: 1 }}>{n.message}</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => markSeen(n.id)}
                disabled={busy === n.id}
                aria-label={`Mark this notice for ${c.name || 'your child'} as read`}
              >
                <Check size={14} /> Got it
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
