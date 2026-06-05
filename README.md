# Infinite Binary Wobble

> Infinite Binary Wobble. It's a 2-player game where two human players (who are considering falling in love) set the vector, velocity, and mass of their star, as well as its starting position within a square on their side of "space" or "the void" as we'll put it in the game. This is a metaphor for love. Binary stars rotate around a shared center of gravity, the relationship pulls each independent object into one celestial being, and thus it and they exist simultaneously in an infinite dance, an infinite binary wobble.

---

## What it is

A two-player browser game with real Newtonian gravity. Each player sets up a star — position, mass, and velocity vector — within their side of the Celestial Court. When both have locked in, the simulation runs and the two stars play out the orbit you gave them.

**Win**: the two stars settle into a stable bound orbit — the *infinite binary wobble*. The simulation never stops; you stay and watch as long as you like.
**Lose**: they escape each other into the void, slingshot too far to return in any meaningful time, or collide head-on (and go supernova).

Love is an infinite game, but in this version the setup matters. The wobble is rare.

## Play

1. `npm install`
2. `npm run dev`
3. Open the URL Vite prints (usually http://localhost:5173).
4. Two players, one laptop. Trade the mouse between setup phases.

Player 1 sets their star on the left court; Player 2 on the right. For each star:

- **Drag the body** anywhere in your half to place it — the star lives inside a dotted 400×400 in-bounds box, with its center kept 24px clear of the edges (a 352×352 range for the center).
- **Drag outward from the body** to draw the velocity vector. Length is speed (1 pixel of arrow = 1 px/s), the tooltip shows the magnitude, and the maximum is 300.
- **Mouse wheel over your court** (or tap the **−**/**+** pills on touch) to set mass, from 1.0 to 5.0. The star's radius grows with mass — area is proportional to mass, so a heavier star is visibly bigger.

Hit **Lock In** when you're satisfied (you can't lock in with a near-zero velocity — give the star a push first). After both players lock in, a 3-second countdown precedes the simulation. Watch.

**Press ESC** at any point to abandon the round and return to the title screen.

The camera follows the system's barycenter, so a drifting pair stays centered on screen. The HUD reads out live diagnostics — separation, relative speed, energy (BOUND / UNBOUND), eccentricity, period, orbit count, and elapsed time. The title screen keeps a per-session scoreboard (total plays, wobble count, wobble rate, how the lost rounds ended — drifted / collided — and your best wobble in orbits). It lives in a session cookie and clears when you close the browser.

## Physics

The simulation is two-body Newtonian gravity, integrated with the **PEFRL 4th-order symplectic scheme** ([Omelyan, Mryglod & Folk, 2002](https://www.sciencedirect.com/science/article/abs/pii/S0010465502004515)) and softened with a Plummer kernel to avoid the singularity at close approach. One PEFRL step is 5 drifts, 4 kicks, and 4 force evaluations, time-symmetric. Because the integrator preserves phase-space volume, energy oscillates with bounded amplitude rather than drifting secularly — the long-run energy test holds drift under `1e-5` over 50,000 steps on a circular orbit.

The simulation runs at a fixed `DT = 1/240 s`, with 4 substeps per display frame (so `4 × 1/240 = 1/60 s` of simulated time per frame), decoupled from the real frame rate by a fixed-step accumulator. Each frame, `src/physics/orbit.ts` derives the orbital diagnostics for the **relative** orbit (body B relative to body A) using **specific** quantities, where `M = m₁ + m₂`:

- **Specific orbital energy** `ε = ½·|v_rel|² − G·M / r`
- **Specific angular momentum** `h = |r × v_rel|`
- **Eccentricity** `e = √(1 + 2·ε·h² / (G·M)²)` (clamped to 0 when the term under the root goes negative from round-off)
- **Semi-major axis** `a = −G·M / (2·ε)` when `ε < 0`, else `∞`
- **Orbital period** `T = 2π·√(a³ / (G·M))` (Kepler), or `∞` when unbound
- **Bound** when `ε < 0`

The total mechanical energy is `E = μ·ε` with reduced mass `μ = m₁m₂/M`; the constructor caches the initial total energy for drift comparison.

The outcome classifier (`src/game/outcomes.ts`) reads these every frame and decides whether you're still playing, have wobbled into a win, or have lost in one of three ways:

- **WIN** — bound, `e ≤ 0.93`, and at least 2 completed orbits, with neither body more than 820 px from the barycenter. Orbits are counted from the unwrapped relative angle and keep ticking after the win, so the ORBITS readout climbs 2 → 4 → 6 … forever.
- **LOSE_COLLISION** — the two surfaces touch (separation < the sum of the radii). Checked first, every frame, even during the 0.6 s warmup.
- **LOSE_ESCAPE** — a body stays more than 820 px from the barycenter for 0.6 s while the orbit is unbound.
- **LOSE_SLINGSHOT** — same off-canvas condition, but the orbit is still technically bound (a very long arc home).

Off-canvas is measured as distance from the mass-weighted barycenter, not from the screen edge — because the camera follows the barycenter, a compact orbit can drift across the screen forever without losing.

Source: see `src/physics/` and `src/game/outcomes.ts`. Gameplay limits (mass 1.0–5.0, velocity cap 300) live in `src/game/states.ts`; the win/lose thresholds live in `src/game/outcomes.ts`.

## Aesthetic

Warm-toned, retro-futurist, soft. Inspired by Spike Jonze's *Her* (production design K.K. Barrett, cinematography Hoyte van Hoytema). No blues, no neon, no harsh edges. Cardo for the wordmark and victory text, Inter for the UI. A full-bleed, deterministic starfield twinkles behind everything across the entire window, with ambient stardust drifting on top and burst debris when stars collide.

Palette lives in `src/theme.ts`. Fonts (Cardo + Inter, plus Great Vibes for the homepage dedication's cursive line) are self-hosted from `public/fonts/`.

## Build, test, deploy

This is a vanilla-TypeScript canvas app built with Vite. No runtime dependencies — only TypeScript, Vite, and Vitest as devDependencies.

- `npm install` — once.
- `npm run dev` — Vite dev server with HMR (the dev server strips the CSP `<meta>` tag so blob-worker console noise doesn't appear; production keeps the tight CSP).
- `npm test` — run the Vitest suite once (25 tests across physics, outcomes, fit, and starfield).
- `npm run test:watch` — Vitest in watch mode.
- `npm run build` — type-check (`tsc`) then bundle to `dist/` (static; deployable under any subpath, `base` is relative).
- `npm run preview` — serve the built bundle locally.

Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`): it runs the tests, builds, and deploys `dist/` to GitHub Pages. The live site is https://jpb33333.github.io/infinite-binary-wobble/.

## Project structure

See [`CLAUDE.md`](./CLAUDE.md) for the architecture overview and the rules of the road, and [`docs/PROJECT_STATE.md`](./docs/PROJECT_STATE.md) for the cold-start handoff (current state, file map, runbook, known gaps). A native iOS rewrite is sketched in [`docs/IOS_NATIVE_APP_PLAN.md`](./docs/IOS_NATIVE_APP_PLAN.md).

## License

MIT. See [LICENSE](./LICENSE).
