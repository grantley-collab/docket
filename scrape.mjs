// Usage: node scrape.mjs            daily run (cheap: looks up the products found earlier)
//        node scrape.mjs discover   search each store and (re)pick the best matching product
import fs from 'node:fs/promises';
import { STORES, normalise, discover, buildPrices, findAlerts } from './lib.mjs';

const TOKEN = process.env.APIFY_TOKEN, NTFY = process.env.NTFY_TOPIC, APP_URL = process.env.APP_URL;
const ACTORS = {
  woolies_aldi: process.env.ACTOR_WOOLIES_ALDI || 'tildekai/au-grocery-prices',
  coles: process.env.ACTOR_COLES || 'diopside/coles-au-products',
  costco: process.env.ACTOR_COSTCO || 'abotapi/costco-au-scraper',
};
const PER_QUERY = 8;            // products kept per search while discovering
const COSTCO_DETAILS = true;    // true = brand + pictures (costs a little more)

const read = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const write = (f, v) => fs.writeFile(f, JSON.stringify(v, null, 1) + '\n');

async function api(path, init = {}) {
  const r = await fetch('https://api.apify.com/v2' + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init.headers } });
  if (!r.ok) throw new Error(`Apify ${r.status} on ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function runActor(actor, input) {
  const id = actor.replace('/', '~');
  let run = (await api(`/acts/${id}/runs`, { method: 'POST', body: JSON.stringify(input) })).data;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status))
    run = (await api(`/actor-runs/${run.id}?waitForFinish=60`)).data;
  if (run.status !== 'SUCCEEDED') throw new Error(`${actor} ${run.status}`);
  const r = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

const catalog = await read('catalog.json', []);
const oldPrices = await read('docs/prices.json', []);
let matches = await read('matches.json', null);
const doDiscover = process.argv[2] === 'discover' || !matches;
if (!TOKEN) { console.error('Set APIFY_TOKEN first (see README).'); process.exit(1); }

// What to ask each scraper
const queries = [...new Set(catalog.map(p => p.query))];
const urls = s => catalog.map(p => matches?.[p.id]?.[s]?.url).filter(Boolean);
const jobs = {
  coles: () => runActor(ACTORS.coles, doDiscover ? { searchTerms: queries, maxItemsPerQuery: PER_QUERY } : { productIds: urls('coles') }),
  woolworths_aldi: () => runActor(ACTORS.woolies_aldi, doDiscover
    ? { retailers: ['woolworths', 'aldi'], searchQueries: queries, maxItemsPerScope: PER_QUERY }
    : { products: [...urls('woolworths'), ...urls('aldi')] }),
  costco: () => runActor(ACTORS.costco, doDiscover
    ? { mode: 'search', queries, maxItems: queries.length * PER_QUERY, fetchDetails: COSTCO_DETAILS }
    : { mode: 'url', urls: urls('costco'), fetchDetails: COSTCO_DETAILS }),
};

const pools = { coles: [], woolworths: [], aldi: [], costco: [] };
const failed = new Set(), status = {};
await Promise.all(Object.entries(jobs).map(async ([name, job]) => {
  const stores = name === 'woolworths_aldi' ? ['woolworths', 'aldi'] : [name];
  if (!doDiscover && stores.every(s => urls(s).length === 0)) return;
  try {
    const items = await job();
    for (const r of items) {
      const store = name === 'woolworths_aldi' ? r.retailer : name;
      const n = pools[store] && normalise(store, r);
      if (n) pools[store].push(n);
    }
    stores.forEach(s => (status[s] = `${pools[s].length} products`));
  } catch (e) {
    console.error(`! ${name} failed: ${e.message}`);
    stores.forEach(s => { failed.add(s); status[s] = 'failed, kept old prices'; });
  }
}));

if (doDiscover) {
  const d = discover(catalog, pools);
  matches = d.matches;
  await write('matches.json', matches);
  console.log('\nMatches (check these look right, then adjust include/exclude in catalog.json):');
  console.log(d.report.join('\n'));
}

const prices = buildPrices(catalog, matches, pools, oldPrices, failed);
await fs.mkdir('docs', { recursive: true });
await write('docs/prices.json', prices);
await write('docs/meta.json', { updated: new Date().toISOString(), status });
console.log('\nStore status:', status);

// Sale alerts via ntfy
const { lines, state } = findAlerts(catalog, prices, await read('state.json', { alerted: {} }));
await write('state.json', state);
if (lines.length) {
  console.log('\nAlerts:\n' + lines.join('\n'));
  if (NTFY) {
    await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY)}`, {
      method: 'POST',
      headers: { Title: `Docket: ${lines.length} special${lines.length > 1 ? "s" : ""}`, Tags: 'shopping_cart', ...(APP_URL ? { Click: APP_URL } : {}) },
      body: lines.join('\n'),
    });
  }
}
