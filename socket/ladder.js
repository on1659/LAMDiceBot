// 사다리타기(ladder) 게임 소켓 핸들러 — vibe(D:\Work\vibe\ladder) 메커니즘 in-place 이식 (Phase A: 서버 코어).
// 게임 로직(physical descent / living-rungs / 슬롯그리드 / 셔플 perm)은 vibe와 byte-identical로 가져오고,
// LAMDiceBot 셸 계약에 맞춘다: DB 기록은 우리 recordGamePlay/recordServerGame/recordGameSession 패턴 유지,
// 주문받기 자동 시작은 ctx.triggerAutoOrder 유지, 시작 게이트는 우리 관례(호스트 + 준비 ≥2) 유지.
// 결과(perm·landings·mutationScript·results·initialRungs)는 전적으로 서버가 결정 — 클라는 받은 값으로 연출만(공정성).
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const LADDER_MIN_PLAYERS = 2;       // 시작 최소 준비 인원 (LAMDice 시작 게이트 — 빌드는 ready 무관, 시작만 게이트)
const LADDER_COLUMNS_MIN = 2;       // 최소 칸(세로 줄) 수
const LADDER_COLUMNS_MAX = 8;       // 최대 칸(세로 줄) 수
const LADDER_COLUMNS_DEFAULT = 4;   // 기본 칸 수
const LADDER_LABEL_MAX_LEN = 24;    // 위/아래 라벨 글자 수 상한 (신뢰경계)
const LADDER_LABEL_LOCK_IDLE_MS = 8000;   // 라벨 편집 소프트락 자동 해제까지의 무입력 시간(ms) — 영구 고착 방지
const LADDER_HISTORY_MAX = 100;     // 히스토리 최대 보관 수
// 기본(가시) 막대기 — 모든 칸(c=0..N-2)에 1개씩 보장 + 다양성용 0~RAND개 추가(서버 RNG).
// 유저가 직접 ~3개씩 그리므로 과밀 방지 위해 추가분은 적게.
const LADDER_BASE_RUNG_RAND = 2;    // 칸별 1개 보장 위에 더해지는 랜덤 추가량 상한(0~이 값)
// 자동 생성(base/스크램블) 막대기 중 '수평(평평한)' 막대기 비율(0~1). 나머지는 대각선.
// 0 = 전부 대각선(수평선 안 나옴), 1 = 전부 수평. 수평이 너무 많지도/없지도 않게 중간값.
// 공정성은 바닥 라벨 perm이 결정하므로 수평/대각선 비율은 시각 전용(결과 분포 불변).
const LADDER_HORIZONTAL_RATIO = 0.5;

// 인당 막대기 최대 개수 — 빌드 단계에서 한 사람이 놓을 수 있는 상한 (cap 초과 시 FIFO 교체)
const LADDER_MAX_RUNGS_PER_USER = 3;
// 스크램블(시작 시점): union에서 K개 지우고 M개 새로 그린다. 모두 서버 RNG. js/ladder.js와 동일 유지.
const LADDER_SCRAMBLE_ERASE_MIN = 2;
const LADDER_SCRAMBLE_ERASE_MAX = 4;
const LADDER_SCRAMBLE_ADD_MIN = 2;
const LADDER_SCRAMBLE_ADD_MAX = 4;
// 밀도 바닥(floor): 스크램블 후 최종 막대기가 이 수 미만이면 서버 RNG로 추가해 채운다(spacing 규칙 준수).
// 작은 방(2명, base 5칸 + erase로 거의 비는 경우)에서도 사다리가 꽉 차 보이게 하는 시각 목표.
// 6레인=칸 5개, 칸당 평균 ~2.4개면 또렷 → 12. 매핑은 physical descent 접점 기준(추가분은 수평이라 대칭) → loser 분포 불변.
const LADDER_MIN_TOTAL_RUNGS = 12;
// 균등 생성용 세로 밴드 수 — y범위[Y_MIN,Y_MAX]를 이 개수로 등분(상/중/하). 추가분을 칸·밴드에 고르게 분산.
// 균등화는 배치(c,y)만 바꾼다(결과는 perm·매핑이 권위 — 배치와 독립). 시각/구조 균형 목적.
const LADDER_GEN_BANDS = 3;

// 연속 좌표 사다리 — 막대기는 두 인접 기둥(c, c+1)을 높이 y(0~1)에서 잇는다. 격자 없음.
const LADDER_MIN_GAP_Y = 0.09;      // 같은 기둥을 공유하는 막대기 간 최소 세로 간격(비율) — 사다리 모호성 방지 + 과밀(군집) 방지
// physical descent의 단 하나의 제약 — per-pole contact distinctness. 같은 기둥에 같은 슬롯(접점) 두 개 금지(+ 분기 모호 → 무한루프/충돌).
// EPS는 같은 슬롯(접점)만 충돌로 본다 — 인접 슬롯(Δ=0.09)은 허용(슬롯 간격 = LADDER_MIN_GAP_Y). 부동소수 경계만 1e-4로 느슨하게.
const LADDER_CONTACT_EPS = LADDER_MIN_GAP_Y - 1e-4;   // 같은 슬롯만 충돌, 인접 슬롯(0.09)은 허용
const LADDER_Y_MIN = 0.05;          // 막대기 높이 하한
const LADDER_Y_MAX = 0.95;          // 막대기 높이 상한
// 연결 슬롯(스냅 그리드) — js/ladder.js와 동기. 슬롯 간격 = LADDER_MIN_GAP_Y(0.09) → 같은 칸 인접 슬롯 허용,
// 같은 슬롯(기둥 공유 접점)만 contactConflict가 거부. 접점 y를 슬롯에 정렬(서버·클라 동일 그리드 시각 일치).
const LADDER_SLOT_ROWS = 11;        // 0.05~0.95를 0.09 간격으로 → 11줄
function snapToSlotY(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    const r = Math.max(0, Math.min(LADDER_SLOT_ROWS - 1, Math.round((y - LADDER_Y_MIN) / span * (LADDER_SLOT_ROWS - 1))));
    return LADDER_Y_MIN + span * r / (LADDER_SLOT_ROWS - 1);
}
// ─── 순차 하강(reveal) 연출 타이밍 — js/ladder.js 와 반드시 동기화 ───
// 솔로 토큰(0..N-3)은 한 칸씩 차례로 출발한다. 한 토큰이 자기 경로 전체를 SLOT_MS 동안
// 호 길이 비례 보간(pointAt)으로 끝까지 내려가면 (변형 후) 다음이 출발한다. 마지막 두 토큰(N-2,N-1)은 같은 보드에서
// 한 SLOT_MS를 공유하며 동시에 내려간다. 경로 길이가 칸마다 달라도 같은 시간(SLOT_MS)에 주파한다.
// 총 하강 시간 = descentSlots × SLOT_MS, descentSlots = (N<=1 ? N : N-1) → 종료 타이머는 N에 비례.
// 스크램블 연출 시퀀스 타이밍(reveal 시작 → 하강 시작 전 단계들). js/ladder.js와 반드시 동일 유지.
// 모션 단계는 ~2배 느리게(차분히 감상). HOLD/PAUSE는 모션이 아니므로 유지(과하게 늘리지 않음).
const LADDER_COUNTDOWN_MS = 3200;     // "3·2·1 시작!" 카운트다운 (1600×2)
const LADDER_ERASE_MS = 2400;         // 스크램블 지우기 연출(클라 ladderRunErase) — ladderRevealDelay 합산. js/ladder.js와 byte-identical.
const LADDER_DRAW_MS = 1800;          // 스크램블 그리기 연출(클라 ladderRunDraw) — ladderRevealDelay 합산. js/ladder.js와 byte-identical.
const LADDER_TOKEN_SLOT_MS = 6000;    // 토큰 한 칸이 끝까지 내려가는 시간(아주 천천히) (3000×2) — js/ladder.js와 동일 유지
const LADDER_FINAL_HOLD = 1800;       // 결과 캡션 유지(ms) — 모션 아님, 유지 — js/ladder.js와 동일 유지
const LADDER_MUTATION_MS = 1400;      // 변형 1단계(add/remove/none) 애니 시간 — 솔로 토큰 사이 max(0,N-2)회(마지막 쌍 앞엔 없음). js/ladder.js와 byte-identical 유지.

// reveal 시작부터 자동 종료(결과 오버레이)까지 — 순차 하강 + 토큰 사이 변형이라 토큰 수(N=칸 수)에 비례.
// living-rungs 시퀀스: 스크램블(지우기→그리기) → 카운트다운 → [토큰0 하강 → 변형0 → … → 토큰N-3 하강 → 변형N-3 → (토큰N-2·N-1 동시 하강)] → 결과 캡션 유지.
//   마지막 두 토큰(N-2, N-1)은 같은 보드에서 동시에 한 슬롯을 공유하며 내려간다(둘 사이 변형 없음) → 마지막 1명 결과가 미리 확정되는 시시함 제거.
//   descentSlots = (N<=1 ? N : N-1) — 마지막 둘이 한 슬롯 공유. mutations = max(0, N-2) — 토큰 사이 변형은 솔로 N-2개뿐(쌍 앞엔 없음).
//   스크램블 = ERASE + DRAW(시각, 매핑 무관). 하강 = descentSlots × TOKEN_SLOT. 변형 = mutations × MUTATION_MS. 셔플 단계는 폐기.
// 단계 합이 같아야 서버 endGame이 클라 연출 도중에 끼어들지 않는다(서버↔클라 타이밍 동기 불변). N = 상단 칸(하강 토큰) 수.
// ⚠ js/ladder.js의 클라 단계 합과 byte-identical이어야 한다(descentSlots/mutations 식 + MUTATION_MS 미러).
function ladderRevealDelay(N, descentMode) {
    const n = Math.max(1, N | 0);
    const simul = descentMode === 'simultaneous';               // 동시에: 모든 토큰이 한 슬롯 공유 + 변형 0개
    const descentSlots = simul ? 1 : ((n <= 1) ? n : (n - 1));  // 마지막 둘이 한 슬롯 공유(sequential) / 전원 한 슬롯(simultaneous)
    const mutations = simul ? 0 : Math.max(0, n - 2);           // 변형은 솔로 토큰 사이 max(0,N-2)개(쌍 앞엔 없음). simultaneous는 0개.
    const descent = descentSlots * LADDER_TOKEN_SLOT_MS;
    const scramble = LADDER_ERASE_MS + LADDER_DRAW_MS;          // 스크램블: 지우기 + 그리기 (클라 ladderRunErase + ladderRunDraw)
    return LADDER_COUNTDOWN_MS + scramble + descent + mutations * LADDER_MUTATION_MS + LADDER_FINAL_HOLD;
}

const LADDER_SLANT_MAX = 1;         // rung 기울기(slant) 절대값 상한 (js/ladder.js와 동기 — 시각 효과)
const LADDER_CURVE_MAX_POINTS = 24; // 곡선 막대기 점 개수 상한 (신뢰경계 — 페이로드 폭주 방지, js/ladder.js와 동기)
const LADDER_CURVE_RAW_MAX = 256;   // 클라가 보낸 원시 점 허용 상한(이 초과는 비정상 → 직선 폴백)
// 곡선 누적 세로 이동(vtravel) 상한 — Σ|Δy|(정규화 0~1). 공개 시 토큰은 막대기 폴리라인을 따라가므로
// 세로로 길게/구불구불 그릴수록 경로가 길어져 속도가 튄다. 이 상한 초과분은 안쪽 점을 코드(직선) 쪽으로 줄여
// 경로 길이를 일정 범위로 묶는다. 매핑은 physical descent(접점 leftY/rightY 기준) — 곡선 가운데 점은 결과 무관 → 공정성 영향 0. js/ladder.js와 동기.
const LADDER_CURVE_MAX_VTRAVEL = 8.0;   // '그린 대로' 우선해 완화(1.0→8.0) — 끝점 이동 시 안쪽 점 재형성/커밋 변형 방지. js/ladder.js와 동기.

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

// 곡선의 누적 세로 이동(Σ|Δy|)이 상한을 넘으면 안쪽 점만 두 끝을 잇는 직선(코드) 쪽으로 축소 → 세로 path 길이 제한.
// 양 끝점(노드 연결)은 고정한다 — 평균 쪽으로 끌면 끝이 빠지고 막대기가 수평으로 망가진다(연결 순간 깨짐 버그). 코드 쪽 축소라 대각선은 유지.
// 매핑은 physical descent(접점 leftY/rightY 기준) — 양 끝점 고정이라 접점 불변 → 결과 불변. 안쪽 점만 줄이는 연출 속도/가독 목적의 시각 제약일 뿐. js/ladder.js clampCurveVTravel와 동기.
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
// physical descent: 토큰은 기둥에선 아래로만, 막대기를 건널 때만 y가 바뀐다(대각선 허용 — leftY≠rightY OK).
// 수평이 필요하면 serverCurvePoints(y, y).
function serverCurvePoints(leftY, rightY) {
    return sanitizeCurvePoints([{ x: 0, y: leftY }, { x: 1, y: rightY }]);   // 2점 직선(끝점 x=0/1)
}

// 상단 칸 → 바닥 칸 매핑 (physical descent — 막대기 접점 leftY/rightY로 추적). slant/곡선 가운데는 무관(접점만 결과).
// 각 start에서 descendOne 호출 — 정렬 불필요(descendOne이 매 스텝 최근접 접점을 스캔). 외부에서 회귀 테스트로 호출.
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

// 라벨 배열을 길이 N으로 맞춘다 — 기존 항목 보존(부족분 '' 패드, 초과분 잘라냄). 비문자열은 ''로.
function resizeLabels(arr, n) {
    const src = Array.isArray(arr) ? arr : [];
    const out = [];
    for (let i = 0; i < n; i++) out.push(typeof src[i] === 'string' ? src[i] : '');
    return out;
}

// ─── physical descent — 막대기 접점(contact) 도출 + 하강 추적 ───
// 막대기는 두 기둥 접점을 가진다: leftY(기둥 c), rightY(기둥 c+1). points에서 도출(없으면 rg.y 폴백).
function rungLeftY(rg)  { return (rg && rg.points && rg.points.length >= 2) ? rg.points[0].y                  : (rg ? rg.y : 0); }
function rungRightY(rg) { return (rg && rg.points && rg.points.length >= 2) ? rg.points[rg.points.length - 1].y : (rg ? rg.y : 0); }

// 한 기둥(P)의 접점 집합 — c==P 막대기의 leftY ∪ c==P-1 막대기의 rightY.
function contactsOnPole(rungs, P) {
    const out = [];
    (rungs || []).forEach(rg => { if (!rg) return; if (rg.c === P) out.push(rungLeftY(rg)); else if (rg.c === P - 1) out.push(rungRightY(rg)); });
    return out;
}
// (c, leftY, rightY)에 막대기를 놓으면 두 공유 기둥(c, c+1)에서 같은 슬롯 접점과 충돌하는가.
// EPS(=MIN_GAP-1e-4): 같은 슬롯(Δ≈0)만 충돌, 인접 슬롯(0.09)은 허용. rungTooClose(midpoint)를 대체.
function contactConflict(rungs, c, leftY, rightY) {
    return contactsOnPole(rungs, c).some(v => Math.abs(v - leftY) < LADDER_CONTACT_EPS)
        || contactsOnPole(rungs, c + 1).some(v => Math.abs(v - rightY) < LADDER_CONTACT_EPS);
}

// ─── 접점 해소(resolveContacts) — 슬롯 인덱스 헬퍼 (snapToSlotY와 같은 그리드) ───
// y → 가장 가까운 슬롯 인덱스(0..ROWS-1). slotYFromIndex(nearestSlotIndex(y)) === snapToSlotY(y).
function nearestSlotIndex(y) {
    const span = LADDER_Y_MAX - LADDER_Y_MIN;
    return Math.max(0, Math.min(LADDER_SLOT_ROWS - 1, Math.round((y - LADDER_Y_MIN) / span * (LADDER_SLOT_ROWS - 1))));
}
// 슬롯 인덱스 → y (= snapToSlotY가 반환하는 값).
function slotYFromIndex(slot) {
    return LADDER_Y_MIN + (LADDER_Y_MAX - LADDER_Y_MIN) * slot / (LADDER_SLOT_ROWS - 1);
}
// slot이 점유됐을 때 가장 가까운 빈 슬롯 — d=1,2,…로 아래(slot+d) 먼저, 그다음 위(slot-d). 범위 안 + 미점유면 반환. 없으면 -1.
function nearestFreeSlot(slot, used) {
    for (let d = 1; d < LADDER_SLOT_ROWS; d++) {
        const down = slot + d;
        if (down <= LADDER_SLOT_ROWS - 1 && !used.has(down)) return down;
        const up = slot - d;
        if (up >= 0 && !used.has(up)) return up;
    }
    return -1;
}

// 겹쳐 그린 막대기를 결정적(RNG 없음)으로 비켜놓아 physical descent가 항상 1:1(전단사)이 되게 한다.
// 기둥 P=0..N-1마다 P에 닿는 모든 접점(c==P의 leftY, c==P-1의 rightY)을 서로 다른 슬롯에 배정하고,
// 그 endpoint(points 양끝)의 y만 in-place로 갱신한다 — descent는 endpoint만 보므로 중간 곡선점은 무관.
// 한 기둥에 슬롯(11)보다 많은 접점이 몰리면(희귀) 넘치는 막대기는 드롭(그 id를 반환).
// 결정적: touchers를 (contact asc, id asc)로 정렬 → id는 단조 카운터라 안정. buildLadder 내부에서만 호출.
function resolveContacts(rungs, N) {
    const dropped = new Set();
    for (let P = 0; P < N; P++) {
        const touchers = [];   // { rg, end:'L'|'R', contact }
        (rungs || []).forEach(rg => {
            if (!rg || dropped.has(rg.id)) return;
            // points 없거나 length<2인 막대기는 endpoint를 갱신할 수 없으니 제외(방어적 — union엔 항상 points가 있다).
            if (!Array.isArray(rg.points) || rg.points.length < 2) return;
            if (rg.c === P)          touchers.push({ rg, end: 'L', contact: rungLeftY(rg) });
            else if (rg.c === P - 1) touchers.push({ rg, end: 'R', contact: rungRightY(rg) });
        });
        // 결정적 순서: 접점 오름차순, 동률이면 id 오름차순.
        touchers.sort((a, b) => (a.contact - b.contact) || (a.rg.id - b.rg.id));
        const used = new Set();   // 이 기둥에서 점유된 슬롯 인덱스
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

// 한 시작 칸(start)에서 물리적 하강 — 토큰은 기둥을 따라 아래로만(접점 > y), 막대기를 건널 때만 y 갱신.
// 매 스텝: col을 건드리는 모든 막대기(c==col → 오른쪽으로, c==col-1 → 왼쪽으로) 중 현재 y보다 아래(>y)이고
//   가장 가까운(최소 contact) 막대기로 이동. 없으면 col 반환(바닥 도달). per-pole distinctness 하에서 유일·종료.
// 무한루프 방어: iteration 캡 초과 시 현재 col 반환.
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

// ─── 공유 그리기 예산(per-game draw budget) — 유저 막대기에만 적용(base/스크램블 제외) ───
// 한 판 동안 모든 참가자가 합쳐서 놓을 수 있는 유저 막대기 총량. N(칸 수)에서 파생 → 별도 저장 안 함(desync 방지).
// spent = 모든 참가자 userRungs 길이 합. remaining = budget - spent.
function drawBudget(N) { return Math.max(0, (N - 1) * 2); }   // (N-1)×2 (예: 4칸 → 6개)
function userRungTotal(ld) {
    if (!ld || !ld.userRungs) return 0;
    return Object.keys(ld.userRungs).reduce((sum, n) =>
        sum + (Array.isArray(ld.userRungs[n]) ? ld.userRungs[n].length : 0), 0);
}
function drawRemaining(ld, N) { return drawBudget(N) - userRungTotal(ld); }

// ─── 균등(편향 없는) 배치 헬퍼 (서버 전용) ───
// 추가분을 무작위 칸이 아니라 "현재 가장 적은 칸"에, 그 칸에서도 "가장 비어있는 밴드"에 놓아
// 칸(c=0..N-2)·세로 밴드(상/중/하)에 라운드로빈처럼 고르게 분산한다. 매핑은 physical descent(접점 기준)·loser 분포 불변.

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
 * @param {number} N - 칸(세로 줄) 수 [2..8]
 * @param {function(): number} nextId - id 발급 콜백 (ld.rungSeq++)
 * @returns {Array<{id:number,c:number,y:number,slant:number,points}>}
 */
function generateBaseRungs(N, nextId) {
    const baseRungs = [];
    // 슬롯 이산 랜덤 접점 — 두 끝(leftY/rightY)을 각각 독립으로 뽑아 대각선 막대기 생성(per-pole distinctness는 contactConflict로 강제).
    const randSlotY = () => snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
    // 두 끝 접점 — LADDER_HORIZONTAL_RATIO 확률로 수평(leftY=rightY), 나머지는 대각선(서로 다른 슬롯).
    // 수평이 적당히 섞이게(전부 대각선도, 전부 수평도 아니게). 결과/공정성은 바닥 라벨 perm이 결정 → 비율은 시각 전용.
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
    //    두 끝 접점은 수평/대각선 혼합(randRungPair) — contactConflict(같은 기둥 같은 슬롯) 안 겹치게 재시도.
    for (let c = 0; c < N - 1; c++) {
        for (let a = 0; a < 60; a++) {
            const { leftY, rightY } = randRungPair();
            if (contactConflict(baseRungs, c, leftY, rightY)) continue;
            pushRung(c, leftY, rightY);
            break;
        }
    }

    // 2) 다양성용 추가 막대기 — 0~RAND개를 "가장 적은 칸"에 얹는다(과밀 방지). 두 끝 접점 수평/대각선 혼합, contactConflict 회피.
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
 * 막대기 = { id, c: 왼쪽 기둥(0..N-2), y: 높이(0~1), slant: 기울기(-1~1, 시각), points, user, owner }.
 * 1) union = base + user(flatten) 방어적 재검증, 2) K개 erase, 3) M개 add(서버 RNG),
 * 4) final = remaining + added 를 y 오름차순 정렬, 4-b) resolveContacts(전단사 보장).
 * 매핑(laneToBottom)은 physical descent — points 양끝(leftY/rightY) 접점으로 추적. slant/곡선 가운데/y중점은 결과 무관(접점만 결과).
 * 바닥 라벨 셔플(perm)은 여기서 정하지 않는다(runLadder의 서버 shufflePermutation이 권위).
 * ⚠ 계약: union이 인자 userRungsMap/baseRungs의 points 배열을 **참조로** 담으므로(복사 X — added↔rungs 참조 공유로 reveal 동기),
 *   내부 resolveContacts(in-place endpoint mutate)가 원본 ld.userRungs/ld.baseRungs의 points까지 갱신한다.
 *   안전 전제: runLadder가 호출 직후 동기적으로 phase='revealing' 전이 + resetLadder가 userRungs={}로 폐기.
 *   ⇒ 반드시 phase=idle에서만(=runLadder 1회/게임) 호출. revealing 중 재호출/await 삽입 시 idle 재표시(emitRungsUpdated)가 오염될 수 있다.
 * @param {number} N - 칸(세로 줄) 수 [2..8]
 * @param {Array<{id,c,y,slant,points}>} baseRungs - 가시 base 막대기 (owner 없음)
 * @param {Object<string, Array<{id,c,y,slant,points}>>} userRungsMap - 유저별 막대기 배열맵
 * @param {function(): number} nextId - add 막대기 id 발급 콜백 (ld.rungSeq++)
 * @returns {{ rungs, erased, added, laneToBottom }}
 */
function buildLadder(N, baseRungs, userRungsMap, nextId) {
    nextId = nextId || (() => 0);

    // 1) union 구성 + 방어적 재검증 (범위 0..N-2, clampY). 위반분 제외, id 보존.
    //    유저 막대기를 먼저 넣어 우선권을 준다 → 겹쳐도 union에 보존(descent 직전 resolveContacts가 distinct 슬롯으로 비켜놓음).
    //    base는 모든 칸 1개씩 깔리므로 어느 칸도 비지 않는다.
    const union = [];
    Object.keys(userRungsMap || {}).forEach(owner => {
        const arr = Array.isArray(userRungsMap[owner]) ? userRungsMap[owner] : [];
        arr.forEach(rg => {
            if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
            const yy = clampY(rg.y);
            // 겹쳐도 union에 보존 — descent 직전 resolveContacts가 접점을 distinct 슬롯으로 비켜놓는다(항상 1:1).
            if (yy === null) return;
            union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: rg.points || null, user: true, owner });
        });
    });
    (baseRungs || []).forEach(rg => {
        if (!rg || !Number.isInteger(rg.c) || rg.c < 0 || rg.c > N - 2) return;
        const yy = clampY(rg.y);
        if (yy === null) return;   // 겹쳐도 union에 보존 — resolveContacts가 distinct 슬롯으로 비켜놓음
        // base 곡선(serverCurvePoints) 보존 — null로 덮으면 reveal에서 base가 평평해져 idle↔reveal 불일치.
        union.push({ id: rg.id, c: rg.c, y: yy, slant: clampSlant(rg.slant), points: rg.points || null, user: false, owner: null });
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
    let erased = [];
    const remaining = [];
    union.forEach((rg, i) => { (eraseIdxSet.has(i) ? erased : remaining).push(rg); });

    // 3) add: M = ADD_MIN..ADD_MAX (서버 RNG). remaining + 이미 add된 것과 spacing 안 겹치게 배치.
    //    못 채우면 M 미달 허용(attempts 한도). 추가분은 owner 없음(user:false, owner:null).
    const M = LADDER_SCRAMBLE_ADD_MIN + Math.floor(Math.random() * (LADDER_SCRAMBLE_ADD_MAX - LADDER_SCRAMBLE_ADD_MIN + 1));
    let added = [];
    // 새 막대기 한 개를 "가장 적은 칸 + 가장 빈 밴드"에, contactConflict(remaining + 기존 added) 안 겹치게 배치 시도.
    //    무작위 c/y 대신 희소 우선이라 erase 후 빈 칸·구역부터 채워 전체가 고르게 찬다. 매핑·loser 분포 불변.
    function tryAddOne() {
        const current = remaining.concat(added);
        const c = pickLeastLoadedColumn(columnCounts(current, N), Math.random);
        // 한 끝(leftY)은 가장 빈 밴드에 앵커(균등 배치 유지). LADDER_HORIZONTAL_RATIO 확률로 수평(rightY=leftY), 나머지는 대각선.
        // 공정성은 바닥 라벨 perm이 결정하므로 막대기 구조(수평/대각선)와 무관 → 비율은 시각 전용. 접점 distinctness는 contactConflict가 강제.
        const leftY = snapToSlotY(pickYInLeastLoadedBand(current, c, Math.random));
        let rightY = leftY;
        if (Math.random() >= LADDER_HORIZONTAL_RATIO) {   // 대각선: 다른 슬롯에서 rightY 재추첨
            rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
            for (let k = 0; k < 8 && rightY === leftY; k++) rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
        }
        // 두 공유 기둥에서 같은 슬롯 접점과 충돌하면 거부.
        if (contactConflict(remaining, c, leftY, rightY) || contactConflict(added, c, leftY, rightY)) return false;
        added.push({ id: nextId(), c, y: snapToSlotY((leftY + rightY) / 2), slant: clampSlant((rightY - leftY) / 0.4), points: serverCurvePoints(leftY, rightY), user: false, owner: null });
        return true;
    }
    let placed = 0, attempts = 0;
    while (placed < M && attempts < M * 80) {
        attempts++;
        if (tryAddOne()) placed++;
    }

    // 3-b) 밀도 보충: 스크램블 후 총 막대기(remaining + added)가 floor 미만이면 floor까지 채운다.
    //      작은 방에서도 사다리가 꽉 차 보이게. 추가분은 added에 합류 → reveal payload added/rungs에 동일 포함(클라 동기).
    //      매핑은 physical descent(접점 기준). 추가분은 대각선(tryAddOne) — 공정성은 바닥 라벨 perm이 결정하므로 막대기 구조와 무관(loser 분포 불변). spacing 못 채우면(빽빽) 미달 허용.
    const floor = Math.min(LADDER_MIN_TOTAL_RUNGS, (N - 1) * 3);   // 칸당 spacing 한계 고려 안전 상한(칸 5개 × ~3)
    let fillAttempts = 0;
    while (remaining.length + added.length < floor && fillAttempts < floor * 120) {
        fillAttempts++;
        tryAddOne();
    }

    // 4) final = remaining + added, y 오름차순 정렬 (위→아래) — 매핑·연출 공통 순서
    let rungs = remaining.concat(added).sort((a, b) => a.y - b.y);

    // 4-b) 접점 해소 — 겹쳐 그린 막대기를 결정적으로 비켜놓아 physical descent가 항상 1:1(전단사).
    //      points endpoint를 in-place로 mutate → remaining.concat(added)가 added와 객체 참조를 공유하므로
    //      added(reveal payload)에도 자동 반영(스크램블 그리기 동기). 새 객체로 교체 금지.
    const droppedIds = resolveContacts(rungs, N);
    if (droppedIds.size) {
        rungs = rungs.filter(r => !droppedIds.has(r.id));
        added = added.filter(r => !droppedIds.has(r.id));     // added도 정리(공유 참조 — reveal 동기)
        erased = erased.filter(r => !droppedIds.has(r.id));   // 방어적
    }

    // 5) 각 상단 칸 → 바닥 슬롯 추적 (곡선/slant/스크램블은 매핑에서 제외 → 결과 불변)
    const laneToBottom = computeLaneToBottom(N, rungs);

    // 바닥 라벨 셔플(perm)은 runLadder의 서버 shufflePermutation으로 확정(공정성 불변).
    return { rungs, erased, added, laneToBottom };
}

// ─── living-rungs 변형 후보 생성 (서버 전용 RNG) ───
// runLadder가 토큰 사이마다 호출. 후보를 "비파괴"로 만들어 반환(채택 전 검증) → 채택 시에만 보드 교체.
// 후보의 L'은 새 보드(불변 검증 통과 시 작업 보드로 승격). 후보 add rung은 base 회색(user:false, owner:null) +
//   serverCurvePoints(접점 명시) — descendOne(서버)/클라 ladderBuildPath 패리티 유지.

// 현재 보드 L에 막대기 1개를 추가한 후보 보드 반환. 실패(접점 충돌 등) 시 null. tryAddOne 로직 비파괴 복제.
function buildAddCandidate(N, L, nextId) {
    const current = L;
    const c = pickLeastLoadedColumn(columnCounts(current, N), Math.random);
    const leftY = snapToSlotY(pickYInLeastLoadedBand(current, c, Math.random));
    let rightY = leftY;
    if (Math.random() >= LADDER_HORIZONTAL_RATIO) {   // 대각선: 다른 슬롯에서 rightY 재추첨
        rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
        for (let k = 0; k < 8 && rightY === leftY; k++) rightY = snapToSlotY(LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN));
    }
    if (contactConflict(current, c, leftY, rightY)) return null;
    const rung = { id: nextId(), c, y: snapToSlotY((leftY + rightY) / 2), slant: clampSlant((rightY - leftY) / 0.4), points: serverCurvePoints(leftY, rightY), user: false, owner: null };
    return { type: 'add', rung, L: current.concat([rung]).sort((a, b) => a.y - b.y) };
}

// 현재 보드 L에서 막대기 1개를 제거한 후보. 칸당 최소 1개 보존(빈 칸 방지) + floor 보존. 실패 시 null.
function buildRemoveCandidate(N, L) {
    if (!L || L.length === 0) return null;
    const floor = Math.min(LADDER_MIN_TOTAL_RUNGS, (N - 1) * 3);
    if (L.length <= floor) return null;                  // floor 보존(밀도 바닥 미만으로 줄이지 않음)
    const counts = columnCounts(L, N);                   // 칸별 개수
    // 제거해도 그 칸이 비지 않는(현재 ≥2) 막대기만 후보 — 칸당 최소 1개 보존
    const removable = L.filter(rg => rg && rg.c >= 0 && rg.c < N - 1 && counts[rg.c] >= 2);
    if (removable.length === 0) return null;
    const victim = removable[Math.floor(Math.random() * removable.length)];
    return { type: 'remove', rungId: victim.id, L: L.filter(rg => rg.id !== victim.id) };   // 이미 y정렬 유지
}

// 바닥 라벨 위치를 게임당 1회 무작위로 섞는 순열 — 서버 RNG(Math.random, 기존 구조 RNG와 동일). 매핑 편향 무력화(공정성).
function shufflePermutation(N) {
    const p = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    return p;
}

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

    // 라벨 편집 소프트락 해제 — key("side:index")의 락이 있으면 타이머 clear + 삭제 + 즉시 unlock 브로드캐스트.
    // 없으면 no-op. lock 이벤트는 rungsUpdated와 별개로 즉시 발사(불변조건 5).
    function releaseLabelLock(room, gameState, key) {
        const ld = gameState && gameState.ladder;
        if (!ld || !ld.labelLocks) return;
        const lock = ld.labelLocks[key];
        if (!lock) return;
        // 방이 이미 삭제됨(clean leave/grace 후 유령 idle 타이머) — 타이머만 정리하고 죽은 방 emit 회피.
        if (!ctx.rooms || !ctx.rooms[room.roomId]) {
            if (lock.timer) clearTimeout(lock.timer);
            delete ld.labelLocks[key];
            return;
        }
        if (lock.timer) clearTimeout(lock.timer);   // 서버 전용 timer — 클라 미전송
        delete ld.labelLocks[key];
        const parts = key.split(':');               // side에는 ':' 없음 — 단순 split
        const side = parts[0];
        const index = parseInt(parts[1], 10);
        io.to(room.roomId).emit('ladder:labelUnlocked', { side, index });
    }
    ctx.releaseLadderLabelLock = releaseLabelLock;

    // userName이 보유한 모든 라벨 락 해제(이탈/disconnect 정리용). userName 기준.
    function releaseLocksByUser(room, gameState, userName) {
        const ld = gameState && gameState.ladder;
        if (!ld || !ld.labelLocks) return;
        Object.keys(ld.labelLocks).forEach((key) => {
            const lk = ld.labelLocks[key];
            if (lk && lk.name === userName) releaseLabelLock(room, gameState, key);
        });
    }
    ctx.releaseLadderLocksByUser = releaseLocksByUser;

    // 칸(세로 줄) 수 — gameState에서 읽는다(setColumns로 동적 변경). 미설정이면 기본값.
    function ladderLaneCount(gameState) {
        return (gameState.ladder && gameState.ladder.numColumns) || LADDER_COLUMNS_DEFAULT;
    }
    // 준비하고 현재 방에 있는 사람 수 — 시작 게이트(≥2)에 사용(LAMDice 시작 관례).
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

    // 레인 점유(claimFreeLane / ctx.claimLadderFreeLane) 폐기 — 칸은 익명(소유자 없음).
    // 입장 시 자동 점유 없이 현재 사다리 + 라벨만 브로드캐스트한다(rooms.js의 emitLadderRungsUpdated).

    // 가시 base 막대기 생성 — 입장(phase idle) 시점에 1회만. 멱등(baseRungsGenerated 가드).
    // emitRungsUpdated 진입 시 호출 → 1명만 있어도(솔로 입장) base가 즉시 가시 broadcast된다(입장 즉시 사다리 표시).
    // base는 결과와 무관(공정성 영향 0) — 빌드 중 공개 OK. 시작 게이트(준비 ≥2)는 별도(ladder:start)로 유지.
    function ensureBaseRungs(ld, N, gameState) {
        if (!ld || ld.phase !== 'idle' || ld.baseRungsGenerated) return;
        ld.baseRungs = generateBaseRungs(N, () => ld.rungSeq++);
        ld.baseRungsGenerated = true;
    }

    // 빌드(idle) 막대기를 현재 칸 수 N 범위로 트림 — 칸 감소 시 범위 밖(c>N-2) 잔존 제거.
    // rooms.js(입장/이탈)·emitRungsUpdated 가 공통으로 호출하는 단일 정합성 규칙.
    // userRungs[name]은 배열 → 각 배열에서 범위밖 원소 필터, 빈 배열되면 키 삭제.
    // 레인 점유 폐기(칸 익명) — userLanes 트림 블록 없음.
    function trimLadderBuildToN(ld, N) {
        if (!ld) return;
        Object.keys(ld.userRungs || {}).forEach(name => {
            const arr = Array.isArray(ld.userRungs[name]) ? ld.userRungs[name] : [];
            const kept = arr.filter(rg => rg && typeof rg.c === 'number' && rg.c >= 0 && rg.c <= N - 2);
            if (kept.length) ld.userRungs[name] = kept;
            else delete ld.userRungs[name];
        });
    }

    // 유저 막대기(배열맵) + base 막대기(가시) + colorIndex + 칸 수 + 위/아래 라벨을 전체 클라에 브로드캐스트.
    // server-only 정보(final rungs/laneToBottom/landings/mutationScript/results/initialRungs/erased/added)는 미포함.
    // 진입 시 base 생성·트림·라벨 정합화를 먼저 수행 → 어떤 경로로 호출돼도 가시 base + 범위내 막대기 + 길이 맞는 라벨만 전파.
    function emitRungsUpdated(room, gameState) {
        const ld = gameState.ladder;
        if (!ld || ld.phase !== 'idle') return;   // 빌드 동기화는 idle에서만 — server-only 누출 단일 방어선(가드 밖 호출 회귀 차단)
        const N = ladderLaneCount(gameState);
        ensureBaseRungs(ld, N, gameState);
        trimLadderBuildToN(ld, N);
        // 라벨 길이를 N에 맞춰 방어적 정합화(기존 항목 보존)
        ld.topLabels = resizeLabels(ld.topLabels, N);
        ld.bottomLabels = resizeLabels(ld.bottomLabels, N);
        io.to(room.roomId).emit('ladder:rungsUpdated', {
            userRungs: { ...ld.userRungs },
            baseRungs: (ld.baseRungs || []).slice(),
            colorIndex: { ...ld.colorIndex },
            numColumns: N,
            topLabels: (ld.topLabels || []).slice(),
            bottomLabels: (ld.bottomLabels || []).slice(),
            labelEditMode: ld.labelEditMode || 'all',
            descentMode: ld.descentMode || 'sequential',
            // 공유 그리기 예산 — N에서 파생(저장 안 함). removeRung도 emitRungsUpdated를 거치므로
            // 막대기 제거 시 remaining이 자동 재계산되어 재브로드캐스트된다(예산 복구).
            budget: drawBudget(N),
            remaining: drawRemaining(ld, N)
        });
    }
    ctx.emitLadderRungsUpdated = emitRungsUpdated;
    ctx.ladderBuildLaneCount = ladderLaneCount;
    ctx.trimLadderBuild = trimLadderBuildToN;

    // (휴면) base(가시 기본) 막대기만 재생성해 빌드 단계 사다리 외관을 다시 그리는 훅 — Phase C 상점 'extra_redraw' 연결용 인프라(현재 미노출).
    // setColumns가 쓰는 generateBaseRungs(N, ()=>ld.rungSeq++)와 동일 경로(공정성 중립) 재사용.
    // idle에서만 동작 — userRungs/perm/laneToBottom/results/labels는 절대 건드리지 않는다.
    // 결과는 여전히 runLadder(시작 시점)에서 서버 buildLadder + shufflePermutation이 결정한다.
    function ladderExtraRedraw(room, gameState) {
        if (!gameState || !gameState.ladder) return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;   // 빌드(idle)에서만 — 진행/결과 중 거부
        const N = ladderLaneCount(gameState);
        ld.baseRungs = generateBaseRungs(N, () => ld.rungSeq++);
        ld.baseRungsGenerated = true;
        emitRungsUpdated(room, gameState);   // 방 전체에 새 base 재공개
    }
    ctx.ladderExtraRedraw = ladderExtraRedraw;

    // 게임 시작 → 사다리 확정 + 바닥 라벨 셔플 + 결과 매핑 → reveal 브로드캐스트.
    // 결과(perm·mapping·results)는 전적으로 서버가 결정 — 클라는 받은 값으로 연출만(공정성).
    function runLadder(room, gameState) {
        const ld = gameState.ladder;
        const N = ladderLaneCount(gameState);   // 상단 칸 수 = 하강 토큰 수

        // 게임 시작 시 자동 주문 cycle 가드만 해제 — 진행 중인 주문받기는 닫지 않는다(호스트가 종료 버튼을 누를 때까지 유지)
        gameState.orderAutoTriggered = false;

        // 라벨 길이를 N에 맞춰 방어적 정합화(빈 칸은 "결과 i+1"로 표시 — 결과 캡션 가독)
        ld.topLabels = resizeLabels(ld.topLabels, N);
        ld.bottomLabels = resizeLabels(ld.bottomLabels, N);

        // ── living-rungs 사전 시뮬레이션(서버 권위, 서버 RNG) ──
        // 초기 보드(buildLadder 의미 유지) → 토큰0은 초기 보드에서 하강 → 솔로 토큰 사이마다 변형(add/remove/none).
        //   변형은 "이미 도착한 토큰의 착지칸 불변" 검증을 통과한 것만 채택 → 전단사(distinct) 자동 보장.
        //   A(impactful): invariant 통과 후보 중 "아직 안 내려간 토큰(j∈[i,N-1])의 경로를 실제로 바꾸는" 후보를 우선 채택.
        //                 없으면 firstValid 폴백 → 그래도 없으면 none. invariant는 약화하지 않고 그 위에 선호만 추가(전단사 불변).
        //   B(마지막 쌍 동시): 솔로는 0..N-2까지(루프 i=1..N-2). 마지막 토큰 N-1은 변형 없이 같은 보드 L에서 하강 →
        //                 토큰 N-2, N-1이 같은 보드에서 동시에 내려가는 셈(둘 사이 변형 없음). script 길이 = max(0, N-2).
        // 클라는 initialRungs + mutationScript + landings 를 받아 결정적 재생만(재계산 0 — 공정성).
        const built = buildLadder(N, ld.baseRungs, ld.userRungs, () => ld.rungSeq++);
        const initialRungs = built.rungs;            // 초기 보드(reveal 전송용 — 불변 복제 보관)
        let L = initialRungs.slice();                // 작업 보드(변형 누적)
        const landings = new Array(N);
        let script;                                  // 길이 max(0,N-2): script[k] = 솔로 토큰 k와 k+1 사이 변형 (simultaneous는 [])
        if ((ld.descentMode || 'sequential') === 'simultaneous') {
            // 동시에(simultaneous): 변형 0개 — 전원이 고정 초기 보드에서 한 슬롯에 함께 하강. landings = 초기 보드 매핑(항상 전단사).
            script = [];
            for (let i = 0; i < N; i++) landings[i] = descendOne(N, initialRungs, i);
            L = initialRungs.slice();                // 최종 보드 = 초기 보드(변형 누적 없음)
        } else {
        landings[0] = descendOne(N, L, 0);           // 토큰0은 초기 보드에서 하강(자기 경로는 추적 가능)
        script = [];                                 // 길이 max(0,N-2): script[k] = 솔로 토큰 k와 k+1 사이 변형
        const ATTEMPT_CAP = 40;
        // 솔로 루프: i = 1 .. N-2 (i < N-1). 마지막 토큰 N-1 앞에는 변형을 넣지 않는다(쌍 동시 하강).
        for (let i = 1; i <= N - 2; i++) {
            // L은 후보 시도 동안 불변 — 남은 토큰(j∈[i,N-1])의 변형 전 착지를 한 번만 캐시해 impactful 비교에 재사용.
            const baseRem = new Array(N);
            for (let j = i; j < N; j++) baseRem[j] = descendOne(N, L, j);
            let firstValid = null;   // invariant 통과한 아무 후보(impactful 폴백)
            let impactful = null;    // 남은 토큰 중 1명 이상 경로가 바뀌는 후보(우선)
            for (let a = 0; a < ATTEMPT_CAP && !impactful; a++) {
                const tryAdd = (a % 2 === 0);   // 짝수 시도=add, 홀수=remove (다양성)
                const cand = tryAdd ? buildAddCandidate(N, L, () => ld.rungSeq++)
                                    : buildRemoveCandidate(N, L);
                if (!cand) continue;
                // arrived invariant: 이미 도착한 토큰 j(0..i-1)의 착지가 후보 보드에서 불변이어야 채택(= 전단사 보장). 약화 금지.
                let ok = true;
                for (let j = 0; j < i && ok; j++) {
                    if (descendOne(N, cand.L, j) !== landings[j]) ok = false;
                }
                if (!ok) continue;
                if (!firstValid) firstValid = cand;
                // impactful: 남은 토큰(j∈[i,N-1]) 중 하나라도 변형 전(baseRem[j]) 대비 착지가 바뀌면 "의미 있는" 변형.
                let changesRemaining = false;
                for (let j = i; j < N && !changesRemaining; j++) {
                    if (descendOne(N, cand.L, j) !== baseRem[j]) changesRemaining = true;
                }
                if (changesRemaining) impactful = cand;
            }
            const pick = impactful || firstValid;   // impactful 우선, 없으면 invariant 통과 아무거나
            let chosen, nextL;
            if (pick) {
                chosen = (pick.type === 'add')
                    ? { type: 'add', rung: pick.rung }
                    : { type: 'remove', rungId: pick.rungId };
                nextL = pick.L;
            } else {
                chosen = { type: 'none' };           // 유효 후보 자체가 없음 → 정지
                nextL = L;
            }
            L = nextL;
            script[i - 1] = chosen;
            landings[i] = descendOne(N, L, i);
        }
        // B: 마지막 토큰 N-1은 솔로 루프 뒤 같은 보드 L에서 하강(변형 없음). N>=2일 때만(N=1이면 landings[0]만 채워짐).
        if (N >= 2) landings[N - 1] = descendOne(N, L, N - 1);
        }

        // 안전망: landings 순열(전단사) 검증 — 위반 시 none 폴백(초기 보드는 항상 전단사). script 길이는 max(0,N-2) 유지.
        const seenSlot = new Set(); let bijection = true;
        for (let i = 0; i < N; i++) { if (seenSlot.has(landings[i])) { bijection = false; break; } seenSlot.add(landings[i]); }
        if (!bijection) {
            console.warn('[사다리타기] 변형 후 landings 비전단사 — none 폴백');
            for (let i = 0; i < script.length; i++) script[i] = { type: 'none' };
            L = initialRungs.slice();
            for (let i = 0; i < N; i++) landings[i] = descendOne(N, L, i);   // 초기 보드는 항상 전단사
        }

        // 셔플 복원: 바닥 라벨 위치를 게임당 1회 무작위로 섞어(perm) 매핑 편향을 무력화 → 결과 균등(공정성).
        //   results[i] = shuffledLabels[landings[i]] = bottomLabels[perm[landings[i]]]. perm은 landings와 독립 균등이라 결과 균등.
        //   클라는 results를 그대로 표시(재계산 금지). ld.bottomLabels(엔트리순서 원본)는 건드리지 않는다.
        const perm = shufflePermutation(N);
        const shuffledLabels = new Array(N);
        for (let k = 0; k < N; k++) {
            const src = ld.bottomLabels[perm[k]];
            shuffledLabels[k] = (typeof src === 'string' && src.length) ? src : ('결과 ' + (perm[k] + 1));
        }
        const results = [];
        for (let i = 0; i < N; i++) results.push(shuffledLabels[landings[i]]);
        ld.rungs = L;                    // 최종 보드(DB·gameEnd용)
        ld.mutationScript = script;
        ld.landings = landings;
        ld.results = results;
        ld.initialRungs = initialRungs;  // reveal payload용(클라 시작 상태)
        ld.erased = built.erased;        // 스크램블 연출용(클라 reveal에서 glow→빛쓸기 지우기)
        ld.added = built.added;          // 스크램블 연출용(클라 reveal에서 펜으로 그리기)
        ld.laneToBottom = built.laneToBottom;   // 회귀 테스트 호환(physical descent 초기 매핑). 결과 권위는 landings.

        // reveal 진입 — 라벨 편집 락 idle 타이머 정리(연출 중 유령 unlock 방지). 브로드캐스트 불필요(연출 중 편집 불가, 클라는 reveal/roundReset에서 락 UI 리셋).
        if (ld.labelLocks) {
            Object.keys(ld.labelLocks).forEach(function (k) {
                if (ld.labelLocks[k] && ld.labelLocks[k].timer) clearTimeout(ld.labelLocks[k].timer);
            });
            ld.labelLocks = {};
        }

        ld.phase = 'revealing';
        ld.isLadderActive = true;
        // 주의: ladder는 gameState.isGameActive를 켜지 않는다(lesson 2026-06-17). 진행 추적은 ld.phase, 준비 차단은 shared.js의 phase 게이트.

        io.to(room.roomId).emit('ladder:reveal', {
            numColumns: N,
            initialRungs: (ld.initialRungs || []).slice(),     // 초기 보드(클라 시작 상태) — id·user·owner·points 포함
            rungs: (ld.initialRungs || []).slice(),            // rungs 키 유지(=초기 보드)
            erased: (ld.erased || []).slice(),                 // 스크램블 연출용 — 클라가 glow→빛쓸기로 지움(순수 시각)
            added: (ld.added || []).slice(),                   // 스크램블 연출용 — 클라가 펜 orb로 그림(순수 시각). remaining = initialRungs - added
            mutationScript: (ld.mutationScript || []).slice(), // 변형 스크립트(길이 max(0,N-2)) — 솔로 토큰 사이 add/remove/none(마지막 쌍 앞엔 없음)
            landings: (ld.landings || []).slice(),             // 토큰 i 최종 착지칸
            mapping: (ld.landings || []).slice(),              // landings 별칭(상단 칸 i → 바닥 슬롯)
            results: results.slice(),                          // 권위 결과(상단 칸 i → 최종 바닥 라벨)
            topLabels: (ld.topLabels || []).slice(),
            bottomLabels: shuffledLabels.slice(),              // 셔플된 라벨(shuffledLabels — 게임당 무작위)
            colorIndex: { ...ld.colorIndex },                  // drawer 색 (서버 권위)
            descentMode: ld.descentMode || 'sequential'        // 내려가기 방식(클라 ladderRun.descentMode로 저장 — 연출 분기)
        });

        console.log(`[사다리타기] 방 ${room.roomName} 공개 - 칸=${N}, landings=[${landings.join(',')}], mutations=${(ld.mutationScript || []).map(s => s.type).join('/')}`);

        clearLadderTimers(ld);
        // 종료 타이머 = 클라 연출 합과 정확히 일치. N = 상단 칸 수(=하강 토큰 수).
        ld.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, ladderRevealDelay(N, ld.descentMode || 'sequential'));

        updateRoomsList();
    }

    function endGame(room, gameState) {
        const ld = gameState.ladder;
        clearLadderTimers(ld);

        const N = (ld.topLabels || []).length;
        ld.phase = 'finished';
        ld.isLadderActive = false;
        // 주의: ladder는 gameState.isGameActive를 켜지/끄지 않는다(애초에 안 켰음). ld.phase로만 진행 추적.
        ld.round++;

        // 한 판 기록 — 칸 수 + 위/아래 라벨 + 결과(상단 칸 i → 최종 바닥 라벨). 꽝/패자 없음(중립 매핑).
        ld.ladderHistory.push({
            round: ld.round,
            numColumns: N,
            topLabels: (ld.topLabels || []).slice(),
            bottomLabels: (ld.bottomLabels || []).slice(),
            results: (ld.results || []).slice(),
            timestamp: new Date().toISOString()
        });
        if (ld.ladderHistory.length > LADDER_HISTORY_MAX) {
            ld.ladderHistory = ld.ladderHistory.slice(-LADDER_HISTORY_MAX);
        }

        io.to(room.roomId).emit('ladder:gameEnd', {
            round: ld.round,
            numColumns: N,
            topLabels: (ld.topLabels || []).slice(),
            bottomLabels: (ld.bottomLabels || []).slice(),
            results: (ld.results || []).slice()
        });

        // ── DB 기록 (LAMDice 패턴, 중립 매핑 — 단일 패자 없음) ──
        // 참여 카운트(승패 무관). 참가자 수 = 시작 시점 방 인원.
        const participants = (gameState.users || []).map(u => u.name);
        recordGamePlay('ladder', participants.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('ladder', room.serverId);
            // 중립 매핑 결과: 단일 패자/승자가 없으므로 전원 동일 rank(1) + isWinner=false로 기록.
            //   server_game_records.result NOT NULL → 1, is_winner BOOLEAN DEFAULT false → false, game_rank → 1(NULL 허용이나 명시).
            //   game_sessions.winner_name 은 NULL 허용 → null(승자 없음), gameRules 'ladder-mapping'.
            Promise.all(participants.map(name =>
                recordServerGame(room.serverId, name, 1, 'ladder', false, sessionId, 1)
            )).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'ladder',
                gameRules: 'ladder-mapping',
                winnerName: null,
                participantCount: participants.length
            })).catch(e => console.warn('[사다리타기] DB 기록 실패:', e.message));
        }

        console.log(`[사다리타기] 방 ${room.roomName} 종료 - 칸=${N}, 참가 ${participants.length}명`);

        // 게임 종료 → 바로 주문받기 자동 시작 (경마/기존 ladder 패턴과 동일).
        // triggerAutoOrder는 패자(loser)에 의존하지 않고 gameState.users 전원에게 디폴트 주문을 채운다(중립). 1회 호출 유지.
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        // 종료 후 자동 리셋 안 함 — phase='finished' 상태로 결과 사다리를 화면에 그대로 유지한다.
        // 다음 판은 명시적 ladder:reset 핸들러(finished→idle)로만 시작된다.

        updateRoomsList();
    }

    // 다음 판 리셋 — 막대기/색/id시퀀스/server-only 필드 초기화. 라벨(topLabels/bottomLabels)과 칸 수(numColumns)는 보존.
    function resetLadder(ld) {
        clearLadderTimers(ld);
        // 라운드 리셋 — 라벨 편집 소프트락 타이머 정리 후 맵 비움. unlock 브로드캐스트는 하지 않는다
        // (라운드 전체가 리셋되며 클라는 ladder:roundReset에서 자체 락 UI를 비운다).
        Object.keys(ld.labelLocks || {}).forEach((key) => {
            const lk = ld.labelLocks[key];
            if (lk && lk.timer) clearTimeout(lk.timer);
        });
        ld.labelLocks = {};
        ld.phase = 'idle';
        ld.userRungs = {};            // 유저 막대기 배열맵 초기화 (매 판 새 기본 틀)
        ld.baseRungs = [];            // 가시 기본 막대기 초기화 — 다음 빌드 오픈 시 재생성
        ld.baseRungsGenerated = false;
        ld.colorIndex = {};           // drawer 색 인덱스 초기화 (라운드마다 재배정)
        ld.rungSeq = 0;               // id 시퀀스 0 리셋 (라운드 분리라 id 충돌 없음)
        ld.rungs = [];
        ld.mutationScript = [];       // living-rungs: 변형 스크립트 초기화
        ld.landings = [];             // living-rungs: 토큰별 착지칸 초기화
        ld.initialRungs = [];         // living-rungs: 초기 보드 초기화
        ld.results = [];
        ld.erased = [];               // server-only: 스크램블 지운 막대기
        ld.added = [];                // server-only: 스크램블 추가 막대기
        ld.laneToBottom = [];         // server-only: physical descent 초기 매핑
        ld.isLadderActive = false;
        // numColumns / topLabels / bottomLabels 는 보존(같은 설정으로 다음 판).
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 막대기 배치 (누구나, 빌드 단계) — 인당 최대 3개 append(cap 초과 FIFO). 연속 좌표(c, y, slant) 서버 검증
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

        // 빌드는 협업(vibe식) — ready 게이트 없음. 누구나 idle에서 막대기 가능(시작 게이트만 ready ≥2).

        if (!Array.isArray(ld.userRungs[name])) ld.userRungs[name] = [];

        const N = ladderLaneCount(gameState);   // 현재 칸 수 — 기둥 범위(0..N-2) 검증용

        const c = data.c;
        const yRaw = clampY(data.y);
        if (!Number.isInteger(c) || c < 0 || c > N - 2 || yRaw === null) {
            socket.emit('ladder:error', '막대기를 놓을 수 없는 위치입니다.');
            return;
        }
        // 표시·DB·매핑 키 y는 슬롯 스냅 유지(중점). 단 physical descent의 결과 권위 접점은 points의 양끝(leftY/rightY).
        const y = snapToSlotY(yRaw);

        // 후보 막대기 곡선 — sanitize한 points. 겹쳐도 저장 허용(접점 해소는 buildLadder의 resolveContacts가 담당).
        const sp = sanitizeCurvePoints(data.points);

        // 인당 cap(3) — 초과 시 거부 대신 FIFO: 가장 오래된 본인 막대기를 교체한다(항상 ≤3 유지).
        const myRungs = ld.userRungs[name];
        const atCap = myRungs.length >= LADDER_MAX_RUNGS_PER_USER;

        // 공유 그리기 예산 — FIFO 교체는 net-zero(1 제거 후 1 추가)라 캡 도달 시엔 예산 검사 스킵.
        // 캡 미만일 때만 예산 소진 거부(남들이 합쳐서 (N-1)×2개를 다 쓴 경우).
        if (!atCap && drawRemaining(ld, N) <= 0) {
            socket.emit('ladder:error', '이번 판 그리기 한도를 다 썼어요.');
            return;
        }

        // 겹쳐 그려도 저장·표시 허용 — 접점이 겹쳐도 게임 시작(buildLadder) 시 resolveContacts가
        // 기둥별 접점을 distinct 슬롯으로 비켜놓아 항상 1:1(전단사)이 된다. 여기선 거부하지 않는다.

        // 첫 등장이면 drawer 색 배정 (서버 권위, 결정적)
        assignColorIndex(ld, name);

        // FIFO: 유효성 통과 후 캡 도달이면 가장 오래된 것 제거 → 새로 추가. id=단조 카운터, slant=시각, points 양끝=접점(결과 권위).
        if (atCap) myRungs.shift();
        myRungs.push({ id: ld.rungSeq++, c, y, slant: clampSlant(data.slant), points: sp });
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

    // 칸(세로 줄) 수 변경 (누구나, 빌드/idle 단계) — N clamp[2,8] → base 재생성 + 막대기/라벨 정합화 후 브로드캐스트.
    socket.on('ladder:setColumns', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;   // 빌드(idle)에서만 변경
        let n = parseInt(data && data.n, 10);
        if (!Number.isInteger(n)) return;
        n = Math.max(LADDER_COLUMNS_MIN, Math.min(LADDER_COLUMNS_MAX, n));
        if (n === ld.numColumns) return;   // 변화 없음
        ld.numColumns = n;
        // 새 N으로 base 막대기 재생성 (generateBaseRungs 의미 유지). 직접 set이라 baseRungsGenerated=true.
        ld.baseRungs = generateBaseRungs(n, () => ld.rungSeq++);
        ld.baseRungsGenerated = true;
        // 유저 막대기를 새 N 범위로 트림 (userRungs만 — 레인 없음)
        trimLadderBuildToN(ld, n);
        // 라벨 배열을 새 N에 맞춤(기존 항목 보존, 부족분 '' 패드 / 초과분 잘라냄)
        ld.topLabels = resizeLabels(ld.topLabels, n);
        ld.bottomLabels = resizeLabels(ld.bottomLabels, n);
        emitRungsUpdated(room, gameState);
    });

    // 위/아래 라벨 편집 (누구나, 빌드/idle 단계) — side·index·text 서버 검증 후 라이브 동기화.
    socket.on('ladder:setLabel', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        // host 모드: 방장만 라벨 편집 가능('all' 모드는 누구나)
        const me = gameState.users.find(u => u.id === socket.id);
        if (ld.labelEditMode === 'host' && (!me || me.isHost !== true)) {
            socket.emit('ladder:error', '방장만 라벨을 편집할 수 있어요.');
            return;
        }
        if (!data || (data.side !== 'top' && data.side !== 'bottom')) return;
        const idx = parseInt(data.index, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ld.numColumns) return;
        let text = (typeof data.text === 'string') ? data.text : '';
        if (text.length > LADDER_LABEL_MAX_LEN) text = text.slice(0, LADDER_LABEL_MAX_LEN);
        const key = (data.side === 'top') ? 'topLabels' : 'bottomLabels';
        // 배열 길이가 numColumns와 다르면 방어적 정합화 후 기록
        if (!Array.isArray(ld[key]) || ld[key].length !== ld.numColumns) {
            ld[key] = resizeLabels(ld[key], ld.numColumns);
        }
        ld[key][idx] = text;
        emitRungsUpdated(room, gameState);
    });

    // 라벨 글쓰기 권한 모드 변경 (방장 전용, idle) — 'all'(누구나) | 'host'(방장만).
    socket.on('ladder:setEditMode', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        const me = gameState.users.find(u => u.id === socket.id);
        if (!me || me.isHost !== true) { socket.emit('ladder:error', '방장만 글쓰기 권한을 바꿀 수 있어요.'); return; }
        const mode = (data && data.mode === 'host') ? 'host' : (data && data.mode === 'all') ? 'all' : null;
        if (!mode) return;
        ld.labelEditMode = mode;
        // host 전환 시 비방장이 들고 있던 락 모두 해제(방장만 편집 가능해지므로)
        if (mode === 'host') {
            const hostNames = new Set(gameState.users.filter(u => u.isHost).map(u => u.name));
            Object.keys(ld.labelLocks || {}).forEach((key) => {
                const lk = ld.labelLocks[key];
                if (lk && !hostNames.has(lk.name)) releaseLabelLock(room, gameState, key);
            });
        }
        emitRungsUpdated(room, gameState);
    });

    // 내려가기 방식 변경 (방장 전용, idle) — 'sequential'(한명씩) | 'simultaneous'(동시에). 방 설정이라 resetLadder에서 보존.
    socket.on('ladder:setDescentMode', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        const me = gameState.users.find(u => u.id === socket.id);
        if (!me || me.isHost !== true) { socket.emit('ladder:error', '방장만 내려가기 방식을 바꿀 수 있어요.'); return; }
        const mode = (data && data.mode === 'simultaneous') ? 'simultaneous' : (data && data.mode === 'sequential') ? 'sequential' : null;
        if (!mode) return;
        ld.descentMode = mode;
        emitRungsUpdated(room, gameState);
    });

    // 라벨 칸 포커스 → 소프트락 그랜트(idle). 보유자만 라이브 타이핑/편집 가능. userName 기준.
    socket.on('ladder:labelFocus', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        if (!data || (data.side !== 'top' && data.side !== 'bottom')) return;
        const idx = parseInt(data.index, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ld.numColumns) return;
        const me = gameState.users.find(u => u.id === socket.id);
        if (!me) return;
        // host 모드에서 비방장 포커스는 거부(클라도 readonly지만 서버 권위)
        if (ld.labelEditMode === 'host' && me.isHost !== true) {
            socket.emit('ladder:labelLockDenied', { side: data.side, index: idx, name: (gameState.users.find(u => u.isHost) || {}).name || '' });
            return;
        }
        if (!ld.labelLocks) ld.labelLocks = {};
        const key = data.side + ':' + idx;
        const existing = ld.labelLocks[key];
        if (existing && existing.name !== me.name) {
            socket.emit('ladder:labelLockDenied', { side: data.side, index: idx, name: existing.name });
            return;
        }
        // 본인 재포커스면 타이머만 갱신, 아니면 신규 그랜트 + 브로드캐스트
        if (existing && existing.name === me.name) {
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => releaseLabelLock(room, gameState, key), LADDER_LABEL_LOCK_IDLE_MS);
            return;
        }
        const timer = setTimeout(() => releaseLabelLock(room, gameState, key), LADDER_LABEL_LOCK_IDLE_MS);
        ld.labelLocks[key] = { name: me.name, timer: timer };
        io.to(room.roomId).emit('ladder:labelLocked', { side: data.side, index: idx, name: me.name });
    });

    // 라벨 칸 블러 → 본인 보유 락 해제(idle). releaseLabelLock이 타이머 clear + 삭제 + unlock 브로드캐스트.
    socket.on('ladder:labelBlur', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        if (!data || (data.side !== 'top' && data.side !== 'bottom')) return;
        const idx = parseInt(data.index, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ld.numColumns) return;
        const me = gameState.users.find(u => u.id === socket.id);
        if (!me) return;
        const key = data.side + ':' + idx;
        const lock = ld.labelLocks && ld.labelLocks[key];
        if (lock && lock.name === me.name) releaseLabelLock(room, gameState, key);
    });

    // 라이브 타이핑 미리보기(idle) — 영속 X(영속은 setLabel 담당). 락 보유자만 가능.
    socket.on('ladder:labelTyping', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;
        if (!data || (data.side !== 'top' && data.side !== 'bottom')) return;
        const idx = parseInt(data.index, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ld.numColumns) return;
        const me = gameState.users.find(u => u.id === socket.id);
        if (!me) return;
        const key = data.side + ':' + idx;
        const lock = ld.labelLocks && ld.labelLocks[key];
        if (!lock || lock.name !== me.name) return;   // 락 보유자만 라이브 타이핑 가능
        let text = (typeof data.text === 'string') ? data.text : '';
        if (text.length > LADDER_LABEL_MAX_LEN) text = text.slice(0, LADDER_LABEL_MAX_LEN);
        // idle 타이머 갱신(타이핑 중엔 자동해제 미루기)
        clearTimeout(lock.timer);
        lock.timer = setTimeout(() => releaseLabelLock(room, gameState, key), LADDER_LABEL_LOCK_IDLE_MS);
        // 미리보기 브로드캐스트(영속 X). 방 전체 emit + 클라가 본인(name) 무시.
        io.to(room.roomId).emit('ladder:labelTyping', { side: data.side, index: idx, text: text, name: me.name });
    });

    // 게임 시작 (호스트 + 준비 ≥2 — LAMDice 시작 게이트 유지). phase가 idle일 때만 1회 실행.
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
        if (ld.phase !== 'idle') {   // 진행 중(revealing/finished) 재시작 차단 — 멀티탭 동시 클릭 가드
            socket.emit('ladder:error',
                ld.phase === 'finished'
                    ? '결과 정리 중이에요. 다시하기를 눌러 다음 판을 시작해주세요.'
                    : '이미 게임이 진행 중입니다!');
            return;
        }

        // 시작 게이트 — 준비하고 방에 있는 사람 ≥2 (LAMDice 관례 유지. 빌드는 ready 무관, 시작만 게이트)
        if (readyCount(gameState) < LADDER_MIN_PLAYERS) {
            socket.emit('ladder:error', `준비한 인원이 ${LADDER_MIN_PLAYERS}명 이상이어야 합니다!`);
            return;
        }

        console.log(`[사다리타기] 방 ${room.roomName} 시작 - 칸 ${ladderLaneCount(gameState)}개`);
        runLadder(room, gameState);
    });

    // 명시적 다시하기 (호스트, ladder:start와 일관) — 결과 화면(finished)에서만 새 사다리로 리셋.
    // 종료 후 자동 리셋을 제거했으므로 이 핸들러가 유일한 finished→idle 전이.
    // revealing/idle에서는 무시(연출 중 리셋 방지 + idle 재진입 무의미).
    socket.on('ladder:reset', () => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;
        const ld = gameState.ladder;
        if (ld.phase !== 'finished') return;   // finished에서만 — 연출 중/idle 리셋 차단

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {   // LAMDice 관례 — 다음 판 시작 권한은 호스트
            socket.emit('ladder:error', '방장만 다음 판을 시작할 수 있습니다!');
            return;
        }

        resetLadder(ld);
        io.to(room.roomId).emit('ladder:roundReset');

        // ensureBaseRungs는 phase=idle이면 새 base를 생성하므로, 다음 빌드가 base 가시 상태로 바로 열린다.
        // 라벨/칸 수는 resetLadder가 보존 → 같은 설정으로 다음 판 진행 가능.
        emitRungsUpdated(room, gameState);   // base 재생성(idle) + 브로드캐스트
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

            const ld = gameState.ladder;
            // revealing: endTimeout이 자연 종료(reveal 연출 → endGame, finished 유지) — 개입 안 함.
            // idle: 진행 타이머 없음. finished: 자동 리셋 제거 → 결과 보드를 유지한다.
            //   남은 참가자가 명시적 ladder:reset(다시하기)로 idle 전이하므로 여기서 별도 개입 불필요.
        }, waitTime);
    });
};

// 테스트용 export (공정성 회귀 — physical descent 매핑 == 클라 시각경로 착지 검증). 핸들러 호출에는 영향 없음.
module.exports.buildLadder = buildLadder;
module.exports.computeLaneToBottom = computeLaneToBottom;
module.exports.sanitizeCurvePoints = sanitizeCurvePoints;
module.exports.contactConflict = contactConflict;
module.exports.descendOne = descendOne;
module.exports.snapToSlotY = snapToSlotY;
module.exports.resolveContacts = resolveContacts;
module.exports.generateBaseRungs = generateBaseRungs;
module.exports.buildAddCandidate = buildAddCandidate;
module.exports.buildRemoveCandidate = buildRemoveCandidate;
module.exports.shufflePermutation = shufflePermutation;
