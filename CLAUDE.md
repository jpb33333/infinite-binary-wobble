# CLAUDE.md

Project rules for working on this codebase with Claude Code.

## gstack

This project uses the [gstack](https://github.com/garrytan/gstack) skill suite. Available skills include `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/autoplan`, `/codex`, `/qa`, `/qa-only`, `/design-review`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/investigate`, `/document-release`, `/retro`, `/careful`, `/freeze`, `/guard`.

Skill routing:
- Plan an architecture change → `/plan-eng-review`
- Plan a UI / visual change → `/plan-design-review`
- Audit the live build's visuals → `/design-review`
- Test the game end-to-end and fix bugs → `/qa`
- Code review before merge → `/review`
- Open the PR → `/ship`
- Deploy to GitHub Pages → `/land-and-deploy`

---

**Think. Plan. Ask. Then build.**

## Rules

1. **Plan mode first.** Any task beyond a single obvious step starts with a written plan: goal, approach, risks, open questions. No code until approved.
2. **Ask, don't guess.** If intent is ambiguous, stop and clarify.
3. **Verify before you speak.** Check current docs, don't fabricate library behavior, cite sources, say "I'm not sure" when you aren't.
4. **Simplest correct solution.** Minimize dependencies and moving parts. If you can't explain what a function does in one sentence, split it.
5. **Test before you fix.** Write a failing test that reproduces the problem, then fix.
6. **Read your own diff.** Before presenting work: confirm it builds, tests pass, matches the plan, handles edge cases.
7. **No unwired functions. No stubs. No placeholders.** Every function must be called. Every UI element must be connected to working logic. No `// TODO`s left behind. Finish what you start. (Known exceptions today: `stats.resetStats` is exported but unwired — there is no clear-scoreboard UI yet — and the `api-worker` iOS routes are deliberate fail-closed 501 stubs awaiting Apple SDKs. Don't add more.)
8. **Physics correctness is the floor, not the ceiling.** The orbit math is not a place for vibes. Tests assert energy conservation, momentum conservation, escape/bound classification, and outcome rules. Run `npm test` before every commit.
9. **Game feel beats math purity.** Once the physics are correct, the constants (`G`, `DT`, mass range, velocity cap, win thresholds) get tuned by *playing the game*, not by deriving them. The units are mixed pixel/second/arbitrary-mass — they are game-feel-tuned, not SI. `npm run dev`, play through, adjust, repeat.

## Don'ts

- Don't skip plan mode to save time.
- Don't introduce dependencies without checking maintenance status and vulnerabilities. (There are currently zero runtime dependencies — keep it that way.)
- Don't write lazy code. No placeholder stubs, no unwired functions, no UI buttons that do nothing.
- Don't build UI without working logic behind it.
- Don't commit secrets. The `api-worker/` backend needs several at deploy time — they go in via `wrangler secret put`, never the repo (see `api-worker/wrangler.toml`'s comment block); the web build's `VITE_*` values are public-safe by design.
- Don't commit directly to `main`. Every change goes via a feature branch and PR. (Pushing to `main` auto-deploys to GitHub Pages.)

## Workflow

- `npm install` — once.
- `npm run dev` — local dev server with HMR (Vite's default port, usually http://localhost:5173). The dev server strips the CSP `<meta>` tag via a `apply: 'serve'` plugin; production keeps it.
- `npm test` — run all Vitest tests once (43 tests).
- `npm run test:watch` — Vitest in watch mode (useful while tuning physics).
- `npm run build` — type-check (`tsc`) then produce the production bundle in `dist/`.
- `npm run preview` — serve the built bundle locally.
- `cd api-worker && npm run typecheck && npm test` — the Cloudflare Worker is its own package (32 tests); touch it, test it.

Before every commit: `npm test && npm run build` must both pass (CI enforces both on every PR via `.github/workflows/ci.yml`).
Before declaring a UI change done: `npm run dev` and actually play through both setup phases plus a full simulation — in landscape AND portrait if the change touches layout. The tests cover physics + outcome + fit + layout + starfield + meter invariants; they do **not** exercise the canvas, controls, cursor logic, resize wiring, or `screenToLogical` — only a real browser does.

Note on Node: CI runs Node 22; nothing pins the local version (no `engines` field). Prefer Node 22 to match CI — `npm run export:fixtures` refuses other majors by design.

## Architecture (one-paragraph mental model)

`src/main.ts` boots a `Game` (`src/game/Game.ts`) which owns the state machine (`src/game/states.ts`, 7 states including the web-only `paywall`), a `Renderer` (`src/render/Renderer.ts`), a `Meter` (`src/net/meter.ts`, fail-open and inert unless `VITE_API_BASE_URL` is set), and — once a round starts — a `Simulation` (`src/physics/Simulation.ts`). The Game drives `requestAnimationFrame`; each frame it advances the `Simulation` (PEFRL 4th-order symplectic integration over exactly two `Body` instances under Plummer-softened Newtonian gravity, drained from a fixed-step accumulator), asks `outcomes.ts` to classify the current state (Playing / WIN / LOSE_*), and asks the `Renderer` to paint. The game renders in one of two fixed design spaces — **1280×800 landscape or its 800×1280 portrait transpose**, picked per viewport by `layoutForViewport` — that the Renderer maps into the live viewport with a uniform contain-fit (`computeFit`), letterboxed and DPR-sharp; `Renderer.screenToLogical` inverts that fit so pointer hit-tests line up. The `src/ui/` controls (`PositionControl`, `MassControl`, `ArrowControl`, plus the `input.ts` geometry helpers) are **passive mutators** of a `BodySpec`, active only during the Setup states — the Game owns all pointer/wheel/keyboard wiring and polls the controls' getters; the controls emit no events. Two siblings live alongside the web game: `api-worker/` (the metering/payments Worker, not deployed) and `ios/` (the native SwiftUI port).

### Rendering: the three transform regimes

`Renderer.render()` paints in a strict layered order across three coordinate regimes, and mixing them up breaks full-bleed coverage:

1. **Identity transform** (raw device buffer) — the deep-void background fill.
2. **DPR-only screen space** (`setTransform(dpr, …)`) — the full-bleed **starfield** and the **ambient** stardust layer, which cover the whole window including the letterbox margins. Star positions are normalized `[0,1]` and scaled to the live viewport; the field is deterministic and order-stable, so a bigger window only *appends* stars.
3. **Scene transform** (`dpr × fit.scale`, plus the centering offset) — everything in design-space pixels: court, stars, trails, predicted orbits, barycenter, HUD, cards, and the **burst** particle layer (collision debris, kept in world coordinates so it rides the fit). The ambient layer is drawn last, back in screen space, on top of everything.

Two particle layers by design: **ambient** (screen space, full-bleed) and **burst** (design space, rides the fit). The camera offset (`input.cameraOffset`) wraps only the system content inside `renderSimulate`, keeping the barycenter centered while court/HUD/starfield stay fixed.

## Critical files

| File | Why it matters |
|---|---|
| `src/physics/integrator.ts` | PEFRL 4th-order symplectic step — the heart of orbital correctness |
| `src/physics/orbit.ts` | Energy, angular momentum, eccentricity, period — the inputs to win/lose |
| `src/game/outcomes.ts` | Classifies every frame as Playing / WIN / LOSE_* + the win/lose thresholds — the heart of game design |
| `src/physics/Simulation.ts` | Owns the two bodies, the time, the `PHYSICS` constants, input sanitization |
| `src/render/Renderer.ts` | The contain-fit, DPR, `screenToLogical`, and the layered render loop |
| `src/render/fit.ts` | `computeFit` — the responsive design-space → viewport mapping |
| `src/theme.ts` | Palette and font tokens — the heart of the look |
| `src/ui/ArrowControl.ts` | Drag-to-set-velocity — the heart of the feel |

If any one of these is wrong, the game is wrong.

## House style

- TypeScript with the strictness flags in `tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`). Note: the umbrella `strict: true` is **not** set today; rely on the individual flags. No `any` unless you explain why in a one-line comment.
- Module per concept, named for what it does (`gravity.ts`, not `physics-utils.ts`).
- No frameworks, no UI libraries — vanilla DOM events on a single `<canvas id="stage">`.
- All colors come from `src/theme.ts`. Never hard-code a hex outside that file. (The one exception is `style.css` — the iframe-refusal, noscript, and dedication styles duplicate palette hexes because CSS can't read `theme.ts`; keep them in sync by hand and don't add more.)
- Physics constants live in `src/physics/Simulation.ts` (the `PHYSICS` object) and `src/physics/Body.ts` (`RADIUS_BASE`). Gameplay **limits** (mass 1.0–5.0, velocity cap 300) live in `src/game/states.ts` (`LIMITS`). Outcome **thresholds** (warmup, win orbits, win eccentricity 0.93, off-canvas grace, 820 px barycenter distance) live in `src/game/outcomes.ts` (`DEFAULT_OUTCOME_CONFIG`). Don't sprinkle magic numbers — add to the right table. Note `WARMUP_SECONDS = 0.6` is defined in `PHYSICS` but consumed only by `outcomes.ts`, which keeps its own copy.
- Two clamp layers exist by design: physics `SAFE_INPUT` (wide, defence-in-depth at the `Simulation.create` boundary) and UI `LIMITS` (narrow). `SAFE_INPUT` must always stay wider than `LIMITS` or legitimate UI inputs would be clamped.
