import type { BodySpec, CourtLayout } from '../game/states.ts';
import { bodyRadius } from '../physics/Body.ts';
import { clampToInBounds } from '../render/court.ts';
import { distSq } from './input.ts';

// Reposition the star by clicking anywhere in the player's court — the
// click point (or any subsequent drag) becomes the star's new position,
// clamped to the in-bounds rectangle.
//
// Hit-testing the star body lives here too (it's the same geometry), but
// the *interaction-routing decision* (is this click on the star? → velocity
// drag, else → position drag) lives in Game.

export class PositionControl {
  private grabbed = false;

  // Pure hit test — exposed so Game can route mousedown without owning the
  // body-radius math.
  isOverBody(spec: BodySpec, p: { x: number; y: number }): boolean {
    const r = bodyRadius(spec.mass);
    return distSq(p, spec.pos) <= r * r;
  }

  // Start a position drag. The caller decides when this is appropriate
  // (currently: mousedown anywhere in the player's court that is NOT on
  // the star body).
  beginGrab(): void {
    this.grabbed = true;
  }

  // Continue a drag — clamps to the player's in-bounds box. Also doubles
  // as the "teleport on first click" call: pass the initial click point
  // and the star jumps there.
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
