// 사다리타기(ladder) 게임 소켓 핸들러
// bridge-cross / horse.js 패턴 차용. 결과는 서버에서만 결정, 클라는 시각화만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const LADDER_MIN_PLAYERS = 2;       // 시작 최소 인원
const LADDER_LANES = 6;             // 레인 항상 6개 고정(번호 1~6). 인원 6 미만이면 빈 레인.
const LADDER_MAX_PLAYERS = LADDER_LANES;  // 최대 참가 = 레인 수(6)
const LADDER_HISTORY_MAX = 100;     // 히스토리 최대 보관 수
// 기본(가시) 막대기 — 모든 칸(c=0..N-2)에 1개씩 보장 + 다양성용 0~RAND개 추가(서버 RNG).
// 유저가 직접 ~3개씩 그리므로 과밀 방지 위해 추가분은 적게.
const LADDER_BASE_RUNG_RAND = 2;    // 칸별 1개 보장 위에 더해지는 랜덤 추가량 상한(0~이 값)

// 인당 막대기 최대 개수 — 빌드 단계에서 한 사람이 놓을 수 있는 상한
const LADDER_MAX_RUNGS_PER_USER = 3;
// 스크램블(시작 시점): union에서 K개 지우고 M개 새로 그린다. 모두 서버 RNG. js/ladder.js와 동일 유지.
const LADDER_SCRAMBLE_ERASE_MIN = 2;
const LADDER_SCRAMBLE_ERASE_MAX = 4;
const LADDER_SCRAMBLE_ADD_MIN = 2;
const LADDER_SCRAMBLE_ADD_MAX = 4;
// 밀도 바닥(floor): 스크램블 후 최종 막대기가 이 수 미만이면 서버 RNG로 추가해 채운다(spacing 규칙 준수).
// 작은 방(2명, base 5칸 + erase로 거의 비는 경우)에서도 사다리가 꽉 차 보이게 하는 시각 목표.
// 6레인=칸 5개, 칸당 평균 ~2.4개면 또렷 → 12. 매핑은 c+y정렬만 쓰므로(추가분도 동일) loser 분포 불변.
const LADDER_MIN_TOTAL_RUNGS = 12;
// 균등 생성용 세로 밴드 수 — y범위[Y_MIN,Y_MAX]를 이 개수로 등분(상/중/하). 추가분을 칸·밴드에 고르게 분산.
// 균등화는 배치(c,y)만 바꾼다(loser는 doReveal의 점유 레인 균등 랜덤 — 배치와 독립). 시각/구조 균형 목적.
const LADDER_GEN_BANDS = 3;

// 연속 좌표 사다리 — 막대기는 두 인접 기둥(c, c+1)을 높이 y(0~1)에서 잇는다. 격자 없음.
const LADDER_MIN_GAP_Y = 0.05;      // 같은 기둥을 공유하는 막대기 간 최소 세로 간격(비율) — 사다리 모호성 방지
const LADDER_Y_MIN = 0.05;          // 막대기 높이 하한
const LADDER_Y_MAX = 0.95;          // 막대기 높이 상한
// ─── 순차 하강(reveal) 연출 타이밍 — js/ladder.js 와 반드시 동기화 ───
// 토큰은 한 명씩 차례로(revealOrder 순) 출발한다. 한 토큰이 자기 경로 전체를 SLOT_MS 동안
// 호 길이 비례 보간(pointAt)으로 끝까지 내려가면 다음 토큰이 출발한다. 경로 길이가 레인마다 달라도
// 같은 시간(SLOT_MS)에 주파한다. 총 하강 시간 = 토큰 수(N) × SLOT_MS → 종료 타이머는 N에 비례.
// 스크램블 연출 시퀀스 타이밍(reveal 시작 → 하강 시작 전 단계들). js/ladder.js와 반드시 동일 유지.
const LADDER_COUNTDOWN_MS = 1600;     // "3·2·1 셔플!" 카운트다운
const LADDER_ERASE_MS = 1200;         // 지울 막대기 동시 강조 → 일괄 탈락(드롭/페이드) 연출 시간
const LADDER_DRAW_MS = 900;           // 펜 구슬이 새 막대기를 그리는 시간
const LADDER_TOKEN_SLOT_MS = 3000;    // 토큰 한 명이 끝까지 내려가는 시간(아주 천천히) — js/ladder.js와 동일 유지
const LADDER_BOTTOM_PAUSE_MS = 500;   // 그리기 후 1박자 멈춤(폭탄 포인터 시작 전) — js/ladder.js와 동일 유지
const LADDER_BOMB_POINTER_MS = 2600;  // 폭탄 룰렛 포인터가 바닥칸을 가속→감속하며 훑다 kkwangBottom에 정지하는 시간(하강 전) — js/ladder.js와 동일 유지
const LADDER_FINAL_HOLD = 1800;       // 결과 캡션 유지(ms) — js/ladder.js와 동일 유지

// reveal 시작부터 자동 종료(결과 오버레이)까지 — 순차 하강이라 토큰 수(N)에 비례.
// 시퀀스(꽝 선결정): 카운트다운 → 지우기(미사용 라벨→일괄탈락) → 그리기 → 바닥멈춤 → 폭탄 포인터(💀 공개) → 순차 하강(N×SLOT) → 결과 캡션 유지.
// 단계 순서만 바뀌고 합은 동일(옛 순서 대비 바닥멈춤+폭탄포인터가 하강 앞으로 이동) — 합산식 불변.
// 모든 단계 길이를 합산해야 서버 endGame이 클라 연출 도중에 끼어들지 않는다(서버↔클라 타이밍 동기 불변). N = 점유 레인(하강 토큰) 수.
function ladderRevealDelay(N) {
    const n = Math.max(1, N | 0);
    const descent = n * LADDER_TOKEN_SLOT_MS;
    return LADDER_COUNTDOWN_MS + LADDER_ERASE_MS + LADDER_DRAW_MS
        + descent + LADDER_BOTTOM_PAUSE_MS + LADDER_BOMB_POINTER_MS + LADDER_FINAL_HOLD;
}

const LADDER_RESET_DELAY = 600;     // gameEnd 후 다음 판 자동 리셋까지(빠른 재준비). 결과 표시는 클라가 유지(경마식).
const LADDER_SLANT_MAX = 1;         // rung 기울기(slant) 절대값 상한 (js/ladder.js와 동기 — 시각 효과)
const LADDER_CURVE_MAX_POINTS = 24; // 곡선 막대기 점 개수 상한 (신뢰경계 — 페이로드 폭주 방지, js/ladder.js와 동기)
const LADDER_CURVE_RAW_MAX = 256;   // 클라가 보낸 원시 점 허용 상한(이 초과는 비정상 → 직선 폴백)
// 곡선 누적 세로 이동(vtravel) 상한 — Σ|Δy|(정규화 0~1). 공개 시 토큰은 막대기 폴리라인을 따라가므로
// 세로로 길게/구불구불 그릴수록 경로가 길어져 속도가 튄다. 이 상한 초과분은 평균 중심으로 y편차를 줄여
// 경로 길이를 일정 범위로 묶는다. points는 시각일 뿐 매핑(c+y정렬)과 무관 → 공정성 영향 0. js/ladder.js와 동기.
const LADDER_CURVE_MAX_VTRAVEL = 1.0;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// 곡선 점 배열 정규화 (신뢰경계 — 클라 입력). 시각 장식일 뿐 결과에 영향 없음.
// 비정상/빈약하면 null(→ 직선 폴백). 좌표 clamp(0~1), 개수 상한 다운샘플, 양끝을 두 기둥(x=0,1)에 스냅.
function sanitizeCurvePoints(points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > LADDER_CURVE_RAW_MAX) return null;
    let clean = [];
    for (const p of points) {
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) continue;
        clean.push({ x: clamp01(p.x), y: clamp01(p.y) });
    }
    if (clean.length < 2) return null;
    if (clean.length > LADDER_CURVE_MAX_POINTS) {   // 상한으로 균등 다운샘플(양끝 보존)
        const ds = [];
        for (let i = 0; i < LADDER_CURVE_MAX_POINTS; i++) {
            ds.push(clean[Math.round(i * (clean.length - 1) / (LADDER_CURVE_MAX_POINTS - 1))]);
        }
        clean = ds;
    }
    clean[0] = { x: 0, y: clean[0].y };                       // 시작점 → 왼쪽 기둥
    clean[clean.length - 1] = { x: 1, y: clean[clean.length - 1].y };  // 끝점 → 오른쪽 기둥
    return clampCurveVTravel(clean);
}

// 곡선의 누적 세로 이동(Σ|Δy|)이 상한을 넘으면 평균 y 중심으로 편차를 일괄 축소 → 세로 path 길이 제한.
// 비례 축소라 vtravel = 상한에 정확히 맞춰진다. x(가로)는 두 기둥에 고정이라 손대지 않는다.
// 매핑은 c와 y정렬만 쓰므로(points 무관) 결과 불변 — 연출 속도/가독 목적의 시각 제약일 뿐.
// vtravel 기준 멱등(재적용 시 vtravel은 상한 그대로; y값은 float 재계산 최하위 자릿수만 흔들릴 수 있음 — 렌더/결과 무해).
function clampCurveVTravel(pts) {
    let vtravel = 0;
    for (let i = 1; i < pts.length; i++) vtravel += Math.abs(pts[i].y - pts[i - 1].y);
    if (vtravel <= LADDER_CURVE_MAX_VTRAVEL) return pts;
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const k = LADDER_CURVE_MAX_VTRAVEL / vtravel;
    return pts.map(p => ({ x: p.x, y: clamp01(meanY + (p.y - meanY) * k) }));
}

// 상단 레인 → 바닥 열 매핑 (곡선·slant 무관: rg.c와 y정렬만 사용 → 결과 불변 보장 지점).
// 외부에서 곡선 무관성 회귀 테스트로 호출. y 오름차순으로 내부 정렬해 자기완결.
function computeLaneToBottom(N, rungs) {
    const sorted = (rungs || []).slice().sort((a, b) => a.y - b.y);
    const map = new Array(N);
    for (let start = 0; start < N; start++) {
        let col = start;
        for (const rg of sorted) {
            if (col === rg.c) col++;
            else if (col === rg.c + 1) col--;
        }
        map[start] = col;
    }
    return map;
}

// slant 정규화: 숫자가 아니거나 범위를 벗어나면 보정 (신뢰경계 — 클라 입력)
function clampSlant(s) {
    if (typeof s !== 'number' || !isFinite(s)) return 0;
    return Math.max(-LADDER_SLANT_MAX, Math.min(LADDER_SLANT_MAX, s));
}

// 높이 y 정규화 (신뢰경계 — 클라 입력). 범위 밖/비정상은 null.
function clampY(y) {
    if (typeof y !== 'number' || !isFinite(y)) return null;
    return Math.max(LADDER_Y_MIN, Math.min(LADDER_Y_MAX, y));
}

// 두 막대기가 기둥을 공유하는가 (같은 구간 c 또는 인접 구간 → 공유 기둥 존재)
function sharesPost(c1, c2) { return Math.abs(c1 - c2) <= 1; }

// (c, y)에 막대기를 놓으면 기존 막대기와 너무 가까운가 (같은 기둥 공유 + |Δy| < 최소간격)
function rungTooClose(rungList, c, y) {
    return (rungList || []).some(rg => rg && sharesPost(rg.c, c) && Math.abs(rg.y - y) < LADDER_MIN_GAP_Y);
}

// ─── 균등(편향 없는) 배치 헬퍼 (서버 전용) ───
// 추가분을 무작위 칸이 아니라 "현재 가장 적은 칸"에, 그 칸에서도 "가장 비어있는 밴드"에 놓아
// 칸(c=0..N-2)·세로 밴드(상/중/하)에 라운드로빈처럼 고르게 분산한다. 매핑(c+y정렬)·loser 분포 불변.

// 높이 y → 밴드 인덱스(0=상 .. LADDER_GEN_BANDS-1=하). Y범위를 등분.
function bandOf(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    const f = span > 0 ? (y - LADDER_Y_MIN) / span : 0;
    return Math.max(0, Math.min(LADDER_GEN_BANDS - 1, Math.floor(f * LADDER_GEN_BANDS)));
}

// 칸별(c=0..N-2) 현재 막대기 수 배열.
function columnCounts(rungs, N) {
    const counts = new Array(N - 1).fill(0);
    (rungs || []).forEach(rg => { if (rg && rg.c >= 0 && rg.c < N - 1) counts[rg.c]++; });
    return counts;
}

// 가장 적게 가진 칸을 고른다(동률이면 서버 RNG). 균형 라운드로빈 배치용.
function pickLeastLoadedColumn(counts, rng) {
    let min = Infinity;
    counts.forEach(c => { if (c < min) min = c; });
    const cands = [];
    counts.forEach((c, i) => { if (c === min) cands.push(i); });
    return cands[Math.floor(rng() * cands.length)];
}

// 주어진 칸(c)에서 가장 비어있는 밴드의 y범위 내 서버 RNG y를 고른다(동률 밴드면 RNG).
// rungs = 현재 전체 막대기(밴드별 개수 산정용). 밴드 경계 안에서 균등 랜덤.
function pickYInLeastLoadedBand(rungs, c, rng) {
    const bandCounts = new Array(LADDER_GEN_BANDS).fill(0);
    (rungs || []).forEach(rg => { if (rg && rg.c === c) bandCounts[bandOf(rg.y)]++; });
    let min = Infinity;
    bandCounts.forEach(n => { if (n < min) min = n; });
    const cands = [];
    bandCounts.forEach((n, i) => { if (n === min) cands.push(i); });
    const band = cands[Math.floor(rng() * cands.length)];
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    const lo = LADDER_Y_MIN + span * (band / LADDER_GEN_BANDS);
    const hi = LADDER_Y_MIN + span * ((band + 1) / LADDER_GEN_BANDS);
    return lo + rng() * (hi - lo);
}

/**
 * 가시 기본(base) 막대기 생성 (서버 전용 RNG) — 빌드 오픈 시점에 1회 호출.
 * 기존 막대기(여기선 다른 base)와 spacing 충돌 회피. owner 없음(user:false, owner:null).
 * id는 단조 카운터(nextId)로 부여 — Math.random/timestamp 금지(결정성·공정성).
 * @param {number} N - 레인 수(고정 6)
 * @param {function(): number} nextId - id 발급 콜백 (ld.rungSeq++)
 * @returns {Array<{id:number,c:number,y:number,slant:number}>}
 */
function generateBaseRungs(N, nextId) {
    const baseRungs = [];
    const randY = () => LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN);
    const pushRung = (c, y) => baseRungs.push({ id: nextId(), c, y, slant: (Math.random() * 2 - 1) * LADDER_SLANT_MAX });

    // 1) 모든 칸(c=0..N-2)에 최소 1개씩 보장 — 빈 칸 없이 사다리가 꽉 차 보이게.
    //    인접 칸과 spacing(rungTooClose) 안 겹치는 y를 재시도로 찾는다.
    for (let c = 0; c < N - 1; c++) {
        for (let a = 0; a < 60; a++) {
            const y = randY();
            if (rungTooClose(baseRungs, c, y)) continue;
            pushRung(c, y);
            break;
        }
    }

    // 2) 다양성용 추가 막대기 — 0~RAND개를 "가장 적은 칸 + 가장 빈 밴드"에 얹는다(균등 분산, spacing 회피).
    //    무작위 칸 대신 희소 우선(least-loaded)이라 한 칸/한 구역에 몰리지 않는다. 매핑·loser 분포 불변.
    const extra = Math.floor(Math.random() * (LADDER_BASE_RUNG_RAND + 1));
    let placed = 0, attempts = 0;
    while (placed < extra && attempts < extra * 80) {
        attempts++;
        const c = pickLeastLoadedColumn(columnCounts(baseRungs, N), Math.random);
        const y = pickYInLeastLoadedBand(baseRungs, c, Math.random);
        if (rungTooClose(baseRungs, c, y)) continue;
        pushRung(c, y);
        placed++;
    }
    return baseRungs;
}

/**
 * 스크램블 사다리 구조 생성 (서버 전용) — 연속 좌표.
 * 막대기 = { id, c: 왼쪽 기둥(0..N-2), y: 높이(0~1), slant: 기울기(-1~1, 시각), user, owner }.
 * 1) union = base + user(flatten) 방어적 재검증, 2) K개 erase, 3) M개 add(서버 RNG),
 * 4) final = remaining + added 를 y 오름차순 정렬.
 * 매핑(laneToBottom)은 c + y정렬만 사용 → slant/points/스크램블 토폴로지는 loser 분포와 무관(공정성 불변).
 * kkwang/losingLane/loser는 여기서 정하지 않는다(doReveal의 점유 레인 균등 랜덤이 권위).
 * @param {number} N - 레인 수(고정 6)
 * @param {Array<{id,c,y,slant}>} baseRungs - 가시 base 막대기 (owner 없음)
 * @param {Object<string, Array<{id,c,y,slant,points}>>} userRungsMap - 유저별 막대기 배열맵
 * @param {function(): number} nextId - add 막대기 id 발급 콜백 (ld.rungSeq++)
 * @returns {{ rungs, erased, added, laneToBottom }}
 */
function buildLadder(N, baseRungs, userRungsMap, nextId) {
    nextId = nextId || (() => 0);

    // 1) union 구성 + 방어적 재검증 (범위 0..N-2, clampY, spacing). 위반분 제외, id 보존.
    //    유저 막대기를 먼저 넣어 우선권을 준다 → 유저가 base 근처에 그렸으면 그 base가 양보(드롭)하고
    //    유저 막대기는 보존된다(빌드에서 그린 게 시작 시 조용히 사라지지 않게). base는 모든 칸 1개씩 깔리므로,
    //    유저가 채운 칸은 유저 막대기로, 안 채운 칸은 base로 — 어느 칸도 비지 않는다.
    const union = [];
    Object.keys(userRungsMap || {}).forEach(owner => {
        const arr = Array.isArray(userRungsMap[owner]) ? userRungsMap[owner] : [];
        arr.forEach(rg => {
            if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
            const yy = clampY(rg.y);
            if (yy === null || rungTooClose(union, rg.c, yy)) return;
            // points = 곡선(시각, 결과 무관). 이미 add 시 sanitize됨 — 그대로 보존.
            union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: rg.points || null, user: true, owner });
        });
    });
    (baseRungs || []).forEach(rg => {
        if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
        const yy = clampY(rg.y);
        if (yy === null || rungTooClose(union, rg.c, yy)) return;   // 유저 막대기와 너무 가까운 base는 드롭
        union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: null, user: false, owner: null });
    });

    // 2) erase: K = ERASE_MIN..ERASE_MAX (서버 RNG). 사다리가 비지 않게 union.length-2까지로 클램프.
    //    무작위 K개 대신 "가장 많이 가진 칸에서 라운드로빈으로" 지워 한 칸만 집중 비우지 않는다(균형).
    //    각 칸은 가능하면 최소 1개 보존(union의 칸당 1개만 있는 작은 방에선 무리하지 않음 — 후보 없으면 중단).
    let K = LADDER_SCRAMBLE_ERASE_MIN + Math.floor(Math.random() * (LADDER_SCRAMBLE_ERASE_MAX - LADDER_SCRAMBLE_ERASE_MIN + 1));
    K = Math.min(K, Math.max(0, union.length - 2));
    const eraseIdxSet = new Set();
    // 칸별 union 인덱스 목록(칸당 보존 1개 판정·라운드로빈 선택용)
    const colIdx = {};
    union.forEach((rg, i) => { (colIdx[rg.c] = colIdx[rg.c] || []).push(i); });
    for (let picked = 0; picked < K; picked++) {
        // 현재 남은(미지움) 막대기가 2개 이상인 칸 중 가장 많이 가진 칸을 고른다(동률은 서버 RNG).
        let maxRemain = -1;
        Object.keys(colIdx).forEach(c => {
            const remainInCol = colIdx[c].filter(i => !eraseIdxSet.has(i)).length;
            if (remainInCol >= 2 && remainInCol > maxRemain) maxRemain = remainInCol;
        });
        if (maxRemain < 0) break;   // 모든 칸이 1개 이하 — 더 지우면 칸이 비므로 중단(균형 보존)
        const cands = Object.keys(colIdx).filter(c =>
            colIdx[c].filter(i => !eraseIdxSet.has(i)).length === maxRemain);
        const col = cands[Math.floor(Math.random() * cands.length)];
        // 그 칸의 남은 막대기 중 하나를 서버 RNG로 지운다.
        const remainIdx = colIdx[col].filter(i => !eraseIdxSet.has(i));
        eraseIdxSet.add(remainIdx[Math.floor(Math.random() * remainIdx.length)]);
    }
    const erased = [];
    const remaining = [];
    union.forEach((rg, i) => { (eraseIdxSet.has(i) ? erased : remaining).push(rg); });

    // 3) add: M = ADD_MIN..ADD_MAX (서버 RNG). remaining + 이미 add된 것과 spacing 안 겹치게 배치.
    //    못 채우면 M 미달 허용(attempts 한도). 추가분은 owner 없음(user:false, owner:null).
    const M = LADDER_SCRAMBLE_ADD_MIN + Math.floor(Math.random() * (LADDER_SCRAMBLE_ADD_MAX - LADDER_SCRAMBLE_ADD_MIN + 1));
    const added = [];
    // 새 막대기 한 개를 "가장 적은 칸 + 가장 빈 밴드"에, spacing(remaining + 기존 added) 안 겹치게 배치 시도.
    //    무작위 c/y 대신 희소 우선이라 erase 후 빈 칸·구역부터 채워 전체가 고르게 찬다. 매핑·loser 분포 불변.
    function tryAddOne() {
        const current = remaining.concat(added);
        const c = pickLeastLoadedColumn(columnCounts(current, N), Math.random);
        const y = pickYInLeastLoadedBand(current, c, Math.random);
        if (rungTooClose(remaining, c, y) || rungTooClose(added, c, y)) return false;
        added.push({ id: nextId(), c, y, slant: (Math.random() * 2 - 1) * LADDER_SLANT_MAX, points: null, user: false, owner: null });
        return true;
    }
    let placed = 0, attempts = 0;
    while (placed < M && attempts < M * 80) {
        attempts++;
        if (tryAddOne()) placed++;
    }

    // 3-b) 밀도 보충: 스크램블 후 총 막대기(remaining + added)가 floor 미만이면 floor까지 채운다.
    //      작은 방에서도 사다리가 꽉 차 보이게. 추가분은 added에 합류 → reveal payload added/rungs에 동일 포함(클라 동기).
    //      매핑은 c+y정렬만 사용하므로 추가분이 loser 분포를 바꾸지 않는다(공정성 불변). spacing 못 채우면(빽빽) 미달 허용.
    const floor = Math.min(LADDER_MIN_TOTAL_RUNGS, (N - 1) * 3);   // 칸당 spacing 한계 고려 안전 상한(칸 5개 × ~3)
    let fillAttempts = 0;
    while (remaining.length + added.length < floor && fillAttempts < floor * 120) {
        fillAttempts++;
        tryAddOne();
    }

    // 4) final = remaining + added, y 오름차순 정렬 (위→아래) — 매핑·연출 공통 순서
    const rungs = remaining.concat(added).sort((a, b) => a.y - b.y);

    // 5) 각 상단 레인 → 바닥 열 추적 (곡선/slant/스크램블은 매핑에서 제외 → 결과 불변)
    const laneToBottom = computeLaneToBottom(N, rungs);

    // kkwangBottom/losingLane/loser는 doReveal에서 점유 레인 균등 랜덤으로 확정(공정성 불변).
    return { rungs, erased, added, laneToBottom };
}

/**
 * 사다리타기 게임 이벤트 핸들러
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    function clearLadderTimers(ld) {
        if (ld.revealTimeout) { clearTimeout(ld.revealTimeout); ld.revealTimeout = null; }
        if (ld.endTimeout) { clearTimeout(ld.endTimeout); ld.endTimeout = null; }
        if (ld.resetTimeout) { clearTimeout(ld.resetTimeout); ld.resetTimeout = null; }
    }

    // 레인 수 = 항상 6 고정(번호 1~6). 인원과 무관 — 빈 레인 허용(경마식 번호 고르기).
    function ladderLaneCount() { return LADDER_LANES; }
    // 준비하고 현재 방에 있는 사람 수 — 막대기 배치/시작 가능 게이트(≥2)에 사용.
    function readyCount(gameState) {
        return (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)).length;
    }

    // drawer 색 인덱스 배정 (서버 권위, 결정적) — 참가자가 빌드에서 처음 등장할 때 호출.
    // 현재 참가자들과 겹치지 않는 가장 작은 미사용 인덱스(0부터)를 배정. Math.random 금지.
    function assignColorIndex(ld, name) {
        if (!ld.colorIndex) ld.colorIndex = {};
        if (ld.colorIndex[name] !== undefined) return;
        const used = new Set(Object.values(ld.colorIndex));
        let idx = 0;
        while (used.has(idx)) idx++;
        ld.colorIndex[name] = idx;
    }

    // 입장 시 자동 레인 점유 (서버 RNG) — 빈 레인(1~6) 중 하나를 균등 랜덤으로 배정. 빈 레인 없으면 미배정.
    // 이미 레인을 가진 사용자(재입장/이미 선택)는 그대로 둔다(중복 점유 방지). 색 인덱스도 함께 부여.
    // pickLane으로 언제든 다른 빈 레인으로 이동 가능 — 자동 점유는 "입장 즉시 자리 하나" 선물일 뿐(예측·악용 영향 없음:
    // 자리는 doReveal에서 점유 레인 균등 랜덤으로 패자를 뽑으므로, 어느 빈 레인을 받든 분포 불변).
    function claimFreeLane(ld, N, name) {
        if (!ld || ld.phase !== 'idle') return false;
        if (typeof ld.userLanes[name] === 'number') return false;   // 이미 점유 중 — 유지
        const taken = new Set(Object.values(ld.userLanes).filter(l => typeof l === 'number'));
        const freeLanes = [];
        for (let i = 0; i < N; i++) if (!taken.has(i)) freeLanes.push(i);
        if (!freeLanes.length) return false;   // 6개 다 참 — 기존 용량 동작(미배정) 유지
        const lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
        assignColorIndex(ld, name);            // 자동 점유에도 drawer 색 부여(레인만 골라도 색 일관)
        ld.userLanes[name] = lane;
        return true;
    }
    // 입장 경로(rooms.js)에서 호출 — 빌드(idle) 단계일 때만 자동 점유 후 브로드캐스트.
    ctx.claimLadderFreeLane = function (room, gameState, name) {
        const ld = gameState && gameState.ladder;
        if (!ld) return;
        if (claimFreeLane(ld, ladderLaneCount(), name)) {
            emitRungsUpdated(room, gameState);
        }
    };

    // 가시 base 막대기 생성 — 입장(phase idle) 시점에 1회만. 멱등(baseRungsGenerated 가드).
    // emitRungsUpdated 진입 시 호출 → 1명만 있어도(솔로 입장) base가 즉시 가시 broadcast된다(입장 즉시 사다리 표시).
    // base는 결과와 무관(공정성 영향 0) — 빌드 중 공개 OK. 시작 게이트(준비 ≥2)는 별도(ladder:start)로 유지.
    function ensureBaseRungs(ld, N, gameState) {
        if (!ld || ld.phase !== 'idle' || ld.baseRungsGenerated) return;
        ld.baseRungs = generateBaseRungs(N, () => ld.rungSeq++);
        ld.baseRungsGenerated = true;
    }

    // 빌드(idle) 막대기/레인을 현재 레인 수 N 범위로 트림 — 인원 감소 시 범위 밖(c>N-2·lane≥N) 잔존 제거.
    // shared.js(준비 변동)·rooms.js(입장/이탈)·emitRungsUpdated 가 공통으로 호출하는 단일 정합성 규칙.
    // userRungs[name]은 배열 → 각 배열에서 범위밖 원소 필터, 빈 배열되면 키 삭제.
    function trimLadderBuildToN(ld, N) {
        if (!ld) return;
        Object.keys(ld.userRungs || {}).forEach(name => {
            const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
            const kept = arr.filter(rg => rg && typeof rg.c === 'number' && rg.c >= 0 && rg.c <= N - 2);
            if (kept.length) ld.userRungs[name] = kept;
            else delete ld.userRungs[name];
        });
        Object.keys(ld.userLanes || {}).forEach(name => {
            const lane = ld.userLanes[name];
            if (typeof lane !== 'number' || lane < 0 || lane >= N) delete ld.userLanes[name];
        });
    }

    // 유저 막대기(배열맵) + base 막대기(가시) + 유저 레인선택 + colorIndex + 현재 레인 수를 전체 클라에 브로드캐스트.
    // server-only 정보(final rungs/laneToBottom/losingLane/kkwangBottom/loser/erased/added)는 미포함.
    // 진입 시 base 생성(준비 ≥2)·트림을 먼저 수행 → 어떤 경로로 호출돼도 가시 base + 범위내 막대기만 전파.
    function emitRungsUpdated(room, gameState) {
        const ld = gameState.ladder;
        const N = ladderLaneCount();
        ensureBaseRungs(ld, N, gameState);
        trimLadderBuildToN(ld, N);
        io.to(room.roomId).emit('ladder:rungsUpdated', {
            userRungs: { ...ld.userRungs },
            baseRungs: (ld.baseRungs || []).slice(),
            userLanes: { ...ld.userLanes },
            colorIndex: { ...ld.colorIndex },
            numLanes: N
        });
    }
    ctx.emitLadderRungsUpdated = emitRungsUpdated;
    ctx.ladderBuildLaneCount = ladderLaneCount;
    ctx.trimLadderBuild = trimLadderBuildToN;

    // 전원 선택 완료 또는 호스트 강제 → reveal
    function doReveal(room, gameState) {
        const ld = gameState.ladder;
        if (ld.phase !== 'selecting') return;

        // 미선택 참가자는 남은 레인을 무작위(서버 RNG)로 섞어 배정 — 예측·악용 방지
        const taken = new Set(Object.values(ld.userLanes));
        const freeLanes = [];
        for (let i = 0; i < ld.numLanes; i++) if (!taken.has(i)) freeLanes.push(i);
        for (let i = freeLanes.length - 1; i > 0; i--) {   // Fisher-Yates
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = freeLanes[i]; freeLanes[i] = freeLanes[j]; freeLanes[j] = tmp;
        }
        let fi = 0;
        ld.participants.forEach(name => {
            if (ld.userLanes[name] === undefined && gameState.users.some(u => u.name === name)) {
                ld.userLanes[name] = freeLanes[fi++];
            }
        });

        // 꽝(losingLane)은 반드시 점유된 레인 중에서만 선택 — 6레인 고정이라 빈 레인이 있어도
        // "패자 없는 판"이 생기지 않게 한다(꽝 항상 정확히 1명). 점유 레인 균등 랜덤 → 공정성 불변.
        // kkwangBottom은 그 레인의 도착 바닥칸(laneToBottom 매핑 그대로 — 시각/매핑 불변).
        const occupiedLanes = Object.values(ld.userLanes).filter(l => typeof l === 'number');
        if (occupiedLanes.length) {
            ld.losingLane = occupiedLanes[Math.floor(Math.random() * occupiedLanes.length)];
            ld.kkwangBottom = ld.laneToBottom[ld.losingLane];
        } else {
            ld.losingLane = -1;
            ld.kkwangBottom = -1;
        }

        ld.phase = 'revealing';
        ld.isLadderActive = true;

        // 패자 = losingLane을 가진 사용자 (없으면 null — 모두 나간 경우 endGame 가드)
        ld.loser = Object.keys(ld.userLanes).find(name => ld.userLanes[name] === ld.losingLane) || null;

        // 하강 순서 = 레인을 가진 참가자를 서버 RNG로 셔플. 시각 효과일 뿐 결과와 무관.
        // 모든 탭이 동일 순서로 재생하도록 페이로드에 포함(클라 Math.random 미사용 → 공정성 유지).
        const revealOrder = Object.keys(ld.userLanes);
        for (let i = revealOrder.length - 1; i > 0; i--) {   // Fisher-Yates
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = revealOrder[i]; revealOrder[i] = revealOrder[j]; revealOrder[j] = tmp;
        }
        ld.revealOrder = revealOrder;

        io.to(room.roomId).emit('ladder:reveal', {
            numLanes: ld.numLanes,
            rungs: ld.rungs,                    // final(스크램블 후, y정렬). 각 막대기에 id·user·owner 포함(클라 색·라벨용)
            kkwangBottom: ld.kkwangBottom,
            laneToBottom: ld.laneToBottom,
            userLanes: { ...ld.userLanes },
            revealOrder: revealOrder,
            loser: ld.loser,
            erased: (ld.erased || []).slice(),  // 지워질 막대기 객체 배열 (지우개 연출용 — 기하 포함)
            added: (ld.added || []).slice(),    // 새로 그릴 막대기 객체 배열 (펜 연출용)
            colorIndex: { ...ld.colorIndex }    // drawer 색 (서버 권위)
        });

        console.log(`[사다리타기] 방 ${room.roomName} 공개 - 레인=${ld.numLanes}, 꽝바닥=${ld.kkwangBottom}, 패배레인=${ld.losingLane}, 패자=${ld.loser}`);

        clearLadderTimers(ld);
        // 종료 타이머 = 클라 연출 합과 정확히 일치. N = 점유 레인 수(=클라 revealOrder 필터 결과 = 하강 토큰 수).
        const tokenCount = Object.keys(ld.userLanes).length;
        ld.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, ladderRevealDelay(tokenCount));

        updateRoomsList();
    }

    function endGame(room, gameState) {
        const ld = gameState.ladder;
        clearLadderTimers(ld);

        const lanePairs = Object.entries(ld.userLanes);
        if (lanePairs.length === 0) {
            ld.phase = 'idle';
            ld.isLadderActive = false;
            io.to(room.roomId).emit('ladder:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        // 패자 확정: reveal 시점 loser가 아직 방에 있으면 그대로, 아니면 losingLane 보유자로 재계산
        const loser = (ld.loser && gameState.users.some(u => u.name === ld.loser))
            ? ld.loser
            : (Object.keys(ld.userLanes).find(name =>
                ld.userLanes[name] === ld.losingLane && gameState.users.some(u => u.name === name)) || ld.loser || null);

        // 순위: 패자만 꼴찌(꽝), 나머지는 통과
        const rankings = lanePairs.map(([name, lane]) => ({
            name,
            lane,
            bottom: ld.laneToBottom[lane],
            isLoser: name === loser
        }));

        ld.phase = 'finished';
        ld.isLadderActive = false;
        ld.round++;

        ld.ladderHistory.push({
            round: ld.round,
            loser,
            kkwangBottom: ld.kkwangBottom,
            picks: { ...ld.userLanes },
            timestamp: new Date().toISOString()
        });
        if (ld.ladderHistory.length > LADDER_HISTORY_MAX) {
            ld.ladderHistory = ld.ladderHistory.slice(-LADDER_HISTORY_MAX);
        }

        io.to(room.roomId).emit('ladder:gameEnd', {
            loser,
            rankings,
            kkwangBottom: ld.kkwangBottom,
            round: ld.round
        });

        const players = Object.keys(ld.userLanes);
        recordGamePlay('ladder', players.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('ladder', room.serverId);
            Promise.all(players.map(name => {
                const isLoser = name === loser;
                const isWinner = !isLoser;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'ladder', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'ladder',
                gameRules: 'ladder-pick',
                winnerName: players.find(n => n !== loser) || null,
                participantCount: players.length
            })).catch(e => console.warn('[사다리타기] DB 기록 실패:', e.message));
        }

        console.log(`[사다리타기] 방 ${room.roomName} 종료 - 패자=${loser}`);

        // 게임 종료 → 바로 주문받기 자동 시작 (경마 단일 당첨자 패턴과 동일).
        // 사다리는 꽝이 항상 정확히 1명(losingLane bijection)이라 동점 분기가 없어 항상 여기로 온다.
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        // 다음 판 리셋 (결과 표시 시간 확보 후)
        ld.resetTimeout = setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const cur = currentRoom.gameState.ladder;
            const cg = currentRoom.gameState;

            // 빠른 재준비 보존: 600ms 결과창에서 "다음 판 준비"를 이미 누른(=readyUsers에 들어있는)
            // 연결 중 유저는 reset이 ready를 덮어쓰지 않게 캡처. resetLadder는 막대기/레인/색/phase를
            // 깨끗이 초기화하지만(매 판 새 틀), 보존 대상은 직후 다시 ready로 복원 + 레인 자동 점유.
            // (덮어쓰면 클라 버튼은 "준비됨"인데 서버 readyUsers=[] → 카운트/버튼 desync, 재클릭 강요.)
            const preservedReady = (cg.readyUsers || []).filter(name =>
                cg.users.some(u => u.name === name));

            resetLadder(cur);
            cg.readyUsers = preservedReady.slice();
            cg.users.forEach(u => { u.isReady = preservedReady.includes(u.name); });
            io.to(room.roomId).emit('readyUsersUpdated', cg.readyUsers);
            io.to(room.roomId).emit('ladder:roundReset');

            // 보존된 ready 유저에게 다음 빌드 레인 자동 점유(입장 경로와 동일 규칙).
            // ensureBaseRungs는 phase=idle이면(인원 1명만 있어도) 새 base를 생성하므로, 다음 빌드가
            // 보존 ready + base 가시 상태로 바로 열린다(매 라운드 새 base, 멱등 정확). 시작은 별도로 준비 ≥2 필요.
            preservedReady.forEach(name => claimFreeLane(cur, ladderLaneCount(), name));
            emitRungsUpdated(currentRoom, cg);   // base 생성(idle) + 점유 레인 브로드캐스트

            updateRoomsList();
        }, LADDER_RESET_DELAY);

        updateRoomsList();
    }

    function resetLadder(ld) {
        clearLadderTimers(ld);
        ld.phase = 'idle';
        ld.numLanes = 0;
        ld.userRungs = {};            // 유저 막대기 배열맵 초기화 (매 판 새 기본 틀)
        ld.baseRungs = [];            // 가시 기본 막대기 초기화 — 다음 빌드 오픈 시 재생성
        ld.baseRungsGenerated = false;
        ld.colorIndex = {};           // drawer 색 인덱스 초기화 (라운드마다 재배정)
        ld.rungSeq = 0;               // id 시퀀스 0 리셋 (라운드 분리라 id 충돌 없음)
        ld.rungs = [];
        ld.erased = [];               // server-only: 스크램블 지운 막대기
        ld.added = [];                // server-only: 스크램블 추가 막대기
        ld.kkwangBottom = -1;
        ld.laneToBottom = [];
        ld.losingLane = -1;
        ld.userLanes = {};
        ld.participants = [];
        ld.revealOrder = [];
        ld.loser = null;
        ld.isLadderActive = false;
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 막대기 배치 (준비자, 빌드 단계) — 인당 최대 3개 append. 연속 좌표(c, y, slant) 서버 검증
    socket.on('ladder:addRung', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.c !== 'number' || typeof data.y !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error', '게임 시작 전(대기 중)에만 막대기를 놓을 수 있습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        if (!gameState.readyUsers.includes(name)) {
            socket.emit('ladder:error', '준비한 사람만 막대기를 놓을 수 있습니다.');
            return;
        }

        if (readyCount(gameState) < 2) {
            socket.emit('ladder:error', '준비한 사람이 2명 이상이어야 막대기를 놓을 수 있습니다.');
            return;
        }

        if (!Array.isArray(ld.userRungs[name])) ld.userRungs[name] = [];
        if (ld.userRungs[name].length >= LADDER_MAX_RUNGS_PER_USER) {
            socket.emit('ladder:error', `막대기는 한 사람당 최대 ${LADDER_MAX_RUNGS_PER_USER}개까지 놓을 수 있어요.`);
            return;
        }

        const N = ladderLaneCount();   // 항상 6 — 기둥 범위(0..N-2) 검증용

        const c = data.c;
        const y = clampY(data.y);
        if (!Number.isInteger(c) || c < 0 || c > N - 2 || y === null) {
            socket.emit('ladder:error', '막대기를 놓을 수 없는 위치입니다.');
            return;
        }

        // spacing 검증 — 유저 막대기끼리만 충돌 검사(본인+남). 기본(base) 막대기와의 근접은 막지 않는다:
        // 유저가 base 근처에도 자유롭게 그릴 수 있고, 시작 시 union에서 유저를 먼저 넣어 base가 양보하므로
        // 유저 막대기가 사라지지 않는다(buildLadder 참조). base까지 막으면 빌드가 과하게 빡빡해진다.
        const all = [];
        Object.keys(ld.userRungs).forEach(n => {
            (Array.isArray(ld.userRungs[n]) ? ld.userRungs[n] : []).forEach(rg => all.push(rg));
        });
        if (rungTooClose(all, c, y)) {
            socket.emit('ladder:error', '다른 막대기와 너무 가까워요. 조금 떨어뜨려 놓아주세요.');
            return;
        }

        // 첫 등장이면 drawer 색 배정 (서버 권위, 결정적)
        assignColorIndex(ld, name);

        // append (cap 3). id=단조 카운터, slant=기울기(시각), points=자유 곡선 궤적(시각). 둘 다 결과 무관.
        ld.userRungs[name].push({ id: ld.rungSeq++, c, y, slant: clampSlant(data.slant), points: sanitizeCurvePoints(data.points) });
        emitRungsUpdated(room, gameState);
    });

    // 막대기 제거 (본인 소유분) — { id }(또는 { rungId })로 해당 id만 제거. 없거나 못 찾으면 무시.
    socket.on('ladder:removeRung', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        const arr = ld.userRungs[name];
        if (!Array.isArray(arr) || arr.length === 0) return;

        const rungId = data && (typeof data.id === 'number' ? data.id : (typeof data.rungId === 'number' ? data.rungId : null));
        if (rungId === null) return;   // id 없으면 무시(에러 X)

        const next = arr.filter(rg => rg && rg.id !== rungId);
        if (next.length === arr.length) return;   // 본인 소유에 없는 id → 무시

        if (next.length) ld.userRungs[name] = next;
        else delete ld.userRungs[name];           // 빈 배열되면 키 정리
        emitRungsUpdated(room, gameState);
    });

    // 게임 시작 (호스트) — 준비 인원 수만큼 사다리 생성, 선택 단계 진입
    socket.on('ladder:start', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'ladder') {
            socket.emit('ladder:error', '사다리타기 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('ladder:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const ld = gameState.ladder;
        // idle(빌드)에서만 시작. finished(결과 표시 600ms)에서의 시작은 거부한다:
        // 결과 직후엔 곧 roundReset(resetTimeout)이 phase를 idle로 되돌리며 base/레인/색/막대기를
        // 새로 초기화한다. finished에서 바로 시작하면 clearLadderTimers가 그 resetTimeout을 취소해
        // resetLadder가 영영 안 돌고 이전 라운드 막대기/색/출발레인이 그대로 carry-over된다(빌드 desync).
        // 새 플로우: finished --600ms--> idle(ready 보존) --> build --> 호스트 시작.
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error',
                ld.phase === 'finished'
                    ? '결과 정리 중이에요. 잠시 후 다음 판을 시작해주세요.'
                    : '이미 게임이 진행 중입니다!');
            return;
        }

        // 참가자 = 현재 방에 있고 준비한 사용자
        const ready = (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)
        );
        if (ready.length < LADDER_MIN_PLAYERS) {
            socket.emit('ladder:error', `준비한 인원이 ${LADDER_MIN_PLAYERS}명 이상이어야 합니다!`);
            return;
        }

        // 게임 시작 시 이전 주문 cycle 가드 해제 — 다음 종료에서도 자동 주문이 다시 발동하도록 (경마 패턴)
        const wasOrderActive = gameState.isOrderActive;
        gameState.orderAutoTriggered = false;
        gameState.isOrderActive = false;
        if (wasOrderActive) io.to(room.roomId).emit('orderEnded');

        const participants = ready.slice(0, LADDER_MAX_PLAYERS);
        const N = LADDER_LANES;   // 레인 항상 6 고정 — 참가자가 6 미만이면 일부는 빈 레인

        // 시작 시점 유저 막대기 확정: 참가자 소유 + 각 배열 원소 기둥 범위(0 ≤ c ≤ N-2)인 것만 유지. 빈 배열 키 삭제.
        Object.keys(ld.userRungs).forEach(name => {
            if (!participants.includes(name)) { delete ld.userRungs[name]; return; }
            const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
            const kept = arr.filter(rg => rg && Number.isInteger(rg.c) && rg.c >= 0 && rg.c <= N - 2);
            if (kept.length) ld.userRungs[name] = kept;
            else delete ld.userRungs[name];
        });
        // 시작 시점 유저 레인 확정: 참가자 소유 + 범위(0 ≤ lane ≤ N-1) 내인 것만 유지 (빌드 단계에서 고른 값)
        Object.keys(ld.userLanes).forEach(name => {
            const lane = ld.userLanes[name];
            if (!participants.includes(name) || typeof lane !== 'number' || lane < 0 || lane >= N) {
                delete ld.userLanes[name];
            }
        });

        clearLadderTimers(ld);
        // 스크램블: base(이미 가시) + user(배열맵)를 union → K개 erase + M개 add (서버 RNG). id는 ld.rungSeq.
        const built = buildLadder(N, ld.baseRungs, ld.userRungs, () => ld.rungSeq++);
        ld.phase = 'selecting';            // 전이용(클라 선택 UI 없음) — 곧바로 doReveal
        ld.numLanes = N;
        ld.rungs = built.rungs;            // server-only: 스크램블 후 final(y정렬), reveal에서만 전송
        ld.erased = built.erased;          // server-only: 스크램블 지운 막대기(reveal에서 연출용 전송)
        ld.added = built.added;            // server-only: 스크램블 추가 막대기(reveal에서 연출용 전송)
        // ld.baseRungs는 그대로 유지 — 빌드 중 이미 가시였음(재생성 안 함)
        ld.laneToBottom = built.laneToBottom;
        // kkwangBottom/losingLane은 doReveal에서 "점유 레인 중"으로 확정(빈 레인 제외). 여기선 미설정.
        // ld.userLanes 유지 — 빌드 단계에서 고른 출발 레인. 미선택자는 doReveal에서 RNG 자동 배정.
        ld.participants = participants;
        ld.loser = null;
        ld.isLadderActive = true;

        console.log(`[사다리타기] 방 ${room.roomName} 시작 - 참가자 ${participants.length}명 / 레인 ${N}개, 곧바로 공개`);
        doReveal(room, gameState);         // 별도 레인 선택 단계 없이 즉시 공개
        updateRoomsList();
    });

    // 출발 레인 선택 (준비자, 빌드 단계) — 1인 1레인, 재선택은 이동, 같은 레인 재클릭은 취소
    socket.on('ladder:pickLane', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.lane !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error', '게임 시작 전(대기 중)에만 레인을 고를 수 있습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        if (!gameState.readyUsers.includes(name)) {
            socket.emit('ladder:error', '준비한 사람만 레인을 고를 수 있습니다.');
            return;
        }

        if (readyCount(gameState) < 2) return;
        const N = ladderLaneCount();   // 항상 6 — 번호(0..N-1) 범위 검증용

        const lane = data.lane;
        if (!Number.isInteger(lane) || lane < 0 || lane >= N) return;

        // 이미 다른 사용자가 고른 레인이면 거부
        const owner = Object.keys(ld.userLanes).find(n => ld.userLanes[n] === lane);
        if (owner && owner !== name) {
            socket.emit('ladder:error', '이미 다른 사람이 고른 레인입니다.');
            return;
        }

        // 본인이 같은 레인 다시 누르면 취소, 아니면 선택/이동 (1인 1레인)
        if (ld.userLanes[name] === lane) {
            delete ld.userLanes[name];
        } else {
            assignColorIndex(ld, name);   // 첫 등장이면 drawer 색 배정 (막대기 없이 레인만 골라도 색 부여)
            ld.userLanes[name] = lane;
        }
        emitRungsUpdated(room, gameState);
    });

    // 호스트 이탈 감지 → grace 후 phase 분기
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;

        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.ladder) return;

            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id
            );
            if (reconnected) return;

            const ld = gameState.ladder;
            // revealing: endTimeout이 자연 종료 — 개입 안 함
            if (ld.phase === 'revealing') return;
            // selecting: 진행 불가 → idle 복귀
            if (ld.phase === 'selecting') {
                resetLadder(ld);
                io.to(roomId).emit('ladder:gameAborted', { reason: '방장이 나갔습니다.' });
                updateRoomsList();
                return;
            }
            // idle: 진행 타이머 없음. finished: 다음 판 자동 리셋(resetTimeout)이 남은 참가자를 idle로
            // 되돌리도록 그대로 둔다(호스트는 이미 위임됨). 여기서 타이머를 지우면 결과 화면에서 고착하므로 개입 안 함.
        }, waitTime);
    });
};

// 테스트용 export (공정성 회귀 — 곡선이 매핑을 바꾸지 않는지 검증). 핸들러 호출에는 영향 없음.
module.exports.buildLadder = buildLadder;
module.exports.computeLaneToBottom = computeLaneToBottom;
module.exports.sanitizeCurvePoints = sanitizeCurvePoints;
