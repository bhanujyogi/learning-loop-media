# Social system

Implemented in SQL (migration 09) and used by the mobile feed (like/save, optimistic with rollback): follows, likes, saves, shares, comments (rate-limited, block-aware, restriction-aware), notifications + preferences (server-created only), `content_stats` counters via triggers.

- Own-only reads for likes/saves/shares; comments readable when content is visible and not blocked; follows readable by either party.
- Blocks hide content both ways and prevent follows/comments; blocked users cannot detect the block.
- Profiles: public basic profile; learning data stays private. XP/level/achievements are intentionally public (see SECURITY.md).
  **Not built yet (UI):** profile screens, follow button/creator pages, comments UI, share sheet, notification centre/push (expo-notifications installed, unconfigured), saved items screen.
