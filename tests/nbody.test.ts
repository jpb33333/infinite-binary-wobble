import { describe, test, expect } from 'vitest';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { applyGravity } from '../src/physics/gravity.ts';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { circularRelativeVelocity } from '../src/physics/orbit.ts';
import { NBodySimulation, applyGravityN, BLAST_VMAX } from '../src/physics/nbody.ts';

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

  test('a supernova leaves a heavy remnant and blasts the survivors (mass + momentum conserved)', () => {
    // Two heavy stars (5 + 5 = 10 ≥ limit) collide head-on; a light third sits
    // off to the side and is flung by the blast. The detonation now CONSERVES
    // mass (a remnant remains, nothing vanishes) and momentum (the remnant
    // recoils against the blast).
    const nb = new NBodySimulation(
      [
        createBody(5, vec2(-120, 0), vec2(70, 0)),
        createBody(5, vec2(120, 0), vec2(-70, 0)),
        createBody(1, vec2(0, 280), vec2(0, 0)),
      ],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const p0 = nb.momentum();
    const m0 = nb.bodies.reduce((s, b) => s + b.mass, 0);
    let event = null;
    for (let i = 0; i < 3000 && !event; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) event = e;
    }
    expect(event!.supernova).toBe(true);
    expect(event!.body).not.toBeNull(); // a remnant survives now
    expect(nb.bodies.length).toBe(2); // remnant + the flung third
    // Mass conserved: nothing vanished, the remnant carries the combined mass.
    expect(nb.bodies.reduce((s, b) => s + b.mass, 0)).toBeCloseTo(m0, 9);
    expect(event!.body!.mass).toBeCloseTo(10, 9);
    // Momentum conserved across the blast (the remnant recoils to balance it).
    const p = nb.momentum();
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
    expect(Math.abs(p.z - p0.z)).toBeLessThan(1e-6);
    // The light third was genuinely flung by the shockwave.
    const third = nb.bodies.find(b => b.mass < 5)!;
    expect(Math.hypot(third.vel.x, third.vel.y)).toBeGreaterThan(50);
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

  test('an over-mass 2-body collision leaves one remnant (mass + momentum conserved)', () => {
    // The terminal "everything fell together" case. The detonation no longer
    // empties the system (which would vanish mass) — it leaves a single heavy
    // remnant. (The Game reads star-count ≤ 1 as a collapse → black-hole over.)
    const nb = new NBodySimulation(
      [createBody(5, vec2(-100, 0), vec2(60, 0)), createBody(5, vec2(100, 0), vec2(-60, 0))],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    const p0 = nb.momentum();
    let event = null;
    for (let i = 0; i < 3000 && !event; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) event = e;
    }
    expect(event && event.supernova).toBe(true);
    expect(nb.bodies.length).toBe(1); // one remnant, not zero
    expect(nb.bodies[0].mass).toBeCloseTo(10, 9); // mass conserved
    // Momentum conserved (two equal-and-opposite stars → a ~stationary remnant).
    const p = nb.momentum();
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
    expect(Number.isFinite(nb.bodies[0].vel.x)).toBe(true);
  });

  test('the supernova blast impulse is capped at BLAST_VMAX and falls off with distance', () => {
    // Two heavy stars start already overlapping, so they merge on the first step
    // and the witnesses barely move under gravity beforehand: the velocity change
    // ACROSS the supernova step is then essentially the blast impulse alone (the
    // clean way to bound it — a witness's *total* speed also carries any
    // gravitational slingshot, which the cap does not limit). Two light witnesses
    // (at rest, exempt from merging) sit near and far on the +y axis; the nearer
    // is flung harder (1/r² falloff) and neither impulse exceeds the cap.
    const near = createBody(0.5, vec2(0, 70), vec2(0, 0));
    const far = createBody(0.5, vec2(0, 500), vec2(0, 0));
    const nb = new NBodySimulation(
      [createBody(5, vec2(-10, 0), vec2(0, 0)), createBody(5, vec2(10, 0), vec2(0, 0)), near, far],
      PHYSICS.G,
      PHYSICS.SOFTENING,
    );
    nb.noMerge.add(near);
    nb.noMerge.add(far);
    let event = null;
    let nearDV = 0;
    let farDV = 0;
    for (let i = 0; i < 100 && !event; i++) {
      const nbx = near.vel.x;
      const nby = near.vel.y;
      const fbx = far.vel.x;
      const fby = far.vel.y;
      const e = nb.step(PHYSICS.DT);
      if (e) {
        event = e;
        nearDV = Math.hypot(near.vel.x - nbx, near.vel.y - nby);
        farDV = Math.hypot(far.vel.x - fbx, far.vel.y - fby);
      }
    }
    expect(event && event.supernova).toBe(true);
    expect(nearDV).toBeGreaterThan(farDV); // 1/r² falloff with distance
    expect(farDV).toBeGreaterThan(10); // the distant witness still felt it
    expect(nearDV).toBeLessThanOrEqual(BLAST_VMAX + 1e-6); // never exceeds the cap
  });

  test('a noMerge planet survives a head-on pass through a star (never fuses)', () => {
    // The Trisolaris planet contract: a planet feels gravity but never merges.
    // A tiny planet and a star aimed dead at each other overlap and pass through
    // — the body count stays 2, no merge event fires, and momentum is conserved
    // across the deep (Plummer-softened) close encounter.
    const planet = createBody(0.02, vec2(-200, 0), vec2(120, 0));
    const star = createBody(3, vec2(200, 0), vec2(-30, 0));
    const nb = new NBodySimulation([star, planet], PHYSICS.G, PHYSICS.SOFTENING);
    nb.noMerge.add(planet);
    const p0 = nb.momentum();
    let merged = null;
    for (let i = 0; i < 4000; i++) {
      const e = nb.step(PHYSICS.DT);
      if (e) merged = e;
    }
    expect(merged).toBeNull(); // never fused
    expect(nb.bodies.length).toBe(2);
    expect(nb.bodies).toContain(planet); // the planet itself survived
    const p = nb.momentum();
    expect(Math.abs(p.x - p0.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - p0.y)).toBeLessThan(1e-6);
  });

  test('a NaN/Infinity-poisoned body is sanitized at the N-body boundary', () => {
    // Defence-in-depth parity with the two-body Simulation.create boundary: a
    // body mutated to non-finite values (e.g. via DevTools) is clamped on entry,
    // so one NaN can't propagate through gravity and blank the whole field.
    const good = createBody(2, vec2(-100, 0), vec2(0, 30));
    const bad = createBody(3, vec2(100, 0), vec2(0, -20));
    bad.pos.x = NaN;
    bad.vz = Infinity;
    const nb = new NBodySimulation([good, bad], PHYSICS.G, PHYSICS.SOFTENING);
    expect(Number.isFinite(nb.bodies[1].pos.x)).toBe(true);
    expect(Number.isFinite(nb.bodies[1].vz)).toBe(true);
    // addBody applies the same guard.
    const bad2 = createBody(1, vec2(NaN, NaN), vec2(-Infinity, NaN));
    nb.addBody(bad2);
    const added = nb.bodies[nb.bodies.length - 1];
    expect(Number.isFinite(added.pos.x) && Number.isFinite(added.vel.x)).toBe(true);
    // Stepping never reintroduces a non-finite component.
    for (let i = 0; i < 200; i++) nb.step(PHYSICS.DT);
    for (const b of nb.bodies) {
      expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y) && Number.isFinite(b.z)).toBe(
        true,
      );
      expect(Number.isFinite(b.vel.x) && Number.isFinite(b.vel.y) && Number.isFinite(b.vz)).toBe(
        true,
      );
    }
  });
});
