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
    // Near-circular so the pair never gets close enough to merge — this checks
    // pure integrator equivalence, not the merge path.
    const m = 2;
    const r = 400;
    const v = circularRelativeVelocity(m, m, r, PHYSICS.G) / 2;
    const sim = Simulation.create(
      m, vec2(-r / 2, 0), vec2(0, +v),
      m, vec2(+r / 2, 0), vec2(0, -v),
    );
    const nb = new NBodySimulation(
      [
        createBody(m, vec2(-r / 2, 0), vec2(0, +v)),
        createBody(m, vec2(+r / 2, 0), vec2(0, -v)),
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
    // Hierarchical (tight circular binary + a distant bound third) so nothing
    // merges — a clean test of the integrator's momentum conservation.
    const m = 2;
    const r = 250;
    const v = circularRelativeVelocity(m, m, r, PHYSICS.G) / 2;
    const nb = new NBodySimulation(
      [
        createBody(m, vec2(-r / 2, 0), vec2(0, +v)),
        createBody(m, vec2(+r / 2, 0), vec2(0, -v)),
        createBody(1.5, vec2(0, 1300), vec2(200, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const p0 = nb.momentum();
    for (let i = 0; i < 4000; i++) nb.step(PHYSICS.DT);
    expect(nb.bodies.length).toBe(3); // no merge in this configuration
    const p = nb.momentum();
    // Internal pair forces cancel exactly (Newton's third law), so every kick
    // is momentum-neutral; only float round-off accumulates.
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
  });

  test('a head-on collision merges, conserving mass and momentum', () => {
    const nb = new NBodySimulation(
      [
        createBody(2, vec2(-120, 0), vec2(70, 0)),
        createBody(3, vec2(120, 0), vec2(-70, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const p0 = nb.momentum();
    let event = null;
    for (let i = 0; i < 3000 && nb.bodies.length > 1; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) event = e;
    }
    expect(nb.bodies.length).toBe(1);
    expect(event).not.toBeNull();
    expect(nb.bodies[0].mass).toBeCloseTo(5, 9); // 2 + 3, exactly
    // Perfectly inelastic merge still conserves total momentum.
    const p = nb.momentum();
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
        createBody(0.5, vec2(0, 1200), vec2(200, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const E0 = nb.initialEnergy;
    for (let i = 0; i < 5000; i++) nb.step(PHYSICS.DT);
    const drift = Math.abs((nb.energy() - E0) / E0);
    expect(drift).toBeLessThan(1e-2);
  });

  test('a merge over the supernova mass detonates and blasts the survivors', () => {
    // Two heavy stars (5 + 5 = 10 ≥ limit) collide head-on; a light third sits
    // off to the side and should be flung outward by the blast, not fused.
    const nb = new NBodySimulation(
      [
        createBody(5, vec2(-120, 0), vec2(70, 0)),
        createBody(5, vec2(120, 0), vec2(-70, 0)),
        createBody(1, vec2(0, 280), vec2(0, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    let event = null;
    for (let i = 0; i < 3000 && !event; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) event = e;
    }
    expect(event).not.toBeNull();
    expect(event!.supernova).toBe(true);
    expect(event!.body).toBeNull();
    // The two heavy stars are gone; the light third remains, flung by the blast.
    expect(nb.bodies.length).toBe(1);
    expect(Math.hypot(nb.bodies[0].vel.x, nb.bodies[0].vel.y)).toBeGreaterThan(50);
  });

  test('3D motion conserves momentum (including z) and leaves the plane', () => {
    const bodies = [
      createBody(2, vec2(-150, 0), vec2(0, 70)),
      createBody(3, vec2(150, 0), vec2(0, -50)),
      createBody(1.5, vec2(0, 300), vec2(-40, 0)),
    ];
    bodies[0].vz = 30; // out-of-plane velocity
    bodies[1].vz = -20;
    bodies[2].vz = 15;
    const nb = new NBodySimulation(bodies, PHYSICS.G, PHYSICS.SOFTENING);
    const p0 = nb.momentum();
    for (let i = 0; i < 3000; i++) nb.step(PHYSICS.DT);
    const p = nb.momentum();
    // Momentum conserved on all three axes (a merge, if any, conserves it too).
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
    expect(Math.abs(p.z - p0.z)).toBeLessThan(1e-6);
    // Something actually moved out of the z = 0 plane — this is real 3D.
    expect(Math.max(...nb.bodies.map(b => Math.abs(b.z)))).toBeGreaterThan(1);
  });

  test('an over-mass 2-body collision detonates to zero survivors without crashing', () => {
    // The terminal "everything fell together" case (the Game reads this as a
    // collapse → black-hole game over). The physics must handle 0 bodies cleanly.
    const nb = new NBodySimulation(
      [createBody(5, vec2(-100, 0), vec2(60, 0)), createBody(5, vec2(100, 0), vec2(-60, 0))],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    let event = null;
    for (let i = 0; i < 3000 && nb.bodies.length > 0; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) event = e;
    }
    expect(event && event.supernova).toBe(true);
    expect(nb.bodies.length).toBe(0);
    // Degenerate state is graceful, not a throw / NaN.
    expect(nb.centerOfMass()).toEqual({ x: 0, y: 0 });
    expect(nb.energy()).toBe(0);
    expect(nb.momentum()).toEqual({ x: 0, y: 0, z: 0 });
  });
});
