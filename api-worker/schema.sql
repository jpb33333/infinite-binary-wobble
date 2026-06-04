-- Infinite Binary Wobble — D1 schema.
-- Apply: wrangler d1 execute ibw --file=./schema.sql  (or `npm run db:init`)
-- D1 is the durable source of truth for entitlements/purchases, and (on the
-- free plan) also holds the play counter. Durable Objects are an optional
-- upgrade for the counter only.

-- One row per identity: a web device token, or an iOS App Attest key.
CREATE TABLE IF NOT EXISTS devices (
  device_id        TEXT PRIMARY KEY,            -- opaque, server-generated
  platform         TEXT NOT NULL,               -- 'web' | 'ios'
  attest_pubkey    TEXT,                         -- iOS only: DER public key, base64
  assertion_count  INTEGER NOT NULL DEFAULT 0,   -- iOS App Attest monotonic counter
  play_count       INTEGER NOT NULL DEFAULT 0,   -- free-tier counter (D1 path)
  created_at       INTEGER NOT NULL,             -- epoch ms
  last_seen        INTEGER NOT NULL
);

-- Current unlock state. Written ONLY by verified payment paths — never by a
-- client request. A server-derived view of *current* payment state.
CREATE TABLE IF NOT EXISTS entitlements (
  device_id        TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'locked',  -- 'locked' | 'unlocked'
  source           TEXT,                             -- 'stripe' | 'apple'
  tier             TEXT,
  original_txn_id  TEXT,                             -- Apple originalTransactionId
  unlocked_at      INTEGER,
  updated_at       INTEGER NOT NULL
);

-- Apple StoreKit 2 / App Store Server Notifications V2.
CREATE TABLE IF NOT EXISTS apple_transactions (
  original_txn_id  TEXT PRIMARY KEY,
  txn_id           TEXT,
  device_id        TEXT,
  product_id       TEXT,
  status           TEXT,
  updated_at       INTEGER NOT NULL
);

-- Stripe web pay-what-you-want payments.
CREATE TABLE IF NOT EXISTS stripe_payments (
  session_id       TEXT PRIMARY KEY,
  device_id        TEXT,
  payment_intent   TEXT,
  amount_cents     INTEGER,
  currency         TEXT,
  status           TEXT,
  livemode         INTEGER,
  created_at       INTEGER NOT NULL
);

-- Idempotency: dedupe Stripe event.id and Apple notificationUUID so a replayed
-- webhook can't double-apply.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id         TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,                -- 'stripe' | 'apple'
  received_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entitlements_status ON entitlements(status);
CREATE INDEX IF NOT EXISTS idx_apple_txn_device ON apple_transactions(device_id);
