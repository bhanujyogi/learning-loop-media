import { clamp01 } from '@learning-loop/shared';
import { classify, estimate, type MasteryState } from './mastery.ts';

export interface ConceptRef {
  id: string;
  prerequisiteIds: string[];
}

export interface WeakConcept {
  conceptId: string;
  /** 0..1, higher = needs attention sooner */
  need: number;
  reason: 'weak' | 'repeated_mistakes' | 'stale' | 'weak_prerequisite' | 'uncertain';
  blockingPrerequisiteId?: string;
}

/**
 * Detect weak concepts. A weak prerequisite surfaces BEFORE the dependent concept
 * (root-cause first). Unseen concepts are not "weak" — they are unexplored.
 */
export function detectWeakConcepts(
  concepts: ConceptRef[],
  states: Map<string, MasteryState>,
  now: number,
  limit = 20,
): WeakConcept[] {
  const out = new Map<string, WeakConcept>();
  const consider = (w: WeakConcept) => {
    const prev = out.get(w.conceptId);
    if (!prev || w.need > prev.need) out.set(w.conceptId, w);
  };
  for (const c of concepts) {
    const st = states.get(c.id);
    if (!st) continue;
    const level = classify(st, now);
    const est = estimate(st, now);
    const gap = 1 - est.mastery;
    if (level === 'weak') {
      const repeated = st.repeatedMistakes > 0;
      consider({
        conceptId: c.id,
        need: clamp01(gap + 0.1 * Math.min(3, st.repeatedMistakes)),
        reason: repeated ? 'repeated_mistakes' : 'weak',
      });
      for (const pid of c.prerequisiteIds) {
        const pst = states.get(pid);
        const pm = pst ? estimate(pst, now).mastery : 0.5;
        if (pm < 0.6) {
          consider({
            conceptId: pid,
            need: clamp01(1 - pm + 0.1),
            reason: 'weak_prerequisite',
            blockingPrerequisiteId: pid,
          });
        }
      }
    } else if (level === 'stale') {
      consider({ conceptId: c.id, need: clamp01(0.5 + gap), reason: 'stale' });
    } else if (level === 'uncertain' && st.incorrect > 0) {
      consider({ conceptId: c.id, need: clamp01(0.4 + gap * 0.5), reason: 'uncertain' });
    }
  }
  return [...out.values()].sort((a, b) => b.need - a.need).slice(0, limit);
}
