import { palette, fonts, rgba } from '../theme.ts';
import type { Outcome } from '../game/outcomes.ts';
import type { StatsSummary } from '../game/stats.ts';

// HUD and overlay drawing primitives. Buttons are drawn on the canvas and
// their click-hit-areas are returned so the Game can route mouse events.

export interface CanvasButton {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function drawWordmark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = palette.cream;
  ctx.font = `400 76px ${fonts.serif}`;
  ctx.fillText('Infinite Binary Wobble', w / 2, h * 0.38);

  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 24px ${fonts.serif}`;
  ctx.fillText('a game for two who are considering', w / 2, h * 0.38 + 64);

  ctx.restore();
}

// Title-screen scoreboard. One line of totals, an optional second line of
// best-WIN superlatives. Renders nothing when no games have been played yet —
// an empty deck shouldn't crowd the title.
export function drawSessionStats(
  ctx: CanvasRenderingContext2D,
  s: StatsSummary,
  w: number,
  h: number,
): void {
  if (s.total === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const winRatePct = Math.round(s.winRate * 100);
  const head =
    `${s.total} ${plural(s.total, 'play', 'plays')} this session  ·  ` +
    `${s.wins} ${plural(s.wins, 'wobble', 'wobbles')}  ·  ` +
    `${winRatePct}% wobble rate`;

  ctx.fillStyle = rgba(palette.cream, 0.55);
  ctx.font = `500 12px ${fonts.sans}`;
  // Sit between the subtitle (h*0.38 + 64) and the BEGIN button (h*0.62).
  const headY = h * 0.51;
  ctx.fillText(head, w / 2, headY);

  // Second line: bests, only when we have any WIN to brag about.
  const parts: string[] = [];
  if (s.byOutcome.lose_escape || s.byOutcome.lose_slingshot) {
    parts.push(
      `${s.byOutcome.lose_escape + s.byOutcome.lose_slingshot} drifted`,
    );
  }
  if (s.byOutcome.lose_collision) {
    parts.push(`${s.byOutcome.lose_collision} collided`);
  }
  if (s.best.mostOrbits !== null && s.best.mostOrbits > 0) {
    parts.push(`best wobble ${s.best.mostOrbits} orbits`);
  }
  if (parts.length > 0) {
    ctx.fillStyle = rgba(palette.rose, 0.55);
    ctx.font = `italic 400 13px ${fonts.serif}`;
    ctx.fillText(parts.join('  ·  '), w / 2, headY + 22);
  }
  ctx.restore();
}

export function drawPhaseLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  highlightColor: string = palette.rose,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(palette.cream, 0.5);
  ctx.font = `500 11px ${fonts.sans}`;
  ctx.fillText('— phase —', w / 2, 36);
  ctx.fillStyle = highlightColor;
  ctx.font = `400 22px ${fonts.serif}`;
  ctx.fillText(text, w / 2, 64);
  ctx.restore();
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fields: { label: string; value: string; color: string }[],
): void {
  ctx.save();
  const padX = 36;
  const baseY = h - 28;
  ctx.font = `500 11px ${fonts.sans}`;
  ctx.textBaseline = 'alphabetic';
  let x = padX;
  for (const f of fields) {
    ctx.fillStyle = rgba(palette.cream, 0.55);
    ctx.textAlign = 'left';
    ctx.fillText(f.label.toUpperCase(), x, baseY - 16);
    ctx.fillStyle = f.color;
    ctx.font = `400 18px ${fonts.serif}`;
    ctx.fillText(f.value, x, baseY);
    ctx.font = `500 11px ${fonts.sans}`;
    const valWidth = ctx.measureText(f.value).width;
    x += Math.max(140, valWidth + 60);
    if (x > w - padX - 100) break;
  }
  ctx.restore();
}

export function drawButton(
  ctx: CanvasRenderingContext2D,
  btn: CanvasButton,
  opts: {
    primary?: string;
    text?: string;
    hovered?: boolean;
  } = {},
): void {
  const primary = opts.primary ?? palette.rose;
  const text = opts.text ?? palette.voidDeep;
  const hovered = opts.hovered ?? false;

  ctx.save();
  // Soft halo (additive). The fill area must fully contain the gradient
  // circle (radius haloR around the button center), otherwise wide-but-short
  // buttons get their glow clipped into a visible rectangle. A 2·haloR square
  // centered on the button is the smallest rect that always contains it.
  ctx.globalCompositeOperation = 'lighter';
  const haloR = Math.max(btn.width, btn.height) * (hovered ? 1.2 : 0.9);
  const cx = btn.x + btn.width / 2;
  const cy = btn.y + btn.height / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  g.addColorStop(0, rgba(primary, hovered ? 0.35 : 0.18));
  g.addColorStop(1, rgba(primary, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);
  ctx.restore();

  // Pill body
  ctx.save();
  const r = btn.height / 2;
  ctx.beginPath();
  roundedRectPath(ctx, btn.x, btn.y, btn.width, btn.height, r);
  ctx.fillStyle = rgba(primary, hovered ? 0.92 : 0.75);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.cream, 0.35);
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 14px ${fonts.sans}`;
  const letterSpacing = 1.2;
  drawSpacedText(ctx, btn.label.toUpperCase(), btn.x + btn.width / 2, btn.y + btn.height / 2 + 1, letterSpacing);
  ctx.restore();
}

export function hitTest(btn: CanvasButton, x: number, y: number): boolean {
  return x >= btn.x && x <= btn.x + btn.width && y >= btn.y && y <= btn.y + btn.height;
}

export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  anchorY: number,
  color: string = palette.cream,
  placement: 'above' | 'below' = 'above',
): void {
  ctx.save();
  ctx.font = `500 13px ${fonts.sans}`;
  ctx.textBaseline = 'middle';
  const padX = 10;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padX * 2;
  const h = 24;
  const x = anchorX - w / 2;
  // anchorY for placement='above' = the point ABOVE which the tooltip sits.
  // anchorY for placement='below' = the point BELOW which it sits.
  // Callers pick the placement based on whether the anchor is near the top
  // edge of the canvas (where the help text lives). Found by /qa round 2.
  const y = placement === 'above' ? anchorY - h - 8 : anchorY + 8;
  ctx.fillStyle = rgba(palette.voidDeep, 0.78);
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedRectPath(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, anchorX, y + h / 2 + 0.5);
  ctx.restore();
}

export function drawOutcomeCard(
  ctx: CanvasRenderingContext2D,
  outcome: Outcome,
  w: number,
  h: number,
  statsLine: string | null = null,
): { titleColor: string; titleText: string; bodyText: string; buttonY: number; carseY: number } {
  const card = outcomeText(outcome);
  const isWin = outcome.kind === 'win';

  // For WIN the orbit itself is the experience — don't dim the canvas and
  // anchor the card at the bottom so the wobble stays the focus.
  // For LOSE the sim is frozen, so a centered, more emphatic card reads better.
  if (!isWin) {
    ctx.save();
    ctx.fillStyle = rgba(palette.voidDeep, 0.55);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Cards include title + body + (optional) per-play stats + button + Carse
  // footer (3 italic lines) inside their bounds. Stats line adds ~28px when
  // present so the breathing room around it doesn't collapse.
  const statsExtra = statsLine ? 28 : 0;
  const cardW = isWin ? 600 : 660;
  const cardH = (isWin ? 232 : 308) + statsExtra;
  const cx = (w - cardW) / 2;
  // WIN card is bottom-anchored; the bottom 56px belong to the HUD strip
  // (label baseline at h−44, value baseline at h−28, ascenders to ~h−53).
  // Margin must clear that band with breathing room or the card's translucent
  // fill bleeds over the labels.
  const cy = isWin ? h - cardH - 72 : (h - cardH) / 2;

  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, cx, cy, cardW, cardH, 18);
  ctx.fillStyle = rgba(palette.voidDeep, isWin ? 0.78 : 0.92);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(card.titleColor, isWin ? 0.45 : 0.6);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = card.titleColor;
  ctx.font = `400 ${isWin ? 30 : 44}px ${fonts.serif}`;
  ctx.fillText(card.titleText, w / 2, cy + (isWin ? 40 : 76));

  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${isWin ? 16 : 19}px ${fonts.serif}`;
  ctx.fillText(card.bodyText, w / 2, cy + (isWin ? 72 : 122));

  if (statsLine) {
    // Sit between the body line and the AGAIN button. Subtle — it's a
    // reading-of-the-moment, not a competition with the title.
    ctx.fillStyle = rgba(palette.cream, 0.55);
    ctx.font = `500 12px ${fonts.sans}`;
    ctx.fillText(statsLine, w / 2, cy + (isWin ? 100 : 152));
  }
  ctx.restore();

  const buttonY = (isWin ? cy + 96 : cy + 156) + statsExtra;
  // Carse footer goes below the button, still inside the card.
  const carseY = buttonY + 44 + 8; // button height + small gap
  return { ...card, buttonY, carseY };
}

function outcomeText(outcome: Outcome): {
  titleColor: string;
  titleText: string;
  bodyText: string;
} {
  switch (outcome.kind) {
    case 'win':
      return {
        titleColor: palette.cream,
        titleText: 'An Infinite Binary Wobble.',
        bodyText: 'Stay and watch as long as you like.',
      };
    case 'lose_escape':
      return {
        titleColor: palette.player1,
        titleText: 'Lost to the void.',
        bodyText: 'You can’t lose each other.',
      };
    case 'lose_slingshot':
      return {
        titleColor: palette.player2,
        titleText: 'A long arc home.',
        bodyText: 'You can’t lose each other.',
      };
    case 'lose_collision':
      return {
        titleColor: palette.wine,
        titleText: 'Touched, and undone.',
        bodyText: 'You can’t lose yourself.',
      };
    default:
      return { titleColor: palette.cream, titleText: '', bodyText: '' };
  }
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  const chars = [...text];
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.textAlign = 'left';
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + spacing;
  }
}
