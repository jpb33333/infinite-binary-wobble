import type { Body } from './Body.ts';
import { applyGravity } from './gravity.ts';

// Velocity Verlet — kick-drift-kick form. Symplectic: phase-space volume
// preserved, energy oscillates around the true value rather than secularly
// drifting (as it does in Euler / RK4 over long integrations of periodic
// systems).
//
//   v(t + ½dt) = v(t)        + ½ · a(t)     · dt        — first half-kick
//   x(t +  dt) = x(t)        +     v(t+½dt) · dt        — drift
//   a(t +  dt) = F(x(t+dt)) / m                          — recompute force
//   v(t +  dt) = v(t + ½dt) + ½ · a(t+dt)  · dt         — second half-kick
//
// PRECONDITION: body.accel must hold a(t), i.e. the force computed at the
// CURRENT positions. The Simulation primes this at construction by calling
// applyGravity once before any step.

export function verletStep(
  a: Body,
  b: Body,
  dt: number,
  G: number,
  softening: number,
): void {
  const halfDt = 0.5 * dt;

  // First half-kick
  a.vel.x += a.accel.x * halfDt;
  a.vel.y += a.accel.y * halfDt;
  b.vel.x += b.accel.x * halfDt;
  b.vel.y += b.accel.y * halfDt;

  // Drift
  a.pos.x += a.vel.x * dt;
  a.pos.y += a.vel.y * dt;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;

  // Recompute acceleration at the new positions
  applyGravity(a, b, G, softening);

  // Second half-kick
  a.vel.x += a.accel.x * halfDt;
  a.vel.y += a.accel.y * halfDt;
  b.vel.x += b.accel.x * halfDt;
  b.vel.y += b.accel.y * halfDt;
}
