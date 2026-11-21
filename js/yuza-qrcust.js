/* ═══════════════════════════════════════════
   YUZA POS — MÜŞTƏRİNİN QR SİFARİŞİ: MÜŞTƏRİ TƏRƏFİ (Q1 · yenilənib 21.11.2026 20:50)
   Yalnız masa AKTİV olanda və Ayarlarda "Masadan QR sifariş" açıq olanda görünür.
   Menyu, sifariş və vəziyyət server (yuza-api) üzərindən: qrMenu, qrOrder, qrMine.
   Qiymətləri server hesablayır — müştəri dəyişə bilməz.
   Görünüş: restoran başlığı · yapışqan kateqoriyalar (sürüşdükcə işıqlanır) · kateqoriya bölmələri ·
   mala toxunanda ətraflı pəncərə (şəkil, təsvir, miqdar, qeyd, içkidə porsiya/şüşə) · üzən səbət düyməsi.
═══════════════════════════════════════════ */
import { api } from './yuza-api.js';
import { esc } from './utils.js';

const I = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
const money = (n) => (Number(n) || 0).toFixed(2) + ' ₼';
const pad2 = (n) => String(n).padStart(2, '0');
const dt = (ts) => { const d = new Date(ts || 0); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const $ = (id) => document.getElementById(id);
const buzz = () => { try { navigator.vibrate?.(12); } catch (e) { /* */ } };

let tableId = null, info = { tableName: '', restaurant: '' }, menu = [], mine = [], alive = false, pollT = 0;
/* Səbət: açar = mal|variant|qeyd */
let cart = {};
const keyOf = (id, v, note) => `${id}|${v || ''}|${note || ''}`;
const itemOf = (id) => menu.find(m => m.id === id);
const variantOf = (m, v) => (m?.variants || []).find(x => x.key === v);
const unitPrice = (l) => { const m = itemOf(l.id); return l.v ? (variantOf(m, l.v)?.price || 0) : (m?.price || 0); };
const cartLines = () => Object.entries(cart).map(([k, l]) => ({ k, ...l })).filter(l => l.qty > 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);
const cartTotal = () => cartLines().reduce((s, l) => s + unitPrice(l) * l.qty, 0);
const qtyOfItem = (id) => cartLines().filter(l => l.id === id).reduce((s, l) => s + l.qty, 0);

function toast(msg, bad) {
  let t = $('yzQcToast');
  if (!t) { t = document.createElement('div'); t.id = 'yzQcToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'yz-qc-toast is-on' + (bad ? ' is-bad' : '');
  t.innerHTML = msg;
  clearTimeout(t._t); t._t = setTimeout(() => { t.className = 'yz-qc-toast'; }, 5000);
}

/* ══ Əsas səhifə: düymə + "QR sifarişləriniz" ══ */
function ensureEntry(show) {
  let btn = $('yzQcBtn');
  const anchor = document.querySelector('#customerScreen .menu-btn');
  if (!btn && anchor) {
    btn = document.createElement('button');
    btn.id = 'yzQcBtn'; btn.type = 'button'; btn.className = 'yz-qc-entry';
    btn.innerHTML = `<span class="yz-qc-entry__ic">${I('food')}</span><span class="yz-qc-entry__t"><b>Menyudan sifariş ver</b><small>Seçin, göndərin — ofisiant təsdiqləyəcək</small></span>${I('back')}`;
    btn.addEventListener('click', openSheet);
    anchor.insertAdjacentElement('beforebegin', btn);
    const st = document.createElement('div'); st.id = 'yzQcStatus'; st.className = 'yz-qc-status'; st.setAttribute('aria-live', 'polite');
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
      <div class="yz-qc-st__h"><b>${I(s[2])} ${s[0]}</b><span>${dt(o.createdAt)}</span></div>
      ${o.status === 'rejected' && o.reason ? `<small>Səbəb: ${esc(o.reason)}</small>` : ''}
      <p>${o.items.map(x => `${x.qty}× ${esc(x.name)}`).join(', ')}</p><em>${money(o.total)}</em></div>`; }).join('')}` : '';
}
async function poll() {
  clearTimeout(pollT);
  if (!alive) return;
  try { mine = (await api('qrMine', {})).orders || []; renderStatus(); } catch (e) { /* şəbəkə — növbəti dəfə */ }
  const wait = mine.some(o => o.status === 'pending' && o.tableId === tableId);
  pollT = setTimeout(poll, wait ? 8000 : 60000);
}

/* ══ Menyu pəncərəsi — ofisiantın sifariş ekranı ilə eyni görünüş (21.11.2026 22:40) ══
   Solda kateqoriyalar, ortada şəkilli mal kartları, aşağıda / sağda "Sifarişiniz" bileti. */
let searchQ = '', catSel = 'all', noteOpen = new Set();
function sheet() {
  let s = $('yzQcSheet');
  if (s) return s;
  s = document.createElement('div');
  s.id = 'yzQcSheet'; s.className = 'yz-qc yz-qc--pos'; s.hidden = true;
  s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'yzQcTitle');
  s.innerHTML = `
    <div class="topbar yz-qc-top">
      <h2 id="yzQcTitle">${I('food')} <span></span></h2>
      <button type="button" class="btn btn-ghost yz-icon-only" data-qc-close aria-label="Bağla" title="Bağla">${I('close')}</button>
    </div>
    <div class="yz-qc-sbar"><span>${I('search')}</span><input type="text" id="yzQcQ" placeholder="Mal axtar..." autocomplete="off" aria-label="Mal axtar"></div>
    <div class="order-layout yz-qc-lay">
      <div class="order-cat-rail category-rail" id="yzQcCats" aria-label="Kateqoriyalar"></div>
      <div class="order-content-wrap">
        <div class="order-items-grid" id="yzQcGrid"></div>
        <div class="ticket-panel">
          <div class="ticket-header"><span class="ticket-header__title" id="yzQcTk">Sifarişiniz</span></div>
          <div class="ticket-body" id="yzQcBody"></div>
          <div class="ticket-footer" id="yzQcFoot"></div>
        </div>
      </div>
    </div>
    <div class="yz-qc-dlg" id="yzQcDlg" hidden></div>`;
  document.body.appendChild(s);
  s.addEventListener('click', onClick);
  s.addEventListener('input', (e) => {
    if (e.target.id === 'yzQcQ') { searchQ = e.target.value.trim().toLocaleLowerCase('az'); renderGrid(); }
  });
  s.addEventListener('change', (e) => { if (e.target.dataset.qcNote) setNote(e.target.dataset.qcNote, e.target.value); });
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.qcNote) { e.target.blur(); return; }
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!$('yzQcDlg').hidden) closeDlg(); else closeSheet();
  });
  return s;
}
const cats = () => [...new Set(menu.map(m => m.category))];
function renderCats() {
  $('yzQcCats').innerHTML = ['all', ...cats()].map(c => `<button type="button" class="category-rail__tab ${catSel === c ? 'active' : ''}" data-qc-cat="${esc(c)}">
    ${I(c === 'all' ? 'clipboard' : 'food')}<span>${c === 'all' ? 'Hamısı' : esc(c)}</span></button>`).join('');
}
function cardHtml(m) {
  const q = qtyOfItem(m.id);
  return `<div class="product-card ${m.photo ? '' : 'no-photo'}" data-qc-add="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(m.name)}, ${m.variants ? money(m.price) + '-dan' : money(m.price)}">
    ${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : ''}
    ${q ? `<div class="product-card__stock yz-qc-inq">${q}</div>` : ''}
    <div class="product-card__overlay">
      <div class="product-card__name">${esc(m.name)}</div>
      <div class="product-card__price">${m.variants ? money(m.price) + '-dan' : money(m.price)}</div>
    </div></div>`;
}
function renderGrid() {
  const list = menu.filter(m => searchQ ? (m.name.toLocaleLowerCase('az').includes(searchQ) || (m.desc || '').toLocaleLowerCase('az').includes(searchQ)) : (catSel === 'all' || m.category === catSel));
  $('yzQcGrid').innerHTML = list.length ? list.map(cardHtml).join('')
    : `<p style="color:var(--text3);grid-column:1/-1;">${searchQ ? 'Axtarışa uyğun mal tapılmadı.' : 'Bu kateqoriyada mal yoxdur.'}</p>`;
}
function renderTicket() {
  const ls = cartLines();
  $('yzQcBody').innerHTML = ls.length ? ls.map(l => {
    const m = itemOf(l.id) || { name: '?' }; const v = l.v ? variantOf(m, l.v) : null; const op = noteOpen.has(l.k);
    return `<div class="ticket-line ticket-line--draft">
      <div class="ticket-line__main">
        <span class="ticket-line__name">${esc(m.name)}${v ? ` · ${esc(v.label)}` : ''}</span>
        <button type="button" class="ticket-line__note-btn ${l.note ? 'has-note' : ''}" data-qc-ntog="${esc(l.k)}" aria-label="Qeyd" title="Qeyd">${I('edit')}</button>
        <div class="qty-stepper"><button type="button" data-qc-lq="${esc(l.k)}" data-d="-1" aria-label="Azalt">−</button><span class="qty-stepper__val">${l.qty}</span><button type="button" data-qc-lq="${esc(l.k)}" data-d="1" aria-label="Artır">+</button></div>
        <span class="ticket-line__price">${money(unitPrice(l) * l.qty)}</span>
      </div>
      ${l.note && !op ? `<div class="ticket-line__tags"><span style="font-size:11px;color:var(--text3);">${I('note')} ${esc(l.note)}</span></div>` : ''}
      ${op ? `<input type="text" class="ticket-note-input" data-qc-note="${esc(l.k)}" value="${esc(l.note)}" maxlength="100" placeholder="Qeyd (məs: soğansız, acısız)">` : ''}
    </div>`; }).join('')
    : '<div class="ticket-empty">Mala toxunun — səbətə düşəcək.</div>';
  const n = cartCount();
  $('yzQcTk').textContent = n ? `Sifarişiniz · ${n}` : 'Sifarişiniz';
  $('yzQcFoot').innerHTML = `<div class="ticket-total-row"><span class="ticket-total-row__label">Cəmi</span><span class="ticket-total-row__value">${money(cartTotal())}</span></div>
    ${n ? `<textarea id="yzQcNote" class="ticket-note" rows="1" maxlength="200" placeholder="Ümumi qeyd (könüllü)" aria-label="Ümumi qeyd">${esc(gNote)}</textarea>
    <button type="button" class="yz-qc-send" data-qc-send>${I('check')} Sifarişi göndər</button>
    <p class="yz-qc-hint">${I('clock')} Əvvəl ofisiant təsdiqləyir, sonra mətbəxə gedir.</p>` : ''}`;
}
let gNote = '';
function renderAll() { renderCats(); renderGrid(); renderTicket(); }
function add(id, v, qty, note) {
  const k = keyOf(id, v, note);
  cart[k] = { id, v: v || '', note: note || '', qty: Math.min(20, (cart[k]?.qty || 0) + qty) };
  buzz();
}
function setNote(k, val) {
  const l = cart[k]; if (!l) return;
  const note = String(val || '').trim().slice(0, 100);
  delete cart[k]; noteOpen.delete(k);
  const nk = keyOf(l.id, l.v, note);
  if (cart[nk]) cart[nk].qty = Math.min(20, cart[nk].qty + l.qty); else cart[nk] = { ...l, note };
  renderTicket();
}

/* ── İçki: porsiya / şüşə seçimi (ofisiantın variant pəncərəsi kimi) ── */
let dlg = null;
function openDlg(id) {
  const m = itemOf(id); if (!m) return;
  dlg = { id };
  const box = $('yzQcDlg');
  box.innerHTML = `<div class="yz-qc-dlg__bg" data-qc-dclose></div>
    <div class="yz-qc-dlg__pn" role="dialog" aria-modal="true" aria-label="${esc(m.name)}">
      <div class="yz-qc-dlg__hd"><b>${esc(m.name)}</b><button type="button" class="btn btn-ghost yz-icon-only" data-qc-dclose aria-label="Bağla">${I('close')}</button></div>
      ${m.desc ? `<p class="yz-qc-dlg__ds">${esc(m.desc)}</p>` : ''}
      <div class="yz-pour-grid">${m.variants.map(v => `<button type="button" class="yz-pour-btn" data-qc-var="${esc(v.key)}"><b>${esc(v.label)}</b><span>${money(v.price)}</span></button>`).join('')}</div>
    </div>`;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('is-on'));
}
function closeDlg() { const b = $('yzQcDlg'); b.classList.remove('is-on'); b.hidden = true; b.innerHTML = ''; dlg = null; }

function renderDone(total) {
  $('yzQcGrid').innerHTML = '';
  $('yzQcBody').innerHTML = `<div class="yz-qc-done"><span class="yz-qc-done__ic">${I('check')}</span><h3>Sifarişiniz göndərildi</h3>
    <p>${money(total)} · Ofisiant təsdiqləyəndən sonra mətbəxə gedəcək. Vəziyyəti əsas səhifədə görəcəksiniz.</p></div>`;
  $('yzQcFoot').innerHTML = `<button type="button" class="yz-qc-send" data-qc-close>Bağla</button>`;
  $('yzQcTk').textContent = 'Sifarişiniz';
}

let sending = false;
async function onClick(e) {
  const t = e.target.closest('button, [data-qc-add], [data-qc-dclose]'); if (!t) return;
  const d = t.dataset;
  if (d.qcClose !== undefined) { closeSheet(); return; }
  if (d.qcDclose !== undefined) { closeDlg(); return; }
  if (d.qcCat !== undefined) { catSel = d.qcCat; searchQ = ''; $('yzQcQ').value = ''; renderCats(); renderGrid(); return; }
  if (d.qcAdd) {
    const m = itemOf(d.qcAdd); if (!m) return;
    if (m.variants) { openDlg(m.id); return; }
    add(m.id, '', 1, ''); renderGrid(); renderTicket(); return;
  }
  if (d.qcVar) { add(dlg.id, d.qcVar, 1, ''); closeDlg(); renderGrid(); renderTicket(); return; }
  if (d.qcNtog) { if (noteOpen.has(d.qcNtog)) noteOpen.delete(d.qcNtog); else noteOpen.add(d.qcNtog); renderTicket(); setTimeout(() => document.querySelector(`[data-qc-note="${CSS.escape(d.qcNtog)}"]`)?.focus(), 30); return; }
  if (d.qcLq) {
    const l = cart[d.qcLq]; if (!l) return;
    l.qty = Math.max(0, Math.min(20, l.qty + Number(d.d)));
    if (!l.qty) { delete cart[d.qcLq]; noteOpen.delete(d.qcLq); }
    renderGrid(); renderTicket(); return;
  }
  if (d.qcSend !== undefined && !sending) {
    document.querySelectorAll('#yzQcSheet [data-qc-note]').forEach(x => setNote(x.dataset.qcNote, x.value));
    gNote = ($('yzQcNote')?.value || '').trim();
    sending = true; const b = $('yzQcSheet').querySelector('[data-qc-send]'); if (b) { b.disabled = true; b.textContent = 'Göndərilir…'; }
    try {
      const items = cartLines().map(l => ({ id: l.id, qty: l.qty, note: l.note, ...(l.v ? { v: l.v } : {}) }));
      const r = await api('qrOrder', { tableId, items, note: gNote });
      cart = {}; gNote = ''; noteOpen.clear(); renderDone(r.total); poll();
    } catch (er) {
      toast(`${I('error')} ${esc(er.message || 'Göndərilmədi')}`, true);
      if (er.code === 'gone') { try { await loadMenu(); } catch (x) { /* */ } renderAll(); }
      else renderTicket();
    } finally { sending = false; }
  }
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('#yzQcSheet [data-qc-add]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('input', (e) => { if (e.target.id === 'yzQcNote') gNote = e.target.value; });

async function loadMenu() {
  const r = await api('qrMenu', { tableId });
  menu = r.items || [];
  info = { tableName: r.tableName || '', restaurant: r.restaurant || '' };
  Object.entries(cart).forEach(([k, l]) => { const m = itemOf(l.id); if (!m || (l.v && !variantOf(m, l.v))) delete cart[k]; });
  return r;
}
async function openSheet() {
  const btn = $('yzQcBtn'); if (btn) btn.disabled = true;
  try {
    const r = await loadMenu();
    if (!r.on || !r.active) { ensureEntry(false); toast(`${I('warning')} Masadan sifariş hazırda mümkün deyil. Ofisiantı çağırın.`, true); return; }
    const s = sheet(); s.hidden = false; document.body.classList.add('yz-qc-open');
    s.querySelector('#yzQcTitle span').textContent = [info.restaurant, info.tableName].filter(Boolean).join(' · ') || 'Menyu';
    searchQ = ''; $('yzQcQ').value = ''; if (catSel !== 'all' && !cats().includes(catSel)) catSel = 'all';
    renderAll();
    setTimeout(() => s.querySelector('[data-qc-close]')?.focus(), 50);
  } catch (e) { toast(`${I('error')} ${esc(e.message || 'Menyu açılmadı')}`, true); }
  finally { if (btn) btn.disabled = false; }
}
function closeSheet() {
  const s = $('yzQcSheet'); if (!s) return;
  if ($('yzQcDlg') && !$('yzQcDlg').hidden) closeDlg();
  s.hidden = true;
  document.body.classList.remove('yz-qc-open');
  $('yzQcBtn')?.focus();
}

/* Masa aktiv oldu / bağlandı (customer.js çağırır) */
export async function start(tid) {
  tableId = tid; alive = true;
  try { const r = await loadMenu(); ensureEntry(!!(r.on && r.active)); }
  catch (e) { ensureEntry(false); }
  poll();
}
export function stop() {
  alive = false; clearTimeout(pollT); cart = {}; mine = [];
  closeSheet(); ensureEntry(false); renderStatus();
}
window.__yzQrCust = { start, stop, openSheet };
