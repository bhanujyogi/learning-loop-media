import { env } from './env';
import { supabase } from './supabase';

/** Region of the Supabase project (Seoul). */
export const DB_REGION = 'ap-northeast-2';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
  get isOffline() {
    return this.status === 0;
  }
}

/** Calls a Supabase Edge Function as the signed-in user. Raw server errors are mapped to safe codes. */
async function call<T>(
  name: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number> } = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'unauthorized');
  const qs = init.query
    ? '?' +
      new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)])).toString()
    : '';
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/${name}${qs}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        authorization: `Bearer ${token}`,
        apikey: env.supabaseAnonKey,
        'content-type': 'application/json',
        // Run the function in the DATABASE's region: it makes dozens of sequential queries, which were taking 7 s from a nearer
        // region (every query crossed an ocean). One longer hop from the phone is far cheaper.
        'x-region': DB_REGION,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (!res.ok) {
    let code = 'error';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export interface FeedItem {
  contentId: string;
  type: string;
  title: string;
  format: string | null;
  hook: string | null;
  difficulty: number | null;
  body: unknown;
  position: number;
  recommendationId: string;
  isExploration: boolean;
  language: string;
  /** Author's user id for user/creator content (followable); null for official content. */
  creatorUserId: string | null;
  official: boolean;
  /** single-choice / true-false questions: instant local right/wrong + explanation (see lib/instant-check.ts) */
  instantCheck?: { salt: string; hash: string; explanation: string };
}
export interface FeedResponse {
  recommendationId: string | null;
  rankingVersion: string;
  items: FeedItem[];
  exhausted: boolean;
}
export interface SubmitAnswerResponse {
  attemptId: string;
  correct: boolean;
  score: number;
  explanation: string;
  correctAnswer: unknown;
  xp: { awarded: number; total: number; level: number; leveledUp: boolean };
  mastery: { conceptId: string; mastery: number; confidence: number; level: string }[];
  nextReviewAt: number;
  achievements: string[];
  replayed: boolean;
  /** Same question answered again within 24 h: reduced learning evidence and no repeat XP (server rule). */
  repeatAttempt: boolean;
}

export const api = {
  feed: (limit = 10) => call<FeedResponse>('feed', { query: { limit } }),
  submitAnswer: (b: {
    questionId: string;
    response: unknown;
    responseMs?: number;
    hintsUsed?: number;
    confidence?: number;
    recommendationId?: string;
    idempotencyKey: string;
  }) => call<SubmitAnswerResponse>('submit-answer', { body: b }),
  events: (events: { name: string; payload?: Record<string, unknown>; at?: number }[]) =>
    call<{ accepted: number; dropped: number }>('events', { body: { events } }),
  createContent: (b: unknown) =>
    call<{ contentId: string; moderation: string }>('create-content', { body: b }),
  /** Up to 50 posts per request; every row gets its own result so one bad row never blocks the rest. */
  createContentBulk: (items: unknown[]) =>
    call<{ results: { ok: boolean; contentId?: string; error?: string }[] }>('create-content', {
      body: { items },
    }),
  onboarding: (b: {
    examId?: string;
    examDate?: string;
    interestSubjectIds: string[];
    educationLevel?: string;
    language?: string;
    preparationLevel?: string;
  }) => call<{ ok: true }>('onboarding', { body: b }),
};
