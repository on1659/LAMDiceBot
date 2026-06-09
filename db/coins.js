// 코인 지갑 — 적립/소비/잔고 (트랜잭션 + 원장 정합성)
//
// 돈 경로다. 다른 db 모듈의 `.catch(()=>{})` silent-fail 관례를 깨고,
// 실패는 호출부가 알 수 있게 던지거나 명시적 결과를 반환한다.
//
// 트랜잭션 패턴은 db/ranking.js:422 startNewSeason 의 pool.connect() +
// BEGIN/COMMIT/ROLLBACK/release 를 그대로 따른다 (코드베이스 유일 선례).
//
// 모든 식별자는 users.id (authedUserId). 닉네임(data.name) 사용 금지.
const { getPool } = require('./pool');

const SEED_COINS = 100; // 신규 지갑 시드 (지갑 최초 생성 시 1회)

// 잔고 조회. 행 없으면 0.
async function getBalance(userId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return 0;
    const r = await pool.query('SELECT balance FROM user_coins WHERE user_id = $1', [userId]);
    return r.rows.length > 0 ? r.rows[0].balance : 0;
}

// 지갑 보장 (없으면 시드 코인으로 생성). 멱등.
async function ensureWallet(userId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return;
    await pool.query(
        `INSERT INTO user_coins (user_id, balance) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, SEED_COINS]
    );
}

// 적립 (양수 delta). 멱등: 같은 (userId, ref, reason)이 이미 있으면 스킵.
// 트랜잭션: 원장 INSERT → 실제 들어갔을 때만 잔고 UP.
// 반환: { ok, balance, granted } (granted=false면 멱등 스킵).
async function grant(userId, delta, reason, ref) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId) || !Number.isInteger(delta) || delta <= 0) {
        return { ok: false, balance: 0, granted: false };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 지갑 보장 (시드는 ensureWallet과 동일 — 적립 전 행 보장)
        await client.query(
            `INSERT INTO user_coins (user_id, balance) VALUES ($1, $2)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, SEED_COINS]
        );
        // 원장 멱등 INSERT
        const led = await client.query(
            `INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, ref, reason) WHERE ref IS NOT NULL DO NOTHING
             RETURNING id`,
            [userId, delta, reason, ref || null]
        );
        let balance;
        if (led.rowCount > 0) {
            const upd = await client.query(
                `UPDATE user_coins SET balance = balance + $1, updated_at = NOW()
                 WHERE user_id = $2 RETURNING balance`,
                [delta, userId]
            );
            balance = upd.rows[0].balance;
        } else {
            // 멱등 스킵 — 현재 잔고만 조회
            const cur = await client.query('SELECT balance FROM user_coins WHERE user_id = $1', [userId]);
            balance = cur.rows[0].balance;
        }
        await client.query('COMMIT');
        return { ok: true, balance, granted: led.rowCount > 0 };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// 소비 (구매). 원자 차감 + 원장 + 인벤토리 1트랜잭션.
// 가격은 호출부(서버 카탈로그)가 권위. 잔고 부족이면 ROLLBACK + insufficient.
// 반환: { ok, reason?, balance, owned? }
async function spend(userId, price, cosmeticId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId) || !Number.isInteger(price) || price < 0 || !cosmeticId) {
        return { ok: false, reason: 'invalid', balance: 0 };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 이미 소유 시 재구매 차단 (코인 차감 없이 ok)
        const ownedAlready = await client.query(
            'SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2',
            [userId, cosmeticId]
        );
        if (ownedAlready.rows.length > 0) {
            const cur = await client.query('SELECT balance FROM user_coins WHERE user_id = $1', [userId]);
            await client.query('COMMIT');
            return { ok: false, reason: 'owned', balance: cur.rows.length ? cur.rows[0].balance : 0 };
        }

        // 원자 차감 (잔고 부족이면 rowCount 0)
        const dec = await client.query(
            `UPDATE user_coins SET balance = balance - $1, updated_at = NOW()
             WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
            [price, userId]
        );
        if (dec.rowCount === 0) {
            await client.query('ROLLBACK');
            const bal = await getBalance(userId);
            return { ok: false, reason: 'insufficient', balance: bal };
        }
        const balance = dec.rows[0].balance;

        await client.query(
            `INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4)`,
            [userId, -price, 'buy:' + cosmeticId, null]
        );
        await client.query(
            `INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($1, $2)
             ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
            [userId, cosmeticId]
        );

        await client.query('COMMIT');
        return { ok: true, balance };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { getBalance, ensureWallet, grant, spend, SEED_COINS };
