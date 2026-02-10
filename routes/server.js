// Server HTTP API 라우트
const express = require('express');
const router = express.Router();
const { generateAdminToken, verifyAdminToken } = require('../utils/auth');
const {
    getServers, getServerById, deleteServer, getMyServers,
    getMembers, updateMemberApproval, removeMember, checkMember,
    getServerRecords, comparePassword
} = require('../db/servers');
const { register: authRegister, login: authLogin } = require('../db/auth');
const { getOnlineMembers, getSocketIdByUser } = require('../socket/server');

// Rate Limiting (Server API 전용)
let rateLimit;
try {
    rateLimit = require('express-rate-limit');
} catch (e) {
    // express-rate-limit 없으면 패스스루
}

if (rateLimit) {
    const serverApiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { error: 'Too many requests' }
    });
    router.use(serverApiLimiter);
}

// 관리자 인증 미들웨어
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!verifyAdminToken(token)) {
        return res.status(401).json({ error: '관리자 인증이 필요합니다.' });
    }
    next();
}

// :id 파라미터 유효성 검증 미들웨어
router.param('id', (req, res, next, val) => {
    const id = parseInt(val);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: '유효하지 않은 서버 ID입니다.' });
    }
    req.serverId = id;
    next();
});

// ─── 관리자 API ───

// 관리자 인증
router.post('/admin/verify', (req, res) => {
    const { id, password } = req.body || {};
    const token = generateAdminToken(id, password);
    if (!token) {
        return res.status(401).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
    res.json({ token });
});

// ─── 유저 인증 API ───

router.post('/auth/register', async (req, res) => {
    try {
        const { name, pin } = req.body || {};
        const result = await authRegister(name, pin);
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ user: result.user });
    } catch (e) {
        res.status(500).json({ error: '회원가입 실패' });
    }
});

router.post('/auth/login', async (req, res) => {
    try {
        const { name, pin } = req.body || {};
        const result = await authLogin(name, pin);
        if (result.error) return res.status(401).json({ error: result.error });
        res.json({ user: result.user });
    } catch (e) {
        res.status(500).json({ error: '로그인 실패' });
    }
});

// 전체 서버 목록 (관리자)
router.get('/admin/servers', adminAuth, async (req, res) => {
    try {
        const servers = await getServers({ activeOnly: false });
        res.json(servers);
    } catch (e) {
        res.status(500).json({ error: '서버 목록 조회 실패' });
    }
});

// 서버 삭제 (관리자)
router.delete('/admin/servers/:id', adminAuth, async (req, res) => {
    try {
        const success = await deleteServer(req.serverId);
        if (!success) return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '서버 삭제 실패' });
    }
});

// 유저 목록 (관리자)
router.get('/admin/users', adminAuth, async (req, res) => {
    try {
        const { getPool } = require('../db/pool');
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'DB 미연결' });
        const result = await pool.query('SELECT id, name, is_admin, created_at, last_login_at FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: '유저 목록 조회 실패' });
    }
});

// 유저 삭제 (관리자)
router.delete('/admin/users/:id', adminAuth, async (req, res) => {
    try {
        const { getPool } = require('../db/pool');
        const pool = getPool();
        if (!pool) return res.status(503).json({ error: 'DB 미연결' });
        const userId = parseInt(req.params.id);
        if (isNaN(userId) || userId <= 0) return res.status(400).json({ error: '유효하지 않은 유저 ID' });
        // 유저의 서버 멤버십도 삭제
        const user = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
        if (user.rows.length > 0) {
            await pool.query('DELETE FROM server_members WHERE user_name = $1', [user.rows[0].name]);
        }
        const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        if (result.rowCount === 0) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '유저 삭제 실패' });
    }
});

// ─── 내 서버 관리 API ───

// 내가 만든 서버 목록
router.get('/my-servers', async (req, res) => {
    try {
        const { userName } = req.query;
        if (!userName) return res.status(400).json({ error: 'userName 필요' });
        const servers = await getMyServers(userName);
        res.json(servers);
    } catch (e) {
        res.status(500).json({ error: '내 서버 목록 조회 실패' });
    }
});

// 호스트가 자기 서버 삭제
router.delete('/my-servers/:id', async (req, res) => {
    try {
        const server = await getServerById(req.serverId);
        if (!server) return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
        const { userName } = req.body || {};
        if (server.host_name !== userName) {
            return res.status(403).json({ error: '서버 호스트만 삭제할 수 있습니다.' });
        }
        const success = await deleteServer(req.serverId);
        if (!success) return res.status(500).json({ error: '삭제 실패' });

        // 서버 룸 전체에 삭제 알림
        const io = req.app.get('io');
        if (io) {
            io.to(`server:${req.serverId}`).emit('serverDeleted', { serverId: req.serverId, serverName: server.name });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '서버 삭제 실패' });
    }
});

// ─── 서버/멤버 API ───

// 서버 정보
router.get('/server/:id/info', async (req, res) => {
    try {
        const server = await getServerById(req.serverId);
        if (!server) return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
        res.json({
            id: server.id,
            name: server.name,
            description: server.description,
            hostName: server.host_name,
            isPrivate: !!server.password_hash,
            createdAt: server.created_at
        });
    } catch (e) {
        res.status(500).json({ error: '서버 정보 조회 실패' });
    }
});

// 멤버 상태 확인
router.get('/server/:id/check-member', async (req, res) => {
    try {
        const { userName } = req.query;
        if (!userName) return res.status(400).json({ error: 'userName 필요' });
        const member = await checkMember(req.serverId, userName);
        res.json({ isMember: !!member, isApproved: member?.is_approved || false });
    } catch (e) {
        res.status(500).json({ error: '멤버 확인 실패' });
    }
});

// 멤버 목록
router.get('/server/:id/members', async (req, res) => {
    try {
        const serverId = req.serverId;
        const members = await getMembers(serverId);
        const online = getOnlineMembers(serverId);
        const membersWithStatus = members.map(m => ({
            ...m,
            isOnline: online.includes(m.user_name)
        }));
        res.json(membersWithStatus);
    } catch (e) {
        res.status(500).json({ error: '멤버 목록 조회 실패' });
    }
});

// 멤버 승인/거절 (호스트 전용)
router.post('/server/:id/members/:name/approve', async (req, res) => {
    try {
        const serverId = req.serverId;
        const userName = req.params.name;
        const { isApproved, hostId } = req.body || {};

        // 호스트 확인
        const server = await getServerById(serverId);
        if (!server) return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
        if (server.host_id !== hostId) {
            return res.status(403).json({ error: '서버 호스트만 멤버를 관리할 수 있습니다.' });
        }

        const success = await updateMemberApproval(serverId, userName, isApproved);
        if (!success) return res.status(404).json({ error: '멤버를 찾을 수 없습니다.' });

        // 실시간 알림: 대상 유저 소켓에 승인/거절 이벤트 emit
        const io = req.app.get('io');
        if (io) {
            const targetSocketId = getSocketIdByUser(serverId, userName);
            const eventName = isApproved ? 'serverApproved' : 'serverRejected';
            const payload = { serverId, serverName: server.name };
            if (targetSocketId) {
                io.to(targetSocketId).emit(eventName, payload);
            }
            // 서버 룸 전체에 멤버 변경 알림
            io.to(`server:${serverId}`).emit('memberUpdated', {
                type: isApproved ? 'approved' : 'rejected',
                userName,
                serverId
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '멤버 상태 변경 실패' });
    }
});

// 멤버 강퇴 (호스트 전용)
router.delete('/server/:id/members/:name', async (req, res) => {
    try {
        const serverId = req.serverId;
        const userName = req.params.name;
        const { hostId } = req.body || {};

        const server = await getServerById(serverId);
        if (!server) return res.status(404).json({ error: '서버를 찾을 수 없습니다.' });
        if (server.host_id !== hostId) {
            return res.status(403).json({ error: '서버 호스트만 멤버를 강퇴할 수 있습니다.' });
        }

        // 강퇴 전 소켓 ID 확보 (멤버 삭제 후엔 찾을 수 없으므로)
        const io = req.app.get('io');
        const targetSocketId = io ? getSocketIdByUser(serverId, userName) : null;

        const success = await removeMember(serverId, userName);
        if (!success) return res.status(404).json({ error: '멤버를 찾을 수 없습니다.' });

        // 실시간 알림: 대상 유저 소켓에 강퇴 이벤트 emit
        if (io) {
            if (targetSocketId) {
                io.to(targetSocketId).emit('serverKicked', { serverId, serverName: server.name });
            }
            io.to(`server:${serverId}`).emit('memberUpdated', {
                type: 'kicked',
                userName,
                serverId
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '멤버 강퇴 실패' });
    }
});

// 게임 기록 조회
router.get('/server/:id/records', async (req, res) => {
    try {
        const serverId = req.serverId;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const gameType = req.query.gameType;

        const result = await getServerRecords(serverId, { limit, offset, gameType });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: '기록 조회 실패' });
    }
});

module.exports = router;
