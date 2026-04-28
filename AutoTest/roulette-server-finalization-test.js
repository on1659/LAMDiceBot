const assert = require('assert');

function installMock(modulePath, exportsValue) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsValue
    };
}

installMock('../db/stats', {
    getVisitorStats: () => ({ todayVisitors: 0, todayPlays: 0, totalPlays: 0 }),
    recordParticipantVisitor: () => {},
    recordGamePlay: () => {}
});

installMock('../db/servers', {
    generateSessionId: () => 'test-session',
    recordGameSession: async () => {},
    recordServerGame: async () => {}
});

installMock('../db/ranking', {
    getTop3Badges: async () => ({})
});

const registerRouletteHandlers = require('../socket/roulette');

class FakeSocket {
    constructor() {
        this.id = 'host-socket';
        this.currentRoomId = 'room-1';
        this.userName = 'Host';
        this.handlers = new Map();
        this.clientEvents = [];
    }

    on(event, handler) {
        this.handlers.set(event, handler);
    }

    emit(event, payload) {
        this.clientEvents.push({ event, payload });
    }

    async trigger(event, payload) {
        const handler = this.handlers.get(event);
        assert(handler, `missing handler: ${event}`);
        return handler(payload);
    }
}

function createFakeIo(roomEvents) {
    return {
        sockets: { sockets: new Map() },
        to(roomId) {
            return {
                emit(event, payload) {
                    roomEvents.push({ roomId, event, payload });
                }
            };
        },
        emit(event, payload) {
            roomEvents.push({ roomId: '*', event, payload });
        }
    };
}

async function main() {
    const { calculateRouletteDisplayDurationMs } = registerRouletteHandlers._test;
    assert.strictEqual(calculateRouletteDisplayDurationMs(10000, 'normal', {}), 7500);
    assert.strictEqual(calculateRouletteDisplayDurationMs(10000, 'bounce', { bounceDuration: 600 }), 8100);
    assert.strictEqual(calculateRouletteDisplayDurationMs(10000, 'slowCrawl', { crawlDuration: 2000 }), 9500);
    assert.strictEqual(calculateRouletteDisplayDurationMs(10000, 'shake', { shakeCount: 2, shakeDuration: 100 }), 8000);
    assert.strictEqual(calculateRouletteDisplayDurationMs(10000, 'nearMiss', {
        teaseDuration: 1200,
        holdDuration: 300,
        recoilDuration: 250,
        settleDuration: 600
    }), 9850);

    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
        const gameState = {
            users: [
                { id: 'host-socket', name: 'Host', isHost: true },
                { id: 'guest-socket', name: 'Guest', isHost: false }
            ],
            readyUsers: ['Host', 'Guest'],
            gamePlayers: [],
            everPlayedUsers: [],
            rouletteHistory: [],
            chatHistory: [],
            isRouletteSpinning: false,
            isGameActive: false,
            orderAutoTriggered: false,
            isOrderActive: false,
            userOrders: {}
        };

        const room = {
            roomId: 'room-1',
            roomName: 'Roulette Test',
            hostId: 'host-socket',
            gameType: 'roulette',
            turboAnimation: true,
            serverId: null,
            gameState
        };

        const rooms = { [room.roomId]: room };
        const roomEvents = [];
        let scheduledTimer = null;
        let updateRoomsListCalls = 0;
        let autoOrderCalls = 0;

        const ctx = {
            rooms,
            rouletteResultGraceMs: 10,
            checkRateLimit: () => true,
            getCurrentRoom: () => room,
            getCurrentRoomGameState: () => gameState,
            updateRoomsList: () => { updateRoomsListCalls++; },
            triggerAutoOrder: () => { autoOrderCalls++; },
            setTimeout(fn, delay) {
                scheduledTimer = { fn, delay, cleared: false };
                return scheduledTimer;
            },
            clearTimeout(timer) {
                if (timer) timer.cleared = true;
            }
        };

        const socket = new FakeSocket();
        const io = createFakeIo(roomEvents);
        registerRouletteHandlers(socket, io, ctx);

        await socket.trigger('startRoulette');

        const startedEvent = roomEvents.find(e => e.event === 'rouletteStarted');
        assert(startedEvent, 'rouletteStarted should be emitted');
        assert(startedEvent.payload.roundId, 'rouletteStarted should include roundId');
        assert.strictEqual(startedEvent.payload.winner, 'Host');
        assert.strictEqual(startedEvent.payload.displayDurationMs, 7500);
        assert.strictEqual(startedEvent.payload.resultGraceMs, 10);
        assert.strictEqual(gameState.isRouletteSpinning, true);
        assert.strictEqual(gameState.isGameActive, true);
        assert(gameState.pendingRouletteRound, 'pending roulette round should be stored');
        assert(scheduledTimer && scheduledTimer.delay > 0, 'server finalization timer should be scheduled');

        await socket.trigger('rouletteResult', {
            roundId: startedEvent.payload.roundId,
            winner: 'Guest'
        });
        assert(!roomEvents.some(e => e.event === 'rouletteEnded'), 'wrong client winner must not finalize');
        assert.strictEqual(gameState.isRouletteSpinning, true);

        await socket.trigger('rouletteResult', {
            roundId: startedEvent.payload.roundId,
            winner: startedEvent.payload.winner
        });
        assert(gameState.pendingRouletteRound.clientResultReceivedAt, 'matching client result should be noted');
        assert(!roomEvents.some(e => e.event === 'rouletteEnded'), 'matching client result should not bypass server timer');

        scheduledTimer.fn();

        const endedEvent = roomEvents.find(e => e.event === 'rouletteEnded');
        assert(endedEvent, 'server timer should emit rouletteEnded');
        assert.strictEqual(endedEvent.payload.winner, 'Host');
        assert.strictEqual(endedEvent.payload.roundId, startedEvent.payload.roundId);
        assert.strictEqual(endedEvent.payload.finalizedBy, 'serverTimer');
        assert.strictEqual(gameState.isRouletteSpinning, false);
        assert.strictEqual(gameState.isGameActive, false);
        assert.deepStrictEqual(gameState.readyUsers, []);
        assert.strictEqual(gameState.pendingRouletteRound, null);
        assert(autoOrderCalls >= 1, 'auto order hook should run after finalization');
        assert(updateRoomsListCalls >= 2, 'rooms list should update on start and finalization');

        console.log('PASS roulette server finalization automation');
    } finally {
        Math.random = originalRandom;
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
