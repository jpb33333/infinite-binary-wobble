> **Provenance (harvest, 2026-06-10).** Written 2026-06-05 in the standalone
> `jpb33333/infinite-binary-wobble-ios` repo (since archived) as the locked
> launch plan for a V1 that was never submitted — the in-repo SwiftUI port
> (PR #24, `ios/`) superseded that effort wholesale. Preserved verbatim below
> the rule as the decision record. Its "pinned values win" rule applied to the
> superseded standalone V1 only; where this document conflicts with the code
> in `ios/`, **the code is current**. Known divergences:
> - **Bundle id:** pins `com.jpbowditch.InfiniteBinaryWobble`; the in-repo app
>   uses `com.gamerboygirl.infinitebinarywobble` (`ios/project.yml`).
> - **Orientation:** pins landscape-only; the in-repo app ships portrait AND
>   landscape (stacked-courts portrait layout).
> - **Stats:** pins UserDefaults persistence (to seed the v1.1 meter); the
>   in-repo `Stats.swift` is in-memory per session.
> - **Repo/licensing strategy:** pins a private all-rights-reserved standalone
>   repo; the port now lives inside this MIT repo.
> - **Device family:** pins iPhone-only (opt out of iPad/Mac/Vision Pro); the
>   in-repo app targets iPhone + iPad (`TARGETED_DEVICE_FAMILY "1,2"`,
>   fullscreen-only).
> - **Meter:** pins 1000 free plays for v1.1; decided 2026-06-10 → **200**
>   (`FREE_PLAY_LIMIT` in `api-worker/wrangler.toml`).
> Still-useful material: the App Store Connect checklist mechanics, the
> review-notes guidance, the free-pricing rationale, and the risk ladder.

---

# V1-LOCK — Infinite Binary Wobble iOS V1

**The single source of truth for this release.** Transcribed 2026-06-05 from the
launch plan of record (`00-LAUNCH-PLAN.md`, synthesized by the orchestrator from
specialist reports 01–15 + red-team passes 13–15).

> **This document supersedes**, for the V1 App Store release:
> - the web repo's `docs/IOS_NATIVE_APP_PLAN.md` — **stale** (it says portrait;
>   V1 is **landscape-only**), and
> - the **v1.1 metered plan** (`~/.claude/plans/quiet-cooking-crescent.md` /
>   `docs/MONETIZATION_PLAN.md`) — that is the **next** release, not this one.
>
> Where any other document, report, or comment conflicts with the pinned values
> below, **the pinned values win.**

---

## What ships (V1) — LOCKED

A **faithful native Swift port** of the live web game (SwiftUI `Canvas` +
`TimelineView`, no game engine): **FREE · fully OFFLINE · zero third-party
dependencies · "Data Not Collected" · landscape-only · iPhone-only**.
Crude-but-faithful UX, "rock solid cybersecure" enforced by the report-14
Blocks A–I green gate.

**Deferred to v1.1:** the **1000-free-plays meter** (updated from 100) + IAP
unlock + Cloudflare backend + App Attest; portrait layout. V1's `UserDefaults`
play stats become the seed for the v1.1 meter. No grandfathering machinery
needed (nobody pays for V1), but we keep the `CFBundleVersion = 1` watermark
anyway — free optionality, zero cost.

**The free decision removes** the Paid Applications Agreement / banking / W-9
chain from the launch's critical path entirely (it was the #1 date-killer in
reports 07/10/13/15). It is still needed *before v1.1's IAP* — start it calmly
this weekend or next week.

---

## PINNED VALUES — single source of truth (red-team contradictions resolved)

| Field | Pinned value | Resolves |
|---|---|---|
| Bundle ID (IMMUTABLE, case-sensitive) | `com.jpbowditch.InfiniteBinaryWobble` | C4/H1 (4 variants across reports) |
| SKU (immutable) | `IBW-IOS-001` | 11 §0 |
| App name | `Infinite Binary Wobble` (23 chars — fits) | 08 §1 (no collisions found) |
| Price | **Free** | supersedes all paid-tier discussion |
| `CFBundleVersion` / marketing | `1` / `1.0` | 11 §1 watermark |
| Deployment target | iOS 17 (A12 floor, 60fps bar) | 12 §5 |
| Orientation | Landscape-only (Info.plist lock; no portrait code) | C-conflict vs stale plan doc |
| Device family | iPhone-only; **opt OUT of Mac (Apple silicon) + Vision Pro** | C18 / A9 |
| Stats persistence | **UserDefaults** + PrivacyInfo `CA92.1` (faithful to web's persistent scoreboard; seeds v1.1 meter) | C12 (overrides report 03's in-memory lean) |
| Privacy label | **Data Not Collected** (truthful: zero network, zero SDKs) | 01/06/09 |
| Privacy policy page | Ship `privacy.html` on the web repo, wording scoped: "**This version** … collects no data" (no absolute/perpetual claims) | C11 + 14 O1/O2 |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` | 01/06 |
| GitHub owner / URLs | `jpb33333` · `https://jpb33333.github.io/infinite-binary-wobble/` | C5 |
| iOS repo | `jpb33333/infinite-binary-wobble-ios`, **private**, proprietary all-rights-reserved LICENSE (web repo stays MIT) | C15 |
| Xcode | **26.x via Mac App Store** (Gatekeeper-verified; report 05's "Xcode 16" is an ERROR — ignore it) | C6/C8 + 14 §3b |
| Screenshots | Landscape, 6.9" slot; read Apple's live spec page on capture day; **the ASC upload dialog's stated size is the final authority** | C2/C3 |
| Release option | **"Manually release this version"** — JP taps Release on Friday | 15 A1 (highest-value click) |
| Review SLA planning | 48h assumed, zero expedited reliance (expedite ≠ launch dates) | C14 |
| Submit target | **Tue Jun 9 by 12:00 PT** (drop-dead 17:00 PT; Wed = hard backstop) | C13 |
| Fallback ladder | GOLD live Fri Jun 12 → SILVER live Mon Jun 15 (slow review) → TestFlight-only Friday (QA fail) | C1, simplified by free |

---

## Day-by-day (gates in bold; human minutes per day)

**FRI Jun 5 (tonight) — human ≈ 75 min + Xcode download unattended**
- [H] Mac App Store → install **Xcode 26.x** (start FIRST; hours of download).
- [H] developer.apple.com → membership **Active**, note Team ID.
- [H] appleid.apple.com → 2FA ON, recovery contact set, **don't change the password this week**.
- [H] Identifiers → register `com.jpbowditch.InfiniteBinaryWobble` — exact case, **all capabilities OFF**.
- [H] ASC → New App → reserve name, SKU `IBW-IOS-001` ("missing information" warning = normal).
- [H] iPhone: confirm model + **iOS ≥ 17** (update tonight if older).
- [H] When Xcode finishes: sign in (jpbowditch@gmail.com), **confirm the PAID team — never "Personal Team"**; plug iPhone → Trust → Developer Mode ON → restart.
- [A] (no Xcode needed) Golden-fixture exporter PR → web repo; `privacy.html` + support PR → web repo (JP merges, verifies URLs load); create private iOS repo + LICENSE + FontLicenses (full OFL text + font SHA-256 provenance); pre-write Swift physics/theme/states/render/input per report 03's task map; author the V1 lock doc in the iOS repo.
- **GATE EOD: Xcode installing/installed · app record exists · bundle ID registered · iPhone confirmed.**

**SAT Jun 6** — [A] verify `xcodebuild` 26.x; scaffold project (paid team, landscape lock, empty entitlements); physics chain T3→T6. **GATE: physics XCTests + 3 golden trajectories green in Debug AND Release.** [H] ~10 min: watch email; nothing else.

**SUN Jun 7** — [A] render layers, state machine, input/gestures, haptics; integrate; first **TestFlight upload** (absorbs the 10–80h processing tail early). [H] ~35 min: feel session #1 on device (20 min, verdict: Go / ≤3 blockers) + corrected App Privacy Report check (report 14 §4: positive control required).
**GATE: app runs end-to-end on SE-class + 6.9" sims; TestFlight processed.**

**MON Jun 8** — [A] polish (Reduce Motion, supernova, HUD), full **security green gate Blocks A–I** (report 14 §5), screenshots at the live-spec size, final metadata texts. [H] ~75 min: **ship-acceptance session #2 (45 min, hard cap — yes/no)**; evening ASC console pass with agent answer sheets: App Privacy = Data Not Collected · age rating 4+ (answer None/No to all; Made for Kids OFF) · category Games→Puzzle/Family · URLs + copyright `2026 J.P. Bowditch` · opt out Mac+Vision Pro · price Free.
**GATE: SHIP-ACCEPTABLE = yes · metadata complete · security gate 100% green.**

**TUE Jun 9 — SUBMIT** — [A] final build (`CFBundleVersion=1`), clean archive, Validate, attach; screenshots uploaded (obey the ASC dialog on size). [H] ~30 min: review notes pasted (local 2-player hot-seat · offline · no accounts · Airplane-Mode *observable*, manifest is the attestation) · **"Manually release this version" selected** · **Submit by 12:00 PT**.
**GATE: status = Waiting for Review on Tuesday.**

**WED Jun 10** — backstop submit if Tue slipped; answer any reviewer message same-day (Resolution Center).
**THU Jun 11** — watch for **Pending Developer Release**. One expedite ONLY for a genuine 2.1/5.1 fix, never for the date.
**FRI Jun 12** — [H] tap **"Release this version"** AM → verify on a real device's App Store (~1h propagation). **LIVE.**

---

## Top remaining risks (post-free)

1. **Review tail >72h** (first app on the account) — submit Tue noon; clean metadata; SILVER = Mon Jun 15. *Uncontrollable; the only one left that can move the date.*
2. **Xcode install slips tonight** — every build day cascades. Start it first, tonight.
3. **4.2 minimum-functionality** — free pricing softens scrutiny; native engine + haptics + persistent scoreboard + supernova + orbit HUD + review notes carry it.
4. **Silent clicks** — Manual-release radio (Tue) and bundle-ID exact case (tonight). Both on the sticky note.
5. **Feel-iteration spiral** — JP is the only feel-tester: two scheduled sessions (Sun, Mon), hard-capped.

---

## JP's sticky note

1. Tonight: Xcode installing + the 5 account steps (~75 min). Bundle ID **exactly** `com.jpbowditch.InfiniteBinaryWobble`.
2. Your **legal name will show publicly** as the seller, permanently (Individual account). That's the "claim it as mine."
3. Tuesday at submit: select **"Manually release this version."** Submit by noon PT.
4. Friday morning: **you tap "Release this version"** — approval alone doesn't publish.
5. Paid Apps agreement + banking: NOT needed for Friday anymore. Start next week for v1.1's meter.

---

## v1.1 bridge (so nothing corners us)

- Meter = **1000 free plays** (user-locked 2026-06-05; supersedes 100) → IAP unlock; backend per `docs/MONETIZATION_PLAN.md`.
- V1's `UserDefaults` play count seeds the meter honestly; server becomes authoritative per the existing plan.
- Keep entitlements EMPTY in V1; App Attest/StoreKit add cleanly in an update (verified, report 11).
- Privacy label changes at v1.1 (Purchases/Identifiers/Usage) — scoped privacy.html wording already anticipates this.
- Paid Apps agreement, banking, W-9: complete before v1.1 ships; start ~week of Jun 15.

---

*Source of record: `/Users/jpbowditch/ibw-launch-analysis/00-LAUNCH-PLAN.md`
(orchestrator synthesis, 2026-06-05). Full specialist designs and code live in
reports 01–15 in that same directory.*
