export type GameStateKind =
  | 'title'
  | 'setup_p1'
  | 'setup_p2'
  | 'countdown'
  | 'simulate'
  | 'resolved'
  // Shown when a metered player has used their free plays (web only; inert
  // unless a backend is configured). Reached from toSetup1's gate.
  | 'paywall';

export type PlayerId = 1 | 2;

// Everything the setup phase needs to remember about a star. Mutated in place
// by the UI controls during the relevant Setup state, then frozen into a Body
// instance when the Simulation is built.
export interface BodySpec {
  player: PlayerId;
  mass: number;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
}

// Court layout — pixel rectangles in canvas-space. Shared by render, UI, and
// outcome classifier so they all agree on what's "in bounds."
export interface CourtLayout {
  canvas: { width: number; height: number };
  // The full half-of-canvas region each player owns (used for highlighting)
  p1Region: { x: number; y: number; width: number; height: number };
  p2Region: { x: number; y: number; width: number; height: number };
  // The dotted in-bounds square inside which each player's star starts
  p1InBounds: { x: number; y: number; width: number; height: number };
  p2InBounds: { x: number; y: number; width: number; height: number };
  centerLineX: number;
}

export const DEFAULT_LAYOUT: CourtLayout = {
  canvas: { width: 1280, height: 800 },
  p1Region: { x: 0, y: 0, width: 640, height: 800 },
  p2Region: { x: 640, y: 0, width: 640, height: 800 },
  // 400×400 inner courts, vertically centered, generous side margins
  p1InBounds: { x: 120, y: 200, width: 400, height: 400 },
  p2InBounds: { x: 760, y: 200, width: 400, height: 400 },
  centerLineX: 640,
};

// Default spec for a player when entering their setup phase
export function defaultSpec(player: PlayerId, layout: CourtLayout): BodySpec {
  const region = player === 1 ? layout.p1InBounds : layout.p2InBounds;
  return {
    player,
    mass: 2.5,
    pos: { x: region.x + region.width / 2, y: region.y + region.height / 2 },
    vel: { x: 0, y: 0 },
  };
}

// Tunable design limits for the player controls. These live alongside the
// state types so any module can import them.
export const LIMITS = {
  minMass: 1.0,
  maxMass: 5.0,
  maxVelocityPerBody: 300, // px/s
} as const;
