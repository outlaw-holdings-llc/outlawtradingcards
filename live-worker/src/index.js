// otc-live Worker — hosts the LiveRoom Durable Object (one instance per show).
// Real-time chat + presence (2a) and live single-card auctions (2b).
// Not publicly routed; Pages Functions bind to it (LIVE_ROOM) and forward
// authenticated WebSocket upgrades. Money/DB actions are delegated to the
// site's internal API (SITE_URL + AUCTION_SECRET) so all Stripe/D1 logic
// stays in one audited place.

export default {
  async fetch() {
    return new Response('otc-live: durable object host', { status: 200 });
  },
};

const ANTISNIPE_MS = 12000; // a bid inside the last 12s extends the timer to 12s

export class LiveRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // ws -> {id,name,role}
    this.history = [];
    this.auction = null;       // persisted (money-critical): survives DO eviction
    this.break = null;
    // moderation (ephemeral per live room)
    this.mod = { banned: new Set(), muted: new Map(), slowMs: 0, lastPost: new Map() };
    this.msgAuthor = new Map(); // msgId -> {uid, name} (server-only; never sent to clients)
    state.blockConcurrencyWhile(async () => {
      this.auction = (await state.storage.get('auction')) || null;
      this.break = (await state.storage.get('break')) || null;
    });
  }

  // ---- connection lifecycle ----
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const who = {
      id: request.headers.get('X-User-Id') || '',
      name: request.headers.get('X-User-Name') || '',
      role: request.headers.get('X-User-Role') || '',
    };
    server.accept();
    this.sessions.set(server, who);

    server.send(JSON.stringify({ type: 'welcome', you: { name: who.name, signedIn: !!who.id, admin: who.role === 'admin' } }));
    server.send(JSON.stringify({ type: 'history', messages: this.history.slice(-50) }));
    if (this.auction) server.send(JSON.stringify({ type: 'auction', auction: this.publicAuction() }));
    if (this.break) server.send(JSON.stringify({ type: 'break', break: this.publicBreak() }));
    this.broadcastPresence();

    server.addEventListener('message', (evt) => this.onMessage(server, evt));
    const drop = () => { this.sessions.delete(server); this.broadcastPresence(); };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(ws, evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    const who = this.sessions.get(ws);
    if (!who) return;

    if (msg.type === 'chat') return this.onChat(ws, who, msg);
    if (msg.type === 'bid') return this.onBid(ws, who, msg);
    if (msg.type === 'auction_start') return this.onAuctionStart(ws, who, msg);
    if (msg.type === 'auction_end') return this.onAuctionEnd(ws, who);
    if (msg.type === 'break_start') return this.onBreakStart(ws, who, msg);
    if (msg.type === 'claim') return this.onClaim(ws, who, msg);
    if (msg.type === 'break_end') return this.onBreakEnd(ws, who);
    if (msg.type === 'mod_delete') return this.onModDelete(ws, who, msg);
    if (msg.type === 'mod_timeout') return this.onModTimeout(ws, who, msg);
    if (msg.type === 'mod_ban') return this.onModBan(ws, who, msg);
    if (msg.type === 'mod_slow') return this.onModSlow(ws, who, msg);
  }

  // ---- chat ----
  onChat(ws, who, msg) {
    if (!who.id) { ws.send(JSON.stringify({ type: 'error', error: 'Sign in to chat' })); return; }
    if (this.mod.banned.has(who.id)) { ws.send(JSON.stringify({ type: 'error', error: 'You are banned from chat' })); return; }
    const mutedUntil = this.mod.muted.get(who.id) || 0;
    if (Date.now() < mutedUntil) {
      ws.send(JSON.stringify({ type: 'error', error: `Timed out — ${Math.ceil((mutedUntil - Date.now()) / 1000)}s left` })); return;
    }
    if (who.role !== 'admin' && this.mod.slowMs) {
      const since = Date.now() - (this.mod.lastPost.get(who.id) || 0);
      if (since < this.mod.slowMs) { ws.send(JSON.stringify({ type: 'error', error: `Slow mode — wait ${Math.ceil((this.mod.slowMs - since) / 1000)}s` })); return; }
    }
    const text = String(msg.text || '').slice(0, 240).trim();
    if (!text) return;
    this.mod.lastPost.set(who.id, Date.now());
    const id = randHex(6);
    this.msgAuthor.set(id, { uid: who.id, name: who.name });
    if (this.msgAuthor.size > 400) this.msgAuthor.delete(this.msgAuthor.keys().next().value);
    const out = { type: 'chat', id, name: who.name, role: who.role, text, ts: Date.now() };
    this.history.push(out);
    if (this.history.length > 200) this.history.shift();
    this.broadcast(out);
  }

  // ---- moderation (admin only; targets resolved from a message id -> author) ----
  onModDelete(ws, who, msg) {
    if (who.role !== 'admin') return;
    const id = String(msg.id || '');
    this.history = this.history.filter((m) => m.id !== id);
    this.broadcast({ type: 'chat_delete', id });
  }
  onModTimeout(ws, who, msg) {
    if (who.role !== 'admin') return;
    const a = this.msgAuthor.get(String(msg.id || ''));
    if (!a) return;
    const secs = Math.max(5, Math.min(3600, Math.round(Number(msg.seconds) || 60)));
    this.mod.muted.set(a.uid, Date.now() + secs * 1000);
    this.system(`⏱ ${a.name} was timed out (${secs}s).`);
  }
  onModBan(ws, who, msg) {
    if (who.role !== 'admin') return;
    const a = this.msgAuthor.get(String(msg.id || ''));
    if (!a) return;
    this.mod.banned.add(a.uid);
    this.system(`⛔ ${a.name} was banned from chat.`);
  }
  onModSlow(ws, who, msg) {
    if (who.role !== 'admin') return;
    this.mod.slowMs = Math.max(0, Math.min(300, Math.round(Number(msg.seconds) || 0))) * 1000;
    this.system(this.mod.slowMs ? `🐢 Slow mode: 1 message / ${this.mod.slowMs / 1000}s.` : 'Slow mode off.');
  }

  // ---- auctions (2b) ----
  async onAuctionStart(ws, who, msg) {
    if (who.role !== 'admin') { ws.send(JSON.stringify({ type: 'error', error: 'Admins only' })); return; }
    if (this.auction && this.auction.status === 'open') {
      ws.send(JSON.stringify({ type: 'error', error: 'An auction is already live' })); return;
    }
    const cardId = String(msg.card_id || '');
    if (!cardId) { ws.send(JSON.stringify({ type: 'error', error: 'Pick a card' })); return; }

    // Reserve the card (take it off the shop) BEFORE starting — prevents a
    // parallel Buy-Now double-sale while bidding is live.
    let reserved;
    try {
      const r = await fetch(`${this.env.SITE_URL}/api/internal/auction-reserve`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + this.env.AUCTION_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
      reserved = await r.json().catch(() => ({}));
    } catch (e) { reserved = { ok: false, error: String(e.message || e) }; }
    if (!reserved || !reserved.ok) {
      ws.send(JSON.stringify({ type: 'error', error: (reserved && reserved.error) || 'Could not reserve card' })); return;
    }

    const startCents = Math.max(0, Math.round(Number(msg.start_cents) || 0));
    const minInc = Math.max(100, Math.round(Number(msg.min_increment_cents) || 100));
    const durMs = Math.min(600, Math.max(10, Math.round(Number(msg.duration_sec) || 45))) * 1000;
    this.auction = {
      cardId,
      title: String(reserved.title || msg.title || 'Live Lot').slice(0, 120),
      image: reserved.image || (msg.image ? String(msg.image) : null),
      startCents,
      currentCents: 0,       // 0 until the first bid
      minIncrement: minInc,
      highBidderId: '', highBidderName: '',
      endsAt: Date.now() + durMs,
      status: 'open',
    };
    await this.saveAuction();
    await this.state.storage.setAlarm(this.auction.endsAt);
    this.broadcast({ type: 'auction', auction: this.publicAuction() });
    this.system(`🔨 Auction started: ${this.auction.title}`);
  }

  async onBid(ws, who, msg) {
    if (!who.id) { ws.send(JSON.stringify({ type: 'error', error: 'Sign in to bid' })); return; }
    const a = this.auction;
    if (!a || a.status !== 'open') { ws.send(JSON.stringify({ type: 'error', error: 'No live auction' })); return; }
    if (Date.now() >= a.endsAt) { ws.send(JSON.stringify({ type: 'error', error: 'Auction just ended' })); return; }

    const amount = Math.round(Number(msg.amount_cents) || 0);
    const floor = a.currentCents ? a.currentCents + a.minIncrement : Math.max(a.startCents, a.minIncrement);
    if (amount < floor) {
      ws.send(JSON.stringify({ type: 'error', error: `Bid at least $${(floor / 100).toFixed(2)}` })); return;
    }
    a.currentCents = amount;
    a.highBidderId = who.id;
    a.highBidderName = who.name;
    // anti-snipe: keep at least ANTISNIPE_MS on the clock after a late bid
    const remaining = a.endsAt - Date.now();
    if (remaining < ANTISNIPE_MS) {
      a.endsAt = Date.now() + ANTISNIPE_MS;
      await this.state.storage.setAlarm(a.endsAt);
    }
    await this.saveAuction();
    this.broadcast({ type: 'auction', auction: this.publicAuction(), lastBid: { name: who.name, amount } });
  }

  async onAuctionEnd(ws, who) {
    if (who.role !== 'admin') { ws.send(JSON.stringify({ type: 'error', error: 'Admins only' })); return; }
    await this.closeAuction();
  }

  async alarm() {
    if (this.auction && this.auction.status === 'open' && Date.now() >= this.auction.endsAt) {
      await this.closeAuction();
    }
  }

  async closeAuction() {
    const a = this.auction;
    if (!a || a.status !== 'open') return;
    a.status = 'closed';
    await this.saveAuction();
    await this.state.storage.deleteAlarm().catch(() => {});

    if (!a.highBidderId) {
      this.broadcast({ type: 'auction_closed', result: 'no_sale', title: a.title });
      this.system(`Auction ended — no bids on ${a.title}.`);
      await this.releaseCard(a.cardId);   // put it back on the shop
      return this.clearAuction();
    }

    this.broadcast({ type: 'auction_closed', result: 'pending', title: a.title,
      winnerName: a.highBidderName, amount: a.currentCents });
    this.system(`SOLD: ${a.title} to ${a.highBidderName} for $${(a.currentCents / 100).toFixed(2)} — charging card…`);

    // Delegate the charge to the site's internal API (has Stripe + D1).
    let charged = null;
    try {
      const r = await fetch(`${this.env.SITE_URL}/api/internal/auction-won`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.env.AUCTION_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: a.cardId, winner_user_id: a.highBidderId, amount_cents: a.currentCents, title: a.title }),
      });
      charged = await r.json().catch(() => ({}));
      charged.ok = r.ok;
    } catch (e) { charged = { ok: false, error: String(e.message || e) }; }

    if (charged && charged.ok && charged.status === 'paid') {
      this.broadcast({ type: 'auction_settled', result: 'paid', title: a.title, winnerName: a.highBidderName, amount: a.currentCents });
      this.system(`✅ Payment received from ${a.highBidderName}.`);
    } else {
      this.broadcast({ type: 'auction_settled', result: 'failed', title: a.title, winnerName: a.highBidderName });
      this.system(`⚠️ Payment for ${a.title} needs attention (${(charged && charged.error) || 'card declined'}). Noah will follow up.`);
    }
    await this.clearAuction();
  }

  // ---- breaks (2c): spots / teams / razz ----
  async onBreakStart(ws, who, msg) {
    if (who.role !== 'admin') { ws.send(JSON.stringify({ type: 'error', error: 'Admins only' })); return; }
    if (this.break && this.break.status !== 'closed') {
      ws.send(JSON.stringify({ type: 'error', error: 'A break is already running' })); return;
    }
    const type = ['spots', 'teams', 'razz'].includes(msg.break_type) ? msg.break_type : 'spots';
    const priceCents = Math.max(50, Math.round(Number(msg.price_cents) || 0));
    let labels = Array.isArray(msg.labels) ? msg.labels.map((l) => String(l).slice(0, 40)).filter(Boolean) : [];
    let teams = null;
    if (type === 'spots') {
      const n = Math.min(60, Math.max(2, Math.round(Number(msg.spot_count) || labels.length || 8)));
      labels = Array.from({ length: n }, (_, i) => `Spot ${i + 1}`);
    } else if (type === 'razz') {
      if (labels.length < 2) { ws.send(JSON.stringify({ type: 'error', error: 'Razz needs a team list' })); return; }
      teams = labels.slice();
      labels = teams.map((_, i) => `Slot ${i + 1}`);
    } else { // teams: buyer picks a named team
      if (labels.length < 2) { ws.send(JSON.stringify({ type: 'error', error: 'Add at least 2 teams' })); return; }
    }
    const spots = labels.map((label) => ({ label, status: 'open', ownerId: '', ownerName: '', team: null }));
    let seedHash = null, serverSeed = null;
    if (type === 'razz') { serverSeed = randHex(32); seedHash = await sha256hex(serverSeed); } // commit; reveal on fill
    this.break = {
      id: randHex(6), title: String(msg.title || 'Live Break').slice(0, 120),
      type, priceCents, spots, teams, seedHash, serverSeed: null, _serverSeed: serverSeed, status: 'open',
    };
    await this.saveBreak();
    this.broadcast({ type: 'break', break: this.publicBreak() });
    this.system(`📦 Break started: ${this.break.title} — $${(priceCents / 100).toFixed(2)}/spot`);
  }

  async onClaim(ws, who, msg) {
    if (!who.id) { ws.send(JSON.stringify({ type: 'error', error: 'Sign in to claim a spot' })); return; }
    const b = this.break;
    if (!b || b.status !== 'open') { ws.send(JSON.stringify({ type: 'error', error: 'No open break' })); return; }
    const spot = b.spots[Math.round(Number(msg.spot))];
    if (!spot) { ws.send(JSON.stringify({ type: 'error', error: 'Invalid spot' })); return; }
    // --- critical section: NO await between the check and the reserve ---
    if (spot.status !== 'open') { ws.send(JSON.stringify({ type: 'error', error: 'That spot is taken' })); return; }
    spot.status = 'pending'; spot.ownerId = who.id; spot.ownerName = who.name;
    // --- end critical section ---
    await this.saveBreak();
    this.broadcast({ type: 'break', break: this.publicBreak() });

    let charged;
    try {
      const r = await fetch(`${this.env.SITE_URL}/api/internal/break-claim`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + this.env.AUCTION_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: who.id, amount_cents: b.priceCents, break_title: b.title, spot_label: spot.label }),
      });
      charged = await r.json().catch(() => ({}));
      charged.ok = r.ok;
    } catch (e) { charged = { ok: false, error: String(e.message || e) }; }

    // the break could have been ended/replaced while we awaited the charge
    const stillActive = this.break && this.break.id === b.id;
    if (charged && charged.ok && charged.status === 'paid') {
      if (stillActive) {
        spot.status = 'claimed';
        await this.saveBreak();
        this.broadcast({ type: 'break', break: this.publicBreak() });
        this.system(`✅ ${who.name} claimed ${spot.label}`);
        if (this.break.spots.every((s) => s.status === 'claimed')) await this.fillBreak();
      } else {
        // paid, but the break closed mid-charge — the order is recorded; flag for Noah
        this.system(`⚠️ ${who.name}'s payment for ${spot.label} landed after the break closed — Noah will assign it.`);
      }
    } else {
      if (stillActive) {
        spot.status = 'open'; spot.ownerId = ''; spot.ownerName = '';
        await this.saveBreak();
        this.broadcast({ type: 'break', break: this.publicBreak() });
      }
      ws.send(JSON.stringify({ type: 'error', error: (charged && charged.error) || 'Payment failed — spot released' }));
    }
  }

  async fillBreak() {
    const b = this.break;
    if (!b || b.status !== 'open') return;
    b.status = 'filled';
    if (b.type === 'razz' && b.teams) {
      const order = await seededShuffle(b.teams.length, b._serverSeed);
      b.spots.forEach((s, i) => { s.team = b.teams[order[i % b.teams.length]]; });
      b.serverSeed = b._serverSeed;   // reveal for verification
    }
    await this.saveBreak();
    this.broadcast({ type: 'break', break: this.publicBreak(), filled: true });
    this.system(`🔥 Break FILLED: ${b.title}. Ripping live!` + (b.type === 'razz' ? ' (razz seed revealed — verify below)' : ''));
  }

  async onBreakEnd(ws, who) {
    if (who.role !== 'admin') { ws.send(JSON.stringify({ type: 'error', error: 'Admins only' })); return; }
    if (this.break && this.break.spots.some((s) => s.status === 'pending')) {
      ws.send(JSON.stringify({ type: 'error', error: 'A claim is still processing — end it again in a moment.' })); return;
    }
    if (this.break) { this.break.status = 'closed'; await this.saveBreak(); this.broadcast({ type: 'break', break: this.publicBreak() }); }
    await this.clearBreak();
  }

  // ---- helpers ----
  async saveBreak() { await this.state.storage.put('break', this.break); }
  async clearBreak() { this.break = null; await this.state.storage.delete('break'); }
  publicBreak() {
    const b = this.break; if (!b) return null;
    return {
      id: b.id, title: b.title, type: b.type, priceCents: b.priceCents, status: b.status,
      seedHash: b.seedHash, serverSeed: b.serverSeed,   // serverSeed stays null until fill
      spots: b.spots.map((s) => ({ label: s.label, status: s.status, ownerName: s.ownerName, team: s.team })),
    };
  }
  async saveAuction() { await this.state.storage.put('auction', this.auction); }
  async clearAuction() { this.auction = null; await this.state.storage.delete('auction'); }
  async releaseCard(cardId) {
    if (!cardId) return;
    try {
      await fetch(`${this.env.SITE_URL}/api/internal/auction-release`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + this.env.AUCTION_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
    } catch { /* best-effort */ }
  }
  publicAuction() {
    const a = this.auction;
    return a && {
      cardId: a.cardId, title: a.title, image: a.image,
      currentCents: a.currentCents, startCents: a.startCents, minIncrement: a.minIncrement,
      highBidderName: a.highBidderName, endsAt: a.endsAt, status: a.status,
    };
  }
  system(text) {
    const out = { type: 'chat', name: 'Outlaw', role: 'system', text, ts: Date.now() };
    this.history.push(out);
    if (this.history.length > 200) this.history.shift();
    this.broadcast(out);
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.sessions.keys()) { try { ws.send(s); } catch { this.sessions.delete(ws); } }
  }
  broadcastPresence() { this.broadcast({ type: 'presence', count: this.sessions.size }); }
}

// ---- provably-fair helpers (verifiable by anyone with the revealed seed) ----
function randHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Deterministic Fisher-Yates permutation of [0..n-1], entropy = sha256(seed:i).
// Anyone can reproduce it from the revealed seed to verify a razz wasn't rigged.
async function seededShuffle(n, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const h = await sha256hex(`${seed}:${i}`);
    const r = parseInt(h.slice(0, 8), 16) % (i + 1);
    [idx[i], idx[r]] = [idx[r], idx[i]];
  }
  return idx;
}
