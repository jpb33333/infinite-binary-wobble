import { describe, test, expect } from 'vitest';
import {
  showsCornerAgain,
  actForFrame,
  ACT_EYEBROWS,
  sandboxClusterLayout,
  placementHudLayout,
  cornerClusterLayout,
  musicPillLayout,
  hudTop,
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
    for (const sandboxOutcome of ['extinction', 'ejection', 'detected', 'survived'] as const) {
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

// ── Act titling ──
//
// The game continuing past the two-body waltz is a SURPRISE: act 1's eyebrow
// carries only the game's name, and the first "ACT II" appears exactly when the
// sandbox does (win card dismissed, or a third body already loose). That reveal
// retroactively names what came before.
describe('actForFrame — the act-ii reveal fires with the sandbox, never before', () => {
  const base = {
    state: 'simulate',
    unravel: false,
    outcomeKind: null as string | null,
    winCardDismissed: false,
    darkForest: false,
  };

  test('act 1 through setup, simulate, and every LOSE resolution', () => {
    expect(actForFrame({ ...base, state: 'setup_p1' })).toBe(1);
    expect(actForFrame({ ...base })).toBe(1);
    for (const kind of ['lose_escape', 'lose_slingshot', 'lose_collision']) {
      expect(actForFrame({ ...base, state: 'resolved', outcomeKind: kind })).toBe(1);
    }
  });

  test('act 1 while the WIN card is still up — no spoiler behind the card', () => {
    expect(actForFrame({ ...base, state: 'resolved', outcomeKind: 'win' })).toBe(1);
  });

  test('act 2 the moment the win card is dismissed (sandbox controls appear)', () => {
    expect(
      actForFrame({ ...base, state: 'resolved', outcomeKind: 'win', winCardDismissed: true }),
    ).toBe(2);
  });

  test('act 2 whenever the unravel is live, including sandbox game-overs', () => {
    expect(actForFrame({ ...base, state: 'resolved', unravel: true })).toBe(2);
    expect(
      actForFrame({ ...base, state: 'resolved', outcomeKind: 'win', unravel: true }),
    ).toBe(2);
  });

  test('act 3 the moment the dark forest wakes, and it outranks the act-2 cases', () => {
    expect(actForFrame({ ...base, state: 'resolved', darkForest: true })).toBe(3);
    expect(
      actForFrame({
        ...base,
        state: 'resolved',
        outcomeKind: 'win',
        winCardDismissed: true,
        unravel: true,
        darkForest: true,
      }),
    ).toBe(3);
  });

  test('eyebrow copy: act 1 never says "act", acts 2 and 3 name the reveals', () => {
    expect(ACT_EYEBROWS[1]).toBe('INFINITE BINARY WOBBLE');
    expect(ACT_EYEBROWS[2]).toBe('ACT II · THE THREE-BODY PROBLEM');
    expect(ACT_EYEBROWS[3]).toBe('ACT III · THE FERMI PARADOX');
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

// The centred phase block as the Renderer measures it: eyebrow at cpx(11) sans
// (~0.62em/char), serif line at cpx(22) (~0.48em/char). Left edge of the wider
// line, and the serif baseline band's bottom (middle-anchored at y=64).
function phaseAt(viewScale: number, canvasW: number, eyebrow: string, serif: string) {
  const eyebrowW = eyebrow.length * cpxAt(11, viewScale) * 0.62;
  const serifW = serif.length * cpxAt(22, viewScale) * 0.48;
  const half = Math.max(eyebrowW, serifW) / 2;
  return {
    left: canvasW / 2 - half,
    right: canvasW / 2 + half,
    bottom: 64 + (cpxAt(22, viewScale) * 1.35) / 2,
  };
}

const ACT2_SERIF = 'no stable solution';

const intersects = (a: PillRect, b: PillRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const pills = (l: ReturnType<typeof sandboxClusterLayout>): PillRect[] => [
  l.starSet,
  l.starRnd,
  l.planetSet,
  l.planetRnd,
];

// iPhone portrait ≈ 0.49, Safari-toolbar landscape ≈ 0.43/0.37, iPhone 5-era ≈ 0.4.
const PHONE_SCALES = [0.4875, 0.428, 0.4, 0.367] as const;

const desktopPhase = (orientation: 'landscape' | 'portrait') =>
  phaseAt(1, orientation === 'landscape' ? 1280 : 800, ACT_EYEBROWS[2], ACT2_SERIF);

describe('hudTop — the left HUD yields to the phase block instead of crossing it', () => {
  test('stays at the legacy 14 when there is clear air', () => {
    expect(hudTop({ hudRight: 401, phaseLeft: 545, phaseBottom: 79 })).toBe(14);
  });
  test('drops below the phase block when the HUD would reach into it', () => {
    expect(hudTop({ hudRight: 502, phaseLeft: 406, phaseBottom: 82 })).toBe(98);
  });
  test('boundary: exactly 24px of air keeps the legacy top', () => {
    expect(hudTop({ hudRight: 400, phaseLeft: 424, phaseBottom: 80 })).toBe(14);
    expect(hudTop({ hudRight: 401, phaseLeft: 424, phaseBottom: 80 })).toBe(96);
  });
});

describe('sandboxClusterLayout — pills sized to their compensated labels', () => {
  test('desktop (scale 1) is pixel-identical to the fixed-width era', () => {
    const layout = sandboxClusterLayout({
      orientation: 'landscape',
      measure: labelMeasurerAt(1),
      captionAdvance: captionAdvanceAt(1),
      goDark: null,
      captionWidth: 0,
      viewScale: 1,
      phase: desktopPhase('landscape'),
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

  test('phone scales: pills never overlap, gaps hold ≥8/10 CSS px, caption clears the grid', () => {
    for (const scale of PHONE_SCALES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const canvasW = orientation === 'landscape' ? 1280 : 800;
        const layout = sandboxClusterLayout({
          orientation,
          measure: labelMeasurerAt(scale),
          captionAdvance: captionAdvanceAt(scale),
          goDark: null,
          captionWidth: 0,
          viewScale: scale,
          phase: phaseAt(scale, canvasW, ACT_EYEBROWS[2], ACT2_SERIF),
        });
        const rects = pills(layout);
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++)
            expect(intersects(rects[i], rects[j])).toBe(false);
        // Neighbouring pills keep at least 8 (x) / 10 (y) CSS px of visible air.
        if (orientation === 'landscape') {
          expect((layout.starRnd.x - (layout.starSet.x + layout.starSet.width)) * scale)
            .toBeGreaterThanOrEqual(8 - 1e-9);
        }
        const rows = orientation === 'landscape' ? [layout.planetSet] : [layout.starRnd];
        expect((rows[0].y - (layout.starSet.y + layout.starSet.height)) * scale)
          .toBeGreaterThanOrEqual(10 - 1e-9);
        // Caption baseline sits below the lowest pill by at least an
        // inflated cap height (~0.75em of the compensated 11px caption).
        const bottom = Math.max(...rects.map(r => r.y + r.height));
        expect(layout.caption.y - bottom).toBeGreaterThanOrEqual(
          (captionAdvanceAt(scale) / 1.35) * 0.75,
        );
      }
    }
  });

  test('the cluster never crosses the act-ii phase block: clear air or dropped below', () => {
    for (const scale of [1, ...PHONE_SCALES]) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const canvasW = orientation === 'landscape' ? 1280 : 800;
        const phase = phaseAt(scale, canvasW, ACT_EYEBROWS[2], ACT2_SERIF);
        const layout = sandboxClusterLayout({
          orientation,
          measure: labelMeasurerAt(scale),
          captionAdvance: captionAdvanceAt(scale),
          goDark: null,
          captionWidth: 0,
          viewScale: scale,
          phase,
        });
        const right = Math.max(...pills(layout).map(r => r.x + r.width));
        const top = Math.min(...pills(layout).map(r => r.y));
        expect(right + 24 <= phase.left || top >= phase.bottom + 16).toBe(true);
      }
    }
  });

  test('desktop never drops: scale-1 keeps the legacy top in both orientations', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const layout = sandboxClusterLayout({
        orientation,
        measure: labelMeasurerAt(1),
        captionAdvance: captionAdvanceAt(1),
      goDark: null,
      captionWidth: 0,
        viewScale: 1,
        phase: desktopPhase(orientation),
      });
      expect(layout.starSet.y).toBe(14);
    }
  });
});

describe('placementHudLayout — measured rows for the Set placement HUD', () => {
  // Hint strings as the Renderer draws them, cpx(12) sans ≈ 0.55em/char.
  const hintWidthAt = (scale: number): number =>
    'Tap to move · drag the star to aim · LAUNCH'.length * cpxAt(12, scale) * 0.55;
  const desktop = {
    massWidth: 60,
    lineAdvance: lineAdvanceAt(1),
    measure: labelMeasurerAt(1),
    viewScale: 1,
    hintWidth: hintWidthAt(1),
    phase: desktopPhase('landscape'),
  };

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

  test('phone scales: Launch/Cancel fit their labels and keep ≥8 CSS px of air', () => {
    for (const scale of PHONE_SCALES) {
      const measure = labelMeasurerAt(scale);
      const layout = placementHudLayout({
        kind: 'star',
        hasPos: true,
        hasVel: true,
        massWidth: cpxAt(15, scale) * 0.5 * 'mass 5.0'.length,
        lineAdvance: lineAdvanceAt(scale),
        measure,
        viewScale: scale,
        hintWidth: hintWidthAt(scale),
        phase: phaseAt(scale, 1280, ACT_EYEBROWS[2], ACT2_SERIF),
      });
      const launch = layout.launch!;
      const cancel = layout.cancel;
      // Labels fit inside their pills with the same padding as the cluster.
      expect(launch.width).toBeGreaterThanOrEqual(measure('Launch') + 20);
      expect(cancel.width).toBeGreaterThanOrEqual(measure('Cancel') + 20);
      // The pair shares one width and keeps visible air between the pills.
      expect(cancel.width).toBe(launch.width);
      expect((cancel.x - (launch.x + launch.width)) * scale).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(intersects(launch, cancel)).toBe(false);
    }
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
        measure: labelMeasurerAt(scale),
        viewScale: scale,
        hintWidth: hintWidthAt(scale),
        phase: phaseAt(scale, 1280, ACT_EYEBROWS[2], ACT2_SERIF),
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

  test('the whole HUD — hint included — clears the phase block or drops below it', () => {
    for (const scale of PHONE_SCALES) {
      for (const canvasW of [1280, 800]) {
        const phase = phaseAt(scale, canvasW, ACT_EYEBROWS[2], ACT2_SERIF);
        const hintWidth = hintWidthAt(scale);
        const layout = placementHudLayout({
          kind: 'star',
          hasPos: true,
          hasVel: true,
          massWidth: cpxAt(15, scale) * 0.5 * 'mass 5.0'.length,
          lineAdvance: lineAdvanceAt(scale),
          measure: labelMeasurerAt(scale),
          viewScale: scale,
          hintWidth,
          phase,
        });
        const right = Math.max(16 + hintWidth, layout.cancel.x + layout.cancel.width);
        expect(right + 24 <= phase.left || layout.hintY - 8 >= phase.bottom + 16).toBe(true);
      }
    }
  });
});

describe('cornerClusterLayout — EXIT/AGAIN sized to their labels, yielding to the eyebrow', () => {
  test('desktop (scale 1) is pixel-identical to the fixed-width era', () => {
    for (const [canvasW, phase] of [
      [1280, desktopPhase('landscape')],
      [800, desktopPhase('portrait')],
    ] as const) {
      const layout = cornerClusterLayout({
        canvasWidth: canvasW,
        measure: labelMeasurerAt(1),
        showAgain: true,
        viewScale: 1,
        phaseRight: phase.right,
      });
      expect(layout.exit).toEqual({ x: canvasW - 16 - 96, y: 14, width: 96, height: PILL_H });
      expect(layout.again).toEqual({
        x: canvasW - 16 - 96 - 12 - 110,
        y: 14,
        width: 110,
        height: PILL_H,
      });
    }
  });

  test('phone scales: labels fit and the pair never crosses the act-ii eyebrow', () => {
    for (const scale of PHONE_SCALES) {
      for (const canvasW of [1280, 800]) {
        const measure = labelMeasurerAt(scale);
        const phase = phaseAt(scale, canvasW, ACT_EYEBROWS[2], ACT2_SERIF);
        const layout = cornerClusterLayout({
          canvasWidth: canvasW,
          measure,
          showAgain: true,
          viewScale: scale,
          phaseRight: phase.right,
        });
        expect(layout.exit.width).toBeGreaterThanOrEqual(measure('Exit') + 20);
        expect(layout.again!.width).toBeGreaterThanOrEqual(measure('Again') + 20);
        expect(intersects(layout.exit, layout.again!)).toBe(false);
        // Either beside with visible air, or stacked below the exit pill.
        const beside = layout.again!.y === layout.exit.y;
        if (beside) {
          expect(layout.again!.x).toBeGreaterThanOrEqual(phase.right + 8);
          expect((layout.exit.x - (layout.again!.x + layout.again!.width)) * scale)
            .toBeGreaterThanOrEqual(8 - 1e-9);
        } else {
          expect(layout.again!.y - (layout.exit.y + layout.exit.height)).toBeGreaterThan(0);
          // Stacked pill hugs the same right margin as the exit pill.
          expect(layout.again!.x + layout.again!.width).toBe(layout.exit.x + layout.exit.width);
        }
      }
    }
  });

  test('no Again: exit alone, same right-anchored geometry at any scale', () => {
    const layout = cornerClusterLayout({
      canvasWidth: 800,
      measure: labelMeasurerAt(0.428),
      showAgain: false,
      viewScale: 0.428,
      phaseRight: phaseAt(0.428, 800, ACT_EYEBROWS[1], 'in motion').right,
    });
    expect(layout.again).toBeNull();
    expect(layout.exit.x + layout.exit.width).toBe(800 - 16);
  });
});

// ── Act III: the GO DARK row ──
//
// Once the dark forest wakes, a full-width toggle pill joins the sandbox
// cluster (below the 2×2 grid / column), and the caption drops below it. The
// pill must fit the WIDER of its two labels ("Running Dark") so toggling never
// reflows the cluster. In act 3 the centred block the HUD yields to is the
// phase block PLUS the visibility meter (renderer passes left = min(phase,
// meter edge), bottom = meter bottom) — the caption's own width joins the
// yield input there, since the caption's band overlaps the meter's.
describe('sandboxClusterLayout — the act-3 GO DARK row', () => {
  const GO_DARK_SERIF = 'where is everybody?';
  // Sandbox caption ≈ 56 chars at compensated italic 11px (~0.42em/char).
  const captionWidthAt = (scale: number): number => 56 * cpxAt(11, scale) * 0.42;
  // The act-3 centred block as the renderer builds it: phase strings widened to
  // the meter's 300px bar, bottom at the meter's foot (meter top clears the
  // compensated serif band + the meter's own label line — Renderer.meterTop).
  const meterBlockAt = (scale: number, canvasW: number) => {
    const phase = phaseAt(scale, canvasW, ACT_EYEBROWS[3], GO_DARK_SERIF);
    const meterLeft = (canvasW - 300) / 2;
    const meterTop = Math.max(
      96,
      Math.ceil(64 + (cpxAt(22, scale) * 1.35) / 2 + cpxAt(11, scale) * 1.35 + 4),
    );
    return {
      left: Math.min(phase.left, meterLeft),
      right: canvasW - meterLeft,
      bottom: meterTop + 64,
    };
  };

  test('desktop landscape: full-width pill spans the grid, caption drops below it', () => {
    const layout = sandboxClusterLayout({
      orientation: 'landscape',
      measure: labelMeasurerAt(1),
      captionAdvance: captionAdvanceAt(1),
      viewScale: 1,
      phase: meterBlockAt(1, 1280),
      goDark: 'idle',
      captionWidth: captionWidthAt(1),
    });
    const gd = layout.goDark!;
    expect(gd).toEqual({ x: 16, y: 122, width: 308, height: PILL_H });
    expect(layout.caption).toEqual({ x: 16, y: 182 });
  });

  test('goDark: null keeps the #74 cluster byte-identical (no row, old caption)', () => {
    const layout = sandboxClusterLayout({
      orientation: 'landscape',
      measure: labelMeasurerAt(1),
      captionAdvance: captionAdvanceAt(1),
      viewScale: 1,
      phase: desktopPhase('landscape'),
      goDark: null,
      captionWidth: 0,
    });
    expect(layout.goDark).toBeNull();
    expect(layout.caption).toEqual({ x: 16, y: 128 });
  });

  test('phone scales: the row fits RUNNING DARK, overlaps nothing, caption clears it', () => {
    for (const scale of PHONE_SCALES) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const canvasW = orientation === 'landscape' ? 1280 : 800;
        const measure = labelMeasurerAt(scale);
        const layout = sandboxClusterLayout({
          orientation,
          measure,
          captionAdvance: captionAdvanceAt(scale),
          viewScale: scale,
          phase: meterBlockAt(scale, canvasW),
          goDark: 'dark',
          captionWidth: captionWidthAt(scale),
        });
        const gd = layout.goDark!;
        expect(gd.width).toBeGreaterThanOrEqual(measure('Running Dark') + 20);
        for (const r of pills(layout)) expect(intersects(r, gd)).toBe(false);
        expect(layout.caption.y - (gd.y + gd.height)).toBeGreaterThanOrEqual(
          (captionAdvanceAt(scale) / 1.35) * 0.75,
        );
      }
    }
  });

  test('with the meter block, the whole cluster (caption included) clears it or drops', () => {
    for (const scale of [1, ...PHONE_SCALES]) {
      for (const orientation of ['landscape', 'portrait'] as const) {
        const canvasW = orientation === 'landscape' ? 1280 : 800;
        const block = meterBlockAt(scale, canvasW);
        const captionWidth = captionWidthAt(scale);
        const layout = sandboxClusterLayout({
          orientation,
          measure: labelMeasurerAt(scale),
          captionAdvance: captionAdvanceAt(scale),
          viewScale: scale,
          phase: block,
          goDark: 'idle',
          captionWidth,
        });
        const right = Math.max(...pills(layout).map(r => r.x + r.width), 16 + captionWidth);
        const top = Math.min(...pills(layout).map(r => r.y));
        expect(right + 24 <= block.left || top >= block.bottom + 16).toBe(true);
      }
    }
  });
});

// ── The music pill ──
//
// A quiet ♪ anchored bottom-right in every state — the one control that lives
// on the canvas floor. Measured like every pill since #74; nothing overlaps it
// down there (metrics flow from bottom-left and truncate; hints are centred).
describe('musicPillLayout — bottom-right anchor in both design spaces', () => {
  test('anchors 16px off the corner with a finger-sized pill at any scale', () => {
    for (const scale of [1, ...PHONE_SCALES]) {
      for (const [cw, ch] of [
        [1280, 800],
        [800, 1280],
      ] as const) {
        const pill = musicPillLayout({
          canvasWidth: cw,
          canvasHeight: ch,
          measure: labelMeasurerAt(scale),
        });
        expect(pill.x + pill.width).toBe(cw - 16);
        expect(pill.y + pill.height).toBe(ch - 16);
        expect(pill.width).toBeGreaterThanOrEqual(48);
        expect(pill.height).toBe(PILL_H);
      }
    }
  });
});

// Planets aim now: an aimed planet shows the velocity readout row and the
// buttons cascade below it (mass row stays star-only).
describe('placementHudLayout — aimed planets read out their velocity', () => {
  const desktopBase = {
    massWidth: 60,
    lineAdvance: lineAdvanceAt(1),
    measure: labelMeasurerAt(1),
    viewScale: 1,
    hintWidth: 300,
    phase: desktopPhase('landscape'),
  };

  test('desktop planet with pos+vel: no mass row, velocity row, buttons below', () => {
    const layout = placementHudLayout({ kind: 'planet', hasPos: true, hasVel: true, ...desktopBase });
    expect(layout.minus).toBeNull();
    expect(layout.velY).not.toBeNull();
    expect(layout.launch!.y).toBeGreaterThan(layout.velY!);
    expect(layout.cancel.y).toBe(layout.launch!.y);
  });

  test('an unaimed planet still shows no velocity row', () => {
    const layout = placementHudLayout({ kind: 'planet', hasPos: false, hasVel: false, ...desktopBase });
    expect(layout.velY).toBeNull();
  });
});
