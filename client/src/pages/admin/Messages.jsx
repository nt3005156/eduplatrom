import { useCallback, useEffect, useState } from 'react';
import { Send, Play, Ban, Trash2, RefreshCw } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const CHANNELS = [
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
];
const LANGS = [{ v: 'en', l: 'English' }, { v: 'ne', l: 'Nepali (नेपाली)' }, { v: 'both', l: 'English and Nepali' }];
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function Settings({ config, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(config), [config]);
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/messages/config', form);
      onSaved(data.config);
      toast.success('Alert settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save settings');
    } finally { setSaving(false); }
  };
  const toggle = (k, label) => (
    <label className="flex items-center gap-2" style={{ marginBottom: 8 }}>
      <input type="checkbox" checked={!!form[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 10 }}>Parent alert settings</h3>
      <p className="text-dim text-sm" style={{ marginBottom: 12 }}>Alerts are off until you turn them on. When alerts are off, nothing is sent and nothing is queued for absence or late alerts.</p>
      {toggle('alerts_enabled', 'Send attendance alerts to parents (master switch)')}
      {toggle('sms_enabled', 'SMS')}
      {toggle('whatsapp_enabled', 'WhatsApp')}
      {toggle('email_enabled', 'Email')}
      <div className="field"><label htmlFor="m-lang">Language of alerts</label>
        <select id="m-lang" className="input" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
          {LANGS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {CHANNELS.map(c => (
          <div className="field" key={c.key} style={{ marginBottom: 0 }}>
            <label htmlFor={`q-${c.key}`}>{c.label} monthly limit</label>
            <input id={`q-${c.key}`} className="input" type="number" min={0} max={10000000} value={form[`${c.key}_monthly_quota`]}
              onChange={e => setForm({ ...form, [`${c.key}_monthly_quota`]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
    </div>
  );
}

function Summary({ summary, onProcess, processing }) {
  if (!summary) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <h3>This month and last {summary.days} days</h3>
        <button className="btn btn-outline btn-sm" onClick={onProcess} disabled={processing}><Play size={14} /> {processing ? 'Sending...' : 'Send queued now'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {CHANNELS.map(c => {
          const u = summary.usage_this_month[c.key];
          const s = summary.channels[c.key];
          const pct = u.quota ? Math.min(100, Math.round((u.messages / u.quota) * 100)) : 0;
          return (
            <div key={c.key} className="card card-pad" style={{ padding: 12 }}>
              <div className="text-dim text-sm">{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{u.messages} <span className="text-dim text-sm">of {u.quota} sent</span></div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, marginTop: 6 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary, #4f46e5)', borderRadius: 4 }} />
              </div>
              <div className="text-dim text-sm" style={{ marginTop: 8 }}>
                Delivery rate: {s.delivery_rate === null ? 'no data yet' : `${s.delivery_rate}%`}
              </div>
              <div className="text-dim text-sm">{Object.entries(s.by_status).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No messages yet'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NoticeForm({ onSent }) {
  const toast = useToast();
  const [form, setForm] = useState({ class_level: '', section: '', title: '', body: '', channels: ['sms'] });
  const [key, setKey] = useState(newKey);
  const [sending, setSending] = useState(false);
  const toggleChannel = (c) => setForm({ ...form, channels: form.channels.includes(c) ? form.channels.filter(x => x !== c) : [...form.channels, c] });
  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data } = await api.post('/messages/notices', { ...form, class_level: Number(form.class_level), section: form.section || null, idempotency_key: key });
      toast.success(`Queued ${data.queued} message(s) to ${data.guardians} guardian(s)`);
      setKey(newKey());
      setForm({ ...form, title: '', body: '' });
      onSent();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not queue the notice');
    } finally { setSending(false); }
  };
  return (
    <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={send}>
      <h3 style={{ marginBottom: 6 }}>Send a notice to a class</h3>
      <p className="text-dim text-sm" style={{ marginBottom: 12 }}>Goes to guardians of children in the class who may receive messages. Do not put marks or private details in a notice.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="n-class">Class</label>
          <select id="n-class" className="input" required value={form.class_level} onChange={e => setForm({ ...form, class_level: e.target.value })}>
            <option value="">Choose</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(c => <option key={c} value={c}>Class {c}</option>)}
          </select></div>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="n-section">Section (optional)</label>
          <input id="n-section" className="input" maxLength={5} value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="n-title">Title</label>
        <input id="n-title" className="input" required minLength={3} maxLength={100} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
      <div className="field"><label htmlFor="n-body">Message ({form.body.length}/480)</label>
        <textarea id="n-body" className="input" required minLength={3} maxLength={480} rows={3} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {CHANNELS.map(c => (
          <label key={c.key} className="flex items-center gap-2"><input type="checkbox" checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} /> {c.label}</label>
        ))}
      </div>
      <button className="btn btn-primary" disabled={sending || form.channels.length === 0}><Send size={14} /> {sending ? 'Queuing...' : 'Queue notice'}</button>
    </form>
  );
}

function OptOuts() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ channel: 'sms', recipient: '' });
  const load = useCallback(() => api.get('/messages/optouts').then(({ data }) => setRows(data.optouts)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/messages/optouts', form); setForm({ ...form, recipient: '' }); load(); toast.success('Opt-out added'); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not add opt-out'); }
  };
  const remove = async (r) => {
    try { await api.delete('/messages/optouts', { params: { channel: r.channel, recipient: r.recipient } }); load(); }
    catch { toast.error('Could not remove opt-out'); }
  };
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 6 }}>Opt-outs</h3>
      <p className="text-dim text-sm" style={{ marginBottom: 10 }}>Addresses listed here never receive messages on that channel. Add one when a parent asks to stop.</p>
      <form className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 12 }} onSubmit={add}>
        <select className="input" style={{ width: 130 }} value={form.channel} aria-label="Channel" onChange={e => setForm({ ...form, channel: e.target.value })}>
          {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Phone (98…) or email" aria-label="Recipient" value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} required />
        <button className="btn btn-outline"><Ban size={14} /> Add opt-out</button>
      </form>
      {rows.length === 0 ? <p className="text-dim text-sm">No opt-outs.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map(r => (
            <li key={`${r.channel}-${r.recipient}`} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{r.recipient} <span className="text-dim text-sm">({r.channel})</span></span>
              <button className="btn-ghost" aria-label={`Remove opt-out for ${r.recipient}`} onClick={() => remove(r)}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Recent({ refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/messages', { params: { limit: 50 } }).then(({ data }) => setRows(data.messages)).catch(() => setRows([])); }, [refreshKey]);
  if (!rows) return null;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h3 className="card-pad" style={{ paddingBottom: 0 }}>Recent messages</h3>
      {rows.length === 0 ? <p className="card-pad text-dim text-sm">Nothing sent or queued yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}>
            <th style={{ padding: '10px 12px' }}>When</th><th>Channel</th><th>To</th><th>Status</th><th>Note</th>
          </tr></thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{m.created_at}</td>
                <td>{m.channel}</td>
                <td>{m.recipient || <span className="text-dim">no contact</span>}</td>
                <td>{m.status}</td>
                <td className="text-dim" style={{ maxWidth: 280 }}>{m.last_error || m.body?.slice(0, 80)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const MODE_TEXT = {
  log: 'Simulated: nothing is sent',
  none: 'Not set up: messages are held',
  sparrow: 'Sparrow SMS (Nepal)',
  cloud: 'WhatsApp Cloud API',
  smtp: 'SMTP email',
};

function Providers({ status }) {
  if (!status) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 10 }}>Providers</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {[['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']].map(([k, label]) => {
          const p = status[k];
          const live = p.mode !== 'log' && p.mode !== 'none';
          return (
            <div key={k} className="card card-pad" style={{ padding: 12 }}>
              <div className="text-dim text-sm">{label}</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{MODE_TEXT[p.mode] || p.mode}</div>
              <div className="text-sm" style={{ marginTop: 6, color: p.configured ? '#00b894' : 'var(--text-dim)' }}>
                {p.configured ? (live ? 'Settings present' : 'Ready') : 'Settings missing (see server settings)'}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-dim text-sm" style={{ marginTop: 10 }}>Provider secrets are set on the server and are never shown here.</p>
    </div>
  );
}

function TestSend() {
  const toast = useToast();
  const [form, setForm] = useState({ channel: 'sms', recipient: '' });
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data } = await api.post('/messages/test', form);
      setResult(data);
      if (data.status === 'failed') toast.error(data.error || 'The test message failed');
      else toast.success(data.status === 'simulated' ? 'Simulated: nothing was sent to a real device' : 'Test message sent');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the test message');
    } finally { setSending(false); }
  };
  return (
    <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={send}>
      <h3 style={{ marginBottom: 6 }}>Send a test message</h3>
      <p className="text-dim text-sm" style={{ marginBottom: 10 }}>Check a provider before a pilot. Use your own number or address. This is not stored as an alert.</p>
      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 130 }} value={form.channel} aria-label="Test channel" onChange={e => setForm({ ...form, channel: e.target.value })}>
          {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 200 }} required placeholder={form.channel === 'email' ? 'name@example.com' : '98XXXXXXXX or +977…'} aria-label="Test recipient" value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} />
        <button className="btn btn-outline" disabled={sending}><Send size={14} /> {sending ? 'Sending...' : 'Send test'}</button>
      </div>
      {result && (
        <div className="text-sm" style={{ marginTop: 10 }}>
          Result: <b>{result.status}</b>{result.provider_message_id ? ` · id ${result.provider_message_id}` : ''}{result.error ? ` · ${result.error}` : ''}
        </div>
      )}
    </form>
  );
}

export default function Messages() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [summary, setSummary] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    api.get('/messages/providers').then(({ data }) => setProviders(data)).catch(() => {});
  }, []);

  const loadSummary = useCallback(() => {
    api.get('/messages/summary', { params: { days: 30 } }).then(({ data }) => setSummary(data)).catch(() => {});
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    api.get('/messages/config').then(({ data }) => setConfig(data.config)).catch(() => toast.error('Could not load alert settings'));
    loadSummary();
  }, [loadSummary, toast]);

  const processNow = async () => {
    setProcessing(true);
    try {
      const { data } = await api.post('/messages/process');
      toast.success(data.paused ? 'Alerts are off. Turn them on to send.' : `Sent ${data.sent}, simulated ${data.simulated}, held ${data.held}, retried ${data.retried}, failed ${data.failed}`);
      loadSummary();
    } catch { toast.error('Could not send the queue'); }
    finally { setProcessing(false); }
  };

  return (
    <AppLayout title="Messages" subtitle="Parent alerts by SMS, WhatsApp, and email. Settings, delivery reports, notices, and opt-outs.">
      <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
        <span className="text-dim text-sm">Simulated messages are recorded but not sent until a provider is connected.</span>
        <button className="btn btn-outline btn-sm" onClick={loadSummary}><RefreshCw size={14} /> Refresh</button>
      </div>
      <Providers status={providers} />
      {config && <Settings config={config} onSaved={setConfig} />}
      <TestSend />
      <Summary summary={summary} onProcess={processNow} processing={processing} />
      <NoticeForm onSent={loadSummary} />
      <OptOuts />
      <Recent refreshKey={refreshKey} />
    </AppLayout>
  );
}
