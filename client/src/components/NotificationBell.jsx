import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, FileText, ClipboardList, PenSquare, Megaphone, Award, CheckCheck, Trash2, XCircle } from 'lucide-react';
import api from '../api/client.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const TYPE_ICON = {
  material: FileText,
  assignment: ClipboardList,
  quiz: PenSquare,
  announcement: Megaphone,
  grade: Award,
  general: Bell,
};

const TYPE_COLOR = {
  material: 'var(--primary)',
  assignment: 'var(--accent)',
  quiz: '#f0932b',
  announcement: '#e84393',
  grade: '#0984e3',
  general: 'var(--text-dim)',
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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const ref = useRef(null);

  const load = () => api.get('/notifications').then(({ data }) => {
    setNotifications(data.notifications);
    setUnreadCount(data.unreadCount);
  }).catch(() => {});

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000); // poll every 20s for near-live updates
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const markRead = (id) => {
    api.put(`/notifications/${id}/read`).then(() => {
      setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    });
  };

  const markAllRead = () => {
    api.put('/notifications/read-all').then(() => {
      setNotifications(ns => ns.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    });
  };

  const remove = (id, e) => {
    e.stopPropagation();
    api.delete(`/notifications/${id}`).then(() => {
      setNotifications(ns => ns.filter(n => n.id !== id));
    });
  };

  const clearAll = () => {
    api.delete('/notifications/all').then(() => {
      setNotifications([]);
      setUnreadCount(0);
      setConfirmClearAll(false);
    });
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className="btn-outline btn-sm"
        style={{ padding: 9, borderRadius: 10, position: 'relative' }}
        aria-label="Notifications"
        onClick={() => setOpen(o => !o)}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 999,
            background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            border: '2px solid var(--bg)',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="card pop-in" style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 360, maxWidth: '90vw',
          maxHeight: 440, overflowY: 'auto', boxShadow: 'var(--shadow-lg)', zIndex: 100,
        }}>
          <div className="flex items-center justify-between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button className="btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px' }} onClick={markAllRead}>
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="btn-ghost btn-sm"
                  style={{ fontSize: 12, padding: '4px 8px', color: 'var(--danger)' }}
                  onClick={() => setConfirmClearAll(true)}
                >
                  <XCircle size={13} /> Clear all
                </button>
              )}
            </div>
          </div>
          {notifications.length === 0 && (
            <div className="text-dim text-sm" style={{ padding: '30px 16px', textAlign: 'center' }}>
              <Bell size={22} style={{ opacity: .4, marginBottom: 8 }} />
              <div>No notifications yet</div>
            </div>
          )}
          {notifications.map(n => {
            const Icon = TYPE_ICON[n.type] || Bell;
            return (
              <Link
                key={n.id}
                to={n.link || '#'}
                onClick={() => { if (!n.is_read) markRead(n.id); setOpen(false); }}
                className="flex items-start gap-2"
                style={{
                  padding: '12px 16px', borderBottom: '1px solid var(--border)',
                  background: n.is_read ? 'transparent' : 'var(--primary-light)',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 9, background: (TYPE_COLOR[n.type] || 'var(--primary)') + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon size={15} color={TYPE_COLOR[n.type] || 'var(--primary)'} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: n.is_read ? 500 : 700 }}>{n.title}</div>
                  {n.body && <div className="text-xs text-dim" style={{ marginTop: 2 }}>{n.body}</div>}
                  <div className="text-xs text-dim" style={{ marginTop: 4 }}>{timeAgo(n.created_at)}</div>
                </div>
                <button className="btn-ghost" style={{ padding: 4, flexShrink: 0 }} onClick={(e) => remove(n.id, e)} aria-label="Dismiss">
                  <Trash2 size={13} />
                </button>
              </Link>
            );
          })}
        </div>
      )}

      {confirmClearAll && (
        <ConfirmDialog
          title="Clear all notifications?"
          message="This will permanently remove every notification in your list. This cannot be undone."
          confirmLabel="Clear All"
          onConfirm={clearAll}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
    </div>
  );
}
