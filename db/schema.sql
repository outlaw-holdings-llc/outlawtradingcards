-- OutlawTradingCards — D1 schema (Phase 1 foundation)
-- Applied to D1 database "otc-db". Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  stripe_customer_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- sha256(raw cookie token)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS shipping_profiles (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address1   TEXT NOT NULL,
  address2   TEXT,
  city       TEXT NOT NULL,
  state      TEXT NOT NULL,
  zip        TEXT NOT NULL,
  country    TEXT NOT NULL DEFAULT 'US',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ship_user ON shipping_profiles(user_id);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,               -- Pokémon | Basketball | Football | Baseball | One Piece ...
  player      TEXT,
  year        TEXT,
  card_set    TEXT,
  grader      TEXT,                        -- PSA | BGS | SGC | Raw
  grade       TEXT,                        -- '10', '9.5', 'Raw'
  cert_number TEXT,
  tag         TEXT,                        -- Grail | Rookie | Hot | Auto | Vintage ...
  emoji       TEXT,                        -- fallback glyph until real photos exist
  image_url   TEXT,                        -- primary (front) photo, served from /img/<key>
  image_back_url TEXT,                     -- optional back photo
  price_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'available',  -- available | reserved | sold
  needs_review INTEGER NOT NULL DEFAULT 0, -- 1 = freshly uploaded, awaiting Claude/Noah review
  notes       TEXT,                        -- free-text (seller or reviewer notes)
  ai_suggestions TEXT,                     -- JSON of Claude's proposed enrichments (pending accept)
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_cards_cat ON cards(category);

-- ---- forward-declared for Phase 2 (not yet served by the API) ----
CREATE TABLE IF NOT EXISTS shows (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  scheduled_at TEXT,
  status       TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | live | ended
  break_type   TEXT,                              -- spots | teams | razz | singles | mixed
  stream_uid   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
