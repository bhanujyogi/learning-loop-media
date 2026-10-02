import { describe, expect, it } from 'vitest';
import { parseRankingConfig, RANKING_V1, rankingAlgorithmOf } from './index.ts';

const v1 = () => JSON.parse(JSON.stringify(rankingAlgorithmOf(RANKING_V1)));

describe('parseRankingConfig (DB-authoritative ranking config is validated like external input)', () => {
  it('round-trips the built-in RANKING_V1', () => {
    expect(parseRankingConfig('ranking_v1', v1())).toEqual(RANKING_V1);
  });
  it('rejects weights that do not sum to 1, unknown/missing keys, out-of-range values', () => {
    const a = v1();
    a.weights.exploration = 0.5;
    expect(() => parseRankingConfig('ranking_v2', a)).toThrow(/sum/);
    const b = v1();
    delete b.weights.novelty;
    expect(() => parseRankingConfig('ranking_v2', b)).toThrow(/weights keys/);
    const c = v1();
    c.weights.surprise = 0;
    expect(() => parseRankingConfig('ranking_v2', c)).toThrow(/weights keys/);
    const d = v1();
    d.explorationRatio = 0.9;
    expect(() => parseRankingConfig('ranking_v2', d)).toThrow(/explorationRatio/);
    const e = v1();
    e.batchSize = 0;
    expect(() => parseRankingConfig('ranking_v2', e)).toThrow(/batchSize/);
    const f = v1();
    f.repetition.content = -1;
    expect(() => parseRankingConfig('ranking_v2', f)).toThrow(/repetition/);
  });
  it('rejects non-objects, NaN and bad version strings', () => {
    expect(() => parseRankingConfig('ranking_v2', null)).toThrow();
    expect(() => parseRankingConfig('ranking_v2', [])).toThrow();
    const a = v1();
    a.weights.novelty = NaN;
    expect(() => parseRankingConfig('ranking_v2', a)).toThrow();
    expect(() => parseRankingConfig('latest', v1())).toThrow(/version format/);
  });
  it('accepts a legitimate alternative version (what an experiment would store)', () => {
    const a = v1();
    a.weights.learning_need = 0.2;
    a.weights.predicted_engagement = 0.12;
    a.batchSize = 12;
    const c = parseRankingConfig('ranking_v2', a);
    expect(c.version).toBe('ranking_v2');
    expect(c.batchSize).toBe(12);
  });
});
