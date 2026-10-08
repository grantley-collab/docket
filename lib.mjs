// Pure logic: parsing sizes, normalising each store's records, matching products, building prices, alerts.
export const STORES = ['coles', 'woolworths', 'aldi', 'costco'];

const U = { g:['kg',.001], kg:['kg',1], ml:['L',.001], l:['L',1], ltr:['L',1], litre:['L',1], liter:['L',1], ea:['each',1], each:['each',1] };

/** "1.2kg" -> {qty:1.2, base:'kg'}; "500g" -> {qty:0.5, base:'kg'}; "100mL" -> {qty:0.1, base:'L'} */
export function parseMeasure(s) {
  const m = String(s ?? '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|ltr|litres?|liters?|l|ea|each)\b/);
  if (!m) return null;
  const u = U[m[2].replace(/s$/, '')];
  return u ? { qty: parseFloat(m[1]) * u[1], base: u[0] } : null;
}

/** Number of items in a pack: "12 pack", "30 rolls", "4 x 500g", "dozen" */
export function packCount(text) {
  const t = String(text ?? '').toLowerCase();
  let m = t.match(/(\d+)\s*[x×]\s*\d/);
  if (m) return +m[1];
  m = t.match(/(\d+)\s*(?:pack|pk|ct|count|rolls?|cans?|eggs?|pieces?|tins?)\b/);
  if (m) return +m[1];
  return /\bdozen\b/.test(t) ? 12 : null;
}

const r2 = n => Math.round(n * 100) / 100, r4 = n => Math.round(n * 1e4) / 1e4;

/** How much of the product's base unit (kg, L, each, roll) does this pack contain? */
export function packQty(p, rec) {
  const text = `${rec.name || ''} ${rec.size || ''}`;
  if (p.base === 'each' || p.base === 'roll') {
    const n = packCount(text);
    return n || (p.need === 1 ? 1 : null);
  }
  const mult = text.toLowerCase().match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\b)/);
  if (mult) { const one = parseMeasure(mult[2]); if (one && one.base === p.base) return r4(+mult[1] * one.qty); }
  for (const s of [rec.size, rec.name]) {
    const m = parseMeasure(s);
    if (m && m.base === p.base) return r4(m.qty);
  }
  if (rec.unit && rec.unit.base === p.base && rec.unit.price > 0) return r4(rec.price / rec.unit.price * rec.unit.qty);
  return null;
}

const num = v => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);
const unitOf = (unitPrice, unitStr) => {
  const up = num(unitPrice), m = parseMeasure(unitStr);
  return up > 0 && m ? { price: up, ...m } : null;
};
const fullName = (brand, name) => {
  name = String(name || '').trim(); brand = String(brand || '').trim();
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
};

/** Turn one raw record from any of the three scrapers into a common shape (or null if unusable). */
export function normalise(store, r) {
  let o;
  if (store === 'coles') {
    o = { id: r.id, name: fullName(r.brand, r.name), size: r.size, price: num(r.price), was: num(r.price_was),
      special: !!r.on_special, url: r.url, image: r.image_url || r.image_urls?.[0],
      unit: unitOf(r.unit_price, `${r.unit_quantity || 1}${r.unit_of_measure || ''}`), ok: r.availability !== false };
  } else if (store === 'woolworths' || store === 'aldi') {
    o = { id: r.productId, name: fullName(r.brand, r.name), size: r.size, price: num(r.price), was: num(r.special?.wasPrice),
      special: !!r.special, url: r.productUrl, image: r.image || r.imageUrl || r.imageUrls?.[0] ||
        (store === 'woolworths' && r.productId ? `https://cdn0.woolworths.media/content/wowproductimages/large/${r.productId}.jpg` : null),
      unit: unitOf(r.unitPrice, r.unitPriceUnit), ok: r.availability !== 'out_of_stock' };
  } else if (store === 'costco') {
    o = { id: r.code, name: fullName(r.brand, r.name), size: '', price: r.priceHidden ? null : num(r.price), was: num(r.wasPrice),
      special: !!r.isOnSpecial, url: r.url, image: r.images?.[0],
      unit: unitOf(r.unitPrice, r.unitMeasure), ok: r.stockStatus !== 'outOfStock' };
  } else return null;
  if (!o.price || o.price <= 0 || !o.ok || !o.name) return null;
  o.id = String(o.id ?? ''); o.store = store;
  if (o.was && o.was <= o.price) o.was = null;
  return o;
}

export const urlKey = u => String(u || '').split('?')[0].replace(/\/+$/, '').toLowerCase();

/** Name filter: every include word (a|b = either) present, no exclude word present. */
export function nameMatches(p, c) {
  const t = `${c.name} ${c.size || ''}`.toLowerCase();
  return (p.include || []).every(w => w.toLowerCase().split('|').some(x => t.includes(x))) &&
         !(p.exclude || []).some(w => t.includes(w.toLowerCase()));
}

/** From a pool of candidates for one store, choose the cheapest per unit that matches the product. */
export function pickBest(p, cands) {
  let best = null;
  for (const c of cands) {
    if (!nameMatches(p, c)) continue;
    const qty = packQty(p, c);
    if (!qty) continue;
    const u = c.price / qty;
    if (!best || u < best.u) best = { c, qty, u };
  }
  return best;
}

const label = (p, c, qty) => (c.size && String(c.size).trim()) || `${qty} ${p.base}`;
export const entryFor = (p, c, qty) =>
  [r2(c.price), qty, label(p, c, qty), c.was ? r2(c.was) : null, c.name, c.url || null, c.special && !c.was ? 1 : 0];

/** Discovery: pick the best match in each store, remember it in `matches` for cheap daily runs. */
export function discover(catalog, pools) {
  const matches = {}, report = [];
  for (const p of catalog) {
    matches[p.id] = {};
    for (const s of STORES) {
      const best = pickBest(p, pools[s] || []);
      if (best) matches[p.id][s] = { id: best.c.id, url: best.c.url, name: best.c.name, qty: best.qty, size: best.c.size || null, image: best.c.image || null };
      report.push(`${p.name} @ ${s}: ${best ? `${best.c.name} $${best.c.price} (${best.qty} ${p.base})` : 'no match'}`);
    }
  }
  return { matches, report };
}

/** Daily run: look up each remembered product in the fresh records and build the prices.json array. */
export function buildPrices(catalog, matches, pools, oldPrices = [], failed = new Set()) {
  const oldById = Object.fromEntries(oldPrices.map(p => [p.id, p]));
  return catalog.map(p => {
    const s = STORES.map((store, i) => {
      if (failed.has(store)) return oldById[p.id]?.s?.[i] ?? null;  // scraper failed: keep yesterday's price
      const m = matches[p.id]?.[store];
      if (!m) return null;
      const rec = (pools[store] || []).find(c => (m.url && urlKey(c.url) === urlKey(m.url)) || (m.id && c.id === String(m.id)));
      return rec ? entryFor(p, { ...rec, size: m.size ?? rec.size }, m.qty) : null;
    });
    const img = STORES.map(st => matches[p.id]?.[st]?.image).find(Boolean) || null;
    return { id: p.id, name: p.name, cat: p.cat, emoji: p.emoji, base: p.base, need: p.need, img, s };
  });
}

/** Which watched products are on special (or under target) and haven't been alerted at this price yet? */
export function findAlerts(catalog, prices, state = { alerted: {} }) {
  const alerted = { ...(state.alerted || {}) }, lines = [];
  for (const cp of catalog.filter(c => c.watch)) {
    const p = prices.find(x => x.id === cp.id); if (!p) continue;
    STORES.forEach((store, i) => {
      const e = p.s[i], key = `${p.id}|${store}`;
      if (!e) { delete alerted[key]; return; }
      const onSale = (e[3] && e[3] > e[0]) || e[6] === 1;
      const under = cp.target && e[0] / e[1] * p.need <= cp.target;
      if (onSale || under) {
        if (alerted[key] !== e[0]) {
          lines.push(`${store[0].toUpperCase() + store.slice(1)}: ${p.name} ${e[2]} $${e[0].toFixed(2)}${e[3] ? ` (was $${e[3].toFixed(2)})` : ''}`);
          alerted[key] = e[0];
        }
      } else delete alerted[key];
    });
  }
  return { lines, state: { alerted } };
}
