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

/* ══ Menyu pəncərəsi ══ */
let view = 'menu', searchOn = false, query = '', spyOff = null;
function sheet() {
  let s = $('yzQcSheet');
  if (s) return s;
  s = document.createElement('div');
  s.id = 'yzQcSheet'; s.className = 'yz-qc'; s.hidden = true;
  s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'yzQcTitle');
  s.innerHTML = `
    <header class="yz-qc-hd">
      <button type="button" class="yz-qc-ib" data-qc-close aria-label="Bağla">${I('close')}</button>
      <div class="yz-qc-hd__t"><h2 id="yzQcTitle"></h2><span id="yzQcSub"></span></div>
      <button type="button" class="yz-qc-ib" data-qc-search aria-label="Axtar">${I('search')}</button>
    </header>
    <div class="yz-qc-srch" id="yzQcSrch" hidden><input type="search" id="yzQcQ" placeholder="Yemək və ya içki axtarın…" autocomplete="off" aria-label="Axtar"></div>
    <nav class="yz-qc-cats" id="yzQcCats" aria-label="Kateqoriyalar"></nav>
    <main class="yz-qc-body" id="yzQcBody"></main>
    <div class="yz-qc-foot" id="yzQcFoot"></div>
    <div class="yz-qc-dlg" id="yzQcDlg" hidden></div>`;
  document.body.appendChild(s);
  s.addEventListener('click', onClick);
  s.querySelector('#yzQcQ').addEventListener('input', (e) => { query = e.target.value.trim().toLocaleLowerCase('az'); renderMenu(); });
  s.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!$('yzQcDlg').hidden) closeDlg(); else if (view === 'cart') renderMenu(); else closeSheet();
  });
  return s;
}
const cats = () => [...new Set(menu.map(m => m.category))];
const slug = (c) => 'yzqc-' + cats().indexOf(c);
function priceLabel(m) { return m.variants ? `${money(m.price)}-dan` : money(m.price); }
function cardHtml(m) {
  const q = qtyOfItem(m.id);
  return `<article class="yz-qc-card${q ? ' has-q' : ''}" data-qc-open="${esc(m.id)}" tabindex="0" aria-label="${esc(m.name)}, ${priceLabel(m)}">
    <div class="yz-qc-card__tx"><h4>${esc(m.name)}</h4>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}<b>${priceLabel(m)}</b></div>
    <div class="yz-qc-card__ph${m.photo ? '' : ' is-none'}">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : ''}
      <button type="button" class="yz-qc-plus" data-qc-quick="${esc(m.id)}" aria-label="${esc(m.name)} — əlavə et">${q ? `<b>${q}</b>` : I('plus')}</button></div>
  </article>`;
}
function renderMenu() {
  view = 'menu';
  document.querySelector('#yzQcSheet [data-qc-search]').hidden = false;
  $('yzQcTitle').textContent = info.restaurant || 'Menyu';
  $('yzQcSub').textContent = info.tableName;
  $('yzQcCats').hidden = !!query;
  const list = menu.filter(m => !query || m.name.toLocaleLowerCase('az').includes(query) || (m.desc || '').toLocaleLowerCase('az').includes(query));
  const groups = cats().map(c => [c, list.filter(m => m.category === c)]).filter(g => g[1].length);
  $('yzQcCats').innerHTML = cats().map((c, i) => `<button type="button" data-qc-cat="${esc(slug(c))}" class="${i ? '' : 'is-on'}">${esc(c)}</button>`).join('');
  $('yzQcBody').innerHTML = groups.length ? groups.map(([c, ms]) => `<section class="yz-qc-sec" id="${esc(slug(c))}"><h3>${esc(c)}</h3>${ms.map(cardHtml).join('')}</section>`).join('')
    : `<p class="yz-qc-empty">${I('search')} "${esc(query)}" tapılmadı.</p>`;
  $('yzQcBody').scrollTop = 0;
  renderFoot(); spy();
}
/* Sürüşdükcə uyğun kateqoriya işıqlanır */
function spy() {
  spyOff?.(); spyOff = null;
  const body = $('yzQcBody'), secs = [...body.querySelectorAll('.yz-qc-sec')];
  if (!secs.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((ents) => {
    const vis = ents.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    $('yzQcCats').querySelectorAll('button').forEach(b => {
      const on = b.dataset.qcCat === vis.target.id; b.classList.toggle('is-on', on);
      if (on) b.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }, { root: body, rootMargin: '0px 0px -70% 0px' });
  secs.forEach(x => io.observe(x));
  spyOff = () => io.disconnect();
}
function renderFoot() {
  const n = cartCount();
  const f = $('yzQcFoot');
  if (view === 'cart') {
    f.innerHTML = n ? `<button type="button" class="yz-qc-cta" data-qc-send><span>Sifarişi göndər</span><b>${money(cartTotal())}</b></button>` : '';
  } else {
    f.innerHTML = n ? `<button type="button" class="yz-qc-cta" data-qc-cart aria-label="Səbətə bax, ${n} mal"><i class="yz-qc-cnt">${n}</i><span>Səbətə bax</span><b>${money(cartTotal())}</b></button>` : '';
  }
  f.classList.toggle('is-on', !!n);
}
function refreshCard(id) {
  const old = document.querySelector(`#yzQcBody [data-qc-open="${CSS.escape(id)}"]`);
  const m = itemOf(id);
  if (old && m) old.outerHTML = cardHtml(m);
  renderFoot();
}
function add(id, v, qty, note) {
  const k = keyOf(id, v, note);
  cart[k] = { id, v: v || '', note: note || '', qty: Math.min(20, (cart[k]?.qty || 0) + qty) };
  buzz();
}

/* ── Ətraflı pəncərə (mala toxunanda) ── */
let dlg = null;
function openDlg(id) {
  const m = itemOf(id); if (!m) return;
  dlg = { id, v: m.variants ? m.variants[0].key : '', qty: 1 };
  const box = $('yzQcDlg');
  box.innerHTML = `<div class="yz-qc-dlg__bg" data-qc-dclose></div>
    <div class="yz-qc-dlg__pn" role="dialog" aria-modal="true" aria-label="${esc(m.name)}">
      ${m.photo ? `<img class="yz-qc-dlg__img" src="${esc(m.photo)}" alt="">` : ''}
      <button type="button" class="yz-qc-ib yz-qc-dlg__x" data-qc-dclose aria-label="Bağla">${I('close')}</button>
      <div class="yz-qc-dlg__in">
        <h3>${esc(m.name)}</h3>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}
        ${m.variants ? `<fieldset class="yz-qc-vars"><legend>Miqdarı seçin</legend>${m.variants.map((v, i) => `<label class="yz-qc-var">
            <input type="radio" name="yzQcV" value="${esc(v.key)}" ${i ? '' : 'checked'}><span>${esc(v.label)}</span><b>${money(v.price)}</b></label>`).join('')}</fieldset>`
          : `<div class="yz-qc-dlg__pr">${money(m.price)}</div>`}
        <label class="yz-qc-fld"><span>Mətbəx üçün qeyd (könüllü)</span><input type="text" id="yzQcDNote" maxlength="100" placeholder="Məs. acısız, soğansız"></label>
        <div class="yz-qc-dlg__row">
          <div class="yz-qc-qty" role="group" aria-label="Miqdar"><button type="button" data-qc-dq="-1" aria-label="Azalt">−</button><b id="yzQcDQ">1</b><button type="button" data-qc-dq="1" aria-label="Artır">+</button></div>
          <button type="button" class="yz-qc-cta yz-qc-cta--in" data-qc-dadd><span>Əlavə et</span><b id="yzQcDP"></b></button>
        </div>
      </div>
    </div>`;
  box.hidden = false;
  box.querySelectorAll('input[name="yzQcV"]').forEach(r => r.addEventListener('change', () => { dlg.v = r.value; dlgPrice(); }));
  dlgPrice();
  requestAnimationFrame(() => box.classList.add('is-on'));
  setTimeout(() => box.querySelector('[data-qc-dadd]')?.focus(), 50);
}
function dlgPrice() {
  const m = itemOf(dlg.id);
  const p = dlg.v ? variantOf(m, dlg.v)?.price || 0 : m.price;
  $('yzQcDQ').textContent = dlg.qty; $('yzQcDP').textContent = money(p * dlg.qty);
}
function closeDlg() { const b = $('yzQcDlg'); b.classList.remove('is-on'); setTimeout(() => { b.hidden = true; b.innerHTML = ''; }, 180); dlg = null; }

/* ── Səbət ── */
function renderCart() {
  view = 'cart';
  $('yzQcTitle').textContent = 'Sifarişiniz'; $('yzQcSub').textContent = info.tableName;
  $('yzQcCats').hidden = true; $('yzQcSrch').hidden = true; searchOn = false;
  document.querySelector('#yzQcSheet [data-qc-search]').hidden = true;
  spyOff?.(); spyOff = null;
  const ls = cartLines();
  $('yzQcBody').innerHTML = ls.length ? `<button type="button" class="yz-qc-backlink" data-qc-menu>${I('back')} Menyuya qayıt</button>
    ${ls.map(l => { const m = itemOf(l.id) || { name: '?' }; const v = l.v ? variantOf(m, l.v) : null; return `<div class="yz-qc-ln">
      <div class="yz-qc-ln__t"><b>${esc(m.name)}${v ? ` <small>· ${esc(v.label)}</small>` : ''}</b>${l.note ? `<span>${I('note')} ${esc(l.note)}</span>` : ''}<em>${money(unitPrice(l) * l.qty)}</em></div>
      <div class="yz-qc-qty yz-qc-qty--sm"><button type="button" data-qc-lq="${esc(l.k)}" data-d="-1" aria-label="Azalt">${l.qty > 1 ? '−' : I('trash')}</button><b>${l.qty}</b><button type="button" data-qc-lq="${esc(l.k)}" data-d="1" aria-label="Artır">+</button></div></div>`; }).join('')}
    <div class="yz-qc-sum"><span>Cəmi</span><b>${money(cartTotal())}</b></div>
    <label class="yz-qc-fld"><span>Ümumi qeyd (könüllü)</span><textarea id="yzQcNote" maxlength="200" rows="2" placeholder="Məs. hamısını birlikdə gətirin"></textarea></label>
    <p class="yz-qc-hint">${I('clock')} Sifariş əvvəl ofisianta gedir. Təsdiqdən sonra mətbəxdə hazırlanmağa başlayır.</p>`
    : `<div class="yz-qc-empty"><p>Səbət boşdur.</p><button type="button" class="yz-qc-backlink" data-qc-menu>${I('back')} Menyuya qayıt</button></div>`;
  $('yzQcBody').scrollTop = 0;
  renderFoot();
}
function renderDone(total) {
  view = 'done';
  $('yzQcCats').hidden = true; $('yzQcSrch').hidden = true;
  document.querySelector('#yzQcSheet [data-qc-search]').hidden = true;
  $('yzQcBody').innerHTML = `<div class="yz-qc-done"><span class="yz-qc-done__ic">${I('check')}</span><h3>Sifarişiniz göndərildi</h3>
    <p>${money(total)} · Ofisiant təsdiqləyəndən sonra mətbəxə gedəcək. Vəziyyəti əsas səhifədə görəcəksiniz.</p>
    <button type="button" class="yz-qc-cta yz-qc-cta--in" data-qc-close><span>Bağla</span></button></div>`;
  $('yzQcFoot').innerHTML = ''; $('yzQcFoot').classList.remove('is-on');
}

let sending = false;
async function onClick(e) {
  const t = e.target.closest('button, [data-qc-open], [data-qc-dclose]'); if (!t) return;
  const d = t.dataset;
  if (d.qcClose !== undefined) { closeSheet(); return; }
  if (d.qcDclose !== undefined) { closeDlg(); return; }
  if (d.qcSearch !== undefined) {
    searchOn = !searchOn; $('yzQcSrch').hidden = !searchOn;
    if (searchOn) $('yzQcQ').focus(); else if (query) { query = ''; $('yzQcQ').value = ''; renderMenu(); }
    return;
  }
  if (d.qcCat) { const sec = document.getElementById(d.qcCat); sec?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (d.qcQuick) {
    e.stopPropagation();
    const m = itemOf(d.qcQuick);
    if (m?.variants) { openDlg(m.id); return; }
    add(m.id, '', 1, ''); refreshCard(m.id); return;
  }
  if (d.qcOpen) { openDlg(d.qcOpen); return; }
  if (d.qcDq) { dlg.qty = Math.max(1, Math.min(20, dlg.qty + Number(d.qcDq))); dlgPrice(); return; }
  if (d.qcDadd !== undefined) {
    add(dlg.id, dlg.v, dlg.qty, ($('yzQcDNote')?.value || '').trim().slice(0, 100));
    const id = dlg.id; closeDlg(); if (view === 'menu') refreshCard(id); return;
  }
  if (d.qcLq) {
    const l = cart[d.qcLq]; if (!l) return;
    l.qty = Math.max(0, Math.min(20, l.qty + Number(d.d)));
    if (!l.qty) delete cart[d.qcLq];
    renderCart(); return;
  }
  if (d.qcCart !== undefined) { renderCart(); return; }
  if (d.qcMenu !== undefined) { renderMenu(); return; }
  if (d.qcSend !== undefined && !sending) {
    sending = true; t.disabled = true; t.querySelector('span').textContent = 'Göndərilir…';
    try {
      const items = cartLines().map(l => ({ id: l.id, qty: l.qty, note: l.note, ...(l.v ? { v: l.v } : {}) }));
      const r = await api('qrOrder', { tableId, items, note: ($('yzQcNote')?.value || '').trim() });
      cart = {}; renderDone(r.total); poll();
    } catch (er) {
      toast(`${I('error')} ${esc(er.message || 'Göndərilmədi')}`, true);
      if (er.code === 'gone') { try { await loadMenu(); } catch (x) { /* */ } renderCart(); }
      t.disabled = false; renderFoot();
    } finally { sending = false; }
  }
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('#yzQcSheet [data-qc-open]')) { e.preventDefault(); openDlg(e.target.dataset.qcOpen); }
});

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
    query = ''; searchOn = false; $('yzQcQ').value = ''; $('yzQcSrch').hidden = true;
    renderMenu();
    requestAnimationFrame(() => s.classList.add('is-on'));
    setTimeout(() => s.querySelector('[data-qc-close]')?.focus(), 50);
  } catch (e) { toast(`${I('error')} ${esc(e.message || 'Menyu açılmadı')}`, true); }
  finally { if (btn) btn.disabled = false; }
}
function closeSheet() {
  const s = $('yzQcSheet'); if (!s) return;
  if ($('yzQcDlg') && !$('yzQcDlg').hidden) closeDlg();
  s.classList.remove('is-on'); spyOff?.(); spyOff = null;
  setTimeout(() => { s.hidden = true; }, 200);
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
