import type { Body } from './Body.ts';

// Plummer-softened Newtonian gravity. Writes accelerations directly to
// body.accel so the Verlet integrator can consume them with no allocation.
//
//   F_magnitude  =  G · m₁ · m₂ / (r² + ε²)^(3/2)         (vector form below)
//   a₁           =  G · m₂ · (b - a) / (r² + ε²)^(3/2)
//   a₂           = -G · m₁ · (b - a) / (r² + ε²)^(3/2)
//
// The Plummer kernel (Aarseth, 1963; standard in N-body codes) regularises
// the 1/r² singularity at close approach without changing far-field behaviour.
// We pick ε small enough that ordinary orbits feel Keplerian and large enough
// that close approaches don't blow numerics.

export function applyGravity(
  a: Body,
  b: Body,
  G: number,
  softening: number,
): void {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const rSq = dx * dx + dy * dy;
  const denom = Math.pow(rSq + softening * softening, 1.5);
  const k1 = (G * b.mass) / denom;
  const k2 = (G * a.mass) / denom;
  a.accel.x = k1 * dx;
  a.accel.y = k1 * dy;
  b.accel.x = -k2 * dx;
  b.accel.y = -k2 * dy;
}
