import { describe, test, expect } from 'vitest';
import {
  placedPlanetVelocity,
  placedStarVelocity,
  clampedVelocity,
  randomStarEntry,
} from '../src/game/placement.ts';

// The auto-velocity for a "Set"-placed sandbox body. The interaction (tap to
// place, +/- mass) is canvas-only and untested; this proves the drop physics.
describe('placed-body auto-velocity', () => {
  const com = { x: 100, y: 100 };

  test('a placed planet gets a circular orbit: tangent to the radius, speed sqrt(GM/r)', () => {
    const G = 4;
    const M = 5;
    const pos = { x: 300, y: 100 }; // r = 200, due east of the barycenter
    const v = placedPlanetVelocity(pos, com, M, G);
    // velocity is perpendicular to the radius → radial component ~0
    const radial = (pos.x - com.x) * v.x + (pos.y - com.y) * v.y;
    expect(Math.abs(radial)).toBeLessThan(1e-9);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(Math.sqrt((G * M) / 200), 9);
  });

  test('a placed star aims straight at the barycenter at the given speed', () => {
    const pos = { x: 300, y: 100 }; // east of the COM → should aim west
    const v = placedStarVelocity(pos, com, 220);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(220, 9);
    expect(v.x).toBeLessThan(0); // inbound = westward
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
  });

  test('degenerate inputs (on the COM, or no mass) return zero — never NaN', () => {
    expect(placedPlanetVelocity(com, com, 5, 4)).toEqual({ x: 0, y: 0 });
    expect(placedPlanetVelocity({ x: 200, y: 100 }, com, 0, 4)).toEqual({ x: 0, y: 0 });
    expect(placedStarVelocity(com, com, 220)).toEqual({ x: 0, y: 0 });
  });
});

// The player can override a Set star's auto-aim by dragging from the ghost — the
// same slingshot mapping as setup (arrow length px = px/s), capped. Pure math.
describe('clampedVelocity (player-aimed Set star)', () => {
  const from = { x: 0, y: 0 };

  test('a sub-cap drag maps 1:1 to velocity (length = drag length)', () => {
    const v = clampedVelocity(from, { x: 30, y: 40 }, 300); // mag 50
    expect(v).toEqual({ x: 30, y: 40 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(50, 9);
  });

  test('a long drag is capped to `cap`, preserving direction', () => {
    const v = clampedVelocity(from, { x: 600, y: 800 }, 300); // mag 1000 → capped
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(300, 9);
    expect(v.x).toBeCloseTo(180, 9); // direction (0.6, 0.8) preserved
    expect(v.y).toBeCloseTo(240, 9);
  });

  test('a zero-length drag returns zero — never NaN', () => {
    expect(clampedVelocity(from, from, 300)).toEqual({ x: 0, y: 0 });
    expect(clampedVelocity({ x: 5, y: 5 }, { x: 5, y: 5 }, 300)).toEqual({ x: 0, y: 0 });
  });
});

// Act 2 breathes: random stars must enter with real angular momentum (a
// tangential component well above the plunge regime) and only a gentle
// infall — the shape that turns instant mergers back into three-body dances.
describe('randomStarEntry', () => {
  const G = 1.5e7;

  test('carries strong tangential motion and gentle inward drift', () => {
    for (let k = 0; k < 200; k++) {
      const e = randomStarEntry(6, 3, 768, G);
      const cos = Math.cos(e.theta);
      const sin = Math.sin(e.theta);
      // Decompose back into radial (outward +) and tangential parts.
      const vr = e.vx * cos + e.vy * sin;
      const vt = -e.vx * sin + e.vy * cos;
      const vCirc = Math.sqrt((G * 9) / 768);
      expect(vr).toBeLessThan(0); // always drifting in…
      expect(vr).toBeGreaterThanOrEqual(-120); // …but never a plunge
      expect(Math.abs(vt)).toBeGreaterThanOrEqual(vCirc * 0.55 - 1e-9);
      expect(Math.abs(vt)).toBeLessThanOrEqual(vCirc * 0.85 + 1e-9);
      expect(Math.abs(e.vz)).toBeLessThanOrEqual(30);
    }
  });

  test('deterministic under an injected rand', () => {
    const seq = [0.25, 0.5, 0.9, 0.1];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    i = 0;
    const a = randomStarEntry(6, 3, 768, G, rand);
    i = 0;
    const b = randomStarEntry(6, 3, 768, G, rand);
    expect(a).toEqual(b);
  });
});
