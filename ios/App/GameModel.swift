import SwiftUI
import WobblePhysics

// The orchestrator — Swift port of src/game/Game.ts. Owns the state machine,
// the fixed-step physics accumulator, all input routing, the camera, effects
// and the session scoreboard. TimelineView(.animation) drives tick(now:);
// the Canvas paints from this state every frame.

enum GameState {
  case title, setupP1, setupP2, countdown, simulate, resolved
}

/// Every tappable thing the canvas draws. Draw + hit-test share one rect
/// registry (`buttons`) refreshed per frame, so they can never disagree.
enum ButtonID: Hashable {
  case begin, explainer, dismissExplainer, lockIn, massMinus, massPlus
  case exit, again, dismissWin
}

private let COUNTDOWN_SECONDS = 3.0
private let DT_CAP = 1.0 / 30.0  // a stutter never feeds physics more than this

// No @Published and no @MainActor on purpose: TimelineView(.animation)
// re-evaluates the Canvas every display frame so SwiftUI invalidation isn't
// needed, and Canvas's renderer closure carries no actor annotation — the
// model is only ever touched from SwiftUI's main-thread rendering and
// gesture callbacks. ObservableObject is kept for @StateObject lifetime.
//
// Do NOT migrate this to @Observable: tick() mutates state from inside the
// Canvas render pass every frame, and @Observable's per-property tracking
// turns that into a main-thread invalidation storm (tried + reverted
// 2026-06-10 — it starved the run loop hard enough that the QA bridge's
// in-app HTTP server never serviced a request). The QA accessors
// (DebugBridgeBootstrap) read properties via plain closures and need no
// observation machinery.
final class GameModel: ObservableObject {

  private(set) var state: GameState = .title
  private(set) var layout: CourtLayout = LANDSCAPE_LAYOUT
  var specs: (p1: BodySpec, p2: BodySpec)
  private(set) var sim: Simulation?
  private(set) var classifier: OutcomeClassifier?
  private(set) var outcome: Outcome?
  let trails = (p1: Trail(), p2: Trail())
  private(set) var countdownRemaining = COUNTDOWN_SECONDS
  private(set) var elapsed: Double = 0
  private var lastTick: Double?
  private var simAccum: Double = 0
  private var recordedOnResolve = false
  private(set) var winCardDismissed = false
  private(set) var explainerOpen = false
  private(set) var supernova: (pos: CGPoint, t0: Double, mergedMass: Double)?
  let stats = SessionStats()
  private(set) var statsSummary = StatsSummary()

  // Atmosphere
  private(set) var starfield: [StarSpec] = []
  let ambientLayer = Particles(seed: 0xFEED)
  let burstLayer = Particles(seed: 0xFEED)
  private var viewSize: CGSize = .zero
  let reducedMotion = UIAccessibility.isReduceMotionEnabled

  // Input
  enum DragKind { case position, velocity }
  private var activeDrag: DragKind?
  /// True from the first gesture event until release — distinguishes "began"
  /// from "moved" regardless of how far the first event travelled.
  private(set) var touchActive = false
  var isDragging: Bool { activeDrag != nil }
  /// Refreshed by the draw pass; hit-tested in design space with a 44pt
  /// minimum touch target (inflation happens in hitButton).
  var buttons: [ButtonID: CGRect] = [:]
  private(set) var fit = Fit(view: CGSize(width: 1, height: 1), design: LANDSCAPE_LAYOUT.canvas)

  init() {
    specs = (defaultSpec(.p1, LANDSCAPE_LAYOUT), defaultSpec(.p2, LANDSCAPE_LAYOUT))
  }

  // ───────────────────────────────────────────────── layout / viewport

  func viewResized(to size: CGSize) {
    guard size.width > 0, size.height > 0, size != viewSize else { return }
    viewSize = size
    starfield = generateStarfield(count: starCount(for: size))
    let newLayout = layoutFor(size: size)
    let old = layout
    fitToView()
    guard newLayout.orientation != old.orientation else { return }
    layout = newLayout
    fitToView()
    // Orientation flipped mid-setup: drop any drag (its coordinates belong
    // to the old space) and carry each star to the same normalized spot in
    // its new in-bounds box. Velocity is unchanged — rotating the device
    // doesn't rotate the player's intent. Mid-sim needs no remap: bodies are
    // absolute and the camera re-centres the barycenter every frame.
    activeDrag = nil
    remap(&specs.p1, from: old, to: newLayout)
    remap(&specs.p2, from: old, to: newLayout)
  }

  private func fitToView() {
    fit = Fit(view: viewSize, design: layout.canvas)
  }

  private func remap(_ spec: inout BodySpec, from: CourtLayout, to: CourtLayout) {
    let a = from.inBounds(for: spec.player)
    let b = to.inBounds(for: spec.player)
    let nx = (spec.pos.x - a.minX) / a.width
    let ny = (spec.pos.y - a.minY) / a.height
    spec.pos = CGPoint(x: b.minX + nx * b.width, y: b.minY + ny * b.height)
  }

  // ───────────────────────────────────────────────── frame loop

  func tick(now: Double) {
    let dt = min(max(0, now - (lastTick ?? now)), DT_CAP)
    lastTick = now
    elapsed += dt

    switch state {
    case .countdown:
      countdownRemaining -= dt
      if countdownRemaining <= 0 { toSimulate() }
    case .simulate:
      guard let sim, let classifier else { break }
      advancePhysics(dt)
      trails.p1.push(sim.a.pos.x, sim.a.pos.y)
      trails.p2.push(sim.b.pos.x, sim.b.pos.y)
      let o = classifier.update(sim, dt: dt)
      if o != .playing { toResolved(o) }
    case .resolved:
      // A WIN never ends — the wobble keeps going and ORBITS keeps climbing.
      if let sim, outcome == .win {
        advancePhysics(dt)
        trails.p1.push(sim.a.pos.x, sim.a.pos.y)
        trails.p2.push(sim.b.pos.x, sim.b.pos.y)
        classifier?.update(sim, dt: dt)
      }
    default:
      break
    }

    if !reducedMotion { ambientLayer.ambient(size: viewSize, dt: dt) }
    burstLayer.update(dt: dt, size: layout.canvas)
  }

  /// Fixed-step accumulator: real dt in, PHYSICS.DT chunks out. Hard-capped
  /// at 0.25 s so backgrounding can't queue thousands of steps.
  private func advancePhysics(_ dt: Double) {
    guard let sim else { return }
    simAccum = min(simAccum + dt, 0.25)
    while simAccum >= PHYSICS.DT {
      sim.step()
      simAccum -= PHYSICS.DT
    }
  }

  /// Barycenter-follow camera: only in simulate/resolved with a live sim.
  var cameraOffset: CGPoint? {
    guard let sim, state == .simulate || state == .resolved else { return nil }
    let M = sim.a.mass + sim.b.mass
    guard M.isFinite, M > 0 else { return nil }
    let bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M
    let by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M
    return CGPoint(x: layout.canvas.width / 2 - bx, y: layout.canvas.height / 2 - by)
  }

  // ───────────────────────────────────────────────── transitions

  private func resetRound() {
    trails.p1.reset()
    trails.p2.reset()
    sim = nil
    classifier = nil
    outcome = nil
    recordedOnResolve = false
    simAccum = 0
    supernova = nil
    countdownRemaining = COUNTDOWN_SECONDS
    winCardDismissed = false
    explainerOpen = false
    activeDrag = nil
  }

  func toTitle() {
    specs = (defaultSpec(.p1, layout), defaultSpec(.p2, layout))
    resetRound()
    state = .title
  }

  func toSetup1() {
    specs = (defaultSpec(.p1, layout), defaultSpec(.p2, layout))
    resetRound()
    state = .setupP1
  }

  private func toSetup2() {
    activeDrag = nil
    Haptics.lockIn()
    state = .setupP2
  }

  private func toCountdown() {
    activeDrag = nil
    Haptics.lockIn()
    countdownRemaining = COUNTDOWN_SECONDS
    state = .countdown
  }

  private func toSimulate() {
    let p1 = specs.p1, p2 = specs.p2
    sim = Simulation.create(
      m1: p1.mass, pos1: Vec2(p1.pos.x, p1.pos.y), vel1: Vec2(p1.vel.dx, p1.vel.dy),
      m2: p2.mass, pos2: Vec2(p2.pos.x, p2.pos.y), vel2: Vec2(p2.vel.dx, p2.vel.dy)
    )
    classifier = OutcomeClassifier(DEFAULT_OUTCOME_CONFIG)
    trails.p1.reset()
    trails.p2.reset()
    outcome = nil
    recordedOnResolve = false
    simAccum = 0
    supernova = nil
    winCardDismissed = false
    state = .simulate
  }

  private func toResolved(_ o: Outcome) {
    outcome = o
    state = .resolved
    guard !recordedOnResolve, let sim, let classifier, o != .playing else { return }
    recordedOnResolve = true
    let orbit = sim.orbit()
    stats.record(GameRecord(
      outcome: o, duration: sim.time,
      eccentricity: orbit.eccentricity, orbits: classifier.orbits
    ))
    statsSummary = stats.summary
    switch o {
    case .loseCollision:
      let mid = CGPoint(x: (sim.a.pos.x + sim.b.pos.x) / 2, y: (sim.a.pos.y + sim.b.pos.y) / 2)
      supernova = (mid, elapsed, sim.a.mass + sim.b.mass)
      burstLayer.burst(at: mid, count: 240, color: Palette.cream, speed: 360)
      Haptics.collision()
    case .win:
      burstLayer.burst(at: CGPoint(x: sim.a.pos.x, y: sim.a.pos.y), count: 24, color: Palette.player1)
      burstLayer.burst(at: CGPoint(x: sim.b.pos.x, y: sim.b.pos.y), count: 24, color: Palette.player2)
      Haptics.win()
    default:
      break
    }
  }

  private var activeSpec: BodySpec? {
    get {
      if state == .setupP1 { return specs.p1 }
      if state == .setupP2 { return specs.p2 }
      return nil
    }
  }

  private func mutateActiveSpec(_ body: (inout BodySpec) -> Void) {
    if state == .setupP1 { body(&specs.p1) } else if state == .setupP2 { body(&specs.p2) }
  }

  // ───────────────────────────────────────────────── input (design space)

  /// 44pt Apple-HIG minimum touch target, inflated in design units so small
  /// contain-fit scales stay tappable. Insertion isn't ordered in a Dict, so
  /// prefer the SMALLEST hit rect that contains the point (the close ✕ wins
  /// over the card behind it).
  func hitButton(at p: CGPoint) -> ButtonID? {
    let minSide = 44 / fit.scale
    var best: (ButtonID, CGFloat)? = nil
    for (id, r) in buttons {
      let padX = max(0, (minSide - r.width) / 2)
      let padY = max(0, (minSide - r.height) / 2)
      if r.insetBy(dx: -padX, dy: -padY).contains(p) {
        let area = r.width * r.height
        if best == nil || area < best!.1 { best = (id, area) }
      }
    }
    return best?.0
  }

  /// Gesture began (the web game's pointerdown — buttons fire here, drags
  /// start here). `p` is already in design space.
  func touchBegan(at p: CGPoint) {
    touchActive = true
    if let btn = hitButton(at: p) {
      handleButton(btn)
      return
    }

    // Setup-phase dragging. Player mental model (locked by /qa 2026-06-01):
    // drag OUTWARD FROM the star to throw it; touch anywhere else in your
    // court to reposition.
    guard state == .setupP1 || state == .setupP2, let spec = activeSpec else { return }
    let r = bodyRadius(spec.mass)
    let dx = p.x - spec.pos.x, dy = p.y - spec.pos.y
    if dx * dx + dy * dy <= r * r {
      activeDrag = .velocity
      dragVelocity(to: p)
    } else if layout.region(for: spec.player).contains(p) {
      activeDrag = .position
      mutateActiveSpec { $0.pos = clampToInBounds(p, layout, $0.player) }
    }
  }

  func touchMoved(to p: CGPoint) {
    guard state == .setupP1 || state == .setupP2 else { return }
    switch activeDrag {
    case .position:
      mutateActiveSpec { $0.pos = clampToInBounds(p, layout, $0.player) }
    case .velocity:
      dragVelocity(to: p)
    case nil:
      break
    }
  }

  func touchEnded() {
    touchActive = false
    activeDrag = nil
  }

  /// Port of ArrowControl: 1 px of drag = 1 px/s, magnitude capped at 300,
  /// direction preserved.
  private func dragVelocity(to p: CGPoint) {
    mutateActiveSpec { spec in
      let dx = p.x - spec.pos.x, dy = p.y - spec.pos.y
      let mag = (dx * dx + dy * dy).squareRoot()
      guard mag > 0 else { spec.vel = .zero; return }
      let clamped = min(mag, Limits.maxVelocityPerBody)
      spec.vel = CGVector(dx: dx / mag * clamped, dy: dy / mag * clamped)
    }
  }

  /// Port of MassControl.applyWheel: one ± tap = one wheel notch = 0.18.
  func stepMass(_ direction: Double) {
    mutateActiveSpec { spec in
      spec.mass = min(max(spec.mass + 0.18 * direction, Limits.minMass), Limits.maxMass)
    }
  }

  var canLockIn: Bool {
    guard let s = activeSpec else { return false }
    return (s.vel.dx * s.vel.dx + s.vel.dy * s.vel.dy).squareRoot() >= 1
  }

  private func handleButton(_ btn: ButtonID) {
    switch btn {
    case .explainer where state == .title && !explainerOpen:
      explainerOpen = true
    case .dismissExplainer where state == .title && explainerOpen:
      explainerOpen = false
    case .begin where state == .title:
      toSetup1()
    case .exit where state != .title:
      toTitle()
    case .dismissWin where state == .resolved && outcome == .win:
      winCardDismissed = true
    case .lockIn where state == .setupP1 || state == .setupP2:
      guard canLockIn else { return }
      if state == .setupP1 { toSetup2() } else { toCountdown() }
    case .again where state == .resolved:
      toSetup1()
    case .massMinus where state == .setupP1 || state == .setupP2:
      stepMass(-1)
    case .massPlus where state == .setupP1 || state == .setupP2:
      stepMass(+1)
    default:
      break
    }
  }
}
