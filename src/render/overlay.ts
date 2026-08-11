import { palette, fonts, rgba, blendHex, cpx, lineHeightFor } from '../theme.ts';
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

  // Shrink-to-fit: 76px is the landscape size; in the narrower portrait
  // design space the full wordmark must still clear the side margins.
  let titleSize = 76;
  ctx.font = `400 ${titleSize}px ${fonts.serif}`;
  const maxW = w - 80;
  const measured = ctx.measureText('Infinite Binary Wobble').width;
  if (measured > maxW) {
    titleSize = Math.floor((titleSize * maxW) / measured);
    ctx.font = `400 ${titleSize}px ${fonts.serif}`;
  }
  ctx.fillStyle = palette.cream;
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
  ctx.font = `500 ${cpx(12)}px ${fonts.sans}`;
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
    ctx.font = `italic 400 ${cpx(13)}px ${fonts.serif}`;
    ctx.fillText(parts.join('  ·  '), w / 2, headY + 22);
  }
  ctx.restore();
}

// The centred phase block: an act-title eyebrow over the live serif reading.
// The eyebrow replaced the old "— phase —" filler with the act name — act 1
// carries only the game's title so the existence of act 2 stays a surprise
// (see ACT_EYEBROWS in cornerControls.ts).
export function drawPhaseLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  highlightColor: string = palette.rose,
  eyebrow: string = 'INFINITE BINARY WOBBLE',
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(palette.cream, 0.5);
  ctx.font = `500 ${cpx(11)}px ${fonts.sans}`;
  ctx.fillText(eyebrow, w / 2, 36);
  ctx.fillStyle = highlightColor;
  ctx.font = `400 ${cpx(22)}px ${fonts.serif}`;
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
  // Label sits one compensated value-line above the value. The original fixed
  // 16px gap was tuned for an uncompensated 18px value; the legibility floor
  // makes that value taller in portrait, so the label would overprint it.
  const labelGap = lineHeightFor(18);
  ctx.textBaseline = 'alphabetic';
  let x = padX;
  for (const f of fields) {
    ctx.fillStyle = rgba(palette.cream, 0.55);
    ctx.textAlign = 'left';
    ctx.font = `500 ${cpx(11)}px ${fonts.sans}`;
    const labelWidth = ctx.measureText(f.label.toUpperCase()).width;
    ctx.fillText(f.label.toUpperCase(), x, baseY - labelGap);
    ctx.fillStyle = f.color;
    ctx.font = `400 ${cpx(18)}px ${fonts.serif}`;
    // Measure in the VALUE font, before drawing advances the column — the old
    // code switched back to the label font first and advanced on that width,
    // so compensated labels overprinted their neighbours on phone fits.
    const valWidth = ctx.measureText(f.value).width;
    ctx.fillText(f.value, x, baseY);
    x += hudColumnAdvance(labelWidth, valWidth);
    if (x > w - padX - 100) break;
  }
  ctx.restore();
}

// Column advance for the metrics HUD: the legacy 140px grid, widened only when
// a compensated label or value actually needs the room. At scale 1 every
// current field fits under the floor, so desktop columns land exactly where
// they always did.
export function hudColumnAdvance(labelWidth: number, valueWidth: number): number {
  return Math.max(140, Math.ceil(labelWidth) + 28, Math.ceil(valueWidth) + 24);
}

export function drawButton(
  ctx: CanvasRenderingContext2D,
  btn: CanvasButton,
  opts: {
    primary?: string;
    text?: string;
    hovered?: boolean;
    // A dead control (e.g. the spawners while running dark): no halo, pill and
    // label ghosted, hover ignored. The caller also ignores its taps.
    disabled?: boolean;
  } = {},
): void {
  const primary = opts.primary ?? palette.rose;
  const text = opts.text ?? palette.voidDeep;
  const hovered = (opts.hovered ?? false) && !opts.disabled;

  ctx.save();
  if (opts.disabled) ctx.globalAlpha = 0.35;
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
  if (opts.disabled) ctx.globalAlpha = 0.35;
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
  ctx.font = buttonLabelFont();
  drawSpacedText(ctx, btn.label.toUpperCase(), btn.x + btn.width / 2, btn.y + btn.height / 2 + 1, BUTTON_LABEL_SPACING);
  ctx.restore();
}

// The label style drawButton renders with, shared with the measurer below so
// pills sized to their text can never disagree with the drawn glyphs.
const BUTTON_LABEL_SPACING = 1.2;
function buttonLabelFont(): string {
  return `600 ${cpx(14)}px ${fonts.sans}`;
}

// Width of a pill label exactly as drawButton draws it: uppercased, in the
// compensated label font, advanced per-char with letterspacing (mirroring
// drawSpacedText — canvas measureText of the whole string would add kerning
// the spaced draw doesn't have). Used to size act-2 pills to their text.
export function measureButtonLabel(ctx: CanvasRenderingContext2D, label: string): number {
  ctx.save();
  ctx.font = buttonLabelFont();
  const chars = [...label.toUpperCase()];
  const total =
    chars.reduce((sum, c) => sum + ctx.measureText(c).width, 0) +
    BUTTON_LABEL_SPACING * (chars.length - 1);
  ctx.restore();
  return total;
}

// A small circular ✕ button — used to dismiss the WIN card so the wobble can
// be watched unobstructed. Drawn as a translucent disc with an accent-tinted
// glyph; the caller owns the (larger, finger-friendly) hit rectangle.
export function drawCloseButton(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  hovered: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(palette.voidDeep, hovered ? 0.9 : 0.55);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(color, hovered ? 0.9 : 0.5);
  ctx.stroke();

  const k = r * 0.42;
  // Glyph stroke scales with the disc — radii are legibility-floored upstream
  // (cpx), so a fixed 1.6 would look hairline-thin on a bumped-up ✕.
  ctx.lineWidth = Math.max(1.6, r * 0.14);
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(color, hovered ? 1 : 0.8);
  ctx.beginPath();
  ctx.moveTo(cx - k, cy - k);
  ctx.lineTo(cx + k, cy + k);
  ctx.moveTo(cx + k, cy - k);
  ctx.lineTo(cx - k, cy + k);
  ctx.stroke();
  ctx.restore();
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
  ctx.font = `500 ${cpx(13)}px ${fonts.sans}`;
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

// Rough spectral classification by mass + merger history. A star with more
// than one progenitor is a "blue straggler" — the real name for a star a merger
// has made hotter and heavier than it has any right to be. Single stars get a
// mass class (game-unit masses run ~1–5, merged up to ~9 before they detonate).
function classifyStar(mass: number, mergedCount: number): string {
  if (mergedCount > 1) return 'Blue straggler';
  if (mass < 1.5) return 'Red dwarf';
  if (mass < 2.5) return 'Yellow dwarf';
  if (mass < 4) return 'White star';
  if (mass < 6) return 'Blue-white star';
  return 'Blue giant';
}

// Inspection tooltip for a star: classification, current mass, and (for a
// merged star) how many stars fused into it. A small multi-line panel anchored
// above or below the body.
export function drawStarTooltip(
  ctx: CanvasRenderingContext2D,
  mass: number,
  mergedCount: number,
  anchorX: number,
  anchorY: number,
  placement: 'above' | 'below' = 'above',
): void {
  const title = classifyStar(mass, mergedCount);
  const sub = [`mass ${mass.toFixed(1)}`];
  if (mergedCount > 1) sub.push(`forged from ${mergedCount} stars`);

  ctx.save();
  const titleFont = `600 ${cpx(13)}px ${fonts.sans}`;
  const subFont = `400 ${cpx(11)}px ${fonts.sans}`;
  ctx.font = titleFont;
  let textW = ctx.measureText(title).width;
  ctx.font = subFont;
  for (const s of sub) textW = Math.max(textW, ctx.measureText(s).width);

  const padX = 12;
  const padY = 8;
  const lineH = lineHeightFor(12);
  const boxW = textW + padX * 2;
  const boxH = padY * 2 + lineH * (1 + sub.length);
  const bx = anchorX - boxW / 2;
  const by = placement === 'above' ? anchorY - boxH - 10 : anchorY + 10;

  ctx.beginPath();
  roundedRectPath(ctx, bx, by, boxW, boxH, 8);
  ctx.fillStyle = rgba(palette.voidDeep, 0.85);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(mergedCount > 1 ? palette.cream : palette.rose, 0.5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let ty = by + padY + lineH / 2;
  ctx.font = titleFont;
  ctx.fillStyle = palette.cream;
  ctx.fillText(title, anchorX, ty);
  ctx.font = subFont;
  ctx.fillStyle = rgba(palette.rose, 0.85);
  for (const s of sub) {
    ty += lineH;
    ctx.fillText(s, anchorX, ty);
  }
  ctx.restore();
}

// Status tooltip for a world: the era (Steady vs Turbulent), the climate + how
// turbulent it is for surface dwellers, the surviving population, and how many
// times life has risen here (it begins again after every wipe).
export function drawWorldTooltip(
  ctx: CanvasRenderingContext2D,
  info: { population: number; dawns: number; era: string; chaos: number; stable: boolean },
  anchorX: number,
  anchorY: number,
  placement: 'above' | 'below' = 'above',
): void {
  const title = info.stable ? 'Steady Era' : 'Turbulent Era';
  const climate =
    info.era === 'scorching'
      ? 'scorching—the suns crowd the sky'
      : info.era === 'frozen'
        ? 'frozen—the suns have fled'
        : 'temperate';
  const turbulence =
    info.chaos < 0.15 ? 'steady skies' : info.chaos < 0.4 ? 'unsettled' : 'violent swings';
  const pop =
    info.population <= 0.05 ? 'no survivors' : `${info.population.toFixed(1)}B surviving`;
  const sub = [climate, turbulence, pop, `${ordinal(info.dawns)} Dawn`];
  const titleColor = info.stable ? palette.cream : palette.danger;

  ctx.save();
  const titleFont = `600 ${cpx(13)}px ${fonts.sans}`;
  const subFont = `400 ${cpx(11)}px ${fonts.sans}`;
  ctx.font = titleFont;
  let textW = ctx.measureText(title).width;
  ctx.font = subFont;
  for (const s of sub) textW = Math.max(textW, ctx.measureText(s).width);

  const padX = 12;
  const padY = 8;
  const lineH = lineHeightFor(12);
  const boxW = textW + padX * 2;
  const boxH = padY * 2 + lineH * (1 + sub.length);
  const bx = anchorX - boxW / 2;
  const by = placement === 'above' ? anchorY - boxH - 10 : anchorY + 10;

  ctx.beginPath();
  roundedRectPath(ctx, bx, by, boxW, boxH, 8);
  ctx.fillStyle = rgba(palette.voidDeep, 0.88);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.world, 0.55);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let ty = by + padY + lineH / 2;
  ctx.font = titleFont;
  ctx.fillStyle = titleColor;
  ctx.fillText(title, anchorX, ty);
  ctx.font = subFont;
  ctx.fillStyle = rgba(palette.cream, 0.85);
  for (const s of sub) {
    ty += lineH;
    ctx.fillText(s, anchorX, ty);
  }
  ctx.restore();
}

function worldSurfaceLine(info: {
  population: number;
  era: string;
  stable: boolean;
}): string {
  if (info.population <= 0.05) return 'Lifeless—awaiting the next dawn.';
  if (info.era === 'scorching') return 'The seas boil; the cities burn.';
  if (info.era === 'frozen') return 'Ice entombs the last fires.';
  if (info.stable) return 'A golden age—humanity flourishes.';
  return 'An uneasy calm; the sky cannot be trusted.';
}

// Persistent surface readout for a world, bottom-left — always on (a hover
// tooltip on a tiny moving dot is invisible). Era, what it's like down there,
// who's left, and how many times life has risen here.
export function drawWorldStatus(
  ctx: CanvasRenderingContext2D,
  info: { population: number; dawns: number; era: string; chaos: number; stable: boolean },
  _w: number,
  h: number,
): void {
  const eraText = info.stable
    ? 'Steady Era'
    : info.era === 'scorching'
      ? 'Turbulent Era · Scorching'
      : info.era === 'frozen'
        ? 'Turbulent Era · Frozen'
        : 'Turbulent Era';
  const eraColor = info.stable
    ? palette.cream
    : info.era === 'frozen'
      ? palette.world
      : palette.danger;
  const surface = worldSurfaceLine(info);
  const stat =
    info.population <= 0.05
      ? `No survivors · ${ordinal(info.dawns)} Dawn`
      : `${info.population.toFixed(1)}B surviving · ${ordinal(info.dawns)} Dawn`;

  ctx.save();
  const labelFont = `600 ${cpx(11)}px ${fonts.sans}`;
  const eraFont = `400 ${cpx(20)}px ${fonts.serif}`;
  const surfFont = `italic 400 ${cpx(14)}px ${fonts.serif}`;
  const statFont = `500 ${cpx(11)}px ${fonts.sans}`;
  const lhLabel = lineHeightFor(11);
  const lhEra = lineHeightFor(20);
  const lhSurf = lineHeightFor(14);
  const lhStat = lineHeightFor(11);

  ctx.font = labelFont;
  let textW = ctx.measureText('THE WORLD').width;
  ctx.font = eraFont;
  textW = Math.max(textW, ctx.measureText(eraText).width);
  ctx.font = surfFont;
  textW = Math.max(textW, ctx.measureText(surface).width);
  ctx.font = statFont;
  textW = Math.max(textW, ctx.measureText(stat).width);

  const padX = 16;
  const padY = 12;
  const boxW = textW + padX * 2;
  const boxH = padY * 2 + lhLabel + lhEra + lhSurf + lhStat;
  const boxX = 24;
  const boxY = h - 28 - boxH;

  ctx.beginPath();
  roundedRectPath(ctx, boxX, boxY, boxW, boxH, 12);
  ctx.fillStyle = rgba(palette.voidDeep, 0.72);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.world, 0.4);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const tx = boxX + padX;
  let ty = boxY + padY;
  ctx.font = labelFont;
  ctx.fillStyle = rgba(palette.world, 0.9);
  ctx.fillText('THE WORLD', tx, ty);
  ty += lhLabel;
  ctx.font = eraFont;
  ctx.fillStyle = eraColor;
  ctx.fillText(eraText, tx, ty);
  ty += lhEra;
  ctx.font = surfFont;
  ctx.fillStyle = rgba(palette.rose, 0.9);
  ctx.fillText(surface, tx, ty);
  ty += lhSurf;
  ctx.font = statFont;
  ctx.fillStyle = rgba(palette.cream, 0.7);
  ctx.fillText(stat, tx, ty);
  ctx.restore();
}

// Game-over card for the sandbox: the system collapsed into a black hole, all
// life died out, a world was flung away — or the dark forest ended the run
// (Act III), where surviving the hunt is the game's one bright ending.
// Centered + dimmed; returns the AGAIN anchor.
export type SandboxOutcome = 'collapse' | 'extinction' | 'ejection' | 'detected' | 'survived';

export function drawSandboxOver(
  ctx: CanvasRenderingContext2D,
  outcome: SandboxOutcome,
  w: number,
  h: number,
  // Survival with every world dead (or none ever made) is a bleaker victory:
  // the copy shifts from triumph to elegy.
  desolate = false,
): { titleColor: string; buttonY: number; x: number; y: number; width: number; height: number } {
  ctx.save();
  ctx.fillStyle = rgba(palette.voidDeep, 0.72);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Survival is the one bright ending — cream, not danger.
  const titleColor = outcome === 'survived' ? palette.cream : palette.danger;
  const copy: Record<SandboxOutcome, { title: string; body: string }> = {
    collapse: {
      title: 'The universe collapsed.',
      body: 'The stars all fell together—a black hole, and everything with it.',
    },
    extinction: {
      title: 'Humanity is extinct.',
      body: 'All life is ash. No one is left to watch the sky.',
    },
    ejection: {
      title: 'Lost to the dark.',
      body: 'A close pass flung your world out of the system—into the endless cold.',
    },
    detected: {
      title: 'Found.',
      body: 'Something in the dark answered. A strike crossed the years and ended you.',
    },
    survived: {
      title: 'You endured the dark.',
      body: 'You stayed silent, and the hunters never found you. The paradox holds: the quiet endure.',
    },
  };
  const { title, body } =
    outcome === 'survived' && desolate
      ? {
          title: 'The stars endure.',
          body: 'You were never found. There is no one left to know it.',
        }
      : copy[outcome];

  const cardW = 660;
  const cardH = 236;
  const cx = (w - cardW) / 2;
  const cy = (h - cardH) / 2;
  const mid = cx + cardW / 2;

  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, cx, cy, cardW, cardH, 18);
  ctx.fillStyle = rgba(palette.voidDeep, 0.92);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(titleColor, 0.6);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor;
  ctx.font = `400 44px ${fonts.serif}`;
  ctx.fillText(title, mid, cy + 74);
  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${cpx(18)}px ${fonts.serif}`;
  ctx.fillText(body, mid, cy + 122);
  ctx.fillStyle = rgba(palette.cream, 0.55);
  ctx.font = `500 ${cpx(12)}px ${fonts.sans}`;
  ctx.fillText('The infinite game is only won by playing again.', mid, cy + 150);
  ctx.restore();

  return { titleColor, buttonY: cy + 172, x: cx, y: cy, width: cardW, height: cardH };
}

export function drawOutcomeCard(
  ctx: CanvasRenderingContext2D,
  outcome: Outcome,
  w: number,
  h: number,
  statsLine: string | null = null,
  // WIN cards are draggable (Game.winCardOffset). The offset shifts the panel,
  // text, buttons and footer together; everything centres on the card, not the
  // canvas, so a horizontal drag keeps text glued to the panel.
  offset: { x: number; y: number } = { x: 0, y: 0 },
): {
  titleColor: string;
  titleText: string;
  bodyText: string;
  buttonY: number;
  carseY: number;
  x: number;
  y: number;
  width: number;
  height: number;
} {
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
  // Grow the card to contain the 3-line Carse footer once the legibility floor
  // makes it taller than the 48px (3×16) the base heights budgeted for — else
  // the third line clips below the rounded-rect bottom on sub-390px phones.
  // Game.clampCardOffset mirrors this exact term; keep them in sync.
  const footerExtra = Math.max(0, lineHeightFor(12) * 3 - 48);
  const cardH = (isWin ? 232 : 308) + statsExtra + footerExtra;
  const cx = (w - cardW) / 2 + offset.x;
  // WIN card is bottom-anchored; the bottom 56px belong to the HUD strip
  // (label baseline at h−44, value baseline at h−28, ascenders to ~h−53).
  // Margin must clear that band with breathing room or the card's translucent
  // fill bleeds over the labels.
  const cy = (isWin ? h - cardH - 72 : (h - cardH) / 2) + offset.y;
  const mid = cx + cardW / 2; // card centre — text rides the drag offset

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
  ctx.fillText(card.titleText, mid, cy + (isWin ? 40 : 76));

  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${cpx(isWin ? 16 : 19)}px ${fonts.serif}`;
  ctx.fillText(card.bodyText, mid, cy + (isWin ? 72 : 122));

  if (statsLine) {
    // Sit between the body line and the AGAIN button. Subtle — it's a
    // reading-of-the-moment, not a competition with the title.
    ctx.fillStyle = rgba(palette.cream, 0.55);
    ctx.font = `500 ${cpx(12)}px ${fonts.sans}`;
    ctx.fillText(statsLine, mid, cy + (isWin ? 100 : 152));
  }
  ctx.restore();

  const buttonY = (isWin ? cy + 96 : cy + 156) + statsExtra;
  // Carse footer goes below the button, still inside the card.
  const carseY = buttonY + 44 + 8; // button height + small gap
  return { ...card, buttonY, carseY, x: cx, y: cy, width: cardW, height: cardH };
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

// The optional title-screen affordance: a quiet, lowercase text link in the
// site's voice. Drawn as plain prose (not a pill) so it reads as an invitation,
// not a control — but the caller registers a finger-sized hit rect around it.
// A faint underline appears on hover to confirm it's tappable. It sits centred
// just above BEGIN (where a curious first-timer is already looking), mirroring
// the free-plays meter line that sits below the button when metering is on.
const EXPLAINER_LINK_TEXT = 'what is a binary star?';

export function drawTitleExplainerLink(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hovered: boolean,
): CanvasButton {
  ctx.save();
  ctx.font = `italic 400 ${cpx(18)}px ${fonts.serif}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // 44px above the BEGIN button's top edge (button top = h·0.62): the visual
  // gap balances the meter line 72px below the button, and keeps this hit
  // rect (44px tall, centred on the baseline) 22px clear of BEGIN's — a
  // mis-tap lands on one or the other, never both.
  const centerX = w / 2;
  const baselineY = h * 0.62 - 44;
  const textW = ctx.measureText(EXPLAINER_LINK_TEXT).width;

  ctx.fillStyle = rgba(palette.rose, hovered ? 0.85 : 0.5);
  ctx.fillText(EXPLAINER_LINK_TEXT, centerX, baselineY);

  if (hovered) {
    ctx.strokeStyle = rgba(palette.rose, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - textW / 2, baselineY + 11);
    ctx.lineTo(centerX + textW / 2, baselineY + 11);
    ctx.stroke();
  }
  ctx.restore();

  // Finger-sized hit rect (≥44px tall, per the repo's touch-target precedent),
  // centred on the rendered text. Pad horizontally so the whole phrase is easy
  // to tap.
  const hitH = 44;
  const padX = 12;
  return {
    label: '',
    x: centerX - textW / 2 - padX,
    y: baselineY - hitH / 2,
    width: textW + padX * 2,
    height: hitH,
  };
}

// The explainer card. Styled to match the outcome/paywall card family — dim
// backdrop, centred rounded panel, Cardo serif prose — and modal: while it's
// open the title screen behind it is inert. Returns the ✕ geometry so the
// caller can register a finger-sized dismiss hit rect (mirroring the WIN card).
const EXPLAINER_TITLE = 'binary stars';
const EXPLAINER_BODY: readonly string[] = [
  'Most stars are not alone.',
  'Perhaps half the stars you can see are two—bound to each other, circling a shared center of gravity, a point that belongs to neither and to both. Astronomers call them binary stars.',
  'Often only one is bright enough to see. It wobbles, tugged by a companion no one can find—to an astronomer, a binary star is a wobble of light.',
  'That wobble is how astronomers weigh what they cannot see—starlight shifts blue as a star swings toward us, red as it swings away. The same trick, refined, now finds planets circling other suns.',
  'In 1844 Friedrich Bessel read a wobble in Sirius’s path and declared an unseen companion. Eighteen years later a telescope found it—Sirius B, the first white dwarf ever known.',
  'Neither star leads. Neither follows. Each bends the other’s path—and when the balance is right, the dance holds for billions of years.',
  'When it isn’t, they fall together, or fly apart.',
  'Two bodies, Newton’s laws—set down over three centuries ago—can predict almost forever. Add a third, and the certainty breaks: the three-body problem has no general solution to this day.',
  'You are about to be such a pair. But remember—other bodies that enter your system can influence it, and even destabilize it permanently.',
];

export function drawExplainerCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  closeHovered: boolean,
): { closeX: number; closeY: number; closeR: number } {
  // Dim the title behind the card so it reads as modal (same backdrop alpha as
  // the LOSE outcome / paywall cards).
  ctx.save();
  ctx.fillStyle = rgba(palette.voidDeep, 0.6);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const bodySize = 17;
  const bodyLineH = lineHeightFor(bodySize); // follows the legibility floor
  const titleTop = 40; // title baseline offset from card top
  const bottomPad = 40;
  const maxH = h - 32; // the card must never leave the design space

  // Wrap the prose at a column width and flow it into 1 or 2 columns. Two
  // columns split at the paragraph boundary that best balances their heights
  // (a paragraph never breaks across columns).
  ctx.save();
  ctx.font = `italic 400 ${cpx(bodySize)}px ${fonts.serif}`;
  const layoutAt = (cardW: number, padX: number, paraGap: number, titleToBody: number, cols: 1 | 2) => {
    const colGap = 40;
    const colW = cols === 1 ? cardW - padX * 2 : (cardW - padX * 2 - colGap) / 2;
    const paras = EXPLAINER_BODY.map(p => wrapText(ctx, p, colW));
    const colH = (c: string[][]): number =>
      c.reduce((s, p) => s + p.length * bodyLineH, 0) + Math.max(0, c.length - 1) * paraGap;
    let columns: string[][][] = [paras];
    if (cols === 2) {
      let bestH = Infinity;
      for (let s = 1; s < paras.length; s++) {
        const split = [paras.slice(0, s), paras.slice(s)];
        const m = Math.max(colH(split[0]), colH(split[1]));
        if (m < bestH) {
          bestH = m;
          columns = split;
        }
      }
    }
    const bodyHeight = Math.max(...columns.map(colH));
    return {
      cardW,
      padX,
      paraGap,
      titleToBody,
      colGap,
      colW,
      columns,
      bodyHeight,
      cardH: titleTop + titleToBody + bodyHeight + bottomPad,
    };
  };

  // Fit ladder: the classic 640 single-column card whenever it fits (desktop
  // stays pixel-identical) → two balanced columns on a wide card (phone fits,
  // where the legibility floor roughly doubles the prose) → as a last resort
  // squeeze the body rhythm a few percent below the floor rather than clip.
  let lay = layoutAt(640, 56, 14, 44, 1);
  if (lay.cardH > maxH) lay = layoutAt(Math.min(1180, w - 64), 40, 12, 40, 2);
  let squeeze = 1;
  if (lay.cardH > maxH) {
    const budget = maxH - titleTop - lay.titleToBody - bottomPad;
    squeeze = Math.max(0.8, budget / lay.bodyHeight);
  }
  ctx.restore();

  const lineH = bodyLineH * squeeze;
  const gapH = lay.paraGap * squeeze;
  const cardH = titleTop + lay.titleToBody + lay.bodyHeight * squeeze + bottomPad;
  const cardW = lay.cardW;
  const cx = (w - cardW) / 2;
  const cy = Math.max(12, (h - cardH) / 2);

  // Panel
  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, cx, cy, cardW, cardH, 18);
  ctx.fillStyle = rgba(palette.voidDeep, 0.92);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.cream, 0.45);
  ctx.stroke();
  ctx.restore();

  // Title — legibility-floored like the body (raw 30px fell below the floor
  // on phone fits).
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.cream;
  ctx.font = `400 ${cpx(30)}px ${fonts.serif}`;
  ctx.fillText(EXPLAINER_TITLE, w / 2, cy + titleTop);

  // Body — wrapped paragraph by paragraph: centred in the classic single
  // column, left-aligned when flowed into two.
  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${cpx(bodySize) * squeeze}px ${fonts.serif}`;
  const single = lay.columns.length === 1;
  ctx.textAlign = single ? 'center' : 'left';
  lay.columns.forEach((colParas, i) => {
    const x = single ? w / 2 : cx + lay.padX + i * (lay.colW + lay.colGap);
    let y = cy + titleTop + lay.titleToBody;
    for (const lines of colParas) {
      for (const line of lines) {
        ctx.fillText(line, x, y);
        y += lineH;
      }
      y += gapH;
    }
  });
  ctx.restore();

  // ✕ to dismiss, top-right of the card — same construction as the WIN card.
  // Legibility-floored disc: 13px design lands at ~6px on a phone otherwise.
  const closeR = cpx(13);
  const closeX = cx + cardW - closeR - 13;
  const closeY = cy + closeR + 13;
  drawCloseButton(ctx, closeX, closeY, closeR, palette.cream, closeHovered);

  return { closeX, closeY, closeR };
}

// Greedy word-wrap to a pixel width using the context's current font. Returns
// one entry per visual line. Used by the explainer card so its longer
// paragraphs fit the panel without hand-broken lines.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Ordinal suffix for a small count: 1st, 2nd, 3rd, 4th … (handles the teens).
// Used by the world readouts to label each successive "dawn" of life.
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
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

// Paywall card — shown when a metered player has used their free plays. Mirrors
// the outcome card's construction (dim backdrop + centred rounded card) so it
// reads as part of the same family. Returns the Y for the caller's button.
export function drawPaywallCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  meter: { remaining: number | null; unlocked: boolean; limit: number },
): { buttonY: number } {
  ctx.save();
  ctx.fillStyle = rgba(palette.voidDeep, 0.6);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const cardW = 640;
  const cardH = 268;
  const cx = (w - cardW) / 2;
  const cy = (h - cardH) / 2;

  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, cx, cy, cardW, cardH, 18);
  ctx.fillStyle = rgba(palette.voidDeep, 0.92);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.cream, 0.55);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = palette.cream;
  ctx.font = `400 38px ${fonts.serif}`;
  // The count comes from the client-side hint (VITE_FREE_LIMIT) — interpolated
  // so the title tracks config instead of hardcoded prose (it said "A hundred"
  // while the limit was 200). It can still desync if the Worker's independent
  // FREE_PLAY_LIMIT env diverges from the build-time hint; the server never
  // reports its limit back (GateResponse has no limit field).
  ctx.fillText(`${meter.limit} wobbles in.`, w / 2, cy + 72);

  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${cpx(18)}px ${fonts.serif}`;
  ctx.fillText(`You’ve watched ${meter.limit} free plays unfold.`, w / 2, cy + 116);

  ctx.fillStyle = rgba(palette.cream, 0.65);
  ctx.font = `500 ${cpx(13)}px ${fonts.sans}`;
  ctx.fillText(
    'Pay what it’s worth to you—from $1—to keep playing, forever.',
    w / 2,
    cy + 150,
  );
  ctx.restore();

  return { buttonY: cy + cardH - 70 };
}

// The act title cards. Copy lives here (the view layer); the Game passes only
// which act is opening. Only acts 2 and 3 exist as cards: the act structure is
// a surprise, so nothing ever announces "Act I" — the first card the player
// sees is the ACT II reveal, the moment the winning binary is first perturbed.
export const CHAPTERS: Record<2 | 3, { numeral: string; title: string; subtitle: string }> = {
  2: {
    numeral: 'Act II',
    title: 'The Three-Body Problem',
    subtitle: 'Add a third, and certainty breaks. No equation can tell you what comes next.',
  },
  3: {
    numeral: 'Act III',
    title: 'The Fermi Paradox',
    subtitle: 'The sky should be crowded with voices. It is silent. Ask yourself why.',
  },
};

// A chapter title card that opens each act. Modeled on the explainer card —
// centred serif panel, dim modal backdrop, ✕ to dismiss (the caller also treats
// a tap anywhere as dismiss). Returns the ✕ geometry for the caller's hit rect.
export function drawChapterCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: { numeral: string; title: string; subtitle: string },
  closeHovered: boolean,
): { closeX: number; closeY: number; closeR: number } {
  ctx.save();
  ctx.fillStyle = rgba(palette.voidDeep, 0.72);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const cardW = 640;
  const padX = 56;
  const textW = cardW - padX * 2;
  const subSize = 18;
  const subLineH = lineHeightFor(subSize);

  ctx.save();
  ctx.font = `italic 400 ${cpx(subSize)}px ${fonts.serif}`;
  const subLines = wrapText(ctx, card.subtitle, textW);
  ctx.restore();

  const numeralTop = 52;
  const titleGap = 50;
  const subGap = 30;
  const bottomPad = 44;
  const cardH = numeralTop + titleGap + subGap + subLines.length * subLineH + bottomPad;
  const cx = (w - cardW) / 2;
  const cy = (h - cardH) / 2;

  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, cx, cy, cardW, cardH, 18);
  ctx.fillStyle = rgba(palette.voidDeep, 0.92);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(palette.cream, 0.45);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Act numeral — small, letter-spaced, in the sans voice (a label, not a title).
  ctx.fillStyle = rgba(palette.rose, 0.85);
  ctx.font = `600 ${cpx(13)}px ${fonts.sans}`;
  drawSpacedText(ctx, card.numeral.toUpperCase(), w / 2, cy + numeralTop, 3);
  // Title — the serif headline. (drawSpacedText leaves textAlign 'left'; restore
  // centre or the title and subtitle render left-anchored at w/2 and spill right.)
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.cream;
  ctx.font = `400 ${cpx(34)}px ${fonts.serif}`;
  ctx.fillText(card.title, w / 2, cy + numeralTop + titleGap);
  // Subtitle — italic serif prose, wrapped.
  ctx.fillStyle = palette.rose;
  ctx.font = `italic 400 ${cpx(subSize)}px ${fonts.serif}`;
  let y = cy + numeralTop + titleGap + subGap + subLineH / 2;
  for (const line of subLines) {
    ctx.fillText(line, w / 2, y);
    y += subLineH;
  }
  ctx.restore();

  const closeR = cpx(13);
  const closeX = cx + cardW - closeR - 13;
  const closeY = cy + closeR + 13;
  drawCloseButton(ctx, closeX, closeY, closeR, palette.cream, closeHovered);

  return { closeX, closeY, closeR };
}

// Act III visibility meter — how loudly the system is broadcasting into the
// dark. A bar from quiet (left) to seen (right), with a tick at the detection
// threshold: calm cream at rest, flushing toward danger as it climbs. When a
// hunter has locked on it pulses red under a "go dark" warning. Top-centre,
// canvas-fixed (design space), sitting just below the phase block — the
// renderer folds this meter's extent into the phase block the left HUDs yield
// to, so the sandbox cluster can never land on it.
export function drawVisibilityMeter(
  ctx: CanvasRenderingContext2D,
  w: number,
  meter: {
    visibility: number;
    threshold: number;
    locked: boolean;
    provoked: boolean;
    strikeProgress: number;
    surviveProgress: number;
  },
  time: number,
  reducedMotion: boolean,
  goingDark: boolean,
  // Bar top in design px. The caller clears the phase serif line with it —
  // compensated text closes the fixed gap a constant here would assume
  // (see Renderer.meterTop).
  top: number,
): void {
  const barW = 300;
  const barH = 10;
  const x = (w - barW) / 2;
  const y = top;
  const v = Math.max(0, Math.min(1, meter.visibility));
  const heat = Math.min(1, v / Math.max(0.001, meter.threshold));
  const fillColor = blendHex(palette.cream, palette.danger, heat);
  // reduced-motion: a steady glow instead of a strobing pulse.
  const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 8);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Label: running dark > the locked warning > the resting "visibility".
  const label = goingDark ? 'RUNNING DARK' : meter.locked ? 'DETECTED—GO DARK' : 'VISIBILITY';
  ctx.fillStyle = goingDark
    ? rgba(palette.world, 0.9)
    : meter.locked
      ? rgba(palette.danger, pulse)
      : rgba(palette.cream, 0.6);
  ctx.font = `600 ${cpx(11)}px ${fonts.sans}`;
  ctx.fillText(label, w / 2, y - 9);

  // Track
  ctx.beginPath();
  roundedRectPath(ctx, x, y, barW, barH, barH / 2);
  ctx.fillStyle = rgba(palette.cream, 0.12);
  ctx.fill();

  // Fill
  if (v > 0) {
    ctx.beginPath();
    roundedRectPath(ctx, x, y, Math.max(barH, barW * v), barH, barH / 2);
    ctx.fillStyle = meter.locked ? rgba(palette.danger, pulse) : rgba(fillColor, 0.9);
    ctx.fill();
  }

  // Threshold tick — cross it and the forest starts to notice.
  const tx = x + barW * Math.max(0, Math.min(1, meter.threshold));
  ctx.strokeStyle = rgba(palette.cream, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, y - 3);
  ctx.lineTo(tx, y + barH + 3);
  ctx.stroke();

  // Second row makes the hunt's two clocks legible. Once a hunter has locked on,
  // a depleting danger bar counts down to the strike (go quiet to break it). Once
  // the forest is woken but not locked, a filling cream bar tracks progress toward
  // enduring the dark — both invisible before, leaving the player flying blind.
  const y2 = y + barH + 14;
  const drawRow = (frac: number, trackA: number, fill: string, text: string): void => {
    const f = Math.max(0, Math.min(1, frac));
    ctx.beginPath();
    roundedRectPath(ctx, x, y2, barW, barH, barH / 2);
    ctx.fillStyle = rgba(palette.cream, trackA);
    ctx.fill();
    if (f > 0) {
      ctx.beginPath();
      roundedRectPath(ctx, x, y2, Math.max(barH, barW * f), barH, barH / 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.font = `600 ${cpx(10)}px ${fonts.sans}`;
    ctx.fillStyle = rgba(meter.locked ? palette.danger : palette.cream, meter.locked ? 0.9 : 0.6);
    // max(12, …): desktop keeps the tuned 12px gap; compensated captions get
    // the ascent room they measure, so the text never grazes the bar.
    ctx.fillText(text, w / 2, y2 + barH + Math.max(12, lineHeightFor(10) * 0.8));
  };
  if (meter.locked) {
    drawRow(1 - meter.strikeProgress, 0.14, rgba(palette.danger, pulse), 'STRIKE INCOMING—GO QUIET');
  } else if (meter.provoked) {
    drawRow(meter.surviveProgress, 0.1, rgba(palette.cream, 0.7), 'STAY SILENT TO ENDURE');
  }

  ctx.restore();
}
