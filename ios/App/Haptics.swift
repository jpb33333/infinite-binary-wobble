import UIKit

// The native niceties the plan calls for (§6): a tick on Lock In, a sharp
// thud on collision, a soft success on WIN. Generators are kept warm; all
// calls are fire-and-forget and safe off the happy path.
enum Haptics {
  private static let impact = UIImpactFeedbackGenerator(style: .medium)
  private static let heavy = UIImpactFeedbackGenerator(style: .heavy)
  private static let notify = UINotificationFeedbackGenerator()

  static func lockIn() { impact.impactOccurred() }
  static func collision() { heavy.impactOccurred(intensity: 1.0) }
  static func win() { notify.notificationOccurred(.success) }
}
