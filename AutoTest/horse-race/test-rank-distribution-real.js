/**
 * Horse Race — 1등 horseIndex 분포 편향 검증 (N=1000 실제 코드 직접 호출)
 *
 * 목적:
 *   test-rank-distribution.js의 시뮬 복제 로직 대신
 *   socket/horse.js의 startHorseRace + raceAnimationComplete 핸들러를
 *   실제로 호출해서 결과 분포를 검증.
 *
 *   기존 AutoTest가 복제 로직으로 작동했다면 결과가 같아야 함.
 *   다르다면 복제에 미묘한 차이가 있었으며, 실제 서버의 공정성을 의심할 근거.
 *
 * 검증 조건 (기존 test-rank-distribution.js와 동일):
 *   1. 단일 gameState — 라인업 재사용 (availableHorses/selectedVehicleTypes 동결)
 *   2. selectedVehicleTypes / availableHorses 동결 (Phase 1 비활성 상태 재현)
 *   3. 매 라운드 같은 사용자가 같은 horseIndex에 베팅
 *   4. userHorseBets 매 라운드 유지
 *
 * 주요 차이점 vs test-rank-distribution.js:
 *   - 시뮬 로직 복제 없음 — socket/horse.js 실제 함수 직접 호출
 *   - setTimeout monkey-patch로 4초 카운트다운 즉시 실행
 *   - raceAnimationComplete 핸들러도 호출 (완전한 사이클)
 *
 * Usage:
 *   node AutoTest/horse-race/test-rank-distribution-real.js
 *   node AutoTest/horse-race/test-rank-distribution-real.js --iterations=500
 */

'use strict';

const path = require('path');

// ── 파라미터 ─────────────────────────────────────────────────────────────────
const ITERATIONS = parseInt(
    process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1000'
);

// Railway 로그에서 본 실제 라인업 (기존 test-rank-distribution.js와 동일)
const FIXED_LINEUP = ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'];
const FIXED_BETS = { host: 2, user2: 4, user3: 4 };
// 베팅된 말: {2, 4} / 베팅 안 된 말: {0, 1, 3, 5}
// host→2(bicycle), user2→4(boat), user3→4(boat) → allSameBet=false (unique=[2,4])

// ── setTimeout monkey-patch (4초 카운트다운 즉시 실행) ──────────────────────
const realSetTimeout = global.setTimeout;
global.setTimeout = function(fn, ms, ...args) {
    return realSetTimeout(fn, 0, ...args);
};
// clearTimeout은 그대로 유지

// ── console.log suppress (socket/horse.js 서버 로그 제거) ────────────────────
// 통계 출력은 process.stdout.write 또는 별도 log 함수로 직접 출력
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
console.log = () => {};
console.warn = () => {};
// console.error는 유지 (실제 오류 표시용)

// 결과 출력용 함수
function log(...args) { originalConsoleLog(...args); }

// ── fake io 캡처 구조 ─────────────────────────────────────────────────────────
let capturedEmits = [];

const fakeIo = {
    // recordParticipantVisitor 가 io.sockets.sockets.get(socketId) 호출
    sockets: {
        sockets: new Map()
    },
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

// ── gameState 기준값 (매 라운드 이 값으로 리셋) ────────────────────────────────
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

// ── fake room ─────────────────────────────────────────────────────────────────
const fakeRoom = {
    roomId: 'fake-room',
    roomName: 'Test Room',
    host: 'host',
    gameType: 'horse-race',
    serverId: null,  // DB 기록 스킵
};

// ── gameState (단일 객체, 라운드 간 재사용) ────────────────────────────────────
const gameState = makeBaseGameState();

// ── fake ctx ─────────────────────────────────────────────────────────────────
const fakeCtx = {
    updateRoomsList: () => {},
    getCurrentRoom: () => fakeRoom,
    getCurrentRoomGameState: () => gameState,
    checkRateLimit: () => true,
    triggerAutoOrder: () => {},
    rooms: { 'fake-room': fakeRoom },
};

// ── fake socket ───────────────────────────────────────────────────────────────
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

// ── socket/horse.js 로드 (핸들러 등록) ───────────────────────────────────────
const horseHandler = require(path.join(__dirname, '..', '..', 'socket', 'horse.js'));
horseHandler(fakeSocket, fakeIo, fakeCtx);

// ── 라운드 1회 실행 ────────────────────────────────────────────────────────────
// 반환값: horseRaceStarted 이벤트의 rankings 배열 (객체 배열 [{horseIndex, rank, finishTime}, ...])
async function runOneRound() {
    capturedEmits = [];

    // gameState를 다음 라운드 가능 상태로 리셋
    // (raceAnimationComplete 이후 reshuffleLineup이 lineup을 바꾸므로 수동 복원 필요)
    gameState.availableHorses = [0, 1, 2, 3, 4, 5];
    gameState.selectedVehicleTypes = [...FIXED_LINEUP];
    gameState.userHorseBets = { ...FIXED_BETS };
    gameState.readyUsers = ['host', 'user2', 'user3'];
    gameState.isHorseRaceActive = false;
    gameState.isGameActive = false;
    gameState.pendingRaceResult = null;
    gameState.forcedWeather = null;
    gameState.forcePhotoFinish = false;

    // startHorseRace 호출 (방장이 호출)
    fakeSocket.id = 'fake-socket-id';
    await fakeSocket.handlers['startHorseRace']();

    // setTimeout(fn, 0)으로 patch됐으므로 microtask 다음 틱에 이미 실행됨.
    // 하지만 async startHorseRace 내 await calculateHorseRaceResult가 있으므로
    // 실제 setTimeout 콜백은 calculateHorseRaceResult 완료 후 등록된다.
    // → 한 번의 setImmediate/Promise로 플러시
    await new Promise(resolve => setImmediate(resolve));
    // setTimeout patch 때문에 fn이 realSetTimeout(fn, 0)으로 예약됨.
    // 아직 실행 안 됐을 수 있으므로 한 번 더 flush
    await new Promise(resolve => realSetTimeout(resolve, 10));

    // horseRaceStarted 이벤트 찾기
    const startedEvent = capturedEmits.find(e => e.event === 'horseRaceStarted');
    if (!startedEvent) {
        return null;
    }

    const { rankings } = startedEvent.data;

    // raceAnimationComplete 호출 (사이클 완성 — DB 기록은 serverId=null이라 스킵)
    if (fakeSocket.handlers['raceAnimationComplete']) {
        await fakeSocket.handlers['raceAnimationComplete']();
    }

    // raceAnimationComplete 내 async 작업 flush
    await new Promise(resolve => setImmediate(resolve));

    return rankings;
}

// ── 진행 표시 ─────────────────────────────────────────────────────────────────
function printProgress(done, total) {
    const pct = Math.floor(done / total * 100);
    const bar = '='.repeat(Math.floor(pct / 2)) + '-'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  [${bar}] ${pct}% (${done}/${total})`);
}

// ── 카이제곱 해석 ─────────────────────────────────────────────────────────────
function interpretChi(chi) {
    if (chi < 3.841)  return 'uniform (p > 0.05) — random OK';
    if (chi < 6.635)  return 'weak bias (p < 0.05)';
    if (chi < 10.83)  return 'strong bias (p < 0.01)';
    return                    'very strong bias (p < 0.001) — deterministic suspected';
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function run() {
    log('\n' + '='.repeat(65));
    log(' Horse Race — 실제 socket/horse.js 직접 호출 편향 검증');
    log('='.repeat(65));
    log(`  트랙: medium (700m) / 반복: ${ITERATIONS}회`);
    log(`  라인업: [${FIXED_LINEUP.join(', ')}]`);
    log(`  베팅: host→말2(bicycle), user2→말4(boat), user3→말4(boat)`);
    log(`  방식: socket/horse.js require → fake socket/io/ctx 주입`);
    log(`        setTimeout monkey-patch (4초 → 0ms 즉시 실행)`);
    log('');

    const bettedHorseIndices = new Set(Object.values(FIXED_BETS)); // {2, 4}
    const winnerCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const top2Counts = {};
    const bettedWinCounts = { 2: 0, 4: 0, none: 0 };
    let nullResults = 0;

    const startTime = Date.now();

    for (let i = 0; i < ITERATIONS; i++) {
        if (i % 50 === 0) printProgress(i, ITERATIONS);

        const rankings = await runOneRound();

        if (!rankings || rankings.length === 0) {
            nullResults++;
            continue;
        }

        // rankings: [{horseIndex, rank, finishTime}, ...] sorted by rank
        const firstPlace = rankings[0].horseIndex;
        winnerCounts[firstPlace] = (winnerCounts[firstPlace] || 0) + 1;

        // 꼴등 (베팅된 말 중 rank 최대 = last mode 당첨)
        const bettedRankings = rankings.filter(r => bettedHorseIndices.has(r.horseIndex));
        let lastPlaceHorse = null;
        if (bettedRankings.length > 0) {
            const maxRank = Math.max(...bettedRankings.map(r => r.rank));
            const target = rankings.find(r => r.rank === maxRank);
            lastPlaceHorse = target ? target.horseIndex : null;
        }

        if (lastPlaceHorse === 2)      bettedWinCounts[2]++;
        else if (lastPlaceHorse === 4) bettedWinCounts[4]++;
        else                           bettedWinCounts.none++;

        // 1·2등 쌍
        if (rankings.length >= 2) {
            const top2Key = `${rankings[0].horseIndex}-${rankings[1].horseIndex}`;
            top2Counts[top2Key] = (top2Counts[top2Key] || 0) + 1;
        }
    }

    printProgress(ITERATIONS, ITERATIONS);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validCount = ITERATIONS - nullResults;
    log(`\n  완료 (${elapsed}초) / 유효: ${validCount}회 / null: ${nullResults}회\n`);

    if (nullResults > 0) {
        log(`  ⚠ ${nullResults}회 null 결과 — horseRaceStarted 이벤트 미수신`);
        log(`    setTimeout flush 타이밍 문제일 수 있음\n`);
    }

    // ── 결과 출력 ─────────────────────────────────────────────────────────────
    log('=== 전체 1등 horseIndex 분포 (말 속도 기준) ===');
    for (let idx = 0; idx <= 5; idx++) {
        const count = winnerCounts[idx] || 0;
        const pct = validCount > 0 ? (count / validCount * 100).toFixed(2) : '0.00';
        const isBet = bettedHorseIndices.has(idx);
        const label = isBet ? '✓ 베팅됨' : '✗ unbetted(멈춤)';
        const bar = '#'.repeat(Math.round(count / Math.max(validCount, 1) * 40));
        log(`  말 ${idx} (${FIXED_LINEUP[idx]}): ${String(count).padStart(4)}회 (${pct}%) ${label}`);
        log(`       ${bar}`);
    }

    log('');
    log('=== 꼴등(당첨) 말 분포 — horseRaceMode=last 기준 ===');
    const bettedTotal = bettedWinCounts[2] + bettedWinCounts[4];
    log(`  말 2 (bicycle): ${String(bettedWinCounts[2]).padStart(4)}회 (${(bettedWinCounts[2] / Math.max(validCount, 1) * 100).toFixed(2)}%)`);
    log(`  말 4 (boat):    ${String(bettedWinCounts[4]).padStart(4)}회 (${(bettedWinCounts[4] / Math.max(validCount, 1) * 100).toFixed(2)}%)`);
    log(`  없음(none):     ${String(bettedWinCounts.none).padStart(4)}회 (${(bettedWinCounts.none / Math.max(validCount, 1) * 100).toFixed(2)}%)`);

    // ── 카이제곱 A: 1등 기준 ──────────────────────────────────────────────────
    log('');
    log('=== 카이제곱 검정 A — 1등(속도) 기준, 베팅된 말 [2, 4] ===');
    const bettedFor1st = [2, 4].map(i => winnerCounts[i] || 0);
    const total1st = bettedFor1st.reduce((a, b) => a + b, 0);
    const expected1st = total1st / 2;
    const chi1st = expected1st > 0
        ? bettedFor1st.reduce((sum, obs) => sum + Math.pow(obs - expected1st, 2) / expected1st, 0)
        : 0;
    log(`  말 2 우승: ${winnerCounts[2] || 0}회 / 말 4 우승: ${winnerCounts[4] || 0}회 (합계 ${total1st}회)`);
    log(`  기댓값: ${expected1st.toFixed(1)}회씩`);
    log(`  chi² = ${chi1st.toFixed(3)}  (df=1)`);
    log(`  판정: ${interpretChi(chi1st)}`);

    // ── 카이제곱 B: 꼴등 기준 ────────────────────────────────────────────────
    log('');
    log('=== 카이제곱 검정 B — 꼴등(당첨) 기준, 베팅된 말 [2, 4] ===');
    const expectedLast = bettedTotal / 2;
    const chiLast = expectedLast > 0
        ? [2, 4].reduce((sum, idx) => sum + Math.pow(bettedWinCounts[idx] - expectedLast, 2) / expectedLast, 0)
        : 0;
    log(`  말 2 꼴등: ${bettedWinCounts[2]}회 / 말 4 꼴등: ${bettedWinCounts[4]}회 (합계 ${bettedTotal}회)`);
    log(`  기댓값: ${expectedLast.toFixed(1)}회씩`);
    log(`  chi² = ${chiLast.toFixed(3)}  (df=1)`);
    log(`  판정: ${interpretChi(chiLast)}`);

    // ── 1·2등 쌍 (상위 5개) ──────────────────────────────────────────────────
    log('');
    log('=== 1·2등 horseIndex 쌍 분포 (상위 5개) ===');
    const sortedPairs = Object.entries(top2Counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    if (sortedPairs.length === 0) {
        log('  (데이터 없음)');
    } else {
        for (const [pair, count] of sortedPairs) {
            const [f, s] = pair.split('-').map(Number);
            const fName = FIXED_LINEUP[f] || '?';
            const sName = FIXED_LINEUP[s] || '?';
            log(`  ${pair} (${fName}-${sName}): ${count}회 (${(count / validCount * 100).toFixed(1)}%)`);
        }
    }

    // ── 최종 판정 ─────────────────────────────────────────────────────────────
    log('');
    log('='.repeat(65));
    const maxChi = Math.max(chi1st, chiLast);
    if (validCount < ITERATIONS * 0.9) {
        log(` ⚠ 유효 결과 ${validCount}/${ITERATIONS}회 — null 결과가 많아 신뢰도 낮음`);
    } else if (maxChi < 3.841) {
        log(' 최종 판정: 균등 분포 (p > 0.05)');
        log(' 해석: 진짜 random + 우연. 결정성 편향 없음.');
    } else if (maxChi < 6.635) {
        log(' 최종 판정: 약한 편향 감지 (p < 0.05)');
        log(' 해석: 통계적으로 유의한 편향 존재. 추가 코드 추적 필요.');
    } else if (maxChi < 10.83) {
        log(' 최종 판정: 강한 편향 감지 (p < 0.01)');
        log(' 해석: 결정성 편향 존재 가능성 높음. 즉시 코드 추적 요망.');
    } else {
        log(' 최종 판정: 매우 강한 편향 (p < 0.001)');
        log(' 해석: 명백한 결정성 버그. 즉시 추적 및 수정 필요.');
    }
    log('='.repeat(65));
    log('');

    // setTimeout 복원
    global.setTimeout = realSetTimeout;
}

run().catch(err => {
    console.error('\n실행 오류:', err);
    global.setTimeout = realSetTimeout;
    process.exit(1);
});
