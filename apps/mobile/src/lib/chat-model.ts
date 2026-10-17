import { parseShareToken } from './social';

/** Pure helpers for the chat screens (kept free of React / Supabase so they are unit-tested). */

export interface ChatPerson {
  id: string;
  username: string;
  displayName: string | null;
  avatarPath: string | null;
}
export interface ConversationRow {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  lastMessageAt: string | null;
  lastBody: string | null;
  unread: number;
  /** everyone in the conversation except the signed-in user */
  members: ChatPerson[];
}
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** client-only state of an optimistic message */
  pending?: 'sending' | 'failed';
}

export const personName = (p: Pick<ChatPerson, 'username' | 'displayName'>): string =>
  p.displayName?.trim() || p.username;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Defensive parse of the `my_conversations()` jsonb so a malformed row never crashes the inbox. */
export function parseConversations(data: unknown): ConversationRow[] {
  if (!Array.isArray(data)) return [];
  const out: ConversationRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r.id !== 'string') continue;
    const members = Array.isArray(r.members)
      ? (r.members as Record<string, unknown>[])
          .filter((m) => m && typeof m.id === 'string')
          .map((m) => ({
            id: m.id as string,
            username: str(m.username) ?? '',
            displayName: str(m.displayName),
            avatarPath: str(m.avatarPath),
          }))
      : [];
    out.push({
      id: r.id,
      kind: r.kind === 'group' ? 'group' : 'direct',
      title: str(r.title),
      lastMessageAt: str(r.lastMessageAt),
      lastBody: str(r.lastBody),
      unread: typeof r.unread === 'number' ? r.unread : 0,
      members,
    });
  }
  return out;
}

/** Direct: the other person's display name / username. Group: its title (or the member names). */
export function conversationName(c: ConversationRow, fallback: string): string {
  if (c.kind === 'group')
    return c.title?.trim() || c.members.map(personName).slice(0, 3).join(', ') || fallback;
  const other = c.members[0];
  return other ? personName(other) : fallback;
}

export type Preview = { kind: 'none' } | { kind: 'share' } | { kind: 'text'; text: string };
export function messagePreview(body: string | null | undefined): Preview {
  if (!body) return { kind: 'none' };
  if (parseShareToken(body)) return { kind: 'share' };
  return { kind: 'text', text: body.replace(/\s+/g, ' ').trim() };
}

/** Compact time: today -> HH:MM, within a week -> weekday, otherwise short date. */
export function formatChatTime(iso: string | null, now: Date, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dayMs = 24 * 3600 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  try {
    if (d.getTime() >= startOfToday)
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
    if (d.getTime() >= startOfToday - 6 * dayMs)
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type SendErrorKind = 'rate' | 'forbidden' | 'offline' | 'other';
/** Maps a Supabase/PostgREST/network error to a user-facing category (never shows raw server text). */
export function sendErrorKind(
  error: { code?: string; message?: string } | null | undefined,
): SendErrorKind {
  if (!error) return 'other';
  const msg = error.message ?? '';
  if (error.code === '54000' || /rate_limited|rate limit/i.test(msg)) return 'rate';
  if (
    error.code === '42501' ||
    /forbidden|restricted|not a member|does not accept|unavailable/i.test(msg)
  )
    return 'forbidden';
  if (/network|fetch|failed to|offline|timeout/i.test(msg)) return 'offline';
  return 'other';
}

/** Merge rows by id (incoming wins) and sort oldest -> newest. */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

/** Newest-first list for an inverted FlatList: pending/failed optimistic messages sit at the bottom. */
export function displayMessages(server: ChatMessage[], pending: ChatMessage[]): ChatMessage[] {
  return [...pending].reverse().concat([...server].reverse());
}

/** Show the sender name above a message only in groups, for others, and when the sender changes. */
export function showSenderName(
  group: boolean,
  mine: boolean,
  prevSender: string | undefined,
  sender: string,
): boolean {
  return group && !mine && prevSender !== sender;
}

/** Friends = mutual follows. Returns ids present in both directions. */
export function mutualIds(iFollow: string[], followMe: string[]): string[] {
  const set = new Set(followMe);
  return [...new Set(iFollow)].filter((id) => set.has(id));
}
