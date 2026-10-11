import { usePermissions } from '../context/PermissionContext.jsx';

export default function ClassPicker({ value, onChange }) {
  // Only ever offer classes this staff member is actually assigned to —
  // driven by the backend-computed allowedClasses, never hardcoded.
  const { allowedClasses } = usePermissions();
  return (
    <div className="flex gap-2" style={{ overflowX: 'auto', paddingBottom: 4 }}>
      {allowedClasses.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="btn-sm"
          style={{
            padding: '8px 16px', borderRadius: 10, whiteSpace: 'nowrap', fontWeight: 700,
            border: value === c ? 'none' : '1.5px solid var(--border)',
            background: value === c ? 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 60%, white))' : 'var(--surface)',
            color: value === c ? '#fff' : 'var(--text)',
          }}
        >
          Class {c}
        </button>
      ))}
    </div>
  );
}
