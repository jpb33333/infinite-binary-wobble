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
// Energy is the N-body escaper criterion with two-body mass in each pair term:
//   ε(body vs set S) = ½·|v − v̄_S|² − Σ_{j∈S} G·(m_j + m_body) / √(d_j² + soft²)
// with v̄_S the set's mass-weighted velocity and d_j 3D distances (the sandbox
// is 2.5D — bodies carry z/vz). Summed pair potentials, NOT the aggregate
// point mass at the set's COM: a body tightly orbiting one far member lives in
// that member's nearby well, which an aggregate potential can't see — the
// point-mass form would misread exactly the orbits this module exists to
// protect. The (m_j + m_body) form matches computeOrbit's two-body convention,
// reduces to the test-particle form for a world (mass 0.02), and makes a
// symmetric two-sun fission read exactly symmetric — which is what lets the
// lighter-leaves tie-break below pick the honest survivor.

export interface CoreFrame {
  members: Body[];
  mass: number;
  // Mass-weighted COM position and velocity of the members, in 3D.
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

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

// Escaper energy of `body` against the set `others` (see the header formula).
function escaperEnergy(body: Body, others: Body[], G: number, softening: number): number {
  const f = frameOf(others);
  const dvx = body.vel.x - f.vx;
  const dvy = body.vel.y - f.vy;
  const dvz = body.vz - f.vz;
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

// 3D distance from `body` to the COM of `others`. The candidate's own mass is
// excluded from the reference on purpose: measured from a members-inclusive
// COM, a heavy runaway drags the reference toward itself and postpones its own
// strip by M_total/M_rest — the exact bug this module fixes.
function distToFrame(body: Body, others: Body[]): number {
  const f = frameOf(others);
  return Math.hypot(body.pos.x - f.x, body.pos.y - f.y, body.z - f.z);
}

// The bound core of a star field: iteratively strip suns that have genuinely
// left (far + unbound vs the rest), then let any casualty of a mid-strip
// misjudgment rejoin against the settled core.
//
// A member is strippable only when BOTH arms fire — farther than `reach` from
// the complement AND unbound vs the complement. Neither arm alone is safe: a
// bound member can sit "far" from a complement COM dragged by a third body,
// and a fast-but-near star is simply passing through.
//
// Strip selection: the most unbound (max ε) goes first — the genuine escaper
// carries the escape kinetic energy, and removing it first un-pollutes every
// later judgment (an unstripped escaper skews the complement's COM velocity,
// making bound members read hot). On an exact ε tie — a symmetric two-sun
// fission produces one — the LIGHTER member leaves: the barycenter's own
// convention, so a disrupted binary's core stays with the heavier survivor.
// When a bound pair and a lone sun part ways, the pair's mutual well keeps its
// members' ε low, so the core follows the pair — the surviving *system* — and
// any worlds left with the lone sun are judged honestly by worldAdrift.
//
// Rejoin: while several escapers coexist, a bound member judged before the
// fastest one was stripped can be stripped in error. The rejoin sweep re-tests
// every stripped sun against the final core (bound OR back inside reach →
// rejoin), anchoring the verdict to the settled frame rather than to strip
// order. Stripping is also stateless per call: a stripped star that later
// swings back inside reach simply counts again.
//
// Never strips below one sun. Both loops move membership monotonically → ≤ N
// passes each; N ≤ the sandbox star cap, so cost is irrelevant.
export function boundCore(
  suns: Body[], G: number, softening: number, reach: number,
): CoreFrame {
  const members = suns.slice();
  const stripped: Body[] = [];

  let strippedOne = true;
  while (strippedOne && members.length > 1) {
    strippedOne = false;
    let pick = -1;
    let pickEnergy = -Infinity;
    let pickMass = Infinity;
    for (let i = 0; i < members.length; i++) {
      const rest = members.filter((_, j) => j !== i);
      if (distToFrame(members[i], rest) <= reach) continue;
      const energy = escaperEnergy(members[i], rest, G, softening);
      if (energy < 0) continue;
      const m = members[i].mass;
      if (energy > pickEnergy || (energy === pickEnergy && m < pickMass)) {
        pick = i;
        pickEnergy = energy;
        pickMass = m;
      }
    }
    if (pick >= 0) {
      stripped.push(members[pick]);
      members.splice(pick, 1);
      strippedOne = true;
    }
  }

  let rejoinedOne = true;
  while (rejoinedOne && stripped.length > 0) {
    rejoinedOne = false;
    for (let i = 0; i < stripped.length; i++) {
      const s = stripped[i];
      const near = distToFrame(s, members) <= reach;
      if (near || escaperEnergy(s, members, G, softening) < 0) {
        members.push(s);
        stripped.splice(i, 1);
        rejoinedOne = true;
        break; // COM moved — re-judge the rest against the grown core
      }
    }
  }

  return frameOf(members);
}

// Is this world, right now, on its way out of the system? Both arms must fire:
//   • staging — its 2D distance from the core COM exceeds `reach` (the eject
//     boundary is a *visual* line: what the player sees, and what the existing
//     drift warning already measures; a world lofted purely out of plane hovers
//     near the canvas centre and is the climate model's problem, not this one);
//   • energy — it is unbound vs the core (3D, core-relative velocity, summed
//     softened potentials over the members): past the line AND actually leaving.
// A bound world past the line is on a long ellipse — Kepler guarantees it
// swings home, so it is not "flung into the dark"; out there the climate model
// freezes it, which is the honest cost of the excursion. The Game keeps the
// grace timing; this is the per-frame verdict only.
export function worldAdrift(
  world: Body, core: CoreFrame, G: number, softening: number, reach: number,
): boolean {
  const dx = world.pos.x - core.x;
  const dy = world.pos.y - core.y;
  if (Math.hypot(dx, dy) <= reach) return false;
  return escaperEnergy(world, core.members, G, softening) >= 0;
}
