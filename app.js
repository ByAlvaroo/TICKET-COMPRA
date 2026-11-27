/* ByTicket — listas de la compra con forma de ticket, por comercio, sincronizadas con GitHub.
   App instalable (PWA). HECHO POR @BYALVARO__ */
{
const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const FILE = 'tickets.json';
const uid = p => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const emptyDoc = () => ({ version: 2, tickets: [], settings: { autodel: 24 } });
const clone = o => JSON.parse(JSON.stringify(o));
const isMobile = () => matchMedia('(max-width: 899px)').matches;
const touchDev = () => matchMedia('(pointer:coarse)').matches;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const safeImg = u => /^https:\/\//.test(u || '') ? u : '';

/* ---------------- comercios ---------------- */
const BADGE = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="currentColor"/><path d="M12 20h24l-2.6 14.2a3 3 0 0 1-3 2.5H17.6a3 3 0 0 1-3-2.5z" fill="#fff"/><path d="M18 20l4-8M30 20l-4-8" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M20 26v6M24 26v6M28 26v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const STORES = {
  mercadona: { id: 'mercadona', name: 'Mercadona', color: '#00843f', light: '#e4f3ea', catalog: 'catalog/mercadona.json', custom: 'que no está en Mercadona' }
};
const SOON = ['Consum', 'Lidl', 'Carrefour'];

// Iconos de categoría (por palabras del nombre)
const CAT_ICONS = [
  ['aceite', '🫒'], ['agua', '🥤'], ['aperitivo', '🥨'], ['arroz', '🍝'], ['azucar', '🍫'], ['bebe', '🍼'], ['bodega', '🍷'],
  ['cacao', '☕'], ['carne', '🥩'], ['cereal', '🍪'], ['charcut', '🧀'], ['congelad', '❄️'], ['conserva', '🥫'], ['cabello', '🧴'],
  ['facial', '🧼'], ['fitoterapia', '💊'], ['fruta', '🍎'], ['huevo', '🥚'], ['limpieza', '🧽'], ['maquillaje', '💄'], ['marisco', '🐟'],
  ['mascota', '🐾'], ['panaderia', '🥖'], ['pizza', '🍕'], ['postre', '🍮'], ['zumo', '🧃']
];
const catIcon = name => { const n = norm(name); const f = CAT_ICONS.find(([k]) => n.includes(k)); return f ? f[1] : '🛒'; };
const FALLBACK_CATS = ['Aceite, especias y salsas', 'Agua y refrescos', 'Aperitivos', 'Arroz, legumbres y pasta', 'Azúcar, caramelos y chocolate', 'Bebé', 'Bodega', 'Cacao, café e infusiones', 'Carne', 'Cereales y galletas', 'Charcutería y quesos', 'Congelados', 'Conservas, caldos y cremas', 'Cuidado del cabello', 'Cuidado facial y corporal', 'Fitoterapia y parafarmacia', 'Fruta y verdura', 'Huevos, leche y mantequilla', 'Limpieza y hogar', 'Maquillaje', 'Marisco y pescado', 'Mascotas', 'Panadería y pastelería', 'Pizzas y platos preparados', 'Postres y yogures', 'Zumos'];

/* ---------------- configuración ---------------- */
function detectRepo() {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return {};
  const owner = h.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.includes('.') ? seg : h };
}
let cfg = Object.assign({ branch: 'datos' }, detectRepo(), LS.get('ts.cfg', {}));
const mode = () => !(cfg.owner && cfg.repo) ? 'local' : cfg.token ? 'rw' : 'ro';
const cacheKey = () => `ts.cache.${cfg.owner}/${cfg.repo}`.toLowerCase();
const pendKey = () => `ts.pending.${cfg.owner}/${cfg.repo}`.toLowerCase();

/* ---------------- estado ---------------- */
let remote = emptyDoc();
let sha = null, etag = null;
let pending = [];
let flushing = false, flushTimer = null, loaded = false, offline = false;
let current = LS.get('ts.cur', null);         // ticket abierto
const ui = { view: 'home', store: null, pane: 'cat', cat: null, sub: null, q: '' };
const seen = new Set();

/* ---------------- operaciones (serializables) ---------------- */
const findT = (d, id) => d.tickets.find(t => t.id === id);
const findI = (d, id, iid) => findT(d, id)?.items.find(x => x.id === iid);
const touch = t => { if (t) t.updated = Date.now(); };
const OPS = {
  addTicket: (d, t) => { if (!findT(d, t.id)) d.tickets.push(clone(t)); },
  editTicket: (d, id, f) => { const t = findT(d, id); if (t) { Object.assign(t, f); touch(t); } },
  delTicket: (d, id) => { d.tickets = d.tickets.filter(t => t.id !== id); },
  addItems: (d, id, items) => { const t = findT(d, id); if (t) { items.forEach(i => { if (!t.items.some(x => x.id === i.id)) t.items.push(clone(i)); }); touch(t); } },
  setQty: (d, id, iid, q, item) => {
    const t = findT(d, id); if (!t) return;
    const i = t.items.find(x => x.id === iid);
    if (q <= 0) { if (i && !i.fav) t.items = t.items.filter(x => x.id !== iid); else if (i) i.qty = 1; }
    else if (i) i.qty = q;
    else if (item) t.items.push({ ...clone(item), qty: q });
    touch(t);
  },
  setDone: (d, id, iid, v, now) => { const i = findI(d, id, iid); if (i) { i.done = v; if (v) i.doneAt = now || Date.now(); else delete i.doneAt; touch(findT(d, id)); } },
  setFav: (d, id, iid, v) => { const i = findI(d, id, iid); if (i) { i.fav = v; touch(findT(d, id)); } },
  delItem: (d, id, iid) => { const t = findT(d, id); if (t) { t.items = t.items.filter(x => x.id !== iid); touch(t); } },
  clearDone: (d, id) => { const t = findT(d, id); if (t) { t.items = t.items.filter(x => !x.done || x.fav).map(x => { if (x.fav && x.done) { x.done = false; delete x.doneAt; } return x; }); touch(t); } },
  purge: (d, now, ms) => {
    d.tickets.forEach(t => {
      let ch = false;
      t.items = t.items.filter(i => {
        if (!i.done || !i.doneAt || now - i.doneAt < ms) return true;
        ch = true;
        if (i.fav) { i.done = false; delete i.doneAt; return true; } // los fijos vuelven para la próxima compra
        return false;
      });
      if (ch) touch(t);
    });
  },
  setSetting: (d, k, v) => { d.settings = d.settings || {}; d.settings[k] = v; }
};
const applyOp = (d, op) => { try { OPS[op.t] && OPS[op.t](d, ...op.a); } catch {} return d; };
function normalizeDoc(d) {
  if (!d || !Array.isArray(d.tickets)) d = emptyDoc();
  d.settings = Object.assign({ autodel: 24 }, d.settings || {});
  d.tickets.forEach(t => { t.store = t.store || 'mercadona'; t.items = Array.isArray(t.items) ? t.items : []; });
  return d;
}
const view = () => normalizeDoc(pending.reduce(applyOp, clone(remote)));
const savePending = () => LS.set(pendKey(), pending);
const saveCache = () => LS.set(cacheKey(), { doc: remote, sha });

/* ---------------- GitHub API ---------------- */
async function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
  try { return await fetch('https://api.github.com' + path, { ...opts, headers, cache: 'no-store' }); }
  catch { const e = new Error('Sin conexión: los cambios se guardan en el móvil y se subirán al volver'); e.offline = true; throw e; }
}
const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
const b64enc = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
function errText(r) {
  if (r.status === 401) return 'Token no válido o caducado';
  if (r.status === 403 || r.status === 429) return 'GitHub ha limitado las peticiones o el token no tiene permiso';
  if (r.status === 404) return cfg.token ? 'No encuentro el repositorio (revisa usuario/repo y permisos del token)' : 'No encuentro el repositorio (si es privado, añade el token)';
  return 'Error de GitHub (' + r.status + ')';
}
async function fetchRemote(useEtag) {
  const r = await gh(`${repoPath()}/contents/${FILE}?ref=${encodeURIComponent(cfg.branch || 'datos')}`, useEtag && etag ? { headers: { 'If-None-Match': etag } } : {});
  if (r.status === 304) return null;
  if (r.status === 404) { const rr = await gh(repoPath()); if (!rr.ok) throw new Error(errText(rr)); return { doc: emptyDoc(), sha: null, etag: null }; }
  if (!r.ok) throw new Error(errText(r));
  const j = await r.json();
  let doc; try { doc = JSON.parse(b64dec(j.content || '')); } catch { doc = emptyDoc(); }
  return { doc: normalizeDoc(doc), sha: j.sha, etag: r.headers.get('ETag') };
}
async function ensureBranch() {
  const br = cfg.branch || 'datos';
  const r = await gh(`${repoPath()}/branches/${encodeURIComponent(br)}`);
  if (r.ok) return;
  const repo = await gh(repoPath()); if (!repo.ok) throw new Error(errText(repo));
  const def = (await repo.json()).default_branch;
  const ref = await gh(`${repoPath()}/git/ref/heads/${encodeURIComponent(def)}`);
  if (!ref.ok) throw new Error('El repositorio está vacío: sube primero los archivos de la app');
  const base = (await ref.json()).object.sha;
  const c = await gh(`${repoPath()}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + br, sha: base }) });
  if (!c.ok && c.status !== 422) throw new Error(errText(c));
}
async function putRemote(doc, curSha) {
  const body = { message: 'Tickets actualizados', content: b64enc(JSON.stringify(doc, null, 1)), branch: cfg.branch || 'datos' };
  if (curSha) body.sha = curSha;
  return gh(`${repoPath()}/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
}

/* ---------------- guardar cambios ---------------- */
function mutate(t, ...a) {
  if (mode() === 'ro') { toast('Modo solo lectura: añade tu token en Ajustes'); return false; }
  pending.push({ t, a });
  render();
  if (mode() === 'local') { remote = view(); pending = []; LS.set('ts.local', remote); setSync('local'); return true; }
  savePending();
  if (offline) { setSync('off'); return true; }
  setSync('busy');
  clearTimeout(flushTimer); flushTimer = setTimeout(flush, 600);
  return true;
}
async function flush() {
  if (flushing || !pending.length || mode() !== 'rw') return;
  clearTimeout(flushTimer); flushTimer = null;
  flushing = true; setSync('busy');
  const batch = pending.slice();
  let ok = false, wasOffline = false;
  try {
    let base = { doc: remote, sha };
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      const next = batch.reduce(applyOp, normalizeDoc(clone(base.doc)));
      const r = await putRemote(next, base.sha);
      if (r.ok) { const j = await r.json(); remote = next; sha = j.content.sha; etag = null; pending = pending.slice(batch.length); savePending(); saveCache(); ok = true; break; }
      const msg = (await r.json().catch(() => ({}))).message || '';
      if ((r.status === 404 || r.status === 422) && /branch/i.test(msg)) { await ensureBranch(); continue; }
      if (r.status === 409 || r.status === 422) { base = await fetchRemote(false); continue; }
      throw new Error(errText(r));
    }
    if (!ok) throw new Error('No se pudo guardar; reintentando…');
    offline = false; setSync(pending.length ? 'busy' : 'ok');
  } catch (e) { wasOffline = !!e.offline; offline = wasOffline; setSync(wasOffline ? 'off' : 'err', e.message); }
  finally {
    flushing = false; render();
    if (pending.length && !wasOffline) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ok ? 300 : 8000); }
  }
}
async function pull(useEtag = true) {
  if (mode() === 'local' || flushing) return;
  try {
    const res = await fetchRemote(useEtag);
    offline = false;
    if (res) { remote = res.doc; sha = res.sha; etag = res.etag; saveCache(); }
    if (pending.length && mode() === 'rw') flush(); else setSync(mode() === 'ro' ? 'ro' : 'ok');
  } catch (e) { offline = !!e.offline; setSync(offline ? 'off' : 'err', e.message); }
  loaded = true; render(); checkPurge();
}
let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  if (mode() === 'local') return;
  pollTimer = setInterval(() => { if (!document.hidden && !pending.length) pull(true); }, mode() === 'rw' ? 12000 : 60000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pending.length ? flush() : pull(true); checkPurge(); } });
window.addEventListener('online', () => { offline = false; pending.length ? flush() : pull(false); });
window.addEventListener('offline', () => { if (mode() !== 'local') { offline = true; setSync('off'); } });

/* ---------------- borrado automático de tachados ---------------- */
const autodelMs = () => { const h = Number(view().settings.autodel); return h < 0 ? Infinity : Math.max(5000, h * 3600000); };
let purgeT = null;
function checkPurge() {
  if (mode() === 'ro') return;
  const ms = autodelMs(); if (!isFinite(ms)) return;
  const now = Date.now(), d = view();
  let next = Infinity, due = false;
  d.tickets.forEach(t => t.items.forEach(i => {
    if (!i.done || !i.doneAt) return;
    const left = i.doneAt + ms - now;
    if (left <= 0) due = true; else next = Math.min(next, left);
  }));
  if (due) mutate('purge', now, ms);
  clearTimeout(purgeT);
  if (isFinite(next) && next < 2 ** 31 - 1) purgeT = setTimeout(checkPurge, next + 400);
}
setInterval(checkPurge, 60000);

/* ---------------- catálogo ---------------- */
const catalogs = {};   // store -> { data, byId, list, catOrder, state }
async function loadCatalog(store) {
  const S = STORES[store]; if (!S) return;
  if (catalogs[store] && catalogs[store].state !== 'error') return;
  catalogs[store] = { state: 'loading' };
  renderCatalog(true);
  try {
    const r = await fetch(S.catalog, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status === 404 ? 'missing' : 'http');
    const data = await r.json();
    const byId = new Map(), list = [], catOrder = new Map();
    (data.cats || []).forEach((c, ci) => {
      catOrder.set(String(c.id), ci);
      c.icon = catIcon(c.name);
      (c.subs || []).forEach(s => (s.groups || []).forEach(g => (g.products || []).forEach(p => {
        if (byId.has(p.id)) return;
        const e = { ...p, cat: String(c.id), cn: c.name, sub: String(s.id), k: norm(p.n + ' ' + (p.p || '')) };
        byId.set(p.id, e); list.push(e);
      })));
    });
    catalogs[store] = { state: 'ok', data, byId, list, catOrder };
  } catch (e) {
    catalogs[store] = { state: e.message === 'missing' ? 'missing' : 'error' };
  }
  renderCatalog(true); render();
}

/* ---------------- formato ---------------- */
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const p2 = n => String(n).padStart(2, '0');
const fDate = ts => { const d = new Date(ts); return `${DIAS[d.getDay()]}  ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fTime = ts => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hash = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const ticketNo = t => String(hash(t.id) % 10000000).padStart(7, '0');
const baseUrl = () => location.origin + location.pathname;
const ticketUrl = t => baseUrl() + '#' + t.id;
const stats = t => { const n = t.items.length, done = t.items.filter(i => i.done).length; return { n, done, units: t.items.reduce((a, i) => a + (i.qty || 1), 0), complete: n > 0 && done === n }; };
const storeTickets = (d, s) => d.tickets.filter(t => t.store === s).sort((a, b) => (a.created || 0) - (b.created || 0));

// Agrupa los productos del ticket: fijos arriba, luego por categoría (orden de la tienda), luego "Otros"
function groupItems(t) {
  const cat = catalogs[t.store];
  const order = cat && cat.catOrder;
  const favs = t.items.filter(i => i.fav);
  const rest = t.items.filter(i => !i.fav);
  const groups = [];
  if (favs.length) groups.push({ key: 'fav', name: 'Fijos · todas las semanas', icon: '⭐', fav: true, items: favs });
  const map = new Map();
  rest.forEach(i => {
    const key = i.cat ? 'c' + i.cat : 'otros';
    if (!map.has(key)) map.set(key, { key, name: i.cn || 'Otros', icon: i.cn ? catIcon(i.cn) : '📝', ord: i.cat && order && order.has(i.cat) ? order.get(i.cat) : (i.cat ? 500 : 999), items: [] });
    map.get(key).items.push(i);
  });
  [...map.values()].sort((a, b) => a.ord - b.ord).forEach(g => groups.push(g));
  return groups;
}

/* ---------------- QR ---------------- */
function qrMatrix(text) { try { return window.makeQR ? window.makeQR(text) : null; } catch { return null; } }
function qrSvg(text) {
  const g = qrMatrix(text); if (!g) return '';
  const n = g.length, q = 2; let d = '';
  g.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg class="qr" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges" role="img" aria-label="Código QR del ticket"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

/* ---------------- navegación ---------------- */
function go(patch, push = true) {
  Object.assign(ui, patch);
  if (push) history.pushState({ ui: { ...ui } }, '', ui.view === 'store' && current ? '#' + current : location.pathname);
  closeQty();
  render(); renderCatalog();
  window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', e => {
  const s = e.state && e.state.ui;
  Object.assign(ui, s || { view: 'home', store: null, pane: 'cat', cat: null, sub: null, q: '' });
  $('#searchInput').value = ui.q || '';
  closeQty(); render(); renderCatalog();
});
function openStore(store, pane) {
  const d = view();
  const list = storeTickets(d, store);
  if (!list.some(t => t.id === current)) current = list.length ? list[list.length - 1].id : null;
  loadCatalog(store);
  go({ view: 'store', store, pane: pane || 'cat', cat: null, sub: null, q: '' });
  $('#searchInput').value = '';
}
$('#backBtn').onclick = () => {
  if (ui.view === 'store' && (ui.cat || ui.q)) { history.length > 1 ? history.back() : go({ cat: null, sub: null, q: '' }); }
  else if (ui.view === 'store') { history.length > 1 ? history.back() : go({ view: 'home' }, false); }
};

/* ---------------- render general ---------------- */
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const XSVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const CHEV_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

function render() {
  const d = view();
  const S = STORES[ui.store];
  document.body.dataset.view = ui.view;
  document.body.dataset.pane = ui.pane;
  document.body.style.setProperty('--store', S ? S.color : '#1d1b20');
  document.body.style.setProperty('--store-light', S ? S.light : '#eee');
  $('#home').hidden = ui.view !== 'home';
  $('#store').hidden = ui.view !== 'store';
  $('#backBtn').hidden = ui.view === 'home';
  $('#brandText').textContent = S && ui.view === 'store' ? S.name : 'ByTicket';
  $('#brandIcon').hidden = !!(S && ui.view === 'store');
  let sb = $('#brand .store-badge');
  if (S && ui.view === 'store') { if (!sb) { sb = el('span', 'store-badge'); sb.innerHTML = BADGE; $('#brand').prepend(sb); } }
  else if (sb) sb.remove();

  const m = mode();
  if (m === 'local') showBanner('Modo local: los tickets solo se guardan en este dispositivo. Súbelo a GitHub Pages para sincronizar.', 'Ajustes', openSettings);
  else if (m === 'ro') showBanner('Modo solo lectura. Añade tu token de GitHub para poder editar desde este dispositivo.', 'Añadir token', openSettings);
  else $('#banner').hidden = true;

  if (ui.view === 'home') renderHome(d);
  else renderStore(d);
}

function showBanner(text, btn, fn) {
  const bn = $('#banner'); bn.hidden = false; bn.textContent = '';
  const b = el('button', '', btn); b.type = 'button'; b.onclick = fn;
  bn.append(el('span', '', text), b);
}

function renderHome(d) {
  const box = $('#stores'); box.textContent = '';
  Object.values(STORES).forEach(S => {
    const ts = storeTickets(d, S.id);
    const left = ts.reduce((a, t) => a + t.items.filter(i => !i.done).length, 0);
    const b = el('button', 'store-card'); b.type = 'button';
    b.style.setProperty('--c', S.color); b.style.setProperty('--cl', S.light);
    b.innerHTML = `<span class="sc-badge">${BADGE}</span><span class="sc-name"></span><span class="sc-meta"></span><span class="sc-go">${CHEV_R}</span>`;
    b.querySelector('.sc-name').textContent = S.name;
    b.querySelector('.sc-meta').textContent = ts.length ? `${ts.length} ${ts.length === 1 ? 'ticket' : 'tickets'} · ${left} por comprar` : 'Empieza tu primera lista';
    b.onclick = () => openStore(S.id);
    box.append(b);
  });
  const soon = el('div', 'store-card soon');
  soon.innerHTML = '<span class="sc-badge">+</span><span class="sc-name">Más comercios</span><span class="sc-meta"></span>';
  soon.querySelector('.sc-meta').textContent = SOON.join(', ') + '… próximamente';
  box.append(soon);
}

function renderStore(d) {
  const S = STORES[ui.store]; if (!S) return;
  const tickets = storeTickets(d, ui.store);
  if (!tickets.some(t => t.id === current)) current = tickets.length ? tickets[tickets.length - 1].id : null;
  LS.set('ts.cur', current);
  const m = mode();

  // pestañas de tickets
  const tabs = $('#tabs'); tabs.textContent = '';
  tickets.forEach(t => {
    const b = el('button', 'tab'); b.type = 'button';
    b.setAttribute('aria-current', t.id === current);
    b.append(el('span', '', t.name || 'Ticket'), el('b', '', String(t.items.filter(i => !i.done).length)));
    b.onclick = () => { current = t.id; history.replaceState(history.state, '', '#' + t.id); closeQty(); render(); };
    tabs.append(b);
  });
  if (m !== 'ro') {
    const nb = el('button', 'tab new'); nb.type = 'button';
    nb.innerHTML = PLUS; nb.append(el('span', '', 'Nuevo'));
    nb.onclick = () => openTicketDlg(null);
    tabs.append(nb);
  }
  if (lastTab !== current) {
    lastTab = current;
    const at = tabs.querySelector('[aria-current=true]');
    if (at) { const l = at.offsetLeft - 14, r = at.offsetLeft + at.offsetWidth + 14; if (l < tabs.scrollLeft) tabs.scrollLeft = l; else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth; }
  }

  const t = findT(d, current);
  $('#printer').hidden = !t; $('#actions').hidden = !t;
  $('#empty').hidden = !!t || (!loaded && m !== 'local');
  $('#emptyNew').hidden = m === 'ro';
  $('#emptyText').textContent = m === 'ro' ? 'Cuando crees tickets desde un dispositivo con token aparecerán aquí.' : 'Elige productos en las categorías y se creará tu ticket automáticamente.';
  document.querySelectorAll('#actions [data-act=edit],#actions [data-act=clear],#actions [data-act=delete]').forEach(b => b.disabled = m === 'ro');
  const left = t ? t.items.filter(i => !i.done).length : 0;
  $('#navCount').textContent = left ? String(left) : '';
  document.querySelectorAll('#bottomNav [data-pane]').forEach(b => b.setAttribute('aria-current', b.dataset.pane === ui.pane));
  if (t) renderTicket(t, S);
  updateSteppers(t);
}

/* ---------------- catálogo: render ---------------- */
let catKey = '';
function renderCatalog(force) {
  if (ui.view !== 'store') return;
  const C = catalogs[ui.store];
  const key = [ui.store, ui.cat, ui.q, C && C.state].join('|');
  if (!force && key === catKey) return;
  catKey = key;
  const body = $('#catBody');
  const head = $('#catHead');
  head.hidden = !ui.cat || !!ui.q;

  if (!C || C.state === 'loading') { body.innerHTML = '<div class="cat-msg"><span class="spin"></span>Cargando catálogo…</div>'; return; }
  if (C.state !== 'ok') { renderCatalogMissing(body, C.state); return; }

  if (ui.q) { renderSearch(body, C); return; }
  if (!ui.cat) {
    body.innerHTML = '<ul class="cat-list">' + C.data.cats.map(c => {
      const n = (c.subs || []).reduce((a, s) => a + s.groups.reduce((b, g) => b + g.products.length, 0), 0);
      return `<li><button type="button" data-cat="${esc(c.id)}"><span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}</span><span class="cc">${n}</span>${CHEV_R}</button></li>`;
    }).join('') + '</ul>' + `<p class="cat-foot">Catálogo actualizado el ${esc(new Date(C.data.updated).toLocaleDateString('es-ES'))}</p>`;
    return;
  }
  const c = C.data.cats.find(x => String(x.id) === ui.cat);
  if (!c) { go({ cat: null }, false); return; }
  $('#catTitle').textContent = `${c.icon} ${c.name}`;
  $('#subchips').innerHTML = c.subs.map(s => `<button type="button" data-sub="${esc(s.id)}">${esc(s.name)}</button>`).join('');
  body.innerHTML = c.subs.map(s => `<section class="sub" id="sub-${esc(s.id)}"><h3>${esc(s.name)}</h3>` +
    s.groups.map(g => (s.groups.length > 1 || g.name !== s.name ? `<h4>${esc(g.name)}</h4>` : '') +
      '<ul class="plist">' + g.products.map(p => prodRow(C.byId.get(p.id) || p)).join('') + '</ul>').join('') + '</section>').join('');
  updateSteppers(findT(view(), current));
}

function prodRow(p) {
  const img = safeImg(p.t);
  return `<li class="prod" data-pid="${esc(p.id)}">
    <span class="pimg">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : catIcon(p.cn)}</span>
    <span class="pinfo"><span class="pn">${esc(p.n)}</span><span class="pp">${esc(p.p || '')}</span></span>
    <span class="pctl"></span></li>`;
}

function renderSearch(body, C) {
  const words = norm(ui.q).split(/\s+/).filter(Boolean);
  const res = C.list.filter(p => words.every(w => p.k.includes(w))).slice(0, 120);
  body.innerHTML = res.length
    ? `<p class="cat-count">${res.length === 120 ? 'Más de 120' : res.length} resultados</p><ul class="plist">${res.map(prodRow).join('')}</ul>`
    : `<div class="cat-msg">No encuentro «${esc(ui.q)}».<br>Puedes añadirlo a mano desde el <b>+</b> del ticket.</div>`;
  updateSteppers(findT(view(), current));
}

function renderCatalogMissing(body, state) {
  const actionsUrl = cfg.owner && cfg.repo ? `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/actions/workflows/catalogo.yml` : '';
  body.innerHTML = `<div class="cat-missing">
    <h3>${state === 'missing' ? 'Falta descargar el catálogo' : 'No se pudo cargar el catálogo'}</h3>
    <p>${state === 'missing' ? 'La primera vez hay que descargar todas las categorías y productos de Mercadona. Tarda unos 3 minutos y luego se actualiza solo cada semana.' : 'Revisa la conexión y vuelve a intentarlo.'}</p>
    ${mode() === 'rw' && state === 'missing' ? '<button type="button" class="primary" data-catupdate>Descargar catálogo ahora</button>' : ''}
    ${actionsUrl ? `<a class="lnk" href="${esc(actionsUrl)}" target="_blank" rel="noopener">Abrir la Action en GitHub</a>` : ''}
    ${state !== 'missing' ? '<button type="button" class="secondary" data-catretry>Reintentar</button>' : ''}
    <p class="hint">Mientras tanto puedes añadir productos a mano con el <b>+</b> del ticket.</p>
    <ul class="cat-list dim">${FALLBACK_CATS.map(n => `<li><span class="ci">${catIcon(n)}</span><span class="cn">${esc(n)}</span></li>`).join('')}</ul>
  </div>`;
}

// Actualiza solo los controles de cantidad (sin repintar la lista: no se mueve nada)
function updateSteppers(t) {
  const items = new Map((t ? t.items : []).filter(i => i.pid).map(i => [i.pid, i]));
  const ro = mode() === 'ro';
  document.querySelectorAll('#catBody .prod').forEach(li => {
    const it = items.get(li.dataset.pid);
    const ctl = li.querySelector('.pctl');
    const want = it ? 'q' + it.qty + (it.done ? 'd' : '') : (ro ? 'ro' : 'add');
    if (ctl.dataset.s === want) return;
    ctl.dataset.s = want;
    li.classList.toggle('in', !!it);
    li.classList.toggle('isdone', !!(it && it.done));
    if (it) ctl.innerHTML = `<span class="stepper"><button type="button" data-step="-1" aria-label="Quitar uno">${it.qty <= 1 && !it.fav ? '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>' : CHEV_L}</button><b>${it.qty}</b><button type="button" data-step="1" aria-label="Añadir uno">${CHEV_R}</button></span>`;
    else ctl.innerHTML = ro ? '' : `<button type="button" class="padd" data-step="1" aria-label="Añadir">${PLUS}</button>`;
  });
}

$('#catBody').addEventListener('click', e => {
  const cb = e.target.closest('[data-cat]');
  if (cb) { go({ cat: cb.dataset.cat, sub: null }); return; }
  if (e.target.closest('[data-catupdate]')) { triggerCatalogUpdate(); return; }
  if (e.target.closest('[data-catretry]')) { delete catalogs[ui.store]; loadCatalog(ui.store); return; }
  const st = e.target.closest('[data-step]');
  const li = e.target.closest('.prod');
  if (!li) return;
  const C = catalogs[ui.store]; const p = C && C.byId.get(li.dataset.pid); if (!p) return;
  const delta = st ? Number(st.dataset.step) : 1;
  if (!st && li.classList.contains('in')) return; // tocar la fila ya añadida no hace nada
  changeProduct(p, delta);
});
function ensureTicket() {
  const d = view();
  if (findT(d, current)) return current;
  if (mode() === 'ro') return null;
  const t = { id: uid('t'), name: 'Compra', place: '', note: '', store: ui.store, created: Date.now(), updated: Date.now(), items: [] };
  current = t.id;
  mutate('addTicket', t);
  toast('Nuevo ticket «Compra» creado');
  return t.id;
}
function changeProduct(p, delta) {
  const tid = ensureTicket(); if (!tid) return toast('Modo solo lectura');
  const t = findT(view(), tid);
  const iid = 'p' + p.id;
  const cur = t.items.find(i => i.id === iid);
  const q = (cur ? cur.qty : 0) + delta;
  const item = { id: iid, pid: p.id, text: p.n, qty: 1, done: false, cat: p.cat, cn: p.cn, t: safeImg(p.t) };
  buzz(delta > 0 ? 8 : 5);
  mutate('setQty', tid, iid, Math.min(99, q), item);
}
$('#subchips').addEventListener('click', e => {
  const b = e.target.closest('[data-sub]'); if (!b) return;
  const sec = document.getElementById('sub-' + b.dataset.sub);
  if (sec) { const y = sec.getBoundingClientRect().top + scrollY - (isMobile() ? 120 : 90); window.scrollTo({ top: y, behavior: 'smooth' }); }
});
$('#catBack').onclick = () => (history.state && history.state.ui && history.state.ui.cat ? history.back() : go({ cat: null }));
let searchT;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    const q = e.target.value.trim();
    const was = !!ui.q;
    ui.q = q;
    if (q && !was) history.pushState({ ui: { ...ui } }, '', location.hash || location.pathname);
    else history.replaceState({ ui: { ...ui } }, '', location.hash || location.pathname);
    renderCatalog();
    render();
  }, 140);
});
$('#bottomNav').addEventListener('click', e => {
  const b = e.target.closest('[data-pane]'); if (!b || b.dataset.pane === ui.pane) return;
  go({ pane: b.dataset.pane });
});

/* ---------------- ticket ---------------- */
let builtFor = null, lastTab = null;
function renderTicket(t, S) {
  const tk = $('#ticket');
  if (builtFor !== t.id) {
    builtFor = t.id;
    tk.innerHTML = `
      <div class="t-store"><span class="t-badge">${BADGE}</span><span class="t-sname"></span></div>
      <div class="t-head"><div>Lista de la compra</div><div data-k="place"></div><div data-k="no"></div></div>
      <div style="text-align:center"><div class="t-name" data-k="name"></div></div>
      <div class="t-date" data-k="date"></div>
      <hr class="dash">
      <ul class="items" data-k="items"></ul>
      <div class="no-items" data-k="none">Ticket vacío · elige productos en las categorías</div>
      <div class="add-own" data-k="addown"></div>
      <hr class="dash">
      <div class="row total"><span>TOTAL:</span><span data-k="total"></span></div>
      <div class="row"><span>Unidades</span><span data-k="units"></span></div>
      <div class="row"><span>Cogidos</span><span data-k="done"></span></div>
      <div class="row"><span>Fijos ⭐</span><span data-k="favs"></span></div>
      <div class="row"><span>Estado:</span><span data-k="state"></span></div>
      <div class="row"><span data-k="inv"></span><span data-k="upd"></span></div>
      <hr class="dash">
      <p class="t-note" data-k="note"></p>
      <div data-k="qr"></div>
      <a class="t-url" data-k="url"></a>
      <div class="t-credit">HECHO POR @BYALVARO__</div>`;
    t.items.forEach(i => seen.add(i.id));
    renderAddOwn(false);
  }
  const k = n => tk.querySelector(`[data-k=${n}]`);
  const s = stats(t);
  tk.querySelector('.t-sname').textContent = S.name.toUpperCase();
  $('#printerName').textContent = `${S.name} · ${t.name || 'Ticket'}`;
  k('place').textContent = t.place || 'Hecho en casa';
  k('no').textContent = 'Ticket Nº ' + ticketNo(t);
  k('name').textContent = t.name || 'Ticket';
  k('date').textContent = fDate(t.created || Date.now());
  k('total').textContent = `${s.n} ${s.n === 1 ? 'ARTÍCULO' : 'ARTÍCULOS'}`;
  k('units').textContent = String(s.units);
  k('done').textContent = `${s.done} / ${s.n}`;
  k('favs').textContent = String(t.items.filter(i => i.fav).length);
  k('state').textContent = s.complete ? 'COMPLETADO' : s.n ? 'PENDIENTE' : 'VACÍO';
  k('inv').textContent = 'INV. ' + ticketNo(t).slice(1);
  k('upd').textContent = 'ACT. ' + fTime(t.updated || t.created || Date.now());
  k('note').textContent = t.note || 'Escanea el código para abrir esta lista en cualquier dispositivo.';
  k('none').hidden = s.n > 0;
  k('addown').hidden = mode() === 'ro';
  const url = ticketUrl(t);
  if (k('qr').dataset.u !== url) { k('qr').innerHTML = qrSvg(url); k('qr').dataset.u = url; }
  k('url').textContent = url.replace(/^https?:\/\//, ''); k('url').href = url;

  // productos agrupados (actualización por claves: no se mueve ni parpadea nada)
  const ul = k('items');
  const old = new Map([...ul.children].map(n => [n.dataset.key, n]));
  const want = [];
  groupItems(t).forEach(g => {
    const hk = 'h:' + g.key;
    let h = old.get(hk);
    if (!h) { h = el('li', 'grp' + (g.fav ? ' fav' : '')); h.dataset.key = hk; h.innerHTML = '<span class="gi"></span><span class="gn"></span>'; }
    h.querySelector('.gi').textContent = g.icon; h.querySelector('.gn').textContent = g.name.toUpperCase();
    want.push(h); old.delete(hk);
    g.items.forEach(it => {
      let li = old.get(it.id);
      if (!li) {
        li = el('li', 'item'); li.dataset.key = it.id; li.dataset.id = it.id; li.tabIndex = 0;
        li.setAttribute('role', 'checkbox');
        li.innerHTML = `<button type="button" class="ph" aria-label="Fijar producto"></button><span class="txt"><span class="tl"></span></span><button type="button" class="qty" aria-label="Cambiar cantidad"></button><button class="del" type="button" aria-label="Borrar producto">${XSVG}</button>`;
        if (!seen.has(it.id)) { li.classList.add('new'); li.addEventListener('animationend', () => li.classList.remove('new'), { once: true }); }
        seen.add(it.id);
      }
      old.delete(it.id);
      const ph = li.querySelector('.ph');
      const img = safeImg(it.t);
      const phKey = (img || '') + '|' + (it.cn || '');
      if (ph.dataset.k !== phKey) { ph.dataset.k = phKey; ph.innerHTML = img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${it.cn ? catIcon(it.cn) : '📝'}</span>`; }
      ph.classList.toggle('fav', !!it.fav);
      ph.setAttribute('aria-pressed', !!it.fav);
      const tx = li.querySelector('.tl'); if (tx.textContent !== it.text) tx.textContent = it.text;
      const qb = li.querySelector('.qty'); const qv = 'x ' + (it.qty || 1); if (qb.textContent !== qv) qb.textContent = qv;
      if (li.classList.contains('done') !== !!it.done) { li.classList.toggle('done', !!it.done); li.setAttribute('aria-checked', !!it.done); }
      li.classList.toggle('isfav', !!it.fav);
      li.querySelector('.del').hidden = mode() === 'ro';
      want.push(li);
    });
  });
  old.forEach(n => n.remove());
  want.forEach((n, i) => { if (ul.children[i] !== n) ul.insertBefore(n, ul.children[i] || null); });
}

// Botón "+" para productos propios
function renderAddOwn(open) {
  const box = $('#ticket [data-k=addown]'); if (!box) return;
  const S = STORES[ui.store] || { custom: '' };
  if (!open) {
    box.innerHTML = `<button type="button" class="own-btn">${PLUS}<span>Añadir producto ${esc(S.custom)}</span></button>`;
  } else {
    box.innerHTML = `<form class="own-form" autocomplete="off"><input type="text" maxlength="200" placeholder="Ej: 2 velas de cumpleaños" enterkeyhint="done" aria-label="Producto propio"><button type="submit" aria-label="Añadir">${PLUS}</button></form>`;
    const inp = box.querySelector('input'); inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') renderAddOwn(false); });
    inp.addEventListener('blur', () => setTimeout(() => { if (!inp.value.trim() && document.activeElement !== inp) renderAddOwn(false); }, 150));
  }
}
$('#ticket').addEventListener('submit', e => {
  if (!e.target.closest('.own-form')) return;
  e.preventDefault();
  const inp = e.target.querySelector('input');
  const items = parseItems(inp.value);
  if (!items.length || !current) return;
  mutate('addItems', current, items);
  buzz(8); inp.value = ''; inp.focus();
});

function parseItems(raw) {
  return raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
    let qty = 1, m;
    if ((m = s.match(/^(\d{1,2})\s*(?:x\s+|\s)(.+)$/i))) { qty = +m[1]; s = m[2]; }
    else if ((m = s.match(/^(.+?)\s*x\s*(\d{1,2})$/i))) { s = m[1]; qty = +m[2]; }
    s = s.trim();
    return { id: uid('i'), text: s.charAt(0).toUpperCase() + s.slice(1), qty: Math.max(1, qty), done: false };
  }).filter(i => i.text);
}

$('#ticket').addEventListener('click', e => {
  if (e.target.closest('.own-btn')) { renderAddOwn(true); return; }
  const li = e.target.closest('.item'); if (!li || li.dataset.swiped) return;
  if (mode() === 'ro') return;
  const it = findI(view(), current, li.dataset.id); if (!it) return;
  if (e.target.closest('.del')) { mutate('delItem', current, it.id); return; }
  if (e.target.closest('.ph')) { buzz(15); mutate('setFav', current, it.id, !it.fav); toast(it.fav ? 'Ya no es fijo' : '⭐ Fijo: siempre arriba y no se borra'); return; }
  if (e.target.closest('.qty')) { openQty(e.target.closest('.qty'), it); return; }
  buzz(it.done ? 6 : 12);
  mutate('setDone', current, it.id, !it.done, Date.now());
  if (!it.done) setTimeout(checkPurge, 300);
});
$('#ticket').addEventListener('keydown', e => {
  const li = e.target.closest('.item'); if (!li || e.target !== li) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); li.querySelector('.txt').click(); }
  if (e.key === 'Delete' || e.key === 'Backspace') mutate('delItem', current, li.dataset.id);
});

// Selector de cantidad dentro del ticket
let qtyFor = null, qtyTimer = null;
function openQty(btn, it) {
  const pop = $('#qtyPop');
  qtyFor = it.id;
  $('#qtyPopN').textContent = String(it.qty || 1);
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.top + scrollY - pop.offsetHeight - 8) + 'px';
  armQty();
}
function armQty() { clearTimeout(qtyTimer); qtyTimer = setTimeout(closeQty, 3500); }
function closeQty() { $('#qtyPop').hidden = true; qtyFor = null; clearTimeout(qtyTimer); }
$('#qtyPop').addEventListener('click', e => {
  const b = e.target.closest('[data-d]'); if (!b || !qtyFor) return;
  const it = findI(view(), current, qtyFor); if (!it) return closeQty();
  const q = Math.max(1, Math.min(99, (it.qty || 1) + Number(b.dataset.d)));
  $('#qtyPopN').textContent = String(q);
  if (q !== it.qty) mutate('setQty', current, it.id, q);
  armQty();
});
document.addEventListener('click', e => { if (qtyFor && !e.target.closest('#qtyPop') && !e.target.closest('.qty')) closeQty(); }, true);
window.addEventListener('scroll', () => { if (qtyFor) closeQty(); }, { passive: true });

// Deslizar a la izquierda para borrar (móvil)
{
  let sx = 0, sy = 0, li = null, dx = 0, lock = null;
  const tk = $('#ticket');
  tk.addEventListener('touchstart', e => {
    if (mode() === 'ro') return;
    li = e.target.closest('.item'); if (!li) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; lock = null; delete li.dataset.swiped;
  }, { passive: true });
  tk.addEventListener('touchmove', e => {
    if (!li) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (lock === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
    if (lock !== 'x') return;
    dx = Math.min(0, x);
    li.style.transform = `translateX(${dx}px)`;
    li.classList.toggle('swipe-del', dx < -90);
  }, { passive: true });
  tk.addEventListener('touchend', () => {
    if (!li) return;
    const target = li; li = null;
    if (lock === 'x') {
      target.dataset.swiped = '1'; setTimeout(() => delete target.dataset.swiped, 350);
      if (dx < -90) {
        buzz(20);
        target.style.transition = 'transform .2s, opacity .2s'; target.style.transform = 'translateX(-110%)'; target.style.opacity = '0';
        setTimeout(() => { target.style.cssText = ''; mutate('delItem', current, target.dataset.id); }, 180);
        return;
      }
    }
    target.style.transition = 'transform .2s'; target.style.transform = '';
    target.classList.remove('swipe-del');
    setTimeout(() => { target.style.transition = ''; }, 220);
  });
}

/* ---------------- acciones ---------------- */
function onAction(e) {
  const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  if ($('#sheet').open) $('#sheet').close();
  if (act === 'install') return doInstall();
  if (act === 'settings') return openSettings();
  const t = findT(view(), current); if (!t) return;
  if (act === 'download') downloadImage(t);
  if (act === 'link') shareLink(t);
  if (act === 'edit') openTicketDlg(t);
  if (act === 'clear') { if (!t.items.some(i => i.done)) return toast('No hay productos tachados'); mutate('clearDone', t.id); toast('Tachados quitados (los fijos se quedan)'); }
  if (act === 'delete') askConfirm(`¿Eliminar «${t.name}»?`, 'Se borrará el ticket en todos tus dispositivos, también los productos fijos.', 'Eliminar', () => { mutate('delTicket', t.id); toast('Ticket eliminado'); });
}
$('#actions').addEventListener('click', onAction);
$('#sheet').addEventListener('click', onAction);
$('#moreBtn').onclick = () => {
  const t = ui.view === 'store' ? findT(view(), current) : null, ro = mode() === 'ro';
  $('#sheetTitle').textContent = t ? t.name : 'ByTicket';
  $('#sheetSync').textContent = syncMsg || '';
  $('#sheet').querySelectorAll('[data-need=ticket]').forEach(b => b.hidden = !t);
  $('#sheet').querySelectorAll('[data-act=edit],[data-act=clear],[data-act=delete]').forEach(b => b.disabled = ro);
  $('#sheet').querySelector('[data-act=install]').hidden = !canOfferInstall();
  $('#sheet').showModal();
};

/* ---------------- diálogos ---------------- */
document.querySelectorAll('dialog [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
let editing = null;
function openTicketDlg(t) {
  editing = t ? t.id : null;
  const f = $('#ticketForm');
  $('#ticketDlgTitle').textContent = t ? 'Editar ticket' : 'Nuevo ticket';
  f.name.value = t?.name || ''; f.place.value = t?.place || ''; f.note.value = t?.note || '';
  $('#ticketDlg').showModal();
  if (!touchDev()) f.name.focus();
}
$('#emptyNew').onclick = () => openTicketDlg(null);
$('#ticketForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const data = { name: f.name.value.trim() || 'Ticket', place: f.place.value.trim(), note: f.note.value.trim() };
  if (editing) mutate('editTicket', editing, data);
  else {
    const t = { id: uid('t'), ...data, store: ui.store || 'mercadona', created: Date.now(), updated: Date.now(), items: [] };
    current = t.id; history.replaceState(history.state, '', '#' + t.id);
    mutate('addTicket', t);
  }
  $('#ticketDlg').close();
});
let confirmFn = null;
function askConfirm(title, text, okLabel, fn) {
  $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = okLabel;
  confirmFn = fn; $('#confirmDlg').showModal();
}
$('#confirmForm').addEventListener('submit', e => { e.preventDefault(); $('#confirmDlg').close(); const f = confirmFn; confirmFn = null; f && f(); });

function openSettings() {
  const f = $('#settingsForm');
  f.owner.value = cfg.owner || ''; f.repo.value = cfg.repo || ''; f.branch.value = cfg.branch || 'datos'; f.token.value = cfg.token || '';
  const ad = String(view().settings.autodel);
  f.autodel.value = [...f.autodel.options].some(o => o.value === ad) ? ad : '24';
  f.autodel.disabled = mode() === 'ro';
  $('#testMsg').textContent = ''; $('#testMsg').className = 'test';
  const C = catalogs.mercadona;
  $('#catInfo').textContent = C && C.state === 'ok' ? `${C.list.length} productos · actualizado el ${new Date(C.data.updated).toLocaleString('es-ES')}. Se actualiza solo cada lunes.` : 'Aún no se ha descargado. Se descarga con la GitHub Action «Actualizar catálogo de Mercadona».';
  $('#catUpdateBtn').disabled = mode() !== 'rw';
  $('#settingsDlg').showModal();
}
$('#settingsBtn').onclick = openSettings;
$('#syncBtn').onclick = () => { if (mode() === 'local') openSettings(); else { pending.length ? flush() : pull(false); toast(syncMsg || 'Sincronizando…'); } };
$('#forgetBtn').onclick = () => { $('#settingsForm').token.value = ''; };
$('#catUpdateBtn').onclick = triggerCatalogUpdate;
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = $('#testMsg');
  const newAd = Number(f.autodel.value);
  if (mode() !== 'ro' && newAd !== Number(view().settings.autodel)) { mutate('setSetting', 'autodel', newAd); setTimeout(checkPurge, 200); }
  const wasLocal = mode() === 'local';
  const localDoc = wasLocal ? clone(remote) : null;
  const nc = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'datos', token: f.token.value.trim() };
  const changed = JSON.stringify(nc) !== JSON.stringify({ owner: cfg.owner || '', repo: cfg.repo || '', branch: cfg.branch || 'datos', token: cfg.token || '' });
  if (!changed) { $('#settingsDlg').close(); toast('Ajustes guardados'); return; }
  cfg = nc; LS.set('ts.cfg', cfg);
  if (mode() === 'local') { $('#settingsDlg').close(); render(); return; }
  msg.className = 'test'; msg.textContent = 'Conectando…';
  try {
    const res = await fetchRemote(false);
    remote = res.doc; sha = res.sha; etag = res.etag; loaded = true; saveCache();
    pending = LS.get(pendKey(), []);
    msg.className = 'test ok'; msg.textContent = mode() === 'rw' ? 'Conectado. Ya puedes editar desde este dispositivo.' : 'Conectado en modo solo lectura.';
    setSync(mode() === 'rw' ? 'ok' : 'ro');
    if (wasLocal && localDoc.tickets.length && mode() === 'rw') {
      setTimeout(() => askConfirm(`¿Subir ${localDoc.tickets.length} ticket(s)?`, 'Tienes tickets guardados solo en este dispositivo. Se añadirán a tu GitHub.', 'Subir', () => localDoc.tickets.forEach(t => mutate('addTicket', t))), 950);
    }
    if (pending.length) flush();
    startPolling(); render();
    setTimeout(() => $('#settingsDlg').open && $('#settingsDlg').close(), 900);
  } catch (err) { msg.className = 'test err'; msg.textContent = err.message; setSync(err.offline ? 'off' : 'err', err.message); }
});

async function triggerCatalogUpdate() {
  if (mode() !== 'rw') return toast('Necesitas el token para lanzar la actualización');
  try {
    const repo = await gh(repoPath()); if (!repo.ok) throw new Error(errText(repo));
    const def = (await repo.json()).default_branch;
    const r = await gh(`${repoPath()}/actions/workflows/catalogo.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: def }) });
    if (r.status === 204) toast('Descargando catálogo en GitHub… en unos 3-5 minutos recarga la app');
    else if (r.status === 403 || r.status === 404) toast('El token necesita el permiso «Actions: Read and write» (o lánzalo desde GitHub → Actions)');
    else toast(errText(r));
  } catch (e) { toast(e.message); }
}

/* ---------------- estado de sincronización ---------------- */
let syncMsg = '';
function setSync(s, detail) {
  const map = { ok: 'Sincronizado', busy: 'Guardando…', err: 'Error', ro: 'Solo lectura', local: 'Solo este dispositivo', off: 'Sin conexión' };
  const btn = $('#syncBtn');
  btn.dataset.s = s === 'local' ? '' : s;
  $('#syncText').textContent = map[s] || s;
  syncMsg = detail || (s === 'off' ? 'Sin conexión: los cambios se guardan aquí y se subirán al volver' : map[s]);
  btn.title = syncMsg;
  $('#led').className = 'led' + (s === 'busy' ? ' busy' : s === 'err' || s === 'ro' || s === 'off' ? ' off' : '');
  $('#printerLabel').textContent = s === 'err' ? 'Error · reintentando' : s === 'off' ? 'Sin conexión · se guarda aquí' : s === 'ro' ? 'Solo lectura' : s === 'busy' ? 'Imprimiendo…' : 'Lista de la compra';
  if (s === 'err' && detail) toast(detail);
}

/* ---------------- instalar como app ---------------- */
let deferredPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);
const canOfferInstall = () => !standalone() && (deferredPrompt || isIOS() || isAndroid());
function updateInstallBtn() { $('#installBtn').hidden = !canOfferInstall(); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; updateInstallBtn(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; LS.set('ts.noInstallHint', 1); updateInstallBtn(); toast('¡Instalada! Ya la tienes en tu pantalla de inicio'); });
async function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null; updateInstallBtn();
    if (r && r.outcome === 'accepted') LS.set('ts.noInstallHint', 1);
    return;
  }
  const ios = isIOS();
  $('#installIOS').hidden = !ios; $('#installAndroid').hidden = ios;
  $('#installDlg').showModal();
}
$('#installBtn').onclick = doInstall;
updateInstallBtn();
setTimeout(() => { if (canOfferInstall() && touchDev() && !LS.get('ts.noInstallHint', 0)) { LS.set('ts.noInstallHint', 1); toast('Puedes instalarla como app desde el menú ⋯'); } }, 2500);

/* ---------------- utilidades ---------------- */
let toastT;
function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Enlace copiado'); }
  catch { const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast('Enlace copiado'); } catch { toast(text); } ta.remove(); }
}
async function shareLink(t) {
  const url = ticketUrl(t);
  if (touchDev() && navigator.share) { try { await navigator.share({ title: t.name, text: 'Lista de la compra: ' + t.name, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url);
}

/* ---------------- imagen del ticket ---------------- */
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.referrerPolicy = 'no-referrer'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(null), 6000); });
async function downloadImage(t) {
  toast('Imprimiendo imagen…');
  try { await Promise.all(['500 15px "IBM Plex Mono"', '600 15px "IBM Plex Mono"', '850 30px "Archivo"'].map(f => document.fonts.load(f))); } catch {}
  const S = STORES[t.store] || STORES.mercadona;
  const badge = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(BADGE.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" color="${S.color}" `)));
  const imgs = new Map(await Promise.all(t.items.map(async i => [i.id, await loadImg(safeImg(i.t))])));
  let canvas = drawTicket(t, S, badge, imgs);
  let blob = await new Promise(r => { try { canvas.toBlob(r, 'image/png'); } catch { r(null); } });
  if (!blob) { canvas = drawTicket(t, S, badge, new Map()); blob = await new Promise(r => canvas.toBlob(r, 'image/png')); } // si alguna foto no deja exportar
  const name = 'ticket-' + norm(S.name + '-' + (t.name || 'compra')).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  const file = new File([blob], name, { type: 'image/png' });
  if (touchDev() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Imagen descargada');
}

function drawTicket(t, S, badge, imgs, exactH) {
  const SC = 2, PW = 460, M = 46, PADX = 30, W = PW + M * 2;
  const mono = (w, s) => `${w} ${s}px "IBM Plex Mono", ui-monospace, monospace`;
  const meas = document.createElement('canvas').getContext('2d');
  const wrap = (text, font, max) => {
    meas.font = font; const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const test = line ? line + ' ' + w : w; if (meas.measureText(test).width <= max || !line) line = test; else { lines.push(line); line = w; } }
    if (line) lines.push(line);
    return lines.flatMap(l => { if (meas.measureText(l).width <= max) return [l]; const out = []; let cur = ''; for (const ch of l) { if (meas.measureText(cur + ch).width > max) { out.push(cur); cur = ch; } else cur += ch; } return cur ? [...out, cur] : out; });
  };
  const s = stats(t), inner = PW - PADX * 2, PH = 34, qtyW = 46, txtX = PH + 12, txtW = inner - txtX - qtyW - 8;
  const groups = groupItems(t);
  let nameSize = 32, nameLines;
  const nameFont = sz => `850 ${sz}px "Archivo", system-ui, sans-serif`;
  do { nameLines = wrap((t.name || 'Ticket').toUpperCase(), nameFont(nameSize), inner - 60); nameSize -= 2; } while (nameLines.length > 1 && nameSize > 20);
  nameSize += 2;
  const noteLines = wrap(t.note || 'Escanea el código para abrir esta lista en cualquier dispositivo.', mono(400, 13.5), inner - 10);
  const url = ticketUrl(t), urlLines = wrap(url.replace(/^https?:\/\//, ''), mono(400, 11), inner);
  const qr = qrMatrix(url), QR = 120;
  const nameH = nameLines.length * nameSize * 1.1 + 26;
  const H_paper = exactH || 3000 + t.items.length * 80;
  const H = H_paper + M * 2;
  const c = document.createElement('canvas'); c.width = W * SC; c.height = H * SC;
  const g = c.getContext('2d'); g.scale(SC, SC);
  try { g.fontStretch = 'semi-condensed'; } catch {}
  const bg = g.createRadialGradient(W / 2, 0, 40, W / 2, H * .4, H);
  bg.addColorStop(0, '#f0ecee'); bg.addColorStop(1, '#d8d1d6');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const x0 = M, y0 = M, x1 = M + PW, y1 = M + H_paper, tooth = 12, th = 7;
  g.beginPath(); g.moveTo(x0, y0 + th);
  for (let x = x0; x < x1; x += tooth) { g.lineTo(x + tooth / 2, y0); g.lineTo(Math.min(x + tooth, x1), y0 + th); }
  g.lineTo(x1, y1 - th);
  for (let x = x1; x > x0; x -= tooth) { g.lineTo(x - tooth / 2, y1); g.lineTo(Math.max(x - tooth, x0), y1 - th); }
  g.closePath();
  g.save(); g.shadowColor = 'rgba(40,20,40,.28)'; g.shadowBlur = 26; g.shadowOffsetY = 10; g.fillStyle = '#fdfdfb'; g.fill(); g.restore();
  const L = x0 + PADX, R = x1 - PADX, CX = W / 2;
  let y = y0 + 34;
  const text = (str, x, yy, font, color = '#1b1b1b', align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(str, x, yy); };
  const dash = (col = '#c4c0c0') => { y += 14; g.save(); g.strokeStyle = col; g.lineWidth = 2; g.setLineDash([7, 6]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.restore(); y += 20; };
  const rrect = (x, yy, w, h, r) => { g.beginPath(); g.moveTo(x + r, yy); g.arcTo(x + w, yy, x + w, yy + h, r); g.arcTo(x + w, yy + h, x, yy + h, r); g.arcTo(x, yy + h, x, yy, r); g.arcTo(x, yy, x + w, yy, r); g.closePath(); };

  // cabecera del comercio
  g.font = `900 26px "Archivo", system-ui, sans-serif`;
  const sn = S.name.toUpperCase(), snW = g.measureText(sn).width, bw0 = 36, gap = 10, tot = bw0 + gap + snW;
  if (badge) g.drawImage(badge, CX - tot / 2, y - 27, bw0, bw0);
  text(sn, CX - tot / 2 + bw0 + gap, y, `900 26px "Archivo", system-ui, sans-serif`, S.color);
  y += 30;
  ['LISTA DE LA COMPRA', (t.place || 'Hecho en casa').toUpperCase(), 'TICKET Nº ' + ticketNo(t)].forEach(l => { text(l, CX, y, mono(400, 13), '#333', 'center'); y += 19; });
  y += 14;
  g.font = nameFont(nameSize);
  const bw = Math.min(inner, Math.max(...nameLines.map(l => g.measureText(l).width)) + 44), bx = CX - bw / 2, by = y;
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 2; g.strokeRect(bx, by, bw, nameH - 8); g.lineWidth = 1; g.strokeRect(bx - 4, by - 4, bw + 8, nameH);
  nameLines.forEach((l, i) => text(l, CX, by + 13 + nameSize * .86 + i * nameSize * 1.1, nameFont(nameSize), '#1b1b1b', 'center'));
  y += nameH + 18;
  text(fDate(t.created || Date.now()), CX, y, mono(500, 14), '#1b1b1b', 'center');
  y += 10; dash(S.color);

  if (!t.items.length) { text('Ticket vacío', CX, y + 10, mono(400, 13.5), '#8a8686', 'center'); y += 30; }
  groups.forEach((gr, gi) => {
    if (gi) y += 6;
    const gc = gr.fav ? '#a87b00' : S.color;
    text(`${gr.icon} ${gr.name.toUpperCase()}`, L, y + 6, mono(600, 11.5), gc);
    y += 22;
    gr.items.forEach(it => {
      const lines = wrap(it.text, mono(500, 15), txtW), col = it.done ? '#c1121f' : '#1b1b1b';
      const h = Math.max(PH, lines.length * 21) + 10, top = y;
      // foto (marco dorado si es fijo)
      const py = top + (h - 10 - PH) / 2;
      g.save(); rrect(L, py, PH, PH, 7); g.fillStyle = '#f3f1ef'; g.fill(); g.clip();
      const im = imgs.get(it.id);
      if (im) g.drawImage(im, L, py, PH, PH); else { g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText(it.cn ? catIcon(it.cn) : '📝', L + PH / 2, py + PH / 2 + 7); }
      g.restore();
      if (it.fav) { g.save(); rrect(L - 2, py - 2, PH + 4, PH + 4, 8); g.strokeStyle = '#d4a017'; g.lineWidth = 3; g.stroke(); g.restore(); text('★', L + PH - 2, py + 9, '700 12px sans-serif', '#d4a017'); }
      const ty = top + (h - 10) / 2 - (lines.length - 1) * 10.5 + 5;
      lines.forEach((l, i) => text(l, L + txtX, ty + i * 21, mono(500, 15), col));
      text('x ' + (it.qty || 1), R, ty, mono(500, 15), col, 'right');
      if (it.done) {
        g.save(); g.strokeStyle = '#e5383b'; g.lineWidth = 2.8; g.lineCap = 'round';
        lines.forEach((l, i) => { g.font = mono(500, 15); const my = ty - 5 + i * 21, ex = i ? L + txtX + g.measureText(l).width + 4 : R + 2; g.beginPath(); g.moveTo(L + txtX - 4, my + 1); g.lineTo(ex, my - 1); g.stroke(); });
        g.restore();
      }
      y += h;
    });
  });
  dash(S.color);
  const row = (a, b, bold) => { text(a, L, y, mono(bold ? 600 : 400, bold ? 15 : 14), bold ? S.color : '#1b1b1b'); text(b, R, y, mono(bold ? 600 : 400, bold ? 15 : 14), '#1b1b1b', 'right'); y += 24; };
  row('TOTAL:', `${s.n} ${s.n === 1 ? 'ARTÍCULO' : 'ARTÍCULOS'}`, true);
  row('Unidades', String(s.units));
  row('Cogidos', `${s.done} / ${s.n}`);
  row('Fijos ⭐', String(t.items.filter(i => i.fav).length));
  row('Estado:', s.complete ? 'COMPLETADO' : s.n ? 'PENDIENTE' : 'VACÍO');
  row('INV. ' + ticketNo(t).slice(1), 'ACT. ' + fTime(t.updated || t.created || Date.now()));
  y -= 10; dash(S.color);
  noteLines.forEach(l => { text(l, CX, y + 4, mono(400, 13.5), '#333', 'center'); y += 20; });
  y += 10;
  if (qr) { const n = qr.length, cell = QR / n, qx = CX - QR / 2; g.fillStyle = '#111'; qr.forEach((r, yy) => r.forEach((on, xx) => { if (on) g.fillRect(qx + xx * cell, y + yy * cell, cell + .3, cell + .3); })); y += QR + 22; }
  urlLines.forEach(l => { text(l, CX, y, mono(400, 11), '#777', 'center'); y += 15; });
  y += 12;
  g.save(); try { g.letterSpacing = '2px'; } catch {}
  text('HECHO POR @BYALVARO__', CX, y, mono(500, 11), '#999', 'center');
  g.restore();
  const used = y + 28 - y0;
  return exactH ? c : drawTicket(t, S, badge, imgs, Math.ceil(used));
}

/* ---------------- arranque ---------------- */
function openFromHash() {
  const id = location.hash.slice(1);
  const t = id && findT(view(), id);
  if (t) { current = id; if (ui.view !== 'store' || ui.store !== t.store) { ui.view = 'store'; ui.store = t.store; ui.pane = 'ticket'; loadCatalog(t.store); history.replaceState({ ui: { ...ui } }, '', '#' + id); } render(); renderCatalog(); return true; }
  return false;
}
window.addEventListener('hashchange', openFromHash);

history.replaceState({ ui: { ...ui } }, '', location.pathname + location.search + location.hash);
if (mode() === 'local') {
  remote = normalizeDoc(LS.get('ts.local', emptyDoc()));
  loaded = true; setSync('local'); render(); openFromHash(); checkPurge();
} else {
  const cached = LS.get(cacheKey(), null);
  if (cached && cached.doc) { remote = normalizeDoc(cached.doc); sha = cached.sha || null; loaded = true; }
  pending = LS.get(pendKey(), []); if (!Array.isArray(pending)) pending = [];
  setSync('busy'); $('#syncText').textContent = 'Cargando…';
  render(); openFromHash();
  const want = location.hash.slice(1);
  pull(false).then(() => { if (want) openFromHash(); });
  startPolling();
}

/* ---------------- service worker ---------------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Nueva versión disponible: cierra y vuelve a abrir la app'); });
    });
  }).catch(() => {});
}
}
