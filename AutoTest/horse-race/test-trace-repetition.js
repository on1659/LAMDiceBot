/**
 * Horse Race — 인접 라운드 signature 일치 비율 검증 (N=1000)
 *
 * 목적:
 *   Codex adversarial 리뷰 가설 검증:
 *   "Chi-square는 marginal counts만 측정 → 같은 trace가 반복되어도 통과.
 *    Evolution이 last 모드에서 결과를 dominate → trace가 deterministic."
 *
 *   인접 라운드 사이에서 race signature가 얼마나 자주 정확히 일치하는지 측정하고
 *   random baseline(50%)과 비교한다.
 *
 * signature 정의:
 *   { horseRankings: [순위별 horseIndex], evolutionTargets: [진화 대상 horseIndex] }
 *   gimmicks에서 evolution type의 progressTrigger도 추출
 *
 * Random baseline 계산:
 *   베팅된 말 2마리(말2, 말4), 나머지는 unbetted_stop → 상위 포지션 결정론적
 *   1등 일치 기댓값 ≈ 50% (말2 vs 말4 중 하나)
 *   horseRankings 정확 일치 기댓값 ≈ 50% (1·2등 순서만 random, 나머지 deterministic)
 *
 * 기반: test-rank-distribution-real.js fake socket/io/ctx 패턴 그대로 사용
 *
 * Usage:
 *   node AutoTest/horse-race/test-trace-repetition.js
 *   node AutoTest/horse-race/test-trace-repetition.js --iterations=500
 */

'use strict';

const path = require('path');

// ── 파라미터 ─────────────────────────────────────────────────────────────────
const ITERATIONS = parseInt(
    process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1000'
);

const FIXED_LINEUP = ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'];
const FIXED_BETS = { host: 2, user2: 4, user3: 4 };

// ── stats 오염 방지 stub (horse.js require 전에 적용) ─────────────────────────
// db/stats.js
const stats = require('../../db/stats');
stats.recordGamePlay         = () => {};
stats.recordParticipantVisitor = () => {};
stats.getVisitorStats        = () => ({});

// db/vehicle-stats.js
const vehicleStats = require('../../db/vehicle-stats');
vehicleStats.recordVehicleRaceResult = async () => {};
vehicleStats.getVehicleStats         = async () => [];

// db/servers.js
const servers = require('../../db/servers');
servers.recordServerGame  = async () => {};
servers.recordGameSession = async () => {};
servers.generateSessionId = () => 'test-session';

// routes/api.js — getServerId만 stub (라우터 등록 부작용 회피)
const apiModule = require('../../routes/api');
if (typeof apiModule.getServerId === 'function') {
    // monkey-patch: getServerId를 null 반환으로 교체
    const apiContainer = require.cache[require.resolve('../../routes/api')];
    if (apiContainer && apiContainer.exports) {
        apiContainer.exports.getServerId = () => null;
    }
}

// db/ranking.js
try {
    const ranking = require('../../db/ranking');
    if (ranking.getTop3Badges)  ranking.getTop3Badges  = async () => [];
    if (ranking.getMyRank)      ranking.getMyRank      = async () => null;
    if (ranking.getFullRanking) ranking.getFullRanking  = async () => [];
} catch (_) {}

// ── setTimeout monkey-patch (4초 카운트다운 즉시 실행) ──────────────────────
const realSetTimeout = global.setTimeout;
global.setTimeout = function(fn, ms, ...args) {
    return realSetTimeout(fn, 0, ...args);
};

// ── console.log suppress ────────────────────────────────────────────────────
const originalConsoleLog  = console.log;
const originalConsoleWarn = console.warn;
console.log  = () => {};
console.warn = () => {};

function log(...args) { originalConsoleLog(...args); }

// ── fake io ──────────────────────────────────────────────────────────────────
let capturedEmits = [];

const fakeIo = {
    sockets: { sockets: new Map() },
    to(roomId) {
        return {
            emit(event, data) {
                capturedEmits.push({ event, data, roomId });
            }
        };
    },
    emit(event, data) {
        capturedEmits.push({ event, data, broadcast: true });
    }
};

// ── gameState 기준값 ─────────────────────────────────────────────────────────
function makeBaseGameState() {
    return {
        users: [
            { id: 'fake-socket-id', name: 'host', isHost: true },
            { id: 'user2-id', name: 'user2', isHost: false },
            { id: 'user3-id', name: 'user3', isHost: false }
        ],
        isHorseRaceActive: false,
        isGameActive: false,
        raceRound: 0,
        horseRaceMode: 'last',
        trackLength: 'medium',
        availableHorses: [0, 1, 2, 3, 4, 5],
        selectedVehicleTypes: [...FIXED_LINEUP],
        userHorseBets: { ...FIXED_BETS },
        readyUsers: ['host', 'user2', 'user3'],
        gamePlayers: [],
        everPlayedUsers: [],
        horseRaceHistory: [],
        chatHistory: [],
        pendingRaceResult: null,
        forcedWeather: null,
        forcePhotoFinish: false,
        horseRaceCountdownTimeout: null,
    };
}

const fakeRoom = {
    roomId: 'fake-room',
    roomName: 'Test Room',
    host: 'host',
    gameType: 'horse-race',
    serverId: null,
};

const gameState = makeBaseGameState();

const fakeCtx = {
    updateRoomsList: () => {},
    getCurrentRoom: () => fakeRoom,
    getCurrentRoomGameState: () => gameState,
    checkRateLimit: () => true,
    triggerAutoOrder: () => {},
    rooms: { 'fake-room': fakeRoom },
};

const fakeSocket = {
    id: 'fake-socket-id',
    username: 'host',
    currentRoomId: 'fake-room',
    isHost: true,
    handlers: {},
    on(event, fn) { this.handlers[event] = fn; },
    emit(event, data) {
        capturedEmits.push({ event, data, target: 'socket' });
    }
};

// ── socket/horse.js 로드 ─────────────────────────────────────────────────────
const horseHandler = require(path.join(__dirname, '..', '..', 'socket', 'horse.js'));
horseHandler(fakeSocket, fakeIo, fakeCtx);

// ── signature 추출 헬퍼 ──────────────────────────────────────────────────────
function extractEvoProgressTriggers(gimmicks, evolutionTargets) {
    // gimmicks: { [horseIndex]: [{type, progressTrigger, ...}, ...] }
    // evolutionTargets: [horseIndex, ...]
    if (!gimmicks || !evolutionTargets || evolutionTargets.length === 0) return [];
    return evolutionTargets.map(hi => {
        const gimList = gimmicks[hi] || [];
        const evo = gimList.find(g => g.type === 'evolution');
        return evo ? parseFloat(evo.progressTrigger.toFixed(3)) : null;
    });
}

// ── 라운드 1회 실행 ──────────────────────────────────────────────────────────
async function runOneRound() {
    capturedEmits = [];

    // gameState 리셋
    gameState.availableHorses        = [0, 1, 2, 3, 4, 5];
    gameState.selectedVehicleTypes   = [...FIXED_LINEUP];
    gameState.userHorseBets          = { ...FIXED_BETS };
    gameState.readyUsers             = ['host', 'user2', 'user3'];
    gameState.isHorseRaceActive      = false;
    gameState.isGameActive           = false;
    gameState.pendingRaceResult      = null;
    gameState.forcedWeather          = null;
    gameState.forcePhotoFinish       = false;

    fakeSocket.id = 'fake-socket-id';
    await fakeSocket.handlers['startHorseRace']();

    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => realSetTimeout(resolve, 10));

    const startedEvent = capturedEmits.find(e => e.event === 'horseRaceStarted');
    if (!startedEvent) return null;

    const d = startedEvent.data;

    // signature 구성
    const sig = {
        horseRankings:       d.horseRankings || [],
        evolutionTargets:    d.evolutionTargets || [],
        evoProgressTriggers: extractEvoProgressTriggers(d.gimmicks, d.evolutionTargets),
    };

    // raceAnimationComplete 호출 (사이클 완성)
    if (fakeSocket.handlers['raceAnimationComplete']) {
        await fakeSocket.handlers['raceAnimationComplete']();
    }
    await new Promise(resolve => setImmediate(resolve));

    return sig;
}

// ── 진행 표시 ─────────────────────────────────────────────────────────────────
function printProgress(done, total) {
    const pct = Math.floor(done / total * 100);
    const bar = '='.repeat(Math.floor(pct / 2)) + '-'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  [${bar}] ${pct}% (${done}/${total})`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function run() {
    log('\n' + '='.repeat(65));
    log(' test-trace-repetition.js — 인접 라운드 signature 일치 비율');
    log('='.repeat(65));
    log(`  트랙: medium (700m) / 반복: ${ITERATIONS}회`);
    log(`  라인업: [${FIXED_LINEUP.join(', ')}]`);
    log(`  베팅: host→말2(bicycle), user2→말4(boat), user3→말4(boat)`);
    log(`  horseRaceMode: last`);
    log('');

    const signatures = [];
    const rankingsCounts = {}; // 각 horseRankings JSON → 출현 횟수
    const matches = { winner: 0, rankings: 0, evoTargets: 0, strict: 0 };
    let nullResults = 0;

    const startTime = Date.now();

    for (let i = 0; i < ITERATIONS; i++) {
        if (i % 50 === 0) printProgress(i, ITERATIONS);

        const sig = await runOneRound();

        if (!sig) {
            nullResults++;
            continue;
        }

        // horseRankings 출현 빈도
        const rkKey = JSON.stringify(sig.horseRankings);
        rankingsCounts[rkKey] = (rankingsCounts[rkKey] || 0) + 1;

        if (signatures.length > 0) {
            const prev = signatures[signatures.length - 1];

            // 1등 동일
            if (sig.horseRankings[0] === prev.horseRankings[0]) matches.winner++;

            // horseRankings 전체 동일
            if (JSON.stringify(sig.horseRankings) === JSON.stringify(prev.horseRankings)) matches.rankings++;

            // evolutionTargets 동일
            if (JSON.stringify(sig.evolutionTargets) === JSON.stringify(prev.evolutionTargets)) matches.evoTargets++;

            // Strict (horseRankings + evolutionTargets + evoProgressTriggers)
            if (
                JSON.stringify(sig.horseRankings)       === JSON.stringify(prev.horseRankings) &&
                JSON.stringify(sig.evolutionTargets)    === JSON.stringify(prev.evolutionTargets) &&
                JSON.stringify(sig.evoProgressTriggers) === JSON.stringify(prev.evoProgressTriggers)
            ) matches.strict++;
        }

        signatures.push(sig);
    }

    printProgress(ITERATIONS, ITERATIONS);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validCount = ITERATIONS - nullResults;
    const total = validCount - 1; // 인접 쌍 수
    log(`\n  완료 (${elapsed}초) / 유효: ${validCount}회 / null: ${nullResults}회\n`);

    if (total <= 0) {
        log('  ERROR: 유효 라운드 부족. 결과 없음.');
        global.setTimeout = realSetTimeout;
        return;
    }

    // ── 일치 비율 출력 ────────────────────────────────────────────────────────
    log(`=== test-trace-repetition.js (evolution 기본 ON, probability=0.6) ===`);
    log(`N = ${total} 인접 쌍\n`);

    log(`[일치 비율]`);
    log(`  1등 동일:                ${matches.winner}/${total} (${(matches.winner/total*100).toFixed(1)}%) — baseline ~50%`);
    log(`  horseRankings 동일:      ${matches.rankings}/${total} (${(matches.rankings/total*100).toFixed(1)}%) — baseline ~50%`);
    log(`  evolutionTargets 동일:   ${matches.evoTargets}/${total} (${(matches.evoTargets/total*100).toFixed(1)}%)`);
    log(`  Strict signature 동일:   ${matches.strict}/${total} (${(matches.strict/total*100).toFixed(1)}%) — baseline ~25-50%`);

    // ── 가장 자주 나오는 horseRankings (상위 5) ───────────────────────────────
    log('');
    log('[가장 자주 나오는 horseRankings]');
    const sortedRankings = Object.entries(rankingsCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    for (const [key, count] of sortedRankings) {
        log(`  ${key}: ${count}회 (${(count / validCount * 100).toFixed(1)}%)`);
    }

    // ── 판정 ─────────────────────────────────────────────────────────────────
    log('');
    log('[판정]');
    const winnerPct  = matches.winner   / total * 100;
    const rankingPct = matches.rankings / total * 100;
    const strictPct  = matches.strict   / total * 100;

    const BASELINE = 50; // %

    function judge(pct, label) {
        const diff = pct - BASELINE;
        if (diff < 5)        return `${label}: ${pct.toFixed(1)}% — 정상 random (baseline 근접)`;
        if (diff < 15)       return `${label}: ${pct.toFixed(1)}% — 약한 deterministic 신호 (+${diff.toFixed(1)}%)`;
        return                      `${label}: ${pct.toFixed(1)}% — 강한 deterministic 신호 (+${diff.toFixed(1)}%) ← Codex 가설 입증`;
    }

    log('  Strict 일치 비율 vs baseline(50%):');
    log(`    < baseline + 5%  → 정상 random`);
    log(`    baseline + 5~15% → 약한 deterministic 신호`);
    log(`    > baseline + 15% → 강한 deterministic 신호 (Codex 가설 입증)`);
    log('');
    log(`  ${judge(winnerPct,  '1등 일치')}`);
    log(`  ${judge(rankingPct, 'horseRankings 일치')}`);
    log(`  ${judge(strictPct,  'Strict 일치')}`);
    log('='.repeat(65));
    log('');

    global.setTimeout = realSetTimeout;
}

run().catch(err => {
    console.error('\n실행 오류:', err);
    global.setTimeout = realSetTimeout;
    process.exit(1);
});
