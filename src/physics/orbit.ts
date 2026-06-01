import type { Body } from './Body.ts';
import { sub, mag, magSq, crossZ } from './Vec2.ts';

// Orbital diagnostics computed from the current state of the two bodies.
// All quantities use *specific* (per-reduced-mass) forms where possible —
// they're independent of μ and the algebra is cleaner.
//
// References:
//   - https://en.wikipedia.org/wiki/Specific_orbital_energy
//   - https://en.wikipedia.org/wiki/Eccentricity_vector
//   - https://en.wikipedia.org/wiki/Kepler%27s_laws_of_planetary_motion

export interface OrbitState {
  separation: number;              // r = |b.pos - a.pos|
  vRel: number;                    // |v_rel|
  specificEnergy: number;          // ε = ½·v_rel² − G·M/r
  totalEnergy: number;             // E = μ·ε        (sign agrees with ε)
  specificAngularMomentum: number; // h = |r × v_rel|  (scalar in 2D)
  eccentricity: number;            // e ≥ 0
  semiMajorAxis: number;           // a; Infinity when ε ≥ 0
  period: number;                  // T = 2π√(a³/GM); Infinity when unbound
  escapeVelocity: number;          // √(2GM/r) at current separation
  bound: boolean;                  // ε < 0
}

export function computeOrbit(a: Body, b: Body, G: number): OrbitState {
  const r = sub(b.pos, a.pos);
  const v = sub(b.vel, a.vel);
  const separation = mag(r);
  const vRelSq = magSq(v);
  const vRel = Math.sqrt(vRelSq);

  const M = a.mass + b.mass;
  const muReduced = (a.mass * b.mass) / M;

  const specificEnergy = 0.5 * vRelSq - (G * M) / separation;
  const totalEnergy = muReduced * specificEnergy;

  const specificAngularMomentum = Math.abs(crossZ(r, v));

  // e² = 1 + 2·ε·h² / (G·M)²
  const inside =
    1 +
    (2 * specificEnergy * specificAngularMomentum * specificAngularMomentum) /
      ((G * M) * (G * M));
  const eccentricity = inside > 0 ? Math.sqrt(inside) : 0;

  const semiMajorAxis =
    specificEnergy < 0 ? -(G * M) / (2 * specificEnergy) : Infinity;

  const period = Number.isFinite(semiMajorAxis)
    ? 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / (G * M))
    : Infinity;

  const escapeVelocity = Math.sqrt((2 * G * M) / separation);

  return {
    separation,
    vRel,
    specificEnergy,
    totalEnergy,
    specificAngularMomentum,
    eccentricity,
    semiMajorAxis,
    period,
    escapeVelocity,
    bound: specificEnergy < 0,
  };
}

// For setup-time UI feedback: the relative velocity that produces a perfect
// circular orbit at the given separation, given both masses. Useful as the
// "if you set this, you win" target.
export function circularRelativeVelocity(
  m1: number,
  m2: number,
  separation: number,
  G: number,
): number {
  return Math.sqrt((G * (m1 + m2)) / separation);
}
