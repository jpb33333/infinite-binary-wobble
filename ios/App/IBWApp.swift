import SwiftUI

// Infinite Binary Wobble — native iOS port of the web game
// (https://jpb33333.github.io/infinite-binary-wobble/), per
// docs/IOS_NATIVE_APP_PLAN.md: SwiftUI Canvas + TimelineView rendering,
// pure-Swift physics (WobblePhysics package), no game engine, no network,
// no data collected.
@main
struct IBWApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
        .preferredColorScheme(.dark)
    }
  }
}
