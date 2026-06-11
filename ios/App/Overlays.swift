import SwiftUI
import WobblePhysics

// HUD/overlay primitives in design space (port of src/render/overlay.ts).
// Button draw + hit registration share the same rects via the model's
// `buttons` registry, refreshed by the draw pass each frame.

enum TooltipPlacement { case above, below }

func drawTooltip(
  _ ctx: inout GraphicsContext, text: String, anchor: CGPoint,
  color: Color, placement: TooltipPlacement = .above
) {
  let resolved = ctx.resolve(Text(text).font(Fonts.sans(13, weight: .medium)).foregroundColor(color))
  let size = resolved.measure(in: CGSize(width: 400, height: 40))
  let padX: CGFloat = 10, h: CGFloat = 24
  let w = size.width + padX * 2
  let x = anchor.x - w / 2
  let y = placement == .above ? anchor.y - h - 8 : anchor.y + 8
  let rect = CGRect(x: x, y: y, width: w, height: h)
  let pill = Path(roundedRect: rect, cornerRadius: 6)
  ctx.fill(pill, with: .color(Palette.voidDeep.opacity(0.78)))
  ctx.stroke(pill, with: .color(color.opacity(0.45)), lineWidth: 1)
  ctx.draw(resolved, at: CGPoint(x: anchor.x, y: rect.midY), anchor: .center)
}

func drawWordmark(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat) {
  // Shrink-to-fit: 76 is the landscape size; portrait must clear the margins.
  var titleSize: CGFloat = 76
  var title = ctx.resolve(Text("Infinite Binary Wobble").font(Fonts.serif(titleSize)).foregroundColor(Palette.cream))
  let measured = title.measure(in: CGSize(width: 4000, height: 200)).width
  if measured > w - 80 {
    titleSize = (titleSize * (w - 80) / measured).rounded(.down)
    title = ctx.resolve(Text("Infinite Binary Wobble").font(Fonts.serif(titleSize)).foregroundColor(Palette.cream))
  }
  ctx.draw(title, at: CGPoint(x: w / 2, y: h * 0.38), anchor: .center)
  ctx.draw(
    ctx.resolve(Text("a game for two who are considering").font(Fonts.serif(24, italic: true)).foregroundColor(Palette.rose)),
    at: CGPoint(x: w / 2, y: h * 0.38 + 64), anchor: .center
  )
}

func drawSessionStats(_ ctx: inout GraphicsContext, _ s: StatsSummary, w: CGFloat, h: CGFloat) {
  guard s.total > 0 else { return }
  func plural(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? one : many }
  let head = "\(s.total) \(plural(s.total, "play", "plays")) this session  ·  "
    + "\(s.wins) \(plural(s.wins, "wobble", "wobbles"))  ·  "
    + "\(Int((s.winRate * 100).rounded()))% wobble rate"
  let headY = h * 0.51
  ctx.draw(
    ctx.resolve(Text(head).font(Fonts.sans(12, weight: .medium)).foregroundColor(Palette.cream.opacity(0.55))),
    at: CGPoint(x: w / 2, y: headY), anchor: .center
  )
  var parts: [String] = []
  if s.drifted > 0 { parts.append("\(s.drifted) drifted") }
  if s.collided > 0 { parts.append("\(s.collided) collided") }
  if let best = s.bestOrbits, best > 0 { parts.append("best wobble \(best) orbits") }
  if !parts.isEmpty {
    ctx.draw(
      ctx.resolve(Text(parts.joined(separator: "  ·  ")).font(Fonts.serif(13, italic: true)).foregroundColor(Palette.rose.opacity(0.55))),
      at: CGPoint(x: w / 2, y: headY + 22), anchor: .center
    )
  }
}

func drawPhaseLabel(_ ctx: inout GraphicsContext, text: String, w: CGFloat, color: Color = Palette.rose) {
  ctx.draw(
    ctx.resolve(Text("— phase —").font(Fonts.sans(11, weight: .medium)).foregroundColor(Palette.cream.opacity(0.5))),
    at: CGPoint(x: w / 2, y: 36), anchor: .center
  )
  ctx.draw(
    ctx.resolve(Text(text).font(Fonts.serif(22)).foregroundColor(color)),
    at: CGPoint(x: w / 2, y: 64), anchor: .center
  )
}

struct HudField {
  let label: String
  let value: String
  let color: Color
}

func drawHud(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat, fields: [HudField]) {
  let padX: CGFloat = 36
  let baseY = h - 28
  // Label sits one compensated value-line above the value: the original
  // fixed 16px gap was tuned for uncompensated 11/18px text and the
  // legibility floor made labels overprint values (/ios-qa screenshot).
  let labelGap = Typography.lineHeight(for: 18)
  var x = padX
  for f in fields {
    ctx.draw(
      ctx.resolve(Text(f.label.uppercased()).font(Fonts.sans(11, weight: .medium)).foregroundColor(Palette.cream.opacity(0.55))),
      at: CGPoint(x: x, y: baseY - labelGap), anchor: .bottomLeading
    )
    let value = ctx.resolve(Text(f.value).font(Fonts.serif(18)).foregroundColor(f.color))
    ctx.draw(value, at: CGPoint(x: x, y: baseY), anchor: .bottomLeading)
    let valWidth = value.measure(in: CGSize(width: 600, height: 40)).width
    x += max(140, valWidth + 60)
    if x > w - padX - 100 { break }
  }
}

/// Pill button with an additive halo. Returns the rect for the registry.
@discardableResult
func drawButton(
  _ ctx: inout GraphicsContext, label: String, rect: CGRect,
  primary: Color, hovered: Bool = false
) -> CGRect {
  var g = ctx
  g.blendMode = .plusLighter
  let haloR = max(rect.width, rect.height) * (hovered ? 1.2 : 0.9)
  let c = CGPoint(x: rect.midX, y: rect.midY)
  g.fill(
    Path(CGRect(x: c.x - haloR, y: c.y - haloR, width: haloR * 2, height: haloR * 2)),
    with: .radialGradient(
      Gradient(stops: [
        .init(color: primary.opacity(hovered ? 0.35 : 0.18), location: 0),
        .init(color: primary.opacity(0), location: 1),
      ]),
      center: c, startRadius: 0, endRadius: haloR
    )
  )

  let pill = Path(roundedRect: rect, cornerRadius: rect.height / 2)
  ctx.fill(pill, with: .color(primary.opacity(hovered ? 0.92 : 0.75)))
  ctx.stroke(pill, with: .color(Palette.cream.opacity(0.35)), lineWidth: 1)
  ctx.draw(
    ctx.resolve(Text(label.uppercased()).font(Fonts.sans(14, weight: .semibold)).foregroundColor(Palette.voidDeep).kerning(1.2)),
    at: CGPoint(x: c.x, y: c.y + 1), anchor: .center
  )
  return rect
}

/// Small circular ✕ — the visible disc is small; the caller registers the
/// finger-sized hit rect.
func drawCloseButton(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat, color: Color) {
  let disc = Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
  ctx.fill(disc, with: .color(Palette.voidDeep.opacity(0.55)))
  ctx.stroke(disc, with: .color(color.opacity(0.5)), lineWidth: 1)
  let k = r * 0.42
  // stroke scales with the disc (legibility-floored radii upstream)
  var x = Path()
  x.move(to: CGPoint(x: center.x - k, y: center.y - k))
  x.addLine(to: CGPoint(x: center.x + k, y: center.y + k))
  x.move(to: CGPoint(x: center.x + k, y: center.y - k))
  x.addLine(to: CGPoint(x: center.x - k, y: center.y + k))
  ctx.stroke(x, with: .color(color.opacity(0.8)), style: StrokeStyle(lineWidth: max(1.6, r * 0.14), lineCap: .round))
}

// ── Outcome card ──

struct OutcomeCopy {
  let titleColor: Color
  let title: String
  let body: String
}

func outcomeCopy(_ o: Outcome) -> OutcomeCopy {
  switch o {
  case .win:
    return OutcomeCopy(titleColor: Palette.cream, title: "An Infinite Binary Wobble.", body: "Stay and watch as long as you like.")
  case .loseEscape:
    return OutcomeCopy(titleColor: Palette.player1, title: "Lost to the void.", body: "You can’t lose each other.")
  case .loseSlingshot:
    return OutcomeCopy(titleColor: Palette.player2, title: "A long arc home.", body: "You can’t lose each other.")
  case .loseCollision:
    return OutcomeCopy(titleColor: Palette.wine, title: "Touched, and undone.", body: "You can’t lose yourself.")
  case .playing:
    return OutcomeCopy(titleColor: Palette.cream, title: "", body: "")
  }
}

struct OutcomeCardGeometry {
  let rect: CGRect
  let buttonY: CGFloat
  let carseY: CGFloat
}

/// Pure geometry shared by draw + hit-test so they can never disagree.
/// WIN cards anchor at the bottom (the wobble stays the focus); LOSE cards
/// center with a dimmed backdrop.
func outcomeCardGeometry(_ o: Outcome, w: CGFloat, h: CGFloat, hasStats: Bool) -> OutcomeCardGeometry {
  let isWin = o == .win
  let statsExtra: CGFloat = hasStats ? 28 : 0
  let cardW: CGFloat = isWin ? 600 : 660
  let cardH: CGFloat = (isWin ? 232 : 308) + statsExtra
  let cx = (w - cardW) / 2
  let cy = isWin ? h - cardH - 72 : (h - cardH) / 2
  let buttonY = (isWin ? cy + 96 : cy + 156) + statsExtra
  return OutcomeCardGeometry(
    rect: CGRect(x: cx, y: cy, width: cardW, height: cardH),
    buttonY: buttonY,
    carseY: buttonY + 44 + 8
  )
}

func drawOutcomeCard(
  _ ctx: inout GraphicsContext, outcome: Outcome, w: CGFloat, h: CGFloat,
  statsLine: String?, geometry: OutcomeCardGeometry
) {
  let copy = outcomeCopy(outcome)
  let isWin = outcome == .win
  if !isWin {
    ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(Palette.voidDeep.opacity(0.55)))
  }
  let card = Path(roundedRect: geometry.rect, cornerRadius: 18)
  ctx.fill(card, with: .color(Palette.voidDeep.opacity(isWin ? 0.78 : 0.92)))
  ctx.stroke(card, with: .color(copy.titleColor.opacity(isWin ? 0.45 : 0.6)), lineWidth: 1)

  let cy = geometry.rect.minY
  ctx.draw(
    ctx.resolve(Text(copy.title).font(Fonts.serif(isWin ? 30 : 44)).foregroundColor(copy.titleColor)),
    at: CGPoint(x: geometry.rect.midX, y: cy + (isWin ? 40 : 76)), anchor: .center
  )
  ctx.draw(
    ctx.resolve(Text(copy.body).font(Fonts.serif(isWin ? 16 : 19, italic: true)).foregroundColor(Palette.rose)),
    at: CGPoint(x: geometry.rect.midX, y: cy + (isWin ? 72 : 122)), anchor: .center
  )
  if let statsLine {
    ctx.draw(
      ctx.resolve(Text(statsLine).font(Fonts.sans(12, weight: .medium)).foregroundColor(Palette.cream.opacity(0.55))),
      at: CGPoint(x: geometry.rect.midX, y: cy + (isWin ? 100 : 152)), anchor: .center
    )
  }
}

/// The Carse footer — the finite-game / infinite-game distinction IS the
/// game; it appears with every AGAIN button.
func drawCarseFooter(_ ctx: inout GraphicsContext, topY: CGFloat, centerX: CGFloat) {
  let lines = [
    "Remember, this is just a finite game.",
    "The real infinite game is played for its own sake",
    "and is only won by playing again and again.",
  ]
  var y = topY
  let lh = Typography.lineHeight(for: 12) // compensated text needs a wider advance
  for line in lines {
    ctx.draw(
      ctx.resolve(Text(line).font(Fonts.serif(12, italic: true)).foregroundColor(Palette.rose.opacity(0.55))),
      at: CGPoint(x: centerX, y: y), anchor: .top
    )
    y += lh
  }
}

// ── Explainer ──

let EXPLAINER_LINK_TEXT = "what is a binary star?"
private let EXPLAINER_TITLE = "binary stars"
private let EXPLAINER_BODY = [
  "Most stars are not alone.",
  "Perhaps half the stars you can see are two — bound to each other, circling a point between them that belongs to neither and to both. Astronomers call them binary stars.",
  "Neither star leads. Neither follows. Each bends the other’s path — and when the balance is right, the dance holds for billions of years.",
  "When it isn’t, they fall together, or fly apart.",
  "You are about to be such a pair.",
]

/// Quiet text link, top-right of the title. Returns the finger-sized hit rect.
func drawExplainerLink(_ ctx: inout GraphicsContext, w: CGFloat) -> CGRect {
  let text = ctx.resolve(Text(EXPLAINER_LINK_TEXT).font(Fonts.serif(15, italic: true)).foregroundColor(Palette.rose.opacity(0.5)))
  let size = text.measure(in: CGSize(width: 600, height: 40))
  let margin: CGFloat = 28, baselineY: CGFloat = 30
  let rightX = w - margin
  ctx.draw(text, at: CGPoint(x: rightX, y: baselineY), anchor: .trailing)
  let hitH: CGFloat = 44, padX: CGFloat = 12
  return CGRect(x: rightX - size.width - padX, y: baselineY - hitH / 2, width: size.width + padX * 2, height: hitH)
}

/// Modal explainer card. Returns the ✕ hit rect.
func drawExplainerCard(_ ctx: inout GraphicsContext, w: CGFloat, h: CGFloat) -> CGRect {
  ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(Palette.voidDeep.opacity(0.6)))

  let cardW: CGFloat = 640, padX: CGFloat = 56
  let textW = cardW - padX * 2
  let paraGap: CGFloat = 14, lineH: CGFloat = 24

  // Wrap each paragraph to the panel width, then size the card to the prose.
  let wrapped = EXPLAINER_BODY.map { wrapText(ctx, $0, maxWidth: textW) }
  let totalLines = wrapped.reduce(0) { $0 + $1.count }
  let titleTop: CGFloat = 40, titleToBody: CGFloat = 44, bottomPad: CGFloat = 40
  let bodyH = CGFloat(totalLines) * lineH + CGFloat(wrapped.count - 1) * paraGap
  let cardH = titleTop + titleToBody + bodyH + bottomPad
  let rect = CGRect(x: (w - cardW) / 2, y: (h - cardH) / 2, width: cardW, height: cardH)

  let panel = Path(roundedRect: rect, cornerRadius: 18)
  ctx.fill(panel, with: .color(Palette.voidDeep.opacity(0.92)))
  ctx.stroke(panel, with: .color(Palette.cream.opacity(0.45)), lineWidth: 1)

  ctx.draw(
    ctx.resolve(Text(EXPLAINER_TITLE).font(Fonts.serif(30)).foregroundColor(Palette.cream)),
    at: CGPoint(x: w / 2, y: rect.minY + titleTop), anchor: .center
  )
  var y = rect.minY + titleTop + titleToBody
  for para in wrapped {
    for line in para {
      ctx.draw(
        ctx.resolve(Text(line).font(Fonts.serif(17, italic: true)).foregroundColor(Palette.rose)),
        at: CGPoint(x: w / 2, y: y), anchor: .center
      )
      y += lineH
    }
    y += paraGap
  }

  // Legibility-floored disc — the 13px ✕ was a ~6pt speck on phone fits.
  let closeR = Typography.compensate(13)
  let closeCenter = CGPoint(x: rect.maxX - closeR - 13, y: rect.minY + closeR + 13)
  drawCloseButton(&ctx, center: closeCenter, r: closeR, color: Palette.cream)
  return CGRect(x: closeCenter.x - 22, y: closeCenter.y - 22, width: 44, height: 44)
}

/// Greedy word-wrap to a pixel width using resolved-text measurement.
private func wrapText(_ ctx: GraphicsContext, _ text: String, maxWidth: CGFloat) -> [String] {
  let font = Fonts.serif(17, italic: true)
  func width(_ s: String) -> CGFloat {
    ctx.resolve(Text(s).font(font)).measure(in: CGSize(width: 4000, height: 60)).width
  }
  var lines: [String] = []
  var line = ""
  for word in text.split(separator: " ").map(String.init) {
    let candidate = line.isEmpty ? word : "\(line) \(word)"
    if !line.isEmpty && width(candidate) > maxWidth {
      lines.append(line)
      line = word
    } else {
      line = candidate
    }
  }
  if !line.isEmpty { lines.append(line) }
  return lines
}
