import { useEffect, useState, Fragment } from 'react';
import {
  ShieldCheck, Search, Download, ChevronLeft, ChevronRight, User, Globe, Monitor,
  LogIn, LogOut, XCircle, UserPlus, FileEdit, Trash2, CheckCircle2, Ban, Upload, PenSquare, Settings as SettingsIcon,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';

const ACTION_ICON = {
  login: LogIn, logout: LogOut, failed_login: XCircle,
  created: UserPlus, updated: FileEdit, deleted: Trash2,
  approved: CheckCircle2, rejected: Ban, submitted: Upload, resubmitted: Upload,
  graded: PenSquare, regraded: PenSquare, uploaded: Upload,
  attempt_completed: PenSquare, role_changed: SettingsIcon,
};

const MODULE_COLORS = {
  auth: 'var(--knowledge)', users: '#e84393', applications: 'var(--flame)',
  assignments: '#0984e3', quizzes: '#f0932b', content: 'var(--accent)', settings: 'var(--text-dim)',
};

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [facets, setFacets] = useState({ modules: [], actions: [], roles: [], statuses: [] });
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState('table'); // 'table' | 'timeline'

  useEffect(() => { api.get('/audit/facets').then(({ data }) => setFacets(data)); }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (moduleFilter) params.set('module', moduleFilter);
    if (actionFilter) params.set('action', actionFilter);
    if (roleFilter) params.set('role', roleFilter);
    if (statusFilter) params.set('status', statusFilter);
    params.set('page', page);
    api.get(`/audit?${params.toString()}`).then(({ data }) => {
      setLogs(data.logs);
      setPagination(data.pagination);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [search, moduleFilter, actionFilter, roleFilter, statusFilter, page]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (moduleFilter) params.set('module', moduleFilter);
    if (actionFilter) params.set('action', actionFilter);
    if (roleFilter) params.set('role', roleFilter);
    if (statusFilter) params.set('status', statusFilter);
    // Fetch as a blob so the session cookie is sent and the file can be saved.
    api.get(`/audit/export?${params.toString()}`, { responseType: 'blob' }).then(({ data }) => {
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'audit-log.csv';
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    });
  };

  return (
    <AppLayout title="Audit Log" subtitle="Complete history of every important action across the system">
      <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by user, description, module..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input" style={{ width: 160 }} value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(1); }}>
          <option value="">All Modules</option>
          {facets.modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          {facets.actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input" style={{ width: 140 }} value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
          <option value="">All Roles</option>
          {facets.roles.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
        </select>
        <select className="input" style={{ width: 140 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {facets.statuses.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
        </select>
        <div className="flex gap-1">
          <button type="button" className={view === 'table' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setView('table')}>Table</button>
          <button type="button" className={view === 'timeline' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setView('timeline')}>Timeline</button>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}><Download size={13} /> Export CSV</button>
      </div>

      {loading && <div className="flex-col gap-2"><Skeleton height={54} /><Skeleton height={54} /><Skeleton height={54} /><Skeleton height={54} /></div>}

      {!loading && logs.length === 0 && (
        <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 40 }}>
          <ShieldCheck size={26} style={{ opacity: .4, marginBottom: 10 }} />
          <div>No audit records match your filters.</div>
        </div>
      )}

      {!loading && logs.length > 0 && view === 'table' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                {['When', 'User', 'Module', 'Action', 'Description', 'Status', ''].map(h => (
                  <th key={h} className="text-xs text-dim" style={{ padding: '12px 16px', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(l => {
                const Icon = ACTION_ICON[l.action] || FileEdit;
                const isOpen = expanded === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : l.id)}>
                      <td className="text-xs text-dim mono" style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{timeAgo(l.created_at)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{l.user_name || 'System'}</div>
                        <div className="text-xs text-dim" style={{ textTransform: 'capitalize' }}>{l.user_role || '—'}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="badge badge-gray" style={{ color: MODULE_COLORS[l.module] || 'var(--text-dim)' }}>{l.module}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div className="flex items-center gap-1">
                          <Icon size={13} color={MODULE_COLORS[l.module] || 'var(--text-dim)'} />
                          <span className="text-sm" style={{ textTransform: 'capitalize' }}>{l.action.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="text-sm" style={{ padding: '12px 16px', maxWidth: 320 }}>{l.description}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className={`badge ${l.status === 'failure' ? 'badge-red' : 'badge-green'}`}>{l.status || 'success'}</span>
                      </td>
                      <td className="text-xs text-dim" style={{ padding: '12px 16px' }}>{isOpen ? '▲' : '▼'}</td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <td colSpan={7} style={{ padding: '14px 16px' }}>
                          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                            <div className="flex items-center gap-1 text-xs text-dim"><Globe size={12} /> IP: {l.ip_address || '—'}</div>
                            <div className="flex items-center gap-1 text-xs text-dim"><Monitor size={12} /> Device: {l.device || 'Unknown device'}</div>
                            <div className="flex items-center gap-1 text-xs text-dim"><User size={12} /> Full timestamp: {l.created_at}</div>
                          </div>
                          {(l.previous_value || l.new_value) && (
                            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
                              {l.previous_value && (
                                <div>
                                  <div className="text-xs" style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>BEFORE</div>
                                  <pre className="text-xs" style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, overflow: 'auto', margin: 0 }}>{JSON.stringify(JSON.parse(l.previous_value), null, 2)}</pre>
                                </div>
                              )}
                              {l.new_value && (
                                <div>
                                  <div className="text-xs" style={{ fontWeight: 700, color: 'var(--knowledge)', marginBottom: 4 }}>AFTER</div>
                                  <pre className="text-xs" style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, overflow: 'auto', margin: 0 }}>{JSON.stringify(JSON.parse(l.new_value), null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && logs.length > 0 && view === 'timeline' && (
        <div className="card card-pad">
          <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 10 }}>
            {logs.map(l => {
              const Icon = ACTION_ICON[l.action] || FileEdit;
              return (
                <div key={l.id} style={{ position: 'relative', paddingLeft: 24, paddingBottom: 20 }}>
                  <div style={{
                    position: 'absolute', left: -11, top: 0, width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--bg-card)', border: `2px solid ${MODULE_COLORS[l.module] || 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={11} color={MODULE_COLORS[l.module] || 'var(--text-dim)'} />
                  </div>
                  <div className="text-sm" style={{ fontWeight: 600 }}>{l.description}</div>
                  <div className="text-xs text-dim" style={{ marginTop: 2 }}>{l.user_name || 'System'} • {timeAgo(l.created_at)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between" style={{ marginTop: 16 }}>
          <span className="text-xs text-dim">Page {pagination.page} of {pagination.totalPages} • {pagination.total} total records</span>
          <div className="flex gap-2">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /> Prev</button>
            <button className="btn btn-outline btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
