/* ═══════════════════════════════════════════
   YUZA POS — EHTİYAT NÜSXƏDƏN BƏRPA (R1, 21.11.2026) · yalnız Rəhbər
   Mənbə: kompüterdən fayl (.json) və ya serverdəki gecə nüsxələrindən biri.
   • Bərpadan dərhal əvvəl hazırkı vəziyyətin nüsxəsi avtomatik alınır (geri qayıtmaq olsun).
   • PIN-lər, təsdiqli cihazlar və Rəhbər hesabı (sys, owners) bərpa olunmur — hazırkı kimi qalır.
   • Tam bərpa: baza nüsxə ilə eyni olur (nüsxədə olmayan bölmələr silinir).
     Seçilmiş bölmələr: yalnız işarələnən bölmələr əvəz olunur, qalanına toxunulmur.
   • Bitəndə bütün açıq cihazlar səhifəni özü yeniləyir.
═══════════════════════════════════════════ */
import { modal } from './yuza-inv-ui.js';
import { showToast, esc } from './utils.js';
import { state } from './state.js';

const I = (n) => `<svg class="icon"><use href="#i-${n}"></use></svg>`;
const KEEP = new Set(['sys', 'owners']);
const CHUNK = 400 * 1024;            // bir sorğuda ən çox ~400 KB
const KNOWN = ['settings', 'staff', 'menuItems', 'tables', 'closedOrders', 'products'];
export const LABELS = {
  tables: 'Masalar', tableOrders: 'Açıq masaların sifarişləri', closedOrders: 'Bağlanmış satışlar', payments: 'Ödənişlər',
  menuItems: 'Menyu', categories: 'Menyu kateqoriyaları', staff: 'İşçilər', staffHR: 'Kadr məlumatları', settings: 'Ayarlar',
  products: 'Məhsullar (anbar)', stock: 'Anbar qalıqları', stockMoves: 'Anbar hərəkətləri', warehouses: 'Anbarlar',
  invDocs: 'Anbar sənədləri', suppliers: 'Təchizatçılar', supplierLedger: 'Təchizatçı hesabları', cashAccounts: 'Kassalar',
  customers: 'Nisyə müştəriləri', customerCharges: 'Nisyə əməliyyatları', loyaltyCustomers: 'Müştəri bazası (loyallıq)',
  creditRequests: 'Nisyə təsdiq sorğuları', logs: 'Jurnal', att: 'Davamiyyət', shifts: 'Kassa növbələri', shiftCur: 'Açıq kassa növbəsi',
  kitchenOrders: 'Mətbəx sifarişləri', kitchens: 'Mətbəxlər', printers: 'Printerlər', banquetEvents: 'Banketlər',
  reservations: 'Rezervasiyalar', deliveries: 'Çatdırılmalar', feedbacks: 'Müştəri rəyləri', announcements: 'Elanlar'
};
const label = (k) => LABELS[k] ? `${LABELS[k]} <small class="mut">(${esc(k)})</small>` : esc(k);
const reload = () => { if (window.__yzNoReload) window.__yzReloaded = true; else location.reload(); };   // sınaqda səhifə yenilənmir
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTs = (ts) => { const d = new Date(ts); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const count = (v) => v && typeof v === 'object' ? Object.keys(v).length : (v == null ? 0 : 1);
const enc = new TextEncoder();
const sizeOf = (v) => enc.encode(JSON.stringify(v ?? null)).length;

/* Faylın/nüsxənin yoxlanması: YuzaPOS bazasına oxşamalıdır */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Fayl oxunmadı: JSON formatında deyil.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Bu fayl YuzaPOS ehtiyat nüsxəsi deyil.');
  if (!KNOWN.some(k => k in data)) throw new Error('Bu fayl YuzaPOS ehtiyat nüsxəsi deyil (menyu, işçilər, ayarlar tapılmadı).');
  return data;
}

/* Böyük bölmə hissələrə bölünür: birinci hissə bölməni əvəz edir (put), qalanları əlavə olunur (patch) */
export function chunksOf(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val) || sizeOf(val) <= CHUNK) return [{ mode: 'put', val: val ?? null }];
  const out = []; let cur = {}, sz = 0;
  for (const [k, v] of Object.entries(val)) {
    const s = sizeOf(v) + k.length + 4;
    if (sz && sz + s > CHUNK) { out.push(cur); cur = {}; sz = 0; }
    cur[k] = v; sz += s;
  }
  if (Object.keys(cur).length) out.push(cur);
  return out.map((v, i) => ({ mode: i ? 'patch' : 'put', val: v }));
}

async function run({ data, from, nodes, full }, prog) {
  const A = await import('./yuza-api.js');
  prog('Bərpadan əvvəl hazırkı vəziyyətin nüsxəsi alınır…');
  const b = await A.api('restoreBegin', {}, { owner: true });
  const removed = full ? (b.nodes || []).filter(n => !(n in data) && !KEEP.has(n) && n !== 'appSignal') : [];
  const jobs = [];
  nodes.forEach(n => chunksOf(data[n]).forEach(c => jobs.push({ node: n, ...c })));
  removed.forEach(n => jobs.push({ node: n, mode: 'put', val: null }));
  let i = 0;
  for (const j of jobs) {
    i++; prog(`Bərpa olunur: ${LABELS[j.node] || j.node} · ${i} / ${jobs.length}`);
    await A.api('restoreNode', j, { owner: true });
  }
  await A.api('restoreEnd', { from, pre: b.pre || '', nodes: nodes.length, removed: removed.length }, { owner: true });
  return { pre: b.pre, nodes: nodes.length, removed: removed.length };
}

/* Bərpa pəncərəsi */
export function openRestore(data, from) {
  if (state.user?.role !== 'admin') { showToast(`${I('warning')} Bərpanı yalnız Rəhbər edə bilər`); return; }
  const nodes = Object.keys(data).filter(k => !KEEP.has(k)).sort((a, b) => (LABELS[a] ? 0 : 1) - (LABELS[b] ? 0 : 1) || a.localeCompare(b));
  const body = document.createElement('div');
  body.className = 'yz-rs';
  body.innerHTML = `
    <p class="yz-rs-src">${I('save')} Mənbə: <b>${esc(from)}</b> · ${nodes.length} bölmə</p>
    <div class="yz-rs-warn">${I('warning')} Bərpa bazadakı məlumatı nüsxədəki vəziyyətlə <b>əvəz edir</b>. Nüsxədən sonra edilən satışlar, ödənişlər və dəyişikliklər itəcək.
      Bərpadan dərhal əvvəl hazırkı vəziyyətin nüsxəsi avtomatik alınır — lazım olsa ona qayıtmaq olar.
      PIN-lər, təsdiqli cihazlar və Rəhbər hesabı dəyişmir.</div>
    <label class="yz-rs-opt"><input type="radio" name="yzRsMode" value="full" checked> <span><b>Tam bərpa</b> — baza nüsxə ilə eyni olur (nüsxədə olmayan bölmələr silinir)</span></label>
    <label class="yz-rs-opt"><input type="radio" name="yzRsMode" value="part"> <span><b>Yalnız seçilmiş bölmələr</b> — qalan bölmələrə toxunulmur</span></label>
    <div class="yz-rs-list" hidden>${nodes.map(n => `<label><input type="checkbox" data-n="${esc(n)}"> ${label(n)} <small class="mut">· ${count(data[n])}</small></label>`).join('')}</div>
    <label class="yzi-f"><span>Təsdiq üçün <b>BƏRPA</b> yazın</span><input type="text" id="yzRsOk" autocomplete="off" autocapitalize="characters"></label>
    <p class="yz-rs-prog" id="yzRsProg" aria-live="polite"></p>`;
  const list = body.querySelector('.yz-rs-list');
  body.addEventListener('change', (e) => { if (e.target.name === 'yzRsMode') list.hidden = e.target.value !== 'part'; });
  let busy = false;
  const m = modal({
    title: `${I('refresh')} Ehtiyat nüsxədən bərpa`, wide: true, body, lock: true,
    onClose: () => { if (busy) reload(); },
    actions: [
      { label: 'Ləğv', cancel: true },
      { label: 'Bərpa et', cls: 'yzi-btn--red', close: false, onClick: async (el) => {
        const full = el.querySelector('input[name="yzRsMode"]:checked').value === 'full';
        const pick = full ? nodes : [...el.querySelectorAll('[data-n]:checked')].map(x => x.dataset.n);
        if (!pick.length) { showToast(`${I('warning')} Ən azı bir bölmə seçin`); return false; }
        if (String(el.querySelector('#yzRsOk').value || '').trim().toLocaleUpperCase('az') !== 'BƏRPA') { showToast(`${I('warning')} Təsdiq üçün BƏRPA yazın`); return false; }
        const prog = (t) => { el.querySelector('#yzRsProg').textContent = t; };
        busy = true; el.closest('.yzi-modal').querySelectorAll('button').forEach(x => { x.disabled = true; });
        try {
          const r = await run({ data, from, nodes: pick, full }, prog);
          prog(`Bərpa bitdi: ${r.nodes} bölmə${r.removed ? `, ${r.removed} artıq bölmə silindi` : ''}. Səhifə yenilənir…`);
          showToast(`${I('check')} Baza bərpa olundu`);
          setTimeout(reload, 2500);
        } catch (er) {
          busy = false;
          el.closest('.yzi-modal').querySelectorAll('button').forEach(x => { x.disabled = false; });
          prog('');
          showToast(`${I('error')} Bərpa yarımçıq qaldı: ${esc(er.message || er)}. Bərpadan əvvəlki nüsxə serverdə saxlanılıb.`, { ms: 12000 });
        }
        return false;
      } }
    ]
  });
  return m;
}

/* Kompüterdən fayl seçmək */
export function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try { openRestore(parseBackup(await f.text()), `${f.name} (fayl)`); }
    catch (e) { showToast(`${I('error')} ${esc(e.message)}`); }
  };
  inp.click();
}

/* Serverdəki nüsxədən */
export async function fromServer(key, at) {
  const A = await import('./yuza-api.js');
  const r = await A.apiRaw('backupGet', { key }, { owner: true });
  openRestore(parseBackup(await r.text()), `server nüsxəsi ${at ? fmtTs(at) : key}`);
}

window.__yzRestore = { openRestore, pickFile, fromServer, parseBackup, chunksOf };
