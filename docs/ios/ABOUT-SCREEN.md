> **Provenance (harvest, 2026-06-10).** Written 2026-06-05 in the standalone
> `jpb33333/infinite-binary-wobble-ios` repo (since archived). The About
> screen it specifies is **not yet built** in the in-repo app (`ios/App/` has
> the explainer card, no About screen) — this is the final copy waiting for
> that view. Notes: the bundled fonts + `FontLicenses.txt` it relies on now
> live at `ios/App/Resources/`. The copyright identity was **decided
> 2026-06-10: Carousella Gaming** — when this screen is built, render the
> copyright line as "© 2026 Carousella Gaming. All rights reserved." instead
> of the "J.P. Bowditch" wording pinned verbatim below (the LICENSE and the
> live footer already say Carousella; see
> `docs/plans/carousella-copyright.md`).

---

# About-screen copy — Infinite Binary Wobble (iOS)

This is the **final copy** for the in-app About screen. The SwiftUI view that
renders it lands with the app target on Saturday. Source: report
`08-claiming-ownership.md` §3b (drafted 2026-06-05); the copyright owner is
filled in per the launch plan's pinned value (`2026 J.P. Bowditch`).

The screen must be reachable from the title screen via a small "About"
affordance (the "crude-but-faithful port" mandate). Render the wordmark and the
italic Carse lines in **Cardo**, the body and metadata in **Inter**, per the
web build's `src/theme.ts`. Pull `© 2026 J.P. Bowditch` and the version string
from a **single source** (do not hard-code the version in two places).

The first three lines of the homage are reproduced **verbatim** from the web
build's outcome-card "Carse footer" (`src/render/Renderer.ts`,
`drawCarseFooter`). The "After James P. Carse…" line is a homage/credit, not a
license claim on Carse's work.

---

## Final copy (verbatim)

```
Infinite Binary Wobble
a game for two who are considering

Two stars. One hot seat. Set the masses, aim the
velocities, and see whether your binary holds — or
drifts, collides, and comes undone.

— —

Remember, this is just a finite game.
The real infinite game is played for its own sake
and is only won by playing again and again.

After James P. Carse, "Finite and Infinite Games" (1986).

— —

© 2026 J.P. Bowditch. All rights reserved.
Built with Cardo and Inter (SIL Open Font License 1.1).
Fully offline. No accounts, no tracking, no data collected.

Version 1.0
```

---

## Notes for the view (Saturday)

- **Typography:** wordmark + the three italic Carse lines in **Cardo**; the
  subtitle, body paragraph, attribution, and the metadata block in **Inter**.
  Match the warm-toned palette in the web `src/theme.ts` (no blues, no neon, no
  harsh edges).
- **Single-sourced strings:** `© 2026 J.P. Bowditch` and `Version 1.0` come from
  one place (e.g. derive the version from `CFBundleShortVersionString`); never
  duplicate the literal.
- **The font credit line is load-bearing.** "Built with Cardo and Inter (SIL
  Open Font License 1.1)" partially satisfies the OFL Condition 2 surfacing
  obligation; the full license text ships in `Resources/FontLicenses.txt`
  (reproduced once per font, with per-file SHA-256 provenance).
- **No absolute privacy/security adjectives** (red-team gate I1): the line states
  *capabilities* ("fully offline · no accounts · no tracking · no data
  collected"), never *guarantees* ("unhackable", "100% secure", "collects
  nothing ever"). Keep it exactly as written above.
- The `— —` separators are a discreet divider; render them as a thin rule or the
  two em-dashes shown, consistent with the web build's outcome-card divider.
