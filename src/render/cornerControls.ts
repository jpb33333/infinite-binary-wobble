// Pure visibility predicate for the resolved-state corner "Again" button, split
// out so it can be unit-tested without the canvas.
//
// Why this exists: the corner Again and a sandbox game-over card's Again BOTH
// register under the action name 'again', the card registers first and the
// corner second, and the button registry is last-write-wins (Map.set). So if the
// corner Again is shown while a game-over card is up, its rect silently
// overwrites the card's and the card's Again button goes dead. The sandbox grows
// from a WIN (outcome.kind stays 'win' the whole time), so this fired whenever
// the win card had been dismissed before the sandbox ended — the
// "Again sometimes broken at Humanity is extinct" bug. Fix: suppress the corner
// Again entirely once any sandbox game-over (collapse / extinction / ejection)
// owns the screen — the card owns 'again' there.
export function showsCornerAgain(o: {
  state: string;
  sandboxOutcome: 'collapse' | 'extinction' | 'ejection' | 'detected' | 'survived' | null;
  unravel: boolean;
  outcomeKind: string | null;
  winCardDismissed: boolean;
}): boolean {
  if (o.state !== 'resolved' || o.sandboxOutcome) return false;
  return o.unravel || (o.outcomeKind === 'win' && o.winCardDismissed);
}
