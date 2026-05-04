// 방 관리 유틸리티
const crypto = require('crypto');
const { loadFrequentMenus } = require('../db/menus');

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
            // user-driven 모델 (2026-04-30):
            // 'idle' | 'ready-wait' | 'playing' | 'finished'
            phase: 'idle',
            // 라운드 데이터 (게임 시작 시 설정)
            participants: [],          // [{userName, colorIndex, mode}]
            safeRows: [],              // server-only, length=6, 'top'|'bottom' — 절대 클라 노출 금지
            brokenRows: [],            // [{top:bool, bottom:bool}] x 6 — 시각용 누적
            currentCol: 0,             // 0~5
            waveDeadline: 0,           // Date.now() + 3000
            pendingChoices: {},        // {[userName]: 'top'|'bottom'}
            waveTimer: null,           // setTimeout handle (wave timeout)
            waveProcessing: false,     // race 가드
            userColors: {},            // {[userName]: colorIndex} — ready phase에서 본인 색 선택
            // 진행 추적
            finishedUsers: [],         // 마지막 col 통과자 = winner
            fallenUsers: [],           // 도중 추락자
            // 호환 / 기존 필드
            isBridgeCrossActive: false,
            bridgeCrossHistory: [],
            raceRound: 0,
            endTimeout: null,
            winners: []
        },
    };
}

module.exports = { generateRoomId, generateUniqueUserName, createRoomGameState };
