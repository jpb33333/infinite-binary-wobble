# Infinite Binary Wobble

> Infinite Binary Wobble. It's a 2-player game where two human players (who are considering falling in love) set the vector, velocity, and mass of their star, as well as it's starting position within a square on their side of "space" or "the void" as we'll put it in the game. This is a metaphor for love. Binary stars rotate around a shared center of gravity, the relationship pulls each independent object into one celestial being, and thus it and they exist simultaneously in an infinite dance, an infinite binary wobble.

---

## What it is

A two-player browser game with real Newtonian gravity. Each player sets up a star — position, mass, and velocity vector — within their side of the Celestial Court. When both have locked in, the simulation runs.

**Win**: the two stars settle into a stable bound orbit — the *infinite binary wobble*.
**Lose**: they escape each other into the void, slingshot too far to return in any meaningful time, or collide head-on.

Love is an infinite game, but in this version the setup matters. The wobble is rare.

## Play

1. `npm install`
2. `npm run dev`
3. Open the URL Vite prints (usually http://localhost:5173).
4. Two players, one laptop. Trade the mouse between setup phases.

Player 1 sets their star on the left court; Player 2 on the right. For each star:

- **Drag the body** to place it within the dotted court boundary.
- **Drag outward from the body** to draw the velocity vector — length = speed, tooltip shows the magnitude.
- **Mouse wheel on the body** (or drag its edge) to set its mass — radius scales with mass.

Hit **Lock In** when you're satisfied. After both players lock in, a countdown precedes the simulation. Watch.

## Physics

The simulation is two-body Newtonian gravity, integrated with the **PEFRL 4th-order symplectic scheme** ([Omelyan, Mryglod & Folk, 2002](https://www.sciencedirect.com/science/article/abs/pii/S0010465502004515)) and softened with a Plummer kernel to avoid singularities at close approach. PEFRL preserves phase-space volume, so energy oscillates with bounded amplitude rather than drifting secularly — measured drift is ~5×10⁻⁷ over 50,000 steps on a circular orbit. Each frame, we compute:

- **Total mechanical energy** `E = ½·μ·|v_rel|² − G·m₁·m₂ / r`, where `μ = m₁m₂/(m₁+m₂)`
- **Specific angular momentum** `h = |r × v_rel|`
- **Eccentricity** `e = √(1 + 2·E·h² / ((G·m₁·m₂)²·μ))`
- **Semi-major axis** `a = −G·m₁·m₂ / (2·E)` when `E < 0`
- **Orbital period** `T = 2π·√(a³ / (G·(m₁+m₂)))`

The outcome classifier (`src/game/outcomes.ts`) reads these and decides every frame whether you're still playing, have wobbled into a win, or have lost in one of three ways.

Source: see `src/physics/` and the inline citations in those files.

## Aesthetic

Warm-toned, retro-futurist, soft. Inspired by Spike Jonze's *Her* (production design K.K. Barrett, cinematography Hoyte van Hoytema). No blues, no neon, no harsh edges. Cardo for the wordmark and victory text, Inter for the UI.

Palette lives in `src/theme.ts`.

## Build

- `npm run build` → `dist/` (static; deployable anywhere)
- `npm run preview` → serve the built bundle locally
- `npm test` → Vitest physics + outcome tests

## Project structure

See [`CLAUDE.md`](./CLAUDE.md) for the architecture overview, the rules of the road, and how to use the gstack skills with this repo.

## License

MIT. See [LICENSE](./LICENSE).
