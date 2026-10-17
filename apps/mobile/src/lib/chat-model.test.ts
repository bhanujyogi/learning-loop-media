import { describe, expect, it, vi } from 'vitest';
import {
  conversationName,
  displayMessages,
  formatChatTime,
  messagePreview,
  mergeMessages,
  mutualIds,
  parseConversations,
  sendErrorKind,
  showSenderName,
  type ChatMessage,
} from './chat-model';
import { shareToken } from './social';
vi.mock('./supabase', () => ({ supabase: {} }));

const id = '123e4567-e89b-12d3-a456-426614174000';
const msg = (i: string, t: string): ChatMessage => ({
  id: i,
  conversation_id: 'c',
  sender_id: 's',
  body: i,
  created_at: t,
});

describe('chat-model', () => {
  it('parses conversations defensively', () => {
    expect(parseConversations(null)).toEqual([]);
    const r = parseConversations([
      { id: 'a', kind: 'group', title: 'T', unread: 2, members: [{ id: 'u', username: 'x' }, {}] },
      { nope: 1 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'group', unread: 2 });
    expect(r[0]!.members).toHaveLength(1);
  });
  it('names conversations', () => {
    const p = { id: 'u', username: 'sam', displayName: 'Sam K', avatarPath: null };
    const base = { id: 'a', title: null, lastMessageAt: null, lastBody: null, unread: 0 };
    expect(conversationName({ ...base, kind: 'direct', members: [p] }, '?')).toBe('Sam K');
    expect(conversationName({ ...base, kind: 'direct', members: [] }, '?')).toBe('?');
    expect(conversationName({ ...base, kind: 'group', title: 'Study', members: [p] }, '?')).toBe(
      'Study',
    );
    expect(
      conversationName({ ...base, kind: 'group', members: [{ ...p, displayName: null }] }, '?'),
    ).toBe('sam');
  });
  it('previews shared posts and text', () => {
    expect(messagePreview(shareToken(id))).toEqual({ kind: 'share' });
    expect(messagePreview('hi \n there')).toEqual({ kind: 'text', text: 'hi there' });
    expect(messagePreview(null)).toEqual({ kind: 'none' });
  });
  it('formats time relative to now', () => {
    const now = new Date(2026, 5, 10, 15, 0);
    expect(formatChatTime(null, now, 'en')).toBe('');
    expect(formatChatTime('garbage', now, 'en')).toBe('');
    expect(formatChatTime(new Date(2026, 5, 10, 9, 5).toISOString(), now, 'en')).toMatch(
      /9:05|09:05/,
    );
    expect(formatChatTime(new Date(2026, 5, 8, 9, 5).toISOString(), now, 'en')).toMatch(/Mon/);
    expect(formatChatTime(new Date(2026, 0, 3, 9, 5).toISOString(), now, 'en')).toMatch(/Jan/);
  });
  it('classifies send errors', () => {
    expect(sendErrorKind({ code: '54000' })).toBe('rate');
    expect(sendErrorKind({ message: 'rate_limited: message_send' })).toBe('rate');
    expect(sendErrorKind({ code: '42501', message: 'forbidden' })).toBe('forbidden');
    expect(sendErrorKind({ message: 'Network request failed' })).toBe('offline');
    expect(sendErrorKind({ message: 'boom' })).toBe('other');
  });
  it('merges and orders messages', () => {
    const a = msg('a', '2026-01-01T00:00:01Z');
    const b = msg('b', '2026-01-01T00:00:02Z');
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(['a', 'b']);
    const p = { ...msg('p', '2026-01-01T00:00:03Z'), pending: 'sending' as const };
    expect(displayMessages([a, b], [p]).map((m) => m.id)).toEqual(['p', 'b', 'a']);
  });
  it('sender names and mutual ids', () => {
    expect(showSenderName(true, false, 'x', 'y')).toBe(true);
    expect(showSenderName(true, false, 'y', 'y')).toBe(false);
    expect(showSenderName(false, false, undefined, 'y')).toBe(false);
    expect(showSenderName(true, true, undefined, 'me')).toBe(false);
    expect(mutualIds(['a', 'b', 'a'], ['b', 'c'])).toEqual(['b']);
  });
});
