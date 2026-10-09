/* =========================================================
   db.js - Koneksi MobaShop ke database Supabase
   Dimuat SETELAH script utama di index.html.
   ========================================================= */

/* >>> ISI DUA NILAI INI <<< */
const SUPABASE_URL = "https://vtgjokqpnmnxhsoetkes.supabase.co";        
const SUPABASE_KEY = "sb_publishable_0rAIHwXF3Fs91oivH2G7mw_2desVOZw";

/* ---- Helper ---- */
async function rpc(fn, args){
  const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify(args)
  });
  const data = await res.json().catch(() => null);
  if(!res.ok) throw new Error((data && data.message) || "Permintaan ke database gagal");
  return data;
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function getVisitorId(){
  let id = null;
  try{ id = localStorage.getItem("mbs_vid"); }catch(e){}
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() :
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c === "x" ? r : (r&0x3|0x8)).toString(16);
      }));
    try{ localStorage.setItem("mbs_vid", id); }catch(e){}
  }
  return id;
}
const VISITOR_ID = getVisitorId();

/* ---- Catat kunjungan ---- */
rpc("log_visit", { p_visitor: VISITOR_ID }).catch(() => {});

/* ---- Tambah elemen UI (menu Riwayat, halaman riwayat, kode pesanan) ---- */
(function injectUI(){
  // 1. Menu "Riwayat" di navbar
  const nav = q("nav-links");
  const li = document.createElement("li");
  li.innerHTML = '<a href="#menu-section">Riwayat</a>';
  li.querySelector("a").addEventListener("click", () => { closeMobileMenu(); goHistory(); });
  if(nav.children[1]) nav.children[1].after(li); else nav.appendChild(li);

  // 2. Halaman riwayat
  const pg = document.createElement("div");
  pg.id = "page-history";
  pg.className = "page";
  pg.innerHTML = `
    <div class="bc">
      <span class="lk" onclick="goHome()">Beranda</span><span>›</span>
      <span style="color:#e2e8f0">Riwayat Top Up</span>
    </div>
    <h3 style="font-family:'Oswald',sans-serif;font-size:22px;margin-bottom:22px;letter-spacing:.5px">Riwayat Top Up</h3>
    <div id="history-list"></div>`;
  q("page-otp").after(pg);

  // 3. Kode pesanan di halaman struk
  const btn = document.querySelector('#page-invoice button[onclick="finishOrder()"]');
  if(btn){
    const p = document.createElement("p");
    p.style.cssText = "margin-bottom:24px;color:#94a3b8";
    p.innerHTML = 'Kode Pesanan: <strong id="invoice-code" style="color:#e2e8f0"></strong>';
    btn.before(p);
  }
})();

/* ---- Riwayat top up ---- */
async function goHistory(){
  goPage("history");
  const box = q("history-list");
  box.innerHTML = '<p style="color:#94a3b8">Memuat riwayat...</p>';
  try{
    const orders = await rpc("get_orders", { p_visitor: VISITOR_ID });
    if(!orders.length){
      box.innerHTML = '<p style="color:#94a3b8">Belum ada riwayat top up.</p>';
      return;
    }
    box.innerHTML = orders.map(o => `
      <div class="cart-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <strong>${esc(o.order_code)}</strong>
          <span class="cart-item-price" style="margin:0">${rp(o.total)}</span>
        </div>
        <div class="cart-item-sub">${esc(new Date(o.created_at).toLocaleString("id-ID"))} · ${esc(o.payment_method)} · ${esc(o.status)}</div>
        ${o.items.map(i => `
          <div class="cart-item-sub" style="margin-top:6px">
            ${esc(i.game_name)} - ${esc(i.package_label)}${i.bonus ? " (" + esc(i.bonus) + ")" : ""}
            · ID: ${esc(i.game_user_id)} · ${rp(i.price)}
          </div>`).join("")}
      </div>`).join("");
  }catch(e){
    box.innerHTML = '<p style="color:#f87171">⚠ ' + esc(e.message) + '</p>';
  }
}

/* ---- Ganti goCart: tambah escape agar aman dari XSS ---- */
function goCart(){
  if(cart.length === 0){
    q("cart-empty-state").style.display = "block";
    q("cart-content-state").style.display = "none";
  } else {
    q("cart-empty-state").style.display = "none";
    q("cart-content-state").style.display = "block";

    const container = q("cart-items-container");
    container.innerHTML = "";
    let total = 0;

    cart.forEach((item, idx) => {
      total += item.pkg.price;
      const d = document.createElement("div");
      d.className = "cart-item";
      d.innerHTML = `
        <div class="cart-item-info">
           <div class="cart-item-title">${item.game.emoji} ${esc(item.game.name)} - ${esc(item.pkg.label)}</div>
           <div class="cart-item-sub">ID Akun: ${esc(item.userId)} ${item.pkg.bonus ? " | Bonus: " + esc(item.pkg.bonus) : ""}</div>
        </div>
        <div class="cart-item-price">${rp(item.pkg.price)}</div>
        <button class="cart-item-del" onclick="removeFromCart(${idx})" title="Hapus Item">✕</button>
      `;
      container.appendChild(d);
    });

    q("cart-total-price").textContent = rp(total);
    q("cart-total-items").textContent = cart.length + " Item";
  }
  goPage("cart");
}

/* ---- Ganti confirmPay: simpan pesanan ke database ---- */
let _paying = false;
async function confirmPay(){
  if(!state.method || _paying) return;
  _paying = true;
  const overlay = q("loading-overlay");
  overlay.classList.add("show");
  try{
    const data = await rpc("create_order", {
      p_visitor: VISITOR_ID,
      p_email: state.email,
      p_method: state.method.label,
      p_items: cart.map(i => ({
        gameId: i.game.id, gameName: i.game.name,
        packageLabel: i.pkg.label, bonus: i.pkg.bonus,
        price: i.pkg.price, gameUserId: i.userId
      }))
    });

    try{ new Audio("thankyou.mp3").play().catch(() => {}); }catch(e){}
    q("sent-email-display").textContent = state.email;
    const code = q("invoice-code");
    if(code) code.textContent = data.orderCode;
    overlay.classList.remove("show");
    goPage("invoice");
  }catch(e){
    overlay.classList.remove("show");
    alert("⚠ " + e.message);
  }finally{
    _paying = false;
  }
}
