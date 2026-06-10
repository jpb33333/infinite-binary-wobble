import SwiftUI
import WobblePhysics

// Scene-layer drawing in design-space coordinates (ports of court.ts,
// star.ts, arrow.ts and the Renderer's predicted-orbit / barycenter /
// supernova / Doppler passes). The caller owns the contain-fit transform.

// ── Court ──

func drawCourt(
  _ ctx: inout GraphicsContext, layout: CourtLayout,
  activePlayer: Player?, showInBounds: Bool, showCenterLine: Bool
) {
  let at = layout.centerLineAt
  let vertical = layout.centerLineAxis == .vertical

  // Soft ambient wash from the active player's edge toward the divider.
  if let player = activePlayer {
    let color = player == .p1 ? Palette.player1 : Palette.player2
    let rect = layout.region(for: player)
    let grad = Gradient(stops: [
      .init(color: color.opacity(player == .p1 ? 0.07 : 0), location: 0),
      .init(color: color.opacity(player == .p1 ? 0 : 0.07), location: 1),
    ])
    let (start, end): (CGPoint, CGPoint) = vertical
      ? (CGPoint(x: rect.minX, y: 0), CGPoint(x: rect.maxX, y: 0))
      : (CGPoint(x: 0, y: rect.minY), CGPoint(x: 0, y: rect.maxY))
    ctx.fill(Path(rect), with: .linearGradient(grad, startPoint: start, endPoint: end))
  }

  // Glowing center "service line" — additive, faded at the ends.
  if showCenterLine {
    var g = ctx
    g.blendMode = .plusLighter
    let grad = Gradient(stops: [
      .init(color: Palette.terracotta.opacity(0), location: 0),
      .init(color: Palette.terracotta.opacity(0.35), location: 0.5),
      .init(color: Palette.terracotta.opacity(0), location: 1),
    ])
    var line = Path()
    let (start, end): (CGPoint, CGPoint)
    if vertical {
      start = CGPoint(x: at, y: 0)
      end = CGPoint(x: at, y: layout.canvas.height)
    } else {
      start = CGPoint(x: 0, y: at)
      end = CGPoint(x: layout.canvas.width, y: at)
    }
    line.move(to: start)
    line.addLine(to: end)
    g.stroke(line, with: .linearGradient(grad, startPoint: start, endPoint: end), lineWidth: 1.5)
  }

  if showInBounds {
    drawInBounds(&ctx, layout.p1InBounds, Palette.player1, activePlayer == .p1)
    drawInBounds(&ctx, layout.p2InBounds, Palette.player2, activePlayer == .p2)
  }
}

private func drawInBounds(_ ctx: inout GraphicsContext, _ rect: CGRect, _ color: Color, _ active: Bool) {
  ctx.stroke(
    Path(rect),
    with: .color((active ? color : Palette.terracotta).opacity(active ? 0.55 : 0.25)),
    style: StrokeStyle(lineWidth: active ? 1.4 : 1, dash: [6, 8])
  )
}

// ── Painterly star ──

struct StarStyle {
  var primary: Color
  var core: Color = Palette.cream
  var haloAlpha: Double
  var haloRadiusFactor: Double

  static let p1 = StarStyle(primary: Palette.player1, haloAlpha: 0.9, haloRadiusFactor: 2.6)
  static let p2 = StarStyle(primary: Palette.player2, haloAlpha: 0.9, haloRadiusFactor: 2.6)

  func dimmed() -> StarStyle {
    var s = self
    s.haloAlpha = 0.35
    s.haloRadiusFactor = 1.7
    return s
  }
}

/// Three layered radial gradients with slightly offset centers (asymmetric
/// corona — painted, not photoreal) plus an additive outer halo.
func drawStar(_ ctx: inout GraphicsContext, at p: CGPoint, radius: Double, style: StarStyle, jitterPhase: Double = 0) {
  let ox = cos(jitterPhase * 1.3) * radius * 0.08
  let oy = sin(jitterPhase * 0.9) * radius * 0.08
  let off = CGPoint(x: p.x + ox, y: p.y + oy)

  // Outer halo (additive bloom)
  var g = ctx
  g.blendMode = .plusLighter
  let haloR = radius * style.haloRadiusFactor
  g.fill(
    Path(ellipseIn: CGRect(x: p.x - haloR, y: p.y - haloR, width: haloR * 2, height: haloR * 2)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: style.primary.opacity(style.haloAlpha * 0.7), location: 0),
        .init(color: style.primary.opacity(style.haloAlpha * 0.25), location: 0.45),
        .init(color: style.primary.opacity(0), location: 1),
      ]),
      center: off, startRadius: radius * 0.5, endRadius: haloR
    )
  )

  // Body — soft outer disk
  ctx.fill(
    Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: style.core, location: 0),
        .init(color: style.primary.opacity(0.95), location: 0.35),
        .init(color: style.primary.opacity(0.55), location: 0.85),
        .init(color: style.primary.opacity(0), location: 1),
      ]),
      center: off, startRadius: 1, endRadius: radius
    )
  )

  // Hot core
  let coreR = radius * 0.4
  ctx.fill(
    Path(ellipseIn: CGRect(x: p.x - coreR, y: p.y - coreR, width: coreR * 2, height: coreR * 2)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: style.core.opacity(0.95), location: 0),
        .init(color: style.core.opacity(0), location: 1),
      ]),
      center: CGPoint(x: p.x + ox * 0.6, y: p.y + oy * 0.6), startRadius: 0, endRadius: coreR
    )
  )
}

/// Doppler tint — how binary wobble is actually detected from Earth. A fixed
/// observer far below the canvas; radial velocity toward it warms the body
/// color toward cream (approaching) or wine (receding). Max blend 0.35.
func dopplerTinted(_ style: StarStyle, body: Body, layout: CourtLayout) -> StarStyle {
  let obsX = layout.canvas.width / 2
  let obsY = layout.canvas.height + 700
  let referenceV = 250.0
  let dx = obsX - body.pos.x, dy = obsY - body.pos.y
  let inv = 1 / (dx * dx + dy * dy).squareRoot()
  let radial = (body.vel.x * dx + body.vel.y * dy) * inv
  let shift = min(max(radial / referenceV, -1), 1)
  var s = style
  s.primary = blendColor(style.primary, shift > 0 ? Palette.cream : Palette.wine, abs(shift) * 0.35)
  return s
}

// ── Velocity arrow ──

func drawVelocityArrow(
  _ ctx: inout GraphicsContext, origin: CGPoint, vel: CGVector, color: Color,
  showTooltip: Bool = true, alpha: Double = 1.0
) {
  let mag = (vel.dx * vel.dx + vel.dy * vel.dy).squareRoot()
  guard mag >= 0.5 else { return }
  // Arrow length in px equals velocity in px/s — players intuit length = speed.
  let tip = CGPoint(x: origin.x + vel.dx, y: origin.y + vel.dy)

  var shaft = Path()
  shaft.move(to: origin)
  shaft.addLine(to: tip)
  let stroke = StrokeStyle(lineWidth: 2.2, lineCap: .round)
  ctx.stroke(shaft, with: .color(color.opacity(0.85 * alpha)), style: stroke)

  // Chevron head
  let angle = atan2(vel.dy, vel.dx)
  let headLen = 14.0, headAngle = Double.pi / 7
  var head = Path()
  head.move(to: tip)
  head.addLine(to: CGPoint(x: tip.x - cos(angle - headAngle) * headLen, y: tip.y - sin(angle - headAngle) * headLen))
  head.move(to: tip)
  head.addLine(to: CGPoint(x: tip.x - cos(angle + headAngle) * headLen, y: tip.y - sin(angle + headAngle) * headLen))
  ctx.stroke(head, with: .color(color.opacity(0.85 * alpha)), style: stroke)

  // Tip glow — pulls the eye to the drag handle
  var g = ctx
  g.blendMode = .plusLighter
  g.fill(
    Path(ellipseIn: CGRect(x: tip.x - 18, y: tip.y - 18, width: 36, height: 36)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: color.opacity(0.6 * alpha), location: 0),
        .init(color: color.opacity(0), location: 1),
      ]),
      center: tip, startRadius: 0, endRadius: 18
    )
  )

  if showTooltip {
    drawTooltip(&ctx, text: "\(Int(mag.rounded())) px/s", anchor: CGPoint(x: tip.x, y: tip.y + 16), color: color, placement: .below)
  }
}

// ── Predicted orbits + barycenter ──

/// Each body's own ellipse around the barycenter focus, from the conserved
/// elements: a₁ = a·m₂/M (periapsis along ω+π), a₂ = a·m₁/M (along ω).
func drawPredictedOrbits(_ ctx: inout GraphicsContext, sim: Simulation) {
  let o = sim.orbit()
  guard o.bound, o.semiMajorAxis.isFinite, o.eccentricity < 0.999 else { return }

  let M = sim.a.mass + sim.b.mass
  let bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M
  let by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M
  let e = o.eccentricity
  let k = (1 - e * e).squareRoot()

  func ellipse(_ a: Double, rotation: Double, color: Color) {
    let b = a * k, c = a * e
    var g = ctx
    g.translateBy(x: bx, y: by)
    g.rotate(by: .radians(rotation))
    let path = Path(ellipseIn: CGRect(x: -c - a, y: -b, width: a * 2, height: b * 2))
    g.stroke(path, with: .color(color.opacity(0.22)), style: StrokeStyle(lineWidth: 1, dash: [4, 6]))
  }

  ellipse(o.semiMajorAxis * (sim.b.mass / M), rotation: o.argumentOfPeriapsis + .pi, color: Palette.player1)
  ellipse(o.semiMajorAxis * (sim.a.mass / M), rotation: o.argumentOfPeriapsis, color: Palette.player2)
}

func drawBarycenter(_ ctx: inout GraphicsContext, sim: Simulation, time: Double) {
  let M = sim.a.mass + sim.b.mass
  let bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M
  let by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M
  let pulse = 0.5 + 0.5 * sin(time * 1.3)
  var g = ctx
  g.blendMode = .plusLighter
  let haloR = 18.0
  g.fill(
    Path(ellipseIn: CGRect(x: bx - haloR, y: by - haloR, width: haloR * 2, height: haloR * 2)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: Palette.cream.opacity(0.18 + 0.12 * pulse), location: 0),
        .init(color: Palette.cream.opacity(0), location: 1),
      ]),
      center: CGPoint(x: bx, y: by), startRadius: 0, endRadius: haloR
    )
  )
  g.fill(
    Path(ellipseIn: CGRect(x: bx - 1.5, y: by - 1.5, width: 3, height: 3)),
    with: .color(Palette.cream.opacity(0.55 + 0.25 * pulse))
  )
}

// ── Supernova: flash → shockwave → persistent remnant ──

func drawSupernova(_ ctx: inout GraphicsContext, at p: CGPoint, elapsed: Double, mergedMass: Double, time: Double) {
  let t = max(0, elapsed)

  if t < 0.5 {
    let k = min(1, t / 0.18)
    let fade = (1 - k) * (1 - k)
    let r = 240 + k * 520
    var g = ctx
    g.blendMode = .plusLighter
    g.fill(
      Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)),
      with: .radialGradient(
        Gradient(stops: [
          .init(color: Palette.cream.opacity(fade), location: 0),
          .init(color: Palette.cream.opacity(fade * 0.55), location: 0.25),
          .init(color: Palette.cream.opacity(0), location: 1),
        ]),
        center: p, startRadius: 0, endRadius: r
      )
    )
  }

  for lag in [0.05, 0.32] {
    let tt = t - lag
    if tt > 0 && tt < 2.5 {
      let u = tt / 2.5
      let rr = u * 760
      let a = (1 - u) * (1 - u) * 0.65
      var g = ctx
      g.blendMode = .plusLighter
      g.stroke(
        Path(ellipseIn: CGRect(x: p.x - rr, y: p.y - rr, width: rr * 2, height: rr * 2)),
        with: .color(Palette.cream.opacity(a)),
        lineWidth: 3 - u * 2
      )
    }
  }

  if t > 0.25 {
    let settle = min(1, (t - 0.25) / 0.6)
    let radius = bodyRadius(mergedMass) * (0.7 + 0.5 * settle)
    let pulse = 0.5 + 0.5 * sin(time * 2.4)
    let remnant = StarStyle(
      primary: blendColor(Palette.player1, Palette.player2, 0.5),
      haloAlpha: 0.7 + 0.25 * pulse,
      haloRadiusFactor: 3.2
    )
    drawStar(&ctx, at: p, radius: radius, style: remnant, jitterPhase: time + 0.7)
  }
}
