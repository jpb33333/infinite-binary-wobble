import { describe, it, expect } from 'vitest';
import { evaluateGate } from '../src/lib/gate.ts';

describe('evaluateGate', () => {
  it('reports remaining within the free tier', () => {
    expect(evaluateGate({ playCount: 10, freeLimit: 100, entitled: false })).toEqual({
      plays: 10,
      remaining: 90,
      locked: false,
      entitled: false,
    });
  });

  it('locks exactly at the limit', () => {
    expect(evaluateGate({ playCount: 100, freeLimit: 100, entitled: false })).toEqual({
      plays: 100,
      remaining: 0,
      locked: true,
      entitled: false,
    });
  });

  it('never reports negative remaining past the limit', () => {
    const r = evaluateGate({ playCount: 150, freeLimit: 100, entitled: false });
    expect(r.remaining).toBe(0);
    expect(r.locked).toBe(true);
  });

  it('entitled devices are never locked and report unlimited', () => {
    expect(evaluateGate({ playCount: 9999, freeLimit: 100, entitled: true })).toEqual({
      plays: 9999,
      remaining: null,
      locked: false,
      entitled: true,
    });
  });
});
