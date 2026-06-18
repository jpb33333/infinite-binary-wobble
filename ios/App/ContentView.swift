import SwiftUI
import WobblePhysics

// The single screen. TimelineView(.animation) drives the loop at the display's
// refresh rate; each frame we tick the model and hand it to GameRenderer, which
// paints the whole scene immediate-mode and returns the tappable-rect registry.
// The View owns the model + input; GameRenderer owns the paint — the same split
// the web game draws between Game and Renderer.
struct ContentView: View {
  @StateObject private var model = GameModel()

  var body: some View {
    GeometryReader { geo in
      TimelineView(.animation) { timeline in
        Canvas { ctx, size in
          // tick() mutates state; Canvas closures run per frame, so driving the
          // loop here keeps sim time locked to render time. The renderer only
          // PRODUCES the button registry; we commit it in one write
          // (double-buffer) so the paint never mutates the model mid-frame.
          model.tick(now: timeline.date.timeIntervalSinceReferenceDate)
          var renderer = GameRenderer(model: model)
          model.buttons = renderer.render(into: &ctx, size: size)
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
}
