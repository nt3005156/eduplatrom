import { Menu } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function Topbar({ title, subtitle, onMenuClick }) {
  const { user } = useAuth();
  return (
    <div
      className="app-topbar"
      style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'color-mix(in srgb, var(--bg) 85%, transparent)', backdropFilter: 'blur(10px)',
        padding: '20px 32px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        borderBottom: '1px solid transparent',
      }}
    >
      <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
        <button
          className="btn-ghost topbar-menu-btn"
          onClick={onMenuClick}
          aria-label="Open menu"
          style={{ padding: 9, borderRadius: 10, display: 'none', flexShrink: 0 }}
        >
          <Menu size={19} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
          {subtitle && <p className="text-dim text-sm" style={{ marginTop: 4 }}>{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
        <span className="theme-toggle-desktop"><ThemeToggle /></span>
        <NotificationBell />
      </div>

      <style>{`
        @media (max-width: 900px){ .topbar-menu-btn{ display: inline-flex !important; } }
        @media (max-width: 560px){ .theme-toggle-desktop{ display:none; } }
      `}</style>
    </div>
  );
}
