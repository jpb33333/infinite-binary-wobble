import { describe, test, expect } from 'vitest';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { vec2 } from '../src/physics/Vec2.ts';

describe('Escape vs bound classification', () => {
  test('super-escape velocity ⇒ specificEnergy > 0 and separation grows', () => {
    // Two bodies far apart with tangential velocity well above the local
    // escape velocity. Specific energy should be positive immediately and
    // remain positive.
    const sim = Simulation.create(
      2, vec2(-300, 0), vec2(0, +400),
      2, vec2(+300, 0), vec2(0, -400),
    );

    const start = sim.orbit();
    expect(start.specificEnergy).toBeGreaterThan(0);
    expect(start.bound).toBe(false);

    const sep0 = start.separation;
    for (let i = 0; i < 2000; i++) sim.step();
    const end = sim.orbit();

    expect(end.specificEnergy).toBeGreaterThan(0);
    expect(end.separation).toBeGreaterThan(sep0);
  });

  test('sub-escape velocity ⇒ specificEnergy < 0 and orbit is bound', () => {
    // Same geometry, smaller tangential velocity — should be bound.
    const sim = Simulation.create(
      2, vec2(-300, 0), vec2(0, +60),
      2, vec2(+300, 0), vec2(0, -60),
    );
    const o = sim.orbit();
    expect(o.specificEnergy).toBeLessThan(0);
    expect(o.bound).toBe(true);
    expect(Number.isFinite(o.semiMajorAxis)).toBe(true);
    expect(Number.isFinite(o.period)).toBe(true);
    expect(o.eccentricity).toBeGreaterThanOrEqual(0);
  });

  test('circular setup produces near-zero eccentricity', () => {
    // Configure exactly the circular relative velocity. Eccentricity should
    // be ~0 (numerical noise tolerated).
    const m = 2;
    const r = 500;
    // v_circ_rel = sqrt(G·M/r); each body at half, opposite directions
    const vRelCirc = Math.sqrt((PHYSICS.G * (m + m)) / r);
    const v = vRelCirc / 2;
    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );
    const o = sim.orbit();
    expect(o.eccentricity).toBeLessThan(0.01);
    expect(o.bound).toBe(true);
  });
});
