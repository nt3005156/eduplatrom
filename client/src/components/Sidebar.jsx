import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, ClipboardList, PenSquare, Megaphone,
  Users, UploadCloud, GraduationCap, LogOut, Palette, X, ShieldCheck, Calendar, UserCog, FileCheck2, Contact, BookMarked, Activity, KeySquare, ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { usePermissions } from '../context/PermissionContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import XpBar from './XpBar.jsx';
import StreakFlame from './StreakFlame.jsx';

export default function Sidebar({ mobileOpen, onClose }) {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { hasPermission, role } = usePermissions();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  const isStaff = isAdmin || isTeacher;
  // A Coordinator (or any future role granted the same permission but not
  // content/assignment/quiz creation rights) gets a completely different,
  // read-only-monitoring nav instead of the full teaching staff nav — this
  // is the concrete mechanism behind "every teacher experiences a different
  // LMS according to their role" rather than one shared teacher UI with
  // hidden buttons. Driven by hasPermission(), not a hardcoded role name, so
  // a future custom role with the same permission profile gets this nav for
  // free.
  const isMonitoringOnlyRole = isTeacher && role?.role_key && !hasPermission('assignment.create') && hasPermission('analytics.view_school_wide');
  // Academic Head / Principal: the "near-complete control" tier — gets its
  // own dedicated dashboard (school-wide comparisons + approval queue) ON
  // TOP OF the regular teaching-staff nav (they can still create/grade
  // content everywhere, unlike a Coordinator), so this is additive rather
  // than a replacement nav.
  const isAcademicHead = isTeacher && user?.staff_role === 'academic_head';

  const studentLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/materials', label: 'Study Materials', icon: BookOpen },
    { to: '/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/quizzes', label: 'Quizzes', icon: PenSquare },
    { to: '/announcements', label: 'Announcements', icon: Megaphone },
  ];

  // Coordinator / monitoring-tier nav: no content/assignment/quiz creation
  // links at all (they hold no create permissions), just oversight tools.
  const monitoringLinks = [
    { to: '/coordinator', label: 'Coordinator Dashboard', icon: Activity },
    ...(hasPermission('audit.view') ? [{ to: '/admin/audit-log', label: 'Audit Log', icon: ShieldCheck }] : []),
  ];

  // Links every staff member (teacher + admin) shares day-to-day.
  const staffLinks = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard },
    ...(isAcademicHead ? [{ to: '/academic-head', label: 'Academic Head Dashboard', icon: ClipboardCheck }] : []),
    { to: '/admin/content', label: 'Manage Content', icon: UploadCloud },
    { to: '/admin/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/admin/quizzes', label: 'Quizzes', icon: PenSquare },
    { to: '/admin/question-banks', label: 'Question Banks', icon: BookMarked },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/admin/preferences', label: 'My Preferences', icon: UserCog },
  ];

  // Admin-only, enterprise-config / oversight tools — not shown to teachers.
  const adminOnlyLinks = [
    { to: '/admin/registry', label: 'Registry', icon: FileCheck2 },
    { to: '/admin/teachers', label: 'Teacher Management', icon: Contact },
    { to: '/admin/roles-permissions', label: 'Roles & Permissions', icon: KeySquare },
    { to: '/admin/academic-sessions', label: 'Academic Sessions', icon: Calendar },
    { to: '/admin/audit-log', label: 'Audit Log', icon: ShieldCheck },
    { to: '/admin/branding', label: 'Branding & Settings', icon: Palette },
  ];

  const links = isMonitoringOnlyRole
    ? monitoringLinks
    : isStaff ? [...staffLinks, ...(isAdmin ? adminOnlyLinks : [])] : studentLinks;


  return (
    <>
      {mobileOpen && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,20,.5)', zIndex: 39, backdropFilter: 'blur(2px)' }}
          className="sidebar-scrim"
        />
      )}
      <aside
        className="app-sidebar"
        style={{
          width: 252, minWidth: 252, background: 'var(--surface)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, zIndex: 40,
          transition: 'background-color .25s, border-color .25s',
        }}
      >
        <div style={{ padding: '22px 22px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, background: settings?.logo_url ? 'transparent' : 'linear-gradient(135deg, var(--primary), var(--accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(var(--brand-primary-rgb),.35)', overflow: 'hidden', flexShrink: 0,
          }}>
            {settings?.logo_url ? <img src={settings.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <GraduationCap size={21} color="#fff" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces'", fontWeight: 700, fontSize: 18, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings?.site_name || 'NITEX'}</div>
            <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>{isAdmin ? 'Admin Console' : isTeacher ? 'Teacher Console' : 'Learning Portal'}</div>
          </div>
          <button className="btn-ghost sidebar-close-btn" onClick={onClose} style={{ marginLeft: 'auto', padding: 6, display: 'none' }} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav style={{ flex: 1, padding: '10px 14px', overflowY: 'auto' }}>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              onClick={onClose}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12,
                marginBottom: 4, fontSize: 14.5, fontWeight: 600,
                color: isActive ? '#241407' : 'var(--text-dim)',
                background: isActive ? 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 60%, white))' : 'transparent',
                boxShadow: isActive ? '0 6px 14px rgba(var(--brand-primary-rgb),.3)' : 'none',
                transition: 'all .15s',
              })}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {!isStaff && (
          <div style={{ margin: '0 16px 16px', padding: 16, borderRadius: 14, background: 'linear-gradient(165deg, var(--bg-card), var(--bg-elevated))', border: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-dim)' }}>Class {user?.class_level}</span>
              <StreakFlame
                streakCount={user?.streak_count || 0}
                studiedToday={user?.streak?.studiedToday}
                atRisk={user?.streak?.atRisk}
                size={16}
              />
            </div>
            <XpBar level={user?.level} xp={user?.xp || 0} compact />
          </div>
        )}

        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className="text-xs text-dim" style={{ fontWeight: 700, letterSpacing: '.03em' }}>THEME</span>
            <ThemeToggle compact />
          </div>
          <div className="flex items-center gap-2">
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: user?.avatar_color || 'var(--primary)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
              <div className="text-dim" style={{ fontSize: 11.5, textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
            <button className="btn-ghost btn-sm" style={{ padding: 8, borderRadius: 9 }} onClick={logout} title="Log out" aria-label="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <style>{`
        @media (max-width: 900px){
          .app-sidebar{
            position: fixed !important; left: ${mobileOpen ? '0' : '-272px'}; top:0; height: 100vh;
            transition: left .28s cubic-bezier(.4,0,.2,1);
            box-shadow: ${mobileOpen ? '0 0 40px rgba(0,0,0,.35)' : 'none'};
          }
          .sidebar-close-btn{ display: inline-flex !important; }
        }
      `}</style>
    </>
  );
}
