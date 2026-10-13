import { createContent } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

// Creator upload. Runs under the `authenticated` role as the verified caller (RLS + guard triggers + rate limits apply);
// the body is validated with the shared content schemas before anything is written. See packages/database services/creator.ts.
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const userId = await requireUser(req);
    const b = await req.json().catch(() => null);
    return json(200, await createContent(sql('authenticated'), userId, b));
  } catch (e) {
    return errorResponse(e);
  }
});
