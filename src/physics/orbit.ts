import type { Body } from './Body.ts';
import { sub, mag, magSq, crossZ } from './Vec2.ts';

// Orbital diagnostics computed from the current state of the two bodies.
// All quantities use *specific* (per-reduced-mass) forms where possible —
// they're independent of μ and the algebra is cleaner.
//
// The dynamics in gravity.ts are PLUMMER-SOFTENED, so the energy the
// integrator actually conserves uses the softened potential −G·M/√(r²+ε²),
// not the Keplerian −G·M/r. Pass the same ε here that the Simulation feeds
// the integrator, or the reported "energy" swings on every close approach.
//
// Two regimes, deliberately split:
//   • specificEnergy / totalEnergy / bound / escapeVelocity — the CONSERVED
//     quantities — use the softened potential. This is what the HUD's
//     BOUND/UNBOUND flag and the escape classification key off.
//   • eccentricity / semiMajorAxis / period / argumentOfPeriapsis — the
//     OSCULATING conic elements — stay pure-Keplerian fits of the local
//     state. Feeding them the softened energy would inflate near-circular
//     eccentricity to ~ε/r (the e-formula is √-sensitive at e≈0); the
//     Keplerian fit errs only at O(ε²/r²) and is what the WIN threshold
//     (e ≤ 0.93) was play-tuned against.
//
// References:
//   - https://en.wikipedia.org/wiki/Specific_orbital_energy
//   - https://en.wikipedia.org/wiki/Eccentricity_vector
//   - https://en.wikipedia.org/wiki/Kepler%27s_laws_of_planetary_motion
//   - Aarseth (1963) for the Plummer kernel (see gravity.ts)

export interface OrbitState {
  separation: number;              // r = |b.pos - a.pos|
  vRel: number;                    // |v_rel|
  specificEnergy: number;          // ε = ½·v_rel² − G·M/√(r²+ε_soft²) — conserved
  totalEnergy: number;             // E = μ·ε        (sign agrees with ε)
  specificAngularMomentum: number; // h = |r × v_rel|  (scalar in 2D)
  eccentricity: number;            // e ≥ 0
  semiMajorAxis: number;           // a; Infinity when ε ≥ 0
  period: number;                  // T = 2π√(a³/GM); Infinity when unbound
  escapeVelocity: number;          // √(2GM/r) at current separation
  bound: boolean;                  // ε < 0
  // Direction (radians) from the barycenter focus to periapsis of the
  // RELATIVE orbit. Undefined for a perfect circle; we just return the
  // atan2 of the (numerically) tiny eccentricity vector — fine for drawing
  // a circle either way. This is the conserved quantity that lets us
  // predict the full orbital ellipse from any single state snapshot.
  argumentOfPeriapsis: number;
}

export function computeOrbit(
  a: Body,
  b: Body,
  G: number,
  softening: number = 0,
): OrbitState {
  const r = sub(b.pos, a.pos);
  const v = sub(b.vel, a.vel);
  const separation = mag(r);
  const vRelSq = magSq(v);
  const vRel = Math.sqrt(vRelSq);

  const M = a.mass + b.mass;
  const muReduced = (a.mass * b.mass) / M;

  // Softened radius: matches the potential whose gradient gravity.ts applies.
  const rSoft = Math.sqrt(separation * separation + softening * softening);
  const specificEnergy = 0.5 * vRelSq - (G * M) / rSoft;
  // Keplerian osculating energy — input to the conic-element fits below only.
  const keplerEnergy = 0.5 * vRelSq - (G * M) / separation;
  const totalEnergy = muReduced * specificEnergy;

  // Keep the signed z-component so the eccentricity vector below has the
  // right orientation; the public magnitude stays in `specificAngularMomentum`.
  const hZ = crossZ(r, v);
  const specificAngularMomentum = Math.abs(hZ);

  // e² = 1 + 2·ε_kepler·h² / (G·M)²
  const inside =
    1 +
    (2 * keplerEnergy * specificAngularMomentum * specificAngularMomentum) /
      ((G * M) * (G * M));
  const eccentricity = inside > 0 ? Math.sqrt(inside) : 0;

  // Eccentricity vector points from the focus to periapsis along the orbit's
  // major axis. In 3D: e_vec = (v × h)/μ − r̂. In 2D with h = (0, 0, h_z):
  //   e_x = (v_y · h_z) / μ − r_x / |r|
  //   e_y = (−v_x · h_z) / μ − r_y / |r|
  const muG = G * M;
  const eVecX = (v.y * hZ) / muG - r.x / separation;
  const eVecY = (-v.x * hZ) / muG - r.y / separation;
  const argumentOfPeriapsis = Math.atan2(eVecY, eVecX);

  const semiMajorAxis =
    keplerEnergy < 0 ? -(G * M) / (2 * keplerEnergy) : Infinity;

  const period = Number.isFinite(semiMajorAxis)
    ? 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / (G * M))
    : Infinity;

  // Escape velocity from the softened potential at the current separation —
  // ½v² ≥ G·M/√(r²+ε²) is exactly the ε ≥ 0 (unbound) condition above.
  const escapeVelocity = Math.sqrt((2 * G * M) / rSoft);

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
    argumentOfPeriapsis,
    bound: specificEnergy < 0,
  };
}

// For setup-time UI feedback: the relative velocity that produces a perfect
// circular orbit at the given separation, given both masses. Useful as the
// "if you set this, you win" target. Under softened gravity the centripetal
// balance is v²/r = G·M·r/(r²+ε²)^{3/2}; with ε = 0 this reduces to the
// familiar √(G·M/r).
export function circularRelativeVelocity(
  m1: number,
  m2: number,
  separation: number,
  G: number,
  softening: number = 0,
): number {
  const rSq = separation * separation;
  const denom = Math.pow(rSq + softening * softening, 1.5);
  return Math.sqrt((G * (m1 + m2) * rSq) / denom);
}
