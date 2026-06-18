import { describe, test, expect } from 'vitest';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { applyGravity } from '../src/physics/gravity.ts';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { circularRelativeVelocity } from '../src/physics/orbit.ts';
import { NBodySimulation, applyGravityN } from '../src/physics/nbody.ts';

// The N-body path (src/physics/nbody.ts) powers the post-win three-body
// unravel. It is additive — the two-body engine is the tested floor + the
// iOS golden-parity contract — so the first thing to prove is that for N = 2
// this code reproduces the two-body engine exactly; then that it conserves the
// invariants a symplectic integrator must (momentum exactly, energy bounded).

describe('N-body reduces to the two-body engine when N = 2', () => {
  test('applyGravityN matches applyGravity bit-for-bit for one pair', () => {
    const a1 = createBody(2, vec2(-100, 30), vec2(0, 0));
    const b1 = createBody(3, vec2(120, -40), vec2(0, 0));
    applyGravity(a1, b1, PHYSICS.G, PHYSICS.SOFTENING);

    const a2 = createBody(2, vec2(-100, 30), vec2(0, 0));
    const b2 = createBody(3, vec2(120, -40), vec2(0, 0));
    applyGravityN([a2, b2], PHYSICS.G, PHYSICS.SOFTENING);

    expect(a2.accel.x).toBe(a1.accel.x);
    expect(a2.accel.y).toBe(a1.accel.y);
    expect(b2.accel.x).toBe(b1.accel.x);
    expect(b2.accel.y).toBe(b1.accel.y);
  });

  test('NBodySimulation([a,b]) tracks Simulation step-for-step', () => {
    const m1 = 2;
    const m2 = 3;
    const sim = Simulation.create(
      m1, vec2(-200, 0), vec2(0, 60),
      m2, vec2(200, 0), vec2(0, -40),
    );
    const nb = new NBodySimulation(
      [
        createBody(m1, vec2(-200, 0), vec2(0, 60)),
        createBody(m2, vec2(200, 0), vec2(0, -40)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );

    for (let i = 0; i < 2000; i++) {
      sim.step();
      nb.step(PHYSICS.DT);
    }

    // Identical kernel + identical PEFRL sequence → identical trajectory.
    expect(nb.bodies[0].pos.x).toBeCloseTo(sim.a.pos.x, 6);
    expect(nb.bodies[0].pos.y).toBeCloseTo(sim.a.pos.y, 6);
    expect(nb.bodies[1].pos.x).toBeCloseTo(sim.b.pos.x, 6);
    expect(nb.bodies[1].pos.y).toBeCloseTo(sim.b.pos.y, 6);
  });
});

describe('N-body PEFRL conserves the invariants (3 bodies)', () => {
  test('total linear momentum is conserved to machine precision', () => {
    const nb = new NBodySimulation(
      [
        createBody(2, vec2(-150, 0), vec2(0, 70)),
        createBody(3, vec2(150, 0), vec2(0, -50)),
        createBody(1.5, vec2(0, 300), vec2(-40, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const p0 = nb.momentum();
    for (let i = 0; i < 4000; i++) nb.step(PHYSICS.DT);
    const p = nb.momentum();
    // Internal pair forces cancel exactly (Newton's third law), so every kick
    // is momentum-neutral; only float round-off accumulates.
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
  });

  test('total energy stays bounded over a long run (hierarchical triple)', () => {
    // Tight equal-mass binary at the origin + a distant lighter third on a
    // wide bound orbit — well-separated scales, no violent close encounter, so
    // the symplectic integrator should hold energy to a small bounded swing
    // rather than drifting secularly.
    const m = 2;
    const r = 200;
    const v = circularRelativeVelocity(m, m, r, PHYSICS.G) / 2;
    const nb = new NBodySimulation(
      [
        createBody(m, vec2(-r / 2, 0), vec2(0, +v)),
        createBody(m, vec2(+r / 2, 0), vec2(0, -v)),
        createBody(0.5, vec2(0, 1200), vec2(90, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const E0 = nb.initialEnergy;
    for (let i = 0; i < 5000; i++) nb.step(PHYSICS.DT);
    const drift = Math.abs((nb.energy() - E0) / E0);
    expect(drift).toBeLessThan(1e-2);
  });
});
