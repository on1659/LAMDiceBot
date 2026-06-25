// 회전 칼날(spin-arena) 게임 소켓 핸들러
// ladder.js / horse.js 패턴 차용. 결과는 서버에서만 결정(결정론 시드 PRNG), 클라는 리플레이만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const { getOwned } = require('../db/cosmetics');   // 스킨 소유 검증(꾸미기 상점) — 시뮬/결과 경로 미사용

// ─── 공유 상수 (js/spin-arena.js 상단과 반드시 동일 값) ───
// ─ 아레나(논리 좌표 고정, CSS 반응형) ─
const ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240;
const ARENA_R = 220;              // 바깥벽 반경

// ─ 슬롯/인원 (봇 없음 — 사람 n=2~24 가변) ─
const MAX_SLOTS = 24;             // 최대 참가 슬롯(준비 선착 최대 24명)
const SPIN_MIN_PLAYERS = 2;

// ─ 토너먼트(2026-06-17 rework, Slice 1: 서버 결정론 코어) ─
// 순수 단판 토너먼트(LOSER 브래킷): 풀 = 전원. 매 라운드 풀을 짝지어 1v1 듀얼.
//   듀얼 WINNER = 안전(safe, 풀에서 이탈). LOSER = 풀 잔류(다음 라운드 진출). 풀이 1명 = 당첨(벌칙).
//   라운드 내 모든 듀얼은 한 타임라인을 공유(parallel). 전부 서버에서 한 시드로 사전 계산.

// ─ 시간축 ─
const COUNTDOWN_MS = 4000;        // 클라 3-2-1-START 카운트다운 실측(1000ms×4) — js/spin-arena.js 와 동일 값
const SIM_DT_MS = 20;             // 내부 시뮬 스텝(50fps)
const SAMPLE_MS = 100;            // 키프레임 샘플 간격 → 듀얼 frames 길이 = durationMs/SAMPLE_MS + 1
const SIM_YIELD_EVERY = 100;      // 이 스텝마다 await setImmediate (CPU 양보) — 듀얼 루프 합산 기준

// ─ 듀얼/라운드 시간 (수치 권위 = 200시드 배치) ─
const DUEL_MAX_MS = 8000;         // 듀얼 캡 — 이 시각까지 HP 0 미발생 시 HP 최저자 = LOSER(HP-lowest fallback → decideMs는 절대 null 아님). 2칼날 + 좁은 DUEL_RING_R로 결판이 빨라 fallback ~0(배치 확인).
const DECIDE_TAIL_MS = 1200;      // 듀얼 결판(decideMs) 후 결판 비트 길이 — durationMs = decideMs + tail (SAMPLE_MS 격자)
const MIN_ROUND_MS = 3000;        // 라운드 최소 길이(가장 긴 듀얼이 짧아도 라운드는 이 길이 이상 — 오버뷰 가독)

// ─── 연출 비트 상수 (SEQUENTIAL 브로드캐스트 타임라인) ───
// 박제: 클라 js/spin-arena.js 와 반드시 동일 값. 전체 durationMs = 이 비트들의 순차 합 →
//   endTimeout = COUNTDOWN_MS + durationMs + RESULT_HOLD_MS. 하나라도 어긋나면 결과가 일찍/늦게 발화.
const BRACKET_OVERVIEW_MS = 3500;  // 시작 브래킷 오버뷰(누가 누구와 싸우는지) — 전체에서 1회.
const ROUND_INTRO_MS = 2000;       // "{poolSize}강 시작" 카드 — 라운드마다 1회.
const DUEL_INTRO_MS = 1500;        // "{A} 대 {B} 게임시작" — 듀얼마다 1회.
const DUEL_OUTRO_MS = 1500;        // "{loser} 패배" 콜아웃 + 이어지는 모션 — 듀얼마다 1회.
const DUEL_BLACKOUT_MS = 700;      // 다음 듀얼로 가는 암전(절대 흰색 아님) — 듀얼마다 1회.
const BYE_BEAT_MS = 1500;          // "부전패" 비트 — bye마다 1회.

// ─ GAME_MS 재유도(하드 캡, SEQUENTIAL 브로드캐스트 모델) ─
//   클라가 브래킷을 순차 브로드캐스트로 재생: [브래킷 오버뷰] → 라운드마다 [라운드 인트로 + 듀얼들 + bye 비트].
//   전체 durationMs = BRACKET_OVERVIEW_MS
//     + Σ_rounds [ ROUND_INTRO_MS + Σ_duels(DUEL_INTRO_MS + duel.durationMs + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS) + #byes×BYE_BEAT_MS ].
//   최악 케이스: n=24 → totalDuels = 23(토너먼트는 n명 → n-1 듀얼), 라운드 수 = ceil(log2(24)) = 5라운드.
//   듀얼당 최악 = DUEL_MAX_MS(8000) + DECIDE_TAIL_MS(1200) = 9200ms (모든 듀얼 fallback 가정).
//   듀얼 연출당 최악 = DUEL_INTRO_MS(1500) + 9200 + DUEL_OUTRO_MS(1500) + DUEL_BLACKOUT_MS(700) = 12900ms.
//   bye 최악(보수적): 라운드당 1 bye × 5라운드 × BYE_BEAT_MS(1500) = 7500ms.
//   theoretical = BRACKET_OVERVIEW_MS(3500) + ROUND_INTRO_MS(2000)×5 + 12900×23 + 7500
//               = 3500 + 10000 + 296700 + 7500 = 317700ms.
//   여유 포함 GAME_MS = 340000 (전체 durationMs 상한, endTimeout 산정의 sanity 캡 — 317700 여유 22300ms).
const GAME_MS = 340000;           // 전체 브래킷 durationMs 하드 캡(여유 포함). 실제 durationMs는 비트 순차 합(SEQUENTIAL) — 보통 훨씬 짧음.

// ─ 캐릭터/칼날 ─
const CHAR_RADIUS = 14;
const BLADE_COUNT = 2;            // 칼날 수 base(듀얼 내 칼날 수는 base 고정. 2개 = 판정 면적↑ → 듀얼 결판 안정).
const BLADE_RADIUS = 46;          // 캐릭터 중심 → 칼날 끝 거리
const SWORD_LEN = 28;             // 도신(검 날) 길이 — 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN. 클라 검 그리기와 동일(보이는 검 = 맞는 검)
const BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 클라 도신 반폭(최대 3.4px) 정합. 판정 = 날 선분 vs 몸 원
const BLADE_SPIN_MIN = 3.5, BLADE_SPIN_MAX = 6.0;   // rad/s (듀얼 sub-seed PRNG 파생)

// ─ 체력/데미지 (수치 권위 = 200시드 배치) ─
const HP_MAX = 100;               // 듀얼 HP. hpFrames(듀얼 frames에 포함) 분모 = HP_MAX
const HIT_DPS = 300;              // 듀얼: 칼날→상대 HP 초당 데미지. 권위 = 200시드 배치(스윕: ring64·pull320·dps300 → fallback ~1%)

// ─ 듀얼 링/이동 ─
const DUEL_RING_R = 64;           // 듀얼 전용 링 반경(고정 — 듀얼은 단계 수축 없음). 두 칼날이 상시 접촉하게 좁힘. 권위 = 스윕(80=fallback 30%↑ → 64=~1%)
const DUEL_START_R = 44;          // 듀얼 시작 시 두 캐릭터를 중심에서 ±이 반경(angle 0, π)에 배치(결정론). DUEL_RING_R-charR-여유 안쪽
const FINALE_PULL = 320;          // 듀얼 중앙 인력(강) — 2인을 중앙에 밀착시켜 칼날 상시 접촉 → HP-0 결판 보장. 권위 = 200시드 배치
const SPIN_DRAG = 0.45;           // 드리프트 선형 감쇠(/s) — 인력만 있으면 보존계 영구 진동 → 나선 수렴
const WALL_BOUNCE = 0.9;          // 벽(링 하드 월) 반사 감쇠

// ─ 캐릭터 충돌 바운스 — 위치 디오버랩 + 탄성 속도 교환(팅겨짐). 결정론(rng 0회). ─
const COLLIDE_MARGIN = 12;        // 충돌 판정 여유(px). minD = 2*charR + COLLIDE_MARGIN
const COLLIDE_RESTITUTION = 1.3;  // 반발 계수 — 드리프트 속도(vx/vy)에만 적용(넉백 kvx/kvy 불변)
const COLLIDE_POP = 10;           // 최소 분리 임펄스(px/s) — rel≈0(느린 접촉)에도 법선 방향으로 팝을 줘 가시적 분리

// ─ 넉백(서버 시뮬 실제 반영 — 칼끝→몸 임펄스, 전부 결정론) ─
const KNOCK_IMPULSE = 70;         // 피격 틱당 가산 속도(px/s)
const KNOCK_MAX = 110;            // 넉백 속도 크기 상한(px/s)
const KNOCK_DECAY = 3.0;          // 지수 감쇠(/s)

// ─ 연출 타이밍 ─
const RESULT_HOLD_MS = 2200;      // 리플레이 끝난 뒤 결과 오버레이 전 여유(클라 자체 처리)
const SPIN_RESET_DELAY = 4500;    // gameEnd 후 다음 판 리셋까지(서버)
const HISTORY_MAX = 100;

// ─── 스킨 프리셋 (js/spin-arena.js 와 동일 값 계약 — 결과 무관, 순수 외형) ───
// 24색 × (t1 + t2 스킨업). 자동 배정 풀 = base tier1 24색 전체(소유 무관 — 식별색≠소유). 상점/명시선택은 free/소유 검증 적용.
// t2는 같은 색 + tier:2 플래그(클라가 강화 비주얼만 추가). 티어는 skinId에 인코딩('{color}_t2') — 새 gameState 필드 없음.
// 색/이름 변경 시 3곳 동기: 여기 + js/spin-arena.js SPIN_SKIN_COLORS + config/spin-arena/cosmetics.json.
const SPIN_SKIN_COLORS = [
    { id: 'crimson',  name: '크림슨',     color: '#e23b3b', blade: '#ff7a7a', free: true },
    { id: 'azure',    name: '애저',       color: '#3b82e2', blade: '#7ab0ff', free: true },
    { id: 'emerald',  name: '에메랄드',   color: '#2bb673', blade: '#6fe0a8', free: true },
    { id: 'amber',    name: '앰버',       color: '#e2a23b', blade: '#ffce7a', free: true },
    { id: 'violet',   name: '바이올렛',   color: '#9b59e2', blade: '#c79aff', free: true },
    { id: 'rose',     name: '로즈',       color: '#e23b8f', blade: '#ff7ac0', free: true },
    { id: 'cyan',     name: '시안',       color: '#22c1d6', blade: '#7ae9f6', free: false },
    { id: 'lime',     name: '라임',       color: '#9ccf2f', blade: '#d3f57a', free: false },
    { id: 'cobalt',   name: '코발트',     color: '#4053d6', blade: '#8a9aff', free: false },
    { id: 'magenta',  name: '마젠타',     color: '#d63be2', blade: '#f07aff', free: false },
    { id: 'bronze',   name: '브론즈',     color: '#b07033', blade: '#e0aa7a', free: false },
    { id: 'silver',   name: '실버',       color: '#aab6c4', blade: '#dde6ee', free: false },
    { id: 'jade',     name: '제이드',     color: '#3bc9a7', blade: '#8af0d4', free: false },
    { id: 'ivory',    name: '아이보리',   color: '#e6dfc8', blade: '#fff6dd', free: false },
    { id: 'graphite', name: '그라파이트', color: '#5a6472', blade: '#a0aebd', free: false },
    { id: 'obsidian', name: '옵시디언',   color: '#343344', blade: '#8d8aa8', free: false },
    // 24명 식별 마감 추가 8색 — 기존 16색과 hue·명도 모두 분리(소형 스케일 구분). free:false(상점 기본값)이나 자동배정은 소유 무관 전체 사용.
    { id: 'tangerine', name: '탠저린',     color: '#ff7a1a', blade: '#ffb060', free: false },
    { id: 'gold',      name: '골드',       color: '#f2c014', blade: '#ffe06a', free: false },
    { id: 'olive',     name: '올리브',     color: '#8a8d2f', blade: '#c5c86e', free: false },
    { id: 'teal',      name: '틸',         color: '#0e9488', blade: '#5fd4c8', free: false },
    { id: 'indigo',    name: '인디고',     color: '#5b3fd6', blade: '#9685ff', free: false },
    { id: 'coral',     name: '코랄',       color: '#ff6f61', blade: '#ffa499', free: false },
    { id: 'plum',      name: '플럼',       color: '#7d3a6a', blade: '#bd76a8', free: false },
    { id: 'slate',     name: '슬레이트',   color: '#46708f', blade: '#86abc6', free: false },
];
const SPIN_SKINS = [];
SPIN_SKIN_COLORS.forEach(c => {
    SPIN_SKINS.push({ id: c.id, name: c.name, color: c.color, blade: c.blade, tier: 1, free: !!c.free });
    SPIN_SKINS.push({ id: c.id + '_t2', name: c.name + ' Ⅱ', color: c.color, blade: c.blade, tier: 2, free: false });
});
// 자동 배정 풀 = base tier1 24색 전체 (소유 무관 — 24명 distinct 무중복 분배로 식별 보장. 클라 previewRoster 거울 규칙과 동일 값)
const BASE_SKINS = SPIN_SKINS.filter(s => s.tier === 1);
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

// ─── 듀얼 sub-seed 파생 (메인 시드/페어링/브래킷 모양과 디커플) ───
// 같은 두 슬롯은 페어링 순서와 무관하게 같은 sub-seed → 정렬된 슬롯 쌍(min,max) 사용.
// 메인 rng 스트림과 독립 → 듀얼 내부가 브래킷 구조 변화에 흔들리지 않음(2탭 + 200시드 안정).
function duelSubSeed(seed, roundIdx, a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return (seed ^ (roundIdx * 0x9E3779B1) ^ (lo * 0x85EBCA77) ^ (hi * 0xC2B2AE35)) >>> 0;
}

/**
 * 단판 듀얼 시뮬레이션 (2인 서든데스) — 메인 rng() 0회 소비. 듀얼 내부 PRNG는 sub-seed에서만.
 *
 * 2인을 DUEL_RING_R 작은 링 안 양 끝(±DUEL_START_R, angle 0/π)에 결정론 배치.
 * 각 캐릭터 칼날 파라미터(baseAngle→spinSpeed→spinDir 고정 순서)를 듀얼 PRNG에서 소비.
 * 루프(SIM_DT_MS 스텝, SAMPLE_MS 키프레임): FINALE_PULL 중앙 인력 → buildBlades → 칼날 선분 vs 몸 판정(HP 드레인 + 넉백)
 *   → separateChars(2인) → integrate 링 하드월 클램프.
 * 첫 HP≤0 = LOSER(듀얼 결과), 상대 = WINNER(안전). DUEL_MAX_MS까지 미결판이면 LOSER = HP 최저자
 *   (동률: hp → received↑ → slotId) → decideMs는 절대 null 아님(모든 듀얼 결판).
 * durationMs = decideMs + DECIDE_TAIL_MS (SAMPLE_MS 격자). frames = 키프레임 [ax,ay,ahp, bx,by,bhp](stride 6, ARENA_CX/CY 중심 로컬 좌표).
 *
 * @returns { duelId, roundIdx, slotA, slotB, frames, durationMs, decideMs, loserSlot, winnerSlot, bladeA, bladeB }
 */
function simulateDuel(duelId, slotA, slotB, subSeed, roundIdx) {
    const rng = mulberry32(subSeed);
    const charR = CHAR_RADIUS, bladeR = BLADE_RADIUS, swordLen = SWORD_LEN, bladeEdgeR = BLADE_EDGE_R;
    const dt = SIM_DT_MS / 1000;
    const ring = DUEL_RING_R;

    // 칼날 파라미터 — 캐릭터당 3회(baseAngle→spinSpeed→spinDir) 고정 순서. 듀얼 PRNG만 소비(메인 rng 0회).
    function mkChar(slotId, ang0) {
        const baseAngle = rng() * 2 * Math.PI;
        const spinSpeed = BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN);
        const spinDir = rng() < 0.5 ? 1 : -1;
        return {
            id: slotId, hp: HP_MAX, received: 0,
            x: ARENA_CX + Math.cos(ang0) * DUEL_START_R, y: ARENA_CY + Math.sin(ang0) * DUEL_START_R,
            vx: 0, vy: 0, kvx: 0, kvy: 0, dead: false,
            baseAngle, spinSpeed, spinDir
        };
    }
    const cA = mkChar(slotA, 0);          // 0 위치
    const cB = mkChar(slotB, Math.PI);    // π 위치(반대편)
    const chars = [cA, cB];

    const frames = [];
    let decideMs = null;
    let loserSlot = null, winnerSlot = null;
    let endMs = DUEL_MAX_MS;   // 결판 전 잠정 캡(결판 시 압축)
    let nextSampleMs = 0;

    function sample() {
        frames.push(
            Math.round(cA.x), Math.round(cA.y), Math.max(0, Math.round(cA.hp)),
            Math.round(cB.x), Math.round(cB.y), Math.max(0, Math.round(cB.hp))
        );
    }
    function buildBlades(tMs) {
        const blades = [];
        for (const c of chars) {
            if (c.dead) continue;
            for (let k = 0; k < BLADE_COUNT; k++) {
                const a = c.baseAngle + c.spinDir * c.spinSpeed * (tMs / 1000) + k * (2 * Math.PI / BLADE_COUNT);
                const ca = Math.cos(a), sa = Math.sin(a);
                blades.push({
                    owner: c.id,
                    ix: c.x + ca * (bladeR - swordLen), iy: c.y + sa * (bladeR - swordLen),
                    ox: c.x + ca * bladeR, oy: c.y + sa * bladeR
                });
            }
        }
        return blades;
    }
    function applyKnock(c, dx, dy) {
        const dl = Math.hypot(dx, dy) || 1;
        c.kvx += (dx / dl) * KNOCK_IMPULSE; c.kvy += (dy / dl) * KNOCK_IMPULSE;
        const km = Math.hypot(c.kvx, c.kvy);
        if (km > KNOCK_MAX) { c.kvx *= KNOCK_MAX / km; c.kvy *= KNOCK_MAX / km; }
    }
    function clampSpeed(c) {
        const sm = Math.hypot(c.vx, c.vy);
        if (sm > KNOCK_MAX) { c.vx *= KNOCK_MAX / sm; c.vy *= KNOCK_MAX / sm; }
    }
    function integrate(c) {
        c.vx -= c.vx * SPIN_DRAG * dt; c.vy -= c.vy * SPIN_DRAG * dt;
        c.x += (c.vx + c.kvx) * dt; c.y += (c.vy + c.kvy) * dt;
        const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
        const wallR = ring - charR;
        if (nd > wallR) {
            const nx = (c.x - ARENA_CX) / nd, ny = (c.y - ARENA_CY) / nd;
            c.x = ARENA_CX + nx * wallR; c.y = ARENA_CY + ny * wallR;
            const dot = c.vx * nx + c.vy * ny;
            c.vx = (c.vx - 2 * dot * nx) * WALL_BOUNCE; c.vy = (c.vy - 2 * dot * ny) * WALL_BOUNCE;
            const kdot = c.kvx * nx + c.kvy * ny;
            if (kdot > 0) { c.kvx = (c.kvx - 2 * kdot * nx) * WALL_BOUNCE; c.kvy = (c.kvy - 2 * kdot * ny) * WALL_BOUNCE; }
        }
        const kdecay = Math.exp(-KNOCK_DECAY * dt);
        c.kvx *= kdecay; c.kvy *= kdecay;
    }
    // 2인 디오버랩 + 탄성 바운스 + 링 재클램프. rng 0회.
    function separateChars() {
        const wallR = ring - charR;
        const minD = 2 * charR + COLLIDE_MARGIN;
        const ci = cA, cj = cB;
        if (!ci.dead && !cj.dead) {
            const dx = cj.x - ci.x, dy = cj.y - ci.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < minD) {
                const overlap = minD - d;
                const nx = dx / d, ny = dy / d;
                const half = overlap / 2;
                ci.x -= nx * half; ci.y -= ny * half;
                cj.x += nx * half; cj.y += ny * half;
                const rel = (cj.vx - ci.vx) * nx + (cj.vy - ci.vy) * ny;
                if (rel < 0) {
                    const imp = -(1 + COLLIDE_RESTITUTION) * rel / 2;
                    ci.vx -= imp * nx; ci.vy -= imp * ny;
                    cj.vx += imp * nx; cj.vy += imp * ny;
                } else {
                    const pop = COLLIDE_POP / 2;
                    ci.vx -= pop * nx; ci.vy -= pop * ny;
                    cj.vx += pop * nx; cj.vy += pop * ny;
                }
                clampSpeed(ci); clampSpeed(cj);
            } else if (d === 0) {
                const half = minD / 2;
                ci.x -= half; cj.x += half;
            }
        }
        for (const c of chars) {
            if (c.dead) continue;
            const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
            if (nd > wallR) {
                const nx = (c.x - ARENA_CX) / nd, ny = (c.y - ARENA_CY) / nd;
                c.x = ARENA_CX + nx * wallR; c.y = ARENA_CY + ny * wallR;
            }
        }
    }
    function setDecide(tMs, loser) {
        decideMs = tMs;
        loserSlot = loser.id;
        winnerSlot = (loser.id === cA.id) ? cB.id : cA.id;
        endMs = Math.min(DUEL_MAX_MS + DECIDE_TAIL_MS, Math.ceil((decideMs + DECIDE_TAIL_MS) / SAMPLE_MS) * SAMPLE_MS);
    }

    for (let step = 0; ; step++) {
        const tMs = step * SIM_DT_MS;
        if (tMs >= nextSampleMs) { sample(); nextSampleMs += SAMPLE_MS; }
        if (tMs >= endMs) break;

        if (decideMs === null) {
            const blades = buildBlades(tMs);
            // 칼날 → 상대 몸: HP 드레인 + received 누적 + 넉백
            for (const c of chars) {
                if (c.dead) continue;
                let d = 0;
                for (const bl of blades) {
                    if (bl.owner === c.id) continue;
                    const sx = bl.ox - bl.ix, sy = bl.oy - bl.iy;
                    let tt = ((c.x - bl.ix) * sx + (c.y - bl.iy) * sy) / (swordLen * swordLen);
                    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                    const dx = c.x - (bl.ix + sx * tt), dy = c.y - (bl.iy + sy * tt);
                    if (dx * dx + dy * dy < (charR + bladeEdgeR) * (charR + bladeEdgeR)) {
                        const dmg = HIT_DPS * dt;
                        d += dmg;
                        applyKnock(c, dx, dy);
                    }
                }
                if (d > 0) { c.received += d; c.hp -= d; }
            }
            // 첫 HP 0 = LOSER. 둘이 같은 틱에 0이면 HP 낮은 쪽(동률 hp→received↑→slotId) = LOSER.
            const downed = chars.filter(c => !c.dead && c.hp <= 0);
            if (downed.length === 1) {
                downed[0].hp = 0; downed[0].dead = true; setDecide(tMs, downed[0]);
            } else if (downed.length === 2) {
                downed.sort((a, b) => (a.hp - b.hp) || (a.received - b.received) || (a.id - b.id));
                downed[0].hp = 0; downed[0].dead = true; setDecide(tMs, downed[0]);
            }
            // HP-lowest fallback — 캡까지 미결판이면 HP 최저자 = LOSER(decideMs는 절대 null 아님)
            if (decideMs === null && tMs >= DUEL_MAX_MS - SIM_DT_MS) {
                const order = chars.slice().sort((a, b) => (a.hp - b.hp) || (a.received - b.received) || (a.id - b.id));
                setDecide(tMs, order[0]);
            }
        }
        // 이동 — 강한 중앙 인력(FINALE_PULL). 결판 후엔 LOSER만 동결(WINNER은 계속 회전 — 외관).
        for (const c of chars) {
            if (c.dead) continue;
            const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
            const cdist = Math.hypot(cdx, cdy) || 1;
            c.vx += (-cdx / cdist) * FINALE_PULL * dt; c.vy += (-cdy / cdist) * FINALE_PULL * dt;
            integrate(c);
        }
        separateChars();
    }

    return {
        duelId, roundIdx, slotA, slotB, frames,
        durationMs: endMs, decideMs, loserSlot, winnerSlot,
        bladeA: { baseAngle: cA.baseAngle, spinSpeed: cA.spinSpeed, spinDir: cA.spinDir, bladeCount: BLADE_COUNT },
        bladeB: { baseAngle: cB.baseAngle, spinSpeed: cB.spinSpeed, spinDir: cB.spinDir, bladeCount: BLADE_COUNT }
    };
}

/**
 * 결정론 토너먼트 시뮬레이션 (2026-06-17 rework Slice 1) — 순수 단판 LOSER 브래킷.
 * async로 듀얼 사이마다 setImmediate 양보(CPU). 결과는 한 시드로 전부 사전 계산, 클라는 리플레이만.
 *
 * 모델: 풀 = 전원. 매 라운드 풀을 인접 페어링 → 각 듀얼 WINNER = 안전(safe, 풀 이탈), LOSER = 풀 잔류(다음 라운드).
 *   풀이 1명 = finalLoser = 당첨(벌칙). 라운드 내 모든 듀얼은 한 타임라인 공유(parallel, 클라).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ 박제(FROZEN) — 메인 rng() 소비 순서. 어떤 재배열도 모든 시드를 깬다. 변경 금지.    │
 * │  Phase A — 풀 셔플: Fisher-Yates(slotIds [0..n-1]), 정확히 n-1회.                  │
 * │    for (let i=n-1;i>=1;i--){ const j=Math.floor(rng()*(i+1)); swap(pool[i],pool[j]); } │
 * │  Per round — 현재 풀 길이가 홀수면 정확히 1회 소비(bye 선택):                       │
 * │    byeIdx = Math.floor(rng()*pool.length). 짝수면 0회.                              │
 * │  페어링 = 인접(pool[0]vs[1], [2]vs[3], …) — rng 0회.                                │
 * │  듀얼 sim = 메인 rng() 0회 — duelSubSeed에서 파생한 듀얼 전용 PRNG만 사용.          │
 * │  → 메인 rng 총소비 = (n-1) + (홀수 라운드 수).                                       │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * slots: [{ id, isBot, name, skinId }] (id == 배열 인덱스, 전원 사람). seed: 32bit int.
 * @returns { bracket:{ poolOrder, rounds, finalLoser, loserDepth }, finalLoser, succession, rankings, geom, slots, sampleMs, durationMs }
 */
async function simulate(slots, seed) {
    const rng = mulberry32(seed);
    const n = slots.length;

    // ── Phase A: 풀 셔플(Fisher-Yates, 정확히 n-1회 rng). poolOrder 저장. ──
    const poolOrder = [];
    for (let i = 0; i < n; i++) poolOrder.push(i);
    for (let i = n - 1; i >= 1; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = poolOrder[i]; poolOrder[i] = poolOrder[j]; poolOrder[j] = tmp;
    }

    // ── 브래킷 빌드 ──
    let atRisk = poolOrder.slice();      // 당첨 후보 풀(LOSER가 잔류)
    let roundIdx = 0;
    const rounds = [];
    const loserDepth = {};               // slotId -> 마지막으로 진 라운드(승자/무패는 -1)
    for (let i = 0; i < n; i++) loserDepth[i] = -1;   // 기본 -1(라운드1 승자/무패는 그대로)

    let duelIdSeq = 0;
    while (atRisk.length > 1) {
        const poolSize = atRisk.length;   // 이 라운드에 진입하는 at-risk 풀 크기(=duels*2+byes). poolSize[0]=n, 이후 ≈ ceil(prev/2).
        const work = atRisk.slice();
        const byes = [];
        if (work.length % 2 === 1) {
            const bi = Math.floor(rng() * work.length);   // 홀수 라운드 — 정확히 1회 rng 소비(bye 선택)
            byes.push(work.splice(bi, 1)[0]);
        }
        const duels = [];
        const nextRisk = [];
        for (let k = 0; k < work.length; k += 2) {
            const a = work[k], b = work[k + 1];
            const sub = duelSubSeed(seed, roundIdx, a, b);
            const d = simulateDuel(duelIdSeq++, a, b, sub, roundIdx);
            duels.push(d);
            nextRisk.push(d.loserSlot);          // LOSER 잔류(다음 라운드 진출)
            loserDepth[d.loserSlot] = roundIdx;   // 이 라운드에 졌다
            // 듀얼 사이 CPU 양보
            if ((duelIdSeq % SIM_YIELD_EVERY) === 0) await new Promise(r => setImmediate(r));
        }
        for (const by of byes) {
            nextRisk.push(by);
            loserDepth[by] = roundIdx;            // bye는 안 싸우고 잔류 = 이 라운드 loser-depth로 카운트
        }
        const roundDurationMs = Math.max(MIN_ROUND_MS, ...duels.map(d => d.durationMs));
        rounds.push({ roundIdx, durationMs: roundDurationMs, poolSize, duels, byes });
        atRisk = nextRisk;
        roundIdx++;
    }
    const finalLoser = atRisk.length ? atRisk[0] : (n === 1 ? poolOrder[0] : null);
    if (n === 1) loserDepth[poolOrder[0]] = 0;   // 1인 방어(실서버 게이트는 n≥2 — sanity)

    // 전체 durationMs = SEQUENTIAL 브로드캐스트 타임라인(클라가 브래킷을 순차 연출로 재생) —
    //   BRACKET_OVERVIEW_MS + Σ_rounds[ ROUND_INTRO_MS + Σ_duels(DUEL_INTRO_MS + duel.durationMs + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS) + #byes×BYE_BEAT_MS ], GAME_MS 캡.
    //   rounds가 없으면(n=1 sanity, totalDuels===0) BRACKET_OVERVIEW_MS도 더하지 않고 durationMs는 0 유지(rounds.length>0 가드).
    //   라운드 객체의 roundDurationMs 필드는 그대로(브래킷 payload 모양 불변 — 2탭 테스트가 max(MIN_ROUND_MS, 듀얼 max) 단언).
    let durationMs = 0;
    if (rounds.length > 0) {
        durationMs = BRACKET_OVERVIEW_MS;
        for (const r of rounds) {
            durationMs += ROUND_INTRO_MS;
            for (const d of r.duels) {
                durationMs += DUEL_INTRO_MS + d.durationMs + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS;
            }
            durationMs += r.byes.length * BYE_BEAT_MS;
        }
    }
    durationMs = Math.min(GAME_MS, durationMs);

    const finalState = slots.map(sl => ({ id: sl.id, loserDepth: loserDepth[sl.id] }));
    const rankings = rankHumans(slots, finalState);
    const succession = buildSuccession(slots, finalState);   // worst→best(이탈자 대체용)

    return {
        bracket: { poolOrder, rounds, finalLoser, loserDepth },
        finalLoser, succession, rankings,
        slots, sampleMs: SAMPLE_MS, durationMs,
        geom: { scale: 1, charRadius: CHAR_RADIUS, bladeRadius: BLADE_RADIUS, swordLen: SWORD_LEN, bladeEdgeR: BLADE_EDGE_R, duelRingR: DUEL_RING_R }
    };
}

// 사람 슬롯 순위 — loser-depth 기반. rank 1 = 가장 먼저 안전(safe) … 최하위 = finalLoser(당첨/벌칙).
//   best→worst = loserDepth 오름차순(빨리 진/안전한 쪽이 위) → slotId 오름차순.
//   loserDepth -1(라운드1 승자/무패)은 가장 작아 항상 best 쪽. finalLoser는 loserDepth 최대 → 마지막(당첨).
//   finalState = [{ id, loserDepth }] (simulate가 brackt loser-depth로 산출).
function rankHumans(slots, finalState) {
    const fsById = {};
    for (const f of finalState) fsById[f.id] = f;
    const humans = slots.map(sl => ({
        name: sl.name, slotId: sl.id,
        loserDepth: fsById[sl.id] ? fsById[sl.id].loserDepth : -1
    }));
    // best→worst: loserDepth↑ → slotId↑. (-1 = 가장 일찍 안전 = best, depth 최대 = finalLoser = worst)
    const order = humans.slice().sort((a, b) => (a.loserDepth - b.loserDepth) || (a.slotId - b.slotId));
    return order.map((h, i) => ({ name: h.name, slotId: h.slotId, rank: i + 1, loserDepth: h.loserDepth }));
}

// 당첨 승계 목록(이탈자 대체용) — worst→best. 결정론. gameEnd가 "지금도 방에 있는 첫 항목"을 당첨자로 선택.
//   loserDepth 내림차순(가장 깊이 진 쪽 먼저) → slotId 오름차순. succession[0] = finalLoser.
//   라운드1 승자(loserDepth -1)는 항상 마지막 → 더 깊은 패자가 전부 이탈하지 않는 한 당첨이 안 됨(leaver-safe).
function buildSuccession(slots, finalState) {
    const ranks = rankHumans(slots, finalState);   // best→worst
    return ranks.slice().reverse().map(r => r.name);   // worst→best = finalLoser부터
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
    // 잠금 스킨(신규 색/t2)은 인증 계정(socket.authedUserId)의 소유(user_cosmetics) 검증 후에만 허용.
    // 같은 스킨 중복 선택은 허용 — 스킨이 계정 귀속 소유물이라 여러 명이 같은 색을 골라도 정상.
    socket.on('spin-arena:selectSkin', async (data) => {
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
        const skin = skinById(data.skinId);
        if (!skin) {
            socket.emit('spin-arena:error', '없는 스킨입니다.');
            return;
        }

        if (!skin.free) {
            // 잠금 스킨 — 인증 + 소유 검증 (cosmetic_id = 'spin_skin_' + skinId)
            if (!socket.authedUserId) {
                socket.emit('spin-arena:error', '로그인한 사용자만 쓸 수 있는 스킨입니다.');
                return;
            }
            let owned;
            try {
                owned = await getOwned(socket.authedUserId);
            } catch (e) {
                socket.emit('spin-arena:error', '스킨 확인 중 오류가 발생했습니다. 다시 시도해주세요.');
                return;
            }
            if (owned.indexOf('spin_skin_' + skin.id) === -1) {
                socket.emit('spin-arena:error', '보유하지 않은 스킨입니다.');
                return;
            }
            // await 동안 상태가 바뀌었을 수 있음 — idle/준비/재실재 재확인 (start 경합 가드)
            if (sa.phase !== 'idle') return;
            if (!gameState.readyUsers.includes(name)) return;
            const still = gameState.users.find(u => u.id === socket.id);
            if (!still || still.name !== name) return;
        }

        sa.skins[name] = skin.id;
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

        // 게임 시작 시 자동 주문 cycle 가드만 해제 — 진행 중인 주문받기는 닫지 않는다(호스트가 종료 버튼을 누를 때까지 유지)
        gameState.orderAutoTriggered = false;

        // 스킨 배정(클라 미리보기와 거울 규칙): users 배열(입장 순서)을 순회하며
        // 명시 선택 스킨 우선, 없으면 base tier1 24색에서 이미 쓴 색 제외하고 순차 배정 — 미리보기 색 == 실제 게임 색 보장.
        // 자동 배정 풀은 base 24색 전체(소유 무관 — 식별색≠소유) — 24명까지 전부 distinct. 명시 픽의 소유 검증만 유지.
        const usedSkinIds = new Set();
        gameState.users.forEach(u => {
            const sel = sa.skins[u.name];
            if (isValidSkinId(sel)) usedSkinIds.add(sel);
        });
        const autoPool = BASE_SKINS.filter(s => !usedSkinIds.has(s.id)).map(s => s.id);
        let api = 0;
        const assignedSkin = {};   // name -> skinId
        gameState.users.forEach((u, idx) => {
            const sel = sa.skins[u.name];
            assignedSkin[u.name] = isValidSkinId(sel)
                ? sel
                : (api < autoPool.length ? autoPool[api++] : BASE_SKINS[idx % BASE_SKINS.length].id);
        });

        // 게임 슬롯 = 준비자를 users 배열(입장 순서)로 정렬해 선착 최대 MAX_SLOTS명 (봇 없음)
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

        const rankings = sim.rankings;
        const successionList = sim.succession;   // worst→best(이탈자 대체용). succession[0] = finalLoser.
        // selected(당첨자) = finalLoser = 승계 목록 첫 항목 = rankings 최하위
        const selected = successionList.length ? successionList[0] : null;

        // 공개 슬롯 meta — id/name/color/blade/tier per slot(클라 리플레이 식별). 칼날 파라미터는 브래킷 듀얼 안에 있음.
        const revealSlots = slots.map((s) => {
            const sk = skinById(s.skinId) || SPIN_SKINS[0];
            return {
                id: s.id, isBot: false, name: s.name, skinId: sk.id,
                color: sk.color, blade: sk.blade,
                tier: sk.tier || 1,   // 스킨업 시각 전용(클라 아우라) — 시뮬/판정/순위와 무관 (additive)
                bladeCount: BLADE_COUNT, bladeRadius: sim.geom.bladeRadius
            };
        });

        sa.timeline = {   // server-only (socket/rooms.js 재진입 마스킹은 phase/skins/round/history 화이트리스트라 자동 비노출 — bracket은 timeline에만)
            slots: revealSlots, bracket: sim.bracket, geom: sim.geom,
            sampleMs: SAMPLE_MS, durationMs: sim.durationMs
        };
        sa.result = { selected, rankings, successionList };   // server-only

        io.to(room.roomId).emit('spin-arena:reveal', {
            durationMs: sim.durationMs,   // 전체 브래킷 길이(라운드 합 + 전환). 듀얼별 decide는 bracket 내부.
            sampleMs: SAMPLE_MS,
            arena: { w: ARENA_W, h: ARENA_H, cx: ARENA_CX, cy: ARENA_CY, r: ARENA_R },
            slots: revealSlots,           // reveal 메타(id/name/color/blade/tier per slot)
            bracket: sim.bracket,         // { poolOrder, rounds[{roundIdx,durationMs,poolSize,duels[{duelId,slotA,slotB,frames,durationMs,decideMs,loserSlot,winnerSlot,bladeA,bladeB}],byes}], finalLoser, loserDepth }
            geom: sim.geom,               // { scale, charRadius, bladeRadius, swordLen, bladeEdgeR, duelRingR }
            result: { selected, rankings, successionList }
        });

        console.log(`[회전칼날] 방 ${room.roomName} 공개 - 참가자 ${humanCount}명 / 라운드=${sim.bracket.rounds.length} / 당첨=${selected} / 길이=${sim.durationMs}ms`);

        clearSpinTimers(sa);
        // 클라가 3-2-1 카운트다운(COUNTDOWN_MS)만큼 늦게 리플레이를 시작하므로 종료 타이머도 그만큼 가산.
        // durationMs는 시뮬 산출(결판 압축) — 시드 결정론이라 모든 클라와 동일 시점 종료.
        sa.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, COUNTDOWN_MS + sim.durationMs + RESULT_HOLD_MS);

        updateRoomsList();
    });

    function endGame(room, gameState) {
        const sa = gameState.spinArena;
        clearSpinTimers(sa);

        // 결과는 reveal 시점에 확정된 server-only result(결정론). 단, 당첨자가 이탈했으면 승계 목록의
        // "지금도 방에 있는 첫 항목"으로 대체(재계산 없음 → 2탭 동일). 2단계는 승계가 결승 진출자로 한정되어
        // 비결승(안전 승자)이 당첨자가 되는 일은 없다(승계가 비면 selected=null).
        const result = sa.result || { selected: null, rankings: [], successionList: [] };
        const rankings = result.rankings || [];
        const succession = result.successionList || (result.selected ? [result.selected] : []);
        const selected = succession.find(name => gameState.users.some(u => u.name === name)) || null;

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

        // DB: 사람 참가자만 (봇 제외, 위에서 현재 방 잔류자로 필터). selected = 당첨자 = 끝까지 탈출 못 한 사람 = ladder loser 의미.
        recordGamePlay('spin-arena', dbPlayers.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('spin-arena', room.serverId);
            Promise.all(dbPlayers.map(name => {
                const isSelected = name === selected;     // 당첨 = 끝까지 탈출 못 한 사람 = ladder loser 의미
                const isWinner = !isSelected;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'spin-arena', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'spin-arena',
                gameRules: 'tournament',
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
module.exports.buildSuccession = buildSuccession;
module.exports.simulateDuel = simulateDuel;
module.exports.duelSubSeed = duelSubSeed;
