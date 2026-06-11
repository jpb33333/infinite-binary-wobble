# Project State — Infinite Binary Wobble

The single cold-start handoff document. If you are an engineer (or Claude) picking this up on a different machine in a different terminal session, read this first. It describes exactly what exists today, how the pieces fit, and what is left to do. Every technical claim here is grounded in the current source; where the source contradicts itself, that is called out under **Known gaps & risks**.

Companion docs: [`README.md`](../README.md) (public-facing), [`CLAUDE.md`](../CLAUDE.md) (working rules + architecture), [`CHANGELOG.md`](../CHANGELOG.md) (history), [`ROADMAP.md`](./ROADMAP.md) (sequenced work + provisioning), and [`docs/ios/`](./ios/) (the harvested iOS product docs).

> **In progress (updated 2026-06-10):** the game is being extended into a metered, monetized product (200 free plays → pay) with a Cloudflare backend — see [`ROADMAP.md`](./ROADMAP.md) and [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md). The `api-worker/` backend (Stripe checkout + verified-webhook persistence, session reuse, all unit-tested) and the web metering client (`src/net/`, refresh-first, dark until `VITE_API_BASE_URL` is set) are built; **nothing is wired or deployed** — everything past here is blocked on Phase 0 provisioning. A native SwiftUI iOS port also lives in-repo under `ios/` (golden-parity physics, bundled fonts; commerce layer not started).

---

## 1. The mental model (read this first)

Infinite Binary Wobble is a two-player browser game. Two humans each configure a star — position, mass, velocity vector — inside their half of a fixed "Celestial Court". When both lock in, a real two-body gravity simulation runs and is classified, every frame, as still-playing, a WIN (a stable bound orbit, the "wobble"), or one of three losses. A WIN never ends: the simulation runs forever and you watch.

The whole thing is one `<canvas>`, vanilla TypeScript, no framework, no runtime dependencies, built with Vite and tested with Vitest. It deploys as static files to GitHub Pages.

There are four conceptual layers, and the dependency arrows only point downward:

```
main.ts  ──boots──►  Game (orchestrator)
                       │  owns the state machine, the rAF loop, ALL input wiring,
                       │  the camera, effects, and scoreboard recording
                       ├──drives──►  Simulation (physics facade)
                       │               two Bodies, PEFRL integrator, Plummer gravity,
                       │               orbit diagnostics
                       ├──asks──────►  OutcomeClassifier (game logic)
                       │               classifies each frame; owns win/lose thresholds
                       ├──asks──────►  Renderer (paint)
                       │               contain-fit, DPR, starfield, particles, all draw
                       ├──polls─────►  ui/ controls (PositionControl/MassControl/ArrowControl)
                       │               passive BodySpec mutators, active in Setup only
                       └──consults──►  net/ Meter (web metering, fail-open)
                                       inert unless VITE_API_BASE_URL is set at build time
```

The single most load-bearing idea is the **design space**: the game always thinks in a fixed logical coordinate system — **1280×800 in landscape, 800×1280 in portrait** (`layoutForViewport` picks whichever matches the viewport's aspect; the portrait court is the exact transpose, stacked P1-top/P2-bottom, so the half-diagonal that the 820 px outcome bound was tuned against is identical). The Renderer maps the chosen design space into the live viewport with a uniform contain-fit (letterboxed, DPR-sharp) and re-picks it on every resize/rotation, remapping in-flight setups to the same normalized spot. Every control, hit-test, and clamp works in design-space units regardless of window size or device pixel ratio. Pointer events come in as CSS pixels and are inverted back into design space by `Renderer.screenToLogical`.

---

## 2. High-level architecture & data flow

Per real animation frame, `Game.tick(now)`:

1. `dt = min((now − last)/1000, DT_CAP=1/30)` — frame delta, capped so a tab-pause can't produce a giant step.
2. `update(dt)` runs the state machine:
   - **countdown** — decrement `countdownRemaining`; at ≤ 0, `toSimulate()`.
   - **simulate** — `advancePhysics(dt)`, push both trail points, `classifier.update(sim, dt)`; on a non-playing result, `toResolved(outcome)`.
   - **resolved** — for a **WIN only**, keep advancing physics + trails + classifier forever (the infinite wobble). All other outcomes freeze the sim.
3. `render(dt)` builds a props object (specs, sim, orbit, outcome, supernova, `cameraOffset`, hover, stats) and calls `renderer.render(...)`.
4. `updateCursor()` and reschedule.

`advancePhysics(dt)` is a fixed-step accumulator: it adds real `dt` into `simAccum` (hard-capped at 0.25 s to survive tab pauses) and drains it in fixed `PHYSICS.DT = 1/240 s` chunks via `sim.step()`. This decouples gameplay speed from frame rate. `Simulation.advanceFrame()` exists too (4 substeps = one 1/60 s frame) but the Game uses the accumulator path.

Data flows one way: Setup controls mutate `BodySpec`s → at `toSimulate()` those specs are frozen into two `Body`s via `Simulation.create(...)` (which sanitizes every numeric input against `SAFE_INPUT`) → the Simulation steps the bodies → `sim.orbit()` returns diagnostics → the classifier reads them → the Renderer paints them.

---

## 3. Full file map

### `src/physics/` — the orbital core (six dependency-free modules, hard-coded for exactly two bodies)

| File | Role |
|---|---|
| `Vec2.ts` | Plain mutable `{x,y}` record + pure helpers (`add`, `sub`, `scale`, `mag`, `magSq`, `normalize` (guards ÷0), `dot`, `crossZ`, `distance`, …). Deliberately **not** a class, to avoid per-step heap allocation; the integrator mutates `body.pos.x/.y` directly. |
| `Body.ts` | `interface Body { mass, pos, vel, accel }`; `createBody`; `RADIUS_BASE = 14`; `bodyRadius(mass) = 14·√mass` (area ∝ mass). |
| `gravity.ts` | `applyGravity(a, b, G, softening)` — Plummer-softened pairwise force, writes `accel` **in place** with `=` (overwrite, not `+=`). Correct only for two bodies. |
| `integrator.ts` | `pefrlStep(a, b, dt, G, softening)` — 4th-order PEFRL symplectic step. |
| `orbit.ts` | `computeOrbit(a, b, G): OrbitState` (relative-orbit diagnostics) + `circularRelativeVelocity(m1, m2, sep, G)`. |
| `Simulation.ts` | Public facade: owns the two bodies, `time`, `PHYSICS` constants, `SAFE_INPUT` sanitization, `step`/`advanceFrame`/`orbit`, and `static create(...)`. |

Dependency graph: `Vec2` (leaf) ← `Body`; `gravity`←`Body`; `integrator`←`Body`,`gravity`; `orbit`←`Body`,`Vec2`; `Simulation`←all.

### `src/game/` — orchestrator, state machine, outcomes, scoreboard

| File | Role |
|---|---|
| `states.ts` | `GameStateKind` (7 states incl. `paywall`), `BodySpec`, `CourtLayout`, `DEFAULT_LAYOUT` (landscape 1280×800), `PORTRAIT_LAYOUT` (800×1280 transpose), `layoutForViewport()`, `defaultSpec()`, `LIMITS`. |
| `outcomes.ts` | `Outcome` union, `DEFAULT_OUTCOME_CONFIG`, `outcomeConfigForLayout(_layout)` (returns a copy; layout-independent by design — the portrait transpose preserves the outcome envelope, the param is kept for API stability), and the stateful `OutcomeClassifier`. |
| `stats.ts` | Per-session cookie scoreboard (`ibw-stats-v1`), `GameRecord`, `recordGame` (which calls `saveStats` internally), `loadStats`, `summarize`, and the still-unwired `resetStats`. |
| `Game.ts` | The orchestrator: state machine, rAF loop, all input, camera-follow, supernova/particle effects, scoreboard recording, and the metering gate (`meter.shouldGate()` → `paywall`). |

### `src/render/` — everything that paints (design-space draw helpers + the Renderer)

| File | Role |
|---|---|
| `fit.ts` | `computeFit(cssW, cssH, designW, designH): Fit` — uniform contain-fit, no DPR awareness. |
| `starfield.ts` | Full-bleed deterministic twinkling starfield; `STAR_DENSITY`, `starCountForViewport`, `generateStarfield`, `drawStarfield`, Mulberry32 PRNG (seed `0xb1bb1e`). |
| `Renderer.ts` | Central renderer: canvas/ctx, layout, starfield, two particle layers, button map, DPR, `resize`, `screenToLogical`, the three-regime `render()`, doppler tint, predicted orbits, barycenter, supernova. |
| `court.ts` | Draws the court (active-side wash, center line, dotted in-bounds boxes); `clampToInBounds`. |
| `star.ts` | Painterly star draw (3 radial gradients + additive halo); `STYLE_P1`/`STYLE_P2`/`dimmed()`. |
| `arrow.ts` | Velocity arrow + chevron + tip glow + optional tooltip. |
| `trail.ts` | Allocation-free ring-buffer `Trail` + `drawTrail`. |
| `particles.ts` | Stardust: ambient drift + on-demand bursts, capped at `MAX_PARTICLES = 300`; own Mulberry32 PRNG (seed `0xfeed`). |
| `overlay.ts` | HUD/overlay primitives: wordmark, session stats, phase label, HUD strip, buttons (return hit-areas), tooltip, outcome card. |

### `src/ui/` — the three setup controls + geometry helpers

| File | Role |
|---|---|
| `input.ts` | Pure geometry helpers `inRect(p, r)` and `distSq(a, b)`. No event listeners, no coordinate mapping (a comment says `screenToLogical` lives on the Renderer because it owns the fit). |
| `PositionControl.ts` | Drag/teleport the star inside the in-bounds box (`clampToInBounds`, pad 24); owns `isOverBody`. |
| `MassControl.ts` | `applyWheel(spec, deltaY)` (step 0.18, inverted — scroll-up increases). |
| `ArrowControl.ts` | Drag-from-star velocity, 1 px = 1 px/s, capped at 300; `static magnitude`. |

### `src/net/` — web metering client (dark by default)

| File | Role |
|---|---|
| `config.ts` | Build-time env (`VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY`, `VITE_FREE_LIMIT` hint, default 200); `METERING_ENABLED` is false — and the game makes **zero** network calls — unless the API base URL is set. |
| `meter.ts` | `Meter`: refresh-first boot (Turnstile + session mint only on a 401), `shouldGate()`, optimistic `consumePlay()`, `startCheckout()` (Stripe redirect). Fail-open everywhere: any error leaves the game fully playable; only a positive server "locked" shows the paywall. |
| `turnstile.ts` | Cloudflare Turnstile loader; resolves a token or `null` (null = stay inert). |

### `src/` — entry & shared

| File | Role |
|---|---|
| `main.ts` | Entry point (51 lines): iframe frame-buster, `#stage` canvas lookup, the DOM dedication footer ("For Natalia / From JP / © Carousella Gaming 2026", title screen only), boots `Game`. |
| `theme.ts` | `palette`, `fonts`, `rgba()`, `blendHex()`. The single source of color. |
| `utils/clamp.ts` | `clamp(value, min, max)`. |
| `style.css` | Global styles, `@font-face`, `#stage` sizing (`100dvh` for iOS Safari's collapsing toolbar), the dedication/noscript/iframe-refusal styles, `touch-action: none`. Portrait is **playable** (stacked courts) — the old "rotate your phone" prompt is gone. (`prefers-reduced-motion` is honored in `Renderer.ts` via a live `matchMedia` listener, not CSS.) |

### Project root

| File | Role |
|---|---|
| `index.html` | Single page: `<canvas id="stage">` + module script + CSP meta + PWA manifest/touch-icon/OG tags. |
| `package.json` | `name`, `version 0.5.0`, scripts (incl. `export:fixtures`), three devDependencies, zero runtime deps. |
| `vite.config.ts` | Vite + Vitest config + the dev-only CSP-stripping plugin + the build-time `meteringCsp` plugin (widens the CSP when `VITE_API_BASE_URL` is set; throws if its anchor substrings stop matching). |
| `tsconfig.json` | Type-check-only config (`noEmit`). |
| `.github/workflows/deploy.yml` | test → build → deploy to GitHub Pages (push to `main`). |
| `.github/workflows/ci.yml` | PR gate: web suite (audit/test/build) + `api-worker` suite (audit/typecheck/test). |
| `.github/workflows/ios-physics.yml` | Swift physics-parity gate: asserts the two golden-fixture trees are byte-identical, then runs the WobblePhysics XCTest suite in a Linux Swift container. |
| `scripts/` | `export-golden-fixtures.mjs` (writes identical fixtures to `tests/fixtures/` + the iOS copy; Node-22-guarded) and `make-touch-icons.mjs` (zero-dep PNG icon rasterizer). |
| `public/` | Favicon, self-hosted Cardo + Inter woff2, PWA manifest + 192/512/apple-touch icons, `privacy.html` + `support.html` (App Store URLs), `.well-known/security.txt`. |
| `tests/` | Nine Vitest files, 44 tests (physics, outcomes, fit, layout, starfield, meter) + `tests/fixtures/` golden trajectories. |
| `docs/` | This file, `ROADMAP.md`, `MONETIZATION_PLAN.md`, `IOS_NATIVE_APP_PLAN.md` (executed — see its banner), `docs/ios/` (harvested product docs), `docs/plans/`. |

### Sibling packages (own toolchains, gated by `ci.yml`)

| Dir | What it is |
|---|---|
| `api-worker/` | The Cloudflare Worker metering/payments backend — built and unit-tested (32 tests), **not deployed**. Own `package.json` (vitest 4, wrangler 4), `wrangler.toml`, D1 `schema.sql`. Read `api-worker/README.md` first — especially the **cookie & origin constraint** (SameSite=Strict means the game and API must share a registrable domain; `github.io` + `workers.dev` silently no-ops). |
| `ios/` | The native SwiftUI port: `ios/App/` (app + bundled Cardo/Inter fonts with OFL provenance) + `ios/WobblePhysics/` (pure-Swift physics, golden-parity + constants-guard tests; `swift test` needs XCTest — full Xcode locally, or the CI container). Build: `brew install xcodegen && cd ios && xcodegen generate`. |

---

## 4. Physics spec (constants + invariants)

### Constants

`PHYSICS` (in `Simulation.ts`, `as const`):

| Name | Value | Meaning |
|---|---|---|
| `G` | `1.5e7` | Gravitational constant, game-feel-tuned (not SI). |
| `SOFTENING` | `6` | Plummer softening length ε. |
| `DT` | `1/240 s` | Fixed physics timestep. |
| `SUBSTEPS_PER_FRAME` | `4` | `4 × 1/240 = 1/60 s` per display frame. |
| `WARMUP_SECONDS` | `0.6` | Settle time for the classifier (defined here, consumed in `outcomes.ts`). |

`RADIUS_BASE = 14` (`Body.ts`); `bodyRadius(mass) = 14·√mass`.

PEFRL coefficients (`integrator.ts`, module-private): `XI = 0.1786178958448091`, `LAMBDA = -0.2123418310626054`, `CHI = -0.06626458266981849`.

`SAFE_INPUT` (private to `Simulation.ts`, defence-in-depth): mass `[0.01, 1e3]` default `2.5`; `|pos component| ≤ 1e5` default `0`; `|vel component| ≤ 1e4` default `0`. Sanitization replaces non-finite values with the default, **then** clamps.

`LIMITS` (`states.ts`, UI-facing, `as const`): `minMass 1.0`, `maxMass 5.0`, `maxVelocityPerBody 300` (px/s). Intentionally ~10–30× narrower than `SAFE_INPUT`, so `SAFE_INPUT` only catches a UI bypass (e.g. DevTools mutation between SETUP and COUNTDOWN).

### Formulas (relative orbit, B relative to A; `M = m₁ + m₂`)

- Gravity: `aₐ = +G·m_b·(b−a)/(r²+ε²)^1.5`, `a_b = −G·m_a·(b−a)/(r²+ε²)^1.5`.
- One PEFRL step: `D(ξ) K((1−2λ)/2) D(χ) K(λ) D(1−2(ξ+χ)) K(λ) D(χ) K((1−2λ)/2) D(ξ)` — 5 drifts, 4 kicks, 4 force evals, time-symmetric.
- `specificEnergy ε = ½·|v_rel|² − G·M/r`
- `totalEnergy = μ·ε`, `μ = m₁m₂/M`
- `h = |r × v_rel|` (specific angular momentum)
- `eccentricity = √(1 + 2·ε·h²/(G·M)²)`, clamped to 0 if the term under the root is negative
- `semiMajorAxis = −G·M/(2·ε)` if `ε < 0`, else `∞`
- `period = 2π·√(a³/(G·M))` if `a` finite, else `∞`
- `escapeVelocity = √(2·G·M/r)`
- `argumentOfPeriapsis = atan2(eVecY, eVecX)` from the eccentricity vector
- `bound = ε < 0`

### Invariants (asserted by the test suite)

- **No secular energy drift** (symplectic): relative energy drift `< 1e-5` over 50,000 steps on a circular orbit; net drift coefficients sum to 1, net kick coefficients sum to 1.
- **Momentum conservation**: total linear momentum preserved to `< 1e-9` (relative) over 4000 steps with asymmetric masses.
- **Escape/bound classification**: super-escape → `ε > 0`, `bound === false`; sub-escape → `ε < 0`, finite `a`/period; circular → `e < 0.01`, bound.
- Plummer softening keeps ordinary orbits Keplerian while preventing close-approach blow-up.

The constructor primes `accel` (one `applyGravity` call) so the first step has a meaningful `a(0)`, and caches `initialSeparation` and `initialEnergy` as readonly fields.

---

## 5. Responsive / full-bleed rendering

The game renders in one of two fixed design spaces — **landscape 1280×800** or **portrait 800×1280** — chosen per viewport by `layoutForViewport(cssW, cssH)` (`cssW >= cssH` → landscape; square gets landscape, the original tuning). The Renderer fits the chosen space into the live viewport and re-picks it on every resize/rotation; in-flight setup positions remap to the same normalized spot in the new space. Canvas buttons inflate their hit rects to a 44 CSS-px minimum at small contain-fit scales (Apple HIG).

- `computeFit(cssW, cssH, designW, designH)`: `scale = min(cssW/designW, cssH/designH)` (smaller ratio wins, so the whole court is visible); offsets center the letterbox symmetrically. No DPR, no clamp.
- `resize(cssW, cssH)` (called on window resize and at construction): re-reads `dpr = max(1, devicePixelRatio || 1)`; sets `viewW/viewH`; recomputes the fit; **regenerates the starfield** at `starCountForViewport(cssW, cssH)`; sets `canvas.width/height = round(css·dpr)` and the CSS size in px. Setting `canvas.width/height` resets all ctx state, which is why `render()` re-establishes the transform every frame (no persistent `ctx.scale`).
- `screenToLogical(event)`: `x = (clientX − rect.left − offsetX)/scale`, `y = (clientY − rect.top − offsetY)/scale`. **DPR is intentionally absent** because `getBoundingClientRect` already returns CSS pixels — do not introduce a phantom DPR factor.

**Three transform regimes** in `render()`, in order:

1. Identity (raw device buffer) — void-deep background fill.
2. DPR-only screen space — **starfield** + **ambient** stardust, full-bleed across the whole window including letterbox margins.
3. Scene transform `m = dpr·scale` (+ centering offset) — court, stars, trails, predicted orbits, barycenter, HUD, cards, and the **burst** particle layer. Then the ambient layer is redrawn last, back in screen space, on top.

**Starfield** (`starfield.ts`): `STAR_DENSITY = 140/(1280·800)`; `starCountForViewport` clamps `round(density·w·h)` to `[60, 600]`. Stars are normalized `[0,1]`, generated in fixed order with Mulberry32 (seed `0xb1bb1e`), so growing the count only **appends** — existing stars keep position/alpha/twinkle and the field reflows without reshuffling. Drawn additively (`'lighter'`); per-star radius `0.7 + 0.6·twinkle` in CSS px (constant size regardless of window). Order-stability is load-bearing; changing the seed, the field order, or inserting fields mid-loop would make the field "jump" on resize.

**Two particle layers** (`particles.ts`, cap 300): **ambient** renders in screen space at `viewW/viewH` (full-bleed); **burst** renders in design-space world coordinates so it rides the fit with the scene. New effects must pick the correct layer.

**Camera offset** (`computeCameraOffset`): `{x: designCenterX − barycenterX, y: designCenterY − barycenterY}` (the design-space center is `layout.canvas/2` — 640,400 in landscape, 400,640 in portrait) using the mass-weighted barycenter, only during simulate/resolved with a live sim and positive finite total mass; `null` otherwise. It wraps **only** the system content inside `renderSimulate` (predicted orbits, both trails, barycenter, stars/supernova). Court, HUD, phase label, and starfield stay canvas-fixed.

---

## 6. State machine & outcome rules

### States (`GameStateKind`, 7 total)

`title → setup_p1 → setup_p2 → countdown → simulate → resolved`, plus **`paywall`** (web metering only — inert unless a backend is configured). **ESC** (`e.key === 'Escape'`) returns to `title` from any non-title state. A **WIN** keeps `simulate`-style stepping alive inside `resolved` forever; every other outcome freezes.

- `title` → `begin` button → `setup_p1` — unless `meter.shouldGate()` (out of free plays, unpaid), which routes to `paywall` instead.
- `paywall` → `support` button → `meter.startCheckout()` (Stripe redirect); a background `meter.refresh()` exits back to `setup_p1` once the device is no longer gated.
- `setup_p1`/`setup_p2` → `lock_in` button, but only if the active spec's `hypot(vel) ≥ 1` (can't lock in a near-zero velocity).
- `countdown` — `COUNTDOWN_SECONDS = 3`, counts down by real dt → `toSimulate()` (which also fires the optimistic `meter.consumePlay()`).
- `resolved` → `again` button → back to `setup_p1`.

### Layouts (`DEFAULT_LAYOUT` / `PORTRAIT_LAYOUT`)

Landscape: canvas 1280×800; `p1Region {0,0,640,800}`, `p2Region {640,0,640,800}`; 400×400 in-bounds boxes (`{120,200}` / `{760,200}`); vertical center line at x=640. Portrait: canvas 800×1280 (the exact transpose — same half-diagonal, so the play-tuned 820 px outcome envelope holds); courts stacked `p1Region {0,0,800,640}` / `p2Region {0,640,800,640}`; 360×360 in-bounds boxes (`{220,170}` / `{220,770}`); horizontal center line at y=640. `defaultSpec`: mass 2.5, vel `{0,0}`, position at the center of the player's in-bounds box.

### Outcome thresholds (`DEFAULT_OUTCOME_CONFIG`)

`warmupSeconds 0.6`, `winOrbitsRequired 2`, `winMaxEccentricity 0.93`, `offCanvasGraceSeconds 0.6`, `maxBodyDistanceFromBarycenter 820`.

### Classifier algorithm (`OutcomeClassifier.update`, in order)

1. **Always** track the unwrapped relative angle (`atan2` of `b.pos − a.pos`, delta clamped to `[−π, π]`); `completedOrbits = floor(|unwrappedAngle|/2π)`. Keeps counting even after resolution, so a WIN's ORBITS readout climbs forever.
2. If already resolved, return the frozen outcome.
3. **Collision first, unconditional** (ignores warmup): `sim.minSeparation < bodyRadius(a) + bodyRadius(b)` → `lose_collision`. `minSeparation` is the substep-resolution minimum maintained by `Simulation.step` — the instantaneous separation would let a fast graze overlap and pull apart entirely between two frame samples.
4. If `sim.time < warmupSeconds`, return `playing`.
5. Compute the mass-weighted barycenter; `maxBodyDist = max(distA, distB)`. If `> 820`, accumulate `offCanvasTime`; once `≥ 0.6 s`, resolve: `bound ? lose_slingshot : lose_escape`.
6. Else reset `offCanvasTime`, and WIN iff `bound && eccentricity ≤ 0.93 && completedOrbits ≥ 2`.

Off-canvas is **barycenter distance**, not screen position — because the camera follows the barycenter, a compact system can drift on screen forever without losing.

### Effects on resolve (`toResolved`)

Recorded exactly once (guarded by `!burstedOnResolve && sim && classifier && kind !== 'playing'`): `recordGame({outcome, duration: sim.time, eccentricity, orbits, period, ts: Date.now()})`, then re-summarize. Then effects: `lose_collision` → supernova `{x,y (midpoint), t0, mergedMass}` + `renderer.burst(mid, 240, cream, 360)`; `win` → two 24-particle bursts in player colors.

---

## 7. Controls

`src/ui/` controls are passive `BodySpec` mutators; `Game.attachInput` owns all wiring and converts every event to design space via `screenToLogical` first.

- **Listeners**: `pointerdown`/`pointermove`/`wheel({passive:false})`/`pointerleave`/`pointercancel` on the canvas; `pointerup`/`keydown`/`resize` on the window. (Pointerup/cancel on window so a release registers even off-canvas.)
- **Drag routing** (setup only): pointer **on the star body** (`isOverBody`, circular hit-test radius `14·√mass`) → `ArrowControl` (velocity drag); pointer **elsewhere in the player's region** (`inRect` against the 640-wide half) → `PositionControl` (reposition, clamped to the in-bounds box). This routing was **flipped** from the original wiring on 2026-06-01 per a `/qa` finding.
- **Mass**: wheel over the active region → `MassControl.applyWheel(deltaY)` (step 0.18, `change = −deltaY/100·step`, scroll-up increases). Touch `−`/`+` pills route through `applyWheel` with `deltaY = +100`/`−100` (one tap = 0.18). Wheel does nothing over the opponent's half.
- **Velocity**: drag from the star, 1 px = 1 px/s, magnitude capped at 300, direction preserved.
- **Cursor** (`updateCursor`): `pointer` over buttons; in setup, `grabbing` while dragging, `grab` over the star, `crosshair` in the active region, `default` elsewhere. Only writes `canvas.style.cursor` on change.

HUD strip (`renderSimulate`) shows seven fields: separation (px), rel. speed (px/s — honest units since 0.4.0), energy (BOUND/UNBOUND), ecc. (2dp or ∞), period (s or ∞), orbits (int), time (s).

---

## 8. Build / test / deploy runbook

### Local

```
npm install          # once
npm run dev          # Vite dev server, HMR, usually http://localhost:5173
npm test             # vitest run — 44 tests
npm run test:watch   # vitest in watch mode
npm run build        # tsc (type-check) THEN vite build → dist/
npm run preview      # serve the built bundle

cd api-worker        # the Cloudflare Worker (separate package)
npm install && npm run typecheck && npm test   # 32 tests
```

Toolchain: `typescript ~6.0.2`, `vite ^8.0.16`, `vitest ^4.1.8`; zero runtime dependencies (api-worker: vitest 4 + wrangler 4 + workers-types, also dev-only). `vite.config.ts`: `base: './'` (relative, works under any Pages subpath), `build.target 'es2022'`, `build.sourcemap false` (deliberate — source maps were publishing full TS source). `tsconfig.json`: `target 'es2023'`, `noEmit`, `moduleResolution 'bundler'` (note the es2023/es2022 mismatch between tsconfig and vite). A dev-only Vite plugin (`apply: 'serve'`) strips the CSP `<meta>` tag so blob-worker console noise doesn't appear; production `dist/index.html` keeps the tight CSP verbatim. The production CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'`, paired with a `referrer: no-referrer` meta. See `SECURITY.md` for the full posture and the GitHub Pages header limitation.

### CI/CD (GitHub Pages auto-deploy)

`.github/workflows/deploy.yml` triggers on push to `main` (and `workflow_dispatch`). Job order: checkout → setup-node (**Node 22**, npm cache) → `npm ci` → `npm audit --audit-level=high` → `npm test` → `npm run build` → configure-pages → upload-pages-artifact (`./dist`) → deploy-pages. Pull requests are gated separately by `.github/workflows/ci.yml` (web suite + `api-worker` typecheck/tests/audit) — before it existed, tests ran only post-merge inside this deploy job. All third-party actions are pinned to full commit SHAs and updated via `.github/dependabot.yml` (npm + github-actions, weekly). The checkout uses `persist-credentials: false`, and an `npm audit --audit-level=high` step gates the deploy on a high/critical advisory. Concurrency group `pages`, `cancel-in-progress: false`. Live URL: https://jpb33333.github.io/infinite-binary-wobble/.

`dist/` is gitignored and built fresh in CI; the `dist/` currently on disk is a stale local artifact.

**Node version note.** CI pins `node-version: '22'`; local dev has been run on Node 20 and Node 25 at different times, and nothing pins the local version (no `engines` field). Prefer Node 22 locally to match CI — it matters most for `npm run export:fixtures`, which refuses other majors by design (engine-dependent `Math.pow` churns the golden fixtures' last digits; see the script header).

### iframe / CSP defense

`frame-ancestors` is intentionally omitted from the `<meta>` CSP because it is header-only and silently ignored as a meta directive, and GitHub Pages cannot set response headers. Clickjacking defense is therefore the JS frame-buster in `main.ts` (reloads the top frame same-origin, or shows a refusal message and throws cross-origin).

---

## 9. Version & changelog state

`package.json` is at **`0.5.0`**, matching the dated **`0.5.0`** section in `CHANGELOG.md` (metering integrity + PR CI gate + iOS asset harvest + the 200-free-plays and Carousella Gaming decisions), above `0.4.0` (portrait mode, PWA install, the native iOS app, softened-energy fix) and the earlier sections. The rule that keeps them honest: cut a dated changelog section and bump the manifest in the **same** change so they never diverge.

---

## 10. Known gaps & risks

Grounded discrepancies and limitations a fresh engineer should not trip over:

- **2-body lock-in.** `gravity.ts` overwrites `accel` with `=` (not `+=`); `integrator.ts` and `orbit.ts` hard-code the pair `(a, b)`. Supporting 3+ bodies requires accumulation, a force-clear pass, looping drift/kick over all bodies, and rethinking the single-relative-orbit diagnostics. This is not a quick change.
- **`~5e-7` drift figure** (README + IOS plan) is a measured anecdote; the actual test only asserts `< 1e-5` over 50,000 steps. Present it as an anecdote, not a guaranteed bound. (The remaining "Verlet" mentions in `tests/physics.energy.test.ts` are deliberate comparative references — the stale "Velocity Verlet" mislabels were purged in 0.4.0.)
- **Missing `docs/research/`.** `src/theme.ts` line 5 cites `docs/research/her-aesthetic.md`, which does not exist in the repo. Either restore the report or fix the citation before claiming docs match the tree exactly.
- **Two copies of the 0.6 s warmup** (`PHYSICS.WARMUP_SECONDS` and `DEFAULT_OUTCOME_CONFIG.warmupSeconds`) and two Mulberry32 PRNG copies (`particles.ts` seed `0xfeed`, `starfield.ts` seed `0xb1bb1e`). A refactor could share each, but must preserve the distinct seeds.
- **Outcome thresholds are layout-independent on purpose.** `outcomeConfigForLayout(_layout)` returns a fixed copy: the portrait design space is an exact transpose (same half-diagonal), so the 820 px bound holds in both orientations. The bound is still a magic number tuned for roughly equal masses; the layout parameter is the seam to re-activate if a future layout ever changes the court diagonal.
- **Unwired scoreboard reset.** `stats.resetStats()` is exported but never called; there is no clear-stats UI. The session cookie has no schema versioning beyond its name — a format change needs a new cookie name or migration (`loadStats` silently drops anything that doesn't parse to `{games:[]}`).
- **Golden-fixture regeneration debt.** The committed fixtures predate the 0.4.0 softened-energy fix and the exporter still samples Keplerian diagnostics while `Simulation.initialEnergy` is softened — `final.energyDriftRel` mixes conventions. Regeneration is a deliberate act (Node 22 only, update the Swift expectations in the same change); the full constraints live in the `export-golden-fixtures.mjs` header. CI guards the two fixture trees against drifting apart, not against this.
- **No lint/format tooling** (no ESLint/Prettier); style is enforced only by `tsconfig` flags + convention. `strict: true` is **not** set in `tsconfig`.
- **Hard-coded hexes in `style.css`** (the iframe-refusal, noscript, and dedication styles duplicate palette values like `#FFC89B`/`#1A0F14`) — CSS can't read `theme.ts`, so these are inherent duplicates; keep them in sync with the palette by hand. (`main.ts` itself no longer hard-codes colors — the refusal notice is DOM-built and styled from CSS.)
- **No tests for canvas/controls/render.** The suite covers physics + outcomes + fit + layout + starfield + the meter client. Input handling, ESC, cursor logic, resize wiring, `screenToLogical`, and DPR are browser-only verified.
- **Metering deploy constraints live elsewhere but bite hard:** the device cookie is `SameSite=Strict` (game + API must share a registrable domain — see `api-worker/README.md`), and the client is fail-open, so a mis-wired deploy looks like "metering does nothing" rather than an error.

---

## 11. Future direction

The **native Swift iOS rewrite is done** — `ios/` holds the SwiftUI `Canvas` + `TimelineView(.animation)` port with golden-parity physics (`docs/IOS_NATIVE_APP_PLAN.md` survives with a status banner as the spec it was built from; the standalone `infinite-binary-wobble-ios` repo is archived, its unique assets harvested into `ios/App/Resources/` and `docs/ios/`).

What's actually next, in order (see `ROADMAP.md` for the sequenced version):

1. **Phase 0 provisioning** — the only blocker for everything monetization: Cloudflare account + custom domain, Stripe, Turnstile, Apple keys. Human-only.
2. **Phases A–C** — front the site, deploy `api-worker/`, wire web metering end-to-end (200 free plays → Stripe pay-what-you-want).
3. **iOS commerce** (Phases E/F) — StoreKit 2 + App Attest in the app; their server verifications in the Worker (currently fail-closed stubs).
4. **App Store track** — Apple **organization** enrollment (needs the Carousella Gaming entity + D-U-N-S — see `docs/plans/carousella-copyright.md`), privacy-label update when metering ships, TestFlight, submit. The harvested `docs/ios/ROADMAP-IOS.md` carries the product direction beyond V1 (saved/sent wobbles).
