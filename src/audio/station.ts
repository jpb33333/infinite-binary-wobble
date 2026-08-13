// The music station — currently "RA.521 The Range" (Resident Advisor).
// Streamed via SoundCloud's official widget with the uploader's embed
// permission: nothing is copied into the game, plays accrue to the
// uploader, and if they ever disable embedding the panel simply goes
// unavailable. Swap the URL to retune; empty it to return the pill to its
// quiet whisper.
export const STATION_URL = 'https://soundcloud.com/resident-advisor/ra521-the-range';

export function hasStation(url: string = STATION_URL): boolean {
  return url.trim().length > 0;
}

// The official SoundCloud embed for a given track/playlist URL, tinted to the
// game's terracotta. The player runs entirely inside its own iframe — nothing
// external ever loads into the game's page itself (CSP: frame-src only).
export function stationEmbedSrc(url: string): string {
  return (
    'https://w.soundcloud.com/player/?url=' +
    encodeURIComponent(url.trim()) +
    '&color=%23C46A5A&auto_play=false&hide_related=true&show_comments=false&visual=false'
  );
}
