// Act III broadcast pings — expanding wavefronts from the system's on-screen
// centre that draw its INSTANTANEOUS emission into the dark. The visibility
// meter shows the slow, smoothed value the forest has accumulated; these rings
// show what you are emitting RIGHT NOW — the quantity GO DARK cuts to the damp
// floor at once. The gap between "my pings just died" and "the bar is still
// high" is the running-dark mechanic, made visible.
//
// Same discipline as comet.ts: a pure function of time. Rings emit on a fixed
// clock phase-locked to `time`, so the layer needs no per-frame state, renders
// identically for identical inputs, and is trivially testable. Loudness lives
// in the rings' brightness (sampled at draw), not their cadence — so a system
// falling silent visibly swallows even the rings already in flight.

export const PING_INTERVAL = 1.7; // seconds between wavefronts
export const PING_SPEED = 240; // design px/s a wavefront expands at

export interface PingRing {
  r: number; // current radius, design px
  alpha: number; // 0..~0.55 — emission × radial fade
}

// The one number that scales BOTH the rings' brightness and the sonar pulse's
// volume (audio/sfx.ts): the instantaneous emission plus the supernova leak.
// Sight and sound sharing this formula is what keeps them honest together.
export function pingStrength(emission: number, flare: number): number {
  return Math.min(1, Math.max(0, emission) + Math.max(0, flare) * 0.8);
}

// All wavefronts alive at `time`, innermost first. `emission` is the system's
// current post-damp broadcast (DarkForest.lastEmission); `flare` (0..1) leaks
// through even while dark, so a supernova's pulse is always visible.
export function activePings(
  time: number,
  emission: number,
  flare: number,
  maxR: number,
): PingRing[] {
  if (!(time >= 0) || !(maxR > 0)) return []; // guards negatives + NaN
  const strength = pingStrength(emission, flare);
  if (strength <= 0.02) return [];
  const life = maxR / PING_SPEED;
  const rings: PingRing[] = [];
  for (let idx = Math.floor(time / PING_INTERVAL); idx >= 0; idx--) {
    const age = time - idx * PING_INTERVAL;
    if (age > life) break; // older ticks are further out still — all dead
    const r = age * PING_SPEED;
    const fade = 1 - r / maxR;
    rings.push({ r, alpha: strength * fade * fade * 0.55 });
  }
  return rings;
}

// How brightly a hidden system at `dist` from the centre catches the passing
// wavefronts — a gaussian bump as each ring front crosses it. Feeds the
// hunters' glint so the causality (your signal reaches them, they stir) reads
// on screen. Clamped to 1.
export function pingGlint(rings: readonly PingRing[], dist: number): number {
  let g = 0;
  for (const ring of rings) {
    const d = (ring.r - dist) / 46;
    g += ring.alpha * Math.exp(-d * d);
  }
  return Math.min(1, g);
}
