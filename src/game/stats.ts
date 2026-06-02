// Per-browser-session scoreboard, persisted in a session cookie (no Expires,
// so it clears when the user closes the browser — "current session" really
// means current session). Each resolved game appends one GameRecord; the
// title and resolved screens summarise the deck.

import type { Outcome } from './outcomes.ts';

export type OutcomeKind = Exclude<Outcome['kind'], 'playing'>;

export interface GameRecord {
  outcome: OutcomeKind;
  duration: number;     // sim seconds elapsed at resolution
  eccentricity: number; // orbit e at the moment of resolution
  orbits: number;       // completed orbits at resolution
  period: number;       // orbit period in s, NaN/Infinity if unbound
  ts: number;           // Date.now() at resolution
}

export interface SessionStats {
  games: GameRecord[];
}

export interface StatsSummary {
  total: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1, 0 when no games yet
  byOutcome: Record<OutcomeKind, number>;
  best: {
    lowestEccentricity: number | null; // among WINs
    mostOrbits: number | null;          // among WINs
    longestWobble: number | null;       // longest WIN duration
  };
}

const COOKIE_NAME = 'ibw-stats-v1';
const MAX_GAMES = 100;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  // No Expires / Max-Age → session cookie; cleared when the browser closes.
  // Path=/ so it applies under any GitHub Pages subpath. SameSite=Lax is the
  // modern default and is the most permissive value the tight CSP allows.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

export function loadStats(): SessionStats {
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return { games: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as SessionStats).games)
    ) {
      return { games: (parsed as SessionStats).games };
    }
  } catch {
    // Malformed cookie — drop it.
  }
  return { games: [] };
}

export function saveStats(s: SessionStats): void {
  const games =
    s.games.length > MAX_GAMES
      ? s.games.slice(s.games.length - MAX_GAMES)
      : s.games;
  writeCookie(COOKIE_NAME, JSON.stringify({ games }));
}

export function recordGame(rec: GameRecord): SessionStats {
  const s = loadStats();
  s.games.push(rec);
  saveStats(s);
  return s;
}

export function resetStats(): void {
  writeCookie(COOKIE_NAME, JSON.stringify({ games: [] }));
}

export function summarize(s: SessionStats): StatsSummary {
  const byOutcome: Record<OutcomeKind, number> = {
    win: 0,
    lose_escape: 0,
    lose_slingshot: 0,
    lose_collision: 0,
  };
  let lowestEcc: number | null = null;
  let mostOrbits: number | null = null;
  let longestWobble: number | null = null;
  for (const g of s.games) {
    byOutcome[g.outcome]++;
    if (g.outcome === 'win') {
      if (Number.isFinite(g.eccentricity)) {
        lowestEcc = lowestEcc === null ? g.eccentricity : Math.min(lowestEcc, g.eccentricity);
      }
      mostOrbits = mostOrbits === null ? g.orbits : Math.max(mostOrbits, g.orbits);
      longestWobble = longestWobble === null ? g.duration : Math.max(longestWobble, g.duration);
    }
  }
  const total = s.games.length;
  const wins = byOutcome.win;
  return {
    total,
    wins,
    losses: total - wins,
    winRate: total > 0 ? wins / total : 0,
    byOutcome,
    best: { lowestEccentricity: lowestEcc, mostOrbits, longestWobble },
  };
}
