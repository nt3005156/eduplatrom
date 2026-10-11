import { createPortal } from 'react-dom';
import { useEffect } from 'react';

/**
 * Renders its children into document.body via a portal, so full-screen
 * overlays are never affected by animated/transformed ancestors (which
 * would otherwise clip position:fixed content to the ancestor's box —
 * see CSS containing-block rules for transformed elements).
 */
export default function Modal({ children, onClose, glass = true, closeOnBackdrop = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div
      className={glass ? 'glass-overlay fade-in' : 'fade-in'}
      style={glass ? undefined : {
        position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,10,24,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      {children}
    </div>,
    document.body
  );
}
