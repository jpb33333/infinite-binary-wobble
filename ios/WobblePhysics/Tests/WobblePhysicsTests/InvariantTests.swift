import XCTest
@testable import WobblePhysics

// XCTest port of the web game's Vitest physics invariants
// (tests/physics.{energy,momentum,escape,softening}.test.ts). Same setups,
// same tolerances — these are the proof the Swift physics matches the
// TypeScript original.

final class EnergyTests: XCTestCase {
  private func circularSim(m: Double = 2, r: Double = 400) -> Simulation {
    let vRelCirc = circularRelativeVelocity(m1: m, m2: m, separation: r, G: PHYSICS.G)
    let v = vRelCirc / 2
    return Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -v)
    )
  }

  func testCircularOrbitEnergyDriftUnder1e5Over5000Steps() {
    let sim = circularSim()
    let e0 = sim.initialEnergy
    for _ in 0..<5000 { sim.step() }
    let drift = abs((sim.orbit().totalEnergy - e0) / e0)
    XCTAssertLessThan(drift, 1e-5)
  }

  func testEllipticalOrbitEnergyBoundedUnder1Percent() {
    let m = 2.0, r = 400.0
    let v = (circularRelativeVelocity(m1: m, m2: m, separation: r, G: PHYSICS.G) / 2) * 0.7
    let sim = Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -v)
    )
    let e0 = sim.initialEnergy
    for _ in 0..<5000 { sim.step() }
    XCTAssertLessThan(abs((sim.orbit().totalEnergy - e0) / e0), 0.01)
  }

  func testSymplecticLongRunNoSecularDrift() {
    let sim = circularSim()
    let e0 = sim.initialEnergy
    var maxDrift = 0.0
    for _ in 0..<50_000 {
      sim.step()
      maxDrift = max(maxDrift, abs((sim.orbit().totalEnergy - e0) / e0))
    }
    XCTAssertLessThan(maxDrift, 1e-5)
  }
}

final class MomentumTests: XCTestCase {
  func testMomentumConservedWithAsymmetricMasses() {
    let sim = Simulation.create(
      m1: 1.2, pos1: Vec2(-180, 20), vel1: Vec2(40, 120),
      m2: 4.4, pos2: Vec2(240, -10), vel2: Vec2(-30, -60)
    )
    let p0x = sim.a.mass * sim.a.vel.x + sim.b.mass * sim.b.vel.x
    let p0y = sim.a.mass * sim.a.vel.y + sim.b.mass * sim.b.vel.y
    let scale = max((p0x * p0x + p0y * p0y).squareRoot(), 1)
    for _ in 0..<4000 { sim.step() }
    let px = sim.a.mass * sim.a.vel.x + sim.b.mass * sim.b.vel.x
    let py = sim.a.mass * sim.a.vel.y + sim.b.mass * sim.b.vel.y
    XCTAssertLessThan(abs(px - p0x) / scale, 1e-9)
    XCTAssertLessThan(abs(py - p0y) / scale, 1e-9)
  }
}

final class EscapeTests: XCTestCase {
  func testSuperEscapeIsUnboundAndSeparates() {
    let m = 2.0, r = 400.0
    let sim = Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +300),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -300)
    )
    let o0 = sim.orbit()
    XCTAssertGreaterThan(o0.specificEnergy, 0)
    XCTAssertFalse(o0.bound)
    for _ in 0..<2000 { sim.step() }
    XCTAssertGreaterThan(sim.orbit().separation, r)
  }

  func testSubEscapeIsBoundWithFiniteElements() {
    let m = 2.0, r = 400.0
    let v = (circularRelativeVelocity(m1: m, m2: m, separation: r, G: PHYSICS.G) / 2) * 0.8
    let sim = Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -v)
    )
    let o = sim.orbit()
    XCTAssertLessThan(o.specificEnergy, 0)
    XCTAssertTrue(o.bound)
    XCTAssertTrue(o.semiMajorAxis.isFinite)
    XCTAssertTrue(o.period.isFinite)
  }

  func testCircularSetupHasNearZeroEccentricity() {
    let m = 2.0, r = 400.0
    let v = circularRelativeVelocity(m1: m, m2: m, separation: r, G: PHYSICS.G) / 2
    let sim = Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -v)
    )
    let o = sim.orbit()
    XCTAssertLessThan(o.eccentricity, 0.01)
    XCTAssertTrue(o.bound)
  }
}

final class SofteningTests: XCTestCase {
  func testSoftenedEnergyIsTheConservedQuantityOnCloseApproach() {
    let m = 2.0, r = 300.0
    let v = (circularRelativeVelocity(m1: m, m2: m, separation: r, G: PHYSICS.G) / 2) * 0.45
    let sim = Simulation.create(
      m1: m, pos1: Vec2(-r / 2, 0), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(+r / 2, 0), vel2: Vec2(0, -v)
    )
    var softMin = Double.infinity, softMax = -Double.infinity
    var kepMin = Double.infinity, kepMax = -Double.infinity
    for _ in 0..<4000 {
      sim.step()
      let soft = computeOrbit(sim.a, sim.b, G: PHYSICS.G, softening: PHYSICS.SOFTENING).specificEnergy
      let kep = computeOrbit(sim.a, sim.b, G: PHYSICS.G).specificEnergy
      softMin = min(softMin, soft); softMax = max(softMax, soft)
      kepMin = min(kepMin, kep); kepMax = max(kepMax, kep)
    }
    let softSwing = (softMax - softMin) / abs(softMin)
    let kepSwing = (kepMax - kepMin) / abs(kepMin)
    XCTAssertLessThan(softSwing, kepSwing / 10)
    XCTAssertLessThan(softSwing, 1e-3)
  }
}

final class OutcomeTests: XCTestCase {
  private let cx = 640.0, cy = 400.0

  private func run(_ sim: Simulation, _ cls: OutcomeClassifier, maxSteps: Int) -> Outcome {
    var outcome = cls.update(sim, dt: 0)
    var i = 0
    while i < maxSteps && outcome == .playing {
      sim.step()
      outcome = cls.update(sim, dt: PHYSICS.DT)
      i += 1
    }
    return outcome
  }

  func testCollision() {
    let sim = Simulation.create(
      m1: 3, pos1: Vec2(cx - 30, cy), vel1: Vec2(+200, 0),
      m2: 3, pos2: Vec2(cx + 30, cy), vel2: Vec2(-200, 0)
    )
    XCTAssertEqual(run(sim, OutcomeClassifier(), maxSteps: 600), .loseCollision)
  }

  func testEscape() {
    let sim = Simulation.create(
      m1: 2, pos1: Vec2(cx - 300, cy), vel1: Vec2(0, +400),
      m2: 2, pos2: Vec2(cx + 300, cy), vel2: Vec2(0, -400)
    )
    XCTAssertEqual(run(sim, OutcomeClassifier(), maxSteps: 3000), .loseEscape)
  }

  func testWinAfterTwoCircularOrbits() {
    let m = 2.0, r = 400.0
    let v = ((PHYSICS.G * (m + m)) / r).squareRoot() / 2
    let sim = Simulation.create(
      m1: m, pos1: Vec2(cx - r / 2, cy), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(cx + r / 2, cy), vel2: Vec2(0, -v)
    )
    let cls = OutcomeClassifier()
    XCTAssertEqual(run(sim, cls, maxSteps: Int((30 / PHYSICS.DT).rounded())), .win)
    XCTAssertGreaterThanOrEqual(cls.orbits, 2)
  }

  func testSlingshot() {
    let m = 2.0, r = 400.0
    let v = ((PHYSICS.G * (m + m)) / r).squareRoot() * 0.65
    let sim = Simulation.create(
      m1: m, pos1: Vec2(cx - r / 2, cy), vel1: Vec2(0, +v),
      m2: m, pos2: Vec2(cx + r / 2, cy), vel2: Vec2(0, -v)
    )
    let initial = sim.orbit()
    XCTAssertTrue(initial.bound)
    XCTAssertGreaterThan(initial.eccentricity, 0.3)
    XCTAssertEqual(run(sim, OutcomeClassifier(), maxSteps: Int((60 / PHYSICS.DT).rounded())), .loseSlingshot)
  }

  func testWarmupGatesEverythingExceptCollision() {
    let sim = Simulation.create(
      m1: 3, pos1: Vec2(cx - 100, cy), vel1: Vec2(+50, 0),
      m2: 3, pos2: Vec2(cx + 100, cy), vel2: Vec2(-50, 0)
    )
    var cfg = DEFAULT_OUTCOME_CONFIG
    cfg.warmupSeconds = 10
    let cls = OutcomeClassifier(cfg)
    sim.step()
    XCTAssertEqual(cls.update(sim, dt: PHYSICS.DT), .playing)
  }

  func testResetClearsState() {
    let sim = Simulation.create(
      m1: 3, pos1: Vec2(cx - 30, cy), vel1: Vec2(+200, 0),
      m2: 3, pos2: Vec2(cx + 30, cy), vel2: Vec2(-200, 0)
    )
    let cls = OutcomeClassifier()
    XCTAssertEqual(run(sim, cls, maxSteps: 600), .loseCollision)
    cls.reset()
    XCTAssertEqual(cls.orbits, 0)
    let fresh = Simulation.create(
      m1: 2, pos1: Vec2(cx - 200, cy), vel1: Vec2(0, +50),
      m2: 2, pos2: Vec2(cx + 200, cy), vel2: Vec2(0, -50)
    )
    XCTAssertEqual(cls.update(fresh, dt: 0), .playing)
  }
}
