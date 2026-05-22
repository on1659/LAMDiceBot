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
            // 무선택 유리다리 모델 (2026-05-21):
            // phase 계약 — 'idle' | 'crossing' | 'finished' (§12 불변조건)
            phase: 'idle',
            participants: [],          // [{userName, colorIndex}]
            userColors: {},            // {[userName]: colorIndex} — ready phase에서 본인 색 선택
            script: null,              // resolveGame() 결과 (애니 재생 후 폐기)
            loser: null,               // 확정된 꼴등 이름
            raceRound: 0,              // 누적 라운드 번호 (UI 표시, 새로고침 보존)
            bridgeCrossHistory: [],    // 라운드 결과 누적 [{round, loser, completedAt}]
            isBridgeCrossActive: false,
            roundResetTimer: null      // 결과→ready 전환 setTimeout 핸들
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
    // 다리건너기 결과→ready 전환 setTimeout 핸들 정리 (방 삭제 시 고아 타이머 누수 방지)
    const bc = room && room.gameState && room.gameState.bridgeCross;
    if (bc && bc.roundResetTimer) {
        clearTimeout(bc.roundResetTimer);
        bc.roundResetTimer = null;
    }
    delete rooms[roomId];
}

module.exports = { generateRoomId, generateUniqueUserName, createRoomGameState, deleteRoom };
