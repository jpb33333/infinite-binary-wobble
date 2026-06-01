import type { Body } from './Body.ts';
import { applyGravity } from './gravity.ts';

// 4th-order symplectic integrator for the 2-body Hamiltonian. Preserves
// phase-space volume; energy oscillates with bounded amplitude rather than
// drifting secularly (as Euler / RK4 do for periodic systems).
//
// PEFRL [Omelyan, Mryglod & Folk, 2002] reduces the leading error constant
// relative to standard 4th-order schemes (e.g. Forest-Ruth, Yoshida 4),
// giving roughly an order of magnitude smaller energy oscillation at the
// same dt for our problem.
//
// Reference: I.P. Omelyan, I.M. Mryglod, R. Folk, "Symplectic analytically
// integrable decomposition algorithms" (2002), Computer Physics Communications
// 146, 188–202.

// ─── PEFRL (4th order) ─────────────────────────────────────────────────────
//
// One full step is the sequence
//   D(ξ) K((1-2λ)/2) D(χ) K(λ) D(1-2(ξ+χ)) K(λ) D(χ) K((1-2λ)/2) D(ξ)
// where D is a drift  (x += v·dt_sub)
// and   K is a kick   (v += a(x)·dt_sub) with a freshly recomputed at each K.
//
// Five drifts, four kicks, four force evaluations per step. Time-symmetric.
// Net drift coefficients sum to 1, net kick coefficients sum to 1.

const XI = 0.1786178958448091;
const LAMBDA = -0.2123418310626054;
const CHI = -0.06626458266981849;

export function pefrlStep(
  a: Body,
  b: Body,
  dt: number,
  G: number,
  softening: number,
): void {
  const cD1 = XI * dt;
  const cD2 = CHI * dt;
  const cD3 = (1 - 2 * (XI + CHI)) * dt;
  const cK1 = ((1 - 2 * LAMBDA) / 2) * dt;
  const cK2 = LAMBDA * dt;

  drift(a, b, cD1);
  applyGravity(a, b, G, softening);
  kick(a, b, cK1);

  drift(a, b, cD2);
  applyGravity(a, b, G, softening);
  kick(a, b, cK2);

  drift(a, b, cD3);
  applyGravity(a, b, G, softening);
  kick(a, b, cK2);

  drift(a, b, cD2);
  applyGravity(a, b, G, softening);
  kick(a, b, cK1);

  drift(a, b, cD1);
}

function drift(a: Body, b: Body, dtScaled: number): void {
  a.pos.x += a.vel.x * dtScaled;
  a.pos.y += a.vel.y * dtScaled;
  b.pos.x += b.vel.x * dtScaled;
  b.pos.y += b.vel.y * dtScaled;
}

function kick(a: Body, b: Body, dtScaled: number): void {
  a.vel.x += a.accel.x * dtScaled;
  a.vel.y += a.accel.y * dtScaled;
  b.vel.x += b.accel.x * dtScaled;
  b.vel.y += b.accel.y * dtScaled;
}
