import { useEffect, useRef, useState } from 'react';

/** Counts a number up from its previous value to a new value with easing. */
function useCountUp(value, duration = 900) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef();

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { setDisplay(to); prevRef.current = to; return; }

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return display;
}

export default function XpBar({ level, xp, compact = false }) {
  const displayXp = useCountUp(xp);
  const pct = level?.progressPct ?? 0;

  return (
    <div className="flex-col gap-1" style={{ width: '100%' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-dim" style={{ fontWeight: 700, letterSpacing: '.03em' }}>
          LEVEL {level?.level ?? 1}
        </span>
        <span className="mono text-xs" style={{ color: 'var(--flame)' }}>
          {displayXp} XP
        </span>
      </div>
      <div className="xp-bar-track" style={{ height: compact ? 8 : 12 }}>
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <div className="text-xs text-dim">
          {level?.nextThreshold != null ? `${level.nextThreshold - xp} XP to level ${level.level + 1}` : 'Max level reached'}
        </div>
      )}
    </div>
  );
}
