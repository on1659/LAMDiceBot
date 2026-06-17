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

// ─ 2단계 분기 (인원수 기준 — 2026-06-17 재단순화: lowest-damage) ─
// n≥SPIN_TWO_STAGE_MIN = 2단계(Stage1 30초 데미지 레이스 → 하위 FINALIST_COUNT명 결승, 첫 HP 0 = 당첨).
// 그 미만 = 단일 단계(30초 레이스로 끝, 최저 누적 데미지 = 당첨).
const SPIN_TWO_STAGE_MIN = 6;     // 이 인원 이상이면 결승전 진행(미만이면 30초 레이스로 끝)
const FINALIST_COUNT = 3;         // 결승 진출 = 최저 누적 데미지 하위 N명(고정 — 사용자 결정)

// ─ 시간축 ─
const GAME_MS = 70000;            // 하드 캡 = Stage1(40s) + 인트로(8s) + 결승 캡(18s) + 결판 tail(2s) = 68s, 여유 2s
const COUNTDOWN_MS = 4000;        // 클라 3-2-1-START 카운트다운 실측(1000ms×4) — js/spin-arena.js 와 동일 값
const SIM_DT_MS = 20;             // 내부 시뮬 스텝(50fps)
const SAMPLE_MS = 100;            // 키프레임 샘플 간격 → frames 길이 = durationMs/SAMPLE_MS + 1 (durationMs 가변, 최대 GAME_MS)
const SIM_YIELD_EVERY = 100;      // 이 스텝마다 await setImmediate (CPU 양보)

// ─ 캐릭터/칼날 ─
const CHAR_RADIUS = 14;
const BLADE_COUNT = 1;            // 칼날 수 — 기본값(feel-v5 S1: 자동 성장 폐기. 칼은 base 1 + 칼추가 아이템(bladeBonus)만으로 증가).
// ─ 칼날 성장(feel-v5 S1) — 자동 성장 제거. 유일한 증가원 = 칼추가 아이템(bladeBonus, BLADE_CAP까지). ─
// escaped/permaDead(동결)는 픽업을 못 하므로 bladeCount 동결(per-slot 단조 비감소 보존).
const BLADE_CAP = 5;              // 칼날 수 하드캡(BLADE_COUNT 바닥 + bladeBonus 합산 최대 5)
const BLADE_RADIUS = 46;          // 캐릭터 중심 → 칼날 끝 거리
const SWORD_LEN = 28;             // 도신(검 날) 길이 — 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN. 클라 검 그리기와 동일(보이는 검 = 맞는 검)
const BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 클라 도신 반폭(최대 3.4px) 정합. 판정 = 날 선분 vs 몸 원
const BLADE_SPIN_MIN = 3.5, BLADE_SPIN_MAX = 6.0;   // rad/s (슬롯별 시드)

// ─ 체력/데미지 (수치 권위 = 200시드 배치) ─
const HP_MAX = 100;               // 결승 결투 HP(Stage1은 HP 불변 — 탈락 없음). hpFrames 분모 = HP_MAX
const STAGE1_HIT_DPS = 80;        // Stage1: 칼날→다른 플레이어 몸 겹친 동안 초당 "입힌 데미지"(=점수, c채널). 탈락 없음
const HIT_DPS = 220;              // 결승: 칼날→상대 HP 초당 데미지. feel-v5 S1: base-1 칼날(얇은 단일 날)로 결승 드레인이 느려져 fallback% 폭증 → 110→220(권위 = 200시드 배치, n24 fallback 0%).
const DECIDE_TAIL_MS = 2000;      // 당첨 확정(decideMs) 후 결판 비트 길이 — 캡에 잘리면 잘린 만큼만

// ─ 단계 시간 ─
const STAGE1_MS = 40000;          // Stage1 타임박스(고정 40초 데미지 레이스 — 탈락·조기종료 없음)
const ROUND2_INTRO_MS = 8000;     // Stage1→결승 전환(전투 정지·결승 집결·링 풀): 순위 요약 ≥5s + 3·2·1 3s
const RING2_SHRINK_MS = 6500;     // 결승: 인트로 종료부터 RING_R_START→RING_R_END 수축 — 강제 교전
const FINALE_MAX_MS = 18000;      // 결승 결투 캡 — 이 시각까지 HP 0 미발생 시 HP 최저자 = 당첨(HP-lowest fallback → decideMs는 절대 null 아님)

// ─ 안전구역 링 ─
const RING_R_START = 220;         // 바깥벽 = 시작 반경
const RING_R_END = 60;            // 결승 최종 반경 — 소인원에서도 강제 교전이 일어나게 좁힘
const STAGE1_RING_END = 150;      // Stage1 종료 시점 링 반경(완만 수축으로 군집 압박, 24명 그리드락 방지)

// ─ 이동 ─
const DRIFT_SPEED = 50;           // 초기 드리프트 속도(px/s) 기준
// feel-v5 S2: Stage1은 "가장 가까운 상대를 추격(hunt-nearest)" — 여기저기서 교전(중앙 blob 해소).
//   HUNT_ACCEL: 최근접 활성 상대 방향 가속(px/s^2). CENTER_BIAS: 벽 밀착 방지용 약한 중앙 인력(px/s^2).
//   둘 다 rng-free(위치 파생) — RNG 소비 순서 불변. 권위 = 200시드 배치.
const HUNT_ACCEL = 55;            // Stage1 최근접 상대 추격 가속(강) — 짝지어 스커미시
const CENTER_BIAS = 8;            // Stage1 약한 중앙 인력(벽 밀착 방지) — 기존 CENTER_PULL(30) 대체(많이 낮춤)
const FINALE_PULL = 240;          // 결승 중앙 인력(강) — 3인을 중앙에 밀착시켜 칼날 상시 접촉 → HP-0 결판 보장(fallback 의존 낮춤). feel-v5 S1: base-1 칼날 보강 위해 110→240. 권위 = 200시드 배치
const SPIN_DRAG = 0.45;           // 드리프트 선형 감쇠(/s) — 인력만 있으면 보존계 영구 진동 → 나선 수렴
const WALL_BOUNCE = 0.9;          // 벽(링 하드 월) 반사 감쇠

// ─ Stage1 공전(swirl) — 군중이 한 점 수렴 대신 회전. 시드 파생(rng 0회 — 소비 순서 불변). ─
const ORBIT_BIAS_MIN = 0.15, ORBIT_BIAS_MAX = 0.55; // 중앙 주위 접선(공전) 성분 비율(baseAngle 정규화 파생)

// ─ Stage1 이동 다양화(B2) — 캐릭터별 이동속도/인력 배율. 이미 소비한 시드 필드 파생(rng 0회 — 소비 순서 불변). ─
// speedMul: spinSpeed 정규화 → 드리프트 적분 배율(빠른 칼 = 빠른 발). pullMul: baseAngle 정규화 → 중앙 인력 배율(경로 다양화).
// 군중이 한 점 blob으로 수렴하지 않고 서로 다른 속도/경로로 움직이게 함. 권위 = 200시드 배치.
const SPEED_MUL_MIN = 0.75, SPEED_MUL_MAX = 1.25;   // spinSpeed 정규화 파생 — 드리프트(이동) 속도 배율
const PULL_MUL_MIN = 0.80, PULL_MUL_MAX = 1.20;     // baseAngle 정규화 파생 — 중앙 인력 배율(경로 다양화)

// ─ 캐릭터 충돌 바운스(B3 + feel-v5 S3) — 위치 디오버랩에 더해 탄성 속도 교환(팅겨짐). 결정론(rng 0회). ─
const COLLIDE_MARGIN = 12;        // feel-v5 S3: 충돌 판정 여유(px, s 스케일). minD = 2*charR + COLLIDE_MARGIN*s → 더 넓은 범위에서 부딪힘
const COLLIDE_RESTITUTION = 1.3;  // 반발 계수 — feel-v5 S3: 0.8→1.3(튕김 비율 크게). 드리프트 속도(vx/vy)에만 적용(넉백 kvx/kvy 불변)
const COLLIDE_POP = 10;           // feel-v5 S3: 최소 분리 임펄스(px/s) — rel≈0(느린 접촉)에도 법선 방향으로 팝을 줘 가시적 분리

// ─ 픽업 아이템(B5, 결정론) — 스폰 RNG는 per-char 루프 뒤에 고정 스케줄로 소비(소비 순서 재동결). 픽업 판정은 sim 위치(rng 0회) ─
const ITEM_R = 12;                 // 픽업 반경(몸 원 + 이 값 겹치면 획득)
const ITEM_SPAWN_INTERVAL = 7000;  // Stage1 스폰 간격(ms)
const ITEM_TTL = 8000;             // 미획득 시 소멸까지(ms)
const ITEM_DOUBLE_MS = 5000;       // 딜두배 지속(ms)
const ITEM_SPEED_MS = 5000;        // 속도 지속(ms)
const ITEM_SPEED_MUL = 1.5;        // 속도 배율(B2 speedMul 위에 곱)
const ITEM_SHIELD_MS = 4000;       // 보호막/무적 지속(ms)
const ITEM_HEAL = 35;              // 회복량(결승 의미 — Stage1은 HP 불변이라 무효지만 정상)
const ITEM_TYPES = { DOUBLE: 'double', SHIELD: 'shield', SPEED: 'speed', BLADE: 'blade', HEAL: 'heal' };
// 스테이지별 풀: Stage1 = dealt 레이스 의미(double/speed/blade), Finale = HP 의미(heal/shield/speed)
const ITEM_POOL_STAGE1 = [ITEM_TYPES.DOUBLE, ITEM_TYPES.SPEED, ITEM_TYPES.BLADE];
const ITEM_POOL_FINALE = [ITEM_TYPES.HEAL, ITEM_TYPES.SHIELD, ITEM_TYPES.SPEED];

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

// ─── 링 반경 함수 (클라와 동일 구현) — 단계 인지 ───
// round1EndMs === null  → 단일 단계(n<6) 또는 2단계의 Stage1 진행 중: Stage1 완만 수축(220→150, STAGE1_MS).
// round1EndMs !== null  → 2단계 결승: t<round1EndMs Stage1, 인트로 동안 링 풀(220), 인트로 후 수축(220→60).
// round1EndMs는 시뮬 중 Stage1 종료 시 1회 확정 후 payload로 전달 — 클라/서버 동일 입력이라 결정론.
function ringRadiusAt(t, round1EndMs) {
    if (round1EndMs === null || round1EndMs === undefined) {
        // Stage1 진행 중(또는 단일 단계 전체): 완만 수축
        const k = Math.min(1, Math.max(0, t / STAGE1_MS));
        return RING_R_START + (STAGE1_RING_END - RING_R_START) * k;
    }
    if (t < round1EndMs) {
        const k = Math.min(1, Math.max(0, t / round1EndMs));
        return RING_R_START + (STAGE1_RING_END - RING_R_START) * k;
    }
    // 인트로(결승 3인 집결): 링 풀
    if (t < round1EndMs + ROUND2_INTRO_MS) return RING_R_START;
    // 결승 수축
    const k = Math.min(1, (t - (round1EndMs + ROUND2_INTRO_MS)) / RING2_SHRINK_MS);
    return RING_R_START + (RING_R_END - RING_R_START) * k;
}

// ─ 인원 가변 스케일 s(n)=√(6/n), n≤6 동결 (설계 §3-1, packRatio 0.33 불변) ─
function spinScale(n) { return n <= 6 ? 1 : Math.sqrt(6 / n); }
// 스폰반경: 인접 칼끝 간격 > 2×칼날+8 (스폰 즉시 피격 방지), 0.55~0.78·ARENA_R 클램프
function spinSpawnR(n) {
    const s = spinScale(n);
    const need = 2 * BLADE_RADIUS * s + 8;
    const r = need / (2 * Math.sin(Math.PI / n));
    return Math.min(Math.max(ARENA_R * 0.55, r), ARENA_R * 0.78);
}

/**
 * 결정론 시뮬레이션 (2026-06-17 재단순화: lowest-damage 2단계) — async로 SIM_YIELD_EVERY 스텝마다 setImmediate 양보.
 *
 * twoStage = n >= SPIN_TWO_STAGE_MIN
 *   공통 Stage1 (0~STAGE1_MS, 고정 30초): 몬스터/탈락/부활/경직 없음. 전원 칼날 난투(중앙 인력 + swirl + 완만 링 수축).
 *     칼날이 다른 플레이어 몸에 입힌 데미지 = 누적 점수(dealt, c채널). 맞은 쪽은 received 누적(동점 처리용). HP 불변(탈락 없음).
 *   단일 단계 (n<6): Stage1 끝(STAGE1_MS)에서 최저 누적 dealt = 당첨. decideMs = STAGE1_MS, round1EndMs = null.
 *   2단계 (n≥6): Stage1 끝에서 최저 dealt 하위 FINALIST_COUNT명 = 결승 진출(finalist), 나머지는 안전(escaped=승자).
 *     round1EndMs = STAGE1_MS 확정. 인트로(ROUND2_INTRO_MS) 후 결승: 3인 축소 링 서든데스, 첫 HP 0 = 당첨(permaDead) → decideMs.
 *     FINALE_MAX_MS까지 미결판이면 HP 최저자 강제 당첨(fallback) → decideMs는 절대 null 아님.
 *
 * decideMs 확정 시 durationMs = min(GAME_MS, ceil((decideMs+DECIDE_TAIL_MS)/SAMPLE_MS)*SAMPLE_MS) 압축.
 * RNG 소비 = 캐릭터당 6회(rr→vAng→sp→baseAngle→spinSpeed→spinDir)만, 그 외 0회(루프 내 rng 없음). 새 동결 순서 — 변경 금지.
 * slots: [{ id, isBot, name, skinId }] (id == 배열 인덱스, 전원 사람). seed: 32bit int.
 * @returns { twoStage, frames, hpFrames, bladeFrames, hpMax, finalists, round1EndMs, decideMs, durationMs, finalState, geom }
 */
async function simulate(slots, seed) {
    const rng = mulberry32(seed);
    const n = slots.length;
    const twoStage = n >= SPIN_TWO_STAGE_MIN;
    const s = spinScale(n);
    const charR = CHAR_RADIUS * s, bladeR = BLADE_RADIUS * s, swordLen = SWORD_LEN * s, bladeEdgeR = BLADE_EDGE_R * s;
    const spawnR = spinSpawnR(n);
    const dt = SIM_DT_MS / 1000;

    // 1) 캐릭터 초기 상태 — 중심 둘레 균등 배치 + 시드 지터. RNG 소비 순서 고정(char당 6회: rr→vAng→sp→baseAngle→spinSpeed→spinDir). 변경 금지.
    const spawnJitter = n <= 6 ? ARENA_R * 0.1 : ARENA_R * 0.04;
    const st = slots.map((sl, i) => {
        const baseAng = (i / slots.length) * 2 * Math.PI;
        const rr = spawnR + rng() * spawnJitter;
        const px = ARENA_CX + Math.cos(baseAng) * rr, py = ARENA_CY + Math.sin(baseAng) * rr;
        const vAng = rng() * 2 * Math.PI, sp = DRIFT_SPEED * (0.6 + rng() * 0.8);
        const bAngle = rng() * 2 * Math.PI;
        const spinSpd = BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN);
        const spinDr = rng() < 0.5 ? 1 : -1;
        return {
            id: i, hp: HP_MAX,
            dealt: 0,                           // 다른 플레이어에게 입힌 누적 데미지(단조) = 점수/리더보드(c채널)
            received: 0,                        // 받은 누적 데미지(단조) — 결승 진출 동점 처리용
            escaped: false,                     // Stage1 종료 후 "안전(상위 데미지 = 승자)" — 동결, 결승 제외
            finalist: false,                    // 최저 데미지 하위 3명(2단계) — 결승 결투 참가
            permaDead: false,                   // 결승 패자 = 당첨자(좌표 동결)
            x: px, y: py, vx: Math.cos(vAng) * sp, vy: Math.sin(vAng) * sp,
            kvx: 0, kvy: 0,
            bladeCount: BLADE_COUNT,            // feel-v5 S1: base 1. 칼추가 아이템 픽업 시에만 BLADE_COUNT+bladeBonus로 갱신.
            bladeBonus: 0,                      // 칼추가 아이템(획득 시 +1). bladeBonus만 증가 → cap 안에서 per-slot 단조 비감소 보존
            dmgMul: 1, dmgMulUntil: 0,          // B5 딜두배(획득 시 dmgMul=2, dmgMulUntil까지). 전부 plain literal — rng 소비 무변경
            speedBoostUntil: 0,                 // B5 속도(획득 시 speedBoostUntil까지 ITEM_SPEED_MUL 곱)
            shieldUntil: 0,                     // B5 보호막/무적(획득 시 shieldUntil까지 received/hp 면역, 넉백은 적용)
            baseAngle: bAngle, spinSpeed: spinSpd, spinDir: spinDr,
            // Stage1 swirl(rng-free 파생) — 공전 방향/접선 비율
            orbitDir: spinDr,
            orbitBias: ORBIT_BIAS_MIN + (bAngle / (2 * Math.PI)) * (ORBIT_BIAS_MAX - ORBIT_BIAS_MIN),
            // Stage1 이동 다양화(B2, rng-free 파생) — 고유 필드명(var-hoist 트랩 회피).
            // speedMul: spinSpeed 정규화(BLADE_SPIN_MIN~MAX) → 0.75~1.25. pullMul: baseAngle 정규화 → 0.80~1.20.
            speedMul: SPEED_MUL_MIN + ((spinSpd - BLADE_SPIN_MIN) / (BLADE_SPIN_MAX - BLADE_SPIN_MIN)) * (SPEED_MUL_MAX - SPEED_MUL_MIN),
            pullMul: PULL_MUL_MIN + (bAngle / (2 * Math.PI)) * (PULL_MUL_MAX - PULL_MUL_MIN)
        };
    });

    // ─ 픽업 아이템 스폰 스케줄(B5) — DETERMINISM CRITICAL. per-char map 루프가 끝난 직후, 여기서만 신규 rng 소비.
    //   고정 cadence(ITEM_SPAWN_INTERVAL)로 spawnMs 틱 순회 — 루프 경계가 twoStage에 의존하지 않아 시드당 rng 횟수 동일.
    //   틱당 정확히 3 rng()(ang→rf→typeR, 고정 순서). 픽업 판정은 위치 기반(rng 0회, 아래 active 루프).
    //   round1EndMs는 twoStage에서 항상 STAGE1_MS(고정 타임박스)라 ring 인자로 미리 넘겨도 결정론.
    const items = [];
    const pickups = [];
    const itemRingEnd = twoStage ? STAGE1_MS : null;
    for (let spawnMs = ITEM_SPAWN_INTERVAL; spawnMs < STAGE1_MS + FINALE_MAX_MS; spawnMs += ITEM_SPAWN_INTERVAL) {
        const ang = rng() * 2 * Math.PI;        // ① 각도
        const rf = rng();                        // ② 반경 분수(sqrt로 면적 균등)
        const typeR = rng();                     // ③ 타입 선택
        const ringAtSpawn = ringRadiusAt(spawnMs, itemRingEnd);
        const maxR = Math.max(20, ringAtSpawn - charR - ITEM_R - 6);   // 벽 안쪽 여유
        const rrad = Math.sqrt(rf) * maxR;
        const ix = ARENA_CX + Math.cos(ang) * rrad, iy = ARENA_CY + Math.sin(ang) * rrad;
        const pool = spawnMs < STAGE1_MS ? ITEM_POOL_STAGE1 : ITEM_POOL_FINALE;
        const itype = pool[Math.floor(typeR * pool.length)];
        items.push({ id: items.length, type: itype, x: ix, y: iy, spawnMs, despawnMs: spawnMs + ITEM_TTL, consumed: false });
    }

    const frames = [];           // 키프레임 — [x, y, c] per slot (c = dealt = 다른 플레이어에게 입힌 누적 데미지 = 점수)
    const hpFrames = [];         // 키프레임 — hp int per slot(stride 1, frames와 평행). 결승 HP바 렌더용. additive.
    const bladeFrames = [];      // 키프레임 — 칼날 수 int per slot(stride 1, frames와 평행, B4). 클라 per-slot/per-time 칼날 수. additive.
    const finalists = [];        // 결승 진출 슬롯ID(2단계만, FINALIST_COUNT개). 단일 단계면 빈 배열.
    let decideMs = null;         // 당첨 확정 시각(ms). HP-lowest fallback이 보장 → 절대 null로 남지 않음
    let round1EndMs = null;      // Stage1 종료 시각(2단계만). 결승 링/단계 전환 기준. 단일 단계 = null
    let endMs = GAME_MS;
    let nextSampleMs = 0;

    function sample() {
        const f = [];
        const hf = [];
        const bc = [];
        for (const c of st) {
            f.push(Math.round(c.x), Math.round(c.y), Math.round(c.dealt));
            hf.push(Math.max(0, Math.round(c.hp)));   // 순수 c.hp 읽기(rng 0회). Stage1=HP_MAX 불변, 결승에서만 감소.
            bc.push(Math.round(c.bladeCount));        // B4 칼날 수(이미 Math.floor/min 정수 — round는 안전용). escaped/permaDead는 동결값.
        }
        frames.push(f);
        hpFrames.push(hf);
        bladeFrames.push(bc);
    }

    // 칼날 날 선분(활성 캐릭터별) — 이동 전 스냅샷. escaped(안전)/permaDead(당첨자)는 제외.
    function buildBlades(tMs) {
        const blades = [];
        for (const c of st) {
            if (c.escaped || c.permaDead) continue;
            const bc = c.bladeCount;
            for (let k = 0; k < bc; k++) {
                const a = c.baseAngle + c.spinDir * c.spinSpeed * (tMs / 1000) + k * (2 * Math.PI / bc);
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
    // feel-v5 S1: 자동 칼날 성장(growBlades) 제거. bladeCount는 칼추가 아이템 픽업(resolveItemPickups)에서만 갱신.
    function applyKnock(c, dx, dy) {
        const dl = Math.hypot(dx, dy) || 1;
        c.kvx += (dx / dl) * KNOCK_IMPULSE; c.kvy += (dy / dl) * KNOCK_IMPULSE;
        const km = Math.hypot(c.kvx, c.kvy);
        if (km > KNOCK_MAX) { c.kvx *= KNOCK_MAX / km; c.kvy *= KNOCK_MAX / km; }
    }
    // 드리프트 속도(vx/vy) 크기 상한 — 충돌 바운스(B3) 폭주 방지. KNOCK_MAX 재사용.
    function clampSpeed(c) {
        const sm = Math.hypot(c.vx, c.vy);
        if (sm > KNOCK_MAX) { c.vx *= KNOCK_MAX / sm; c.vy *= KNOCK_MAX / sm; }
    }
    // 이동 적분(드래그+넉백) + 링 하드 월 + 넉백 감쇠. pull은 호출 전 vx/vy에 이미 가산.
    // driftMul(B2, 기본 1): 드리프트 속도(vx/vy)의 위치 기여만 배율(넉백 kvx/kvy 불변). rng-free 캐릭터별 이동속도 다양화.
    function integrate(c, ring, driftMul) {
        const dm = (driftMul === undefined) ? 1 : driftMul;
        c.vx -= c.vx * SPIN_DRAG * dt; c.vy -= c.vy * SPIN_DRAG * dt;
        c.x += (c.vx * dm + c.kvx) * dt; c.y += (c.vy * dm + c.kvy) * dt;
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
    function setDecide(tMs) {
        decideMs = tMs;
        endMs = Math.min(GAME_MS, Math.ceil((decideMs + DECIDE_TAIL_MS) / SAMPLE_MS) * SAMPLE_MS);
    }
    // Stage1 종료(2단계) — 최저 누적 dealt 하위 FINALIST_COUNT명 = 결승 진출, 나머지는 안전(escaped=승자).
    // 선정 정렬: dealt↑(낮을수록 결승) → received↑ → slotId. rng 0회.
    function enterFinale(tMs) {
        round1EndMs = tMs;
        const order = st.slice().sort((a, b) => (a.dealt - b.dealt) || (a.received - b.received) || (a.id - b.id));
        const finSet = new Set(order.slice(0, FINALIST_COUNT).map(c => c.id));
        for (const c of st) {
            if (finSet.has(c.id)) { c.finalist = true; c.hp = HP_MAX; c.vx = 0; c.vy = 0; c.kvx = 0; c.kvy = 0; }
            else c.escaped = true;   // 안전(상위 데미지 = 승자) — 동결, 결승 제외
        }
        // 결승 3인 고정 균등 배치(원형). baseAngle(시드 파생) 정렬 = 고정 위치·랜덤 배정. rng 0회. 클라 암전이 스냅을 가림.
        const ordered = st.filter(c => c.finalist).sort((a, b) => (a.baseAngle - b.baseAngle) || (a.id - b.id));
        const rc = ordered.length;
        const startR2 = Math.max(70, (2.2 * charR * rc) / (2 * Math.PI));
        for (let k = 0; k < rc; k++) {
            const c = ordered[k];
            const ang2 = (k / rc) * 2 * Math.PI;
            c.x = ARENA_CX + Math.cos(ang2) * startR2;
            c.y = ARENA_CY + Math.sin(ang2) * startR2;
        }
        for (const c of ordered) finalists.push(c.id);
    }
    // 디오버랩(위치) + 탄성 바운스(속도, B3). 활성(비안전·비당첨자) char 쌍 전수(i<j 고정 = 결정론).
    // 겹치면: ① 대칭으로 각자 overlap/2 반대방향 이동(위치). ② 접근 중이면 법선 방향 드리프트 속도를 탄성 교환(팅겨짐, B3).
    //   동질량 탄성: 두 캐릭터의 법선 속도 성분을 restitution 배율로 교환. 드리프트(vx/vy)에만 적용 — 넉백(kvx/kvy) 불변.
    //   결과 속도는 KNOCK_MAX 클램프로 폭주 방지. d===0(완전겹침)은 슬롯 인덱스 고정 방향 분리 — rng() 0회.
    // 분리·바운스 후 ring 안으로 재클램프(integrate와 동일 식) → 하드월 회귀 무위반.
    function separateChars(tMs) {
        const ring = ringRadiusAt(tMs, round1EndMs);
        const wallR = ring - charR;
        const minD = 2 * charR + COLLIDE_MARGIN * s;   // feel-v5 S3: 충돌 판정 더 넓게(s 스케일 비례)
        for (let i = 0; i < st.length; i++) {
            const ci = st[i];
            if (ci.escaped || ci.permaDead) continue;
            for (let j = i + 1; j < st.length; j++) {
                const cj = st[j];
                if (cj.escaped || cj.permaDead) continue;
                const dx = cj.x - ci.x, dy = cj.y - ci.y;
                const d = Math.hypot(dx, dy);
                if (d > 0 && d < minD) {
                    const overlap = minD - d;
                    const nx = dx / d, ny = dy / d;
                    const half = overlap / 2;
                    ci.x -= nx * half; ci.y -= ny * half;
                    cj.x += nx * half; cj.y += ny * half;
                    // 탄성 바운스(B3 + feel-v5 S3) — 법선(n) 방향 드리프트 상대속도가 접근(rel<0)이면 탄성 교환,
                    //   아니면(느린 접촉) 최소 분리 팝(COLLIDE_POP)으로 가시적 분리. rng 0회.
                    const rel = (cj.vx - ci.vx) * nx + (cj.vy - ci.vy) * ny;
                    if (rel < 0) {
                        // 동질량 탄성 충돌: 법선 속도 성분 교환(restitution 배율). impulse = -(1+e)·rel/2.
                        const imp = -(1 + COLLIDE_RESTITUTION) * rel / 2;
                        ci.vx -= imp * nx; ci.vy -= imp * ny;
                        cj.vx += imp * nx; cj.vy += imp * ny;
                    } else {
                        // 느린/이탈 접촉도 가시적으로 떼어놓는 평탄 팝(법선 따라 대칭). feel-v5 S3.
                        const pop = COLLIDE_POP / 2;
                        ci.vx -= pop * nx; ci.vy -= pop * ny;
                        cj.vx += pop * nx; cj.vy += pop * ny;
                    }
                    clampSpeed(ci); clampSpeed(cj);
                } else if (d === 0) {
                    // 완전겹침 — 슬롯 인덱스 기반 고정 방향(rng 금지). 속도는 손대지 않음(법선 미정의).
                    const half = minD / 2;
                    ci.x -= half; cj.x += half;
                }
            }
        }
        // 분리로 벽 밖으로 나간 char를 ring 안으로 재클램프
        for (const c of st) {
            if (c.escaped || c.permaDead) continue;
            const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
            if (nd > wallR) {
                const nx = (c.x - ARENA_CX) / nd, ny = (c.y - ARENA_CY) / nd;
                c.x = ARENA_CX + nx * wallR; c.y = ARENA_CY + ny * wallR;
            }
        }
    }
    // 픽업 판정(B5, rng 0회) — 위치 settle 후 호출. 활성(비안전·비당첨자) 중 겹치는 가장 낮은 slotId가 1회 소비(결정론).
    //   st는 slotId 순서(slots.map id:i)라 for..of 첫 겹침 = 최저 slotId. 효과는 타이머 필드에만 기록(timed expire는 active 루프에서).
    function resolveItemPickups(tMs) {
        for (const it of items) {
            if (it.consumed) continue;
            if (tMs < it.spawnMs || tMs >= it.despawnMs) continue;
            let eater = -1;
            const reach = (charR + ITEM_R) * (charR + ITEM_R);
            for (const c of st) {
                if (c.escaped || c.permaDead) continue;
                const dx = c.x - it.x, dy = c.y - it.y;
                if (dx * dx + dy * dy < reach) { eater = c.id; break; }   // st = slotId 순서 → 첫 겹침 = 최저 slotId
            }
            if (eater < 0) continue;
            it.consumed = true;
            const c = st[eater];
            pickups.push({ itemId: it.id, type: it.type, slotId: eater, timeMs: tMs });
            if (it.type === ITEM_TYPES.DOUBLE) { c.dmgMul = 2; c.dmgMulUntil = tMs + ITEM_DOUBLE_MS; }
            else if (it.type === ITEM_TYPES.SPEED) { c.speedBoostUntil = tMs + ITEM_SPEED_MS; }
            else if (it.type === ITEM_TYPES.BLADE) { c.bladeBonus += 1; c.bladeCount = Math.min(BLADE_CAP, BLADE_COUNT + c.bladeBonus); }
            else if (it.type === ITEM_TYPES.HEAL) { c.hp = Math.min(HP_MAX, c.hp + ITEM_HEAL); }
            else if (it.type === ITEM_TYPES.SHIELD) { c.shieldUntil = tMs + ITEM_SHIELD_MS; }
        }
    }

    for (let step = 0; ; step++) {
        const tMs = step * SIM_DT_MS;
        if (tMs >= nextSampleMs) { sample(); nextSampleMs += SAMPLE_MS; }
        if (tMs >= endMs) break;

        const ring = ringRadiusAt(tMs, round1EndMs);
        const inStage1 = (round1EndMs === null);   // 전환 전(단일 단계 전체 또는 2단계 Stage1)

        if (inStage1) {
            // ===== STAGE 1: 30초 데미지 레이스 — 탈락 없음. (단일 단계 결판 후엔 동결) =====
            if (decideMs === null) {
                // B5: 만료된 딜두배 리셋(rng 0회). buildBlades 전 — 이번 틱 데미지에 정확히 반영.
                for (const c of st) { if (c.dmgMulUntil && tMs >= c.dmgMulUntil) { c.dmgMul = 1; c.dmgMulUntil = 0; } }
                const blades = buildBlades(tMs);   // feel-v5 S1: 칼날 수 = base + 칼추가 아이템(자동 성장 폐기)
                // 칼날 → 다른 플레이어 몸 = 입힌 데미지(점수=dealt) + 받은 데미지(received) + 넉백. HP 불변(탈락 없음).
                for (const bl of blades) {
                    const owner = st[bl.owner];
                    const sx = bl.ox - bl.ix, sy = bl.oy - bl.iy;
                    for (const c of st) {
                        if (c.id === bl.owner || c.escaped || c.permaDead) continue;
                        let tt = ((c.x - bl.ix) * sx + (c.y - bl.iy) * sy) / (swordLen * swordLen);
                        if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                        const dx = c.x - (bl.ix + sx * tt), dy = c.y - (bl.iy + sy * tt);
                        if (dx * dx + dy * dy < (charR + bladeEdgeR) * (charR + bladeEdgeR)) {
                            const dmg = STAGE1_HIT_DPS * dt * owner.dmgMul;   // B5 딜두배(공격자)
                            owner.dealt += dmg;
                            if (!(tMs < c.shieldUntil)) c.received += dmg;     // B5 보호막: 피격자 received 면제(동점 처리 무영향), dealt는 항상 가산
                            applyKnock(c, dx, dy);                            // 넉백은 보호막과 무관하게 항상 적용
                        }
                    }
                }
                // 이동(feel-v5 S2) — 가장 가까운 활성 상대를 추격(hunt-nearest) → 여기저기서 스커미시.
                //   ① 최근접 활성 상대 방향 가속(HUNT_ACCEL, pullMul 배율) — O(n²) 최근접(n≤24, 동률은 최저 slotId).
                //   ② 약한 중앙 인력(CENTER_BIAS) — 벽 밀착 방지(중앙 blob 안 됨).
                //   ③ 기존 공전 접선(swirl, 약화) — 직선 추격 단조로움 완화.
                //   전부 rng-free(위치/시드 파생) — RNG 소비 순서 불변. speedMul로 드리프트 적분 배율(이동속도 다양화).
                for (const c of st) {
                    if (c.escaped || c.permaDead) continue;
                    // ① 최근접 활성 상대 탐색(결정론: 최소 거리, 동률 최저 slotId)
                    let ox = 0, oy = 0, bestD2 = Infinity, found = false;
                    for (const o of st) {
                        if (o.id === c.id || o.escaped || o.permaDead) continue;
                        const ddx = o.x - c.x, ddy = o.y - c.y;
                        const dd2 = ddx * ddx + ddy * ddy;
                        if (dd2 < bestD2) { bestD2 = dd2; ox = o.x; oy = o.y; found = true; }
                    }
                    if (found) {
                        const hdx = ox - c.x, hdy = oy - c.y;
                        const hd = Math.hypot(hdx, hdy);
                        if (hd > 0) {
                            const hacc = HUNT_ACCEL * c.pullMul;
                            c.vx += (hdx / hd) * hacc * dt; c.vy += (hdy / hd) * hacc * dt;
                        }
                    }
                    // ② 약한 중앙 인력(벽 밀착 방지) + ③ 공전 접선(약화)
                    const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
                    const cdist = Math.hypot(cdx, cdy) || 1;
                    c.vx += (-cdx / cdist) * CENTER_BIAS * dt; c.vy += (-cdy / cdist) * CENTER_BIAS * dt;
                    const tnx = -cdy / cdist, tny = cdx / cdist;   // 중앙 둘레 접선
                    c.vx += tnx * c.orbitDir * CENTER_BIAS * c.orbitBias * dt;
                    c.vy += tny * c.orbitDir * CENTER_BIAS * c.orbitBias * dt;
                    integrate(c, ring, c.speedMul * (tMs < c.speedBoostUntil ? ITEM_SPEED_MUL : 1));   // B5 속도
                }
                separateChars(tMs);
                resolveItemPickups(tMs);   // B5 픽업 판정(위치 settle 후, rng 0회)
                // Stage1 종료(고정 30초)
                if (tMs >= STAGE1_MS) {
                    if (twoStage) enterFinale(tMs);   // 하위 3명 결승 진출, 나머지 안전(escaped)
                    else setDecide(tMs);              // 단일 단계: 최저 dealt = 당첨, 즉시 결판(이후 동결)
                }
            }
        } else {
            // ===== STAGE 2: 결승 (2단계만) — 결승 3인 서든데스, 첫 HP 0 = 당첨 =====
            const introEnd = round1EndMs + ROUND2_INTRO_MS;
            const inIntro = tMs < introEnd;   // 인트로(순위 요약 + 3·2·1): 전투 정지·고정 배치 유지
            if (decideMs === null && !inIntro) {
                // B5: 만료된 딜두배 리셋(rng 0회). buildBlades 전.
                for (const c of st) { if (c.dmgMulUntil && tMs >= c.dmgMulUntil) { c.dmgMul = 1; c.dmgMulUntil = 0; } }
                const blades = buildBlades(tMs);   // feel-v5 S1: 칼날 수 = base + 칼추가(자동 성장 폐기). escaped/permaDead 제외 → 결승 3인 칼날만
                for (const c of st) {
                    if (c.escaped || c.permaDead) continue;
                    let d = 0;
                    for (const bl of blades) {
                        if (bl.owner === c.id) continue;
                        const sx = bl.ox - bl.ix, sy = bl.oy - bl.iy;
                        let tt = ((c.x - bl.ix) * sx + (c.y - bl.iy) * sy) / (swordLen * swordLen);
                        if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                        const dx = c.x - (bl.ix + sx * tt), dy = c.y - (bl.iy + sy * tt);
                        if (dx * dx + dy * dy < (charR + bladeEdgeR) * (charR + bladeEdgeR)) {
                            const dmgAmt = HIT_DPS * dt * st[bl.owner].dmgMul;   // B5 딜두배(공격자)
                            d += dmgAmt;
                            st[bl.owner].dealt += dmgAmt;   // 결승 데미지도 dealt 누적(c채널 단조 유지)
                            applyKnock(c, dx, dy);          // 넉백은 보호막과 무관하게 항상 적용
                        }
                    }
                    if (d > 0) { if (!(tMs < c.shieldUntil)) { c.received += d; c.hp -= d; } }   // B5 보호막: received·hp 둘 다 면역(무적)
                }
                // 첫 HP 0 = 당첨(permaDead, 좌표 동결) → decideMs 확정
                for (const c of st) {
                    if (c.escaped || c.permaDead) continue;
                    if (c.hp <= 0) { c.hp = 0; c.permaDead = true; setDecide(tMs); break; }
                }
                // HP-lowest fallback — 결승 캡까지 미결판이면 HP 최저자 강제 당첨(decideMs는 절대 null 아님)
                if (decideMs === null && tMs >= introEnd + FINALE_MAX_MS) {
                    const alive = st.filter(c => !c.escaped && !c.permaDead);
                    alive.sort((a, b) => (a.hp - b.hp) || (a.dealt - b.dealt) || (a.id - b.id));
                    if (alive.length) { alive[0].permaDead = true; setDecide(tMs); }
                }
            }
            // 이동 — 강한 중앙 인력(FINALE_PULL) + 링 수축(결승 3인만). 인트로 동안은 고정 배치 유지(이동 정지).
            if (!inIntro) {
                for (const c of st) {
                    if (c.escaped || c.permaDead) continue;
                    const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
                    const cdist = Math.hypot(cdx, cdy) || 1;
                    c.vx += (-cdx / cdist) * FINALE_PULL * dt; c.vy += (-cdy / cdist) * FINALE_PULL * dt;
                    integrate(c, ring, (tMs < c.speedBoostUntil ? ITEM_SPEED_MUL : 1));   // B5 속도(결승은 base speedMul 없음 — boost만)
                }
                separateChars(tMs);
                resolveItemPickups(tMs);   // B5 픽업 판정(위치 settle 후, rng 0회)
            }
        }

        if (step % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    }

    return {
        twoStage, frames, hpFrames, bladeFrames, hpMax: HP_MAX, finalists, round1EndMs,
        decideMs, durationMs: endMs, finalState: st,
        // B5 픽업: durationMs(결판 압축) 이후 스폰 예정 아이템은 리플레이 윈도우 밖이라 제거(후처리 — rng 소비 무변경, 시드 결정론 유지).
        items: items.filter(it => it.spawnMs < endMs), pickups,
        geom: { scale: s, charRadius: charR, bladeRadius: bladeR, swordLen, bladeEdgeR, spawnR }
    };
}

// 사람 슬롯 순위 — rank 1 = 최상위(가장 많이 입힘/생존) … 최하위 = 당첨(벌칙).
//   2단계: 안전(비결승) = dealt 내림차순(많이 입힌 쪽 위) → received 오름차순 → slotId.
//          그 아래 결승 생존자(hp 내림차순 → dealt 내림차순), 최하위 = 결승 패자(permaDead).
//   단일 단계: 전원 dealt 내림차순 → received 오름차순 → slotId. 최하위 = 최저 dealt = 당첨.
//   twoStage 미지정 시 finalState 길이로 추정. (escapeMs 필드는 클라/테스트 호환용 null 고정 — 탈출 개념 폐기)
function rankHumans(slots, finalState, twoStage) {
    if (twoStage === undefined || twoStage === null) twoStage = finalState.length >= SPIN_TWO_STAGE_MIN;
    const fsById = {};
    for (const f of finalState) fsById[f.id] = f;
    const humans = slots.map(sl => {
        const fs = fsById[sl.id];
        return {
            name: sl.name, slotId: sl.id,
            dealt: fs.dealt, received: fs.received, hp: fs.hp,
            finalist: !!fs.finalist, permaDead: !!fs.permaDead
        };
    });
    // 최하위(당첨) 정의 = enterFinale 선정 정렬과 동일: dealt↓ → received↓ → slotId↓.
    // best→worst 정렬은 그 역(byBetter): dealt↑ → received↑ → slotId↑ 우선 → 마지막 = 최저 dealt/received/slotId.
    const byBetter = (a, b) => (b.dealt - a.dealt) || (b.received - a.received) || (b.slotId - a.slotId);
    let order;
    if (twoStage) {
        const safe = humans.filter(h => !h.finalist).sort(byBetter);
        const fin = humans.filter(h => h.finalist);
        const loser = fin.filter(h => h.permaDead).sort((a, b) => a.slotId - b.slotId);   // 정확히 1명(당첨자)
        const survivors = fin.filter(h => !h.permaDead).sort((a, b) => (b.hp - a.hp) || byBetter(a, b));
        order = safe.concat(survivors, loser);
    } else {
        order = humans.slice().sort(byBetter);
    }
    return order.map((h, i) => ({ name: h.name, slotId: h.slotId, rank: i + 1, escapeMs: null }));
}

// 당첨 승계 목록(이탈자 대체용) — worst→best. 결정론. gameEnd가 "지금도 방에 있는 첫 항목"을 당첨자로 선택.
//   2단계: 결승 진출자(finalist)만 — 비결승(안전 승자)을 당첨자로 만들지 않음(결승 전원 이탈 시 당첨자 없음).
//   단일 단계: 전원(최저 dealt부터).
function buildSuccession(slots, finalState, twoStage) {
    if (twoStage === undefined || twoStage === null) twoStage = finalState.length >= SPIN_TWO_STAGE_MIN;
    const fsById = {};
    for (const f of finalState) fsById[f.id] = f;
    const ranks = rankHumans(slots, finalState, twoStage);   // best→worst
    let pool = ranks.slice().reverse();                       // worst→best
    if (twoStage) pool = pool.filter(r => fsById[r.slotId] && fsById[r.slotId].finalist);
    return pool.map(r => r.name);
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

        // 게임 시작 시 이전 주문 cycle 가드 해제 — 다음 종료에서도 자동 주문이 다시 발동하도록 (ladder/경마 패턴)
        const wasOrderActive = gameState.isOrderActive;
        gameState.orderAutoTriggered = false;
        gameState.isOrderActive = false;
        if (wasOrderActive) io.to(room.roomId).emit('orderEnded');

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

        const rankings = rankHumans(slots, sim.finalState, sim.twoStage);
        const successionList = buildSuccession(slots, sim.finalState, sim.twoStage);   // worst→best(이탈자 대체용)
        // selected(당첨자) = 승계 목록 첫 항목 = rankings 최하위 (2단계: 결승 패자 / 단일: 최저 데미지)
        const selected = successionList.length ? successionList[0] : null;

        // B5 픽업 아이템 — 페이로드 clean shape(서버 스크래치 consumed 제외, x/y 정수 압축 = frames 패리티). pickups는 이미 clean.
        const revealItems = sim.items.map(it => ({ id: it.id, type: it.type, x: Math.round(it.x), y: Math.round(it.y), spawnMs: it.spawnMs, despawnMs: it.despawnMs }));

        sa.timeline = {   // server-only (socket/rooms.js 재진입 마스킹은 phase/skins/round/history 화이트리스트라 자동 비노출)
            slots, twoStage: sim.twoStage, frames: sim.frames, hpFrames: sim.hpFrames, bladeFrames: sim.bladeFrames, hpMax: sim.hpMax,
            finalists: sim.finalists, round1EndMs: sim.round1EndMs, decideMs: sim.decideMs, durationMs: sim.durationMs,
            items: revealItems, pickups: sim.pickups   // B5(additive). timeline은 server-only — reveal 1회 송신 외 노출 없음(재진입 마스킹 자동)
        };
        sa.result = { selected, rankings, successionList };   // server-only

        // 공개 슬롯 meta — baseAngle/spinSpeed/spinDir 은 시뮬 초기상태에서 추출(클라가 t로 칼날각 계산)
        // isBot은 additive-safe 호환을 위해 false 고정 유지. bladeCount = base 칼날 수(feel-v5 S1: 1). 실시간 수는 클라가 bladeFrames로 읽음.
        const revealSlots = slots.map((s, i) => {
            const fs = sim.finalState[i];
            const sk = skinById(s.skinId) || SPIN_SKINS[0];
            return {
                id: s.id, isBot: false, name: s.name, skinId: sk.id,
                color: sk.color, blade: sk.blade,
                tier: sk.tier || 1,   // 스킨업 시각 전용(클라 아우라) — 시뮬/판정/순위와 무관 (additive)
                bladeCount: BLADE_COUNT, bladeRadius: sim.geom.bladeRadius,
                baseAngle: fs.baseAngle, spinSpeed: fs.spinSpeed, spinDir: fs.spinDir
            };
        });

        io.to(room.roomId).emit('spin-arena:reveal', {
            twoStage: sim.twoStage,       // true(n≥6, 결승전 진행) | false(n<6, 30초 레이스로 끝) — 클라 단계 분기
            durationMs: sim.durationMs,   // 가변(결판 압축) — (frames.length-1)*sampleMs와 항상 일치
            decideMs: sim.decideMs,       // 당첨 확정 시각(ms) — fallback 보장으로 절대 null 아님. 결판 연출/스포일러 가드 기준
            round1EndMs: sim.round1EndMs, // Stage1 종료 시각(2단계만, 단일 단계면 null) — 결승 전환·링 수축 기준
            sampleMs: SAMPLE_MS,
            arena: { w: ARENA_W, h: ARENA_H, cx: ARENA_CX, cy: ARENA_CY, r: ARENA_R },
            ring: { rStart: RING_R_START, rEnd: RING_R_END, stage1End: STAGE1_RING_END, introMs: ROUND2_INTRO_MS, shrinkMs: RING2_SHRINK_MS },
            slots: revealSlots,
            frames: sim.frames,                 // [x,y,c] per slot per keyframe. c = dealt = 다른 플레이어에게 입힌 누적 데미지(점수/리더보드)
            hpFrames: sim.hpFrames,             // hp int per slot per keyframe(stride 1, length === frames.length) — 결승 HP바. Stage1=HP_MAX 불변.
            bladeFrames: sim.bladeFrames,       // 칼날 수 int per slot per keyframe(stride 1, length === frames.length, B4) — 클라 per-slot/per-time 칼날 수. additive.
            hpMax: sim.hpMax,                   // 결승 HP 분모(HP_MAX)
            finalists: sim.finalists,           // 결승 진출 슬롯ID 배열(2단계만, FINALIST_COUNT개. 단일 단계면 빈 배열) — 클라 결승 프레이밍
            items: revealItems,                 // B5 픽업 아이템(additive) — { id, type, x, y, spawnMs, despawnMs }. server-only-via-timeline + reveal 1회 송신(재진입 마스킹 자동).
            pickups: sim.pickups,               // B5 픽업 이벤트(additive) — { itemId, type, slotId, timeMs }. 결정론 sim 위치 판정 결과.
            geom: sim.geom,
            result: { selected, rankings, successionList }
        });

        console.log(`[회전칼날] 방 ${room.roomName} 공개 - 참가자 ${humanCount}명 / 2단계=${sim.twoStage} / 결승=${JSON.stringify(sim.finalists)} / 당첨=${selected} / 길이=${sim.durationMs}ms`);

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
                gameRules: (sa.timeline && sa.timeline.twoStage) ? 'two-stage' : 'single-stage',
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
module.exports.ringRadiusAt = ringRadiusAt;
