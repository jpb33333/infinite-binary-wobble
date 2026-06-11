//
//  DebugBridgeTouch.m — minimal port of KIF's in-process touch synthesis.
//  Original code: https://github.com/kif-framework/KIF — MIT-licensed
//  (Square, Inc. + KIF contributors). Adapted to a single-file, tap-only,
//  iOS 18+ aware subset for the gstack/ios-qa DebugBridge.
//
//  Uses these private UIKit selectors (DEBUG-only; never shipped to App Store):
//    UITouch:  _setLocationInWindow:resetPrevious:, _setIsFirstTouchForView:,
//              setPhase:, setTimestamp:, setView:, setWindow:, setTapCount:,
//              _setHidEvent:
//    UIEvent:  _clearTouches, _addTouch:forDelayedDelivery:, _setHIDEvent:
//    UIApplication: _touchesEvent
//    UIView:   _hitTestWithContext: (iOS 18+ for SwiftUI hit-testing)
//    NSObject: _UIHitTestContext contextWithPoint:radius: (iOS 18+)
//
//  IOKit private symbols (linked dynamically via the IOKit framework on iOS):
//    IOHIDEventCreateDigitizerEvent, IOHIDEventCreateDigitizerFingerEventWithQuality,
//    IOHIDEventSetIntegerValue, IOHIDEventAppendEvent.

#import "DebugBridgeTouch.h"
#import <TargetConditionals.h>

#if TARGET_OS_IOS

#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <mach/mach_time.h>

#pragma mark - IOHIDEvent (private symbols from IOKit)

typedef struct __IOHIDEvent * IOHIDEventRef;

#define IOHIDEventFieldBase(type) (type << 16)
#ifdef __LP64__
typedef double IOHIDFloat;
#else
typedef float IOHIDFloat;
#endif
typedef UInt32 IOOptionBits;
typedef uint32_t IOHIDDigitizerTransducerType;
typedef uint32_t IOHIDEventField;

enum {
    kIOHIDDigitizerTransducerTypeStylus = 0,
    kIOHIDDigitizerTransducerTypePuck,
    kIOHIDDigitizerTransducerTypeFinger,
    kIOHIDDigitizerTransducerTypeHand
};

enum {
    kIOHIDEventTypeDigitizer = 11,
};

enum {
    kIOHIDDigitizerEventRange    = 0x00000001,
    kIOHIDDigitizerEventTouch    = 0x00000002,
    kIOHIDDigitizerEventPosition = 0x00000004,
};

enum {
    kIOHIDEventFieldDigitizerX = IOHIDEventFieldBase(kIOHIDEventTypeDigitizer),
    kIOHIDEventFieldDigitizerY,
    kIOHIDEventFieldDigitizerZ,
    kIOHIDEventFieldDigitizerButtonMask,
    kIOHIDEventFieldDigitizerType,
    kIOHIDEventFieldDigitizerIndex,
    kIOHIDEventFieldDigitizerIdentity,
    kIOHIDEventFieldDigitizerEventMask,
    kIOHIDEventFieldDigitizerRange,
    kIOHIDEventFieldDigitizerTouch,
    kIOHIDEventFieldDigitizerPressure,
    kIOHIDEventFieldDigitizerAuxiliaryPressure,
    kIOHIDEventFieldDigitizerTwist,
    kIOHIDEventFieldDigitizerTiltX,
    kIOHIDEventFieldDigitizerTiltY,
    kIOHIDEventFieldDigitizerAltitude,
    kIOHIDEventFieldDigitizerAzimuth,
    kIOHIDEventFieldDigitizerQuality,
    kIOHIDEventFieldDigitizerDensity,
    kIOHIDEventFieldDigitizerIrregularity,
    kIOHIDEventFieldDigitizerMajorRadius,
    kIOHIDEventFieldDigitizerMinorRadius,
    kIOHIDEventFieldDigitizerCollection,
    kIOHIDEventFieldDigitizerCollectionChord,
    kIOHIDEventFieldDigitizerChildEventMask,
    kIOHIDEventFieldDigitizerIsDisplayIntegrated,
};

// IOKit is a PRIVATE framework on iOS — we can't link it via -framework. Load
// at runtime via dlopen/dlsym. This is the standard approach for KIF-style
// touch synthesis on iOS, including in DEBUG-only test harnesses.
#import <dlfcn.h>

typedef IOHIDEventRef (*IOHIDEventCreateDigitizerEventFn)(CFAllocatorRef, AbsoluteTime,
    IOHIDDigitizerTransducerType, uint32_t, uint32_t, uint32_t, uint32_t,
    IOHIDFloat, IOHIDFloat, IOHIDFloat, IOHIDFloat, IOHIDFloat, Boolean, Boolean, IOOptionBits);

typedef IOHIDEventRef (*IOHIDEventCreateDigitizerFingerEventWithQualityFn)(CFAllocatorRef,
    AbsoluteTime, uint32_t, uint32_t, uint32_t, IOHIDFloat, IOHIDFloat, IOHIDFloat,
    IOHIDFloat, IOHIDFloat, IOHIDFloat, IOHIDFloat, IOHIDFloat, IOHIDFloat,
    IOHIDFloat, Boolean, Boolean, IOOptionBits);

typedef void (*IOHIDEventSetIntegerValueFn)(IOHIDEventRef, IOHIDEventField, int);
typedef void (*IOHIDEventAppendEventFn)(IOHIDEventRef, IOHIDEventRef);

static IOHIDEventCreateDigitizerEventFn _IOHIDEventCreateDigitizerEvent;
static IOHIDEventCreateDigitizerFingerEventWithQualityFn _IOHIDEventCreateDigitizerFingerEventWithQuality;
static IOHIDEventSetIntegerValueFn _IOHIDEventSetIntegerValue;
static IOHIDEventAppendEventFn _IOHIDEventAppendEvent;

static BOOL _IOKitLoaded = NO;
static BOOL DBT_LoadIOKit(void) {
    if (_IOKitLoaded) return YES;
    void *handle = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW);
    if (!handle) {
        handle = dlopen("/System/Library/PrivateFrameworks/IOKit.framework/IOKit", RTLD_NOW);
    }
    if (!handle) return NO;
    _IOHIDEventCreateDigitizerEvent = (IOHIDEventCreateDigitizerEventFn)dlsym(handle, "IOHIDEventCreateDigitizerEvent");
    _IOHIDEventCreateDigitizerFingerEventWithQuality = (IOHIDEventCreateDigitizerFingerEventWithQualityFn)dlsym(handle, "IOHIDEventCreateDigitizerFingerEventWithQuality");
    _IOHIDEventSetIntegerValue = (IOHIDEventSetIntegerValueFn)dlsym(handle, "IOHIDEventSetIntegerValue");
    _IOHIDEventAppendEvent = (IOHIDEventAppendEventFn)dlsym(handle, "IOHIDEventAppendEvent");
    _IOKitLoaded = (_IOHIDEventCreateDigitizerEvent && _IOHIDEventCreateDigitizerFingerEventWithQuality &&
                    _IOHIDEventSetIntegerValue && _IOHIDEventAppendEvent);
    return _IOKitLoaded;
}

static IOHIDEventRef DBT_IOHIDEventWithTouch(UITouch *touch) CF_RETURNS_RETAINED;
static IOHIDEventRef DBT_IOHIDEventWithTouch(UITouch *touch) {
    if (!DBT_LoadIOKit()) return NULL;
    uint64_t abTime = mach_absolute_time();
    AbsoluteTime timeStamp;
    timeStamp.hi = (UInt32)(abTime >> 32);
    timeStamp.lo = (UInt32)(abTime);

    IOHIDEventRef handEvent = _IOHIDEventCreateDigitizerEvent(kCFAllocatorDefault,
        timeStamp, kIOHIDDigitizerTransducerTypeHand,
        0, 0, kIOHIDDigitizerEventTouch, 0,
        0, 0, 0, 0, 0,
        0, true, 0);
    _IOHIDEventSetIntegerValue(handEvent, kIOHIDEventFieldDigitizerIsDisplayIntegrated, 1);

    uint32_t eventMask = (touch.phase == UITouchPhaseMoved)
        ? kIOHIDDigitizerEventPosition
        : (kIOHIDDigitizerEventRange | kIOHIDDigitizerEventTouch);
    uint32_t isTouching = (touch.phase == UITouchPhaseEnded) ? 0 : 1;

    CGPoint loc = [touch locationInView:touch.window];

    IOHIDEventRef fingerEvent = _IOHIDEventCreateDigitizerFingerEventWithQuality(kCFAllocatorDefault,
        timeStamp, 1, 2, eventMask,
        (IOHIDFloat)loc.x, (IOHIDFloat)loc.y, 0.0,
        0, 0, 5.0, 5.0, 1.0, 1.0, 1.0,
        (IOHIDFloat)isTouching, (IOHIDFloat)isTouching, 0);
    _IOHIDEventSetIntegerValue(fingerEvent, kIOHIDEventFieldDigitizerIsDisplayIntegrated, 1);

    _IOHIDEventAppendEvent(handEvent, fingerEvent);
    CFRelease(fingerEvent);

    return handEvent;
}

#pragma mark - Private selectors

@interface UITouch ()
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setPhase:(UITouchPhase)touchPhase;
- (void)setGestureView:(UIView *)view;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)resetPrevious;
- (void)_setIsFirstTouchForView:(BOOL)firstTouchForView;
- (void)_setHidEvent:(IOHIDEventRef)event;
@end

@interface UIEvent (DBTPrivate)
- (void)_clearTouches;
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_setHIDEvent:(IOHIDEventRef)event;
- (void)_setTimestamp:(NSTimeInterval)timestamp;
@end

@interface UIApplication (DBTPrivate)
- (UIEvent *)_touchesEvent;
@end

@interface UIView (DBTPrivate)
- (id)_hitTestWithContext:(id)context;
@end

#pragma mark - SwiftUI-aware hit test (iOS 18+)

// Returns `id` because iOS 18's _hitTestWithContext: can return either a UIView
// OR a SwiftUI.UIKitGestureContainer (a plain UIResponder, NOT a UIView).
// The latter is the case for SwiftUI Buttons. KIF's observation: the returned
// responder is still compatible with UITouch.setView: even when it isn't a
// UIView — so we pass it through as-is. Filtering by isKindOfClass:UIView
// here would drop every SwiftUI Button tap silently. Mirrors KIF PR #1323.
static id DBT_HitTestView(UIWindow *window, CGPoint point) {
    UIView *fallback = [window hitTest:point withEvent:nil];

    if (@available(iOS 18.0, *)) {
        Class ctxClass = NSClassFromString(@"_UIHitTestContext");
        SEL ctxSel = NSSelectorFromString(@"contextWithPoint:radius:");
        if (ctxClass && [ctxClass respondsToSelector:ctxSel] &&
            [UIView instancesRespondToSelector:@selector(_hitTestWithContext:)]) {
            id (*sendCtx)(id, SEL, CGPoint, CGFloat) =
                (id (*)(id, SEL, CGPoint, CGFloat))objc_msgSend;
            id ctx = sendCtx(ctxClass, ctxSel, point, 0);
            if (ctx) {
                id found = nil;
                UIView *current = fallback;
                while (found == nil && current != nil) {
                    found = [current _hitTestWithContext:ctx];
                    current = current.superview;
                }
                if (found) {
                    return found;
                }
            }
        }
    }
    return fallback;
}

#pragma mark - Public API

// DEVIATION from the upstream template (2026-06-10): the template's tap sent
// Began→Ended back-to-back in ONE run-loop turn. UIKit target-action sees
// that; SwiftUI gesture recognizers (DragGesture et al.) sample touches
// across run-loop turns and never see it — taps on a SwiftUI Canvas app were
// silently ignored (verified live: 200-ok tap, zero state change). The
// rewrite phase-separates every touch with main-run-loop spins and adds a
// real drag primitive (Began → interpolated Moved @~60Hz → Ended), which
// gesture-driven apps need anyway. Blocking the @MainActor request handler
// while the run loop spins is intentional: frames keep pumping (that's the
// point), and the device session lock already serializes mutations.

@implementation DebugBridgeTouch

// Build the synthetic touch via private setters. Order matters — setWindow:
// clears internal state and must come first. setView: is typed UIView * but
// accepts SwiftUI.UIKitGestureContainer (UIResponder) too — that's how
// SwiftUI Buttons get routed on iOS 18+.
static UITouch *DBT_BeginTouch(UIWindow *window, CGPoint point, id hit) {
    UITouch *touch = [[UITouch alloc] init];
    [touch setWindow:window];
    [touch setTapCount:1];
    [touch _setLocationInWindow:point resetPrevious:YES];
    [touch setView:(UIView *)hit];
    [touch setPhase:UITouchPhaseBegan];
    if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) {
        [touch _setIsFirstTouchForView:YES];
    }
    [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
    if ([touch respondsToSelector:@selector(setGestureView:)] &&
        [hit isKindOfClass:[UIView class]]) {
        [touch setGestureView:(UIView *)hit];
    }
    return touch;
}

// Wrap the touch's CURRENT state in a fresh IOHIDEvent (required iOS 9+) and
// push it through UIApplication.sendEvent — the same dispatch path real
// touches take.
static BOOL DBT_DispatchPhase(UITouch *touch) {
    IOHIDEventRef hid = DBT_IOHIDEventWithTouch(touch);
    [touch _setHidEvent:hid];
    UIEvent *event = [[UIApplication sharedApplication] _touchesEvent];
    if (!event) {
        CFRelease(hid);
        return NO;
    }
    [event _clearTouches];
    [event _setHIDEvent:hid];
    [event _addTouch:touch forDelayedDelivery:NO];
    [[UIApplication sharedApplication] sendEvent:event];
    CFRelease(hid);
    return YES;
}

// Let the main run loop breathe between phases so gesture recognizers (and
// the app's own frame loop) observe the touch like a human one.
static void DBT_SpinRunLoop(NSTimeInterval seconds) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

+ (BOOL)sendTapAtPoint:(CGPoint)point inWindow:(UIWindow *)window {
    // A tap is a stationary drag: Began, ~5 frames of dwell, Ended.
    return [self sendDragFrom:point to:point durationMs:80 inWindow:window];
}

+ (BOOL)sendDragFrom:(CGPoint)from
                  to:(CGPoint)to
          durationMs:(NSInteger)durationMs
            inWindow:(UIWindow *)window {
    if (!window) return NO;
    id hit = DBT_HitTestView(window, from);
    if (!hit) return NO;

    UITouch *touch = DBT_BeginTouch(window, from, hit);
    if (!DBT_DispatchPhase(touch)) return NO;

    NSInteger steps = MAX(1, durationMs / 16);  // ~60 Hz move cadence
    BOOL stationary = CGPointEqualToPoint(from, to);
    for (NSInteger i = 1; i <= steps; i++) {
        DBT_SpinRunLoop(0.016);
        if (stationary) continue;
        CGFloat t = (CGFloat)i / (CGFloat)steps;
        CGPoint p = CGPointMake(from.x + (to.x - from.x) * t,
                                from.y + (to.y - from.y) * t);
        [touch _setLocationInWindow:p resetPrevious:NO];
        [touch setPhase:UITouchPhaseMoved];
        [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
        if (!DBT_DispatchPhase(touch)) return NO;
    }

    DBT_SpinRunLoop(0.016);
    [touch _setLocationInWindow:to resetPrevious:NO];
    [touch setPhase:UITouchPhaseEnded];
    [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
    return DBT_DispatchPhase(touch);
}

@end

#else // !TARGET_OS_IOS

// macOS / Catalyst / other non-iOS host build: no-op stub so the module
// resolves cleanly without UIKit or IOKit. The Swift cross-platform tests
// don't exercise touch synthesis; that's iOS-only by definition.
@implementation DebugBridgeTouch
+ (BOOL)sendTapAtPoint:(CGPoint)point inWindow:(UIWindow *)window {
    (void)point; (void)window;
    return NO;
}
+ (BOOL)sendDragFrom:(CGPoint)from
                  to:(CGPoint)to
          durationMs:(NSInteger)durationMs
            inWindow:(UIWindow *)window {
    (void)from; (void)to; (void)durationMs; (void)window;
    return NO;
}
@end

#endif // TARGET_OS_IOS
