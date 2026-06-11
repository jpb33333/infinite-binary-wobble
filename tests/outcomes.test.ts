import { describe, test, expect } from 'vitest';
import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { OutcomeClassifier, DEFAULT_OUTCOME_CONFIG } from '../src/game/outcomes.ts';

// Test geometry centre — equivalent to the canvas centre under the old
// off-canvas check. With camera follow the absolute bounds no longer
// matter; we just need a stable reference point for the tests' setups.
function center(): { x: number; y: number } {
  return { x: 640, y: 400 };
}

describe('OutcomeClassifier', () => {
  test('collision: bodies started near-touching with closing velocity → lose_collision', () => {
    const c = center();
    const sim = Simulation.create(
      3, vec2(c.x - 30, c.y), vec2(+200, 0),
      3, vec2(c.x + 30, c.y), vec2(-200, 0),
    );
    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    for (let i = 0; i < 600 && outcome.kind === 'playing'; i++) {
      sim.step();
      outcome = cls.update(sim, PHYSICS.DT);
    }
    expect(outcome.kind).toBe('lose_collision');
  });

  test('collision: grazing pass that overlaps only BETWEEN frame samples is still caught', () => {
    // Regression (2026-06-10 review). The classifier runs once per rendered
    // frame while physics advances in 1/240 s substeps — at the DT_CAP frame
    // floor (1/30 s = 8 substeps) a fast graze can dip inside the collision
    // radius and back out entirely between two classifier samples. Two
    // mass-1 stars at the 300 px/s per-body cap on a near-grazing approach
    // overlap by ~3 px at substep resolution yet never at frame resolution;
    // collision detection must key off the substep minimum, not the
    // instantaneous separation.
    const c = center();
    const half = 50; // per-body vy; vx fills the rest of the 300 px/s cap
    const vx = Math.sqrt(300 * 300 - half * half);
    const sim = Simulation.create(
      1, vec2(c.x - 200, c.y), vec2(+vx, -half),
      1, vec2(c.x + 200, c.y), vec2(-vx, +half),
    );
    const rSum = 28; // bodyRadius(1) × 2

    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    const SUBSTEPS_PER_FRAME = 8; // one 1/30 s frame of physics per classifier sample
    const frameDt = SUBSTEPS_PER_FRAME * PHYSICS.DT;
    let minFrameSeparation = Infinity;
    const maxFrames = Math.round(5 / frameDt);
    for (let f = 0; f < maxFrames && outcome.kind === 'playing'; f++) {
      for (let s = 0; s < SUBSTEPS_PER_FRAME; s++) sim.step();
      const o = sim.orbit();
      minFrameSeparation = Math.min(minFrameSeparation, o.separation);
      outcome = cls.update(sim, frameDt);
    }

    // The premise of the regression: at frame boundaries the stars never
    // appear to touch — only the substep trajectory dips inside rSum.
    expect(minFrameSeparation).toBeGreaterThanOrEqual(rSum);
    expect(outcome.kind).toBe('lose_collision');
  });

  test('escape: super-escape relative velocity, both bodies fly off → lose_escape', () => {
    const c = center();
    const sim = Simulation.create(
      2, vec2(c.x - 300, c.y), vec2(0, +400),
      2, vec2(c.x + 300, c.y), vec2(0, -400),
    );
    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    for (let i = 0; i < 3000 && outcome.kind === 'playing'; i++) {
      sim.step();
      outcome = cls.update(sim, PHYSICS.DT);
    }
    expect(outcome.kind).toBe('lose_escape');
  });

  test('win: configured for circular orbit at sensible separation → win after 2 orbits', () => {
    const c = center();
    const m = 2;
    const r = 400;
    const vRelCirc = Math.sqrt((PHYSICS.G * (m + m)) / r);
    const v = vRelCirc / 2;
    const sim = Simulation.create(
      m, vec2(c.x - r / 2, c.y), vec2(0, +v),
      m, vec2(c.x + r / 2, c.y), vec2(0, -v),
    );
    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    // Run for up to ~30 simulated seconds (well over 2 orbits)
    const maxSteps = Math.round(30 / PHYSICS.DT);
    for (let i = 0; i < maxSteps && outcome.kind === 'playing'; i++) {
      sim.step();
      outcome = cls.update(sim, PHYSICS.DT);
    }
    expect(outcome.kind).toBe('win');
    expect(cls.orbits).toBeGreaterThanOrEqual(2);
  });

  test('slingshot: super-circular bound orbit with huge apoapsis goes off-canvas → lose_slingshot', () => {
    // Tangential velocity ABOVE circular but below escape (√2 · v_circ).
    // At a tangent start, super-circular ⇒ this point is periapsis and
    // apoapsis is several times farther along the same axis. With ~1.3·v_circ
    // the apoapsis is ~5× the initial separation, well off-canvas, while
    // the orbit remains bound (ε < 0).
    const c = center();
    const m = 2;
    const r = 400;
    const vRelCirc = Math.sqrt((PHYSICS.G * (m + m)) / r);
    // Per-body velocity so that |v_rel| = 1.3 · v_circ
    const v = vRelCirc * 0.65;
    const sim = Simulation.create(
      m, vec2(c.x - r / 2, c.y), vec2(0, +v),
      m, vec2(c.x + r / 2, c.y), vec2(0, -v),
    );
    // Sanity-check setup: must start bound but eccentric, not at escape
    const initial = sim.orbit();
    expect(initial.bound).toBe(true);
    expect(initial.eccentricity).toBeGreaterThan(0.3);

    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    const maxSteps = Math.round(60 / PHYSICS.DT);
    for (let i = 0; i < maxSteps && outcome.kind === 'playing'; i++) {
      sim.step();
      outcome = cls.update(sim, PHYSICS.DT);
    }
    expect(outcome.kind).toBe('lose_slingshot');
  });

  test('classifier remains "playing" during warmup window even with collision-bound geometry', () => {
    const c = center();
    const sim = Simulation.create(
      3, vec2(c.x - 100, c.y), vec2(+50, 0),
      3, vec2(c.x + 100, c.y), vec2(-50, 0),
    );
    // Custom config with a long warmup so we can test the gating
    const cfg = { ...DEFAULT_OUTCOME_CONFIG, warmupSeconds: 10 };
    const cls = new OutcomeClassifier(cfg);
    // Simulate just a few steps (way less than 10s)
    sim.step();
    const outcome = cls.update(sim, PHYSICS.DT);
    // Collision is checked BEFORE warmup gate, but escape/win are not.
    // Bodies are still ~200 px apart, so no collision yet → playing.
    expect(outcome.kind).toBe('playing');
  });

  test('reset() clears resolved state and orbit count', () => {
    const c = center();
    const sim = Simulation.create(
      3, vec2(c.x - 30, c.y), vec2(+200, 0),
      3, vec2(c.x + 30, c.y), vec2(-200, 0),
    );
    const cls = new OutcomeClassifier(DEFAULT_OUTCOME_CONFIG);
    let outcome = cls.update(sim, 0);
    for (let i = 0; i < 600 && outcome.kind === 'playing'; i++) {
      sim.step();
      outcome = cls.update(sim, PHYSICS.DT);
    }
    expect(outcome.kind).toBe('lose_collision');
    cls.reset();
    expect(cls.orbits).toBe(0);
    // After reset, the classifier should report 'playing' on next update
    const fresh = Simulation.create(
      2, vec2(c.x - 200, c.y), vec2(0, +50),
      2, vec2(c.x + 200, c.y), vec2(0, -50),
    );
    const next = cls.update(fresh, 0);
    expect(next.kind).toBe('playing');
  });
});
