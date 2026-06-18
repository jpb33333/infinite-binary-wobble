# Bowditch Gaming — making the copyright real

_Decided 2026-06-10: **Bowditch Gaming** is the company building Infinite
Binary Wobble and the copyright holder on everything it ships. The notices in
this repo now say so consistently (LICENSE, the live footer, the future iOS
About screen). This file is the practical checklist for making that legally
solid — it is a planning doc, not legal advice; the one step worth real money
is a short session with a small-business attorney before the first sale._

## What is already true (no action)

- **Copyright exists automatically.** The moment code/art/copy is written it
  is copyrighted (Berne Convention) — no registration needed for the right to
  exist. Registration (step 3) only strengthens *enforcement*.
- **The notices are consistent** as of this commit: `LICENSE` says
  "Copyright (c) 2026 Bowditch Gaming", the site footer says
  "© Bowditch Gaming 2026", and `docs/ios/ABOUT-SCREEN.md` directs the
  future About screen to match.
- **Third-party assets are compliant**: Cardo + Inter ship under SIL OFL with
  full license text + per-file SHA-256 provenance
  (`ios/App/Resources/FontLicenses.txt`); the About screen carries the credit
  line. Nothing else in the tree is third-party.

## Step 1 — make Bowditch Gaming a legal person (before charging money)

A name can't own copyright; a person or legal entity can. Two routes:

| | **Single-member LLC** (recommended) | **Sole proprietor + DBA** |
|---|---|---|
| What it is | "Bowditch Gaming LLC", a real entity | You, trading as "Bowditch Gaming" |
| Copyright vests in | the LLC | JP personally (d/b/a Bowditch) |
| Liability shield | yes — matters once strangers pay you | none |
| Cost/effort | state filing fee (~$50–$500 by state, some states add a publication step) + free EIN from the IRS | county/state DBA filing, usually < $100 |

Recommended order: form the LLC → get the **EIN** (free, irs.gov, minutes) →
open a **business bank account**. Do this before Phase H (taking money): the
Stripe account and the Apple agreements should be in the company's name from
day one, not migrated later.

## Step 2 — assign the existing work to the company

Everything written so far was authored by JP personally (the entity didn't
exist). Once the LLC exists, sign a **one-page IP assignment**: JP assigns all
right, title, and interest in the Infinite Binary Wobble code, art, and copy
(identify the repos + date range) to Bowditch Gaming LLC. Date it, both
"parties" sign (yes, you sign twice), keep it with the company records. This
is the piece people skip and regret in diligence later.

## Step 3 — register with the US Copyright Office (around launch)

Optional but cheap and valuable: registration before an infringement (or
within 3 months of publication) unlocks **statutory damages + attorney's
fees** in US enforcement — without it you can only chase actual damages.

- Where: copyright.gov → eCO portal. Category: **Computer Program** (literary
  work). Fee ~$45–$65.
- Deposit: source code excerpt (first + last 25 pages; trade-secret portions
  may be redacted under the standard options).
- Timing: file once around commercial launch (ROADMAP Phase H). One
  registration covering the game as shipped is enough to start; re-register
  on major versions if it ever matters.

## Step 4 — Apple: publish AS Bowditch Gaming

The App Store **seller name** comes from the developer account type:

- **Personal enrollment** → apps appear under "JP Bowditch". Cannot be
  rebranded per-app.
- **Organization enrollment** → apps appear under "Bowditch Gaming". Needs:
  the legal entity (step 1), a **D-U-N-S number** (free from Dun & Bradstreet,
  allow days–weeks), and authority to bind the company.

Decide **before** the first App Store submission — switching account types
later is painful. Also set the App Store Connect per-app copyright field to
`2026 Bowditch Gaming`. (V1-LOCK's checklist mechanics still apply;
its "© J.P. Bowditch" values are superseded.)

## Step 5 — names and the trademark lane (separate from copyright)

Copyright covers the code/art; the **names** "Bowditch Gaming" and
"Infinite Binary Wobble" are trademark territory:

- Now (free/cheap): search USPTO's trademark database for conflicts on both
  names; register the **bowditch domain** you want anyway — ROADMAP Phase A
  needs a custom domain for the API and site fronting, so one purchase serves
  both purposes. Use ™ informally if you like (no filing needed).
- Later (once revenue is real): a USPTO application is ~$250–$350 per class;
  Class 9 (downloadable game software) and/or 41 (online game services) are
  the usual picks.

## Open, deliberately deferred

- **MIT vs proprietary.** The repo is private and stays MIT with Bowditch
  as holder. MIT only governs the code *if distributed* — selling access to
  the hosted game and the App Store app is unaffected. Revisit only if the
  repo is ever opened or takes outside contributions.
- **Year ranges.** Notices say 2026; extend to "2026–20XX" when meaningful
  changes ship in later years.

## Order of operations (condensed)

1. Form Bowditch Gaming LLC + EIN + bank account *(before taking money)*
2. Sign the JP → LLC IP assignment *(same week as 1)*
3. D-U-N-S number → Apple Developer **organization** enrollment *(before App
   Store submission; D-U-N-S takes days–weeks, start early)*
4. Stripe account in the LLC's name *(Phase 0 provisioning, ROADMAP)*
5. Copyright Office registration *(around Phase H launch)*
6. Trademark search now; filing when revenue justifies it
