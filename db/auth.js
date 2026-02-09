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

module.exports = { register, login };
