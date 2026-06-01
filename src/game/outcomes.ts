import type { Simulation } from '../physics/Simulation.ts';
import { bodyRadius } from '../physics/Body.ts';
import { sub } from '../physics/Vec2.ts';

// What happened this frame.
export type Outcome =
  | { kind: 'playing' }
  | { kind: 'win' }
  | { kind: 'lose_collision' }
  | { kind: 'lose_escape' }
  | { kind: 'lose_slingshot' };

export interface OutcomeConfig {
  // Time before the classifier is allowed to fire at all. Lets the player
  // see the system kick off, and prevents quirks of the very first frame
  // (where the orbit hasn't quite established) from miscalling outcomes.
  warmupSeconds: number;

  // To win: at least this many complete orbits, with eccentricity at or below
  // this ceiling, both bodies still on the canvas.
  winOrbitsRequired: number;
  winMaxEccentricity: number;

  // Either body off-canvas for this long → the system has clearly resolved.
  // We then call ESCAPE if the system is unbound, SLINGSHOT if it's bound
  // (the bodies could return eventually but not in any meaningful arc).
  offCanvasGraceSeconds: number;

  canvasBounds: { minX: number; maxX: number; minY: number; maxY: number };
  // Beyond the visible canvas we allow this much margin before considering
  // a body "off-canvas" — gives near-edge orbits a chance to swing back in.
  offCanvasPad: number;
}

export const DEFAULT_OUTCOME_CONFIG: OutcomeConfig = {
  warmupSeconds: 0.6,
  winOrbitsRequired: 2,
  winMaxEccentricity: 0.93,
  offCanvasGraceSeconds: 0.6,
  canvasBounds: { minX: 0, maxX: 1280, minY: 0, maxY: 800 },
  offCanvasPad: 80,
};

// Stateful classifier — instantiated once per simulation run and asked to
// `update(sim, dt)` every frame. Tracks orbit count via unwrapped relative
// angle, and off-canvas-grace via a small timer.
export class OutcomeClassifier {
  private readonly cfg: OutcomeConfig;
  private prevAngle: number | null = null;
  private unwrappedAngle = 0;
  private offCanvasTime = 0;
  private resolved: Outcome = { kind: 'playing' };
  private completedOrbits = 0;

  constructor(cfg: OutcomeConfig = DEFAULT_OUTCOME_CONFIG) {
    this.cfg = cfg;
  }

  get orbits(): number {
    return this.completedOrbits;
  }

  reset(): void {
    this.prevAngle = null;
    this.unwrappedAngle = 0;
    this.offCanvasTime = 0;
    this.resolved = { kind: 'playing' };
    this.completedOrbits = 0;
  }

  update(sim: Simulation, dt: number): Outcome {
    if (this.resolved.kind !== 'playing') return this.resolved;

    const orbit = sim.orbit();

    // Collision is always checked first and instantly resolves.
    const rSum = bodyRadius(sim.a.mass) + bodyRadius(sim.b.mass);
    if (orbit.separation < rSum) {
      this.resolved = { kind: 'lose_collision' };
      return this.resolved;
    }

    // Track the relative-position angle continuously so we can count orbits.
    const r = sub(sim.b.pos, sim.a.pos);
    const angle = Math.atan2(r.y, r.x);
    if (this.prevAngle !== null) {
      let delta = angle - this.prevAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      else if (delta < -Math.PI) delta += 2 * Math.PI;
      this.unwrappedAngle += delta;
    }
    this.prevAngle = angle;
    this.completedOrbits = Math.floor(
      Math.abs(this.unwrappedAngle) / (2 * Math.PI),
    );

    if (sim.time < this.cfg.warmupSeconds) {
      return this.resolved;
    }

    const bothOnCanvas = this.onCanvas(sim.a.pos) && this.onCanvas(sim.b.pos);

    if (!bothOnCanvas) {
      this.offCanvasTime += dt;
      if (this.offCanvasTime >= this.cfg.offCanvasGraceSeconds) {
        this.resolved = orbit.bound
          ? { kind: 'lose_slingshot' }
          : { kind: 'lose_escape' };
        return this.resolved;
      }
      // Still in grace window — neither resolved nor a win this frame.
      return this.resolved;
    }

    // Both bodies on canvas. Reset off-canvas timer; check for win.
    this.offCanvasTime = 0;

    if (
      orbit.bound &&
      orbit.eccentricity <= this.cfg.winMaxEccentricity &&
      this.completedOrbits >= this.cfg.winOrbitsRequired
    ) {
      this.resolved = { kind: 'win' };
      return this.resolved;
    }

    return this.resolved;
  }

  private onCanvas(p: { x: number; y: number }): boolean {
    const b = this.cfg.canvasBounds;
    const pad = this.cfg.offCanvasPad;
    return (
      p.x >= b.minX - pad &&
      p.x <= b.maxX + pad &&
      p.y >= b.minY - pad &&
      p.y <= b.maxY + pad
    );
  }
}
