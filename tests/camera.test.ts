import { describe, test, expect } from 'vitest';
import {
  CAMERA_MIN_ZOOM,
  COM_GLIDE,
  cameraFitRadius,
  planetEjectRadius,
  seedGlide,
  glideStep,
} from '../src/game/camera.ts';

// The post-win unravel lets a planet slingshot freely (no leash). A planet flung
// past planetEjectRadius is a LOSE — and the boundary is defined so the planet is
// still on screen, at the readable edge, the instant it's declared lost. These
// prove that geometry, so the "is it readable when zoomed out?" question has a
// answer that can't silently drift.

describe('planet ejection boundary ties to the camera’s furthest pull-back', () => {
  // Short axis of both design spaces (1280×800 and its 800×1280 transpose) is 800.
  const minDim = 800;

  test('a planet at the boundary sits exactly at the fit margin when fully zoomed out', () => {
    // This is the load-bearing invariant: eject distance × min zoom = fit radius.
    // So at the moment of loss, viewed at the most-zoomed-out the camera ever
    // gets, the planet is right at the margin edge — visible, not off-screen.
    expect(planetEjectRadius(minDim) * CAMERA_MIN_ZOOM).toBeCloseTo(cameraFitRadius(minDim), 9);
  });

  test('the camera pulls back to 5× and the boundary follows it (≈1600 px)', () => {
    expect(CAMERA_MIN_ZOOM).toBeCloseTo(0.2, 9); // 5× wider view
    expect(planetEjectRadius(minDim)).toBeCloseTo(1600, 9); // fitRadius (320) / 0.2
  });

  test('the boundary is far outside the normal (zoom = 1) view, so it takes a real slingshot', () => {
    // At zoom 1 the system fills cameraFitRadius; the boundary is 1/MIN_ZOOM = 4×
    // further out, so a planet only ejects after genuinely being flung away.
    expect(planetEjectRadius(minDim)).toBeCloseTo(cameraFitRadius(minDim) / CAMERA_MIN_ZOOM, 9);
    expect(planetEjectRadius(minDim)).toBeGreaterThan(cameraFitRadius(minDim) * 3.9);
  });

  test('the geometry scales with the frame and is never degenerate', () => {
    // Larger frame → proportionally larger boundary; always positive and ordered.
    expect(planetEjectRadius(1600)).toBeCloseTo(planetEjectRadius(800) * 2, 9);
    expect(cameraFitRadius(minDim)).toBeGreaterThan(0);
    expect(planetEjectRadius(minDim)).toBeGreaterThan(cameraFitRadius(minDim));
  });
});

// The COM glide: when the tracked barycenter jumps (a star added, a runaway
// stripped from the bound core, a graze annihilation), the camera's viewed
// point must stay continuous and then ease home — never snap-cut.
describe('COM glide (snap absorber)', () => {
  test('seeding preserves the viewed point exactly across a COM jump', () => {
    const prevView = { x: 10, y: 5 };
    const nextCOM = { x: 310, y: -95 }; // a ~300 px membership jump
    const delta = seedGlide(prevView, nextCOM);
    expect(nextCOM.x + delta.x).toBeCloseTo(prevView.x, 12);
    expect(nextCOM.y + delta.y).toBeCloseTo(prevView.y, 12);
  });

  test('the absorbed jump decays exponentially to nothing', () => {
    let delta = { x: 100, y: -40 };
    const mag0 = Math.hypot(delta.x, delta.y);
    delta = glideStep(delta, 1);
    expect(Math.hypot(delta.x, delta.y)).toBeCloseTo(mag0 * Math.exp(-COM_GLIDE), 9);
    for (let i = 0; i < 5; i++) delta = glideStep(delta, 1);
    expect(Math.hypot(delta.x, delta.y)).toBeLessThan(1e-3); // gone within seconds
  });

  test('frame-rate independent: two half-steps land exactly where one full step does', () => {
    const full = glideStep({ x: 80, y: 60 }, 1 / 30);
    const halves = glideStep(glideStep({ x: 80, y: 60 }, 1 / 60), 1 / 60);
    expect(halves.x).toBeCloseTo(full.x, 12);
    expect(halves.y).toBeCloseTo(full.y, 12);
  });

  test('a COM-conserving change (a merge) seeds a zero delta — exact tracking has zero lag', () => {
    // Merges replace bodies but conserve the barycenter: the seeded delta is 0,
    // and a zero delta stays zero — the camera keeps tracking exactly.
    const view = { x: 42, y: -7 };
    const delta = seedGlide(view, { x: 42, y: -7 });
    expect(delta).toEqual({ x: 0, y: 0 });
    expect(glideStep(delta, 1 / 60)).toEqual({ x: 0, y: 0 });
  });
});
