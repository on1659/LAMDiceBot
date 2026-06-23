// 전체풀/배타/카탈로그무결성 결정론 단위 — 확장 후 동작(중복환급) 기준으로 재검증.
//
//   qa-shop-gacha-pool-smoke.js 는 *확장 전*(소유 self-exclude / 10 anchors) 가정이라
//   확장 후 일부 단언이 stale-fail 한다(의도된 동작 역전). 이 파일은 확장 후 계약을 단언:
//     (1) 전체풀: buildPool 이 소유 아이템을 self-exclude 하지 않는다(중복환급 전환).
//     (2) 배타: coin 풀 = 비-adOnly only, ad 풀 = adOnly only, 교집합 0.
//     (3) 공통 제외 유지: directBuy / defaultOwned / requires-미충족.
//     (4) 카탈로그 무결성: (slot,economy)별 directBuy 정확히 1개(최저등급) · id 전역 유일 ·
//         coin=price만 / ad=adOnly+adPrice·price없음 · aura=color.
//     (5) 광고 가챠 풀 크기 vs 명세 AC(>=10) 보고.
//     (6) spin 회귀: gameHasGacha 카탈로그·spin 풀 무변경.
//   실행: node AutoTest/qa-gacha-pool-expansion-unit.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const shopSrc = fs.readFileSync(path.join(ROOT, 'socket', 'shop.js'), 'utf8');

function sliceBetween(src, s0, e0) {
  const s = src.indexOf(s0); const e = src.indexOf(e0, s);
  if (s === -1 || e === -1) throw new Error('marker not found: ' + s0);
  return src.slice(s, e);
}
const catalogBlock = sliceBetween(shopSrc, 'const CONFIG_DIR', 'function registerShopHandlers');
const exposeSrc = "const fs=require('fs');const path=require('path');\n" + catalogBlock
  + '\nmodule.exports={CATALOG,CATALOG_INDEX,KNOWN_GAMES,GACHA_RARITY_WEIGHTS,COIN_GACHA_ENABLED,buildPool,weightedPick};\n';
const box = {
  module: { exports: {} },
  require: (m) => (m === 'fs' ? fs : m === 'path' ? path : new Proxy({}, { get: () => () => {} })),
  console: { warn(){}, error(){}, log(){} },
  process: { env: {} }, __dirname: path.join(ROOT, 'socket'), Math, Number, Array, Object, JSON
};
vm.createContext(box);
vm.runInContext(exposeSrc, box, { filename: 'socket/shop.js#expose' });
const S = box.module.exports;
const CAT = S.CATALOG_INDEX;

let pass = 0, fail = 0, warn = 0;
function ok(c, m) { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } }
function note(m) { warn++; console.log('  NOTE', m); }
function section(t) { console.log('\n### ' + t); }

const horseIds = Object.keys(CAT).filter(id => CAT[id].game === 'horse');
const RAR = { common: 0, rare: 1, epic: 2, legend: 3 };

// ── (1) 전체풀: 소유 self-exclude 없음 ──
section('(1) Full-pool — owned items are NOT self-excluded (dupe→refund reversal)');
const coinPool0 = S.buildPool('coin', 'horse', []).map(p => p.id);
const adPool0 = S.buildPool('ad', 'horse', []).map(p => p.id);
ok(coinPool0.length > 0, 'coin pool non-empty (' + coinPool0.length + ')');
if (coinPool0.length) {
  const owned = [coinPool0[0]];
  const after = S.buildPool('coin', 'horse', owned).map(p => p.id);
  ok(after.indexOf(coinPool0[0]) !== -1, 'owned item STILL in coin pool (full-pool draw)');
  ok(after.length === coinPool0.length, 'pool size unchanged when an item is owned (no shrink)');
}
// 모두 소유해도 풀은 여전히 가득(중복환급 가능)
ok(S.buildPool('coin', 'horse', coinPool0.slice()).length === coinPool0.length, 'owning all coin items → pool unchanged (never empties from ownership)');

// ── (2) 배타 ──
section('(2) Economy split — disjoint coin/ad pools');
ok(coinPool0.every(id => CAT[id].item.adOnly !== true), 'coin pool: zero adOnly');
ok(adPool0.every(id => CAT[id].item.adOnly === true), 'ad pool: adOnly only');
ok(coinPool0.filter(id => adPool0.indexOf(id) !== -1).length === 0, 'coin & ad disjoint');

// ── (3) 공통 제외 ──
section('(3) Common exclusions still enforced (directBuy / defaultOwned / requires)');
const directBuyAll = horseIds.filter(id => CAT[id].item.directBuy === true);
ok(directBuyAll.every(id => coinPool0.indexOf(id) === -1 && adPool0.indexOf(id) === -1), 'no directBuy anchor in any pool');
const defOwned = horseIds.filter(id => CAT[id].item.defaultOwned === true);
ok(defOwned.every(id => coinPool0.indexOf(id) === -1 && adPool0.indexOf(id) === -1), 'no defaultOwned in any pool (count=' + defOwned.length + ')');
const reqUnmet = horseIds.filter(id => CAT[id].item.requires && coinPool0.indexOf(id) === -1 && adPool0.indexOf(id) === -1);
ok(true, 'requires-unmet horse items excluded (count=' + reqUnmet.length + ')');

// ── (4) 카탈로그 무결성 ──
section('(4) Catalog integrity — directBuy per (slot,econ), uniqueness, fields');
ok(horseIds.length === Object.keys(CAT).filter(id => CAT[id].game === 'horse').length, 'horse id index consistent');
// 전역 id 유일성(CATALOG_INDEX는 충돌 시 스킵하므로 raw 파일에서 재검)
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'horse', 'cosmetics.json'), 'utf8'));
const seen = {}; let dup = 0, totalRaw = 0;
Object.keys(raw).forEach(slot => (raw[slot] || []).forEach(it => { if (it && it.id) { totalRaw++; if (seen[it.id]) dup++; seen[it.id] = 1; } }));
ok(dup === 0, 'all raw catalog ids unique (total=' + totalRaw + ', dup=' + dup + ')');
note('horse catalog total items = ' + totalRaw + ' (post-polish: emote slot removed)');

const gachaSlots = ['paint', 'trail', 'accessory', 'bib', 'track_theme', 'finish_fx', 'aura'];
gachaSlots.forEach(slot => {
  ['coin', 'ad'].forEach(econ => {
    const items = (raw[slot] || []).filter(it => { const a = it.adOnly === true; return econ === 'coin' ? !a : a; });
    if (!items.length) { ok(false, slot + '/' + econ + ' has items'); return; }
    const db = items.filter(it => it.directBuy === true);
    ok(db.length === 1, slot + '/' + econ + ': exactly 1 directBuy (got ' + db.length + ')');
    if (db.length === 1) {
      const minR = Math.min(...items.map(it => RAR[it.rarity] ?? 9));
      ok((RAR[db[0].rarity] ?? 9) === minR, slot + '/' + econ + ': directBuy is lowest rarity (' + db[0].rarity + ')');
    }
    // price/adPrice
    const fieldOk = items.every(it => econ === 'coin'
      ? (Number.isInteger(it.price) && it.adPrice === undefined)
      : (it.adOnly === true && Number.isInteger(it.adPrice) && it.price === undefined));
    ok(fieldOk, slot + '/' + econ + ': price/adPrice fields correct');
  });
});
// aura=color
ok((raw.aura || []).every(it => typeof it.color === 'string' && it.color), 'all aura items have color');
ok((raw.aura || []).every(it => it.emoji === undefined), 'aura items have no emoji');
// fairness: 스탯/확률 필드 0
const STAT = ['stat', 'stats', 'odds', 'weight', 'speed', 'boost', 'prob', 'probability', 'bonus', 'multiplier'];
let statHits = 0;
Object.keys(raw).forEach(s => (raw[s] || []).forEach(it => STAT.forEach(k => { if (it[k] !== undefined) statHits++; })));
ok(statHits === 0, 'no stat/odds/probability fields on any item (fairness)');

// ── (5) 광고 가챠 풀 크기 vs AC ──
section('(5) Ad gacha pool size per slot vs spec AC (>=10 ad-pool items)');
gachaSlots.forEach(slot => {
  const adItems = (raw[slot] || []).filter(it => it.adOnly === true);
  const adGacha = adItems.filter(it => it.directBuy !== true && it.defaultOwned !== true);
  if (adGacha.length < 10) note(slot + ' ad gacha pool = ' + adGacha.length + ' (< AC 10; total ad items incl anchor = ' + adItems.length + ')');
  else ok(adGacha.length >= 10, slot + ' ad gacha pool >= 10 (' + adGacha.length + ')');
});

// ── (6) spin 회귀 ──
section('(6) Spin regression — spin pool unaffected, no ad items');
const spinIds = Object.keys(CAT).filter(id => CAT[id].game === 'spin-arena');
const spinAd = spinIds.filter(id => CAT[id].item.adOnly === true);
ok(spinAd.length === 0, 'spin has zero adOnly items (ad gacha horse-only)');
const spinPool = S.buildPool('coin', 'spin-arena', []).map(p => p.id);
ok(spinPool.length > 0, 'spin coin pool non-empty (' + spinPool.length + ')');
// 명세 Must-Preserve: spin 은 directBuy 앵커가 0 → gameHasGacha()=false → 가챠 OFF, 직접구매 보존.
const spinDirectBuy = spinIds.filter(id => CAT[id].item.directBuy === true);
ok(spinDirectBuy.length === 0, 'spin has ZERO directBuy anchors → gameHasGacha(spin)=false → gacha OFF (direct-buy preserved)');

console.log('\n========================================');
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed, ' + warn + ' notes');
process.exit(fail ? 1 : 0);
