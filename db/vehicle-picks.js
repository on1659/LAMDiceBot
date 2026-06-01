const { getPool } = require('./pool');

async function recordVehiclePicks(serverId, picks) {
    const pool = getPool();
    if (!pool || !serverId || !Array.isArray(picks) || picks.length === 0) return;
    // picks: [{ userName, vehicleId, rank, isWinner, gameSessionId }]
    try {
        const values = [];
        const params = [];
        let i = 1;
        for (const p of picks) {
            if (!p.userName || !p.vehicleId) continue;
            values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(serverId, p.userName, p.vehicleId, p.rank ?? null, !!p.isWinner, p.gameSessionId ?? null);
        }
        if (values.length === 0) return;
        await pool.query(
            `INSERT INTO vehicle_picks (server_id, user_name, vehicle_id, rank, is_winner, game_session_id)
             VALUES ${values.join(',')}`,
            params
        );
    } catch (e) {
        console.warn('vehicle_picks insert:', e.message);
    }
}

module.exports = { recordVehiclePicks };
