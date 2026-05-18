// 광고 노출 측정 (Phase D)
// /free origin과 기존 dice 로비 origin의 광고 노출 비교를 위한 ping 기록.
// DB 없으면 graceful skip — 페이지 동작에 영향 없음.
const { getPool } = require('./pool');

async function recordAdImpression({ gameType, page, origin, ip }) {
    const pool = getPool();
    if (!pool) return;
    try {
        await pool.query(
            `INSERT INTO ad_impression (game_type, page, origin, ip, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
                gameType || null,
                page || null,
                origin || null,
                ip ? String(ip).slice(0, 63) : null
            ]
        );
    } catch (e) {
        console.warn('[ad_impression] insert 실패:', e.message);
    }
}

module.exports = { recordAdImpression };
