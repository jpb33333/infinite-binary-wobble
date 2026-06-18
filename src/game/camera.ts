// Camera + planet-ejection geometry for the post-win three-body unravel. Pure
// math, kept in its own module so it can be unit-tested without dragging in the
// renderer/DOM, and so the zoom solver and the ejection boundary share ONE
// source of truth. They must agree: if they drifted, a planet could be declared
// "lost to the dark" while still on screen, or vanish off-frame before the loss
// ever fires.

export const CAMERA_MIN_ZOOM = 0.25; // furthest the camera pulls back (4× wider view)
export const CAMERA_MARGIN = 0.8; // fraction of the short axis the system fills
export const CAMERA_EASE = 2.5; // zoom easing rate, per second (smooth, not jumpy)

// The system is fit within this radius (design-space px) of the frame centre at
// the current zoom. `minDim` is the short canvas axis (800 in both orientations).
export function cameraFitRadius(minDim: number): number {
  return (minDim / 2) * CAMERA_MARGIN;
}

// A planet slingshot past this radius from the barycenter is lost to the dark —
// an ejection game-over. It is exactly the distance that fills the frame margin
// at the camera's furthest pull-back (CAMERA_MIN_ZOOM), so at the instant of loss
// the planet sits right at the readable edge of the most-zoomed-out view:
// dramatic, and never gone before you see it go.
export function planetEjectRadius(minDim: number): number {
  return cameraFitRadius(minDim) / CAMERA_MIN_ZOOM;
}
