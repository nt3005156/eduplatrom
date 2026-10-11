import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, ShieldCheck } from 'lucide-react';
import api from '../../api/client.js';
import GuardianLayout from './GuardianLayout.jsx';

// Read-only in Phase 1. Changing a phone number needs verification (Phase 2), and the school edits
// contact details for now. Shows only the guardian's own record.
export default function GuardianProfile() {
  const { t } = useTranslation('guardian');
  const [guardian, setGuardian] = useState(null);
  const [error, setError] = useState(null); // { text: server message, key: fallback translation key }

  useEffect(() => {
    api.get('/guardian/profile')
      .then(({ data }) => setGuardian(data.guardian))
      .catch(err => setError({ text: err.response?.data?.error, key: 'profile.loadFailed' }));
  }, []);

  return (
    <GuardianLayout title={t('profile.title')} back="/guardian">
      {error && <p role="alert" className="card card-pad" style={{ color: 'var(--danger)' }}>{error.text || t(error.key)}</p>}
      {!guardian && !error && <p className="text-dim">{t('profile.loading')}</p>}
      {guardian && (
        <div className="card card-pad" style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="text-dim text-sm">{t('profile.name')}</div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{guardian.name}</div>
          </div>
          <div>
            <div className="text-dim text-sm"><Mail size={13} style={{ verticalAlign: '-2px' }} /> {t('profile.signInEmail')}</div>
            <div style={{ wordBreak: 'break-all' }}>{guardian.email}</div>
          </div>
          <div>
            <div className="text-dim text-sm"><Phone size={13} style={{ verticalAlign: '-2px' }} /> {t('profile.phone')}</div>
            <div>{guardian.phone || t('profile.notOnFile')}</div>
            {guardian.phone && (
              <div className="text-faint" style={{ fontSize: 12 }}>
                <ShieldCheck size={12} style={{ verticalAlign: '-2px' }} /> {guardian.phone_verified ? t('profile.verified') : t('profile.notVerified')}
              </div>
            )}
          </div>
          <p className="text-dim text-sm">{t('profile.contactNote')}</p>
        </div>
      )}
    </GuardianLayout>
  );
}
