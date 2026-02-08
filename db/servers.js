// Server CRUD 함수
const { getPool } = require('./pool');
const crypto = require('crypto');

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
    if (bcrypt) return bcrypt.hash(password, SALT_ROUNDS);
    return password; // bcrypt 없으면 평문
}

async function comparePassword(password, hash) {
    if (!password && !hash) return true;
    if (!password || !hash) return false;
    if (bcrypt) return bcrypt.compare(password, hash);
    return password === hash; // bcrypt 없으면 평문 비교
}

function generateHostCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase(); // 8자리 16진수
}

// ─── Server CRUD ───

async function createServer({ name, description, hostId, hostName, password }) {
    const pool = getPool();
    if (!pool) return { error: 'DB 미연결' };

    const passwordHash = await hashPassword(password);
    const hostCode = generateHostCode();

    const result = await pool.query(
        `INSERT INTO servers (name, description, host_id, host_name, password_hash, host_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, host_name, host_code, created_at`,
        [name, description || '', hostId, hostName, passwordHash, hostCode]
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

async function getServers({ activeOnly = true } = {}) {
    const pool = getPool();
    if (!pool) return [];

    const query = activeOnly
        ? `SELECT s.id, s.name, s.description, s.host_name, s.created_at,
           (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND sm.is_approved = true) AS member_count,
           CASE WHEN s.password_hash != '' THEN true ELSE false END AS is_private
           FROM servers s WHERE s.is_active = true ORDER BY s.created_at DESC`
        : `SELECT s.id, s.name, s.description, s.host_name, s.created_at, s.is_active,
           (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND sm.is_approved = true) AS member_count
           FROM servers s ORDER BY s.created_at DESC`;

    const result = await pool.query(query);
    return result.rows;
}

async function getServerById(serverId) {
    const pool = getPool();
    if (!pool) return null;

    const result = await pool.query(
        `SELECT id, name, description, host_id, host_name, password_hash, host_code, created_at, is_active
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

module.exports = {
    createServer, getServers, getServerById, deleteServer,
    joinServer, getMembers, updateMemberApproval, removeMember, checkMember, updateLastSeen,
    recordServerGame, getServerRecords,
    comparePassword
};
