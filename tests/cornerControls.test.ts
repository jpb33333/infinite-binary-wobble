import { describe, test, expect } from 'vitest';
import {
  showsCornerAgain,
  sandboxClusterLayout,
  placementHudLayout,
  pillWidth,
  SANDBOX_LABELS,
  PILL_H,
  type PillRect,
} from '../src/render/cornerControls.ts';

// Regression guard for "Again sometimes broken at Humanity is extinct": the
// corner Again must never be registered while a sandbox game-over card owns the
// 'again' action — the last-write-wins registry would otherwise kill the card's
// button (the corner registers after the card).
describe('showsCornerAgain — corner Again never collides with a game-over card', () => {
  const base = {
    state: 'resolved',
    sandboxOutcome: null,
    unravel: false,
    outcomeKind: 'win',
    winCardDismissed: false,
  } as const;

  test('suppressed during EVERY sandbox game-over, even from a dismissed win (the bug)', () => {
    for (const sandboxOutcome of ['extinction', 'collapse', 'ejection'] as const) {
      // dismissed win + game-over = the exact broken case
      expect(showsCornerAgain({ ...base, sandboxOutcome, unravel: true, winCardDismissed: true })).toBe(
        false,
      );
      // and undismissed, for completeness
      expect(
        showsCornerAgain({ ...base, sandboxOutcome, unravel: true, winCardDismissed: false }),
      ).toBe(false);
    }
  });

  test('still shows during the live unravel (no game-over yet)', () => {
    expect(showsCornerAgain({ ...base, unravel: true })).toBe(true);
  });

  test('still shows for a dismissed win with no sandbox', () => {
    expect(showsCornerAgain({ ...base, winCardDismissed: true })).toBe(true);
  });

  test('hidden for an undismissed win, and outside the resolved state', () => {
    expect(showsCornerAgain({ ...base, winCardDismissed: false })).toBe(false);
    expect(showsCornerAgain({ ...base, state: 'simulate', unravel: true })).toBe(false);
  });
});

// ── Sandbox cluster + placement HUD geometry ──
//
// Regression guards for "overlapping Random Star/Planet buttons on iOS": pills
// were fixed 150px rects while labels draw at cpx()-compensated sizes, so on
// phone fits (viewScale ≈ 0.49) the inflated text outgrew its pill and bled
// into the neighbour. The layout now sizes pills to an injected measurer;
// these tests replay the measurer at desktop and phone scales and prove
// (a) desktop stays pixel-identical to the fixed-width era and (b) nothing
// can overlap at phone scales.

// Replica of theme.ts cpx() (FLOOR_PX 11, SLOPE 0.2) — theme.ts keeps its
// viewScale module-private, so tests recompute the compensation per scale.
function cpxAt(designSize: number, viewScale: number): number {
  const onScreen = designSize * viewScale;
  if (onScreen >= 11) return designSize;
  return (11 - (11 - onScreen) * 0.2) / viewScale;
}

// Approximate the drawButton label measurer: 14px semibold sans averages
// ~0.62em per uppercase char (the factor the pill design was tuned against),
// plus the 1.2px letterspacing drawSpacedText adds between chars.
function labelMeasurerAt(viewScale: number): (label: string) => number {
  const size = cpxAt(14, viewScale);
  return label => label.length * size * 0.62 + 1.2 * (label.length - 1);
}

const captionAdvanceAt = (viewScale: number): number => cpxAt(11, viewScale) * 1.35;
const lineAdvanceAt = (viewScale: number): number => cpxAt(12, viewScale) * 1.35;

const intersects = (a: PillRect, b: PillRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const pills = (l: ReturnType<typeof sandboxClusterLayout>): PillRect[] => [
  l.starSet,
  l.starRnd,
  l.planetSet,
  l.planetRnd,
];

// iPhone portrait ≈ 0.49, iPhone 5-era floor ≈ 0.4.
const PHONE_SCALES = [0.4875, 0.4] as const;

describe('sandboxClusterLayout — pills sized to their compensated labels', () => {
  test('desktop (scale 1) is pixel-identical to the fixed-width era', () => {
    const layout = sandboxClusterLayout({
      orientation: 'landscape',
      measure: labelMeasurerAt(1),
      captionAdvance: captionAdvanceAt(1),
    });
    expect(layout.starSet).toEqual({ x: 16, y: 14, width: 150, height: 44 });
    expect(layout.starRnd).toEqual({ x: 174, y: 14, width: 150, height: 44 });
    expect(layout.planetSet).toEqual({ x: 16, y: 68, width: 150, height: 44 });
    expect(layout.planetRnd).toEqual({ x: 174, y: 68, width: 150, height: 44 });
    expect(layout.caption).toEqual({ x: 16, y: 128 });
  });

  test('every pill fits its label with padding at every scale', () => {
    for (const scale of [1, ...PHONE_SCALES]) {
      const measure = labelMeasurerAt(scale);
      for (const label of Object.values(SANDBOX_LABELS)) {
        expect(pillWidth(measure, label)).toBeGreaterThanOrEqual(measure(label) + 20);
      }
    }
  });

  test('phone scales: pills never overlap and the caption clears the grid', () => {
    for (const scale of PHONE_SCALES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const layout = sandboxClusterLayout({
          orientation,
          measure: labelMeasurerAt(scale),
          captionAdvance: captionAdvanceAt(scale),
        });
        const rects = pills(layout);
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++)
            expect(intersects(rects[i], rects[j])).toBe(false);
        // Caption baseline sits below the lowest pill by at least an
        // inflated cap height (~0.75em of the compensated 11px caption).
        const bottom = Math.max(...rects.map(r => r.y + r.height));
        expect(layout.caption.y - bottom).toBeGreaterThanOrEqual(
          (captionAdvanceAt(scale) / 1.35) * 0.75,
        );
      }
    }
  });

  test('portrait single column clears the centred phase label and the corner cluster', () => {
    const PORTRAIT_W = 800;
    for (const scale of PHONE_SCALES) {
      const layout = sandboxClusterLayout({
        orientation: 'portrait',
        measure: labelMeasurerAt(scale),
        captionAdvance: captionAdvanceAt(scale),
      });
      const rects = pills(layout);
      // Single column: all pills share x and width.
      for (const r of rects) {
        expect(r.x).toBe(rects[0].x);
        expect(r.width).toBe(rects[0].width);
      }
      const right = rects[0].x + rects[0].width;
      // "the three-body problem" draws centred at w/2 in cpx(22) serif
      // (~0.48em per char). The column must stay left of its left edge.
      const labelHalf = (cpxAt(22, scale) * 0.48 * 'the three-body problem'.length) / 2;
      expect(right).toBeLessThan(PORTRAIT_W / 2 - labelHalf);
      // And left of the corner Again pill (x = 800 − 16 − 96 − 12 − 110).
      expect(right).toBeLessThan(566);
    }
  });
});

describe('placementHudLayout — measured rows for the Set placement HUD', () => {
  const desktop = { massWidth: 60, lineAdvance: lineAdvanceAt(1) };

  test('desktop star flow is pixel-identical to the fixed-offset era', () => {
    const layout = placementHudLayout({ kind: 'star', hasPos: true, hasVel: true, ...desktop });
    expect(layout.hintY).toBe(22);
    expect(layout.minus).toEqual({ x: 16, y: 40, width: 40, height: 40 });
    expect(layout.plus).toEqual({ x: 140, y: 40, width: 40, height: 40 });
    expect(layout.massCenter).toEqual({ x: 98, y: 60 });
    expect(layout.velY).toBe(96);
    expect(layout.launch).toEqual({ x: 16, y: 114, width: 110, height: PILL_H });
    expect(layout.cancel).toEqual({ x: 134, y: 114, width: 110, height: PILL_H });
  });

  test('desktop planet flow: no mass/velocity rows, buttons right below the hint', () => {
    const layout = placementHudLayout({ kind: 'planet', hasPos: false, hasVel: false, ...desktop });
    expect(layout.minus).toBeNull();
    expect(layout.velY).toBeNull();
    expect(layout.launch).toBeNull();
    expect(layout.cancel).toEqual({ x: 16, y: 40, width: 110, height: PILL_H });
  });

  test('phone scales: mass readout, velocity line, and buttons never collide', () => {
    for (const scale of PHONE_SCALES) {
      const lineAdvance = lineAdvanceAt(scale);
      // "mass 5.0" at compensated 15px serif (~0.5em per char).
      const massWidth = cpxAt(15, scale) * 0.5 * 'mass 5.0'.length;
      const layout = placementHudLayout({
        kind: 'star',
        hasPos: true,
        hasVel: true,
        massWidth,
        lineAdvance,
      });
      const minus = layout.minus!;
      const plus = layout.plus!;
      // The gap between − and + holds the widest readout with breathing room.
      expect(plus.x - (minus.x + minus.width)).toBeGreaterThanOrEqual(massWidth + 16);
      // Velocity baseline clears the mass pills by an inflated cap height.
      const massBottom = minus.y + minus.height;
      expect(layout.velY! - massBottom).toBeGreaterThanOrEqual((lineAdvance / 1.35) * 0.6);
      // Launch/Cancel sit fully below the velocity baseline.
      expect(layout.launch!.y).toBeGreaterThan(layout.velY!);
      expect(layout.cancel.y).toBe(layout.launch!.y);
    }
  });
});
