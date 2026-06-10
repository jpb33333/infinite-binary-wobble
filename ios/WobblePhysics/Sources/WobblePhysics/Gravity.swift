import Foundation

// Plummer-softened Newtonian gravity (Aarseth 1963). Writes accelerations
// directly to body.accel (overwrite, not accumulate — exactly two bodies).
// Mirrors src/physics/gravity.ts:
//
//   a⃗_a =  G · m_b · (b − a) / (r² + ε²)^(3/2)
//   a⃗_b = −G · m_a · (b − a) / (r² + ε²)^(3/2)
public func applyGravity(_ a: Body, _ b: Body, G: Double, softening: Double) {
  let dx = b.pos.x - a.pos.x
  let dy = b.pos.y - a.pos.y
  let rSq = dx * dx + dy * dy
  let denom = pow(rSq + softening * softening, 1.5)
  let k1 = (G * b.mass) / denom
  let k2 = (G * a.mass) / denom
  a.accel.x = k1 * dx
  a.accel.y = k1 * dy
  b.accel.x = -k2 * dx
  b.accel.y = -k2 * dy
}
