import CoreGraphics
import WobblePhysics

// Court layout in design-space pixels — the Swift port of src/game/states.ts,
// including the web's portrait layout (the exact transpose of landscape, so
// the play-tuned 820 px outcome envelope holds in both).

enum Player: Int { case p1 = 1, p2 = 2 }

enum CourtOrientation { case landscape, portrait }

struct CourtLayout {
  let orientation: CourtOrientation
  let canvas: CGSize
  let p1Region: CGRect
  let p2Region: CGRect
  let p1InBounds: CGRect
  let p2InBounds: CGRect
  /// vertical: line at x = at (P1 left / P2 right);
  /// horizontal: line at y = at (P1 top / P2 bottom).
  let centerLineAxis: Axis2
  let centerLineAt: CGFloat

  enum Axis2 { case vertical, horizontal }

  func region(for player: Player) -> CGRect { player == .p1 ? p1Region : p2Region }
  func inBounds(for player: Player) -> CGRect { player == .p1 ? p1InBounds : p2InBounds }
}

let LANDSCAPE_LAYOUT = CourtLayout(
  orientation: .landscape,
  canvas: CGSize(width: 1280, height: 800),
  p1Region: CGRect(x: 0, y: 0, width: 640, height: 800),
  p2Region: CGRect(x: 640, y: 0, width: 640, height: 800),
  p1InBounds: CGRect(x: 120, y: 200, width: 400, height: 400),
  p2InBounds: CGRect(x: 760, y: 200, width: 400, height: 400),
  centerLineAxis: .vertical,
  centerLineAt: 640
)

let PORTRAIT_LAYOUT = CourtLayout(
  orientation: .portrait,
  canvas: CGSize(width: 800, height: 1280),
  p1Region: CGRect(x: 0, y: 0, width: 800, height: 640),
  p2Region: CGRect(x: 0, y: 640, width: 800, height: 640),
  p1InBounds: CGRect(x: 220, y: 170, width: 360, height: 360),
  p2InBounds: CGRect(x: 220, y: 770, width: 360, height: 360),
  centerLineAxis: .horizontal,
  centerLineAt: 640
)

func layoutFor(size: CGSize) -> CourtLayout {
  size.width >= size.height ? LANDSCAPE_LAYOUT : PORTRAIT_LAYOUT
}

/// UI-facing control limits (narrower than the physics SAFE_INPUT clamps by
/// design — see src/game/states.ts).
enum Limits {
  static let minMass = 1.0
  static let maxMass = 5.0
  static let maxVelocityPerBody = 300.0  // px/s
}

/// Everything the setup phase remembers about a star, mutated in place by
/// the controls and frozen into a Body at countdown's end.
struct BodySpec {
  let player: Player
  var mass: Double
  var pos: CGPoint
  var vel: CGVector
}

func defaultSpec(_ player: Player, _ layout: CourtLayout) -> BodySpec {
  let r = layout.inBounds(for: player)
  return BodySpec(player: player, mass: 2.5, pos: CGPoint(x: r.midX, y: r.midY), vel: .zero)
}

/// Clamp a point into the player's in-bounds box, padded so the star body
/// stays fully inside (port of court.ts clampToInBounds, pad 24).
func clampToInBounds(_ p: CGPoint, _ layout: CourtLayout, _ player: Player, pad: CGFloat = 24) -> CGPoint {
  let r = layout.inBounds(for: player)
  return CGPoint(
    x: min(max(p.x, r.minX + pad), r.maxX - pad),
    y: min(max(p.y, r.minY + pad), r.maxY - pad)
  )
}

/// Uniform contain-fit of the design space into the live view (port of
/// src/render/fit.ts): the smaller axis ratio wins, leftovers letterbox.
struct Fit {
  let scale: CGFloat
  let offset: CGPoint

  init(view: CGSize, design: CGSize) {
    let s = min(view.width / design.width, view.height / design.height)
    scale = s
    offset = CGPoint(
      x: (view.width - design.width * s) / 2,
      y: (view.height - design.height * s) / 2
    )
  }

  func toDesign(_ p: CGPoint) -> CGPoint {
    CGPoint(x: (p.x - offset.x) / scale, y: (p.y - offset.y) / scale)
  }
}
