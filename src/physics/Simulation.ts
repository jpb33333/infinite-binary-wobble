import type { Body } from './Body.ts';
import { createBody } from './Body.ts';
import type { Vec2 } from './Vec2.ts';
import { vec2 } from './Vec2.ts';
import { applyGravity } from './gravity.ts';
import { pefrlStep } from './integrator.ts';
import type { OrbitState } from './orbit.ts';
import { computeOrbit } from './orbit.ts';

// All physics constants live here. Tune by editing this object, not by
// scattering magic numbers across the codebase.
//
//   Pixel units for position. Mass arbitrary (we use 1–5 in the UI). Time
//   in seconds. G is the gravitational constant in these mixed game units;
//   it has been tuned so that:
//     • a sensible circular binary (M ≈ 2, separation ≈ 600 px) has a
//       period of ~5–8 s and a circular relative velocity of ~180 px/s
//     • the player-controllable velocity range (0–300 px/s) spans the
//       interesting space from "tight ellipse" through "escape"
//   See physics tests for the invariants this configuration preserves.

export const PHYSICS = {
  G: 1.5e7,
  SOFTENING: 6,
  DT: 1 / 240,
  SUBSTEPS_PER_FRAME: 4, // 4 × 1/240 = 1/60 s per UI frame
  WARMUP_SECONDS: 0.6, // give the outcome classifier this much settle time
} as const;

// Defence-in-depth bounds enforced at the boundary into the physics layer.
// The UI clamps everything to narrower ranges (LIMITS in game/states.ts);
// these absolute bounds catch anyone who bypasses the UI — e.g., via DevTools
// mutation of a BodySpec between SETUP and COUNTDOWN. They are intentionally
// generous (~10–30× wider than UI ranges) so the physics simulation stays
// inside well-defined numerical territory even on the cheating path. Any
// non-finite input (NaN, ±Infinity) is replaced by a default before clamping.
const SAFE_INPUT = {
  minMass: 0.01,
  maxMass: 1e3,
  defaultMass: 2.5,
  maxSpeedComponent: 1e4, // per-component cap (each of vx, vy)
  defaultVelComponent: 0,
  maxPosMagnitude: 1e5, // each of |x|, |y|
  defaultPosComponent: 0,
} as const;

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function clampInRange(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// Exported so the additive N-body boundary (nbody.ts) can apply the SAME
// defence-in-depth contract — one source of truth for the SAFE_INPUT bounds, so
// the two clamp layers can never drift apart. The two-body engine's behaviour is
// unchanged; only these helpers' visibility widened.
export function sanitizeMass(m: number): number {
  return clampInRange(
    finite(m, SAFE_INPUT.defaultMass),
    SAFE_INPUT.minMass,
    SAFE_INPUT.maxMass,
  );
}

export function sanitizePosComponent(p: number): number {
  return clampInRange(
    finite(p, SAFE_INPUT.defaultPosComponent),
    -SAFE_INPUT.maxPosMagnitude,
    SAFE_INPUT.maxPosMagnitude,
  );
}

export function sanitizeVelComponent(v: number): number {
  return clampInRange(
    finite(v, SAFE_INPUT.defaultVelComponent),
    -SAFE_INPUT.maxSpeedComponent,
    SAFE_INPUT.maxSpeedComponent,
  );
}

export class Simulation {
  readonly a: Body;
  readonly b: Body;
  time: number;
  readonly initialSeparation: number;
  readonly initialEnergy: number;
  // Smallest separation seen at any substep since construction. Collision
  // detection (game/outcomes.ts) reads THIS, not the instantaneous
  // separation: the classifier only runs once per rendered frame (4–8
  // substeps), and a fast grazing pass can dip inside the collision radius
  // and back out entirely between frames. At game speeds a body moves ≲10 px
  // per substep, so the substep minimum itself can't tunnel a ≥28 px disk.
  minSeparation: number;

  constructor(a: Body, b: Body) {
    this.a = a;
    this.b = b;
    this.time = 0;
    // Prime acceleration so the integrator's first kick has a meaningful a(0).
    applyGravity(a, b, PHYSICS.G, PHYSICS.SOFTENING);
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    this.initialSeparation = Math.sqrt(dx * dx + dy * dy);
    this.minSeparation = this.initialSeparation;
    this.initialEnergy = computeOrbit(a, b, PHYSICS.G, PHYSICS.SOFTENING).totalEnergy;
  }

  // Single fixed-dt sub-step using the 4th-order PEFRL symplectic integrator.
  // Cost is 4 force evaluations per call (vs 1 for a 2nd-order scheme) in
  // exchange for ~10x lower energy oscillation at the same dt — worth it
  // for a system that may sim indefinitely after a WIN.
  step(dt: number = PHYSICS.DT): void {
    pefrlStep(this.a, this.b, dt, PHYSICS.G, PHYSICS.SOFTENING);
    this.time += dt;
    const dx = this.b.pos.x - this.a.pos.x;
    const dy = this.b.pos.y - this.a.pos.y;
    const sep = Math.sqrt(dx * dx + dy * dy);
    if (sep < this.minSeparation) this.minSeparation = sep;
  }

  // Advance one display frame (= SUBSTEPS_PER_FRAME physics sub-steps).
  // This keeps physics rock-stable regardless of frame-rate hiccups,
  // up to the point where the UI loop itself stalls.
  advanceFrame(): void {
    for (let i = 0; i < PHYSICS.SUBSTEPS_PER_FRAME; i++) {
      this.step();
    }
  }

  orbit(): OrbitState {
    return computeOrbit(this.a, this.b, PHYSICS.G, PHYSICS.SOFTENING);
  }

  // Convenience constructor from raw numbers — used by both gameplay setup
  // and physics tests. Inputs are *sanitized* at this boundary against
  // non-finite values and absurd magnitudes; see SAFE_INPUT above.
  static create(
    m1: number, pos1: Vec2, vel1: Vec2,
    m2: number, pos2: Vec2, vel2: Vec2,
  ): Simulation {
    const a = createBody(
      sanitizeMass(m1),
      vec2(sanitizePosComponent(pos1.x), sanitizePosComponent(pos1.y)),
      vec2(sanitizeVelComponent(vel1.x), sanitizeVelComponent(vel1.y)),
    );
    const b = createBody(
      sanitizeMass(m2),
      vec2(sanitizePosComponent(pos2.x), sanitizePosComponent(pos2.y)),
      vec2(sanitizeVelComponent(vel2.x), sanitizeVelComponent(vel2.y)),
    );
    return new Simulation(a, b);
  }
}
