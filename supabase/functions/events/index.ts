import { recordEvents } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const userId = await requireUser(req);
    const b = await req.json();
    if (!Array.isArray(b?.events)) return json(400, { error: 'invalid_input' });
    return json(200, await recordEvents(sql(), userId, b.events));
  } catch (e) {
    return errorResponse(e);
  }
});
