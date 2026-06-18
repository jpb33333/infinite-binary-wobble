import { describe, test, expect } from 'vitest';
import {
  CAMERA_MIN_ZOOM,
  cameraFitRadius,
  planetEjectRadius,
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

  test('the camera pulls back to 4× and the boundary follows it (≈1280 px)', () => {
    expect(CAMERA_MIN_ZOOM).toBeCloseTo(0.25, 9); // 4× wider view
    expect(planetEjectRadius(minDim)).toBeCloseTo(1280, 9); // fitRadius (320) / 0.25
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
