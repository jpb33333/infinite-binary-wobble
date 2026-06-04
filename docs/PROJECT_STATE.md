# Project State — Infinite Binary Wobble

The single cold-start handoff document. If you are an engineer (or Claude) picking this up on a different machine in a different terminal session, read this first. It describes exactly what exists today, how the pieces fit, and what is left to do. Every technical claim here is grounded in the current source; where the source contradicts itself, that is called out under **Known gaps & risks**.

Companion docs: [`README.md`](../README.md) (public-facing), [`CLAUDE.md`](../CLAUDE.md) (working rules + architecture), [`CHANGELOG.md`](../CHANGELOG.md) (history), and [`IOS_NATIVE_APP_PLAN.md`](./IOS_NATIVE_APP_PLAN.md) (future direction).

> **In progress (2026-06-04):** the game is being extended into a metered, monetized product (100 free plays → pay) with a Cloudflare backend. See [`ROADMAP.md`](./ROADMAP.md) (sequenced work + provisioning + new-machine bootstrap) and [`MONETIZATION_PLAN.md`](./MONETIZATION_PLAN.md). The `api-worker/` backend scaffold and the web metering client (`src/net/`, dark until `VITE_API_BASE_URL` is set) have landed; nothing is wired or deployed yet.

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
                       └──polls─────►  ui/ controls (PositionControl/MassControl/ArrowControl)
                                       passive BodySpec mutators, active in Setup only
```

The single most load-bearing idea is the **fixed design space**: the game always thinks in a 1280×800 coordinate system. The Renderer maps that into whatever viewport the browser gives it with a uniform contain-fit (letterboxed, DPR-sharp). Every control, hit-test, and clamp works in 1280×800 logical units regardless of window size or device pixel ratio. Pointer events come in as CSS pixels and are inverted back into design space by `Renderer.screenToLogical`.

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
| `states.ts` | `GameStateKind` (6 states), `BodySpec`, `CourtLayout`, `DEFAULT_LAYOUT`, `defaultSpec()`, `LIMITS`. |
| `outcomes.ts` | `Outcome` union, `DEFAULT_OUTCOME_CONFIG`, `outcomeConfigForLayout(_layout)` (layout-ignored, returns a copy), and the stateful `OutcomeClassifier`. |
| `stats.ts` | Per-session cookie scoreboard (`ibw-stats-v1`), `GameRecord`, `recordGame`, `loadStats`, `summarize`, and (unwired) `resetStats`/`saveStats`. |
| `Game.ts` | The orchestrator: state machine, rAF loop, all input, camera-follow, supernova/particle effects, scoreboard recording. |

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
| `MassControl.ts` | `applyWheel(spec, deltaY)` (step 0.18, inverted) and `setMass` (test-only). |
| `ArrowControl.ts` | Drag-from-star velocity, 1 px = 1 px/s, capped at 300; `static magnitude`. |

### `src/` — entry & shared

| File | Role |
|---|---|
| `main.ts` | Entry point (24 lines): iframe frame-buster, `#stage` canvas lookup, boots `Game`. |
| `theme.ts` | `palette`, `fonts`, `rgba()`, `blendHex()`. The single source of color. |
| `utils/clamp.ts` | `clamp(value, min, max)`. |
| `style.css` | Global styles, `@font-face`, `#stage` sizing, portrait "rotate your phone" prompt, `touch-action: none`. |

### Project root

| File | Role |
|---|---|
| `index.html` | Single page: `<canvas id="stage" width="1280" height="800">` + module script + CSP meta. |
| `package.json` | `name`, `version 0.3.0`, scripts, three devDependencies, zero runtime deps. |
| `vite.config.ts` | Vite + Vitest config + the dev-only CSP-stripping plugin. |
| `tsconfig.json` | Type-check-only config (`noEmit`). |
| `.github/workflows/deploy.yml` | test → build → deploy to GitHub Pages. |
| `public/favicon.svg`, `public/fonts/` | Favicon (two-star SVG) and self-hosted Cardo + Inter woff2 (~82 KB). |
| `tests/` | Six Vitest files, 25 tests. |
| `docs/` | `IOS_NATIVE_APP_PLAN.md` and this file. |

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

The game renders in a fixed **1280×800 design space**; the Renderer fits it into the live viewport.

- `computeFit(cssW, cssH, 1280, 800)`: `scale = min(cssW/1280, cssH/800)` (smaller ratio wins, so the whole court is visible); `offsetX = (cssW − 1280·scale)/2`, `offsetY = (cssH − 800·scale)/2` (symmetric letterbox). No DPR, no clamp.
- `resize(cssW, cssH)` (called on window resize and at construction): re-reads `dpr = max(1, devicePixelRatio || 1)`; sets `viewW/viewH`; recomputes the fit; **regenerates the starfield** at `starCountForViewport(cssW, cssH)`; sets `canvas.width/height = round(css·dpr)` and the CSS size in px. Setting `canvas.width/height` resets all ctx state, which is why `render()` re-establishes the transform every frame (no persistent `ctx.scale`).
- `screenToLogical(event)`: `x = (clientX − rect.left − offsetX)/scale`, `y = (clientY − rect.top − offsetY)/scale`. **DPR is intentionally absent** because `getBoundingClientRect` already returns CSS pixels — do not introduce a phantom DPR factor.

**Three transform regimes** in `render()`, in order:

1. Identity (raw device buffer) — void-deep background fill.
2. DPR-only screen space — **starfield** + **ambient** stardust, full-bleed across the whole window including letterbox margins.
3. Scene transform `m = dpr·scale` (+ centering offset) — court, stars, trails, predicted orbits, barycenter, HUD, cards, and the **burst** particle layer. Then the ambient layer is redrawn last, back in screen space, on top.

**Starfield** (`starfield.ts`): `STAR_DENSITY = 140/(1280·800)`; `starCountForViewport` clamps `round(density·w·h)` to `[60, 600]`. Stars are normalized `[0,1]`, generated in fixed order with Mulberry32 (seed `0xb1bb1e`), so growing the count only **appends** — existing stars keep position/alpha/twinkle and the field reflows without reshuffling. Drawn additively (`'lighter'`); per-star radius `0.7 + 0.6·twinkle` in CSS px (constant size regardless of window). Order-stability is load-bearing; changing the seed, the field order, or inserting fields mid-loop would make the field "jump" on resize.

**Two particle layers** (`particles.ts`, cap 300): **ambient** renders in screen space at `viewW/viewH` (full-bleed); **burst** renders in design-space world coordinates so it rides the fit with the scene. New effects must pick the correct layer.

**Camera offset** (`computeCameraOffset`): `{x: 640 − barycenterX, y: 400 − barycenterY}` using the mass-weighted barycenter, only during simulate/resolved with a live sim and positive finite total mass; `null` otherwise. It wraps **only** the system content inside `renderSimulate` (predicted orbits, both trails, barycenter, stars/supernova). Court, HUD, phase label, and starfield stay canvas-fixed.

---

## 6. State machine & outcome rules

### States (`GameStateKind`, 6 total)

`title → setup_p1 → setup_p2 → countdown → simulate → resolved`. **ESC** (`e.key === 'Escape'`) returns to `title` from any non-title state. A **WIN** keeps `simulate`-style stepping alive inside `resolved` forever; every other outcome freezes.

- `title` → `begin` button → `setup_p1`.
- `setup_p1`/`setup_p2` → `lock_in` button, but only if the active spec's `hypot(vel) ≥ 1` (can't lock in a near-zero velocity).
- `countdown` — `COUNTDOWN_SECONDS = 3`, counts down by real dt → `toSimulate()`.
- `resolved` → `again` button → back to `setup_p1`.

### Layout (`DEFAULT_LAYOUT`)

Canvas 1280×800; `p1Region {0,0,640,800}`, `p2Region {640,0,640,800}`; `p1InBounds {120,200,400,400}`, `p2InBounds {760,200,400,400}`; `centerLineX 640`. `defaultSpec`: mass 2.5, vel `{0,0}`, position at the center of the player's in-bounds box.

### Outcome thresholds (`DEFAULT_OUTCOME_CONFIG`)

`warmupSeconds 0.6`, `winOrbitsRequired 2`, `winMaxEccentricity 0.93`, `offCanvasGraceSeconds 0.6`, `maxBodyDistanceFromBarycenter 820`.

### Classifier algorithm (`OutcomeClassifier.update`, in order)

1. **Always** track the unwrapped relative angle (`atan2` of `b.pos − a.pos`, delta clamped to `[−π, π]`); `completedOrbits = floor(|unwrappedAngle|/2π)`. Keeps counting even after resolution, so a WIN's ORBITS readout climbs forever.
2. If already resolved, return the frozen outcome.
3. **Collision first, unconditional** (ignores warmup): `separation < bodyRadius(a) + bodyRadius(b)` → `lose_collision`.
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

HUD strip (`renderSimulate`) shows seven fields: separation (px), rel. speed (m/s label — see gaps), energy (BOUND/UNBOUND), ecc. (2dp or ∞), period (s or ∞), orbits (int), time (s).

---

## 8. Build / test / deploy runbook

### Local

```
npm install          # once
npm run dev          # Vite dev server, HMR, usually http://localhost:5173
npm test             # vitest run — 25 tests
npm run test:watch   # vitest in watch mode
npm run build        # tsc (type-check) THEN vite build → dist/
npm run preview      # serve the built bundle
```

Toolchain: `typescript ~6.0.2` (resolved 6.0.3), `vite ^8.0.12` (8.0.15), `vitest ^4.1.7` (4.1.7); zero runtime dependencies. `vite.config.ts`: `base: './'` (relative, works under any Pages subpath), `build.target 'es2022'`, `build.sourcemap false` (deliberate — source maps were publishing full TS source). `tsconfig.json`: `target 'es2023'`, `noEmit`, `moduleResolution 'bundler'` (note the es2023/es2022 mismatch between tsconfig and vite). A dev-only Vite plugin (`apply: 'serve'`) strips the CSP `<meta>` tag so blob-worker console noise doesn't appear; production `dist/index.html` keeps the tight CSP verbatim. The production CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'`, paired with a `referrer: no-referrer` meta. See `SECURITY.md` for the full posture and the GitHub Pages header limitation.

### CI/CD (GitHub Pages auto-deploy)

`.github/workflows/deploy.yml` triggers on push to `main` (and `workflow_dispatch`). Job order: checkout → setup-node (**Node 22**, npm cache) → `npm ci` → `npm audit --audit-level=high` → `npm test` → `npm run build` → configure-pages → upload-pages-artifact (`./dist`) → deploy-pages. All third-party actions are pinned to full commit SHAs and updated via `.github/dependabot.yml` (npm + github-actions, weekly). The checkout uses `persist-credentials: false`, and an `npm audit --audit-level=high` step gates the deploy on a high/critical advisory. Concurrency group `pages`, `cancel-in-progress: false`. Live URL: https://jpb33333.github.io/infinite-binary-wobble/.

`dist/` is gitignored and built fresh in CI; the `dist/` currently on disk is a stale local artifact.

**Node action-deprecation note.** The workflow pins `node-version: '22'`, ahead of the Node 20 GitHub Actions runtime deprecation, so the actions run on a current Node. There is **no** "Node20 deprecation" text in the repo — if you go looking for one, it isn't there; the relevant fact is simply that CI is on Node 22 while local dev has been run on Node 20 (`v20.20.1`), and nothing pins the Node version for local dev (no `engines` field). Prefer Node 22 locally to match CI.

### iframe / CSP defense

`frame-ancestors` is intentionally omitted from the `<meta>` CSP because it is header-only and silently ignored as a meta directive, and GitHub Pages cannot set response headers. Clickjacking defense is therefore the JS frame-buster in `main.ts` (reloads the top frame same-origin, or shows a refusal message and throws cross-origin).

---

## 9. Version & changelog state

`package.json` is at **`0.3.0`**, matching the dated **`0.3.0`** section in `CHANGELOG.md` (responsive-resize + full-bleed-starfield, plus ESC, scoreboard, contextual cursor, and ISSUE-006…010), with `0.2.0` and `0.1.0` below it. The 0.3.0 work shipped to the live site after the 0.2.0 tag, and the manifest was aligned in a follow-up bump (2026-06-04) so the two now agree. Going forward, cut a dated changelog section and bump the manifest in the **same** change so they never diverge again.

---

## 10. Known gaps & risks

Grounded discrepancies and limitations a fresh engineer should not trip over:

- **2-body lock-in.** `gravity.ts` overwrites `accel` with `=` (not `+=`); `integrator.ts` and `orbit.ts` hard-code the pair `(a, b)`. Supporting 3+ bodies requires accumulation, a force-clear pass, looping drift/kick over all bodies, and rethinking the single-relative-orbit diagnostics. This is not a quick change.
- **Stale "Velocity Verlet" code comments.** `Body.ts`, `Simulation.ts` (constructor + `step()`), `Vec2.ts`, and `tests/physics.momentum.test.ts` reference "Velocity Verlet" / "first Verlet step", but the integrator is genuinely **PEFRL**. The README/CLAUDE/IOS-plan PEFRL claims are correct; only these in-code comments are stale and should be purged.
- **`~5e-7` drift figure** (README + IOS plan) is a measured anecdote; the actual test only asserts `< 1e-5` over 50,000 steps. Present it as an anecdote, not a guaranteed bound.
- **`m/s` vs `px/s`.** The internal unit is px/s (1 px/s of arrow draws as 1 px) but the velocity tooltip and HUD label read "m/s" per the original brief. Don't claim the displayed velocity is true physical m/s. `arrow.ts` ends with a no-op `void LIMITS;` keeping the import live; it does not actually use `LIMITS`.
- **Missing `docs/research/`.** `src/theme.ts` line 5 cites `docs/research/her-aesthetic.md`, which does not exist in the repo. Either restore the report or fix the citation before claiming docs match the tree exactly.
- **Two copies of the 0.6 s warmup** (`PHYSICS.WARMUP_SECONDS` and `DEFAULT_OUTCOME_CONFIG.warmupSeconds`) and two Mulberry32 PRNG copies (`particles.ts` seed `0xfeed`, `starfield.ts` seed `0xb1bb1e`). A refactor could share each, but must preserve the distinct seeds.
- **`outcomeConfigForLayout(_layout)` ignores its argument** — the 820 px off-canvas bound is a fixed magic number tuned for the default 1280×800 layout and roughly equal masses (e ≤ 0.93, apoapsis ~720 px). Non-default layouts or very unequal masses aren't accounted for. The layout parameter is the seam to re-activate if bounds should ever scale with the court again.
- **Unwired scoreboard reset.** `stats.resetStats()`/`saveStats()` are exported but never called outside `stats.ts`; there is no clear-stats UI. `MassControl.setMass` is test-only. The session cookie has no schema versioning beyond its name — a format change needs a new cookie name or migration (`loadStats` silently drops anything that doesn't parse to `{games:[]}`).
- **No lint/format tooling** (no ESLint/Prettier); style is enforced only by `tsconfig` flags + convention. `strict: true` is **not** set in `tsconfig`.
- **Hard-coded hexes in `main.ts`** (`#FFC89B`, `#1A0F14`, `#E8956F`) in the iframe-refusal fallback HTML — technically violates the "all colors from theme.ts" rule, but only reachable in the cross-origin-iframe path.
- **No tests for canvas/controls/render.** The suite covers physics + outcomes + fit + starfield only. Input handling, ESC, cursor logic, resize wiring, `screenToLogical`, and DPR are browser-only verified.

---

## 11. Future direction

The committed future direction is a **native Swift iOS rewrite**, specced in [`docs/IOS_NATIVE_APP_PLAN.md`](./IOS_NATIVE_APP_PLAN.md). Decisions locked 2026-06-03: native Swift (not Capacitor), portrait-playable, SwiftUI `Canvas` + `TimelineView(.animation)`, pure-Swift physics with no engine (SpriteKit as fallback). Its Section 3 is a faithful port spec of every constant and formula in this document and is the source of truth for the port; its open decisions and App Store checklist live in Sections 10–11.

Two things in that plan are stale relative to the current web code and should be reconciled when the port starts: it says the suite is "13 cases today" (true only for the physics+outcome subset — the full suite is **25**, adding `fit.test.ts` and `starfield.test.ts`), and it predates the camera-follow / full-bleed model, which the port should mirror. The plan's Section 11 web-mobile note ("landscape works full-bleed; portrait shows a rotate-to-landscape prompt") matches the live `style.css` portrait media query.
