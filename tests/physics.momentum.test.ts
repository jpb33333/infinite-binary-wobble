import { describe, test, expect } from 'vitest';
import { Simulation } from '../src/physics/Simulation.ts';
import { vec2 } from '../src/physics/Vec2.ts';

// Newton's third law ⇒ forces between the two bodies are equal and opposite.
// In the Verlet integrator, both halves of every kick apply equal-and-opposite
// momentum changes (m·a·dt is symmetric in our pair-gravity formula), so
// total linear momentum is conserved to floating-point precision.

describe('Total linear momentum is conserved', () => {
  test('asymmetric masses with arbitrary initial state', () => {
    const sim = Simulation.create(
      1.7, vec2(-180, 40), vec2(+12, -8),
      3.4, vec2(+220, -30), vec2(-6, +14),
    );

    const p0x = sim.a.mass * sim.a.vel.x + sim.b.mass * sim.b.vel.x;
    const p0y = sim.a.mass * sim.a.vel.y + sim.b.mass * sim.b.vel.y;

    for (let i = 0; i < 4000; i++) sim.step();

    const pfx = sim.a.mass * sim.a.vel.x + sim.b.mass * sim.b.vel.x;
    const pfy = sim.a.mass * sim.a.vel.y + sim.b.mass * sim.b.vel.y;

    // Floating-point rounding accumulates over thousands of additions but
    // there's no algebraic source of momentum loss. Tolerance is generous
    // relative to the initial magnitudes.
    const scale = Math.max(Math.abs(p0x), Math.abs(p0y), 1);
    expect(Math.abs(pfx - p0x) / scale).toBeLessThan(1e-9);
    expect(Math.abs(pfy - p0y) / scale).toBeLessThan(1e-9);
  });
});
