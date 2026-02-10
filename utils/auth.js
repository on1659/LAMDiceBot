// 관리자 인증 유틸리티
const crypto = require('crypto');

const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '0000';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24시간

// 활성 토큰 저장 (인메모리)
const activeTokens = new Map();

function generateAdminToken(id, password) {
    if (id !== ADMIN_ID || password !== ADMIN_PASSWORD) return null;
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, Date.now() + TOKEN_EXPIRY_MS);
    return token;
}

function verifyAdminToken(token) {
    if (!token || !activeTokens.has(token)) return false;
    const expiry = activeTokens.get(token);
    if (Date.now() > expiry) {
        activeTokens.delete(token);
        return false;
    }
    return true;
}

// 만료 토큰 정리 (1시간마다)
setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of activeTokens) {
        if (now > expiry) activeTokens.delete(token);
    }
}, 60 * 60 * 1000);

module.exports = { generateAdminToken, verifyAdminToken };
