import { describe, test, expect } from 'vitest';
import {
  DEFAULT_LAYOUT,
  PORTRAIT_LAYOUT,
  layoutForViewport,
  defaultSpec,
  type CourtLayout,
} from '../src/game/states.ts';
import { DEFAULT_OUTCOME_CONFIG } from '../src/game/outcomes.ts';

// Geometry invariants every court layout must hold. The render helpers, the
// UI clamps (clampToInBounds pad 24) and the outcome thresholds all assume
// these; a layout that violates them produces unreachable stars or buttons
// drawn outside the canvas.

const PAD = 24; // clampToInBounds keeps the star this far inside the box

function rectInside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function checkLayout(layout: CourtLayout): void {
  const { canvas, p1Region, p2Region, p1InBounds, p2InBounds, centerLine } = layout;

  // The two regions tile the canvas exactly along the split axis.
  if (centerLine.axis === 'vertical') {
    expect(p1Region.x).toBe(0);
    expect(p1Region.x + p1Region.width).toBe(centerLine.at);
    expect(p2Region.x).toBe(centerLine.at);
    expect(p2Region.x + p2Region.width).toBe(canvas.width);
    expect(p1Region.height).toBe(canvas.height);
    expect(p2Region.height).toBe(canvas.height);
  } else {
    expect(p1Region.y).toBe(0);
    expect(p1Region.y + p1Region.height).toBe(centerLine.at);
    expect(p2Region.y).toBe(centerLine.at);
    expect(p2Region.y + p2Region.height).toBe(canvas.height);
    expect(p1Region.width).toBe(canvas.width);
    expect(p2Region.width).toBe(canvas.width);
  }

  // In-bounds boxes sit fully inside their owner's region, both players get
  // identically-sized boxes, and the boxes are roomier than the clamp pad.
  expect(rectInside(p1InBounds, p1Region)).toBe(true);
  expect(rectInside(p2InBounds, p2Region)).toBe(true);
  expect(p1InBounds.width).toBe(p2InBounds.width);
  expect(p1InBounds.height).toBe(p2InBounds.height);
  expect(p1InBounds.width).toBeGreaterThan(PAD * 2);
  expect(p1InBounds.height).toBeGreaterThan(PAD * 2);

  // Fresh specs start at the center of their in-bounds box.
  for (const player of [1, 2] as const) {
    const spec = defaultSpec(player, layout);
    const box = player === 1 ? p1InBounds : p2InBounds;
    expect(spec.pos.x).toBe(box.x + box.width / 2);
    expect(spec.pos.y).toBe(box.y + box.height / 2);
  }
}

describe('court layouts', () => {
  test('landscape layout holds the geometry invariants', () => {
    checkLayout(DEFAULT_LAYOUT);
  });

  test('portrait layout holds the geometry invariants', () => {
    checkLayout(PORTRAIT_LAYOUT);
  });

  test('portrait is the transpose of landscape, preserving the outcome envelope', () => {
    // The 820 px barycenter-distance bound was tuned against the landscape
    // half-diagonal. The portrait design space must keep that envelope —
    // a transposed canvas does so exactly.
    expect(PORTRAIT_LAYOUT.canvas.width).toBe(DEFAULT_LAYOUT.canvas.height);
    expect(PORTRAIT_LAYOUT.canvas.height).toBe(DEFAULT_LAYOUT.canvas.width);
    const halfDiag = (c: { width: number; height: number }) =>
      Math.hypot(c.width / 2, c.height / 2);
    expect(halfDiag(PORTRAIT_LAYOUT.canvas)).toBeCloseTo(
      halfDiag(DEFAULT_LAYOUT.canvas),
      10,
    );
    // …and the tuned bound clears the half-diagonal in both, so a winning
    // orbit envelope fits on screen either way.
    expect(DEFAULT_OUTCOME_CONFIG.maxBodyDistanceFromBarycenter).toBeGreaterThan(
      halfDiag(DEFAULT_LAYOUT.canvas),
    );
  });

  test('layoutForViewport picks by aspect, landscape on ties', () => {
    expect(layoutForViewport(1280, 800)).toBe(DEFAULT_LAYOUT);
    expect(layoutForViewport(390, 844)).toBe(PORTRAIT_LAYOUT);
    expect(layoutForViewport(844, 390)).toBe(DEFAULT_LAYOUT);
    expect(layoutForViewport(800, 800)).toBe(DEFAULT_LAYOUT);
  });
});
