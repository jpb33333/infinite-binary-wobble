// The music station — JP's SoundCloud, one day. The pill and panel ship fully
// wired to this constant; it is deliberately empty until JP supplies the link
// (drop a SoundCloud track/playlist URL here and the pill starts playing it).
// Empty means the pill answers with a quiet whisper instead of a player.
export const STATION_URL = '';

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
