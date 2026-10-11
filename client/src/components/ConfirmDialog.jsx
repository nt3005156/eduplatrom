import { AlertTriangle } from 'lucide-react';
import Modal from './Modal.jsx';

/**
 * A reusable "Are you sure?" confirmation modal. Renders via the same
 * portal-based Modal so it's never clipped by animated ancestors.
 */
export default function ConfirmDialog({
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal onClose={onCancel}>
      <div className="glass-card card-pad pop-in" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', margin: '0 auto 14px',
          background: danger ? 'rgba(255,107,129,.14)' : 'var(--primary-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertTriangle size={24} color={danger ? 'var(--error)' : 'var(--flame)'} />
        </div>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>{title}</h3>
        <p className="text-dim text-sm" style={{ marginBottom: 22, lineHeight: 1.5 }}>{message}</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline btn-block" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className={`btn btn-block ${danger ? '' : 'btn-primary'}`}
            onClick={onConfirm}
            style={danger ? { background: 'var(--error)', color: '#fff' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
