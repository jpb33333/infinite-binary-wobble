// The music station + the player directory behind the ♪ pill.
//
// The DEFAULT station is JP's pick; players tune their own via the panel's
// directory — any SoundCloud link they paste (short links included) is
// resolved and validated through SoundCloud's CORS-open oEmbed endpoint, then
// kept privately on their device (localStorage). Everything streams through
// SoundCloud's official widget with the uploader's embed permission: nothing
// is ever copied into the game, plays accrue to the uploader, and a link
// whose owner disables embedding simply stops resolving.

export interface Station {
  url: string; // canonical resource the widget accepts
  title: string;
}

export const DEFAULT_STATION: Station = {
  url: 'https://soundcloud.com/resident-advisor/ra521-the-range',
  title: 'RA.521 The Range',
};

// Kept for the pill's gate: the game has a station as long as a default
// exists (it always does now), so the whisper only returns if this file is
// ever emptied deliberately.
export const STATION_URL = DEFAULT_STATION.url;

export function hasStation(url: string = STATION_URL): boolean {
  return url.trim().length > 0;
}

// The official SoundCloud embed for a given resource URL, tinted to the
// game's terracotta. The player runs entirely inside its own iframe — nothing
// external ever loads into the game's page itself (CSP: frame-src only).
export function stationEmbedSrc(url: string): string {
  return (
    'https://w.soundcloud.com/player/?url=' +
    encodeURIComponent(url.trim()) +
    '&color=%23C46A5A&auto_play=false&hide_related=true&show_comments=false&visual=false'
  );
}

// Cheap pre-gate before any network: only https SoundCloud shapes get as far
// as the oEmbed lookup. Short links (on.soundcloud.com) pass — the widget
// itself 404s on them, but oEmbed resolves them to the canonical resource.
export function looksLikeSoundcloud(input: string): boolean {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host !== 'soundcloud.com' && host !== 'www.soundcloud.com' && host !== 'on.soundcloud.com')
    return false;
  return u.pathname.length > 1;
}

// The only hosts a station URL may point at — canonical widget resources
// (api.soundcloud.com), page URLs, and short links. Enforced when extracting
// from oEmbed AND when loading the stored directory, so neither a spoofed
// oEmbed answer nor a poisoned localStorage entry can aim the player frame at
// a foreign origin. (CSP frame-src is the backstop; this keeps the data model
// itself clean above it.)
const RESOURCE_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'on.soundcloud.com',
  'api.soundcloud.com',
]);

export function isSoundcloudResource(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && RESOURCE_HOSTS.has(u.hostname.toLowerCase());
}

// oEmbed answers with an iframe snippet whose src carries the CANONICAL
// resource as its url= param (e.g. api.soundcloud.com/tracks/123) — the one
// form the widget accepts for anything a player pasted. Extract + decode it;
// only a SoundCloud-hosted https resource passes.
export function canonicalFromOembedHtml(html: string): string | null {
  const m = html.match(/[?&]url=([^"&\\]+)/);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    return isSoundcloudResource(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// Resolve anything a player pasted into a playable Station via oEmbed
// (validates embeddability, resolves short links, and names the row in one
// round trip). null = it doesn't tune. Injected fetch for tests.
export async function resolveStation(
  raw: string,
  fetchFn: typeof fetch = fetch,
): Promise<Station | null> {
  if (!looksLikeSoundcloud(raw)) return null;
  try {
    const res = await fetchFn(
      'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(raw.trim()),
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown; html?: unknown };
    if (typeof data.title !== 'string' || typeof data.html !== 'string') return null;
    const canonical = canonicalFromOembedHtml(data.html);
    if (!canonical) return null;
    return { url: canonical, title: data.title };
  } catch {
    return null;
  }
}

// ── The private directory ──
//
// Player-added stations + which station is selected, kept per device.
// localStorage rather than the stats cookie: a station list deserves the
// quota and has no business riding request headers. Fail-open everywhere —
// storage denied or corrupted just means the directory starts fresh.
const STORE_KEY = 'ibw.stations.v1';

export interface StationStore {
  added: Station[];
  // Selected station url; DEFAULT_STATION.url when unset/unknown.
  selected: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // some privacy modes throw on ACCESS
  }
}

export function loadStations(): StationStore {
  const fresh: StationStore = { added: [], selected: DEFAULT_STATION.url };
  const s = storage();
  if (!s) return fresh;
  try {
    const raw = s.getItem(STORE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return fresh;
    const p = parsed as { added?: unknown; selected?: unknown };
    const added = Array.isArray(p.added)
      ? p.added.filter(
          (x): x is Station =>
            !!x &&
            typeof x === 'object' &&
            typeof (x as Station).url === 'string' &&
            typeof (x as Station).title === 'string' &&
            // Stored URLs re-prove their host on every load — a poisoned
            // entry must not survive into the directory or the widget.
            isSoundcloudResource((x as Station).url),
        )
      : [];
    const selected =
      typeof p.selected === 'string' &&
      (p.selected === DEFAULT_STATION.url || added.some(a => a.url === p.selected))
        ? p.selected
        : DEFAULT_STATION.url;
    return { added, selected };
  } catch {
    return fresh;
  }
}

export function saveStations(store: StationStore): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota / privacy mode — the directory just won't persist. Fail open.
  }
}
