import SwiftUI

// Starfield + stardust (ports of src/render/starfield.ts + particles.ts).
// Deterministic Mulberry32 seeds — the same field paints every launch, so
// the void feels like a place, not noise. Positions are normalized [0,1]
// and scaled to the live view at draw time (full-bleed); the generator is
// order-stable so growing the count only appends.

/// Mulberry32 — bit-exact port of the JS PRNG (32-bit wrapping arithmetic),
/// so the Swift sky is the SAME sky the web game shows.
struct Mulberry32 {
  private var s: UInt32
  init(seed: UInt32) { s = seed }
  mutating func next() -> Double {
    s = s &+ 0x6D2B79F5
    var t = (s ^ (s >> 15)) &* (s | 1)
    t = (t &+ ((t ^ (t >> 7)) &* (t | 61))) ^ t
    return Double(t ^ (t >> 14)) / 4294967296.0
  }
}

struct StarSpec {
  let x: Double, y: Double  // normalized [0, 1]
  let baseAlpha: Double
  let twinkleSpeed: Double
  let twinklePhase: Double
  let warmth: Double  // < 0.5 → cream, else rose
}

let STAR_DENSITY = 140.0 / (1280.0 * 800.0)

func starCount(for size: CGSize) -> Int {
  min(600, max(60, Int((STAR_DENSITY * size.width * size.height).rounded())))
}

func generateStarfield(count: Int, seed: UInt32 = 0xB1BB1E) -> [StarSpec] {
  var rng = Mulberry32(seed: seed)
  return (0..<count).map { _ in
    StarSpec(
      x: rng.next(), y: rng.next(),
      baseAlpha: 0.15 + rng.next() * 0.45,
      twinkleSpeed: 0.3 + rng.next() * 0.8,
      twinklePhase: rng.next() * .pi * 2,
      warmth: rng.next()
    )
  }
}

func drawStarfield(_ ctx: inout GraphicsContext, stars: [StarSpec], time: Double, size: CGSize) {
  var g = ctx
  g.blendMode = .plusLighter
  for s in stars {
    let twinkle = 0.6 + 0.4 * sin(s.twinklePhase + time * s.twinkleSpeed)
    let a = s.baseAlpha * twinkle
    let color = (s.warmth < 0.5 ? Palette.cream : Palette.rose).opacity(a)
    let r = 0.7 + 0.6 * twinkle
    let rect = CGRect(x: s.x * size.width - r, y: s.y * size.height - r, width: r * 2, height: r * 2)
    g.fill(Path(ellipseIn: rect), with: .color(color))
  }
}

// ── Stardust ──
// Two layers by design (mirrors the web Renderer): AMBIENT drifts in screen
// space full-bleed; BURST debris lives at design-space world coordinates and
// rides the contain-fit with the scene. Global cap 300.

private struct Particle {
  var x: Double, y: Double
  var vx: Double, vy: Double
  var age: Double
  let life: Double
  let size: Double
  let color: Color
}

final class Particles {
  private var particles: [Particle] = []
  private var rng: Mulberry32
  private static let maxParticles = 300

  init(seed: UInt32 = 0xFEED) { rng = Mulberry32(seed: seed) }

  /// Continuous low-density drift; call per frame (screen-space layer).
  func ambient(size: CGSize, dt: Double, target: Int = 36) {
    let cap = min(target, Self.maxParticles)
    while particles.count < cap { spawnDrift(size: size) }
    update(dt: dt, size: size)
  }

  func burst(at p: CGPoint, count: Int, color: Color, speed: Double = 220) {
    let room = Self.maxParticles - particles.count
    for _ in 0..<min(count, max(0, room)) {
      let angle = rng.next() * .pi * 2
      let s = speed * (0.3 + rng.next() * 0.7)
      particles.append(Particle(
        x: p.x, y: p.y,
        vx: cos(angle) * s, vy: sin(angle) * s,
        age: 0, life: 0.8 + rng.next() * 1.0,
        size: 1.5 + rng.next() * 2.5,
        color: color
      ))
    }
  }

  /// Burst layers don't respawn — just integrate and cull.
  func update(dt: Double, size: CGSize) {
    var i = particles.count - 1
    while i >= 0 {
      particles[i].age += dt
      if particles[i].age >= particles[i].life {
        particles.remove(at: i)
      } else {
        particles[i].x += particles[i].vx * dt
        particles[i].y += particles[i].vy * dt
      }
      i -= 1
    }
  }

  private func spawnDrift(size: CGSize) {
    let warm = rng.next()
    particles.append(Particle(
      x: rng.next() * size.width, y: rng.next() * size.height,
      vx: (rng.next() - 0.5) * 6, vy: (rng.next() - 0.5) * 6,
      age: 0, life: 4 + rng.next() * 6,
      size: 0.8 + rng.next() * 1.2,
      color: warm < 0.5 ? Palette.cream : Palette.rose
    ))
  }

  func draw(_ ctx: inout GraphicsContext) {
    var g = ctx
    g.blendMode = .plusLighter
    for p in particles {
      let fade = 1 - p.age / p.life
      let rect = CGRect(x: p.x - p.size, y: p.y - p.size, width: p.size * 2, height: p.size * 2)
      g.fill(Path(ellipseIn: rect), with: .color(p.color.opacity(0.5 * fade)))
    }
  }
}

/// Allocation-light ring buffer of past positions (port of trail.ts).
final class Trail {
  private var points: [CGPoint] = []
  private let capacity: Int
  private var write = 0
  private var filled = false

  init(capacity: Int = 700) { self.capacity = capacity }

  func push(_ x: Double, _ y: Double) {
    let p = CGPoint(x: x, y: y)
    if points.count < capacity { points.append(p) } else { points[write] = p }
    write = (write + 1) % capacity
    if points.count >= capacity { filled = true }
  }

  func reset() {
    points.removeAll(keepingCapacity: true)
    write = 0
    filled = false
  }

  /// Iterate oldest → newest; `t ∈ [0,1]` is normalized age (1 = newest).
  func forEach(_ body: (CGFloat, CGFloat, Double) -> Void) {
    let n = points.count
    guard n > 0 else { return }
    let start = filled ? write : 0
    let denom = n > 1 ? Double(n - 1) : 1
    for i in 0..<n {
      let p = points[(start + i) % n]
      body(p.x, p.y, Double(i) / denom)
    }
  }
}

func drawTrail(
  _ ctx: inout GraphicsContext, trail: Trail, color: Color,
  headAlpha: Double = 0.85, tailAlpha: Double = 0, width: CGFloat = 2.2
) {
  var prev: (CGFloat, CGFloat, Double)? = nil
  trail.forEach { x, y, t in
    if let (px, py, pt) = prev {
      let midT = (pt + t) * 0.5
      let a = tailAlpha + (headAlpha - tailAlpha) * midT
      var path = Path()
      path.move(to: CGPoint(x: px, y: py))
      path.addLine(to: CGPoint(x: x, y: y))
      ctx.stroke(path, with: .color(color.opacity(a)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }
    prev = (x, y, t)
  }
}
