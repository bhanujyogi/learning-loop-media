import type { HookType } from '@learning-loop/shared';

/** Ranking weights. Every key is a named, explainable feature (see docs/FEED_RANKING.md). */
export interface RankingWeights {
  predicted_engagement: number;
  predicted_learning_gain: number;
  learning_need: number;
  personal_interest: number;
  hook_affinity: number;
  difficulty_fit: number;
  content_quality: number;
  novelty: number;
  social_signal: number;
  exploration: number;
}

export interface RankingConfig {
  version: string;
  weights: RankingWeights;
  /** Share of each batch reserved for exploration candidates (0..1). */
  explorationRatio: number;
  /** Penalty multipliers applied to recently-seen dimensions. */
  repetition: { content: number; concept: number; creator: number; hook: number; format: number };
  /** Max share of one creator/subject/format within a batch (diversity constraint). */
  diversity: { maxPerCreator: number; maxPerSubject: number; maxPerFormat: number };
  batchSize: number;
}

/** Initial interpretable formulation from the product directive. NOT proven optimal. */
export const RANKING_V1: RankingConfig = {
  version: 'ranking_v1',
  weights: {
    predicted_engagement: 0.18,
    predicted_learning_gain: 0.18,
    learning_need: 0.14,
    personal_interest: 0.1,
    hook_affinity: 0.08,
    difficulty_fit: 0.08,
    content_quality: 0.06,
    novelty: 0.05,
    social_signal: 0.05,
    exploration: 0.08,
  },
  explorationRatio: 0.15,
  repetition: { content: 0.5, concept: 0.15, creator: 0.08, hook: 0.05, format: 0.05 },
  diversity: { maxPerCreator: 2, maxPerSubject: 4, maxPerFormat: 4 },
  batchSize: 10,
};

export const RANKING_CONFIGS: Record<string, RankingConfig> = { ranking_v1: RANKING_V1 };

export const getRankingConfig = (version: string): RankingConfig => {
  const c = RANKING_CONFIGS[version];
  if (!c) throw new Error(`Unknown ranking version: ${version}`);
  return c;
};

export const XP_CONFIG = {
  questionCorrect: 10,
  questionIncorrectAttempt: 2,
  reviewCompleted: 8,
  lessonCompleted: 25,
  quizCompleted: 30,
  conceptMastered: 50,
  /** Passive watching intentionally earns nothing. */
  watchComplete: 0,
  /** Max XP per UTC day from answering questions (anti-farming). Also: at most one award per question/action per day. */
  dailyXpCap: 400,
  levelBase: 100,
  levelGrowth: 1.35,
} as const;

export const FEATURE_FLAGS = {
  local_ai: false,
  ranking_v2: false,
  interactive_map: true,
  dm_enabled: true,
} as const;
export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const isEnabled = (
  flag: FeatureFlag,
  overrides: Partial<Record<FeatureFlag, boolean>> = {},
) => overrides[flag] ?? FEATURE_FLAGS[flag];

export const RATE_LIMITS = {
  message_send: { max: 30, windowSeconds: 60 },
  comment_create: { max: 10, windowSeconds: 60 },
  report_submit: { max: 10, windowSeconds: 3600 },
  content_upload: { max: 20, windowSeconds: 3600 },
  official_publish: { max: 50, windowSeconds: 3600 },
} as const;

export const MODERATION_CONFIG = {
  autoFlagReportThreshold: 3,
} as const;

export const NEUTRAL_HOOK_PRIOR: Record<HookType, number> = {
  curiosity: 0.5,
  challenge: 0.5,
  surprise: 0.5,
  prediction: 0.5,
  mistake: 0.5,
  exam: 0.5,
  myth: 0.5,
  real_world: 0.5,
  comparison: 0.5,
  speed: 0.5,
  story: 0.5,
  question: 0.5,
};
