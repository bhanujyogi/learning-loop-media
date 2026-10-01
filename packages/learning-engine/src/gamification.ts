import { XP_CONFIG } from '@learning-loop/config';

export type XpAction =
  | 'question_correct'
  | 'question_incorrect_attempt'
  | 'review_completed'
  | 'lesson_completed'
  | 'quiz_completed'
  | 'concept_mastered'
  | 'watch_complete';

/** XP rewards meaningful learning behaviour only; passive watching earns zero. */
export function xpFor(action: XpAction): number {
  switch (action) {
    case 'question_correct': return XP_CONFIG.questionCorrect;
    case 'question_incorrect_attempt': return XP_CONFIG.questionIncorrectAttempt;
    case 'review_completed': return XP_CONFIG.reviewCompleted;
    case 'lesson_completed': return XP_CONFIG.lessonCompleted;
    case 'quiz_completed': return XP_CONFIG.quizCompleted;
    case 'concept_mastered': return XP_CONFIG.conceptMastered;
    case 'watch_complete': return XP_CONFIG.watchComplete;
  }
}

/** Total XP required to reach `level` (level 1 = 0 XP). Geometric growth. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += Math.round(XP_CONFIG.levelBase * Math.pow(XP_CONFIG.levelGrowth, l - 1));
  return total;
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, into: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}

const DAY = 86_400_000;
/** Streak by UTC-day index supplied by caller (timezone handled upstream). */
export function updateStreak(
  streak: { current: number; longest: number; lastDay: number | null },
  today: number,
): { current: number; longest: number; lastDay: number } {
  const gap = streak.lastDay == null ? null : today - streak.lastDay;
  const current = gap === 0 ? streak.current : gap === 1 ? streak.current + 1 : 1;
  return { current, longest: Math.max(streak.longest, current), lastDay: today };
}
export const dayIndex = (ms: number, tzOffsetMinutes = 0) =>
  Math.floor((ms + tzOffsetMinutes * 60_000) / DAY);
