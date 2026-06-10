// swift-tools-version: 5.9
import PackageDescription

// Pure-Swift physics core — zero UI dependencies, deterministic, and a
// 1:1 transliteration of the web game's src/physics/* + src/game/outcomes.ts.
// `swift test` runs on macOS or Linux; the golden-trajectory fixtures
// (exported from the TypeScript original) prove step-for-step parity.
let package = Package(
  name: "WobblePhysics",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "WobblePhysics", targets: ["WobblePhysics"])
  ],
  targets: [
    .target(name: "WobblePhysics"),
    .testTarget(
      name: "WobblePhysicsTests",
      dependencies: ["WobblePhysics"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
