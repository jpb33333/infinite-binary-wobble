import { describe, it, expect } from 'vitest';
import { computeFit } from '../src/render/fit.ts';

const DW = 1280;
const DH = 800;

describe('computeFit', () => {
  it('is identity when the viewport matches the design space', () => {
    const f = computeFit(DW, DH, DW, DH);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBe(0);
  });

  it('letterboxes left/right on a wider-than-design viewport (height-bound)', () => {
    // 2000×800 — same height, extra width. Scale is height-bound (= 1).
    const f = computeFit(2000, 800, DW, DH);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe((2000 - 1280) / 2); // 360 each side
    expect(f.offsetY).toBe(0);
  });

  it('letterboxes top/bottom on a taller-than-design viewport (width-bound)', () => {
    // 1280×1200 — same width, extra height. Scale is width-bound (= 1).
    const f = computeFit(1280, 1200, DW, DH);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBe((1200 - 800) / 2); // 200 top and bottom
  });

  it('scales up uniformly to fill a larger window and stays centered', () => {
    // 2560×1600 is exactly 2× the design space — perfect fit, no margins.
    const f = computeFit(2560, 1600, DW, DH);
    expect(f.scale).toBe(2);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBe(0);
  });

  it('scales down to fit a small window, choosing the limiting axis', () => {
    // 640×800 — width-bound. scale = 640/1280 = 0.5.
    const f = computeFit(640, 800, DW, DH);
    expect(f.scale).toBe(0.5);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBeCloseTo((800 - 800 * 0.5) / 2); // 200
  });

  it('keeps the design aspect ratio (no axis distortion)', () => {
    // An extreme ultrawide: the rendered court must stay 1280×800 in ratio.
    const f = computeFit(3440, 900, DW, DH);
    const renderedW = DW * f.scale;
    const renderedH = DH * f.scale;
    expect(renderedW / renderedH).toBeCloseTo(DW / DH);
    // Height-bound here (900/800 < 3440/1280), so margins are horizontal.
    expect(f.offsetY).toBe(0);
    expect(f.offsetX).toBeGreaterThan(0);
  });
});
