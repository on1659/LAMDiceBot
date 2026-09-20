// 마블런(marble) 결정론 시뮬레이션 — 순수 모듈(소켓/DB 없음).
// 서버가 시드 PRNG + 고정 스텝으로 경주 전체를 사전 계산하고, 클라는 샘플 타임라인을 재생만 한다.
// 공정성: 모든 장치 규칙은 "구역 안 공 전원"에 동일 적용. 공 주인/ID를 읽어 물리를 바꾸는 코드는 없다.
// 트랙 A(10구간)와 상수는 docs/goal/marble-run.md Decisions 표가 근거.
'use strict';

// ─── 시간축 ───
const SIM_DT_MS = 5;              // 내부 스텝(200fps) — 자유낙하 속도(≤1400px/s = 스텝당 7px < 반지름)에서 벽 터널링 방지
const SIM_CAP_MS = 120000;        // 하드 캡 — 이후 미도착 공은 진행도(y) 순으로 강제 정산 (200마리 3열 통로 ~80s 여유)
const SIM_YIELD_EVERY = 200;      // 이 스텝마다 setImmediate (CPU 양보)
const SAMPLE_MS_FEW = 40;         // 공 ≤ SAMPLE_FEW_MAX 이면 40ms 샘플 (SIM_DT_MS 배수여야 함)
const SAMPLE_MS_MANY = 100;
const SAMPLE_FEW_MAX = 60;

// ─── 인원/공 ───
const MAX_BALLS = 200;
const BALLS_PER_PLAYER_MIN = 1, BALLS_PER_PLAYER_MAX = 10, BALLS_PER_PLAYER_DEFAULT = 3;
// 마릿수 3단계(호스트 선택). 인당 = clamp(floor(total / 인원), 1, perMax) — 인원이 많아지면 인당이 줄어 총 마릿수가 total 근처에 머문다.
//   2명: 4 / 8 / 16마리, 10명: 20 / 40 / 80, 30명: 30 / 30 / 90, 50명+: 인원수(인당 최소 1 — 사람마다 자기 동물이 하나는 있어야 하므로 하한)
const CROWD_PRESETS = {
    few:    { perMax: 2, total: 20 },
    normal: { perMax: 4, total: 50 },
    many:   { perMax: 8, total: 100 }
};
const CROWD_DEFAULT = 'normal';
const START_ROW_SIZE = 13;        // 출발대 한 줄 공 수 (13 × 30 = 390 ≤ 출발대 폭 400)
const START_SPACING = 30;

// ─── 물리 ───
const TRACK_W = 800;
const BALL_R = 14;                // 표시 지름 28
const GRAVITY = 700;              // px/s² (+y = 언덕 아래). Marble Roulette(box2d g=10m/s²≈300px/s², 공기저항 0)보다 공이 2배 커서 2배
const DRAG = 0;                   // 공기저항 없음 — 그냥 중력으로 떨어진다(Marble Roulette 과 동일). 속도는 MAX_SPEED 안전 캡만
const MAX_SPEED = 1400;           // px/s 상한 (스텝당 7px < 공 반지름 → 터널링 없음)
const WALL_RESTITUTION = 0.45;
const WALL_FRICTION = 1.5;        // 접촉 중 접선 속도 손실 /s (스텝 수와 무관하게 dt 로 스케일 — 스텝당 상수면 200fps 에서 시소 위에 공이 눌러앉는다)
const BALL_RESTITUTION = 0.5;
const STATIC_RESTITUTION = 0.6;   // 정지 공(잠·구덩이)에 부딪힐 때
const CELL = 32;                  // 공-공 브로드페이즈 해시 셀
const BUMP_SPEED = 380;           // 이 이상 충돌 속도면 impact fx 이벤트
const BUMP_MAX_PER_SAMPLE = 6;
const STUCK_SPEED = 5, STUCK_MS = 2000;
const STUCK_KICK_X_MIN = 80, STUCK_KICK_X_RND = 80, STUCK_KICK_Y = -140;   // 위로 튀어오르며 트랙 중앙 쪽으로 (쐐기 탈출)

// ─── 장치 ───
const STAKE_R = 8;
const LOG_R = 20;
const BEE_MS = 1800;              // 벌 떼 지속
const BEE_ACCEL = 1600;           // px/s² 랜덤 가속(구역 안 전원)
// ④ 햇볕 잔디: 구역 전체가 아니라 잔디 '자리'(타원) 몇 군데만 — 밟은 놈만 느려지고 잠들 수 있다. 전원이 똑같이 겪는 감속은 두지 않는다(경쟁 게임).
const SUN_SPOTS = [[230, 1340, 48, 55], [400, 1450, 48, 55], [570, 1560, 48, 55]];   // [x, y, rx, ry] — 폭 500 중 x 커버 ≈ 58%
const SUN_DRAG = 10.0;            // 잔디 자리 안 추가 감쇠 /s → 종단속도 ≈70, 자리(110px) 통과에 ~1.4s
const NAP_SPEED = 200;            // 이 속도 미만이면 잠들 수 있음
const NAP_P = 0.007;              // 스텝(10ms)당 잠들 확률(시드 PRNG)
const NAP_MIN_MS = 500, NAP_MAX_MS = 1800;
const NAP_R = 17;                 // 잠든 동물 = 정지 원 r17 (≈ 폭 35 선분)
const WAKE_KICK_Y = 60;
const DAM_FRACTION = 0.5;         // 전체 공의 이 비율이 쌓이면 터짐
const DAM_MIN_COUNT = 2;
const DAM_MAX_HOLD_MS = 2500;     // 첫 접촉 후 이 시간이 지나면 무조건 터짐
const DAM_BURST_VY = 320, DAM_BURST_VX = 120;
const DAM_GAP_W = 56;             // 댐 한쪽 끝에 새는 틈(공 2개) — 틈 쪽으로 온 놈은 기다리지 않고 바로 빠진다. 쪽은 시드로
// ⑦ 풍차: 날개 4개가 도는 회전 장애물 — 맞는 놈만 튕겨 나간다. 날개 끝 속도 ≈ 2π·len/period
const WINDMILL_LEN = 72;          // 날개 길이(허브→끝). rotor 스프라이트 192px 를 3배(=144 표시)로 그린다
const WINDMILL_PERIOD_MS = 2400;
const WINDMILL_HUB_R = 8;
const WINDMILL_POLE_H = 144;      // 기둥 높이(A자 다리 두 개가 물리 벽)
// ⑦ 점프대: 경사로 위 발판. 밟은 놈만 위로 튀어 올라(≈190px) 다른 자리에 떨어진다
const JUMP_LEN = 36;
const JUMP_VY = 520;              // 위로 튀는 속도 → 최고 높이 JUMP_VY²/(2g) ≈ 193px
const JUMP_VX = 120;              // 내리막 방향 살짝
const JUMP_LIFT = 5;              // 경사로 면에서 발판을 띄우는 높이(공이 경사로보다 먼저 닿게)
const PIT_FRACTION = 0.1, PIT_FILL_MIN = 1, PIT_FILL_MAX = 12;
const PIT_PASS_MULT = 2;          // PIT_FILL × 2 마리 지나가면 깨어남
const PIT_MAX_MS = 2200;
const PIT_RISE_VY = 120;
const MUD_STALL_MS = 500, MUD_DIZZY_MS = 800, MUD_RESUME_VY = 60;
const SEESAW_LEN = 84, SEESAW_AMP_DEG = 25, SEESAW_PERIOD_MS = 2400;
// ⑨ 구멍밭: 폭 500 판에 말뚝(파칭코) + 바닥 골 구멍 HOLE_COUNT 개. 구멍 사이 바닥은 지붕처럼 솟아 공이 구멍으로 굴러 떨어진다.
//   구멍 아래 파이프 안 goalY 를 지나면 도착. 물리만으로 읽히는 결승(가둬 두는 문·회전판 없음).
const HOLE_COUNT = 5;
const HOLE_W = 44;                // 구멍 폭 (공 1.6개 — 동시에 둘이 끼지 못함)
const HOLE_RIDGE_H = 16;          // 구멍 사이 바닥 지붕 높이
const HOLE_PIPE_H = 60;           // 구멍 아래 파이프 길이
// 구멍 뚜껑: 구멍마다 여닫힌다. 골(오른쪽 끝)에 가까운 구멍일수록 주기가 길어 가끔 열리고, 먼 구멍일수록 자주 열린다.
//   열려 있는 시간은 전부 같고(HOLE_OPEN_MS) 주기만 왼쪽→오른쪽 선형. 뚜껑은 왼쪽으로 미끄러져 열린다. 클라는 hole 에 실린 값으로 같은 식을 그린다.
const HOLE_OPEN_MS = 700;
const HOLE_PERIOD_FAR_MS = 1500;  // 골에서 가장 먼 구멍(왼쪽 끝)
const HOLE_PERIOD_NEAR_MS = 4200; // 골에 가장 가까운 구멍(오른쪽 끝)
const HOLE_LID_SLIDE_MS = 150;    // 여닫히는 데 걸리는 시간
const HOLE_PHASE_STEP = 0.37;     // 구멍별 위상(주기 × i × 이 값) — 동시에 열리지 않게
// ⑩ 집결 통로: 파이프에서 떨어진 동물은 통로 바닥에 내려 오른쪽 끝(골)까지 한 줄로 직접 걸어간다. 앞을 추월 못 함.
const WALK_SPEED_MIN = 60, WALK_SPEED_MAX = 140;   // px/s 걷는 속도 — 착지 순간 마리마다 시드 PRNG 로 뽑는다(종족 무관, 운). 앞이 느리면 갇힌다
const WALK_SPACING = 28;          // 앞 동물과 최소 간격
const WALK_PASS_MS = 900;         // 앞에 막혀 이만큼 답답하면 옆으로 비켜 추월 (인원 많을 때 병목 해소)
const WALK_TRIP_P = 0.08;         // 초당 넘어질 확률
const WALK_TRIP_MS = 700;         // 넘어져 있는 시간
const WALK_DOZE_P = 0.04;         // 초당 졸 확률
const WALK_DOZE_MIN_MS = 1200, WALK_DOZE_RND_MS = 1500;   // 졸음 길이 1.2~2.7s
const WALK_DOZE_BUMP_MS = 500;    // 이만큼 지난 뒤 뒤에서 부딪히면 깸
const LANE_H = 60;                // 통로 높이
const LANE_ROW_BALLS = 25;        // 이 마리 수마다 줄 하나 (≤25 한 줄, ≤50 2열, 그 이상 3열) — 줄은 착지 시 시드 랜덤, 줄끼리 독립 큐
const LANE_ROWS_MAX = 3;
const LANE_ROW_GAP = 20;          // 줄 간 y 간격
const LANE_END_X = 745;           // 통로 끝 벽(판자벽)
const GOAL_X = 700;               // 이 x 를 지나면 도착
const FINALE_HOLD_MS = 3500;      // 마지막 공 골인 후 엎어짐·스포트라이트 여유(클라 재생 길이에 포함)
// 슬로모 (Marble Roulette timeScale 차용): 마지막 남은 공이 골 앞 SLOW_ZONE_PX 에 들어오면 재생 속도 SLOW_RATE.
// 서버·클라가 같은 타임라인으로 같은 시각을 계산해 durationMs 에 반영 → 2탭 동기·종료 타이머 일치.
const SLOW_ZONE_PX = 60;          // 통로 골 앞 60px(마지막 걸음만) — 걷는 4~5초를 전부 늘리면 지루하다
const SLOW_RATE = 0.3;

// ─── 결정론 시드 PRNG (spin-arena와 동일) ───
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ═══════════════════════════════════════════════════════════
// 트랙 A — 10구간. y는 출발 문(0)부터 아래로. 출발대는 음수 y(공 수에 따라 높이 가변).
// pieces 는 서버 물리와 클라 렌더가 같은 배열을 본다(reveal에 실어 보냄).
// ═══════════════════════════════════════════════════════════
function buildTrack(ballCount, rng) {
    rng = rng || (() => 0.75);   // rng 없으면(테스트·덤프) 댐 틈은 오른쪽
    const rows = Math.max(1, Math.ceil(ballCount / START_ROW_SIZE));
    const startH = rows * START_SPACING + 40;
    const p = [];
    const wall = (x1, y1, x2, y2) => p.push({ kind: 'wall', x1, y1, x2, y2 });

    // ① 출발대 + 깔때기 (x 200..600 → 120폭)
    p.push({ kind: 'platform', zone: { x: 200, y: -startH, w: 400, h: startH } });
    wall(200, -startH - 20, 200, 0);
    wall(600, -startH - 20, 600, 0);
    p.push({ kind: 'startGate', x1: 200, y1: 0, x2: 600, y2: 0 });
    wall(200, 0, 340, 300);
    wall(600, 0, 460, 300);

    // ② 말뚝밭 (120 → 500폭, 지그재그 말뚝)
    wall(340, 300, 150, 420); wall(150, 420, 150, 900);
    wall(460, 300, 650, 420); wall(650, 420, 650, 900);
    for (let r = 0; r < 8; r++) {
        const y = 470 + r * 48;
        const off = (r % 2) ? 24 : 0;
        for (let x = 200 + off; x <= 600; x += 48) p.push({ kind: 'stake', x, y, r: STAKE_R });   // 벽(150/650)과 44px 띄움 — 공(28)이 끼지 않게
    }

    // ③ 벌집 언덕 (500폭)
    wall(150, 900, 150, 1250); wall(650, 900, 650, 1250);
    p.push({ kind: 'beehive', x: 400, y: 935, triggerY: 1000, zone: { x: 150, y: 960, w: 500, h: 290 } });
    p.push({ kind: 'log', x: 260, y: 1120, r: LOG_R });
    p.push({ kind: 'log', x: 540, y: 1180, r: LOG_R });

    // ④ 햇볕 잔디 (500폭)
    wall(150, 1250, 150, 1650); wall(650, 1250, 650, 1650);
    p.push({ kind: 'sunpatch', zone: { x: 150, y: 1280, w: 500, h: 340 }, spots: SUN_SPOTS.map(([x, y, rx, ry]) => ({ x, y, rx, ry })) });

    // ⑤ 비버 댐 (깔때기 → 160폭 채널). 댐 한쪽 끝에 틈 — 틈 쪽 공은 바로 빠지고 나머지만 갇혀 기다린다
    wall(150, 1650, 320, 1760); wall(650, 1650, 480, 1760);
    wall(320, 1760, 320, 2200); wall(480, 1760, 480, 2200);
    const gapRight = rng() < 0.5;
    const gap = gapRight ? { x1: 480 - DAM_GAP_W, x2: 480 } : { x1: 320, x2: 320 + DAM_GAP_W };
    p.push({ kind: 'dam', x1: 320, y1: 1960, x2: 480, y2: 1960, beaverX: 400, gap, zone: { x: 320, y: 1840, w: 160, h: 120 } });

    // ⑥ 희생 다리(구덩이)
    p.push({ kind: 'pit', zone: { x: 320, y: 2060, w: 160, h: 60 } });   // 구덩이 스프라이트(480×160 → 채널 폭 160×53) 크기에 맞춤

    // ⑦ 풍차 + 점프대 (깔때기 160 → 500폭). 뱀길(순위 변동 없는 긴 대각선)을 대신한다.
    //   풍차: 채널 출구 바로 아래 한가운데 — 대부분 날개에 맞아 좌우로 튕기고, 옆으로 빠진 놈은 그냥 통과.
    //   점프대: 경사로 2단(오른쪽 내리막 → 왼쪽 내리막) 위 발판 3개 — 밟은 놈만 튀어 올라 시간을 잃고 다른 자리에 떨어진다.
    wall(320, 2200, 150, 2320); wall(480, 2200, 650, 2320);
    wall(150, 2320, 150, 3800); wall(650, 2320, 650, 3800);
    const WM = { x: 400, y: 2480 };
    p.push({ kind: 'windmill', x: WM.x, y: WM.y, blades: 4, len: WINDMILL_LEN, period: WINDMILL_PERIOD_MS, hubR: WINDMILL_HUB_R, poleH: WINDMILL_POLE_H });
    wall(WM.x, WM.y + 45, WM.x - 32, WM.y + WINDMILL_POLE_H); wall(WM.x, WM.y + 45, WM.x + 32, WM.y + WINDMILL_POLE_H);   // 기둥 A자 다리
    const ramp = (x1, y1, x2, y2, pads) => {
        wall(x1, y1, x2, y2);
        const ang = Math.atan2(y2 - y1, x2 - x1), nx = Math.sin(ang), ny = -Math.cos(ang);   // 위쪽 법선
        const dir = x2 > x1 ? 1 : -1;
        pads.forEach(k => p.push({ kind: 'jumppad', x: x1 + (x2 - x1) * k + nx * JUMP_LIFT, y: y1 + (y2 - y1) * k + ny * JUMP_LIFT, len: JUMP_LEN, angle: ang, dir }));
    };
    ramp(150, 2700, 560, 2830, [0.3, 0.68]);   // 오른쪽 내리막, 끝(560~650)으로 떨어짐
    ramp(650, 2910, 240, 3040, [0.5]);         // 왼쪽 내리막, 끝(150~240)으로 떨어짐

    // ⑧ 통나무 범퍼 + 진흙·시소 (500폭)
    for (let r = 0; r < 3; r++) {
        const y = 3180 + r * 120, off = (r % 2) ? 60 : 0;
        for (let x = 220 + off; x <= 580; x += 120) p.push({ kind: 'log', x, y, r: LOG_R });
    }
    p.push({ kind: 'seesaw', x: 400, y: 3560, len: SEESAW_LEN, period: SEESAW_PERIOD_MS, amp: SEESAW_AMP_DEG });
    p.push({ kind: 'mud', x: 270, y: 3620, rx: 60, ry: 32 });
    p.push({ kind: 'mud', x: 540, y: 3700, rx: 60, ry: 32 });
    p.push({ kind: 'mud', x: 400, y: 3770, rx: 50, ry: 28 });

    // ⑨ 구멍밭 — 500폭 그대로. 말뚝 파칭코 → 바닥 골 구멍 5개(지붕 바닥이 구멍으로 유도, 구멍마다 여닫는 뚜껑) → 파이프
    const HF = { x: 150, y: 3800, w: 500, h: 440 };        // 구역
    const floorY = HF.y + HF.h;                             // 4240
    wall(150, HF.y, 150, floorY); wall(650, HF.y, 650, floorY);
    for (let r = 0; r < 5; r++) {
        const y = HF.y + 80 + r * 60, off = (r % 2) ? 25 : 0;
        for (let x = 200 + off; x <= 600; x += 50) p.push({ kind: 'stake', x, y, r: STAKE_R });
    }
    const holes = [];
    const pitch = HF.w / HOLE_COUNT;                        // 100
    for (let i = 0; i < HOLE_COUNT; i++) {
        const cx = HF.x + pitch * (i + 0.5);
        const period = Math.round(HOLE_PERIOD_FAR_MS + (HOLE_PERIOD_NEAR_MS - HOLE_PERIOD_FAR_MS) * i / (HOLE_COUNT - 1));   // 왼쪽(골에서 멂)=자주, 오른쪽(골 가까움)=가끔
        holes.push({ x: cx, y: floorY, w: HOLE_W, period, open: HOLE_OPEN_MS, phase: Math.round(period * HOLE_PHASE_STEP * i), slide: HOLE_LID_SLIDE_MS });
        // 파이프 벽 (구멍 양옆 아래로)
        wall(cx - HOLE_W / 2, floorY, cx - HOLE_W / 2, floorY + HOLE_PIPE_H);
        wall(cx + HOLE_W / 2, floorY, cx + HOLE_W / 2, floorY + HOLE_PIPE_H);
    }
    // 바닥: 구멍 사이는 지붕(가운데 솟음), 양 끝은 벽 쪽이 높은 경사
    wall(HF.x, floorY - HOLE_RIDGE_H, holes[0].x - HOLE_W / 2, floorY);
    for (let i = 0; i < HOLE_COUNT - 1; i++) {
        const a = holes[i].x + HOLE_W / 2, b = holes[i + 1].x - HOLE_W / 2, m = (a + b) / 2;
        wall(a, floorY, m, floorY - HOLE_RIDGE_H); wall(m, floorY - HOLE_RIDGE_H, b, floorY);
    }
    wall(holes[HOLE_COUNT - 1].x + HOLE_W / 2, floorY, HF.x + HF.w, floorY - HOLE_RIDGE_H);
    p.push({ kind: 'holefield', zone: HF, holes, floorY, pipeH: HOLE_PIPE_H });

    // ⑩ 집결 통로 → 도착 스탠드. 통로: 파이프 아래 y [laneTop, laneTop+LANE_H], 왼쪽 벽 ~ 오른쪽 판자벽. 골 = x ≥ GOAL_X
    const laneTop = floorY + HOLE_PIPE_H, laneY = laneTop + LANE_H / 2;
    wall(150, laneTop, 150, laneTop + LANE_H); wall(150, laneTop + LANE_H, LANE_END_X, laneTop + LANE_H);
    wall(LANE_END_X, laneTop - 10, LANE_END_X, laneTop + LANE_H);
    const laneRows = Math.max(1, Math.min(LANE_ROWS_MAX, Math.ceil(ballCount / LANE_ROW_BALLS)));
    p.push({ kind: 'lane', x0: 150, x1: LANE_END_X, y: laneY, h: LANE_H, goalX: GOAL_X, rows: laneRows, rowGap: LANE_ROW_GAP });
    // 스탠드 — 통로 아래, 왼쪽부터 1, 2, 3… (클라가 finishOrder 로 배치). 꼴찌는 통로 끝 판자벽 앞에 엎어짐
    p.push({ kind: 'stand', zone: { x: 150, y: laneTop + LANE_H + 24, w: 500, h: 180 }, cols: 10 });
    p.push({ kind: 'dumpwall', x: LANE_END_X, y: laneY, facing: 'left' });

    // 장식(클라 전용, 물리 없음)
    const decor = [
        ['tree', 60, 250], ['tree', 740, 700], ['bush-big', 80, 1100], ['bush-big', 720, 1500],
        ['rock', 90, 1900], ['bush-small', 740, 2100], ['flower-pink', 60, 2600], ['flower-yellow', 740, 2950],
        ['tree', 70, 3350], ['bush-big', 730, 3550], ['signpost', 700, 3920], ['flower-white', 100, 4220], ['tree', 730, 4450]
    ];
    decor.forEach(([kind, x, y]) => p.push({ kind: 'decor', decor: kind, x, y }));

    return {
        width: TRACK_W, startY: -startH, goalY: laneY, goalX: GOAL_X, endY: laneTop + LANE_H + 260,
        ballR: BALL_R, napR: NAP_R,
        pieces: p
    };
}

// 출발 배치: 참가자 라운드로빈으로 나열 → 줄(13개) 단위로 시드 셔플 → 한 사람 공이 한 줄에 몰리지 않는다.
// 반환 balls[i] = { id: i, owner, creature, colorIdx, num, x, y }
function layoutBalls(participants, picks, ballsPerPlayer, rng) {
    const seq = [];
    for (let k = 1; k <= ballsPerPlayer; k++) {
        participants.forEach((name, pi) => {
            seq.push({ owner: name, creature: picks[name], colorIdx: pi, num: k });
        });
    }
    for (let r0 = 0; r0 < seq.length; r0 += START_ROW_SIZE) {
        const end = Math.min(seq.length, r0 + START_ROW_SIZE);
        for (let i = end - 1; i > r0; i--) {           // Fisher–Yates (줄 안에서만)
            const j = r0 + Math.floor(rng() * (i - r0 + 1));
            const tmp = seq[i]; seq[i] = seq[j]; seq[j] = tmp;
        }
    }
    return seq.map((b, i) => {
        const row = Math.floor(i / START_ROW_SIZE);
        const col = i % START_ROW_SIZE;
        const rowCount = Math.min(START_ROW_SIZE, seq.length - row * START_ROW_SIZE);
        const rowW = rowCount * START_SPACING;
        const x = 400 - rowW / 2 + START_SPACING / 2 + col * START_SPACING;
        const y = -20 - row * START_SPACING;
        return { id: i, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, x, y };
    });
}

// ─── 기하 헬퍼 ───
function closestOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return { x: x1 + dx * t, y: y1 + dy * t };
}
function inZone(b, z) { return b.x >= z.x && b.x <= z.x + z.w && b.y >= z.y && b.y <= z.y + z.h; }
function inEllipse(b, m) { const dx = (b.x - m.x) / m.rx, dy = (b.y - m.y) / m.ry; return dx * dx + dy * dy < 1; }
function seesawSegment(s, t) {
    const a = (s.amp * Math.PI / 180) * Math.sin(2 * Math.PI * t / s.period);
    const hx = Math.cos(a) * s.len / 2, hy = Math.sin(a) * s.len / 2;
    return { x1: s.x - hx, y1: s.y - hy, x2: s.x + hx, y2: s.y + hy };
}
// 구멍 뚜껑이 덮은 비율 0(활짝)~1(닫힘). 주기 안 [0, open) 이 열린 창, 양 끝 slide 동안 미끄러진다. 클라(js/marble-render.js)와 같은 식.
function lidCover(h, t) {
    const c = ((t + h.phase) % h.period + h.period) % h.period;
    if (c >= h.open) return 1;
    if (c < h.slide) return 1 - c / h.slide;
    if (c > h.open - h.slide) return 1 - (h.open - c) / h.slide;
    return 0;
}
function windmillAngle(w, t) { return 2 * Math.PI * t / w.period; }

/**
 * 시뮬레이션. balls = layoutBalls() 결과. 반환:
 * { track, sampleMs, frames, events, finishOrder, simEndMs, durationMs }
 *  frames[k] = [x0,y0,x1,y1,…] (정수, 도착/정지 무관 항상 기록. 도착한 공은 -1,-1)
 *  events    = [{ t, type, ball?, x?, y? }] — gateOpen|bees|nap|wake|damCrack|damBurst|pitFall|pitRise|jump|mud|mudEnd|bump|land|trip|doze|pass|finish
 */
async function simulate(balls, seed, track) {
    const rng = mulberry32(seed ^ 0x5bd1e995);
    const n = balls.length;
    const sampleMs = n <= SAMPLE_FEW_MAX ? SAMPLE_MS_FEW : SAMPLE_MS_MANY;
    const dt = SIM_DT_MS / 1000;

    // 상태
    const B = balls.map(b => ({
        id: b.id, x: b.x, y: b.y, vx: 0, vy: 0,
        state: 'roll',            // roll | nap | pit | mud | done
        r: BALL_R,
        napAt: 0, hasNapped: false,
        mudAt: 0, mudDone: {}, dizzyUntil: 0,
        pitDone: false, inPit: false, walkSpeed: 0, walkRow: 0, stallUntil: 0, stallAt: 0, stallKind: '', blockedSince: -1,
        stuckSince: 0, lidAt: -1e9
    }));

    // 조각 분류
    const walls = [], stakes = [], muds = [], pads = [];
    let beehive = null, sun = null, dam = null, pit = null, seesaw = null, lane = null, windmill = null, holefield = null;
    for (const pc of track.pieces) {
        switch (pc.kind) {
            case 'wall': walls.push(pc); break;
            case 'stake': case 'log': stakes.push(pc); break;
            case 'mud': muds.push(pc); break;
            case 'jumppad': pads.push(pc); break;
            case 'beehive': beehive = pc; break;
            case 'sunpatch': sun = pc; break;
            case 'dam': dam = pc; break;
            case 'pit': pit = pc; break;
            case 'seesaw': seesaw = pc; break;
            case 'lane': lane = pc; break;
            case 'windmill': windmill = pc; break;
            case 'holefield': holefield = pc; break;
        }
    }
    // 벽 y-밴드 브로드페이즈(200px 밴드)
    const BAND = 200;
    const wallBands = new Map();
    const bandKey = y => Math.floor(y / BAND);
    walls.forEach(w => {
        const b0 = bandKey(Math.min(w.y1, w.y2) - BALL_R), b1 = bandKey(Math.max(w.y1, w.y2) + BALL_R);
        for (let k = b0; k <= b1; k++) { if (!wallBands.has(k)) wallBands.set(k, []); wallBands.get(k).push(w); }
    });
    const stakeBands = new Map();
    stakes.forEach(s => {
        const k = bandKey(s.y);
        for (let kk = k - 1; kk <= k + 1; kk++) { if (!stakeBands.has(kk)) stakeBands.set(kk, []); stakeBands.get(kk).push(s); }
    });

    // 장치 상태
    const damThreshold = Math.max(DAM_MIN_COUNT, Math.ceil(n * DAM_FRACTION));
    let damActive = !!dam, damFirstContact = -1, damCracked = false;
    const pitFill = Math.min(PIT_FILL_MAX, Math.max(PIT_FILL_MIN, Math.ceil(n * PIT_FRACTION)));
    let pitFallen = 0, pitPassed = 0, pitFirstFall = -1, pitReleased = false;
    let beesAt = -1;

    const events = [{ t: 0, type: 'gateOpen' }];
    const frames = [];
    const finishOrder = [];
    let finishedCount = 0;
    let bumpBudget = BUMP_MAX_PER_SAMPLE;

    const pushEvent = (t, type, b, extra) => {
        const e = { t, type };
        if (b) { e.ball = b.id; }
        if (extra) Object.assign(e, extra);
        events.push(e);
    };
    const bump = (t, b, speed) => {
        if (speed < BUMP_SPEED || bumpBudget <= 0) return;
        bumpBudget--;
        pushEvent(t, 'bump', b, { x: Math.round(b.x), y: Math.round(b.y) });
    };
    const wakeBall = (t, b, vx, vy) => {
        b.state = 'roll'; b.r = BALL_R; b.vx = vx; b.vy = vy; b.stuckSince = t;
        pushEvent(t, 'wake', b);
    };
    const finishBall = (t, b) => {
        b.state = 'done'; b.vx = 0; b.vy = 0;
        finishOrder.push(b.id); finishedCount++;
        pushEvent(t, 'finish', b);
    };

    // 공 vs 선분(정지 벽)
    const collideSegment = (t, b, x1, y1, x2, y2, e) => {
        const c = closestOnSegment(b.x, b.y, x1, y1, x2, y2);
        let nx = b.x - c.x, ny = b.y - c.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= b.r * b.r) return;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {   // 정확히 선 위 — 선분 법선(위쪽 우선)으로
            const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
            nx = dy / L; ny = -dx / L; if (ny > 0) { nx = -nx; ny = -ny; }
            d = 0;
        } else { nx /= d; ny /= d; }
        b.x += nx * (b.r - d); b.y += ny * (b.r - d);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
            bump(t, b, -vn);
            b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        }
        // 접선 마찰
        const tx = -ny, ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        const fr = Math.min(1, WALL_FRICTION * dt);
        b.vx -= vt * fr * tx; b.vy -= vt * fr * ty;
    };
    // 공 vs 정지 원(말뚝/통나무)
    const collideCircle = (t, b, cx, cy, cr, e) => {
        let nx = b.x - cx, ny = b.y - cy;
        const minD = b.r + cr;
        const d2 = nx * nx + ny * ny;
        if (d2 >= minD * minD) return;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { nx = 0; ny = -1; d = 0; } else { nx /= d; ny /= d; }
        b.x += nx * (minD - d); b.y += ny * (minD - d);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { bump(t, b, -vn); b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
    };
    // 공 vs 움직이는 선분(풍차 날개): (hx,hy) 중심으로 각속도 omega(rad/s) 회전 — 접점의 날개 속도를 뺀 상대 속도로 반사
    const collideMovingSegment = (t, b, x1, y1, x2, y2, e, omega, hx, hy) => {
        const c = closestOnSegment(b.x, b.y, x1, y1, x2, y2);
        let nx = b.x - c.x, ny = b.y - c.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= b.r * b.r) return;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { nx = 0; ny = -1; d = 0; } else { nx /= d; ny /= d; }
        b.x += nx * (b.r - d); b.y += ny * (b.r - d);
        const pvx = -omega * (c.y - hy), pvy = omega * (c.x - hx);
        const vn = (b.vx - pvx) * nx + (b.vy - pvy) * ny;
        if (vn < 0) { bump(t, b, -vn); b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
    };

    const totalSteps = Math.ceil(SIM_CAP_MS / SIM_DT_MS);
    const sampleEvery = sampleMs / SIM_DT_MS;
    let simEndMs = SIM_CAP_MS;

    const record = () => {
        const f = new Array(n * 2);
        for (let i = 0; i < n; i++) {
            const b = B[i];
            if (b.state === 'done') { f[i * 2] = -1; f[i * 2 + 1] = -1; }
            else { f[i * 2] = Math.round(b.x); f[i * 2 + 1] = Math.round(b.y); }
        }
        frames.push(f);
        bumpBudget = BUMP_MAX_PER_SAMPLE;
    };
    record();

    for (let step = 1; step <= totalSteps; step++) {
        const t = step * SIM_DT_MS;
        if (step % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));

        // ── 장치 타이머(공 무관) ──
        const ss = seesaw ? seesawSegment(seesaw, t) : null;
        const beesOn = beesAt >= 0 && t < beesAt + BEE_MS;

        // 댐: 구역 안 공 수
        if (dam && damActive) {
            let cnt = 0;
            for (const b of B) if (b.state !== 'done' && inZone(b, dam.zone)) cnt++;
            if (cnt > 0 && damFirstContact < 0) damFirstContact = t;
            if (!damCracked && cnt >= Math.ceil(damThreshold / 2)) { damCracked = true; pushEvent(t, 'damCrack'); }
            if (cnt >= damThreshold || (damFirstContact >= 0 && t - damFirstContact >= DAM_MAX_HOLD_MS)) {
                damActive = false;
                pushEvent(t, 'damBurst');
                for (const b of B) {
                    if (b.state === 'roll' && inZone(b, dam.zone)) {
                        b.vy += DAM_BURST_VY; b.vx += (rng() - 0.5) * DAM_BURST_VX;
                    }
                }
            }
        }
        // 구덩이 해제
        if (pit && !pitReleased && pitFirstFall >= 0 &&
            (pitPassed >= pitFill * PIT_PASS_MULT || t - pitFirstFall >= PIT_MAX_MS)) {
            pitReleased = true;
            pushEvent(t, 'pitRise');
            for (const b of B) if (b.state === 'pit') wakeBall(t, b, (rng() - 0.5) * 40, PIT_RISE_VY);
        }

        // ── 집결 통로 걷기: 한 줄, 앞 추월 불가, 골 x 통과 시 도착 ──
        if (lane) {
            for (let row = 0; row < lane.rows; row++) {
            const rowY = lane.y + (row - (lane.rows - 1) / 2) * lane.rowGap;
            const walkers = B.filter(b => b.state === 'walk' && b.walkRow === row).sort((a, b) => b.x - a.x);
            for (let i = 0; i < walkers.length; i++) {
                const w = walkers[i];
                w.y = rowY; w.vy = 0;
                if (t < w.stallUntil) {
                    // 졸음: 최소 시간 지난 뒤 뒤에서 누가 붙으면 깸
                    const behind = walkers[i + 1];
                    if (w.stallKind === 'doze' && behind && behind.x >= w.x - WALK_SPACING - 2 && t - w.stallAt >= WALK_DOZE_BUMP_MS) {
                        w.stallUntil = t; w.stallKind = ''; pushEvent(t, 'wake', w);
                    } else { w.vx = 0; continue; }
                }
                // 졸음이 시간으로 끝난 경우도 wake 를 남긴다 — 클라는 이벤트로만 잠/깸을 알므로 없으면 자는 그림인 채 걸어간다
                if (w.stallKind === 'doze') { w.stallKind = ''; pushEvent(t, 'wake', w); }
                // 걷다가 넘어짐 / 졸음 (전원 동일 확률)
                const r = rng();
                if (r < WALK_TRIP_P * dt) { w.stallKind = 'trip'; w.stallAt = t; w.stallUntil = t + WALK_TRIP_MS; w.vx = 0; pushEvent(t, 'trip', w); continue; }
                if (r < (WALK_TRIP_P + WALK_DOZE_P) * dt) { w.stallKind = 'doze'; w.stallAt = t; w.stallUntil = t + WALK_DOZE_MIN_MS + rng() * WALK_DOZE_RND_MS; w.vx = 0; pushEvent(t, 'doze', w); continue; }
                w.x += w.walkSpeed * dt; w.vx = w.walkSpeed;
                if (i > 0) {
                    const ahead = walkers[i - 1];
                    if (w.x > ahead.x - WALK_SPACING) {
                        if (w.blockedSince < 0) w.blockedSince = t;
                        if (t - w.blockedSince >= WALK_PASS_MS) {   // 비켜 추월
                            w.x = ahead.x + WALK_SPACING * 0.5; w.blockedSince = -1; pushEvent(t, 'pass', w);
                        } else w.x = ahead.x - WALK_SPACING;
                    } else w.blockedSince = -1;
                }
                if (w.x >= lane.goalX) finishBall(t, w);
            }
            }
        }

        // ── 공 적분 ──
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk') continue;
            if (b.state === 'nap') {
                if (t - b.napAt >= NAP_MAX_MS) wakeBall(t, b, 0, WAKE_KICK_Y);
                else continue;
            }
            if (b.state === 'mud') {
                if (t - b.mudAt >= MUD_STALL_MS) {
                    b.state = 'roll'; b.vx = 0; b.vy = MUD_RESUME_VY; b.dizzyUntil = t + MUD_DIZZY_MS; b.stuckSince = t;
                    pushEvent(t, 'mudEnd', b);
                } else continue;
            }
            if (b.state === 'pit') continue;

            let ax = 0, ay = GRAVITY;
            let drag = DRAG;
            if (beesOn && beehive && inZone(b, beehive.zone)) {
                ax += (rng() * 2 - 1) * BEE_ACCEL;
                ay += (rng() * 2 - 1) * BEE_ACCEL * 0.5;
            }
            const inSun = !!sun && sun.spots.some(s => inEllipse(b, s));   // 잔디 '자리'를 밟은 놈만
            if (inSun) drag += SUN_DRAG;
            b.vx += (ax - drag * b.vx) * dt;
            b.vy += (ay - drag * b.vy) * dt;
            const spd0 = Math.hypot(b.vx, b.vy);
            if (spd0 > MAX_SPEED) { b.vx *= MAX_SPEED / spd0; b.vy *= MAX_SPEED / spd0; }
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            // 벽/장치 충돌
            const wl = wallBands.get(bandKey(b.y));
            if (wl) for (const w of wl) collideSegment(t, b, w.x1, w.y1, w.x2, w.y2, WALL_RESTITUTION);
            const sl = stakeBands.get(bandKey(b.y));
            if (sl) for (const s of sl) collideCircle(t, b, s.x, s.y, s.r, WALL_RESTITUTION);
            if (dam && damActive && Math.abs(b.y - dam.y1) < BALL_R + 4) {   // 틈(gap)은 비워 둔다
                if (dam.gap.x1 > dam.x1) collideSegment(t, b, dam.x1, dam.y1, dam.gap.x1, dam.y1, WALL_RESTITUTION);
                if (dam.gap.x2 < dam.x2) collideSegment(t, b, dam.gap.x2, dam.y1, dam.x2, dam.y2, WALL_RESTITUTION);
            }
            if (ss && Math.abs(b.y - seesaw.y) < SEESAW_LEN) collideSegment(t, b, ss.x1, ss.y1, ss.x2, ss.y2, WALL_RESTITUTION);
            if (windmill && Math.abs(b.y - windmill.y) < windmill.len + BALL_R) {
                const a0 = windmillAngle(windmill, t), om = 2 * Math.PI * 1000 / windmill.period;
                collideCircle(t, b, windmill.x, windmill.y, windmill.hubR, WALL_RESTITUTION);
                for (let k = 0; k < windmill.blades; k++) {
                    const a = a0 + k * 2 * Math.PI / windmill.blades;
                    collideMovingSegment(t, b, windmill.x, windmill.y, windmill.x + Math.cos(a) * windmill.len, windmill.y + Math.sin(a) * windmill.len, WALL_RESTITUTION, om, windmill.x, windmill.y);
                }
            }
            for (const jp of pads) {   // 점프대: 위에서 내려와 밟을 때만 발사
                if (Math.abs(b.y - jp.y) > jp.len) continue;
                const hx = Math.cos(jp.angle) * jp.len / 2, hy = Math.sin(jp.angle) * jp.len / 2;
                const c = closestOnSegment(b.x, b.y, jp.x - hx, jp.y - hy, jp.x + hx, jp.y + hy);
                const dx = b.x - c.x, dy = b.y - c.y;
                if (dx * dx + dy * dy >= b.r * b.r || b.vy <= 0 || b.y > c.y) continue;
                b.y = c.y - b.r; b.vx = b.vx * 0.3 + jp.dir * JUMP_VX; b.vy = -JUMP_VY; b.stuckSince = t;
                pushEvent(t, 'jump', b, { x: Math.round(jp.x), y: Math.round(jp.y) });
            }
            if (holefield && Math.abs(b.y - holefield.floorY) < BALL_R + 4) {   // 구멍 뚜껑(닫힌 만큼만 벽)
                for (const h of holefield.holes) {
                    const cover = lidCover(h, t); if (cover <= 0) continue;
                    const lx = h.x - h.w / 2, rx = lx + h.w * cover;
                    if (b.x < lx - BALL_R || b.x > rx + BALL_R) continue;
                    collideSegment(t, b, lx, h.y, rx, h.y, WALL_RESTITUTION);
                    if (Math.abs(b.y - h.y) <= BALL_R + 0.5 && b.x >= lx && b.x <= rx) b.lidAt = t;   // 뚜껑 위에서 기다리는 중 — 갇힘 킥 제외
                }
            }
            // 트랙 좌우 경계(안전망)
            if (b.x < BALL_R) { b.x = BALL_R; if (b.vx < 0) b.vx = -b.vx * WALL_RESTITUTION; }
            if (b.x > TRACK_W - BALL_R) { b.x = TRACK_W - BALL_R; if (b.vx > 0) b.vx = -b.vx * WALL_RESTITUTION; }

            // 센서
            if (beehive && beesAt < 0 && b.y >= beehive.triggerY && b.y <= beehive.zone.y + beehive.zone.h) {
                beesAt = t; pushEvent(t, 'bees');
            }
            if (inSun && !b.hasNapped) {
                const sp = Math.hypot(b.vx, b.vy);
                if (sp < NAP_SPEED && rng() < NAP_P) {
                    b.state = 'nap'; b.napAt = t; b.hasNapped = true; b.vx = 0; b.vy = 0; b.r = NAP_R;
                    pushEvent(t, 'nap', b);
                    continue;
                }
            }
            if (pit) {
                const inside = inZone(b, pit.zone);
                if (inside && !b.pitDone && !pitReleased && pitFallen < pitFill) {
                    b.pitDone = true; pitFallen++; if (pitFirstFall < 0) pitFirstFall = t;
                    b.state = 'pit'; b.vx = 0; b.vy = 0; b.r = NAP_R;
                    b.y = Math.min(b.y, pit.zone.y + pit.zone.h - NAP_R);
                    pushEvent(t, 'pitFall', b);
                    continue;
                }
                if (inside) b.inPit = true;
                else if (b.inPit && b.y > pit.zone.y + pit.zone.h) { b.inPit = false; if (!b.pitDone) { b.pitDone = true; pitPassed++; } }
            }
            for (let mi = 0; mi < muds.length; mi++) {
                if (!b.mudDone[mi] && inEllipse(b, muds[mi])) {
                    b.mudDone[mi] = true; b.state = 'mud'; b.mudAt = t; b.vx = 0; b.vy = 0;
                    pushEvent(t, 'mud', b);
                    break;
                }
            }
            if (b.state !== 'roll') continue;

            // 골인
            if (lane && b.y >= lane.y) {
                b.state = 'walk'; b.x = Math.max(lane.x0 + BALL_R, b.x); b.y = lane.y; b.vx = 0; b.vy = 0;
                b.walkSpeed = Math.round(WALK_SPEED_MIN + rng() * (WALK_SPEED_MAX - WALK_SPEED_MIN));
                b.walkRow = Math.floor(rng() * lane.rows);
                pushEvent(t, 'land', b, { speed: b.walkSpeed, row: b.walkRow });
                continue;
            }

            // 갇힘 방지
            const spd = Math.hypot(b.vx, b.vy);
            const waitingDam = dam && damActive && inZone(b, dam.zone);
            if (spd > STUCK_SPEED || waitingDam || t - b.lidAt < 50) b.stuckSince = t;
            else if (t - b.stuckSince >= STUCK_MS) {
                b.vx = (b.x < TRACK_W / 2 ? 1 : -1) * (STUCK_KICK_X_MIN + rng() * STUCK_KICK_X_RND); b.vy = STUCK_KICK_Y; b.stuckSince = t;
            }
        }

        // ── 공-공 충돌(해시) ──
        const grid = new Map();
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk') continue;
            const k = (Math.floor(b.x / CELL) + 4096) * 65536 + Math.floor((b.y + 8192) / CELL);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(b);
        }
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk') continue;
            const cx = Math.floor(b.x / CELL) + 4096, cy = Math.floor((b.y + 8192) / CELL);
            for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
                const cell = grid.get((cx + ox) * 65536 + (cy + oy));
                if (!cell) continue;
                for (const o of cell) {
                    if (o.id <= b.id) continue;
                    let nx = o.x - b.x, ny = o.y - b.y;
                    const minD = b.r + o.r;
                    const d2 = nx * nx + ny * ny;
                    if (d2 >= minD * minD || d2 < 1e-9) continue;
                    const d = Math.sqrt(d2); nx /= d; ny /= d;
                    const overlap = minD - d;
                    const bDyn = b.state === 'roll', oDyn = o.state === 'roll';
                    if (bDyn && oDyn) {
                        b.x -= nx * overlap / 2; b.y -= ny * overlap / 2;
                        o.x += nx * overlap / 2; o.y += ny * overlap / 2;
                        const rv = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
                        if (rv < 0) {
                            bump(t, b, -rv);
                            const j = -(1 + BALL_RESTITUTION) * rv / 2;
                            b.vx -= j * nx; b.vy -= j * ny; o.vx += j * nx; o.vy += j * ny;
                        }
                    } else if (bDyn || oDyn) {
                        const dyn = bDyn ? b : o, st = bDyn ? o : b;
                        const sx = bDyn ? -1 : 1;    // dyn 을 st 에서 멀어지는 방향으로
                        dyn.x += sx * nx * overlap; dyn.y += sx * ny * overlap;
                        const vn = (dyn.vx * nx + dyn.vy * ny) * -sx;   // st 쪽으로 향하는 속도(양수=접근)
                        if (vn > 0) {
                            bump(t, dyn, vn);
                            dyn.vx += sx * (1 + STATIC_RESTITUTION) * vn * nx;
                            dyn.vy += sx * (1 + STATIC_RESTITUTION) * vn * ny;
                            // 잠든 공만 깨어남(구덩이 공은 밟혀도 그대로)
                            if (st.state === 'nap' && t - st.napAt >= NAP_MIN_MS) {
                                wakeBall(t, st, dyn.vx * 0.5, Math.max(WAKE_KICK_Y, dyn.vy * 0.5));
                            }
                        }
                    }
                }
            }
        }

        if (step % sampleEvery === 0) record();

        if (finishedCount === n) { simEndMs = t; if (step % sampleEvery !== 0) record(); break; }
    }

    // 캡 도달: 미도착 공을 진행도(y) 내림차순으로 정산 (덜 간 공이 더 늦게 도착)
    if (finishedCount < n) {
        const rest = B.filter(b => b.state !== 'done').sort((a, b) => (b.y - a.y) || (a.id - b.id));
        for (const b of rest) finishBall(SIM_CAP_MS, b);
        simEndMs = SIM_CAP_MS;
        record();
    }

    // 슬로모 시작 시각: 뒤에서 두 번째 공이 골인한 뒤, 마지막 공이 골 앞 SLOW_ZONE_PX 에 처음 들어온 샘플
    const lastId = finishOrder[finishOrder.length - 1];
    const secondLastT = finishOrder.length >= 2 ? events.filter(e => e.type === 'finish' && e.ball === finishOrder[finishOrder.length - 2])[0].t : 0;
    let slowStartMs = simEndMs;
    for (let k = Math.ceil(secondLastT / sampleMs); k < frames.length; k++) {
        const x = frames[k][lastId * 2], y = frames[k][lastId * 2 + 1];
        if (x >= 0 && Math.abs(y - track.goalY) <= LANE_H / 2 && x >= track.goalX - SLOW_ZONE_PX) { slowStartMs = Math.max(secondLastT, k * sampleMs); break; }   // 통로 위(걷는 중)에서 골 앞 SLOW_ZONE_PX
    }
    if (slowStartMs > simEndMs) slowStartMs = simEndMs;
    const slow = { startMs: slowStartMs, rate: SLOW_RATE, endMs: simEndMs };
    const slowExtra = (simEndMs - slowStartMs) * (1 / SLOW_RATE - 1);
    return { track, sampleMs, frames, events, finishOrder, simEndMs, slow, durationMs: Math.round(simEndMs + slowExtra + FINALE_HOLD_MS) };
}

// 참가자 순위: 각자 "가장 늦은 공"의 도착 순서로. 마지막 공의 주인 = selected(당첨).
// successionList = worst→best (이탈자 대체용, spin-arena 패턴).
// 꼴찌 = 구멍(통)에 마지막으로 들어간 공. 통로 걷기·골 도착 순서는 결과에 영향 없고 재생도 그 순간(cutMs)에 끝낸다
// (사용자 결정 2026-09-20: 통에 들어가는 순간 확정이니 랭킹까지 기다릴 필요 없음). 캡까지 못 들어간 공은 정산 순서를 뒤에 붙인다.
// 반환 { finishOrder, cutMs, durationMs } — 서버(socket/marble.js)와 덤프(AutoTest/marble-sim-dump.js)가 같이 쓴다.
function holeEntryCut(result, ballCount) {
    const lands = result.events.filter(e => e.type === 'land');
    const landOrder = lands.map(e => e.ball);
    const landed = new Set(landOrder);
    const finishOrder = landOrder.concat(result.finishOrder.filter(id => !landed.has(id)));
    const cutMs = (landOrder.length === ballCount && lands.length) ? lands[lands.length - 1].t : result.simEndMs;
    return { finishOrder, cutMs, durationMs: cutMs + FINALE_HOLD_MS };
}

function rankPlayers(balls, finishOrder, participants) {
    const worst = {};
    finishOrder.forEach((ballId, idx) => { worst[balls[ballId].owner] = idx; });
    const order = participants.slice().sort((a, b) => (worst[a] ?? -1) - (worst[b] ?? -1));
    const rankings = order.map((name, i) => ({ name, rank: i + 1 }));
    const successionList = order.slice().reverse();
    return { rankings, successionList, selected: successionList[0] || null };
}

// 3단계 프리셋 → 인당 마릿수 (MAX_BALLS 캡 포함). 모르는 프리셋은 기본값.
function crowdBallsPerPlayer(crowd, players) {
    const p = CROWD_PRESETS[crowd] || CROWD_PRESETS[CROWD_DEFAULT];
    const n = Math.max(1, Math.min(p.perMax, Math.floor(p.total / Math.max(1, players))));
    return effectiveBallsPerPlayer(n, players);
}

function effectiveBallsPerPlayer(n, players) {
    const clamped = Math.max(BALLS_PER_PLAYER_MIN, Math.min(BALLS_PER_PLAYER_MAX, Math.floor(n) || BALLS_PER_PLAYER_DEFAULT));
    return Math.max(1, Math.min(clamped, Math.floor(MAX_BALLS / Math.max(1, players))));
}

module.exports = {
    buildTrack, layoutBalls, simulate, rankPlayers, holeEntryCut, effectiveBallsPerPlayer, crowdBallsPerPlayer, mulberry32,
    constants: {
        SIM_DT_MS, SIM_CAP_MS, MAX_BALLS, BALLS_PER_PLAYER_MIN, BALLS_PER_PLAYER_MAX, BALLS_PER_PLAYER_DEFAULT, CROWD_PRESETS, CROWD_DEFAULT,
        BALL_R, NAP_R, FINALE_HOLD_MS, MUD_DIZZY_MS, BEE_MS, HOLE_COUNT, SLOW_ZONE_PX, SLOW_RATE
    }
};
