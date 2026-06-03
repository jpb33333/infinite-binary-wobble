// Screen → design-space coordinate mapping lives on the Renderer
// (`screenToLogical`), since it owns the contain-fit transform that the
// inverse depends on. This module keeps the geometry helpers shared by the
// hit tests.

// True if a point lies within the given rectangle.
export function inRect(
  p: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

// Squared distance — for hit tests where the actual distance isn't needed
// (cheaper than Math.sqrt on every move event).
export function distSq(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
