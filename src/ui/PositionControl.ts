import type { BodySpec, CourtLayout } from '../game/states.ts';
import { bodyRadius } from '../physics/Body.ts';
import { clampToInBounds } from '../render/court.ts';
import { distSq } from './input.ts';

// Drag the star's body itself to reposition it inside the player's
// in-bounds rectangle.

export class PositionControl {
  private grabbed = false;

  // Returns true if the pointer is currently inside the star body (drag-handle).
  isOverHandle(spec: BodySpec, p: { x: number; y: number }): boolean {
    const r = bodyRadius(spec.mass);
    return distSq(p, spec.pos) <= r * r;
  }

  beginGrab(spec: BodySpec, p: { x: number; y: number }): boolean {
    if (this.isOverHandle(spec, p)) {
      this.grabbed = true;
      return true;
    }
    return false;
  }

  // Continue a drag — clamps to the player's in-bounds box.
  drag(spec: BodySpec, p: { x: number; y: number }, layout: CourtLayout): void {
    if (!this.grabbed) return;
    const clamped = clampToInBounds(p, layout, spec.player);
    spec.pos.x = clamped.x;
    spec.pos.y = clamped.y;
  }

  release(): void {
    this.grabbed = false;
  }

  get isGrabbing(): boolean {
    return this.grabbed;
  }
}
