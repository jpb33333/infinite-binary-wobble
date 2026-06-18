import Foundation
import StoreKit

// StoreKit 2 wrapper for the single non-consumable "unlock unlimited play".
//
// Plain class on purpose, matching GameModel/GameRenderer's stance (no
// @MainActor on the type — the app runs on the main thread by convention). The
// async work methods ARE @MainActor, so every property the paywall render reads
// each frame and every PlayMeter mutation happens on the main actor; the awaits
// inside them suspend without blocking the run loop. The render reads `product`/
// `working`/`note` as a plain per-frame snapshot (TimelineView redraws anyway —
// no SwiftUI observation needed, same as the rest of the game).
//
// Entitlement's source of truth is Transaction.currentEntitlements. Fail-open
// everywhere: a transient StoreKit error never re-locks a paid player — only an
// explicit revocation (a refund, via Transaction.updates) clears the unlock.
final class StoreManager {
  /// Must match the product id in the App Store Connect listing AND the local
  /// Store/Unlock.storekit config used for testing.
  static let unlockProductID = "com.bowditch.infinitebinarywobble.unlock"

  private let meter: PlayMeter

  /// Loaded product (nil until the store responds). Read on main each frame.
  private(set) var product: Product?
  /// True while a purchase or restore is in flight (drives the button label).
  private(set) var working = false
  /// A short human note shown on the card when something fails.
  private(set) var note: String?

  /// Localized price for the UI, e.g. "$0.99" / "0,99 €". nil until loaded.
  var displayPrice: String? { product?.displayPrice }

  private var updates: Task<Void, Never>?

  init(meter: PlayMeter) {
    self.meter = meter
    // Listen for transactions that land outside an explicit buy() — Ask to Buy
    // approvals, refunds, restores on another device.
    updates = listenForTransactions()
    Task { await self.boot() }
  }

  deinit { updates?.cancel() }

  // ── actions (called from GameModel.handleButton, on the main thread) ──

  /// Buy the unlock. No-op if the product hasn't loaded or a call is in flight.
  func buy() { Task { await self.runPurchase() } }

  /// Restore a prior purchase. Apple requires this for non-consumables.
  func restore() { Task { await self.runRestore() } }

  // ── internals (all main-isolated) ──

  @MainActor private func boot() async {
    await loadProduct()
    await syncEntitlement()
  }

  @MainActor private func loadProduct() async {
    do {
      let products = try await Product.products(for: [Self.unlockProductID])
      product = products.first
    } catch {
      note = "Couldn’t reach the store."
    }
  }

  /// Re-derive entitlement from StoreKit and grant if owned. Fail-open: this
  /// only ever GRANTS — revocation is handled by the updates listener so a
  /// transient empty read can't wall a paid player.
  @MainActor private func syncEntitlement() async {
    for await result in Transaction.currentEntitlements {
      if case .verified(let t) = result,
        t.productID == Self.unlockProductID, t.revocationDate == nil {
        meter.setEntitled(true)
        return
      }
    }
  }

  @MainActor private func runPurchase() async {
    guard let product, !working else { return }
    working = true
    note = nil
    defer { working = false }
    do {
      switch try await product.purchase() {
      case .success(.verified(let t)):
        meter.setEntitled(true)
        await t.finish()
      case .success(.unverified):
        note = "Purchase couldn’t be verified."
      case .pending:
        note = "Purchase is pending approval."
      case .userCancelled:
        break
      @unknown default:
        break
      }
    } catch {
      note = "Purchase failed. Try again."
    }
  }

  @MainActor private func runRestore() async {
    guard !working else { return }
    working = true
    note = nil
    defer { working = false }
    // AppStore.sync() can throw on cancellation; fail-open and still re-check.
    try? await AppStore.sync()
    await syncEntitlement()
    if !meter.entitled { note = "No purchase to restore." }
  }

  private func listenForTransactions() -> Task<Void, Never> {
    Task.detached { [weak self] in
      for await update in Transaction.updates {
        guard let self else { continue }
        if case .verified(let t) = update {
          await self.apply(t)
        }
      }
    }
  }

  @MainActor private func apply(_ t: Transaction) async {
    if t.productID == Self.unlockProductID {
      meter.setEntitled(t.revocationDate == nil) // grant, or revoke on refund
    }
    await t.finish()
  }
}
