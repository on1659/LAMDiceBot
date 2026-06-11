// 회전 칼날(spin-arena) 게임 소켓 핸들러
// ladder.js / horse.js 패턴 차용. 결과는 서버에서만 결정(결정론 시드 PRNG), 클라는 리플레이만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 공유 상수 (js/spin-arena.js 상단과 반드시 동일 값) ───
// ─ 아레나(논리 좌표 고정, CSS 반응형) ─
const ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240;
const ARENA_R = 220;              // 바깥벽 반경

// ─ 슬롯/인원 (봇 없음 — 사람 n=2~6 가변) ─
const MAX_SLOTS = 6;              // 최대 참가 슬롯(준비 선착 6명)
const SPIN_MIN_PLAYERS = 2;

// ─ 시간축 ─
const GAME_MS = 30000;
const COUNTDOWN_MS = 4000;        // 클라 3-2-1-START 카운트다운 실측(1000ms×4) — js/spin-arena.js 와 동일 값
const SIM_DT_MS = 20;             // 내부 시뮬 스텝(50fps)
const SAMPLE_MS = 100;            // 키프레임 샘플 간격 → frames 길이 = GAME_MS/SAMPLE_MS + 1 = 301
const SIM_YIELD_EVERY = 100;      // 이 스텝마다 await setImmediate (CPU 양보)

// ─ 캐릭터/칼날 ─
const CHAR_RADIUS = 14;
const BLADE_COUNT = 2;            // 시작 칼날 수
const BLADE_COUNT_MAX = 5;        // 킬당 +1 상한
const BLADE_RADIUS = 46;          // 캐릭터 중심 → 칼날 끝 거리
const SWORD_LEN = 28;             // 도신(검 날) 길이 — 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN. 클라 검 그리기와 동일(보이는 검 = 맞는 검)
const BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 클라 도신 반폭(최대 3.4px) 정합. 판정 = 날 선분 vs 몸 원
const BLADE_SPIN_MIN = 3.5, BLADE_SPIN_MAX = 6.0;   // rad/s (슬롯별 시드)

// ─ 체력/데미지 (200시드 배치 시뮬로 "최후 1인" 분포 튜닝 — 수치는 보고서 참조) ─
// 링 데미지(RING_DPS)는 하드 월 채택으로 제거 — 링은 이제 데미지가 아니라 "못 나가는 벽"(킬 전부 칼날 귀속).
const HP_MAX = 100;
const HIT_DPS = 110;              // 칼날 1개가 몸에 겹친 동안 초당 데미지(넉백 이탈로 실접촉은 짧음)

// ─ 안전구역 링(반경 = t의 함수) ─
const RING_R_START = 220;
const RING_R_END = 60;            // 결판 단계 최종 반경 — 봇 없는 소인원에서도 강제 교전이 일어나게 좁힘
const RING_PHASE1_MS = 10000;     // 0~10s: 링 풀(RING_R_START)
const RING_PHASE2_MS = 20000;     // 10~20s: RING_R_START→RING_R_END 선형 수축, 이후 RING_R_END 유지

// ─ 이동 ─
const DRIFT_SPEED = 50;           // 초기 드리프트 속도(px/s) 기준
const CENTER_PULL = 30;           // 상시 중앙 인력 가속(px/s^2) — 시간이 갈수록 중심 밀도 상승(군집)
const SPIN_DRAG = 0.45;           // 드리프트 선형 감쇠(/s) — 인력만 있으면 보존계 영구 진동(중심 관통 왕복) → 나선 수렴
const WALL_BOUNCE = 0.9;          // 벽(링 하드 월) 반사 감쇠

// ─ 넉백(서버 시뮬 실제 반영 — 칼끝→몸 임펄스, 전부 결정론) ─
const KNOCK_IMPULSE = 70;         // 피격 틱당 가산 속도(px/s)
const KNOCK_MAX = 110;            // 넉백 속도 크기 상한(px/s)
const KNOCK_DECAY = 3.0;          // 지수 감쇠(/s)

// ─ 연출 타이밍 ─
const RESULT_HOLD_MS = 2200;      // 리플레이 끝난 뒤 결과 오버레이 전 여유(클라 자체 처리)
const SPIN_RESET_DELAY = 4500;    // gameEnd 후 다음 판 리셋까지(서버)
const HISTORY_MAX = 100;

// ─── 스킨 프리셋 (js/spin-arena.js 와 동일 — 결과 무관, 순수 외형) ───
const SPIN_SKINS = [
    { id: 'crimson',  name: '크림슨',   color: '#e23b3b', blade: '#ff7a7a' },
    { id: 'azure',    name: '애저',     color: '#3b82e2', blade: '#7ab0ff' },
    { id: 'emerald',  name: '에메랄드', color: '#2bb673', blade: '#6fe0a8' },
    { id: 'amber',    name: '앰버',     color: '#e2a23b', blade: '#ffce7a' },
    { id: 'violet',   name: '바이올렛', color: '#9b59e2', blade: '#c79aff' },
    { id: 'rose',     name: '로즈',     color: '#e23b8f', blade: '#ff7ac0' },
];
function skinById(id) { return SPIN_SKINS.find(s => s.id === id) || null; }
function isValidSkinId(id) { return SPIN_SKINS.some(s => s.id === id); }

// ─── 결정론 시드 PRNG ───
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── 링 반경 함수 (클라와 동일 구현) ───
function ringRadiusAt(t) {                       // t: ms (0~GAME_MS)
    if (t <= RING_PHASE1_MS) return RING_R_START;
    if (t >= RING_PHASE2_MS) return RING_R_END;
    const k = (t - RING_PHASE1_MS) / (RING_PHASE2_MS - RING_PHASE1_MS);
    return RING_R_START + (RING_R_END - RING_R_START) * k;
}

/**
 * 결정론 시뮬레이션 — 30초 고정 타임스텝. async로 SIM_YIELD_EVERY 스텝마다 setImmediate 양보.
 * slots: [{ id, isBot, name, skinId }] (길이 n=2~6 가변, 전원 사람). seed: 32bit int.
 * @returns { frames, eliminations, finalState }
 */
async function simulate(slots, seed) {
    const rng = mulberry32(seed);
    // 1) 초기 상태: 참가자 n명을 중심 둘레에 균등 배치 + 약간의 시드 지터
    const st = slots.map((s, i) => {
        const baseAng = (i / slots.length) * 2 * Math.PI;
        const rr = ARENA_R * 0.55 + rng() * ARENA_R * 0.1;
        const px = ARENA_CX + Math.cos(baseAng) * rr, py = ARENA_CY + Math.sin(baseAng) * rr;
        const vAng = rng() * 2 * Math.PI, sp = DRIFT_SPEED * (0.6 + rng() * 0.8);
        return {
            id: s.id, isBot: !!s.isBot, alive: true, hp: HP_MAX,
            x: px, y: py, vx: Math.cos(vAng) * sp, vy: Math.sin(vAng) * sp,
            kvx: 0, kvy: 0,                     // 넉백 속도 성분(이동 속도와 분리, 지수 감쇠)
            bladeCount: BLADE_COUNT,            // 킬마다 +1 (상한 BLADE_COUNT_MAX)
            baseAngle: rng() * 2 * Math.PI,
            spinSpeed: BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN),
            spinDir: rng() < 0.5 ? 1 : -1,
            eliminatedMs: null
        };
    });
    const byId = {};
    for (const c of st) byId[c.id] = c;

    const frames = [];           // 키프레임(SAMPLE_MS 마다)
    const eliminations = [];
    const dt = SIM_DT_MS / 1000;
    const totalSteps = Math.round(GAME_MS / SIM_DT_MS);   // 1500
    let nextSampleMs = 0;

    function sample() {
        const f = [];
        for (const c of st) { f.push(Math.round(c.x), Math.round(c.y), Math.round(Math.max(0, c.hp))); }
        frames.push(f);
    }

    for (let step = 0; step <= totalSteps; step++) {
        const tMs = step * SIM_DT_MS;
        // 샘플(키프레임) — tMs가 nextSampleMs 도달 시
        if (tMs >= nextSampleMs) { sample(); nextSampleMs += SAMPLE_MS; }
        if (step === totalSteps) break;

        const ring = ringRadiusAt(tMs);
        // 결판 규칙: 사람 생존자가 1명 이하(또는 전체 1명 이하)면 데미지 중단 — 그 사람이 최후 1인(당첨) 확정.
        // 최후 2인이 같은 프레임에 동시 전멸하는 것을 막아 거의 항상 화면에 생존자 1명을 남긴다(배치 시뮬 검증).
        let humansAlive = 0, totalAlive = 0;
        for (const c of st) { if (c.alive) { totalAlive++; if (!c.isBot) humansAlive++; } }
        // 결판: 사람 최후 1인이 확정되면(당첨자 결정 — 선택엔 영향 없음) 그 사람은 무적(서사 보호).
        // 전원이 사람이라 decided ≈ allDone 으로 수렴하지만 규칙 코드는 형태 유지(불변조건).
        const decided = humansAlive <= 1;
        const allDone = totalAlive <= 1;
        // 2) 칼날 날 선분 계산(살아있는 캐릭터만, 캐릭터별 bladeCount) — 이동 전 스냅샷.
        //    선분 = 허브에서 BLADE_RADIUS-SWORD_LEN(안쪽 끝)~BLADE_RADIUS(칼끝) 구간.
        const blades = [];
        for (const c of st) {
            if (!c.alive) continue;
            const bc = c.bladeCount;
            for (let k = 0; k < bc; k++) {
                const a = c.baseAngle + c.spinDir * c.spinSpeed * (tMs / 1000) + k * (2 * Math.PI / bc);
                const ca = Math.cos(a), sa = Math.sin(a);
                blades.push({
                    owner: c.id,
                    ix: c.x + ca * (BLADE_RADIUS - SWORD_LEN), iy: c.y + sa * (BLADE_RADIUS - SWORD_LEN),
                    ox: c.x + ca * BLADE_RADIUS, oy: c.y + sa * BLADE_RADIUS
                });
            }
        }
        // 3) 데미지 + 가해자별 기여 추적(킬 크레딧) + 넉백 임펄스 가산
        //    (전체 1명이면 0, 확정된 최후 사람은 무적)
        const dmg = {};
        const bladeDmgBy = {};   // victimId -> { attackerId: 이 틱 칼날 기여 데미지 }
        if (!allDone) for (const c of st) {
            if (!c.alive) continue;
            if (decided && !c.isBot) continue;   // 확정된 최후 사람 = 무적(서사 보호)
            let d = 0;
            for (const tp of blades) {
                if (tp.owner === c.id) continue;
                // 선분-원 판정: 몸 중심에서 날 선분 위 최근접점 (t = clamp(dot/len², 0, 1)) — 전부 결정론 산술
                // 분모 SWORD_LEN²은 "날 선분 길이 = SWORD_LEN 고정" 구조에 결합 — 칼날별 길이 가변화 시 실제 길이²로 교체 (클라 미러 동일)
                const sx = tp.ox - tp.ix, sy = tp.oy - tp.iy;
                let tt = ((c.x - tp.ix) * sx + (c.y - tp.iy) * sy) / (SWORD_LEN * SWORD_LEN);
                if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                const dx = c.x - (tp.ix + sx * tt), dy = c.y - (tp.iy + sy * tt);
                if (dx * dx + dy * dy < (CHAR_RADIUS + BLADE_EDGE_R) * (CHAR_RADIUS + BLADE_EDGE_R)) {
                    d += HIT_DPS * dt;
                    if (!bladeDmgBy[c.id]) bladeDmgBy[c.id] = {};
                    bladeDmgBy[c.id][tp.owner] = (bladeDmgBy[c.id][tp.owner] || 0) + HIT_DPS * dt;
                    // 실제 넉백: 날 최근접점→몸 단방향 임펄스(크기 상한 KNOCK_MAX)
                    const dl = Math.hypot(dx, dy) || 1;
                    c.kvx += (dx / dl) * KNOCK_IMPULSE;
                    c.kvy += (dy / dl) * KNOCK_IMPULSE;
                    const km = Math.hypot(c.kvx, c.kvy);
                    if (km > KNOCK_MAX) { c.kvx *= KNOCK_MAX / km; c.kvy *= KNOCK_MAX / km; }
                }
            }
            dmg[c.id] = d;
        }
        // 4) 이동 적분(드리프트+넉백) + 중앙 인력 + 링 하드 월 + 넉백 감쇠
        for (const c of st) {
            if (!c.alive) continue;
            const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
            const cdist = Math.hypot(cdx, cdy) || 1;
            // 상시 중앙 인력(상시) — 군집 형성. 드리프트 무작위 방향성은 유지(궤적만 중심 쪽으로 휘어짐).
            c.vx += (-cdx / cdist) * CENTER_PULL * dt;
            c.vy += (-cdy / cdist) * CENTER_PULL * dt;
            // 약한 선형 감쇠 — 보존력 영구 진동 방지(나선 수렴). 넉백(kvx/kvy)은 자체 감쇠(KNOCK_DECAY)라 제외.
            c.vx -= c.vx * SPIN_DRAG * dt;
            c.vy -= c.vy * SPIN_DRAG * dt;
            c.x += (c.vx + c.kvx) * dt; c.y += (c.vy + c.kvy) * dt;
            // 링 하드 월 — 살아있는 캐릭터는 수축 링 밖으로 못 나감(경계 클램프 + 법선 반사).
            // 시체는 이 루프에 안 들어옴(alive 가드) → 사망 좌표 동결 유지. 링은 틱 시작 1회 계산이라
            // 수축 중 벽에 붙은 캐릭터가 다음 틱 0.32px 밖일 수 있음 — 순수 하드 월이라 재클램프로 무해.
            const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
            const wallR = ring - CHAR_RADIUS;
            if (nd > wallR) {
                const nx = (c.x - ARENA_CX) / nd, ny = (c.y - ARENA_CY) / nd;
                c.x = ARENA_CX + nx * wallR;
                c.y = ARENA_CY + ny * wallR;
                const dot = c.vx * nx + c.vy * ny;
                c.vx = (c.vx - 2 * dot * nx) * WALL_BOUNCE;
                c.vy = (c.vy - 2 * dot * ny) * WALL_BOUNCE;
                const kdot = c.kvx * nx + c.kvy * ny;
                if (kdot > 0) {
                    c.kvx = (c.kvx - 2 * kdot * nx) * WALL_BOUNCE;
                    c.kvy = (c.kvy - 2 * kdot * ny) * WALL_BOUNCE;
                }
            }
            // 넉백 지수 감쇠
            const kdecay = Math.exp(-KNOCK_DECAY * dt);
            c.kvx *= kdecay; c.kvy *= kdecay;
        }
        // 5) HP 적용 + 탈락(동시 탈락은 적용 전 HP 낮은 쪽이 먼저 = tie-break)
        const justDead = [];
        for (const c of st) {
            if (!c.alive) continue;
            const before = c.hp;
            c.hp -= (dmg[c.id] || 0);
            if (c.hp <= 0) { c.hp = 0; justDead.push({ c, before }); }
        }
        justDead.sort((a, b) => a.before - b.before);  // HP 낮은 쪽 먼저 탈락
        for (const jd of justDead) {
            jd.c.alive = false; jd.c.eliminatedMs = tMs;
            // 킬 크레딧: 이 틱 칼날 기여 데미지 최대 슬롯(동률 = 슬롯 id 낮은 쪽).
            // 데미지원이 칼날뿐(링 데미지 제거)이라 사실상 항상 결정 — null은 방어적 폴백.
            let killerId = null, best = 0;
            const contrib = bladeDmgBy[jd.c.id];
            if (contrib) {
                const ids = Object.keys(contrib).map(Number).sort((x, y) => x - y);
                for (const aid of ids) {
                    if (contrib[aid] > best) { best = contrib[aid]; killerId = aid; }
                }
            }
            eliminations.push({ id: jd.c.id, timeMs: tMs, x: Math.round(jd.c.x), y: Math.round(jd.c.y), killerId });
            // 킬러 칼날 +1 (다음 틱부터 적용 — 클라 공식 strict `<` 와 정합)
            if (killerId !== null && byId[killerId]) {
                byId[killerId].bladeCount = Math.min(BLADE_COUNT_MAX, byId[killerId].bladeCount + 1);
            }
        }

        // CPU 양보 — 무거운 결정론 계산이 이벤트 루프를 막지 않게
        if (step % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    }

    return { frames, eliminations, finalState: st };
}

// 사람 슬롯만 생존순 랭킹. aliveAtEnd > eliminatedMs(클수록 위) > hpEnd(클수록 위) > slotId
function rankHumans(slots, finalState) {
    const humans = slots.filter(s => !s.isBot).map(s => {
        const fs = finalState.find(f => f.id === s.id);
        return { name: s.name, slotId: s.id, alive: fs.alive, elimMs: fs.eliminatedMs, hp: fs.hp };
    });
    humans.sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        if (a.alive) return b.hp - a.hp;                  // 둘 다 생존: HP 높은 쪽이 당첨(더 오래 버팀)
        if (a.elimMs !== b.elimMs) return b.elimMs - a.elimMs;  // 늦게 죽은 쪽 위
        return a.slotId - b.slotId;
    });
    return humans.map((h, i) => ({
        name: h.name, slotId: h.slotId, rank: i + 1,
        eliminatedMs: h.alive ? null : h.elimMs
    }));
}

/**
 * 회전 칼날 게임 이벤트 핸들러
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    function clearSpinTimers(sa) {
        if (sa.playTimeout) { clearTimeout(sa.playTimeout); sa.playTimeout = null; }
        if (sa.endTimeout) { clearTimeout(sa.endTimeout); sa.endTimeout = null; }
        if (sa.resetTimeout) { clearTimeout(sa.resetTimeout); sa.resetTimeout = null; }
    }

    // 준비하고 현재 방에 있는 사람 수 — 시작 가능 게이트(≥2)에 사용 (ladder readyCount와 동일)
    function readyCount(gameState) {
        return (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)).length;
    }

    // idle 단계 스킨 선택 동기화 브로드캐스트 (server-only 정보 미포함)
    function emitSkinsUpdated(room, gameState) {
        io.to(room.roomId).emit('spin-arena:skinsUpdated', {
            skins: { ...gameState.spinArena.skins }
        });
    }
    ctx.emitSpinArenaSkinsUpdated = emitSkinsUpdated;

    // 스킨 선택 (idle 단계, 준비자만)
    socket.on('spin-arena:selectSkin', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.skinId !== 'string') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'spin-arena') return;

        const sa = gameState.spinArena;
        if (sa.phase !== 'idle') {
            socket.emit('spin-arena:error', '게임 시작 전(대기 중)에만 스킨을 고를 수 있습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        if (!gameState.readyUsers.includes(name)) {
            socket.emit('spin-arena:error', '준비한 사람만 스킨을 고를 수 있습니다.');
            return;
        }
        if (!isValidSkinId(data.skinId)) {
            socket.emit('spin-arena:error', '없는 스킨입니다.');
            return;
        }

        sa.skins[name] = data.skinId;
        emitSkinsUpdated(room, gameState);
    });

    // 입장/재입장 시점 스킨 동기화 — 요청 소켓에만 현재 skins 응답 (순수 additive 이벤트).
    // server-only 데이터(timeline/result/seed)는 절대 포함하지 않는다 — skins만.
    socket.on('spin-arena:requestSkins', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'spin-arena') return;

        socket.emit('spin-arena:skinsUpdated', {
            skins: { ...gameState.spinArena.skins }
        });
    });

    // 게임 시작 (호스트) — 슬롯 배정 + 시뮬 사전계산 + reveal
    socket.on('spin-arena:start', async () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'spin-arena') {
            socket.emit('spin-arena:error', '회전 칼날 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('spin-arena:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const sa = gameState.spinArena;
        if (sa.phase !== 'idle' && sa.phase !== 'finished') {
            socket.emit('spin-arena:error', '이미 게임이 진행 중입니다!');
            return;
        }

        // 참가자 = 현재 방에 있고 준비한 사용자
        const ready = (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)
        );
        if (ready.length < SPIN_MIN_PLAYERS) {
            socket.emit('spin-arena:error', `준비한 인원이 ${SPIN_MIN_PLAYERS}명 이상이어야 합니다!`);
            return;
        }

        // 게임 시작 시 이전 주문 cycle 가드 해제 — 다음 종료에서도 자동 주문이 다시 발동하도록 (ladder/경마 패턴)
        const wasOrderActive = gameState.isOrderActive;
        gameState.orderAutoTriggered = false;
        gameState.isOrderActive = false;
        if (wasOrderActive) io.to(room.roomId).emit('orderEnded');

        // 스킨 배정(클라 미리보기와 거울 규칙): users 배열(입장 순서)을 순회하며
        // 명시 선택 스킨 우선, 없으면 free preset 순차 배정 — 미리보기 색 == 실제 게임 색 보장.
        const usedSkinIds = new Set();
        gameState.users.forEach(u => {
            const sel = sa.skins[u.name];
            if (isValidSkinId(sel)) usedSkinIds.add(sel);
        });
        const freePresets = SPIN_SKINS.filter(s => !usedSkinIds.has(s.id)).map(s => s.id);
        let fpi = 0;
        const assignedSkin = {};   // name -> skinId
        gameState.users.forEach((u, idx) => {
            const sel = sa.skins[u.name];
            assignedSkin[u.name] = isValidSkinId(sel)
                ? sel
                : (fpi < freePresets.length ? freePresets[fpi++] : SPIN_SKINS[idx % SPIN_SKINS.length].id);
        });

        // 게임 슬롯 = 준비자를 users 배열(입장 순서)로 정렬해 선착 최대 6명 (봇 없음)
        const humanNames = gameState.users
            .filter(u => ready.includes(u.name))
            .map(u => u.name)
            .slice(0, MAX_SLOTS);
        const humanCount = humanNames.length;

        const slots = humanNames.map((name, i) => ({
            id: i, isBot: false, name, skinId: assignedSkin[name]
        }));

        const seed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)

        clearSpinTimers(sa);
        sa.phase = 'playing';
        sa.isActive = true;
        sa.participants = humanNames.slice();
        sa.seed = seed;

        let sim;
        try {
            sim = await simulate(slots, seed);
        } catch (e) {
            console.warn('[회전칼날] 시뮬 실패:', e.message);
            sa.phase = 'idle';
            sa.isActive = false;
            socket.emit('spin-arena:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
            updateRoomsList();
            return;
        }

        // 비동기 시뮬 도중 방이 사라졌으면 중단
        if (!ctx.rooms[room.roomId]) return;

        const rankings = rankHumans(slots, sim.finalState);
        const selected = rankings.length ? rankings[0].name : null;

        sa.timeline = { slots, frames: sim.frames, eliminations: sim.eliminations };  // server-only
        sa.result = { selected, rankings };   // server-only

        // 공개 슬롯 meta — baseAngle/spinSpeed/spinDir 은 시뮬 초기상태에서 추출(클라가 t로 칼날각 계산)
        // isBot은 additive-safe 호환을 위해 false 고정 유지. bladeCount는 "시작 칼날 수 2" 의미.
        const revealSlots = slots.map((s, i) => {
            const fs = sim.finalState[i];
            const sk = skinById(s.skinId) || SPIN_SKINS[0];
            return {
                id: s.id, isBot: false, name: s.name, skinId: sk.id,
                color: sk.color, blade: sk.blade,
                bladeCount: BLADE_COUNT, bladeRadius: BLADE_RADIUS,
                baseAngle: fs.baseAngle, spinSpeed: fs.spinSpeed, spinDir: fs.spinDir
            };
        });

        io.to(room.roomId).emit('spin-arena:reveal', {
            durationMs: GAME_MS,
            sampleMs: SAMPLE_MS,
            arena: { w: ARENA_W, h: ARENA_H, cx: ARENA_CX, cy: ARENA_CY, r: ARENA_R },
            ring: { rStart: RING_R_START, rEnd: RING_R_END, phase1Ms: RING_PHASE1_MS, phase2Ms: RING_PHASE2_MS },
            slots: revealSlots,
            frames: sim.frames,
            eliminations: sim.eliminations,
            result: { selected, rankings }
        });

        console.log(`[회전칼날] 방 ${room.roomName} 공개 - 참가자 ${humanCount}명 / 당첨=${selected}`);

        clearSpinTimers(sa);
        // 클라가 3-2-1 카운트다운(COUNTDOWN_MS)만큼 늦게 리플레이를 시작하므로 종료 타이머도 그만큼 가산
        sa.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, COUNTDOWN_MS + GAME_MS + RESULT_HOLD_MS);

        updateRoomsList();
    });

    function endGame(room, gameState) {
        const sa = gameState.spinArena;
        clearSpinTimers(sa);

        // 결과는 reveal 시점에 확정된 server-only result를 그대로 사용(이탈자도 결과 집계 — 결정론 일관).
        const result = sa.result || { selected: null, rankings: [] };
        const selected = result.selected;
        const rankings = result.rankings || [];

        // DB·집계는 시작 시점 참가자 중 "지금도 방에 있는" 사람만 (ladder의 전원이탈 abort 취지와 동일).
        const dbPlayers = (sa.participants || []).filter(name =>
            gameState.users.some(u => u.name === name));
        if (dbPlayers.length === 0) {
            sa.phase = 'idle';
            sa.isActive = false;
            io.to(room.roomId).emit('spin-arena:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        sa.phase = 'finished';
        sa.isActive = false;
        sa.round++;

        sa.history.push({
            round: sa.round,
            selected,
            timestamp: new Date().toISOString()
        });
        if (sa.history.length > HISTORY_MAX) sa.history = sa.history.slice(-HISTORY_MAX);

        io.to(room.roomId).emit('spin-arena:gameEnd', { selected, rankings, round: sa.round });

        // DB: 사람 참가자만 (봇 제외, 위에서 현재 방 잔류자로 필터). selected = 당첨자 = ladder loser 의미.
        recordGamePlay('spin-arena', dbPlayers.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('spin-arena', room.serverId);
            Promise.all(dbPlayers.map(name => {
                const isSelected = name === selected;     // 당첨 = ladder loser 의미
                const isWinner = !isSelected;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'spin-arena', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'spin-arena',
                gameRules: 'spin-survival',
                winnerName: dbPlayers.find(n => n !== selected) || null,
                participantCount: dbPlayers.length
            })).catch(e => console.warn('[회전칼날] DB 기록 실패:', e.message));
        }

        console.log(`[회전칼날] 방 ${room.roomName} 종료 - 당첨=${selected}`);

        // 게임 종료 → 바로 주문받기 자동 시작 (ladder/경마 단일 당첨자 패턴과 동일)
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        // 다음 판 리셋 (결과 표시 시간 확보 후)
        sa.resetTimeout = setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const cur = currentRoom.gameState.spinArena;
            resetSpin(cur);
            const cg = currentRoom.gameState;
            cg.readyUsers = [];
            cg.users.forEach(u => { u.isReady = false; });
            io.to(room.roomId).emit('readyUsersUpdated', cg.readyUsers);
            io.to(room.roomId).emit('spin-arena:roundReset');
            updateRoomsList();
        }, SPIN_RESET_DELAY);

        updateRoomsList();
    }

    function resetSpin(sa) {
        clearSpinTimers(sa);
        sa.phase = 'idle';
        sa.skins = {};
        sa.participants = [];
        sa.timeline = null;
        sa.result = null;
        sa.seed = 0;
        sa.isActive = false;
    }

    // 호스트 이탈 감지 → grace 후 phase 분기 (ladder disconnect 복제)
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;

        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.spinArena) return;

            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id
            );
            if (reconnected) return;

            const sa = gameState.spinArena;
            // playing: endTimeout이 자연 종료 — 개입 안 함(클라 핸드셰이크 없음)
            if (sa.phase === 'playing') return;
            // idle: 진행 타이머 없음. finished: 다음 판 자동 리셋(resetTimeout)이 남은 참가자를 idle로
            // 되돌리도록 그대로 둔다(호스트는 이미 위임됨). 여기서 타이머를 지우면 결과 화면 고착하므로 개입 안 함.
        }, waitTime);
    });
};

// 테스트용 export (공정성/결정론 회귀). 핸들러 호출에는 영향 없음.
module.exports.simulate = simulate;
module.exports.rankHumans = rankHumans;
module.exports.ringRadiusAt = ringRadiusAt;
