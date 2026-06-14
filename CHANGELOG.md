# Changelog

All notable changes to **Infinite Binary Wobble** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **The win card is now draggable** — on the web game and on iOS. Slide it
  anywhere on screen (it stays fully on-canvas) so the infinite wobble
  underneath stays watchable without losing the live stats line; the ✕ still
  dismisses it entirely for a fully clear view. AGAIN, the ✕, and the EXIT/
  AGAIN corner controls all keep tap priority over the card.
- **An occasional comet drifts across the deep background.** A faint warm
  streak crosses the sky roughly every 24 seconds for a few seconds, then it's
  empty sky again — a little life in the void, on the title screen and during
  play alike. It rides the same screen-space atmosphere layer as the starfield
  and freezes (with the twinkle and stardust) under reduced motion.

### Fixed
- **Text is legible on phones** — on the web game and the iOS app alike. Both
  render in a fixed design space that lands at about half-size on a phone held
  in portrait, which left help text, HUD labels, card stats, and tooltips far
  below the readable floor. Type that would render too small is now pulled up
  toward an on-screen legibility floor, preserving the size hierarchy; display
  text and near-full-size desktop / iPad are untouched. The setup help
  reflowed to fit; the win card grows to keep its footer inside the panel on
  the narrowest phones; and the card's ✕ — previously a roughly 6-point speck
  almost nobody noticed — is now visibly tappable with a matching touch target.
- **Grazing collisions can no longer slip between frames.** The simulation now
  remembers the closest the two stars have ever come (at full 1/240 s physics
  resolution), and the outcome classifier reads that instead of the
  once-per-frame snapshot. Before this, a fast near-miss could overlap and
  pull apart entirely between two frame checks — reliably missed at the 30 fps
  frame floor for light stars — and the round would end as "drifting" with no
  supernova even though the stars visibly touched. Fixed identically in the
  web engine and the Swift iOS port, each with a regression test that replays
  a tunneling graze.
- **Button hover styling now actually renders.** The renderer's button
  registry is double-buffered: hover highlights (brighter pill, wider halo,
  the explainer link's underline) were querying a just-cleared registry and
  could never match, so they had been silently dead on desktop. Clicks and
  the pointer cursor were unaffected.
- **The paywall headline tracks the configured free-play limit.** It
  hardcoded "A hundred wobbles in." while the limit is 200; the count is now
  interpolated from config alongside the body line. (Latent until metering
  ships — the paywall is unreachable while the backend is dark.)

### Changed
- **The homepage footer dropped its personal dedication and the studio name is
  now Gamerboygirl Gaming.** The title screen previously carried a "For Natalia /
  From JP" couplet above the copyright; the footer is now just the copyright
  line, which reads **© Gamerboygirl Gaming 2026** (the LICENSE copyright holder
  changed to match, superseding the earlier Carousella Gaming name).
- **The "what is a binary star?" explainer link moved from the top-right
  corner to centred just above the BEGIN button** — where a curious
  first-timer is already looking, and in the thumb zone on phones. Same quiet
  styling, same finger-sized hit rect (kept 22px clear of BEGIN's so a
  mis-tap never lands on both); when metering ships, it mirrors the
  free-plays line below the button. It also reads bigger now (15→18px) so it
  doesn't get lost on a desktop window.
- **The background stars twinkle more.** The shimmer was always there but
  gentle (each star swayed 20–100% of its brightness); it now breathes more
  visibly (10–100%) without any star blinking fully out. Still frozen under
  reduced motion.

### For contributors
- **Live-device iOS QA harness** (`ios/DebugBridge/`, `/ios-qa`): a debug-only
  in-app server that drives the SwiftUI app on a real iPhone over USB —
  screenshots, state snapshots, and tap/swipe — for agent-run QA. Every line
  is `#if DEBUG`-gated and verified absent from Release builds (the touch
  layer's private-API code carries a Clang `DEBUG` define so Release links a
  no-op stub; confirmed by symbol dump). The mass of the iOS work this cycle
  was found and fixed through this harness.

## [0.5.0] — 2026-06-10

### Added
- **iOS assets harvested from the standalone repo** (which is now archived):
  the six SIL-OFL **Cardo + Inter TTFs** with license text and per-file
  SHA-256 provenance (`ios/App/Resources/`, hashes verified on harvest),
  wired into the app via `project.yml`'s generated Info.plist (`UIAppFonts`);
  a **constants-guard test** pinning every play-tuned physics constant to its
  exact contractual value (`ConstantsGuardTests.swift`); and the three
  product docs — `ROADMAP-IOS.md` (saved/sent wobbles, the 1000-free-plays
  meter decision, north star), `V1-LOCK.md`, `ABOUT-SCREEN.md` — preserved
  under `docs/ios/` with provenance banners flagging where they conflict
  with what actually shipped (bundle id, orientation, stats persistence).
- **PR test gate (`.github/workflows/ci.yml`).** Every pull request now runs
  the web suite (audit, tests, build) and the api-worker suite (audit,
  typecheck, tests), with per-PR concurrency; previously tests ran only
  post-merge inside the deploy workflow, so a broken PR surfaced only after
  landing.
- **Web meter client tests** (`tests/meter.test.ts`) pinning refresh-first
  boot, the first-visit Turnstile→session→status order, the gate contract,
  the paywall un-latch on session expiry, and fail-open behavior on
  401 / 5xx / malformed bodies / network errors.

### Changed
- **Free-play allotment set to 200** (decided 2026-06-10; supersedes the 100
  default and the 1000 recorded in the harvested iOS roadmap):
  `FREE_PLAY_LIMIT` in `wrangler.toml`, the worker's fallback, the client's
  display hint, and every doc now agree. Web metering stays best-effort by
  design — a determined player re-earning free plays is accepted.
- **Copyright holder unified as Carousella Gaming** (decided 2026-06-10):
  the LICENSE attribution line now matches the live footer; the harvested
  About-screen copy is flagged to use it when that screen is built. The
  practical to-company checklist (LLC, IP assignment, Copyright Office
  registration, Apple organization enrollment, trademark lane) lives in
  `docs/plans/gamerboygirl-copyright.md`.
- **Golden-fixture exporter writes both copies, with guardrails.**
  `npm run export:fixtures` now emits identical fixtures to `tests/fixtures/`
  *and* `ios/WobblePhysics/Tests/WobblePhysicsTests/Fixtures/` (the copy the
  Swift suite actually loads via `Bundle.module`), and refuses to run on a
  Node major other than the one the committed fixtures were generated on
  (Node 22 — engine-dependent `Math.pow` churns trajectory tails at the last
  ULP; `--force` overrides for a deliberate regeneration). The `ios-physics`
  workflow now asserts the two fixture trees are byte-identical before
  running the Swift suite, triggers on `tests/fixtures/**` changes, and pins
  its `checkout` action to the same v6.0.3 SHA as the deploy workflow.
- **Metering CSP injection fails loudly.** The build-time `meteringCsp`
  plugin now throws if either of its CSP anchor substrings stops matching
  `index.html`, instead of silently shipping a policy that blocks every
  metering fetch (which the fail-open client would mask as
  "the paywall just never appears").

### Removed
- Dead `hitTest` export in `src/render/overlay.ts` (the Renderer's
  `hoveredButton()` owns all button hit-testing).
- Dead `MassControl.setMass` (zero callers — it was documented as "test-only"
  but no test ever used it) and the never-imported `src/utils/lerp.ts`, both
  surfaced by the documentation truth pass.

### Fixed
- **Metering: a page reload no longer resets the device.** `/v1/web/session`
  now reuses the device behind a valid session cookie (sliding 30-day renewal,
  missing rows re-adopted under the same id) instead of minting a fresh
  identity per call, and the web client boots refresh-first — Turnstile and
  the session mint only run when the server answers 401. Previously every
  page load created a new device: the 100-free-plays meter reset on refresh,
  and a paid unlock was orphaned the moment Stripe's `?checkout=success`
  redirect reloaded the page. A session that expires mid-visit now also
  un-latches a cached paywall lock instead of trapping the player (fail-open).
- **Stripe webhook: a transient failure can no longer eat a payment.** The
  idempotency claim on an event id is released if applying the event throws,
  so Stripe's retry re-processes it instead of hitting the duplicate path —
  one D1 hiccup can no longer leave a paying customer permanently locked. A
  failed claim release and a refund that can't resolve its device are logged
  loudly for manual reconciliation (both are otherwise invisible).
- **CSP no longer blocks the PWA manifest.** `manifest-src 'self'` added to the
  CSP (meta tag + the recommended header set in `SECURITY.md`) — it previously
  fell back to `default-src 'none'`, which silently blocked
  `manifest.webmanifest` and broke Android/Chrome "Install app" (iOS install
  was unaffected — it reads the `apple-touch-icon`/meta tags instead).

### Security
- **Session cookie hardened to `__Host-ibw_session`.** The `__Host-` prefix
  makes the browser enforce Secure + Path=/ + no Domain attribute, so a
  script on a sibling subdomain can never plant or shadow the session cookie
  (session fixation) — free hardening while the feature is still dark.
- **api-worker toolchain refreshed and under Dependabot.** vitest 2.1.9 →
  4.1.8, wrangler 3.90 → 4.99, TypeScript aligned to ~6.0.2: `npm audit` goes
  from 9 vulnerabilities (1 critical, 1 high) to **0**. `.github/dependabot.yml`
  now watches `/api-worker`, which was previously invisible to it. wrangler 4
  config compatibility verified via `wrangler deploy --dry-run`.
- **The same-site cookie constraint is documented** (api-worker README +
  ROADMAP Phase C): metering requires the game and API on one registrable
  domain, and the `github.io` + `workers.dev` combination fails silently. The
  README no longer claims rate limits the Worker doesn't implement (the
  provisioning steps gain a Cloudflare rate-limiting rule), the KV namespace
  is labeled as reserved for the iOS phase (idempotency lives in D1 —
  `MONETIZATION_PLAN.md` corrected to match), and SECURITY.md's recommended
  header set warns about the metering CSP additions.

## [0.4.0] — 2026-06-10

### Added
- **Native iOS app** (added retroactively to this entry 2026-06-10 — it
  shipped in this release's PR but was omitted from the changelog):
  `ios/` holds a SwiftUI `Canvas` + `TimelineView` port with a pure-Swift
  physics package (`WobblePhysics`) proven against golden trajectories
  exported from the TypeScript engine.
- **Playable portrait mode.** Portrait phones get a real stacked layout
  (P1 top / P2 bottom, `PORTRAIT_LAYOUT`, the exact transpose of the
  landscape design space — same half-diagonal, so the play-tuned outcome
  envelope and physics constants are untouched) instead of the old
  "rotate your phone" lockout. The Renderer re-picks the design space on
  every resize/rotation; in-flight setups remap to the same normalized spot.
- **Finger-sized hit targets.** Every canvas button's hit rect inflates to a
  44 CSS-px minimum (Apple HIG) at small contain-fit scales.
- **Installable web app.** Manifest + apple-touch-icon/192/512 PNGs
  (generated by a zero-dependency encoder in `scripts/make-touch-icons.mjs`),
  apple-mobile-web-app meta, theme-color, Open Graph/Twitter preview tags.
- **Accessibility.** `prefers-reduced-motion` stills the starfield twinkle
  and ambient drift (live media-query listener); `<noscript>` notice;
  `100dvh` so iOS Safari's collapsing toolbar can't hide the canvas.
- **Stripe web monetization path completed** (`api-worker/`): Checkout
  Session creation (pay-what-you-want Price via new `STRIPE_PRICE_ID` var)
  and verified-webhook persistence — idempotent `processed_events` dedupe,
  entitlement unlock on paid live sessions, re-lock on refund/dispute.
  Unit-tested against an in-memory D1 fake. Still dark until provisioned.
- **Metering CSP injection.** Building with `VITE_API_BASE_URL` set now adds
  the API origin + Turnstile host to the CSP automatically; the default
  build's CSP is byte-identical to before.

- **Security hardening** — strict Content-Security-Policy (`default-src 'none'`) +
  Trusted Types, no inline scripts/styles, supply-chain gates (Dependabot,
  `npm audit`, `persist-credentials: false`), and disclosure (`SECURITY.md`,
  `/.well-known/security.txt`).
- **Cloudflare Worker backend scaffold** (`api-worker/`) — the metering + payments
  trust root: router, CORS, signed web token, gate, D1 counter, Turnstile session,
  and **Stripe webhook signature verification** (payment/attest verification still
  stubbed). Not deployed.
- **Web metering client** (`src/net/*`, `paywall` state) — 100-free-plays gate +
  Stripe pay-what-you-want, **inert + fail-open** until `VITE_API_BASE_URL` is set,
  so the live game is unchanged.
- **Roadmap + plan docs** — `docs/ROADMAP.md` (sequenced work, provisioning,
  new-machine bootstrap) and `docs/MONETIZATION_PLAN.md`.

### Fixed
- **Physics: energy diagnostics now conserve the softened Hamiltonian.**
  The force is Plummer-softened but the reported energy used the pure
  Keplerian potential, so it breathed on every close approach. Conserved
  quantities (energy, bound, escape velocity) now use the softened
  potential; the osculating conic elements stay Keplerian (what the WIN
  threshold was tuned against). New invariant tests pin both regimes.
- **Honest units.** Velocity readouts now say `px/s` (they never were m/s);
  setup help names the EXIT pill alongside ESC; stale "Velocity Verlet"
  comments purged (the integrator is PEFRL).

## [0.3.0] — 2026-06-03

### Fixed
- **Canvas now fills any viewport (responsive resize).** The stage was a
  fixed 1280×800 surface — above 1300px wide it just sat centered with dead
  margins, and nothing re-rendered on window resize. The game still renders
  in a fixed 1280×800 *design space* (so the pixel-tuned physics and win/lose
  thresholds never shift with screen size), but the Renderer now applies a
  uniform contain-fit transform — centered, letterboxed, DPR-sharp — sized to
  the live viewport, and refits on every `resize` (re-reading
  `devicePixelRatio`, so dragging between monitors stays crisp). Pointer hit
  tests invert the same transform via `Renderer.screenToLogical` (CSS pixels
  in, design-space coordinates out; DPR is intentionally not part of the
  inverse because `getBoundingClientRect` already returns CSS pixels). New
  `computeFit` helper with unit coverage (`tests/fit.test.ts`, 6 tests).

### Changed
- **Full-bleed starfield + ambient drift.** With the canvas now filling the
  viewport, the atmosphere followed: the starfield and the ambient stardust
  render in screen space across the entire window — letterbox margins
  included — instead of being confined to the 1280×800 court rect. Star
  positions are stored normalized `[0,1]` and scaled to the live viewport, so
  the field reflows smoothly on resize (deterministic, order-stable
  generation means a bigger window only *appends* stars; existing ones never
  jump), and the count scales with viewport area to hold density constant
  (`STAR_DENSITY = 140/(1280·800)`, clamped to 60–600 stars). The particle
  system split into an ambient layer (full-bleed, screen space) and a burst
  layer (collision debris, kept in design space at world coordinates so it
  rides the fit). Covered by `tests/starfield.test.ts` (6 tests).

### Added
- **Dismissible WIN card.** The victory card is now closable via a ✕ in its
  top-right corner, so the infinite wobble can be watched unobstructed — the
  orbit keeps advancing underneath while the card is hidden. AGAIN doesn't
  disappear with it: once dismissed, it reappears in the top-right control
  cluster, one tap from restarting.
- **On-screen EXIT control (touch-friendly ESC).** A persistent EXIT pill
  sits in the top-right corner during every non-title state and does exactly
  what the ESC key does — return to the title screen. Until now touch players
  (phone / tablet / the iOS app) had no way out of a round without a keyboard;
  this is their escape hatch. Desktop keeps the ESC key in parallel.
- **Escape** key returns to the title screen from any state. Resets specs,
  trails, sim, classifier, outcome, and the supernova animation. A way out
  without forcing the player to wait for a resolve they don't want.
- **Per-session scoreboard** on the title screen, persisted in a session
  cookie (`ibw-stats-v1`, no `Expires`/`Max-Age` → clears with the browser
  session; `SameSite=Lax`; capped at the last 100 games). Shows total plays,
  wobble count, wobble rate, drift / collision breakdown, and best wobble
  in orbits.
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

## [0.2.0]

Off-canvas detection moved from absolute canvas/court bounds to
**barycenter distance** so the camera can follow the system. The outcome
classifier measures each body's distance from the mass-weighted barycenter
(`maxBodyDistanceFromBarycenter 820`) instead of testing against the court
rectangle; `outcomeConfigForLayout` keeps its layout parameter only for API
stability and no longer derives bounds from the layout. Camera-follow keeps
the barycenter centered while the court, HUD, and starfield stay fixed.

## [0.1.0] — initial release

Two-player gravitational binary-star browser game. PEFRL 4th-order
symplectic integration over two bodies under softened Newtonian gravity.
Players set position, mass, and velocity vector inside their half of the
Celestial Court; the simulation classifies the result as WIN (stable
bound orbit), LOSE_ESCAPE, LOSE_SLINGSHOT, or LOSE_COLLISION. Vanilla TS
+ Vite, no UI framework, single `<canvas>`.
