# Direct messaging

Tables: `conversations` (direct/group-ready, `direct_key` dedupes 1:1), `conversation_members` (`last_read_at`, `left_at`), `messages`, `message_reports`.
Rules (tested): conversations/members are created **only** by `start_direct_conversation(p_other)` — enforces auth, active account, sender restriction, blocks (both directions), recipient `dm_policy` (`everyone | followers | nobody`, default followers). Members-only read/send; spoofed `sender_id` rejected; messages immutable except sender soft-delete;
a blocked user cannot keep sending through an old conversation; 30 messages/60 s rate limit; reports are member-only. Realtime: subscribe to `messages` (RLS applies to Realtime). Message text is never used as a recommendation signal and never appears in analytics payloads.
**Not built:** UI, group conversations/attachments/voice, read-receipt updates API, message-report triage UI, unread counts.
