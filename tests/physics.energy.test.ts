import { describe, test, expect } from 'vitest';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { circularRelativeVelocity } from '../src/physics/orbit.ts';
import { vec2 } from '../src/physics/Vec2.ts';

// The Simulation uses PEFRL (Position Extended Forest-Ruth-Like) — a
// 4th-order symplectic integrator. Like Verlet, it preserves phase-space
// volume; unlike Verlet, the leading error is O(dt^4) instead of O(dt^2),
// so the bounded energy oscillation is several orders of magnitude smaller
// at the same dt. The bounds below are calibrated to lock in that win.

describe('PEFRL energy behavior', () => {
  test('equal-mass circular orbit: total energy drift < 1e-5 over ~3 orbits', () => {
    const m = 2;
    const r = 400; // separation
    const vRelCirc = circularRelativeVelocity(m, m, r, PHYSICS.G);
    // Equal masses, symmetric around origin: each body at ±r/2.
    // Relative velocity is split equally and oppositely along ±y.
    const v = vRelCirc / 2;

    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );

    const E0 = sim.initialEnergy;

    // 5000 steps at dt = 1/240 → ~20.8 simulated seconds.
    for (let i = 0; i < 5000; i++) sim.step();

    const E = sim.orbit().totalEnergy;
    const drift = Math.abs((E - E0) / E0);
    expect(drift).toBeLessThan(1e-5);
  });

  test('elliptical orbit: total energy bounded < 1% over ~5000 steps', () => {
    // Same configuration but tangential velocity at 70% of circular —
    // produces a moderate ellipse. Energy still bounded; tolerance looser
    // because elliptical orbits stress the integrator more at perihelion.
    const m = 2;
    const r = 400;
    const vRelCirc = circularRelativeVelocity(m, m, r, PHYSICS.G);
    const v = (vRelCirc / 2) * 0.7;

    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );

    const E0 = sim.initialEnergy;
    for (let i = 0; i < 5000; i++) sim.step();
    const E = sim.orbit().totalEnergy;
    const drift = Math.abs((E - E0) / E0);
    expect(drift).toBeLessThan(0.01);
  });

  test('circular orbit: drift stays bounded over a 50,000-step long run (symplectic property)', () => {
    // Verlet/PEFRL preserve a shadow Hamiltonian, so the error does NOT grow
    // secularly. This verifies that property: the worst-case drift over 10x
    // the standard test horizon is still tiny.
    const m = 2;
    const r = 400;
    const vRelCirc = circularRelativeVelocity(m, m, r, PHYSICS.G);
    const v = vRelCirc / 2;
    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );
    const E0 = sim.initialEnergy;
    let maxDrift = 0;
    for (let i = 0; i < 50_000; i++) {
      sim.step();
      const d = Math.abs((sim.orbit().totalEnergy - E0) / E0);
      if (d > maxDrift) maxDrift = d;
    }
    expect(maxDrift).toBeLessThan(1e-5);
  });
});
