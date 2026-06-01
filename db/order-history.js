const { getPool } = require('./pool');

async function recordOrderHistory(serverId, userName, menuText, opts = {}) {
    const pool = getPool();
    if (!pool || !serverId || !userName || !menuText) return;
    const { gameType = null, gameSessionId = null, source = 'manual_update' } = opts;
    try {
        await pool.query(
            `INSERT INTO order_history (server_id, user_name, menu_text, game_type, game_session_id, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [serverId, userName, menuText, gameType, gameSessionId, source]
        );
    } catch (e) {
        console.warn('order_history insert:', e.message);
    }
}

async function recordOrderHistoryBatch(serverId, entries) {
    const pool = getPool();
    if (!pool || !serverId || !Array.isArray(entries) || entries.length === 0) return;
    try {
        const values = [];
        const params = [];
        let i = 1;
        for (const e of entries) {
            if (!e.userName || !e.menuText) continue;
            values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(
                serverId,
                e.userName,
                e.menuText,
                e.gameType ?? null,
                e.gameSessionId ?? null,
                e.source ?? 'manual_update'
            );
        }
        if (values.length === 0) return;
        await pool.query(
            `INSERT INTO order_history (server_id, user_name, menu_text, game_type, game_session_id, source)
             VALUES ${values.join(',')}`,
            params
        );
    } catch (e) {
        console.warn('order_history batch insert:', e.message);
    }
}

module.exports = { recordOrderHistory, recordOrderHistoryBatch };
