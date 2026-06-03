# Changelog

All notable changes to **Infinite Binary Wobble** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Canvas now fills any viewport (responsive resize).** The stage was a
  fixed 1280×800 surface — above 1300px wide it just sat centered with dead
  margins, and nothing re-rendered on window resize. The game still renders
  in a fixed 1280×800 *design space* (so the pixel-tuned physics and win/lose
  thresholds never shift with screen size), but the Renderer now applies a
  uniform contain-fit transform — centered, letterboxed, DPR-sharp — sized to
  the live viewport, and refits on every `resize` (re-reading
  `devicePixelRatio`, so dragging between monitors stays crisp). Pointer hit
  tests invert the same transform via `Renderer.screenToLogical`. New
  `computeFit` helper with unit coverage (`tests/fit.test.ts`).

### Added
- **Escape** key returns to the title screen from any state. Resets specs,
  trails, sim, classifier, outcome, and the supernova animation. A way out
  without forcing the player to wait for a resolve they don't want.
- **Per-session scoreboard** on the title screen, persisted in a session
  cookie (`ibw-stats-v1`, no `Expires` → clears with the browser session).
  Shows total plays, wobble count, win rate, drift / collision breakdown,
  and best wobble in orbits.
- **Per-play stats line** on every resolved card. WIN reads
  *"19s · 2 orbits · ecc 0.79"* and keeps ticking as the wobble continues;
  LOSE cards show duration + eccentricity, or for collision, the relative
  speed at impact ("2275 m/s at impact").
- **ESC affordance surfaced** in the setup help block as a fifth, faded
  italic line ("Press ESC to return to title.") so first-time players
  discover the key without rediscovering it through the manual.
- **Contextual cursor.** The canvas was `cursor: crosshair` everywhere,
  which felt cheap. Now: `pointer` over buttons, `grab` (and `grabbing`
  while dragging) over the active star, `crosshair` over the active
  player's court, `default` everywhere else. Standard tactile feedback.

### Fixed
- **Card-vs-HUD overlap (ISSUE-006).** The WIN outcome card was
  bottom-anchored at `h - cardH - 40`, putting its translucent fill on top
  of the HUD label row (ENERGY / ECC. / PERIOD / ORBITS / TIME washed out
  behind the card). Bumped the bottom margin to 72px so the card ends
  19px clear of the HUD label ascenders.
- **Dev-only CSP/blob-worker console error (ISSUE-007).** Vite's dev
  server spawns a blob: worker for client transforms which the production
  CSP (`script-src 'self'`) blocks. Added a tiny Vite plugin scoped to
  `apply: 'serve'` that strips the `<meta http-equiv="Content-Security-Policy">`
  tag from the HTML the dev server returns. The production `dist/index.html`
  ships the tight prod CSP untouched.
- **Phase label honesty (ISSUE-008).** The header always read "in motion"
  while resolved, even on LOSE outcomes where the sim is frozen. Now keyed
  off the outcome: `in motion` for playing / win, `drifting` for
  lose_escape / lose_slingshot, `stilled` for lose_collision.
- **Button-halo clipping (ISSUE-009).** The radial-gradient glow behind
  every canvas button (BEGIN, LOCK IN, AGAIN, mass ±) was being drawn into
  a `fillRect` sized `width + haloR × height + haloR`. For wide-but-short
  buttons (180×44) the rect was narrower than the gradient circle
  vertically, clipping the glow into a visible rectangle. Now the fill
  area is a `2 · haloR` square centered on the button — the smallest rect
  that always contains the gradient circle.
- **ORBITS counter frozen after WIN (ISSUE-010).** The classifier
  early-returned past the angle-unwrap once it had resolved, and
  `Game.update`'s `case 'resolved'` never called `classifier.update()`
  anyway. The counter froze at 2 (the win threshold) while the wobble
  visibly continued. Moved the unwrap above the early-return guard and
  wired `classifier.update(sim, dt)` into the `resolved + win` branch.
  The counter now ticks 2 → 4 → 6 → … as the wobble continues, exactly
  as "stay and watch as long as you like" promised.

### Verified
- All four outcome paths: WIN, LOSE_ESCAPE, LOSE_SLINGSHOT
  ("A long arc home." with `drifting` phase label, e≈0.95 at the edge of
  the bound-but-too-wide envelope), LOSE_COLLISION.
- Mid-sim reload returns to title cleanly.
- Long-run sim stability (30s+ continuous sim, no NaN, energy stays
  bounded, orbits count up linearly).
- Mobile portrait nudge + landscape canvas at 390×844 / 844×390.
- Production CSP remains intact in `dist/index.html` after the dev-server
  plugin change.

## [0.1.0] — initial release

Two-player gravitational binary-star browser game. PEFRL 4th-order
symplectic integration over two bodies under softened Newtonian gravity.
Players set position, mass, and velocity vector inside their half of the
Celestial Court; the simulation classifies the result as WIN (stable
bound orbit), LOSE_ESCAPE, LOSE_SLINGSHOT, or LOSE_COLLISION. Vanilla TS
+ Vite, no UI framework, single `<canvas>`.
