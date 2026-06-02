import type { BodySpec, GameStateKind } from './states.ts';
import { DEFAULT_LAYOUT, defaultSpec } from './states.ts';
import { Renderer } from '../render/Renderer.ts';
import { PositionControl } from '../ui/PositionControl.ts';
import { MassControl } from '../ui/MassControl.ts';
import { ArrowControl } from '../ui/ArrowControl.ts';
import { eventToCanvas, inRect } from '../ui/input.ts';
import { Simulation, PHYSICS } from '../physics/Simulation.ts';
import { vec2 } from '../physics/Vec2.ts';
import { OutcomeClassifier, outcomeConfigForLayout, type Outcome } from './outcomes.ts';
import { recordGame, loadStats, summarize, type StatsSummary } from './stats.ts';
import { Trail } from '../render/trail.ts';
import { palette } from '../theme.ts';

const COUNTDOWN_SECONDS = 3;
const TRAIL_CAPACITY = 700;
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
  // Supernova scene: { x, y } of the merger point, plus the elapsed-time
  // marker at the moment of collision so Renderer can animate the flash,
  // shockwave and remnant in real time. null at all other times.
  private supernova: { x: number; y: number; t0: number; mergedMass: number } | null = null;
  // Session scoreboard summary, recomputed only when a game is recorded.
  // Reading the cookie every frame would be silly at 60Hz.
  private statsSummary: StatsSummary = summarize(loadStats());

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, DEFAULT_LAYOUT);
    this.specs = {
      p1: defaultSpec(1, DEFAULT_LAYOUT),
      p2: defaultSpec(2, DEFAULT_LAYOUT),
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
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.state !== 'title') {
      this.toTitle();
    }
  }

  private onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    const p = eventToCanvas(
      e,
      this.renderer.canvas,
      this.renderer.layout.canvas.width,
      this.renderer.layout.canvas.height,
    );
    this.hover = p;

    // Button clicks first
    const btn = this.renderer.hoveredButton(p);
    if (btn === 'begin' && this.state === 'title') {
      this.toSetup1();
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
    if (this.posControl.isGrabbing || this.arrowControl.isGrabbing) {
      e.preventDefault();
    }
    const p = eventToCanvas(
      e,
      this.renderer.canvas,
      this.renderer.layout.canvas.width,
      this.renderer.layout.canvas.height,
    );
    this.hover = p;

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
  }

  private onWheel(e: WheelEvent): void {
    if (this.state !== 'setup_p1' && this.state !== 'setup_p2') return;
    const spec = this.activeSpec();
    if (!spec) return;
    // Only adjust mass if the wheel is over the active player's region.
    const p = eventToCanvas(
      e,
      this.renderer.canvas,
      this.renderer.layout.canvas.width,
      this.renderer.layout.canvas.height,
    );
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
    this.sim = null;
    this.classifier = null;
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'title';
  }

  private toSetup1(): void {
    // Fresh specs each time. Avoid carrying over previous-round state.
    this.specs = {
      p1: defaultSpec(1, this.renderer.layout),
      p2: defaultSpec(2, this.renderer.layout),
    };
    this.trails.p1.reset();
    this.trails.p2.reset();
    this.sim = null;
    this.classifier = null;
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
    this.posControl.release();
    this.arrowControl.release();
    this.state = 'setup_p1';
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
    this.outcome = null;
    this.burstedOnResolve = false;
    this.simAccum = 0;
    this.supernova = null;
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
        };
        this.renderer.burst(mid.x, mid.y, 240, palette.cream, 360);
      } else if (o.kind === 'win') {
        this.renderer.burst(this.sim.a.pos.x, this.sim.a.pos.y, 24, palette.player1);
        this.renderer.burst(this.sim.b.pos.x, this.sim.b.pos.y, 24, palette.player2);
      }
    }
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
    if (this.hover) {
      const btn = this.renderer.hoveredButton(this.hover);
      if (btn) {
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
      posGrabbing: this.posControl.isGrabbing,
      arrowGrabbing: this.arrowControl.isGrabbing,
      stats: this.statsSummary,
      supernova: this.supernova
        ? {
            x: this.supernova.x,
            y: this.supernova.y,
            elapsed: this.elapsed - this.supernova.t0,
            mergedMass: this.supernova.mergedMass,
          }
        : null,
      cameraOffset: this.computeCameraOffset(),
    });
  }

  // Centre the camera on the barycenter so the orbit stays watchable even
  // when net linear momentum drifts the whole system. Returns null in
  // non-sim states where no offset should apply (title, setup, countdown).
  private computeCameraOffset(): { x: number; y: number } | null {
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

