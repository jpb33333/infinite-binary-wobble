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
    // iOS 26: KIF-derived synthesized touches dispatch cleanly (sendEvent
    // accepts them, taps return ok) but the SwiftUI gesture environment never
    // surfaces them to DragGesture — verified live 2026-06-10 with both the
    // template's same-turn tap and a phase-separated ~60Hz drag rewrite.
    // Rather than chase private UITouch internals on a brand-new iOS major,
    // route tap/swipe straight into GameModel's input surface — the same
    // three methods ContentView.dragGesture calls, through the same
    // fit.toDesign conversion. Deterministic and iOS-version-proof; the
    // velocity control reads drag DISTANCE (not speed), so synthetic timing
    // is irrelevant. Screenshot + elements stay on the UIKit bridges.
    MutationBridge.resolver = { [weak model] op, payload in
      guard let model else { return false }
      func designPoint(_ xKey: String, _ yKey: String) -> CGPoint? {
        guard let x = payload[xKey] as? NSNumber, let y = payload[yKey] as? NSNumber else { return nil }
        return model.fit.toDesign(CGPoint(x: x.doubleValue, y: y.doubleValue))
      }
      switch op {
      case "tap":
        guard let p = designPoint("x", "y") else { return false }
        model.touchBegan(at: p)
        model.touchEnded()
        return true
      case "swipe":
        guard let from = designPoint("from_x", "from_y"),
              let to = designPoint("to_x", "to_y") else { return false }
        model.touchBegan(at: from)
        model.touchMoved(to: CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2))
        model.touchMoved(to: to)
        model.touchEnded()
        return true
      default:
        return false  // 'type': this app has no text inputs
      }
    }
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
