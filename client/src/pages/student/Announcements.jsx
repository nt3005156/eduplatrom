import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';

export default function Announcements() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/announcements').then(({ data }) => setItems(data.announcements)); }, []);

  return (
    <AppLayout title="Announcements" subtitle="Stay updated with the latest news from your school">
      <div className="flex-col gap-3">
        {items.length === 0 && <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 40 }}>No announcements yet.</div>}
        {items.map(a => (
          <div key={a.id} className="card card-pad flex gap-3">
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Megaphone size={18} color="var(--primary)" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>{a.title}</div>
              <div className="text-sm text-dim" style={{ marginTop: 4 }}>{a.body}</div>
              <div className="text-xs text-dim" style={{ marginTop: 8 }}>{new Date(a.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}
