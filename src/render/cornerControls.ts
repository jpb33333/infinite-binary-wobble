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

// ── Sandbox cluster + placement HUD geometry ──
//
// Why this exists: the act-2 pills used to be fixed 150px rects while their
// labels are drawn at cpx()-compensated sizes. On phone fits (viewScale ≈ 0.5)
// the legibility floor inflates a 14px label to ~21 design px, so "RANDOM
// PLANET" outgrew its pill and bled into the neighbour 8px away — overlapping
// buttons on iOS while desktop (viewScale ≥ 1, no compensation) looked fine.
// Fix: pure layout that sizes each pill to its measured compensated label.
// The Renderer injects the measurer (canvas text metrics); tests inject fakes,
// so non-overlap is provable here without a canvas. Draw + hit-test share the
// returned rects, so they can never disagree.

export interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CLUSTER_LEFT = 16;
const CLUSTER_TOP = 14;
export const PILL_H = 44;
const GAP_X = 8;
const GAP_Y = 10;
// Side padding inside a pill around the measured label. 10px keeps every pill
// at exactly the old 150px on desktop fits (widest label ≈ 127px there), so
// scale-1 layouts are pixel-identical to the fixed-width era.
const PILL_PAD_X = 10;
const PILL_MIN_W = 150;

export function pillWidth(measure: (label: string) => number, label: string): number {
  return Math.max(PILL_MIN_W, Math.ceil(measure(label)) + PILL_PAD_X * 2);
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
// to their widest label. Portrait: a single column — the centred "the
// three-body problem" phase label owns the top-middle of an 800px-wide space,
// and measured pills in two columns would reach into it on phone fits.
export function sandboxClusterLayout(o: {
  orientation: 'landscape' | 'portrait';
  measure: (label: string) => number;
  // lineHeightFor(11) from the caller — the caption's advance once compensated.
  captionAdvance: number;
}): SandboxClusterLayout {
  const wSetStar = pillWidth(o.measure, SANDBOX_LABELS.starSet);
  const wRndStar = pillWidth(o.measure, SANDBOX_LABELS.starRnd);
  const wSetPlanet = pillWidth(o.measure, SANDBOX_LABELS.planetSet);
  const wRndPlanet = pillWidth(o.measure, SANDBOX_LABELS.planetRnd);
  // max(16, advance): scale-1 advance is ~15, so desktop keeps the old fixed
  // 16px gap exactly; inflated captions get the room they measure.
  const captionGap = Math.max(16, Math.round(o.captionAdvance));

  if (o.orientation === 'portrait') {
    const w = Math.max(wSetStar, wRndStar, wSetPlanet, wRndPlanet);
    const rect = (row: number): PillRect => ({
      x: CLUSTER_LEFT,
      y: CLUSTER_TOP + row * (PILL_H + GAP_Y),
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
  const x2 = CLUSTER_LEFT + colL + GAP_X;
  const row2 = CLUSTER_TOP + PILL_H + GAP_Y;
  return {
    starSet: { x: CLUSTER_LEFT, y: CLUSTER_TOP, width: colL, height: PILL_H },
    starRnd: { x: x2, y: CLUSTER_TOP, width: colR, height: PILL_H },
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
// mass readout that compensated text exactly fills on phone fits, and fixed
// row advances that inflated lines overprint. Rows advance by
// max(old constant, measured advance), so desktop keeps the old rhythm to the
// pixel and phone fits get the room the text actually needs.
export function placementHudLayout(o: {
  kind: 'star' | 'planet';
  hasPos: boolean;
  hasVel: boolean;
  // Width of the widest mass readout ("mass 5.0") as drawn — sized to the
  // maximum so the +/- pills don't jitter as the value changes.
  massWidth: number;
  // lineHeightFor(12) — the hint and velocity lines' compensated advance.
  lineAdvance: number;
}): PlacementHudLayout {
  const top = CLUSTER_TOP;
  const hintY = top + 8;
  // Old rhythm: mass row at top+26, i.e. 18 below the hint baseline.
  let y = hintY + Math.max(18, Math.round(o.lineAdvance) + 2);

  let minus: PillRect | null = null;
  let plus: PillRect | null = null;
  let massCenter: { x: number; y: number } | null = null;
  if (o.kind === 'star') {
    const pill = 40;
    const massGap = Math.max(84, Math.ceil(o.massWidth) + 16);
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

  const bw = 110;
  const launch: PillRect | null = o.hasPos
    ? { x: CLUSTER_LEFT, y, width: bw, height: PILL_H }
    : null;
  const cancel: PillRect = {
    x: o.hasPos ? CLUSTER_LEFT + bw + GAP_X : CLUSTER_LEFT,
    y,
    width: bw,
    height: PILL_H,
  };
  return { hintY, minus, plus, massCenter, velY, launch, cancel };
}
