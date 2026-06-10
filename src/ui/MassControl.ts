import type { BodySpec } from '../game/states.ts';
import { LIMITS } from '../game/states.ts';
import { clamp } from '../utils/clamp.ts';

// Mass is adjusted by mouse-wheel over the player's court. We treat the
// wheel as a smooth (delta-based) input — small steps per notch, so the
// player can dial in a mass without snapping. Radius (visual feedback)
// is derived from mass via Body.bodyRadius — so a single mutation here
// shows up immediately in render.

export class MassControl {
  // delta is the raw `WheelEvent.deltaY` value (+ scroll down, - scroll up).
  // We invert it so scrolling UP increases mass — feels like "make it bigger".
  applyWheel(spec: BodySpec, deltaY: number): void {
    // ~5 notches to span the whole range; deltaY is ±100ish per notch in
    // most browsers, so divide by 100 then scale by step.
    const step = 0.18;
    const change = -deltaY / 100 * step;
    spec.mass = clamp(spec.mass + change, LIMITS.minMass, LIMITS.maxMass);
  }
}
