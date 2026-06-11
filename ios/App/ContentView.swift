import SwiftUI
import WobblePhysics

// The single screen. TimelineView(.animation) drives the loop at the
// display's refresh rate; Canvas repaints the whole scene from GameModel
// state each frame — the same immediate-mode model as the web Renderer,
// with the same three transform regimes:
//   1. screen space — void fill, full-bleed starfield + ambient stardust
//   2. design space (contain-fit) — court, stars, trails, HUD, cards, bursts
//   3. screen space again — ambient motes on top
struct ContentView: View {
  @StateObject private var model = GameModel()

  var body: some View {
    GeometryReader { geo in
      TimelineView(.animation) { timeline in
        Canvas { ctx, size in
          // tick() mutates state; Canvas closures run per frame, so driving
          // the loop here keeps sim time locked to render time.
          model.tick(now: timeline.date.timeIntervalSinceReferenceDate)
          render(&ctx, size: size)
        }
        .ignoresSafeArea()
      }
      .background(Palette.voidDeep.ignoresSafeArea())
      .gesture(dragGesture)
      .onAppear {
        model.viewResized(to: geo.size)
        #if DEBUG
        DebugBridgeBootstrap.installOnce(model: model)
        #endif
      }
      .onChange(of: geo.size) { _, newSize in model.viewResized(to: newSize) }
      .statusBarHidden(true)
      .persistentSystemOverlays(.hidden)
      .accessibilityLabel("Celestial Court")
    }
  }

  /// minimumDistance 0 → began fires like pointerdown (buttons act on touch,
  /// drags start immediately — matching the web game's feel exactly).
  private var dragGesture: some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .local)
      .onChanged { value in
        let p = model.fit.toDesign(value.location)
        if !model.touchActive {
          model.touchBegan(at: p)
        } else {
          model.touchMoved(to: p)
        }
      }
      .onEnded { _ in model.touchEnded() }
  }

  // ───────────────────────────────────────────── frame

  private func render(_ ctx: inout GraphicsContext, size: CGSize) {
    let layout = model.layout
    let w = layout.canvas.width, h = layout.canvas.height
    let time = model.elapsed
    // Feed the live contain-fit scale to the type system so small text can
    // hold the on-screen legibility floor (see Typography in Theme.swift).
    Typography.fitScale = model.fit.scale

    // 1 — screen space: void + atmosphere (full-bleed, letterbox included)
    ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Palette.voidDeep))
    drawStarfield(&ctx, stars: model.starfield, time: model.reducedMotion ? 0 : time, size: size)

    // 2 — design space via the contain-fit
    var scene = ctx
    scene.translateBy(x: model.fit.offset.x, y: model.fit.offset.y)
    scene.scaleBy(x: model.fit.scale, y: model.fit.scale)

    model.buttons.removeAll(keepingCapacity: true)

    switch model.state {
    case .title: renderTitle(&scene, w: w, h: h)
    case .setupP1, .setupP2: renderSetup(&scene, w: w, h: h, time: time)
    case .countdown: renderCountdown(&scene, w: w, h: h, time: time)
    case .simulate: renderSimulate(&scene, w: w, h: h, time: time)
    case .resolved: renderResolved(&scene, w: w, h: h, time: time)
    }

    if model.state != .title { drawCornerControls(&scene, w: w) }

    // Collision debris lives in design space — rides the fit with the scene.
    model.burstLayer.draw(&scene)

    // 3 — back to screen space: ambient motes on top of everything
    if !model.reducedMotion { model.ambientLayer.draw(&ctx) }
  }

  // ───────────────────────────────────────────── states

  private func renderTitle(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat) {
    drawWordmark(&ctx, w: w, h: h)
    drawSessionStats(&ctx, model.statsSummary, w: w, h: h)

    if !model.explainerOpen {
      let begin = CGRect(x: w / 2 - 90, y: h * 0.62, width: 180, height: 44)
      drawButton(&ctx, label: "Begin", rect: begin, primary: Palette.cream)
      model.buttons[.begin] = begin
      model.buttons[.explainer] = drawExplainerLink(&ctx, w: w)
    } else {
      // Modal: BEGIN is not registered underneath, the card owns all input.
      model.buttons[.dismissExplainer] = drawExplainerCard(&ctx, w: w, h: h)
    }
  }

  private func renderSetup(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat, time: Double) {
    let layout = model.layout
    let active: Player = model.state == .setupP1 ? .p1 : .p2
    let spec = active == .p1 ? model.specs.p1 : model.specs.p2
    let style: StarStyle = active == .p1 ? .p1 : .p2

    drawCourt(&ctx, layout: layout, activePlayer: active, showInBounds: true, showCenterLine: true)
    drawPhaseLabel(
      &ctx,
      text: active == .p1 ? "Player 1 — set your star" : "Player 2 — set your star",
      w: w, color: style.primary
    )

    // P2 plans against P1's locked star + dimmed velocity arrow.
    if active == .p2 {
      let p1 = model.specs.p1
      drawStar(&ctx, at: p1.pos, radius: bodyRadius(p1.mass), style: StarStyle.p1.dimmed(), jitterPhase: time)
      drawVelocityArrow(&ctx, origin: p1.pos, vel: p1.vel, color: Palette.player1, showTooltip: false, alpha: 0.55)
    }

    drawStar(&ctx, at: spec.pos, radius: bodyRadius(spec.mass), style: style, jitterPhase: time + (active == .p1 ? 0 : 1.7))
    let hasVel = (spec.vel.dx * spec.vel.dx + spec.vel.dy * spec.vel.dy).squareRoot() >= 1
    drawVelocityArrow(&ctx, origin: spec.pos, vel: spec.vel, color: style.primary, showTooltip: model.isDragging || hasVel)

    // Mass tooltip flips below the star near the top edge (help text lives there).
    let starR = bodyRadius(spec.mass)
    let flipBelow = spec.pos.y - starR < 240
    drawTooltip(
      &ctx, text: String(format: "mass %.1f", spec.mass),
      anchor: CGPoint(x: spec.pos.x, y: flipBelow ? spec.pos.y + starR + 4 : spec.pos.y - starR - 4),
      color: style.primary, placement: flipBelow ? .below : .above
    )

    drawSetupHelp(&ctx, active: active)

    // Lock In + mass pills below the active court.
    let inBounds = layout.inBounds(for: active)
    let lockIn = CGRect(x: inBounds.midX - 80, y: inBounds.maxY + 36, width: 160, height: 40)
    drawButton(&ctx, label: "Lock In", rect: lockIn, primary: model.canLockIn ? style.primary : Palette.terracotta)
    model.buttons[.lockIn] = lockIn

    let pill: CGFloat = 40, gap: CGFloat = 18
    let minus = CGRect(x: lockIn.minX - pill - gap, y: lockIn.midY - pill / 2, width: pill, height: pill)
    let plus = CGRect(x: lockIn.maxX + gap, y: lockIn.midY - pill / 2, width: pill, height: pill)
    drawButton(&ctx, label: "−", rect: minus, primary: style.primary)
    drawButton(&ctx, label: "+", rect: plus, primary: style.primary)
    model.buttons[.massMinus] = minus
    model.buttons[.massPlus] = plus

    if !model.canLockIn {
      ctx.draw(
        ctx.resolve(Text("drag from the star to give it a direction")
          .font(Fonts.sans(12, weight: .medium).italic()).foregroundColor(Palette.terracotta.opacity(0.85))),
        at: CGPoint(x: lockIn.midX, y: lockIn.maxY + 18), anchor: .center
      )
    }
  }

  private func drawSetupHelp(_ ctx: inout GraphicsContext, active: Player) {
    let layout = model.layout
    let portrait = layout.orientation == .portrait
    // Three lines, not five: legibility-compensated text (Typography) is
    // ~1.7× taller, and the old five-line block overflowed the gap between
    // the phase label and the court's top edge in portrait (caught by
    // /ios-qa screenshots, 2026-06-10). The exit affordance moves to the
    // canvas bottom, clear of both courts in every orientation.
    let lines = [
      "DRAG OUTWARD from the star to throw it.",
      "TAP your court to reposition. − / + sets mass.",
      "Max velocity \(Int(Limits.maxVelocityPerBody)) px/s.",
    ]
    let centered = portrait
    let x: CGFloat = portrait
      ? layout.canvas.width / 2
      : (active == .p1 ? 80 : layout.canvas.width - 80)
    var y: CGFloat = portrait ? (active == .p1 ? 94 : layout.centerLineAt + 32) : 100
    let anchor: UnitPoint = centered ? .center : (active == .p1 ? .leading : .trailing)
    let lh = Typography.lineHeight(for: 12) // compensated text needs a wider advance
    for line in lines {
      ctx.draw(
        ctx.resolve(Text(line).font(Fonts.sans(12)).foregroundColor(Palette.cream.opacity(0.45))),
        at: CGPoint(x: x, y: y), anchor: anchor
      )
      y += lh
    }
    ctx.draw(
      ctx.resolve(Text("Tap EXIT to return to title.").font(Fonts.sans(11).italic()).foregroundColor(Palette.cream.opacity(0.3))),
      at: CGPoint(x: layout.canvas.width / 2, y: layout.canvas.height - 36), anchor: .center
    )
  }

  private func renderCountdown(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat, time: Double) {
    drawCourt(&ctx, layout: model.layout, activePlayer: nil, showInBounds: false, showCenterLine: true)
    let p1 = model.specs.p1, p2 = model.specs.p2
    drawStar(&ctx, at: p1.pos, radius: bodyRadius(p1.mass), style: StarStyle.p1.dimmed(), jitterPhase: time)
    drawStar(&ctx, at: p2.pos, radius: bodyRadius(p2.mass), style: StarStyle.p2.dimmed(), jitterPhase: time + 1.7)
    drawVelocityArrow(&ctx, origin: p1.pos, vel: p1.vel, color: Palette.player1, showTooltip: false)
    drawVelocityArrow(&ctx, origin: p2.pos, vel: p2.vel, color: Palette.player2, showTooltip: false)

    let remaining = model.countdownRemaining
    let n = max(1, Int(remaining.rounded(.up)))
    let pulse = 1 - (remaining - remaining.rounded(.down))
    ctx.draw(
      ctx.resolve(Text(String(n)).font(Fonts.serif(160)).foregroundColor(Palette.cream.opacity(0.6 + 0.4 * (1 - pulse)))),
      at: CGPoint(x: w / 2, y: h / 2), anchor: .center
    )
  }

  private func renderSimulate(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat, time: Double) {
    drawCourt(&ctx, layout: model.layout, activePlayer: nil, showInBounds: false, showCenterLine: true)

    // Camera-follow: only the system content translates; court/HUD stay fixed.
    var world = ctx
    if let cam = model.cameraOffset { world.translateBy(x: cam.x, y: cam.y) }

    if let sim = model.sim {
      drawPredictedOrbits(&world, sim: sim)
    }
    drawTrail(&world, trail: model.trails.p1, color: Palette.player1)
    drawTrail(&world, trail: model.trails.p2, color: Palette.player2)

    if let nova = model.supernova {
      drawSupernova(&world, at: nova.pos, elapsed: model.elapsed - nova.t0, mergedMass: nova.mergedMass, time: time)
    } else if let sim = model.sim {
      drawBarycenter(&world, sim: sim, time: time)
      drawStar(&world, at: CGPoint(x: sim.a.pos.x, y: sim.a.pos.y), radius: bodyRadius(sim.a.mass),
               style: dopplerTinted(.p1, body: sim.a, layout: model.layout), jitterPhase: time)
      drawStar(&world, at: CGPoint(x: sim.b.pos.x, y: sim.b.pos.y), radius: bodyRadius(sim.b.mass),
               style: dopplerTinted(.p2, body: sim.b, layout: model.layout), jitterPhase: time + 1.7)
    }

    if let sim = model.sim, let classifier = model.classifier {
      let o = sim.orbit()
      drawHud(&ctx, w: w, h: h, fields: [
        HudField(label: "separation", value: "\(Int(o.separation.rounded())) px", color: Palette.rose),
        HudField(label: "rel. speed", value: "\(Int(o.vRel.rounded())) px/s", color: Palette.rose),
        HudField(label: "energy", value: o.bound ? "BOUND" : "UNBOUND", color: o.bound ? Palette.cream : Palette.wine),
        HudField(label: "ecc.", value: o.eccentricity.isFinite ? String(format: "%.2f", o.eccentricity) : "∞", color: Palette.cream),
        // ORBITS before PERIOD: legibility-compensated columns are wider, so
        // the portrait HUD truncates after ~5 fields — and orbits is the
        // counter the win condition is ABOUT. Period + time are the
        // sacrificial tail.
        HudField(label: "orbits", value: String(classifier.orbits), color: Palette.cream),
        HudField(label: "period", value: o.period.isFinite ? String(format: "%.1f s", o.period) : "∞", color: Palette.rose),
        HudField(label: "time", value: String(format: "%.1f s", sim.time), color: Palette.rose),
      ])
    }

    // Phase echoes the system honestly: WIN keeps moving, losses freeze.
    var phase = "in motion"
    if model.state == .resolved, let o = model.outcome {
      switch o {
      case .loseEscape, .loseSlingshot: phase = "drifting"
      case .loseCollision: phase = "stilled"
      default: break
      }
    }
    drawPhaseLabel(&ctx, text: phase, w: w)
  }

  private func renderResolved(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat, time: Double) {
    renderSimulate(&ctx, w: w, h: h, time: time)
    guard let outcome = model.outcome else { return }
    if outcome == .win && model.winCardDismissed { return }

    let statsLine = playStatsLine()
    let base = outcomeCardGeometry(outcome, w: w, h: h, hasStats: statsLine != nil)
    // WIN cards are draggable (GameModel.winCardOffset); everything on the
    // card — panel, text, AGAIN, ✕, footer — rides the same offset.
    let off = outcome == .win ? model.winCardOffset : .zero
    let geo = OutcomeCardGeometry(
      rect: base.rect.offsetBy(dx: off.x, dy: off.y),
      buttonY: base.buttonY + off.y,
      carseY: base.carseY + off.y
    )
    drawOutcomeCard(&ctx, outcome: outcome, w: w, h: h, statsLine: statsLine, geometry: geo)

    // The merger is the whole moment — punch it back through the card.
    if let nova = model.supernova {
      drawSupernova(&ctx, at: nova.pos, elapsed: model.elapsed - nova.t0, mergedMass: nova.mergedMass, time: time)
    }

    let again = CGRect(x: geo.rect.midX - 90, y: geo.buttonY, width: 180, height: 44)
    drawButton(&ctx, label: "Again", rect: again, primary: outcomeCopy(outcome).titleColor)
    model.buttons[.again] = again

    if outcome == .win {
      // Legibility-floor the ✕'s VISUAL disc (its hit target was already
      // 44pt-inflated by hitButton; the drawn disc was a ~6pt speck — JP
      // couldn't see that dismissal existed).
      let closeR = Typography.compensate(13)
      let c = CGPoint(x: geo.rect.maxX - closeR - 13, y: geo.rect.minY + closeR + 13)
      drawCloseButton(&ctx, center: c, r: closeR, color: outcomeCopy(outcome).titleColor)
      let hit = closeR + 9
      model.buttons[.dismissWin] = CGRect(x: c.x - hit, y: c.y - hit, width: hit * 2, height: hit * 2)
      // The card itself is the drag handle — registered LAST and biggest, so
      // AGAIN and ✕ (smaller rects) always win the hit test.
      model.buttons[.winCard] = geo.rect
    }

    drawCarseFooter(&ctx, topY: geo.carseY, centerX: geo.rect.midX)
  }

  private func playStatsLine() -> String? {
    guard let sim = model.sim, let outcome = model.outcome else { return nil }
    let o = sim.orbit()
    let orbits = model.classifier?.orbits ?? 0
    let ecc = o.eccentricity.isFinite ? String(format: "%.2f", o.eccentricity) : "∞"
    let sep = "  ·  "
    switch outcome {
    case .win:
      return "\(Int(sim.time))s\(sep)\(orbits) \(orbits == 1 ? "orbit" : "orbits")\(sep)ecc \(ecc)"
    case .loseEscape, .loseSlingshot:
      return String(format: "%.1fs", sim.time) + sep + "ecc \(ecc)"
    case .loseCollision:
      return String(format: "%.1fs", sim.time) + sep + "\(Int(o.vRel.rounded())) px/s at impact"
    default:
      return nil
    }
  }

  /// Top-right control cluster: EXIT always (the touch ESC), AGAIN joins it
  /// after a WIN card is dismissed.
  private func drawCornerControls(_ ctx: inout GraphicsContext, w: CGFloat) {
    let exit = CGRect(x: w - 16 - 96, y: 14, width: 96, height: 44)
    drawButton(&ctx, label: "Exit", rect: exit, primary: Palette.terracotta)
    model.buttons[.exit] = exit

    if model.state == .resolved, model.outcome == .win, model.winCardDismissed {
      let again = CGRect(x: exit.minX - 12 - 110, y: 14, width: 110, height: 44)
      drawButton(&ctx, label: "Again", rect: again, primary: Palette.cream)
      model.buttons[.again] = again
    }
  }
}
