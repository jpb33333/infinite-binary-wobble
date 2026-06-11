// Debug-only wiring for the gstack /ios-qa bridge (ios/DebugBridge). The whole
// file compiles away in Release.
//
// HAND-WRITTEN accessor registration instead of gen-accessors output, on
// purpose: the generator's regex only sees `@Snapshotable var x: Type` on an
// @Observable class, but (a) the @Observable macro rejects property wrappers
// outright (backing-storage collision, verified 2026-06-10), and (b) most of
// GameModel is `private(set)` / type-inferred, which the regex also skips.
// Closures registered here can additionally reach DERIVED state the generator
// never could (sim.minSeparation, classifier.orbits, the buttons registry).
// If /ios-sync ever regenerates accessors for this app, reconcile with this
// file rather than replacing it.
//
// The "buttons" key is the load-bearing one for QA: the game is a single
// SwiftUI Canvas, so the accessibility tree (/elements) is nearly empty. The
// canvas's own hit-rect registry (GameModel.buttons, design-space coords) plus
// the contain-fit transform (fitScale/fitOffsetX/fitOffsetY) is how an agent
// computes real tap points: window = design × fitScale + fitOffset.

#if DEBUG

import Foundation
import DebugBridgeCore
#if canImport(UIKit)
import DebugBridgeUI
#endif

@MainActor
enum DebugBridgeBootstrap {
  private static var installed = false

  /// Idempotent. Called from ContentView.onAppear — the earliest point where
  /// both the GameModel instance and a connected UIWindowScene exist (the
  /// overlay needs the scene; App.init is too early).
  static func installOnce(model: GameModel) {
    guard !installed else { return }
    installed = true

    #if canImport(UIKit)
    DebugBridgeUIWiring.installAll()
    #endif

    registerAccessors(model: model)
    StateServer.shared.start()

    #if canImport(UIKit)
    DebugOverlayWindow.shared.install(
      recording: ProcessInfo.processInfo.arguments.contains("--gstack-recording")
    )
    #endif
  }

  private static func registerAccessors(model: GameModel) {
    let info = Bundle.main.infoDictionary
    let version = (info?["CFBundleShortVersionString"] as? String) ?? "0"
    let build = (info?["CFBundleVersion"] as? String) ?? "0"

    StateServer.shared.register(
      buildId: "\(version)(\(build))",
      accessorHash: "ibw-accessors-v1",
      // Restore is deliberately unsupported: GameModel state is driven by the
      // physics loop, not a restorable struct. Report a validation failure
      // rather than a lying 200.
      atomicRestore: { _ in .missingKey("restore_unsupported") }
    )

    func read(_ key: String, _ type: String, _ handler: @escaping () -> Any?) {
      StateServer.shared.registerAccessor(key: key, type: type, read: handler, write: { _ in false })
    }
    // JSONSerialization rejects NaN/Infinity — gate every derived Double.
    func finite(_ v: Double?) -> Any? { v.flatMap { $0.isFinite ? $0 : nil } }

    read("state", "String") { String(describing: model.state) }
    read("elapsed", "Double") { model.elapsed }
    read("countdownRemaining", "Double") { model.countdownRemaining }
    read("winCardDismissed", "Bool") { model.winCardDismissed }
    read("explainerOpen", "Bool") { model.explainerOpen }
    read("canLockIn", "Bool") { model.canLockIn }
    read("outcome", "String?") { model.outcome.map { String(describing: $0) } }
    read("orbits", "Int?") { model.classifier?.orbits }
    read("simTime", "Double?") { finite(model.sim?.time) }
    read("minSeparation", "Double?") { finite(model.sim?.minSeparation) }
    read("separation", "Double?") { finite(model.sim.map { $0.orbit().separation }) }
    read("eccentricity", "Double?") { finite(model.sim.map { $0.orbit().eccentricity }) }
    read("p1Mass", "Double") { model.specs.p1.mass }
    read("p2Mass", "Double") { model.specs.p2.mass }
    read("orientation", "String") { String(describing: model.layout.orientation) }
    read("fitScale", "Double") { Double(model.fit.scale) }
    read("fitOffsetX", "Double") { Double(model.fit.offset.x) }
    read("fitOffsetY", "Double") { Double(model.fit.offset.y) }
    // Tappable rects in DESIGN coordinates: [name: [x, y, w, h]].
    read("buttons", "[String: [Double]]") {
      Dictionary(uniqueKeysWithValues: model.buttons.map { id, r in
        (String(describing: id), [Double(r.minX), Double(r.minY), Double(r.width), Double(r.height)])
      })
    }
  }
}

#endif // DEBUG
