import { describe, test, expect } from 'vitest';
import { boundCore, worldAdrift } from '../src/game/boundCore.ts';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import type { Body } from '../src/physics/Body.ts';

// The sandbox's "which stars still constitute the system?" question, and the
// energy test that decides whether a world is truly lost to the dark. Pure
// model, driven here with toy units (G = 1, no softening, reach = 100) — the
// module is fully parameterized, like visibility.ts.

const G = 1;
const SOFT = 0;
const REACH = 100;

function star(mass: number, x: number, y: number, vx = 0, vy = 0, z = 0, vz = 0): Body {
  const b = createBody(mass, vec2(x, y), vec2(vx, vy));
  b.z = z;
  b.vz = vz;
  return b;
}

// A comfortable binary: two unit masses 20 apart, mutually circular. Well
// inside reach and firmly bound — the control group for every strip test.
function binary(): Body[] {
  const v = Math.sqrt((G * 2) / 20) / 2; // half the relative circular speed each
  return [star(1, -10, 0, 0, -v), star(1, 10, 0, 0, v)];
}

describe('boundCore — who still counts as the system', () => {
  test('a clean binary is untouched: both members, COM at the barycenter', () => {
    const core = boundCore(binary(), G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
    expect(core.mass).toBeCloseTo(2, 9);
    expect(core.x).toBeCloseTo(0, 9);
    expect(core.y).toBeCloseTo(0, 9);
  });

  test('an unbound runaway beyond reach is stripped; the COM stays with the binary', () => {
    const suns = [...binary(), star(1, 150, 0, 10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
    expect(core.x).toBeCloseTo(0, 6);
    // Without the strip, the runaway would drag the COM to x = 50 — the false
    // reference the ejection check and camera used to measure from.
  });

  test('a massive runaway cannot hide behind its own COM drag (distance is vs the complement)', () => {
    // Mass 5 among total 7: measured from the members-inclusive COM its distance
    // would read 150·(2/7) ≈ 43 — "near" — and it would keep dragging the frame
    // until 3.5× farther out. Measured from the complement (the binary) it is
    // honestly 150 out, and goes at the boundary.
    const suns = [...binary(), star(5, 150, 0, 10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
    expect(core.mass).toBeCloseTo(2, 9);
  });

  test('a bound star on a far excursion is kept — and its real COM drag is honest', () => {
    // At rest relative to the binary, 150 out: apoapsis of a long ellipse. It
    // WILL come home; while it is away the barycenter genuinely sits between
    // them (x = 50) — that drag is orbital truth, absorbed by the world energy
    // test, never by pretending the star left.
    const suns = [...binary(), star(1, 150, 0, 0, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(3);
    expect(core.x).toBeCloseTo(50, 6);
  });

  test('a fast runaway cannot get a bound star mis-stripped (most-unbound strips first)', () => {
    // The runaway pollutes the complement's COM velocity while it remains a
    // member: judged against that frame, the far BOUND star (at rest) reads
    // "moving" and its ε comes out positive too. Stripping the largest ε first
    // removes the real offender, and the re-judged bound star is kept.
    const suns = [...binary(), star(1, -150, 0, -10, 0), star(1, 200, 0, 0, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(3);
    const xs = core.members.map(m => m.pos.x).sort((a, b) => a - b);
    expect(xs).toEqual([-10, 10, 200]); // the binary + the bound wanderer
  });

  test('a star tightly bound to a bound-far companion is kept (summed potentials, not point-mass)', () => {
    // A co-orbiting pair 300 out, at rest as a pair relative to the central
    // star: each member's binding lives in its companion's nearby well. An
    // aggregate point-mass potential at ~300 would call both unbound.
    const vOrb = Math.sqrt((G * 2) / 2) / 2; // half the pair's relative circular speed
    const suns = [
      star(2, 0, 0),
      star(1, 300, 1, vOrb, 0),
      star(1, 300, -1, -vOrb, 0),
    ];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(3);
  });

  test('when a bound pair and a lone sun part ways, the core follows the pair', () => {
    // The pair's mutual well keeps its members' escaper energy low, so the
    // lone sun reads as the one who left: the core is the surviving *system*
    // (the thing still orbiting), not the lone wanderer. Any worlds left with
    // the loner are then judged honestly by worldAdrift.
    const vOrb = Math.sqrt((G * 2) / 2) / 2;
    const suns = [
      star(2, 0, 0),
      star(1, 300, 1, 10 + vOrb, 0),
      star(1, 300, -1, 10 - vOrb, 0),
    ];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
    expect(core.mass).toBeCloseTo(2, 9);
    expect(core.vx).toBeCloseTo(10, 6); // riding with the pair
  });

  test('in a mutual fission of two lone suns, the heavier keeps the name', () => {
    // The two-body mass form makes the fission read exactly symmetric (equal ε
    // both ways), so the lighter-leaves tie-break decides: a disrupted binary's
    // core — and the camera — stay with the heavier survivor.
    const suns = [star(3, -150, 0, -10, 0), star(1, 150, 0, 10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(1);
    expect(core.members[0].mass).toBe(3);
  });

  test('two opposite runaways (supernova-blast shape) are both stripped', () => {
    const suns = [...binary(), star(1, 150, 0, 10, 0), star(1, -150, 0, -10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
    expect(core.x).toBeCloseTo(0, 6);
  });

  test('a full mutual disruption never strips below one member', () => {
    const suns = [star(1, 150, 0, 10, 0), star(1, -150, 0, -10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(1);
    expect(core.mass).toBe(1);
  });

  test('the strip distance is 3D: a z-axis runaway is stripped too', () => {
    const suns = [...binary(), star(1, 0, 0, 0, 0, 150, 10)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2);
  });

  test('the core carries the members’ mass-weighted velocity (the frame worlds are judged in)', () => {
    const drift = 5;
    const suns = binary().map(s => {
      s.vel.x += drift;
      return s;
    });
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.vx).toBeCloseTo(drift, 9);
    expect(core.vy).toBeCloseTo(0, 9);
    expect(core.vz).toBeCloseTo(0, 9);
  });
});

describe('worldAdrift — lost means actually leaving', () => {
  // A single heavy sun as the whole core keeps the orbital arithmetic legible.
  const sun = (vx = 0) => boundCore([star(4, 0, 0, vx, 0)], G, SOFT, REACH);

  test('a bound world lingering past the boundary near apoapsis is NOT adrift', () => {
    // Past reach (staging arm fires) but under escape speed at its radius
    // (v_esc = √(2·4/120) ≈ 0.258): Kepler guarantees it swings home.
    const world = star(0.02, 120, 0, 0, 0.1);
    expect(worldAdrift(world, sun(), G, SOFT, REACH)).toBe(false);
  });

  test('a tight S-type world riding a bound-far member star is NOT adrift', () => {
    // THE regression trap: the world orbits the far member at r = 2 with speed
    // ≈ 0.707 — huge KE relative to the core COM, but its host's well (Σ over
    // members: 1/2 dominates) holds it. A point-mass core potential at ~102
    // would misread this exact case as unbound and re-create the false loss.
    const suns = [star(2, 0, 0), star(1, 150, 0, 0, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(2); // the far member is bound → kept
    const world = star(0.02, 152, 0, 0, Math.sqrt(G * 1 / 2));
    expect(worldAdrift(world, core, G, SOFT, REACH)).toBe(false);
  });

  test('a hyperbolic world past the boundary IS adrift', () => {
    const world = star(0.02, 120, 0, 1, 0); // well past v_esc ≈ 0.258
    expect(worldAdrift(world, sun(), G, SOFT, REACH)).toBe(true);
  });

  test('the verdict lives in the core’s frame: a drifting system does not strand its own world', () => {
    // Same bound world as the lingerer test, but the whole system streams at
    // vx = 10. Judged in absolute velocities it would scream "unbound".
    const world = star(0.02, 120, 0, 10, 0.1);
    expect(worldAdrift(world, sun(10), G, SOFT, REACH)).toBe(false);
  });

  test('staging is 2D: a world lofted purely out of plane never reads as past the boundary', () => {
    // It hovers near the canvas centre (2D dist 0) — visibly frozen, handled by
    // the climate/extinction path, never by the "flung out" card.
    const world = star(0.02, 0, 0, 0, 0, 200, 10);
    expect(worldAdrift(world, sun(), G, SOFT, REACH)).toBe(false);
  });

  test('energy is 3D: a far world unbound only through vz IS adrift', () => {
    const world = star(0.02, 120, 0, 0, 0.1, 0, 1); // in-plane bound, vz blows the total
    expect(worldAdrift(world, sun(), G, SOFT, REACH)).toBe(true);
  });

  test('a world emigrating with a stripped sun counts as lost (it left the stage)', () => {
    const suns = [star(2, 0, 0), star(1, 150, 0, 10, 0)];
    const core = boundCore(suns, G, SOFT, REACH);
    expect(core.members).toHaveLength(1); // the runaway is stripped…
    const world = star(0.02, 152, 0, 10, Math.sqrt(G * 1 / 2)); // …and its world rides along
    expect(worldAdrift(world, core, G, SOFT, REACH)).toBe(true);
  });
});
