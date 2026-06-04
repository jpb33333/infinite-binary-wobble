# Plan: Drastically improve the mobile experience

Status: **Draft / planning** — to be refined in CLI before any of Phase 2+
is built. Phase 1 (dismissible WIN card + on-screen EXIT) already shipped on
this branch.

## Goal

Make _Infinite Binary Wobble_ feel like it was designed for touch first —
phones, tablets, and the iOS app wrapper — without regressing the desktop
experience. Today the game is playable on mobile but was tuned on a
1280×800 mouse-and-keyboard stage; several interactions are keyboard-only or
mouse-sized, and the fixed-aspect court wastes space on tall phone screens.

The desktop build must stay identical in feel. Every change below is either
additive (new touch affordance) or responsive (adapts to viewport), never a
desktop regression.

## Non-goals

- Native iOS code. The "iOS app" is assumed to be a WKWebView/Capacitor-style
  wrapper around the live site. This plan improves the web build it loads.
  Native shell work (App Store packaging, splash, status-bar theming) is a
  separate track.
- Rewriting the physics, the outcome rules, or the visual language. Game feel
  and the _Her_-derived palette are fixed.
- A second input paradigm. Touch and mouse continue to share one
  `PointerEvent` path.

## Current state (what already works)

- **Responsive canvas.** `Renderer` draws in a fixed 1280×800 _design space_
  and applies a uniform contain-fit transform to the live viewport
  (`computeFit`), DPR-sharp, refit on every `resize`. Physics never shift
  with screen size.
- **Unified pointer input.** `Game.attachInput` routes mouse + touch + pen
  through `pointerdown/move/up`; `touch-action: none` claims gestures.
- **Touch-reachable controls exist.** Mass `−`/`+` pills, Lock In, Begin,
  Again are all canvas buttons hit-tested via `Renderer.hoveredButton`.
- **Phase 1 (this branch):** WIN card is dismissable (✕), and a persistent
  EXIT pill provides the ESC-key equivalent for touch.

## Gaps (why mobile still feels second-class)

1. **Letterboxing on tall screens.** Contain-fit on a 9:19.5 phone in
   portrait leaves huge top/bottom letterbox bars; the 1280×800 court floats
   in the middle at a small scale. The playfield is tiny and the two side
   courts get cramped.
2. **Two side-by-side courts assume landscape.** P1 left / P2 right is a
   landscape mental model. In portrait the courts are narrow and the
   in-bounds boxes shrink, making the drag-to-throw gesture fiddly.
3. **Tap targets vary.** Some hit areas (the star body for velocity drag, the
   `−`/`+` pills at 40px) are borderline for fingers; the ✕ on the card was
   deliberately given a 40px hit rect, but other elements weren't audited
   against a touch-target minimum (44×44 iOS HIG / 48dp Material).
4. **No haptics, no momentum, no large-thumb ergonomics.** Controls sit where
   they read well visually, not where thumbs reach (bottom third of the
   screen).
5. **Text sizes are px-fixed in design space.** At small contain-fit scales,
   HUD labels (11px) and help text (12px) become hard to read on a phone.
6. **iOS web quirks unverified.** Safe-area insets (notch / home indicator),
   `100vh` vs visual-viewport, double-tap-zoom, rubber-band scroll, and the
   wrapper's status bar haven't been audited.
7. **Orientation.** No explicit handling/encouragement of landscape, which is
   the natural fit for a two-player side-by-side game.

## Proposed phases

### Phase 1 — Escape hatch + unobstructed watch — DONE (this branch)

- ✕ to dismiss the WIN card; orbit keeps running underneath.
- Persistent EXIT pill = on-screen ESC for touch.

### Phase 2 — Touch-target & ergonomics audit (low risk, high payoff)

- Define a single `TOUCH_TARGET_MIN` (≥ 44 design-space px, scaled) and audit
  every interactive element against it: star-body grab radius, `−`/`+`,
  Lock In, Begin, Again, EXIT, ✕.
- Grow hit rectangles independently of visual size where needed (the ✕
  already does this — generalize the pattern).
- Verify hover-only affordances degrade gracefully (touch has no hover; the
  contextual cursor work is desktop-only and already no-ops on touch).

### Phase 3 — Portrait layout / orientation strategy

Decision needed (see open questions): **stack the courts vertically in
portrait** vs **prompt to rotate to landscape**. Options:

- **3a. Responsive court stacking.** When viewport aspect < ~1.0, lay P1 on
  top, P2 on bottom (or a single shared court with a turn indicator). This
  keeps portrait usable but is the larger change — `CourtLayout`,
  `DEFAULT_LAYOUT`, region/in-bounds math, and several render helpers assume
  a left/right split keyed off `centerLineX`.
- **3b. Rotate-to-play nudge.** A lightweight overlay in portrait ("turn your
  phone") that disappears in landscape. Cheap; punts the real layout work.
- **3c. Hybrid.** Ship 3b now, plan 3a as a follow-up.

Whichever we pick, the design-space → physics decoupling means the physics
constants do **not** change — only the layout rectangles and where the
contain-fit maps them.

### Phase 4 — Readability at small scale

- Make HUD / help / tooltip font sizes scale with a floor relative to the
  contain-fit scale (or switch the HUD to a more compact mobile arrangement
  below a width threshold).
- Re-flow the bottom HUD strip so it doesn't truncate (`drawHud` already
  breaks early when it runs out of width — verify the mobile break point).

### Phase 5 — iOS web-shell polish

- Honor `env(safe-area-inset-*)` so controls clear the notch and home
  indicator (pad the design-space → screen mapping, or inset the corner
  control cluster).
- Use the visual-viewport API / `dvh` to avoid the iOS `100vh` jump.
- Confirm `touch-action`, `user-select`, double-tap-zoom, and overscroll are
  all suppressed inside the wrapper.
- Optional: light haptic feedback on Lock In / WIN where the wrapper exposes
  it.

## Risks

- **Layout coupling.** `CourtLayout` and `centerLineX` are threaded through
  render, UI controls, and the outcome classifier (`outcomeConfigForLayout`).
  A portrait re-layout (3a) touches all three — must keep them in agreement,
  and the physics-invariant tests (energy/momentum/eccentricity) must still
  pass untouched since the layout doesn't feed the integrator.
- **Two-player on one phone.** Side-by-side hot-seat on a small screen is
  awkward regardless of layout; worth a design conversation about whether
  mobile is one-device-two-players or something else.
- **Verification gap.** Tests don't exercise the canvas; the SessionStart hook
  / CI can't catch touch-layout regressions. Mobile changes need a real
  device or emulator pass (and ideally a screenshot harness — see below).

## Open questions

1. Portrait strategy: stack the courts (3a) or nudge to landscape (3b/3c)?
2. Is the iOS app a WebView wrapper of the live site, or a separate build? If
   separate, what's the deploy path and does it pin a site version?
3. Hot-seat on a phone: keep two side-by-side courts, or rethink the
   two-player flow for a single small device?
4. Do we want a screenshot/visual-regression harness (headless Chromium) so
   mobile layouts can be checked in CI? Tests currently cover physics only.

## Verification plan

- Per phase: `npm test && npm run build` (regression floor), then a real
  play-through on at least one phone (portrait + landscape) and one tablet,
  plus the iOS wrapper if available.
- Phase 3/4 specifically need device screenshots at representative viewports
  (e.g. iPhone SE, iPhone 15 Pro, iPad) attached to the PR.

---

_This is a living plan. Refine in CLI, then split each phase into its own
branch/PR rather than landing the whole thing at once._
