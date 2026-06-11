// swift-tools-version:5.9
// (Tools-version must be the FIRST line of a pre-6.0 manifest; the upstream
// template carries it mid-file, which Swift 6 toolchains reject.)
//
// Rendered from gstack/ios-qa/templates/Package.swift.template (2026-06-10).
// Local SPM package for the /ios-qa debug bridge. Three targets:
//
//   - DebugBridgeCore   Swift, cross-platform (Foundation + Network).
//                       Hosts the StateServer + bridge protocols.
//   - DebugBridgeTouch  Objective-C, iOS-only. KIF-derived in-process touch
//                       synthesis (UITouch + IOHIDEvent + iOS 18
//                       _UIHitTestContext for SwiftUI hit-testing).
//   - DebugBridgeUI     Swift, iOS-only. ScreenshotBridge, ElementsBridge,
//                       MutationBridge implementations. Depends on the other
//                       two.
//
// Every line of source in all three targets is wrapped in #if DEBUG (and the
// iOS-only targets additionally in canImport(UIKit) / TARGET_OS_IOS), so a
// Release build compiles these modules to EMPTY objects — no server, no touch
// synthesis, no private-selector code ships to the App Store.
//
// Deviation from the template, documented: the template's testTarget and the
// DebugBridgeManager/AppState indirection are omitted. This app hand-wires
// the bridge in ios/App/DebugBridgeBootstrap.swift (see the PR for why the
// gen-accessors flow doesn't fit GameModel's private(set) style), so the
// placeholder layers would be unwired stubs — which this repo's rules forbid.

import PackageDescription

let package = Package(
    name: "DebugBridge",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "DebugBridgeCore", targets: ["DebugBridgeCore"]),
        .library(name: "DebugBridgeUI", targets: ["DebugBridgeUI"]),
        .library(name: "DebugBridgeTouch", targets: ["DebugBridgeTouch"]),
    ],
    targets: [
        .target(
            name: "DebugBridgeCore",
            dependencies: [],
            path: "Sources/DebugBridgeCore",
            swiftSettings: [
                .define("DEBUG", .when(configuration: .debug)),
            ]
        ),
        .target(
            name: "DebugBridgeTouch",
            dependencies: [],
            path: "Sources/DebugBridgeTouch",
            publicHeadersPath: "include",
            cSettings: [
                // Gives the Clang preprocessor DEBUG in debug builds only —
                // the ObjC touch-synth body is `#if defined(DEBUG) &&
                // TARGET_OS_IOS`, so Release compiles it to a no-op stub and
                // ships none of the private UIKit/IOKit symbols. SwiftPM
                // auto-defines DEBUG for Swift targets but NOT for Clang, so
                // this is required, not redundant (unlike the Swift targets').
                .define("DEBUG", .when(configuration: .debug)),
            ],
            linkerSettings: [
                // IOKit is loaded dynamically via dlopen at runtime (it's a
                // private framework on iOS and can't be linked statically).
                // UIKit links normally.
                .linkedFramework("UIKit", .when(platforms: [.iOS])),
            ]
        ),
        .target(
            name: "DebugBridgeUI",
            dependencies: ["DebugBridgeCore", "DebugBridgeTouch"],
            path: "Sources/DebugBridgeUI",
            swiftSettings: [
                .define("DEBUG", .when(configuration: .debug)),
            ]
        ),
    ]
)
