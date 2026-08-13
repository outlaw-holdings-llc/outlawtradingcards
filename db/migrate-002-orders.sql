-- Migration 002: orders (Buy-Now / checkout). Run once.
CREATE TABLE IF NOT EXISTS orders (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id),
  amount_cents             INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | canceled | refunded
  shipping_profile_id      TEXT,
  items                    TEXT,   -- JSON: [{card_id,title,price_cents}]
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_pi ON orders(stripe_payment_intent_id);
