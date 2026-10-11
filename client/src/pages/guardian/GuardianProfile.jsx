import { useEffect, useState } from 'react';
import { Mail, Phone, ShieldCheck } from 'lucide-react';
import api from '../../api/client.js';
import GuardianLayout from './GuardianLayout.jsx';

// Read-only in Phase 1. Changing a phone number needs verification (Phase 2), and the school edits
// contact details for now. Shows only the guardian's own record.
export default function GuardianProfile() {
  const [guardian, setGuardian] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/guardian/profile')
      .then(({ data }) => setGuardian(data.guardian))
      .catch(err => setError(err.response?.data?.error || 'Could not load your profile.'));
  }, []);

  return (
    <GuardianLayout title="My profile" back="/guardian">
      {error && <p role="alert" className="card card-pad" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!guardian && !error && <p className="text-dim">Loading…</p>}
      {guardian && (
        <div className="card card-pad" style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="text-dim text-sm">Name</div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{guardian.name}</div>
          </div>
          <div>
            <div className="text-dim text-sm"><Mail size={13} style={{ verticalAlign: '-2px' }} /> Sign-in email</div>
            <div style={{ wordBreak: 'break-all' }}>{guardian.email}</div>
          </div>
          <div>
            <div className="text-dim text-sm"><Phone size={13} style={{ verticalAlign: '-2px' }} /> Phone</div>
            <div>{guardian.phone || 'Not on file'}</div>
            {guardian.phone && (
              <div className="text-faint" style={{ fontSize: 12 }}>
                <ShieldCheck size={12} style={{ verticalAlign: '-2px' }} /> {guardian.phone_verified ? 'Verified' : 'Not verified yet'}
              </div>
            )}
          </div>
          <p className="text-dim text-sm">To change your name, email, or phone number, contact the school office.</p>
        </div>
      )}
    </GuardianLayout>
  );
}
