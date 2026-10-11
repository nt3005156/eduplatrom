import { useState } from 'react';
import { Upload, Download, CheckCircle2, AlertTriangle, Copy } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const COLUMNS = [
  'name', 'email', 'class_level', 'section', 'roll_no', 'admission_no', 'gender', 'dob_ad', 'dob_bs',
  'blood_group', 'phone', 'address', 'iemis_id', 'neb_reg_no', 'emergency_contact_name', 'emergency_contact_phone',
  'guardian_name', 'guardian_email', 'guardian_phone', 'guardian_relationship',
];
const EXAMPLE = ['Asha Sharma', 'asha.sharma@school.example', '7', 'A', '12', 'ADM-2026-001', 'female', '2013-05-01', '2070-01-18',
  'B+', '9812345678', 'Kathmandu-10', '', '', 'Ram Sharma', '', 'Ram Sharma', 'ram.sharma@example.com', '9801234567', 'father'];

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');

export default function StudentImport() {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadFile = async (file) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { toast.error('This file is larger than 1.5 MB. Split it into smaller files.'); return; }
    setCsv(await file.text()); setReport(null); setResult(null);
  };

  const check = async () => {
    setBusy(true); setResult(null);
    try { const { data } = await api.post('/student-import/preview', { csv }); setReport(data); }
    catch (err) { setReport(null); toast.error(err.response?.data?.error || 'Could not read this file'); }
    finally { setBusy(false); }
  };

  const importNow = async () => {
    if (!window.confirm(`Import ${report.summary.total} student(s)? This cannot be undone from this screen.`)) return;
    setBusy(true);
    try { const { data } = await api.post('/student-import', { csv }); setResult(data); setReport(null); setCsv(''); toast.success('Import complete'); }
    catch (err) {
      toast.error(err.response?.data?.error || 'Import failed. Nothing was saved.');
      if (err.response?.data?.rows) setReport(err.response.data);
    } finally { setBusy(false); }
  };

  const linksCsv = () => {
    const lines = [['role', 'name', 'email', 'setup_link'].join(',')];
    result.setup_links.forEach(l => lines.push([l.role, l.name, l.email, l.setup_url].map(csvCell).join(',')));
    download('setup-links.csv', lines.join('\n'));
  };

  return (
    <AppLayout title="Import Students" subtitle="Add many students at once from a CSV file. The file is checked row by row before anything is saved.">
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <h4>1. Use the template</h4>
            <p className="text-dim text-sm">Required: name, email, class_level (6–12), section. Guardian columns are optional; siblings with the same guardian email share one guardian account.</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => download('nitex-student-import-template.csv', `${COLUMNS.join(',')}\n${EXAMPLE.map(csvCell).join(',')}\n`)}>
            <Download size={14} /> Download template
          </button>
        </div>

        <h4 style={{ marginBottom: 8 }}>2. Upload or paste</h4>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={e => loadFile(e.target.files?.[0])} style={{ marginBottom: 10 }} />
        <textarea className="input" rows={6} style={{ fontFamily: 'monospace', fontSize: 12.5 }} placeholder="name,email,class_level,section,..."
          value={csv} onChange={e => { setCsv(e.target.value); setReport(null); }} aria-label="CSV text" />
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={!csv.trim() || busy} onClick={check}><Upload size={15} /> {busy ? 'Checking...' : 'Check file'}</button>
        </div>
      </div>

      {report && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h4 style={{ marginBottom: 8 }}>3. Review</h4>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="badge badge-blue">{report.summary.total} rows</span>
            <span className="badge badge-green">{report.summary.valid} ready</span>
            {report.summary.invalid > 0 && <span className="badge badge-red">{report.summary.invalid} need fixing</span>}
            <span className="badge badge-purple">{report.summary.guardians_new} new guardian(s)</span>
            <span className="badge badge-gray">{report.summary.guardians_existing} existing guardian(s) linked</span>
          </div>
          {report.summary.invalid > 0 && <p style={{ color: 'var(--danger)', marginBottom: 10 }}><AlertTriangle size={15} style={{ verticalAlign: '-3px' }} /> Fix the rows below and check again. Nothing is imported until every row is ready.</p>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-dim)' }}><th style={{ padding: 6 }}>Row</th><th>Status</th><th>Name</th><th>Class</th><th>Email</th><th>Problems</th></tr></thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.row} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                    <td style={{ padding: 6 }}>{r.row}</td>
                    <td>{r.status === 'ok' ? <span className="badge badge-green">Ready</span> : <span className="badge badge-red">Fix</span>}</td>
                    <td>{r.data.name || '—'}</td>
                    <td>{r.data.class_level ? `${r.data.class_level}${r.data.section || ''}` : '—'}</td>
                    <td>{r.data.email || '—'}</td>
                    <td style={{ color: 'var(--danger)' }}>{[...r.errors, ...r.warnings.map(w => `Note: ${w}`)].join('; ') || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy || report.summary.invalid > 0 || report.summary.valid === 0} onClick={importNow}>
            <CheckCircle2 size={15} /> Import {report.summary.valid} student(s)
          </button>
        </div>
      )}

      {result && (
        <div className="card card-pad">
          <h4 style={{ marginBottom: 6 }}><CheckCircle2 size={16} color="var(--accent)" style={{ verticalAlign: '-3px' }} /> Imported</h4>
          <p className="text-dim text-sm" style={{ marginBottom: 10 }}>{result.created.students} student(s), {result.created.guardians} guardian account(s), {result.created.links} link(s). Each account gets a one-time link to choose a password. Links expire in {result.setup_expires_in_days} days.</p>
          <button className="btn btn-outline btn-sm" onClick={linksCsv}><Download size={14} /> Download setup links (CSV)</button>
          <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 12 }}>
            {result.setup_links.map(l => (
              <div key={l.email} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', fontSize: 13 }}>
                <span className="badge badge-gray" style={{ marginRight: 6 }}>{l.role}</span>
                <strong>{l.name}</strong> <span className="text-dim">{l.email}</span>
                <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                  <input className="input" readOnly value={l.setup_url} onFocus={e => e.target.select()} aria-label={`Setup link for ${l.name}`} style={{ fontSize: 11.5 }} />
                  <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(l.setup_url)}><Copy size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
