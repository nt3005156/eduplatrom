import { useEffect, useState, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import api from '../api/client.js';
import { Skeleton } from './Skeleton.jsx';

const MASTERY_STYLE = {
  mastered: { color: 'var(--knowledge)', glow: 'rgba(94,234,212,.55)', radius: 15, label: 'Mastered' },
  practicing: { color: 'var(--flame)', glow: 'rgba(255,180,84,.5)', radius: 13, label: 'Practicing' },
  exploring: { color: 'var(--ink-muted)', glow: 'rgba(165,163,214,.3)', radius: 11, label: 'Exploring' },
  unexplored: { color: 'var(--ink-faint)', glow: 'transparent', radius: 9, label: 'Unexplored' },
};

/** Deterministic pseudo-random layout so nodes don't jump around on re-render. */
function layoutNodes(topics, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) / 2 - 40;
  return topics.map((t, i) => {
    const angle = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
    // Vary orbit distance slightly by hash of topic name for organic feel
    const hash = t.topic.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const orbitFactor = 0.55 + ((hash % 40) / 100); // 0.55–0.95
    const r = maxRadius * orbitFactor;
    return { ...t, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

export default function KnowledgeConstellation({ subjectId, onSelectTopic }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const width = 560;
  const height = 420;

  useEffect(() => {
    if (!subjectId) return;
    setLoading(true);
    api.get(`/dashboard/student/constellation/${subjectId}`).then(({ data }) => {
      setData(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [subjectId]);

  const nodes = useMemo(() => data ? layoutNodes(data.topics, width, height) : [], [data]);
  const cx = width / 2, cy = height / 2;

  if (loading) {
    return (
      <div className="card card-pad flex-col gap-2" style={{ alignItems: 'center' }}>
        <Skeleton width={220} height={16} />
        <Skeleton width="100%" height={340} radius={16} />
      </div>
    );
  }

  if (!data || data.topics.length === 0) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center', padding: 40 }}>
        <Sparkles size={26} style={{ opacity: .4, marginBottom: 10 }} />
        <div className="text-dim text-sm">No tagged topics yet for {data?.subject?.name || 'this subject'} — check back once your teacher adds topic-tagged materials.</div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} color="var(--knowledge)" />
          <h3 style={{ fontSize: 16 }}>{data.subject.name} — Knowledge Constellation</h3>
        </div>
      </div>
      <p className="text-xs text-dim" style={{ marginBottom: 12 }}>
        Each star is a topic. Brighter, cyan stars mean mastery — dim stars are still waiting to be explored.
      </p>

      <div style={{ position: 'relative', width: '100%', maxWidth: width, margin: '0 auto' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          <defs>
            <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--flame)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--flame)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Orbit guide rings */}
          {[0.55, 0.7, 0.85, 0.95].map((f, i) => (
            <circle key={i} cx={cx} cy={cy} r={(Math.min(width, height) / 2 - 40) * f} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="2 6" opacity="0.5" />
          ))}

          {/* Connection lines from center "you" node to each topic star */}
          {nodes.map((n, i) => (
            <line
              key={`line-${i}`}
              x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={MASTERY_STYLE[n.mastery].color}
              strokeOpacity={n.mastery === 'unexplored' ? 0.12 : 0.35}
              strokeWidth="1.5"
            />
          ))}

          {/* Center node: the student's current focus */}
          <circle cx={cx} cy={cy} r="22" fill="url(#core-glow)" />
          <circle cx={cx} cy={cy} r="9" fill="var(--flame)" />

          {/* Topic stars */}
          {nodes.map((n, i) => {
            const style = MASTERY_STYLE[n.mastery];
            const isHovered = hovered === n.topic;
            return (
              <g
                key={i}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(n.topic)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectTopic?.(n.topic)}
              >
                {n.mastery !== 'unexplored' && (
                  <circle cx={n.x} cy={n.y} r={style.radius + 8} fill={style.glow} opacity={isHovered ? 0.9 : 0.55}>
                    {n.mastery === 'mastered' && (
                      <animate attributeName="r" values={`${style.radius + 6};${style.radius + 11};${style.radius + 6}`} dur="3s" repeatCount="indefinite" />
                    )}
                  </circle>
                )}
                <circle
                  cx={n.x} cy={n.y} r={isHovered ? style.radius + 2 : style.radius}
                  fill={style.color}
                  stroke={n.mastery === 'unexplored' ? 'var(--border-strong)' : 'none'}
                  strokeWidth="1.5"
                  style={{ transition: 'r .2s cubic-bezier(.34,1.56,.64,1)' }}
                />
                <text
                  x={n.x} y={n.y + style.radius + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="Inter, sans-serif"
                  fontWeight={isHovered ? 700 : 500}
                  fill={isHovered ? 'var(--text)' : 'var(--text-dim)'}
                >
                  {n.topic}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="pop-in" style={{
            position: 'absolute', top: 8, right: 8, background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '8px 12px', fontSize: 12,
          }}>
            {(() => {
              const n = nodes.find(x => x.topic === hovered);
              if (!n) return null;
              return (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>{n.topic}</div>
                  <div className="text-dim">{MASTERY_STYLE[n.mastery].label}</div>
                  {n.quizAvgPct != null && <div className="text-dim">Quiz avg: {n.quizAvgPct}%</div>}
                  <div className="text-dim">{n.viewedCount}/{n.materialCount} materials viewed</div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      <div className="flex gap-3" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        {Object.entries(MASTERY_STYLE).map(([key, s]) => (
          <div key={key} className="flex items-center gap-1 text-xs text-dim">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
