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

// 본인이 주문한 적 있는 메뉴 목록 (order_stats 기반, 많이 주문한 순)
async function getMyOrderedMenus(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId || !userName) return [];
    try {
        const res = await pool.query(
            'SELECT menu_text FROM order_stats WHERE server_id = $1 AND user_name = $2 ORDER BY order_count DESC, menu_text ASC',
            [serverId, userName]
        );
        return (res.rows || []).map(r => r.menu_text);
    } catch (e) {
        console.warn('order_stats 조회:', e.message);
        return [];
    }
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

    // vehicle_stats는 배포 전역 누적 테이블 (server_id는 VARCHAR).
    // 기록은 recordVehicleRaceResult(getServerId(), ...) = process.env.SERVER_ID||'default' 키로만 쌓이므로,
    // 방/멤버십 serverId로 조회하면 항상 비어 있다 → 기록과 동일한 배포 전역 키로 읽는다 (구 탈것 통계 모달과 동일 동작).
    const vehicleServerId = process.env.SERVER_ID || 'default';
    const vehicleResult = await pool.query(`
        SELECT vehicle_id, appearance_count, pick_count,
               rank_1, rank_2, rank_3, rank_4, rank_5, rank_6
        FROM vehicle_stats
        WHERE server_id = $1 AND appearance_count > 0
        ORDER BY rank_1 DESC, appearance_count DESC
    `, [vehicleServerId]);

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

// ─── 특정 유저 랭킹 (동점 시 같은 등수, 내 랭킹/검색용) ───

async function getMyRank(serverId, userName) {
    const pool = getPool();
    if (!pool || !userName) return null;

    const condition = serverId ? 'server_id = $1' : 'server_id IS NULL';
    const params = serverId ? [serverId, userName] : [userName];
    const userParam = serverId ? '$2' : '$1';

    const result = { overall: {}, dice: {}, horse: {}, roulette: {} };

    // overall: mostPlayed (games DESC)
    const mostPlayedRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) AS games
            FROM server_game_records WHERE ${condition} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, games, DENSE_RANK() OVER (ORDER BY games DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.games
        FROM ranked r WHERE r.user_name = ${userParam}
    `, params);
    if (mostPlayedRow.rows[0]) {
        const r = mostPlayedRow.rows[0];
        result.overall.mostPlayed = { rank: parseInt(r.rank), total: parseInt(r.total), games: parseInt(r.games) };
    }

    // overall: mostWins (wins DESC)
    const mostWinsRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records WHERE ${condition} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, wins, DENSE_RANK() OVER (ORDER BY wins DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.wins FROM ranked r WHERE r.user_name = ${userParam}
    `, params);
    if (mostWinsRow.rows[0]) {
        const r = mostWinsRow.rows[0];
        result.overall.mostWins = { rank: parseInt(r.rank), total: parseInt(r.total), wins: parseInt(r.wins) };
    }

    // overall: winRate (5게임+)
    const winRateRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) AS games, COUNT(*) FILTER (WHERE is_winner = true) AS wins,
                CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE is_winner = true)::numeric / COUNT(*) * 100, 1) ELSE 0 END AS win_rate
            FROM server_game_records WHERE ${condition} GROUP BY user_name HAVING COUNT(*) >= 5
        ),
        ranked AS (SELECT user_name, win_rate, DENSE_RANK() OVER (ORDER BY win_rate DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.win_rate FROM ranked r WHERE r.user_name = ${userParam}
    `, params);
    if (winRateRow.rows[0]) {
        const r = winRateRow.rows[0];
        result.overall.winRate = { rank: parseInt(r.rank), total: parseInt(r.total), winRate: parseFloat(r.win_rate) };
    }

    // overall: avgRank
    const avgRankRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, ROUND(AVG(game_rank) FILTER (WHERE game_rank IS NOT NULL), 1) AS avg_rank
            FROM server_game_records WHERE ${condition} GROUP BY user_name
            HAVING AVG(game_rank) FILTER (WHERE game_rank IS NOT NULL) IS NOT NULL
        ),
        ranked AS (SELECT user_name, avg_rank, DENSE_RANK() OVER (ORDER BY avg_rank ASC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.avg_rank FROM ranked r WHERE r.user_name = ${userParam}
    `, params);
    if (avgRankRow.rows[0]) {
        const r = avgRankRow.rows[0];
        result.overall.avgRank = { rank: parseInt(r.rank), total: parseInt(r.total), avgRank: parseFloat(r.avg_rank) };
    }

    // game type param
    const typeParams = serverId ? [serverId, userName, 'dice'] : [userName, 'dice'];
    const typeUserParam = serverId ? '$2' : '$1';
    const typeCond = serverId ? 'server_id = $1 AND game_type = $3' : 'server_id IS NULL AND game_type = $2';

    const diceWinsRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records WHERE ${typeCond} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, wins, DENSE_RANK() OVER (ORDER BY wins DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.wins FROM ranked r WHERE r.user_name = ${typeUserParam}
    `, serverId ? [serverId, userName, 'dice'] : [userName, 'dice']);
    if (diceWinsRow.rows[0]) {
        const r = diceWinsRow.rows[0];
        result.dice.wins = { rank: parseInt(r.rank), total: parseInt(r.total), wins: parseInt(r.wins) };
    }

    const diceGamesRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) AS games FROM server_game_records
            WHERE ${serverId ? 'server_id = $1 AND game_type = $3' : 'server_id IS NULL AND game_type = $2'} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, games, DENSE_RANK() OVER (ORDER BY games DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.games FROM ranked r WHERE r.user_name = ${typeUserParam}
    `, serverId ? [serverId, userName, 'dice'] : [userName, 'dice']);
    if (diceGamesRow.rows[0]) {
        const r = diceGamesRow.rows[0];
        result.dice.games = { rank: parseInt(r.rank), total: parseInt(r.total), games: parseInt(r.games) };
    }

    const horseWinsRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records WHERE ${serverId ? 'server_id = $1 AND game_type = $3' : 'server_id IS NULL AND game_type = $2'} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, wins, DENSE_RANK() OVER (ORDER BY wins DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.wins FROM ranked r WHERE r.user_name = ${typeUserParam}
    `, serverId ? [serverId, userName, 'horse'] : [userName, 'horse']);
    if (horseWinsRow.rows[0]) {
        const r = horseWinsRow.rows[0];
        result.horse.wins = { rank: parseInt(r.rank), total: parseInt(r.total), wins: parseInt(r.wins) };
    }

    const rouletteWinsRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records WHERE ${serverId ? 'server_id = $1 AND game_type = $3' : 'server_id IS NULL AND game_type = $2'} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, wins, DENSE_RANK() OVER (ORDER BY wins DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.wins FROM ranked r WHERE r.user_name = ${typeUserParam}
    `, serverId ? [serverId, userName, 'roulette'] : [userName, 'roulette']);
    if (rouletteWinsRow.rows[0]) {
        const r = rouletteWinsRow.rows[0];
        result.roulette.wins = { rank: parseInt(r.rank), total: parseInt(r.total), wins: parseInt(r.wins) };
    }

    const rouletteGamesRow = await pool.query(`
        WITH stats AS (
            SELECT user_name, COUNT(*) AS games
            FROM server_game_records WHERE ${serverId ? 'server_id = $1 AND game_type = $3' : 'server_id IS NULL AND game_type = $2'} GROUP BY user_name
        ),
        ranked AS (SELECT user_name, games, DENSE_RANK() OVER (ORDER BY games DESC) AS rn FROM stats)
        SELECT r.rn AS rank, (SELECT COUNT(*) FROM stats) AS total, r.games FROM ranked r WHERE r.user_name = ${typeUserParam}
    `, serverId ? [serverId, userName, 'roulette'] : [userName, 'roulette']);
    if (rouletteGamesRow.rows[0]) {
        const r = rouletteGamesRow.rows[0];
        result.roulette.games = { rank: parseInt(r.rank), total: parseInt(r.total), games: parseInt(r.games) };
    }

    return result;
}

// ─── TOP 3 배지 조회 (채팅용) ───

/**
 * Get top 3 rankers for all games in a server
 * @param {number} serverId - Server ID (null for free server)
 * @returns {Promise<Object>} { dice: {userName: rank}, horse: {...}, roulette: {...} }
 */
async function getTop3Badges(serverId) {
  if (!serverId) return { dice: {}, horse: {}, roulette: {} };

  const pool = getPool();
  if (!pool) return { dice: {}, horse: {}, roulette: {} };

  const gameTypes = ['dice', 'horse', 'roulette'];
  const result = { dice: {}, horse: {}, roulette: {} };

  for (const gameType of gameTypes) {
    const query = `
      SELECT user_name, rank
      FROM (
        SELECT
          user_name,
          DENSE_RANK() OVER (ORDER BY wins DESC) as rank
        FROM (
          SELECT
            user_name,
            COUNT(*) FILTER (WHERE is_winner = true) as wins
          FROM server_game_records
          WHERE server_id = $1
            AND game_type = $2
          GROUP BY user_name
          HAVING COUNT(*) FILTER (WHERE is_winner = true) > 0
        ) wins_sub
      ) ranked_sub
      WHERE rank <= 3
      ORDER BY rank
    `;

    const { rows } = await pool.query(query, [serverId, gameType]);

    rows.forEach(row => {
      result[gameType][row.user_name] = parseInt(row.rank);
    });
  }

  return result;
}

// ─── 전체 랭킹 데이터 (API용) ───

async function getFullRanking(serverId, userName, isPrivate) {
    const overall = await getOverallRanking(serverId);
    const dice = await getGameRanking(serverId, 'dice');
    const horseRace = await getHorseRaceStats(serverId);
    const roulette = await getGameRanking(serverId, 'roulette');
    const ladder = await getGameRanking(serverId, 'ladder');
    const spinArena = await getGameRanking(serverId, 'spin-arena');
    const pirate = await getGameRanking(serverId, 'pirate');

    const result = {
        serverType: isPrivate ? 'private' : 'public',
        overall,
        dice,
        horseRace,
        roulette,
        ladder,
        'spin-arena': spinArena,
        'pirate': pirate
    };

    if (userName) {
        result.myRank = await getMyRank(serverId, userName);
    }

    // 서버가 있으면 주문 랭킹 포함 (최다 주문자 제외, 인기 메뉴·내 TOP 메뉴만)
    if (serverId) {
        const orderRank = await getOrderRanking(serverId);
        result.orders = {
            popularMenus: orderRank.popularMenus,
            myTopMenus: userName ? await getMyTopOrders(serverId, userName) : []
        };
    } else {
        result.orders = null;
    }

    return result;
}

// ─── 시즌 아카이브 ───

async function startNewSeason(serverId) {
    if (!Number.isInteger(serverId) || serverId <= 0) {
        throw new Error('유효하지 않은 서버 ID');
    }

    const pool = getPool();
    if (!pool) throw new Error('DB 미연결');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 현재 시즌 조회
        const seasonResult = await client.query(
            'SELECT current_season FROM servers WHERE id = $1',
            [serverId]
        );
        const currentSeason = seasonResult.rows[0]?.current_season || 1;

        // 기존 기록을 아카이브로 복사
        await client.query(`
            INSERT INTO season_archives
                (server_id, season, user_name, result, game_type, is_winner,
                 game_session_id, range_min, range_max, game_rules, game_rank, created_at)
            SELECT server_id, $2, user_name, result, game_type, is_winner,
                   game_session_id, range_min, range_max, game_rules, game_rank, created_at
            FROM server_game_records
            WHERE server_id = $1
        `, [serverId, currentSeason]);

        // 현재 기록 삭제
        await client.query(
            'DELETE FROM server_game_records WHERE server_id = $1',
            [serverId]
        );

        // 시즌 번호 증가
        const updateResult = await client.query(
            'UPDATE servers SET current_season = current_season + 1 WHERE id = $1 RETURNING current_season',
            [serverId]
        );

        await client.query('COMMIT');
        return updateResult.rows[0].current_season;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function getCurrentSeason(serverId) {
    const pool = getPool();
    if (!pool) return 1;

    const result = await pool.query(
        'SELECT current_season FROM servers WHERE id = $1',
        [serverId]
    );
    return result.rows[0]?.current_season || 1;
}

async function getSeasonList(serverId) {
    const pool = getPool();
    if (!pool) return [];

    const result = await pool.query(`
        SELECT season,
               COUNT(*) AS game_count,
               MIN(created_at) AS started_at,
               MAX(created_at) AS ended_at
        FROM season_archives
        WHERE server_id = $1
        GROUP BY season
        ORDER BY season DESC
    `, [serverId]);

    return result.rows.map(r => ({
        season: parseInt(r.season),
        gameCount: parseInt(r.game_count),
        startedAt: r.started_at,
        endedAt: r.ended_at
    }));
}

async function getSeasonRanking(serverId, season) {
    const pool = getPool();
    if (!pool) return { mostPlayed: [], mostWins: [], winRate: [], avgRank: [] };

    const result = await pool.query(`
        WITH stats AS (
            SELECT user_name,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE is_winner = true) AS wins,
                ROUND(AVG(game_rank) FILTER (WHERE game_rank IS NOT NULL), 1) AS avg_rank,
                COUNT(*) FILTER (WHERE game_rank IS NOT NULL AND game_rank <= 3) AS top3_count
            FROM season_archives
            WHERE server_id = $1 AND season = $2
            GROUP BY user_name
        )
        SELECT user_name, games, wins, avg_rank, top3_count,
            CASE WHEN games > 0 THEN ROUND(wins::numeric / games * 100, 1) ELSE 0 END AS win_rate
        FROM stats
        ORDER BY games DESC
    `, [serverId, season]);

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

// ─── 날짜별 당첨자 (달력 뷰) ───

// 한 판 = game_session_id 하나. sessionId 없이 기록되는 경로(socket/horse.js 등)가 있어
// NULL은 id로 대체 키를 만든다 — 안 그러면 서로 무관한 기록이 한 판으로 뭉친다.
//
// created_at은 타임존 없는 TIMESTAMP고 배포 호스트 타임존이 이 저장소 어디에도 고정돼 있지 않다.
// 그래서 날짜 경계를 SQL에서 자르지 않는다 (자정 넘긴 판이 전날로 밀림).
// 원본 시각을 그대로 내려보내고 클라이언트가 Asia/Seoul 기준으로 날짜를 묶는다.
const CALENDAR_SESSION_LIMIT = 1000;

// 테이블명은 파라미터화할 수 없어 보간 대신 완성된 쿼리 2개를 상수로 둔다 (사용자 입력 미개입)
const CALENDAR_COLUMNS = `
        COALESCE(game_session_id, 'row:' || id) AS session_key,
        MIN(created_at) AS played_at,
        MIN(game_type) AS game_type,
        COUNT(*) AS participants,
        COALESCE(ARRAY_AGG(user_name ORDER BY user_name) FILTER (WHERE is_winner = true), ARRAY[]::text[]) AS winners`;

const CALENDAR_SQL_LIVE = `
    SELECT ${CALENDAR_COLUMNS}
    FROM server_game_records
    WHERE server_id = $1
    GROUP BY session_key
    ORDER BY played_at DESC
    LIMIT $2
`;

const CALENDAR_SQL_ARCHIVE = `
    SELECT ${CALENDAR_COLUMNS}
    FROM season_archives
    WHERE server_id = $1 AND season = $2
    GROUP BY session_key
    ORDER BY played_at DESC
    LIMIT $3
`;

// season=null → 현재 시즌(라이브 테이블), season=N → 아카이브된 그 시즌
async function getWinnerCalendar(serverId, season) {
    const pool = getPool();
    if (!pool || !serverId) return { sessions: [], truncated: false };

    // 상한을 1건 넘겨 받아 잘렸는지 판단 (조용한 절단 방지)
    const probe = CALENDAR_SESSION_LIMIT + 1;
    const result = season
        ? await pool.query(CALENDAR_SQL_ARCHIVE, [serverId, season, probe])
        : await pool.query(CALENDAR_SQL_LIVE, [serverId, probe]);

    const rows = result.rows;
    return {
        sessions: rows.slice(0, CALENDAR_SESSION_LIMIT).map(r => ({
            playedAt: r.played_at,
            gameType: r.game_type,
            participants: parseInt(r.participants, 10),
            winners: r.winners || []
        })),
        truncated: rows.length > CALENDAR_SESSION_LIMIT
    };
}

module.exports = {
    recordOrder,
    getMyOrderedMenus,
    getOverallRanking,
    getGameRanking,
    getHorseRaceStats,
    getOrderRanking,
    getMyTopOrders,
    getMyRank,
    getFullRanking,
    getTop3Badges,
    startNewSeason,
    getCurrentSeason,
    getSeasonList,
    getSeasonRanking,
    getWinnerCalendar
};
