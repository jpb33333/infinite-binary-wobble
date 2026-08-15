import { vec2 } from '../physics/Vec2.ts';

// Auto-velocity for a body the player "Set"-places in the sandbox. Quick-set:
// the player picks the spot (and a star's mass); we supply a sensible velocity.
// Pure, so the drop math is unit-tested without the canvas.

type P = { x: number; y: number };

// A placed PLANET gets a near-circular orbit around the barycenter — tangent to
// the radius, speed = sqrt(G·M / r) — the same law addPlanet uses, but at the
// player's chosen radius. Zero for a degenerate spot (on the COM) or no mass.
export function placedPlanetVelocity(pos: P, com: P, totalMass: number, G: number) {
  const dx = pos.x - com.x;
  const dy = pos.y - com.y;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6 || totalMass <= 0) return vec2(0, 0);
  const vCirc = Math.sqrt((G * totalMass) / r);
  return vec2((-dy / r) * vCirc, (dx / r) * vCirc); // counter-clockwise tangent
}

// A placed STAR is aimed straight inbound — at the barycenter — at a fixed speed,
// so it drives into the system instead of drifting off. Zero if placed exactly
// on the COM.
export function placedStarVelocity(pos: P, com: P, speed: number) {
  const dx = com.x - pos.x;
  const dy = com.y - pos.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return vec2(0, 0);
  return vec2((dx / d) * speed, (dy / d) * speed);
}

// Velocity from a slingshot-style drag: aim along (to − from), magnitude capped
// at `cap`, in whatever space the points are given (the sandbox passes WORLD
// coords). Zero for a zero-length drag. The pure twin of ArrowControl's drag
// math, so the player-aimed "Set" star is unit-tested without the canvas.
export function clampedVelocity(from: P, to: P, cap: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return vec2(0, 0);
  const speed = Math.min(mag, cap);
  return vec2((dx / mag) * speed, (dy / mag) * speed);
}

// A RANDOM star enters on an orbit, not a plunge. The old recipe fired new
// stars within ±30° of the barycenter — near-radial infall through the
// binary's heart, and with contact radii ~40× fatter than real stellar
// scales, 97% of entries merged within a median 1.4s (measured through the
// real integrator): act 2 barely played. Real three-body encounters
// overwhelmingly slingshot and eject instead, because misses dominate. So an
// entry now carries real angular momentum — tangential speed at 0.55–0.85 of
// circular for its reach, a gentle radial infall, a whisper of tilt — which
// drops first-merge odds to roughly a quarter of entries and lets the dance
// live. `rand` is injected so the shape is unit-testable.
export function randomStarEntry(
  comMass: number,
  starMass: number,
  reach: number,
  G: number,
  rand: () => number = Math.random,
): { theta: number; vx: number; vy: number; vz: number } {
  const theta = rand() * Math.PI * 2;
  const vCirc = Math.sqrt((G * (comMass + starMass)) / reach);
  const vt = vCirc * (0.55 + rand() * 0.3) * (rand() < 0.5 ? 1 : -1);
  const vr = -(30 + rand() * 90);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    theta,
    vx: vr * cos - vt * sin,
    vy: vr * sin + vt * cos,
    vz: (rand() - 0.5) * 60,
  };
}

// The auto-orbit seed for a Set PLANET: read the live star field and pick the
// orbit most likely to LAST — the two survivable regimes of real multi-star
// systems. Tap near one star (inside its dominance region) → a circumstellar
// "S-type" orbit: circular speed for that star at that radius, CO-MOVING with
// the star (orbiting a moving sun demands riding along). Tap anywhere else →
// a circumbinary "P-type" orbit around the mass-weighted COM, riding the
// system's drift. Either way the tangent runs PROGRADE with the system's net
// angular momentum — co-rotating orbits survive; retrograde ones get eaten.
// The player can always drag the ghost to override.
export interface OrbitStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
}

export function autoPlanetOrbit(pos: P, stars: OrbitStar[], G: number) {
  if (stars.length === 0) return vec2(0, 0);

  let M = 0;
  let cx = 0, cy = 0, cvx = 0, cvy = 0;
  for (const s of stars) {
    M += s.mass;
    cx += s.mass * s.x;
    cy += s.mass * s.y;
    cvx += s.mass * s.vx;
    cvy += s.mass * s.vy;
  }
  cx /= M; cy /= M; cvx /= M; cvy /= M;

  // Net spin about the COM decides prograde.
  let L = 0;
  for (const s of stars) {
    L += s.mass * ((s.x - cx) * (s.vy - cvy) - (s.y - cy) * (s.vx - cvx));
  }
  const spin = L >= 0 ? 1 : -1;

  const circular = (ox: number, oy: number, m: number, bvx: number, bvy: number) => {
    const dx = pos.x - ox;
    const dy = pos.y - oy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6 || m <= 0) return vec2(bvx, bvy);
    const v = Math.sqrt((G * m) / r);
    return vec2(bvx + (-dy / r) * v * spin, bvy + (dx / r) * v * spin);
  };

  let near = stars[0];
  let dNear = Infinity;
  for (const s of stars) {
    const d = Math.hypot(pos.x - s.x, pos.y - s.y);
    if (d < dNear) {
      dNear = d;
      near = s;
    }
  }
  let dOther = Infinity;
  for (const s of stars) {
    if (s !== near) dOther = Math.min(dOther, Math.hypot(near.x - s.x, near.y - s.y));
  }

  // Inside the star's dominance region (~0.45 of the way to its nearest
  // neighbour — the game-feel end of the Holman–Wiegert stability line).
  if (dNear < 0.45 * dOther) return circular(near.x, near.y, near.mass, near.vx, near.vy);
  return circular(cx, cy, M, cvx, cvy);
}
