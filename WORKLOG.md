# outlawtradingcards.com — WORKLOG

## 2026-08-11 — Session (MASSIVE: Phase 1 + Phase 2 full build of the live platform)

Owner: Noah (Chris's son). Goal = pull his Whatnot audience onto his own site (breaks + auctions,
no marketplace fees). Started as a static mock; this session built it into a working live platform.

### Done — Phase 1 (foundation, all LIVE)
- **Restored BUILD-SPEC.md** (Option-B single-seller live platform) + committed to git (was wiped once
  by the notbad curator regen — untracked files get clobbered; ALWAYS commit).
- **Backend foundation:** D1 db `otc-db` (uuid a3281e69-96af-43ae-aeb0-a1746febbf6b), Pages Functions
  API (`functions/api/`): auth (signup/signin/signout/me, PBKDF2 + session cookie `otc_session`),
  cards CRUD, shipping. Restructured to `public/` output dir so internal files aren't served.
- **Admin seller console `/console/`** + customer `/account/`: photo upload→KV `otc-images`
  (`IMAGES_KV`), served `/img/<key>`; Review Queue w/ Claude-assist (`cards.ai_suggestions`);
  inventory; sales/orders. Nav Account link on all pages.
- **Stripe payments (FULLY LIVE):** card-on-file (SetupIntent), saved-card mgmt, Buy-Now
  (PaymentIntent+3DS), webhook (sig-verified), `orders` table, `/checkout/`. All 3 secrets set.
  sk_live ROTATED + verified (old dead). Creds `/root/.otc-stripe-creds`.
- **Drive→AI auto-catalog pipeline** (`/opt/otc-pipeline/`, cron 15min): public Drive folder →
  Claude-vision classify → **ensemble pricing (Perplexity + Gemini + Claude web-search + Claude
  reconcile)** → `/api/ingest` (token-gated) → review queue. Handles HEIC. Keys `/root/.anthropic-key`
  + `/root/.perplexity-key` + `/root/.gemini-api-key`; creds `/root/.otc-pipeline-creds`.
- **Live streaming (Cloudflare Stream):** console Live Show panel (create show → RTMP key → Go Live),
  `/live/` real player embed, `/api/live`. CONFIRMED E2E with a real viewer (Noah watched Chris's
  Larix/iPhone stream). Player uses account subdomain `customer-cg6igngzsjy7wotl.cloudflarestream.com`.
- **Fixes:** real card photos render on shop (was emoji placeholder); in-browser HEIC→JPEG for manual
  upload (heic2any + `wasm-unsafe-eval` CSP); OG/Twitter link-preview cards (og-card.jpg 1200x630);
  flatpickr date/time picker for the Scheduled field.

### Done — Phase 2 (THE LIVE ROOM — feature complete)
Architecture: **Cloudflare Pages CANNOT host a Durable Object** → the `LiveRoom` DO lives in a
separate Worker **`otc-live`** (`live-worker/`, `wrangler deploy -c live-worker/wrangler.toml`); Pages
binds via `[[durable_objects.bindings]] script_name="otc-live"`. Same-origin preserved: Pages Fn
`functions/api/live/socket.js` authenticates (cookie) + forwards WS to the DO with X-User-* headers.
- **2a chat + real viewer count** — DO presence + chat + history replay; `/live/` wired (killed the
  demo `chatSim`). Audit: fixed orphaned-live-input on show-create DB fail.
- **2b live single-card auctions** — bids w/ min-increment, anti-snipe (last-12s extends), alarm-based
  close (`storage.setAlarm`), charge winner off-session via `/api/internal/auction-won`. Audit (Codex
  P1): **double-sale** — card stayed available mid-auction → fixed with reserve-on-start
  (available→reserved) via `/api/internal/auction-reserve` + release on no-sale.
- **2c live breaks** — spots/teams/razz; **concurrency-safe claim** (sync check+reserve BEFORE the
  async charge); **provably-fair razz** (publish sha256 commit hash on start, reveal seed on fill,
  deterministic `seededShuffle`). `/api/internal/break-claim`. Audit (Codex 2 P2s): end-mid-charge
  race (guard finalization w/ break.id re-check + block end while pending) + order title.
- **2d chat moderation + web-push** — mod: delete/timeout/ban/slow-mode (msg-id→author map, uid never
  sent to clients). push: VAPID + RFC8291 aes128gcm hand-rolled in `functions/api/_push.js`,
  `/api/push/{config,subscribe}`, `public/sw.js`, `/live/` 🔔 button, go-live PATCH fires push via
  `waitUntil`. Audit (Codex 2 P2s): chunk+cap push fan-out (subrequest limit) + check subscribe res.ok.
- **scripts/audit.sh** — runs Gemini + Codex on each build's diff. Established as the standing QA step.

### Also this session (minor)
- **yocaden.com:** pulled 7 iPhone HEIC house photos from Drive (gdown), converted to JPEG, wired room
  cards + expanded gallery + homepage hero. Committed + deployed.
- **IESS/NMC CA decommission CLOSED OUT** — Chris confirmed both domains clean; recorded in
  `project_nmc_ca_lineage` memory. Program done.

### Tried but rejected
- **DO in Pages Functions** → Pages rejects it ("DO bindings need script_name; no migrations support").
  Must use a separate Worker. (This is THE key architecture fact.)
- **R2 for images** → not enabled on the account (err 10042) → used KV instead. **Cloudflare Stream**
  needed enabling too (Chris enabled it). Both need dashboard/billing action.
- **`api_token_full`** → fails on D1/Pages-deploy (err 10000). Must use **`api_token_account`** (cfat_).
- Larix on iPhone defaults to **HEVC** → Cloudflare needs **H.264** (black screen until fixed).

### Open / Next session
- **📅 TOMORROW: Chris brings iPad + has Noah set up a stream + auction → full E2E validation +
  document.** Runbook DL: https://console.outlawholdingsllc.com/downloads/otc-validation-runbook.txt
- **⚠️ MONEY PATHS NEVER RUN WITH A REAL CARD** (auction-win + break-claim charges only tested with
  no-card users = graceful fail). #1 thing to validate: save card → win $1 lot / claim $1 spot →
  verify Stripe charge + refund.
- **Web-push delivery unverified on a real device** (encryption correct per spec, not byte-verified).
- System is CLEAN + ready: 0 shows, 0 orders, 0 subs, 10 cards, admins = Chris + Noah.
- Low-pri/polish: R2 migrate KV→R2; eBay-comp pricing; front/back photo pairing; DO WebSocket
  hibernation for scale; failed-payment recovery UX; VOD replay.

### Watch out for
- **Two deploys per change touching the DO:** `wrangler deploy -c live-worker/wrangler.toml` (Worker)
  THEN `wrangler pages deploy` (Pages). All Cloudflare ops use `api_token_account` (cfat_).
- **iOS web push** needs Add-to-Home-Screen first, or it won't fire.
- **Apex propagation lag:** after a Pages deploy the apex can serve a stale 404/old asset for a few
  seconds — test the `<hash>.pages.dev` deploy URL to bypass.
- **Codex CLI** is slow (explores repo) — give it ≥600s in audit.sh; its red "unknown variant max"
  error is cosmetic. Gemini needs `GEMINI_CLI_TRUST_WORKSPACE=true`.
- Creds: `/root/.otc-stripe-creds`, `/root/.otc-stream-creds` (stream token + VAPID + auction_secret),
  `/root/.otc-pipeline-creds`, cloudflare `/root/.console-creds/cloudflare.json`.
