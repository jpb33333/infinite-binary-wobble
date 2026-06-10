// ConstantsGuardTests.swift — the constants guard.
//
// Pins every play-tuned physics constant to its contractual value. If anyone
// edits a constant this fails LOUDLY and immediately — the first line of
// defence before the golden fixtures (which would also fail, but with a much
// noisier diff). Exact equality on purpose: these are contractual, not
// approximate.
//
// Harvested 2026-06-10 from the standalone iOS repo
// (jpb33333/infinite-binary-wobble-ios, Tests/PhysicsTests/) and adapted to
// the WobblePhysics API: `PHYSICS` enum, internal PEFRL coefficients (reached
// via @testable), and `OutcomeConfig()` defaults in place of the old
// DEFAULT_OUTCOME_CONFIG constant.

import XCTest
@testable import WobblePhysics

final class ConstantsGuardTests: XCTestCase {

  func testPhysicsConstantsExact() {
    XCTAssertEqual(PHYSICS.G, 1.5e7)
    XCTAssertEqual(PHYSICS.SOFTENING, 6)
    XCTAssertEqual(PHYSICS.DT, 1.0 / 240.0)
    XCTAssertEqual(PHYSICS.SUBSTEPS_PER_FRAME, 4)
    XCTAssertEqual(PHYSICS.WARMUP_SECONDS, 0.6)
  }

  func testPEFRLCoefficientsExact() {
    XCTAssertEqual(XI, 0.1786178958448091)
    XCTAssertEqual(LAMBDA, -0.2123418310626054)
    XCTAssertEqual(CHI, -0.06626458266981849)
  }

  func testRadiusBaseExact() {
    XCTAssertEqual(RADIUS_BASE, 14)
    // bodyRadius(m) = 14 · √m
    XCTAssertEqual(bodyRadius(4), 28)
    XCTAssertEqual(bodyRadius(1), 14)
  }

  func testOutcomeConfigDefaultsExact() {
    let c = OutcomeConfig()
    XCTAssertEqual(c.warmupSeconds, 0.6)
    XCTAssertEqual(c.winOrbitsRequired, 2)
    XCTAssertEqual(c.winMaxEccentricity, 0.93)
    XCTAssertEqual(c.offCanvasGraceSeconds, 0.6)
    XCTAssertEqual(c.maxBodyDistanceFromBarycenter, 820)
  }
}
