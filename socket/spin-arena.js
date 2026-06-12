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

// ─ 시간축 ─
const GAME_MS = 30000;
const COUNTDOWN_MS = 4000;        // 클라 3-2-1-START 카운트다운 실측(1000ms×4) — js/spin-arena.js 와 동일 값
const SIM_DT_MS = 20;             // 내부 시뮬 스텝(50fps)
const SAMPLE_MS = 100;            // 키프레임 샘플 간격 → frames 길이 = durationMs/SAMPLE_MS + 1 (durationMs 가변, 최대 GAME_MS)
const SIM_YIELD_EVERY = 100;      // 이 스텝마다 await setImmediate (CPU 양보)

// ─ 캐릭터/칼날 ─
const CHAR_RADIUS = 14;
const BLADE_COUNT = 2;            // 시작 칼날 수
const ESCAPE_BLADES = 5;          // 이 개수 도달 = 즉시 탈출 (기존 상한 5의 의미 교체 — UI "칼 5개" 문구와 결합)
const BLADE_RADIUS = 46;          // 캐릭터 중심 → 칼날 끝 거리
const SWORD_LEN = 28;             // 도신(검 날) 길이 — 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN. 클라 검 그리기와 동일(보이는 검 = 맞는 검)
const BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 클라 도신 반폭(최대 3.4px) 정합. 판정 = 날 선분 vs 몸 원
const BLADE_SPIN_MIN = 3.5, BLADE_SPIN_MAX = 6.0;   // rad/s (슬롯별 시드)

// ─ 체력/데미지 (200시드 배치 시뮬로 "최후 1인" 분포 튜닝 — 수치는 보고서 참조) ─
// 링 데미지(RING_DPS)는 하드 월 채택으로 제거 — 링은 이제 데미지가 아니라 "못 나가는 벽"(킬 전부 칼날 귀속).
const HP_MAX = 100;
const HIT_DPS = 110;              // 칼날 1개가 몸에 겹친 동안 초당 데미지(넉백 이탈로 실접촉은 짧음)

// ─ 칼 성장/다운·부활/종료 압축 (2026-06-12 칼 수집 탈출 개편 — 수치의 권위는 200시드 배치) ─
const BLADE_UP_DMG = 35;          // 받은 데미지 누적 임계당 칼 +1 (5−2 = 3회 = 총 105) — 탐색 범위 30~55
const REVIVE_MS = 3000;           // 다운(HP 0) → 부활 시간
const REVIVE_GRACE_MS = 800;      // 부활 직후 다운 면역(피해·cumDmg 적산은 정상, hp만 1 미만 불가 클램프)
const DECIDE_TAIL_MS = 2000;      // 잔류 1명 확정(decideMs) 후 결판 비트 길이 — 30초 캡에 잘리면 잘린 만큼만

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

// ─── 링 반경 함수 (클라와 동일 구현) ───
function ringRadiusAt(t) {                       // t: ms (0~GAME_MS)
    if (t <= RING_PHASE1_MS) return RING_R_START;
    if (t >= RING_PHASE2_MS) return RING_R_END;
    const k = (t - RING_PHASE1_MS) / (RING_PHASE2_MS - RING_PHASE1_MS);
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
 * 결정론 시뮬레이션 — 가변 길이 타임스텝(결판 시 압축, 최대 GAME_MS). async로 SIM_YIELD_EVERY 스텝마다 setImmediate 양보.
 * 규칙(2026-06-12 칼 수집 탈출 개편 — 결정서 3-2 틱 순서):
 *   받은 데미지 누적 BLADE_UP_DMG마다 칼 +1(시작 BLADE_COUNT), 칼 ESCAPE_BLADES 도달 = 즉시 탈출(좌표 동결·시뮬 이탈),
 *   HP 0 = 다운(좌표 동결) → REVIVE_MS 후 부활(hp 풀 + REVIVE_GRACE_MS 다운 면역),
 *   잔류자(탈출 안 한 사람) 1명 = decideMs 확정 → durationMs = min(GAME_MS, ceil((decideMs+DECIDE_TAIL_MS)/SAMPLE_MS)*SAMPLE_MS).
 * slots: [{ id, isBot, name, skinId }] (길이 n=2~6 가변, 전원 사람). seed: 32bit int.
 * @returns { frames, escapes, downs, bladeUps, decideMs, durationMs, finalState }
 */
async function simulate(slots, seed) {
    const rng = mulberry32(seed);
    // 인원 가변 스케일 주입 (n≤6은 s=1 → 아래 스케일 변수가 전역 상수와 동일 = 기존 산출 동결 보장)
    const n = slots.length;
    const s = spinScale(n);
    const charR = CHAR_RADIUS * s, bladeR = BLADE_RADIUS * s, swordLen = SWORD_LEN * s, bladeEdgeR = BLADE_EDGE_R * s;
    const spawnR = spinSpawnR(n);
    // 1) 초기 상태: 참가자 n명을 중심 둘레에 균등 배치 + 약간의 시드 지터
    //    n≤6: spawnR=121(=ARENA_R*0.55) + 지터 ARENA_R*0.1 = 기존 식과 비트 동일(동결 보장).
    //    n>6: 스폰반경 규칙(spawnR)으로 칼끝 간격 확보 + 지터 ARENA_R*0.04로 축소(군집 spacing이 지터로 깨지지 않게).
    const spawnJitter = n <= 6 ? ARENA_R * 0.1 : ARENA_R * 0.04;
    const st = slots.map((s, i) => {
        const baseAng = (i / slots.length) * 2 * Math.PI;
        const rr = spawnR + rng() * spawnJitter;
        const px = ARENA_CX + Math.cos(baseAng) * rr, py = ARENA_CY + Math.sin(baseAng) * rr;
        const vAng = rng() * 2 * Math.PI, sp = DRIFT_SPEED * (0.6 + rng() * 0.8);
        return {
            id: s.id, isBot: !!s.isBot, hp: HP_MAX,
            cumDmg: 0,                          // 받은 데미지 누적(단조 증가) — 칼업 임계·진행 바·frames 3채널의 권위
            escaped: false, escapeMs: null,     // 칼 ESCAPE_BLADES 도달 = 탈출(좌표 동결·시뮬 이탈)
            down: false, reviveAtMs: 0,         // HP 0 = 다운(좌표 동결), reviveAtMs에 부활
            graceUntil: 0,                      // 부활 직후 다운 면역 종료 시각(hp 1 미만 불가 클램프)
            x: px, y: py, vx: Math.cos(vAng) * sp, vy: Math.sin(vAng) * sp,
            kvx: 0, kvy: 0,                     // 넉백 속도 성분(이동 속도와 분리, 지수 감쇠)
            bladeCount: BLADE_COUNT,            // 받은 데미지 BLADE_UP_DMG마다 +1 (ESCAPE_BLADES 도달 = 탈출)
            baseAngle: rng() * 2 * Math.PI,
            spinSpeed: BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN),
            spinDir: rng() < 0.5 ? 1 : -1
        };
    });

    const frames = [];           // 키프레임(SAMPLE_MS 마다) — [x, y, cumDmg] per slot
    const escapes = [];          // {id, timeMs, x, y} — 배열 순서 = 탈출 순위(rank)
    const downs = [];            // {id, timeMs, reviveMs, x, y} — 슬롯당 다회 가능(비석/부활 연출 기준)
    const bladeUps = [];         // {id, timeMs} — 클라 핍 HUD/칼날 렌더 개수의 유일 권위
    let decideMs = null;         // 잔류 1명 확정 시각(ms). 30초 캡까지 결판 못 내면 null
    let endMs = GAME_MS;         // 시뮬 종료 시각 = durationMs (결판 시 압축, SAMPLE_MS 격자 보장)
    const dt = SIM_DT_MS / 1000;
    let nextSampleMs = 0;

    function sample() {
        const f = [];
        for (const c of st) { f.push(Math.round(c.x), Math.round(c.y), Math.round(c.cumDmg)); }
        frames.push(f);
    }

    for (let step = 0; ; step++) {
        const tMs = step * SIM_DT_MS;
        // 샘플(키프레임) — tMs가 nextSampleMs 도달 시. endMs가 SAMPLE_MS 격자라 마지막 키프레임 = durationMs 시점.
        if (tMs >= nextSampleMs) { sample(); nextSampleMs += SAMPLE_MS; }
        if (tMs >= endMs) break;

        const ring = ringRadiusAt(tMs);
        // ①~⑤ 칼날/피격/칼업/탈출/다운 — decideMs 확정 후에는 전부 스킵(결판 비트: 이동·부활 타이머만 진행).
        if (decideMs === null) {
            // ① 칼날 날 선분 계산(활성 = 탈출 아님 + 다운 아님, 캐릭터별 bladeCount) — 이동 전 스냅샷.
            //    선분 = 허브에서 BLADE_RADIUS-SWORD_LEN(안쪽 끝)~BLADE_RADIUS(칼끝) 구간.
            const blades = [];
            for (const c of st) {
                if (c.escaped || c.down) continue;
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
            // ② 데미지 적산 + 넉백 임펄스 — 활성 캐릭터만 피격 대상.
            //    cumDmg는 항상 정상 적산, grace(부활 직후) 중에는 hp만 1 미만 불가 클램프(다운 면역).
            for (const c of st) {
                if (c.escaped || c.down) continue;
                let d = 0;
                for (const tp of blades) {
                    if (tp.owner === c.id) continue;
                    // 선분-원 판정: 몸 중심에서 날 선분 위 최근접점 (t = clamp(dot/len², 0, 1)) — 전부 결정론 산술
                    // 분모 SWORD_LEN²은 "날 선분 길이 = SWORD_LEN 고정" 구조에 결합 — 칼날별 길이 가변화 시 실제 길이²로 교체 (클라 미러 동일)
                    const sx = tp.ox - tp.ix, sy = tp.oy - tp.iy;
                    let tt = ((c.x - tp.ix) * sx + (c.y - tp.iy) * sy) / (swordLen * swordLen);
                    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                    const dx = c.x - (tp.ix + sx * tt), dy = c.y - (tp.iy + sy * tt);
                    if (dx * dx + dy * dy < (charR + bladeEdgeR) * (charR + bladeEdgeR)) {
                        d += HIT_DPS * dt;
                        // 실제 넉백: 날 최근접점→몸 단방향 임펄스(크기 상한 KNOCK_MAX)
                        const dl = Math.hypot(dx, dy) || 1;
                        c.kvx += (dx / dl) * KNOCK_IMPULSE;
                        c.kvy += (dy / dl) * KNOCK_IMPULSE;
                        const km = Math.hypot(c.kvx, c.kvy);
                        if (km > KNOCK_MAX) { c.kvx *= KNOCK_MAX / km; c.kvy *= KNOCK_MAX / km; }
                    }
                }
                if (d > 0) {
                    c.cumDmg += d;
                    c.hp -= d;
                    if (tMs < c.graceUntil && c.hp < 1) c.hp = 1;   // grace: 다운만 면역(피해·진행은 정상)
                }
            }
            // ③ 칼업 후보 산출 — 4개 이하 칼업은 즉시 확정(한 틱 다중 칼업 허용).
            //    5번째 칼(=탈출 자격) 도달은 즉시 발행하지 않고 "탈출 후보"로 보류 → ④에서 성공 시에만 bladeUp+escape 동시 push.
            const escapeCandidates = [];
            for (const c of st) {
                if (c.escaped || c.down) continue;
                while (c.bladeCount < ESCAPE_BLADES &&
                       c.cumDmg >= (c.bladeCount - BLADE_COUNT + 1) * BLADE_UP_DMG) {
                    if (c.bladeCount + 1 === ESCAPE_BLADES) { escapeCandidates.push(c); break; }
                    c.bladeCount++;
                    bladeUps.push({ id: c.id, timeMs: tMs });
                }
            }
            // ④ 탈출 처리 — 후보를 cumDmg 내림차순→slotId 오름차순으로 순회. 항상 최소 1명 잔류("문이 닫혔다"):
            //    잔류자(다운 중 포함)가 1명만 남으면 남은 후보 전부 거부 = 5번째 bladeUp 미발행(칼 4 유지, 정상 다운 가능).
            if (escapeCandidates.length) {
                escapeCandidates.sort((a, b) => (b.cumDmg - a.cumDmg) || (a.id - b.id));
                let residents = 0;
                for (const c of st) if (!c.escaped) residents++;
                for (const c of escapeCandidates) {
                    if (residents <= 1) break;   // 문이 닫혔다 — 남은 후보 거부
                    c.bladeCount = ESCAPE_BLADES;
                    bladeUps.push({ id: c.id, timeMs: tMs });
                    c.escaped = true; c.escapeMs = tMs;
                    escapes.push({ id: c.id, timeMs: tMs, x: Math.round(c.x), y: Math.round(c.y) });
                    residents--;
                }
            }
            // ⑤ 다운 체크 — 활성 + hp<=0 → 그 자리 좌표 동결(이번 틱 탈출 성공자는 escaped 가드로 자동 면제).
            //    grace 중에는 hp 클램프로 도달 불가. 탈출 거부자(칼 4)도 정상 다운(막판 KO 서사).
            for (const c of st) {
                if (c.escaped || c.down) continue;
                if (c.hp <= 0) {
                    c.hp = 0;
                    c.down = true; c.reviveAtMs = tMs + REVIVE_MS;
                    downs.push({ id: c.id, timeMs: tMs, reviveMs: c.reviveAtMs, x: Math.round(c.x), y: Math.round(c.y) });
                }
            }
        }
        // ⑥ 부활 체크 — hp 풀 + grace 부여, 동결 좌표 그대로 재개(칼 수·cumDmg 유지).
        //    좌표가 수축한 링 밖이면 같은 틱 ⑦ 하드 월 클램프로 즉시 재진입(비석 표시는 클라가 downs 좌표 사용).
        for (const c of st) {
            if (c.down && tMs >= c.reviveAtMs) {
                c.down = false;
                c.hp = HP_MAX;
                c.graceUntil = tMs + REVIVE_GRACE_MS;
            }
        }
        // ⑦ 이동 적분(드리프트+넉백) + 중앙 인력 + 링 하드 월 + 넉백 감쇠 — 활성 캐릭터만(다운/탈출자 좌표 동결).
        for (const c of st) {
            if (c.escaped || c.down) continue;
            const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
            const cdist = Math.hypot(cdx, cdy) || 1;
            // 상시 중앙 인력(상시) — 군집 형성. 드리프트 무작위 방향성은 유지(궤적만 중심 쪽으로 휘어짐).
            c.vx += (-cdx / cdist) * CENTER_PULL * dt;
            c.vy += (-cdy / cdist) * CENTER_PULL * dt;
            // 약한 선형 감쇠 — 보존력 영구 진동 방지(나선 수렴). 넉백(kvx/kvy)은 자체 감쇠(KNOCK_DECAY)라 제외.
            c.vx -= c.vx * SPIN_DRAG * dt;
            c.vy -= c.vy * SPIN_DRAG * dt;
            c.x += (c.vx + c.kvx) * dt; c.y += (c.vy + c.kvy) * dt;
            // 링 하드 월 — 활성 캐릭터는 수축 링 밖으로 못 나감(경계 클램프 + 법선 반사).
            // 다운/탈출자는 이 루프에 안 들어옴(가드) → 좌표 동결 유지. 링은 틱 시작 1회 계산이라
            // 수축 중 벽에 붙은 캐릭터가 다음 틱 0.32px 밖일 수 있음 — 순수 하드 월이라 재클램프로 무해.
            const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
            const wallR = ring - charR;
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
        // ⑧ 결판 체크 — 잔류자(탈출 안 한 사람, 다운 중 포함) 1명 = decideMs 확정(1회).
        //    durationMs는 SAMPLE_MS 올림 정렬 → frames.length === durationMs/SAMPLE_MS + 1 불변식 성립.
        if (decideMs === null) {
            let residents = 0;
            for (const c of st) if (!c.escaped) residents++;
            if (residents <= 1) {
                decideMs = tMs;
                endMs = Math.min(GAME_MS, Math.ceil((decideMs + DECIDE_TAIL_MS) / SAMPLE_MS) * SAMPLE_MS);
            }
        }

        // CPU 양보 — 무거운 결정론 계산이 이벤트 루프를 막지 않게
        if (step % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    }

    return { frames, escapes, downs, bladeUps, decideMs, durationMs: endMs, finalState: st,
        geom: { scale: s, charRadius: charR, bladeRadius: bladeR, swordLen, bladeEdgeR, spawnR } };
}

// 사람 슬롯 탈출 순위 — rank 1 = 첫 탈출 … 최하위 = 끝까지 못 나감 = selected(당첨).
// 같은 틱 동시 탈출 tie는 시뮬 ④와 동일 기준(cumDmg 내림차순→slotId 오름차순)이라 escapes 배열 순서와 일치
// (탈출자는 이후 피격이 없어 cumDmg가 탈출 시점 값으로 동결되기 때문).
// 30초 캡 교착(잔류 2+명): 잔류자끼리 bladeCount 내림차순 → cumDmg 내림차순 → slotId 오름차순.
// selected = 정렬 최하위(진행도가 가장 낮은 사람, 전부 동률이면 slotId 큰 쪽).
function rankHumans(slots, finalState) {
    const humans = slots.filter(s => !s.isBot).map(s => {
        const fs = finalState.find(f => f.id === s.id);
        return {
            name: s.name, slotId: s.id, escaped: fs.escaped, escapeMs: fs.escapeMs,
            bladeCount: fs.bladeCount, cumDmg: fs.cumDmg
        };
    });
    humans.sort((a, b) => {
        if (a.escaped !== b.escaped) return a.escaped ? -1 : 1;                  // 탈출자가 위
        if (a.escaped) {                                                          // 둘 다 탈출: 먼저 나간 쪽 위
            if (a.escapeMs !== b.escapeMs) return a.escapeMs - b.escapeMs;
            if (a.cumDmg !== b.cumDmg) return b.cumDmg - a.cumDmg;               // 같은 틱: 시뮬 ④ 처리 순서 재현
            return a.slotId - b.slotId;
        }
        if (a.bladeCount !== b.bladeCount) return b.bladeCount - a.bladeCount;   // 잔류자: 진행도 높은 쪽 위
        if (a.cumDmg !== b.cumDmg) return b.cumDmg - a.cumDmg;
        return a.slotId - b.slotId;
    });
    return humans.map((h, i) => ({
        name: h.name, slotId: h.slotId, rank: i + 1,
        escapeMs: h.escaped ? h.escapeMs : null
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
        // selected(당첨자) = 새 rankings 최하위 = 끝까지 탈출 못 한 사람 (기존 rank 1과 동일 인물)
        const selected = rankings.length ? rankings[rankings.length - 1].name : null;

        sa.timeline = {   // server-only (socket/rooms.js 재진입 마스킹은 phase/skins/round/history 화이트리스트라 자동 비노출)
            slots, frames: sim.frames, escapes: sim.escapes, downs: sim.downs,
            bladeUps: sim.bladeUps, decideMs: sim.decideMs, durationMs: sim.durationMs
        };
        sa.result = { selected, rankings };   // server-only

        // 공개 슬롯 meta — baseAngle/spinSpeed/spinDir 은 시뮬 초기상태에서 추출(클라가 t로 칼날각 계산)
        // isBot은 additive-safe 호환을 위해 false 고정 유지. bladeCount는 "시작 칼날 수 2" 의미.
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
            durationMs: sim.durationMs,   // 가변(결판 압축) — (frames.length-1)*sampleMs와 항상 일치
            decideMs: sim.decideMs,       // 잔류 1명 확정 시각(ms) 또는 null(30초 캡 교착) — 클라 결판 연출 기준
            sampleMs: SAMPLE_MS,
            arena: { w: ARENA_W, h: ARENA_H, cx: ARENA_CX, cy: ARENA_CY, r: ARENA_R },
            ring: { rStart: RING_R_START, rEnd: RING_R_END, phase1Ms: RING_PHASE1_MS, phase2Ms: RING_PHASE2_MS },
            slots: revealSlots,
            frames: sim.frames,
            escapes: sim.escapes,
            downs: sim.downs,
            bladeUps: sim.bladeUps,
            geom: sim.geom,
            result: { selected, rankings }
        });

        console.log(`[회전칼날] 방 ${room.roomName} 공개 - 참가자 ${humanCount}명 / 당첨=${selected} / 길이=${sim.durationMs}ms`);

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
