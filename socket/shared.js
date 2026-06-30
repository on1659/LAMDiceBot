// socket/shared.js
// 공유 게임 기능 핸들러 (주문, 준비, 게임 룰, 자주 쓰는 메뉴)

const { getPool } = require('../db/pool');
const { loadFrequentMenus, getMergedFrequentMenus, saveFrequentMenus } = require('../db/menus');
const { getServerId } = require('../routes/api');
const { recordOrder, getMyOrderedMenus } = require('../db/ranking');
const { recordOrderHistory } = require('../db/order-history');
const { setDefaultOrder, removeDefaultOrder } = require('../db/default-orders');
const { createRoomGameState } = require('../utils/room-helpers');

// updateRange용 레거시 전역 gameState
let gameState = createRoomGameState();

// 랜덤 메뉴 픽 — frequentMenus 풀에서 1개. 공정성 무관(게임 결과 아님)이라 서버 Math.random 허용
function pickRandomMenu(gameState) {
    const pool = Array.isArray(gameState.frequentMenus) ? gameState.frequentMenus : [];
    if (pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
}

// 디폴트 주문 적용값 결정 (startOrder/triggerAutoOrder 공용, sync)
// mode=random이면 매번 풀에서 랜덤, fixed면 저장된 menuText
function resolveDefaultOrder(gameState, userName) {
    const def = gameState.userDefaultOrders[userName];
    if (!def) return '';
    if (def.mode === 'random') return pickRandomMenu(gameState);
    return def.menuText || '';
}

module.exports = function setupSharedHandlers(socket, io, ctx) {
    const { checkRateLimit, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const pool = getPool();

    // 게임 종료 시 자동 주문 트리거 (최초 1회만)
    function triggerAutoOrder(gameState, room) {
        if (gameState.orderAutoTriggered || gameState.isOrderActive) return;
        gameState.orderAutoTriggered = true;
        gameState.isOrderActive = true;
        gameState.userOrders = {};
        gameState.users.forEach(u => {
            gameState.userOrders[u.name] = resolveDefaultOrder(gameState, u.name);
        });
        // 자동 채움 주문은 통계에 기록하지 않음 (사용자 직접 저장만 기록)
        io.to(room.roomId).emit('orderStarted');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
    }
    ctx.triggerAutoOrder = triggerAutoOrder;

    // 사다리타기 빌드 동기화 — 준비 변동 시 현재 빌드 상태를 재브로드캐스트(빌드 정합성 유지).
    // vibe 메커니즘: 빌드(칸/라벨/막대기)는 협업이라 ready 무관 → 준비 취소가 협업 막대기를 삭제하지 않는다.
    //   (removedUserName 인자는 호환 위해 받지만 사용하지 않음 — 준비취소로 빌드 상태를 깨지 않는다.)
    // 빌드(phase idle)에서만 동작. 막대기/색 정리는 실제 이탈(leaveRoom / disconnect)에서만 한다.
    function syncLadderBuildOnReadyChange(gameState, room, removedUserName) {
        if (!room || room.gameType !== 'ladder' || !gameState.ladder) return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        // 트림·브로드캐스트는 ladder.js 단일 소스(emitLadderRungsUpdated)로. 협업 막대기는 보존.
        if (ctx.emitLadderRungsUpdated) ctx.emitLadderRungsUpdated(room, gameState);
    }

    // 주문받기 시작
    socket.on('startOrder', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 시작할 수 있습니다!');
            return;
        }

        gameState.isOrderActive = true;
        // 주문받기 시작 시 기존 주문 초기화 + 비공개 서버 디폴트 캐시 적용 (고정/랜덤 모드)
        gameState.userOrders = {};
        gameState.users.forEach(u => {
            gameState.userOrders[u.name] = resolveDefaultOrder(gameState, u.name);
        });
        // 자동 채움 주문은 통계에 기록하지 않음 (사용자 직접 저장만 기록)

        io.to(room.roomId).emit('orderStarted');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        console.log(`방 ${room.roomName}에서 주문받기 시작`);
    });

    // 주문받기 종료
    socket.on('endOrder', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 종료할 수 있습니다!');
            return;
        }

        gameState.isOrderActive = false;
        io.to(room.roomId).emit('orderEnded');
        console.log(`방 ${room.roomName}에서 주문받기 종료`);
    });

    // 주문 업데이트
    socket.on('updateOrder', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { userName, order } = data;

        // 주문받기 활성화 확인
        if (!gameState.isOrderActive) {
            socket.emit('orderError', '주문받기가 시작되지 않았습니다!');
            return;
        }

        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            console.log(`주문 실패: 사용자를 찾을 수 없음. socket.id: ${socket.id}, userName: ${userName}`);
            socket.emit('orderError', '사용자를 찾을 수 없습니다!');
            return;
        }

        const trimmedUserName = userName ? userName.trim() : '';
        if (user.name !== trimmedUserName) {
            console.log(`주문 실패: 사용자 이름 불일치. user.name: ${user.name}, userName: ${trimmedUserName}`);
            socket.emit('orderError', `잘못된 사용자입니다! (${user.name} vs ${trimmedUserName})`);
            return;
        }

        // 입력값 검증
        if (typeof order !== 'string') {
            socket.emit('orderError', '올바른 주문을 입력해주세요!');
            return;
        }

        // 주문 길이 제한
        if (order.length > 100) {
            socket.emit('orderError', '주문은 100자 이하로 입력해주세요!');
            return;
        }

        // userOrders가 없으면 초기화
        if (!gameState.userOrders) {
            gameState.userOrders = {};
        }

        // 주문 저장 (userName은 이미 trimmedUserName으로 검증됨)
        const trimmedOrder = order.trim();
        gameState.userOrders[trimmedUserName] = trimmedOrder;

        // 비공개서버: 주문 통계 DB 기록
        if (room.serverId && trimmedOrder) {
            recordOrder(room.serverId, trimmedUserName, trimmedOrder);
            recordOrderHistory(room.serverId, trimmedUserName, trimmedOrder, { gameType: room.gameType, source: 'manual_update' });
        }

        // 같은 방의 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);

        socket.emit('orderUpdated', { order: order.trim() });
        console.log(`방 ${room.roomName}: ${trimmedUserName}의 주문 저장 성공: ${order.trim() || '(삭제됨)'}`);
    });

    // 본인 디폴트 주문 조회 (방 진입 후 클라이언트가 호출 — 캐시에서 응답)
    // enabled = 비공개 서버 여부 → 클라가 별 아이콘 표시 제어
    socket.on('getDefaultOrder', () => {
        if (!checkRateLimit()) return;
        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const def = gameState.userDefaultOrders[user.name] || null;
        socket.emit('defaultOrderUpdated', {
            menu: def && def.mode === 'fixed' ? def.menuText : null,
            mode: def ? def.mode : null,
            enabled: !!room.serverId
        });
    });

    // 본인이 주문한 적 있는 메뉴 목록 조회 (디폴트 모달 고정 메뉴 선택 풀, order_stats 기반)
    socket.on('getMyOrderedMenus', async () => {
        if (!checkRateLimit()) return;
        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        if (!room.serverId) { socket.emit('myOrderedMenusUpdated', []); return; }
        const menus = await getMyOrderedMenus(room.serverId, user.name);
        socket.emit('myOrderedMenusUpdated', menus);
    });

    // 디폴트 주문 설정 — DB 저장 + 캐시 갱신 (비공개 서버 전용). { menu, mode }
    socket.on('setDefaultOrder', async (data) => {
        if (!checkRateLimit()) return;
        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        if (!room.serverId) {
            socket.emit('orderError', '자유 플레이 방에서는 디폴트 주문을 사용할 수 없습니다. 서버 방으로 입장해주세요!');
            return;
        }
        const mode = (data && data.mode === 'random') ? 'random' : 'fixed';
        let menu = '';
        if (mode === 'fixed') {
            menu = (data && typeof data.menu === 'string') ? data.menu.trim() : '';
            if (!menu) {
                socket.emit('orderError', '디폴트로 저장할 메뉴를 입력해주세요!');
                return;
            }
            if (menu.length > 100) {
                socket.emit('orderError', '주문은 100자 이하로 입력해주세요!');
                return;
            }
        }
        if (await setDefaultOrder(room.serverId, user.name, menu, mode)) {
            gameState.userDefaultOrders[user.name] = { menuText: menu, mode };
            socket.emit('defaultOrderUpdated', { menu: mode === 'fixed' ? menu : null, mode, enabled: true });
        } else {
            socket.emit('orderError', '디폴트 주문 저장에 실패했습니다!');
        }
    });

    // 디폴트 주문 해제 — DB 삭제 + 캐시 제거 (enabled는 비공개 서버이므로 유지)
    socket.on('removeDefaultOrder', async () => {
        if (!checkRateLimit()) return;
        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !room.serverId) return;
        if (await removeDefaultOrder(room.serverId, user.name)) {
            delete gameState.userDefaultOrders[user.name];
            socket.emit('defaultOrderUpdated', { menu: null, mode: null, enabled: true });
        } else {
            socket.emit('orderError', '디폴트 주문 해제에 실패했습니다!');
        }
    });


    // 개인 주사위 설정 업데이트 (최소값은 항상 1)
    socket.on('updateUserDiceSettings', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { userName, max } = data;

        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('settingsError', '잘못된 사용자입니다!');
            return;
        }

        // 입력값 검증
        if (typeof max !== 'number' || max < 2 || max > 100000) {
            socket.emit('settingsError', '올바른 범위를 입력해주세요! (2~100000)');
            return;
        }

        // 설정 저장 (최소값은 항상 1)
        gameState.userDiceSettings[userName] = {
            max: Math.floor(max)
        };

        socket.emit('settingsUpdated', gameState.userDiceSettings[userName]);
        console.log(`${userName}의 주사위 설정 변경: 1 ~ ${max}`);
    });

    // 주사위 범위 업데이트 (전역 - 하위 호환성)
    socket.on('updateRange', (range) => {
        if (!checkRateLimit()) return;

        // 입력값 검증
        if (typeof range !== 'number' || range < 2 || range > 10000) {
            socket.emit('rangeError', '주사위 범위는 2 이상 10000 이하로 설정해주세요!');
            return;
        }

        gameState.diceMax = Math.floor(range);
        io.emit('rangeUpdated', gameState.diceMax);
        console.log('주사위 범위 변경:', gameState.diceMax);
    });

    // 게임 룰 업데이트 (호스트만, 게임 시작 전만 가능)
    socket.on('updateGameRules', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 룰을 수정할 수 있습니다!');
            return;
        }

        // 게임 시작 후 수정 불가
        if (gameState.isGameActive) {
            socket.emit('rulesError', '게임이 진행 중이면 룰을 수정할 수 없습니다!');
            return;
        }

        const { rules } = data;

        // 입력값 검증
        if (typeof rules !== 'string') {
            socket.emit('rulesError', '올바른 룰을 입력해주세요!');
            return;
        }

        // 룰 길이 제한
        if (rules.length > 500) {
            socket.emit('rulesError', '룰은 500자 이하로 입력해주세요!');
            return;
        }

        // 룰 저장
        gameState.gameRules = rules.trim();

        // 경마 게임인 경우 horseRaceMode도 업데이트
        if (room.gameType === 'horse-race') {
            const rulesLower = rules.trim().toLowerCase();
            if (rulesLower.includes('1등') || rulesLower.includes('first')) {
                gameState.horseRaceMode = 'first';
            } else if (rulesLower.includes('꼴등') || rulesLower.includes('last')) {
                gameState.horseRaceMode = 'last';
            }
        }

        // 같은 방의 모든 클라이언트에게 업데이트된 룰 전송
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        // 호스트에게 저장 성공 메시지 전송
        const rulesText = gameState.gameRules || '(룰 없음)';
        socket.emit('rulesSaved', `${rulesText} 룰이 적용되었습니다.`);

    });

    // 준비 상태 토글
    socket.on('toggleReady', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // 게임 진행 중이면 준비 상태 변경 불가
        if (gameState.isGameActive) {
            socket.emit('readyError', '게임이 진행 중일 때는 준비 상태를 변경할 수 없습니다!');
            return;
        }

        // 사다리타기 전용 게이트(크로스게임 무영향 — ladder일 때만 동작):
        // 사다리는 isGameActive를 켜지 않고 ld.phase로 진행을 추적한다(phase 집합: idle | revealing | finished).
        // 공개 연출(revealing) 도중의 stray toggleReady가 readyUsers를 흔들면 카운트/시작 게이트와 어긋나므로 무시한다.
        // idle(빌드)·finished(결과창)에서는 허용. (selecting phase는 폐기됨.)
        if (room.gameType === 'ladder' && gameState.ladder
            && gameState.ladder.phase !== 'idle' && gameState.ladder.phase !== 'finished') {
            socket.emit('readyError', '사다리 진행 중에는 준비 상태를 바꿀 수 없어요. 결과가 끝난 뒤 다시 시도해주세요.');
            return;
        }

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('readyError', '사용자를 찾을 수 없습니다!');
            return;
        }

        const userName = user.name;
        const isReady = gameState.readyUsers.includes(userName);

        if (isReady) {
            // 준비 취소
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== userName);
            socket.emit('readyStateChanged', { isReady: false });

            // 경마 게임: 준비 취소 시 말 선택 + N등 투표 모두 취소
            if (room.gameType === 'horse-race') {
                if (gameState.userHorseBets && gameState.userHorseBets[userName] !== undefined) {
                    delete gameState.userHorseBets[userName];
                    io.to(room.roomId).emit('horseSelectionCancelled', { userName });
                }
                if (gameState.userRankVotes && gameState.userRankVotes[userName] !== undefined) {
                    delete gameState.userRankVotes[userName];
                    io.to(room.roomId).emit('rankVotesUpdated', {
                        userRankVotes: { ...gameState.userRankVotes },
                        maxRank: (gameState.availableHorses || []).length
                    });
                }
            }
        } else {
            // 준비
            gameState.readyUsers.push(userName);
            socket.emit('readyStateChanged', { isReady: true });
        }

        // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

        // 사다리타기: 준비 인원 변동 → 막대기 정리/브로드캐스트 (준비 취소 시 본인 막대기 제거)
        syncLadderBuildOnReadyChange(gameState, room, isReady ? userName : null);

        console.log(`방 ${room.roomName}: ${userName} ${isReady ? '준비 취소' : '준비 완료'} (준비 인원: ${gameState.readyUsers.length}명)`);
    });

    // 호스트가 다른 사용자를 준비 상태로 설정
    socket.on('setUserReady', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 다른 사용자의 준비 상태를 변경할 수 있습니다!');
            return;
        }

        // 게임 진행 중이면 준비 상태 변경 불가
        if (gameState.isGameActive) {
            socket.emit('readyError', '게임이 진행 중일 때는 준비 상태를 변경할 수 없습니다!');
            return;
        }

        const { userName, isReady } = data;

        // 입력값 검증
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('readyError', '올바른 사용자 이름을 입력해주세요!');
            return;
        }

        const trimmedUserName = userName.trim();
        const currentlyReady = gameState.readyUsers.includes(trimmedUserName);

        if (isReady && !currentlyReady) {
            // 준비 상태로 설정 - 방에 있는지 확인 필요
            const targetUser = gameState.users.find(u => u.name === trimmedUserName);
            if (!targetUser) {
                socket.emit('readyError', '해당 사용자를 찾을 수 없습니다!');
                return;
            }
            gameState.readyUsers.push(trimmedUserName);

            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

            // 대상 사용자에게도 준비 상태 변경 알림
            const targetSocket = io.sockets.sockets.get(targetUser.id);
            if (targetSocket) {
                targetSocket.emit('readyStateChanged', { isReady: isReady });
            }
        } else if (!isReady && currentlyReady) {
            // 준비 취소 - 방에 없어도 제거 가능
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== trimmedUserName);

            // 경마 게임: 호스트가 강제 unready 시킨 사용자의 말 선택 + N등 투표도 정리
            if (room.gameType === 'horse-race') {
                if (gameState.userHorseBets && gameState.userHorseBets[trimmedUserName] !== undefined) {
                    delete gameState.userHorseBets[trimmedUserName];
                    io.to(room.roomId).emit('horseSelectionCancelled', { userName: trimmedUserName });
                }
                if (gameState.userRankVotes && gameState.userRankVotes[trimmedUserName] !== undefined) {
                    delete gameState.userRankVotes[trimmedUserName];
                    io.to(room.roomId).emit('rankVotesUpdated', {
                        userRankVotes: { ...gameState.userRankVotes },
                        maxRank: (gameState.availableHorses || []).length
                    });
                }
            }

            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

            // 대상 사용자가 방에 있으면 알림 전송
            const targetUser = gameState.users.find(u => u.name === trimmedUserName);
            if (targetUser) {
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) {
                    targetSocket.emit('readyStateChanged', { isReady: isReady });
                }
            }
        } else {
            // 상태 변경이 없는 경우 (이미 준비 상태이거나 이미 준비 취소 상태)
            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트 (동기화를 위해)
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        }

        // 사다리타기: 호스트 강제 준비 취소 시 해당 유저 막대기 제거 + 인원 변동 동기화
        syncLadderBuildOnReadyChange(gameState, room, (!isReady && currentlyReady) ? trimmedUserName : null);

        console.log(`방 ${room.roomName}: 호스트가 ${trimmedUserName}을(를) ${isReady ? '준비 상태로' : '준비 취소로'} 설정 (준비 인원: ${gameState.readyUsers.length}명)`);
    });

    // 자주 쓰는 메뉴 목록 가져오기
    socket.on('getFrequentMenus', () => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        socket.emit('frequentMenusUpdated', gameState.frequentMenus);
    });

    // 자주 쓰는 메뉴 추가
    socket.on('addFrequentMenu', async (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { menu } = data;

        // 입력값 검증
        if (!menu || typeof menu !== 'string' || menu.trim().length === 0) {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }

        const menuTrimmed = menu.trim();

        // 중복 체크
        if (gameState.frequentMenus.includes(menuTrimmed)) {
            socket.emit('menuError', '이미 등록된 메뉴입니다!');
            return;
        }

        const serverId = getServerId();
        if (pool) {
            try {
                await pool.query(
                    'INSERT INTO frequent_menus (server_id, menu_text) VALUES ($1, $2) ON CONFLICT (server_id, menu_text) DO NOTHING',
                    [serverId, menuTrimmed]
                );
                gameState.frequentMenus.push(menuTrimmed);
                io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
                console.log(`방 ${room.roomName} 메뉴 추가:`, menuTrimmed);
            } catch (e) {
                console.warn('frequent_menus insert:', e.message);
                socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
            }
        } else {
            gameState.frequentMenus.push(menuTrimmed);
            if (await saveFrequentMenus(gameState.frequentMenus)) {
                io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
                console.log(`방 ${room.roomName} 메뉴 추가:`, menuTrimmed);
            } else {
                socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
                gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menuTrimmed);
            }
        }
    });

    // 자주 쓰는 메뉴 삭제
    socket.on('deleteFrequentMenu', async (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { menu } = data;

        // 입력값 검증
        if (!menu || typeof menu !== 'string') {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }

        const beforeLength = gameState.frequentMenus.length;
        gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menu);

        if (gameState.frequentMenus.length === beforeLength) {
            socket.emit('menuError', '존재하지 않는 메뉴입니다!');
            return;
        }

        const serverId = getServerId();
        if (pool) {
            try {
                await pool.query('DELETE FROM frequent_menus WHERE server_id = $1 AND menu_text = $2', [serverId, menu]);
                io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
                console.log(`방 ${room.roomName} 메뉴 삭제:`, menu);
            } catch (e) {
                console.warn('frequent_menus delete:', e.message);
                gameState.frequentMenus = await getMergedFrequentMenus(serverId);
                io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
            }
        } else {
            if (await saveFrequentMenus(gameState.frequentMenus)) {
                io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
                console.log(`방 ${room.roomName} 메뉴 삭제:`, menu);
            } else {
                socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
                gameState.frequentMenus = loadFrequentMenus();
            }
        }
    });
};
