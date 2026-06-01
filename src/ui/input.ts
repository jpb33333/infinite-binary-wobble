// Convert a browser pointer event into canvas-space (logical) pixel
// coordinates, regardless of CSS scaling or devicePixelRatio.
//
// The Renderer keeps the canvas's internal pixel buffer at
// canvas.width × canvas.height (the "design" resolution — 1280×800), and
// CSS may scale that down on small viewports. We invert the CSS scale here
// so that all downstream code (controls, hit tests, physics) lives in the
// design coordinate system.

export function eventToCanvas(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const xCss = event.clientX - rect.left;
  const yCss = event.clientY - rect.top;
  // CSS size may differ from internal canvas size; map back to design pixels.
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return { x: xCss * sx, y: yCss * sy };
}

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
