import { describe, it, expect } from 'vitest';
import { activeComet } from '../src/render/comet.ts';

// PERIOD = 24s, TRANSIT = 3.2s (private to comet.ts). These tests pin the
// observable contract — occasional, fades at the edges, deterministic — without
// importing the constants, so tuning them doesn't churn the assertions.
const W = 1280;
const H = 800;

describe('activeComet', () => {
  it('is empty sky for most of the period', () => {
    // After the transit (3.2s) and before the next period (24s): nothing.
    expect(activeComet(5, W, H)).toBeNull();
    expect(activeComet(12, W, H)).toBeNull();
    expect(activeComet(23.9, W, H)).toBeNull();
  });

  it('shows a comet during the transit window', () => {
    const c = activeComet(1.6, W, H); // mid first transit
    expect(c).not.toBeNull();
    expect(c!.alpha).toBeGreaterThan(0.9); // sin(0.5π) ≈ 1 at mid-sky
  });

  it('fades in at entry and out at exit (alpha ~0 at the edges)', () => {
    expect(activeComet(0, W, H)!.alpha).toBeCloseTo(0, 2); // p=0
    expect(activeComet(3.19, W, H)!.alpha).toBeLessThan(0.05); // p→1
  });

  it('reappears once per period', () => {
    expect(activeComet(24, W, H)).not.toBeNull(); // idx 1 begins
    expect(activeComet(25.6, W, H)!.alpha).toBeGreaterThan(0.9); // its mid-sky
    expect(activeComet(30, W, H)).toBeNull(); // and is gone again
  });

  it('is deterministic — same time yields the same state', () => {
    expect(activeComet(1.6, W, H)).toEqual(activeComet(1.6, W, H));
  });

  it('travels across the sky during the transit', () => {
    const early = activeComet(0.4, W, H)!; // p ≈ 0.125
    const late = activeComet(2.8, W, H)!; // p ≈ 0.875, same comet (idx 0)
    expect(Math.abs(late.x - early.x)).toBeGreaterThan(W * 0.5);
  });

  it('rejects negative and NaN time', () => {
    expect(activeComet(-1, W, H)).toBeNull();
    expect(activeComet(NaN, W, H)).toBeNull();
  });
});
