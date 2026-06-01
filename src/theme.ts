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
} as const;

export const fonts = {
  // Humanist serif for wordmark, headings, victory cards
  serif: '"Cardo", Georgia, "Times New Roman", serif',
  // Humanist sans for UI labels, tooltips, m/s readout
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

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
