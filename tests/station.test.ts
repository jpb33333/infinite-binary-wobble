import { describe, test, expect, afterEach } from 'vitest';
import {
  STATION_URL,
  DEFAULT_STATION,
  hasStation,
  stationEmbedSrc,
  looksLikeSoundcloud,
  isSoundcloudResource,
  canonicalFromOembedHtml,
  resolveStation,
  loadStations,
  saveStations,
} from '../src/audio/station.ts';

// The ♪ pill's station + the private player directory. These pin the gates:
// only https SoundCloud shapes reach the network; oEmbed's answer yields the
// one canonical form the widget accepts; storage fails open everywhere.

describe('station', () => {
  test('the default station is tuned and hasStation gates correctly', () => {
    expect(STATION_URL).toBe(DEFAULT_STATION.url);
    expect(DEFAULT_STATION.url).toBe('https://soundcloud.com/resident-advisor/ra521-the-range');
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

describe('looksLikeSoundcloud — the pre-network gate', () => {
  test('accepts the three https SoundCloud hosts with real paths', () => {
    expect(looksLikeSoundcloud('https://soundcloud.com/artist/track')).toBe(true);
    expect(looksLikeSoundcloud('https://www.soundcloud.com/artist')).toBe(true);
    expect(looksLikeSoundcloud('https://on.soundcloud.com/AbC123')).toBe(true);
    expect(looksLikeSoundcloud('  https://soundcloud.com/x  ')).toBe(true);
  });

  test('rejects everything else', () => {
    expect(looksLikeSoundcloud('http://soundcloud.com/x')).toBe(false); // not https
    expect(looksLikeSoundcloud('https://soundcloud.com/')).toBe(false); // no path
    expect(looksLikeSoundcloud('https://evil.com/soundcloud.com/x')).toBe(false);
    expect(looksLikeSoundcloud('https://notsoundcloud.com/x')).toBe(false);
    expect(looksLikeSoundcloud('soundcloud.com/x')).toBe(false); // no scheme
    expect(looksLikeSoundcloud('')).toBe(false);
    expect(looksLikeSoundcloud('not a url')).toBe(false);
  });
});

describe('canonicalFromOembedHtml — the widget-ready resource', () => {
  // Captured shape of a real oEmbed answer (src attr abridged).
  const SAMPLE =
    '<iframe width="100%" height="400" scrolling="no" frameborder="no" ' +
    'src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F320626452&show_artwork=true"></iframe>';

  test('extracts and decodes the url param', () => {
    expect(canonicalFromOembedHtml(SAMPLE)).toBe('https://api.soundcloud.com/tracks/320626452');
  });

  test('garbage in, null out', () => {
    expect(canonicalFromOembedHtml('')).toBeNull();
    expect(canonicalFromOembedHtml('<iframe src="https://w.soundcloud.com/player/"></iframe>')).toBeNull();
    expect(canonicalFromOembedHtml('url=%ZZbroken')).toBeNull();
    expect(canonicalFromOembedHtml('?url=javascript%3Aalert(1)')).toBeNull(); // non-https decodes rejected
  });

  test('a canonical pointing anywhere but SoundCloud is refused', () => {
    // https alone is not enough: only SoundCloud hosts may reach the widget.
    expect(canonicalFromOembedHtml('?url=https%3A%2F%2Fevil.example%2Ftracks%2F1')).toBeNull();
  });
});

describe('isSoundcloudResource — the only hosts a station may point at', () => {
  test('accepts the widget-canonical and page forms', () => {
    for (const u of [
      'https://api.soundcloud.com/tracks/123',
      'https://soundcloud.com/artist/track',
      'https://www.soundcloud.com/artist/track',
      'https://on.soundcloud.com/abc',
    ])
      expect(isSoundcloudResource(u)).toBe(true);
  });

  test('rejects other hosts, lookalikes, schemes, and garbage', () => {
    for (const u of [
      'https://evil.example/tracks/1',
      'https://soundcloud.com.evil.example/x',
      'http://soundcloud.com/artist/track',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(isSoundcloudResource(u)).toBe(false);
  });
});

describe('resolveStation — oEmbed round trip (injected fetch)', () => {
  const okFetch = (async () =>
    new Response(
      JSON.stringify({
        title: 'RA.521 The Range by Resident Advisor',
        html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F99"></iframe>',
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  test('resolves a pasted short link into a canonical, titled station', async () => {
    const st = await resolveStation('https://on.soundcloud.com/xyz', okFetch);
    expect(st).toEqual({
      url: 'https://api.soundcloud.com/tracks/99',
      title: 'RA.521 The Range by Resident Advisor',
    });
  });

  test('never fetches for non-SoundCloud input', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await resolveStation('https://evil.com/x', spy)).toBeNull();
    expect(called).toBe(false);
  });

  test('404, malformed JSON, and bad shapes all yield null', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const garbage = (async () => new Response('{{{', { status: 200 })) as unknown as typeof fetch;
    const badShape = (async () =>
      new Response(JSON.stringify({ title: 42 }), { status: 200 })) as unknown as typeof fetch;
    expect(await resolveStation('https://soundcloud.com/a/b', notFound)).toBeNull();
    expect(await resolveStation('https://soundcloud.com/a/b', garbage)).toBeNull();
    expect(await resolveStation('https://soundcloud.com/a/b', badShape)).toBeNull();
  });
});

describe('the private directory — localStorage, failing open', () => {
  const stub = (impl: Partial<Storage>): void => {
    (globalThis as { localStorage?: unknown }).localStorage = impl as Storage;
  };
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  test('no storage at all: a fresh directory, and saving is a quiet no-op', () => {
    expect(loadStations()).toEqual({ added: [], selected: DEFAULT_STATION.url });
    expect(() => saveStations({ added: [], selected: DEFAULT_STATION.url })).not.toThrow();
  });

  test('round-trips added stations and the selection', () => {
    const bag: Record<string, string> = {};
    stub({
      getItem: k => bag[k] ?? null,
      setItem: (k, v) => {
        bag[k] = v;
      },
    });
    const added = [{ url: 'https://api.soundcloud.com/tracks/7', title: 'Seven' }];
    saveStations({ added, selected: added[0].url });
    expect(loadStations()).toEqual({ added, selected: added[0].url });
  });

  test('a poisoned entry pointing off-SoundCloud is dropped on load', () => {
    stub({
      getItem: () =>
        JSON.stringify({
          added: [
            { url: 'https://api.soundcloud.com/tracks/7', title: 'Seven' },
            { url: 'https://evil.example/x', title: 'Trap' },
          ],
          selected: 'https://evil.example/x',
        }),
    });
    expect(loadStations()).toEqual({
      added: [{ url: 'https://api.soundcloud.com/tracks/7', title: 'Seven' }],
      selected: DEFAULT_STATION.url,
    });
  });

  test('corrupted or hostile payloads fall back fresh; unknown selection resets', () => {
    stub({ getItem: () => '{{{not json' });
    expect(loadStations()).toEqual({ added: [], selected: DEFAULT_STATION.url });
    stub({ getItem: () => JSON.stringify({ added: [{ evil: true }], selected: 'https://x' }) });
    expect(loadStations()).toEqual({ added: [], selected: DEFAULT_STATION.url });
    stub({
      getItem: () => {
        throw new Error('privacy mode');
      },
    });
    expect(loadStations()).toEqual({ added: [], selected: DEFAULT_STATION.url });
  });
});
