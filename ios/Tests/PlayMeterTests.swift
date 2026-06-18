import XCTest

@testable import InfiniteBinaryWobble

// The play meter gates revenue AND must never lock out a paying player, so its
// logic is tested directly. Each test runs against an isolated UserDefaults
// suite (no shared global state, no leakage between tests or onto the device).
final class PlayMeterTests: XCTestCase {
  private var suiteName = ""
  private var store: UserDefaults!

  override func setUp() {
    super.setUp()
    suiteName = "test.playmeter.\(UUID().uuidString)"
    store = UserDefaults(suiteName: suiteName)
    store.removePersistentDomain(forName: suiteName)
  }

  override func tearDown() {
    store.removePersistentDomain(forName: suiteName)
    store = nil
    super.tearDown()
  }

  func testStartsUngatedWithAllFreePlays() {
    let m = PlayMeter(store: store)
    XCTAssertFalse(m.shouldGate())
    XCTAssertEqual(m.playCount, 0)
    XCTAssertEqual(m.remaining, PlayMeter.freePlayLimit)
    XCTAssertFalse(m.entitled)
  }

  func testGatesExactlyAtTheLimitNotBefore() {
    let m = PlayMeter(store: store)
    for _ in 0 ..< (PlayMeter.freePlayLimit - 1) { m.consumePlay() }
    XCTAssertFalse(m.shouldGate(), "199 plays must still be free")
    XCTAssertEqual(m.remaining, 1)
    m.consumePlay() // the 200th
    XCTAssertTrue(m.shouldGate(), "the wall is at exactly the limit")
    XCTAssertEqual(m.remaining, 0)
  }

  func testEntitlementUnlocksAndStopsCounting() {
    let m = PlayMeter(store: store)
    for _ in 0 ..< PlayMeter.freePlayLimit { m.consumePlay() }
    XCTAssertTrue(m.shouldGate())

    m.setEntitled(true)
    XCTAssertFalse(m.shouldGate(), "a purchase clears the gate")
    XCTAssertNil(m.remaining, "entitled means unlimited")

    let before = m.playCount
    m.consumePlay()
    XCTAssertEqual(m.playCount, before, "entitled players don't tick the counter")
  }

  func testPlayCountSurvivesRelaunch() {
    let first = PlayMeter(store: store)
    for _ in 0 ..< 5 { first.consumePlay() }
    let afterRelaunch = PlayMeter(store: store) // a fresh instance = a new app run
    XCTAssertEqual(afterRelaunch.playCount, 5)
  }

  func testEntitlementSurvivesRelaunch() {
    PlayMeter(store: store).setEntitled(true)
    XCTAssertTrue(PlayMeter(store: store).entitled, "the unlock must persist across runs")
  }

  func testFreshStoreFailsOpen() {
    // No keys written: the meter must read as wide open, never as locked.
    let m = PlayMeter(store: store)
    XCTAssertFalse(m.shouldGate())
  }
}
