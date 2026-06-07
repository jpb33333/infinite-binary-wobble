// scripts/export-golden-fixtures.mjs
//
// Golden-trajectory exporter. Runs the REAL TypeScript physics (the same
// modules the live web game uses — src/physics/*) and writes JSON fixtures
// that the iOS Swift XCTest suite replays to prove a bit-faithful port.
//
// Determinism: the TS physics is allocation-free and uses only IEEE-754
// binary64 doubles, so re-runs are bit-identical (verified: two 50k-step runs
// match exactly; momentum drift over 4000 steps is exactly 0.0). Swift `Double`
// is the same IEEE-754 binary64, so a faithful port reproduces these numbers.
//
// Usage:
//   npm run export:fixtures
//   node --experimental-strip-types scripts/export-golden-fixtures.mjs
//
// (Node 22 strips TypeScript types for `.ts` imports, so the script imports the
//  real physics modules directly — zero new dependencies, zero build step.)
//
// Output: tests/fixtures/golden-{stable_orbit,collision,slingshot_escape}.json
//
// Each fixture pins, for one scenario:
//   • the PHYSICS constants + PEFRL coefficients it was generated against
//     (the Swift constants-guard test fails loudly if these ever drift)
//   • the exact (sanitized) initial body specs the Simulation was built from
//   • the step count + sampling cadence
//   • full state (pos/vel of both bodies) + orbit diagnostics at each sample
//   • the final energy drift, eccentricity, and classified outcome
//
// We do NOT round or truncate any number: JS `JSON.stringify` emits each Double
// as its shortest round-trippable decimal, which Swift's Double(_:String) /
// JSONDecoder parses back to the exact same bits. The transfer is lossless.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation, PHYSICS } from '../src/physics/Simulation.ts';
import { computeOrbit } from '../src/physics/orbit.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { bodyRadius } from '../src/physics/Body.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'tests', 'fixtures');

// The PEFRL coefficients are private to src/physics/integrator.ts (not exported).
// They are pinned here VERBATIM from that file so the fixture records exactly
// which integrator produced it; the Swift constants-guard asserts equality.
// Source of truth: src/physics/integrator.ts (XI / LAMBDA / CHI).
const PEFRL = {
  XI: 0.1786178958448091,
  LAMBDA: -0.2123418310626054,
  CHI: -0.06626458266981849,
};

// Full-state + orbit-diagnostics snapshot at the current simulation instant.
function snapshot(sim) {
  const o = computeOrbit(sim.a, sim.b, PHYSICS.G);
  return {
    t: sim.time,
    aPos: [sim.a.pos.x, sim.a.pos.y],
    bPos: [sim.b.pos.x, sim.b.pos.y],
    aVel: [sim.a.vel.x, sim.a.vel.y],
    bVel: [sim.b.vel.x, sim.b.vel.y],
    separation: o.separation,
    specificEnergy: o.specificEnergy,
    totalEnergy: o.totalEnergy,
    eccentricity: o.eccentricity,
    bound: o.bound,
  };
}

// The exact (post-sanitization) body specs the Simulation was built from.
// Recording these lets the Swift harness reconstruct the identical initial
// state and confirms the sanitize-then-construct boundary agrees across ports.
function initialBodies(sim) {
  return {
    a: {
      mass: sim.a.mass,
      pos: [sim.a.pos.x, sim.a.pos.y],
      vel: [sim.a.vel.x, sim.a.vel.y],
    },
    b: {
      mass: sim.b.mass,
      pos: [sim.b.pos.x, sim.b.pos.y],
      vel: [sim.b.vel.x, sim.b.vel.y],
    },
  };
}

// The summed-radii collision threshold the game uses (src/game/outcomes.ts:
// `orbit.separation < bodyRadius(a) + bodyRadius(b)`).
function collisionThreshold(sim) {
  return bodyRadius(sim.a.mass) + bodyRadius(sim.b.mass);
}

// Run `steps` PEFRL sub-steps, snapshotting at step 0, every `sampleEvery`
// steps, and the final step. Returns the full fixture object.
//
// `firstCollisionStep` is the first step at which separation falls below the
// summed-radii threshold — i.e. the step the game's OutcomeClassifier would
// resolve `lose_collision`. We record it because Plummer softening (ε=6)
// regularizes close approaches: bodies pass *through* the collision radius and
// slingshot back out rather than merging, so the TERMINAL state of a collision
// scenario is an escape, not a contact. The honest game outcome is therefore
// the FIRST threshold crossing, exactly as the live classifier latches it.
function runScenario(name, specs, steps, sampleEvery) {
  const sim = Simulation.create(
    specs.a.mass, vec2(specs.a.pos[0], specs.a.pos[1]), vec2(specs.a.vel[0], specs.a.vel[1]),
    specs.b.mass, vec2(specs.b.pos[0], specs.b.pos[1]), vec2(specs.b.vel[0], specs.b.vel[1]),
  );

  const rCollide = collisionThreshold(sim);
  let firstCollisionStep = computeOrbit(sim.a, sim.b, PHYSICS.G).separation < rCollide ? 0 : -1;

  // Capture the initial body specs NOW, before the step loop. The physics is
  // allocation-free and mutates sim.a/sim.b in place, so reading them after the
  // loop would record the FINAL state, not the initial one.
  const initial = initialBodies(sim);

  const samples = [{ step: 0, ...snapshot(sim) }];
  for (let i = 1; i <= steps; i++) {
    sim.step(); // exactly PHYSICS.DT — the same call the game's accumulator drains
    if (firstCollisionStep < 0) {
      const sep = computeOrbit(sim.a, sim.b, PHYSICS.G).separation;
      if (sep < rCollide) firstCollisionStep = i;
    }
    if (i % sampleEvery === 0 || i === steps) {
      samples.push({ step: i, ...snapshot(sim) });
    }
  }

  // Game-faithful outcome: collision latches at the first threshold crossing
  // (the live classifier resolves and freezes there). Absent any crossing, the
  // outcome is read from the terminal state — escape if unbound, else bound.
  const last = samples[samples.length - 1];
  const outcome =
    firstCollisionStep >= 0
      ? 'lose_collision'
      : last.bound
        ? 'bound'
        : 'lose_escape';
  const finalEnergyDrift = Math.abs(
    (last.totalEnergy - sim.initialEnergy) / sim.initialEnergy,
  );

  return {
    scenario: name,
    // Provenance: any change here invalidates the golden file.
    generatedFrom: 'infinite-binary-wobble TS physics (src/physics/*)',
    integrator: 'PEFRL-4',
    dt: PHYSICS.DT,
    steps,
    sampleEvery,
    constants: {
      G: PHYSICS.G,
      SOFTENING: PHYSICS.SOFTENING,
      DT: PHYSICS.DT,
      XI: PEFRL.XI,
      LAMBDA: PEFRL.LAMBDA,
      CHI: PEFRL.CHI,
    },
    initialBodies: initial,
    initialEnergy: sim.initialEnergy,
    initialSeparation: sim.initialSeparation,
    // The summed-radii collision threshold and the first step it was crossed
    // (-1 = never). The Swift harness asserts the same crossing step to prove
    // the collision-detection geometry ported faithfully.
    collisionThreshold: rCollide,
    firstCollisionStep,
    final: {
      step: last.step,
      t: last.t,
      totalEnergy: last.totalEnergy,
      energyDriftRel: finalEnergyDrift,
      eccentricity: last.eccentricity,
      separation: last.separation,
      bound: last.bound,
      outcome,
    },
    samples,
  };
}

// Circular relative velocity helper (mirrors orbit.circularRelativeVelocity).
const vCirc = (m1, m2, r) => Math.sqrt((PHYSICS.G * (m1 + m2)) / r);

// ── Scenario 1: stable (near-circular) orbit ─────────────────────────────────
// Equal masses, exact circular relative velocity split ±y. The calm regime and
// the energy-drift acceptance case. denom stays moderate; this exposes long-run
// roundoff. 2000 steps (~8.3 s, >1 full orbit), sampled every 50th.
const stableOrbitSpecs = (() => {
  const m = 2, r = 400;
  const v = vCirc(m, m, r) / 2;
  return {
    a: { mass: m, pos: [-r / 2, 0], vel: [0, +v] },
    b: { mass: m, pos: [+r / 2, 0], vel: [0, -v] },
  };
})();

// ── Scenario 2: collision ────────────────────────────────────────────────────
// Bodies near-touching with strong closing velocity → the close-approach regime
// where rSq → small, denom is dominated by the Plummer softening, accel spikes,
// and pow(_, 1.5) precision matters most. 400 steps, sampled every 10th (dense,
// because this is where any port divergence shows first).
const collisionSpecs = {
  a: { mass: 3, pos: [-30, 0], vel: [+200, 0] },
  b: { mass: 3, pos: [+30, 0], vel: [-200, 0] },
};

// ── Scenario 3: slingshot / escape ───────────────────────────────────────────
// Super-escape tangential velocity (±400): unbound, separation grows
// monotonically, exercises the far-field tail (large denom, accel→0) and the
// ε>0 / bound=false path. 2000 steps, sampled every 50th.
const slingshotEscapeSpecs = (() => {
  const m = 2, r = 600; // bodies at ±300
  return {
    a: { mass: m, pos: [-r / 2, 0], vel: [0, +400] },
    b: { mass: m, pos: [+r / 2, 0], vel: [0, -400] },
  };
})();

const fixtures = [
  runScenario('stable_orbit', stableOrbitSpecs, 2000, 50),
  runScenario('collision', collisionSpecs, 400, 10),
  runScenario('slingshot_escape', slingshotEscapeSpecs, 2000, 50),
];

mkdirSync(OUT_DIR, { recursive: true });
for (const fx of fixtures) {
  const path = join(OUT_DIR, `golden-${fx.scenario}.json`);
  writeFileSync(path, JSON.stringify(fx, null, 2) + '\n', 'utf8');
  console.log(
    `wrote ${path}  (${fx.samples.length} samples, ` +
      `outcome=${fx.final.outcome}, ` +
      `final |E-E0|/|E0|=${fx.final.energyDriftRel.toExponential(3)})`,
  );
}
