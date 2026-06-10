import { describe, test, expect } from 'vitest';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { computeOrbit, circularRelativeVelocity } from '../src/physics/orbit.ts';
import { vec2 } from '../src/physics/Vec2.ts';

// The integrator moves the bodies under PLUMMER-SOFTENED gravity
// (gravity.ts), so the quantity those dynamics conserve is the softened
// Hamiltonian — kinetic energy plus the softened potential −G·M/√(r²+ε²).
// The orbit diagnostics must use that same potential: if they used the pure
// Keplerian −G·M/r, "energy" would swing visibly on every close approach and
// the eccentricity / bound flags feeding the WIN threshold would be measured
// against a quantity the simulation doesn't actually conserve.

describe('softening consistency between force and energy', () => {
  test('softened specific energy is the conserved quantity on a close-approach orbit', () => {
    // A hard ellipse whose periapsis dives deep into the softening regime
    // (r_p of a few tens of px against ε = 6), where the softened and
    // Keplerian potentials genuinely disagree.
    const m = 2;
    const r = 300;
    const vCirc = circularRelativeVelocity(m, m, r, PHYSICS.G);
    const v = (vCirc / 2) * 0.45; // strongly sub-circular → deep periapsis

    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );

    // Track the swing (max − min) of both energy formulations over several
    // periapsis passages. The conserved one stays flat to integrator error;
    // the mismatched one inhales and exhales with every close approach.
    let softMin = Infinity;
    let softMax = -Infinity;
    let keplerMin = Infinity;
    let keplerMax = -Infinity;
    for (let i = 0; i < 4000; i++) {
      sim.step();
      const soft = computeOrbit(sim.a, sim.b, PHYSICS.G, PHYSICS.SOFTENING)
        .specificEnergy;
      const kepler = computeOrbit(sim.a, sim.b, PHYSICS.G).specificEnergy;
      softMin = Math.min(softMin, soft);
      softMax = Math.max(softMax, soft);
      keplerMin = Math.min(keplerMin, kepler);
      keplerMax = Math.max(keplerMax, kepler);
    }

    const softSwing = (softMax - softMin) / Math.abs(softMin);
    const keplerSwing = (keplerMax - keplerMin) / Math.abs(keplerMin);

    // The softened formulation must be at least an order of magnitude flatter
    // than the Keplerian one under softened dynamics.
    expect(softSwing).toBeLessThan(keplerSwing / 10);
    expect(softSwing).toBeLessThan(1e-3);
  });

  test('far from the softening length the two formulations agree', () => {
    // At game-typical separations (r ≫ ε) softening must not change the
    // diagnostics players see: eccentricity and energy match to ~ε²/2r².
    const m = 2;
    const r = 400;
    const vCirc = circularRelativeVelocity(m, m, r, PHYSICS.G);
    const v = vCirc / 2;
    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );

    const soft = computeOrbit(sim.a, sim.b, PHYSICS.G, PHYSICS.SOFTENING);
    const kepler = computeOrbit(sim.a, sim.b, PHYSICS.G);
    expect(
      Math.abs((soft.specificEnergy - kepler.specificEnergy) / kepler.specificEnergy),
    ).toBeLessThan(1e-3);
    expect(Math.abs(soft.eccentricity - kepler.eccentricity)).toBeLessThan(1e-2);
    expect(soft.bound).toBe(kepler.bound);
  });

  test('Simulation.orbit() reports the softened (conserved) energy', () => {
    const m = 2;
    const r = 120; // close enough that ε = 6 is measurable
    const vCirc = circularRelativeVelocity(m, m, r, PHYSICS.G, PHYSICS.SOFTENING);
    const v = vCirc / 2;
    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );
    const fromSim = sim.orbit().specificEnergy;
    const softened = computeOrbit(sim.a, sim.b, PHYSICS.G, PHYSICS.SOFTENING)
      .specificEnergy;
    expect(fromSim).toBe(softened);
  });
});
