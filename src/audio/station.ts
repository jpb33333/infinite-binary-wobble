// The music station — JP's SoundCloud: "jpbowditch — beeps & boops & etc."
// The profile URL embeds as a feed of JP's tracks in the widget. Emptying
// this constant returns the pill to its quiet whisper.
export const STATION_URL = 'https://soundcloud.com/jpenningtonb';

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
