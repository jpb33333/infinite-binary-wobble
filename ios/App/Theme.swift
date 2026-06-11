import SwiftUI

// The "Her" warm palette — verbatim hexes from src/theme.ts. Warm tones
// throughout; no blues, no greens, no neon. Every color in the app comes
// from here.
enum Palette {
  static let voidDeep = Color(hex: 0x1A0F14)
  static let player1 = Color(hex: 0xE8956F)
  static let player2 = Color(hex: 0xD97D3D)
  static let rose = Color(hex: 0xF4A58D)
  static let cream = Color(hex: 0xFFC89B)
  static let terracotta = Color(hex: 0xA3685C)
  static let wine = Color(hex: 0x6F1D1B)
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

/// Linear sRGB blend between two palette colors — the Doppler tint mechanism
/// (port of theme.ts blendHex). t = 0 → a, t = 1 → b.
func blendColor(_ a: Color, _ b: Color, _ t: Double) -> Color {
  let k = min(max(t, 0), 1)
  let ca = UIColor(a), cb = UIColor(b)
  var ar: CGFloat = 0, ag: CGFloat = 0, ab2: CGFloat = 0, aa: CGFloat = 0
  var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
  ca.getRed(&ar, green: &ag, blue: &ab2, alpha: &aa)
  cb.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
  return Color(
    .sRGB,
    red: ar + (br - ar) * k,
    green: ag + (bg - ag) * k,
    blue: ab2 + (bb - ab2) * k,
    opacity: 1
  )
}

// Legibility compensation for contain-fit text (QA finding, 2026-06-10,
// found by JP on an iPhone 14): the 800×1280 portrait design space lands on
// iPhone screens at ~0.49× scale, so every design-px font renders at half
// size — 12px help text became ~5.9pt against Apple's ~11pt legibility
// floor. Fonts are drawn inside the fit-scaled canvas context, so the
// compensation happens here in design units: text that would land below
// `floorPt` on screen is pulled up toward it, compressing (slope) but never
// reversing the size hierarchy; text already at/above the floor — display
// type, and ALL text on large-scale fits like iPad (~0.92×) — is untouched.
// Continuous at the floor boundary by construction.
enum Typography {
  /// Live contain-fit scale, written by ContentView.render each frame.
  /// 0 (pre-first-frame) means "no compensation".
  static var fitScale: CGFloat = 0
  static let floorPt: CGFloat = 11 // on-screen points
  static let slope: CGFloat = 0.2  // how much sub-floor deficit survives

  static func compensate(_ designSize: CGFloat) -> CGFloat {
    guard fitScale > 0 else { return designSize }
    let pt = designSize * fitScale
    guard pt < floorPt else { return designSize }
    return (floorPt - (floorPt - pt) * slope) / fitScale
  }

  /// Line advance for compensated text — call sites hardcode design-px line
  /// heights tuned for UNcompensated sizes; this keeps wrapped/stacked text
  /// from overlapping once it grows. 1.35 leading: tight enough that the
  /// 3-line setup help clears the court's top edge and the Carse footer
  /// stays inside the win card (verified by /ios-qa screenshots).
  static func lineHeight(for designSize: CGFloat) -> CGFloat {
    compensate(designSize) * 1.35
  }
}

// Cardo (serif: wordmark, cards) + Inter (sans: UI labels) — both SIL OFL,
// bundled as app resources. Fall back to the system designs so a missing
// font file degrades gracefully instead of crashing. Sizes pass through
// Typography.compensate (legibility floor) — call sites stay in design px.
enum Fonts {
  static func serif(_ size: CGFloat, italic: Bool = false) -> Font {
    let s = Typography.compensate(size)
    let name = italic ? "Cardo-Italic" : "Cardo-Regular"
    if UIFont(name: name, size: s) != nil {
      return .custom(name, size: s)
    }
    let f = Font.system(size: s, design: .serif)
    return italic ? f.italic() : f
  }

  static func sans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    let s = Typography.compensate(size)
    if UIFont(name: "Inter-Regular", size: s) != nil {
      return .custom("Inter-Regular", size: s).weight(weight)
    }
    return .system(size: s, weight: weight)
  }
}
