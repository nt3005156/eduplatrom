import { useCallback, useEffect, useState } from 'react';
import { Search, Check, X, GitCompare, History, Archive, ArchiveRestore } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];
const STATUS_TABS = [
  ['', 'Active / Valid'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['archived', 'Archived'],
];

function RejectModal({ application, onClose, onDone }) {
  const toast = useToast();
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/applications/reasons').then(({ data }) => { setReasons(data.reasons); setReason(data.reasons[0]); }); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/applications/${application.id}/reject`, { reason, comments });
      toast.success('Application rejected — the record is kept permanently for history.');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject');
    } finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 440 }}>
        <h3 style={{ marginBottom: 14 }}>Reject Application</h3>
        <div className="field"><label>Reason</label>
          <select className="input" value={reason} onChange={e => setReason(e.target.value)}>
            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}><label>Reviewer Comments (optional)</label><textarea className="input" value={comments} onChange={e => setComments(e.target.value)} /></div>
        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={onClose}>Cancel</button>
          <button className="btn btn-block" style={{ background: 'var(--danger)', color: '#fff' }} disabled={saving}>{saving ? 'Rejecting...' : 'Reject'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CompareModal({ applicantUserId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/applications/compare/${applicantUserId}`).then(({ data }) => setData(data)); }, [applicantUserId]);

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3><GitCompare size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Version Comparison</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!data ? <div className="text-dim text-sm">Loading...</div> : (
          <div className="flex-col gap-3">
            <div className="text-xs text-dim">Comparing v{data.from?.version ?? '—'} → v{data.to.version}</div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--surface-2)' }}>
                  <th className="text-xs text-dim" style={{ padding: 10, textAlign: 'left' }}>Field</th>
                  <th className="text-xs text-dim" style={{ padding: 10, textAlign: 'left' }}>Before</th>
                  <th className="text-xs text-dim" style={{ padding: 10, textAlign: 'left' }}>After</th>
                </tr></thead>
                <tbody>
                  {data.fieldDiffs.map(f => (
                    <tr key={f.field} style={{ borderTop: '1px solid var(--border)', background: f.changed ? 'rgba(var(--flame-rgb),.08)' : undefined }}>
                      <td className="text-sm" style={{ padding: 10, fontWeight: 600 }}>{f.field}</td>
                      <td className="text-sm text-dim" style={{ padding: 10 }}>{f.before == null ? '—' : String(f.before)}</td>
                      <td className="text-sm" style={{ padding: 10, fontWeight: f.changed ? 700 : 400, color: f.changed ? 'var(--flame)' : undefined }}>{f.after == null ? '—' : String(f.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.addedDocs.length > 0 || data.removedDocs.length > 0) && (
              <div className="card card-pad">
                <div className="text-xs text-dim" style={{ fontWeight: 700, marginBottom: 8 }}>DOCUMENT CHANGES</div>
                {data.addedDocs.map(d => <div key={d.name} className="text-sm" style={{ color: 'var(--knowledge)' }}>+ Added: {d.name}</div>)}
                {data.removedDocs.map(d => <div key={d.name} className="text-sm" style={{ color: 'var(--danger)' }}>− Removed: {d.name}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function HistoryModal({ applicantUserId, onClose }) {
  const [history, setHistory] = useState(null);
  useEffect(() => { api.get(`/applications/history/${applicantUserId}`).then(({ data }) => setHistory(data.history)); }, [applicantUserId]);

  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
          <h3><History size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Full Application History</h3>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        {!history ? <div className="text-dim text-sm">Loading...</div> : (
          <div className="flex-col gap-3">
            {history.map(h => (
              <div key={h.id} className="card card-pad" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 700 }}>Version {h.version}</span>
                  <span className={`badge ${h.status === 'approved' ? 'badge-green' : h.status === 'rejected' ? 'badge-red' : 'badge-orange'}`}>{h.status}</span>
                </div>
                <div className="text-xs text-dim">{new Date(h.created_at).toLocaleString()}</div>
                {h.status === 'rejected' && <div className="text-sm" style={{ marginTop: 6, color: 'var(--danger)' }}>Reason: {h.rejection_reason}{h.reviewer_comments ? ` — ${h.reviewer_comments}` : ''}</div>}
                {h.reviewer_name && <div className="text-xs text-dim" style={{ marginTop: 4 }}>Reviewed by {h.reviewer_name}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Registry() {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [applications, setApplications] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const [comparing, setComparing] = useState(null);
  const [viewingHistory, setViewingHistory] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (classFilter) params.set('class_level', classFilter);
    if (search) params.set('search', search);
    api.get(`/applications?${params.toString()}`).then(({ data }) => setApplications(data.applications));
  }, [statusFilter, classFilter, search]);
  useEffect(() => { load(); }, [load]);

  const approve = async (app) => {
    try {
      await api.put(`/applications/${app.id}/approve`);
      toast.success(`${app.applicant_name}'s application approved`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const doArchive = async () => {
    const app = confirmArchive;
    setConfirmArchive(null);
    try {
      const endpoint = app.applicant_account_status === 'archived' ? 'unarchive' : 'archive';
      await api.put(`/users/${app.applicant_user_id}/${endpoint}`);
      toast.success(`Account ${endpoint === 'archive' ? 'archived' : 'restored'}`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <AppLayout title="Registry" subtitle="Applications registry — active records by default; rejected/archived only shown when explicitly filtered">
      <div className="flex gap-2" style={{ marginBottom: 14, overflowX: 'auto' }}>
        {STATUS_TABS.map(([val, label]) => (
          <button key={val} className="btn-sm" onClick={() => setStatusFilter(val)}
            style={{
              padding: '8px 16px', borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 700,
              border: statusFilter === val ? 'none' : '1.5px solid var(--border)',
              background: statusFilter === val ? 'linear-gradient(135deg, var(--flame), #ff8a4c)' : 'var(--surface)',
              color: statusFilter === val ? '#241407' : 'var(--text)',
            }}>{label}</button>
        ))}
      </div>

      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 150 }} value={classFilter} onChange={e => setClassFilter(e.target.value)}>
          <option value="">All Classes</option>
          {CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
        </select>
      </div>

      <div className="flex-col gap-2">
        {applications.map(app => (
          <div key={app.id} className="card card-pad flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <div style={{ fontWeight: 700 }}>{app.applicant_name}</div>
                <span className="badge badge-gray">v{app.version}</span>
                <span className={`badge ${app.status === 'approved' ? 'badge-green' : app.status === 'rejected' ? 'badge-red' : 'badge-orange'}`}>{app.status}</span>
                {app.applicant_account_status === 'archived' && <span className="badge badge-gray"><Archive size={10} /> Archived</span>}
                <span className="badge badge-purple">Class {app.applicant_class}</span>
              </div>
              <div className="text-sm text-dim">{app.applicant_email} • Submitted {new Date(app.created_at).toLocaleDateString()}</div>
              {app.status === 'rejected' && <div className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>Reason: {app.rejection_reason}</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {app.status === 'submitted' && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => approve(app)}><Check size={13} /> Approve</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setRejecting(app)}><X size={13} /> Reject</button>
                </>
              )}
              {app.version > 1 && <button className="btn btn-outline btn-sm" onClick={() => setComparing(app.applicant_user_id)}><GitCompare size={13} /> Compare</button>}
              <button className="btn-ghost btn-sm" onClick={() => setViewingHistory(app.applicant_user_id)}><History size={13} /></button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmArchive(app)}>
                {app.applicant_account_status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </div>
          </div>
        ))}
        {applications.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 30 }}>No applications found for this filter.</div>}
      </div>

      {rejecting && <RejectModal application={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}
      {comparing && <CompareModal applicantUserId={comparing} onClose={() => setComparing(null)} />}
      {viewingHistory && <HistoryModal applicantUserId={viewingHistory} onClose={() => setViewingHistory(null)} />}
      {confirmArchive && (
        <ConfirmDialog
          title={confirmArchive.applicant_account_status === 'archived' ? 'Restore this account?' : 'Archive this account?'}
          message={confirmArchive.applicant_account_status === 'archived' ? 'This will make the account active again.' : 'The account and its history are kept — this just removes it from the default Registry view.'}
          confirmLabel={confirmArchive.applicant_account_status === 'archived' ? 'Restore' : 'Archive'}
          danger={false}
          onConfirm={doArchive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </AppLayout>
  );
}
