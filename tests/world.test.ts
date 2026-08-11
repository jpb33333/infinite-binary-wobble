import { describe, test, expect } from 'vitest';
import { createBody } from '../src/physics/Body.ts';
import { vec2 } from '../src/physics/Vec2.ts';
import { WorldState } from '../src/game/world.ts';

// The world climate model: insolation → warmth → era → population. A temperate
// era grows the population; a scorching/frozen era burns or freezes it away.
// (WARMTH_REF in world.ts is tuned so a mass-2.5 sun at ~500px reads as
// warmth ≈ 1, comfortably temperate.)

describe('World climate + population', () => {
  test('a temperate era grows the population', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(2.5, vec2(500, 0), vec2(0, 0)); // warmth ≈ 1
    world.population = 1;
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('temperate');
    expect(world.population).toBeGreaterThan(1);
  });

  test('a scorching era crashes the population', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(5, vec2(150, 0), vec2(0, 0)); // suns crowd close → scorching
    world.population = 5;
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('scorching');
    expect(world.population).toBeLessThan(5);
  });

  test('a frozen era (suns far) is turbulent, not steady', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(1, vec2(2000, 0), vec2(0, 0)); // warmth ≪ 1 → frozen
    for (let i = 0; i < 120; i++) world.update(1 / 60, [sun]);
    expect(world.era).toBe('frozen');
    expect(world.stable).toBe(false);
  });

  test('running dark suppresses growth — life wanes even in a temperate era', () => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(2.5, vec2(500, 0), vec2(0, 0)); // warmth ≈ 1, temperate
    world.population = 5;
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun], true); // running dark
    expect(world.era).toBe('temperate'); // the climate itself is unchanged…
    expect(world.population).toBeLessThan(5); // …but a powered-down civilization wanes
  });
});

// Survivability tuning ("make it easier for the worlds to survive"): a wider
// temperate band, slower crashes, gentler dark-decay, quicker rebirths. These
// pin the DIRECTION of the constants so a future retune that quietly reverts
// them fails a test rather than a playtest.
describe('survivability tuning', () => {
  const worldAt = (sunMass: number, dist: number) => {
    const world = new WorldState(createBody(0.02, vec2(0, 0), vec2(0, 0)));
    const sun = createBody(sunMass, vec2(dist, 0), vec2(0, 0));
    return { world, sun };
  };

  test('a dim, distant orbit that once froze now reads temperate (band widened)', () => {
    // warmth ≈ 0.4: frozen under the old 0.45 floor, temperate under 0.32.
    // mass 1 at 500px → warmth ≈ 0.4: frozen under the old 0.45 floor.
    const { world, sun } = worldAt(1, 500);
    for (let i = 0; i < 300; i++) world.update(1 / 60, [sun]);
    expect(world.warmth).toBeGreaterThan(0.32);
    expect(world.warmth).toBeLessThan(0.45);
    expect(world.era).toBe('temperate');
  });

  test('a frozen crash is survivable for a meaningful stretch', () => {
    const { world, sun } = worldAt(1, 2000); // deep frozen
    world.population = 5;
    for (let i = 0; i < 60 * 4; i++) world.update(1 / 60, [sun]); // four frozen seconds
    expect(world.population).toBeGreaterThan(0.05); // alive — the old 1.1 decay would have zeroed it
  });

  test('running dark wanes gently — six dark seconds do not wipe a healthy world', () => {
    const { world, sun } = worldAt(2.5, 500); // temperate
    world.population = 5;
    for (let i = 0; i < 60 * 6; i++) world.update(1 / 60, [sun], true);
    expect(world.population).toBeGreaterThan(1);
  });
});
