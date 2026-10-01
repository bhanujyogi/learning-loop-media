import type { FormatType, HookType } from '@learning-loop/shared';

export type CandidateSource =
  | 'weak_concept'
  | 'review_due'
  | 'exam_requirement'
  | 'interest'
  | 'followed_creator'
  | 'saved_topic'
  | 'new_content'
  | 'high_quality'
  | 'adjacent_concept'
  | 'challenge'
  | 'exploration'
  | 'trending'
  | 'related';

/** Pedagogical role used by the sequencer (story-arc ordering). */
export type SequenceRole =
  'introduction' | 'application' | 'prediction' | 'challenge' | 'explanation' | 'review';

export interface Candidate {
  contentId: string;
  conceptIds: string[];
  subjectId: string;
  creatorId: string;
  format: FormatType;
  hook: HookType | null;
  /** 0..1 */
  difficulty: number;
  /** 0..1 editorial/behavioural quality estimate */
  quality: number;
  /** 0..1 popularity among relevant learners; never overrides learner-fit by default */
  socialSignal: number;
  /** Observed platform-wide learning gain for this content 0..1, null if unknown */
  learningGainStat: number | null;
  ageHours: number;
  sources: CandidateSource[];
  role?: SequenceRole;
  /** eligibility inputs */
  published: boolean;
  moderationOk: boolean;
  freshness: 'current' | 'needs_review' | 'outdated' | 'archived';
}

export interface Affinity {
  score: number; // 0..1, 0.5 = neutral
  n: number; // evidence count (drives exploration/uncertainty)
}

export interface RecentWindow {
  contentIds: string[];
  conceptIds: string[];
  creatorIds: string[];
  hooks: string[];
  formats: string[];
}

export interface LearnerFeatures {
  learnerId: string;
  /** Model A: engagement preference */
  subject: Record<string, Affinity>;
  format: Record<string, Affinity>;
  hook: Record<string, Affinity>;
  creator: Record<string, Affinity>;
  /** Model B: learning response (does it produce measurable learning for this learner?) */
  formatLearning: Record<string, Affinity>;
  hookLearning: Record<string, Affinity>;
  /** 0..1 ability and frustration (see learning-engine/difficulty) */
  ability: number;
  frustration: number;
  /** concept id → need 0..1 (weak/stale/uncertain), from learning-engine */
  conceptNeed: Record<string, number>;
  dueConceptIds: string[];
  followedCreatorIds: string[];
  seenContentIds: string[];
  blockedCreatorIds: string[];
  /** Concepts/content demanded by the exam syllabus mapping 0..1 */
  examRelevance: Record<string, number>;
  examDate: number | null; // epoch ms
  recent: RecentWindow;
  /** Fatigue: rapid skipping in the session. 0..1 */
  sessionFatigue: number;
}

export interface Contribution {
  feature: string;
  value: number; // raw 0..1 feature value
  weight: number;
  contribution: number; // weight*value (or negative for penalties)
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  contributions: Contribution[];
  penalties: Contribution[];
  isExploration: boolean;
  /** deliberate resurfacing (due/failed) – exempt from repetition penalty */
  isReview: boolean;
}

export interface Exclusion {
  contentId: string;
  reason:
    | 'not_published'
    | 'moderation'
    | 'outdated'
    | 'blocked_creator'
    | 'already_seen'
    | 'duplicate_in_pool';
}

export interface RankedItem {
  contentId: string;
  position: number;
  score: number;
  isExploration: boolean;
  /** why_shown: signed contributions; stored in recommendation diagnostics */
  whyShown: Record<string, number>;
  sources: CandidateSource[];
}

export interface FeedResult {
  rankingVersion: string;
  items: RankedItem[];
  excluded: Exclusion[];
  diagnostics: {
    candidatePool: number;
    eligible: number;
    explorationCount: number;
    examPressure: number;
  };
}
