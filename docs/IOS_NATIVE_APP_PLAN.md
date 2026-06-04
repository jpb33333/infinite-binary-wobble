# Infinite Binary Wobble — Native iOS App Plan

Plan to ship a **native Swift** iOS app to the App Store, iOS-only, portrait +
landscape playable, signed with JP's Apple Developer Program account.

Status: PLAN (no code yet). Decisions locked 2026-06-03: native Swift rewrite
(not Capacitor), portrait playable (not landscape-only).

---

## 1. Why native, and the honest tradeoff

The web game (this repo) is vanilla TS + a single `<canvas>`, fully working and
tested. A native rewrite does **not** reuse that code — it becomes a second,
parallel codebase. We accepted that for: best native feel and perf, a real
Swift codebase to grow, no WKWebView wrapper, no App Store 4.2 "thin wrapper"
risk.

What *does* transfer for free: the entire **game design and physics**, which is
pure math. The constants, the integrator, the orbit formulas, and the win/lose
rules below are the source of truth — the Swift port must reproduce them
exactly, and the existing Vitest invariants become XCTest invariants.

The live web version keeps living on its own (GitHub Pages). See §11 for what,
if anything, we change there in the interim.

---

## 2. Stack recommendation: SwiftUI + Canvas + TimelineView

**Rendering: SwiftUI `Canvas` driven by `TimelineView(.animation)`. Physics:
plain Swift value types. No game engine.**

Why this over the alternatives:

- The current renderer is **immediate-mode** — every frame it redraws the whole
  scene from state (`Renderer.render(input)`). SwiftUI's `Canvas { ctx, size in
  … }` is the same model: a draw closure that paints from state each frame. The
  port is close to 1:1, layer for layer. `GraphicsContext` supports paths,
  gradients, text, image, clipping, and **blend modes** (`.plusLighter`) — which
  is exactly what the glow/star/trail additive compositing needs
  (`globalCompositeOperation = 'lighter'` today).
- `TimelineView(.animation)` redraws at the display's refresh rate (incl. 120Hz
  ProMotion) and is the idiomatic continuous-loop driver — perfect for the
  "watch the wobble forever after a WIN" requirement.
- SwiftUI gives us **orientation + safe-area + size-class layout for free**,
  which is the backbone of the portrait/landscape requirement (§5).
- Our scene is light: ≤600 stars, 2 bodies, 2 trails, ≤300 particles, HUD. Canvas
  is Metal-backed and handles this at 60/120fps with headroom.

**Alternative considered — SpriteKit:** the idiomatic 2D *game* engine, with free
`SKEmitterNode` particles and a robust loop. But it's a **retained scene-graph**
(you manage node lifecycles per star/trail/particle), a different paradigm from
our per-frame procedural drawing. More porting friction, less fidelity to the
current code, for no real win at our scene size. Keep it as a fallback only if
particle-heavy frames ever miss frame budget.

**Physics stays pure Swift** either way — SpriteKit's built-in physics can't do
custom PEFRL gravity, and we don't want it to. The physics is a standalone,
fully-tested module.

> Open technical decision: SwiftUI Canvas (recommended) vs SpriteKit. I'll go
> SwiftUI Canvas unless you'd rather commit to SpriteKit.

---

## 3. Faithful port spec — the source of truth

The Swift physics module must reproduce these **exactly**. All values are from
the current source; pixel units for position, seconds for time, arbitrary mass.

### Constants (`physics/Simulation.ts` → `Physics.swift`)
- `G = 1.5e7`
- `SOFTENING = 6` (Plummer ε)
- `DT = 1/240`, `SUBSTEPS_PER_FRAME = 4` (→ 1/60 s per display step)
- `WARMUP_SECONDS = 0.6`
- Body visual radius: `14 · sqrt(mass)` (`RADIUS_BASE = 14`)
- UI limits (`LIMITS`): `minMass 1.0`, `maxMass 5.0`, `maxVelocityPerBody 300` px/s
- Safe-input clamps at the physics boundary (defense-in-depth): mass [0.01, 1e3]
  default 2.5; |pos| ≤ 1e5; |vel component| ≤ 1e4; non-finite → default.

### Gravity (`gravity.ts`) — Plummer-softened Newtonian
```
dx, dy = b.pos − a.pos ; rSq = dx²+dy²
denom = (rSq + ε²)^1.5
a.accel =  (G·b.mass / denom) · (dx, dy)
b.accel = −(G·a.mass / denom) · (dx, dy)
```

### Integrator (`integrator.ts`) — PEFRL 4th-order symplectic
Constants: `ξ = 0.1786178958448091`, `λ = −0.2123418310626054`,
`χ = −0.06626458266981849`. One step = D K D K D K D K D (5 drifts, 4 kicks, 4
force evals), coefficients exactly as in source. Drift: `pos += vel·c`. Kick:
`vel += accel·c` with gravity recomputed before each kick.

### Orbit diagnostics (`orbit.ts`)
Specific energy `ε = ½v_rel² − G·M/r`; `E = μ·ε` (μ = m₁m₂/M); `h = |r × v_rel|`;
`e = sqrt(1 + 2εh²/(GM)²)`; `a = −GM/(2ε)` (∞ if ε≥0); `T = 2π·sqrt(a³/GM)`;
escape vel `sqrt(2GM/r)`; argument of periapsis from eccentricity vector;
`bound = ε < 0`.

### Outcome classifier (`outcomes.ts`)
Config: `warmup 0.6`, `winOrbitsRequired 2`, `winMaxEccentricity 0.93`,
`offCanvasGraceSeconds 0.6`, `maxBodyDistanceFromBarycenter 820`.
Each frame: unwrap relative-position angle → `completedOrbits` (keeps counting
after WIN). Then, while unresolved:
1. **Collision** (instant): `separation < radius(a)+radius(b)` → `lose_collision`.
2. Before warmup: stay `playing`.
3. Compute mass-weighted barycenter; `maxBodyDist = max(dist(a,bc), dist(b,bc))`.
   If `> 820` for ≥ `0.6 s`: `lose_slingshot` if bound else `lose_escape`.
4. Else reset the off-canvas timer; **WIN** iff `bound && e ≤ 0.93 && orbits ≥ 2`.

### Theme (`theme.ts`) — "Her" warm palette, no blues/greens
`voidDeep #1A0F14`, `player1 #E8956F`, `player2 #D97D3D`, `rose #F4A58D`,
`cream #FFC89B`, `terracotta #A3685C`, `wine #6F1D1B`. Fonts: **Cardo** (serif,
wordmark/cards), **Inter** (sans, UI). Bundle both as app resources.

### Controls (from `src/ui/`)
- **Position**: drag within your in-bounds square to place the star (clamped,
  24px pad).
- **Mass**: scroll / ± pills, range 1–5; radius scales with √mass.
- **Velocity**: drag *outward from the star body* to set the vector (length =
  px/s, capped at 300), tooltip shows magnitude.

### Render layers (from `src/render/`)
starfield (full-bleed, twinkle) · court (region wash, glowing center line,
dotted in-bounds boxes) · velocity arrow · orbit trails · stars with glow +
Doppler tint · particles (ambient drift + collision burst) · supernova
(flash → shockwave → remnant) · HUD (ENERGY/ECC/PERIOD/ORBITS/TIME) · overlays
(wordmark, session stats, phase label, buttons, tooltip, outcome card) ·
camera follow barycenter.

---

## 4. Project structure

New Xcode project (SwiftUI App lifecycle), iOS 17+ deployment target. Suggested
layout — a clean separation that mirrors the web `src/`:

```
InfiniteBinaryWobble/            (Xcode project / new repo)
  Package: Physics/  (pure Swift, no UIKit — unit-testable, deterministic)
    Vec2.swift  Body.swift  Gravity.swift  Integrator.swift
    Orbit.swift  Simulation.swift  Outcomes.swift
  Game/        GameState.swift  Layout.swift  Stats.swift  Theme.swift
  Render/      Scene drawing split per layer (Canvas helpers)
  Input/       PositionControl / MassControl / ArrowControl (gesture → state)
  App/         App entry, ContentView, orientation, haptics, safe areas
  Resources/   Cardo + Inter fonts, app icon, launch screen, Doppler/colors
  Tests/       PhysicsTests (XCTest port of the Vitest suite)
```

The `Physics` target has **zero UI dependencies**, so the test suite runs fast
and the determinism invariants port directly.

---

## 5. Orientation & layout (the portrait requirement)

The game is two-player **side-by-side** by design. Making portrait genuinely
playable means an **orientation-aware layout**, not just letting it shrink.

Approach:
- Keep the **simulation** in a fixed, centered, roughly-square design space
  (so the tuned thresholds — `maxBodyDist 820`, separations, the WIN envelope —
  stay valid regardless of device aspect). The orbit always plays in this
  centered field, contain-fit to the screen, full-bleed starfield behind it
  (same model the web now uses).
- **Reflow the setup courts + HUD by orientation:**
  - **Landscape:** courts side-by-side (P1 left, P2 right) — today's layout.
  - **Portrait:** courts stacked (P1 top, P2 bottom), HUD along the bottom.
    "Two players, one phone, pass it between turns" reads naturally vertically.
- SwiftUI size classes / `GeometryReader` drive the switch; the in-bounds
  squares, center divider (horizontal vs vertical), and control bar positions
  are computed from the live size.
- **Spike first:** before committing, prototype the portrait court split and
  confirm the setup drag + velocity-arrow gestures feel right at phone size.
  This is the one genuinely new design surface; everything else is a port.

Decision to confirm during the spike: does the *simulation* design space rotate
with orientation, or stay fixed square? Recommendation: fixed square sim space,
reflow only setup/HUD chrome — least physics risk.

---

## 6. Native niceties (what makes it feel like an app, not a port)

- **Haptics** (`CoreHaptics` / `UIImpactFeedbackGenerator`): a tick on Lock In,
  a sharp thud on collision, a soft success on WIN.
- **Safe areas / notch / home indicator:** SwiftUI honors them; starfield bleeds
  under, interactive controls stay inside `safeAreaInsets`.
- **Orientation:** support portrait + landscape (both). Smooth rotation.
- **Launch screen** in the palette + wordmark; hide status bar in-game.
- **Persistence:** the per-session scoreboard → `UserDefaults` (or in-memory if
  we keep "per session"). No account, no network.
- **Privacy:** no data collected, no tracking, no network calls. Trivial App
  Privacy nutrition label ("Data Not Collected").

---

## 7. Phases & rough effort

| Phase | Work | Rough effort |
|---|---|---|
| 0 | Xcode project, targets, fonts, CI (xcodebuild) | 0.5 day |
| 1 | **Physics port** + XCTest invariants (energy/momentum/escape/outcomes) | 1–2 days |
| 2 | Render layers → SwiftUI Canvas (starfield, court, stars+glow, trails, arrow, particles, supernova) | 4–6 days |
| 3 | Game state machine + HUD + overlays + outcome cards + camera | 2–3 days |
| 4 | Input controls (position/mass/velocity gestures) | 2 days |
| 5 | **Orientation layout** (portrait split) + spike | 2–3 days |
| 6 | Haptics, safe areas, launch screen, polish, device testing | 2–3 days |
| 7 | App Store: icon, screenshots, metadata, TestFlight, submit | 1–2 days |

Realistically ~3 weeks of focused work to a polished submission, physics and
design fully faithful to the web original.

---

## 8. App Store submission checklist

- Apple Developer Program account (have it). Create App ID + bundle identifier.
- App icon (1024² + set), launch screen, display name, version/build.
- Signing: development + distribution certs, provisioning (Xcode automatic
  signing with JP's team).
- App Store Connect: new app record, category (Games → Puzzle/Family),
  age rating (4+), description, keywords, support URL, 6.7"/6.1"/iPad(if any)
  screenshots — capture from the running app.
- App Privacy: "Data Not Collected."
- Review notes: explain it's a **local 2-player** game (one device, pass it
  between players), no login, fully offline. (4.2 thin-wrapper risk is N/A — it's
  native.)
- TestFlight build → internal test on device → submit for review.

---

## 9. Testing strategy

Port the Vitest suite (energy conservation, momentum conservation, escape
detection, outcome classification — 13 cases today) to **XCTest** against the
`Physics` target. These are deterministic numeric invariants; they transfer 1:1
and become the proof the Swift physics matches the TS original (e.g., energy
drift ~5×10⁻⁷ over 50k steps on a circular orbit). Add a golden-trajectory test:
seed a known setup, run N steps, assert positions match the TS reference to
tolerance — catches any port drift.

---

## 10. Open decisions & risks

1. **Render: SwiftUI Canvas (recommended) vs SpriteKit.** → leaning Canvas.
2. **Portrait sim space: fixed square (recommended) vs rotating.** → resolve in
   the §5 spike.
3. **iOS deployment target.** Recommend iOS 17+ (modern SwiftUI Canvas/Timeline;
   ProMotion). Lower only if you need older devices.
4. **New repo vs subdir** of this one. Recommend a **new repo** (different stack,
   different toolchain) — this plan doc is the bridge.
5. **App name / bundle ID / developer entity** (personal vs Pursuit org).
6. Font licensing: Cardo (SIL OFL) and Inter (SIL OFL) both permit app bundling.

---

## 11. Interim: the live web version on mobile

Independent of the native app. Today: landscape works (full-bleed); portrait
shows a "rotate to landscape" prompt. Options:
- **(a) Leave it** — landscape works; the prompt is honest. Lowest effort; the
  real portrait design goes into the native app.
- **(b) Quick web portrait** — apply the same vertical-court reflow to the web
  canvas so the live site is portrait-playable too. Doubles as a working
  prototype/reference for the native portrait layout (§5).

Recommendation: **(b)** if you want the live site solid on phones now and a
free prototype of the portrait layout; **(a)** if we're racing to the native
app and the web is "good enough" in landscape.
```
