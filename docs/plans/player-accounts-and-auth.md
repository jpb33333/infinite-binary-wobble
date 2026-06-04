# Plan: Player Accounts & Authentication (Google / Apple / Email)

> **Status: PLAN ONLY — nothing here is built yet.** This document scopes what it
> would take to put real sign-in in front of (or alongside) Infinite Binary Wobble,
> why the current setup can't do it, the realistic options, and the cost.
> Written 2026-06-04.

---

## TL;DR

Infinite Binary Wobble is a **static website** hosted on GitHub Pages: just
HTML/CSS/JS files that run entirely in the player's browser. There is **no server
and no database**, and the full source is already public.

Secure "Sign in with Google / Apple" or "create an account with a valid email"
**cannot be done on a static site** — all three need a **backend** (a server +
database, and for email, a mail service). Adding one is a real project with
ongoing cost, not a code tweak.

**Recommendation:** Don't gate the whole game (see "Do you actually need this?").
If you want accounts for a *specific* feature (saved scores, online play), start
with a managed auth service (**Supabase** or **Clerk**) + **Google** sign-in
behind just that feature. Add **Apple** only when you go to the App Store
(it costs **$99/year** and is effectively required there).

---

## 1. First question: do you actually need accounts?

The architect's instinct before adding auth is *"what capability does login unlock?"*
Login is a means, not a goal. It's worth it only if you want one of these:

| Goal | Needs accounts? | Notes |
|------|-----------------|-------|
| **Save scores / stats across devices** | Yes | The clearest reason. Today stats are per-session only. |
| **Online two-player (play over the internet)** | Yes + realtime | The big one. Accounts are the *small* part; realtime matchmaking is the hard part. |
| **Leaderboards tied to a name** | Yes | Needs accounts to prevent fake entries. |
| **"Stop random people playing"** | **No — impossible here** | The game is free, public, open-source. A login screen wouldn't secure it (see §2). |

**If none of the "Yes" rows apply, the right move is to skip auth** and instead do
the static-site hardening (CSP, Subresource Integrity, dependency audit). That's
the honest version of "make it more secure" for a public browser game.

---

## 2. Why the current architecture can't do secure auth

**What GitHub Pages is:** a free host for *static files*. When someone plays, their
browser downloads `index.html` + the JS bundle and runs it locally. There is no
code running on a server that we control.

That breaks all three login methods:

- **Google / Apple OAuth** needs a **server-side secret** (the OAuth "client
  secret") and a **server** to swap a login code for a token. Anything shipped to
  the browser is readable by anyone — so a secret in static JS is *not secret*.
- **Email signup** needs a **database** to store accounts and a **mail service**
  to send verification emails. Neither exists on Pages.
- **A login screen added only in the frontend = security theater.** The entire
  game is already downloaded to the browser and the repo is public — anyone can
  View Source, open DevTools, or clone it and run the game with the login removed.
  It would *look* locked while the door is wide open.

---

## 3. What has to change: add a backend

```
   TODAY (static)                        WITH ACCOUNTS (needs a backend)

  ┌───────────────┐                   ┌───────────────┐
  │   Browser     │                   │   Browser     │  game UI + login button
  │  (game runs   │                   │  (game runs   │
  │   here)       │                   │   here)       │
  └──────┬────────┘                   └──────┬────────┘
         │ download files                    │ 1. login   │ 3. API calls w/ token
         ▼                                    ▼            ▼
  ┌───────────────┐                   ┌───────────────┐  ┌──────────────────┐
  │ GitHub Pages  │                   │ Auth provider │  │  Your API        │
  │ (static host) │                   │ (Google/Apple │  │ (serverless fn)  │
  └───────────────┘                   │  /email)      │  └────────┬─────────┘
                                       └───────────────┘           ▼
                                                          ┌──────────────────┐
                                                          │  Database        │
                                                          │ (accounts, stats)│
                                                          └──────────────────┘
```

The frontend can *stay* on GitHub Pages; you add an auth provider, a small API
(serverless functions), and a database alongside it.

---

## 4. The three realistic options

| Option | What it is | Effort | Cost (hobby scale) | Security burden | Best for |
|--------|-----------|--------|--------------------|-----------------|----------|
| **A. Managed auth + serverless + managed DB** (e.g. Clerk/Auth0 for auth, Cloudflare/Vercel/Netlify functions, Supabase/Neon Postgres) | Best-in-class login as a service, you write a little glue | Medium | Free tiers cover hobby use; ~$0 to start | **Low** — provider handles tokens, hashing, resets | Most people. **Recommended.** |
| **B. All-in-one Backend-as-a-Service** (Supabase **or** Firebase) | Auth + database + APIs from one vendor | **Low–Medium** | Free tier, then usage-based | Low | A solo, non-backend developer who wants the fewest moving parts |
| **C. Roll your own** (Node/Express + Passport + Postgres + a mail service) | You build and run everything | **High** | A server (~$5–15/mo) + mail service | **High — it's all on you** | Learning exercise, or when you need total control |

**Recommended: A or B.** For *you* specifically, **B (Supabase)** is likely the
sweet spot — one dashboard gives you Google/Apple/email login **and** a Postgres
database to store scores, with a generous free tier. **C is not recommended** —
running your own auth means owning password hashing, breach response, and patching
forever.

---

## 5. OAuth in plain English (and the Google vs Apple specifics)

The standard flow (Authorization Code + **PKCE**), simplified:

1. Player clicks "Sign in with Google."
2. They're sent to Google, log in there, and approve.
3. Google sends back a one-time **code** to your app.
4. Your **backend** swaps that code (plus its secret) for a token. ← *must be
   server-side; this is the step a static site can't do safely.*
5. Your backend creates/looks up the player's account and starts a session.

**Google:** free. You register an OAuth client in the Google Cloud Console.

**Apple ("Sign in with Apple"):**
- Requires the **Apple Developer Program — $99/year (USD).**
- App Store rule of thumb: if your iOS app offers *any* third-party login
  (Google, etc.), Apple generally **requires** you to also offer Sign in with
  Apple. So if the [iOS native app plan](../IOS_NATIVE_APP_PLAN.md) happens, Apple
  sign-in moves from optional to basically mandatory.

**Email + password:** use your auth provider's **built-in** email flow
(verification, password reset, secure hashing). Do **not** hand-roll this — email
deliverability and password storage are easy to get dangerously wrong.

---

## 6. Cost & effort estimate

| Item | Cost | Notes |
|------|------|-------|
| Auth provider (Supabase/Clerk/Firebase) | **$0** to start | Free tiers fit hobby scale — *verify current limits, pricing changes* |
| Database | **$0** to start | Included in Supabase/Firebase free tier |
| Serverless API | **$0** to start | Cloudflare/Vercel/Netlify free tiers |
| Google sign-in | **$0** | — |
| Apple sign-in | **$99/year** | Only if you want Apple login / go to the App Store |
| Custom domain (optional) | ~$10–15/year | Not required |
| **Engineering effort (Phase 1)** | ~**1–3 days** | Google + email login behind one feature |

> Note: your **$5 work-budget cap** is about *my* time on a task — it's separate
> from these (mostly free-to-start) infrastructure costs.

---

## 7. New responsibilities you'd be taking on

This is the honest flip side. We just **removed** personal data from this repo;
adding accounts means **deliberately collecting and protecting** it:

- A **privacy policy** and a clear statement of what you store and why.
- **GDPR / CCPA** basics: let users see and **delete** their account/data.
- **Secure storage**: encryption, least-privilege database access, secrets in
  environment variables (never in the frontend or the repo).
- **Breach responsibility**: if emails leak, that's now your duty to handle.

A managed provider (Option A/B) shoulders most of the *technical* security, but the
*legal/privacy* responsibility for collecting emails is always yours.

---

## 8. Security checklist (for when it's built)

- [ ] HTTPS everywhere (Pages gives this free; your API must too)
- [ ] OAuth Authorization Code **+ PKCE**; client secret only on the backend
- [ ] Sessions in **HttpOnly + Secure + SameSite** cookies (or carefully-scoped tokens)
- [ ] **CSRF** protection on state-changing requests
- [ ] **Rate limiting / brute-force** protection on login + signup
- [ ] Password hashing with **argon2id or bcrypt** *(only if you ever DIY — Option C)*
- [ ] Least-privilege database credentials; no admin keys in app code
- [ ] Secrets in env vars / a secrets manager — **never** committed
- [ ] Dependency + secret scanning in CI
- [ ] Optional but nice: MFA, login alerts, audit logging

---

## 9. Recommended phased roadmap

- **Phase 0 — Decide the *why*.** Pick the one feature accounts unlock (saved
  scores is the easiest win). If you can't name one, **stop here** and do static
  hardening instead.
- **Phase 1 — MVP (~1–3 days).** Stand up **Supabase** (or Clerk). Add **Google +
  email** login. Keep the game on GitHub Pages; gate **only** the new feature
  (e.g. "save my scores"), not the whole game.
- **Phase 2 — Profiles & Apple.** Add Apple sign-in (if/when going to iOS — ties
  to the iOS plan, $99/yr), user profiles, and persistent stats in the database.
- **Phase 3 — Online play (the big one).** If the real goal was internet
  multiplayer, add a realtime backend (managed WebSockets / Supabase Realtime) for
  matchmaking. This dwarfs the auth work — scope it separately.

---

## 10. How this connects to your other plans

- **[iOS native app plan](../IOS_NATIVE_APP_PLAN.md):** Apple sign-in becomes
  near-mandatory on the App Store, and the backend built here would serve **both**
  the web and iOS versions — so design the API to be client-agnostic from day one.
- **Static hardening:** worth doing **regardless** of accounts — it's the real,
  achievable meaning of "enterprise-grade security" for the public web build.

---

## Bottom line

You almost certainly **don't need to gate the game** today. When a concrete feature
justifies accounts, the cheapest sound path is **Supabase + Google sign-in behind
that one feature** (Phase 1), expanding only as usage warrants. Add Apple at App
Store time. Keep ownership of the privacy obligations in mind — accounts are the
deliberate *opposite* of the PII cleanup we just did, so do it on purpose.
