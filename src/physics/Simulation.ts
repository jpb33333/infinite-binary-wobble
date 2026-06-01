import type { Body } from './Body.ts';
import { createBody } from './Body.ts';
import type { Vec2 } from './Vec2.ts';
import { vec2 } from './Vec2.ts';
import { applyGravity } from './gravity.ts';
import { verletStep } from './integrator.ts';
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

export class Simulation {
  readonly a: Body;
  readonly b: Body;
  time: number;
  readonly initialSeparation: number;
  readonly initialEnergy: number;

  constructor(a: Body, b: Body) {
    this.a = a;
    this.b = b;
    this.time = 0;
    // Prime acceleration so the first Verlet step has a meaningful a(0).
    applyGravity(a, b, PHYSICS.G, PHYSICS.SOFTENING);
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    this.initialSeparation = Math.sqrt(dx * dx + dy * dy);
    this.initialEnergy = computeOrbit(a, b, PHYSICS.G).totalEnergy;
  }

  // Single fixed-dt sub-step.
  step(dt: number = PHYSICS.DT): void {
    verletStep(this.a, this.b, dt, PHYSICS.G, PHYSICS.SOFTENING);
    this.time += dt;
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
    return computeOrbit(this.a, this.b, PHYSICS.G);
  }

  // Convenience constructor from raw numbers — used by both gameplay
  // setup and physics tests.
  static create(
    m1: number, pos1: Vec2, vel1: Vec2,
    m2: number, pos2: Vec2, vel2: Vec2,
  ): Simulation {
    const a = createBody(m1, vec2(pos1.x, pos1.y), vec2(vel1.x, vel1.y));
    const b = createBody(m2, vec2(pos2.x, pos2.y), vec2(vel2.x, vel2.y));
    return new Simulation(a, b);
  }
}
