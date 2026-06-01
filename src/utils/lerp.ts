export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// "Smooth-step" easing, useful for fades and pulses without an animation lib.
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
