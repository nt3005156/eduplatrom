import { Flame } from 'lucide-react';

/**
 * A streak flame that breathes/flickers when the streak is active today,
 * and cools to a dim, desaturated state (with a slow warning pulse) when
 * the student hasn't studied yet and it's getting late.
 */
export default function StreakFlame({ streakCount = 0, studiedToday = false, atRisk = false, size = 18, showCount = true }) {
  const isActive = studiedToday && streakCount > 0;
  const isRisk = atRisk && streakCount > 0;

  return (
    <div className="flex items-center gap-1">
      <Flame
        size={size}
        className={isActive ? 'flame-icon-active' : isRisk ? 'flame-icon-risk flame-pulse-warn' : 'flame-icon-risk'}
        fill={isActive ? 'var(--flame)' : 'none'}
        strokeWidth={isActive ? 1.5 : 1.75}
      />
      {showCount && (
        <span className="mono" style={{ fontSize: size < 18 ? 12 : 14, fontWeight: 600, color: isActive ? 'var(--flame)' : 'var(--text-faint)' }}>
          {streakCount}
        </span>
      )}
    </div>
  );
}
