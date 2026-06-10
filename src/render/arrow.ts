import { palette, fonts, rgba } from '../theme.ts';

// Draws the velocity arrow from a star's center to the tip of its velocity
// vector. Includes a small head and a tooltip showing the magnitude.

export function drawVelocityArrow(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  vel: { x: number; y: number },
  color: string, // HEX (e.g. "#E8956F") — never an rgba() string; `rgba()` below assumes hex
  showTooltip: boolean = true,
  alpha: number = 1.0, // scale every internal alpha; lets callers dim a locked-in arrow
): void {
  const mag = Math.hypot(vel.x, vel.y);
  if (mag < 0.5) return; // don't draw a degenerate arrow

  // Scale: arrow length in pixels equals velocity magnitude in px/s.
  // (Since the canvas is in px and the simulation is in px/s, a vector of
  // 100 px/s draws as 100 px — players can intuit length = speed.)
  const tipX = origin.x + vel.x;
  const tipY = origin.y + vel.y;

  ctx.save();
  ctx.strokeStyle = rgba(color, 0.85 * alpha);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Arrowhead — two strokes forming a chevron
  const angle = Math.atan2(vel.y, vel.x);
  const headLen = 14;
  const headAngle = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - Math.cos(angle - headAngle) * headLen,
    tipY - Math.sin(angle - headAngle) * headLen,
  );
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - Math.cos(angle + headAngle) * headLen,
    tipY - Math.sin(angle + headAngle) * headLen,
  );
  ctx.stroke();

  // Glow at the tip — pulls the eye to the drag handle
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 18);
  glow.addColorStop(0, rgba(color, 0.6 * alpha));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (showTooltip) {
    drawVelocityTooltip(ctx, mag, tipX, tipY, color);
  }
}

function drawVelocityTooltip(
  ctx: CanvasRenderingContext2D,
  speed: number,
  anchorX: number,
  anchorY: number,
  color: string,
): void {
  const text = `${speed.toFixed(0)} px/s`;
  ctx.save();
  ctx.font = `500 12px ${fonts.sans}`;
  ctx.textBaseline = 'middle';
  const padX = 8;
  const m = ctx.measureText(text);
  const w = m.width + padX * 2;
  const h = 22;
  const x = anchorX - w / 2;
  const y = anchorY + 16;

  ctx.fillStyle = rgba(palette.voidDeep, 0.78);
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const r = 5;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.cream;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}
