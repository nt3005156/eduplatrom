import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const COLORS = { success: '#00b894', error: '#e74c3c', info: 'var(--primary)' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);

  const push = useCallback((message, type = 'info', duration = 3200) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const toast = {
    success: (msg, d) => push(msg, 'success', d),
    error: (msg, d) => push(msg, 'error', d),
    info: (msg, d) => push(msg, 'info', d),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
        {toasts.map(t => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className="card pop-in" style={{
              padding: '13px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, boxShadow: 'var(--shadow-lg)',
            }}>
              <Icon size={18} color={COLORS[t.type]} style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="text-sm" style={{ flex: 1, fontWeight: 500 }}>{t.message}</span>
              <button className="btn-ghost" style={{ padding: 2 }} onClick={() => dismiss(t.id)}><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
