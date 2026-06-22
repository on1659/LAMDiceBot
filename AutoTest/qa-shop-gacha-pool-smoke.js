// 결정론 단위 스모크 — socket/shop.js 의 buildPool / weightedPick 를 실제 코드 그대로
// VM에 로드해 구동한다(함수가 module.exports 되지 않으므로 소스에서 추출 후 실행).
//   목적:
//     (1) H-2: buildPool 이 requires 미충족 *_t2 를 풀에서 제외(선행 미소유 시), 선행 소유 시 포함.
//     (2) 두 경제 분리: coin 풀 = 비-adOnly only, ad 풀 = adOnly only (배타).
//     (3) 공통 제외: directBuy / defaultOwned / 이미 보유.
//     (4) spin 회귀: requires 가드가 spin t1(앵커) 직접구매를 깨지 않음(t1은 항상 풀에 있음).
//     (5) weightedPick: 가중치가 GACHA_RARITY_WEIGHTS 에 따라 통계적으로 맞고, 0/미정은 최소1 보정.
//     (6) directBuy 앵커가 어떤 풀에도 안 나옴.
//   실행: node AutoTest/qa-shop-gacha-pool-smoke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const shopSrc = fs.readFileSync(path.join(ROOT, 'socket', 'shop.js'), 'utf8');

// socket/shop.js 의 GACHA_RARITY_WEIGHTS / buildPool / weightedPick 를 그대로 추출.
function extract(name, src) {
  const re = new RegExp('(const ' + name + '\\b[\\s\\S]*?;\\n)');
  // 함수는 별도 처리
  return null;
}

// 소스 통째를 sandbox 에서 실행하되, registerShopHandlers 호출/소켓 의존이 없으므로
// 모듈 상단부(상수/카탈로그 로드/buildPool/weightedPick)만 평가되도록 require 들을 stub.
const sandbox = {
  module: { exports: {} },
  require: function (m) {
    if (m === 'fs') return fs;
    if (m === 'path') return path;
    // db 모듈은 가챠 풀/추첨엔 불필요 — no-op stub
    return new Proxy({}, { get: () => () => {} });
  },
  console: console,
  process: { env: {} },
  __dirname: path.join(ROOT, 'socket'),
  Math: Math,
  Number: Number,
  Array: Array,
  Object: Object,
  JSON: JSON
};
vm.createContext(sandbox);
vm.runInContext(shopSrc, sandbox, { filename: 'socket/shop.js' });

// registerShopHandlers 가 export 됐지만 buildPool/weightedPick 는 클로저 내부라 직접 접근 불가.
// → 소스에서 두 함수 + 상수 + 카탈로그 빌드 블록만 떼어 별도 sandbox 에서 재평가해 노출.
function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s);
  if (s === -1 || e === -1) throw new Error('marker not found: ' + startMarker);
  return src.slice(s, e);
}

// 카탈로그 로드 블록(상단) + 상수 + buildPool + weightedPick 를 모은 축약 모듈.
const catalogBlock = sliceBetween(shopSrc, 'const CONFIG_DIR', 'function registerShopHandlers');

const exposeSrc = "const fs = require('fs');\nconst path = require('path');\n"
  + catalogBlock
  + '\nmodule.exports = { CATALOG, CATALOG_INDEX, KNOWN_GAMES, GACHA_RARITY_WEIGHTS, GACHA_COIN_COST, GACHA_AD_COST, COIN_GACHA_ENABLED, buildPool, weightedPick };\n';

const box2 = {
  module: { exports: {} },
  require: function (m) {
    if (m === 'fs') return fs;
    if (m === 'path') return path;
    return new Proxy({}, { get: () => () => {} });
  },
  console: { warn: () => {}, error: () => {}, log: () => {} }, // 카탈로그 충돌 경고 침묵
  process: { env: {} },
  __dirname: path.join(ROOT, 'socket'),
  Math, Number, Array, Object, JSON
};
vm.createContext(box2);
vm.runInContext(exposeSrc, box2, { filename: 'socket/shop.js#expose' });
const S = box2.module.exports;

// ── 테스트 러너 ──
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } }
function section(t) { console.log('\n### ' + t); }

console.log('Loaded games:', Object.keys(S.KNOWN_GAMES).join(', '));
console.log('GACHA_RARITY_WEIGHTS:', JSON.stringify(S.GACHA_RARITY_WEIGHTS), 'COIN_GACHA_ENABLED:', S.COIN_GACHA_ENABLED);

// ── (1) 두 경제 분리 (horse) ──
section('Economy split — horse coin pool = non-ad only, ad pool = adOnly only');
const horseCoinPool = S.buildPool('coin', 'horse', []);
const horseAdPool = S.buildPool('ad', 'horse', []);
const coinIds = horseCoinPool.map(p => p.id);
const adIds = horseAdPool.map(p => p.id);
ok(coinIds.every(id => S.CATALOG_INDEX[id].item.adOnly !== true), 'coin pool has zero adOnly items');
ok(adIds.every(id => S.CATALOG_INDEX[id].item.adOnly === true), 'ad pool is adOnly only');
ok(coinIds.filter(id => adIds.indexOf(id) !== -1).length === 0, 'coin & ad pools are disjoint');

// ── (2) 공통 제외: directBuy / defaultOwned / owned ──
section('Common exclusions (directBuy / defaultOwned / owned)');
const allHorse = Object.keys(S.CATALOG_INDEX).filter(id => S.CATALOG_INDEX[id].game === 'horse');
const directBuyHorse = allHorse.filter(id => S.CATALOG_INDEX[id].item.directBuy === true);
ok(directBuyHorse.length === 10, 'horse has 10 directBuy anchors (got ' + directBuyHorse.length + ')');
ok(directBuyHorse.every(id => coinIds.indexOf(id) === -1 && adIds.indexOf(id) === -1), 'no directBuy anchor appears in any pool');
const defOwnedHorse = allHorse.filter(id => S.CATALOG_INDEX[id].item.defaultOwned === true);
ok(defOwnedHorse.every(id => coinIds.indexOf(id) === -1 && adIds.indexOf(id) === -1), 'no defaultOwned appears in any pool (count=' + defOwnedHorse.length + ')');
// owned 제외: 첫 coin 아이템을 owned 로 주면 풀에서 빠진다
if (coinIds.length) {
  const owned1 = [coinIds[0]];
  const after = S.buildPool('coin', 'horse', owned1).map(p => p.id);
  ok(after.indexOf(coinIds[0]) === -1, 'owned item is excluded from coin pool');
  ok(after.length === coinIds.length - 1, 'pool shrinks by exactly 1 when one item owned');
}

// ── (3) H-2: requires gate (spin t2 requires t1) ──
section('H-2 — requires gate (spin *_t2 excluded until base owned)');
const spinCoinPool0 = S.buildPool('coin', 'spin-arena', []); // 아무것도 미소유
const poolIds0 = spinCoinPool0.map(p => p.id);
const t2Ids = Object.keys(S.CATALOG_INDEX).filter(id => S.CATALOG_INDEX[id].game === 'spin-arena' && S.CATALOG_INDEX[id].item.requires);
// 스펙 H-2 분기: requires 의 base 가 defaultOwned 면 (선행 자동충족) 풀에 IN,
// base 가 비-defaultOwned 면 base 미소유 시 OUT.
const t2BaseDefault = t2Ids.filter(id => { const b = S.CATALOG_INDEX[id].item.requires; return !!(S.CATALOG_INDEX[b] && S.CATALOG_INDEX[b].item.defaultOwned); });
const t2BaseNonDefault = t2Ids.filter(id => { const b = S.CATALOG_INDEX[id].item.requires; return !(S.CATALOG_INDEX[b] && S.CATALOG_INDEX[b].item.defaultOwned); });
ok(t2Ids.length > 0, 'spin has requires-gated items to test (total=' + t2Ids.length + ', defaultBase=' + t2BaseDefault.length + ', nonDefaultBase=' + t2BaseNonDefault.length + ')');
ok(t2BaseNonDefault.length === 0 || t2BaseNonDefault.every(id => poolIds0.indexOf(id) === -1),
   '*_t2 with NON-default base excluded when base unowned (count=' + t2BaseNonDefault.length + ')');
ok(t2BaseDefault.length === 0 || t2BaseDefault.every(id => poolIds0.indexOf(id) !== -1),
   '*_t2 with defaultOwned base INCLUDED even with nothing owned (spec H-2; count=' + t2BaseDefault.length + ')');
// 비-default base t2 는 base 를 사면 등장
if (t2BaseNonDefault.length) {
  const sampleT2 = t2BaseNonDefault[0];
  const base = S.CATALOG_INDEX[sampleT2].item.requires;
  const poolWithBase = S.buildPool('coin', 'spin-arena', [base]).map(p => p.id);
  ok(poolWithBase.indexOf(sampleT2) !== -1, 'non-default-base ' + sampleT2 + ' appears once base ' + base + ' is owned');
} else {
  console.log('    (note: all spin t2 bases are defaultOwned — no non-default-base case in current catalog)');
}

// ── (4) spin 회귀: t1 앵커(요구조건 없는 base)는 항상 풀에 ──
section('Spin regression — base (t1, no requires) items remain drawable');
const spinT1 = Object.keys(S.CATALOG_INDEX).filter(id => {
  const e = S.CATALOG_INDEX[id];
  return e.game === 'spin-arena' && !e.item.requires && e.item.directBuy !== true && e.item.defaultOwned !== true && e.item.adOnly !== true;
});
const spinPoolIds0 = spinCoinPool0.map(p => p.id);
ok(spinT1.length === 0 || spinT1.every(id => spinPoolIds0.indexOf(id) !== -1),
   'all non-anchor t1 bases are in spin coin pool when unowned (t1 count=' + spinT1.length + ')');
// spin 은 ad 아이템이 없어야(광고 가챠 horse-only)
const spinAd = Object.keys(S.CATALOG_INDEX).filter(id => S.CATALOG_INDEX[id].game === 'spin-arena' && S.CATALOG_INDEX[id].item.adOnly === true);
ok(spinAd.length === 0, 'spin has zero adOnly items (ad gacha horse-only)');

// ── (5) weightedPick 분포 ──
section('weightedPick distribution (rare 70 / epic 30 over horse coin pool)');
if (horseCoinPool.length) {
  const N = 200000;
  const counts = {};
  for (let i = 0; i < N; i++) { const id = S.weightedPick(horseCoinPool); counts[id] = (counts[id] || 0) + 1; }
  // rarity 별 합산 기대치 vs 실측
  const rar = {};
  horseCoinPool.forEach(p => { rar[p.rarity] = rar[p.rarity] || { w: 0, n: 0 }; });
  let totalW = 0;
  horseCoinPool.forEach(p => {
    const w = S.GACHA_RARITY_WEIGHTS[p.rarity];
    const eff = (Number.isFinite(w) && w > 0) ? w : 1;
    rar[p.rarity].w += eff; totalW += eff;
    rar[p.rarity].n += (counts[p.id] || 0);
  });
  let distOk = true;
  Object.keys(rar).forEach(k => {
    const expPct = (rar[k].w / totalW) * 100;
    const obsPct = (rar[k].n / N) * 100;
    const drift = Math.abs(expPct - obsPct);
    if (drift > 2) distOk = false;
    console.log('    rarity=' + k, 'expected=' + expPct.toFixed(1) + '%', 'observed=' + obsPct.toFixed(1) + '%', 'drift=' + drift.toFixed(2));
  });
  ok(distOk, 'observed distribution within 2% of rarity-weighted expectation');
  // 모든 풀 아이템이 최소 1회는 뽑힘(0확률 항목 없음 — eff>=1 보정)
  ok(horseCoinPool.every(p => counts[p.id] > 0), 'every pool item is reachable (no zero-weight starvation)');
}

// ── (6) empty pool ──
section('Empty pool — owning everything yields []');
const everyCoin = coinIds.slice();
ok(S.buildPool('coin', 'horse', everyCoin).length === 0, 'coin pool empty when all coin items owned');
const everyAd = adIds.slice();
ok(S.buildPool('ad', 'horse', everyAd).length === 0, 'ad pool empty when all ad items owned');

console.log('\n========================================');
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
