// Server 소켓 이벤트 핸들러
const {
    createServer, getServers, getServerById, joinServer,
    getMembers, updateMemberApproval, removeMember, checkMember, updateLastSeen,
    getServerRecords
} = require('../db/servers');

// 온라인 멤버 추적 (인메모리)
// Map<serverId, Map<userName, socketId>>
const onlineMembers = new Map();

function registerServerHandlers(socket, io, ctx) {
    const { checkRateLimit } = ctx;

    // 서버 생성
    socket.on('createServer', async (data) => {
        if (!checkRateLimit()) return;
        const { name, description, hostName, password } = data || {};

        if (!name || !hostName) {
            socket.emit('serverError', '서버 이름과 호스트 이름은 필수입니다.');
            return;
        }
        if (name.length > 100 || hostName.length > 50) {
            socket.emit('serverError', '이름이 너무 깁니다.');
            return;
        }

        try {
            const hostId = socket.deviceId || socket.id;
            const result = await createServer({ name, description, hostId, hostName, password });

            if (result.error) {
                socket.emit('serverError', result.error);
                return;
            }

            socket.emit('serverCreated', {
                id: result.server.id,
                name: result.server.name,
                hostName: result.server.host_name
            });

            // 전체에게 서버 목록 갱신 알림
            const servers = await getServers();
            io.emit('serversList', servers);
        } catch (e) {
            console.error('서버 생성 오류:', e.message);
            socket.emit('serverError', '서버 생성 중 오류가 발생했습니다.');
        }
    });

    // 서버 목록 요청
    socket.on('getServers', async (data) => {
        if (!checkRateLimit()) return;
        try {
            const userName = (data && data.userName) || socket.serverUserName || null;
            const servers = await getServers({ userName });
            socket.emit('serversList', servers);
        } catch (e) {
            console.error('서버 목록 오류:', e.message);
            socket.emit('serverError', '서버 목록 조회 중 오류가 발생했습니다.');
        }
    });

    // 서버 입장
    socket.on('joinServer', async (data) => {
        if (!checkRateLimit()) return;
        const { serverId, userName, password } = data || {};

        if (!serverId || !userName) {
            socket.emit('serverError', '서버 ID와 이름은 필수입니다.');
            return;
        }

        try {
            const result = await joinServer(serverId, userName, password);

            if (result.error) {
                socket.emit('serverError', result.error);
                return;
            }

            // 소켓에 서버 정보 저장
            socket.serverId = serverId;
            socket.serverUserName = userName;

            // 온라인 멤버 등록
            if (!onlineMembers.has(serverId)) {
                onlineMembers.set(serverId, new Map());
            }
            onlineMembers.get(serverId).set(userName, socket.id);

            // Socket.IO 룸 조인 (서버 단위 알림용)
            socket.join(`server:${serverId}`);

            const server = await getServerById(serverId);
            if (!server) {
                socket.emit('serverError', '서버 정보를 찾을 수 없습니다.');
                return;
            }
            socket.emit('serverJoined', {
                id: server.id,
                name: server.name,
                hostName: server.host_name,
                description: server.description,
                alreadyMember: result.alreadyMember || false
            });

            // 서버 내 멤버에게 접속 알림
            io.to(`server:${serverId}`).emit('memberUpdated', {
                type: 'online',
                userName,
                serverId
            });
        } catch (e) {
            console.error('서버 입장 오류:', e.message);
            socket.emit('serverError', '서버 입장 중 오류가 발생했습니다.');
        }
    });

    // 서버 퇴장
    socket.on('leaveServer', () => {
        handleServerLeave(socket, io);
    });

    // 현재 서버 ID 설정
    socket.on('setServerId', (data) => {
        if (!checkRateLimit()) return;
        const { serverId } = data || {};
        if (serverId) {
            socket.serverId = serverId;
        }
    });

    // 서버 게임 기록 요청
    socket.on('getServerRecords', async (data) => {
        if (!checkRateLimit()) return;
        const { serverId, limit, offset, gameType } = data || {};

        if (!serverId) {
            socket.emit('serverError', '서버 ID가 필요합니다.');
            return;
        }

        try {
            const result = await getServerRecords(serverId, { limit, offset, gameType });
            socket.emit('serverRecords', result);
        } catch (e) {
            console.error('서버 기록 조회 오류:', e.message);
            socket.emit('serverError', '기록 조회 중 오류가 발생했습니다.');
        }
    });

    // 연결 해제 시 온라인 멤버에서 제거
    socket.on('disconnect', () => {
        handleServerLeave(socket, io);
    });
}

function handleServerLeave(socket, io) {
    const { serverId, serverUserName } = socket;
    if (!serverId || !serverUserName) return;

    // 온라인 멤버에서 제거
    const serverOnline = onlineMembers.get(serverId);
    if (serverOnline) {
        // 같은 소켓인 경우에만 제거 (다른 탭에서 접속 중일 수 있음)
        if (serverOnline.get(serverUserName) === socket.id) {
            serverOnline.delete(serverUserName);
        }
        if (serverOnline.size === 0) onlineMembers.delete(serverId);
    }

    // last_seen 업데이트
    updateLastSeen(serverId, serverUserName);

    socket.leave(`server:${serverId}`);

    io.to(`server:${serverId}`).emit('memberUpdated', {
        type: 'offline',
        userName: serverUserName,
        serverId
    });

    socket.serverId = null;
    socket.serverUserName = null;
}

function getOnlineMembers(serverId) {
    const serverOnline = onlineMembers.get(serverId);
    return serverOnline ? Array.from(serverOnline.keys()) : [];
}

function getSocketIdByUser(serverId, userName) {
    const serverOnline = onlineMembers.get(Number(serverId));
    return serverOnline ? serverOnline.get(userName) : null;
}

module.exports = { registerServerHandlers, getOnlineMembers, getSocketIdByUser };
