import XCTest

@testable import InfiniteBinaryWobble

// The gate WIRING: that the meter's verdict actually diverts the state machine
// to the paywall, and that a fresh meter plays normally. (PlayMeter's own
// counting/persistence logic is covered in PlayMeterTests.)
final class GameModelGateTests: XCTestCase {
  private func meter(plays: Int) -> PlayMeter {
    let suite = "test.gate.\(UUID().uuidString)"
    let store = UserDefaults(suiteName: suite)!
    store.removePersistentDomain(forName: suite)
    let m = PlayMeter(store: store)
    for _ in 0 ..< plays { m.consumePlay() }
    return m
  }

  func testFreshMeterEntersSetup() {
    let model = GameModel(meter: meter(plays: 0))
    model.toSetup1()
    XCTAssertEqual(model.state, .setupP1, "with free plays left, Begin/Again starts a round")
  }

  func testSpentMeterDivertsToPaywall() {
    let model = GameModel(meter: meter(plays: PlayMeter.freePlayLimit))
    model.toSetup1()
    XCTAssertEqual(model.state, .paywall, "out of free plays, the gate diverts to the paywall")
  }

  func testEntitledMeterPlaysPastTheLimit() {
    let spent = meter(plays: PlayMeter.freePlayLimit)
    spent.setEntitled(true)
    let model = GameModel(meter: spent)
    model.toSetup1()
    XCTAssertEqual(model.state, .setupP1, "a purchased player is never gated")
  }
}
