import { submitAnswer } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const userId = await requireUser(req);
    const b = await req.json();
    if (typeof b?.questionId !== 'string') return json(400, { error: 'invalid_input' });
    const result = await submitAnswer(sql(), {
      userId,
      questionId: b.questionId,
      response: b.response,
      responseMs: b.responseMs,
      hintsUsed: b.hintsUsed,
      confidence: b.confidence,
      recommendationId: typeof b.recommendationId === 'string' ? b.recommendationId : undefined,
      idempotencyKey:
        typeof b.idempotencyKey === 'string' ? b.idempotencyKey.slice(0, 100) : undefined,
    });
    return json(200, result);
  } catch (e) {
    return errorResponse(e);
  }
});
