# Infinite Binary Wobble — native iOS app

The native Swift port specced in [`../docs/IOS_NATIVE_APP_PLAN.md`](../docs/IOS_NATIVE_APP_PLAN.md):
SwiftUI `Canvas` driven by `TimelineView(.animation)`, pure-Swift physics, no
game engine, no network, no data collected. Physics, constants, outcome rules,
layouts (landscape **and** stacked portrait) and the *Her* palette are 1:1 with
the web original — and the golden-trajectory tests prove it numerically.

## Layout

| Path | What |
|---|---|
| `WobblePhysics/` | SPM package: Vec2 · Body · Gravity · PEFRL Integrator · Orbit · Simulation · Outcomes. Zero UI imports; `swift test` runs on macOS or Linux. |
| `WobblePhysics/Tests/` | XCTest port of the web Vitest invariants (energy, momentum, escape, softening, outcomes), a **constants guard** pinning every play-tuned constant to its exact contractual value, **plus** golden-trajectory parity against fixtures exported from the TypeScript engine. The suite loads the bundled copies in `Tests/WobblePhysicsTests/Fixtures/`; `npm run export:fixtures` (repo root) regenerates them and `../tests/fixtures/` together, and CI asserts the two stay identical. |
| `App/` | SwiftUI app: GameModel (state machine + fixed-step accumulator + input routing), Canvas rendering (starfield, court, painterly stars, trails, predicted orbits, supernova, HUD, cards), haptics, session scoreboard. |
| `project.yml` | XcodeGen spec for the app target. |

## Build & test

```sh
# Physics parity suite — no Xcode project needed:
cd ios/WobblePhysics && swift test

# App:
brew install xcodegen
cd ios && xcodegen generate
open InfiniteBinaryWobble.xcodeproj   # set your team, run on a device
```

## Fonts (bundled)

**Cardo** (wordmark/cards) and **Inter** (UI labels) ship in the repo at
`App/Resources/Fonts/` — six SIL-OFL TTFs harvested from the original
standalone iOS repo, wired through `project.yml`'s `UIAppFonts` (so
`xcodegen generate` does all the plumbing; nothing to download or click).
The full OFL license text plus per-file SHA-256 provenance lives in
`App/Resources/FontLicenses.txt` — surface the "Built with Cardo and Inter"
credit in any future About screen (see `../docs/ios/ABOUT-SCREEN.md`).
If a font ever fails to load, `Theme.swift` degrades to the system
serif/sans designs — fully functional, slightly different voice.

## Product docs

The standalone-repo launch effort's docs were harvested into
[`../docs/ios/`](../docs/ios/) with provenance banners: `ROADMAP-IOS.md`
(saved/sent wobbles, the 1000-free-plays meter decision, north star),
`V1-LOCK.md` (the superseded V1 launch plan — useful App Store mechanics),
and `ABOUT-SCREEN.md` (final copy for the not-yet-built About screen).

## Fidelity notes

- The physics module reproduces the web engine bit-for-bit in IEEE-754 terms
  (same operations, same order); `GoldenTrajectoryTests` asserts sampled
  positions/velocities to 1e-6 px over thousands of steps.
- The outcome thresholds (warmup 0.6 s, 2 orbits, e ≤ 0.93, 820 px envelope,
  0.6 s grace) are the play-tuned web values — do not retune them here.
- Portrait stacks the courts P1-top/P2-bottom in an 800×1280 design space
  (the transpose of landscape, same half-diagonal) exactly like the web build.
- The per-session scoreboard is in-memory by design (the web version's
  session cookie equivalent). Nothing is persisted, transmitted or tracked —
  App Privacy label: **Data Not Collected**.

## App Store checklist (from the plan, §8)

1. App ID + bundle id (`com.bowditch.infinitebinarywobble`), automatic
   signing with your team.
2. Icon set (reuse `../public/icon-512.png` artwork at 1024²), launch screen
   is generated (void background).
3. App Store Connect: Games → Puzzle/Family, 4+, screenshots from device.
4. App Privacy: Data Not Collected. Review notes: local 2-player game, one
   device, no login, fully offline.
5. TestFlight internal build → submit.
