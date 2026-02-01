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
        horseRankings: [],
        horseRaceMode: 'last',
    };
}

module.exports = { generateRoomId, generateUniqueUserName, createRoomGameState };
