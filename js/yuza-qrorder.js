/* ═══════════════════════════════════════════
   YUZA POS — MÜŞTƏRİNİN QR SİFARİŞİ: İŞÇİ TƏRƏFİ (Q1, 21.11.2026)
   • Müştəri masadakı QR-dan sifariş verir (yalnız masa AKTİV olanda) → qrOrders/{id} status 'pending'.
     Sifariş mətbəxə birbaşa GETMİR.
   • Görən və təsdiqləyən: həmin masanın ofisiantı, "qr.approve" icazəli şəxs, Rəhbər. Səs: qr_order.
   • "Təsdiqlə və göndər": mallar həmin masanın səbətinə düşür və adi qaydada göndərilir
     (anbar, porsiya, göndərmə anında yoxlama, mətbəx kartı, çap — hamısı eyni yoldan).
   • "Səbətdə dəyiş": mallar səbətə düşür, işçi dəyişib özü "Göndər" basır.
   • "Rədd et": səbəb müştəriyə göstərilir.
   • Ayar: Ayarlar → Satış → "Masadan QR sifariş" (settings/qrOrder/on).
═══════════════════════════════════════════ */
import { db } from './firebase-service.js';
import { state } from './state.js';
import { hasPermission } from './permissions.js';
import { addLog, showToast, toArr, makeLineKey } from './utils.js';
import { playNotifSound } from './notifSounds.js';
import { modal, esc, confirmBox } from './yuza-inv-ui.js';

const I = (n) => `<svg class="icon"><use href="#i-${n}"></use></svg>`;
const money = (n) => (Number(n) || 0).toFixed(2) + ' ₼';
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDT = (ts) => { const d = new Date(ts || 0); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

let list = [], on = false;
const tableOf = (id) => (state.tables || []).find(t => t.id === id);
const isAdmin = () => state.user?.role === 'admin';
/* Sifariş hələ etibarlıdırmı: masa açıqdır və eyni oturumdur */
const live = (r) => { const t = tableOf(r.tableId); return !!(t && t.occupant && (!r.session || Number(t.activatedAt) === Number(r.session))); };
export const canHandle = (r) => !!state.user && (isAdmin() || hasPermission('qr.approve') || (tableOf(r.tableId)?.occupant === state.user.id && hasPermission('order.add_item')));
export const pending = () => list.filter(r => r.status === 'pending' && canHandle(r)).sort((a, b) => a.createdAt - b.createdAt);

/* ── Dinləmə ── */
let who = null, off = null;
function watch() {
  const key = state.user ? `${state.user.role}:${state.user.id || 'admin'}` : null;
  if (key === who) return;
  who = key; off?.(); off = null; list = [];
  if (!state.user || (state.user.role !== 'admin' && state.user.role !== 'staff')) return;
  const since = Date.now(), known = {};
  const q = db.ref('qrOrders').orderByKey().limitToLast(100);
  const h = q.on('value', snap => {
    list = toArr(snap.val());
    let fresh = 0;
    list.forEach(r => {
      const prev = known[r.id]; known[r.id] = r.status;
      if (prev === undefined && r.status === 'pending' && r.createdAt >= since && canHandle(r)) fresh++;
    });
    if (fresh) {
      try { playNotifSound('qr_order'); } catch (e) { /* */ }
      const r = pending().slice(-1)[0];
      showToast(`${I('qr')} QR sifariş: ${esc(r?.tableName || 'Masa')} — ${money(r?.total)} <button type="button" class="yz-qr-toastbtn" onclick="window.__yzQr.open()">Bax</button>`, { ms: 10000 });
    }
    paintBadges();
  }, () => {});
  off = () => q.off('value', h);
}

/* Masa kartında nişan */
function paintBadges() {
  const by = {};
  pending().forEach(r => { by[r.tableId] = (by[r.tableId] || 0) + 1; });
  document.querySelectorAll('.floor-card[data-table-id]').forEach(c => {
    const n = by[c.dataset.tableId] || 0;
    let b = c.querySelector('.yz-qr-badge');
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'yz-qr-badge'; c.appendChild(b); }
    b.textContent = `QR ${n}`; b.title = 'Təsdiq gözləyən QR sifariş';
  });
}

/* ── Təsdiq / rədd ── */
async function take(r, status, extra = {}) {
  const res = await db.ref('qrOrders/' + r.id).transaction(cur => {
    if (!cur || cur.status !== 'pending') return;   // başqası artıq baxıb
    return { ...cur, status, at: Date.now(), byId: state.user?.id || 'admin', byName: state.user?.name || 'Rəhbər', ...extra };
  });
  return res.committed;
}

function toCart(r) {
  const cart = window.staffApp?.orderCart;
  if (!cart) throw new Error('Sifariş ekranı hazır deyil');
  // Başqa masada göndərilməmiş mallar varsa — itmir, həmin masa açılanda geri qayıdır
  const cur = state.orderTableId;
  if (cur && cur !== r.tableId && Object.keys(state._orderDraft || {}).length) {
    const st = cart._failedDrafts[cur] = cart._failedDrafts[cur] || {};
    Object.entries(state._orderDraft).forEach(([k, l]) => { if (st[k]) st[k].qty += l.qty; else st[k] = l; });
  }
  if (state.orderTableId !== r.tableId) cart.open(r.tableId);
  let missing = [];
  (r.items || []).forEach(x => {
    const m = (state.menuItems || []).find(mi => mi.id === x.id);
    if (!m) { missing.push(x.name); return; }
    const note = ['QR', x.note || ''].filter(Boolean).join(': ');
    const key = makeLineKey(x.id, note, 0);
    if (state._orderDraft[key]) state._orderDraft[key].qty += x.qty;
    else state._orderDraft[key] = { menuItemId: x.id, qty: x.qty, note, extraFee: 0 };
  });
  const gn = document.getElementById('orderGlobalNote');
  if (gn && r.note) gn.value = [gn.value.trim(), 'QR: ' + r.note].filter(Boolean).join(' · ');
  cart.renderDraftList();
  if (missing.length) showToast(`${I('warning')} Menyuda tapılmadı: ${esc(missing.join(', '))}`, { ms: 8000 });
  return cart;
}

export async function approve(id, sendNow = true) {
  const r = list.find(x => x.id === id);
  if (!r || !canHandle(r)) return false;
  if (!live(r)) { showToast(`${I('warning')} Masa bağlanıb — sifariş etibarsızdır`); await take(r, 'expired'); return false; }
  if (!await take(r, 'approved', { sent: !!sendNow })) { showToast(`${I('warning')} Bu sifarişə artıq baxılıb`); return false; }
  addLog('qr_order', `${state.user?.name || 'Rəhbər'} "${r.tableName}" masasının QR sifarişini təsdiqlədi${sendNow ? ' və göndərdi' : ' (səbətdə dəyişmək üçün)'}: ${(r.items || []).map(x => `${x.qty}× ${x.name}`).join(', ')} (${money(r.total)})`, { tableId: r.tableId, qrOrderId: r.id });
  const cart = toCart(r);
  if (sendNow) await cart.send();
  else showToast(`${I('check')} QR sifariş səbətdədir — yoxlayıb "Göndər" basın`);
  return true;
}

export async function reject(id, reason = '') {
  const r = list.find(x => x.id === id);
  if (!r || !canHandle(r)) return false;
  if (!await take(r, 'rejected', { reason: String(reason || '').slice(0, 200) })) { showToast(`${I('warning')} Bu sifarişə artıq baxılıb`); return false; }
  addLog('qr_order', `${state.user?.name || 'Rəhbər'} "${r.tableName}" masasının QR sifarişini rədd etdi${reason ? ': ' + reason : ''}`, { tableId: r.tableId, qrOrderId: r.id });
  showToast(`${I('check')} Rədd edildi — müştəri görəcək`);
  return true;
}

/* ── Siyahı pəncərəsi ── */
function rowHtml(r) {
  const ok = live(r);
  return `<div class="yz-qr-card${ok ? '' : ' is-dead'}">
    <div class="yz-qr-head"><b>${esc(r.tableName)}</b><span>${fmtDT(r.createdAt)}</span></div>
    <ul>${(r.items || []).map(x => `<li><span>${x.qty}× ${esc(x.name)}${x.note ? ` <small>· ${esc(x.note)}</small>` : ''}</span><b>${money(x.price * x.qty)}</b></li>`).join('')}</ul>
    ${r.note ? `<p class="yz-qr-note">${I('note')} ${esc(r.note)}</p>` : ''}
    <div class="yz-qr-total">Cəmi <b>${money(r.total)}</b></div>
    ${ok ? `<div class="yz-qr-acts">
      <button type="button" class="yzi-btn yzi-btn--gold" data-qr-ok="${esc(r.id)}">${I('check')} Təsdiqlə və göndər</button>
      <button type="button" class="yzi-btn yzi-btn--ghost" data-qr-edit="${esc(r.id)}">Səbətdə dəyiş</button>
      <button type="button" class="yzi-btn yzi-btn--ghost" data-qr-no="${esc(r.id)}">Rədd et</button></div>`
    : `<p class="yz-qr-note">${I('warning')} Masa bağlanıb və ya yenidən açılıb — bu sifariş etibarsızdır. <button type="button" class="yzi-btn yzi-btn--ghost yzi-btn--sm" data-qr-x="${esc(r.id)}">Siyahıdan çıxar</button></p>`}
  </div>`;
}
export function open() {
  const items = pending();
  const m = modal({ title: `${I('qr')} QR sifarişlər (${items.length})`, wide: true,
    body: `<div class="yz-qr-list">${items.length ? items.map(rowHtml).join('') : '<p class="yzi-empty">Təsdiq gözləyən QR sifariş yoxdur.</p>'}</div>`,
    actions: [{ label: 'Bağla', cancel: true }] });
  const root = document.querySelector('.yz-qr-list')?.closest('.yzi-modal-bg');
  root?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-qr-ok],[data-qr-edit],[data-qr-no],[data-qr-x]'); if (!b || b.disabled) return;
    b.disabled = true;
    try {
      if (b.dataset.qrOk || b.dataset.qrEdit) { root.remove(); await approve(b.dataset.qrOk || b.dataset.qrEdit, !!b.dataset.qrOk); return; }
      if (b.dataset.qrX) { const r = list.find(x => x.id === b.dataset.qrX); if (r) await take(r, 'expired'); }
      if (b.dataset.qrNo) {
        const why = await confirmBox('Müştəriyə "sifarişiniz qəbul edilmədi" göstəriləcək. Səbəb (könüllü, müştəri görür):', { title: 'Rədd edilsin?', okLabel: 'Rədd et', okCls: 'yzi-btn--red', input: 'Səbəb' });
        if (why === false || why === null) { b.disabled = false; return; }
        await reject(b.dataset.qrNo, typeof why === 'string' ? why : '');
      }
      root.remove(); if (pending().length) setTimeout(open, 200);
    } catch (er) { b.disabled = false; showToast(`${I('error')} ${esc(er.message || er)}`); }
  });
  return m;
}

/* ── Ayar kartı (Ayarlar → Satış) ── */
function renderSettings(box) {
  if (!box) return;
  const can = isAdmin() || hasPermission('panel.settings');
  box.innerHTML = `<div class="table-card yzs-card"><h3 style="margin-bottom:8px;">${I('qr')} Masadan QR sifariş</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:10px;">Müştəri masadakı QR-dan menyunu görüb sifariş verə bilər — yalnız masa açıq olanda. Sifariş mətbəxə birbaşa getmir: əvvəl masanın ofisiantı və ya "QR sifarişini təsdiqləmək" icazəli şəxs təsdiqləyir.</p>
    <label style="display:flex;gap:8px;align-items:center;font-size:14px;"><input type="checkbox" id="yzQrOn" ${on ? 'checked' : ''} ${can ? '' : 'disabled'}> Masadan QR sifariş açıqdır</label></div>`;
  box.querySelector('#yzQrOn')?.addEventListener('change', async (e) => {
    try {
      await db.ref('settings/qrOrder').set({ on: e.target.checked, at: Date.now(), by: state.user?.name || 'Rəhbər' });
      addLog('settings', `Masadan QR sifariş ${e.target.checked ? 'açıldı' : 'bağlandı'}`);
      showToast(`${I('check')} Yadda saxlanıldı`);
    } catch (er) { e.target.checked = !e.target.checked; showToast(`${I('error')} Saxlanmadı: ${esc(er.message || er)}`); }
  });
}
let setOff = null, setWho = null;
function watchSettings() {
  const key = state.user ? state.user.role : null;
  if (key === setWho) return;
  setWho = key; setOff?.(); setOff = null;
  if (!state.user) return;
  const ref = db.ref('settings/qrOrder/on');
  const h = ref.on('value', s => { on = s.val() === true; }, () => {});
  setOff = () => ref.off('value', h);
}
function ensureSettingsCard() {
  const pane = document.querySelector('#sec-settings .yzs-pane[data-pane="sales"]');
  if (!pane || pane.hidden) return;
  let box = document.getElementById('yzsQrOrder');
  if (!box) { box = document.createElement('div'); box.id = 'yzsQrOrder'; pane.appendChild(box); box.dataset.v = ''; }
  const v = String(on) + (state.user?.role || '');
  if (box.dataset.v !== v) { box.dataset.v = v; renderSettings(box); }
}

/* ⋮ menyusu */
window.__yzDotsExtra = window.__yzDotsExtra || [];
window.__yzDotsExtra.push(() => {
  const n = state.user ? pending().length : 0;
  return n ? { k: 'x:qrorders', l: `QR sifarişlər (${n})`, i: 'qr', run: open } : null;
});

setInterval(() => {
  watch(); watchSettings();
  if (!state.user) return;
  paintBadges(); ensureSettingsCard();
}, 800);

window.__yzQr = { open, approve, reject, pending, canHandle };
