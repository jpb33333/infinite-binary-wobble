import { describe, test, expect } from 'vitest';
import { hudColumnAdvance } from '../src/render/overlay.ts';

// Regression guard for the metrics-row pileup on phone fits ("SEPARATIO/REL.
// SPEED"): drawHud advanced columns by max(140, valueWidth + 60) — with the
// value measured in the WRONG font (the 11px label font; the ctx had already
// been switched back), and with the label's own width ignored entirely. The
// legibility floor inflates an uppercase label like SEPARATION past the 140px
// column floor, so neighbouring columns overprinted. Columns now advance by
// the widest of the floor, the label, and the correctly-measured value.
describe('hudColumnAdvance — metrics columns clear both their label and value', () => {
  test('desktop identity: every current field stays on the legacy 140 grid', () => {
    // Widest scale-1 fields: label "SEPARATION" ≈ 68px at 11px sans, value
    // "1236 px/s" ≈ 90px at 18px serif. The 140 floor must still win.
    expect(hudColumnAdvance(68, 90)).toBe(140);
    expect(hudColumnAdvance(0, 0)).toBe(140);
    expect(hudColumnAdvance(112, 116)).toBe(140);
  });

  test('phone fits: inflated labels and values push the column wide enough', () => {
    // "SEPARATION" at compensated ~26px ≈ 162px wide: the next column must
    // start past it with air.
    expect(hudColumnAdvance(162, 120)).toBe(190);
    // A wide value (e.g. "1236 px/s" at compensated 27.6px serif ≈ 124px)
    // must clear even when the label is short.
    expect(hudColumnAdvance(60, 200)).toBe(224);
  });

  test('never regresses below the legacy floor', () => {
    expect(hudColumnAdvance(10, 10)).toBeGreaterThanOrEqual(140);
  });
});
