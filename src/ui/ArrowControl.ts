import type { BodySpec } from '../game/states.ts';
import { LIMITS } from '../game/states.ts';

// Drag from the star to set the velocity vector. The arrow length in pixels
// equals the velocity magnitude in px/s — a visceral one-to-one mapping that
// makes the tooltip readout feel honest.

export class ArrowControl {
  private grabbed = false;

  // No "handle" hit-test here — the Game decides to begin a velocity drag
  // when the pointer lands anywhere in the player's court that isn't the
  // star body itself. So we just start the drag.
  beginGrab(): void {
    this.grabbed = true;
  }

  // Continue dragging — sets velocity from star center to pointer position,
  // capped at LIMITS.maxVelocityPerBody.
  drag(spec: BodySpec, p: { x: number; y: number }): void {
    if (!this.grabbed) return;
    const dx = p.x - spec.pos.x;
    const dy = p.y - spec.pos.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) {
      spec.vel.x = 0;
      spec.vel.y = 0;
      return;
    }
    const cap = LIMITS.maxVelocityPerBody;
    const clamped = Math.min(mag, cap);
    spec.vel.x = (dx / mag) * clamped;
    spec.vel.y = (dy / mag) * clamped;
  }

  release(): void {
    this.grabbed = false;
  }

  get isGrabbing(): boolean {
    return this.grabbed;
  }

  // Velocity magnitude (px/s, displayed as "px/s" in the UI).
  static magnitude(spec: BodySpec): number {
    return Math.hypot(spec.vel.x, spec.vel.y);
  }
}
