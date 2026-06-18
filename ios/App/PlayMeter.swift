import Foundation

// Persistent play meter — the iOS analogue of the web Meter (src/net/meter.ts),
// but fully local: no server, no accounts, no network. A play is counted once
// per round at simulation start (mirrors web `consumePlay`); after
// `freePlayLimit` plays the game gates to the paywall until the one-time
// non-consumable unlock sets `entitled`. State lives in UserDefaults so the
// count survives an app relaunch — unlike the in-memory SessionStats summary,
// which is per-run by design.
//
// Fail-open, like the web meter: a fresh/unreadable store reads as 0 plays and
// not-entitled (never fabricates a lock), and an entitled player is never gated
// or counted. Entitlement's source of truth is StoreKit's currentEntitlements;
// StoreManager pushes it here (boot/purchase/restore), and this cache answers
// the gate instantly and offline so a flaky network can't wall a paid player.
final class PlayMeter {
  /// Free plays before the paywall. Matches the web FREE_PLAY_LIMIT (200).
  static let freePlayLimit = 200

  private enum Key {
    static let playCount = "ibw.meter.playCount.v1"
    static let entitled = "ibw.meter.entitled.v1"
  }

  private let store: UserDefaults

  /// Plays consumed so far. Persisted on every change.
  private(set) var playCount: Int {
    didSet { store.set(playCount, forKey: Key.playCount) }
  }

  /// Cached unlock entitlement. Persisted; only StoreManager flips it.
  private(set) var entitled: Bool {
    didSet { store.set(entitled, forKey: Key.entitled) }
  }

  init(store: UserDefaults = .standard) {
    self.store = store
    self.playCount = store.integer(forKey: Key.playCount) // 0 when unset
    self.entitled = store.bool(forKey: Key.entitled) // false when unset
  }

  /// Count one play. Called once per round at simulation start. Entitled
  /// players don't tick the counter — they never gate, so there's no point.
  func consumePlay() {
    guard !entitled else { return }
    playCount += 1
  }

  /// Gate the next round once the free plays are spent and unpurchased.
  func shouldGate() -> Bool { !entitled && playCount >= Self.freePlayLimit }

  /// Plays left before the wall (0 once gated), or nil when entitled (unlimited).
  var remaining: Int? { entitled ? nil : max(0, Self.freePlayLimit - playCount) }

  /// Pushed by StoreManager when entitlement is confirmed or revoked
  /// (purchase, restore, boot re-check, or refund). Idempotent.
  func setEntitled(_ value: Bool) { entitled = value }
}
