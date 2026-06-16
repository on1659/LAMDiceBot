// 유저 인증 함수
const { getPool } = require('./pool');

// bcrypt는 선택적 (없으면 평문 저장)
let bcrypt = null;
try {
    bcrypt = require('bcrypt');
} catch (e) {
    console.warn('⚠️  bcrypt 미설치. 유저 PIN이 평문 저장됩니다.');
}

const SALT_ROUNDS = 10;

async function hashPin(pin) {
    if (bcrypt) {
        try { return await bcrypt.hash(pin, SALT_ROUNDS); }
        catch (e) { /* fallback */ }
    }
    return pin;
}

async function comparePin(pin, hash) {
    if (!pin || !hash) return false;
    if (bcrypt) {
        try { return await bcrypt.compare(pin, hash); }
        catch (e) { /* fallback */ }
    }
    return pin === hash;
}

async function register(name, pin) {
    const pool = getPool();
    if (!pool) return { error: 'DB 미연결' };

    if (!name || !pin) return { error: '이름과 암호코드를 입력해주세요.' };
    if (!/^\d{4,6}$/.test(pin)) return { error: '암호코드는 4~6자리 숫자여야 합니다.' };

    // 중복 체크
    const existing = await pool.query('SELECT id FROM users WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
        return { error: '이미 사용 중인 이름입니다.' };
    }

    const pinHash = await hashPin(pin);
    const result = await pool.query(
        `INSERT INTO users (name, pin_hash) VALUES ($1, $2) RETURNING id, name, is_admin`,
        [name, pinHash]
    );

    return { user: result.rows[0] };
}

async function login(name, pin) {
    const pool = getPool();
    if (!pool) return { error: 'DB 미연결' };

    if (!name || !pin) return { error: '이름과 암호코드를 입력해주세요.' };

    const result = await pool.query('SELECT id, name, pin_hash, is_admin FROM users WHERE name = $1', [name]);
    if (result.rows.length === 0) {
        return { error: '존재하지 않는 사용자입니다.' };
    }

    const user = result.rows[0];
    const match = await comparePin(pin, user.pin_hash);
    if (!match) {
        return { error: '암호코드가 일치하지 않습니다.' };
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return { user: { id: user.id, name: user.name, isAdmin: user.is_admin } };
}

// 토큰 부트스트랩용: 이름으로 계정(id, name) 조회. PIN 검증 없음 —
// 호출부(/auth/token)가 신뢰 등급을 책임진다(현재: 플레이머니 전용 느슨한 발급).
async function getUserByName(name) {
    const pool = getPool();
    if (!pool || !name) return null;
    const result = await pool.query('SELECT id, name FROM users WHERE name = $1', [name]);
    return result.rows[0] || null;
}

async function getUserFlags(name) {
    const pool = getPool();
    if (!pool) return 0;
    const result = await pool.query('SELECT flags FROM users WHERE name = $1', [name]);
    return result.rows.length > 0 ? (result.rows[0].flags || 0) : 0;
}

async function setFlag(name, flagBit) {
    const pool = getPool();
    if (!pool) return;
    await pool.query('UPDATE users SET flags = flags | $1 WHERE name = $2', [flagBit, name]);
}

async function getUserPrefs(name) {
    const pool = getPool();
    if (!pool || !name) return {};
    const result = await pool.query('SELECT prefs FROM users WHERE name = $1', [name]);
    return result.rows.length > 0 ? (result.rows[0].prefs || {}) : {};
}

async function setUserPref(name, key, value) {
    const pool = getPool();
    if (!pool || !name || !key) return;
    // JSONB 부분 업데이트: jsonb_set 사용
    await pool.query(
        `UPDATE users SET prefs = jsonb_set(COALESCE(prefs, '{}'::jsonb), $1, $2::jsonb, true) WHERE name = $3`,
        [`{${key}}`, JSON.stringify(value), name]
    );
}

module.exports = { register, login, getUserByName, getUserFlags, setFlag, getUserPrefs, setUserPref };
