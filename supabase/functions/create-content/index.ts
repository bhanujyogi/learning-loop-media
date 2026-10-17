import { createContent, DomainFailure } from '@learning-loop/database';
import { errorResponse, json, requireUser, sql } from '../_shared/runtime.ts';

// Creator upload. Runs under the `authenticated` role as the verified caller (RLS + guard triggers + rate limits apply);
// the body is validated with the shared content schemas before anything is written. See packages/database services/creator.ts.
// Bulk: `{ items: [...] }` (≤ 50 per request) creates each item in its own transaction and reports every result, so one bad row
// never blocks the rest.
const MAX_BULK = 50;

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const userId = await requireUser(req);
    const b = await req.json().catch(() => null);
    const db = sql('authenticated');
    if (b && typeof b === 'object' && Array.isArray((b as { items?: unknown }).items)) {
      const items = (b as { items: unknown[] }).items;
      if (items.length < 1 || items.length > MAX_BULK) return json(400, { error: 'invalid_input' });
      const results: { ok: boolean; contentId?: string; error?: string }[] = [];
      for (const it of items) {
        try {
          const r = await createContent(db, userId, it);
          results.push({ ok: true, contentId: r.contentId });
        } catch (e) {
          if (!(e instanceof DomainFailure) && (e as { code?: string }).code !== '54000') throw e;
          results.push({ ok: false, error: (e as DomainFailure).code ?? 'rate_limited' });
          if ((e as DomainFailure).code === 'rate_limited') break; // later rows would fail the same way
        }
      }
      return json(200, { results });
    }
    return json(200, await createContent(db, userId, b));
  } catch (e) {
    return errorResponse(e);
  }
});
