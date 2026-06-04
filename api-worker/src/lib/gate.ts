/**
 * Pure metering decision — no I/O, fully unit-tested.
 * `locked` is true only when a non-entitled device has exhausted its free plays.
 * Entitled (paid) devices are never locked and report `remaining: null` (unlimited).
 */
export interface GateState {
  playCount: number;
  freeLimit: number;
  entitled: boolean;
}

export interface GateResult {
  plays: number;
  remaining: number | null; // null = unlimited (entitled)
  locked: boolean;
  entitled: boolean;
}

export function evaluateGate(state: GateState): GateResult {
  const { playCount, freeLimit, entitled } = state;
  if (entitled) {
    return { plays: playCount, remaining: null, locked: false, entitled: true };
  }
  const remaining = Math.max(0, freeLimit - playCount);
  return { plays: playCount, remaining, locked: remaining <= 0, entitled: false };
}
