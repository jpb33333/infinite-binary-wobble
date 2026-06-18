import { palette, rgba } from '../theme.ts';

// Painterly star. Three layered radial gradients with slightly offset centers
// (asymmetric corona — feels painted rather than photoreal), plus an additive
// outer halo. Drawn at the body's current position; the caller is responsible
// for setting transforms.

export interface StarStyle {
  primary: string;   // base coral / apricot color
  core: string;      // cream-gold center
  haloAlpha: number; // 0..1; lower when "locked" (more subdued)
  haloRadiusFactor: number; // 1.0 = subtle, 3.0 = blooming
}

export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  style: StarStyle,
  jitterPhase: number = 0,
): void {
  // Asymmetric corona: gradient center offset by ~10% of radius in a
  // pseudo-random direction derived from jitterPhase. Cheap and convincing.
  const ox = Math.cos(jitterPhase * 1.3) * radius * 0.08;
  const oy = Math.sin(jitterPhase * 0.9) * radius * 0.08;

  // Outer halo (additive bloom)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const haloR = radius * style.haloRadiusFactor;
  const halo = ctx.createRadialGradient(x + ox, y + oy, radius * 0.5, x, y, haloR);
  halo.addColorStop(0, rgba(style.primary, style.haloAlpha * 0.7));
  halo.addColorStop(0.45, rgba(style.primary, style.haloAlpha * 0.25));
  halo.addColorStop(1, rgba(style.primary, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Body — soft outer disk
  const outer = ctx.createRadialGradient(x + ox, y + oy, 1, x, y, radius);
  outer.addColorStop(0, rgba(style.core, 1));
  outer.addColorStop(0.35, rgba(style.primary, 0.95));
  outer.addColorStop(0.85, rgba(style.primary, 0.55));
  outer.addColorStop(1, rgba(style.primary, 0));
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Hot core
  const core = ctx.createRadialGradient(x + ox * 0.6, y + oy * 0.6, 0, x, y, radius * 0.4);
  core.addColorStop(0, rgba(style.core, 0.95));
  core.addColorStop(1, rgba(style.core, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

export const STYLE_P1: StarStyle = {
  primary: palette.player1,
  core: palette.cream,
  haloAlpha: 0.9,
  haloRadiusFactor: 2.6,
};

export const STYLE_P2: StarStyle = {
  primary: palette.player2,
  core: palette.cream,
  haloAlpha: 0.9,
  haloRadiusFactor: 2.6,
};

// The intruding third star in the post-win three-body unravel. Bright danger
// red so it reads as the threat that breaks the binary — the one deliberate
// hot note in the warm field.
export const STYLE_P3: StarStyle = {
  primary: palette.danger,
  core: palette.cream,
  haloAlpha: 0.95,
  haloRadiusFactor: 2.8,
};

// A dimmed variant used to show the OTHER player's star while one player is
// in setup — they need to see it but it shouldn't compete for attention.
export function dimmed(style: StarStyle): StarStyle {
  return {
    ...style,
    haloAlpha: 0.35,
    haloRadiusFactor: 1.7,
  };
}
