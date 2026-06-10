import XCTest
@testable import WobblePhysics

// Step-for-step parity with the TypeScript original. The fixtures were
// exported from the web game (scripts/export-golden-fixtures.mjs, PR #21)
// exactly for this port: seed the same setup, run the same number of fixed
// steps, and the sampled positions/velocities must agree to floating-point
// noise. Catches ANY divergence — coefficient typos, drift/kick ordering,
// softening mistakes — in one assertion per sample.
//
// Note: the fixtures' per-sample `specificEnergy`/`eccentricity` fields were
// generated before the softened-Hamiltonian diagnostics fix and use the pure
// Keplerian potential. Positions and velocities are integrator output and
// are unaffected; this test compares those (the parity that matters) and
// reproduces the energy fields with an unsoftened computeOrbit call.

private struct Fixture: Decodable {
  struct Constants: Decodable { let G: Double; let SOFTENING: Double; let DT: Double }
  struct InitBody: Decodable { let mass: Double; let pos: [Double]; let vel: [Double] }
  struct InitBodies: Decodable { let a: InitBody; let b: InitBody }
  struct Sample: Decodable {
    let step: Int
    let aPos: [Double]
    let bPos: [Double]
    let aVel: [Double]
    let bVel: [Double]
    let separation: Double
    let specificEnergy: Double
  }
  let scenario: String
  let dt: Double
  let steps: Int
  let sampleEvery: Int
  let constants: Constants
  let initialBodies: InitBodies
  let firstCollisionStep: Int?
  let samples: [Sample]
}

final class GoldenTrajectoryTests: XCTestCase {
  // Positions are O(100) px; agreement to 1e-6 px after thousands of steps
  // means the arithmetic is identical, not merely similar.
  private let tolerance = 1e-6

  private func load(_ name: String) throws -> Fixture {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
      "fixture \(name).json missing from test bundle"
    )
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  private func assertParity(_ name: String) throws {
    let fx = try load(name)
    XCTAssertEqual(fx.constants.G, PHYSICS.G)
    XCTAssertEqual(fx.constants.SOFTENING, PHYSICS.SOFTENING)
    XCTAssertEqual(fx.constants.DT, PHYSICS.DT, accuracy: 1e-15)

    let sim = Simulation.create(
      m1: fx.initialBodies.a.mass,
      pos1: Vec2(fx.initialBodies.a.pos[0], fx.initialBodies.a.pos[1]),
      vel1: Vec2(fx.initialBodies.a.vel[0], fx.initialBodies.a.vel[1]),
      m2: fx.initialBodies.b.mass,
      pos2: Vec2(fx.initialBodies.b.pos[0], fx.initialBodies.b.pos[1]),
      vel2: Vec2(fx.initialBodies.b.vel[0], fx.initialBodies.b.vel[1])
    )

    var samples = fx.samples.makeIterator()
    var expected = samples.next()
    for step in 0...fx.steps {
      if let s = expected, s.step == step {
        XCTAssertEqual(sim.a.pos.x, s.aPos[0], accuracy: tolerance, "\(name) a.pos.x @\(step)")
        XCTAssertEqual(sim.a.pos.y, s.aPos[1], accuracy: tolerance, "\(name) a.pos.y @\(step)")
        XCTAssertEqual(sim.b.pos.x, s.bPos[0], accuracy: tolerance, "\(name) b.pos.x @\(step)")
        XCTAssertEqual(sim.b.pos.y, s.bPos[1], accuracy: tolerance, "\(name) b.pos.y @\(step)")
        XCTAssertEqual(sim.a.vel.x, s.aVel[0], accuracy: tolerance, "\(name) a.vel.x @\(step)")
        XCTAssertEqual(sim.a.vel.y, s.aVel[1], accuracy: tolerance, "\(name) a.vel.y @\(step)")
        XCTAssertEqual(sim.b.vel.x, s.bVel[0], accuracy: tolerance, "\(name) b.vel.x @\(step)")
        XCTAssertEqual(sim.b.vel.y, s.bVel[1], accuracy: tolerance, "\(name) b.vel.y @\(step)")
        // The fixture's energy field is the Keplerian (unsoftened) form.
        let kepler = computeOrbit(sim.a, sim.b, G: PHYSICS.G).specificEnergy
        XCTAssertEqual(kepler, s.specificEnergy, accuracy: max(1e-6, abs(s.specificEnergy) * 1e-9))
        expected = samples.next()
      }
      if step < fx.steps { sim.step() }
    }
    XCTAssertNil(expected, "\(name): unsampled fixture entries remain")
  }

  func testStableOrbitParity() throws { try assertParity("golden-stable_orbit") }
  func testCollisionParity() throws { try assertParity("golden-collision") }
  func testSlingshotEscapeParity() throws { try assertParity("golden-slingshot_escape") }
}
