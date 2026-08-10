import { describe, test, expect } from 'vitest';
import { activePings, pingGlint, PING_INTERVAL, PING_SPEED } from '../src/render/pings.ts';

// The broadcast ping layer (Act III): expanding rings that draw the system's
// INSTANTANEOUS emission — the quantity GO DARK cuts immediately — while the
// meter shows the slow, smoothed visibility. Pure function of time, like
// comet.ts: same inputs, same rings, no per-frame state.

const MAX_R = 800;

describe('activePings — deterministic expanding wavefronts', () => {
  test('pure: identical inputs yield identical rings', () => {
    const a = activePings(12.34, 0.6, 0.2, MAX_R);
    const b = activePings(12.34, 0.6, 0.2, MAX_R);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  test('silent and flare-free systems emit nothing', () => {
    expect(activePings(30, 0, 0, MAX_R)).toEqual([]);
    expect(activePings(30, 0.01, 0, MAX_R)).toEqual([]);
  });

  test('a flare alone pings — the supernova leak is visible even running dark', () => {
    const rings = activePings(30, 0, 0.8, MAX_R);
    expect(rings.length).toBeGreaterThan(0);
  });

  test('rings expand with time and die at maxR', () => {
    const t0 = 40;
    const r0 = activePings(t0, 0.7, 0, MAX_R);
    const r1 = activePings(t0 + 0.5, 0.7, 0, MAX_R);
    // The ring emitted at the same tick is 0.5s further out.
    const tick = Math.floor(t0 / PING_INTERVAL);
    const ringAt = (rings: { r: number }[], age: number) =>
      rings.find(g => Math.abs(g.r - age * PING_SPEED) < 1e-6);
    const age0 = t0 - tick * PING_INTERVAL;
    expect(ringAt(r0, age0)).toBeTruthy();
    expect(ringAt(r1, age0 + 0.5)).toBeTruthy();
    // No ring ever outlives the field.
    for (const g of activePings(1234.5, 1, 1, MAX_R)) {
      expect(g.r).toBeLessThanOrEqual(MAX_R);
      expect(g.alpha).toBeGreaterThan(0);
      expect(g.alpha).toBeLessThanOrEqual(0.6);
    }
  });

  test('concurrent ring count is bounded by lifetime over the emission clock', () => {
    const cap = Math.ceil(MAX_R / PING_SPEED / PING_INTERVAL) + 1;
    for (const t of [3, 17.7, 60.2, 999.9]) {
      expect(activePings(t, 1, 1, MAX_R).length).toBeLessThanOrEqual(cap);
    }
  });

  test('louder emission means brighter rings', () => {
    const quiet = activePings(25, 0.15, 0, MAX_R);
    const loud = activePings(25, 0.9, 0, MAX_R);
    expect(loud[0].alpha).toBeGreaterThan(quiet[0].alpha);
  });

  test('guards junk time', () => {
    expect(activePings(-1, 1, 1, MAX_R)).toEqual([]);
    expect(activePings(Number.NaN, 1, 1, MAX_R)).toEqual([]);
  });
});

describe('pingGlint — hidden systems catch the wavefront as it passes', () => {
  test('peaks when a ring crosses the system distance, fades far away', () => {
    const rings = [{ r: 300, alpha: 0.5 }];
    expect(pingGlint(rings, 300)).toBeCloseTo(0.5, 5);
    expect(pingGlint(rings, 306)).toBeLessThan(0.5);
    expect(pingGlint(rings, 306)).toBeGreaterThan(0.2);
    expect(pingGlint(rings, 700)).toBeLessThan(0.01);
  });

  test('no rings, no glint — and glint never exceeds 1', () => {
    expect(pingGlint([], 100)).toBe(0);
    const stack = Array.from({ length: 8 }, () => ({ r: 200, alpha: 0.6 }));
    expect(pingGlint(stack, 200)).toBeLessThanOrEqual(1);
  });
});
