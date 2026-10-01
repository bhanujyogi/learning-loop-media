# Security

## Secrets & keys

| Variable                                             | Where                                     | Public?                                                    |
| ---------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`, `NEXT_PUBLIC_*` | clients                                   | yes (anon key is designed to be public; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`       | Edge Functions/CI/local scripts only      | **never**                                                  |
| Publishing/ingestion credentials                     | service identities' own JWT/secrets store | **never**                                                  |

`createPublicClient` throws when handed a service-role JWT, `sb_secret_…` or anything named like one. `.env*` is gitignored except `.env.example`. Run `mcp__github__run_secret_scanning` / a scanner in CI before release (TODO).

## Threat model highlights → mitigations

- _Forge mastery/XP/answers_ → no client write policies; server grading; idempotency keys; raw events ignored for mastery.
- _Scrape answers_ → answer keys in separate RLS-protected table; body check rejects `answer`/`explanation`; `toClientQuestion` strips; ordering items not leaked by position.
- _Escalate to official_ → structural ownership + permissions + identity membership + gates + provenance; guard triggers; tests.
- _Abuse messaging/comments/reports/uploads_ → rate limits (`rate_limit_rules`), blocks (cannot be bypassed via old conversations), `dm_policy`, restrictions, report de-duplication.
- _Malicious uploads_ → private bucket, bucket MIME/size limits, owner-path scoping, server-side magic-number sniffing (`validateUpload` in `database/media`), keys are server-generated (no user filenames). TODO: AV/transcode pipeline.
- _Injection via content_ → notes are structured blocks (no raw HTML); SVG map paths whitelist-validated; Next admin sets CSP/XFO headers.
- _Analytics privacy_ → taxonomy-declared keys only, primitives, secret-name filter, no message text/emails/tokens; retention per event (ANALYTICS.md).
- _Admin compromise blast radius_ → admin runs as the user under RLS; no service key; privileged actions audited and append-only.
- _Info leakage_ → Edge Functions map errors to codes; mobile shows friendly messages; sign-in errors are generic; blocked users cannot detect blocks (`user_blocks` select limited to blocker).

## Known gaps (tracked in PROJECT_STATUS.md)

Edge Functions not exercised against a real Supabase; no CAPTCHA/auth-attempt rate limiting beyond Supabase Auth defaults; no malware scanning; no dependency-audit gate failing CI yet;
`user_progress`/`user_achievements` are intentionally readable by any authenticated user (public XP/level/badges) — revisit if privacy requirements change.
