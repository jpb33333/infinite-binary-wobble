import type { Body } from './Body.ts';
import { createBody, bodyRadius } from './Body.ts';
import { vec2 } from './Vec2.ts';

// A collision event. Below the supernova mass the two stars fuse into one
// (`supernova: false`, `body` = the fused star, momentum conserved). At or
// above it the merge detonates instead (`supernova: true`, `body` = null —
// nothing survives the blast) and a shockwave is rammed outward through every
// other body (a supernova is NOT momentum-conserving; it dumps energy outward).
export interface MergeEvent {
  x: number;
  y: number;
  mass: number;
  supernova: boolean;
  body: Body | null;
}

// A merge whose combined mass reaches this detonates (Type-Ia-style) rather
// than fusing — game units, tuned so only big stars colliding blow up. The
// blast adds an outward velocity impulse to each survivor, falling off with
// distance (game-feel-tuned, not SI).
const SUPERNOVA_MASS = 9;
const BLAST_STRENGTH = 2.0e6;
const BLAST_VMAX = 500;
// Stars merge only on a genuine DEEP overlap, not a graze — their centres must
// come within this fraction of the summed radii. Grazing passes slingshot
// instead, so the three-body chaos lasts far longer before collapsing to a
// stable binary. (1.0 = "surfaces touch"; lower = rarer, more chaotic.)
const MERGE_OVERLAP = 0.5;

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
    body.az = 0;
  }
  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j];
      const dx = bj.pos.x - bi.pos.x;
      const dy = bj.pos.y - bi.pos.y;
      const dz = bj.z - bi.z;
      const denom = Math.pow(dx * dx + dy * dy + dz * dz + soft2, 1.5);
      const gi = (G * bj.mass) / denom; // |accel| on i, directed toward j
      const gj = (G * bi.mass) / denom; // |accel| on j, directed toward i
      bi.accel.x += gi * dx;
      bi.accel.y += gi * dy;
      bi.az += gi * dz;
      bj.accel.x -= gj * dx;
      bj.accel.y -= gj * dy;
      bj.az -= gj * dz;
    }
  }
}

function driftN(bodies: Body[], dtScaled: number): void {
  for (const b of bodies) {
    b.pos.x += b.vel.x * dtScaled;
    b.pos.y += b.vel.y * dtScaled;
    b.z += b.vz * dtScaled;
  }
}

function kickN(bodies: Body[], dtScaled: number): void {
  for (const b of bodies) {
    b.vel.x += b.accel.x * dtScaled;
    b.vel.y += b.accel.y * dtScaled;
    b.vz += b.az * dtScaled;
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
    ke += 0.5 * b.mass * (b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vz * b.vz);
  }
  let pe = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].pos.x - bodies[i].pos.x;
      const dy = bodies[j].pos.y - bodies[i].pos.y;
      const dz = bodies[j].z - bodies[i].z;
      pe += -(G * bodies[i].mass * bodies[j].mass) / Math.sqrt(dx * dx + dy * dy + dz * dz + soft2);
    }
  }
  return ke + pe;
}

// Total linear momentum Σmᵢvᵢ — conserved to machine precision by PEFRL
// (internal forces cancel by Newton's third law, so every kick is momentum-
// neutral). The test keys off this; z is included so 3D runs are covered.
export function totalMomentum(bodies: Body[]): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const b of bodies) {
    x += b.mass * b.vel.x;
    y += b.mass * b.vel.y;
    z += b.mass * b.vz;
  }
  return { x, y, z };
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
      const dz = bodies[j].z - bodies[i].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  // Bodies exempt from merging — a planet (Earth) feels the suns' gravity but
  // never fuses with one. It can still be flung around or scorched; it just
  // doesn't turn a star into a blue straggler by brushing it.
  readonly noMerge = new Set<Body>();

  constructor(bodies: Body[], G: number, softening: number) {
    this.bodies = bodies;
    this.G = G;
    this.softening = softening;
    applyGravityN(bodies, G, softening); // prime accel for the first kick
    this.minSeparation = minPairSeparation(bodies);
    this.initialEnergy = totalEnergy(bodies, G, softening);
  }

  // Advance one fixed step, then resolve at most one collision into a merge.
  // Returns the merge event for the caller to animate, or null. The system is
  // never stopped — after a merge it simply has one fewer body and keeps going.
  step(dt: number): MergeEvent | null {
    pefrlStepN(this.bodies, dt, this.G, this.softening);
    this.time += dt;
    const m = minPairSeparation(this.bodies);
    if (m < this.minSeparation) this.minSeparation = m;
    return this.resolveCollision();
  }

  // Add a body to the running system (e.g. a planet dropped in mid-unravel). It
  // feels gravity from the next step on; `noMerge` keeps a planet from fusing.
  addBody(body: Body, noMerge = false): void {
    this.bodies.push(body);
    if (noMerge) this.noMerge.add(body);
  }

  // Resolve the first overlapping pair (surfaces touching). Below the supernova
  // mass they fuse — perfectly inelastic: combined mass, momentum-conserving
  // velocity, COM position. At/above it they DETONATE: both are removed and a
  // shockwave impulse is rammed through every survivor. One pair per call; a
  // rare simultaneous second overlap resolves on the next step.
  private resolveCollision(): MergeEvent | null {
    const b = this.bodies;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        if (this.noMerge.has(b[i]) || this.noMerge.has(b[j])) continue; // a planet never fuses
        const dx = b[j].pos.x - b[i].pos.x;
        const dy = b[j].pos.y - b[i].pos.y;
        const dz = b[j].z - b[i].z;
        const contact = MERGE_OVERLAP * (bodyRadius(b[i].mass) + bodyRadius(b[j].mass));
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < contact) {
          const mass = b[i].mass + b[j].mass;
          const x = (b[i].mass * b[i].pos.x + b[j].mass * b[j].pos.x) / mass;
          const y = (b[i].mass * b[i].pos.y + b[j].mass * b[j].pos.y) / mass;
          const z = (b[i].mass * b[i].z + b[j].mass * b[j].z) / mass;
          if (mass >= SUPERNOVA_MASS) {
            b.splice(j, 1); // remove the higher index first
            b.splice(i, 1);
            this.applyBlast(x, y, z, mass);
            return { x, y, mass, supernova: true, body: null };
          }
          const vx = (b[i].mass * b[i].vel.x + b[j].mass * b[j].vel.x) / mass;
          const vy = (b[i].mass * b[i].vel.y + b[j].mass * b[j].vel.y) / mass;
          const vz = (b[i].mass * b[i].vz + b[j].mass * b[j].vz) / mass;
          const merged = createBody(mass, vec2(x, y), vec2(vx, vy));
          merged.z = z;
          merged.vz = vz;
          b.splice(j, 1);
          b[i] = merged;
          return { x, y, mass, supernova: false, body: merged };
        }
      }
    }
    return null;
  }

  // A supernova shockwave: an outward velocity impulse to every surviving body,
  // ∝ source mass / distance² (capped), like a blast shell ramming through the
  // system. Called after the detonated pair has been removed.
  private applyBlast(cx: number, cy: number, cz: number, sourceMass: number): void {
    for (const body of this.bodies) {
      const dx = body.pos.x - cx;
      const dy = body.pos.y - cy;
      const dz = body.z - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);
      if (dist < 1e-6) continue;
      const dv = Math.min(BLAST_VMAX, (BLAST_STRENGTH * sourceMass) / Math.max(distSq, 1));
      body.vel.x += (dx / dist) * dv;
      body.vel.y += (dy / dist) * dv;
      body.vz += (dz / dist) * dv;
    }
  }

  energy(): number {
    return totalEnergy(this.bodies, this.G, this.softening);
  }

  momentum(): { x: number; y: number; z: number } {
    return totalMomentum(this.bodies);
  }

  centerOfMass(): { x: number; y: number } {
    return centerOfMass(this.bodies);
  }
}
