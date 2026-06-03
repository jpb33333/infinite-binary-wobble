import { describe, it, expect } from 'vitest';
import {
  generateStarfield,
  starCountForViewport,
  STAR_DENSITY,
} from '../src/render/starfield.ts';

describe('generateStarfield', () => {
  it('produces the requested number of stars', () => {
    expect(generateStarfield(200)).toHaveLength(200);
  });

  it('stores positions normalized to [0, 1]', () => {
    for (const s of generateStarfield(500)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic — same seed yields the same field', () => {
    expect(generateStarfield(50)).toEqual(generateStarfield(50));
  });

  it('is order-stable: growing the count only appends to the tail', () => {
    // This is what keeps stars from jumping on resize — a bigger window asks
    // for more stars, and the existing ones must keep their exact positions.
    const small = generateStarfield(100);
    const big = generateStarfield(260);
    expect(big.slice(0, 100)).toEqual(small);
  });
});

describe('starCountForViewport', () => {
  it('holds density roughly constant across viewport area', () => {
    const n = starCountForViewport(2000, 1000);
    expect(n).toBe(Math.round(STAR_DENSITY * 2000 * 1000));
  });

  it('clamps to a sane floor and ceiling', () => {
    expect(starCountForViewport(10, 10)).toBe(60); // floor
    expect(starCountForViewport(8000, 8000)).toBe(600); // ceiling
  });
});
