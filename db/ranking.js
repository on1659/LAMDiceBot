// 랭킹 쿼리 + 주문 기록 함수
const { getPool } = require('./pool');

// ─── 주문 기록 ───

async function recordOrder(serverId, userName, menuText) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        `INSERT INTO order_stats (server_id, user_name, menu_text, order_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (server_id, user_name, menu_text)
         DO UPDATE SET order_count = order_stats.order_count + 1`,
        [serverId || 0, userName, menuText]
    ).catch(e => console.warn('order_stats upsert:', e.message));
}

// ─── 종합 랭킹 ───

async function getOverallRanking(serverId) {
    const pool = getPool();
    if (!pool) return { mostPlayed: [], mostWins: [], winRate: [], avgRank: [] };

    const condition = serverId ? 'server_id = $1' : 'server_id IS NULL';
    const params = serverId ? [serverId] : [];

    const result = await pool.query(`
        WITH stats AS (
            SELECT user_name,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE is_winner = true) AS wins,
                ROUND(AVG(game_rank) FILTER (WHERE game_rank IS NOT NULL), 1) AS avg_rank,
                COUNT(*) FILTER (WHERE game_rank IS NOT NULL AND game_rank <= 3) AS top3_count
            FROM server_game_records
            WHERE ${condition}
            GROUP BY user_name
        )
        SELECT user_name, games, wins, avg_rank, top3_count,
            CASE WHEN games > 0 THEN ROUND(wins::numeric / games * 100, 1) ELSE 0 END AS win_rate
        FROM stats
        ORDER BY games DESC
    `, params);

    const rows = result.rows;
    return {
        mostPlayed: rows.slice(0, 10).map(r => ({ name: r.user_name, games: parseInt(r.games) })),
        mostWins: [...rows].sort((a, b) => b.wins - a.wins).slice(0, 10).map(r => ({ name: r.user_name, wins: parseInt(r.wins) })),
        winRate: rows.filter(r => parseInt(r.games) >= 5).sort((a, b) => parseFloat(b.win_rate) - parseFloat(a.win_rate)).slice(0, 10)
            .map(r => ({ name: r.user_name, winRate: parseFloat(r.win_rate), games: parseInt(r.games), wins: parseInt(r.wins) })),
        avgRank: rows.filter(r => r.avg_rank !== null).sort((a, b) => parseFloat(a.avg_rank) - parseFloat(b.avg_rank)).slice(0, 10)
            .map(r => ({ name: r.user_name, avgRank: parseFloat(r.avg_rank), top3: parseInt(r.top3_count), games: parseInt(r.games) }))
    };
}

// ─── 게임별 랭킹 ───

async function getGameRanking(serverId, gameType) {
    const pool = getPool();
    if (!pool) return { winners: [], players: [] };

    const condition = serverId ? 'server_id = $1' : 'server_id IS NULL';
    const params = serverId ? [serverId, gameType] : [gameType];
    const typeParam = serverId ? '$2' : '$1';

    const result = await pool.query(`
        WITH stats AS (
            SELECT user_name,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records
            WHERE ${condition} AND game_type = ${typeParam}
            GROUP BY user_name
        )
        SELECT user_name, games, wins
        FROM stats
        ORDER BY wins DESC
        LIMIT 10
    `, params);

    return {
        winners: result.rows.map(r => ({ name: r.user_name, wins: parseInt(r.wins), games: parseInt(r.games) })),
        players: [...result.rows].sort((a, b) => b.games - a.games).slice(0, 10)
            .map(r => ({ name: r.user_name, games: parseInt(r.games) }))
    };
}

// ─── 경마 특화 (탈것 등수 분포) ───

async function getHorseRaceStats(serverId) {
    const pool = getPool();
    if (!pool) return { winners: [], vehicles: [] };

    // 기본 게임 랭킹
    const gameRanking = await getGameRanking(serverId, 'horse');

    // vehicle_stats에서 전체 탈것 등수 분포 (server_id는 VARCHAR)
    const serverIdStr = serverId ? String(serverId) : 'default';
    const vehicleResult = await pool.query(`
        SELECT vehicle_id, appearance_count, pick_count,
               rank_1, rank_2, rank_3, rank_4, rank_5, rank_6
        FROM vehicle_stats
        WHERE server_id = $1 AND appearance_count > 0
        ORDER BY rank_1 DESC, appearance_count DESC
    `, [serverIdStr]);

    const vehicles = vehicleResult.rows.map(r => ({
        id: r.vehicle_id,
        appearances: parseInt(r.appearance_count),
        picks: parseInt(r.pick_count),
        ranks: [
            parseInt(r.rank_1), parseInt(r.rank_2), parseInt(r.rank_3),
            parseInt(r.rank_4), parseInt(r.rank_5), parseInt(r.rank_6)
        ]
    }));

    return {
        winners: gameRanking.winners,
        vehicles
    };
}

// ─── 주문 랭킹 ───

async function getOrderRanking(serverId) {
    const pool = getPool();
    if (!pool) return { topOrderers: [], popularMenus: [] };

    const sid = serverId || 0;

    // 최다 주문자
    const orderersResult = await pool.query(`
        SELECT user_name, SUM(order_count) AS total_orders
        FROM order_stats
        WHERE server_id = $1
        GROUP BY user_name
        ORDER BY total_orders DESC
        LIMIT 10
    `, [sid]);

    // 인기 메뉴
    const menusResult = await pool.query(`
        SELECT menu_text, SUM(order_count) AS total_orders
        FROM order_stats
        WHERE server_id = $1
        GROUP BY menu_text
        ORDER BY total_orders DESC
        LIMIT 10
    `, [sid]);

    return {
        topOrderers: orderersResult.rows.map(r => ({ name: r.user_name, orders: parseInt(r.total_orders) })),
        popularMenus: menusResult.rows.map(r => ({ menu: r.menu_text, orders: parseInt(r.total_orders) }))
    };
}

// ─── 개인 TOP 메뉴 ───

async function getMyTopOrders(serverId, userName) {
    const pool = getPool();
    if (!pool) return [];

    const sid = serverId || 0;

    const result = await pool.query(`
        SELECT menu_text, order_count
        FROM order_stats
        WHERE server_id = $1 AND user_name = $2
        ORDER BY order_count DESC
        LIMIT 3
    `, [sid, userName]);

    return result.rows.map(r => ({ menu: r.menu_text, count: parseInt(r.order_count) }));
}

// ─── 전체 랭킹 데이터 (API용) ───

async function getFullRanking(serverId, userName, isPrivate) {
    const overall = await getOverallRanking(serverId);
    const dice = await getGameRanking(serverId, 'dice');
    const horseRace = await getHorseRaceStats(serverId);
    const roulette = await getGameRanking(serverId, 'roulette');

    const result = {
        serverType: isPrivate ? 'private' : 'public',
        overall,
        dice,
        horseRace,
        roulette
    };

    // 서버가 있으면 주문 랭킹 포함
    if (serverId) {
        result.orders = {
            ...(await getOrderRanking(serverId)),
            myTopMenus: userName ? await getMyTopOrders(serverId, userName) : []
        };
    } else {
        result.orders = null;
    }

    return result;
}

module.exports = {
    recordOrder,
    getOverallRanking,
    getGameRanking,
    getHorseRaceStats,
    getOrderRanking,
    getMyTopOrders,
    getFullRanking
};
