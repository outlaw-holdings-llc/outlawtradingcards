#!/usr/bin/env bash
# OTC build auditor — third-party review of a build's diff (Gemini + Codex).
# Run after each build chunk, before/after committing.
#   Usage:  scripts/audit.sh <base-ref> [path ...]
#   e.g.    scripts/audit.sh HEAD~1
#           scripts/audit.sh d98ae47 outlawtradingcards.com/live-worker outlawtradingcards.com/functions
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
BASE="${1:-HEAD~1}"; shift || true
PATHS=("$@"); [ ${#PATHS[@]} -eq 0 ] && PATHS=(outlawtradingcards.com/)
DIFF="$(mktemp)"
git -C "$ROOT" diff "$BASE"..HEAD -- "${PATHS[@]}" > "$DIFF"
echo "== auditing $(wc -l < "$DIFF") diff lines since $BASE =="

INSTR="Senior code reviewer. Audit this git diff (a live trading-card site: Cloudflare Pages Functions, Durable Objects, WebSockets, Stripe, D1). Report ONLY concrete issues: [SEV high/med/low] file - problem - fix. Cover correctness, authz, XSS/injection, concurrency, resource leaks, error handling, CSP. Terse. If clean, say CLEAN."

echo "=== GEMINI ==="
GEMINI_API_KEY="$(cat /root/.gemini-api-key)" GEMINI_CLI_TRUST_WORKSPACE=true \
  gemini --approval-mode plan -m gemini-2.5-flash -p "$INSTR" < "$DIFF" 2>/dev/null \
  | grep -viE "warning|ripgrep|falling back|loaded cached" || true

echo "=== CODEX (explores the repo — allow a few minutes) ==="
# The red 'unknown variant max' model-refresh line is cosmetic (falls back + completes);
# strip the giant one-line models JSON so it doesn't flood output.
timeout 600 codex review --base "$BASE" 2>/dev/null | grep -av '"models"' | tail -50 \
  || echo "(codex timed out/unavailable — retry with a longer timeout, or 'git diff | codex exec')"

rm -f "$DIFF"
