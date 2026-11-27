/* ByTicket — listas de la compra en forma de ticket, sincronizadas con GitHub.
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
const emptyDoc = () => ({ version: 1, tickets: [] });
const clone = o => JSON.parse(JSON.stringify(o));
const isMobile = () => matchMedia('(max-width: 600px)').matches;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

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
let remote = emptyDoc();      // última versión confirmada
let sha = null, etag = null;  // del tickets.json en GitHub
let pending = [];             // operaciones aún no guardadas ({t, a}) — se guardan en el dispositivo
let flushing = false, flushTimer = null, loaded = false, offline = false;
let current = LS.get('ts.cur', null);
const seen = new Set();       // ids de productos ya pintados (para animar solo los nuevos)

/* ---------------- operaciones (serializables, para poder guardarlas sin conexión) ---------------- */
const findT = (d, id) => d.tickets.find(t => t.id === id);
const touch = t => { if (t) t.updated = Date.now(); };
const OPS = {
  addTicket: (d, t) => { if (!findT(d, t.id)) d.tickets.push(clone(t)); },
  editTicket: (d, id, f) => { const t = findT(d, id); if (t) { Object.assign(t, f); touch(t); } },
  delTicket: (d, id) => { d.tickets = d.tickets.filter(t => t.id !== id); },
  addItems: (d, id, items) => { const t = findT(d, id); if (t) { items.forEach(i => { if (!t.items.some(x => x.id === i.id)) t.items.push(clone(i)); }); touch(t); } },
  setDone: (d, id, iid, v) => { const t = findT(d, id), i = t?.items.find(x => x.id === iid); if (i) { i.done = v; touch(t); } },
  delItem: (d, id, iid) => { const t = findT(d, id); if (t) { t.items = t.items.filter(x => x.id !== iid); touch(t); } },
  clearDone: (d, id) => { const t = findT(d, id); if (t) { t.items = t.items.filter(x => !x.done); touch(t); } }
};
const applyOp = (d, op) => { try { OPS[op.t] && OPS[op.t](d, ...op.a); } catch {} return d; };
const view = () => pending.reduce(applyOp, clone(remote));
const savePending = () => LS.set(pendKey(), pending);
const saveCache = () => LS.set(cacheKey(), { doc: remote, sha });

/* ---------------- GitHub API ---------------- */
async function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
  try {
    return await fetch('https://api.github.com' + path, { ...opts, headers, cache: 'no-store' });
  } catch {
    const e = new Error('Sin conexión: los cambios se guardan en el móvil y se subirán al volver');
    e.offline = true; throw e;
  }
}
const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
const b64enc = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

function errText(r) {
  if (r.status === 401) return 'Token no válido o caducado';
  if (r.status === 403 || r.status === 429) return 'GitHub ha limitado las peticiones; espera un poco';
  if (r.status === 404) return cfg.token ? 'No encuentro el repositorio (revisa usuario/repo y permisos del token)' : 'No encuentro el repositorio (si es privado, añade el token)';
  return 'Error de GitHub (' + r.status + ')';
}

async function fetchRemote(useEtag) {
  const r = await gh(`${repoPath()}/contents/${FILE}?ref=${encodeURIComponent(cfg.branch || 'datos')}`,
    useEtag && etag ? { headers: { 'If-None-Match': etag } } : {});
  if (r.status === 304) return null;
  if (r.status === 404) {
    const rr = await gh(repoPath());
    if (!rr.ok) throw new Error(errText(rr));
    return { doc: emptyDoc(), sha: null, etag: null };
  }
  if (!r.ok) throw new Error(errText(r));
  const j = await r.json();
  let doc;
  try { doc = JSON.parse(b64dec(j.content || '')); } catch { doc = emptyDoc(); }
  if (!doc || !Array.isArray(doc.tickets)) doc = emptyDoc();
  return { doc, sha: j.sha, etag: r.headers.get('ETag') };
}

async function ensureBranch() {
  const br = cfg.branch || 'datos';
  const r = await gh(`${repoPath()}/branches/${encodeURIComponent(br)}`);
  if (r.ok) return;
  const repo = await gh(repoPath());
  if (!repo.ok) throw new Error(errText(repo));
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
  if (mode() === 'ro') { toast('Modo solo lectura: añade tu token en Ajustes'); return; }
  pending.push({ t, a });
  render();
  if (mode() === 'local') { remote = view(); pending = []; LS.set('ts.local', remote); setSync('local'); return; }
  savePending();
  if (offline) { setSync('off'); return; }
  setSync('busy');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 500); // agrupa toques rápidos en un solo guardado
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
      const next = batch.reduce(applyOp, clone(base.doc));
      const r = await putRemote(next, base.sha);
      if (r.ok) {
        const j = await r.json();
        remote = next; sha = j.content.sha; etag = null;
        pending = pending.slice(batch.length);
        savePending(); saveCache();
        ok = true; break;
      }
      const msg = (await r.json().catch(() => ({}))).message || '';
      if ((r.status === 404 || r.status === 422) && /branch/i.test(msg)) { await ensureBranch(); continue; }
      if (r.status === 409 || r.status === 422) { base = await fetchRemote(false); continue; } // otro dispositivo guardó antes: recargo y reaplico
      throw new Error(errText(r));
    }
    if (!ok) throw new Error('No se pudo guardar; reintentando…');
    offline = false;
    setSync(pending.length ? 'busy' : 'ok');
  } catch (e) {
    wasOffline = !!e.offline; offline = wasOffline;
    setSync(wasOffline ? 'off' : 'err', e.message);
  } finally {
    flushing = false;
    render();
    if (pending.length && !wasOffline) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ok ? 300 : 8000); }
  }
}

async function pull(useEtag = true) {
  if (mode() === 'local' || flushing) return;
  try {
    const res = await fetchRemote(useEtag);
    offline = false;
    if (res) { remote = res.doc; sha = res.sha; etag = res.etag; saveCache(); }
    if (pending.length && mode() === 'rw') flush();
    else setSync(mode() === 'ro' ? 'ro' : 'ok');
  } catch (e) { offline = !!e.offline; setSync(offline ? 'off' : 'err', e.message); }
  loaded = true; render();
}

let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  if (mode() === 'local') return;
  pollTimer = setInterval(() => { if (!document.hidden && !pending.length) pull(true); }, mode() === 'rw' ? 12000 : 60000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pending.length ? flush() : pull(true); });
window.addEventListener('online', () => { offline = false; pending.length ? flush() : pull(false); });
window.addEventListener('offline', () => { if (mode() !== 'local') { offline = true; setSync('off'); } });

function parseItems(raw) {
  return raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
    let qty = 1, m;
    if ((m = s.match(/^(\d{1,3})\s*(?:x\s+|\s)(.+)$/i))) { qty = +m[1]; s = m[2]; }
    else if ((m = s.match(/^(.+?)\s*x\s*(\d{1,3})$/i))) { s = m[1]; qty = +m[2]; }
    s = s.trim();
    return { id: uid('i'), text: s.charAt(0).toUpperCase() + s.slice(1), qty: Math.max(1, qty), done: false };
  }).filter(i => i.text);
}

/* ---------------- utilidades de formato ---------------- */
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const p2 = n => String(n).padStart(2, '0');
const fDate = ts => { const d = new Date(ts); return `${DIAS[d.getDay()]}  ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fTime = ts => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hash = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const code = (i, it) => `${p2(i + 1)}-${String(hash(it.id) % 1000).padStart(3, '0')}`;
const ticketNo = t => String(hash(t.id) % 10000000).padStart(7, '0');
const baseUrl = () => location.origin + location.pathname;
const ticketUrl = t => baseUrl() + '#' + t.id;
const stats = t => {
  const n = t.items.length, done = t.items.filter(i => i.done).length;
  return { n, done, units: t.items.reduce((a, i) => a + (i.qty || 1), 0), complete: n > 0 && done === n };
};

/* ---------------- QR ---------------- */
function qrMatrix(text) { try { return window.makeQR ? window.makeQR(text) : null; } catch { return null; } }
function qrSvg(text) {
  const g = qrMatrix(text);
  if (!g) return '';
  const n = g.length, q = 2; let d = '';
  g.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg class="qr" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges" role="img" aria-label="Código QR del ticket"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

/* ---------------- render ---------------- */
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const XSVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function render() {
  const d = view();
  const tickets = d.tickets.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!findT(d, current)) current = tickets.length ? tickets[tickets.length - 1].id : null;
  LS.set('ts.cur', current);
  const m = mode();

  // pestañas
  const tabs = $('#tabs'); tabs.textContent = '';
  tickets.forEach(t => {
    const b = el('button', 'tab'); b.type = 'button';
    b.setAttribute('aria-current', t.id === current);
    b.append(el('span', '', t.name || 'Ticket'), el('b', '', String(t.items.filter(i => !i.done).length)));
    b.onclick = () => { current = t.id; history.replaceState(null, '', '#' + t.id); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    tabs.append(b);
  });
  if (m !== 'ro') {
    const nb = el('button', 'tab new'); nb.type = 'button';
    nb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    nb.append(el('span', '', 'Nuevo'));
    nb.onclick = () => openTicketDlg(null);
    tabs.append(nb);
  }
  if (lastTab !== current) {
    lastTab = current;
    const at = tabs.querySelector('[aria-current=true]');
    if (at) { const l = at.offsetLeft - 14, r = at.offsetLeft + at.offsetWidth + 14; if (l < tabs.scrollLeft) tabs.scrollLeft = l; else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth; }
  }

  // banner
  if (m === 'local') showBanner('Modo local: los tickets solo se guardan en este dispositivo. Súbelo a GitHub Pages para sincronizar.', 'Ajustes', openSettings);
  else if (m === 'ro') showBanner('Modo solo lectura. Añade tu token de GitHub para poder editar desde este dispositivo.', 'Añadir token', openSettings);
  else $('#banner').hidden = true;

  const t = findT(d, current);
  const has = !!t;
  document.body.classList.toggle('has-ticket', has);
  $('#printer').hidden = !has; $('#actions').hidden = !has;
  $('#empty').hidden = has || (!loaded && m !== 'local');
  $('#emptyNew').hidden = m === 'ro';
  $('#emptyText').textContent = m === 'ro' ? 'Cuando crees tickets desde un dispositivo con token aparecerán aquí.' : 'Crea tu primera lista de la compra.';
  $('#addInput').disabled = $('#addBtn').disabled = m === 'ro';
  $('#addInput').placeholder = m === 'ro' ? 'Solo lectura' : 'Ej: 2 leche, pan, huevos x12';
  document.querySelectorAll('#actions [data-act=edit],#actions [data-act=clear],#actions [data-act=delete]').forEach(b => b.disabled = m === 'ro');
  if (has) renderTicket(t);
}

function showBanner(text, btn, fn, closable) {
  const bn = $('#banner'); bn.hidden = false; bn.textContent = '';
  const b = el('button', '', btn); b.type = 'button'; b.onclick = fn;
  bn.append(el('span', '', text), b);
  if (closable) {
    const x = el('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Cerrar'); x.innerHTML = XSVG;
    x.onclick = () => { LS.set('ts.noInstallHint', 1); bn.hidden = true; };
    bn.append(x);
  }
}

let builtFor = null, lastTab = null;
function renderTicket(t) {
  const tk = $('#ticket');
  if (builtFor !== t.id) {
    builtFor = t.id;
    tk.innerHTML = `
      <div class="t-head"><div>Lista de la compra</div><div data-k="place"></div><div data-k="no"></div></div>
      <div style="text-align:center"><div class="t-name" data-k="name"></div></div>
      <div class="t-date" data-k="date"></div>
      <hr class="dash">
      <ul class="items" data-k="items"></ul>
      <div class="no-items" data-k="none">Ticket vacío · añade productos arriba</div>
      <hr class="dash">
      <div class="row total"><span>TOTAL:</span><span data-k="total"></span></div>
      <div class="row"><span>Unidades</span><span data-k="units"></span></div>
      <div class="row"><span>Cogidos</span><span data-k="done"></span></div>
      <div class="row"><span>Estado:</span><span data-k="state"></span></div>
      <div class="row"><span data-k="inv"></span><span data-k="upd"></span></div>
      <hr class="dash">
      <p class="t-note" data-k="note"></p>
      <div data-k="qr"></div>
      <a class="t-url" data-k="url"></a>
      <div class="t-credit">HECHO POR @BYALVARO__</div>`;
    t.items.forEach(i => seen.add(i.id)); // no animar al cambiar de ticket
  }
  const k = n => tk.querySelector(`[data-k=${n}]`);
  const s = stats(t);
  k('place').textContent = t.place || 'Hecho en casa';
  k('no').textContent = 'Ticket Nº ' + ticketNo(t);
  k('name').textContent = t.name || 'Ticket';
  k('date').textContent = fDate(t.created || Date.now());
  k('total').textContent = `${s.n} ${s.n === 1 ? 'ARTÍCULO' : 'ARTÍCULOS'}`;
  k('units').textContent = String(s.units);
  k('done').textContent = `${s.done} / ${s.n}`;
  k('state').textContent = s.complete ? 'COMPLETADO' : s.n ? 'PENDIENTE' : 'VACÍO';
  k('inv').textContent = 'INV. ' + ticketNo(t).slice(1);
  k('upd').textContent = 'ACT. ' + fTime(t.updated || t.created || Date.now());
  k('note').textContent = t.note || 'Escanea el código para abrir esta lista en cualquier dispositivo.';
  k('none').hidden = s.n > 0;
  const url = ticketUrl(t);
  if (k('qr').dataset.u !== url) { k('qr').innerHTML = qrSvg(url); k('qr').dataset.u = url; }
  k('url').textContent = url.replace(/^https?:\/\//, ''); k('url').href = url;

  // productos (actualización por claves para animar solo los nuevos)
  const ul = k('items');
  const old = new Map([...ul.children].map(li => [li.dataset.id, li]));
  t.items.forEach((it, idx) => {
    let li = old.get(it.id);
    if (!li) {
      li = el('li', 'item'); li.dataset.id = it.id; li.tabIndex = 0;
      li.setAttribute('role', 'checkbox');
      li.innerHTML = `<span class="code"></span><span class="txt"></span><span class="qty"></span><button class="del" type="button" aria-label="Borrar producto">${XSVG}</button>`;
      if (!seen.has(it.id)) { li.classList.add('new'); li.addEventListener('animationend', () => li.classList.remove('new'), { once: true }); }
      seen.add(it.id);
    }
    old.delete(it.id);
    const set = (sel, v) => { const n = li.querySelector(sel); if (n.textContent !== v) n.textContent = v; };
    set('.code', code(idx, it)); set('.txt', it.text); set('.qty', 'x ' + (it.qty || 1));
    if (li.classList.contains('done') !== !!it.done) { li.classList.toggle('done', !!it.done); li.setAttribute('aria-checked', !!it.done); }
    li.querySelector('.del').hidden = mode() === 'ro';
    if (ul.children[idx] !== li) ul.insertBefore(li, ul.children[idx] || null); // solo mueve si cambia el orden
  });
  old.forEach(li => li.remove());
}

/* ---------------- eventos del ticket ---------------- */
$('#ticket').addEventListener('click', e => {
  const li = e.target.closest('.item'); if (!li || li.dataset.swiped) return;
  if (e.target.closest('.del')) { mutate('delItem', current, li.dataset.id); return; }
  const v = !li.classList.contains('done');
  buzz(v ? 12 : 6);
  mutate('setDone', current, li.dataset.id, v);
});
$('#ticket').addEventListener('keydown', e => {
  const li = e.target.closest('.item'); if (!li || e.target !== li) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); li.click(); }
  if (e.key === 'Delete' || e.key === 'Backspace') mutate('delItem', current, li.dataset.id);
});

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
        setTimeout(() => mutate('delItem', current, target.dataset.id), 180);
        return;
      }
    }
    target.style.transition = 'transform .2s'; target.style.transform = '';
    target.classList.remove('swipe-del');
    setTimeout(() => { target.style.transition = ''; }, 220);
  });
}

$('#addForm').addEventListener('submit', e => {
  e.preventDefault();
  const inp = $('#addInput'); const items = parseItems(inp.value);
  if (!items.length || !current) return;
  mutate('addItems', current, items);
  buzz(8);
  inp.value = '';
  if (!isMobile()) inp.focus();
  requestAnimationFrame(() => $('#ticket .items').lastElementChild?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
});

function onAction(e) {
  const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  if ($('#sheet').open) $('#sheet').close();
  if (act === 'install') return doInstall();
  if (act === 'settings') return openSettings();
  if (act === 'new') return openTicketDlg(null);
  const t = findT(view(), current); if (!t) return;
  if (act === 'download') downloadImage(t);
  if (act === 'link') shareLink(t);
  if (act === 'edit') openTicketDlg(t);
  if (act === 'clear') { if (!t.items.some(i => i.done)) return toast('No hay productos tachados'); mutate('clearDone', t.id); toast('Tachados quitados'); }
  if (act === 'delete') askConfirm(`¿Eliminar «${t.name}»?`, 'Se borrará el ticket en todos tus dispositivos.', 'Eliminar', () => { mutate('delTicket', t.id); toast('Ticket eliminado'); });
}
$('#actions').addEventListener('click', onAction);
$('#sheet').addEventListener('click', onAction);
$('#moreBtn').onclick = () => {
  const t = findT(view(), current), ro = mode() === 'ro';
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
  if (!isMobile()) f.name.focus();
}
$('#emptyNew').onclick = () => openTicketDlg(null);
$('#ticketForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const data = { name: f.name.value.trim() || 'Ticket', place: f.place.value.trim(), note: f.note.value.trim() };
  if (editing) mutate('editTicket', editing, data);
  else {
    const t = { id: uid('t'), ...data, created: Date.now(), updated: Date.now(), items: [] };
    current = t.id; history.replaceState(null, '', '#' + t.id);
    mutate('addTicket', t);
    setTimeout(() => $('#addInput').focus(), 80);
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
  $('#testMsg').textContent = ''; $('#testMsg').className = 'test';
  $('#settingsDlg').showModal();
}
$('#settingsBtn').onclick = openSettings;
$('#syncBtn').onclick = () => { if (mode() === 'local') openSettings(); else { pending.length ? flush() : pull(false); toast(syncMsg || 'Sincronizando…'); } };
$('#forgetBtn').onclick = () => { $('#settingsForm').token.value = ''; };
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = $('#testMsg');
  const wasLocal = mode() === 'local';
  const localDoc = wasLocal ? clone(remote) : null;
  cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'datos', token: f.token.value.trim() };
  LS.set('ts.cfg', cfg);
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
  } catch (err) {
    msg.className = 'test err'; msg.textContent = err.message;
    setSync(err.offline ? 'off' : 'err', err.message);
  }
});

/* ---------------- estado de sincronización ---------------- */
let syncMsg = '';
function setSync(s, detail) {
  const map = { ok: 'Sincronizado', busy: 'Guardando…', err: 'Error', ro: 'Solo lectura', local: 'Solo este dispositivo', off: 'Sin conexión' };
  const btn = $('#syncBtn');
  btn.dataset.s = s === 'local' ? '' : s;
  $('#syncText').textContent = map[s] || s;
  syncMsg = detail || (s === 'off' ? 'Sin conexión: los cambios se guardan aquí y se subirán al volver' : map[s]);
  btn.title = syncMsg;
  const led = $('#led');
  led.className = 'led' + (s === 'busy' ? ' busy' : s === 'err' || s === 'ro' || s === 'off' ? ' off' : '');
  $('#printerLabel').textContent = s === 'err' ? 'Error · reintentando' : s === 'off' ? 'Sin conexión · se guarda aquí' : s === 'ro' ? 'Solo lectura' : 'Añadir producto';
  if (s === 'err' && detail) toast(detail);
}

/* ---------------- instalar como app ---------------- */
let deferredPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);
const canOfferInstall = () => !standalone() && (deferredPrompt || isIOS() || isAndroid());
const installHintVisible = () => canOfferInstall() && matchMedia('(pointer:coarse)').matches && !LS.get('ts.noInstallHint', 0);
function updateInstallBtn() { $('#installBtn').hidden = !canOfferInstall(); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; updateInstallBtn(); render(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; LS.set('ts.noInstallHint', 1); updateInstallBtn(); render(); toast('¡Instalada! Ya la tienes en tu pantalla de inicio'); });
async function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null; updateInstallBtn();
    if (r && r.outcome === 'accepted') { LS.set('ts.noInstallHint', 1); render(); }
    return;
  }
  const ios = isIOS();
  $('#installIOS').hidden = !ios; $('#installAndroid').hidden = ios;
  $('#installDlg').showModal();
}
$('#installBtn').onclick = doInstall;
updateInstallBtn();
setTimeout(() => { if (installHintVisible()) { LS.set('ts.noInstallHint', 1); toast('Puedes instalarla como app desde el menú ⋯'); } }, 2500);

/* ---------------- utilidades ---------------- */
let toastT;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Enlace copiado'); }
  catch {
    const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Enlace copiado'); } catch { toast(text); }
    ta.remove();
  }
}
async function shareLink(t) {
  const url = ticketUrl(t);
  if (matchMedia('(pointer:coarse)').matches && navigator.share) {
    try { await navigator.share({ title: t.name, text: 'Lista de la compra: ' + t.name, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copy(url);
}

/* ---------------- imagen del ticket ---------------- */
async function downloadImage(t) {
  toast('Imprimiendo imagen…');
  try { await Promise.all(['500 15px "IBM Plex Mono"', '600 15px "IBM Plex Mono"', '850 30px "Archivo"'].map(f => document.fonts.load(f))); } catch {}
  const canvas = drawTicket(t);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const name = 'ticket-' + (t.name || 'compra').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  const file = new File([blob], name, { type: 'image/png' });
  const touchDev = matchMedia('(pointer:coarse)').matches;
  if (touchDev && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t.name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Imagen descargada');
}

function drawTicket(t, exactH) {
  const S = 2, PW = 440, M = 46, PADX = 30, W = PW + M * 2;
  const mono = (w, s) => `${w} ${s}px "IBM Plex Mono", ui-monospace, monospace`;
  const meas = document.createElement('canvas').getContext('2d');
  const wrap = (text, font, max) => {
    meas.font = font; const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (meas.measureText(test).width <= max || !line) line = test; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines.flatMap(l => { // palabras larguísimas
      if (meas.measureText(l).width <= max) return [l];
      const out = []; let cur = '';
      for (const ch of l) { if (meas.measureText(cur + ch).width > max) { out.push(cur); cur = ch; } else cur += ch; }
      return cur ? [...out, cur] : out;
    });
  };
  const s = stats(t), inner = PW - PADX * 2;
  const codeW = 64, qtyW = 46, txtW = inner - codeW - qtyW - 16;
  const itemLines = t.items.map(i => wrap(i.text, mono(500, 15), txtW));

  // nombre en la caja: reduce el tamaño hasta que quepa
  let nameSize = 32, nameLines;
  const nameFont = sz => `850 ${sz}px "Archivo", system-ui, sans-serif`;
  do { nameLines = wrap((t.name || 'Ticket').toUpperCase(), nameFont(nameSize), inner - 60); nameSize -= 2; } while (nameLines.length > 1 && nameSize > 20);
  nameSize += 2;
  const noteLines = wrap(t.note || 'Escanea el código para abrir esta lista en cualquier dispositivo.', mono(400, 13.5), inner - 10);
  const url = ticketUrl(t), urlLines = wrap(url.replace(/^https?:\/\//, ''), mono(400, 11), inner);
  const qr = qrMatrix(url), QR = 120;

  const nameH = nameLines.length * nameSize * 1.1 + 26;
  const itemsH = t.items.length ? itemLines.reduce((a, l) => a + l.length * 22 + 12, 0) : 30;
  const H_paper = exactH || 40 + 3 * 19 + 14 + nameH + 18 + 24 + 34 + itemsH + 34 + 5 * 24 + 34 + noteLines.length * 20 + 14 + (qr ? QR + 10 : 0) + urlLines.length * 15 + 40 + 30;
  const H = H_paper + M * 2;

  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  const g = c.getContext('2d'); g.scale(S, S);
  try { g.fontStretch = 'semi-condensed'; } catch {}

  // fondo
  const bg = g.createRadialGradient(W / 2, 0, 40, W / 2, H * .4, H);
  bg.addColorStop(0, '#f0ecee'); bg.addColorStop(1, '#d8d1d6');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // papel con bordes de sierra arriba y abajo
  const x0 = M, y0 = M, x1 = M + PW, y1 = M + H_paper, tooth = 12, th = 7;
  g.beginPath(); g.moveTo(x0, y0 + th);
  for (let x = x0; x < x1; x += tooth) { g.lineTo(x + tooth / 2, y0); g.lineTo(Math.min(x + tooth, x1), y0 + th); }
  g.lineTo(x1, y1 - th);
  for (let x = x1; x > x0; x -= tooth) { g.lineTo(x - tooth / 2, y1); g.lineTo(Math.max(x - tooth, x0), y1 - th); }
  g.closePath();
  g.save(); g.shadowColor = 'rgba(40,20,40,.28)'; g.shadowBlur = 26; g.shadowOffsetY = 10; g.fillStyle = '#fdfdfb'; g.fill(); g.restore();

  const L = x0 + PADX, R = x1 - PADX, CX = W / 2;
  let y = y0 + 40;
  const text = (str, x, yy, font, color = '#1b1b1b', align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(str, x, yy); };
  const dash = () => { y += 14; g.save(); g.strokeStyle = '#c4c0c0'; g.lineWidth = 2; g.setLineDash([7, 6]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.restore(); y += 20; };

  ['LISTA DE LA COMPRA', (t.place || 'Hecho en casa').toUpperCase(), 'TICKET Nº ' + ticketNo(t)].forEach(l => { text(l, CX, y, mono(400, 13), '#333', 'center'); y += 19; });
  y += 14;
  // caja del nombre
  g.font = nameFont(nameSize);
  const bw = Math.min(inner, Math.max(...nameLines.map(l => g.measureText(l).width)) + 44);
  const bx = CX - bw / 2, by = y;
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 2; g.strokeRect(bx, by, bw, nameH - 8);
  g.lineWidth = 1; g.strokeRect(bx - 4, by - 4, bw + 8, nameH);
  nameLines.forEach((l, i) => text(l, CX, by + 13 + nameSize * .86 + i * nameSize * 1.1, nameFont(nameSize), '#1b1b1b', 'center'));
  y += nameH + 18;
  text(fDate(t.created || Date.now()), CX, y, mono(500, 14), '#1b1b1b', 'center');
  y += 10; dash();

  if (!t.items.length) { text('Ticket vacío', CX, y + 10, mono(400, 13.5), '#8a8686', 'center'); y += 30; }
  t.items.forEach((it, idx) => {
    const lines = itemLines[idx], col = it.done ? '#c1121f' : '#1b1b1b';
    const top = y;
    text(code(idx, it), L, y + 10, mono(400, 13), it.done ? '#c1121f' : '#666');
    lines.forEach((l, i) => text(l, L + codeW + 8, y + 10 + i * 22, mono(500, 15), col));
    text('x ' + (it.qty || 1), R, y + 10, mono(500, 15), col, 'right');
    const h = lines.length * 22;
    if (it.done) {
      g.save(); g.strokeStyle = '#e5383b'; g.lineWidth = 2.8; g.lineCap = 'round';
      lines.forEach((l, i) => {
        g.font = mono(500, 15);
        const my = top + 5 + i * 22, sx = i ? L + codeW + 4 : L - 4, ex = i ? L + codeW + 12 + g.measureText(l).width : R + 2;
        g.beginPath(); g.moveTo(sx, my + 1); g.lineTo(ex, my - 1); g.stroke();
      });
      g.restore();
    }
    y += h + 12;
  });
  dash();
  const row = (a, b, bold) => { text(a, L, y, mono(bold ? 600 : 400, bold ? 15 : 14)); text(b, R, y, mono(bold ? 600 : 400, bold ? 15 : 14), '#1b1b1b', 'right'); y += 24; };
  row('TOTAL:', `${s.n} ${s.n === 1 ? 'ARTÍCULO' : 'ARTÍCULOS'}`, true);
  row('Unidades', String(s.units));
  row('Cogidos', `${s.done} / ${s.n}`);
  row('Estado:', s.complete ? 'COMPLETADO' : s.n ? 'PENDIENTE' : 'VACÍO');
  row('INV. ' + ticketNo(t).slice(1), 'ACT. ' + fTime(t.updated || t.created || Date.now()));
  y -= 10; dash();
  noteLines.forEach(l => { text(l, CX, y + 4, mono(400, 13.5), '#333', 'center'); y += 20; });
  y += 10;
  if (qr) {
    const n = qr.length, cell = QR / n, qx = CX - QR / 2;
    g.fillStyle = '#111';
    qr.forEach((r, yy) => r.forEach((on, xx) => { if (on) g.fillRect(qx + xx * cell, y + yy * cell, cell + .3, cell + .3); }));
    y += QR + 22;
  }
  urlLines.forEach(l => { text(l, CX, y, mono(400, 11), '#777', 'center'); y += 15; });
  y += 12;
  g.save(); try { g.letterSpacing = '2px'; } catch {}
  text('HECHO POR @BYALVARO__', CX, y, mono(500, 11), '#999', 'center');
  g.restore();
  const used = y + 28 - y0;
  return exactH ? c : drawTicket(t, Math.ceil(used));
}


/* ---------------- arranque ---------------- */
function fromHash() {
  const id = location.hash.slice(1);
  if (id && findT(view(), id)) { current = id; render(); }
}
window.addEventListener('hashchange', fromHash);

const want = location.hash.slice(1);
if (mode() === 'local') {
  remote = LS.get('ts.local', emptyDoc());
  if (!Array.isArray(remote.tickets)) remote = emptyDoc();
  loaded = true; setSync('local'); render(); fromHash();
} else {
  // Muestra al instante lo último guardado en el dispositivo y luego actualiza
  const cached = LS.get(cacheKey(), null);
  if (cached && cached.doc && Array.isArray(cached.doc.tickets)) { remote = cached.doc; sha = cached.sha || null; loaded = true; }
  pending = LS.get(pendKey(), []);
  if (!Array.isArray(pending)) pending = [];
  setSync('busy'); $('#syncText').textContent = 'Cargando…';
  render(); fromHash();
  pull(false).then(() => { if (want && findT(view(), want)) { current = want; render(); } });
  startPolling();
}
// Acceso directo "Nuevo ticket" del icono de la app
if (new URLSearchParams(location.search).has('nuevo') && mode() !== 'ro') {
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => openTicketDlg(null), 300);
}

/* ---------------- service worker (app instalable y sin conexión) ---------------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Nueva versión disponible: cierra y vuelve a abrir la app');
      });
    });
  }).catch(() => {});
}
}
