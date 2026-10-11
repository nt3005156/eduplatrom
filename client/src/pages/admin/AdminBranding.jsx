import { useEffect, useState } from 'react';
import {
  Upload, Save, Palette, Image as ImageIcon, Globe2, Check, Type, LayoutGrid, Square,
  School, Clock, Calendar, Home, Mail, Bell, Eye, Building2,
} from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import { useSettings, HEADING_FONT_OPTIONS, BODY_FONT_OPTIONS } from '../../context/SettingsContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const COLOR_PRESETS = [
  ['#6C5CE7', '#00B894'], ['#0984E3', '#FDCB6E'], ['#E84393', '#00CEC9'],
  ['#E17055', '#0984E3'], ['#2D3436', '#00B894'], ['#6C5CE7', '#E17055'],
];

const LANGUAGES = [['en', 'English'], ['ne', 'Nepali'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French']];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const TIMEZONES = ['Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Dhaka', 'UTC', 'America/New_York', 'Europe/London'];

const TABS = [
  { id: 'general', label: 'General', icon: ImageIcon },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'school', label: 'School Info', icon: School },
  { id: 'localization', label: 'Localization', icon: Clock },
  { id: 'homepage', label: 'Homepage', icon: Home },
  { id: 'notifications', label: 'Email & Notifications', icon: Bell },
];

function ImageUploadField({ label, value, onChange, icon: Icon }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/settings/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(data.url);
    } finally { setUploading(false); }
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="flex items-center gap-2">
        <div style={{
          width: 52, height: 52, borderRadius: 12, border: '1.5px dashed var(--border)', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        }}>
          {value ? <img src={value} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon size={20} color="var(--text-faint)" />}
        </div>
        <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        </label>
        {value && <button type="button" className="btn-ghost btn-sm" onClick={() => onChange('')}>Remove</button>}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        {hint && <div className="text-xs text-dim" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        style={{
          width: 42, height: 24, borderRadius: 999, border: 'none', position: 'relative', flexShrink: 0,
          background: checked ? 'var(--primary)' : 'var(--surface-2)', transition: 'background .2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }} />
      </button>
    </div>
  );
}

function BrandingPreview({ form }) {
  return (
    <div className="card card-pad" style={{ position: 'sticky', top: 90 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
        <Eye size={16} color="var(--primary)" />
        <h3 style={{ fontSize: 15 }}>Live Preview</h3>
      </div>
      <div style={{
        borderRadius: form.corner_style === 'sharp' ? 6 : 14, overflow: 'hidden', border: '1px solid var(--border)',
      }}>
        <div style={{
          padding: 16, background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 34, height: 34, borderRadius: form.corner_style === 'sharp' ? 6 : 10, background: 'rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {form.logo_url ? <img src={form.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Building2 size={18} color="#fff" />}
          </div>
          <div style={{ color: '#fff', fontFamily: `'${form.font_family}', serif`, fontWeight: 700, fontSize: 16 }}>
            {form.school_name || form.site_name || 'Your School'}
          </div>
        </div>
        <div style={{ padding: 16, background: 'var(--surface)' }}>
          <div style={{ fontFamily: `'${form.body_font}', sans-serif`, fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
            {form.homepage_headline || form.tagline || 'A modern learning experience for every student.'}
          </div>
          <button
            type="button"
            style={{
              padding: '8px 16px', borderRadius: form.corner_style === 'sharp' ? 6 : 999, border: 'none',
              background: form.primary_color, color: '#fff', fontSize: 12.5, fontWeight: 700,
            }}
          >
            Sample Button
          </button>
        </div>
      </div>
      <div className="text-xs text-dim" style={{ marginTop: 12, lineHeight: 1.6 }}>
        This preview reflects your logo, colors, fonts, and corner style. Save changes to apply them sitewide.
      </div>
    </div>
  );
}

export default function AdminBranding() {
  const { settings: liveSettings, refreshSettings } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (liveSettings) setForm(liveSettings); }, [liveSettings]);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.put('/settings', form);
      refreshSettings();
      setSaved(true);
      toast.success('Settings updated successfully!');
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally { setSaving(false); }
  };

  if (!form) return <AppLayout title="Branding & Site Settings"><div className="text-dim">Loading...</div></AppLayout>;

  return (
    <AppLayout title="Branding & Site Settings" subtitle="Configure your platform's identity, localization, and behavior — changes apply instantly, sitewide">
      <form onSubmit={save} className="grid" style={{ gridTemplateColumns: '1.4fr 0.9fr', gap: 20, alignItems: 'start' }}>
        <div className="flex-col gap-3">
          <div className="flex gap-2" style={{ overflowX: 'auto', paddingBottom: 4 }}>
            {TABS.map(t => (
              <button
                key={t.id} type="button" onClick={() => setTab(t.id)}
                className="btn-sm"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 700,
                  border: tab === t.id ? 'none' : '1.5px solid var(--border)',
                  background: tab === t.id ? 'linear-gradient(135deg, var(--flame), #ff8a4c)' : 'var(--surface)',
                  color: tab === t.id ? '#241407' : 'var(--text)',
                }}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'general' && (
            <div className="card card-pad fade-in">
              <h3 style={{ fontSize: 16, marginBottom: 16 }}>General</h3>
              <div className="field"><label>Site Name</label><input className="input" value={form.site_name || ''} onChange={e => set('site_name', e.target.value)} /></div>
              <div className="field"><label>Tagline</label><input className="input" value={form.tagline || ''} onChange={e => set('tagline', e.target.value)} /></div>
              <ImageUploadField label="Logo" value={form.logo_url} onChange={v => set('logo_url', v)} icon={ImageIcon} />
              <ImageUploadField label="Favicon" value={form.favicon_url} onChange={v => set('favicon_url', v)} icon={Globe2} />
              <ImageUploadField label="Hero / Banner Image (login page)" value={form.hero_image_url} onChange={v => set('hero_image_url', v)} icon={ImageIcon} />
            </div>
          )}

          {tab === 'theme' && (
            <div className="flex-col gap-3 fade-in">
              <div className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                  <Palette size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Theme Colors</h3>
                </div>
                <div className="flex gap-2" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                  {COLOR_PRESETS.map(([p, a]) => (
                    <button
                      key={p} type="button"
                      onClick={() => { set('primary_color', p); set('accent_color', a); }}
                      style={{
                        width: 46, height: 32, borderRadius: 9, border: form.primary_color === p ? '2px solid var(--text)' : '1.5px solid var(--border)',
                        background: `linear-gradient(135deg, ${p}, ${a})`, cursor: 'pointer',
                      }}
                      title={`${p} / ${a}`}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Primary Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} style={{ width: 44, height: 40, borderRadius: 8, border: '1.5px solid var(--border)', padding: 2, background: 'var(--surface)' }} />
                      <input className="input" value={form.primary_color} onChange={e => set('primary_color', e.target.value)} />
                    </div>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Secondary / Accent Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.accent_color} onChange={e => set('accent_color', e.target.value)} style={{ width: 44, height: 40, borderRadius: 8, border: '1.5px solid var(--border)', padding: 2, background: 'var(--surface)' }} />
                      <input className="input" value={form.accent_color} onChange={e => set('accent_color', e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Default Theme for New Visitors</label>
                  <select className="input" value={form.default_theme} onChange={e => set('default_theme', e.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </div>

              <div className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                  <Type size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Typography & Layout</h3>
                </div>
                <div className="flex gap-2">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Heading Font</label>
                    <select className="input" value={form.font_family} onChange={e => set('font_family', e.target.value)}>
                      {HEADING_FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Body Font</label>
                    <select className="input" value={form.body_font} onChange={e => set('body_font', e.target.value)}>
                      {BODY_FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="flex items-center gap-1"><LayoutGrid size={13} /> Layout Density</label>
                  <div className="flex gap-2">
                    {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([val, label]) => (
                      <button key={val} type="button" onClick={() => set('ui_density', val)} className={form.ui_density === val ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} style={{ flex: 1 }}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="flex items-center gap-1"><Square size={13} /> Corner Style</label>
                  <div className="flex gap-2">
                    {[['rounded', 'Rounded'], ['sharp', 'Sharp']].map(([val, label]) => (
                      <button key={val} type="button" onClick={() => set('corner_style', val)} className={form.corner_style === val ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} style={{ flex: 1 }}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'school' && (
            <div className="card card-pad fade-in">
              <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                <School size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>School Information</h3>
              </div>
              <div className="field"><label>School / Institution Name</label><input className="input" value={form.school_name || ''} onChange={e => set('school_name', e.target.value)} placeholder="e.g. Greenwood International School" /></div>
              <div className="field"><label>Registration / License Number</label><input className="input" value={form.school_registration_no || ''} onChange={e => set('school_registration_no', e.target.value)} /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>School Address</label><textarea className="input" value={form.school_address || ''} onChange={e => set('school_address', e.target.value)} /></div>
            </div>
          )}

          {tab === 'localization' && (
            <div className="card card-pad fade-in">
              <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                <Clock size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Localization & Academic Session</h3>
              </div>
              <div className="flex gap-2">
                <div className="field" style={{ flex: 1 }}>
                  <label>Default Language</label>
                  <select className="input" value={form.default_language} onChange={e => set('default_language', e.target.value)}>
                    {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Timezone</label>
                  <select className="input" value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="field" style={{ flex: 1 }}>
                  <label>Date Format</label>
                  <select className="input" value={form.date_format} onChange={e => set('date_format', e.target.value)}>
                    {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Time Format</label>
                  <select className="input" value={form.time_format} onChange={e => set('time_format', e.target.value)}>
                    <option value="12h">12-hour</option>
                    <option value="24h">24-hour</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-dim" style={{ marginTop: -6 }}>
                <Calendar size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
                Manage academic sessions (e.g. 2025-2026) from the Academic Sessions panel.
              </p>
            </div>
          )}

          {tab === 'homepage' && (
            <div className="card card-pad fade-in">
              <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                <Home size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Homepage Customization</h3>
              </div>
              <div className="field"><label>Headline</label><input className="input" value={form.homepage_headline || ''} onChange={e => set('homepage_headline', e.target.value)} placeholder="Where students learn, practice & excel." /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>Subheadline</label><textarea className="input" value={form.homepage_subheadline || ''} onChange={e => set('homepage_subheadline', e.target.value)} placeholder="A short supporting sentence shown under the headline." /></div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="flex-col gap-3 fade-in">
              <div className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                  <Mail size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Email Settings</h3>
                </div>
                <p className="text-xs text-dim" style={{ marginBottom: 14 }}>Configure the outgoing mail identity. Connecting a live SMTP provider is a follow-up integration step.</p>
                <div className="flex gap-2">
                  <div className="field" style={{ flex: 1 }}><label>From Name</label><input className="input" value={form.email_from_name || ''} onChange={e => set('email_from_name', e.target.value)} placeholder="NITEX Notifications" /></div>
                  <div className="field" style={{ flex: 1 }}><label>From Address</label><input className="input" value={form.email_from_address || ''} onChange={e => set('email_from_address', e.target.value)} placeholder="no-reply@yourschool.com" /></div>
                </div>
                <div className="flex gap-2">
                  <div className="field" style={{ flex: 1 }}><label>SMTP Host</label><input className="input" value={form.email_smtp_host || ''} onChange={e => set('email_smtp_host', e.target.value)} placeholder="smtp.yourprovider.com" /></div>
                  <div className="field" style={{ flex: 1 }}><label>SMTP Port</label><input className="input" type="number" value={form.email_smtp_port || ''} onChange={e => set('email_smtp_port', e.target.value)} placeholder="587" /></div>
                </div>
              </div>
              <div className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                  <Bell size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>Notification Preferences</h3>
                </div>
                <ToggleRow label="New Registration Alerts" hint="Notify admins when a student registers" checked={!!form.notify_new_registration} onChange={v => set('notify_new_registration', v ? 1 : 0)} />
                <ToggleRow label="New Submission Alerts" hint="Notify staff when a student submits an assignment" checked={!!form.notify_new_submission} onChange={v => set('notify_new_submission', v ? 1 : 0)} />
                <ToggleRow label="Grading Complete Alerts" hint="Notify students when their work is graded" checked={!!form.notify_grading_complete} onChange={v => set('notify_grading_complete', v ? 1 : 0)} />
              </div>
              <div className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                  <Bell size={17} color="var(--primary)" /><h3 style={{ fontSize: 16 }}>XP & Streaks</h3>
                </div>
                <ToggleRow label="Enable XP & Study Streaks" hint="Off by default. When on, only students aged 13 or older (by date of birth) earn XP and streaks. Students without a date of birth are excluded." checked={!!form.gamification_enabled} onChange={v => set('gamification_enabled', v ? 1 : 0)} />
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-block" disabled={saving} type="submit">
            {saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}</>}
          </button>
        </div>

        <BrandingPreview form={form} />
      </form>

      <style>{`@media (max-width: 980px){ .page-container form.grid{ grid-template-columns: 1fr !important; } }`}</style>
    </AppLayout>
  );
}
