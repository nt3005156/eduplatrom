import { useEffect, useState } from 'react';
import { Trophy, Flame } from 'lucide-react';

const COLORS = ['var(--flame)', 'var(--knowledge)', '#ff8a4c', '#8ff2e4'];

function ConfettiBurst({ pieceCount = 22 }) {
  const [pieces] = useState(() =>
    Array.from({ length: pieceCount }).map((_, i) => {
      const angle = (Math.PI * 2 * i) / pieceCount + Math.random() * 0.4;
      const distance = 70 + Math.random() * 90;
      return {
        id: i,
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        tr: `${Math.random() * 360 + 180}deg`,
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 120,
      };
    })
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {pieces.map(p => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            '--tx': `${p.tx}px`, '--ty': `${p.ty}px`, '--tr': p.tr,
            background: p.color, animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * A brief full-screen celebratory overlay for level-ups or streak milestones.
 * Auto-dismisses after ~2.4s or on click.
 */
export default function Celebration({ type = 'level', level, streakCount, onDone }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  const isStreak = type === 'streak';

  return (
    <div
      className="glass-overlay fade-in"
      onClick={onDone}
      style={{ zIndex: 200, cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <ConfettiBurst />
        <div
          className="level-badge-celebrate"
          style={{
            width: 96, height: 96, borderRadius: '50%', margin: '0 auto 18px',
            background: isStreak
              ? 'linear-gradient(135deg, var(--flame), #ff8a4c)'
              : 'linear-gradient(135deg, var(--knowledge), var(--flame))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(var(--flame-rgb),.5)',
          }}
        >
          {isStreak ? <Flame size={42} color="#241407" fill="#241407" /> : <Trophy size={42} color="#241407" />}
        </div>
        <h2 style={{ fontSize: 28, color: '#fff', marginBottom: 6 }}>
          {isStreak ? `${streakCount}-Day Streak!` : `Level ${level}!`}
        </h2>
        <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 14.5 }}>
          {isStreak ? 'Your dedication is paying off — keep the flame alive.' : 'New heights unlocked. Keep studying.'}
        </p>
      </div>
    </div>
  );
}
