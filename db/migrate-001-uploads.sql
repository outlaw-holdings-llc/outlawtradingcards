-- Migration 001: card upload + review-queue columns. Run once (ADD COLUMN is not idempotent).
ALTER TABLE cards ADD COLUMN image_back_url TEXT;
ALTER TABLE cards ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN notes TEXT;
ALTER TABLE cards ADD COLUMN ai_suggestions TEXT;
