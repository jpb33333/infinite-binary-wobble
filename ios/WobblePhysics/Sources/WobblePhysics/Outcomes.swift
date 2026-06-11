import Foundation

/// What happened this frame. Mirrors src/game/outcomes.ts.
public enum Outcome: Equatable, Sendable {
  case playing
  case win
  case loseCollision
  case loseEscape
  case loseSlingshot
}

public struct OutcomeConfig: Sendable {
  /// Settle time before win/escape may fire (collision is never gated).
  public var warmupSeconds: Double
  public var winOrbitsRequired: Int
  public var winMaxEccentricity: Double
  public var offCanvasGraceSeconds: Double
  /// With the camera following the barycenter, "off-canvas" means each
  /// body's distance from the shared barycenter — not screen position.
  public var maxBodyDistanceFromBarycenter: Double

  public init(
    warmupSeconds: Double = 0.6,
    winOrbitsRequired: Int = 2,
    winMaxEccentricity: Double = 0.93,
    offCanvasGraceSeconds: Double = 0.6,
    maxBodyDistanceFromBarycenter: Double = 820
  ) {
    self.warmupSeconds = warmupSeconds
    self.winOrbitsRequired = winOrbitsRequired
    self.winMaxEccentricity = winMaxEccentricity
    self.offCanvasGraceSeconds = offCanvasGraceSeconds
    self.maxBodyDistanceFromBarycenter = maxBodyDistanceFromBarycenter
  }
}

public let DEFAULT_OUTCOME_CONFIG = OutcomeConfig()

/// Stateful classifier — one per simulation run, `update(sim:dt:)` every
/// frame. Tracks orbit count via the unwrapped relative angle (it keeps
/// counting after a WIN: the infinite wobble is the whole metaphor) and the
/// off-canvas grace timer. Order of checks is load-bearing:
/// collision (ungated) → warmup gate → barycenter distance → win.
public final class OutcomeClassifier {
  private let cfg: OutcomeConfig
  private var prevAngle: Double?
  private var unwrappedAngle: Double = 0
  private var offCanvasTime: Double = 0
  private var resolved: Outcome = .playing
  private var completedOrbits = 0

  public init(_ cfg: OutcomeConfig = DEFAULT_OUTCOME_CONFIG) {
    self.cfg = cfg
  }

  public var orbits: Int { completedOrbits }

  /// Prepare this classifier for a FRESH Simulation. The pairing contract is
  /// one classifier per simulation run: collision keys off sim.minSeparation,
  /// which is monotone since the SIM's construction — reusing a sim that has
  /// already grazed would re-resolve loseCollision instantly after reset.
  /// (GameModel constructs both together in toSimulate; keep it that way.)
  public func reset() {
    prevAngle = nil
    unwrappedAngle = 0
    offCanvasTime = 0
    resolved = .playing
    completedOrbits = 0
  }

  @discardableResult
  public func update(_ sim: Simulation, dt: Double) -> Outcome {
    // Track the relative-position angle every frame, even after resolution,
    // so the ORBITS readout keeps climbing through an infinite WIN.
    let r = sim.b.pos - sim.a.pos
    let angle = atan2(r.y, r.x)
    if let prev = prevAngle {
      var delta = angle - prev
      if delta > .pi { delta -= 2 * .pi } else if delta < -.pi { delta += 2 * .pi }
      unwrappedAngle += delta
    }
    prevAngle = angle
    completedOrbits = Int(abs(unwrappedAngle) / (2 * .pi))

    if resolved != .playing { return resolved }

    let orbit = sim.orbit()

    // Collision is always checked first and instantly resolves. Keys off the
    // SUBSTEP-resolution minimum separation (maintained by Simulation.step),
    // not the instantaneous separation: this classifier samples once per
    // rendered frame, and a fast grazing pass can overlap and pull apart
    // again entirely between two samples. Mirrors src/game/outcomes.ts.
    let rSum = bodyRadius(sim.a.mass) + bodyRadius(sim.b.mass)
    if sim.minSeparation < rSum {
      resolved = .loseCollision
      return resolved
    }

    if sim.time < cfg.warmupSeconds { return resolved }

    // Mass-weighted barycenter; the honest measure of "too far gone."
    let M = sim.a.mass + sim.b.mass
    let bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M
    let by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M
    let dA = ((sim.a.pos.x - bx) * (sim.a.pos.x - bx) + (sim.a.pos.y - by) * (sim.a.pos.y - by)).squareRoot()
    let dB = ((sim.b.pos.x - bx) * (sim.b.pos.x - bx) + (sim.b.pos.y - by) * (sim.b.pos.y - by)).squareRoot()
    let maxBodyDist = max(dA, dB)

    if maxBodyDist > cfg.maxBodyDistanceFromBarycenter {
      offCanvasTime += dt
      if offCanvasTime >= cfg.offCanvasGraceSeconds {
        resolved = orbit.bound ? .loseSlingshot : .loseEscape
        return resolved
      }
      return resolved
    }

    // Both bodies inside the envelope: reset the timer; check for win.
    offCanvasTime = 0

    if orbit.bound,
       orbit.eccentricity <= cfg.winMaxEccentricity,
       completedOrbits >= cfg.winOrbitsRequired {
      resolved = .win
      return resolved
    }

    return resolved
  }
}
