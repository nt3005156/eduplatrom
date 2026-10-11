import { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import Celebration from '../components/Celebration.jsx';

const GamificationContext = createContext(null);

export function GamificationProvider({ children }) {
  const { user, updateUser } = useAuth();
  const [celebration, setCelebration] = useState(null);

  /**
   * Feed the { xp, streak } payload returned by material-view / assignment-submit /
   * quiz-submit endpoints. Updates the local user's xp/level/streak and triggers a
   * celebration overlay for level-ups or streak milestones (level-up takes priority
   * if both happen in the same action).
   */
  const applyGamificationResult = useCallback(({ xp, streak } = {}) => {
    if (!user) return;
    const patch = {};
    if (xp) { patch.xp = xp.totalXp; patch.level = xp.level; }
    if (streak) { patch.streak_count = streak.streak_count; patch.longest_streak = streak.longest_streak; }
    if (Object.keys(patch).length) updateUser(patch);

    if (xp?.leveledUp) {
      setCelebration({ type: 'level', level: xp.level.level });
    } else if (streak?.isMilestone) {
      setCelebration({ type: 'streak', streakCount: streak.streak_count });
    }
  }, [user, updateUser]);

  return (
    <GamificationContext.Provider value={{ applyGamificationResult }}>
      {children}
      {celebration && (
        <Celebration
          type={celebration.type}
          level={celebration.level}
          streakCount={celebration.streakCount}
          onDone={() => setCelebration(null)}
        />
      )}
    </GamificationContext.Provider>
  );
}

export const useGamification = () => useContext(GamificationContext);
