import { describe, test, expect } from 'vitest';
import {
  placedPlanetVelocity,
  placedStarVelocity,
  clampedVelocity,
  randomStarEntry,
  autoPlanetOrbit,
} from '../src/game/placement.ts';
import { NBodySimulation } from '../src/physics/nbody.ts';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';

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
// (co-moving!), circumbinary far out, always prograde with the system's spin —
// and always at the ENGINE-TRUE softened circular speed
// (sqrt(G·m·r² / (r²+ε²)^1.5)), so a seed can never outrun the Plummer-softened
// field that has to hold it. ε here mirrors PHYSICS.SOFTENING.
describe('autoPlanetOrbit', () => {
  const G = 1.5e7;
  const EPS = 6; // PHYSICS.SOFTENING — the engine the seeds must live in
  const soft = (m: number, r: number) =>
    Math.sqrt((G * m * r * r) / (r * r + EPS * EPS) ** 1.5);
  // A binary spinning counter-clockwise (+L), drifting +x at 50 px/s.
  const binary = () => [
    { x: -60, y: 0, vx: 50, vy: -400, mass: 3 },
    { x: 60, y: 0, vx: 50, vy: 400, mass: 3 },
  ];

  test('near one star: co-moving circumstellar at softened circular speed', () => {
    const stars = binary();
    const pos = { x: 60 + 20, y: 0 }; // 20px off the right star — deep inside dominance
    const v = autoPlanetOrbit(pos, stars, G, EPS);
    const rel = { x: v.x - stars[1].vx, y: v.y - stars[1].vy };
    const speed = Math.hypot(rel.x, rel.y);
    expect(speed).toBeCloseTo(soft(3, 20), 6);
    // Tangential: relative velocity ⊥ the radial from the star.
    expect(rel.x * 20 + rel.y * 0).toBeCloseTo(0, 6);
    // Prograde (+L system): at +x from the star, tangent points +y.
    expect(rel.y).toBeGreaterThan(0);
  });

  test('far out: circumbinary around the COM, riding the system drift', () => {
    const stars = binary();
    const pos = { x: 800, y: 0 };
    const v = autoPlanetOrbit(pos, stars, G, EPS);
    const rel = { x: v.x - 50, y: v.y - 0 }; // COM drifts +x at 50
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(soft(6, 800), 6);
    expect(rel.y).toBeGreaterThan(0); // prograde
    expect(Math.abs(rel.x)).toBeLessThan(1e-6);
  });

  test('retrograde system flips the seeded tangent', () => {
    const stars = binary().map(s => ({ ...s, vy: -s.vy })); // spin now −L
    const v = autoPlanetOrbit({ x: 800, y: 0 }, stars, G, EPS);
    expect(v.y).toBeLessThan(0);
  });

  test('single star and empty field degrade gracefully', () => {
    const lone = [{ x: 0, y: 0, vx: 10, vy: 0, mass: 5 }];
    const v = autoPlanetOrbit({ x: 100, y: 0 }, lone, G, EPS);
    const rel = { x: v.x - 10, y: v.y };
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(soft(5, 100), 6);
    expect(autoPlanetOrbit({ x: 1, y: 2 }, [], G, EPS)).toEqual({ x: 0, y: 0, vz: 0 });
  });

  // A star-center bullseye must seed the softened law, not sqrt(G·m/r)'s
  // divergence: at r=3 the unsoftened law fires 3873 px/s — past the softened
  // escape speed — and the run ends in ejection seconds later.
  test('bullseye tap seeds the softened speed, below softened escape', () => {
    const star = { x: 0, y: 0, vx: 25, vy: -40, mass: 3 };
    const v = autoPlanetOrbit({ x: 3, y: 0 }, [star], G, EPS);
    const rel = { x: v.x - star.vx, y: v.y - star.vy };
    const speed = Math.hypot(rel.x, rel.y);
    expect(speed).toBeCloseTo(soft(3, 3), 6);
    const vEscape = Math.sqrt((2 * G * 3) / Math.hypot(3, EPS));
    expect(speed).toBeLessThan(vEscape);
  });

  test('zero total mass seeds zero, not NaN', () => {
    const v = autoPlanetOrbit({ x: 1, y: 2 }, [{ x: 0, y: 0, vx: 0, vy: 0, mass: 0 }], G, EPS);
    expect(v).toEqual({ x: 0, y: 0, vz: 0 });
  });

  // A runaway slingshot survivor parked far outside the play field must not
  // drag the P-type COM (and drift, and spin) into empty space.
  test('stars beyond reach are culled from the seed field', () => {
    const stars = [
      { x: -100, y: 0, vx: -200, vy: -300, mass: 3 },
      { x: 100, y: 0, vx: -200, vy: 300, mass: 3 },
      { x: 3000, y: 0, vx: 600, vy: 0, mass: 5 }, // the runaway
    ];
    const v = autoPlanetOrbit({ x: 350, y: 0 }, stars, G, EPS, 1600);
    // Culled to the binary alone: P-type about (0,0), drifting (−200, 0), CCW.
    expect(v.x).toBeCloseTo(-200, 6);
    expect(v.y).toBeCloseTo(soft(6, 350), 6);
  });

  test('a tap beyond reach of every star falls back to the full field', () => {
    const v = autoPlanetOrbit({ x: 9000, y: 0 }, binary(), G, EPS, 1600);
    const rel = { x: v.x - 50, y: v.y }; // still rides the COM drift
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(soft(6, 9000), 6);
  });

  // The field is genuinely 3D (entry stars carry vz, supernova blasts kick out
  // of plane): distances use the star's z, so a tap beside a lofted star seeds
  // the cooler true-radius speed, not the hot 2D projection.
  test('an out-of-plane star seeds at its 3D distance', () => {
    const lofted = [{ x: 0, y: 0, z: 100, vx: 10, vy: 0, mass: 5 }];
    const v = autoPlanetOrbit({ x: 40, y: 0 }, lofted, G, EPS);
    const rel = { x: v.x - 10, y: v.y };
    expect(Math.hypot(rel.x, rel.y)).toBeCloseTo(soft(5, Math.hypot(40, 100)), 6);
  });

  // And the frame is ridden out of plane too: the seed carries vz — the host
  // star's for S-type, the COM's for P-type — so a planet beside a climbing
  // star doesn't shear away vertically from the sun it co-moves with.
  test('the seed carries the frame vz: host star for S-type, COM for P-type', () => {
    const lofted = [{ x: 0, y: 0, vx: 10, vy: 0, vz: 25, mass: 3 }];
    expect(autoPlanetOrbit({ x: 30, y: 0 }, lofted, G, EPS).vz).toBeCloseTo(25, 9);
    const pair = [
      { x: -60, y: 0, vx: 50, vy: -400, vz: 40, mass: 3 },
      { x: 60, y: 0, vx: 50, vy: 400, vz: -20, mass: 3 },
    ];
    // Far tap → P-type; vz is the mass-weighted mean: (40 − 20) / 2 = 10.
    expect(autoPlanetOrbit({ x: 800, y: 0 }, pair, G, EPS).vz).toBeCloseTo(10, 9);
  });
});

// The seed must hold up inside the real engine: drop a planet with the seeded
// velocity into NBodySimulation at the old worst case — a bullseye tap right
// beside a moving star — and it must stay gravitationally bound. Under the
// unsoftened seed this exact setup ejected within seconds.
describe('autoPlanetOrbit × NBodySimulation', () => {
  test('a bullseye-seeded planet stays bound to its moving star', () => {
    const G = 1.5e7;
    const EPS = 6;
    const DT = 1 / 240;
    const star = createBody(3, vec2(0, 0), vec2(40, -30));
    const v = autoPlanetOrbit({ x: 6, y: 0 }, [{ x: 0, y: 0, vx: 40, vy: -30, mass: 3 }], G, EPS);
    const planet = createBody(0.02, vec2(6, 0), vec2(v.x, v.y));
    const sim = new NBodySimulation([star], G, EPS);
    sim.addBody(planet, true); // noMerge — planets don't fuse
    let maxR = 0;
    for (let i = 0; i < 2400; i++) {
      // 10 simulated seconds
      sim.step(DT);
      maxR = Math.max(maxR, Math.hypot(planet.pos.x - star.pos.x, planet.pos.y - star.pos.y));
    }
    expect(maxR).toBeLessThan(300);
  });
});
