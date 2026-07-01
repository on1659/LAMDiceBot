// 사다리타기(ladder) 게임 소켓 핸들러 — pick-elimination 새 룰(in-place 리워크).
// 룰: 6 고정 칸(LADDER_COLUMNS) 중 1개를 선택(경마식 6택1, 여러 명 같은 top 공유 가능). 고정 "당첨" 바닥칸(winSlot)으로
//     routing되는 top을 고른 사람들이 라운드 패자 풀(loser pool). |pool|==1이면 최종 꼴등, >1이면 풀만 재준비+재pick(토너먼트).
// 막대기: 인당 최대 3개. 본인은 자기 막대기 전부, 남에겐 드로어당 server가 고른 public 1개만 보인다(publicRungByDrawer).
// 결과(winSlot·public rung·겹침 생존자·balance rung·mutationScript·landings·shrink top)는 전적으로 서버 RNG가 결정 — 클라는 받은 값으로 연출만(공정성).
// DB는 토너먼트 종료(최종 꼴등 확정) 시 1회만 기록(pirate 단일 패자 패턴: isWinner = name !== loser, rank = isWinner ? 1 : 2).
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const LADDER_COLUMNS = 6;           // 고정 칸(세로 줄) 수 — 경마식 6택1. 인원과 무관한 상수.
const LADDER_MIN_PLAYERS = 2;       // 시작 최소 준비 인원 (LAMDice 시작 게이트)
const LADDER_HISTORY_MAX = 100;     // 히스토리 최대 보관 수
// 기본(가시) 막대기 — 모든 칸(c=0..N-2)에 1개씩 보장 + 다양성용 0~RAND개 추가(서버 RNG).
const LADDER_BASE_RUNG_RAND = 2;    // 칸별 1개 보장 위에 더해지는 랜덤 추가량 상한(0~이 값)
// 자동 생성(base/스크램블) 막대기 중 '수평(평평한)' 막대기 비율(0~1). 나머지는 대각선.
// 공정성은 winSlot routing(physical descent)이 결정 — 수평/대각선 비율은 시각 전용(결과 분포 불변).
const LADDER_HORIZONTAL_RATIO = 0.5;

// 인당 막대기 최대 개수 — 빌드 단계에서 한 사람이 놓을 수 있는 상한 (cap 초과 시 FIFO 교체). 공유 예산은 제거(단순화).
const LADDER_MAX_RUNGS_PER_USER = 3;
// 스크램블(시작 시점): union에서 K개 지우고 M개 새로 그린다. 모두 서버 RNG. js/ladder.js와 동일 유지.
const LADDER_SCRAMBLE_ERASE_MIN = 2;
const LADDER_SCRAMBLE_ERASE_MAX = 4;
const LADDER_SCRAMBLE_ADD_MIN = 2;
const LADDER_SCRAMBLE_ADD_MAX = 4;
// 밀도 바닥(floor): 스크램블 후 최종 막대기가 이 수 미만이면 서버 RNG로 추가해 채운다(spacing 규칙 준수).
const LADDER_MIN_TOTAL_RUNGS = 12;
// 균등 생성용 세로 밴드 수 — y범위[Y_MIN,Y_MAX]를 이 개수로 등분(상/중/하).
const LADDER_GEN_BANDS = 3;

// 연속 좌표 사다리 — 막대기는 두 인접 기둥(c, c+1)을 높이 y(0~1)에서 잇는다. 격자 없음.
const LADDER_MIN_GAP_Y = 0.09;      // 같은 기둥을 공유하는 막대기 간 최소 세로 간격(비율)
const LADDER_CONTACT_EPS = LADDER_MIN_GAP_Y - 1e-4;   // 같은 슬롯만 충돌, 인접 슬롯(0.09)은 허용
const LADDER_Y_MIN = 0.05;          // 막대기 높이 하한
const LADDER_Y_MAX = 0.95;          // 막대기 높이 상한
const LADDER_SLOT_ROWS = 11;        // 0.05~0.95를 0.09 간격으로 → 11줄
function snapToSlotY(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    const r = Math.max(0, Math.min(LADDER_SLOT_ROWS - 1, Math.round((y - LADDER_Y_MIN) / span * (LADDER_SLOT_ROWS - 1))));
    return LADDER_Y_MIN + span * r / (LADDER_SLOT_ROWS - 1);
}
// ─── 순차 하강(reveal) 연출 타이밍 — js/ladder.js 와 반드시 동기화 ───
// 시작 시퀀스: 인지창(전체 막대기 동시 표시) → 사라짐(겹침 dedup + 스크램블 erase) → 서버 그리기(balance add)
//   → 카운트다운 3·2·1 → 리빙럼 하강(매 스텝 변형) → 착지 공개.
const LADDER_RECOGNITION_MS = 3000;   // 인지창 — 전체 막대기 동시 표시(누가 뭘 그렸는지 인지). 신규 단계.
const LADDER_COUNTDOWN_MS = 3200;     // "3·2·1 시작!" 카운트다운 (1600×2)
const LADDER_ERASE_MS = 2400;         // 사라짐 연출(클라 ladderRunErase) — "사다리 사라집니다". js/ladder.js와 byte-identical.
const LADDER_DRAW_MS = 1800;          // 서버 그리기 연출(클라 ladderRunDraw, balance add). js/ladder.js와 byte-identical.
const LADDER_TOKEN_SLOT_MS = 6000;    // 토큰 한 칸이 끝까지 내려가는 시간(아주 천천히) (3000×2)
const LADDER_FINAL_HOLD = 1800;       // 결과 캡션 유지(ms) — 모션 아님
const LADDER_MUTATION_MS = 1400;      // 변형 1단계(add/remove/none) 애니 시간 — 솔로 토큰 사이 max(0,N-2)회

// reveal 시작부터 자동 종료(결과 오버레이)까지 — 순차 하강 + 토큰 사이 변형이라 토큰 수(N=칸 수=LADDER_COLUMNS)에 비례.
// 시퀀스: 인지창 → 사라짐(erase) → 서버 그리기(draw) → 카운트다운 → [토큰0 하강 → 변형0 → … → 토큰N-3 하강 → 변형N-3 → (토큰N-2·N-1 동시 하강)] → 결과 캡션 유지.
//   descentSlots = (N<=1 ? N : N-1) — 마지막 둘이 한 슬롯 공유. mutations = max(0, N-2) — 토큰 사이 변형은 솔로 N-2개.
// 단계 합이 같아야 서버 endGame이 클라 연출 도중에 끼어들지 않는다(서버↔클라 타이밍 동기 불변). N = 상단 칸(하강 토큰) 수.
// ⚠ js/ladder.js의 클라 단계 합과 byte-identical(인지창 포함).
function ladderRevealDelay(N) {
    const n = Math.max(1, N | 0);
    const descentSlots = (n <= 1) ? n : (n - 1);     // 마지막 둘이 한 슬롯 공유
    const mutations = Math.max(0, n - 2);            // 변형은 솔로 토큰 사이 max(0,N-2)개
    const descent = descentSlots * LADDER_TOKEN_SLOT_MS;
    const scramble = LADDER_ERASE_MS + LADDER_DRAW_MS;          // 사라짐 + 서버 그리기
    return LADDER_RECOGNITION_MS + scramble + LADDER_COUNTDOWN_MS + descent + mutations * LADDER_MUTATION_MS + LADDER_FINAL_HOLD;
}

const LADDER_SLANT_MAX = 1;         // rung 기울기(slant) 절대값 상한 (js/ladder.js와 동기 — 시각 효과)
const LADDER_CURVE_MAX_POINTS = 24; // 곡선 막대기 점 개수 상한 (신뢰경계 — 페이로드 폭주 방지)
const LADDER_CURVE_RAW_MAX = 256;   // 클라가 보낸 원시 점 허용 상한(이 초과는 비정상 → 직선 폴백)
const LADDER_CURVE_MAX_VTRAVEL = 8.0;   // 곡선 누적 세로 이동(Σ|Δy|) 상한 — 결과 무관(접점만 결과). js/ladder.js와 동기.

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// 곡선 점 배열 정규화 (신뢰경계 — 클라 입력). 시각 장식일 뿐 결과에 영향 없음.
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

// 곡선의 누적 세로 이동(Σ|Δy|)이 상한을 넘으면 안쪽 점만 두 끝을 잇는 직선(코드) 쪽으로 축소 → 세로 path 길이 제한.
// 양 끝점(노드 연결)은 고정 → 접점 불변 → 결과 불변. 안쪽 점만 줄이는 연출 속도/가독 목적의 시각 제약.
function clampCurveVTravel(pts) {
    const n = pts.length;
    if (n < 3) return pts;
    let vtravel = 0;
    for (let i = 1; i < n; i++) vtravel += Math.abs(pts[i].y - pts[i - 1].y);
    if (vtravel <= LADDER_CURVE_MAX_VTRAVEL) return pts;
    const k = LADDER_CURVE_MAX_VTRAVEL / vtravel;
    const y0 = pts[0].y, y1 = pts[n - 1].y;
    return pts.map((p, i) => {
        if (i === 0 || i === n - 1) return { x: p.x, y: p.y };   // 끝점(노드 연결) 고정
        const chord = y0 + (y1 - y0) * (i / (n - 1));            // 두 끝을 잇는 직선의 같은 위치 높이
        return { x: p.x, y: clamp01(chord + (p.y - chord) * k) };
    });
}

// base/자동 막대기 points — 두 노드 직선(대각선 가능). leftY=왼쪽 기둥 접점, rightY=오른쪽 기둥 접점.
function serverCurvePoints(leftY, rightY) {
    return sanitizeCurvePoints([{ x: 0, y: leftY }, { x: 1, y: rightY }]);   // 2점 직선(끝점 x=0/1)
}

// 상단 칸 → 바닥 칸 매핑 (physical descent — 막대기 접점 leftY/rightY로 추적). slant/곡선 가운데는 무관(접점만 결과).
function computeLaneToBottom(N, rungs) {
    const map = new Array(N);
    for (let start = 0; start < N; start++) map[start] = descendOne(N, rungs || [], start);
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

// ─── physical descent — 막대기 접점(contact) 도출 + 하강 추적 ───
function rungLeftY(rg)  { return (rg && rg.points && rg.points.length >= 2) ? rg.points[0].y                  : (rg ? rg.y : 0); }
function rungRightY(rg) { return (rg && rg.points && rg.points.length >= 2) ? rg.points[rg.points.length - 1].y : (rg ? rg.y : 0); }

// 한 기둥(P)의 접점 집합 — c==P 막대기의 leftY ∪ c==P-1 막대기의 rightY.
function contactsOnPole(rungs, P) {
    const out = [];
    (rungs || []).forEach(rg => { if (!rg) return; if (rg.c === P) out.push(rungLeftY(rg)); else if (rg.c === P - 1) out.push(rungRightY(rg)); });
    return out;
}
// (c, leftY, rightY)에 막대기를 놓으면 두 공유 기둥(c, c+1)에서 같은 슬롯 접점과 충돌하는가.
function contactConflict(rungs, c, leftY, rightY) {
    return contactsOnPole(rungs, c).some(v => Math.abs(v - leftY) < LADDER_CONTACT_EPS)
        || contactsOnPole(rungs, c + 1).some(v => Math.abs(v - rightY) < LADDER_CONTACT_EPS);
}

// ─── 겹침 판정 헬퍼 (resolveContacts / dedup 공통) ───
function nearestSlotIndex(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    return Math.max(0, Math.min(LADDER_SLOT_ROWS - 1, Math.round((y - LADDER_Y_MIN) / span * (LADDER_SLOT_ROWS - 1))));
}
function slotYFromIndex(slot) {
    return LADDER_Y_MIN + (LADDER_Y_MAX - LADDER_Y_MIN) * slot / (LADDER_SLOT_ROWS - 1);
}
// slot이 점유됐을 때 가장 가까운 빈 슬롯 — d=1,2,…로 아래(slot+d) 먼저, 그다음 위(slot-d). 없으면 -1.
function nearestFreeSlot(slot, used) {
    for (let d = 1; d < LADDER_SLOT_ROWS; d++) {
        const down = slot + d;
        if (down <= LADDER_SLOT_ROWS - 1 && !used.has(down)) return down;
        const up = slot - d;
        if (up >= 0 && !used.has(up)) return up;
    }
    return -1;
}

// ── 겹침 dedup(하드룰) — 같은 슬롯/접점에 두 사람이 그렸으면 둘 중 하나를 server RNG로 제거 ──
// 사라짐(disappear) 단계 정책: 같은 슬롯 contact 쌍은 "비켜놓기"가 아니라 반드시 하나 제거(goal §6).
// 기둥 P=0..N-1마다 P에 닿는 접점을 슬롯 인덱스로 묶어, 같은 슬롯에 2개 이상이면 그중 1개(서버 RNG)만 생존, 나머지는 droppedIds.
// 반환: 제거할 막대기 id 집합(Set). 이후 union에서 filter.
function dedupOverlaps(rungs, N, rng) {
    rng = rng || Math.random;
    const dropped = new Set();
    for (let P = 0; P < N; P++) {
        // 이 기둥에 닿는 막대기들을 슬롯 인덱스별로 버킷.
        const buckets = {};   // slotIdx -> [rungId, ...]
        (rungs || []).forEach(rg => {
            if (!rg || dropped.has(rg.id)) return;
            if (!Array.isArray(rg.points) || rg.points.length < 2) return;
            let contact = null;
            if (rg.c === P)          contact = rungLeftY(rg);
            else if (rg.c === P - 1) contact = rungRightY(rg);
            else return;
            const slot = nearestSlotIndex(contact);
            (buckets[slot] = buckets[slot] || []).push(rg.id);
        });
        Object.keys(buckets).forEach(slot => {
            const ids = buckets[slot];
            if (ids.length < 2) return;
            // server RNG로 생존자 1개 선택, 나머지 제거.
            const survivor = ids[Math.floor(rng() * ids.length)];
            ids.forEach(id => { if (id !== survivor) dropped.add(id); });
        });
    }
    return dropped;
}

// 남은(중복 제거 후) 막대기를 결정적으로 비켜놓아 physical descent가 항상 1:1(전단사)이 되게 한다.
// dedup이 같은 슬롯 충돌을 제거하므로 남은 충돌은 부동소수 경계뿐 → endpoint를 distinct 슬롯에 재배정.
function resolveContacts(rungs, N) {
    const dropped = new Set();
    for (let P = 0; P < N; P++) {
        const touchers = [];   // { rg, end:'L'|'R', contact }
        (rungs || []).forEach(rg => {
            if (!rg || dropped.has(rg.id)) return;
            if (!Array.isArray(rg.points) || rg.points.length < 2) return;
            if (rg.c === P)          touchers.push({ rg, end: 'L', contact: rungLeftY(rg) });
            else if (rg.c === P - 1) touchers.push({ rg, end: 'R', contact: rungRightY(rg) });
        });
        touchers.sort((a, b) => (a.contact - b.contact) || (a.rg.id - b.rg.id));
        const used = new Set();
        for (const t of touchers) {
            let slot = nearestSlotIndex(t.contact);
            if (used.has(slot)) slot = nearestFreeSlot(slot, used);
            if (slot === -1) { dropped.add(t.rg.id); continue; }   // 기둥 가득(>11 접점) → 드롭
            used.add(slot);
            const slotY = slotYFromIndex(slot);
            if (t.end === 'L') t.rg.points[0] = { x: 0, y: slotY };
            else t.rg.points[t.rg.points.length - 1] = { x: 1, y: slotY };
        }
    }
    return dropped;
}

// 한 시작 칸(start)에서 물리적 하강 — 토큰은 기둥을 따라 아래로만, 막대기를 건널 때만 y 갱신.
function descendOne(N, rungs, start) {
    let col = start, y = -Infinity;
    const maxIter = (rungs ? rungs.length : 0) * 2 + N + 4;
    for (let iter = 0; iter < maxIter; iter++) {
        let best = null;
        for (let i = 0; i < (rungs ? rungs.length : 0); i++) {
            const rg = rungs[i];
            if (!rg) continue;
            let contact, toCol, newY;
            if (rg.c === col)          { contact = rungLeftY(rg);  toCol = col + 1; newY = rungRightY(rg); }
            else if (rg.c === col - 1) { contact = rungRightY(rg); toCol = col - 1; newY = rungLeftY(rg); }
            else continue;
            if (contact > y && (best === null || contact < best.contact)) best = { contact, toCol, newY };
        }
        if (best === null) return col;
        col = best.toCol; y = best.newY;
    }
    return col;   // iteration 캡 — 방어적 종료(정상 입력에선 도달 불가)
}

// ─── 균등(편향 없는) 배치 헬퍼 (서버 전용) ───
function bandOf(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    const f = span > 0 ? (y - LADDER_Y_MIN) / span : 0;
    return Math.max(0, Math.min(LADDER_GEN_BANDS - 1, Math.floor(f * LADDER_GEN_BANDS)));
}
function columnCounts(rungs, N) {
    const counts = new Array(N - 1).fill(0);
    (rungs || []).forEach(rg => { if (rg && rg.c >= 0 && rg.c < N - 1) counts[rg.c]++; });
    return counts;
}
function pickLeastLoadedColumn(counts, rng) {
    let min = Infinity;
    counts.forEach(c => { if (c < min) min = c; });
    const cands = [];
    counts.forEach((c, i) => { if (c === min) cands.push(i); });
    return cands[Math.floor(rng() * cands.length)];
}
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
 * id는 단조 카운터(nextId)로 부여 — Math.random/timestamp 금지(결정성·공정성).
 */
function generateBaseRungs(N, nextId) {
    const baseRungs = [];
    const randSlotY = () => snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
    const randRungPair = () => {
        const leftY = randSlotY();
        if (Math.random() < LADDER_HORIZONTAL_RATIO) return { leftY, rightY: leftY };   // 수평
        let rightY = randSlotY();
        for (let k = 0; k < 8 && rightY === leftY; k++) rightY = randSlotY();
        return { leftY, rightY };   // 대각선
    };
    const pushRung = (c, leftY, rightY) => baseRungs.push({
        id: nextId(), c,
        y: snapToSlotY((leftY + rightY) / 2),
        slant: clampSlant((rightY - leftY) / 0.4),
        points: serverCurvePoints(leftY, rightY)
    });

    // 1) 모든 칸(c=0..N-2)에 최소 1개씩 보장 — 빈 칸 없이 사다리가 꽉 차 보이게.
    for (let c = 0; c < N - 1; c++) {
        for (let a = 0; a < 60; a++) {
            const { leftY, rightY } = randRungPair();
            if (contactConflict(baseRungs, c, leftY, rightY)) continue;
            pushRung(c, leftY, rightY);
            break;
        }
    }
    // 2) 다양성용 추가 막대기 — 0~RAND개를 "가장 적은 칸"에 얹는다(과밀 방지).
    const extra = Math.floor(Math.random() * (LADDER_BASE_RUNG_RAND + 1));
    let placed = 0, attempts = 0;
    while (placed < extra && attempts < extra * 80) {
        attempts++;
        const c = pickLeastLoadedColumn(columnCounts(baseRungs, N), Math.random);
        const { leftY, rightY } = randRungPair();
        if (contactConflict(baseRungs, c, leftY, rightY)) continue;
        pushRung(c, leftY, rightY);
        placed++;
    }
    return baseRungs;
}

/**
 * 스크램블 사다리 구조 생성 (서버 전용) — 연속 좌표.
 * 1) union = base + user(flatten), 2) 겹침 dedup(같은 슬롯 쌍 하나 제거, 하드룰), 3) K개 erase, 4) M개 add(서버 RNG),
 * 5) final = remaining + added 를 y 오름차순 정렬, 5-b) resolveContacts(전단사 보장).
 * @returns {{ rungs, erased, added, droppedOverlap, laneToBottom }}
 *   droppedOverlap = dedup으로 제거된 막대기 배열(클라 사라짐 연출에 erased와 함께 포함).
 */
function buildLadder(N, baseRungs, userRungsMap, nextId, pickedTops) {
    nextId = nextId || (() => 0);

    // 1) union 구성 + 방어적 재검증. 유저 막대기를 먼저 넣어 우선권을 준다.
    //    pickedTops가 주어지면(Set), 선택된 top을 그린 사람의 막대기만 결과에 영향 — 단, 막대기 위치는 칸 무관이라
    //    모든 유저 막대기를 보드에 포함한다(시각/공유). routing 판정은 picked top만 본다(landings 계산 측).
    const union = [];
    Object.keys(userRungsMap || {}).forEach(owner => {
        const arr = Array.isArray(userRungsMap[owner]) ? userRungsMap[owner] : [];
        arr.forEach(rg => {
            if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
            const yy = clampY(rg.y);
            if (yy === null) return;
            union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: rg.points || null, user: true, owner });
        });
    });
    (baseRungs || []).forEach(rg => {
        if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
        const yy = clampY(rg.y);
        if (yy === null) return;
        union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: rg.points || null, user: false, owner: null });
    });

    // 1-b) 겹침 dedup(하드룰) — 같은 슬롯/접점에 둘이 그렸으면 server RNG로 하나 제거(goal §6).
    let droppedOverlap = [];
    const overlapDropped = dedupOverlaps(union, N, Math.random);
    let working = union;
    if (overlapDropped.size) {
        droppedOverlap = union.filter(r => overlapDropped.has(r.id));
        working = union.filter(r => !overlapDropped.has(r.id));
    }

    // 2) erase: K = ERASE_MIN..ERASE_MAX (서버 RNG). 사다리가 비지 않게 working.length-2까지로 클램프.
    let K = LADDER_SCRAMBLE_ERASE_MIN + Math.floor(Math.random() * (LADDER_SCRAMBLE_ERASE_MAX - LADDER_SCRAMBLE_ERASE_MIN + 1));
    K = Math.min(K, Math.max(0, working.length - 2));
    const eraseIdxSet = new Set();
    const colIdx = {};
    working.forEach((rg, i) => { (colIdx[rg.c] = colIdx[rg.c] || []).push(i); });
    for (let picked = 0; picked < K; picked++) {
        let maxRemain = -1;
        Object.keys(colIdx).forEach(c => {
            const remainInCol = colIdx[c].filter(i => !eraseIdxSet.has(i)).length;
            if (remainInCol >= 2 && remainInCol > maxRemain) maxRemain = remainInCol;
        });
        if (maxRemain < 0) break;   // 모든 칸이 1개 이하 — 더 지우면 칸이 비므로 중단(균형 보존)
        const cands = Object.keys(colIdx).filter(c =>
            colIdx[c].filter(i => !eraseIdxSet.has(i)).length === maxRemain);
        const col = cands[Math.floor(Math.random() * cands.length)];
        const remainIdx = colIdx[col].filter(i => !eraseIdxSet.has(i));
        eraseIdxSet.add(remainIdx[Math.floor(Math.random() * remainIdx.length)]);
    }
    let erased = [];
    const remaining = [];
    working.forEach((rg, i) => { (eraseIdxSet.has(i) ? erased : remaining).push(rg); });

    // 3) add: M = ADD_MIN..ADD_MAX (서버 RNG). remaining + 이미 add된 것과 spacing 안 겹치게 배치.
    const M = LADDER_SCRAMBLE_ADD_MIN + Math.floor(Math.random() * (LADDER_SCRAMBLE_ADD_MAX - LADDER_SCRAMBLE_ADD_MIN + 1));
    let added = [];
    function tryAddOne() {
        const current = remaining.concat(added);
        const c = pickLeastLoadedColumn(columnCounts(current, N), Math.random);
        const leftY = snapToSlotY(pickYInLeastLoadedBand(current, c, Math.random));
        let rightY = leftY;
        if (Math.random() >= LADDER_HORIZONTAL_RATIO) {   // 대각선: 다른 슬롯에서 rightY 재추첨
            rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
            for (let k = 0; k < 8 && rightY === leftY; k++) rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
        }
        if (contactConflict(remaining, c, leftY, rightY) || contactConflict(added, c, leftY, rightY)) return false;
        added.push({ id: nextId(), c, y: snapToSlotY((leftY + rightY) / 2), slant: clampSlant((rightY - leftY) / 0.4), points: serverCurvePoints(leftY, rightY), user: false, owner: null });
        return true;
    }
    let placed = 0, attempts = 0;
    while (placed < M && attempts < M * 80) {
        attempts++;
        if (tryAddOne()) placed++;
    }

    // 3-b) 밀도 보충: 스크램블 후 총 막대기가 floor 미만이면 floor까지 채운다(작은 방 시각 목적).
    const floor = Math.min(LADDER_MIN_TOTAL_RUNGS, (N - 1) * 3);
    let fillAttempts = 0;
    while (remaining.length + added.length < floor && fillAttempts < floor * 120) {
        fillAttempts++;
        tryAddOne();
    }

    // 4) final = remaining + added, y 오름차순 정렬 (위→아래)
    let rungs = remaining.concat(added).sort((a, b) => a.y - b.y);

    // 4-b) 접점 해소 — 남은 충돌(부동소수 경계)을 결정적으로 비켜놓아 physical descent가 항상 1:1(전단사).
    const droppedIds = resolveContacts(rungs, N);
    if (droppedIds.size) {
        rungs = rungs.filter(r => !droppedIds.has(r.id));
        added = added.filter(r => !droppedIds.has(r.id));
        erased = erased.filter(r => !droppedIds.has(r.id));
    }

    // 5) 각 상단 칸 → 바닥 슬롯 추적
    const laneToBottom = computeLaneToBottom(N, rungs);

    return { rungs, erased, added, droppedOverlap, laneToBottom };
}

// ─── living-rungs 변형 후보 생성 (서버 전용 RNG) ───
function buildAddCandidate(N, L, nextId) {
    const current = L;
    const c = pickLeastLoadedColumn(columnCounts(current, N), Math.random);
    const leftY = snapToSlotY(pickYInLeastLoadedBand(current, c, Math.random));
    let rightY = leftY;
    if (Math.random() >= LADDER_HORIZONTAL_RATIO) {
        rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
        for (let k = 0; k < 8 && rightY === leftY; k++) rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
    }
    if (contactConflict(current, c, leftY, rightY)) return null;
    const rung = { id: nextId(), c, y: snapToSlotY((leftY + rightY) / 2), slant: clampSlant((rightY - leftY) / 0.4), points: serverCurvePoints(leftY, rightY), user: false, owner: null };
    return { type: 'add', rung, L: current.concat([rung]).sort((a, b) => a.y - b.y) };
}
function buildRemoveCandidate(N, L) {
    if (!L || L.length === 0) return null;
    const floor = Math.min(LADDER_MIN_TOTAL_RUNGS, (N - 1) * 3);
    if (L.length <= floor) return null;
    const counts = columnCounts(L, N);
    const removable = L.filter(rg => rg && rg.c >= 0 && rg.c < N - 1 && counts[rg.c] >= 2);
    if (removable.length === 0) return null;
    const victim = removable[Math.floor(Math.random() * removable.length)];
    return { type: 'remove', rungId: victim.id, L: L.filter(rg => rg.id !== victim.id) };
}

// 한 보드에 막대기 1개를 더하거나(add) base 막대기 1개를 빼서(remove) 만들 수 있는 *전단사 보존* 후보 열거.
//   add: col 0..N-2 × row × {수평,±1 대각선}. remove: user 아닌(base/balance) 막대기만(유저 막대기 시각 보존).
//   각 후보는 { L, rung?(add), removeId?(remove), dist=|착지-winSlot| }. add/remove 둘 다라 도달 가능 순열이 넓다.
function enumerateRouteMoves(N, work, targetTop, winSlot, nextId) {
    const out = [];
    // add 후보
    for (let col = 0; col <= N - 2; col++) {
        for (let r = 0; r < LADDER_SLOT_ROWS; r++) {
            const leftY = slotYFromIndex(r);
            for (let dy = -1; dy <= 1; dy++) {
                const rj = r + dy;
                if (rj < 0 || rj >= LADDER_SLOT_ROWS) continue;
                const rightY = slotYFromIndex(rj);
                if (contactConflict(work, col, leftY, rightY)) continue;
                const rung = { id: nextId(), c: col, y: snapToSlotY((leftY + rightY) / 2), slant: clampSlant((rightY - leftY) / 0.4), points: serverCurvePoints(leftY, rightY), user: false, owner: null };
                const cand = work.concat([rung]).sort((a, b) => a.y - b.y);
                const m = computeLaneToBottom(N, cand);
                if (!isBijection(m)) continue;
                out.push({ L: cand, rung, dist: Math.abs(m[targetTop] - winSlot) });
            }
        }
    }
    // remove 후보 — user 막대기는 보존(시각/공정), base/balance(user!==true)만 제거 대상.
    for (let i = 0; i < work.length; i++) {
        const rg = work[i];
        if (!rg || rg.user) continue;
        const cand = work.filter((_, j) => j !== i);
        const m = computeLaneToBottom(N, cand);
        if (!isBijection(m)) continue;
        out.push({ L: cand, removeId: rg.id, dist: Math.abs(m[targetTop] - winSlot) });
    }
    return out;
}

// ── winSlot에 routing되는 top을 targetTop으로 만들기 (zero-loser guarantee) ──
// 현재 보드 L에 막대기를 추가해 targetTop이 winSlot으로 내려가게 한다(자연 보드가 0-loser일 때만 호출).
// ① 결정적 best-first 탐색 — 보드에 막대기를 1개씩 더하며 |착지-winSlot| 을 줄인다(전단사 보존, plateau 허용·permutation tabu로 사이클 차단).
// ② ①이 막히면(드묾) 무작위 add 탐색 폴백.
//   결과는 전적으로 서버 권위. 둘 다 실패(거의 불가) 시 null → 호출부 group-random 안전망(단일 소스 유지).
function forceRouteToWin(N, L, targetTop, winSlot, nextId) {
    let map = computeLaneToBottom(N, L);
    if (map[targetTop] === winSlot && isBijection(map)) return { L: L.slice(), added: [] };

    // ① 결정적 best-first — 상태=보드(+added 경로). 우선순위=현재 dist. permutation 방문 tabu로 사이클 방지.
    {
        const start = { L: L.slice(), added: [], dist: Math.abs(map[targetTop] - winSlot), steps: 0 };
        const frontier = [start];
        const seen = new Set([computeLaneToBottom(N, L).join(',')]);
        const MAX_EXPAND = 6000;    // 확장 노드 상한(결정적·유한)
        let expanded = 0;
        while (frontier.length && expanded < MAX_EXPAND) {
            // best-first — dist 최소(동률이면 경로 짧은) 노드 확장. uphill 허용(permutation tabu가 사이클 차단).
            frontier.sort((a, b) => a.dist - b.dist || a.added.length - b.added.length);
            const node = frontier.shift();
            expanded++;
            const moves = enumerateRouteMoves(N, node.L, targetTop, winSlot, nextId);
            moves.sort((a, b) => a.dist - b.dist);
            for (const mv of moves) {
                const key = computeLaneToBottom(N, mv.L).join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                // add면 added에 누적(화면 그리기 연출), remove면 보드만 줄임(client는 initialRungs로만 렌더 → 무영향).
                const nextAdded = mv.rung ? node.added.concat([mv.rung]) : node.added;
                const next = { L: mv.L, added: nextAdded, dist: mv.dist, steps: node.steps + 1 };
                if (next.dist === 0) {
                    return { L: next.L.sort((a, b) => a.y - b.y), added: next.added };
                }
                if (next.steps <= N + 6) frontier.push(next);   // 경로 길이 가드(유한)
                if (frontier.length > 2000) { frontier.sort((a, b) => a.dist - b.dist); frontier.length = 2000; }
            }
        }
    }

    // ②' 결정적 바닥 하이웨이(보장) — best-first가 못 풀면 *항상 성공*하는 구성.
    //   바닥 2행을 라우팅 전용으로 비우고(기존 막대기를 상단 9행으로 압축 재배치), 그 위에서 인접 전치만으로
    //   targetTop 착지를 winSlot까지 버블한다. 바닥 행 막대기는 descend가 *마지막에* 건너므로(가장 큰 y)
    //   상단 routing을 안 건드리고 landing permutation에만 작용 → 임의 목표 routing 결정적 달성.
    {
        const RESERVED = 6;                              // 바닥 예약 행 수(라우팅 전용) — 최대 N-1개 인접전치 수용
        const topRows = LADDER_SLOT_ROWS - RESERVED;     // 상단 압축 가용 행(0..topRows-1)
        // (1) 기존 막대기를 상단(0..topRows-1)으로 압축 재배치 — 각 막대기의 접점을 가장 가까운 빈 상단 슬롯으로.
        //     col별로 used 슬롯 추적해 충돌 없이 재배치. 재배치 실패분은 드롭(드묾).
        const compressed = [];
        const usedByPole = {};                           // pole P -> Set(slotRow)
        const claimSlot = (P, want) => {
            const used = usedByPole[P] || (usedByPole[P] = new Set());
            if (want < topRows && !used.has(want)) { used.add(want); return want; }
            for (let d = 1; d < topRows; d++) {
                const up = want - d, down = want + d;
                if (up >= 0 && up < topRows && !used.has(up)) { used.add(up); return up; }
                if (down >= 0 && down < topRows && !used.has(down)) { used.add(down); return down; }
            }
            return -1;
        };
        // y 오름차순(위→아래) 순으로 재배치해 원래 순서 최대한 보존.
        const sortedSrc = L.slice().sort((a, b) => a.y - b.y);
        for (const rg of sortedSrc) {
            const lSlot = claimSlot(rg.c, nearestSlotIndex(rungLeftY(rg)));
            const rSlot = claimSlot(rg.c + 1, nearestSlotIndex(rungRightY(rg)));
            if (lSlot < 0 || rSlot < 0) continue;        // 자리 없음 — 드롭(상단 9행이면 거의 없음)
            const ly = slotYFromIndex(lSlot), ry = slotYFromIndex(rSlot);
            compressed.push({ id: rg.id, c: rg.c, y: snapToSlotY((ly + ry) / 2), slant: clampSlant((ry - ly) / 0.4), points: serverCurvePoints(ly, ry), user: !!rg.user, owner: rg.owner || null });
        }
        let work = compressed.slice().sort((a, b) => a.y - b.y);
        const droppedForCompress = L.filter(rg => !compressed.some(c => c.id === rg.id));
        const added = [];
        // 압축 후 전단사 확인 — 깨졌으면 이 경로 포기(아래 random 폴백).
        if (isBijection(computeLaneToBottom(N, work))) {
            // (2) 바닥 예약 행(topRows..SLOT_ROWS-1)에서 인접 전치로 targetTop → winSlot 버블.
            let cur = computeLaneToBottom(N, work)[targetTop];
            let row = topRows;                           // 첫 스왑은 가장 위 예약행, 이후 아래로
            let ok = true;
            let safety = 0;
            while (cur !== winSlot && safety++ < N * 2) {
                const col = (cur < winSlot) ? cur : cur - 1;   // cur↔cur±1 전치
                const yy = slotYFromIndex(Math.min(LADDER_SLOT_ROWS - 1, row));
                const rung = { id: nextId(), c: col, y: yy, slant: 0, points: serverCurvePoints(yy, yy), user: false, owner: null };
                const cand = work.concat([rung]).sort((a, b) => a.y - b.y);
                const m = computeLaneToBottom(N, cand);
                // 예약행 위치라 마지막 crossing → 정확히 col↔col+1 전치여야 한다. 아니면 이 경로 포기.
                let cleanSwap = isBijection(m);
                if (cleanSwap) {
                    const before = computeLaneToBottom(N, work);
                    for (let s = 0; s < N && cleanSwap; s++) {
                        const expect = (before[s] === col) ? col + 1 : (before[s] === col + 1) ? col : before[s];
                        if (m[s] !== expect) cleanSwap = false;
                    }
                }
                if (!cleanSwap) { ok = false; break; }
                work = cand; added.push(rung); cur = m[targetTop];
                row = Math.min(LADDER_SLOT_ROWS - 1, row + 1);
            }
            if (ok && cur === winSlot && isBijection(computeLaneToBottom(N, work))) {
                // 압축으로 드롭된 막대기는 client가 어차피 initialRungs(=이 work)로만 렌더 → 무영향.
                void droppedForCompress;
                return { L: work.sort((a, b) => a.y - b.y), added };
            }
        }
    }

    // ② 무작위 add 탐색 폴백 — buildAddCandidate(전단사 보존 후보만 채택).
    const TRIES = 4000;
    for (let t = 0; t < TRIES; t++) {
        let work = L.slice();
        const added = [];
        const adds = 1 + Math.floor(Math.random() * 8);   // 1..8개
        for (let a = 0; a < adds; a++) {
            const cand = buildAddCandidate(N, work, nextId);
            if (!cand) break;
            work = cand.L;
            added.push(cand.rung);
            const m = computeLaneToBottom(N, work);
            if (m[targetTop] === winSlot && isBijection(m)) {
                return { L: work.sort((a, b) => a.y - b.y), added };
            }
        }
    }
    return null;   // 도달 실패(거의 불가) → 호출부 group-random 안전망이 처리.
}
function isBijection(map) {
    const seen = new Set();
    for (let i = 0; i < map.length; i++) { if (seen.has(map[i])) return false; seen.add(map[i]); }
    return true;
}

// ── living-rungs 변형 시뮬레이션 (서버 전용) ──
// 시작 보드 startBoard 위에서 토큰 사이 변형(add/remove/none) 스크립트를 생성하고 최종 착지(landings)를 계산.
// 클라는 initialRungs + mutationScript 를 replay해 정확히 landings에 도달한다(서버↔클라 lockstep, byte-identical).
// routeGuard = { targetTop, winSlot } 가 주어지면, 모든 변형 후보는 targetTop→winSlot routing을 *보존*해야 채택.
//   (시작 보드가 이미 targetTop→winSlot이면, none/보존 후보만 받으므로 최종 landings도 targetTop→winSlot 보장 →
//    "발표 loser ≡ landings winSlot 착지" 단일 소스 불변식이 변형 후에도 깨지지 않는다.)
// 반환: { initialRungs, script(len max(0,N-2)), work(최종 보드), landings(len N) }.
function simulateMutation(N, startBoard, nextId, routeGuard) {
    const guardTop = routeGuard ? routeGuard.targetTop : -1;
    const guardSlot = routeGuard ? routeGuard.winSlot : -1;
    const preservesRoute = (boardL) => guardTop < 0 || descendOne(N, boardL, guardTop) === guardSlot;
    const initialRungs = startBoard.slice();
    let work = initialRungs.slice();
    const landings = new Array(N);
    const script = [];
    const ATTEMPT_CAP = 40;
    landings[0] = descendOne(N, work, 0);
    for (let i = 1; i <= N - 2; i++) {
        const baseRem = new Array(N);
        for (let j = i; j < N; j++) baseRem[j] = descendOne(N, work, j);
        let firstValid = null, impactful = null;
        for (let a = 0; a < ATTEMPT_CAP && !impactful; a++) {
            const tryAdd = (a % 2 === 0);
            const cand = tryAdd ? buildAddCandidate(N, work, nextId)
                                : buildRemoveCandidate(N, work);
            if (!cand) continue;
            let ok = true;
            for (let j = 0; j < i && ok; j++) {
                if (descendOne(N, cand.L, j) !== landings[j]) ok = false;
            }
            if (!ok) continue;
            if (!preservesRoute(cand.L)) continue;   // routeGuard — targetTop→winSlot 보존 후보만 채택
            if (!firstValid) firstValid = cand;
            let changesRemaining = false;
            for (let j = i; j < N && !changesRemaining; j++) {
                if (descendOne(N, cand.L, j) !== baseRem[j]) changesRemaining = true;
            }
            if (changesRemaining) impactful = cand;
        }
        const pick = impactful || firstValid;
        let chosen, nextL;
        if (pick) {
            chosen = (pick.type === 'add') ? { type: 'add', rung: pick.rung } : { type: 'remove', rungId: pick.rungId };
            nextL = pick.L;
        } else { chosen = { type: 'none' }; nextL = work; }
        work = nextL;
        script[i - 1] = chosen;
        landings[i] = descendOne(N, work, i);
    }
    if (N >= 2) landings[N - 1] = descendOne(N, work, N - 1);

    // 안전망: 변형 후 landings 전단사 위반 시 none 폴백(초기 보드는 항상 전단사).
    if (!isBijection(landings)) {
        console.warn('[사다리타기] 변형 후 landings 비전단사 — none 폴백');
        for (let i = 0; i < script.length; i++) script[i] = { type: 'none' };
        work = initialRungs.slice();
        for (let i = 0; i < N; i++) landings[i] = descendOne(N, work, i);
    }
    return { initialRungs, script, work, landings };
}

// winSlot 지정 (서버 RNG) — 0..N-1. 시작부터 모두에게 공개(위치만). routing은 reveal에만.
function pickWinSlot(N) { return Math.floor(Math.random() * N); }

/**
 * 사다리타기 게임 이벤트 핸들러
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    function clearLadderTimers(ld) {
        if (ld.endTimeout) { clearTimeout(ld.endTimeout); ld.endTimeout = null; }
        if (ld.resetTimeout) { clearTimeout(ld.resetTimeout); ld.resetTimeout = null; }
    }

    // 준비하고 현재 방에 있는 사람 수 — 시작 게이트(≥2)에 사용. 토너먼트 sub-round에선 loserPool 기준.
    function readyCount(gameState) {
        return (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)).length;
    }

    // 라운드 참가자 — round 1은 준비한 전원, sub-round는 loserPool. 둘 다 현재 방에 있는 사람만.
    function roundParticipants(gameState) {
        const ld = gameState.ladder;
        const present = name => gameState.users.some(u => u.name === name);
        if (ld.tournamentActive && Array.isArray(ld.loserPool) && ld.loserPool.length) {
            return ld.loserPool.filter(present);
        }
        return (gameState.readyUsers || []).filter(present);
    }

    // drawer 색 인덱스 배정 (서버 권위, 결정적). Math.random 금지.
    function assignColorIndex(ld, name) {
        if (!ld.colorIndex) ld.colorIndex = {};
        if (ld.colorIndex[name] !== undefined) return;
        const used = new Set(Object.values(ld.colorIndex));
        let idx = 0;
        while (used.has(idx)) idx++;
        ld.colorIndex[name] = idx;
    }

    // 가시 base 막대기 + winSlot 생성 — 입장(phase idle) 시점에 1회만. 멱등(baseRungsGenerated 가드).
    // winSlot은 라운드마다 지정되며 빌드 시작부터 공개(위치만, routing은 server-only).
    function ensureBaseRungs(ld, N) {
        if (!ld || ld.phase !== 'idle' || ld.baseRungsGenerated) return;
        ld.baseRungs = generateBaseRungs(N, () => ld.rungSeq++);
        ld.baseRungsGenerated = true;
        if (typeof ld.winSlot !== 'number' || ld.winSlot < 0 || ld.winSlot >= N) ld.winSlot = pickWinSlot(N);
    }

    // 드로어당 public 막대기(남에게 보이는 1개)를 server RNG로 (재)선택 — 드로어 set 변경 시 호출.
    // publicRungByDrawer[name] = 그 드로어 막대기 중 1개의 id. 막대기 없으면 키 삭제.
    function repickPublicRung(ld, name) {
        if (!ld.publicRungByDrawer) ld.publicRungByDrawer = {};
        const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
        if (!arr.length) { delete ld.publicRungByDrawer[name]; return; }
        // 기존 public id가 여전히 유효하면 유지(불필요한 흔들림 방지) — 단, set이 바뀌어 사라졌으면 재선택.
        const cur = ld.publicRungByDrawer[name];
        if (cur != null && arr.some(r => r.id === cur)) return;
        ld.publicRungByDrawer[name] = arr[Math.floor(Math.random() * arr.length)].id;
    }

    // 유저 막대기(공개 set: 본인 전체 + 남은 드로어당 1개) + base + winSlot + userTops + colorIndex 를 브로드캐스트.
    // server-only(전체 hidden rung·landings·mutationScript·results·initialRungs·publicRungByDrawer·balance routing)는 미포함.
    // 본인 private full set은 io.to(socket.id) 개인 보충 emit으로 따로 보낸다(아래 emitPrivateRungs).
    function emitRungsUpdated(room, gameState) {
        const ld = gameState.ladder;
        if (!ld || ld.phase !== 'idle') return;   // 빌드 동기화는 idle에서만 — server-only 누출 단일 방어선
        const N = LADDER_COLUMNS;
        ensureBaseRungs(ld, N);
        // 드로어별 public 선택 정합화 + public set 구성(드로어당 1개).
        const publicRungs = [];
        Object.keys(ld.userRungs || {}).forEach(name => {
            repickPublicRung(ld, name);
            const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
            const pid = ld.publicRungByDrawer[name];
            const rg = arr.find(r => r.id === pid);
            if (rg) publicRungs.push({ id: rg.id, c: rg.c, y: rg.y, slant: rg.slant, points: rg.points || null, owner: name });
        });
        io.to(room.roomId).emit('ladder:rungsUpdated', {
            numColumns: N,
            winSlot: ld.winSlot,
            userTops: { ...ld.userTops },
            publicRungs: publicRungs,
            baseRungs: (ld.baseRungs || []).slice(),
            colorIndex: { ...ld.colorIndex },
            round: ld.round,
            tournamentActive: !!ld.tournamentActive,
            loserPool: ld.tournamentActive ? (ld.loserPool || []).slice() : [],
            maxRungs: LADDER_MAX_RUNGS_PER_USER
        });
        // 각 드로어에게 본인 막대기 전체(private full set)를 개인 보충 emit.
        emitAllPrivateRungs(room, gameState);
    }
    ctx.emitLadderRungsUpdated = emitRungsUpdated;

    // 드로어 본인에게 자기 막대기 전체를 개인 emit(public ∪ own 렌더용). 현재 방에 연결된 소켓만.
    function emitPrivateRungs(ld, name, socketId) {
        const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
        io.to(socketId).emit('ladder:myRungs', {
            owner: name,
            rungs: arr.map(r => ({ id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points || null }))
        });
    }
    function emitAllPrivateRungs(room, gameState) {
        const ld = gameState.ladder;
        (gameState.users || []).forEach(u => {
            if (!u || !u.id) return;
            emitPrivateRungs(ld, u.name, u.id);
        });
    }
    ctx.emitLadderPrivateRungs = function (room, gameState, name, socketId) {
        if (!gameState || !gameState.ladder) return;
        emitPrivateRungs(gameState.ladder, name, socketId);
    };

    // 시작 시퀀스 빌드 + reveal 브로드캐스트. landings·mutationScript·당첨 routing은 전적으로 서버가 결정.
    function runLadder(room, gameState) {
        const ld = gameState.ladder;
        const N = LADDER_COLUMNS;

        gameState.orderAutoTriggered = false;

        // 이번 라운드 참가자 + 그들의 top 선택. 미선택자는 라운드에서 제외(픽 게이트가 보장하지만 방어적).
        const participants = roundParticipants(gameState).filter(name =>
            typeof ld.userTops[name] === 'number' && ld.userTops[name] >= 0 && ld.userTops[name] < N);
        // picked tops 집합(여러 명이 같은 top 공유 가능 → 토큰 1개 공유).
        const pickedTops = new Set(participants.map(name => ld.userTops[name]));

        // ── 보드 빌드(자연 우선) ──
        const built = buildLadder(N, ld.baseRungs, ld.userRungs, () => ld.rungSeq++, pickedTops);
        let L = built.rungs.slice();
        let extraBalanceAdded = [];   // zero-loser guarantee 또는 shrink로 추가된 balance 막대기

        // ── 자연 보드 landings 계산 → winSlot에 떨어지는 top 판정 ──
        const winSlot = (typeof ld.winSlot === 'number') ? ld.winSlot : pickWinSlot(N);
        ld.winSlot = winSlot;

        // 토너먼트 shrink 보장: sub-round(loserPool 진행 중)는 풀을 반드시 줄여야 한다.
        const subRound = !!ld.tournamentActive;

        // ── 발표 패자 = 변형 후 landings 단일 소스(BLOCKER fix) ──
        // 핵심 불변식: "화면 착지(landings)" 와 "발표 loser" 가 항상 일치.
        // 따라서 loser pool은 mutation 시뮬이 끝나 landings가 확정된 *다음에만* 도출하고,
        // zero-loser guarantee(forceRouteToWin) 도 mutation을 거친 *시작 보드*에 적용해
        // mutation 후에도 winSlot routing이 보존되게 한다(자연 이름 폴백 제거 — 단일 소스).
        //
        // 절차: ① group-random으로 보장 target top 선정(picked tops 중) → 시작 보드 L 을 forceRouteToWin 으로
        //         그 target top이 winSlot에 routing되게 보정
        //      ② mutation 시뮬을 routeGuard(target→winSlot 보존) 와 함께 → 변형 후에도 target 착지 보존
        //      ③ landings에서 winSlot에 떨어지는 picked top 도출(target 포함 보장 → 비지 않음)
        //      ④ forceRouteToWin 실패(극히 드묾)면 guard 없이 시뮬 후 group-random 안전망(아래)으로 처리.
        let baseBoard = L.slice();                  // mutation 시뮬 시작 보드(forceRouteTo 보정 누적)
        let routeGuard = null;
        let startMap = computeLaneToBottom(N, baseBoard);
        // ① 보장 target — 이미 winSlot으로 가는 picked top이 있으면 그중 하나, 없으면 force로 새로 라우팅.
        let guaranteedTop = -1;
        const natWin = pickedTopsAtWin(startMap, pickedTops, winSlot);
        if (natWin.size > 0) {
            // 자연 보드가 이미 라우팅 — 그 중 group-random 하나를 guard target으로(불필요한 보정 없음).
            const arr = Array.from(natWin);
            guaranteedTop = arr[Math.floor(Math.random() * arr.length)];
        } else {
            const targetTop = chooseGuaranteeTop(participants, ld, pickedTops, subRound);
            const forced = forceRouteToWin(N, baseBoard, targetTop, winSlot, () => ld.rungSeq++);
            if (forced) {
                baseBoard = forced.L;
                extraBalanceAdded = extraBalanceAdded.concat(forced.added);
                guaranteedTop = targetTop;
            }
            // forced 실패 → guaranteedTop = -1 (guard 없음). 아래 group-random 안전망이 단일 소스 보존.
        }
        if (guaranteedTop >= 0) routeGuard = { targetTop: guaranteedTop, winSlot };

        // ② mutation 시뮬 — routeGuard로 target→winSlot 보존(변형 후에도 단일 소스 불변).
        const sim = simulateMutation(N, baseBoard, () => ld.rungSeq++, routeGuard);
        // ③ landings 단일 소스 판정 — guard가 있으면 target이 반드시 포함되어 비지 않는다.
        let finalLoserTops = pickedTopsAtWin(sim.landings, pickedTops, winSlot);

        const initialRungs = sim.initialRungs;
        const script = sim.script;
        const work = sim.work;
        const landings = sim.landings;

        // 최종 loser pool — 변형 후 landings에서 winSlot에 떨어지는 picked top에서만 도출(단일 소스).
        let finalLoserNames = participantsWithTopIn(participants, ld, finalLoserTops);

        // sub-round / zero-loser 보정·안전망은 모두 group-random(개인 1명 타게팅 금지, MAJOR fix).
        // picked top이 2개 이상이면 보정은 *top(그룹)* 단위로만. picked top이 1개뿐(전원 같은 칸,
        // degenerate)일 때만 종료성을 위해 randomProperSubset(개인 부분집합)이 불가피하므로 허용.
        const degenerate = pickedTops.size <= 1;   // 모든 참가자가 같은 top → top 단위로는 더 못 쪼갬

        // sub-round strict shrink — loser가 풀 전체면(줄지 않음) 풀을 한 단계 더 줄인다.
        if (subRound && finalLoserNames.length >= participants.length && participants.length > 1) {
            finalLoserNames = degenerate
                ? randomProperSubset(participants)                       // degenerate: 개인 부분집합(불가피)
                : shrinkByTop(participants, ld, finalLoserTops);         // 일반: top(그룹) 단위 축소
        }

        // 안전망: loser가 0명이면(forceRouteToWin 실패 — 극히 드묾) 단일 소스를 *유지*하기 위해
        // 반드시 "최종 landings에서 winSlot에 떨어지는 top"에서만 loser를 뽑는다(자연 이름 폴백 금지).
        // landings는 항상 전단사 → winSlot에 떨어지는 top은 정확히 1개(winTop). 그 top이 picked면 그 그룹을 loser로.
        // (degenerate면 그 그룹=전원이지만 종료성 위해 개인 부분집합 허용 — 단 token은 winSlot 착지라 화면 일치.)
        if (finalLoserNames.length === 0 && participants.length > 0) {
            const winTop = landings.indexOf(winSlot);   // 변형 후 winSlot에 떨어지는 유일 top
            const winTopPicked = winTop >= 0 && pickedTops.has(winTop);
            if (winTopPicked) {
                finalLoserTops = new Set([winTop]);
                const group = participantsWithTopIn(participants, ld, finalLoserTops);
                // degenerate(그 top이 곧 전원)면 종료성 위해 개인 부분집합, 아니면 그룹 전원.
                finalLoserNames = (degenerate && group.length === participants.length && participants.length > 1)
                    ? randomProperSubset(participants)
                    : group;
            } else {
                // winSlot에 picked token이 전혀 안 떨어지는 unroutable 케이스(이론상 거의 불가).
                // 이때만 group/개인 fallback — 단일 소스는 깨지나 라운드 진행은 보장(로그로 가시화).
                console.warn(`[사다리타기] unroutable — winSlot=${winSlot}에 picked token 없음(force 실패). loser fallback.`);
                if (degenerate) {
                    finalLoserNames = [participants[Math.floor(Math.random() * participants.length)]];
                } else {
                    const tops = Array.from(pickedTops);
                    const pickTop = tops[Math.floor(Math.random() * tops.length)];
                    finalLoserNames = participantsWithTopIn(participants, ld, new Set([pickTop]));
                }
            }
        }

        // 강조용 loserTop = *발표 loser들의 top*(finalLoserNames 기준). shrink/안전망 보정 후에도
        // "발표 loser ↔ 강조 토큰 ↔ landings winSlot 착지" 3자가 항상 일치하도록 finalLoserNames에서 도출.
        const loserTopSet = new Set(finalLoserNames.map(name => ld.userTops[name]));

        ld.rungs = work;
        ld.mutationScript = script;
        ld.landings = landings;
        ld.initialRungs = initialRungs;
        ld.erased = built.erased.concat(built.droppedOverlap);   // 사라짐 연출 = 스크램블 erase + 겹침 dedup 제거분
        ld.added = built.added.concat(extraBalanceAdded);        // 서버 그리기 연출 = 스크램블 add + balance add
        ld.laneToBottom = built.laneToBottom;
        ld.roundParticipants = participants.slice();
        ld.roundLoserNames = finalLoserNames.slice();
        ld.loserTop = Array.from(loserTopSet);                    // 死필드 활용(MINOR) — 발표 loser들의 top

        ld.phase = 'revealing';
        ld.isLadderActive = true;
        // 주의: ladder는 gameState.isGameActive를 켜지 않는다(lesson 2026-06-17).

        io.to(room.roomId).emit('ladder:reveal', {
            numColumns: N,
            winSlot: winSlot,
            initialRungs: (ld.initialRungs || []).slice(),
            rungs: (ld.initialRungs || []).slice(),
            erased: (ld.erased || []).slice(),
            added: (ld.added || []).slice(),
            mutationScript: (ld.mutationScript || []).slice(),
            landings: (ld.landings || []).slice(),
            loserTop: (ld.loserTop || []).slice(),      // 발표 loser들의 top — 패자 토큰 강조용(landings winSlot 착지와 일치)
            userTops: { ...ld.userTops },
            colorIndex: { ...ld.colorIndex },
            round: ld.round,
            tournamentActive: !!ld.tournamentActive
        });

        console.log(`[사다리타기] 방 ${room.roomName} 공개 - winSlot=${winSlot}, landings=[${landings.join(',')}], loser=[${finalLoserNames.join(',')}]`);

        clearLadderTimers(ld);
        ld.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endRound(room, gameState);
        }, ladderRevealDelay(N));

        updateRoomsList();
    }

    // winSlot에 떨어지는 picked top들(Set 반환). map = lane→bottom.
    function pickedTopsAtWin(map, pickedTops, winSlot) {
        const out = new Set();
        pickedTops.forEach(top => { if (map[top] === winSlot) out.add(top); });
        return out;
    }
    // 참가자 중 top이 topSet에 속한 사람들 이름 배열.
    function participantsWithTopIn(participants, ld, topSet) {
        return participants.filter(name => topSet.has(ld.userTops[name]));
    }
    // zero-loser guarantee용 target top — picked tops 중 server RNG 균등 선택.
    // sub-round면 strict-subset 우선: 풀 전체가 같은 top이 아니라면 일부만 잡는 top을 선호(가능한 한).
    function chooseGuaranteeTop(participants, ld, pickedTops, subRound) {
        const tops = Array.from(pickedTops);
        if (!subRound || tops.length <= 1) return tops[Math.floor(Math.random() * tops.length)];
        // strict-subset 우선: 그 top을 고른 사람 수가 참가자 전체보다 적은 top들.
        const proper = tops.filter(top =>
            participants.filter(name => ld.userTops[name] === top).length < participants.length);
        const pool = proper.length ? proper : tops;
        return pool[Math.floor(Math.random() * pool.length)];
    }
    // 참가자에서 random 진부분집합(≥1, < 전체) — degenerate(전원 같은 top)일 때만 종료성 위해 사용.
    function randomProperSubset(participants) {
        const shuffled = participants.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
        }
        const k = 1 + Math.floor(Math.random() * (participants.length - 1));   // 1..전체-1
        return shuffled.slice(0, k);
    }
    // sub-round strict shrink (group-random) — loser top들(loserTops)의 *진부분집합*(≥1, < 전체 top)을
    // server RNG로 골라, 그 top들의 picker 전원을 loser로. top(그룹) 단위라 share-fate("같은 top=같은 운명") 보존.
    // 개인 1명 타게팅 금지(MAJOR). loserTops가 1개뿐이면(비-degenerate에선 비도달) 안전하게 그 top 전원 유지.
    function shrinkByTop(participants, ld, loserTops) {
        const tops = Array.from(loserTops);
        if (tops.length <= 1) return participantsWithTopIn(participants, ld, loserTops);
        // top 배열 셔플 후 1..전체-1개 선택(진부분집합).
        for (let i = tops.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = tops[i]; tops[i] = tops[j]; tops[j] = t;
        }
        const k = 1 + Math.floor(Math.random() * (tops.length - 1));   // 1..tops-1 (진부분집합)
        const keep = new Set(tops.slice(0, k));
        return participantsWithTopIn(participants, ld, keep);
    }

    // 라운드 종료 — loser pool 판정 → |pool|==1이면 토너먼트 종료(DB 기록), >1이면 다음 sub-round.
    function endRound(room, gameState) {
        const ld = gameState.ladder;
        clearLadderTimers(ld);
        const N = LADDER_COLUMNS;
        ld.isLadderActive = false;

        const loserNames = (ld.roundLoserNames || []).filter(name =>
            gameState.users.some(u => u.name === name));
        // 라운드 결과 emit(연출 종료 시점 — 클라가 결과 오버레이/풀 표시).
        io.to(room.roomId).emit('ladder:gameEnd', {
            round: ld.round,
            winSlot: ld.winSlot,
            loserPool: loserNames.slice(),
            participants: (ld.roundParticipants || []).slice(),
            finished: loserNames.length <= 1
        });

        if (loserNames.length <= 1) {
            // 토너먼트 종료 — 최종 꼴등 확정.
            const finalLoser = loserNames[0] || null;
            ld.phase = 'finished';
            ld.tournamentActive = false;
            ld.loserPool = [];
            ld.round++;
            finishTournament(room, gameState, finalLoser);
        } else {
            // 다음 sub-round — loser pool만 진행. 생존자는 out. 재준비 + 재pick.
            ld.tournamentActive = true;
            ld.loserPool = loserNames.slice();
            ld.phase = 'idle';
            ld.round++;
            // 다음 라운드용 빌드 상태 리셋(막대기/색/winSlot 재생성), loserPool은 보존.
            resetLadderRound(ld, /*keepLoserPool*/ true);
            // 재준비 — loser pool만 readyUsers에 남기고 나머지 제거(픽/시작 게이트가 풀만 보게).
            gameState.readyUsers = (gameState.readyUsers || []).filter(name => loserNames.indexOf(name) !== -1);
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            io.to(room.roomId).emit('ladder:tournamentRound', {
                round: ld.round,
                loserPool: loserNames.slice(),
                winSlot: ld.winSlot
            });
            emitRungsUpdated(room, gameState);
        }
        updateRoomsList();
    }

    // 토너먼트 종료 — 히스토리 + DB 1회 기록(pirate 단일 패자 패턴).
    function finishTournament(room, gameState, finalLoser) {
        const ld = gameState.ladder;
        const N = LADDER_COLUMNS;

        ld.ladderHistory.push({
            round: ld.round,
            numColumns: N,
            winSlot: ld.winSlot,
            loser: finalLoser,
            timestamp: new Date().toISOString()
        });
        if (ld.ladderHistory.length > LADDER_HISTORY_MAX) {
            ld.ladderHistory = ld.ladderHistory.slice(-LADDER_HISTORY_MAX);
        }

        io.to(room.roomId).emit('ladder:tournamentEnd', {
            round: ld.round,
            winSlot: ld.winSlot,
            loser: finalLoser
        });

        // ── DB 기록 (pirate 단일 패자 패턴 — 토너먼트 1회) ──
        // 참가자 = 토너먼트 첫 라운드 참가자(전원). 없으면 현재 방 인원으로 폴백.
        const participants = (ld.tournamentParticipants && ld.tournamentParticipants.length)
            ? ld.tournamentParticipants.slice()
            : (gameState.users || []).map(u => u.name);
        recordGamePlay('ladder', participants.length, room.serverId || null);

        if (room.serverId && finalLoser) {
            const sessionId = generateSessionId('ladder', room.serverId);
            Promise.all(participants.map(name => {
                const isWinner = name !== finalLoser;   // 꼴등(finalLoser)만 패자
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'ladder', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'ladder',
                gameRules: 'ladder-pick-elimination',
                winnerName: null,   // 단일 패자 게임 — 승자 지정 없음(패자가 꼴등)
                participantCount: participants.length
            })).catch(e => console.warn('[사다리타기] DB 기록 실패:', e.message));
        }

        console.log(`[사다리타기] 방 ${room.roomName} 토너먼트 종료 - 꼴등=${finalLoser}, 참가 ${participants.length}명`);

        // 종료 → 주문받기 자동 시작 (기존 패턴, 2-arg 시그니처). Order/penalty 적용 대상은 최종 꼴등.
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        // 종료 후 자동 리셋 안 함 — phase='finished' 유지. 다음 토너먼트는 명시적 ladder:reset로만.
    }

    // 라운드 빌드 상태 리셋 — 막대기/색/id시퀀스/server-only/winSlot/userTops 초기화.
    // keepLoserPool=true면 토너먼트 sub-round로 loserPool/tournamentActive 보존(상위에서 별도 관리).
    function resetLadderRound(ld, keepLoserPool) {
        clearLadderTimers(ld);
        ld.userRungs = {};
        ld.userTops = {};                 // 새 라운드 — 다시 pick
        ld.publicRungByDrawer = {};
        ld.baseRungs = [];
        ld.baseRungsGenerated = false;
        ld.colorIndex = {};
        ld.rungSeq = 0;
        ld.winSlot = null;                // ensureBaseRungs가 다음 빌드 오픈 시 재지정
        ld.rungs = [];
        ld.mutationScript = [];
        ld.landings = [];
        ld.initialRungs = [];
        ld.erased = [];
        ld.added = [];
        ld.laneToBottom = [];
        ld.roundParticipants = [];
        ld.roundLoserNames = [];
        ld.isLadderActive = false;
        if (!keepLoserPool) {
            ld.tournamentActive = false;
            ld.loserPool = [];
            ld.tournamentParticipants = [];
        }
    }

    // 전체 리셋 (finished → idle, 새 토너먼트) — 토너먼트 상태도 전부 초기화.
    function resetLadder(ld) {
        ld.phase = 'idle';
        resetLadderRound(ld, /*keepLoserPool*/ false);
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // top 선택 (경마식 6택1) — { top: 0..5 }. idle(빌드/sub-round pick)에서만. 여러 명 같은 top 허용.
    socket.on('ladder:pickTop', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error', '게임 시작 전(대기 중)에만 칸을 고를 수 있습니다.');
            return;
        }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        // sub-round면 loser pool만 pick 가능(생존자는 out).
        if (ld.tournamentActive && Array.isArray(ld.loserPool) && ld.loserPool.indexOf(name) === -1) {
            socket.emit('ladder:error', '이번 라운드 대상이 아니에요.');
            return;
        }

        const top = parseInt(data && data.top, 10);
        if (!Number.isInteger(top) || top < 0 || top >= LADDER_COLUMNS) {
            socket.emit('ladder:error', '고를 수 없는 칸이에요.');
            return;
        }
        if (!ld.userTops) ld.userTops = {};
        ld.userTops[name] = top;
        assignColorIndex(ld, name);
        emitRungsUpdated(room, gameState);
    });

    // 막대기 배치 (누구나, 빌드 단계) — 인당 최대 3개 append(cap 초과 FIFO). 연속 좌표(c, y, slant) 서버 검증.
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

        // sub-round면 loser pool만 그리기 가능.
        if (ld.tournamentActive && Array.isArray(ld.loserPool) && ld.loserPool.indexOf(name) === -1) return;

        if (!Array.isArray(ld.userRungs[name])) ld.userRungs[name] = [];

        const N = LADDER_COLUMNS;
        const c = data.c;
        const yRaw = clampY(data.y);
        if (!Number.isInteger(c) || c < 0 || c > N - 2 || yRaw === null) {
            socket.emit('ladder:error', '막대기를 놓을 수 없는 위치입니다.');
            return;
        }
        const y = snapToSlotY(yRaw);
        const sp = sanitizeCurvePoints(data.points);

        // 인당 cap(3) — 초과 시 거부 대신 FIFO: 가장 오래된 본인 막대기를 교체(항상 ≤3 유지).
        const myRungs = ld.userRungs[name];
        if (myRungs.length >= LADDER_MAX_RUNGS_PER_USER) myRungs.shift();

        assignColorIndex(ld, name);
        myRungs.push({ id: ld.rungSeq++, c, y, slant: clampSlant(data.slant), points: sp });
        repickPublicRung(ld, name);   // 드로어 set 변경 → public 1개 재선택(server RNG)
        emitRungsUpdated(room, gameState);
    });

    // 막대기 제거 (본인 소유분) — { id } 로 해당 id만 제거.
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
        if (rungId === null) return;

        const next = arr.filter(rg => rg && rg.id !== rungId);
        if (next.length === arr.length) return;

        if (next.length) ld.userRungs[name] = next;
        else delete ld.userRungs[name];
        repickPublicRung(ld, name);   // set 변경 → public 재선택(또는 키 삭제)
        emitRungsUpdated(room, gameState);
    });

    // 게임 시작 (호스트 + 준비/풀 ≥ 게이트). phase가 idle일 때만 1회 실행.
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
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error',
                ld.phase === 'finished'
                    ? '결과 정리 중이에요. 다시하기를 눌러 다음 판을 시작해주세요.'
                    : '이미 게임이 진행 중입니다!');
            return;
        }

        const subRound = !!ld.tournamentActive;
        const participants = roundParticipants(gameState);

        if (!subRound) {
            // 첫 라운드 — 준비 ≥2 게이트.
            if (readyCount(gameState) < LADDER_MIN_PLAYERS) {
                socket.emit('ladder:error', `준비한 인원이 ${LADDER_MIN_PLAYERS}명 이상이어야 합니다!`);
                return;
            }
            // 토너먼트 참가자 스냅샷(DB 기록용) — 시작 시점 준비 인원.
            ld.tournamentParticipants = participants.slice();
        }
        // 전원이 top을 골랐는지 — 미선택자가 있으면 거부(경마식: 선택 필수).
        const notPicked = participants.filter(name =>
            typeof ld.userTops[name] !== 'number');
        if (notPicked.length > 0) {
            socket.emit('ladder:error', '아직 칸을 고르지 않은 사람이 있어요. 모두 칸을 골라야 시작할 수 있어요.');
            return;
        }
        if (participants.length < 1) {
            socket.emit('ladder:error', '참가자가 없습니다!');
            return;
        }

        console.log(`[사다리타기] 방 ${room.roomName} 시작 - 참가 ${participants.length}명 (sub-round=${subRound})`);
        runLadder(room, gameState);
    });

    // 명시적 다시하기 (호스트) — 결과 화면(finished)에서만 새 토너먼트로 리셋.
    socket.on('ladder:reset', () => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'finished') return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('ladder:error', '방장만 다음 판을 시작할 수 있습니다!');
            return;
        }

        resetLadder(ld);
        io.to(room.roomId).emit('ladder:roundReset');
        emitRungsUpdated(room, gameState);   // base/winSlot 재생성(idle) + 브로드캐스트
        updateRoomsList();
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
            // revealing: endTimeout이 자연 종료. idle/finished: 별도 개입 불필요(남은 참가자가 명시 reset).
        }, waitTime);
    });
};

// 테스트용 export (공정성 회귀 — physical descent 매핑 검증). 핸들러 호출에는 영향 없음.
module.exports.buildLadder = buildLadder;
module.exports.computeLaneToBottom = computeLaneToBottom;
module.exports.sanitizeCurvePoints = sanitizeCurvePoints;
module.exports.contactConflict = contactConflict;
module.exports.descendOne = descendOne;
module.exports.snapToSlotY = snapToSlotY;
module.exports.resolveContacts = resolveContacts;
module.exports.dedupOverlaps = dedupOverlaps;
module.exports.generateBaseRungs = generateBaseRungs;
module.exports.buildAddCandidate = buildAddCandidate;
module.exports.buildRemoveCandidate = buildRemoveCandidate;
module.exports.forceRouteToWin = forceRouteToWin;
module.exports.isBijection = isBijection;
module.exports.LADDER_COLUMNS = LADDER_COLUMNS;
