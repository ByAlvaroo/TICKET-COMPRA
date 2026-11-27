// Descarga TODAS las categorías y productos de Mercadona (tienda.mercadona.es)
// y los guarda en catalog/mercadona.json para ByTicket.
// Lo ejecuta la GitHub Action .github/workflows/catalogo.yml
// HECHO POR @BYALVARO__
import { writeFile, mkdir } from 'node:fs/promises';

const WH = process.env.MERCADONA_WH || 'vlc1';          // almacén (vlc1, mad1, bcn1…)
const API = process.env.MERCADONA_API || 'https://tienda.mercadona.es/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, tries = 4) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}lang=es&wh=${WH}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'ByTicket catalog updater (personal shopping list)' } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      console.warn(`  ${r.status} en ${path} (intento ${i})`);
    } catch (e) { console.warn(`  error de red en ${path} (intento ${i}): ${e.message}`); }
    await sleep(1500 * i);
  }
  throw new Error('No se pudo descargar ' + path);
}

const thumb = t => typeof t === 'string' ? t.replace(/([?&])(h|w)=\d+/g, '$1$2=200') : '';
const prod = p => ({
  id: String(p.id),
  n: (p.display_name || p.name || '').trim(),
  p: (p.packaging || '').trim(),
  t: thumb(p.thumbnail || (p.photos && p.photos[0] && p.photos[0].thumbnail))
});

const root = await get('/categories/');
const tops = (root.results || root.categories || []).filter(c => c.published !== false);
const out = { store: 'mercadona', wh: WH, updated: new Date().toISOString(), cats: [] };
let total = 0;

for (const top of tops) {
  console.log(`${top.name}`);
  const cat = { id: String(top.id), name: top.name, subs: [] };
  for (const sub of (top.categories || []).filter(c => c.published !== false)) {
    await sleep(Number(process.env.SLEEP ?? 250));
    const det = await get(`/categories/${sub.id}/`);
    if (!det) continue;
    const groups = [];
    const seen = new Set();
    const addGroup = (name, products) => {
      const list = (products || []).filter(p => p.published !== false).map(prod).filter(p => p.n && !seen.has(p.id));
      list.forEach(p => seen.add(p.id));
      if (list.length) groups.push({ name, products: list });
    };
    if (Array.isArray(det.categories)) det.categories.forEach(g => addGroup(g.name, g.products));
    if (Array.isArray(det.products)) addGroup(det.name || sub.name, det.products);
    const n = groups.reduce((a, g) => a + g.products.length, 0);
    total += n;
    console.log(`  · ${sub.name}: ${n}`);
    if (n) cat.subs.push({ id: String(sub.id), name: sub.name, groups });
  }
  if (cat.subs.length) out.cats.push(cat);
}

if (total < 100) throw new Error(`Solo se han encontrado ${total} productos; no se guarda para no romper el catálogo.`);
await mkdir('catalog', { recursive: true });
await writeFile('catalog/mercadona.json', JSON.stringify(out));
console.log(`\nListo: ${out.cats.length} categorías, ${total} productos.`);
