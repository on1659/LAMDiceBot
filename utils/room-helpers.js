// 방 관리 유틸리티
const crypto = require('crypto');
const { loadFrequentMenus } = require('../db/menus');
const { releaseShortcode } = require('./shortcode');

function generateRoomId() {
    return crypto.randomBytes(4).toString('hex');
}

function generateUniqueUserName(baseName, existingNames) {
    if (!existingNames.includes(baseName)) {
        return baseName;
    }

    const basePattern = /^(.+?)(?:_(\d+))?$/;
    const match = baseName.match(basePattern);
    const cleanBaseName = match ? match[1] : baseName;

    let maxSuffix = 0;
    existingNames.forEach(name => {
        if (name === cleanBaseName) {
            maxSuffix = Math.max(maxSuffix, 0);
        } else if (name.startsWith(cleanBaseName + '_')) {
            const suffix = name.substring(cleanBaseName.length + 1);
            const num = parseInt(suffix, 10);
            if (!isNaN(num)) {
                maxSuffix = Math.max(maxSuffix, num);
            }
        }
    });

    return `${cleanBaseName}_${maxSuffix + 1}`;
}

function createRoomGameState() {
    return {
        users: [],
        isGameActive: false,
        isOrderActive: false,
        orderAutoTriggered: false,
        diceMax: 100,
        history: [],
        rolledUsers: [],
        gamePlayers: [],
        everPlayedUsers: [],
        readyUsers: [],
        userDiceSettings: {},
        userOrders: {},
        userDefaultOrders: {},   // { [userName]: { menuText, mode } } — joinRoom 시 DB에서 로드된 디폴트 캐시 (비공개 서버 전용)
        gameRules: '',
        frequentMenus: loadFrequentMenus(),
        allPlayersRolledMessageSent: false,
        chatHistory: [],
        rouletteHistory: [],
        isRouletteSpinning: false,
        userColors: {},
        horseRaceHistory: [],
        isHorseRaceActive: false,
        availableHorses: [],
        userHorseBets: {},
        userRankVotes: {},        // { [userName]: 1-based rank } — N등 찾기 투표
        targetRank: null,         // 룰렛 결정 결과 등수. null = 'last' fallback
        rouletteResult: null,     // { segments, winningRank, animDurationMs } — 클라 애니용
        horseRankings: [],
        horseRaceMode: 'last',
        craneGameHistory: [],
        isCraneGameActive: false,
        bridgeCross: {
            // history-v1 (오징어게임 방식 + 병렬진행, 2026-04-30) — feat/bridge-cross-history-v1 복원
            phase: 'idle',
            userColorBets: {},
            activeColors: [],
            safeRows: [],
            scenarios: [],
            bettingDeadline: 0,
            bettingTimeout: null,
            endTimeout: null,
            isBridgeCrossActive: false,
            bridgeCrossHistory: [],
            raceRound: 0,
            winnerColor: null,
            passingColors: [],
            winners: []
        },
        ladder: {
            phase: 'idle',          // idle(로비/빌드) | selecting | revealing | finished
            numLanes: 0,
            userRungs: {},          // { [userName]: { c, y, slant } } — 유저가 직접 놓은 막대기(연속 좌표, 가시)
            baseRungs: [],          // server-only [{c,y,slant}] — 숨은 기본 막대기 (reveal까지 비공개)
            rungs: [],              // server-only [{c,y,slant}] — 최종 결합 막대기(y정렬, reveal 시 전송)
            kkwangBottom: -1,
            laneToBottom: [],       // server-only
            losingLane: -1,         // server-only
            userLanes: {},          // { [userName]: laneIndex }
            participants: [],
            revealOrder: [],        // reveal 시 서버가 셔플한 하강 순서 (시각 효과, 결과 무관)
            loser: null,
            ladderHistory: [],
            round: 0,
            isLadderActive: false,
            revealTimeout: null,
            endTimeout: null,
            resetTimeout: null
        },
    };
}

// 방 삭제 헬퍼 — shortcode cleanup 포함
// 모든 `delete rooms[roomId]` 호출 지점에서 이 헬퍼를 사용해야
// /free 발급 shortcode 메모리 누수를 막을 수 있다.
function deleteRoom(rooms, roomId) {
    if (!rooms || !roomId) return;
    const room = rooms[roomId];
    if (room && room.shortcode) {
        releaseShortcode(room.shortcode);
    }
    delete rooms[roomId];
}

module.exports = { generateRoomId, generateUniqueUserName, createRoomGameState, deleteRoom };
