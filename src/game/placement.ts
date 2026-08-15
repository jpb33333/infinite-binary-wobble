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
