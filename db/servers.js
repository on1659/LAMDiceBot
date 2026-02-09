// Server CRUD 함수
const { getPool } = require('./pool');
// bcrypt는 선택적 (없으면 평문 저장 경고)
let bcrypt = null;
try {
    bcrypt = require('bcrypt');
} catch (e) {
    console.warn('⚠️  bcrypt 미설치. 서버 비밀번호가 평문 저장됩니다. npm install bcrypt');
}

const SALT_ROUNDS = 10;

async function hashPassword(password) {
    if (!password) return '';
    if (bcrypt) {
        try { return await bcrypt.hash(password, SALT_ROUNDS); }
        catch (e) { console.warn('⚠️  bcrypt.hash 실패, 평문 저장:', e.message); }
    }
    return password;
}

async function comparePassword(password, hash) {
    if (!password && !hash) return true;
    if (!password || !hash) return false;
    if (bcrypt) {
        try { return await bcrypt.compare(password, hash); }
        catch (e) { console.warn('⚠️  bcrypt.compare 실패, 평문 비교:', e.message); }
    }
    return password === hash;
}

// ─── Server CRUD ───

async function createServer({ name, description, hostId, hostName, password }) {
    const pool = getPool();
    if (!pool) return { error: 'DB 미연결' };

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
        `INSERT INTO servers (name, description, host_id, host_name, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, host_name, created_at`,
        [name, description || '', hostId, hostName, passwordHash]
    );

    // 호스트를 멤버로 자동 등록
    const server = result.rows[0];
    await pool.query(
        `INSERT INTO server_members (server_id, user_name, is_approved, last_seen_at)
         VALUES ($1, $2, true, NOW())`,
        [server.id, hostName]
    );

    return { server };
}

async function getServers({ activeOnly = true, userName = null } = {}) {
    const pool = getPool();
    if (!pool) return [];

    if (activeOnly) {
        // userName이 있으면 가입 여부(is_member) 포함 + 가입한 서버 상단 정렬
        const query = userName
            ? `SELECT s.id, s.name, s.description, s.host_name, s.created_at,
               (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND sm.is_approved = true) AS member_count,
               CASE WHEN s.password_hash != '' THEN true ELSE false END AS is_private,
               EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id = s.id AND sm.user_name = $1 AND sm.is_approved = true) AS is_member
               FROM servers s WHERE s.is_active = true
               ORDER BY is_member DESC, s.created_at DESC`
            : `SELECT s.id, s.name, s.description, s.host_name, s.created_at,
               (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND sm.is_approved = true) AS member_count,
               CASE WHEN s.password_hash != '' THEN true ELSE false END AS is_private,
               false AS is_member
               FROM servers s WHERE s.is_active = true ORDER BY s.created_at DESC`;

        const result = userName ? await pool.query(query, [userName]) : await pool.query(query);
        return result.rows;
    } else {
        const result = await pool.query(
            `SELECT s.id, s.name, s.description, s.host_name, s.created_at, s.is_active,
             (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND sm.is_approved = true) AS member_count
             FROM servers s ORDER BY s.created_at DESC`
        );
        return result.rows;
    }
}

async function getServerById(serverId) {
    const pool = getPool();
    if (!pool) return null;

    const result = await pool.query(
        `SELECT id, name, description, host_id, host_name, password_hash, created_at, is_active
         FROM servers WHERE id = $1`,
        [serverId]
    );
    return result.rows[0] || null;
}

async function deleteServer(serverId) {
    const pool = getPool();
    if (!pool) return false;

    const result = await pool.query('DELETE FROM servers WHERE id = $1', [serverId]);
    return result.rowCount > 0;
}

// ─── Member 관리 ───

async function joinServer(serverId, userName, password) {
    const pool = getPool();
    if (!pool) return { error: 'DB 미연결' };

    const server = await getServerById(serverId);
    if (!server) return { error: '서버를 찾을 수 없습니다.' };
    if (!server.is_active) return { error: '비활성화된 서버입니다.' };

    // 비밀번호 확인
    if (server.password_hash) {
        const match = await comparePassword(password, server.password_hash);
        if (!match) return { error: '비밀번호가 일치하지 않습니다.' };
    }

    // 이미 멤버인지 확인
    const existing = await pool.query(
        'SELECT id, is_approved FROM server_members WHERE server_id = $1 AND user_name = $2',
        [serverId, userName]
    );

    if (existing.rows.length > 0) {
        // last_seen 업데이트
        await pool.query(
            'UPDATE server_members SET last_seen_at = NOW() WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return { member: existing.rows[0], alreadyMember: true };
    }

    // 새 멤버 등록
    const result = await pool.query(
        `INSERT INTO server_members (server_id, user_name, is_approved, last_seen_at)
         VALUES ($1, $2, true, NOW()) RETURNING id, is_approved`,
        [serverId, userName]
    );

    return { member: result.rows[0] };
}

async function getMembers(serverId) {
    const pool = getPool();
    if (!pool) return [];

    const result = await pool.query(
        `SELECT user_name, is_approved, joined_at, last_seen_at
         FROM server_members WHERE server_id = $1 ORDER BY joined_at ASC`,
        [serverId]
    );
    return result.rows;
}

async function updateMemberApproval(serverId, userName, isApproved) {
    const pool = getPool();
    if (!pool) return false;

    const result = await pool.query(
        'UPDATE server_members SET is_approved = $3 WHERE server_id = $1 AND user_name = $2',
        [serverId, userName, isApproved]
    );
    return result.rowCount > 0;
}

async function removeMember(serverId, userName) {
    const pool = getPool();
    if (!pool) return false;

    const result = await pool.query(
        'DELETE FROM server_members WHERE server_id = $1 AND user_name = $2',
        [serverId, userName]
    );
    return result.rowCount > 0;
}

async function checkMember(serverId, userName) {
    const pool = getPool();
    if (!pool) return null;

    const result = await pool.query(
        'SELECT is_approved FROM server_members WHERE server_id = $1 AND user_name = $2',
        [serverId, userName]
    );
    return result.rows[0] || null;
}

async function updateLastSeen(serverId, userName) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        'UPDATE server_members SET last_seen_at = NOW() WHERE server_id = $1 AND user_name = $2',
        [serverId, userName]
    ).catch(() => {});
}

// ─── Server Game Records ───

async function recordServerGame(serverId, userName, result, gameType, isWinner, gameSessionId) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        `INSERT INTO server_game_records (server_id, user_name, result, game_type, is_winner, game_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [serverId, userName, result, gameType, isWinner, gameSessionId]
    ).catch(e => console.warn('server_game_records insert:', e.message));
}

async function getServerRecords(serverId, { limit = 50, offset = 0, gameType } = {}) {
    const pool = getPool();
    if (!pool) return { records: [], total: 0 };

    let whereClause = 'WHERE server_id = $1';
    const params = [serverId];

    if (gameType) {
        whereClause += ` AND game_type = $${params.length + 1}`;
        params.push(gameType);
    }

    const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM server_game_records ${whereClause}`, params
    );

    const recordsResult = await pool.query(
        `SELECT user_name, result, game_type, is_winner, game_session_id, created_at
         FROM server_game_records ${whereClause}
         ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );

    return {
        records: recordsResult.rows,
        total: parseInt(countResult.rows[0].total, 10)
    };
}

// ─── Game Sessions ───

function generateSessionId(gameType, serverId) {
    return `${gameType}_${serverId || 0}_${Date.now()}`;
}

async function recordGameSession({ serverId, sessionId, gameType, gameRules, winnerName, winnerResult, participantCount }) {
    const pool = getPool();
    if (!pool || !serverId) return null;

    try {
        const result = await pool.query(
            `INSERT INTO game_sessions (server_id, session_id, game_type, game_rules, winner_name, winner_result, participant_count, ended_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING id, session_id`,
            [serverId, sessionId, gameType, gameRules || '', winnerName || null, winnerResult || null, participantCount || 0]
        );
        return result.rows[0];
    } catch (e) {
        console.warn('game_sessions insert:', e.message);
        return null;
    }
}

module.exports = {
    createServer, getServers, getServerById, deleteServer,
    joinServer, getMembers, updateMemberApproval, removeMember, checkMember, updateLastSeen,
    recordServerGame, getServerRecords,
    recordGameSession, generateSessionId,
    comparePassword
};
