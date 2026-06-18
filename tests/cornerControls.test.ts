import { describe, test, expect } from 'vitest';
import { showsCornerAgain } from '../src/render/cornerControls.ts';

// Regression guard for "Again sometimes broken at Humanity is extinct": the
// corner Again must never be registered while a sandbox game-over card owns the
// 'again' action — the last-write-wins registry would otherwise kill the card's
// button (the corner registers after the card).
describe('showsCornerAgain — corner Again never collides with a game-over card', () => {
  const base = {
    state: 'resolved',
    sandboxOutcome: null,
    unravel: false,
    outcomeKind: 'win',
    winCardDismissed: false,
  } as const;

  test('suppressed during EVERY sandbox game-over, even from a dismissed win (the bug)', () => {
    for (const sandboxOutcome of ['extinction', 'collapse', 'ejection'] as const) {
      // dismissed win + game-over = the exact broken case
      expect(showsCornerAgain({ ...base, sandboxOutcome, unravel: true, winCardDismissed: true })).toBe(
        false,
      );
      // and undismissed, for completeness
      expect(
        showsCornerAgain({ ...base, sandboxOutcome, unravel: true, winCardDismissed: false }),
      ).toBe(false);
    }
  });

  test('still shows during the live unravel (no game-over yet)', () => {
    expect(showsCornerAgain({ ...base, unravel: true })).toBe(true);
  });

  test('still shows for a dismissed win with no sandbox', () => {
    expect(showsCornerAgain({ ...base, winCardDismissed: true })).toBe(true);
  });

  test('hidden for an undismissed win, and outside the resolved state', () => {
    expect(showsCornerAgain({ ...base, winCardDismissed: false })).toBe(false);
    expect(showsCornerAgain({ ...base, state: 'simulate', unravel: true })).toBe(false);
  });
});
