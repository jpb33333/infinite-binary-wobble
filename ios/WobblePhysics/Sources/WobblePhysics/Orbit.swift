import Foundation

// Orbital diagnostics for the relative two-body orbit. Transliterated from
// src/physics/orbit.ts (including its softened-Hamiltonian fix):
//
//   • specificEnergy / totalEnergy / bound / escapeVelocity — the CONSERVED
//     quantities — use the softened potential −G·M/√(r²+ε²), matching what
//     the integrator actually conserves.
//   • eccentricity / semiMajorAxis / period / argumentOfPeriapsis — the
//     OSCULATING conic elements — stay pure-Keplerian local fits (the
//     e ≤ 0.93 WIN threshold was play-tuned against the Keplerian fit, and
//     the softened energy would inflate near-circular e to ~ε/r).
public struct OrbitState: Sendable {
  public let separation: Double
  public let vRel: Double
  public let specificEnergy: Double
  public let totalEnergy: Double
  public let specificAngularMomentum: Double
  public let eccentricity: Double
  public let semiMajorAxis: Double  // .infinity when ε_kepler ≥ 0
  public let period: Double         // .infinity when unbound
  public let escapeVelocity: Double
  public let bound: Bool            // softened ε < 0
  /// Direction (radians) from the barycenter focus to periapsis of the
  /// RELATIVE orbit — the conserved quantity that lets us draw the full
  /// predicted ellipse from a single state snapshot.
  public let argumentOfPeriapsis: Double
}

public func computeOrbit(_ a: Body, _ b: Body, G: Double, softening: Double = 0) -> OrbitState {
  let r = b.pos - a.pos
  let v = b.vel - a.vel
  let separation = r.mag
  let vRelSq = v.magSq
  let vRel = vRelSq.squareRoot()

  let M = a.mass + b.mass
  let muReduced = (a.mass * b.mass) / M

  // Softened radius: matches the potential whose gradient applyGravity applies.
  let rSoft = (separation * separation + softening * softening).squareRoot()
  let specificEnergy = 0.5 * vRelSq - (G * M) / rSoft
  // Keplerian osculating energy — input to the conic-element fits below only.
  let keplerEnergy = 0.5 * vRelSq - (G * M) / separation
  let totalEnergy = muReduced * specificEnergy

  let hZ = r.crossZ(v)
  let specificAngularMomentum = abs(hZ)

  // e² = 1 + 2·ε_kepler·h² / (G·M)²
  let inside = 1 + (2 * keplerEnergy * specificAngularMomentum * specificAngularMomentum)
    / ((G * M) * (G * M))
  let eccentricity = inside > 0 ? inside.squareRoot() : 0

  // Eccentricity vector, 2D specialisation: e_vec = (v × h)/μ − r̂.
  let muG = G * M
  let eVecX = (v.y * hZ) / muG - r.x / separation
  let eVecY = (-v.x * hZ) / muG - r.y / separation
  let argumentOfPeriapsis = atan2(eVecY, eVecX)

  let semiMajorAxis = keplerEnergy < 0 ? -(G * M) / (2 * keplerEnergy) : Double.infinity

  let period = semiMajorAxis.isFinite
    ? 2 * Double.pi * ((semiMajorAxis * semiMajorAxis * semiMajorAxis) / (G * M)).squareRoot()
    : Double.infinity

  let escapeVelocity = ((2 * G * M) / rSoft).squareRoot()

  return OrbitState(
    separation: separation,
    vRel: vRel,
    specificEnergy: specificEnergy,
    totalEnergy: totalEnergy,
    specificAngularMomentum: specificAngularMomentum,
    eccentricity: eccentricity,
    semiMajorAxis: semiMajorAxis,
    period: period,
    escapeVelocity: escapeVelocity,
    bound: specificEnergy < 0,
    argumentOfPeriapsis: argumentOfPeriapsis
  )
}

/// The relative velocity producing a perfect circular orbit at the given
/// separation under softened gravity: v²/r = G·M·r/(r²+ε²)^{3/2}.
/// With ε = 0 this reduces to the familiar √(G·M/r).
public func circularRelativeVelocity(
  m1: Double, m2: Double, separation: Double, G: Double, softening: Double = 0
) -> Double {
  let rSq = separation * separation
  let denom = pow(rSq + softening * softening, 1.5)
  return ((G * (m1 + m2) * rSq) / denom).squareRoot()
}
