// Uniform "contain" fit. The game renders in a fixed design space
// (1280×800) so the tuned, pixel-based physics never change with screen
// size. This maps that design space into an arbitrary viewport without
// distortion: the smaller of the two axis ratios wins so the whole court is
// always visible, and the leftover space becomes symmetric letterbox margins.
export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function computeFit(
  cssW: number,
  cssH: number,
  designW: number,
  designH: number,
): Fit {
  const scale = Math.min(cssW / designW, cssH / designH);
  return {
    scale,
    offsetX: (cssW - designW * scale) / 2,
    offsetY: (cssH - designH * scale) / 2,
  };
}
