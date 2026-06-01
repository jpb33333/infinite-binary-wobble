import type { CourtLayout, PlayerId } from '../game/states.ts';
import { palette, rgba } from '../theme.ts';

// Draws the "Celestial Court" — the divided playfield with each player's
// in-bounds square. Active player's region gets a soft warm fill; the other
// stays neutral.

export interface CourtDrawOptions {
  activePlayer?: PlayerId; // highlights this side
  showInBoundsBoxes: boolean; // dotted starting-region outlines
  showCenterLine: boolean;
}

export function drawCourt(
  ctx: CanvasRenderingContext2D,
  layout: CourtLayout,
  opts: CourtDrawOptions,
): void {
  // Soft ambient wash on the active side
  if (opts.activePlayer === 1) {
    const grad = ctx.createLinearGradient(0, 0, layout.centerLineX, 0);
    grad.addColorStop(0, rgba(palette.player1, 0.07));
    grad.addColorStop(1, rgba(palette.player1, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, layout.centerLineX, layout.canvas.height);
  } else if (opts.activePlayer === 2) {
    const grad = ctx.createLinearGradient(layout.centerLineX, 0, layout.canvas.width, 0);
    grad.addColorStop(0, rgba(palette.player2, 0));
    grad.addColorStop(1, rgba(palette.player2, 0.07));
    ctx.fillStyle = grad;
    ctx.fillRect(layout.centerLineX, 0, layout.canvas.width - layout.centerLineX, layout.canvas.height);
  }

  // Glowing center "service line"
  if (opts.showCenterLine) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createLinearGradient(layout.centerLineX, 0, layout.centerLineX, layout.canvas.height);
    grad.addColorStop(0, rgba(palette.terracotta, 0));
    grad.addColorStop(0.5, rgba(palette.terracotta, 0.35));
    grad.addColorStop(1, rgba(palette.terracotta, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(layout.centerLineX, 0);
    ctx.lineTo(layout.centerLineX, layout.canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  if (opts.showInBoundsBoxes) {
    drawInBounds(ctx, layout.p1InBounds, palette.player1, opts.activePlayer === 1);
    drawInBounds(ctx, layout.p2InBounds, palette.player2, opts.activePlayer === 2);
  }
}

function drawInBounds(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  color: string,
  active: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = rgba(active ? color : palette.terracotta, active ? 0.55 : 0.25);
  ctx.lineWidth = active ? 1.4 : 1;
  ctx.setLineDash([6, 8]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
  ctx.restore();
}

// Clamp a point to the in-bounds rectangle for the given player. Used by
// PositionControl to keep the star inside the court during setup.
export function clampToInBounds(
  p: { x: number; y: number },
  layout: CourtLayout,
  player: PlayerId,
  pad: number = 24, // keep the star fully inside, not on the line
): { x: number; y: number } {
  const r = player === 1 ? layout.p1InBounds : layout.p2InBounds;
  return {
    x: Math.min(Math.max(p.x, r.x + pad), r.x + r.width - pad),
    y: Math.min(Math.max(p.y, r.y + pad), r.y + r.height - pad),
  };
}
