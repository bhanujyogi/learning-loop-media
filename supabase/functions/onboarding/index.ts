import { completeOnboarding } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const userId = await requireUser(req);
    const b = await req.json();
    const interests = Array.isArray(b?.interestSubjectIds)
      ? b.interestSubjectIds
          .filter((x: unknown) => typeof x === 'string' && UUID.test(x))
          .slice(0, 12)
      : [];
    const examId = typeof b?.examId === 'string' && UUID.test(b.examId) ? b.examId : undefined;
    const examDate =
      typeof b?.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.examDate)
        ? b.examDate
        : undefined;
    await completeOnboarding(sql(), {
      userId,
      examId,
      examDate,
      educationLevel:
        typeof b?.educationLevel === 'string' ? b.educationLevel.slice(0, 40) : undefined,
      interestSubjectIds: interests,
    });
    return json(200, { ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
