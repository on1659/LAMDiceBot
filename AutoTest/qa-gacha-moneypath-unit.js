// 머니패스 결정론 단위 스모크 — db/coins.js drawAndGrant 3분기 net 정합 검증.
//
//   in-memory pg 풀 모킹으로 user_coins / coin_ledger / user_cosmetics 를 시뮬레이션해
//   실제 db/coins.js 코드를 그대로 구동한다. 라이브 DB 불필요(결정론).
//
//   검증(명세 Must-Preserve · QA 항목 2):
//     (A) 신규(미소유): net = -cost. owned 1건 추가. ledger 'gacha' delta=-cost.
//     (B) 중복(이미 소유): net = -(cost - floor(cost/2)). 차감 유지 + 50% 재적립 COMMIT.
//         owned 미추가. ledger 'gacha-dup' delta = -(cost-refund).
//     (C) 잔고 부족: net = 0(ROLLBACK). owned 미추가. ledger 미기록.
//     (D) ledger delta 합 == user_coins 순델타 (정합).
//     (E) 음수 잔고 불가 — balance>=cost 가드가 환급분기에 선행.
//     (F) coin_ledger.reason <= 40 ('gacha' / 'gacha-dup').
//   실행: node AutoTest/qa-gacha-moneypath-unit.js
const path = require('path');
const Module = require('module');

// ── in-memory DB 상태 ──
const DB = {
  coins: {},        // userId -> balance
  ledger: [],       // { user_id, delta, reason, ref }
  cosmetics: {}     // userId -> Set(cosmeticId)
};
function resetDB() { DB.coins = {}; DB.ledger = []; DB.cosmetics = {}; }

// ── pg 풀/클라이언트 모킹 (db/coins.js 가 쓰는 쿼리만 처리) ──
// 트랜잭션은 단일 스레드 + 즉시 적용으로 근사(레이스는 별도 PK-가드 테스트에서).
function makeClient() {
  return {
    async query(sql, params) {
      sql = sql.trim();
      // BEGIN / COMMIT / ROLLBACK
      if (/^BEGIN/i.test(sql)) return { rowCount: 0, rows: [] };
      if (/^COMMIT/i.test(sql)) return { rowCount: 0, rows: [] };
      if (/^ROLLBACK/i.test(sql)) { client._rolledBack = true; return { rowCount: 0, rows: [] }; }
      // INSERT user_coins ... ON CONFLICT DO NOTHING (지갑 시드)
      if (/INSERT INTO user_coins/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        const [userId, seed] = params;
        if (DB.coins[userId] === undefined) { DB.coins[userId] = seed; return { rowCount: 1, rows: [] }; }
        return { rowCount: 0, rows: [] };
      }
      // SELECT balance FROM user_coins
      if (/SELECT balance FROM user_coins/i.test(sql)) {
        const [userId] = params;
        return DB.coins[userId] === undefined ? { rows: [] } : { rows: [{ balance: DB.coins[userId] }] };
      }
      // UPDATE user_coins SET balance = balance - $1 ... WHERE balance >= $1 (원자 차감)
      if (/UPDATE user_coins SET balance = balance - \$1/i.test(sql)) {
        const [amount, userId] = params;
        const bal = DB.coins[userId] || 0;
        if (bal >= amount) { DB.coins[userId] = bal - amount; return { rowCount: 1, rows: [{ balance: DB.coins[userId] }] }; }
        return { rowCount: 0, rows: [] };
      }
      // UPDATE user_coins SET balance = balance + $1 (적립/환급)
      if (/UPDATE user_coins SET balance = balance \+ \$1/i.test(sql)) {
        const [amount, userId] = params;
        DB.coins[userId] = (DB.coins[userId] || 0) + amount;
        return { rowCount: 1, rows: [{ balance: DB.coins[userId] }] };
      }
      // INSERT coin_ledger
      if (/INSERT INTO coin_ledger/i.test(sql)) {
        const [userId, delta, reason, ref] = params;
        // 멱등 INSERT (grant) 분기 — 여기선 drawAndGrant만 쓰므로 단순 push
        DB.ledger.push({ user_id: userId, delta, reason, ref: ref || null });
        if (/RETURNING id/i.test(sql)) return { rowCount: 1, rows: [{ id: DB.ledger.length }] };
        return { rowCount: 1, rows: [] };
      }
      // INSERT user_cosmetics ... ON CONFLICT DO NOTHING RETURNING user_id
      if (/INSERT INTO user_cosmetics/i.test(sql)) {
        const [userId, cosmeticId] = params;
        DB.cosmetics[userId] = DB.cosmetics[userId] || new Set();
        if (DB.cosmetics[userId].has(cosmeticId)) return { rowCount: 0, rows: [] };
        DB.cosmetics[userId].add(cosmeticId);
        return { rowCount: 1, rows: [{ user_id: userId }] };
      }
      // SELECT 1 FROM user_cosmetics (spend fast-path — 미사용)
      if (/SELECT 1 FROM user_cosmetics/i.test(sql)) {
        const [userId, cosmeticId] = params;
        const has = DB.cosmetics[userId] && DB.cosmetics[userId].has(cosmeticId);
        return { rows: has ? [{ '?column?': 1 }] : [] };
      }
      throw new Error('unmocked SQL: ' + sql.slice(0, 60));
    },
    release() {}
  };
}
let client = null;
const mockPool = {
  async connect() { client = makeClient(); client._rolledBack = false; return client; },
  async query(sql, params) { const c = makeClient(); return c.query(sql, params); }
};

// db/pool.js 를 모킹된 getPool 로 바꿔치기 — require 캐시에 가짜 모듈 주입.
const poolPath = require.resolve(path.join(__dirname, '..', 'db', 'pool.js'));
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true, exports: {
    getPool: () => mockPool, initPool: async () => {}, clearPool: () => {}
  }
};

const coins = require(path.join(__dirname, '..', 'db', 'coins.js'));

// ── 러너 ──
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } }
function section(t) { console.log('\n### ' + t); }

const USER = 7;
const COST = 100; // GACHA_COIN_COST
const REFUND = Math.floor(COST / 2); // 50

(async function run() {
  // ── (A) 신규 — net = -cost ──
  section('(A) NEW draw — net = -cost, owned +1, ledger=gacha');
  resetDB();
  DB.coins[USER] = 500;
  const rA = await coins.drawAndGrant(USER, COST, 'paint_gold');
  ok(rA.ok === true, 'ok=true');
  ok(rA.isDupe === false, 'isDupe=false');
  ok(rA.refunded === 0, 'refunded=0');
  ok(DB.coins[USER] === 500 - COST, 'balance net = 500-100 = ' + (500 - COST) + ' (got ' + DB.coins[USER] + ')');
  ok(rA.balance === 400, 'returned balance=400');
  ok(DB.cosmetics[USER].has('paint_gold'), 'owned has paint_gold');
  ok(DB.ledger.length === 1 && DB.ledger[0].reason === 'gacha' && DB.ledger[0].delta === -COST, "ledger: 1 row 'gacha' delta=-100");

  // ── (B) 중복 — net = -(cost - refund) ──
  section('(B) DUP draw — net = -(cost-floor(cost/2)) = -50, owned unchanged, ledger=gacha-dup, COMMIT');
  resetDB();
  DB.coins[USER] = 500;
  DB.cosmetics[USER] = new Set(['paint_gold']); // 이미 소유
  const before = DB.coins[USER];
  const rB = await coins.drawAndGrant(USER, COST, 'paint_gold');
  ok(rB.ok === true, 'ok=true (COMMIT, not rollback)');
  ok(rB.isDupe === true, 'isDupe=true');
  ok(rB.refunded === REFUND, 'refunded=' + REFUND);
  ok(DB.coins[USER] === before - (COST - REFUND), 'balance net = 500-(100-50) = 450 (got ' + DB.coins[USER] + ')');
  ok(rB.balance === 450, 'returned balance=450');
  ok(DB.cosmetics[USER].size === 1, 'owned unchanged (still 1 item)');
  ok(DB.ledger.length === 1 && DB.ledger[0].reason === 'gacha-dup' && DB.ledger[0].delta === -(COST - REFUND),
     "ledger: 1 row 'gacha-dup' delta=-50");

  // ── (C) 부족 — net = 0, ROLLBACK ──
  section('(C) INSUFFICIENT — net = 0, owned unchanged, no ledger');
  resetDB();
  DB.coins[USER] = 50; // < COST
  const rC = await coins.drawAndGrant(USER, COST, 'paint_gold');
  ok(rC.ok === false, 'ok=false');
  ok(rC.reason === 'insufficient', "reason='insufficient'");
  ok(DB.coins[USER] === 50, 'balance unchanged (net 0)');
  ok(!DB.cosmetics[USER] || DB.cosmetics[USER].size === 0, 'owned unchanged (no grant)');
  ok(DB.ledger.length === 0, 'no ledger row written');

  // ── (D) ledger 합 == 순델타 (장기 시퀀스) ──
  section('(D) ledger delta sum == user_coins net delta (mixed sequence)');
  resetDB();
  DB.coins[USER] = 10000;
  const startBal = DB.coins[USER];
  const items = ['a', 'b', 'c', 'd', 'e'];
  // 각 아이템 2회씩(첫 신규, 둘째 중복) → net 정합 검증
  for (const it of items) { await coins.drawAndGrant(USER, COST, it); await coins.drawAndGrant(USER, COST, it); }
  const ledgerSum = DB.ledger.reduce((s, l) => s + l.delta, 0);
  const netDelta = DB.coins[USER] - startBal;
  ok(ledgerSum === netDelta, 'ledger sum (' + ledgerSum + ') == balance net delta (' + netDelta + ')');
  // 신규5 + 중복5 → 5*(-100) + 5*(-50) = -750
  ok(netDelta === -750, 'net delta = 5*(-100) + 5*(-50) = -750 (got ' + netDelta + ')');
  const newRows = DB.ledger.filter(l => l.reason === 'gacha').length;
  const dupRows = DB.ledger.filter(l => l.reason === 'gacha-dup').length;
  ok(newRows === 5 && dupRows === 5, '5 gacha + 5 gacha-dup rows');

  // ── (E) 음수 잔고 불가 — 환급분기는 차감 성공(balance>=cost) 후에만 도달 ──
  section('(E) Negative balance impossible — refund branch reached only after successful debit');
  resetDB();
  DB.coins[USER] = COST; // 정확히 cost (차감 후 0)
  DB.cosmetics[USER] = new Set(['x']); // 중복 유도
  const rE = await coins.drawAndGrant(USER, COST, 'x');
  ok(rE.ok === true && rE.isDupe === true, 'dup at exactly cost balance succeeds');
  ok(DB.coins[USER] === REFUND, 'balance = 0(차감) + 50(환급) = 50, never negative (got ' + DB.coins[USER] + ')');
  // 잔고 0 + 중복 시도 → 차감 실패 → insufficient (환급분기 미도달)
  resetDB();
  DB.coins[USER] = 0;
  DB.cosmetics[USER] = new Set(['x']);
  const rE2 = await coins.drawAndGrant(USER, COST, 'x');
  ok(rE2.ok === false && rE2.reason === 'insufficient', 'zero balance + dup → insufficient (no refund, no negative)');
  ok(DB.coins[USER] === 0, 'balance stays 0');

  // ── (F) reason 길이 <= 40 ──
  section('(F) coin_ledger.reason <= 40 chars (VARCHAR(40))');
  const reasons = [...new Set(DB.ledger.map(l => l.reason))];
  resetDB(); DB.coins[USER] = 500;
  await coins.drawAndGrant(USER, COST, 'paint_gold');
  DB.cosmetics[USER].add('paint_gold');
  await coins.drawAndGrant(USER, COST, 'paint_gold');
  const allReasons = [...new Set(DB.ledger.map(l => l.reason))];
  ok(allReasons.every(r => r.length <= 40), 'all reasons <= 40 chars: [' + allReasons.join(', ') + ']');
  ok(allReasons.every(r => r === 'gacha' || r === 'gacha-dup'), "reasons are exactly 'gacha' / 'gacha-dup'");

  // ── (G) cost=0 방어 ──
  section('(G) Edge — cost 0 / invalid args');
  resetDB(); DB.coins[USER] = 100;
  const rG = await coins.drawAndGrant(USER, 0, 'free');
  ok(rG.ok === true && rG.isDupe === false, 'cost=0 new draw ok (net 0, grant)');
  ok(DB.coins[USER] === 100, 'balance unchanged at cost=0');
  const rGi = await coins.drawAndGrant(null, COST, 'x');
  ok(rGi.ok === false && rGi.reason === 'invalid', 'invalid userId → invalid');

  console.log('\n========================================');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
