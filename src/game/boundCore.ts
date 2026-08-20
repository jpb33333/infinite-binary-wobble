import type { Body } from '../physics/Body.ts';

// The bound core — which suns still constitute "the system", and whether a
// world is truly lost to it. This is the sandbox's measuring stick: the
// ejection verdict, the camera, and every spawn/aim reference read the core's
// barycenter, so an unbound runaway star (which Act-II slingshots produce
// constantly, and which nothing ever removes from the simulation) must stop
// counting once it has genuinely left — otherwise it drags the COM into empty
// space and healthy worlds get measured from a phantom point. Pure model — no
// rendering, no DOM, no engine dependency — mirroring visibility.ts, so every
// judgment here is unit-tested.
//
// One rule everywhere: STAGING distances are 2D (the eject boundary is a
// visual line on the stage — a body climbing straight out of plane is still
// drawn at the canvas centre and still belongs to the scene), while ENERGIES
// are 3D (the sandbox is 2.5D; bodies carry z/vz and a vertical escape is a
// real escape). Energy is the N-body escaper criterion with two-body mass in
// each pair term:
//   ε(body vs set S) = ½·|v − v̄_S|² − Σ_{j∈S} G·(m_j + m_body) / √(d_j² + soft²)
// with v̄_S the set's mass-weighted velocity and d_j 3D pair distances. Summed
// pair potentials, NOT the aggregate point mass at the set's COM: a body
// tightly orbiting one far member lives in that member's nearby well, which
// an aggregate potential can't see — the point-mass form would misread
// exactly the orbits this module exists to protect. The (m_j + m_body) form
// matches computeOrbit's two-body convention, reduces to the test-particle
// form for a world (mass 0.02), and makes a symmetric two-sun fission read
// exactly symmetric — which is what lets the lighter-leaves tie-break pick
// the honest survivor.
//
// Known edge, deliberately unsolved here: membership is stateless per call,
// so a star riding the knife edge of the boundary with ε ≈ 0 can flap in and
// out across a few frames. Statelessness is load-bearing (self-healing, no
// lifecycle, fully unit-testable); the Game's camera glide absorbs the visual
// jump, and the ejection grace HOLDS rather than resets off-boundary, so a
// flap costs a wobble, not an outcome. Hysteresis is the follow-up if play
// demands it.

export interface CoreFrame {
  members: Body[];
  mass: number;
  // Mass-weighted COM position and velocity of the members, in 3D. (z has no
  // production reader — staging deliberately uses only x/y — but it completes
  // the frame and the tests pin it.)
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

// ε-equality band for the lighter-leaves tie-break, relative. An analytic tie
// (a pure two-sun fission) lands within a few ulps of exact — but only a few:
// frameOf's (m·v)/m round-trip breaks bitwise equality for full-entropy
// masses, and on `===` the surviving fragment was decided by that noise,
// flipping frame to frame. 1e-9 is astronomically wider than the rounding and
// astronomically narrower than any physical distinction.
const TIE_REL = 1e-9;

function frameOf(members: Body[]): CoreFrame {
  let mass = 0;
  let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of members) {
    mass += b.mass;
    x += b.mass * b.pos.x;
    y += b.mass * b.pos.y;
    z += b.mass * b.z;
    vx += b.mass * b.vel.x;
    vy += b.mass * b.vel.y;
    vz += b.mass * b.vz;
  }
  if (mass <= 0) return { members, mass: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  return {
    members,
    mass,
    x: x / mass, y: y / mass, z: z / mass,
    vx: vx / mass, vy: vy / mass, vz: vz / mass,
  };
}

// Escaper energy of `body` against the set `others`, whose frame is already
// computed (KE is taken relative to the frame's velocity — see the header).
function escaperEnergy(
  body: Body,
  others: Body[],
  frame: { vx: number; vy: number; vz: number },
  G: number,
  softening: number,
): number {
  const dvx = body.vel.x - frame.vx;
  const dvy = body.vel.y - frame.vy;
  const dvz = body.vz - frame.vz;
  let potential = 0;
  for (const o of others) {
    const dx = body.pos.x - o.pos.x;
    const dy = body.pos.y - o.pos.y;
    const dz = body.z - o.z;
    potential +=
      (G * (o.mass + body.mass)) /
      Math.sqrt(dx * dx + dy * dy + dz * dz + softening * softening);
  }
  return 0.5 * (dvx * dvx + dvy * dvy + dvz * dvz) - potential;
}

// Strip suns that have genuinely left, one per iteration, until none qualify.
// A member is strippable only when BOTH arms fire: its 2D distance from the
// complement's COM exceeds `reach` (the candidate's own mass is excluded from
// the reference on purpose — measured from a members-inclusive COM, a heavy
// runaway drags the reference toward itself and postpones its own strip by
// M_total/M_rest) AND it is unbound vs the complement. Neither arm alone is
// safe: a bound member can sit "far" from a complement COM dragged by a third
// body, and a fast-but-near star is simply passing through the stage.
//
// Selection: the most unbound (max ε) goes first — the genuine escaper
// carries the escape kinetic energy, and removing it first un-pollutes every
// later judgment (an unstripped escaper skews the complement's COM velocity,
// making bound members read hot). Ties within TIE_REL — a symmetric fission —
// send the LIGHTER member away: the barycenter's own convention, so a
// disrupted binary's core stays with the heavier survivor. Never strips below
// one sun. Returns whether anything was stripped.
function stripPass(
  members: Body[], stripped: Body[], G: number, softening: number, reach: number,
): boolean {
  let any = false;
  let strippedOne = true;
  while (strippedOne && members.length > 1) {
    strippedOne = false;
    let pick = -1;
    let pickEnergy = -Infinity;
    let pickMass = Infinity;
    for (let i = 0; i < members.length; i++) {
      const rest = members.filter((_, j) => j !== i);
      const f = frameOf(rest);
      const flat = Math.hypot(members[i].pos.x - f.x, members[i].pos.y - f.y);
      if (flat <= reach) continue;
      const energy = escaperEnergy(members[i], rest, f, G, softening);
      if (energy < 0) continue;
      const m = members[i].mass;
      const tie = Math.abs(energy - pickEnergy) <= TIE_REL * Math.max(Math.abs(energy), Math.abs(pickEnergy), 1);
      if ((!tie && energy > pickEnergy) || (tie && m < pickMass)) {
        pick = i;
        pickEnergy = energy;
        pickMass = m;
      }
    }
    if (pick >= 0) {
      stripped.push(members[pick]);
      members.splice(pick, 1);
      strippedOne = true;
      any = true;
    }
  }
  return any;
}

// Re-admit stripped suns that the settled core still owns: back inside the
// stage line (2D) OR bound to the members. While several escapers coexist, a
// bound member judged before the fastest one was stripped can be stripped in
// error — this sweep re-anchors the verdict to the settled frame rather than
// to strip order. Stripping is stateless per call anyway: a stripped star
// that later swings home simply counts again next frame.
function rejoinPass(
  members: Body[], stripped: Body[], G: number, softening: number, reach: number,
): void {
  let rejoinedOne = true;
  while (rejoinedOne && stripped.length > 0) {
    rejoinedOne = false;
    for (let i = 0; i < stripped.length; i++) {
      const s = stripped[i];
      const f = frameOf(members);
      const flat = Math.hypot(s.pos.x - f.x, s.pos.y - f.y);
      if (flat <= reach || escaperEnergy(s, members, f, G, softening) < 0) {
        members.push(s);
        stripped.splice(i, 1);
        rejoinedOne = true;
        break; // COM moved — re-judge the rest against the grown core
      }
    }
  }
}

// The bound core of a star field: strip → rejoin → strip.
//
// The final strip pass exists because the rejoin's energy arm judges against
// a frame that can itself be polluted (a fast near passer-by in the members
// drags v̄, letting a genuine escaper rejoin as "bound"): re-stripping against
// the settled set removes anything flagrantly violating the strip invariant.
// It runs ONCE, not to an outer fixed point — a marginal state can ping-pong
// strip↔rejoin forever, and one bounded sequence keeps the result
// deterministic. Rejoined bound members survive it by construction (they are
// bound vs the very set that admitted them).
export function boundCore(
  suns: Body[], G: number, softening: number, reach: number,
): CoreFrame {
  const members = suns.slice();
  const stripped: Body[] = [];
  stripPass(members, stripped, G, softening, reach);
  rejoinPass(members, stripped, G, softening, reach);
  stripPass(members, stripped, G, softening, reach);
  return frameOf(members);
}

// Is this world, right now, on its way out of the system? Both arms must fire:
//   • staging — its 2D distance from the core COM exceeds `reach` (what the
//     player sees, and what the existing drift warning already measures; a
//     world lofted purely out of plane hovers near the canvas centre and is
//     the climate model's problem, not this one);
//   • energy — it is unbound vs the core (3D, KE relative to the core frame's
//     own velocity, summed softened potentials over the members): past the
//     line AND actually leaving.
// A bound world past the line is on a long ellipse — Kepler guarantees it
// swings home, so it is not "flung into the dark". The Game keeps the grace
// timing (and its hold-vs-reset semantics); this is the per-frame verdict.
export function worldAdrift(
  world: Body, core: CoreFrame, G: number, softening: number, reach: number,
): boolean {
  const dx = world.pos.x - core.x;
  const dy = world.pos.y - core.y;
  if (Math.hypot(dx, dy) <= reach) return false;
  return escaperEnergy(world, core.members, core, G, softening) >= 0;
}
