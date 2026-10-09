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

// ─── 통합 랭킹 (사람 × 게임 집계) ───

// 필터(게임)·정렬·등수·내 순위는 클라가 계산한다 — 서버 멤버 규모라 사람×게임 행을 전부 내려도 작다.
// 테이블명은 파라미터화할 수 없어 보간 대신 완성된 쿼리를 상수로 둔다 (사용자 입력 미개입)
const PLAYER_COLUMNS = `
        user_name, game_type,
        COUNT(*) AS games,
        COUNT(*) FILTER (WHERE is_winner = true) AS wins`;

const PLAYERS_SQL_LIVE = `SELECT ${PLAYER_COLUMNS} FROM server_game_records WHERE server_id = $1 GROUP BY user_name, game_type`;
const PLAYERS_SQL_FREE = `SELECT ${PLAYER_COLUMNS} FROM server_game_records WHERE server_id IS NULL GROUP BY user_name, game_type`;
const PLAYERS_SQL_ARCHIVE = `SELECT ${PLAYER_COLUMNS} FROM season_archives WHERE server_id = $1 AND season = $2 GROUP BY user_name, game_type`;

// serverId=null → 자유 랭킹, season=null → 현재 시즌(라이브 테이블), season=N → 아카이브된 그 시즌
// 반환: [{ name, byGame: { [gameType]: { games, wins } } }]
async function getRankingPlayers(serverId, season) {
    const pool = getPool();
    if (!pool) return [];

    let result;
    if (!serverId) result = await pool.query(PLAYERS_SQL_FREE);
    else if (season) result = await pool.query(PLAYERS_SQL_ARCHIVE, [serverId, season]);
    else result = await pool.query(PLAYERS_SQL_LIVE, [serverId]);

    const byName = new Map();
    result.rows.forEach(r => {
        if (!byName.has(r.user_name)) byName.set(r.user_name, { name: r.user_name, byGame: {} });
        byName.get(r.user_name).byGame[r.game_type] = { games: parseInt(r.games, 10), wins: parseInt(r.wins, 10) };
    });
    return [...byName.values()];
}

// ─── 경마 탈것 등수 분포 ───

async function getVehicleStats() {
    const pool = getPool();
    if (!pool) return [];

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

    return vehicleResult.rows.map(r => ({
        id: r.vehicle_id,
        appearances: parseInt(r.appearance_count),
        picks: parseInt(r.pick_count),
        ranks: [
            parseInt(r.rank_1), parseInt(r.rank_2), parseInt(r.rank_3),
            parseInt(r.rank_4), parseInt(r.rank_5), parseInt(r.rank_6)
        ]
    }));
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
    const result = {
        serverType: isPrivate ? 'private' : 'public',
        players: await getRankingPlayers(serverId, null),
        vehicles: await getVehicleStats()
    };

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
    getRankingPlayers,
    getOrderRanking,
    getMyTopOrders,
    getFullRanking,
    getTop3Badges,
    startNewSeason,
    getCurrentSeason,
    getSeasonList,
    getWinnerCalendar
};
