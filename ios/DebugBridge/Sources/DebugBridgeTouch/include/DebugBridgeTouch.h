//
//  DebugBridgeTouch.h — public Objective-C interface for in-process touch
//  synthesis. Implementation derived from KIF (https://github.com/kif-framework/KIF),
//  MIT-licensed. The minimal subset needed to deliver a real UITouch to a
//  point on the key window, including SwiftUI Buttons via iOS 18+
//  _UIHitTestContext. DEBUG-only — never link in Release.

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <TargetConditionals.h>

#if TARGET_OS_IOS
#import <UIKit/UIKit.h>
#else
// macOS build: forward-declare UIWindow so the module compiles without UIKit.
// The host CI runs swift build on macOS to validate the cross-platform Swift
// surface; DebugBridgeTouch's implementation is a no-op there. On iOS the
// real UIWindow comes from UIKit and the implementation is active.
@class UIWindow;
#endif

NS_ASSUME_NONNULL_BEGIN

@interface DebugBridgeTouch : NSObject

/// Synthesize a single tap (Began → ~80ms dwell → Ended, phase-separated by
/// run-loop spins so SwiftUI gesture recognizers see it) at the given
/// window-coordinate point. Returns YES if the touch was delivered (a hit
/// view was found and the event passed through UIApplication.sendEvent).
/// On non-iOS platforms returns NO unconditionally.
+ (BOOL)sendTapAtPoint:(CGPoint)point inWindow:(UIWindow *)window;

/// Synthesize a real touch drag: Began at `from`, interpolated Moved events
/// at ~60Hz over `durationMs`, Ended at `to`. Spins the main run loop
/// between phases (blocks the caller for the drag duration — intentional).
/// This is what drives SwiftUI DragGesture; added 2026-06-10 (the upstream
/// template was tap-only). On non-iOS platforms returns NO unconditionally.
+ (BOOL)sendDragFrom:(CGPoint)from
                  to:(CGPoint)to
          durationMs:(NSInteger)durationMs
            inWindow:(UIWindow *)window;

@end

NS_ASSUME_NONNULL_END
