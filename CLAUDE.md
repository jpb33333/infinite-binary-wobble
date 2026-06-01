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
7. **No unwired functions. No stubs. No placeholders.** Every function must be called. Every UI element must be connected to working logic. No `// TODO`s left behind. Finish what you start.
8. **Physics correctness is the floor, not the ceiling.** The orbit math is not a place for vibes. Tests assert energy conservation, momentum conservation, eccentricity bounds. Run `npm test` before every commit.
9. **Game feel beats math purity.** Once the physics are correct, the constants (`G`, `DT`, mass range, velocity cap, win thresholds) get tuned by *playing the game*, not by deriving them. `npm run dev`, play through, adjust, repeat.

## Don'ts

- Don't skip plan mode to save time.
- Don't introduce dependencies without checking maintenance status and vulnerabilities.
- Don't write lazy code. No placeholder stubs, no unwired functions, no UI buttons that do nothing.
- Don't build UI without working logic behind it.
- Don't commit secrets. Nothing in this project needs them (no backend), and if that ever changes, env vars only.
- Don't commit directly to `main`. Every change goes via a feature branch and PR.

## Workflow

- `npm install` — once.
- `npm run dev` — local dev server with HMR on http://localhost:5173.
- `npm test` — run all Vitest tests once.
- `npm run test:watch` — Vitest in watch mode (useful while tuning physics).
- `npm run build` — type-check and produce the production bundle in `dist/`.
- `npm run preview` — serve the built bundle locally.

Before every commit: `npm test && npm run build` must both pass.
Before declaring a UI change done: `npm run dev` and actually play through both setup phases plus a full simulation.

## Architecture (one-paragraph mental model)

`src/main.ts` boots a `Game` (`src/game/Game.ts`) which owns a state machine (`src/game/states.ts`) and a `Simulation` (`src/physics/Simulation.ts`). The Game drives `requestAnimationFrame`; on each frame it advances the `Simulation` (Velocity Verlet integration over two `Body` instances under softened Newtonian gravity), asks `outcomes.ts` to classify the current state (WIN / LOSE_*), and asks the `Renderer` (`src/render/Renderer.ts`) to paint everything. `src/ui/` controls (PositionControl, MassControl, ArrowControl) are active during Setup states only — they directly mutate the relevant `Body` and emit events the Game listens for.

## Critical files

| File | Why it matters |
|---|---|
| `src/physics/integrator.ts` | Velocity Verlet step — the heart of orbital correctness |
| `src/physics/orbit.ts` | Energy, angular momentum, eccentricity, period — the inputs to win/lose |
| `src/game/outcomes.ts` | Classifies every frame as Playing / WIN / LOSE_* — the heart of game design |
| `src/physics/Simulation.ts` | Owns the two bodies, the time, the warmup gate |
| `src/theme.ts` | Palette and font tokens — the heart of the look |
| `src/ui/ArrowControl.ts` | Drag-to-set-velocity — the heart of the feel |

If any one of these is wrong, the game is wrong.

## House style

- TypeScript strict, no `any` unless you explain why in a one-line comment
- Module per concept, named for what it does (`gravity.ts`, not `physics-utils.ts`)
- No frameworks, no UI libraries — vanilla DOM events on a single `<canvas>`
- All colors come from `src/theme.ts`. Never hard-code a hex outside that file.
- All physics constants live in `src/physics/Simulation.ts` (top of file). Never sprinkle magic numbers.
