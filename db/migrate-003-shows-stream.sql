-- Migration 003: live-stream credentials on shows. Run once.
ALTER TABLE shows ADD COLUMN rtmps_url TEXT;
ALTER TABLE shows ADD COLUMN rtmps_key TEXT;   -- per-input ingest secret (admin-only, never public)
