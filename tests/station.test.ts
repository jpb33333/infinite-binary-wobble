import { describe, test, expect } from 'vitest';
import { STATION_URL, hasStation, stationEmbedSrc } from '../src/audio/station.ts';

// The music pill ships fully wired to an intentionally empty station constant
// (JP has no SoundCloud link yet). These pin the gate: empty stays silent,
// and a future URL builds exactly one kind of src — the official SoundCloud
// embed host — with the URL safely encoded.
describe('station', () => {
  test('ships unconfigured: the constant is empty and hasStation gates on it', () => {
    expect(STATION_URL).toBe('');
    expect(hasStation()).toBe(false);
    expect(hasStation('')).toBe(false);
    expect(hasStation('   ')).toBe(false);
    expect(hasStation('https://soundcloud.com/jp/sets/wobble')).toBe(true);
  });

  test('embed src pins the SoundCloud widget host and encodes the URL', () => {
    const src = stationEmbedSrc('https://soundcloud.com/jp/sets/a b?x=1&y=2');
    expect(src.startsWith('https://w.soundcloud.com/player/?url=')).toBe(true);
    expect(src).toContain(encodeURIComponent('https://soundcloud.com/jp/sets/a b?x=1&y=2'));
    expect(src).not.toContain('a b'); // raw spaces never survive
  });
});
