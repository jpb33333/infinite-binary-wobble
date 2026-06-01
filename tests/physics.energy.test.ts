import { describe, test, expect } from 'vitest';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { circularRelativeVelocity } from '../src/physics/orbit.ts';
import { vec2 } from '../src/physics/Vec2.ts';

// Velocity Verlet is symplectic. It does NOT exactly conserve energy each
// step — instead it conserves a nearby "shadow Hamiltonian", so the true
// energy oscillates around the true value with bounded amplitude rather
// than drifting secularly (as Euler / RK4 would). For a circular orbit
// this oscillation is small.

describe('Velocity Verlet energy behavior', () => {
  test('equal-mass circular orbit: total energy drift < 1% over ~3 orbits', () => {
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
    expect(drift).toBeLessThan(0.01);
  });

  test('elliptical orbit: total energy bounded < 5% over ~5000 steps', () => {
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
    expect(drift).toBeLessThan(0.05);
  });
});
