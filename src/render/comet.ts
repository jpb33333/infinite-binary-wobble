import { palette, rgba } from '../theme.ts';

// An occasional comet drifting across the deep background — a faint warm streak,
// far away, that crosses the sky every PERIOD seconds and is gone for the rest.
// It lives in the same screen-space, 'lighter'-blended atmosphere layer as the
// starfield, so it shows on the title screen AND in-game. The caller gates it
// on reduced motion (like the ambient drift and the twinkle phase).
//
// Deterministic: the comet for each period is seeded by its index, so its entry
// edge, height, angle and speed vary but reproduce exactly on reload — the void
// stays a "place," not a slot machine. Position is a pure function of time, so
// it needs no per-frame state and is trivially testable.

const PERIOD = 24; // seconds between comet appearances
const TRANSIT = 3.2; // seconds a comet takes to cross the sky
const TAIL_FRAC = 0.16; // tail length as a fraction of the viewport diagonal
const TAIL_MAX = 220; // ...capped so it stays "distant" on huge monitors

export interface CometState {
  x: number; // head position, CSS px
  y: number;
  angle: number; // direction of travel, radians
  alpha: number; // 0 at the edges of the transit, 1 mid-sky
}

// Mulberry32 — the same small deterministic PRNG the starfield uses. Seeded per
// comet index so each appearance is varied but reproducible.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The comet's current position, or null when the sky is empty (which is most of
// every period). Pure — same (time, width, height) always yields the same state.
export function activeComet(
  time: number,
  width: number,
  height: number,
): CometState | null {
  if (!(time >= 0)) return null; // guards negatives + NaN
  const idx = Math.floor(time / PERIOD);
  const local = time - idx * PERIOD; // [0, PERIOD)
  if (local >= TRANSIT) return null; // empty sky the rest of the period
  const p = local / TRANSIT; // transit progress [0, 1)

  const rng = makeRng((idx + 1) * 0x9e3779b1);
  const fromLeft = rng() < 0.5;
  const y0 = (0.08 + rng() * 0.42) * height; // start in the upper sky band
  const drop = (0.06 + rng() * 0.18) * height; // gentle downward drift
  const margin = 0.16 * width; // start/end off-screen so it enters cleanly
  const x0 = fromLeft ? -margin : width + margin;
  const x1 = fromLeft ? width + margin : -margin;

  const x = x0 + (x1 - x0) * p;
  const y = y0 + drop * p;
  const angle = Math.atan2(drop, x1 - x0);
  const alpha = Math.sin(p * Math.PI); // fade in at entry, out at exit

  return { x, y, angle, alpha };
}

// Paint the current comet (head glow + tapering tail) in screen space. No-op
// when the sky is empty. Caller must have set the DPR-only transform and should
// skip this entirely under reduced motion.
export function drawComet(
  ctx: CanvasRenderingContext2D,
  time: number,
  width: number,
  height: number,
): void {
  const c = activeComet(time, width, height);
  if (!c || c.alpha <= 0.01) return;

  const tail = Math.min(TAIL_FRAC * Math.hypot(width, height), TAIL_MAX);
  const tx = c.x - Math.cos(c.angle) * tail;
  const ty = c.y - Math.sin(c.angle) * tail;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Tail: bright at the head, fading to nothing — cream into rose into void.
  const trail = ctx.createLinearGradient(c.x, c.y, tx, ty);
  trail.addColorStop(0, rgba(palette.cream, 0.5 * c.alpha));
  trail.addColorStop(0.35, rgba(palette.rose, 0.16 * c.alpha));
  trail.addColorStop(1, rgba(palette.rose, 0));
  ctx.strokeStyle = trail;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Head: a small soft glow, distant and subtle.
  const hr = 3;
  const head = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, hr * 3);
  head.addColorStop(0, rgba(palette.cream, 0.7 * c.alpha));
  head.addColorStop(1, rgba(palette.cream, 0));
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(c.x, c.y, hr * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
