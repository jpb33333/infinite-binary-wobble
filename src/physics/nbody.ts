import type { Body } from './Body.ts';

// N-body Plummer-softened gravity + PEFRL, for the post-win "third star"
// unravel (the three-body problem tearing a stable binary apart).
//
// This is ADDITIVE. The two-body engine (gravity.ts / integrator.ts /
// Simulation.ts) is the tested floor and the golden-parity contract with the
// iOS Swift port, so it stays byte-for-byte untouched. These functions use the
// SAME softened kernel and the SAME PEFRL coefficients, so for N = 2 they
// reproduce the two-body dynamics exactly (asserted in nbody.test.ts) — this
// path just generalizes the force sum and the drift/kick loops to N bodies.

// PEFRL [Omelyan, Mryglod & Folk, 2002] — identical constants to integrator.ts
// (mathematical constants from the paper; duplicated to keep this module
// dependency-free, like the rest of src/physics/).
const XI = 0.1786178958448091;
const LAMBDA = -0.2123418310626054;
const CHI = -0.06626458266981849;

// All-pairs Plummer-softened gravity. Zeroes every accel, then adds each
// unordered pair's mutual contribution to BOTH bodies (Newton's third law).
// The single-pair kernel matches gravity.ts exactly; with the accel cleared
// first, the N = 2 result is identical to applyGravity's overwrite.
export function applyGravityN(bodies: Body[], G: number, softening: number): void {
  const soft2 = softening * softening;
  for (const body of bodies) {
    body.accel.x = 0;
    body.accel.y = 0;
  }
  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j];
      const dx = bj.pos.x - bi.pos.x;
      const dy = bj.pos.y - bi.pos.y;
      const denom = Math.pow(dx * dx + dy * dy + soft2, 1.5);
      const gi = (G * bj.mass) / denom; // |accel| on i, directed toward j
      const gj = (G * bi.mass) / denom; // |accel| on j, directed toward i
      bi.accel.x += gi * dx;
      bi.accel.y += gi * dy;
      bj.accel.x -= gj * dx;
      bj.accel.y -= gj * dy;
    }
  }
}

function driftN(bodies: Body[], dtScaled: number): void {
  for (const b of bodies) {
    b.pos.x += b.vel.x * dtScaled;
    b.pos.y += b.vel.y * dtScaled;
  }
}

function kickN(bodies: Body[], dtScaled: number): void {
  for (const b of bodies) {
    b.vel.x += b.accel.x * dtScaled;
    b.vel.y += b.accel.y * dtScaled;
  }
}

// One PEFRL step over N bodies — same 5-drift / 4-kick / 4-force sequence as
// integrator.ts's pefrlStep, just looped over the array.
export function pefrlStepN(bodies: Body[], dt: number, G: number, softening: number): void {
  const cD1 = XI * dt;
  const cD2 = CHI * dt;
  const cD3 = (1 - 2 * (XI + CHI)) * dt;
  const cK1 = ((1 - 2 * LAMBDA) / 2) * dt;
  const cK2 = LAMBDA * dt;

  driftN(bodies, cD1);
  applyGravityN(bodies, G, softening);
  kickN(bodies, cK1);

  driftN(bodies, cD2);
  applyGravityN(bodies, G, softening);
  kickN(bodies, cK2);

  driftN(bodies, cD3);
  applyGravityN(bodies, G, softening);
  kickN(bodies, cK2);

  driftN(bodies, cD2);
  applyGravityN(bodies, G, softening);
  kickN(bodies, cK1);

  driftN(bodies, cD1);
}

// Total mechanical energy with the SAME softened potential the integrator
// conserves: KE = Σ½mᵢ|vᵢ|², PE = Σ_{i<j} −G·mᵢ·mⱼ / √(rᵢⱼ² + ε²).
export function totalEnergy(bodies: Body[], G: number, softening: number): number {
  const soft2 = softening * softening;
  let ke = 0;
  for (const b of bodies) {
    ke += 0.5 * b.mass * (b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  }
  let pe = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].pos.x - bodies[i].pos.x;
      const dy = bodies[j].pos.y - bodies[i].pos.y;
      pe += -(G * bodies[i].mass * bodies[j].mass) / Math.sqrt(dx * dx + dy * dy + soft2);
    }
  }
  return ke + pe;
}

// Total linear momentum Σmᵢvᵢ — conserved to machine precision by PEFRL
// (internal forces cancel by Newton's third law, so every kick is momentum-
// neutral). The test keys off this.
export function totalMomentum(bodies: Body[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const b of bodies) {
    x += b.mass * b.vel.x;
    y += b.mass * b.vel.y;
  }
  return { x, y };
}

export function centerOfMass(bodies: Body[]): { x: number; y: number } {
  let mx = 0;
  let my = 0;
  let m = 0;
  for (const b of bodies) {
    mx += b.mass * b.pos.x;
    my += b.mass * b.pos.y;
    m += b.mass;
  }
  return m > 0 ? { x: mx / m, y: my / m } : { x: 0, y: 0 };
}

// Smallest current distance between any pair — collision detection reads this.
export function minPairSeparation(bodies: Body[]): number {
  let min = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].pos.x - bodies[i].pos.x;
      const dy = bodies[j].pos.y - bodies[i].pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < min) min = d;
    }
  }
  return min;
}

// Public facade for the three-body unravel — mirrors Simulation's shape
// (time, primed accel, a per-substep minimum separation) so the Game drives it
// the same way it drives the two-body Simulation.
export class NBodySimulation {
  readonly bodies: Body[];
  readonly G: number;
  readonly softening: number;
  time = 0;
  readonly initialEnergy: number;
  // Smallest pair separation seen at any substep since construction (collision
  // can graze between frames; same reasoning as Simulation.minSeparation).
  minSeparation: number;

  constructor(bodies: Body[], G: number, softening: number) {
    this.bodies = bodies;
    this.G = G;
    this.softening = softening;
    applyGravityN(bodies, G, softening); // prime accel for the first kick
    this.minSeparation = minPairSeparation(bodies);
    this.initialEnergy = totalEnergy(bodies, G, softening);
  }

  step(dt: number): void {
    pefrlStepN(this.bodies, dt, this.G, this.softening);
    this.time += dt;
    const m = minPairSeparation(this.bodies);
    if (m < this.minSeparation) this.minSeparation = m;
  }

  energy(): number {
    return totalEnergy(this.bodies, this.G, this.softening);
  }

  momentum(): { x: number; y: number } {
    return totalMomentum(this.bodies);
  }

  centerOfMass(): { x: number; y: number } {
    return centerOfMass(this.bodies);
  }

  // Farthest any body currently sits from the barycenter — ejection detection.
  maxDistanceFromCOM(): number {
    const c = this.centerOfMass();
    let max = 0;
    for (const b of this.bodies) {
      const dx = b.pos.x - c.x;
      const dy = b.pos.y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > max) max = d;
    }
    return max;
  }
}
