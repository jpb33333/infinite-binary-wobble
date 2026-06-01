import { palette, rgba } from '../theme.ts';

// A sparse, slow-twinkling backdrop in the warm palette. No blues, no greens.
// Deterministic seed so the same field paints every frame after init (and
// returns the same layout on reload — feels less random, more like a place).

export interface StarSpec {
  x: number;
  y: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  warmth: number; // 0 = cream, 1 = rose
}

// Mulberry32 — small, deterministic PRNG. Lets us reproduce the same field
// every reload, which makes the void feel like a real place.
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

export function generateStarfield(
  width: number,
  height: number,
  count: number = 140,
  seed: number = 0xb1bb1e,
): StarSpec[] {
  const rng = makeRng(seed);
  const stars: StarSpec[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng() * width,
      y: rng() * height,
      baseAlpha: 0.15 + rng() * 0.45,
      twinkleSpeed: 0.3 + rng() * 0.8, // radians/second
      twinklePhase: rng() * Math.PI * 2,
      warmth: rng(),
    });
  }
  return stars;
}

export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: readonly StarSpec[],
  time: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    const twinkle = 0.6 + 0.4 * Math.sin(s.twinklePhase + time * s.twinkleSpeed);
    const a = s.baseAlpha * twinkle;
    const color = s.warmth < 0.5 ? palette.cream : palette.rose;
    ctx.fillStyle = rgba(color, a);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.7 + 0.6 * twinkle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
