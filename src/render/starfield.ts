import { palette, rgba } from '../theme.ts';

// A sparse, slow-twinkling backdrop in the warm palette. No blues, no greens.
// Deterministic seed so the same field paints every frame after init (and
// returns the same layout on reload — feels less random, more like a place).
//
// Positions are stored NORMALIZED in [0, 1] and multiplied by the live
// viewport at draw time, so the field fills the whole screen (full-bleed) and
// reflows smoothly on resize instead of jumping. Because the RNG is
// deterministic and stars are generated in a fixed order, growing the count
// (a bigger window wants more stars to hold density) only appends to the tail
// — every existing star keeps its position, alpha, and twinkle.

export interface StarSpec {
  x: number; // normalized [0, 1]
  y: number; // normalized [0, 1]
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  warmth: number; // 0 = cream, 1 = rose
}

// Stars per CSS pixel². Tuned from the original 140 stars over the 1280×800
// design court (140 / 1_024_000), so in-court density is unchanged while the
// field now extends to fill any viewport.
export const STAR_DENSITY = 140 / (1280 * 800);

// How many stars to paint for a viewport of the given CSS size, holding
// density constant. Capped so a huge monitor can't spawn an absurd field.
export function starCountForViewport(cssW: number, cssH: number): number {
  return Math.min(600, Math.max(60, Math.round(STAR_DENSITY * cssW * cssH)));
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
  count: number = 140,
  seed: number = 0xb1bb1e,
): StarSpec[] {
  const rng = makeRng(seed);
  const stars: StarSpec[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng(), // normalized [0, 1]
      y: rng(), // normalized [0, 1]
      baseAlpha: 0.15 + rng() * 0.45,
      twinkleSpeed: 0.3 + rng() * 0.8, // radians/second
      twinklePhase: rng() * Math.PI * 2,
      warmth: rng(),
    });
  }
  return stars;
}

// Draw the field scaled to fill (width × height) CSS pixels. The caller sets a
// screen-space transform (DPR only) so stars cover the entire buffer, margins
// included. Star radius is in CSS px — constant size regardless of window, as
// a backdrop should be.
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  stars: readonly StarSpec[],
  time: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    const twinkle = 0.6 + 0.4 * Math.sin(s.twinklePhase + time * s.twinkleSpeed);
    const a = s.baseAlpha * twinkle;
    const color = s.warmth < 0.5 ? palette.cream : palette.rose;
    ctx.fillStyle = rgba(color, a);
    ctx.beginPath();
    ctx.arc(s.x * width, s.y * height, 0.7 + 0.6 * twinkle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
