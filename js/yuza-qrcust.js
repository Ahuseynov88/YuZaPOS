/* ═══════════════════════════════════════════
   YUZA POS — MÜŞTƏRİNİN QR SİFARİŞİ: MÜŞTƏRİ TƏRƏFİ (Q1, 21.11.2026)
   Yalnız masa AKTİV olanda və Ayarlarda "Masadan QR sifariş" açıq olanda görünür.
   Menyu, sifariş və vəziyyət server (yuza-api) üzərindən: qrMenu, qrOrder, qrMine.
   Qiymətləri server menyudan hesablayır — müştəri dəyişə bilməz.
═══════════════════════════════════════════ */
import { api } from './yuza-api.js';
import { esc } from './utils.js';

const I = (n) => `<svg class="icon"><use href="#i-${n}"></use></svg>`;
const money = (n) => (Number(n) || 0).toFixed(2) + ' ₼';
const pad2 = (n) => String(n).padStart(2, '0');
const hm = (ts) => { const d = new Date(ts || 0); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

let tableId = null, menu = [], cart = {}, cat = 'all', query = '', pollT = 0, mine = [], alive = false;
const $ = (id) => document.getElementById(id);
const cartCount = () => Object.values(cart).reduce((s, q) => s + q, 0);
const cartTotal = () => Object.entries(cart).reduce((s, [id, q]) => s + (menu.find(m => m.id === id)?.price || 0) * q, 0);

function toast(msg, bad) {
  let t = $('yzQcToast');
  if (!t) { t = document.createElement('div'); t.id = 'yzQcToast'; t.className = 'yz-qc-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'yz-qc-toast is-on' + (bad ? ' is-bad' : '');
  t.innerHTML = msg;
  clearTimeout(t._t); t._t = setTimeout(() => { t.className = 'yz-qc-toast'; }, 5000);
}

/* ── Əsas səhifədə düymə və vəziyyət bloku ── */
function ensureEntry(show) {
  let btn = $('yzQcBtn');
  const anchor = document.querySelector('#customerScreen .menu-btn');
  if (!btn && anchor) {
    btn = document.createElement('button');
    btn.id = 'yzQcBtn'; btn.type = 'button'; btn.className = 'menu-btn yz-qc-entry';
    btn.innerHTML = `<span class="menu-icon">${I('food')}</span> Menyudan sifariş ver`;
    btn.addEventListener('click', openSheet);
    anchor.insertAdjacentElement('afterend', btn);
    const st = document.createElement('div'); st.id = 'yzQcStatus'; st.className = 'yz-qc-status';
    btn.insertAdjacentElement('afterend', st);
  }
  if (btn) btn.hidden = !show;
}
const ST = { pending: ['Ofisiantın təsdiqini gözləyir', 'is-wait', 'clock'], approved: ['Təsdiqləndi — mətbəxə göndərildi', 'is-ok', 'check'],
  rejected: ['Qəbul edilmədi', 'is-bad', 'close'], expired: ['Masa bağlandığı üçün etibarsızdır', 'is-bad', 'close'] };
function renderStatus() {
  const box = $('yzQcStatus'); if (!box) return;
  const rows = mine.filter(o => o.tableId === tableId);
  box.innerHTML = rows.length ? `<h3>${I('qr')} QR sifarişləriniz</h3>${rows.map(o => { const s = ST[o.status] || ST.pending; return `<div class="yz-qc-st ${s[1]}">
      <div><b>${I(s[2])} ${s[0]}</b>${o.status === 'rejected' && o.reason ? `<small>Səbəb: ${esc(o.reason)}</small>` : ''}</div>
      <p>${o.items.map(x => `${x.qty}× ${esc(x.name)}`).join(', ')}</p><span>${hm(o.createdAt)} · ${money(o.total)}</span></div>`; }).join('')}` : '';
}
async function poll() {
  clearTimeout(pollT);
  if (!alive) return;
  try { mine = (await api('qrMine', {})).orders || []; renderStatus(); } catch (e) { /* şəbəkə — növbəti dəfə */ }
  const wait = mine.some(o => o.status === 'pending' && o.tableId === tableId);
  pollT = setTimeout(poll, wait ? 8000 : 60000);
}

/* ── Menyu pəncərəsi ── */
function sheet() {
  let s = $('yzQcSheet');
  if (s) return s;
  s = document.createElement('div');
  s.id = 'yzQcSheet'; s.className = 'yz-qc-sheet'; s.hidden = true;
  s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-label', 'Menyu və sifariş');
  s.innerHTML = `<div class="yz-qc-top"><button type="button" class="yz-qc-x" data-qc-close aria-label="Bağla">${I('close')}</button><h2 id="yzQcTitle">Menyu</h2></div>
    <div class="yz-qc-tools"><input type="search" id="yzQcSearch" placeholder="Axtar…" autocomplete="off"><div class="yz-qc-cats" id="yzQcCats"></div></div>
    <div class="yz-qc-body" id="yzQcBody"></div>
    <div class="yz-qc-bar" id="yzQcBar"></div>`;
  document.body.appendChild(s);
  s.addEventListener('click', onClick);
  s.querySelector('#yzQcSearch').addEventListener('input', (e) => { query = e.target.value.trim().toLocaleLowerCase('az'); renderMenu(); });
  return s;
}
let view = 'menu';
function renderCats() {
  const cats = [...new Set(menu.map(m => m.category))];
  $('yzQcCats').innerHTML = ['all', ...cats].map(c => `<button type="button" class="${c === cat ? 'is-on' : ''}" data-qc-cat="${esc(c)}">${c === 'all' ? 'Hamısı' : esc(c)}</button>`).join('');
}
function stepper(id) {
  const q = cart[id] || 0;
  return q ? `<div class="yz-qc-step"><button type="button" data-qc-minus="${esc(id)}" aria-label="Azalt">−</button><b>${q}</b><button type="button" data-qc-plus="${esc(id)}" aria-label="Artır">+</button></div>`
    : `<button type="button" class="yz-qc-add" data-qc-plus="${esc(id)}">${I('plus')} Əlavə et</button>`;
}
function renderMenu() {
  view = 'menu';
  $('yzQcTitle').textContent = 'Menyu';
  $('yzQcSearch').parentElement.hidden = false;
  const list = menu.filter(m => (cat === 'all' || m.category === cat) && (!query || m.name.toLocaleLowerCase('az').includes(query)));
  $('yzQcBody').innerHTML = list.length ? list.map(m => `<div class="yz-qc-item">
      ${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : `<div class="yz-qc-noimg">${I('food')}</div>`}
      <div class="yz-qc-info"><b>${esc(m.name)}</b>${m.desc ? `<small>${esc(m.desc)}</small>` : ''}<span>${money(m.price)}</span></div>
      <div class="yz-qc-act" data-qc-row="${esc(m.id)}">${stepper(m.id)}</div></div>`).join('')
    : '<p class="yz-qc-empty">Heç nə tapılmadı.</p>';
  renderBar();
}
function renderCart() {
  view = 'cart';
  $('yzQcTitle').textContent = 'Sifarişiniz';
  $('yzQcSearch').parentElement.hidden = true;
  const ids = Object.keys(cart).filter(id => cart[id] > 0);
  $('yzQcBody').innerHTML = ids.length ? `${ids.map(id => { const m = menu.find(x => x.id === id) || { name: '?', price: 0 }; return `<div class="yz-qc-line">
      <div><b>${esc(m.name)}</b><span>${money(m.price * cart[id])}</span></div><div class="yz-qc-act" data-qc-row="${esc(id)}">${stepper(id)}</div></div>`; }).join('')}
    <label class="yz-qc-notef"><span>Qeyd (könüllü)</span><textarea id="yzQcNote" maxlength="200" rows="2" placeholder="Məs. acısız, tez gətirin…"></textarea></label>
    <p class="yz-qc-hint">${I('bell')} Sifariş əvvəl ofisianta gedir. Təsdiqdən sonra mətbəxdə hazırlanmağa başlayır.</p>`
    : '<p class="yz-qc-empty">Səbət boşdur.</p>';
  renderBar();
}
function renderBar() {
  const n = cartCount();
  $('yzQcBar').innerHTML = view === 'menu'
    ? (n ? `<button type="button" class="yz-qc-go" data-qc-cart>${I('clipboard')} Səbət: ${n} · ${money(cartTotal())}</button>` : '<span class="yz-qc-barhint">Mal seçin</span>')
    : `<button type="button" class="yz-qc-back" data-qc-menu>${I('back')} Menyu</button>${n ? `<button type="button" class="yz-qc-go" data-qc-send>Sifarişi göndər · ${money(cartTotal())}</button>` : ''}`;
}
function refreshRow(id) {
  document.querySelectorAll(`#yzQcSheet [data-qc-row="${CSS.escape(id)}"]`).forEach(el => { el.innerHTML = stepper(id); });
  if (view === 'cart' && !cart[id]) renderCart(); else renderBar();
}
let sending = false;
async function onClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.qcClose !== undefined) { closeSheet(); return; }
  if (d.qcCat !== undefined) { cat = d.qcCat; renderCats(); renderMenu(); return; }
  if (d.qcPlus) { cart[d.qcPlus] = Math.min(20, (cart[d.qcPlus] || 0) + 1); refreshRow(d.qcPlus); return; }
  if (d.qcMinus) { cart[d.qcMinus] = Math.max(0, (cart[d.qcMinus] || 0) - 1); if (!cart[d.qcMinus]) delete cart[d.qcMinus]; refreshRow(d.qcMinus); return; }
  if (d.qcCart !== undefined) { renderCart(); return; }
  if (d.qcMenu !== undefined) { renderMenu(); return; }
  if (d.qcSend !== undefined && !sending) {
    sending = true; t.disabled = true; t.textContent = 'Göndərilir…';
    try {
      const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty }));
      const r = await api('qrOrder', { tableId, items, note: ($('yzQcNote')?.value || '').trim() });
      cart = {}; closeSheet();
      toast(`${I('check')} Sifarişiniz göndərildi (${money(r.total)}). Ofisiant təsdiqləyəndən sonra mətbəxə gedəcək.`);
      poll();
    } catch (er) {
      toast(`${I('error')} ${esc(er.message || 'Göndərilmədi')}`, true);
      if (er.code === 'gone') { await loadMenu(); renderCart(); }
      t.disabled = false; renderBar();
    } finally { sending = false; }
  }
}
async function loadMenu() {
  const r = await api('qrMenu', { tableId });
  menu = r.items || [];
  Object.keys(cart).forEach(id => { if (!menu.some(m => m.id === id)) delete cart[id]; });
  return r;
}
async function openSheet() {
  const btn = $('yzQcBtn'); if (btn) btn.disabled = true;
  try {
    const r = await loadMenu();
    if (!r.on || !r.active) { ensureEntry(false); toast(`${I('bell')} Masadan sifariş hazırda mümkün deyil. Ofisiantı çağırın.`, true); return; }
    const s = sheet(); s.hidden = false; document.body.classList.add('yz-qc-open');
    cat = 'all'; query = ''; $('yzQcSearch').value = '';
    renderCats(); renderMenu();
  } catch (e) { toast(`${I('error')} ${esc(e.message || 'Menyu açılmadı')}`, true); }
  finally { if (btn) btn.disabled = false; }
}
function closeSheet() { const s = $('yzQcSheet'); if (s) s.hidden = true; document.body.classList.remove('yz-qc-open'); }

/* Masa aktiv oldu / bağlandı (customer.js çağırır) */
export async function start(tid) {
  tableId = tid; alive = true;
  try { const r = await api('qrMenu', { tableId }); menu = r.items || []; ensureEntry(!!(r.on && r.active)); }
  catch (e) { ensureEntry(false); }
  poll();
}
export function stop() {
  alive = false; clearTimeout(pollT); cart = {}; mine = [];
  closeSheet(); ensureEntry(false); renderStatus();
}
window.__yzQrCust = { start, stop, openSheet };
