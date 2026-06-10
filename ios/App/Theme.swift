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

// Cardo (serif: wordmark, cards) + Inter (sans: UI labels) — both SIL OFL,
// bundled as app resources. Fall back to the system designs so a missing
// font file degrades gracefully instead of crashing.
enum Fonts {
  static func serif(_ size: CGFloat, italic: Bool = false) -> Font {
    let name = italic ? "Cardo-Italic" : "Cardo-Regular"
    if UIFont(name: name, size: size) != nil {
      return .custom(name, size: size)
    }
    let f = Font.system(size: size, design: .serif)
    return italic ? f.italic() : f
  }

  static func sans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    if UIFont(name: "Inter-Regular", size: size) != nil {
      return .custom("Inter-Regular", size: size).weight(weight)
    }
    return .system(size: size, weight: weight)
  }
}
