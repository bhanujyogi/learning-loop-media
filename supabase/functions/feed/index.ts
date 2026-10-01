import { getFeed } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

Deno.serve(async (req) => {
  try {
    const userId = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') ?? 10)));
    return json(200, await getFeed(sql(), { userId, limit }));
  } catch (e) {
    return errorResponse(e);
  }
});
