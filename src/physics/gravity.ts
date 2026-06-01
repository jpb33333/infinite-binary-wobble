import type { Body } from './Body.ts';

// Plummer-softened Newtonian gravity. Writes accelerations directly to
// body.accel so the integrator can consume them with no allocation.
//
//   F⃗_on_a =  G · m_a · m_b · (b - a) / (r² + ε²)^(3/2)     (vector form)
//   |F|     =  G · m_a · m_b · r / (r² + ε²)^(3/2)            (magnitude)
//   a⃗_a     =  G · m_b · (b - a) / (r² + ε²)^(3/2)            (accel on a)
//   a⃗_b     = -G · m_a · (b - a) / (r² + ε²)^(3/2)            (accel on b)
//
// (r = |b - a|; ε = softening length.)
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
