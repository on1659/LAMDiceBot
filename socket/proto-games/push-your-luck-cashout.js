// -----------------------------------------------------------------------------
// push-your-luck-cashout — 계속하기 눈덩이 베팅 (v2: 1회 업프론트 입력 + 완전 자동 진행)
//
// 업프론트 입력(1회, 매치 시작 전에만): 플레이스타일 하나를 고른다 — 안전형/균형형/공격형.
// 고르지 않고 호스트가 시작하면 균형형이 기본값으로 자동 배정된다.
// 이 플레이스타일은 매치 내내 서버가 매 라운드 자동으로 따르는 고정 정책이다:
//   - 안전형: 2라운드 성공 시 자동 캐시아웃
//   - 균형형: 4라운드 성공 시, 또는 이번 라운드 생존율이 약 60% 미만으로 떨어지면 그 전에 자동 캐시아웃
//   - 공격형: 탈락하거나 라운드 상한(HARD_ROUND_CAP)에 도달할 때까지 항상 계속
// 매치가 시작되면 그 다음부터는 플레이어 입력이 전혀 없다 — 서버가 라운드 타이머로
// 자동 진행하며(crypto 판정), 매 라운드 결과를 방 전체에 동시 공개한다.
// 모든 플레이어가 캐시아웃/탈락으로 정산되면 게임 종료, 확정 점수 내림차순으로 순위를 매긴다.
//
// socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 는 사용하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'push-your-luck-cashout';

// ─── 라운드/정책 상수 (상단 const 블록) ───
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const BASE_ELIMINATION_CHANCE = 0.08; // 1라운드 탈락 확률 8%
const ELIMINATION_STEP = 0.04;        // 라운드마다 +4%p
const ELIMINATION_CAP = 0.72;         // 최대 72%로 상한
const BASE_GROWTH = 0.25;             // 1라운드 생존 시 배율 +25%
const GROWTH_STEP = 0.03;             // 라운드마다 성장폭 +3%p
const HARD_ROUND_CAP = 10;            // 공격형 안전장치: 이 라운드에서 강제 정산
const ROLL_PRECISION = 1000000;       // crypto.randomInt 정밀도

const SAFE_CASHOUT_ROUNDS = 2;        // 안전형: 이 라운드 수만큼 성공하면 자동 캐시아웃
const BALANCED_CASHOUT_ROUNDS = 4;    // 균형형: 이 라운드 수만큼 성공하면 자동 캐시아웃
const BALANCED_MIN_SURVIVAL_ODDS = 0.6; // 균형형: 이번 라운드 생존율이 이 아래로 떨어지면 조기 캐시아웃

const ROUND_START_DELAY_MS = 1200; // 매치 시작 → 첫 라운드 판정까지 대기 (연출용)
const ROUND_TICK_MS = 1800;        // 라운드 사이 대기 (연출용)

const VALID_STYLES = ['safe', 'balanced', 'aggressive'];
const DEFAULT_STYLE = 'balanced';

function getRoundOdds(round) {
    const eliminationChance = Math.min(
        BASE_ELIMINATION_CHANCE + (round - 1) * ELIMINATION_STEP,
        ELIMINATION_CAP
    );
    const growthFactor = 1 + BASE_GROWTH + (round - 1) * GROWTH_STEP;
    return { eliminationChance, growthFactor };
}

function rollEliminated(chance) {
    const threshold = Math.round(chance * ROLL_PRECISION);
    const roll = crypto.randomInt(ROLL_PRECISION); // [0, ROLL_PRECISION)
    return roll < threshold;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// 플레이어의 고정 정책이 "이번 라운드를 시도할지" 아니면 "지금 멈출지"를 결정한다.
// 순수 함수 — 결과는 정책 + 지금까지 성공 라운드 수 + 이번 라운드 배당(odds)에만 의존한다.
function decidePolicyAction(player, odds) {
    if (player.policy === 'safe') {
        return player.roundsSurvived >= SAFE_CASHOUT_ROUNDS ? 'cashout' : 'push';
    }
    if (player.policy === 'balanced') {
        if (player.roundsSurvived >= BALANCED_CASHOUT_ROUNDS) return 'cashout';
        const survivalOdds = 1 - odds.eliminationChance;
        if (survivalOdds < BALANCED_MIN_SURVIVAL_ODDS) return 'cashout';
        return 'push';
    }
    // aggressive: 하드 캡 전까지 항상 계속
    return 'push';
}

module.exports = (socket, nsp, ctx) => {
    const { checkRateLimit, getRoom } = ctx;

    function buildStatePayload(room) {
        const state = room.pushYourLuck;
        const odds = getRoundOdds(state.round);
        return {
            phase: state.phase,
            round: state.round,
            eliminationChance: odds.eliminationChance,
            growthFactor: odds.growthFactor,
            activePlayers: state.activePlayers.map((p) => ({
                name: p.name,
                multiplier: round2(p.multiplier),
                policy: p.policy,
                roundsSurvived: p.roundsSurvived
            })),
            finished: state.finished
                .map((f) => ({ name: f.name, score: round2(f.score), status: f.status, round: f.round }))
                .sort((a, b) => b.score - a.score)
        };
    }

    function broadcastState(room) {
        nsp.to(room.code).emit('proto:push-your-luck:state', buildStatePayload(room));
    }

    function finishGame(room) {
        const state = room.pushYourLuck;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        state.phase = 'finished';
        state.activePlayers = [];
        const ranking = state.finished
            .map((f) => ({ name: f.name, score: round2(f.score), status: f.status }))
            .sort((a, b) => b.score - a.score);
        nsp.to(room.code).emit('proto:push-your-luck:gameOver', { ranking });
    }

    // 매 라운드 자동 판정. 라운드 타이머(setTimeout)로 호출되며 플레이어 입력을 기다리지 않는다.
    function resolveRound(room) {
        // 스케줄된 시점 사이에 방이 사라졌을 수 있다 (전원 퇴장 등) — 방어적 가드.
        if (!room || ctx.rooms[room.code] !== room) return;
        const state = room.pushYourLuck;
        if (!state || state.phase !== 'playing') return;

        // ─── disconnect 안전장치: 판정 전에 현재 접속 중인 room.players 기준으로 걸러낸다 ───
        const connectedIds = new Set(room.players.map((p) => p.socketId));
        const stillActive = [];
        let prunedCount = 0;
        state.activePlayers.forEach((p) => {
            if (connectedIds.has(p.socketId)) {
                stillActive.push(p);
            } else {
                prunedCount++;
                state.finished.push({ name: p.name, score: 0, status: 'disconnected', round: state.round });
            }
        });
        state.activePlayers = stillActive;

        // disconnect로 인해 실제 접속 중인 인원이 1명만 남았다면, 더 위험을 태우지 않고 즉시 승자로 확정한다.
        if (prunedCount > 0 && state.activePlayers.length === 1) {
            const winner = state.activePlayers[0];
            state.finished.push({ name: winner.name, score: round2(winner.multiplier), status: 'cashed', round: state.round });
            state.activePlayers = [];
            finishGame(room);
            return;
        }
        if (state.activePlayers.length === 0) {
            finishGame(room);
            return;
        }

        // ─── 각 플레이어의 고정 정책에 따라 자동 판정 ───
        const round = state.round;
        const odds = getRoundOdds(round);
        const results = [];
        const survivors = [];

        state.activePlayers.forEach((p) => {
            const action = decidePolicyAction(p, odds);
            if (action === 'cashout') {
                state.finished.push({ name: p.name, score: round2(p.multiplier), status: 'cashed', round });
                results.push({
                    name: p.name,
                    action: 'cashout',
                    multiplierBefore: round2(p.multiplier),
                    multiplierAfter: round2(p.multiplier),
                    eliminated: false
                });
                return;
            }

            const eliminated = rollEliminated(odds.eliminationChance);
            if (eliminated) {
                state.finished.push({ name: p.name, score: 0, status: 'eliminated', round });
                results.push({
                    name: p.name,
                    action: 'push',
                    multiplierBefore: round2(p.multiplier),
                    multiplierAfter: 0,
                    eliminated: true
                });
            } else {
                const before = p.multiplier;
                p.multiplier = p.multiplier * odds.growthFactor;
                p.roundsSurvived += 1;
                survivors.push(p);
                results.push({
                    name: p.name,
                    action: 'push',
                    multiplierBefore: round2(before),
                    multiplierAfter: round2(p.multiplier),
                    eliminated: false
                });
            }
        });

        state.activePlayers = survivors;

        nsp.to(room.code).emit('proto:push-your-luck:roundResult', {
            round,
            eliminationChance: odds.eliminationChance,
            growthFactor: odds.growthFactor,
            results
        });

        if (survivors.length === 0) {
            finishGame(room);
            return;
        }

        if (round >= HARD_ROUND_CAP) {
            // 안전장치: 라운드 상한 도달 시 남은 인원(공격형 등)은 현재 배율로 강제 정산
            survivors.forEach((p) => {
                state.finished.push({ name: p.name, score: round2(p.multiplier), status: 'cashed', round });
            });
            state.activePlayers = [];
            finishGame(room);
            return;
        }

        state.round = round + 1;
        broadcastState(room);
        state.timer = setTimeout(() => resolveRound(room), ROUND_TICK_MS);
    }

    // 유일한 업프론트 입력: 매치 시작 전에 플레이스타일을 1회 제출한다.
    // 이미 제출한 플레이어의 재제출은 거부한다. 매치가 진행 중이면(phase === 'playing') 거부한다.
    socket.on('proto:push-your-luck:pickStyle', (data) => {
        if (!checkRateLimit()) return;
        const room = getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        if (room.pushYourLuck && room.pushYourLuck.phase === 'playing') return; // 진행 중에는 입력 불가

        const style = data && data.style;
        if (VALID_STYLES.indexOf(style) === -1) return;

        room.pushYourLuckPicks = room.pushYourLuckPicks || {};
        if (room.pushYourLuckPicks[socket.id]) return; // 이미 제출함 — 재제출 거부

        room.pushYourLuckPicks[socket.id] = style;

        // 선택 "내용"은 시작 전까지 비공개 — 누가 선택을 마쳤는지 진행률만 공개(v1의 decided 플래그와 동일 원칙)
        const pickedCount = room.players.filter((p) => !!room.pushYourLuckPicks[p.socketId]).length;
        nsp.to(room.code).emit('proto:push-your-luck:pickStatus', {
            pickedCount,
            totalCount: room.players.length
        });
    });

    socket.on('proto:push-your-luck:start', () => {
        if (!checkRateLimit()) return;
        const room = getRoom();
        if (!room || room.gameSlug !== SLUG) return;

        if (!socket.protoIsHost) {
            socket.emit('proto:push-your-luck:error', { message: '호스트만 게임을 시작할 수 있습니다.' });
            return;
        }
        if (room.pushYourLuck && room.pushYourLuck.phase === 'playing') return; // 이미 진행 중

        const playerCount = room.players.length;
        if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
            socket.emit('proto:push-your-luck:error', {
                message: `이 게임은 ${MIN_PLAYERS}~${MAX_PLAYERS}명이 필요합니다. (현재 ${playerCount}명)`
            });
            return;
        }

        const picks = room.pushYourLuckPicks || {};
        room.pushYourLuck = {
            phase: 'playing',
            round: 1,
            activePlayers: room.players.map((p) => ({
                socketId: p.socketId,
                name: p.name,
                multiplier: 1,
                policy: picks[p.socketId] || DEFAULT_STYLE, // 미선택자는 균형형 자동 배정
                roundsSurvived: 0
            })),
            finished: [],
            timer: null
        };
        room.pushYourLuckPicks = {}; // 다음 매치(재시작) 때 다시 고를 수 있도록 초기화

        broadcastState(room);
        room.pushYourLuck.timer = setTimeout(() => resolveRound(room), ROUND_START_DELAY_MS);
    });

    // 연결 종료 시: 대기 중이던 픽 제거 + 진행 중인 매치라면 이 소켓을 즉시 탈락 처리한다.
    // proto-hub.js의 기본 disconnect 핸들러가 먼저 등록되어 room.players 정리와
    // 방 삭제/호스트 이관을 이미 처리하므로, 여기서는 room.pushYourLuck에 남은
    // activePlayers 잔여물만 청소한다. getRoom()은 이미 socket.protoRoomCode가
    // null로 초기화된 뒤라 쓸 수 없어 ctx.rooms 전체를 훑어 찾는다.
    socket.on('disconnect', () => {
        for (const code in ctx.rooms) {
            const room = ctx.rooms[code];
            if (!room || room.gameSlug !== SLUG) continue;

            if (room.pushYourLuckPicks) delete room.pushYourLuckPicks[socket.id];

            const state = room.pushYourLuck;
            if (!state || state.phase !== 'playing') break;

            const idx = state.activePlayers.findIndex((p) => p.socketId === socket.id);
            if (idx === -1) break;

            const [gone] = state.activePlayers.splice(idx, 1);
            state.finished.push({ name: gone.name, score: 0, status: 'disconnected', round: state.round });

            // disconnect로 인해 실제 접속 중인 인원이 1명만 남았다면 즉시 승자로 확정한다.
            if (state.activePlayers.length === 1) {
                const winner = state.activePlayers[0];
                state.finished.push({ name: winner.name, score: round2(winner.multiplier), status: 'cashed', round: state.round });
                state.activePlayers = [];
                finishGame(room);
            } else if (state.activePlayers.length === 0) {
                finishGame(room);
            } else {
                broadcastState(room);
            }
            break; // 소켓은 한 번에 하나의 방에만 속함
        }
    });
};
