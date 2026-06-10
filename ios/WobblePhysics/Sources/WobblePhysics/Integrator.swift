import Foundation

// PEFRL — Position Extended Forest-Ruth-Like, 4th-order symplectic.
// [Omelyan, Mryglod & Folk 2002, Comput. Phys. Commun. 146, 188–202.]
//
// One step is the palindrome
//   D(ξ) K((1−2λ)/2) D(χ) K(λ) D(1−2(ξ+χ)) K(λ) D(χ) K((1−2λ)/2) D(ξ)
// — five drifts, four kicks, four force evaluations, time-symmetric.
// Constants and sequence are verbatim from src/physics/integrator.ts;
// the golden-trajectory tests pin step-for-step parity with the original.

let XI = 0.1786178958448091
let LAMBDA = -0.2123418310626054
let CHI = -0.06626458266981849

public func pefrlStep(_ a: Body, _ b: Body, dt: Double, G: Double, softening: Double) {
  let cD1 = XI * dt
  let cD2 = CHI * dt
  let cD3 = (1 - 2 * (XI + CHI)) * dt
  let cK1 = ((1 - 2 * LAMBDA) / 2) * dt
  let cK2 = LAMBDA * dt

  drift(a, b, cD1)
  applyGravity(a, b, G: G, softening: softening)
  kick(a, b, cK1)

  drift(a, b, cD2)
  applyGravity(a, b, G: G, softening: softening)
  kick(a, b, cK2)

  drift(a, b, cD3)
  applyGravity(a, b, G: G, softening: softening)
  kick(a, b, cK2)

  drift(a, b, cD2)
  applyGravity(a, b, G: G, softening: softening)
  kick(a, b, cK1)

  drift(a, b, cD1)
}

private func drift(_ a: Body, _ b: Body, _ dtScaled: Double) {
  a.pos.x += a.vel.x * dtScaled
  a.pos.y += a.vel.y * dtScaled
  b.pos.x += b.vel.x * dtScaled
  b.pos.y += b.vel.y * dtScaled
}

private func kick(_ a: Body, _ b: Body, _ dtScaled: Double) {
  a.vel.x += a.accel.x * dtScaled
  a.vel.y += a.accel.y * dtScaled
  b.vel.x += b.accel.x * dtScaled
  b.vel.y += b.accel.y * dtScaled
}
