# Gamification

**Principle:** reward learning behaviours, not time spent. Passive watching = 0 XP (config + test).

| Action                                                                                                                                                                                            | XP (`XP_CONFIG`) |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| correct answer                                                                                                                                                                                    | 10               |
| incorrect attempt (effort)                                                                                                                                                                        | 2                |
| review completed                                                                                                                                                                                  | 8                |
| lesson / quiz completed                                                                                                                                                                           | 25 / 30          |
| concept newly mastered (bonus)                                                                                                                                                                    | 50               |
| Levels: geometric (`base 100`, ×1.35). Streak: consecutive active days (idempotent same-day). Achievements seeded: first_correct, streak_3, concept_mastered_1, review_10 (last not yet awarded). |
| Ledger is append-only and idempotent per attempt (`xp_ledger(user_id, idempotency_key)` UNIQUE). `user_progress` derived. Clients cannot write any of it.                                         |
| Feedback: haptics on answer (skipped when reduce-motion is on), result panel with XP/level/mastery bar/achievements; colour is never the only signal (✓/✗ text).                                  |
| Not built: friendly competition, concept unlock UI, badges gallery.                                                                                                                               |

## Anti-farming (audit H4)

Answering reveals the key, so repeats are weak evidence: `repeatFactor` discounts the n-th attempt at the same question within 24 h (1, 0.25, 0.1, 0.05, then 0) in mastery evidence; repeats do **not** move ability/frustration, FSRS schedule or learning-feedback features.
XP: at most one award per question + action (correct / effort) per UTC day, and `XP_CONFIG.dailyXpCap` (400) per UTC day across questions; the one-off concept-mastered bonus counts toward the cap. A genuine review on a later day (delayed recall) counts fully. Attempts are always recorded (`repeatAttempt` in the response).
