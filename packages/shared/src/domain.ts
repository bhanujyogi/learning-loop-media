/**
 * Canonical domain vocabulary. The SQL enums in supabase/migrations MUST mirror these
 * (enforced by packages/database tests). Several independent dimensions are modelled
 * separately on purpose (see docs/CONTENT_SYSTEM.md): ownership, source type,
 * verification, publishing, moderation, freshness.
 */
export const CONTENT_TYPES = [
  'video',
  'note',
  'question',
  'quiz',
  'flashcard',
  'lesson',
  'course',
  'pdf',
  'audio',
  'image',
  'interactive',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Who owns/publishes the object (structural, never a username check). */
export const OWNERSHIP_KINDS = ['official', 'creator', 'user'] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

/** How the knowledge entered the platform. */
export const SOURCE_TYPES = [
  'original',
  'imported',
  'ai_generated',
  'ai_assisted',
  'community',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const VERIFICATION_STATUSES = [
  'unverified',
  'source_backed',
  'reviewed',
  'official',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PUBLISHING_STATUSES = [
  'draft',
  'published',
  'unpublished',
  'archived',
  'deleted',
] as const;
export type PublishingStatus = (typeof PUBLISHING_STATUSES)[number];

export const MODERATION_STATUSES = [
  'none',
  'pending_review',
  'flagged',
  'restricted',
  'removed',
  'appealed',
  'cleared',
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const FRESHNESS_STATUSES = ['current', 'needs_review', 'outdated', 'archived'] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const HOOK_TYPES = [
  'curiosity',
  'challenge',
  'surprise',
  'prediction',
  'mistake',
  'exam',
  'myth',
  'real_world',
  'comparison',
  'speed',
  'story',
  'question',
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const FORMAT_TYPES = [
  'animation',
  'video',
  'diagram',
  'question',
  'interactive',
  'challenge',
  'story',
  'map',
  'timeline',
  'note',
  'flashcard',
] as const;
export type FormatType = (typeof FORMAT_TYPES)[number];

export const QUESTION_TYPES = [
  'single_choice',
  'multi_choice',
  'true_false',
  'fill_blank',
  'numerical',
  'matching',
  'ordering',
  'image_based',
  'map_based',
  'application',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const LICENSE_CODES = [
  'public_domain',
  'cc0',
  'cc_by',
  'cc_by_sa',
  'cc_by_nc',
  'cc_by_nd',
  'cc_by_nc_sa',
  'cc_by_nc_nd',
  'open_government',
  'mit',
  'apache_2',
  'proprietary',
  'unknown',
] as const;
export type LicenseCode = (typeof LICENSE_CODES)[number];

export const TRUST_LEVELS = ['high', 'standard', 'needs_review', 'blocked'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'retrying',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ROLES = [
  'student',
  'creator',
  'moderator',
  'admin',
  'official_content_creator',
  'service',
] as const;
export type Role = (typeof ROLES)[number];

/** A normalised score in [0, 1]. */
export type Unit = number;

export const clamp01 = (x: number): Unit => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/**
 * UI/content languages the product supports today. Language is DATA: adding one means adding a code here, a message
 * catalogue in apps/mobile/src/i18n and (optionally) `name_i18n` entries — no schema change. `profiles.locale` stores it.
 */
export const SUPPORTED_LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const isSupportedLocale = (x: unknown): x is Locale =>
  typeof x === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(x);

/**
 * Self-reported approximate preparation level captured at onboarding (`learner_profiles.preparation_level`).
 * It only seeds the cold-start ability prior; real evidence from graded answers takes over quickly.
 */
export const PREPARATION_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type PreparationLevel = (typeof PREPARATION_LEVELS)[number];
export const PREPARATION_ABILITY_PRIOR: Record<PreparationLevel, number> = {
  beginner: 0.35,
  intermediate: 0.5,
  advanced: 0.65,
};
