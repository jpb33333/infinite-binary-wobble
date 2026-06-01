// Convert a browser pointer event into canvas-space (logical) pixel
// coordinates, regardless of CSS scaling or devicePixelRatio.
//
// `event.clientX` and `rect.left` are both viewport-relative, so their
// difference is already CSS-pixel-relative-to-canvas; no scroll-offset math
// is needed. We map CSS pixels → logical canvas pixels by dividing CSS pixels
// over the bounding-rect size. We do NOT use `canvas.width` here because the
// internal buffer is now DPR-scaled (e.g. 2560 for a 1280 logical width on
// retina) and would over-scale events by `devicePixelRatio`.

export function eventToCanvas(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const xCss = event.clientX - rect.left;
  const yCss = event.clientY - rect.top;
  const sx = logicalWidth / rect.width;
  const sy = logicalHeight / rect.height;
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
