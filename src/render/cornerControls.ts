// Pure visibility predicate for the resolved-state corner "Again" button, split
// out so it can be unit-tested without the canvas.
//
// Why this exists: the corner Again and a sandbox game-over card's Again BOTH
// register under the action name 'again', the card registers first and the
// corner second, and the button registry is last-write-wins (Map.set). So if the
// corner Again is shown while a game-over card is up, its rect silently
// overwrites the card's and the card's Again button goes dead. The sandbox grows
// from a WIN (outcome.kind stays 'win' the whole time), so this fired whenever
// the win card had been dismissed before the sandbox ended — the
// "Again sometimes broken at Humanity is extinct" bug. Fix: suppress the corner
// Again entirely once any sandbox game-over (collapse / extinction / ejection)
// owns the screen — the card owns 'again' there.
export function showsCornerAgain(o: {
  state: string;
  sandboxOutcome: 'collapse' | 'extinction' | 'ejection' | null;
  unravel: boolean;
  outcomeKind: string | null;
  winCardDismissed: boolean;
}): boolean {
  if (o.state !== 'resolved' || o.sandboxOutcome) return false;
  return o.unravel || (o.outcomeKind === 'win' && o.winCardDismissed);
}

// ── Act titling ──
//
// The game continuing past the two-body waltz is a SURPRISE. Act 1's eyebrow
// carries only the game's name; the first "ACT II" appears exactly when the
// sandbox does (win card dismissed, or a third body already loose), and the
// numeral retroactively names what came before. Keep 1 | 2 extensible: the
// stranded feat/act3-fermi-paradox branch adds a 3 here when it lands.
export const ACT_EYEBROWS = {
  1: 'INFINITE BINARY WOBBLE',
  2: 'ACT II · THE THREE-BODY PROBLEM',
} as const;

export function actForFrame(o: {
  state: string;
  unravel: boolean;
  outcomeKind: string | null;
  winCardDismissed: boolean;
}): 1 | 2 {
  if (o.unravel) return 2;
  if (o.state === 'resolved' && o.outcomeKind === 'win' && o.winCardDismissed) return 2;
  return 1;
}

// ── Sandbox cluster + corner + placement HUD geometry ──
//
// Why this exists: the act-2 pills used to be fixed 150px rects while their
// labels are drawn at cpx()-compensated sizes. On phone fits (viewScale ≈ 0.5)
// the legibility floor inflates a 14px label to ~21 design px, so "RANDOM
// PLANET" outgrew its pill and bled into the neighbour 8px away — overlapping
// buttons on iOS while desktop (viewScale ≥ 1, no compensation) looked fine.
// PR #73 fixed the four sandbox pills; the same disease lived on in the fixed
// Launch/Cancel and EXIT/AGAIN pills, in gaps that shrink to ~3 CSS px on
// phones, and in HUDs that reach into the centred phase block. Fix: pure
// layout that sizes every pill to its measured compensated label, floors every
// gap in on-screen pixels, and yields to the phase block instead of crossing
// it. The Renderer injects the measurer (canvas text metrics); tests inject
// fakes, so non-overlap is provable here without a canvas. Draw + hit-test
// share the returned rects, so they can never disagree.

export interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The centred phase block (eyebrow + serif line) as measured by the caller:
// horizontal extent of the wider line, and the bottom of the serif band.
export interface PhaseBlock {
  left: number;
  right: number;
  bottom: number;
}

const CLUSTER_LEFT = 16;
const CLUSTER_TOP = 14;
export const PILL_H = 44;
const GAP_X = 8;
const GAP_Y = 10;
const CORNER_GAP = 12;
const RIGHT_MARGIN = 16;
// Side padding inside a pill around the measured label. 10px keeps every pill
// at exactly the old 150px on desktop fits (widest label ≈ 127px there), so
// scale-1 layouts are pixel-identical to the fixed-width era.
const PILL_PAD_X = 10;
const PILL_MIN_W = 150;

// Labels shared with the Renderer so measurement and drawing can't drift.
export const PLACEMENT_LABELS = { launch: 'Launch', cancel: 'Cancel' } as const;
export const CORNER_LABELS = { exit: 'Exit', again: 'Again' } as const;

export function pillWidth(
  measure: (label: string) => number,
  label: string,
  min: number = PILL_MIN_W,
): number {
  return Math.max(min, Math.ceil(measure(label)) + PILL_PAD_X * 2);
}

// Gaps floored in ON-SCREEN pixels: a fixed 8px design gap is ~3 CSS px at
// phone scales, and neighbouring pill glows read as one blob. Identity at
// scale ≥ 1, so desktop keeps the legacy rhythm exactly.
const gapX = (viewScale: number): number => Math.max(GAP_X, Math.ceil(GAP_X / viewScale));
const gapY = (viewScale: number): number => Math.max(GAP_Y, Math.ceil(GAP_Y / viewScale));
const cornerGap = (viewScale: number): number =>
  Math.max(CORNER_GAP, Math.ceil(GAP_X / viewScale));

// Compensated text also widens the centred phase block, so on phone fits a
// top-left HUD can reach into it. Rather than shrink either, the HUD yields:
// with 24px of air it keeps the legacy top, otherwise it starts below the
// block. ceil() the bottom so the drop always fully clears the serif band.
export function hudTop(o: { hudRight: number; phaseLeft: number; phaseBottom: number }): number {
  return o.hudRight + 24 <= o.phaseLeft ? CLUSTER_TOP : Math.ceil(o.phaseBottom) + 16;
}

export interface SandboxClusterLayout {
  starSet: PillRect;
  starRnd: PillRect;
  planetSet: PillRect;
  planetRnd: PillRect;
  // Caption baseline (textAlign left).
  caption: { x: number; y: number };
}

export const SANDBOX_LABELS = {
  starSet: 'Set Star',
  starRnd: 'Random Star',
  planetSet: 'Set Planet',
  planetRnd: 'Random Planet',
} as const;

// Landscape: the familiar 2×2 grid (Set column | Random column), columns sized
// to their widest label. Portrait: a single column — the centred phase block
// owns the top-middle of an 800px-wide space, and measured pills in two
// columns would reach into it on phone fits.
export function sandboxClusterLayout(o: {
  orientation: 'landscape' | 'portrait';
  measure: (label: string) => number;
  // lineHeightFor(11) from the caller — the caption's advance once compensated.
  captionAdvance: number;
  viewScale: number;
  phase: PhaseBlock;
}): SandboxClusterLayout {
  const wSetStar = pillWidth(o.measure, SANDBOX_LABELS.starSet);
  const wRndStar = pillWidth(o.measure, SANDBOX_LABELS.starRnd);
  const wSetPlanet = pillWidth(o.measure, SANDBOX_LABELS.planetSet);
  const wRndPlanet = pillWidth(o.measure, SANDBOX_LABELS.planetRnd);
  const gx = gapX(o.viewScale);
  const gy = gapY(o.viewScale);
  // max(16, advance): scale-1 advance is ~15, so desktop keeps the old fixed
  // 16px gap exactly; inflated captions get the room they measure.
  const captionGap = Math.max(16, Math.round(o.captionAdvance));

  if (o.orientation === 'portrait') {
    const w = Math.max(wSetStar, wRndStar, wSetPlanet, wRndPlanet);
    const top = hudTop({
      hudRight: CLUSTER_LEFT + w,
      phaseLeft: o.phase.left,
      phaseBottom: o.phase.bottom,
    });
    const rect = (row: number): PillRect => ({
      x: CLUSTER_LEFT,
      y: top + row * (PILL_H + gy),
      width: w,
      height: PILL_H,
    });
    const planetRnd = rect(3);
    return {
      starSet: rect(0),
      starRnd: rect(1),
      planetSet: rect(2),
      planetRnd,
      caption: { x: CLUSTER_LEFT, y: planetRnd.y + PILL_H + captionGap },
    };
  }

  const colL = Math.max(wSetStar, wSetPlanet);
  const colR = Math.max(wRndStar, wRndPlanet);
  const top = hudTop({
    hudRight: CLUSTER_LEFT + colL + gx + colR,
    phaseLeft: o.phase.left,
    phaseBottom: o.phase.bottom,
  });
  const x2 = CLUSTER_LEFT + colL + gx;
  const row2 = top + PILL_H + gy;
  return {
    starSet: { x: CLUSTER_LEFT, y: top, width: colL, height: PILL_H },
    starRnd: { x: x2, y: top, width: colR, height: PILL_H },
    planetSet: { x: CLUSTER_LEFT, y: row2, width: colL, height: PILL_H },
    planetRnd: { x: x2, y: row2, width: colR, height: PILL_H },
    caption: { x: CLUSTER_LEFT, y: row2 + PILL_H + captionGap },
  };
}

export interface PlacementHudLayout {
  // Hint baseline (textAlign left, alphabetic baseline).
  hintY: number;
  // Star-only mass row: − / + pills with the readout centred between them.
  minus: PillRect | null;
  plus: PillRect | null;
  massCenter: { x: number; y: number } | null;
  // Star-with-aim velocity readout baseline, or null when hidden.
  velY: number | null;
  launch: PillRect | null;
  cancel: PillRect;
}

// The placing HUD had the same disease in fixed offsets: an 84px slot for the
// mass readout that compensated text exactly fills on phone fits, fixed row
// advances that inflated lines overprint, and fixed 110px Launch/Cancel pills
// whose labels grow to ~120px on phones — the pair fused into one
// "LAUNCHCANCEL" blob. Rows advance by max(old constant, measured advance) and
// the pill pair is sized to its wider measured label, so desktop keeps the old
// rhythm to the pixel and phone fits get the room the text actually needs.
export function placementHudLayout(o: {
  kind: 'star' | 'planet';
  hasPos: boolean;
  hasVel: boolean;
  // Width of the widest mass readout ("mass 5.0") as drawn — sized to the
  // maximum so the +/- pills don't jitter as the value changes.
  massWidth: number;
  // lineHeightFor(12) — the hint and velocity lines' compensated advance.
  lineAdvance: number;
  // drawButton's label measurer, for the Launch/Cancel pill pair.
  measure: (label: string) => number;
  viewScale: number;
  // Measured width of the hint line as drawn, so the whole HUD (text included)
  // can yield to the phase block.
  hintWidth: number;
  phase: PhaseBlock;
}): PlacementHudLayout {
  const gx = gapX(o.viewScale);
  const pill = 40;
  const massGap = Math.max(84, Math.ceil(o.massWidth) + 16);
  // Launch and Cancel share the wider measured width so the pair reads as one
  // family (110 keeps desktop pixel-identical to the fixed-width era).
  const bw = Math.max(
    pillWidth(o.measure, PLACEMENT_LABELS.launch, 110),
    pillWidth(o.measure, PLACEMENT_LABELS.cancel, 110),
  );

  // Rightmost extent of anything this HUD will draw, for the yield rule.
  const rowRight = Math.max(
    CLUSTER_LEFT + o.hintWidth,
    o.kind === 'star' ? CLUSTER_LEFT + pill + massGap + pill : 0,
    o.hasPos ? CLUSTER_LEFT + bw + gx + bw : CLUSTER_LEFT + bw,
  );
  const top = hudTop({ hudRight: rowRight, phaseLeft: o.phase.left, phaseBottom: o.phase.bottom });

  const hintY = top + 8;
  // Old rhythm: mass row at top+26, i.e. 18 below the hint baseline.
  let y = hintY + Math.max(18, Math.round(o.lineAdvance) + 2);

  let minus: PillRect | null = null;
  let plus: PillRect | null = null;
  let massCenter: { x: number; y: number } | null = null;
  if (o.kind === 'star') {
    minus = { x: CLUSTER_LEFT, y, width: pill, height: pill };
    plus = { x: CLUSTER_LEFT + pill + massGap, y, width: pill, height: pill };
    massCenter = { x: CLUSTER_LEFT + pill + massGap / 2, y: y + pill / 2 };
    // Old rhythm: 12 below the pills; inflated velocity text needs its advance.
    y += pill + Math.max(12, Math.round(o.lineAdvance) - 4);
  }

  let velY: number | null = null;
  if (o.kind === 'star' && o.hasPos && o.hasVel) {
    velY = y + 4;
    y += Math.max(22, Math.round(o.lineAdvance) + 6);
  }

  const launch: PillRect | null = o.hasPos
    ? { x: CLUSTER_LEFT, y, width: bw, height: PILL_H }
    : null;
  const cancel: PillRect = {
    x: o.hasPos ? CLUSTER_LEFT + bw + gx : CLUSTER_LEFT,
    y,
    width: bw,
    height: PILL_H,
  };
  return { hintY, minus, plus, massCenter, velY, launch, cancel };
}

export interface CornerClusterLayout {
  exit: PillRect;
  again: PillRect | null;
}

// Top-right EXIT / AGAIN, sized to their labels and right-anchored. On phone
// portrait fits the act-ii eyebrow is wide enough to reach the beside-EXIT
// slot, so AGAIN stacks under EXIT instead of crossing the text.
export function cornerClusterLayout(o: {
  canvasWidth: number;
  measure: (label: string) => number;
  showAgain: boolean;
  viewScale: number;
  phaseRight: number;
}): CornerClusterLayout {
  const exitW = pillWidth(o.measure, CORNER_LABELS.exit, 96);
  const exit: PillRect = {
    x: o.canvasWidth - RIGHT_MARGIN - exitW,
    y: CLUSTER_TOP,
    width: exitW,
    height: PILL_H,
  };
  if (!o.showAgain) return { exit, again: null };

  const againW = pillWidth(o.measure, CORNER_LABELS.again, 110);
  const besideX = exit.x - cornerGap(o.viewScale) - againW;
  const again: PillRect =
    besideX >= o.phaseRight + 8
      ? { x: besideX, y: CLUSTER_TOP, width: againW, height: PILL_H }
      : {
          // Stacked: hug the same right margin as EXIT, one gap below it.
          x: o.canvasWidth - RIGHT_MARGIN - againW,
          y: CLUSTER_TOP + PILL_H + gapY(o.viewScale),
          width: againW,
          height: PILL_H,
        };
  return { exit, again };
}
