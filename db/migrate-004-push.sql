-- Migration 004: web-push subscriptions. Run once.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_id    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
