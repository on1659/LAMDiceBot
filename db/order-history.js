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

module.exports = { recordOrderHistory };
