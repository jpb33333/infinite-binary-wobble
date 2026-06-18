import type { Vec2 } from './Vec2.ts';
import { vec2 } from './Vec2.ts';

export interface Body {
  mass: number;
  pos: Vec2;
  vel: Vec2;
  // Current acceleration in game units. Maintained by `gravity.applyGravity`
  // so that the PEFRL integrator can read it without recomputing
  // mid-step. Initialized to zero; the Simulation primes it at construction.
  accel: Vec2;
  // Third-dimension scalars, used ONLY by the N-body unravel (nbody.ts) for its
  // pseudo-3D depth. The two-body engine (Simulation/gravity/integrator/orbit)
  // never reads or writes these — they stay 0, so the 2D math (and golden
  // parity with the iOS port) is byte-for-byte unaffected.
  z: number;
  vz: number;
  az: number;
}

export function createBody(mass: number, pos: Vec2, vel: Vec2): Body {
  return { mass, pos, vel, accel: vec2(0, 0), z: 0, vz: 0, az: 0 };
}

// Visual radius scales with sqrt(mass) so that *area* is proportional to
// mass — feels more honest than radius-proportional (small mass changes
// otherwise dwarf the canvas).
export const RADIUS_BASE = 14;
export function bodyRadius(mass: number): number {
  return RADIUS_BASE * Math.sqrt(mass);
}
