import { useEffect, useState } from 'react';
import { FileText, Video, LinkIcon, Download, ExternalLink, Search, SlidersHorizontal, X } from 'lucide-react';
import api from '../../api/client.js';
import AppLayout from '../../components/AppLayout.jsx';
import Modal from '../../components/Modal.jsx';
import SubjectIcon from '../../components/IconMap.jsx';
import KnowledgeConstellation from '../../components/KnowledgeConstellation.jsx';
import { SkeletonGrid } from '../../components/Skeleton.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useGamification } from '../../context/GamificationContext.jsx';

const TYPE_ICON = { pdf: FileText, note: FileText, doc: FileText, video: Video, slide: FileText, link: LinkIcon };
const TYPE_LABEL = { pdf: 'PDF', note: 'Notes', doc: 'Document', video: 'Video', slide: 'Slides', link: 'Link' };

function MaterialDetailModal({ material, onClose, onOpenFile }) {
  const Icon = TYPE_ICON[material.type] || FileText;
  const href = material.file_path || material.external_url;
  return (
    <Modal onClose={onClose}>
      <div onClick={e => e.stopPropagation()} className="glass-card card-pad pop-in" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-start" style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-2">
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={18} color="var(--primary)" />
            </div>
            <h3 style={{ fontSize: 17 }}>{material.title}</h3>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex gap-1" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="badge badge-purple">{TYPE_LABEL[material.type] || material.type}</span>
          <span className={`badge ${material.difficulty === 'easy' ? 'badge-green' : material.difficulty === 'hard' ? 'badge-red' : 'badge-orange'}`}>{material.difficulty}</span>
          {material.topic && <span className="badge badge-gray">{material.topic}</span>}
        </div>
        <p className="text-dim text-sm" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 20 }}>
          {material.description || 'No description provided for this material.'}
        </p>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="btn btn-primary btn-block" onClick={onOpenFile}>
            {material.type === 'video' || material.type === 'link' ? <ExternalLink size={15} /> : <Download size={15} />}
            {material.type === 'video' || material.type === 'link' ? 'Open Link' : 'Open / Download'}
          </a>
        )}
      </div>
    </Modal>
  );
}

export default function Materials() {
  const { user } = useAuth();
  const { applyGamificationResult } = useGamification();
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    api.get(`/subjects/class/${user.class_level}`).then(({ data }) => {
      setSubjects(data.subjects);
      if (data.subjects.length) setActiveSubject(data.subjects[0].id);
      else setLoading(false);
    });
  }, [user.class_level]);

  useEffect(() => {
    if (!activeSubject) return;
    setLoading(true);
    setTopicFilter(null);
    api.get(`/materials/subject/${activeSubject}`).then(({ data }) => { setMaterials(data.materials); setLoading(false); });
  }, [activeSubject]);

  const markViewed = (id) => api.post(`/materials/${id}/view`).then(({ data }) => applyGamificationResult(data)).catch(() => {});

  const filtered = materials.filter(m =>
    (typeFilter === 'all' || m.type === typeFilter) &&
    (!topicFilter || m.topic === topicFilter) &&
    (m.title.toLowerCase().includes(search.toLowerCase()) || (m.topic || '').toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AppLayout title="Study Materials" subtitle="Browse PDFs, slides, notes and videos organized by subject">
      <div className="flex gap-2" style={{ overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
        {subjects.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSubject(s.id)}
            className="btn-sm"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap',
              border: activeSubject === s.id ? 'none' : '1.5px solid var(--border)',
              background: activeSubject === s.id ? s.color : 'var(--surface)',
              color: activeSubject === s.id ? '#fff' : 'var(--text)',
              fontWeight: 700, fontSize: 13.5,
            }}
          >
            <SubjectIcon name={s.icon} size={16} color={activeSubject === s.id ? '#fff' : s.color} />
            {s.name}
            <span style={{ opacity: .8, fontWeight: 600 }}>({s.materials_count})</span>
          </button>
        ))}
      </div>

      {activeSubject && (
        <div style={{ marginBottom: 20 }}>
          <KnowledgeConstellation subjectId={activeSubject} onSelectTopic={(t) => setTopicFilter(t)} />
        </div>
      )}

      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search materials by title or topic..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 170 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="pdf">PDF</option>
          <option value="slide">Slides</option>
          <option value="note">Notes</option>
          <option value="video">Video</option>
          <option value="doc">Document</option>
          <option value="link">Link</option>
        </select>
        {topicFilter && (
          <button className="badge badge-green" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setTopicFilter(null)}>
            {topicFilter} <X size={11} />
          </button>
        )}
      </div>

      {loading && <SkeletonGrid count={6} />}

      {!loading && filtered.length === 0 && (
        <div className="card card-pad text-dim" style={{ textAlign: 'center', padding: 50 }}>
          <SlidersHorizontal size={28} style={{ marginBottom: 10, opacity: .5 }} />
          <div>No materials found{topicFilter ? ` for "${topicFilter}"` : ' for this subject yet'}.</div>
        </div>
      )}

      {!loading && (
      <div className="grid stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {filtered.map(m => {
          const Icon = TYPE_ICON[m.type] || FileText;
          const href = m.file_path || m.external_url;
          return (
            <div
              key={m.id}
              onClick={() => setViewing(m)}
              className="card card-pad"
              style={{ display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}
            >
              <div className="flex items-center justify-between">
                <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} color="var(--primary)" />
                </div>
                <span className={`badge ${m.difficulty === 'easy' ? 'badge-green' : m.difficulty === 'hard' ? 'badge-red' : 'badge-orange'}`}>{m.difficulty}</span>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{m.title}</div>
                <div className="text-sm text-dim" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{m.description || 'No description'}</div>
              </div>
              <div className="flex items-center justify-between" style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <span className="badge badge-purple">{TYPE_LABEL[m.type]}</span>
                {m.topic && <span className="text-xs text-dim">{m.topic}</span>}
                {href && (m.type === 'video' || m.type === 'link' ? <ExternalLink size={15} color="var(--text-dim)" /> : <Download size={15} color="var(--text-dim)" />)}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {viewing && (
        <MaterialDetailModal
          material={viewing}
          onClose={() => setViewing(null)}
          onOpenFile={() => markViewed(viewing.id)}
        />
      )}
    </AppLayout>
  );
}
