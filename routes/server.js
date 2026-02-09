// Server HTTP API 라우트
const express = require('express');
const router = express.Router();
const { generateAdminToken, verifyAdminToken } = require('../utils/auth');
const {
    getServers, getServerById, deleteServer,
    getMembers, updateMemberApproval, removeMember, checkMember,
    getServerRecords, comparePassword
} = require('../db/servers');
const { getOnlineMembers } = require('../socket/server');

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
    const { password } = req.body || {};
    const token = generateAdminToken(password);
    if (!token) {
        return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
    }
    res.json({ token });
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

        const success = await removeMember(serverId, userName);
        if (!success) return res.status(404).json({ error: '멤버를 찾을 수 없습니다.' });
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
