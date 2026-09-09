// 회전 칼날(spin-arena) 게임 소켓 핸들러 — "경마인데 과정이 칼싸움" 메커니즘.
// 명세: docs/goal/spin-arena-horse-style-5char.md
//
// 규칙: 캐릭터 5개 고정(1~5) → 각자 하나 고르기(중복 허용, 인원 상한 없음)
//   → 사람이 고른 캐릭터만 아레나에 출전(2~5) → 프리포올 전투 → 쓰러진 역순으로 등수(1등 = 최후 생존자)
//   → 「몇 등이 당첨인지」를 등수 투표 룰렛으로 결정 → 그 등수 캐릭터를 고른 사람(들)이 당첨
//   → 당첨자가 2명 이상이면 그 사람들끼리 재경기(한 명이 남을 때까지).
// 경마와 다른 점: 무투표 시 꼴등 fallback이 없다. 유효표가 0이면 1..n 균등 추첨으로 "무조건 룰렛을 돌린다".
//
// 폐기: 1v1 듀얼 브래킷 토너먼트(~2026-09-06). MAX_SLOTS(24)·bye·라운드 연출 비트도 함께 폐기.
// 유지: 전투 코어(칼날 선분 판정·HP 드레인·넉백·탄성 충돌·링 하드월·중앙 인력·시드 PRNG).
// 결과(등수·당첨 등수·자동 배정·인원 분할)는 전적으로 서버가 결정 — 클라는 받은 값으로 연출만(공정성).
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const { getOwned } = require('../db/cosmetics');   // 스킨 소유 검증(꾸미기 상점) — 시뮬/결과 경로 미사용

// ─── 공유 상수 (js/spin-arena.js 상단과 반드시 동일 값) ───
// ─ 아레나(논리 좌표 고정, CSS 반응형) ─
const ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240;
const ARENA_R = 220;              // 바깥벽 반경 (= RING_R_START)

// ─ 캐릭터/인원 ─
const SPIN_MIN_PLAYERS = 2;       // 시작 최소 인원
const SPIN_MAX_PLAYERS = 24;      // 참가 상한(준비 선착) — 전원 참가 모델이라 상한이 다시 필요하다
const FINALIST_COUNT = 4;         // 「최후의 4인」 — Stage1은 이 인원이 남는 순간 멈춘다

// ─ 시간축 ─
const COUNTDOWN_MS = 4000;        // 클라 3-2-1-START 카운트다운 실측(1000ms×4) — js/spin-arena.js 와 동일 값
const SIM_DT_MS = 20;             // 내부 시뮬 스텝(50fps)
const SAMPLE_MS = 100;            // 키프레임 샘플 간격 → frames 길이 = (durationMs/SAMPLE_MS + 1) × n × 3
const SIM_YIELD_EVERY = 200;      // 이 스텝마다 await setImmediate (CPU 양보)

// ─ 전투 시간(2스테이지) ─
const STAGE1_MAX_MS = 45000;      // Stage1 캡 — 이 시각까지 FINALIST_COUNT명에 못 닿으면 HP 낮은 순으로 강제 탈락
const TRANSITION_MS = 3200;       // Stage1 종료 → 결승 시작. 전투·이동 정지 구간. 클라가 「최후의 4인!」 낙하 연출.
const FINALE_MAX_MS = 38000;      // 결승 캡(결승 시작 기준) — 이 시각까지 1명이 안 남으면 HP 낮은 순으로 강제 탈락.
                                  // HP를 올리면 이 값도 같이 올려야 한다. 안 그러면 KO 전에 캡이 먼저 온다.
const ELIM_TAIL_MS = 1600;        // 마지막 탈락 후 결판 비트 길이 — durationMs = lastElimMs + tail (SAMPLE_MS 격자)
const GAME_MS = 95000;            // durationMs 하드 캡(sanity) — Stage1 45s + 전환 3.2s + 결승 32s + tail 여유

// ─ 룰렛(등수 추첨) 연출 — 경마(socket/horse.js)와 같은 값·같은 순서 ─
const ROULETTE_ANIM_MS = 5500;    // 등수 룰렛 애니메이션 길이
const ROULETTE_HOLD_MS = 1200;    // 룰렛 정지 후 결과를 읽는 시간

// ─ 연출 타이밍 ─
const RESULT_HOLD_MS = 2200;      // 리플레이 끝난 뒤 결과 오버레이 전 여유(클라 자체 처리)
const SPIN_RESET_DELAY = 4500;    // gameEnd 후 다음 판 리셋까지(서버)
const HISTORY_MAX = 100;

// ─ 캐릭터/칼날 ─
const CHAR_RADIUS = 14;
const BLADE_COUNT = 2;            // 칼날 수(캐릭터당 고정)
const BLADE_RADIUS = 46;          // 캐릭터 중심 → 칼날 끝 거리
const SWORD_LEN = 28;             // 도신(검 날) 길이 — 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN. 클라 검 그리기와 동일(보이는 검 = 맞는 검)
const BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 클라 도신 반폭 정합. 판정 = 날 선분 vs 몸 원
const BLADE_SPIN_MIN = 3.5, BLADE_SPIN_MAX = 6.0;   // rad/s (시드 PRNG 파생)

// ─ 체력/데미지 ─
// 전투 길이 튜닝(2026-09-06 실측) — 이전 HP 100에서는 2명 방이 7.9s, 4명이 6.9s로 너무 빨리 끝났다.
// HP만 크게 올리면(400+) 2명 판의 92%가 결승 캡에 걸려 KO가 아니라 강제 판정으로 끝나므로,
// HP·결승 링 수축·결승 캡을 함께 올려야 한다. 아래 조합은 25판×8가지 인원 측정에서 강제 판정 0건.
//   결과: 2명 18.5s / 4명 14.0s / 6~24명 전체 34.6~38.2s (Stage1 ~18-20s + 결승 ~14s)
const HP_MAX = 350;               // hpFrames 분모 = HP_MAX
const HIT_DPS = 300;              // 결승 칼날→상대 HP 초당 데미지. 2인 듀얼 시절 200시드 배치로 잡은 값 — 그대로 유지.
// Stage1은 인원이 많아 칼날이 사방에 있다 → 결승과 같은 DPS면 24명이 3초 만에 정리된다(측정).
// 492a8c7도 Stage1 전용 DPS(80)를 따로 뒀다. 여기서는 탈락형이라 그보다 조금 더 낮춘다.
// Stage1은 넓은 아레나를 로밍하며 스쳐 지나가는 교전이라, 결승처럼 오래 붙어 있지 않는다.
// DPS가 낮으면(60) 아무도 안 죽어 Stage1이 45s 캡에 100% 걸렸다 — 한 번의 클래시가 유효타가 되게 올렸다.
// 이 값에서 실측: n=6 11.3s / n=10 16.4s / n=24 23.9s, 캡 0건, 퍼짐 158~186px.
const STAGE1_HIT_DPS = 600;       // Stage1 칼날→상대 HP 초당 데미지(기준 인원에서)
// 인원이 늘면 한 사람이 동시에 맞는 칼날 수도 같이 늘어 실효 피해가 중첩된다 → 그대로 두면
// 인원이 많을수록 Stage1이 짧아진다(측정: 24명 5.5s < 5명 9s). 기준 인원으로 정규화해 뒤집는다.
const STAGE1_DPS_REF_N = 6;       // 이 인원에서 STAGE1_HIT_DPS를 그대로 쓴다
const STAGE1_DPS_MIN_SCALE = 0.3; // 정규화 하한 — 너무 낮추면 타격이 안 먹는 느낌이 된다
function stage1DpsFor(n) {
    return STAGE1_HIT_DPS * Math.max(STAGE1_DPS_MIN_SCALE, Math.min(1, STAGE1_DPS_REF_N / n));
}

// ─ 링/이동 — 단계별 반경 스케줄. 기준값은 492a8c7(2스테이지 시절)에서 가져왔다. ─
// Stage1은 탈락형이라 종료 시점을 미리 알 수 없다 → 수축을 "경과 시간" 기준으로 돌린다.
// 페이싱이 어긋나면 시드 배치로 재튜닝할 것(이 값들은 배치 스윕이 아니라 설계 판단).
const RING_R_START = 220;         // 시작 반경 = 바깥벽
const RING_R_END = 60;            // 결승 최종 반경 — 4인이라도 강제 교전이 일어나게 좁힘
const RING2_SHRINK_MS = 20000;    // 결승 수축(결승 시작 기준, 220 → 60). 느릴수록 초반에 거리를 두고 붙는다.
const START_R_MARGIN = 6;         // 배치 반경 = ring - charR - 이 값
// ─ 성향(disposition) ─
// 유저는 카테고리(공격형/방어형)만 고르고, 세부 성향은 서버가 굴린다.
// 세부 성향은 "목표 지점"을 고르는 규칙만 다르다 — 이동 물리는 전부 공통이다.
const DISP_ATTACK = 'atk', DISP_DEFEND = 'def';
const DISP_CATEGORIES = [DISP_ATTACK, DISP_DEFEND];
const DISP_SUBS = {
    atk: ['rusher', 'hunter', 'brawler'],   // 돌격 / 사냥 / 난입
    def: ['evader', 'drifter', 'stalker']   // 회피 / 배회 / 관망
};
const DISP_SUB_LABEL = {
    rusher: '돌격', hunter: '사냥', brawler: '난입',
    evader: '회피', drifter: '배회', stalker: '관망'
};
const DISP_CAT_LABEL = { atk: '공격형', def: '방어형' };
const STALKER_KEEP_R = 95;        // 관망 — 유지하려는 거리(px)
const RETARGET_MS = 600;          // 목표 재계산 주기 — 매 스텝 고르면 목표가 떨려 움직임이 지저분해진다
const STEER_SPEED = 96;           // 목표를 향한 순항 속도(px/s)
const STEER_ACCEL = 3.2;          // 목표 방향으로 붙는 가속(1/s)
// 도주는 추격보다 느리다 — 안 그러면 방어형끼리 있는 방에서 아무도 안 잡혀 Stage1이 캡(45s)까지 간다(측정).
const FLEE_SPEED_MUL = 0.78;
// 후반 압박 — 맵(링)은 그대로 두고, 시간이 갈수록 전원을 중앙으로 약하게 민다.
// 방어형만 있는 방도 결국 붙게 만드는 장치. 링을 줄이지 않으므로 화면은 계속 넓다.
const PRESSURE_START_MS = 10000;  // 이 시각부터 압박이 붙기 시작
const PRESSURE_FULL_MS = 34000;   // 이 시각에 최대
const PRESSURE_MAX = 150;         // 최대 중앙 가속(px/s²)
const FLEE_CHOKE = 0.65;          // 압박이 최대일 때 도주 속도를 이만큼 깎는다 — 방어형만 있는 방도 결국 붙게
// ─ 밸런스 노브 ─ 오직 성향별 벌칙 확률을 맞추기 위한 값이다(연출이 아니다).
// 회피는 그 자체로 생존을 낳아서, 손대지 않으면 방어형 결승진출 73% vs 공격형 7%가 나온다(측정).
// 그래서 Stage1에서만 "공격형은 버티고 방어형은 약하다"를 준다 — 읽히는 트레이드오프이면서
// 결승 진출 확률을 맞추는 유일한 레버다. **결승은 배율 없이 공정한 맞대결**로 둬서
// 1등 확률을 따로 맞춘다(둘을 한 노브로 맞추려 하면 한쪽이 반드시 깨진다 — 측정으로 확인).
const DISP_DMG_TAKEN_MUL = { atk: 0.4, def: 2.6 };   // Stage1 전용
const DISP_DMG_DEALT_MUL = { atk: 1.0, def: 1.0 };   // Stage1 전용

// ─ Stage1 이동 = 로밍(wander) — 이제는 목표가 없을 때만 쓰는 폴백이다 ─
// 여기서 시도했다 버린 것들(전부 측정으로 기각):
//   · 중앙 인력  → 전원이 한 점 blob으로 뭉친다.
//   · 동심 궤도  → 원끼리 교차하지 않아 서로 못 만나고 Stage1이 캡(45s)까지 늘어졌다(12/12).
// 각자 고유 방향으로 아레나를 가로지르고 벽에서 튕긴다 → 경로가 교차하며 자연히 교전이 생긴다.
// 방향/회전율/속도는 전부 이미 소비한 시드 필드에서 파생 → rng 추가 소비 0회(FROZEN 소비 순서 불변).
const WANDER_SPEED = 78;          // 로밍 순항 속도(px/s) — 아레나(반경 220) 횡단에 ~5s
const WANDER_ACCEL = 2.4;         // 순항 속도로 복귀하는 가속(1/s) — 넉백 후 다시 제 갈 길로
const WANDER_TURN_MIN = 0.10, WANDER_TURN_MAX = 0.42;   // 진행 방향 회전율(rad/s) — 직선만 달리지 않게
const WANDER_CENTER_BIAS = 26;    // 아주 약한 중앙 복귀(px/s²) — 전원이 벽에만 붙어 도는 걸 막는 정도
const SPEED_MUL_MIN = 0.75, SPEED_MUL_MAX = 1.25;    // 드리프트 속도 배율(spinSpeed 정규화)
const PULL_MUL_MIN = 0.80, PULL_MUL_MAX = 1.20;      // 중앙 인력 배율(baseAngle 정규화) — 경로 다양화
const FINALE_PULL = 200;          // 결승 중앙 인력 — 4인을 붙여 결판을 보장하되, 즉시 뭉개지지는 않게
const SPIN_DRAG = 0.45;           // 드리프트 선형 감쇠(/s) — 인력만 있으면 보존계 영구 진동 → 나선 수렴
const WALL_BOUNCE = 0.9;          // 벽(링 하드 월) 반사 감쇠

// ─ 캐릭터 충돌 바운스 — 위치 디오버랩 + 탄성 속도 교환(팅겨짐). 결정론(rng 0회). ─
const COLLIDE_MARGIN = 12;        // 충돌 판정 여유(px). minD = 2*charR + COLLIDE_MARGIN
const COLLIDE_RESTITUTION = 1.3;  // 반발 계수 — 드리프트 속도(vx/vy)에만 적용(넉백 kvx/kvy 불변)
const COLLIDE_POP = 10;           // 최소 분리 임펄스(px/s) — rel≈0(느린 접촉)에도 법선 방향으로 팝을 줘 가시적 분리

// ─ 넉백(서버 시뮬 실제 반영 — 칼끝→몸 임펄스, 전부 결정론) ─
const KNOCK_IMPULSE = 80;         // 피격 틱당 가산 속도(px/s) — 맞으면 좀 더 튕겨 나가 교전이 끊겼다 이어진다
const KNOCK_MAX = 110;            // 넉백 속도 크기 상한(px/s)
const KNOCK_DECAY = 3.0;          // 지수 감쇠(/s)


// ─── 링 반경 스케줄 (클라 js/spin-arena.js 의 동명 함수와 반드시 동일 식) ───
// 492a8c7의 ringRadiusAt(t, round1EndMs) 구조를 그대로 가져오되, Stage1이 타임박스가 아니라
// 탈락형이라 Stage1 수축은 "경과 시간" 기준으로 돈다(종료 시점을 미리 알 수 없으므로).
// ⚠ twoStage를 반드시 넘겨라. stage1EndMs === null 은 뜻이 둘이다 —
//   "단일 단계 매치"이기도 하고 "2스테이지인데 Stage1이 아직 안 끝났다"이기도 하다.
//   구분하지 않아서 Stage1 내내 결승 스케줄로 벽이 220→60까지 조여들었다(2026-09-07 측정으로 발견).
//   twoStage && (stage1EndMs 미정 || t < stage1EndMs) → Stage1: 수축 없음(RING_R_START 고정)
//   !twoStage                                         → 단일 단계: 처음부터 결승 스케줄
//   전환 구간                                          → 링 풀(RING_R_START)
//   그 이후                                            → 결승: RING_R_START → RING_R_END
function ringRadiusAt(t, stage1EndMs, finaleStartMs, twoStage) {
    // Stage1은 수축하지 않는다 — 넓은 맵에서 흩어져 싸우게 둔다(소유자 결정 2026-09-07).
    // 종반은 링이 아니라 탈락으로 만들어진다: 4명이 남는 순간 Stage1이 끝난다.
    if (twoStage && (stage1EndMs === null || stage1EndMs === undefined || t < stage1EndMs)) {
        return RING_R_START;
    }
    if (stage1EndMs === null || stage1EndMs === undefined) {
        const k = Math.min(1, Math.max(0, t / RING2_SHRINK_MS));
        return RING_R_START + (RING_R_END - RING_R_START) * k;
    }
    if (t < finaleStartMs) return RING_R_START;
    const k = Math.min(1, Math.max(0, (t - finaleStartMs) / RING2_SHRINK_MS));
    return RING_R_START + (RING_R_END - RING_R_START) * k;
}
// ─── 스킨 프리셋 (js/spin-arena.js 와 동일 값 계약 — 결과 무관, 순수 외형) ───
// 24색 × (t1 + t2 스킨업). 캐릭터 색 = 그 캐릭터 첫 소유자의 스킨, 없으면 base tier1 팔레트를 번호순으로.
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
// 캐릭터 기본 팔레트 = base tier1 (캐릭터는 최대 5개 — 번호순으로 앞 5색이 기본값)
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

// 세부 성향별 목표 지점. 반환 { tx, ty, flee } — flee면 그 지점에서 멀어진다.
// alive는 자기 자신을 제외한 살아있는 캐릭터 배열. 없으면 null(폴백 로밍).
function pickSteerTarget(c, alive) {
    if (alive.length === 0) return null;
    let best = null, bestScore = Infinity;
    switch (c.dispSub) {
        case 'rusher': {   // 가장 가까운 상대
            for (const o of alive) {
                const d = Math.hypot(o.x - c.x, o.y - c.y);
                if (d < bestScore) { bestScore = d; best = o; }
            }
            return { tx: best.x, ty: best.y, flee: false };
        }
        case 'hunter': {   // HP 낮은 상대 우선(거리로 가중 — 지구 반대편까지 쫓지는 않게)
            for (const o of alive) {
                const d = Math.hypot(o.x - c.x, o.y - c.y);
                const score = o.hp * 2 + d;
                if (score < bestScore) { bestScore = score; best = o; }
            }
            return { tx: best.x, ty: best.y, flee: false };
        }
        case 'brawler': {   // 사람이 가장 많이 모인 쪽 — 이웃 밀도가 가장 높은 캐릭터의 위치
            for (const o of alive) {
                let near = 0;
                for (const q of alive) if (q !== o && Math.hypot(q.x - o.x, q.y - o.y) < 120) near++;
                const score = -near * 100 + Math.hypot(o.x - c.x, o.y - c.y) * 0.3;
                if (score < bestScore) { bestScore = score; best = o; }
            }
            return { tx: best.x, ty: best.y, flee: false };
        }
        case 'evader': {   // 가장 가까운 상대에게서 멀어진다
            for (const o of alive) {
                const d = Math.hypot(o.x - c.x, o.y - c.y);
                if (d < bestScore) { bestScore = d; best = o; }
            }
            return { tx: best.x, ty: best.y, flee: true };
        }
        case 'drifter': {   // 사람이 가장 적은 빈 공간 — 후보 지점 중 최근접 상대가 가장 먼 곳
            let bx = ARENA_CX, by = ARENA_CY, bd = -1;
            for (let k = 0; k < 8; k++) {
                const a = (2 * Math.PI * k) / 8 + c.baseAngle;
                const rr = (RING_R_START - CHAR_RADIUS) * 0.62;
                const px = ARENA_CX + Math.cos(a) * rr, py = ARENA_CY + Math.sin(a) * rr;
                let nd = Infinity;
                for (const o of alive) nd = Math.min(nd, Math.hypot(o.x - px, o.y - py));
                if (nd > bd) { bd = nd; bx = px; by = py; }
            }
            return { tx: bx, ty: by, flee: false };
        }
        case 'stalker':
        default: {   // 중간 거리 유지 — 가까우면 물러나고 멀면 붙는다
            for (const o of alive) {
                const d = Math.hypot(o.x - c.x, o.y - c.y);
                if (d < bestScore) { bestScore = d; best = o; }
            }
            return { tx: best.x, ty: best.y, flee: bestScore < STALKER_KEEP_R };
        }
    }
}

/**
 * 2스테이지 매치 시뮬레이션 — 참고 구현: 492a8c7(Stage1 → 전환 → 결승).
 * async로 주기적 setImmediate 양보(CPU). 결과는 한 시드로 전부 사전 계산, 클라는 리플레이만.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ 박제(FROZEN) — rng() 소비 순서. 재배열하면 모든 시드가 깨진다. 변경 금지.      │
 * │  1) 좌석 셔플: Fisher-Yates(슬롯 0..n-1), 정확히 n-1회.                       │
 * │  2) 슬롯마다 baseAngle → spinSpeed → spinDir, **좌석 순서로** 3n회.           │
 * │  2b) 슬롯마다 세부 성향 1회(좌석 순서) — n회. 기존 소비 뒤라 앞 순서 불변.  │
 * │  3) 결승 진출자 재배치 각도 오프셋 1회(2스테이지일 때만).                      │
 * │  → 총 소비 = (n-1) + 3n + n + (2스테이지면 1).                                 │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 배열은 **좌석 순서**로 만든다. 슬롯 번호 순으로 만들면 separateChars의 인덱스 편향과
 * PRNG 스트림 위치가 슬롯 번호에 붙어 실제로 불공정해진다(측정: chi²=15.4, p<.01 — 이전 goal 참조).
 *
 * 흐름:
 *   n > FINALIST_COUNT (2스테이지):
 *     Stage1  0 ~ stage1EndMs      전원 난투. HP 0 = 탈락. 정확히 FINALIST_COUNT명 남으면 즉시 종료.
 *     전환    stage1EndMs ~ finaleStartMs   전투·이동 정지(프레임 동결) — 클라가 「최후의 4인!」 연출.
 *     결승    finaleStartMs ~      진출자만 재배치 후 좁아지는 링에서 난투. 마지막 생존자 = 1등.
 *   n <= FINALIST_COUNT (단일 단계): 전환 없이 결승 스케줄로 바로 최후 1인까지.
 *
 * 등수: 최후 생존자 1등, 먼저 탈락할수록 낮은 등수(n등부터 역순).
 * @param dispCats 슬롯별 성향 카테고리 배열('atk'|'def'). 없으면 전원 'atk'(테스트 편의).
 * @returns { n, seats, frames, blades, elimOrder, rankings, stage1EndMs, finaleStartMs, dispSubs,
 *            finalists, twoStage, durationMs, sampleMs, geom }
 */
async function simulateMatch(n, seed, dispCats) {
    const rng = mulberry32(seed);
    const dt = SIM_DT_MS / 1000;
    const charR = CHAR_RADIUS, bladeR = BLADE_RADIUS, swordLen = SWORD_LEN, bladeEdgeR = BLADE_EDGE_R;
    const twoStage = n > FINALIST_COUNT;
    const finaleCount = twoStage ? FINALIST_COUNT : n;
    const stage1Dps = stage1DpsFor(n);   // 인원 정규화 — 많을수록 한 방이 약해져 Stage1 길이가 유지된다

    // 1) 좌석 셔플 — seats[k] = k번 자리에 앉을 슬롯 번호
    const seats = [];
    for (let i = 0; i < n; i++) seats.push(i);
    for (let i = n - 1; i >= 1; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = seats[i]; seats[i] = seats[j]; seats[j] = tmp;
    }

    // 2) 좌석 순서로 캐릭터 생성 — 각도는 좌석 균등, 반경은 각자의 궤도(2스테이지일 때).
    //    전원을 링 가장자리에 세우면 자기 궤도로 끌려오면서 중앙까지 오버슛한다(측정: 2초 만에 53px).
    const edgeR = Math.max(0, RING_R_START - charR - START_R_MARGIN);
    const chars = seats.map((slotId, seatIdx) => {
        const ang0 = (2 * Math.PI * seatIdx) / n;
        const baseAngle = rng() * 2 * Math.PI;
        const spinSpeed = BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN);
        const spinDir = rng() < 0.5 ? 1 : -1;
        // 시작 반경도 흩뿌린다 — 전원 가장자리에 세우면 첫 몇 초가 텅 빈 원처럼 보인다.
        const startR = (n > FINALIST_COUNT) ? edgeR * (0.45 + (baseAngle / (2 * Math.PI)) * 0.5) : edgeR;
        return {
            slotId, seat: seatIdx, hp: HP_MAX, received: 0,
            x: ARENA_CX + Math.cos(ang0) * startR, y: ARENA_CY + Math.sin(ang0) * startR,
            vx: 0, vy: 0, kvx: 0, kvy: 0, dead: false,
            baseAngle, spinSpeed, spinDir,
            // ↓ 전부 위 세 필드에서 파생 — rng 추가 소비 0회(FROZEN 소비 순서 불변)
            dispCat: (dispCats && dispCats[slotId]) || DISP_ATTACK,
            dispSub: null,          // 아래에서 좌석 순서로 굴린다
            steerT: -1e9,           // 목표 재계산 시각
            steerTx: 0, steerTy: 0, steerFlee: false,
            // 로밍 — 진행 방향은 배치 각도에서 90° 튼 값(곧장 벽으로 나가지 않게), 회전율은 spinSpeed 파생.
            heading: ang0 + Math.PI / 2 + baseAngle * 0.5,
            turnRate: spinDir * (WANDER_TURN_MIN + ((spinSpeed - BLADE_SPIN_MIN) / (BLADE_SPIN_MAX - BLADE_SPIN_MIN)) * (WANDER_TURN_MAX - WANDER_TURN_MIN)),
            speedMul: SPEED_MUL_MIN + ((spinSpeed - BLADE_SPIN_MIN) / (BLADE_SPIN_MAX - BLADE_SPIN_MIN)) * (SPEED_MUL_MAX - SPEED_MUL_MIN),
            pullMul: PULL_MUL_MIN + (baseAngle / (2 * Math.PI)) * (PULL_MUL_MAX - PULL_MUL_MIN)
        };
    });
    // 3) 결승 재배치 각도 오프셋 — 진출자가 늘 같은 자리에 서지 않게(2스테이지만 소비)
    const finaleAngle0 = twoStage ? rng() * 2 * Math.PI : 0;

    // 2b) 세부 성향 — 고른 카테고리 안에서 서버가 굴린다(유저는 카테고리만 고른다).
    for (const c of chars) {
        const subs = DISP_SUBS[c.dispCat] || DISP_SUBS[DISP_ATTACK];
        c.dispSub = subs[Math.floor(rng() * subs.length)];
    }

    // 클라로 나가는 frames/blades는 **슬롯 번호 오름차순 고정** — 클라는 위치로 매핑한다.
    const emitOrder = chars.slice().sort((a, b) => a.slotId - b.slotId);

    const charBySlot = {};
    for (const c of chars) charBySlot[c.slotId] = c;

    const frames = [];
    const elimOrder = [];
    let aliveCount = n;
    let stage1EndMs = null;
    let finaleStartMs = 0;      // 단일 단계는 0부터 결승 스케줄
    let endMs = null;           // 확정 전 null
    let nextSampleMs = 0;

    function sample() {
        for (const c of emitOrder) {
            frames.push(Math.round(c.x), Math.round(c.y), Math.max(0, Math.round(c.hp)));
        }
    }
    // 링 반경 — t와 stage1EndMs만으로 결정(클라 미러 함수와 반드시 동일 식).
    function ringAt(tMs) {
        return ringRadiusAt(tMs, stage1EndMs, finaleStartMs, twoStage);
    }
    function buildBlades(tMs, wallR) {
        void wallR;
        const blades = [];
        for (const c of chars) {
            if (c.dead) continue;
            for (let k = 0; k < BLADE_COUNT; k++) {
                const a = c.baseAngle + c.spinDir * c.spinSpeed * (tMs / 1000) + k * (2 * Math.PI / BLADE_COUNT);
                const ca = Math.cos(a), sa = Math.sin(a);
                blades.push({
                    owner: c.slotId,
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
    function integrate(c, wallR, speedMul) {
        const sm = speedMul || 1;
        c.vx -= c.vx * SPIN_DRAG * dt; c.vy -= c.vy * SPIN_DRAG * dt;
        c.x += (c.vx * sm + c.kvx) * dt; c.y += (c.vy * sm + c.kvy) * dt;
        const nd = Math.hypot(c.x - ARENA_CX, c.y - ARENA_CY);
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
    // 살아있는 모든 쌍의 디오버랩 + 탄성 바운스 + 링 재클램프. rng 0회.
    function separateChars(wallR) {
        const minD = 2 * charR + COLLIDE_MARGIN;
        for (let i = 0; i < chars.length; i++) {
            const ci = chars[i];
            if (ci.dead) continue;
            for (let j = i + 1; j < chars.length; j++) {
                const cj = chars[j];
                if (cj.dead) continue;
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
    function eliminate(c, tMs) {
        c.hp = 0; c.dead = true;
        c.vx = 0; c.vy = 0; c.kvx = 0; c.kvy = 0;
        elimOrder.push({ slotId: c.slotId, atMs: tMs });
        aliveCount--;
    }
    // worst-first — hp↑ → received↑ → 좌석↑. 마지막 키를 슬롯 번호로 두면 편향이 된다.
    function worstFirst(list) {
        return list.slice().sort((a, b) => (a.hp - b.hp) || (a.received - b.received) || (a.seat - b.seat));
    }
    // 결승 진출자를 링 가장자리에 균등 재배치 — 장면 전환("4명만 한 화면")의 실체.
    function seatFinalists() {
        const alive = chars.filter(c => !c.dead);
        const r = Math.max(0, RING_R_START - charR - START_R_MARGIN);
        // 좌석 순서로 배치 — 슬롯 번호와 자리의 상관을 끊는다.
        const ordered = alive.slice().sort((a, b) => a.seat - b.seat);
        ordered.forEach((c, i) => {
            const ang = finaleAngle0 + (2 * Math.PI * i) / ordered.length;
            c.x = ARENA_CX + Math.cos(ang) * r;
            c.y = ARENA_CY + Math.sin(ang) * r;
            c.vx = 0; c.vy = 0; c.kvx = 0; c.kvy = 0;
            c.hp = HP_MAX; c.received = 0;   // 결승은 만HP에서 새로 시작 — Stage1 피해가 결승을 좌우하지 않게
            // 칼날도 새로 굴린다. Stage1은 특정 칼날 특성(회전 속도 등)을 가진 캐릭터를 골라 올려보내는데,
            // 그 특성이 결승에서도 유리하게 작용해 성향별 1등 확률에 ~1pp 기울기가 생겼다(4트라이얼 전부 공격형 우세).
            // 여기서 새로 굴리면 Stage1의 선택 효과가 결승으로 새지 않는다 — 결승은 진짜 새 판이다.
            c.baseAngle = rng() * 2 * Math.PI;
            c.spinSpeed = BLADE_SPIN_MIN + rng() * (BLADE_SPIN_MAX - BLADE_SPIN_MIN);
            c.spinDir = rng() < 0.5 ? 1 : -1;
            c.speedMul = SPEED_MUL_MIN + ((c.spinSpeed - BLADE_SPIN_MIN) / (BLADE_SPIN_MAX - BLADE_SPIN_MIN)) * (SPEED_MUL_MAX - SPEED_MUL_MIN);
            c.pullMul = PULL_MUL_MIN + (c.baseAngle / (2 * Math.PI)) * (PULL_MUL_MAX - PULL_MUL_MIN);
        });
    }

    let finalistsSeated = false;

    for (let step = 0; ; step++) {
        const tMs = step * SIM_DT_MS;
        if (tMs >= nextSampleMs) { sample(); nextSampleMs += SAMPLE_MS; }
        if (endMs !== null && tMs >= endMs) break;

        const inTransition = (stage1EndMs !== null && tMs >= stage1EndMs && tMs < finaleStartMs);
        // 전환 구간: 전투·이동 전부 정지(프레임 동결). 클라가 이 구간에 「최후의 4인!」을 연출한다.
        if (inTransition) {
            if (step > 0 && (step % SIM_YIELD_EVERY) === 0) await new Promise(r => setImmediate(r));
            continue;
        }
        // 전환이 막 끝난 첫 스텝에 진출자를 재배치한다(장면 전환).
        if (stage1EndMs !== null && !finalistsSeated && tMs >= finaleStartMs) {
            seatFinalists();
            finalistsSeated = true;
        }

        const wallR = ringAt(tMs) - charR;
        const inStage1 = (stage1EndMs === null && twoStage);
        const target = inStage1 ? FINALIST_COUNT : 1;   // 이 단계에서 몇 명 남으면 멈추는가
        const pull = FINALE_PULL;   // Stage1은 궤도 스프링을 쓰므로 중앙 인력을 안 쓴다
        const dps = inStage1 ? stage1Dps : HIT_DPS;
        const phaseCapMs = inStage1 ? STAGE1_MAX_MS : (finaleStartMs + FINALE_MAX_MS);

        if (aliveCount > target) {
            const blades = buildBlades(tMs, wallR);
            for (const c of chars) {
                if (c.dead) continue;
                let dmgSum = 0;
                for (const bl of blades) {
                    if (bl.owner === c.slotId) continue;
                    const sx = bl.ox - bl.ix, sy = bl.oy - bl.iy;
                    let tt = ((c.x - bl.ix) * sx + (c.y - bl.iy) * sy) / (swordLen * swordLen);
                    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                    const dx = c.x - (bl.ix + sx * tt), dy = c.y - (bl.iy + sy * tt);
                    if (dx * dx + dy * dy < (charR + bladeEdgeR) * (charR + bladeEdgeR)) {
                        // 때린 쪽 성향의 가한 피해 배율 — 밸런스 노브
                        const attacker = charBySlot[bl.owner];
                        const dealtMul = (inStage1 && attacker) ? (DISP_DMG_DEALT_MUL[attacker.dispCat] || 1) : 1;
                        dmgSum += dps * dt * dealtMul;
                        applyKnock(c, dx, dy);
                    }
                }
                if (dmgSum > 0) {
                    // 밸런스 노브는 Stage1에만. 결승은 배율 없는 공정한 맞대결.
                    if (inStage1) dmgSum *= (DISP_DMG_TAKEN_MUL[c.dispCat] || 1);
                    c.received += dmgSum; c.hp -= dmgSum;
                }
            }

            const downed = chars.filter(c => !c.dead && c.hp <= 0);
            if (downed.length > 0) {
                const order = worstFirst(downed);
                // 목표 인원 아래로는 절대 안 내려간다 — 같은 틱에 여럿이 쓰러져도 target명은 남긴다.
                const maxKill = aliveCount - target;
                const killCount = Math.min(downed.length, maxKill);
                for (let i = 0; i < killCount; i++) eliminate(order[i], tMs);
            }
            // 단계 캡 — 이 시각까지 목표 인원에 못 닿으면 HP 낮은 순으로 강제 탈락
            if (aliveCount > target && tMs >= phaseCapMs - SIM_DT_MS) {
                const rest = worstFirst(chars.filter(c => !c.dead));
                const need = aliveCount - target;
                for (let i = 0; i < need; i++) eliminate(rest[i], tMs);
            }
        }

        // 단계 종료 판정
        if (aliveCount <= target) {
            if (inStage1) {
                // 정확히 이 시각에 끊는다. SAMPLE_MS 격자로 올림하면 그 사이 스텝이 이미 결승 규칙(target=1)으로
                // 돌아 전환 전에 탈락자가 생긴다(측정: n=5~24에서 결승 진출자가 Stage1 구간에 탈락).
                stage1EndMs = tMs;
                finaleStartMs = stage1EndMs + TRANSITION_MS;
            } else if (endMs === null) {
                endMs = Math.min(GAME_MS, Math.ceil((tMs + ELIM_TAIL_MS) / SAMPLE_MS) * SAMPLE_MS);
            }
        }

        // 이동 — 중앙 인력(+ Stage1은 공전) + 링 클램프. 탈락자는 그 자리에 동결.
        for (const c of chars) {
            if (c.dead) continue;
            const cdx = c.x - ARENA_CX, cdy = c.y - ARENA_CY;
            const cdist = Math.hypot(cdx, cdy) || 1;
            const nx = cdx / cdist, ny = cdy / cdist;
            let ax, ay;
            // 성향 조종은 **Stage1에서만**. 결승은 성향 없는 공정한 맞대결이다 —
            // 좁아지는 링에 갇힌 4인에겐 도망칠 곳이 없다는 뜻이기도 하고,
            // 결승에서도 회피가 통하면 1등 확률이 방어형 86% vs 공격형 14%로 무너진다(측정).
            if (inStage1 && tMs - c.steerT >= RETARGET_MS) {
                c.steerT = tMs;
                const others = chars.filter(o => !o.dead && o !== c);
                const tgt = pickSteerTarget(c, others);
                if (tgt) { c.steerTx = tgt.tx; c.steerTy = tgt.ty; c.steerFlee = tgt.flee; c.hasSteer = true; }
                else { c.hasSteer = false; }
            }
            if (inStage1 && c.hasSteer) {
                const sdx = c.steerTx - c.x, sdy = c.steerTy - c.y;
                const sd = Math.hypot(sdx, sdy) || 1;
                const sign = c.steerFlee ? -1 : 1;
                // 도주 속도는 후반 압박이 커질수록 깎인다(몰린다).
                const pk0 = (inStage1 && tMs > PRESSURE_START_MS)
                    ? Math.min(1, (tMs - PRESSURE_START_MS) / (PRESSURE_FULL_MS - PRESSURE_START_MS)) : 0;
                const fleeMul = FLEE_SPEED_MUL * (1 - FLEE_CHOKE * pk0);
                const spd = STEER_SPEED * c.speedMul * (c.steerFlee ? fleeMul : 1);
                const wantVx = (sdx / sd) * sign * spd;
                const wantVy = (sdy / sd) * sign * spd;
                ax = (wantVx - c.vx) * STEER_ACCEL;
                ay = (wantVy - c.vy) * STEER_ACCEL;
                // 도망칠 때 벽에 몰리지 않게 중앙 쪽으로 약하게 되돌린다.
                if (c.steerFlee) { ax += -nx * WANDER_CENTER_BIAS * 2; ay += -ny * WANDER_CENTER_BIAS * 2; }
            } else if (inStage1) {
                // 폴백 로밍 — 목표가 없을 때만(사실상 혼자 남았을 때).
                c.heading += c.turnRate * dt;
                const wantVx = Math.cos(c.heading) * WANDER_SPEED * c.speedMul;
                const wantVy = Math.sin(c.heading) * WANDER_SPEED * c.speedMul;
                ax = (wantVx - c.vx) * WANDER_ACCEL;
                ay = (wantVy - c.vy) * WANDER_ACCEL;
                ax += -nx * WANDER_CENTER_BIAS;
                ay += -ny * WANDER_CENTER_BIAS;
            } else {
                ax = -nx * pull * c.pullMul;
                ay = -ny * pull * c.pullMul;
            }
            // 후반 압박 — Stage1에서만. 맵은 안 줄이고 전원을 중앙으로 약하게 민다.
            if (inStage1 && tMs > PRESSURE_START_MS) {
                const pk = Math.min(1, (tMs - PRESSURE_START_MS) / (PRESSURE_FULL_MS - PRESSURE_START_MS));
                ax += -nx * PRESSURE_MAX * pk;
                ay += -ny * PRESSURE_MAX * pk;
            }
            c.vx += ax * dt; c.vy += ay * dt;
            integrate(c, wallR, c.speedMul);
        }
        separateChars(wallR);

        if (step > 0 && (step % SIM_YIELD_EVERY) === 0) await new Promise(r => setImmediate(r));
    }

    // 등수 — 최후 생존자 1등, 먼저 탈락할수록 낮은 등수(n등부터 역순).
    const rankings = elimOrder.map((e, i) => ({ slotId: e.slotId, rank: n - i, atMs: e.atMs }));
    const survivor = chars.find(c => !c.dead);
    if (survivor) rankings.push({ slotId: survivor.slotId, rank: 1, atMs: null });
    rankings.sort((a, b) => a.rank - b.rank);

    // 결승 진출자 = 상위 finaleCount명(등수 1..finaleCount)
    const finalists = rankings.filter(r => r.rank <= finaleCount).map(r => r.slotId);

    return {
        n, seats, frames, elimOrder, rankings,
        stage1EndMs, finaleStartMs, finalists, twoStage,
        blades: emitOrder.map(c => ({
            slotId: c.slotId, baseAngle: c.baseAngle, spinSpeed: c.spinSpeed,
            spinDir: c.spinDir, bladeCount: BLADE_COUNT
        })),
        dispSubs: emitOrder.map(c => ({ slotId: c.slotId, cat: c.dispCat, sub: c.dispSub })),
        durationMs: endMs, sampleMs: SAMPLE_MS,
        geom: {
            charRadius: CHAR_RADIUS, bladeRadius: BLADE_RADIUS, swordLen: SWORD_LEN,
            bladeEdgeR: BLADE_EDGE_R, ringStart: RING_R_START, ringEnd: RING_R_END,
            transitionMs: TRANSITION_MS
        }
    };
}

// ─── 벌칙 등수 추첨 ───
// 경마(socket/horse.js)의 득표 비례 가중 랜덤을 그대로 쓰되, 무투표 fallback만 다르다.
// 경마: 표가 없으면 룰렛을 건너뛰고 꼴등 확정. 회전 칼날: 표가 없으면 균등 추첨 — 룰렛은 항상 돈다.
// 후보 등수는 **결승 진출자의 등수(1..FINALIST_COUNT)** 뿐이다. 1등도 후보에 포함된다(소유자 결정).
// 인원이 FINALIST_COUNT보다 적으면 후보도 그만큼 줄어든다(n명 방 = 1..n등).
// rankOrder = 표 단위 시퀀스를 셔플한 것(모든 클라가 같은 순서로 룰렛을 그린다).
// @returns { targetRank, segments, rankOrder, reason }
function resolveTargetRank(rankVotes, readyNames, n, rnd) {
    const validVotes = readyNames
        .map(name => rankVotes[name])
        .filter(rank => Number.isInteger(rank) && rank >= 1 && rank <= n);
    const totalVoteCount = readyNames.filter(name => rankVotes[name] !== undefined).length;

    let segments;
    let targetRank;
    let reason;

    if (validVotes.length > 0) {
        const tally = {};
        for (const rank of validVotes) tally[rank] = (tally[rank] || 0) + 1;
        segments = Object.entries(tally)
            .map(([rank, count]) => ({ rank: Number(rank), count }))
            .sort((a, b) => a.rank - b.rank);

        let pick = Math.floor(rnd() * validVotes.length);
        for (const seg of segments) {
            if (pick < seg.count) { targetRank = seg.rank; break; }
            pick -= seg.count;
        }
        reason = (segments.length === 1)
            ? `투표가 ${targetRank}등에만 몰려 ${targetRank}등 확정`
            : `룰렛 추첨 결과 ${targetRank}등 당첨`;
    } else {
        // 유효표 0 — 모두가 한 표씩 넣은 셈 치고 1..n 균등 추첨(꼴등 fallback 없음)
        segments = Array.from({ length: n }, (_, i) => ({ rank: i + 1, count: 1 }));
        targetRank = 1 + Math.floor(rnd() * n);
        reason = (totalVoteCount === 0)
            ? `아무도 투표하지 않아 1~${n}등을 균등 추첨했어요`
            : `출전 캐릭터가 ${n}개뿐이라 ${n + 1}등 이상 투표는 무효 — 1~${n}등을 균등 추첨했어요`;
    }

    // 표(또는 균등 후보) 단위 시퀀스 → Fisher-Yates 셔플
    const rankOrder = [];
    for (const seg of segments) {
        for (let i = 0; i < seg.count; i++) rankOrder.push(seg.rank);
    }
    for (let i = rankOrder.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = rankOrder[i]; rankOrder[i] = rankOrder[j]; rankOrder[j] = tmp;
    }

    return { targetRank, segments, rankOrder, reason };
}

// ─── 예약 발화 계약 (socket/scheduled-start.js) ───
// canStart는 순수 판정(거절 사유 문자열 또는 null). 회전 칼날은 중복 당첨 재경기를 이 경로로 자동 시작한다.
function canStartSpin(room, gameState) {
    if (!room || room.gameType !== 'spin-arena') return '회전 칼날 방이 아니에요.';
    const sa = gameState && gameState.spinArena;
    if (!sa) return '회전 칼날 상태가 없어요.';
    if (sa.phase === 'finished') return '결과 정리 중이에요. 잠시 후 다음 판을 시작해주세요.';
    // idle(빌드)에서만 시작. finished 직후엔 곧 roundReset(resetTimeout)이 phase를 idle로 되돌리며
    // 캐릭터 선택·투표를 새로 초기화한다. finished에서 바로 시작하면 clearSpinTimers가 그 resetTimeout을
    // 취소해 이전 라운드 선택이 그대로 넘어온다(사다리와 같은 함정).
    if (sa.phase !== 'idle') return '이미 게임이 진행 중이에요.';
    const ready = (gameState.readyUsers || []).filter(name =>
        gameState.users.some(u => u.name === name));
    if (ready.length < SPIN_MIN_PLAYERS) return `준비한 인원이 ${SPIN_MIN_PLAYERS}명 이상이어야 해요.`;
    return null;
}

// ─── 라운드 엔진 — 소켓 핸들러(방장 [시작])와 예약 발화(재경기 자동 시작)가 같은 경로를 쓴다 ───
function createSpinEngine(io, ctx) {
    const { updateRoomsList } = ctx;

    function clearSpinTimers(sa) {
        if (sa.playTimeout) { clearTimeout(sa.playTimeout); sa.playTimeout = null; }
        if (sa.endTimeout) { clearTimeout(sa.endTimeout); sa.endTimeout = null; }
        if (sa.resetTimeout) { clearTimeout(sa.resetTimeout); sa.resetTimeout = null; }
    }

    function resetSpin(sa) {
        clearSpinTimers(sa);
        sa.phase = 'idle';
        sa.skins = {};
        sa.rankVotes = {};
        sa.dispositions = {};
        sa.participants = [];
        sa.timeline = null;
        sa.result = null;
        sa.seed = 0;
        sa.isActive = false;
    }

    // 준비하고 현재 방에 있는 사람 이름 — 입장 순서(gameState.users 순).
    // 캐릭터 "첫 소유자"(색/스킨 결정)도 이 순서를 따른다.
    function readyNamesInOrder(gameState) {
        return gameState.users
            .filter(u => (gameState.readyUsers || []).includes(u.name))
            .map(u => u.name);
    }

    // 출전 캐릭터의 표시 정보 — 색/칼날색은 그 캐릭터를 고른 첫 소유자의 스킨, 없으면 번호순 기본 팔레트.
    // 사다리 레인 토큰(js/ladder.js)의 "owners[0] 기준" 규칙과 같은 결이다. 시뮬/판정과는 무관(순수 외형).
    function buildCharMeta(entrants, chars, gameState, skins) {
        return entrants.map(ci => {
            const owners = gameState.users.filter(u => chars[u.name] === ci).map(u => u.name);
            const firstSkinId = owners.map(nm => skins[nm]).find(id => isValidSkinId(id));
            const sk = skinById(firstSkinId) || BASE_SKINS[ci % BASE_SKINS.length];
            return {
                charIndex: ci,
                owners,
                label: owners.length > 1 ? `${owners[0]} 외 ${owners.length - 1}명` : (owners[0] || ''),
                skinId: sk.id, color: sk.color, blade: sk.blade, tier: sk.tier || 1,
                bladeCount: BLADE_COUNT
            };
        });
    }

    // 준비자 → 참가 슬롯. 입장 순서로 선착 SPIN_MAX_PLAYERS명. 슬롯 번호 = 이 배열의 인덱스.
    // 스킨은 명시 선택 우선, 없으면 base 팔레트에서 아직 안 쓴 색을 순차 배정(24명까지 전부 구분).
    function buildPlayers(readyNames, gameState) {
        const sa = gameState.spinArena;
        const names = readyNames.slice(0, SPIN_MAX_PLAYERS);
        const used = new Set();
        names.forEach(nm => { if (isValidSkinId(sa.skins[nm])) used.add(sa.skins[nm]); });
        const autoPool = BASE_SKINS.filter(sk => !used.has(sk.id)).map(sk => sk.id);
        let api = 0;
        return names.map((nm, i) => {
            const sel = sa.skins[nm];
            const skinId = isValidSkinId(sel)
                ? sel
                : (api < autoPool.length ? autoPool[api++] : BASE_SKINS[i % BASE_SKINS.length].id);
            const sk = skinById(skinId) || BASE_SKINS[0];
            const cat = (sa.dispositions[nm] === DISP_DEFEND) ? DISP_DEFEND : DISP_ATTACK;
            return {
                slotId: i, name: nm, skinId: sk.id,
                color: sk.color, blade: sk.blade, tier: sk.tier || 1,
                bladeCount: BLADE_COUNT,
                dispCat: cat, dispCatLabel: DISP_CAT_LABEL[cat]
            };
        });
    }

    // 한 라운드 시작 — 벌칙 등수 룰렛 → 2스테이지 전투 사전계산 → reveal.
    // 실패하면 사유 문자열, 성공하면 null. (예약 발화는 소켓이 없으므로 emit이 아니라 반환값으로 알린다)
    async function startRound(room, gameState) {
        const gate = canStartSpin(room, gameState);
        if (gate) return gate;

        const sa = gameState.spinArena;
        const readyNames = readyNamesInOrder(gameState);
        const rnd = Math.random;   // 서버 RNG — 결과 결정은 전부 여기서만 일어난다

        // 1) 성향 미선택자 자동 배정 — 경마/사다리의 미선택 자동 배정과 같은 결.
        const autoDisp = [];
        for (const nm of readyNames.slice(0, SPIN_MAX_PLAYERS)) {
            if (sa.dispositions[nm] !== DISP_ATTACK && sa.dispositions[nm] !== DISP_DEFEND) {
                sa.dispositions[nm] = DISP_CATEGORIES[Math.floor(rnd() * DISP_CATEGORIES.length)];
                autoDisp.push(nm);
            }
        }
        if (autoDisp.length > 0) {
            require('./scheduled-start').roomNotice(io, room, gameState,
                `${autoDisp.join(', ')}님이 성향을 고르지 않아 자동으로 배정했어요.`);
        }

        // 2) 참가 슬롯 확정 — 준비한 사람 전원(선착 상한까지).
        const players = buildPlayers(readyNames, gameState);
        const n = players.length;

        // 2) 벌칙 등수 추첨 — 후보는 결승 진출 등수(1..min(FINALIST_COUNT, n)). 유효표 0이어도 룰렛은 돈다.
        const voteMax = Math.min(FINALIST_COUNT, n);
        const roulette = resolveTargetRank(sa.rankVotes, readyNames, voteMax, rnd);

        // 3) 전투 사전계산
        const seed = Math.floor(rnd() * 2147483647);
        clearSpinTimers(sa);
        sa.phase = 'playing';
        sa.isActive = true;
        sa.participants = players.map(pl => pl.name);
        sa.seed = seed;
        // 게임 시작 시 자동 주문 cycle 가드만 해제 — 진행 중인 주문받기는 닫지 않는다
        gameState.orderAutoTriggered = false;

        let sim;
        try {
            sim = await simulateMatch(n, seed, players.map(pl => pl.dispCat));
        } catch (e) {
            console.warn('[회전칼날] 시뮬 실패:', e.message);
            sa.phase = 'idle';
            sa.isActive = false;
            updateRoomsList();
            return '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.';
        }

        // 비동기 시뮬 도중 방이 사라졌으면 중단
        if (!ctx.rooms[room.roomId]) return null;

        // 서버가 굴린 세부 성향을 슬롯 메타에 실어 클라가 보여줄 수 있게 한다.
        const subBySlot = {};
        (sim.dispSubs || []).forEach(d => { subBySlot[d.slotId] = d.sub; });
        players.forEach(pl => {
            pl.dispSub = subBySlot[pl.slotId] || null;
            pl.dispSubLabel = pl.dispSub ? DISP_SUB_LABEL[pl.dispSub] : '';
        });

        const nameBySlot = {};
        players.forEach(pl => { nameBySlot[pl.slotId] = pl.name; });
        const targetEntry = sim.rankings.find(r => r.rank === roulette.targetRank);
        const targetSlot = targetEntry ? targetEntry.slotId : null;
        const targetName = targetSlot !== null ? nameBySlot[targetSlot] : null;
        const champEntry = sim.rankings.find(r => r.rank === 1);
        const championSlot = champEntry ? champEntry.slotId : null;
        const championName = championSlot !== null ? nameBySlot[championSlot] : null;

        sa.timeline = {   // server-only (socket/rooms.js 재진입 마스킹 화이트리스트에 없어 자동 비노출)
            frames: sim.frames, blades: sim.blades, seats: sim.seats,
            sampleMs: sim.sampleMs, durationMs: sim.durationMs, geom: sim.geom
        };
        sa.result = {     // server-only
            targetRank: roulette.targetRank, targetSlot, targetName,
            championSlot, championName,
            rankings: sim.rankings, players: players.map(pl => ({ slotId: pl.slotId, name: pl.name }))
        };

        io.to(room.roomId).emit('spin-arena:reveal', {
            players,                          // 슬롯 메타(번호/이름/색) — frames와 같은 슬롯 순서
            arena: { w: ARENA_W, h: ARENA_H, cx: ARENA_CX, cy: ARENA_CY, r: ARENA_R },
            geom: sim.geom,                   // { charRadius, bladeRadius, swordLen, bladeEdgeR, ringStart, ringEnd, transitionMs }
            blades: sim.blades,               // 슬롯별 칼날 파라미터(클라가 각도를 t로 계산 — 프레임에 없음)
            frames: sim.frames,               // 키프레임 [x,y,hp] × n (슬롯 번호 오름차순)
            sampleMs: sim.sampleMs,
            durationMs: sim.durationMs,
            countdownMs: COUNTDOWN_MS,
            // 2스테이지 계약 — 클라가 stage1 / 전환 / 결승을 이 값들로 가른다(492a8c7과 같은 모양).
            twoStage: sim.twoStage,
            stage1EndMs: sim.stage1EndMs,
            finaleStartMs: sim.finaleStartMs,
            finalists: sim.finalists,
            finalistCount: FINALIST_COUNT,
            roulette: {
                segments: roulette.segments, rankOrder: roulette.rankOrder,
                winningRank: roulette.targetRank, reason: roulette.reason,
                animDurationMs: ROULETTE_ANIM_MS, holdMs: ROULETTE_HOLD_MS
            },
            result: {
                targetRank: roulette.targetRank, targetSlot, targetName,
                championSlot, championName, rankings: sim.rankings
            }
        });

        console.log(`[회전칼날] 방 ${room.roomName} 공개 - 참가 ${n}명 / ${sim.twoStage ? '2스테이지(stage1End=' + sim.stage1EndMs + ')' : '단일단계'} / 1등 ${championName} / 벌칙 ${roulette.targetRank}등 = ${targetName} / 길이 ${sim.durationMs}ms`);

        clearSpinTimers(sa);
        // 클라 재생 순서: 룰렛 → 홀드 → 3-2-1 카운트다운 → 전투(Stage1+전환+결승) → 결과.
        // 하나라도 어긋나면 결과가 일찍/늦게 발화하므로 클라 상수와 반드시 같이 움직인다.
        sa.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, ROULETTE_ANIM_MS + ROULETTE_HOLD_MS + COUNTDOWN_MS + sim.durationMs + RESULT_HOLD_MS);

        updateRoomsList();
        return null;
    }

    function endGame(room, gameState) {
        const sa = gameState.spinArena;
        clearSpinTimers(sa);

        // 결과는 reveal 시점에 확정된 server-only result(결정론) — 여기서 재계산하지 않는다(2탭 동일 보장).
        const result = sa.result || {
            targetRank: null, targetSlot: null, targetName: null,
            championSlot: null, championName: null, rankings: [], players: []
        };
        const rankByName = {};
        const slotToName = {};
        (result.players || []).forEach(pl => { slotToName[pl.slotId] = pl.name; });
        (result.rankings || []).forEach(r => {
            const nm = slotToName[r.slotId];
            if (nm) rankByName[nm] = r.rank;
        });

        // DB·집계는 시작 시점 참가자 중 "지금도 방에 있는" 사람만 (사다리와 동일).
        const players = (sa.participants || []).filter(name =>
            gameState.users.some(u => u.name === name));
        if (players.length === 0) {
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
            targetName: result.targetName,
            targetRank: result.targetRank,
            championName: result.championName,
            timestamp: new Date().toISOString()
        });
        if (sa.history.length > HISTORY_MAX) sa.history = sa.history.slice(-HISTORY_MAX);

        io.to(room.roomId).emit('spin-arena:gameEnd', {
            targetRank: result.targetRank,
            targetSlot: result.targetSlot,
            targetName: result.targetName,
            championSlot: result.championSlot,
            championName: result.championName,
            rankings: result.rankings,
            round: sa.round
        });

        recordGamePlay('spin-arena', players.length, room.serverId || null);

        if (room.serverId) {
            // 경마·사다리와 같은 시점·같은 규칙. 등수가 1인 1값이라 벌칙 대상은 항상 정확히 한 명이다.
            // is_winner = 벌칙에 안 걸린 사람. rank는 실제 최종 등수를 그대로 남긴다.
            const sessionId = generateSessionId('spin-arena', room.serverId);
            const targetName = result.targetName;
            Promise.all(players.map(name => {
                const isWinner = name !== targetName;
                const rank = rankByName[name] || players.length;
                return recordServerGame(room.serverId, name, `${rank}등`, 'spin-arena', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'spin-arena',
                gameRules: 'final-four',
                winnerName: result.championName || null,   // 끝까지 살아남은 1등
                participantCount: players.length
            })).catch(e => console.warn('[회전칼날] DB 기록 실패:', e.message));
        }

        console.log(`[회전칼날] 방 ${room.roomName} 종료 - 1등=${result.championName} / 벌칙=${result.targetName} (${result.targetRank}등)`);

        // 게임 종료 → 바로 주문받기 자동 시작. 등수가 1인 1값이라 동시 당첨이 없어 재경기가 필요 없다.
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

    return { startRound };
}

// 걸려 있는 예약 시작을 풀고 방 전체에 알린다 (경마·사다리와 동일).
function dropScheduledStart(io, room, gameState) {
    const scheduled = require('./scheduled-start');
    if (scheduled.cancelSchedule(gameState)) scheduled.broadcastSchedule(io, room, gameState);
}

/**
 * 회전 칼날 게임 이벤트 핸들러
 */
module.exports = (socket, io, ctx) => {
    const { getCurrentRoom, getCurrentRoomGameState } = ctx;
    // horse.js/ladder.js와 동일 패턴 — ctx가 주면 그걸 쓰고, 없으면 통과. (security-guard 훅이 ctx.checkRateLimit() 리터럴을 요구)
    const checkRateLimit = ctx.checkRateLimit ? () => ctx.checkRateLimit() : () => true;
    const engine = createSpinEngine(io, ctx);

    // idle 단계 공통 검문 — 방/게임타입/유저/단계/준비 확인. 통과하면 { gameState, room, userName }.
    function idlePrecheck() {
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return null;
        }
        if (room.gameType !== 'spin-arena') {
            socket.emit('spin-arena:error', '회전 칼날 방이 아닙니다!');
            return null;
        }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('spin-arena:error', '사용자 정보를 찾을 수 없습니다!');
            return null;
        }
        if (gameState.spinArena.phase !== 'idle') {
            socket.emit('spin-arena:error', '게임 시작 전(대기 중)에만 바꿀 수 있습니다.');
            return null;
        }
        if (!(gameState.readyUsers || []).includes(user.name)) {
            socket.emit('spin-arena:error', '먼저 준비를 해주세요!');
            return null;
        }
        return { gameState, room, userName: user.name };
    }

    // idle 단계 스킨 선택 동기화 브로드캐스트 (server-only 정보 미포함)
    function emitSkinsUpdated(room, gameState) {
        io.to(room.roomId).emit('spin-arena:skinsUpdated', {
            skins: { ...gameState.spinArena.skins }
        });
    }
    ctx.emitSpinArenaSkinsUpdated = emitSkinsUpdated;

    // 성향 고르기 (idle 단계, 준비자만) — 공격형/방어형만 고른다. 세부 성향은 시작할 때 서버가 굴린다.
    socket.on('spin-arena:selectDisposition', (data) => {
        if (!checkRateLimit()) return;

        const pre = idlePrecheck();
        if (!pre) return;
        const { gameState, room, userName } = pre;

        const cat = data && data.cat;
        if (cat !== DISP_ATTACK && cat !== DISP_DEFEND) {
            socket.emit('spin-arena:error', '없는 성향입니다.');
            return;
        }
        gameState.spinArena.dispositions[userName] = cat;
        io.to(room.roomId).emit('spin-arena:dispositionsUpdated', {
            dispositions: { ...gameState.spinArena.dispositions }
        });
    });

    // 「몇 등이 벌칙인지」 등수 투표 (idle 단계, 준비자만) — 같은 등수 재클릭 = 취소. 경마 voteRank와 같은 규칙.
    // 후보는 결승 진출 등수(1~FINALIST_COUNT). 준비 인원이 그보다 적으면 시작할 때 초과분이 무효 처리되고
    // 그 사유를 유저에게 알린다(경마와 동일).
    socket.on('spin-arena:voteRank', (data) => {
        if (!checkRateLimit()) return;

        const pre = idlePrecheck();
        if (!pre) return;
        const { gameState, room, userName } = pre;

        const rank = (data && typeof data.rank === 'number') ? data.rank : null;
        if (!Number.isInteger(rank) || rank < 1 || rank > FINALIST_COUNT) {
            socket.emit('spin-arena:error', '유효하지 않은 등수입니다.');
            return;
        }

        const sa = gameState.spinArena;
        if (sa.rankVotes[userName] === rank) delete sa.rankVotes[userName];
        else sa.rankVotes[userName] = rank;

        io.to(room.roomId).emit('spin-arena:rankVotesUpdated', {
            rankVotes: { ...sa.rankVotes },
            maxRank: FINALIST_COUNT
        });
    });

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

    // 입장/재입장 시점 빌드 상태 동기화 — 요청 소켓에만 스킨/투표 응답 (순수 additive 이벤트).
    // server-only 데이터(timeline/result/seed)는 절대 포함하지 않는다.
    socket.on('spin-arena:requestSkins', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'spin-arena') return;

        const sa = gameState.spinArena;
        socket.emit('spin-arena:skinsUpdated', { skins: { ...sa.skins } });
        socket.emit('spin-arena:rankVotesUpdated', { rankVotes: { ...sa.rankVotes }, maxRank: FINALIST_COUNT });
        socket.emit('spin-arena:dispositionsUpdated', { dispositions: { ...sa.dispositions } });
    });

    // 게임 시작 (호스트) — 출전 캐릭터 확정 + 등수 룰렛 + 전투 사전계산 + reveal.
    // 예약 발화(재경기 자동 시작)는 이 핸들러가 아니라 module.exports.start로 같은 엔진을 부른다.
    socket.on('spin-arena:start', async () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        if (room.gameType !== 'spin-arena') {
            socket.emit('spin-arena:error', '회전 칼날 방이 아닙니다!');
            return;
        }
        if (!socket.isHost) {
            socket.emit('spin-arena:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }
        // 방장이 직접 시작하면 걸려 있던 재경기 예약은 해제한다(경마·사다리와 동일 — 앞지르기 허용).
        dropScheduledStart(io, room, gameState);

        const err = await engine.startRound(room, gameState);
        if (err) socket.emit('spin-arena:error', err);
    });

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
module.exports.simulateMatch = simulateMatch;
module.exports.resolveTargetRank = resolveTargetRank;
module.exports.ringRadiusAt = ringRadiusAt;
module.exports.FINALIST_COUNT = FINALIST_COUNT;
module.exports.DISP_SUBS = DISP_SUBS;
module.exports.DISP_CATEGORIES = DISP_CATEGORIES;
module.exports.HP_MAX = HP_MAX;
module.exports.TRANSITION_MS = TRANSITION_MS;
module.exports.SPIN_MAX_PLAYERS = SPIN_MAX_PLAYERS;
