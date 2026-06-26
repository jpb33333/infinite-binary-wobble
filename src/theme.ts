// Palette derived from research on Spike Jonze's "Her" (production design by
// K.K. Barrett, cinematography by Hoyte van Hoytema) and adapted for a 2-player
// binary-star game. Warm tones throughout; no blues, no greens, no neon.
//
// Source: docs/research/her-aesthetic.md (research report, 2026-06-01).

export const palette = {
  voidDeep: '#1A0F14', // background — deep wine-black, never pure black
  player1: '#E8956F', // warm peach-coral
  player2: '#D97D3D', // burnt apricot-rust
  rose: '#F4A58D', // UI text, soft halos
  cream: '#FFC89B', // highlights, star cores
  terracotta: '#A3685C', // court lines, secondary UI, orbital trails
  wine: '#6F1D1B', // accent shadows, "unbound" warning text
  // Bright warning red for the one peril affordance — the "Add 3rd Body"
  // button + the intruding third star in the post-win three-body unravel. A
  // deliberate hot break from the warm palette: it MUST read as danger.
  danger: '#E5392F',
  // The pale blue dot — a world, a deliberate cool note among the warm suns.
  // Muted so it reads as a small distant world, not neon.
  world: '#7FB0C9',
} as const;

export const fonts = {
  // Humanist serif for wordmark, headings, victory cards
  serif: '"Cardo", Georgia, "Times New Roman", serif',
  // Humanist sans for UI labels, tooltips, px/s readout
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

// ─── Legibility floor for contain-fit canvas text ──────────────────────────
//
// The game draws in a fixed design space (1280×800 / 800×1280) that the
// Renderer maps into the viewport with a uniform contain-fit. A phone held in
// portrait renders the 800×1280 space at ~0.49×, so a 12px design font lands
// at ~5.9 CSS px on screen — far below the ~11px readability floor. (Found on
// the iOS port first; the web has identical fit math.)
//
// `cpx` pulls any design size that would render below the floor up toward it,
// compressing the sub-floor range (slope) so the size hierarchy is preserved,
// never inverted. Text already at/above the floor — all display type, and any
// near-1× desktop fit — is returned unchanged. The Renderer calls
// `setViewScale(fit.scale)` once per frame before any drawing or measuring.
let viewScale = 1;
const FLOOR_PX = 11; // on-screen CSS px (Apple HIG-ish minimum)
const SLOPE = 0.2; // fraction of the sub-floor deficit that survives

export function setViewScale(scale: number): void {
  viewScale = scale > 0 ? scale : 1;
}

// Design-space px to draw at so the glyph clears the on-screen floor. Identity
// at/above the floor — continuous at the boundary, monotonic in designSize.
export function cpx(designSize: number): number {
  const onScreen = designSize * viewScale;
  if (onScreen >= FLOOR_PX) return designSize;
  return (FLOOR_PX - (FLOOR_PX - onScreen) * SLOPE) / viewScale;
}

// Line advance for compensated text — call sites hardcode design-px line
// heights tuned for the UNcompensated sizes; this keeps stacked/wrapped text
// from overlapping once it grows. 1.35 matches the iOS port.
export function lineHeightFor(designSize: number): number {
  return cpx(designSize) * 1.35;
}

export type Palette = typeof palette;
export type PaletteKey = keyof Palette;

// Convert a hex color to an rgba string with the given alpha. Used everywhere
// we need a translucent version of a palette color (glows, trails, overlays).
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Linear-blend two hex colors in sRGB. t=0 returns a, t=1 returns b.
// Used by the Doppler tint code so a star's primary color shifts toward
// cream (approaching the observer) or wine (receding) without leaving
// the palette.
export function blendHex(a: string, b: string, t: number): string {
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const k = clamp01(t);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`.toUpperCase();
}
