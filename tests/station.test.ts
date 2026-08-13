import { describe, test, expect } from 'vitest';
import { STATION_URL, hasStation, stationEmbedSrc } from '../src/audio/station.ts';

// The music pill is tuned to JP's station. These pin the gate — an emptied
// constant falls back to the silent whisper — and the src builder: exactly
// one kind of src, the official SoundCloud embed host, URL safely encoded.
describe('station', () => {
  test('the station is tuned to JP\'s profile and hasStation gates correctly', () => {
    expect(STATION_URL).toBe('https://soundcloud.com/jpenningtonb');
    expect(hasStation()).toBe(true);
    expect(hasStation('')).toBe(false);
    expect(hasStation('   ')).toBe(false);
  });

  test('embed src pins the SoundCloud widget host and encodes the URL', () => {
    const src = stationEmbedSrc('https://soundcloud.com/jp/sets/a b?x=1&y=2');
    expect(src.startsWith('https://w.soundcloud.com/player/?url=')).toBe(true);
    expect(src).toContain(encodeURIComponent('https://soundcloud.com/jp/sets/a b?x=1&y=2'));
    expect(src).not.toContain('a b'); // raw spaces never survive
  });
});
