import type { BodySpec, GameStateKind, CourtLayout } from './states.ts';
import { defaultSpec } from './states.ts';
import { Renderer } from '../render/Renderer.ts';
import { PositionControl } from '../ui/PositionControl.ts';
import { MassControl } from '../ui/MassControl.ts';
import { ArrowControl } from '../ui/ArrowControl.ts';
import { inRect } from '../ui/input.ts';
import { Simulation, PHYSICS } from '../physics/Simulation.ts';
import { NBodySimulation, type MergeEvent } from '../physics/nbody.ts';
import { createBody } from '../physics/Body.ts';
import type { Body } from '../physics/Body.ts';
import { vec2 } from '../physics/Vec2.ts';
import { OutcomeClassifier, outcomeConfigForLayout, type Outcome } from './outcomes.ts';
import { EarthState } from './earth.ts';
import { placedStarVelocity, placedPlanetVelocity } from './placement.ts';
import { CAMERA_MIN_ZOOM, CAMERA_EASE, cameraFitRadius, planetEjectRadius } from './camera.ts';
import { recordGame, loadStats, summarize, type StatsSummary } from './stats.ts';
import { Trail } from '../render/trail.ts';
import { palette, lineHeightFor } from '../theme.ts';
import { Meter } from '../net/meter.ts';

const COUNTDOWN_SECONDS = 3;
const TRAIL_CAPACITY = 700;
const EARTH_MASS = 0.02; // a planet — feels the suns, barely tugs them back
const EARTH_ORBIT = 850; // px from the barycenter where a planet is dropped in
// "Set"-placed sandbox bodies (quick-set: tap a spot, pick a star's mass; the
// velocity is supplied automatically — see placement.ts).
const SET_STAR_DEFAULT_MASS = 3;
const SET_STAR_MASS_MIN = 1;
const SET_STAR_MASS_MAX = 5;
const SET_STAR_INBOUND_SPEED = 220; // px/s, aimed straight at the barycenter
// Dynamic camera zoom + the planet-ejection boundary live in ./camera.ts (pure,
// shared, unit-tested). There is no leash any more: real gravity is allowed to
// slingshot a planet out, and a planet flung past planetEjectRadius — the edge
// of the most-zoomed-out view — is lost to the dark (an ejection game-over).
// The sandbox can be LOST: it collapses into a black hole when the stars all
// fall together (≤1 left), or humanity goes extinct if every planet stays dead
// this long (civilizations get a grace window to reboot first).
const EXTINCTION_GRACE = 6; // seconds
const EJECT_GRACE = 2.5; // seconds a planet must stay past the boundary before it's lost
const DT_CAP = 1 / 30; // never let a stutter feed the physics more than this

export class Game {
  private state: GameStateKind = 'title';
  private specs: { p1: BodySpec; p2: BodySpec };
  private renderer: Renderer;

  private posControl = new PositionControl();
  private massControl = new MassControl();
  private arrowControl = new ArrowControl();

  private sim: Simulation | null = null;
  private classifier: OutcomeClassifier | null = null;
  private outcome: Outcome | null = null;
  private trails: { p1: Trail; p2: Trail };

  // Post-win "Add 3rd Body" three-body unravel. When `nbody` is set, the
  // resolved state steps THIS instead of the two-body `sim` (it reuses
  // sim.a/sim.b as its first two bodies, so the binary continues unbroken and
  // p1/p2 trails keep flowing). It runs forever, like the WIN — collisions
  // merge stars (never stop it). Each added body gets its own track in
  // `unravelTracks`, created as it enters — no fixed slots.
  private nbody: NBodySimulation | null = null;
  // Per-body tracks (trail + render kind) for the unravel. The body count
  // changes as stars merge, so trails follow bodies, not fixed slots.
  private unravelTracks: {
    body: Body;
    trail: Trail;
    kind: 'p1' | 'p2' | 'star' | 'merged';
    mergedCount: number; // how many original stars fused into this body (1 = pristine)
  }[] = [];
  // Trisolaris: planets dropped into the (chaotic) system, each with its own
  // climate + civilization. Empty until "Add Planet"; earths[0] is the one the
  // persistent surface panel reads. Reset every fresh round.
  private earths: EarthState[] = [];
  // Eased camera zoom for the unravel (1 = the two-body game's fixed view).
  private cameraZoom = 1;
  // How the sandbox finally fails (null while it's still running): the system
  // collapses to a black hole, or every civilization dies out.
  private sandboxOutcome: 'collapse' | 'extinction' | 'ejection' | null = null;
  // Sandbox "Set" placement: when set, the unravel pauses and the player taps a
  // drop point (pos in WORLD coords) + picks a star's mass; Launch drops it.
  private placing: { kind: 'star' | 'planet'; pos: { x: number; y: number } | null; mass: number } | null =
    null;
  private extinctionTimer = 0;

  private hover: { x: number; y: number } | null = null;
  private lastFrameTime = 0;
  private elapsed = 0;
  private countdownRemaining = COUNTDOWN_SECONDS;
  // Accumulator for fixed-step physics integration. Real-time dt feeds in;
  // sim.step() pulls fixed PHYSICS.DT chunks out. Decouples gameplay speed
  // from frame rate so 60Hz / 120Hz / headless all run at the same speed.
  private simAccum = 0;
  private burstedOnResolve = false;
  private running = false;
  // True once the player taps the ✕ on a WIN card. Hides the card so the
  // infinite wobble can be watched unobstructed; the orbit keeps advancing
  // underneath. Reset whenever a fresh play begins (or we return to title).
  private winCardDismissed = false;
  // Design-space drag offset of the WIN card from its home position. Lets the
  // player slide the card aside to watch the wobble without losing the stats
  // line (✕ still fully dismisses). Reset every fresh play. `cardDragAnchor`
  // is the pointer→offset delta captured at drag start.
  private winCardOffset = { x: 0, y: 0 };
  private draggingCard = false;
  private cardDragAnchor = { x: 0, y: 0 };
  // True while the optional "what is a binary star?" explainer card is open on
  // the title screen. A simple boolean rather than a new GameStateKind: it's a
  // modal aside over the existing title, not a distinct phase of the game.
  // Always reset to false on entering the title (toTitle / toSetup1).
  private explainerOpen = false;
  // Supernova scene: { x, y } of the merger point, plus the elapsed-time
  // marker at the moment of collision so Renderer can animate the flash,
  // shockwave and remnant in real time. null at all other times.
  // `transient` merges (the three-body unravel) play only flash + shockwave —
  // the merged star keeps moving, so no persistent remnant is drawn. The
  // two-body collision (which freezes) keeps the remnant (transient: false).
  private supernova: { x: number; y: number; t0: number; mergedMass: number; transient: boolean } | null = null;
  // Session scoreboard summary, recomputed only when a game is recorded.
  // Reading the cookie every frame would be silly at 60Hz.
  private statsSummary: StatsSummary = summarize(loadStats());

  // Web metering (200 free plays → paywall). Inert unless a backend is
  // configured (VITE_API_BASE_URL); fail-open on any error.
  private meter = new Meter();

  constructor(canvas: HTMLCanvasElement) {
    // The Renderer picks the design space (landscape or portrait) that
    // matches the boot viewport; everything downstream reads renderer.layout.
    this.renderer = new Renderer(canvas);
    this.specs = {
      p1: defaultSpec(1, this.renderer.layout),
      p2: defaultSpec(2, this.renderer.layout),
    };
    this.trails = {
      p1: new Trail(TRAIL_CAPACITY),
      p2: new Trail(TRAIL_CAPACITY),
    };
    this.attachInput(canvas);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Sync metering state in the background (no-op when metering is disabled).
    void this.meter.init();
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ─────────────────────────────────────────────────────────────── input

  private attachInput(canvas: HTMLCanvasElement): void {
    // PointerEvent unifies mouse + touch + pen, so a finger on a phone routes
    // through the same code path as a mouse on a laptop. We preventDefault on
    // pointerdown to claim the gesture as game input (with touch-action: none
    // in CSS, the browser already gives us this, but defense in depth).
    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    window.addEventListener('pointerup', e => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
    canvas.addEventListener('pointercancel', e => this.onPointerUp(e));
    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    // Escape returns to the title screen from any other state. A way out
    // without forcing the player to wait for a resolve they don't want.
    window.addEventListener('keydown', e => this.onKeyDown(e));
    // Refit the canvas whenever the window changes — resized, rotated, or
    // dragged to a monitor with a different pixel density. The rAF loop runs
    // continuously, so the next frame repaints at the new size. A rotation
    // can also swap the design space (landscape ↔ portrait), in which case
    // any in-flight setup specs are remapped into the new courts.
    window.addEventListener('resize', () => this.handleResize());
  }

  private handleResize(): void {
    const before = this.renderer.layout;
    this.renderer.resize(window.innerWidth, window.innerHeight);
    const after = this.renderer.layout;
    if (after === before) return;
    // Orientation flipped. A drag in the old coordinate space is meaningless
    // in the new one — drop it before remapping. The WIN-card offset was
    // clamped to the old canvas; recenter it (and end any card drag) so it
    // can't render off-canvas in the transposed space until the next move.
    this.posControl.release();
    this.arrowControl.release();
    this.draggingCard = false;
    this.winCardOffset = { x: 0, y: 0 };
    this.remapSpec(this.specs.p1, before, after);
    this.remapSpec(this.specs.p2, before, after);
    // Mid-simulation the bodies live in absolute design-space coordinates and
    // the camera re-centres the barycenter every frame, so the sim itself
    // needs no remap; the outcome thresholds are layout-independent (the two
    // design spaces are transposes with the same half-diagonal).
  }

  // Carry a star's setup across an orientation swap: same normalized spot in
  // the player's in-bounds box, velocity vector unchanged (right stays right —
  // rotating the device doesn't rotate the player's intent).
  private remapSpec(spec: BodySpec, from: CourtLayout, to: CourtLayout): void {
    const a = spec.player === 1 ? from.p1InBounds : from.p2InBounds;
    const b = spec.player === 1 ? to.p1InBounds : to.p2InBounds;
    const nx = (spec.pos.x - a.x) / a.width;
    const ny = (spec.pos.y - a.y) / a.height;
    spec.pos.x = b.x + nx * b.width;
    spec.pos.y = b.y + ny * b.height;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    // On the title, Esc closes the explainer card if it's open (mirrors the ✕);
    // there's nothing else to escape to. Elsewhere it returns to the title.
    if (this.state === 'title') {
      if (this.explainerOpen) this.explainerOpen = false;
      return;
    }
    this.toTitle();
  }

  private onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    const p = this.renderer.screenToLogical(e);
    this.hover = p;

    // Button clicks first
    const btn = this.renderer.hoveredButton(p);
    // Title-screen explainer: open on the quiet link, dismiss on its ✕. While
    // open it's modal (BEGIN isn't registered underneath), so these are the
    // only title buttons the renderer exposes.
    if (btn === 'explainer' && this.state === 'title' && !this.explainerOpen) {
      this.explainerOpen = true;
      return;
    }
    if (btn === 'dismiss_explainer' && this.state === 'title' && this.explainerOpen) {
      this.explainerOpen = false;
      return;
    }
    if (btn === 'begin' && this.state === 'title') {
      this.toSetup1();
      return;
    }
    // On-screen equivalent of the ESC key — the only way out for touch
    // players, who have no keyboard to escape with.
    if (btn === 'to_title' && this.state !== 'title') {
      this.toTitle();
      return;
    }
    // ✕ on the WIN card: dismiss it and let the wobble fill the screen.
    if (btn === 'dismiss_win' && this.state === 'resolved' && this.outcome?.kind === 'win') {
      this.winCardDismissed = true;
      return;
    }
    // "Add 3rd Body": the peril affordance on a WIN. Drop a real third star
    // into the stable binary and let the three-body problem take it apart.
    // Open-ended sandbox: keep feeding the problem until it collapses. Both are
    // repeatable, available on a WIN or any time the system is running.
    const sandboxOpen =
      this.state === 'resolved' &&
      (this.outcome?.kind === 'win' || this.nbody !== null) &&
      !this.sandboxOutcome;
    if (sandboxOpen && !this.placing) {
      if (btn === 'random_star') {
        this.addStar();
        return;
      }
      if (btn === 'random_planet') {
        this.addPlanet();
        return;
      }
      if (btn === 'set_star') {
        this.beginPlacing('star');
        return;
      }
      if (btn === 'set_planet') {
        this.beginPlacing('planet');
        return;
      }
    }
    // Placement-mode controls (active while a body is being Set-placed).
    if (this.placing) {
      if (btn === 'place_launch' && this.placing.pos) {
        this.launchPlaced();
        return;
      }
      if (btn === 'place_cancel') {
        this.placing = null;
        return;
      }
      if ((btn === 'place_mass_minus' || btn === 'place_mass_plus') && this.placing.kind === 'star') {
        const step = btn === 'place_mass_plus' ? 0.5 : -0.5;
        this.placing.mass = Math.min(
          SET_STAR_MASS_MAX,
          Math.max(SET_STAR_MASS_MIN, this.placing.mass + step),
        );
        return;
      }
    }
    // Anywhere else on the WIN card body → start dragging it. (dismiss_win and
    // again are registered first, so hoveredButton resolves them before
    // win_card — the buttons always win a direct tap.)
    if (btn === 'win_card' && this.state === 'resolved' && this.outcome?.kind === 'win') {
      this.draggingCard = true;
      this.cardDragAnchor = { x: p.x - this.winCardOffset.x, y: p.y - this.winCardOffset.y };
      return;
    }
    if (btn === 'lock_in' && (this.state === 'setup_p1' || this.state === 'setup_p2')) {
      const spec = this.activeSpec();
      if (spec && Math.hypot(spec.vel.x, spec.vel.y) >= 1) {
        if (this.state === 'setup_p1') this.toSetup2();
        else this.toCountdown();
      }
      return;
    }
    if (btn === 'again' && this.state === 'resolved') {
      this.toSetup1();
      return;
    }
    // Paywall: tap Support to pay-what-you-want via Stripe (redirects away).
    if (btn === 'support' && this.state === 'paywall') {
      void this.meter.startCheckout();
      return;
    }
    // Touch-friendly mass control: tap the [−] or [+] pill to step.
    // Wheel still works on desktop in parallel.
    if (
      (btn === 'mass_minus' || btn === 'mass_plus') &&
      (this.state === 'setup_p1' || this.state === 'setup_p2')
    ) {
      const spec = this.activeSpec();
      if (spec) {
        // applyWheel takes a deltaY in browser-wheel convention; the existing
        // implementation reuses one notch per call, so + / − map directly.
        this.massControl.applyWheel(spec, btn === 'mass_minus' ? +100 : -100);
      }
      return;
    }

    // Setup-phase dragging.
    //
    // Mental model the player actually has:
    //   • "Drag outward FROM the star to throw it." → mousedown on the body,
    //     drag away to set velocity.
    //   • "Tap somewhere else in my court to reposition the star." → mousedown
    //     anywhere else in the player's region, optionally drag to fine-tune.
    //
    // The original wiring (body=position, outside=velocity) felt wrong
    // because everyone who's ever played a slingshot game expects to pull
    // velocity *out of* the star. Caught by /qa on 2026-06-01.

    // Sandbox "Set" placement: a tap on the field (no button hit) sets/moves the
    // drop point, in world coords (the unravel is paused while placing).
    if (this.placing && this.state === 'resolved') {
      this.placing.pos = this.designToWorld(p);
      return;
    }

    if (this.state === 'setup_p1' || this.state === 'setup_p2') {
      const spec = this.activeSpec();
      if (!spec) return;
      // On the star body → start a velocity drag (length = px/s, capped).
      if (this.posControl.isOverBody(spec, p)) {
        this.arrowControl.beginGrab();
        this.arrowControl.drag(spec, p);
        return;
      }
      // Elsewhere in the active player's region → reposition (and keep
      // dragging if the player slides further).
      const region = spec.player === 1 ? this.renderer.layout.p1Region : this.renderer.layout.p2Region;
      if (inRect(p, region)) {
        this.posControl.beginGrab();
        this.posControl.drag(spec, p, this.renderer.layout);
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.posControl.isGrabbing || this.arrowControl.isGrabbing || this.draggingCard) {
      e.preventDefault();
    }
    const p = this.renderer.screenToLogical(e);
    this.hover = p;

    if (this.draggingCard) {
      this.winCardOffset = this.clampCardOffset({
        x: p.x - this.cardDragAnchor.x,
        y: p.y - this.cardDragAnchor.y,
      });
      return;
    }

    if (this.state === 'setup_p1' || this.state === 'setup_p2') {
      const spec = this.activeSpec();
      if (!spec) return;
      if (this.posControl.isGrabbing) {
        this.posControl.drag(spec, p, this.renderer.layout);
      } else if (this.arrowControl.isGrabbing) {
        this.arrowControl.drag(spec, p);
      }
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    this.posControl.release();
    this.arrowControl.release();
    this.draggingCard = false;
  }

  // Keep the dragged WIN card fully on-canvas (8 px margin) so it can't be
  // flung somewhere unrecoverable. Card geometry mirrors drawOutcomeCard's WIN
  // branch (600 wide, bottom-anchored 72 px above the HUD); the offset is
  // clamped against the design-space canvas, so it's orientation-correct.
  private clampCardOffset(raw: { x: number; y: number }): { x: number; y: number } {
    const { width: w, height: h } = this.renderer.layout.canvas;
    const cardW = 600;
    // Mirrors drawOutcomeCard's WIN geometry EXACTLY (600 wide, stats line
    // always present on a win, + the legibility-floor footer growth). If the
    // formula there changes, change it here — the clamp depends on the height.
    const cardH = 232 + 28 + Math.max(0, lineHeightFor(12) * 3 - 48);
    const homeX = (w - cardW) / 2;
    const homeY = h - cardH - 72;
    const margin = 8;
    const minX = margin - homeX;
    const maxX = w - cardW - margin - homeX;
    const minY = margin - homeY;
    const maxY = h - cardH - margin - homeY;
    return {
      x: Math.min(Math.max(raw.x, minX), maxX),
      y: Math.min(Math.max(raw.y, minY), maxY),
    };
  }

  private onWheel(e: WheelEvent): void {
    if (this.state !== 'setup_p1' && this.state !== 'setup_p2') return;
    const spec = this.activeSpec();
    if (!spec) return;
    // Only adjust mass if the wheel is over the active player's region.
    const p = this.renderer.screenToLogical(e);
    const region = spec.player === 1 ? this.renderer.layout.p1Region : this.renderer.layout.p2Region;
    if (!inRect(p, region)) return;
    e.preventDefault();
    this.massControl.applyWheel(spec, e.deltaY);
  }

  // ─────────────────────────────────────────────────────── state transitions

  private toTitle(): void {
    this.specs = {
      p1: defaultSpec(1, this.renderer.layout),
      p2: defaultSpec(2, this.renderer.layout),
    };
    this.trails.p1.reset();
    this.trails.p2.reset();
    this.nbody = null;
    this.unravelTracks = [];
    this.earths = [];
    this.cameraZoom = 1;
    this.sandboxOutcome = null;
    this.placing = null;
    this.extinctionTimer = 0;
    this.sim = null;
    this.classifier = null;
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.winCardDismissed = false;
    this.winCardOffset = { x: 0, y: 0 };
    this.draggingCard = false;
    this.explainerOpen = false;
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'title';
  }

  private toSetup1(): void {
    // Metering gate: out of free plays and unpaid → paywall instead of setup.
    // shouldGate() is false whenever metering is disabled/uncertain (fail-open).
    if (this.meter.shouldGate()) {
      this.toPaywall();
      return;
    }
    // Fresh specs each time. Avoid carrying over previous-round state.
    this.specs = {
      p1: defaultSpec(1, this.renderer.layout),
      p2: defaultSpec(2, this.renderer.layout),
    };
    this.trails.p1.reset();
    this.trails.p2.reset();
    this.nbody = null;
    this.unravelTracks = [];
    this.earths = [];
    this.cameraZoom = 1;
    this.sandboxOutcome = null;
    this.placing = null;
    this.extinctionTimer = 0;
    this.sim = null;
    this.classifier = null;
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
    this.winCardDismissed = false;
    this.winCardOffset = { x: 0, y: 0 };
    this.draggingCard = false;
    this.explainerOpen = false;
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'setup_p1';
  }

  private toPaywall(): void {
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'paywall';
    // Re-check the server in the background; if the count was stale or a
    // purchase has just landed, drop straight into setup.
    void this.meter.refresh().then(() => {
      if (this.state === 'paywall' && !this.meter.shouldGate()) this.toSetup1();
    });
  }

  private toSetup2(): void {
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'setup_p2';
  }

  private toCountdown(): void {
    this.posControl.release();
    this.arrowControl.release();
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.state = 'countdown';
  }

  private toSimulate(): void {
    // Build the Simulation from the two locked specs
    const p1 = this.specs.p1;
    const p2 = this.specs.p2;
    this.sim = Simulation.create(
      p1.mass, vec2(p1.pos.x, p1.pos.y), vec2(p1.vel.x, p1.vel.y),
      p2.mass, vec2(p2.pos.x, p2.pos.y), vec2(p2.vel.x, p2.vel.y),
    );
    this.classifier = new OutcomeClassifier(
      outcomeConfigForLayout(this.renderer.layout),
    );
    this.trails.p1.reset();
    this.trails.p2.reset();
    this.nbody = null;
    this.unravelTracks = [];
    this.earths = [];
    this.cameraZoom = 1;
    this.sandboxOutcome = null;
    this.placing = null;
    this.extinctionTimer = 0;
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
    this.winCardDismissed = false;
    this.winCardOffset = { x: 0, y: 0 };
    this.draggingCard = false;
    // Count this play (a simulation actually started). Optimistic + async;
    // no-op when metering is disabled or the player is already unlocked.
    this.meter.consumePlay();
    this.state = 'simulate';
  }

  private toResolved(o: Outcome): void {
    this.outcome = o;
    this.state = 'resolved';
    // Append this game to the session scoreboard exactly once per resolve.
    // burstedOnResolve doubles as the recorded-once flag — both fire from
    // inside this guard.
    if (!this.burstedOnResolve && this.sim && this.classifier && o.kind !== 'playing') {
      const orbit = this.sim.orbit();
      const updated = recordGame({
        outcome: o.kind,
        duration: this.sim.time,
        eccentricity: orbit.eccentricity,
        orbits: this.classifier.orbits,
        period: orbit.period,
        ts: Date.now(),
      });
      this.statsSummary = summarize(updated);
    }
    if (!this.burstedOnResolve && this.sim) {
      this.burstedOnResolve = true;
      if (o.kind === 'lose_collision') {
        // Two stars merging at high contrast deserve a real stellar event:
        // record the merger position + the elapsed-time anchor so the
        // Renderer can animate the flash, shockwave and remnant. Also
        // throw a heavy particle burst — capped by Particles' MAX so the
        // request value is generous, the actual count clamps below.
        const mid = {
          x: (this.sim.a.pos.x + this.sim.b.pos.x) / 2,
          y: (this.sim.a.pos.y + this.sim.b.pos.y) / 2,
        };
        this.supernova = {
          x: mid.x,
          y: mid.y,
          t0: this.elapsed,
          mergedMass: this.sim.a.mass + this.sim.b.mass,
          transient: false,
        };
        this.renderer.burst(mid.x, mid.y, 240, palette.cream, 360);
      } else if (o.kind === 'win') {
        this.renderer.burst(this.sim.a.pos.x, this.sim.a.pos.y, 24, palette.player1);
        this.renderer.burst(this.sim.b.pos.x, this.sim.b.pos.y, 24, palette.player2);
      }
    }
  }

  // Build the N-body system from the just-won binary, reusing the winning
  // bodies + their p1/p2 trails so history flows unbroken. Shared by "Add 3rd
  // Body" and "Add Planet Earth". No-op once the system already exists.
  private ensureNBodyFromWin(): void {
    if (this.nbody || !this.sim) return;
    this.nbody = new NBodySimulation([this.sim.a, this.sim.b], PHYSICS.G, PHYSICS.SOFTENING);
    this.unravelTracks = [
      { body: this.sim.a, trail: this.trails.p1, kind: 'p1', mergedCount: 1 },
      { body: this.sim.b, trail: this.trails.p2, kind: 'p2', mergedCount: 1 },
    ];
    // The WIN card is gone now; drop any in-progress card drag.
    this.winCardOffset = { x: 0, y: 0 };
    this.draggingCard = false;
  }

  // Mass-weighted barycenter of the whole running system (suns + the tiny
  // planets, whose mass is negligible). Spawn reference for new bodies.
  private systemCOM(): { x: number; y: number; mass: number } {
    let M = 0;
    let cx = 0;
    let cy = 0;
    for (const s of this.nbody?.bodies ?? []) {
      M += s.mass;
      cx += s.mass * s.pos.x;
      cy += s.mass * s.pos.y;
    }
    return M > 0 ? { x: cx / M, y: cy / M, mass: M } : { x: 0, y: 0, mass: 0 };
  }

  // Add a star — repeatable. Enters from a random edge of the field, generally
  // massive (≥ a default star), aimed inward with ±30° jitter (close enough to
  // disrupt, never rigged). Keep feeding the problem until it collapses.
  private addStar(): void {
    if (!this.sim) return;
    this.ensureNBodyFromWin();
    if (!this.nbody) return;
    const com = this.systemCOM();
    const { width: w, height: h } = this.renderer.layout.canvas;
    const mass = 2 + Math.random() * 3;
    const theta = Math.random() * Math.PI * 2;
    const reach = Math.max(w, h) * 0.6;
    const speed = 150 + Math.random() * 140;
    const aim = theta + Math.PI + (Math.random() - 0.5) * (Math.PI / 3);
    const star = createBody(
      mass,
      vec2(com.x + Math.cos(theta) * reach, com.y + Math.sin(theta) * reach),
      vec2(Math.cos(aim) * speed, Math.sin(aim) * speed),
    );
    star.vz = (Math.random() - 0.5) * speed; // arrive out of the plane → real 3D
    this.nbody.addBody(star);
    this.unravelTracks.push({
      body: star,
      trail: new Trail(TRAIL_CAPACITY),
      kind: 'star',
      mergedCount: 1,
    });
  }

  // Trisolaris: drop a planet onto a wide, roughly-circular orbit around the
  // barycenter — temperate at first; the suns' chaos does the rest. Repeatable.
  private addPlanet(): void {
    if (!this.sim) return;
    this.ensureNBodyFromWin();
    if (!this.nbody) return;
    const com = this.systemCOM();
    if (com.mass <= 0) return;
    const ang = Math.random() * Math.PI * 2;
    const vCirc = Math.sqrt((PHYSICS.G * com.mass) / EARTH_ORBIT);
    const planet = createBody(
      EARTH_MASS,
      vec2(com.x + Math.cos(ang) * EARTH_ORBIT, com.y + Math.sin(ang) * EARTH_ORBIT),
      vec2(-Math.sin(ang) * vCirc, Math.cos(ang) * vCirc),
    );
    planet.vz = (Math.random() - 0.5) * vCirc * 0.6; // a slightly inclined orbit
    this.nbody.addBody(planet, true); // noMerge — a planet doesn't fuse
    this.earths.push(new EarthState(planet));
  }

  // ── "Set" placement (quick-set: tap a drop point, +/- a star's mass) ──

  private beginPlacing(kind: 'star' | 'planet'): void {
    if (!this.sim) return;
    this.ensureNBodyFromWin();
    if (!this.nbody) return;
    this.placing = { kind, pos: null, mass: kind === 'star' ? SET_STAR_DEFAULT_MASS : EARTH_MASS };
  }

  private launchPlaced(): void {
    const pl = this.placing;
    this.placing = null;
    if (!pl || !pl.pos || !this.nbody) return;
    if (pl.kind === 'star') this.addStarAt(pl.pos, pl.mass);
    else this.addPlanetAt(pl.pos);
  }

  private addStarAt(pos: { x: number; y: number }, mass: number): void {
    if (!this.nbody) return;
    const v = placedStarVelocity(pos, this.systemCOM(), SET_STAR_INBOUND_SPEED);
    const star = createBody(mass, vec2(pos.x, pos.y), vec2(v.x, v.y));
    this.nbody.addBody(star);
    this.unravelTracks.push({
      body: star,
      trail: new Trail(TRAIL_CAPACITY),
      kind: 'star',
      mergedCount: 1,
    });
  }

  private addPlanetAt(pos: { x: number; y: number }): void {
    if (!this.nbody) return;
    const com = this.systemCOM();
    if (com.mass <= 0) return;
    const v = placedPlanetVelocity(pos, com, com.mass, PHYSICS.G);
    const planet = createBody(EARTH_MASS, vec2(pos.x, pos.y), vec2(v.x, v.y));
    this.nbody.addBody(planet, true); // noMerge — a planet doesn't fuse
    this.earths.push(new EarthState(planet));
  }

  // Invert the renderer's camera transform (design-canvas point → world point):
  // a forward draw is centre + cz·(P + offset − centre), so the inverse is
  // P = centre + (D − centre)/cz − offset. The unravel is paused while placing,
  // so the camera is static and this is exact.
  private designToWorld(d: { x: number; y: number }): { x: number; y: number } {
    const { width: w, height: h } = this.renderer.layout.canvas;
    const cz = this.cameraZoom;
    const off = this.computeCameraOffset();
    if (!off || cz <= 0) return d;
    return { x: w / 2 + (d.x - w / 2) / cz - off.x, y: h / 2 + (d.y - h / 2) / cz - off.y };
  }

  // Fixed-step accumulator for the three-body unravel (mirror of
  // advancePhysics). Runs forever, like the WIN's infinite wobble — it never
  // stops on a collision; collisions just merge and the survivors carry on.
  private advanceNBody(dt: number): void {
    if (!this.nbody) return;
    this.simAccum += dt;
    if (this.simAccum > 0.25) this.simAccum = 0.25;
    while (this.simAccum >= PHYSICS.DT) {
      const merge = this.nbody.step(PHYSICS.DT);
      if (merge) this.onMerge(merge);
      this.simAccum -= PHYSICS.DT;
    }
    for (const t of this.unravelTracks) t.trail.push(t.body.pos.x, t.body.pos.y);
    if (this.earths.length > 0) {
      const planets = new Set(this.earths.map(e => e.body));
      const suns = this.nbody.bodies.filter(b => !planets.has(b));
      for (const earth of this.earths) {
        earth.update(dt, suns);
        earth.trail.push(earth.body.pos.x, earth.body.pos.y);
      }
    }
    this.checkSandboxOutcome(dt);
  }

  // The sandbox fails in three ways. EJECTION: a planet is slingshot past the
  // edge of the most-zoomed-out view (planetEjectRadius) → lost to the dark.
  // COLLAPSE: the stars all fall together (≤ 1 left — merged, or detonated to
  // nothing) → a black hole, universe over. EXTINCTION: planets exist but every
  // one has been dead longer than the grace window (civilizations get a chance to
  // reboot first).
  private checkSandboxOutcome(dt: number): void {
    if (!this.nbody || this.sandboxOutcome) return;
    const planets = new Set(this.earths.map(e => e.body));
    // EJECTION: any planet flung past the camera's furthest pull-back. Measured
    // from the same barycenter the camera zoom fits around, so at the instant of
    // loss the planet sits right at the readable edge of the frame.
    if (this.earths.length > 0) {
      const com = this.systemCOM();
      const { width: w, height: h } = this.renderer.layout.canvas;
      const ejectR = planetEjectRadius(Math.min(w, h));
      for (const e of this.earths) {
        const dist = Math.hypot(e.body.pos.x - com.x, e.body.pos.y - com.y);
        // The renderer reads driftFraction to warn ON the planet as it nears the
        // edge (≈¾ of the way out) — so the loss is telegraphed, not abrupt.
        e.driftFraction = Math.min(1, dist / ejectR);
        if (dist > ejectR) {
          // Past the edge, but grant a grace beat: a chaotic orbit can still
          // swing it home, and the loss shouldn't snap the instant it crosses.
          e.secondsAdrift += dt;
          if (e.secondsAdrift > EJECT_GRACE) {
            this.sandboxOutcome = 'ejection';
            return;
          }
        } else {
          e.secondsAdrift = 0; // pulled home — reprieve
        }
      }
    }
    const starCount = this.nbody.bodies.filter(b => !planets.has(b)).length;
    if (starCount <= 1) {
      this.sandboxOutcome = 'collapse';
      return;
    }
    if (this.earths.length > 0 && this.earths.every(e => e.population <= 0.05)) {
      this.extinctionTimer += dt;
      if (this.extinctionTimer > EXTINCTION_GRACE) this.sandboxOutcome = 'extinction';
    } else {
      this.extinctionTimer = 0;
    }
  }


  // A collision fused two stars. Retire the consumed tracks, give the merged
  // star a fresh track, and fire a transient flash at the merger point. The
  // merged body then carries on — we want to watch whether the survivor is
  // slingshot away or falls into a new orbit around the heavier mass.
  private onMerge(event: MergeEvent): void {
    if (!this.nbody) return;
    const present = new Set(this.nbody.bodies);
    // Lineage: the merged star inherits the combined progenitor count of the
    // two stars it consumed (so the tooltip can read "forged from N stars").
    const mergedCount = this.unravelTracks
      .filter(t => !present.has(t.body))
      .reduce((sum, t) => sum + t.mergedCount, 0);
    this.unravelTracks = this.unravelTracks.filter(t => present.has(t.body));
    // Normal fuse → track the merged star. Supernova → nothing survives the
    // detonation (event.body is null), so no new track; nbody already rammed
    // the blast through the survivors.
    if (event.body && !this.unravelTracks.some(t => t.body === event.body)) {
      this.unravelTracks.push({
        body: event.body,
        trail: new Trail(TRAIL_CAPACITY),
        kind: 'merged',
        mergedCount,
      });
    }
    this.supernova = {
      x: event.x,
      y: event.y,
      t0: this.elapsed,
      mergedMass: event.mass,
      transient: true,
    };
    this.renderer.burst(
      event.x,
      event.y,
      event.supernova ? 320 : 180,
      palette.cream,
      event.supernova ? 440 : 340,
    );
  }

  private activeSpec(): BodySpec | null {
    if (this.state === 'setup_p1') return this.specs.p1;
    if (this.state === 'setup_p2') return this.specs.p2;
    return null;
  }

  // ─────────────────────────────────────────────────────────────── frame loop

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastFrameTime) / 1000, DT_CAP);
    this.lastFrameTime = now;
    this.elapsed += dt;

    this.update(dt);
    this.render(dt);
    this.updateCursor();

    requestAnimationFrame(this.tick);
  };

  // Contextual cursor: 'pointer' over buttons, 'grab/grabbing' over the
  // active star during setup, 'crosshair' over the rest of the active
  // court (where a click would reposition), 'default' everywhere else.
  // Setting canvas.style.cursor is a no-op when the value matches, so it's
  // safe to call every frame.
  private updateCursor(): void {
    const canvas = this.renderer.canvas;
    let desired: string = 'default';
    if (this.draggingCard) {
      desired = 'grabbing';
    } else if (this.hover) {
      const btn = this.renderer.hoveredButton(this.hover);
      if (btn === 'win_card') {
        // The card body is a drag handle, not a click target.
        desired = 'grab';
      } else if (btn) {
        desired = 'pointer';
      } else if (this.state === 'setup_p1' || this.state === 'setup_p2') {
        const spec = this.activeSpec();
        if (spec) {
          if (this.arrowControl.isGrabbing || this.posControl.isGrabbing) {
            desired = 'grabbing';
          } else if (this.posControl.isOverBody(spec, this.hover)) {
            desired = 'grab';
          } else {
            const region =
              spec.player === 1 ? this.renderer.layout.p1Region : this.renderer.layout.p2Region;
            desired = inRect(this.hover, region) ? 'crosshair' : 'default';
          }
        }
      }
    }
    if (canvas.style.cursor !== desired) {
      canvas.style.cursor = desired;
    }
  }

  // Fixed-step integration: feed real-time dt into the accumulator, pull
  // PHYSICS.DT chunks out. Gameplay speed becomes independent of display
  // refresh rate — same wall-time orbit on 60Hz, 120Hz, or headless.
  private advancePhysics(dt: number): void {
    if (!this.sim) return;
    this.simAccum += dt;
    // Hard cap so a long tab-pause doesn't queue thousands of steps.
    if (this.simAccum > 0.25) this.simAccum = 0.25;
    while (this.simAccum >= PHYSICS.DT) {
      this.sim.step();
      this.simAccum -= PHYSICS.DT;
    }
  }

  private update(dt: number): void {
    switch (this.state) {
      case 'countdown': {
        this.countdownRemaining -= dt;
        if (this.countdownRemaining <= 0) this.toSimulate();
        break;
      }
      case 'simulate': {
        if (!this.sim || !this.classifier) break;
        this.advancePhysics(dt);
        this.trails.p1.push(this.sim.a.pos.x, this.sim.a.pos.y);
        this.trails.p2.push(this.sim.b.pos.x, this.sim.b.pos.y);
        const o = this.classifier.update(this.sim, dt);
        if (o.kind !== 'playing') this.toResolved(o);
        break;
      }
      case 'resolved': {
        // Three-body unravel takes over and runs forever — advanceNBody handles
        // its trails + merges. It never stops on a collision; merged stars just
        // carry on, watchable as long as the WIN it grew out of.
        if (this.nbody) {
          if (!this.sandboxOutcome && !this.placing) this.advanceNBody(dt);
          break;
        }
        // For WINs, the wobble keeps going — it really is infinite. Keep the
        // classifier ticking too so the ORBITS counter on the HUD stays alive.
        if (this.sim && this.outcome?.kind === 'win') {
          this.advancePhysics(dt);
          this.trails.p1.push(this.sim.a.pos.x, this.sim.a.pos.y);
          this.trails.p2.push(this.sim.b.pos.x, this.sim.b.pos.y);
          if (this.classifier) this.classifier.update(this.sim, dt);
        }
        break;
      }
      default:
        break;
    }
  }

  private render(dt: number): void {
    // Reflect the state machine onto the DOM so CSS can scope the homepage
    // dedication overlay (in style.css) to the title screen — it fades out the
    // moment play begins. Idempotent string write; the browser no-ops if equal.
    document.body.dataset.screen = this.state;
    this.renderer.render({
      state: this.state,
      time: this.elapsed,
      dt,
      hover: this.hover,
      specs: this.specs,
      sim: this.sim,
      classifier: this.classifier,
      outcome: this.outcome,
      countdownRemaining: this.countdownRemaining,
      trails: this.trails,
      unravel: this.nbody ? this.unravelTracks : null,
      earths: this.earths.map(e => ({
        body: e.body,
        trail: e.trail,
        population: e.population,
        civilizations: e.civilizations,
        era: e.era,
        chaos: e.chaos,
        stable: e.stable,
        driftWarn: e.driftFraction,
      })),
      posGrabbing: this.posControl.isGrabbing,
      arrowGrabbing: this.arrowControl.isGrabbing,
      winCardDismissed: this.winCardDismissed,
      winCardOffset: this.winCardOffset,
      explainerOpen: this.explainerOpen,
      stats: this.statsSummary,
      meter: this.meter.view,
      supernova: this.supernova
        ? {
            x: this.supernova.x,
            y: this.supernova.y,
            elapsed: this.elapsed - this.supernova.t0,
            mergedMass: this.supernova.mergedMass,
            transient: this.supernova.transient,
          }
        : null,
      cameraOffset: this.computeCameraOffset(),
      cameraZoom: this.computeCameraZoom(dt),
      sandboxOutcome: this.sandboxOutcome,
      placing: this.placing,
    });
  }

  // Ease the camera zoom toward whatever fits the whole system in frame. Only
  // the unravel pulls back (its bodies fling wide); the two-body game holds at
  // zoom 1. Smoothed so a slingshot doesn't snap the view.
  private computeCameraZoom(dt: number): number {
    let target = 1;
    if (this.nbody && this.state === 'resolved' && this.nbody.bodies.length > 0) {
      const com = this.systemCOM();
      let maxExtent = 0;
      for (const b of this.nbody.bodies) {
        const d = Math.hypot(b.pos.x - com.x, b.pos.y - com.y);
        if (d > maxExtent) maxExtent = d;
      }
      const { width: w, height: h } = this.renderer.layout.canvas;
      const fitRadius = cameraFitRadius(Math.min(w, h));
      const fit = maxExtent > 1 ? fitRadius / maxExtent : 1;
      target = Math.max(CAMERA_MIN_ZOOM, Math.min(1, fit));
    }
    this.cameraZoom += (target - this.cameraZoom) * Math.min(1, dt * CAMERA_EASE);
    return this.cameraZoom;
  }

  // Centre the camera on the barycenter so the orbit stays watchable even
  // when net linear momentum drifts the whole system. Returns null in
  // non-sim states where no offset should apply (title, setup, countdown).
  private computeCameraOffset(): { x: number; y: number } | null {
    // During the three-body unravel, follow the barycenter of all three so the
    // chaos stays watchable as it scatters.
    if (this.nbody && this.state === 'resolved') {
      const c = this.nbody.centerOfMass();
      return {
        x: this.renderer.layout.canvas.width / 2 - c.x,
        y: this.renderer.layout.canvas.height / 2 - c.y,
      };
    }
    if (!this.sim) return null;
    if (this.state !== 'simulate' && this.state !== 'resolved') return null;
    const M = this.sim.a.mass + this.sim.b.mass;
    if (!Number.isFinite(M) || M <= 0) return null;
    const bx = (this.sim.a.mass * this.sim.a.pos.x + this.sim.b.mass * this.sim.b.pos.x) / M;
    const by = (this.sim.a.mass * this.sim.a.pos.y + this.sim.b.mass * this.sim.b.pos.y) / M;
    const cx = this.renderer.layout.canvas.width / 2;
    const cy = this.renderer.layout.canvas.height / 2;
    return { x: cx - bx, y: cy - by };
  }
}

