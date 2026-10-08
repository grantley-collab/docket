// Offline test using fake records shaped like the scrapers' documented output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalise, parseMeasure, packCount, pickBest, discover, buildPrices, findAlerts } from './lib.mjs';

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const raw = {
  coles: [
    { id: 8150288, name: 'Full Cream Milk', brand: 'Coles', size: '2L', price: 3.1, price_was: null, on_special: false, unit_price: 1.55, unit_of_measure: 'l', unit_quantity: 1, availability: true, image_url: 'https://productimages.coles.com.au/productimages/8/8150288.jpg', url: 'https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288' },
    { id: 1, name: 'Chocolate Milk', brand: 'Coles', size: '1L', price: 2, on_special: false, unit_price: 2, unit_of_measure: 'l', unit_quantity: 1, availability: true, url: 'https://www.coles.com.au/product/x-1' },
    { id: 2, name: 'Butter Salted', brand: 'Coles', size: '500g', price: 7.5, price_was: 9, on_special: true, unit_price: 1.5, unit_of_measure: 'g', unit_quantity: 100, availability: true, url: 'https://www.coles.com.au/product/butter-2' },
  ],
  woolworths: [
    { retailer: 'woolworths', productId: '44528', name: 'Full Cream Milk 2L', brand: 'Woolworths', size: '2L', price: 3.1, unitPrice: 1.55, unitPriceUnit: '1L', special: null, availability: 'in_stock', productUrl: 'https://www.woolworths.com.au/shop/productdetails/44528/x' },
    { retailer: 'woolworths', productId: '777', name: 'Salted Butter', brand: 'Western Star', size: '500g', price: 5, unitPrice: 1, unitPriceUnit: '100g', special: { label: 'Special', wasPrice: 7.5, saving: 2.5 }, availability: 'in_stock', productUrl: 'https://www.woolworths.com.au/shop/productdetails/777/y' },
  ],
  aldi: [
    { retailer: 'aldi', productId: '000398691', name: 'Full Cream Milk 2L', brand: 'Farmdale', size: '2L', price: 2.55, unitPrice: 1.28, unitPriceUnit: '1L', special: null, productUrl: 'https://www.aldi.com.au/product/farmdale-full-cream-milk-2l-000398691' },
    { retailer: 'aldi', productId: '555', name: 'Butter 500g', brand: 'Emporium', size: '500g', price: 4.99, unitPrice: 1, unitPriceUnit: '100g', special: { label: 'Super Savers' }, productUrl: 'https://www.aldi.com.au/product/emporium-butter-555' },
  ],
  costco: [
    { code: '1001', name: 'Full Cream Milk 6 x 1L', brand: 'Kirkland Signature', price: 7.49, unitPrice: 1.25, unitMeasure: '1L', isOnSpecial: false, stockStatus: 'inStock', images: ['https://www.costco.com.au/medias/m.jpg'], url: 'https://www.costco.com.au/dairy/milk/p/1001' },
    { code: '1002', name: 'Butter', brand: 'Kirkland Signature', price: null, priceHidden: true, url: 'https://www.costco.com.au/p/1002' },
  ],
};
const pools = Object.fromEntries(Object.entries(raw).map(([s, rs]) => [s, rs.map(r => normalise(s, r)).filter(Boolean)]));

// parsing
assert.deepEqual(parseMeasure('1.2kg'), { qty: 1.2, base: 'kg' });
assert.equal(parseMeasure('500g').qty, 0.5);
assert.equal(packCount('4 x 500g'), 4);
assert.equal(packCount('30 rolls'), 30);
assert.equal(pools.costco.length, 1);                 // hidden-price butter is dropped

// discovery
const { matches, report } = discover(catalog, pools);
console.log(report.filter(l => /^(Full cream milk|Butter)/.test(l)).join('\n'));
assert.equal(matches.milk.coles.qty, 2);
assert.equal(matches.milk.costco.qty, 6);             // 6 x 1L
assert.equal(matches.milk.coles.name.includes('Chocolate'), false);
assert.equal(matches.butter.aldi.qty, 0.5);
assert.equal(matches.butter.costco, undefined);

// problems seen in the first real run
const cat=id=>catalog.find(p=>p.id===id);
const mk=(store,r)=>normalise(store,r);
// Aldi sells chicken "per kg": price is already per kg, so 1 unit, not the 1.38kg pack weight
const aldiChicken=mk('aldi',{retailer:'aldi',productId:'1',name:'RSPCA Approved Chicken Breast Fillets Bulk Pack per kg',brand:'Broad Oak',size:'1.38 kg',price:10.99,unitPrice:10.99,unitPriceUnit:'1kg',productUrl:'https://aldi/c'});
assert.equal(pickBest(cat('chicken'),[aldiChicken]).qty,1);
// "Sweet" corn must not match Weet-Bix; pasta must not either
assert.equal(pickBest(cat('weet'),[mk('aldi',{retailer:'aldi',productId:'2',name:'Peas, Carrots & Super Sweet Corn',brand:'Market Fare',size:'1kg',price:3.59,unitPrice:3.59,unitPriceUnit:'1kg',productUrl:'u'})]),null);
assert.ok(pickBest(cat('weet'),[mk('woolworths',{retailer:'woolworths',productId:'3',name:'Weet-Bix Breakfast Cereal 1.2kg',brand:'Sanitarium',size:'1.2kg',price:7,unitPrice:5.83,unitPriceUnit:'1kg',productUrl:'u'})]));
// potatoes with herb butter are not butter; 5kg rice is too big when you need 1kg; $150 olive oil is ignored
assert.equal(pickBest(cat('butter'),[mk('coles',{id:9,name:'Parmentier Potatoes With Herb Butter',brand:'Coles Finest',size:'500g',price:5,unit_price:1,unit_of_measure:'g',unit_quantity:100,availability:true,url:'u'})]),null);
assert.equal(pickBest(cat('rice'),[mk('coles',{id:8,name:'Everyday Gold Basmati Rice',brand:'Daawat',size:'5kg',price:12.5,unit_price:2.5,unit_of_measure:'kg',unit_quantity:1,availability:true,url:'u'})]),null);
assert.equal(pickBest(cat('oil'),[mk('costco',{code:'7',name:'Extra Virgin Olive Oil 1.75L',brand:'Chateau',price:149.99,unitPrice:85.7,unitMeasure:'1L',stockStatus:'inStock',url:'u'})]),null);
assert.equal(pickBest(cat('eggs'),[mk('aldi',{retailer:'aldi',productId:'5',name:'Free-Range Eggs 12pk',brand:'Farm Fresh',size:'12 pack',price:5.49,productUrl:'u'})]).qty,12);

// daily build
const prices = buildPrices(catalog, matches, pools);
const milk = prices.find(p => p.id === 'milk'), butter = prices.find(p => p.id === 'butter');
assert.equal(milk.s[3][0], 7.49);
assert.equal(milk.img.startsWith('https://'), true);
assert.equal(butter.s[1][3], 7.5);                    // Woolworths was-price
assert.equal(butter.s[2][6], 1);                      // Aldi special without was-price

// a failed store keeps yesterday's price
const kept = buildPrices(catalog, matches, { ...pools, coles: [] }, prices, new Set(['coles']));
assert.equal(kept.find(p => p.id === 'milk').s[0][0], 3.1);

// alerts: butter is watched and on special at 3 stores; second run stays quiet
const a1 = findAlerts(catalog, prices);
console.log(a1.lines.join('\n'));
assert.equal(a1.lines.length, 3);
assert.equal(findAlerts(catalog, prices, a1.state).lines.length, 0);
console.log('\nAll tests passed');
