import Foundation

/// Visual/collision radius scale — `bodyRadius = 14·√mass` (area ∝ mass).
/// Mirrors src/physics/Body.ts.
public let RADIUS_BASE: Double = 14

public func bodyRadius(_ mass: Double) -> Double {
  RADIUS_BASE * mass.squareRoot()
}

/// One gravitating body. A reference type on purpose: the PEFRL integrator
/// mutates pos/vel/accel in place with no per-step allocation, exactly like
/// the TS original mutates its `{ x, y }` records.
public final class Body {
  public var mass: Double
  public var pos: Vec2
  public var vel: Vec2
  /// Maintained by `applyGravity` so the integrator can read it without
  /// recomputing mid-step. Primed by the Simulation at construction.
  public var accel: Vec2

  public init(mass: Double, pos: Vec2, vel: Vec2) {
    self.mass = mass
    self.pos = pos
    self.vel = vel
    self.accel = Vec2(0, 0)
  }
}
