import type { BodySpec, GameStateKind } from './states.ts';
import { DEFAULT_LAYOUT, defaultSpec } from './states.ts';
import { Renderer } from '../render/Renderer.ts';
import { PositionControl } from '../ui/PositionControl.ts';
import { MassControl } from '../ui/MassControl.ts';
import { ArrowControl } from '../ui/ArrowControl.ts';
import { eventToCanvas, inRect } from '../ui/input.ts';
import { Simulation } from '../physics/Simulation.ts';
import { vec2 } from '../physics/Vec2.ts';
import { OutcomeClassifier, type Outcome } from './outcomes.ts';
import { Trail } from '../render/trail.ts';
import { palette } from '../theme.ts';

const COUNTDOWN_SECONDS = 3;
const TRAIL_CAPACITY = 700;
const POST_RESOLVE_PARTICLE_BURST = 80;
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
  private burstedOnResolve = false;
  private running = false;

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
    canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    canvas.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', e => this.onMouseUp(e));
    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
    });
  }

  private onMouseDown(e: MouseEvent): void {
    const p = eventToCanvas(e, this.renderer.canvas);
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

    // Setup-phase dragging
    if (this.state === 'setup_p1' || this.state === 'setup_p2') {
      const spec = this.activeSpec();
      if (!spec) return;
      // Try grabbing the star body first
      if (this.posControl.beginGrab(spec, p)) return;
      // Otherwise, if the click landed in the active player's region, begin
      // a velocity drag (snaps the arrow to point to the pointer)
      const region = spec.player === 1 ? this.renderer.layout.p1Region : this.renderer.layout.p2Region;
      if (inRect(p, region)) {
        this.arrowControl.beginGrab();
        this.arrowControl.drag(spec, p);
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const p = eventToCanvas(e, this.renderer.canvas);
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

  private onMouseUp(_e: MouseEvent): void {
    this.posControl.release();
    this.arrowControl.release();
  }

  private onWheel(e: WheelEvent): void {
    if (this.state !== 'setup_p1' && this.state !== 'setup_p2') return;
    const spec = this.activeSpec();
    if (!spec) return;
    // Only adjust mass if the wheel is over the active player's region.
    const p = eventToCanvas(e, this.renderer.canvas);
    const region = spec.player === 1 ? this.renderer.layout.p1Region : this.renderer.layout.p2Region;
    if (!inRect(p, region)) return;
    e.preventDefault();
    this.massControl.applyWheel(spec, e.deltaY);
  }

  // ─────────────────────────────────────────────────────── state transitions

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
    this.classifier = new OutcomeClassifier();
    this.trails.p1.reset();
    this.trails.p2.reset();
    this.outcome = null;
    this.burstedOnResolve = false;
    this.state = 'simulate';
  }

  private toResolved(o: Outcome): void {
    this.outcome = o;
    this.state = 'resolved';
    if (!this.burstedOnResolve && this.sim) {
      this.burstedOnResolve = true;
      if (o.kind === 'lose_collision') {
        const mid = {
          x: (this.sim.a.pos.x + this.sim.b.pos.x) / 2,
          y: (this.sim.a.pos.y + this.sim.b.pos.y) / 2,
        };
        this.renderer.burst(mid.x, mid.y, POST_RESOLVE_PARTICLE_BURST, palette.cream);
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

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    switch (this.state) {
      case 'countdown': {
        this.countdownRemaining -= dt;
        if (this.countdownRemaining <= 0) this.toSimulate();
        break;
      }
      case 'simulate': {
        if (!this.sim || !this.classifier) break;
        this.sim.advanceFrame();
        this.trails.p1.push(this.sim.a.pos.x, this.sim.a.pos.y);
        this.trails.p2.push(this.sim.b.pos.x, this.sim.b.pos.y);
        const o = this.classifier.update(this.sim, dt);
        if (o.kind !== 'playing') this.toResolved(o);
        break;
      }
      case 'resolved': {
        // For WINs, the wobble keeps going — it really is infinite.
        if (this.sim && this.outcome?.kind === 'win') {
          this.sim.advanceFrame();
          this.trails.p1.push(this.sim.a.pos.x, this.sim.a.pos.y);
          this.trails.p2.push(this.sim.b.pos.x, this.sim.b.pos.y);
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
    });
  }
}

