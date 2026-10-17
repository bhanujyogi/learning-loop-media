import { describe, expect, it } from 'vitest';
import {
  bodyMediaIds,
  cleanSearch,
  escapeIlike,
  followStats,
  formatCount,
  ilikePattern,
  normalizeUsername,
  profileSaveError,
  relationActions,
  usernameProblem,
} from './profile-model';

describe('username', () => {
  it('normalizes and validates', () => {
    expect(normalizeUsername('  @Ab_C1 ')).toBe('ab_c1');
    expect(usernameProblem('ab')).toBe('length');
    expect(usernameProblem('a'.repeat(31))).toBe('length');
    expect(usernameProblem('bad name')).toBe('chars');
    expect(usernameProblem('Good_Name9')).toBeNull();
  });
});

describe('search', () => {
  it('escapes ilike wildcards', () => {
    expect(escapeIlike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(ilikePattern('a_b')).toBe('%a\\_b%');
    expect(cleanSearch('  @raj ')).toBe('raj');
    expect(cleanSearch('   ')).toBe('');
  });
});

describe('formatCount', () => {
  it('abbreviates', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1234)).toBe('1.2K');
    expect(formatCount(12500)).toBe('12.5K');
    expect(formatCount(999_999)).toBe('1M');
    expect(formatCount(2_500_000)).toBe('2.5M');
    expect(formatCount(-3)).toBe('0');
  });
});

describe('followStats', () => {
  it('derives friends as mutual follows', () => {
    const rows = [
      { follower_id: 'me', followee_id: 'a' },
      { follower_id: 'a', followee_id: 'me' },
      { follower_id: 'me', followee_id: 'b' },
      { follower_id: 'c', followee_id: 'me' },
    ];
    expect(followStats('me', rows)).toEqual({ followers: 2, following: 2, friends: 1 });
  });
});

describe('relationActions', () => {
  it('maps relationships to buttons', () => {
    expect(relationActions('none')).toEqual(['addFriend', 'follow']);
    expect(relationActions('request_sent')).toEqual(['requested']);
    expect(relationActions('request_received')).toEqual(['accept', 'decline']);
    expect(relationActions('friends')).toEqual(['friends', 'message']);
    expect(relationActions('self')).toEqual([]);
  });
});

describe('misc', () => {
  it('reads media ids defensively', () => {
    expect(bodyMediaIds({ mediaIds: ['x', 3] })).toEqual(['x']);
    expect(bodyMediaIds(null)).toEqual([]);
  });
  it('maps save errors', () => {
    expect(profileSaveError({ code: '23505' })).toBe('taken');
    expect(profileSaveError({ code: '42501' })).toBe('unavailable');
    expect(profileSaveError({ code: 'x' })).toBe('failed');
    expect(profileSaveError(null)).toBeNull();
  });
});
