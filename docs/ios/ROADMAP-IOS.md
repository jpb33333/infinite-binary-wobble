> **Provenance (harvest, 2026-06-10).** Written 2026-06-05 in the standalone
> `jpb33333/infinite-binary-wobble-ios` repo (since archived) during the V1
> launch effort that was superseded by the in-repo SwiftUI port (PR #24,
> `ios/`). Preserved verbatim below the rule as the product-intent record —
> the "saved wobbles" feature and the north star remain live direction.
> **Decision recorded here that has NOT reached the code:** the v1.1 meter is
> stated as **1000 free plays ("updated from 100")**, while
> `api-worker/wrangler.toml` still defaults `FREE_PLAY_LIMIT = "100"` — pick
> one before Phase C provisioning. The copyright identity here ("© JP
> Bowditch 2026") also differs from the live site's footer ("© Carousella
> Gaming 2026") — same open question as the LICENSE line.

---

# Infinite Binary Wobble — iOS Product Roadmap (living document)

The game is **not close to done** — and that's deliberate. V1 (the offline,
free, landscape App Store release) is **milestone 1**: it claims the name, the
store presence, and proves the physics. The product keeps growing from there.
This file collects where it goes next. Add freely; nothing here is "out of
scope" — only "not yet."

_Last updated: 2026-06-05 (evening, V1 build week)._

---

## Saved wobbles — save · resume · send (captured 2026-06-05, from JP)

> Send a completed wobble that you finished solo, or save a wobble so you can
> view its unique physics over again if you want. You continue wherever you
> left off in its wobble — it does **not** restart the counter.

**Why this is nearly free:** the physics is deterministic — proven by the
golden-trajectory test suite (Swift replays the web engine bit-for-bit). A
saved wobble is therefore a tiny snapshot:

```
{ initial body specs, current pos/vel of both stars,
  elapsed sim time, completed orbits, outcome state }
```

Reloading it resumes the *exact* same wobble mid-flight — same orbit counter,
same eccentricity, same future. No video needed, no approximation, ~200 bytes.

**Design notes**
- **Save:** snapshot on demand (and/or auto-save the latest WIN). Stored
  on-device (UserDefaults/file) — keeps the offline, Data-Not-Collected
  posture untouched.
- **Resume:** load snapshot → simulation continues from saved state.
  Counter/time/orbits persist — never restart.
- **Send:** stage 1 = share sheet exporting a `.wobble` file (works fully
  offline, AirDrop/Messages). Stage 2 = a wobble *link* that opens in the app —
  needs a URL scheme or universal links (universal links want the custom
  domain that v1.1's backend provisioning brings anyway).
- **Gallery:** a simple "My Wobbles" list — each entry replays/continues its
  unique physics.

**Open questions (decide when we build it)**
- "Finished **solo**" — formalize a solo mode (one player sets both stars)?
  Today's hot-seat already allows it informally; naming it changes the UI.
- Does a *received* wobble open as view-only theater, or fully playable from
  the snapshot?
- Meter interaction (v1.1+): re-viewing a saved wobble should probably never
  count as a "play" — confirm when the meter ships.

---

## Already-committed next milestones (from the launch plan)

- **v1.1 — the meter:** 1000 free plays, then pay (IAP) — Cloudflare backend,
  App Attest, server-held count. V1's on-device play stats seed it honestly.
  Paid Apps agreement + banking paperwork unblock this (start ~week of Jun 15).
- **Portrait layout** — the stacked-courts design the web plan spiked.
- **Privacy label + policy update** to match v1.1's collection (already drafted
  into the privacy page's "future versions" clause).

## Seeds (unordered, unscoped — add more)

- Reduce Motion polish, haptics tuning beyond the three core events
- iPad / larger-canvas presentation (currently deliberately opted out)
- Web ↔ iOS wobble sharing (one `.wobble` format across both)
- The web homepage carries a dedication ("A love letter to Natalia", cursive,
  very bottom) followed by the copyright line (© JP Bowditch 2026). Open
  question for JP: does the iOS About screen carry the dedication too?

---

**North star (JP, 2026-06-05):** *"I want this to be perfect."* Quality leads;
the calendar serves the work. Security is treated with standing, active worry —
every release passes the full SECURITY-GATE before it ships.
