import Foundation

// Plain 2D vector. A mutable struct (the integrator mutates body.pos/.vel
// in place through the Body reference type) — mirrors src/physics/Vec2.ts.
public struct Vec2: Equatable, Sendable {
  public var x: Double
  public var y: Double

  public init(_ x: Double, _ y: Double) {
    self.x = x
    self.y = y
  }

  public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
  public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
  public static func * (a: Vec2, k: Double) -> Vec2 { Vec2(a.x * k, a.y * k) }

  public var magSq: Double { x * x + y * y }
  public var mag: Double { (magSq).squareRoot() }

  public func dot(_ o: Vec2) -> Double { x * o.x + y * o.y }
  /// z-component of the 3D cross product (scalar in 2D).
  public func crossZ(_ o: Vec2) -> Double { x * o.y - y * o.x }
  public func distance(to o: Vec2) -> Double { (self - o).mag }
}
