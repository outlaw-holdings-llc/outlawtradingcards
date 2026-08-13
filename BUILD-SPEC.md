# OutlawTradingCards — Live Break & Auction Platform — Build Spec

**Owner:** Noah (Chris's son). **Domain:** outlawtradingcards.com (Cloudflare Pages, main account).
**Status of this doc:** reconstructed 2026-08-11 and committed to git so it persists. Supersedes the
earlier un-committed draft that was wiped by the site-regen cron.

---

## 1. Goal & why this shape

Noah is an active, experienced **Whatnot** seller with an existing following. He is good at the
**live-auction / live-break** format. His pain is Whatnot's ~11% take (8% commission + 2.9% + $0.30
payments). **Goal: pull his existing bidding community off Whatnot onto his own site** to sell and
advertise his already-**graded singles**, and to run his **live breaks** — where he actually makes his
money.

**Decision (locked): Option B — a single-seller live platform.** Single-seller is the key simplifier.
Because Noah is the only seller, we do **not** build the expensive parts of a Whatnot clone:

- No Stripe **Connect** payouts, no seller KYC/onboarding.
- No multi-seller trust & safety, disputes between third parties, or per-seller ledgers.
- One merchant account (Noah's), one shipping origin, one inventory.

Rejected: **Option C** (full multi-seller marketplace clone) — $100–500k, 12–18 months. Not the goal.

**The core is the LIVE BREAK EXPERIENCE.** A "break" = a group buy: buyers claim **spots/teams**
(fixed price; sometimes randomized / "razz") in a sealed box or case. Noah rips packs **live on
stream**; each hit goes to whoever owns that team/spot. **Live single-card auctions** also run during
the show (he holds up a card → live bidding + countdown → the winner is charged). So the live room
needs BOTH:

1. a live **fixed-price "buy spot/team"** flow (with optional random assignment), and
2. a live **auction** flow (bid + countdown + charge-on-win),

over **low-latency video + live chat**. Do not defer live video — it is the product.

---

## 2. Architecture (Cloudflare-native, the account they're already on)

| Concern | Choice | Why |
|---|---|---|
| Real-time auction/break state | **Cloudflare Durable Objects** — one DO instance per live show/room | A single-threaded authoritative object per room holds bid state, the countdown timer, and spot ownership over WebSockets. No race conditions, no external realtime DB. |
| Low-latency video | **Cloudflare Stream Live** (default) — alternatives Amazon IVS real-time, Mux | Sub-second-ish glass-to-glass for the live rip. Stream keeps everything on the same bill/account. IVS if we need true <300ms interactive. |
| Payments | **Stripe** — single account, **SetupIntent** save-card at signup → **off-session PaymentIntent** charge-on-win / charge-on-claim | Card-on-file is mandatory for live bidding (charge the winner instantly, no checkout friction mid-show). No Connect needed. |
| Accounts + orders + history | **D1** (SQLite) or Postgres | Users, shipping profiles, catalog, auction/break results, ledger of charges + shipments. Start on D1 (native, free tier); migrate to Postgres only if it outgrows it. |
| Push alerts | **Web Push (VAPID)** | "Show starting" is the single biggest re-engagement lever for pulling the Whatnot crowd over. |
| Front end | Existing static site (Anton/Oswald/Inter, outlaw red + gold) → progressively wired to the API | The mock already exists; we replace mock arrays with real API calls page by page. |

---

## 3. Data model (first cut — D1)

- **users** — id, email, display_name, created_at, stripe_customer_id, push_subscription (json, nullable)
- **shipping_profiles** — id, user_id, name, address1/2, city, state, zip, country, is_default
- **cards** (graded singles catalog) — id, title, player, year, set, grader (PSA/BGS/SGC), grade,
  cert_number, price_cents, status (`available|sold|reserved`), image_key, created_at
- **shows** (live breaks/auction sessions) — id, title, scheduled_at, status
  (`scheduled|live|ended`), stream_uid, break_type (`spots|teams|razz|singles|mixed`)
- **break_slots** — id, show_id, label (team/spot), price_cents, owner_user_id (nullable),
  status (`open|claimed`), assigned_random (bool)
- **auctions** — id, show_id (nullable for standalone), card_id, start_cents, current_cents,
  high_bidder_user_id, ends_at, status (`open|won|unsold`)
- **bids** — id, auction_id, user_id, amount_cents, created_at
- **charges** — id, user_id, stripe_payment_intent_id, amount_cents, kind (`auction|break|buynow`),
  ref_id, status, created_at
- **shipments** — id, user_id, status, tracking, items (json), created_at

---

## 4. Phasing

### Phase 1 — Foundation (~2 weeks). *Prereq for everything; no live video yet.*
- Accounts (sign up / sign in). Cloudflare Pages Functions or a Worker + D1.
- **Stripe card-on-file** via SetupIntent (save card at signup; store `stripe_customer_id`).
- Shipping profiles.
- **Graded-singles catalog + Buy-Now** — replaces the mock `CATALOG` array with a D1-backed API;
  real card photos. This also delivers Noah's *secondary* goal immediately: advertise & sell graded
  singles direct, off-Whatnot. Buy-Now uses a normal on-session PaymentIntent.
- Admin: a simple authenticated path for Noah to add cards + create shows.

### Phase 2 — THE LIVE ROOM (the money).
Video is DONE (Cloudflare Stream Live in `/live/`, confirmed with a real viewer 2026-08-12).
Remaining Phase 2 = the **real-time interactive layer**. Architecture: **one Cloudflare Durable
Object per show** (`LiveRoom`, keyed by show id) = the authoritative real-time room. Clients connect
over **WebSockets**; the DO holds live state (chat, bids, break spots, presence) and broadcasts deltas.
Money actions reuse Phase-1 Stripe card-on-file (off-session PaymentIntents) + the `orders` table.

Components:
1. **Live chat** — real-time; signed-in users post, broadcast to all. Moderation (delete msg,
   timeout/ban, slow-mode, pin). Recent-history replay for late joiners.
2. **Real viewer count / presence** — live connected-count, updates on join/leave.
3. **Live single-card auctions** — Noah puts a card on the block; real-time bids w/ min-increment,
   high-bidder tracking, countdown + **anti-snipe** (late bid extends timer); on end, **charge winner**
   off-session → mark sold → order → notify.
4. **Live breaks (spots/teams)** — group buy of a sealed box/case; claim spot/team at fixed price,
   charge on claim; DO prevents double-claims; **razz** randomizer = provably-fair (seed+hash) team
   assignment when a break fills; each hit routes to the spot owner.
5. **Noah's live control panel** (console, during show) — put card up / start-stop timer, set break +
   spots, mark hits, moderate chat, pin messages — alongside the video he's broadcasting.
6. **Web-Push "show starting" alerts** (VAPID) — opt-in; biggest lever to pull the Whatnot crowd over.
7. **Charge + fulfillment** — off-session charges for winners/claimers; handle declines (re-offer next
   bidder / re-open spot); feed orders + shipping; receipts.

**Build order (incremental, each shippable + tested before the next):**
- **2a — Chat + real viewer count** (DO + WebSocket foundation; lowest risk, immediate payoff).
- **2b — Live single-card auctions** (bid → countdown → auto-charge winner; the core money mechanic).
- **2c — Breaks: spots/teams + razz** (his primary format).
- **2d — Push alerts + polish** (moderation depth, anti-snipe, reconnection, receipts, VOD replay).

**Risk notes:** biggest/most delicate build — real-time, moves real money live, needs concurrency
safety (no double-claims), fairness (razz), and abuse controls (chat moderation). Multi-session;
build+test each sub-phase. Open decision: whether `LiveRoom` DO lives in the Pages Functions bundle
or a dedicated `otc-live` Worker (same-origin routing preferred for cookie auth) — spike 2a decides.

### Phase 3 — Scale.
- Advanced break formats, PWA/native app, VOD replay, analytics, moderation tooling.

**Realistic effort:** live-room MVP ≈ $30–70k if contracted, or a multi-month Noah+Claude incremental
build. ~2–4 months to a polished live room.

---

## 5. Hard prerequisites we need from Noah (block certain steps)

1. **Stripe account** (Noah's) → publishable + secret keys. Needed for any real card-on-file / charge.
   Until then, Phase 1 payments run against **Stripe test keys**.
2. **Cloudflare Stream** enabled on the account (has a cost) → needed to start Phase 2 video.
3. **Real inventory** — graded-singles data + slab photos to seed the catalog.
4. Business/tax basics for taking money directly (was Whatnot's job before).

---

## 6. GTM caveat

The hardest part is **not** the tech — it's getting the Whatnot audience to show up on a new site.
Levers: exclusive drops only on his site, pass the ~11% fee savings through as better prices/value,
and **announce every show on Whatnot** to funnel viewers over. Build the "show starting" push +
calendar early.

---

## 7. Current state (2026-08-11)

Front end is a **live static mock** at outlawtradingcards.com / outlawtradingcards.pages.dev. Catalog,
auctions, cart, live chat, viewer count, and the stream player are all client-side demos in `site.js`
(`CATALOG`/`AUCTIONS` arrays; cart in localStorage). **Nothing is wired to a backend, payments, or
inventory yet.** Everything in Phases 1–2 above is the work to make it real.
