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
  // this ceiling, both bodies still inside the "in the system" radius.
  winOrbitsRequired: number;
  winMaxEccentricity: number;

  // With the camera following the barycenter, "off-canvas" stops meaning
  // "absolute canvas position" — a system can drift forever on screen so
  // long as the orbit stays compact. Instead we measure each body's
  // distance from the shared barycenter. If either body sits beyond
  // maxBodyDistanceFromBarycenter for `offCanvasGraceSeconds`, we declare:
  //   - ESCAPE  if the system is unbound (ε ≥ 0)
  //   - SLINGSHOT if it's bound — the orbit is so wide we can't keep it on
  //     screen even with the camera following.
  offCanvasGraceSeconds: number;
  maxBodyDistanceFromBarycenter: number;
}

export const DEFAULT_OUTCOME_CONFIG: OutcomeConfig = {
  warmupSeconds: 0.6,
  winOrbitsRequired: 2,
  winMaxEccentricity: 0.93,
  offCanvasGraceSeconds: 0.6,
  // Threshold tuned so the winning-orbit envelope (e ≤ 0.93, typical sep
  // ~640 px, equal masses) — apoapsis from barycenter ~720 px — fits
  // comfortably under the bound. Anything larger reads as SLINGSHOT.
  maxBodyDistanceFromBarycenter: 820,
};

// Kept for API stability — the classifier no longer needs layout-derived
// bounds, but callers may pass a layout for forward compatibility.
export function outcomeConfigForLayout(_layout: {
  canvas: { width: number; height: number };
}): OutcomeConfig {
  return { ...DEFAULT_OUTCOME_CONFIG };
}

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

  // Prepare this classifier for a FRESH Simulation. The pairing contract is
  // one classifier per simulation run: collision keys off sim.minSeparation,
  // which is monotone since the SIM's construction — reusing a sim that has
  // already grazed would re-resolve lose_collision instantly after reset.
  // (Game.ts constructs both together in toSimulate; keep it that way.)
  reset(): void {
    this.prevAngle = null;
    this.unwrappedAngle = 0;
    this.offCanvasTime = 0;
    this.resolved = { kind: 'playing' };
    this.completedOrbits = 0;
  }

  update(sim: Simulation, dt: number): Outcome {
    // Track the relative-position angle every frame, even after resolution.
    // For WIN the orbit keeps going ("stay and watch as long as you like"),
    // so the ORBITS HUD counter has to keep ticking up too — the infinite
    // wobble is the whole metaphor. Only the *outcome* freezes on resolve.
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

    if (this.resolved.kind !== 'playing') return this.resolved;

    const orbit = sim.orbit();

    // Collision is always checked first and instantly resolves. Keys off the
    // SUBSTEP-resolution minimum separation (maintained by Simulation.step),
    // not the instantaneous separation: this classifier samples once per
    // rendered frame, and a fast grazing pass can overlap and pull apart
    // again entirely between two samples (reliably missed at the 1/30 s
    // frame floor for light stars before this).
    const rSum = bodyRadius(sim.a.mass) + bodyRadius(sim.b.mass);
    if (sim.minSeparation < rSum) {
      this.resolved = { kind: 'lose_collision' };
      return this.resolved;
    }

    if (sim.time < this.cfg.warmupSeconds) {
      return this.resolved;
    }

    // Compute each body's distance from the shared barycenter. With camera
    // follow on, the renderer keeps the barycenter centered, so this — not
    // absolute canvas position — is the honest measure of "too far gone."
    const M = sim.a.mass + sim.b.mass;
    const bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M;
    const by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M;
    const dA = Math.hypot(sim.a.pos.x - bx, sim.a.pos.y - by);
    const dB = Math.hypot(sim.b.pos.x - bx, sim.b.pos.y - by);
    const maxBodyDist = Math.max(dA, dB);

    if (maxBodyDist > this.cfg.maxBodyDistanceFromBarycenter) {
      this.offCanvasTime += dt;
      if (this.offCanvasTime >= this.cfg.offCanvasGraceSeconds) {
        this.resolved = orbit.bound
          ? { kind: 'lose_slingshot' }
          : { kind: 'lose_escape' };
        return this.resolved;
      }
      return this.resolved;
    }

    // Both bodies inside the orbit envelope. Reset the timer; check for win.
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
}
