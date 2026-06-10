import Foundation

/// All physics constants. Pixel units for position, seconds for time,
/// arbitrary mass (1–5 in the UI). Verbatim from src/physics/Simulation.ts —
/// these are game-feel-tuned, not SI; do not "correct" them.
public enum PHYSICS {
  public static let G: Double = 1.5e7
  public static let SOFTENING: Double = 6
  public static let DT: Double = 1.0 / 240.0
  public static let SUBSTEPS_PER_FRAME = 4  // 4 × 1/240 = 1/60 s per UI frame
  public static let WARMUP_SECONDS: Double = 0.6
}

// Defence-in-depth bounds enforced at the boundary into the physics layer —
// ~10–30× wider than the UI's LIMITS, so they only catch a bypass. Any
// non-finite input is replaced by the default BEFORE clamping.
private enum SafeInput {
  static let minMass = 0.01
  static let maxMass = 1e3
  static let defaultMass = 2.5
  static let maxSpeedComponent = 1e4
  static let defaultVelComponent = 0.0
  static let maxPosMagnitude = 1e5
  static let defaultPosComponent = 0.0
}

private func finite(_ x: Double, _ fallback: Double) -> Double {
  x.isFinite ? x : fallback
}

private func clampIn(_ x: Double, _ lo: Double, _ hi: Double) -> Double {
  min(max(x, lo), hi)
}

private func sanitizeMass(_ m: Double) -> Double {
  clampIn(finite(m, SafeInput.defaultMass), SafeInput.minMass, SafeInput.maxMass)
}

private func sanitizePos(_ p: Double) -> Double {
  clampIn(finite(p, SafeInput.defaultPosComponent), -SafeInput.maxPosMagnitude, SafeInput.maxPosMagnitude)
}

private func sanitizeVel(_ v: Double) -> Double {
  clampIn(finite(v, SafeInput.defaultVelComponent), -SafeInput.maxSpeedComponent, SafeInput.maxSpeedComponent)
}

/// Physics facade: owns the two bodies and the clock. Mirrors
/// src/physics/Simulation.ts.
public final class Simulation {
  public let a: Body
  public let b: Body
  public private(set) var time: Double
  public let initialSeparation: Double
  public let initialEnergy: Double

  public init(a: Body, b: Body) {
    self.a = a
    self.b = b
    self.time = 0
    // Prime acceleration so the integrator's first kick has a meaningful a(0).
    applyGravity(a, b, G: PHYSICS.G, softening: PHYSICS.SOFTENING)
    self.initialSeparation = (b.pos - a.pos).mag
    self.initialEnergy = computeOrbit(a, b, G: PHYSICS.G, softening: PHYSICS.SOFTENING).totalEnergy
  }

  /// Single fixed-dt sub-step (4 force evaluations — see Integrator.swift).
  public func step(dt: Double = PHYSICS.DT) {
    pefrlStep(a, b, dt: dt, G: PHYSICS.G, softening: PHYSICS.SOFTENING)
    time += dt
  }

  /// Advance one display frame (= SUBSTEPS_PER_FRAME physics sub-steps).
  public func advanceFrame() {
    for _ in 0..<PHYSICS.SUBSTEPS_PER_FRAME { step() }
  }

  public func orbit() -> OrbitState {
    computeOrbit(a, b, G: PHYSICS.G, softening: PHYSICS.SOFTENING)
  }

  /// Convenience constructor from raw numbers — inputs are sanitized at this
  /// boundary against non-finite values and absurd magnitudes.
  public static func create(
    m1: Double, pos1: Vec2, vel1: Vec2,
    m2: Double, pos2: Vec2, vel2: Vec2
  ) -> Simulation {
    let a = Body(
      mass: sanitizeMass(m1),
      pos: Vec2(sanitizePos(pos1.x), sanitizePos(pos1.y)),
      vel: Vec2(sanitizeVel(vel1.x), sanitizeVel(vel1.y))
    )
    let b = Body(
      mass: sanitizeMass(m2),
      pos: Vec2(sanitizePos(pos2.x), sanitizePos(pos2.y)),
      vel: Vec2(sanitizeVel(vel2.x), sanitizeVel(vel2.y))
    )
    return Simulation(a: a, b: b)
  }
}
