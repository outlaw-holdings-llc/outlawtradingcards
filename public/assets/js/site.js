/* ===========================================================
   OUTLAW TRADING CARDS — site.js  (draft, front-end mock)
   Cart, catalog render, auction countdowns, live chat sim.
   No backend yet — data is local; wire to real API later.
   =========================================================== */

/* ---------- nav / drawer ---------- */
function toggleNav(){document.getElementById('nav-links')?.classList.toggle('open');}
function openDrawer(){document.getElementById('drawer')?.classList.add('open');document.getElementById('drawer-mask')?.classList.add('open');}
function closeDrawer(){document.getElementById('drawer')?.classList.remove('open');document.getElementById('drawer-mask')?.classList.remove('open');}

/* ---------- catalog (loaded from /api/cards) ---------- */
let CATALOG = [];
async function loadCatalog(){
  try{
    const res = await fetch('/api/cards');
    if(!res.ok) throw new Error('status '+res.status);
    const data = await res.json();
    CATALOG = data.cards || [];
  }catch(e){
    console.error('catalog load failed', e);
    CATALOG = [];
  }
  return CATALOG;
}

const AUCTIONS = [
  {id:'a1', title:'Michael Jordan 1986 Fleer RC', grade:'PSA 7', emoji:'🐐', bid:8200, bids:34, ends:1000*60*60*6},
  {id:'a2', title:'Pikachu Illustrator (Repro Lot)', grade:'Raw', emoji:'⚡', bid:640, bids:52, ends:1000*60*47},
  {id:'a3', title:'Luka Dončić Logoman 1/1', grade:'BGS 9', emoji:'🏀', bid:15400, bids:71, ends:1000*60*60*22},
  {id:'a4', title:'Sealed Evolving Skies Booster Box', grade:'Sealed', emoji:'📦', bid:445, bids:28, ends:1000*60*12},
];

/* ---------- render helpers ---------- */
function cardHTML(p){
  return `<div class="card">
    <div class="card-media">
      ${p.grade&&p.grade!=='Raw'?`<span class="grade-badge">${p.grade}</span>`:''}
      ${p.tag?`<span class="tag-badge">${p.tag}</span>`:''}
      ${p.image_url?`<img class="card-photo" src="${p.image_url}" alt="${p.title}" loading="lazy">`:`<div class="slab"><span class="emoji">${p.emoji}</span></div>`}
    </div>
    <div class="card-body">
      <span class="card-cat">${p.cat}</span>
      <span class="card-title">${p.title}</span>
      <div class="card-foot">
        <span class="price">$${p.price.toLocaleString()}<small>Buy direct</small></span>
        <button class="btn sm" onclick="addToCart('${p.id}')">Add</button>
      </div>
    </div></div>`;
}
function renderGrid(id, items){const el=document.getElementById(id);if(el)el.innerHTML=items.map(cardHTML).join('');}

function auctionHTML(a){
  return `<div class="auction" data-ends="${Date.now()+a.ends}" id="auc-${a.id}">
    <div class="card-media">
      <span class="grade-badge">${a.grade}</span>
      <span class="tag-badge">Live Bid</span>
      <div class="slab"><span class="emoji">${a.emoji}</span></div>
    </div>
    <div class="auction-body">
      <span class="card-title">${a.title}</span>
      <div class="bid-row">
        <div class="bid-now"><b id="bid-${a.id}">$${a.bid.toLocaleString()}</b><span>Current bid</span></div>
        <div class="bid-count"><b id="bids-${a.id}">${a.bids}</b><span>Bids</span></div>
      </div>
      <div class="countdown" id="cd-${a.id}"></div>
      <div class="bid-bar">
        <input type="number" id="in-${a.id}" placeholder="$${(a.bid+25).toLocaleString()} or more" min="${a.bid+25}">
        <button class="btn gold sm" onclick="placeBid('${a.id}')">Bid</button>
      </div>
    </div></div>`;
}
function renderAuctions(id, items){const el=document.getElementById(id);if(el)el.innerHTML=items.map(auctionHTML).join('');startCountdowns();}

/* ---------- countdown ---------- */
function fmtCD(ms){
  if(ms<0)ms=0;
  const d=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4),s=Math.floor(ms%6e4/1e3);
  const seg=(v,l)=>`<div class="seg"><b>${String(v).padStart(2,'0')}</b><span>${l}</span></div>`;
  return (d>0?seg(d,'days'):'')+seg(h,'hrs')+seg(m,'min')+seg(s,'sec');
}
function startCountdowns(){
  const tick=()=>{document.querySelectorAll('.auction[data-ends]').forEach(el=>{
    const ends=+el.dataset.ends, left=ends-Date.now();
    const cd=el.querySelector('.countdown');
    if(cd){cd.innerHTML=fmtCD(left);cd.classList.toggle('ending',left<1000*60*10);}
  });};
  tick();clearInterval(window.__cdT);window.__cdT=setInterval(tick,1000);
}
function placeBid(id){
  const inp=document.getElementById('in-'+id);const cur=+document.getElementById('bid-'+id).textContent.replace(/[^0-9]/g,'');
  const v=parseInt(inp.value||0);
  if(v<cur+25){alert('Bid must be at least $'+(cur+25).toLocaleString());return;}
  document.getElementById('bid-'+id).textContent='$'+v.toLocaleString();
  const bc=document.getElementById('bids-'+id);bc.textContent=(+bc.textContent)+1;
  inp.value='';inp.placeholder='$'+(v+25).toLocaleString()+' or more';
  toast('Bid placed — you\'re the high bidder! (demo)');
}

/* ---------- cart ---------- */
let CART=JSON.parse(localStorage.getItem('otc_cart')||'[]');
function saveCart(){localStorage.setItem('otc_cart',JSON.stringify(CART));paintCart();}
function addToCart(pid){const p=CATALOG.find(x=>x.id===pid);if(!p)return;CART.push(p);saveCart();openDrawer();}
function removeItem(i){CART.splice(i,1);saveCart();}
function paintCart(){
  document.querySelectorAll('.cart-count').forEach(e=>e.textContent=CART.length);
  const body=document.getElementById('drawer-body');if(!body)return;
  if(!CART.length){body.innerHTML='<p class="empty-cart">Your cart is empty.<br>Go pull something.</p>';}
  else{body.innerHTML=CART.map((p,i)=>`<div class="ci"><div class="cim">${p.emoji}</div>
    <div class="cit">${p.title}<br><span style="color:#9b9ba2">${p.cat} · ${p.grade}</span></div>
    <div class="cip">$${p.price.toLocaleString()}</div>
    <button onclick="removeItem(${i})" style="background:none;border:none;color:#9b9ba2;cursor:pointer;font-size:1.1rem">×</button></div>`).join('');}
  const tot=CART.reduce((s,p)=>s+p.price,0);
  const t=document.getElementById('cart-total');if(t)t.textContent='$'+tot.toLocaleString();
}

/* ---------- live chat sim ---------- */
const CHAT_NAMES=['SlabHunter','RipCity','GradeGod','WaxKing','OutlawKid','PokeWhale','CardVulture','NoReserve','MintOrBust','PPGChaser'];
const CHAT_LINES=['that hit is INSANE 🔥','GEM MINT for sure','sniped it at the buzzer 😤','box break when??','wemby to the moon 🚀',
  'raw dog that pull','PSA 10 lock','let\'s gooo','no reserve = danger','who\'s in for the next break','that centering tho','+1 vault it'];
function chatSim(){
  if(window.__realtimeChat)return;   // /live/ uses the real WebSocket room instead
  const log=document.getElementById('chat-log');if(!log)return;
  const add=(name,txt,sys)=>{const d=document.createElement('div');d.className='msg'+(sys?' sys':'');
    d.innerHTML=sys?txt:`<b>${name}</b>${txt}`;log.appendChild(d);log.scrollTop=log.scrollHeight;
    while(log.children.length>40)log.removeChild(log.firstChild);};
  add('','⚡ Break started — Pokémon Evolving Skies · 6 spots left',true);
  setInterval(()=>{
    if(Math.random()<0.15){add('','💥 '+CHAT_NAMES[Math.floor(Math.random()*CHAT_NAMES.length)]+' just claimed a spot',true);return;}
    add(CHAT_NAMES[Math.floor(Math.random()*CHAT_NAMES.length)],CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]);
  },2200);
}
function sendChat(e){e.preventDefault();const i=document.getElementById('chat-input');if(!i.value.trim())return false;
  const log=document.getElementById('chat-log');const d=document.createElement('div');d.className='msg';
  d.innerHTML=`<b>You</b>${i.value.replace(/</g,'&lt;')}`;log.appendChild(d);log.scrollTop=log.scrollHeight;i.value='';return false;}

/* ---------- misc ---------- */
function joinList(e){e.preventDefault();e.target.querySelector('input').value='';toast('You\'re on the list. Welcome to the gang.');return false;}
function toast(msg){let t=document.getElementById('__toast');if(!t){t=document.createElement('div');t.id='__toast';
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#c81e2c;color:#fff;font-family:Oswald,sans-serif;'+
  'text-transform:uppercase;letter-spacing:.1em;font-size:.8rem;padding:13px 22px;border-radius:4px;z-index:200;transition:.3s;opacity:0';
  document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';clearTimeout(window.__tT);window.__tT=setTimeout(()=>t.style.opacity='0',2600);}

/* ---------- boot ---------- */
function renderCatalogGrids(){
  renderGrid('best-grid',CATALOG.slice(0,4));
  renderGrid('shop-grid',CATALOG);
  renderGrid('featured-grid',CATALOG.slice(2,6));
  document.dispatchEvent(new Event('catalog:loaded'));
}
document.addEventListener('DOMContentLoaded',async ()=>{
  renderAuctions('auction-grid',AUCTIONS);
  renderAuctions('auction-home',AUCTIONS.slice(0,3));
  paintCart();chatSim();
  await loadCatalog();
  renderCatalogGrids();
});
