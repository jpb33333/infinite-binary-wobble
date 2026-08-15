import { describe, test, expect } from 'vitest';
import {
  placedPlanetVelocity,
  placedStarVelocity,
  clampedVelocity,
  randomStarEntry,
  autoPlanetOrbit,
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

// The survivor-orbit seed for Set planets: circumstellar near a star
// (co-moving!), circumbinary far out, always prograde with the system's spin.
describe('autoPlanetOrbit', () => {
  const G = 1.5e7;
  // A binary spinning counter-clockwise (+L), drifting +x at 50 px/s.
  const binary = () => [
    { x: -60, y: 0, vx: 50, vy: -400, mass: 3 },
    { x: 60, y: 0, vx: 50, vy: 400, mass: 3 },
  ];

  test('near one star: co-moving circumstellar at circular speed', () => {
    const stars = binary();
    const pos = { x: 60 + 20, y: 0 }; // 20px off the right star — deep inside dominance
    const v = autoPlanetOrbit(pos, stars, G);
    const rel = { x: v.x - stars[1].vx, y: v.y - stars[1].vy };
    const speed = Math.hypot(rel.x, rel.y);
    expect(speed).toBeCloseTo(Math.sqrt((G * 3) / 20), 6);
    // Tangential: relative velocity ⊥ the radial from the star.
    expect(rel.x * 20 + rel.y * 0).toBeCloseTo(0, 6);
    // Prograde (+L system): at +x from the star, tangent points +y.
    expect(rel.y).toBeGreaterThan(0);
  });

  test('far out: circumbinary around the COM, riding the system drift', () => {
    const stars = binary();
    const pos = { x: 800, y: 0 };
    const v = autoPlanetOrbit(pos, stars, G);
    const rel = { x: v.x - 50, y: v.y - 0 }; // COM drifts +x at 50
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(Math.sqrt((G * 6) / 800), 6);
    expect(rel.y).toBeGreaterThan(0); // prograde
    expect(Math.abs(rel.x)).toBeLessThan(1e-6);
  });

  test('retrograde system flips the seeded tangent', () => {
    const stars = binary().map(s => ({ ...s, vy: -s.vy })); // spin now −L
    const v = autoPlanetOrbit({ x: 800, y: 0 }, stars, G);
    expect(v.y).toBeLessThan(0);
  });

  test('single star and empty field degrade gracefully', () => {
    const lone = [{ x: 0, y: 0, vx: 10, vy: 0, mass: 5 }];
    const v = autoPlanetOrbit({ x: 100, y: 0 }, lone, G);
    const rel = { x: v.x - 10, y: v.y };
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(Math.sqrt((G * 5) / 100), 6);
    expect(autoPlanetOrbit({ x: 1, y: 2 }, [], G)).toEqual({ x: 0, y: 0 });
  });
});
