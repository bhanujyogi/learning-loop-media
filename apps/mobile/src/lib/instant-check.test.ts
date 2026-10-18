import { describe, expect, it } from 'vitest';
import {
  instantCheckHash,
  makeInstantCheck,
} from '../../../../packages/database/src/services/instant-check.ts';
import {
  findCorrectToken,
  instantHash,
  instantStates,
  instantVerdict,
  isInstantCheck,
  supportsInstant,
} from './instant-check';

const CID = '11111111-2222-3333-4444-555555555555';
const OPTS = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];
const ic = (token: string) => makeInstantCheck(CID, token, 'Because नमस्ते.');

describe('server/app parity', () => {
  it('the app hash equals the Node-side instantCheckHash', () => {
    for (const token of [...OPTS, 'true', 'false', 'विकल्प']) {
      expect(instantHash('abcd1234', CID, token)).toBe(instantCheckHash('abcd1234', CID, token));
    }
  });
  it('verifies exactly what the server generates', () => {
    for (const correct of OPTS) {
      const check = ic(correct);
      expect(findCorrectToken(check, CID, OPTS)).toBe(correct);
      for (const tapped of OPTS) {
        const v = instantVerdict(check, CID, OPTS, tapped)!;
        expect(v.correct).toBe(tapped === correct);
        expect(v.correctToken).toBe(correct);
        expect(v.explanation).toBe('Because नमस्ते.');
      }
    }
  });
  it('true/false tokens', () => {
    const check = makeInstantCheck(CID, 'false', 'x');
    expect(instantVerdict(check, CID, ['true', 'false'], 'true')!.correct).toBe(false);
    expect(instantVerdict(check, CID, ['true', 'false'], 'false')!.correct).toBe(true);
  });
});

describe('fallback to the server flow', () => {
  it('missing or malformed instantCheck', () => {
    for (const bad of [undefined, null, {}, { salt: 's', hash: 'nothex', explanation: '' }, 'x']) {
      expect(isInstantCheck(bad)).toBe(false);
      expect(instantVerdict(bad, CID, OPTS, 'opt-a')).toBeNull();
      expect(findCorrectToken(bad, CID, OPTS)).toBeNull();
    }
  });
  it('tampered hash, wrong content id, or an unknown tapped token', () => {
    const check = ic('opt-b');
    const tampered = { ...check, hash: (check.hash[0] === 'a' ? 'b' : 'a') + check.hash.slice(1) };
    expect(instantVerdict(tampered, CID, OPTS, 'opt-b')).toBeNull();
    expect(instantVerdict(check, 'other-id', OPTS, 'opt-b')).toBeNull();
    expect(instantVerdict(check, CID, OPTS, 'nope')).toBeNull();
    expect(instantVerdict({ ...check, salt: 'zz' }, CID, OPTS, 'opt-b')).toBeNull();
  });
  it('only single_choice and true_false are instant', () => {
    expect(supportsInstant('single_choice')).toBe(true);
    expect(supportsInstant('true_false')).toBe(true);
    for (const t of ['multi_choice', 'fill_blank', 'numerical', 'ordering', 'image_based'])
      expect(supportsInstant(t)).toBe(false);
  });
});

describe('instantStates', () => {
  it('wrong tap: red on the tap, correct highlighted, rest idle', () => {
    expect(instantStates(OPTS, { tapped: 'opt-a', correctToken: 'opt-c' })).toEqual({
      'opt-a': 'wrong',
      'opt-b': 'idle',
      'opt-c': 'missed',
      'opt-d': 'idle',
    });
  });
  it('right tap', () => {
    expect(instantStates(OPTS, { tapped: 'opt-c', correctToken: 'opt-c' })['opt-c']).toBe(
      'correct',
    );
  });
});
