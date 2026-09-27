// 데구리(marble) 결정론 시뮬레이션 — 순수 모듈(소켓/DB 없음).
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
const MAX_BALLS = 100;
const BALLS_PER_PLAYER_MIN = 1, BALLS_PER_PLAYER_MAX = 10, BALLS_PER_PLAYER_DEFAULT = 3;
// 마릿수 3단계(호스트 선택). 인당 = clamp(floor(total / 인원), 1, perMax) — 인원이 많아지면 인당이 줄어 총 마릿수가 total 근처에 머문다.
//   솔로: 항상 인당 1마리. 2명: 2 / 4 / 8마리, 10명: 10 / 20 / 40, 20명: 20 / 20 / 40, 30명+: 인원수(인당 최소 1 — 사람마다 자기 동물이 하나는 있어야 하므로 하한)
//   4단계(조금 20·보통 50·우르르 100, 최대 200)에서 줄임(사용자 2026-09-21 "너무 많다") — 옛 조금이 지금의 보통, 옛 보통이 지금의 많이
const CROWD_PRESETS = {
    solo:   { perMax: 1, total: MAX_BALLS },
    normal: { perMax: 2, total: 20 },
    many:   { perMax: 4, total: 50 }
};
const CROWD_DEFAULT = 'solo';    // 방 기본값(utils/room-helpers.js)과 동일 — 모르는 단계가 오면 이걸로
const START_ROW_SIZE = 13;        // 출발대 한 줄 공 수 (13 × 30 = 390 ≤ 출발대 폭 400)
const START_SPACING = 30;

// ─── 물리 ───
const TRACK_W = 800;
const BALL_R = 14;                // 표시 지름 28
const GRAVITY = 595;              // px/s² (+y = 언덕 아래). 700 → 595(−15%, 낙하 속도 ≈ −8%): 기믹을 못 보고 지나간다는 피드백(2026-09-21). 505(속도 −15%)는 90s 캡에 걸리는 판이 생겨 기각. Marble Roulette(box2d g≈300px/s²)보다 공이 2배 커서 2배 기준
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
const SUN_SPOTS = [[230, 90, 48, 55], [400, 200, 48, 55], [570, 310, 48, 55]];   // [x, y(모듈 위 기준), rx, ry] — 폭 500 중 x 커버 ≈ 58%
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
const DAM_DRAIN_MS = 700;         // 터진 뒤 갇혀 있던 공이 물처럼 순서 없이 흘러나가는 시간(마리별 시드 랜덤 지연) — 한꺼번에 툭 떨어지지 않게
const DAM_BOUNCE_MIN = 380, DAM_BOUNCE_MAX = 620;   // 댐에 부딪힌 공의 위로 튕기는 속도(입사 속도 그대로, 이 범위로 클램프) → 100~270px 튀어 오른다
const DAM_GAP_W = 56;             // 댐 한쪽 끝에 새는 틈(공 2개) — 틈 쪽으로 온 놈은 기다리지 않고 바로 빠진다. 쪽은 시드로
// ⑦ 풍차: 날개 4개가 도는 회전 장애물 — 맞는 놈만 튕겨 나간다. 날개 끝 속도 ≈ 2π·len/period
const WINDMILL_LEN = 72;          // 날개 길이(허브→끝). rotor 스프라이트 192px 를 3배(=144 표시)로 그린다
const WINDMILL_PERIOD_MS = 2400;
const WINDMILL_HUB_R = 8;
const WINDMILL_POLE_H = 144;      // 기둥 높이(A자 다리 두 개가 물리 벽)
// ⑦ 두더지 경사로: 경사로 위 두더지 구멍. 두더지는 제 박자(period/up/phase)로 튀어나오고, 그 순간 머리 위에 있던 놈만 튕겨 오른다(≈165px).
//    항상 켜진 점프대와 달리 타이밍 운 — 같은 자리를 지나도 누구는 맞고 누구는 안 맞는다. 클라는 mole 에 실린 값으로 같은 박자를 그린다
const MOLE_PERIOD_MS = 1800, MOLE_UP_MS = 450, MOLE_PHASE_STEP = 0.31;
const MOLE_R = 22;                // 두더지 머리 반경 — 이 안에 공 중심이 오면 맞음
const MOLE_VY = 480, MOLE_VX = 110;
const MOLE_COOLDOWN_MS = 400;     // 한 번 튕긴 공이 같은 두더지에 연달아 안 맞게
// ⑥ 간헐천 구덩이: 들어온 놈은 전부 빠져 잠깐 갇혔다가, 주기마다 한꺼번에 분수처럼 튀어 오른다(위로 100~190px, 좌우 랜덤).
//    한 번 튀어 오른 놈은 다시 안 빠진다(위를 그냥 굴러 지나감). 정원이 없어 채널이 막히지 않는다.
const PIT_ERUPT_PERIOD_MS = 1500;
const PIT_ERUPT_VY_MIN = 380, PIT_ERUPT_VY_MAX = 520;
const PIT_ERUPT_VX = 150;
const MUD_STALL_MS = 500, MUD_DIZZY_MS = 800, MUD_RESUME_VY = 60;
const SEESAW_LEN = 84, SEESAW_AMP_DEG = 25, SEESAW_PERIOD_MS = 2400;
// ⑦-b 장치 골짜기(높이 DEV_H): 대각선 필러 없이 순위가 뒤집히는 장치만.
//    (a) 플립플롭 갈림길 — 공이 지날 때마다 판이 반대로 젖혀져 왼쪽 지름길 / 오른쪽 컨베이어 돌아가기(≈2.5s 손해)를 번갈아 보낸다. 앞뒤 순서가 곧 운
//        판은 깔때기 목 바로 아래 축을 중심으로 기울어진 널빤지: 위쪽 끝이 목 벽(x 340/460)에 닿아 목에서 나오는 공 전원이 판 위로 떨어져 낮은 쪽으로 미끄러진다.
//        (옛 팔은 축에서 아래로만 56px·가로 32px — 위 경사로가 왼쪽 끝에서 떨어뜨려 깔때기 왼쪽 벽에서 오른쪽 속도를 얻은 공이 목 오른쪽 벽을 타고 내려와
//         팔을 스치지도 않아 20시드 92% 가 오른쪽으로 갔다, 사용자 2026-09-24)
//    (b) 선풍기 — 양쪽 벽에서 엇박으로 바람. 켜진 순간 띠 안에 있던 놈만 옆으로 밀린다
const FF_ANGLE_DEG = 45;          // 젖힘판이 수직에서 기운 각
const FF_LEN = 85;                // 축에서 양쪽으로 각각 — 가로 60 = 목 반폭. 위쪽 끝은 목 벽에 닿아 새는 틈이 없고, 아래쪽 끝은 목 벽 연장선(x 340/460)이라 벽을 타고 온 공도 판을 스치지 않고 지나갈 수 없다
const FF_ZONE_TOP_PAD = BALL_R;   // 젖힘 보류 구역 윗선 = 판 꼭대기 + 이만큼(simulate 의 ffPending 주석). 40시드: 보통 55%·우르르 50%·솔로 50% 오른쪽
const BELT_SPEED = 160;           // 컨베이어 표면 속도 px/s
const BELT_GRIP = 8;              // 공이 벨트 속도에 붙는 세기 /s
const CLIMB_SPEED = 220, CLIMB_UP_SPEED = 140;   // 등반 컵: 바닥 벨트 220, 오르막 벨트 140 — 37° 오르막에서 중력(≈360px/s²)에 그립(8/s)이 이겨 ≈80px/s 로 기어오른다(한 칸 1.3s). 멈춤 주기는 뺌 — 스스로 못 오르는 놈이 생겼다(사용자 2026-09-25). 뒤로 밀리는 건 옆 놈에 부딪혀서만
const FAN_PERIOD_MS = 2400, FAN_ON_MS = 900, FAN_ACCEL = 1600, FAN_BAND = 200;
const DEV_H = 760;                // 장치 골짜기 높이
// ⑦-c 갈래 골짜기(장치 골짜기 아래): 대각선 한 방향으로만 길게 흐르지 않게 지형을 섞는다 —
//    짧은 경사 → 끊긴 경사로(틈으로 먼저 빠지는 놈·끝까지 가는 놈) → 크기 제각각 범퍼 밭(시드 배치) → 갈라주는 봉우리 Λ 두 개 → U자 그릇(바닥 가운데 틈으로만 빠짐, 빠른 놈은 왔다갔다)
const VAR_GAP_W = 40;             // 끊긴 경사로 틈 폭(공 1.4개)
const VAR_BOWL_R = 240, VAR_BOWL_SEGS = 14, VAR_BOWL_GAP_DEG = 11;   // 그릇 반지름·호 분할 수·바닥 틈 각도(≈2R·sin(5.5°) ≈ 46px)
const VAR_H = 1000 + 360;         // 구간 높이 (워프 방 WARP_H 만큼 늘어남 — 아래 const 는 이 위에 못 쓰므로 숫자로)
// 스프링 널빤지(끊긴 경사로 끝 60px, 사용자 요청 2026-09-21 2차): 장전돼 있으면 밟는 놈을 그 자리에서 위·뒤(경사로 시작 쪽)로 쏜다.
//    한 번 쏘면 SPRING_COOLDOWN_MS 동안 꺼짐(클라가 3·2·1 표시) → 다시 장전. 꺼진 동안은 그냥 경사로 끝 판.
const SPRING_LEN = 60;
const SPRING_VX = 300, SPRING_VY = 640;   // 발사 속도(뒤·위) — 640 은 ≈290px 올라간다(경사로 낙차 160 보다 위)
const SPRING_COOLDOWN_MS = 3000;
const SPRING_ARM_DELAY_MS = 120;  // 밟은 뒤 이만큼 있다 발사(판 위에 확실히 올라온 뒤) — 스치기만 한 놈은 안 쏨
// 독수리(사용자 요청 ⑤): 결승 구멍밭에서 뚜껑을 기다리는 공·통로를 걷는 동물 중 시드로 한 마리를 채서 풍차 옆에 떨어뜨린다(다시 굴러 내려와야 함).
//    마지막 한 마리도 채 간다. 한 판 여러 번(같은 놈은 한 번만) — 낙하 지점이 시소 옆(손해 ≈10s)이라 감당됨. 남은 놈이 EAGLE_FINAL_ALIVE 이하인
//    꼴찌 결정전에선 쉬는 시간을 짧게 해 바쁘게 움직이고, 통로에서 달리는 놈(walk)을 뚜껑 앞에서 기다리는 놈보다 3배 우선(사용자 2026-09-21 2차).
//    후보가 처음 보인 뒤 EAGLE_WAIT_MS 지나면 그때 후보 중 하나 — 5s 대기 + 후보 비면 초기화로는 소인원 24판 중 9판이 독수리를 못 봤다(사용자 "안 나와")
const EAGLE_WAIT_MS = 1500;       // 후보가 처음 생긴 뒤 이만큼 지나서 온다(중간에 후보가 비어도 초기화 안 함)
const EAGLE_COUNT_WEIGHTS = { solo: [0.7, 0.2, 0.1], normal: [0.3, 0.5, 0.2], many: [0.15, 0.35, 0.5] };   // 독수리 1·2·3마리 확률(사용자 2026-09-23: 판마다 랜덤, 1마리 모드는 1마리가 잘 나오게). 한 번 채인 놈은 어느 독수리도 다시 안 잡는다
// 예산(사용자 2026-09-21): 남은 동물이 EAGLE_FINAL_ALIVE 보다 많을 땐 독수리 전체 합쳐 EAGLE_MAX_EARLY 회 — 초반에 다 써서 막판에 못 움직이던 것.
//    남은 동물이 EAGLE_FINAL_ALIVE 이하가 되는 순간 카운터를 0 으로 되돌리고 전체 EAGLE_MAX_FINAL 회. 같은 독수리는 같은 놈 재납치 금지(유지).
//    (독수리당 4회로 하면 우르르 3마리 × 4 = 막판 12회 → 200마리 90s 대라 전체 합산으로)
//    초반 예산은 마릿수에 비례(max(2, n×0.15)) — 2회면 4마리 남을 때까지 독수리가 논다 + 구멍밭에 몰려 못 내려가는 무리를 독수리가 덜어 준다(사용자 3차).
//    초반엔 뚜껑 앞에서 기다리는 놈 우선(2배), 막판엔 달리는 놈 우선(3배)
const EAGLE_MAX_EARLY_MIN = 2, EAGLE_MAX_EARLY_RATIO = 0.06, EAGLE_MAX_FINAL = 2;   // 빈도 −50% 더(피드백 2026-09-21): 3/0.12/4 → 2/0.06/2. 결승전 예산은 독수리 수로도 캡(보통 1마리 → 1회). 25시드: 납치 6.8→4.0(보통)·2.8→1.0(조금)·9.0→4.0(우르르)
const EAGLE_REST_MS = 3000, EAGLE_REST_FINAL_MS = 1000;   // 놓고 나서 다음 잡기까지(비행 시간 뒤) / 결승전(남은 ≤ EAGLE_FINAL_ALIVE). 1500/500 → 3000/1000(빈도 −50%)
const EAGLE_WAIT_WEIGHT_EARLY = 2;
const EAGLE_FINAL_ALIVE = 4;
const EAGLE_STAGGER_MS = 700;     // 독수리마다 첫 출격 시차
const EAGLE_WALK_WEIGHT = 3;
const EAGLE_FLY_MS = 2600;        // 채서 떨어뜨릴 때까지(공은 이 동안 독수리 발톱에 — 충돌 없음)
const EAGLE_ARC = 140;            // 비행 중 곡선 높이(위로)
const EAGLE_DROP_ABOVE_SEESAW = 70;   // 낙하 지점 = 결승 프레임 위쪽 시소 바로 위(시소 y − 이 값) — 풍차까지 올리면 25s 손해·화면 밖(사용자 2026-09-21: "가운데 돌아가는 거쯤")
const EAGLE_DROP_MIN_ABOVE_HF = 40;   // 낙하 높이는 랜덤(사용자 2026-09-23): 가장 높으면 지금 자리(시소 위), 가장 낮으면 구멍밭 윗변에서 이만큼 위
const EAGLE_DROP_LATE_W = 0.6;       // 후반일수록 낮게: 낮은 정도 = 진행도(골인 비율)×이 값 + 랜덤×(1−이 값). 초반 0~40%, 막판 60~100% 구간
const EAGLE_DROP_DX = 130;        // 시소 좌우 이만큼 떨어진 자리(쪽은 시드)
const EAGLE_MISS_P = 0.5;         // 헛발톱 확률(사용자 2026-09-23 "독수리 킹받는다"): 급강하는 똑같이 하되 못 채고 빈 발로 같은 곡선을 날아오른다. 동물은 제자리, 출격 예산·쉬는 시간·재도전 금지는 잡은 것과 같이 친다
// ⑦-d 워프 파이프 방(갈래 골짜기 끊긴 경사로 아래, docs/goal/marble-warp-pipes.md): 마리오식 서 있는 파이프 6개가 한 화면에.
//    윗줄 [1][2][3] / 통나무 한 줄 / 아랫줄 [4][5][6], 짝 1↔6·2↔5·3↔4(대각선 교차). 들어가면 짝 파이프에서 위로 뿅 튀어나온다 —
//    윗줄로 들어가면 범퍼를 건너뛰고 반대편으로(지름길), 아랫줄로 들어가면 윗줄로 되돌아가 범퍼를 다시(손해). 순위 규칙 예외 없음(위치 이동뿐).
//    무한 핑퐁 방지: 공 1마리당 파이프 1회(들어간 것·나온 것 둘 다 소진) + 나올 때 트랙 가운데 쪽으로 차서 입구 위에 도로 안 떨어진다.
const WARP_TOP = 330;             // 방 시작(V 기준). 윗줄 입구 y
const WARP_ROW_GAP = 250;         // 윗줄 ↔ 아랫줄 입구 y 간격
const WARP_H = 360;               // 방 높이 → 봉우리·그릇이 이만큼 내려간다
const WARP_XS = [260, 400, 540];  // 줄 안 파이프 x (기둥과 바깥벽·이웃 사이 ≥ 44 — 좁으면 공이 쐐기로 낀다)
const WARP_MOUTH_W = 40;          // 입구 폭(공 1.4개)
const WARP_BODY_W = 48, WARP_BODY_H = 56;   // 파이프 몸통(양옆이 벽). 스프라이트 표시 크기와 같음
const WARP_MS = 350;              // 들어가서 나올 때까지(숨어 있는 시간)
const WARP_POP_VY = 380, WARP_POP_VX = 140;   // 나올 때 위로·가운데 쪽으로
const WARP_LOG_Y = 125;           // 줄 사이 통나무(윗줄 입구 기준 아래로)
// ⑨ 구멍밭: 폭 500 판에 말뚝(파칭코) + 바닥 골 구멍 HOLE_COUNT 개. 구멍 사이 바닥은 지붕처럼 솟아 공이 구멍으로 굴러 떨어진다.
//   구멍 아래 파이프 안 goalY 를 지나면 도착. 물리만으로 읽히는 결승(가둬 두는 문·회전판 없음).
const HOLE_COUNT = 5;
const HOLE_W = 40;                // 구멍 폭 (공 1.4개 — 동시에 둘이 끼지 못함)
const HOLE_RIDGE_H = 12;          // 구멍 사이 바닥 지붕 높이
const HOLE_PIPE_H = 60;           // 구멍 아래 파이프 길이
// 구멍 뚜껑: 구멍마다 여닫힌다. 골(오른쪽 끝)에 가까운 구멍일수록 주기가 길어 가끔 열리고, 먼 구멍일수록 자주 열린다.
//   열려 있는 시간은 전부 같고(HOLE_OPEN_MS) 주기만 왼쪽→오른쪽 선형. 뚜껑은 왼쪽으로 미끄러져 열린다. 클라는 hole 에 실린 값으로 같은 식을 그린다.
const HOLE_OPEN_MS = 700;
const HOLE_OPEN_SCALE_BALLS = 40;  // 공이 이 수를 넘으면 열림 시간을 n/40 배로 늘린다(최대 주기의 85%) — 200마리가 얄쌍한 구멍밭에서 막히지 않게. 소인원(≤40)은 그대로
const HOLE_PERIOD_FAR_MS = 1500;  // 골에서 가장 먼 구멍(왼쪽 끝)
const HOLE_PERIOD_NEAR_MS = 4200; // 오른쪽에서 둘째 구멍(골에서 두 번째로 가까움)
const HOLE_PERIOD_LAST_MS = 9000; // 맨 오른쪽 구멍 — 골(600) 바로 옆이라 내려오면 바로 골인. 정말로 잘 안 열려야 한다(사용자 2026-09-25)
const HOLE_LID_SLIDE_MS = 150;    // 여닫히는 데 걸리는 시간
const HOLE_PHASE_STEP = 0.37;     // 구멍별 위상(주기 × i × 이 값) — 동시에 열리지 않게
// 셔터 문(last-gate) — 500폭 판자문이 주기로 여닫힌다. 닫혀 있는 동안 문 위 SHUTTER_WAIT_H 구역의 공은 갇힘 킥 예외(댐 대기와 같음)
const SHUTTER_PERIOD_MS = 3000, SHUTTER_OPEN_MS = 1000, SHUTTER_SLIDE_MS = 150;
const SHUTTER_PERIOD_STEP_MS = 500;   // 3토막의 주기 차(3000·3500·4000) — 서로 어긋나 전원이 동시에 갇혔다 풀리는 일이 없다
const SHUTTER_STEP_H = 60;            // 가운데 토막 단차(ㅡ _ ㅡ) — 높은 토막 끝에서 굴러 떨어진 공이 낮은 토막에 얹힌다
const SHUTTER_OPEN_SCALE_BALLS = 40;   // 구멍 뚜껑(HOLE_OPEN_SCALE_BALLS)과 같은 식 — 마릿수가 이 수를 넘으면 열림 시간을 n/40 배(최대 주기의 85%)
const SHUTTER_WAIT_H = 200;            // 문 위 대기 구역 높이(100마리 무더기 ≈ 140px)
const WINDHALL_FAN_BAND = 120;         // 바람 복도 선풍기 띠 — 3대가 겹치지 않게(FAN_BAND 200 은 장치 골짜기 2대용)
// 움직이는 장애물 6종(docs/goal/marble-moving-gimmicks.md) — 전부 t 의 함수(상태 없음)라 한 트랙에 여러 개 가능. 그림은 기존 스프라이트/코드 도형, 에셋 계약은 goal 문서
const PEND_LEN = 140, PEND_AMP_DEG = 50, PEND_PERIOD_MS = 2600, PEND_R = 20;   // 진자 통나무: 밧줄·진폭·주기·통나무 반지름(LOG_R). 끝 속도 ≈ 295px/s
const PISTON_EXT = 200, PISTON_HEAD = 24, PISTON_H = 64, PISTON_PERIOD_MS = 3000, PISTON_OUT_MS = 1200;   // 밀대: 돌출·머리 폭·머리 높이·주기·왕복 시간(나머지는 들어가 있음). 최대 523px/s
const TRAMP_E = 1.15, TRAMP_KICK = 80;   // 트램펄린: 반발(1 넘으면 온 것보다 높이, MAX_SPEED 캡)·튈 때 좌우 시드 킥(기울기와 함께 제자리 무한 튕김 방지)
const GUST_PERIOD_MS = 2400, GUST_ON_MS = 1200, GUST_ACCEL = 900, GUST_DIRS = 64;   // 돌풍: 주기·부는 시간·가속·방향 수열 길이(트랙 만들 때 시드로 뽑아 조각에 싣는다)
const QUAKE_PERIOD_MS = 3500, QUAKE_DUR_MS = 700, QUAKE_VX = 500, QUAKE_VY = 300;   // 지진: 주기·흔들리는 시간·시작 순간 킥(좌우 ±VX/2, 위로 0~VY)
// 구멍 앞 몸싸움(연출, 순위 무관): 닫힌 뚜껑 위에 둘 이상이 멈춰 기다리면 구멍 중심에 가장 가까운 둘이 서서 밀어내기 → 뚜껑이 열리면 화들짝 낙하
//   → 착지 후 SCUFFLE_DIZZY_MS 기절(걷기 시작만 늦어짐). 셋 이상이면 나머지는 공 그대로. 판정은 서버가 하고 scuffle/scuffleEnd 이벤트로 알린다
const SCUFFLE_WAIT_MS = 0;        // 뚜껑 위에 이만큼 연속으로 머문 뒤에야 후보 — 0 = 자리 잡자마자(사용자 2026-09-21 "안전한 범위에서 최대한 짧게"). 튕김은 SCUFFLE_SPEED 가 거른다
const SCUFFLE_SPEED = 90;         // 이 속도(px/s) 아래여야 "멈춰 기다리는 중"
const SCUFFLE_MIN_LEFT_MS = 300;  // 뚜껑이 이만큼은 더 닫혀 있어야 시작(열리기 직전에 붙어서 한 프레임 밀다 마는 깜빡임 방지)
const SCUFFLE_GRACE_MS = 300;     // 밀려나거나 속도가 튀어도 이 안에 돌아오면 계속(뚜껑이 열리면 즉시 끝). 40시드 스윕(2026-09-21): 0/90/300/300 이 250ms 미만 0건·최소 310ms. "뚜껑에서 떠남(lidAt 100ms 스테일)"을 즉시 끝으로 치면 뚜껑 위 튕김을 오판해 짧은 것 98개 생김 — 유예 방식 유지
const SCUFFLE_DIZZY_MS = 500;     // 화들짝 낙하 뒤 착지 기절 시간
// ⑩ 집결 통로 = 마지막 경주 구간: 파이프에서 떨어진 동물은 통로 바닥에 내려 오른쪽 끝(골)까지 제 속도로 달린다 — 추월 있음.
//    골(x ≥ GOAL_X)에 들어간 순서가 곧 순위, 꼴찌 = 골에 마지막으로 들어간 놈 (사용자 확정 2026-09-20 밤, 그림으로).
const WALK_SPEED_MIN = 60, WALK_SPEED_MAX = 140;   // px/s 걷는 속도 — 착지 순간 마리마다 시드 PRNG 로 뽑는다(종족 무관, 운)
const LAND_REST_MS = 800;         // 착지 뒤 이만큼 제자리에서 숨 고르고 출발(전원 동일, 순위 무관). 파이프에서 떨어지자마자 뛰면 맛이 없다(사용자 2026-09-24). 클라(js/marble-render.js)와 같은 값
const WALK_SPACING = 30;          // 졸고 있는 동물은 뒤가 이 거리로 붙으면 깨운다
const WALK_TRIP_P = 0.08;         // 초당 넘어질 확률
const WALK_TRIP_MS = 700;         // 넘어져 있는 시간
const WALK_DOZE_P = 0.04;         // 초당 졸 확률
const WALK_DOZE_MIN_MS = 1200, WALK_DOZE_RND_MS = 1500;   // 졸음 길이 1.2~2.7s
const WALK_DOZE_BUMP_MS = 500;    // 이만큼 지난 뒤 뒤에서 부딪히면 깸
const LANE_H = 60;                // 통로 높이
const LANE_ROW_BALLS = 25;        // 이 마리 수마다 줄 하나 (≤25 한 줄, ≤50 2열, 그 이상 3열) — 줄은 착지 시 시드 랜덤, 줄끼리 독립 큐
const LANE_ROWS_MAX = 3;
const LANE_ROW_GAP = 20;          // 줄 간 y 간격
const LANE_END_X = 650;           // 통로 끝 벽(판자벽) — 트랙 폭(150~650) 안에. 745 였을 땐 결승 프레임이 규격을 넘어 카메라가 묻혔다(사용자 2026-09-25)
const GOAL_X = 600;               // 이 x 를 지나면 도착 — 맨 오른쪽 문(x 568) 바로 옆이라 거기서 내려오면 바로 골인. 대신 그 문은 HOLE_PERIOD_LAST_MS 로 정말 드물게 열린다
const CHUTE_H = 24;               // 통로 아래 홈통 높이(도착 동물이 굴러가는 파이프, 클라 연출)
const STAND_ROW_H = 44, STAND_ROWS_MAX = 3;   // 스탠드 줄 높이·줄 수 (js/marble-render.js 와 동일 값) — 결승 프레임 높이에 들어감
const STAND_GAP = 36;             // 홈통 아래 ~ 스탠드 첫 줄 사이(12 였을 땐 첫 줄 머리가 홈통·골 파이프에 겹쳤다, 사용자 2026-09-21)
const FINALE_HOLD_MS = 3500;      // 마지막 공 골인 후 엎어짐·스포트라이트 여유(클라 재생 길이에 포함)
// 슬로모 (Marble Roulette timeScale 차용): 마지막 남은 공이 골 앞 SLOW_ZONE_PX 에 들어오면 재생 속도 SLOW_RATE.
// 서버·클라가 같은 타임라인으로 같은 시각을 계산해 durationMs 에 반영 → 2탭 동기·종료 타이머 일치.
const SLOW_ZONE_PX = 60;          // 통로 골 앞 60px(마지막 걸음만) — 걷는 4~5초를 전부 늘리면 지루하다
const SLOW_RATE = 0.3;
const FAST_RATE = 2;              // 꼴찌 한 마리만 남으면(뒤에서 두 번째 골인 ~ 슬로모 시작) 재생 2배속 — 혼자 25초 걷는 걸 그대로 보게 하지 않는다(사용자 2026-09-21)

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
// 트랙 — 모듈 조립. 매판 다른 맵(docs/goal/marble-random-track.md).
//  모듈 계약: fn(top, rng, ctx) → { pieces, height, bounds? }. 모듈 안 y 는 top 기준(모듈 위 = top), 입·출구는 전부 500폭(벽 150/650),
//  깔때기는 모듈 안에. 머리(출발대·깔때기)와 꼬리(범퍼·시소·진흙 → 구멍밭 → 통로·스탠드)는 고정 — 독수리 낙하(seesaw.y~holefield)·
//  결승 카메라(구멍밭 위 400px)·조기 확정이 꼬리에 묶여 있다. 가운데 7모듈만 셔플 + 모듈별 좌우반전(mirrorPiece).
//  rng 없으면(테스트·덤프) 트랙 A 원래 순서·무반전·모듈 rng 0.75 고정 = 회귀 기준선(AutoTest/marble-determinism-test.js).
//  pieces 는 서버 물리와 클라 렌더가 같은 배열을 본다(reveal에 실어 보냄). y는 출발 문(0)부터 아래로, 출발대는 음수 y(공 수에 따라 가변).
// ═══════════════════════════════════════════════════════════
const HEAD_H = 420;               // 출발 문 아래: 깔때기 400→120(0..300) + 벌림 120→500(300..420). 첫 모듈은 y=420 에서 시작
const SECTION_H = { stakes: 480, beehive: 350, sun: 400, dam: 670, windmill: 780, device: DEV_H, variety: VAR_H, bumpers: 620,   // 모듈 높이(트랙 A 좌표 그대로)
    slalom: 520, windhall: 600, molefield: 700, springfield: 720, warproulette: 560, shutter: 420, climb: 420,   // 기믹 풀(docs/goal/marble-gimmick-pool.md) — 기존 조각 재조합 + 셔터 문. 컨베이어 계단(7초 실려만 감, "재미없음")은 등반 벨트(climb)로 바꿈(사용자 2026-09-25)
    pendulums: 560, pistons: 600, trampolines: 560, gust: 560, quake: 480 };   // 움직이는 장애물 5(docs/goal/marble-moving-gimmicks.md) — 대포는 "뭔지 모르겠다"(사용자 2026-09-25)라 뺌
const GIMMICK_NAMES = ['shutter', 'pendulums', 'pistons', 'trampolines', 'gust', 'quake'];   // 판마다 최소 GIMMICK_MIN 개 — 재조합 모듈만 뽑히면 "새 장애물" 느낌이 없다(사용자 2026-09-24)
const GIMMICK_MIN = 2;
const MIDDLE_H_MIN = 4300, MIDDLE_H_MAX = 5300;   // 가운데 모듈 높이 예산 — 트랙 A 가운데 4800. 셔플한 풀에서 합이 MIN 이 될 때까지 MAX 를 안 넘는 것만 담는다(보통 5~9개)
const TRACK_A_COUNT = 7;              // MIDDLE_SECTIONS 앞 7개 = 트랙 A(rng 없을 때 그 순서 그대로)
const wallFn = p => (x1, y1, x2, y2) => p.push({ kind: 'wall', x1, y1, x2, y2 });
const decorFn = (p, top) => (kind, x, y) => p.push({ kind: 'decor', decor: kind, x, y: top + y });   // 장식(클라 전용, 물리 없음)
const sideWalls = (wall, top, h) => { wall(150, top, 150, top + h); wall(650, top, 650, top + h); };
// 경사로 + 두더지 구멍(경사로 위 ks 지점) + 끝 60px 은 스프링 널빤지(사용자: "스프링 중간에 더")
function ramp(p, x1, y1, x2, y2, ks, phase0, noSpring) {
    const wall = wallFn(p);
    if (noSpring) wall(x1, y1, x2, y2);
    else {
        const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, hx = x2 - ux * SPRING_LEN, hy = y2 - uy * SPRING_LEN;
        wall(x1, y1, hx, hy);
        p.push({ kind: 'spring', x: hx, y: hy, len: SPRING_LEN, angle: Math.atan2(uy, ux), cooldown: SPRING_COOLDOWN_MS });
    }
    const ang = Math.atan2(y2 - y1, x2 - x1), dir = x2 > x1 ? 1 : -1;
    ks.forEach((k, i) => p.push({ kind: 'mole', x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k, angle: ang, dir, r: MOLE_R,
        period: MOLE_PERIOD_MS, up: MOLE_UP_MS, phase: Math.round(MOLE_PERIOD_MS * MOLE_PHASE_STEP * (i + phase0)) }));
}

// 워프 파이프 한 방: warps[{x, y, idx}] + 짝 함수 → 파이프 조각 + 몸통 양옆 벽(스프라이트가 대신 보이므로 클라는 안 그림).
// uid/pairUid 는 트랙 전체에서 유일(한 판에 워프 방이 둘이어도 짝·소진 기록이 안 섞인다), idx/pair/color 는 방 안 번호(클라 라벨·짝 색)
function warpRoom(p, warps, pairOf, ctx) {
    const base = ctx.warpUid || 0; ctx.warpUid = base + warps.length;
    warps.forEach(w => {
        const pair = pairOf(w.idx);
        p.push({ kind: 'warp', x: w.x, y: w.y, idx: w.idx, pair, uid: base + w.idx, pairUid: base + pair, w: WARP_MOUTH_W, bodyW: WARP_BODY_W, bodyH: WARP_BODY_H, color: Math.min(w.idx, pair) });
        [-1, 1].forEach(sg => p.push({ kind: 'wall', x1: w.x + sg * WARP_BODY_W / 2, y1: w.y, x2: w.x + sg * WARP_BODY_W / 2, y2: w.y + WARP_BODY_H, hidden: true }));
    });
}

// 머리(고정): 출발대(마릿수 가변 높이) + 문 + 깔때기 400→120 + 벌림 120→500
function headSection(ballCount) {
    const rows = Math.max(1, Math.ceil(ballCount / START_ROW_SIZE));
    const startH = rows * START_SPACING + 40;
    const p = [], wall = wallFn(p), decor = decorFn(p, 0);
    p.push({ kind: 'platform', zone: { x: 200, y: -startH, w: 400, h: startH } });
    wall(200, -startH - 20, 200, 0);
    wall(600, -startH - 20, 600, 0);
    p.push({ kind: 'startGate', x1: 200, y1: 0, x2: 600, y2: 0 });
    wall(200, 0, 340, 300); wall(600, 0, 460, 300);
    wall(340, 300, 150, HEAD_H); wall(460, 300, 650, HEAD_H);
    decor('tree', 60, 250);
    return { pieces: p, height: HEAD_H, startY: -startH };
}
// 말뚝밭 — 지그재그 말뚝 8줄
function stakesSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    sideWalls(wall, top, SECTION_H.stakes);
    for (let r = 0; r < 8; r++) {
        const y = top + 50 + r * 48, off = (r % 2) ? 24 : 0;
        for (let x = 200 + off; x <= 600; x += 48) p.push({ kind: 'stake', x, y, r: STAKE_R });   // 벽(150/650)과 44px 띄움 — 공(28)이 끼지 않게
    }
    decor('tree', 740, 280);
    return { pieces: p, height: SECTION_H.stakes };
}
// 벌집 언덕 — 첫 공이 지나면 벌 떼가 구역 전원을 흔든다 + 통나무 2
function beehiveSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    sideWalls(wall, top, SECTION_H.beehive);
    p.push({ kind: 'beehive', x: 400, y: top + 35, triggerY: top + 100, zone: { x: 150, y: top + 60, w: 500, h: 290 } });
    p.push({ kind: 'log', x: 260, y: top + 220, r: LOG_R });
    p.push({ kind: 'log', x: 540, y: top + 280, r: LOG_R });
    decor('bush-big', 80, 200);
    return { pieces: p, height: SECTION_H.beehive };
}
// 햇볕 잔디 — 자리를 밟은 느린 놈이 잠든다
function sunSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    sideWalls(wall, top, SECTION_H.sun);
    p.push({ kind: 'sunpatch', zone: { x: 150, y: top + 30, w: 500, h: 340 }, spots: SUN_SPOTS.map(([x, y, rx, ry]) => ({ x, y: top + y, rx, ry })) });
    decor('bush-big', 720, 250);
    return { pieces: p, height: SECTION_H.sun };
}
// 비버 댐 + 희생 다리(구덩이) — 깔때기 500→160 채널. 댐 한쪽 끝에 틈(시드) — 틈 쪽 공은 바로 빠지고 나머지만 갇혀 기다린다. 벌림 160→500
function damSection(top, rng) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    wall(150, top, 320, top + 110); wall(650, top, 480, top + 110);
    wall(320, top + 110, 320, top + 550); wall(480, top + 110, 480, top + 550);
    const gapRight = rng() < 0.5;
    const gap = gapRight ? { x1: 480 - DAM_GAP_W, x2: 480 } : { x1: 320, x2: 320 + DAM_GAP_W };
    p.push({ kind: 'dam', x1: 320, y1: top + 310, x2: 480, y2: top + 310, beaverX: 400, gap, zone: { x: 320, y: top + 190, w: 160, h: 120 } });
    p.push({ kind: 'pit', zone: { x: 320, y: top + 410, w: 160, h: 60 } });   // 구덩이 스프라이트(480×160 → 채널 폭 160×53) 크기에 맞춤
    wall(320, top + 550, 150, top + SECTION_H.dam); wall(480, top + 550, 650, top + SECTION_H.dam);
    decor('rock', 90, 250); decor('bush-small', 740, 450);
    return { pieces: p, height: SECTION_H.dam, bounds: [{ y1: top + 110, y2: top + 550, x1: 320, x2: 480 }] };   // 채널은 하드 클램프 구역
}
// 풍차 + 두더지 경사로 2단 — 뱀길(순위 변동 없는 긴 대각선)을 대신한다.
//   풍차: 모듈 위 한가운데 — 대부분 날개에 맞아 좌우로 튕기고, 옆으로 빠진 놈은 그냥 통과.
//   경사로: 오른쪽 내리막 → 왼쪽 내리막, 두더지 3개씩 + 끝 스프링 — 밟은 놈만 튀어 올라 시간을 잃고 다른 자리에 떨어진다.
function windmillSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    sideWalls(wall, top, SECTION_H.windmill);
    const WM = { x: 400, y: top + 160 };
    p.push({ kind: 'windmill', x: WM.x, y: WM.y, blades: 4, len: WINDMILL_LEN, period: WINDMILL_PERIOD_MS, hubR: WINDMILL_HUB_R, poleH: WINDMILL_POLE_H });
    wall(WM.x, WM.y + 45, WM.x - 32, WM.y + WINDMILL_POLE_H); wall(WM.x, WM.y + 45, WM.x + 32, WM.y + WINDMILL_POLE_H);   // 기둥 A자 다리
    ramp(p, 150, top + 380, 560, top + 510, [0.25, 0.5, 0.75], 0);   // 오른쪽 내리막, 끝(560~650)으로 떨어짐
    ramp(p, 650, top + 590, 240, top + 720, [0.25, 0.5, 0.75], 1.5); // 왼쪽 내리막, 끝(150~240)으로 떨어짐
    decor('flower-pink', 60, 280); decor('flower-yellow', 740, 630);
    return { pieces: p, height: SECTION_H.windmill };
}
// 장치 골짜기 — (a) 플립플롭 갈림길: 깔때기 500→120 → 젖힘판(공이 지날 때마다 반대로) → 왼쪽 지름길(바로 낙하+범퍼 1) / 오른쪽 돌아가기(컨베이어 2단 왕복)
//   (b) 선풍기 — 왼쪽(오른쪽으로 붐) / 오른쪽(왼쪽으로 붐) 엇박
function deviceSection(top, rng) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    sideWalls(wall, top, SECTION_H.device);
    wall(150, top + 20, 340, top + 100); wall(650, top + 20, 460, top + 100);
    wall(340, top + 100, 340, top + 160); wall(460, top + 100, 460, top + 160);
    // 축 y=+190: 위쪽 끝 (340|460, +130) 이 목 벽(+100~+160) 위에 닿고, 아래쪽 끝 (460|340, +250) 은 갈림 벽 꼭대기(+280) 보다 30 위·60 옆
    p.push({ kind: 'flipflop', x: 400, y: top + 190, len: FF_LEN, angleDeg: FF_ANGLE_DEG, triggerY: top + 265, dir: rng() < 0.5 ? -1 : 1 });
    wall(400, top + 280, 400, top + 400);                                                   // 갈림 벽
    p.push({ kind: 'log', x: 275, y: top + 330, r: LOG_R });                                    // 지름길 범퍼
    p.push({ kind: 'belt', x1: 410, y1: top + 300, x2: 590, y2: top + 300, speed: BELT_SPEED });    // → 오른쪽 끝(590~650)에서 아래로. 틈 60(공 2개+) — 40이면 200마리 때 끝 롤러에 걸친 공과 벽에 기댄 공이 아치를 만들어 캡까지 막힌다
    p.push({ kind: 'belt', x1: 440, y1: top + 380, x2: 650, y2: top + 380, speed: -BELT_SPEED });   // ← 왼쪽 끝(400~440)에서 아래로
    p.push({ kind: 'fan', x: 150, y: top + 520, dir: 1, band: FAN_BAND, period: FAN_PERIOD_MS, on: FAN_ON_MS, phase: 0, accel: FAN_ACCEL });
    p.push({ kind: 'fan', x: 650, y: top + 680, dir: -1, band: FAN_BAND, period: FAN_PERIOD_MS, on: FAN_ON_MS, phase: Math.round(FAN_PERIOD_MS / 2), accel: FAN_ACCEL });
    decor('tree', 70, 250); decor('bush-big', 730, 450);
    return { pieces: p, height: SECTION_H.device };
}
// 갈래 골짜기 — (a) 오른쪽 위 짧은 경사 (b) 끊긴 경사로 (c) 워프 파이프 방 (d) 봉우리 Λ 두 개 (e) U자 그릇
function varietySection(top, rng, ctx) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    const V = top;
    sideWalls(wall, top, SECTION_H.variety);
    wall(650, V + 20, 470, V + 90);                                  // (a) 오른쪽 위 짧은 경사 — 오른쪽으로 온 놈을 가운데로
    {   // (b) 끊긴 경사로 ↘: 5토막, 틈 4개(시드 위치). 틈에서 빠진 놈은 범퍼 밭으로 먼저, 끝까지 간 놈은 오른쪽 끝(610~650)으로
        const x1 = 150, y1 = V + 120, x2 = 610, y2 = V + 280, L = Math.hypot(x2 - x1, y2 - y1), gw = VAR_GAP_W / L;
        let from = 0;
        [0.2, 0.4, 0.6, 0.8].forEach(k0 => {
            const k = k0 + (rng() - 0.5) * 0.08;
            wall(x1 + (x2 - x1) * from, y1 + (y2 - y1) * from, x1 + (x2 - x1) * (k - gw / 2), y1 + (y2 - y1) * (k - gw / 2));
            p.push({ kind: 'zzhole', x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k, w: VAR_GAP_W, angle: Math.atan2(y2 - y1, x2 - x1) });   // 클라 연출(틈 표시)
            from = k + gw / 2;
        });
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L, hx = x2 - ux * SPRING_LEN, hy = y2 - uy * SPRING_LEN;   // 경첩 = 끝에서 60 앞
        wall(x1 + (x2 - x1) * from, y1 + (y2 - y1) * from, hx, hy);
        p.push({ kind: 'spring', x: hx, y: hy, len: SPRING_LEN, angle: Math.atan2(uy, ux), cooldown: SPRING_COOLDOWN_MS });
    }
    // (c) 워프 파이프 방: 윗줄 3 / 통나무 한 줄 / 아랫줄 3, 짝은 1↔6·2↔5·3↔4. 파이프 몸통 양옆은 벽(공이 옆에서 부딪히면 튕김), 입구는 센서
    {
        const warps = [];
        [0, 1].forEach(row => WARP_XS.forEach((x, i) => warps.push({ x, y: V + WARP_TOP + row * WARP_ROW_GAP, idx: row * 3 + i })));
        warpRoom(p, warps, idx => 5 - idx, ctx);   // 1↔6, 2↔5, 3↔4
        for (let x = 240; x <= 540; x += 100) p.push({ kind: 'log', x: Math.round(x + (rng() - 0.5) * 20), y: Math.round(V + WARP_TOP + WARP_LOG_Y + (rng() - 0.5) * 30), r: LOG_R });   // 줄 사이 통나무 — x 섞기. 통나무끼리 ≥ 40·벽과 ≥ 80 띄운다(좁으면 공이 쐐기로 낀다 — 600 자리는 벽과 22 라 캡)
    }
    // (d) 봉우리 Λ 두 개 — 꼭대기에 맞으면 좌우로 갈린다(가운데 틈 120 · 양 옆 틈 30)
    wall(180, V + WARP_H + 660, 260, V + WARP_H + 570); wall(260, V + WARP_H + 570, 340, V + WARP_H + 660);
    wall(460, V + WARP_H + 660, 540, V + WARP_H + 570); wall(540, V + WARP_H + 570, 620, V + WARP_H + 660);
    {   // (e) U자 그릇: 반원 호(선분 분할). 굴러 들어와 왔다갔다 하다 바닥 가운데 틈으로만 빠진다 — 느린 놈이 먼저, 빠른 놈은 지나쳤다 돌아온다
        const cx = 400, cy = V + WARP_H + 700, R = VAR_BOWL_R, N = VAR_BOWL_SEGS;
        const a0 = Math.PI * 162 / 180, a1 = Math.PI * 18 / 180, gapHalf = VAR_BOWL_GAP_DEG / 2 * Math.PI / 180;
        let prev = null, prevA = 0;
        for (let i = 0; i <= N; i++) {
            const a = a0 + (a1 - a0) * i / N, pt = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
            if (prev && Math.abs((a + prevA) / 2 - Math.PI / 2) > gapHalf) wall(prev.x, prev.y, pt.x, pt.y);   // 바닥(90°) 토막 하나는 비운다 = 틈
            prev = pt; prevA = a;
        }
        p.push({ kind: 'bowl', x: cx, y: cy, r: R, gapW: Math.round(2 * R * Math.sin(gapHalf)) });   // 클라 연출용(라벨)
    }
    decor('rock', 90, 40); decor('flower-pink', 730, 290); decor('tree', 60, 490); decor('bush-small', 740, 840); decor('tree', 60, 1190);
    return { pieces: p, height: SECTION_H.variety };
}
// ── 기믹 풀(docs/goal/marble-gimmick-pool.md): 기존 조각만 재조합한 모듈 6 + 셔터 문. 새 그림 없음 ──
// 통나무 슬라럼 — 깔때기 500→300, 좁은 길에 통나무 지그재그(벽과 60: 공 하나는 넉넉, 둘은 못 나란히), 다시 500. 좁은 길은 하드 클램프 구역
function slalomSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top), H = SECTION_H.slalom;
    wall(150, top, 250, top + 80); wall(650, top, 550, top + 80);
    wall(250, top + 80, 250, top + 440); wall(550, top + 80, 550, top + 440);
    [130, 210, 290, 370].forEach((y, i) => p.push({ kind: 'log', x: i % 2 ? 470 : 330, y: top + y, r: LOG_R }));
    wall(250, top + 440, 150, top + H); wall(550, top + 440, 650, top + H);
    decor('tree', 70, 200); decor('bush-small', 730, 360);
    return { pieces: p, height: H, bounds: [{ y1: top + 80, y2: top + 440, x1: 250, x2: 550 }] };
}
// 바람 복도 — 300폭 복도 양옆 선풍기 3대 엇박(띠 120, 안 겹침). 벽에 붙는 놈이 느려진다
function windhallSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top), H = SECTION_H.windhall;
    wall(150, top, 250, top + 80); wall(650, top, 550, top + 80);
    wall(250, top + 80, 250, top + 520); wall(550, top + 80, 550, top + 520);
    [[250, 160, 1, 0], [550, 280, -1, 800], [250, 400, 1, 1600]].forEach(([x, y, dir, phase]) =>
        p.push({ kind: 'fan', x, y: top + y, dir, band: WINDHALL_FAN_BAND, period: FAN_PERIOD_MS, on: FAN_ON_MS, phase, accel: FAN_ACCEL }));
    wall(250, top + 520, 150, top + H); wall(550, top + 520, 650, top + H);
    decor('flower-yellow', 80, 300); decor('rock', 720, 460);
    return { pieces: p, height: H, bounds: [{ y1: top + 80, y2: top + 520, x1: 250, x2: 550 }] };
}
// 두더지 밭 — 완만한 경사로 3단(스프링 없음), 두더지 3마리씩. 밟히는 놈만 튄다
function molefieldSection(top) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.molefield;
    sideWalls(wallFn(p), top, H);
    ramp(p, 150, top + 80, 600, top + 200, [0.25, 0.5, 0.75], 0, true);
    ramp(p, 650, top + 300, 200, top + 420, [0.25, 0.5, 0.75], 1.5, true);
    ramp(p, 150, top + 520, 600, top + 640, [0.25, 0.5, 0.75], 3, true);
    decor('bush-big', 720, 260); decor('flower-pink', 70, 470);
    return { pieces: p, height: H };
}
// 등반 컵 — \_/ 모양 둘(사용자 스케치 2026-09-25). 왼쪽 비탈(벽)로 굴러 들어가면 바닥 벨트가 오른쪽 오르막 벨트로 밀어 올린다 — 동물이 풀려서 기어오르는 연출(클라 climb 플래그).
// 컵 사이·양옆 틈(50·80·50)으로 떨어지는 놈은 안 걸린다("몇 명은 안 걸릴 수도 있어야"). 컵 폭 160·깊이 60, 오르막 80×60(37°)
function climbSection(top) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.climb, y0 = top + 200, x0 = 200;
    sideWalls(wallFn(p), top, H);
    const cup = [], cwall = wallFn(cup);   // 왼쪽 컵(200~360) — 오른쪽 컵은 이걸 좌우 반전(440~600): 오르막이 서로 마주 본다 _/ \_ (사용자 2026-09-25)
    cwall(x0, y0, x0 + 40, y0 + 60);                                                                              // \ 비탈
    cup.push({ kind: 'belt', x1: x0 + 40, y1: y0 + 60, x2: x0 + 80, y2: y0 + 60, speed: CLIMB_SPEED });          // _ 바닥 벨트(늘 돈다)
    cup.push({ kind: 'belt', x1: x0 + 80, y1: y0 + 60, x2: x0 + 160, y2: y0, speed: CLIMB_UP_SPEED, climb: true });   // / 오르막(등반) — 늘 돈다
    cup.forEach(q => p.push(q)); cup.forEach(q => p.push(mirrorPiece(q)));
    decor('tree', 60, 100); decor('bush-big', 720, 340);
    return { pieces: p, height: H };
}
// 스프링 밭 — 짧은 경사로 4개, 끝마다 스프링 널빤지. 밟은 놈은 되돌아 올라간다(위 모듈 바닥까지 잠깐 튀어 오를 수 있다). 가운데는 늘 빈 구멍
function springfieldSection(top) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.springfield;
    sideWalls(wallFn(p), top, H);
    // 경사로 끝을 가운데 80px(360~440) 앞에서 끊는다 — 떨어지는 공이 늘 그 구멍으로 그냥 내려갈 수 있게. 400 까지 닿으면 전원이 다음 스프링 판 위로만 떨어졌다(사용자 2026-09-25)
    ramp(p, 150, top + 80, 360, top + 150, [], 0); ramp(p, 650, top + 230, 440, top + 300, [], 0);
    ramp(p, 150, top + 380, 360, top + 450, [], 0); ramp(p, 650, top + 530, 440, top + 600, [], 0);
    decor('flower-white', 80, 520); decor('bush-small', 730, 120);
    return { pieces: p, height: H };
}
// 워프 룰렛 — 윗줄 3 ↔ 아랫줄 3, 짝은 시드로 섞는다(6가지). 사이에 통나무 한 줄(갈래 골짜기 워프 방과 같은 흔들기)
function warprouletteSection(top, rng, ctx) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.warproulette;
    sideWalls(wallFn(p), top, H);
    const perm = [0, 1, 2];
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    const warps = [];
    [0, 1].forEach(row => WARP_XS.forEach((x, i) => warps.push({ x, y: top + (row ? 330 : 100), idx: row * 3 + i })));
    warpRoom(p, warps, idx => idx < 3 ? 3 + perm[idx] : perm.indexOf(idx - 3), ctx);
    for (let x = 240; x <= 540; x += 100) p.push({ kind: 'log', x: Math.round(x + (rng() - 0.5) * 20), y: Math.round(top + 215 + (rng() - 0.5) * 30), r: LOG_R });
    decor('tree', 60, 80); decor('flower-pink', 740, 420);
    return { pieces: p, height: H };
}
// 셔터 문 — 판자문(last-gate) 3토막이 각자 주기로 여닫힌다. 닫힌 토막 위엔 무리가 쌓였다 열리면 떨어진다(타이밍 운). 위상은 시드
function shutterSection(top, rng, ctx) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.shutter, y = top + 220;
    sideWalls(wallFn(p), top, H);
    const open = Math.round(Math.min(SHUTTER_PERIOD_MS * 0.85, SHUTTER_OPEN_MS * Math.max(1, ctx.ballCount / SHUTTER_OPEN_SCALE_BALLS)));
    // 3토막 ㅡ _ ㅡ — 가운데는 SHUTTER_STEP_H 아래(단차). 토막마다 주기·위상이 달라 "모든 위치가 다 똑같아지는 지점"이 없다(사용자 2026-09-25). 토막 폭 167 ≥ 공 둘
    [[150, 317, 0, 0], [317, 483, 1, SHUTTER_STEP_H], [483, 650, 2, 0]].forEach(([x1, x2, i, dy]) => {
        const period = SHUTTER_PERIOD_MS + i * SHUTTER_PERIOD_STEP_MS, yy = y + dy;
        p.push({ kind: 'shutter', x1, y1: yy, x2, y2: yy, period, open: Math.min(open, Math.round(period * 0.85)), slide: SHUTTER_SLIDE_MS, phase: Math.round(rng() * period), zone: { x: x1, y: yy - SHUTTER_WAIT_H, w: x2 - x1, h: SHUTTER_WAIT_H } });
    });
    decor('rock', 90, 120); decor('bush-big', 720, 330);
    return { pieces: p, height: H };
}

// ── 움직이는 장애물(docs/goal/marble-moving-gimmicks.md) — 전부 기존 스프라이트/코드 도형. 에셋이 오면 파일만 넣는다(계약은 goal 문서) ──
// 진자 통나무 — 밧줄에 매달린 통나무 둘이 엇박으로 흔들리며 공을 쳐낸다
function pendulumsSection(top) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.pendulums;
    sideWalls(wallFn(p), top, H);
    p.push({ kind: 'pendulum', x: 300, y: top + 60, len: PEND_LEN, amp: PEND_AMP_DEG, period: PEND_PERIOD_MS, phase: 0, r: PEND_R });
    p.push({ kind: 'pendulum', x: 500, y: top + 300, len: PEND_LEN, amp: PEND_AMP_DEG, period: PEND_PERIOD_MS, phase: Math.round(PEND_PERIOD_MS / 2), r: PEND_R });
    decor('tree', 70, 120); decor('bush-small', 730, 440);
    return { pieces: p, height: H };
}
// 밀대 — 300폭 복도 양쪽 벽에서 울타리 머리가 번갈아 튀어나와 공을 밀어낸다. 머리가 나와 있는 1.2s 는 STUCK_MS 보다 짧아 대기 무리가 튀지 않는다
function pistonsSection(top) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top), H = SECTION_H.pistons;
    wall(150, top, 250, top + 80); wall(650, top, 550, top + 80);
    wall(250, top + 80, 250, top + 520); wall(550, top + 80, 550, top + 520);
    [[250, 180, 1, 0], [550, 320, -1, 1000], [250, 460, 1, 2000]].forEach(([x, y, dir, phase]) =>
        p.push({ kind: 'piston', x, y: top + y, dir, ext: PISTON_EXT, head: PISTON_HEAD, h: PISTON_H, period: PISTON_PERIOD_MS, out: PISTON_OUT_MS, phase }));
    wall(250, top + 520, 150, top + H); wall(550, top + 520, 650, top + H);
    decor('rock', 90, 260); decor('flower-white', 720, 400);
    return { pieces: p, height: H, bounds: [{ y1: top + 80, y2: top + 520, x1: 250, x2: 550 }] };
}
// 트램펄린 — 살짝 기운 천 둘. 닿으면 온 것보다 높이 튀고 좌우로 조금 흔들려 결국 안쪽 끝으로 굴러 떨어진다
function trampolinesSection(top) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.trampolines;
    sideWalls(wallFn(p), top, H);
    p.push({ kind: 'trampoline', x1: 200, y1: top + 180, x2: 400, y2: top + 200, e: TRAMP_E });
    p.push({ kind: 'trampoline', x1: 400, y1: top + 380, x2: 600, y2: top + 360, e: TRAMP_E });
    decor('bush-big', 80, 300); decor('tree', 730, 120);
    return { pieces: p, height: H };
}
// 돌풍 — 구간 전체에 주기마다 방향이 바뀌는(시드 수열) 바람. 통나무 두 줄이 있어 밀리는 게 보인다
function gustSection(top, rng) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.gust;
    sideWalls(wallFn(p), top, H);
    [[250, 180], [400, 180], [550, 180], [325, 380], [475, 380]].forEach(([x, y]) => p.push({ kind: 'log', x, y: top + y, r: LOG_R }));
    const dirs = []; for (let i = 0; i < GUST_DIRS; i++) dirs.push(rng() < 0.5 ? -1 : 1);
    p.push({ kind: 'gust', zone: { x: 150, y: top, w: 500, h: H }, period: GUST_PERIOD_MS, on: GUST_ON_MS, accel: GUST_ACCEL, phase: Math.round(rng() * GUST_PERIOD_MS), dirs });
    decor('tree', 60, 80); decor('bush-small', 740, 500);
    return { pieces: p, height: H };
}
// 지진 — 주기마다 0.7초 구역 전원이 튀어오른다(시드 킥). 말뚝 3줄 위라 튄 놈이 다른 자리로 떨어진다
function quakeSection(top, rng) {
    const p = [], decor = decorFn(p, top), H = SECTION_H.quake;
    sideWalls(wallFn(p), top, H);
    for (let r = 0; r < 3; r++) { const y = top + 100 + r * 60, off = (r % 2) ? 25 : 0; for (let x = 200 + off; x <= 600; x += 50) p.push({ kind: 'stake', x, y, r: STAKE_R }); }
    p.push({ kind: 'quake', zone: { x: 150, y: top, w: 500, h: H }, period: QUAKE_PERIOD_MS, dur: QUAKE_DUR_MS, phase: Math.round(rng() * QUAKE_PERIOD_MS) });
    decor('rock', 90, 300); decor('rock', 720, 160);
    return { pieces: p, height: H };
}

// 꼬리(고정): 통나무 범퍼 + 시소·진흙 → 구멍밭(뚜껑·몸싸움·독수리) → 집결 통로 → 도착 스탠드
function tailSection(top, ballCount) {
    const p = [], wall = wallFn(p), decor = decorFn(p, top);
    // ⑧ 통나무 범퍼 + 진흙·시소 (500폭). 끝은 구멍밭 폭(420)으로 좁아지는 깔때기
    sideWalls(wall, top, SECTION_H.bumpers);
    for (let r = 0; r < 3; r++) {
        const y = top + 80 + r * 120, off = (r % 2) ? 60 : 0;
        for (let x = 220 + off; x <= 580; x += 120) p.push({ kind: 'log', x, y, r: LOG_R });
    }
    p.push({ kind: 'seesaw', x: 400, y: top + 460, len: SEESAW_LEN, period: SEESAW_PERIOD_MS, amp: SEESAW_AMP_DEG });
    p.push({ kind: 'mud', x: 270, y: top + 520, rx: 60, ry: 32 });
    p.push({ kind: 'mud', x: 540, y: top + 600, rx: 60, ry: 32 });
    p.push({ kind: 'mud', x: 400, y: top + 670, rx: 50, ry: 28 });

    // ⑨ 구멍밭 — 얄쌍하고 짧게(420폭 × 280). 말뚝 3줄 → 바닥 골 구멍 5개(지붕 바닥이 구멍으로 유도, 구멍마다 여닫는 뚜껑) → 파이프
    //   결승 카메라가 위 구간(범퍼·시소·진흙)까지 한 화면에 담아야 하므로 구멍밭 자체는 작게.
    const HF = { x: 190, y: top + 700, w: 420, h: 280 };   // 구역. 파이프 사이 간격(pitch−HOLE_W=44)이 공(28)보다 넉넉해야 200마리 때 바닥을 뚫고 샌 공이 끼지 않는다
    const floorY = HF.y + HF.h;
    wall(150, top + SECTION_H.bumpers, HF.x, HF.y); wall(650, top + SECTION_H.bumpers, HF.x + HF.w, HF.y);   // 깔때기 500 → 420
    wall(HF.x, HF.y, HF.x, floorY); wall(HF.x + HF.w, HF.y, HF.x + HF.w, floorY);
    for (let r = 0; r < 3; r++) {
        const y = HF.y + 60 + r * 60, off = (r % 2) ? 25 : 0;
        for (let x = HF.x + 40 + off; x <= HF.x + HF.w - 40; x += 50) p.push({ kind: 'stake', x, y, r: STAKE_R });
    }
    const holes = [];
    const pitch = HF.w / HOLE_COUNT;                        // 84
    for (let i = 0; i < HOLE_COUNT; i++) {
        const cx = HF.x + pitch * (i + 0.5);
        const period = i === HOLE_COUNT - 1 ? HOLE_PERIOD_LAST_MS : Math.round(HOLE_PERIOD_FAR_MS + (HOLE_PERIOD_NEAR_MS - HOLE_PERIOD_FAR_MS) * i / (HOLE_COUNT - 2));   // 왼쪽(골에서 멂)=자주 … 오른쪽 둘째=가끔, 맨 오른쪽(골 옆)=거의 안 열림
        const open = Math.round(Math.min(period * 0.85, HOLE_OPEN_MS * Math.max(1, ballCount / HOLE_OPEN_SCALE_BALLS)));
        holes.push({ x: cx, y: floorY, w: HOLE_W, period, open, phase: Math.round(period * HOLE_PHASE_STEP * i), slide: HOLE_LID_SLIDE_MS });
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
    // 골 x 에서 통로 바닥 아래 파이프로 떨어져 스탠드 위 홈통(chute)을 왼쪽으로 굴러가 자기 자리에 떨어진다(클라 연출 — 물리 없음)
    p.push({ kind: 'stand', zone: { x: 150, y: laneTop + LANE_H + CHUTE_H + STAND_GAP, w: 500, h: STAND_ROWS_MAX * STAND_ROW_H }, cols: 10, chuteY: laneTop + LANE_H + CHUTE_H / 2, chuteH: CHUTE_H, chuteX: GOAL_X });
    p.push({ kind: 'dumpwall', x: LANE_END_X, y: laneY, facing: 'left' });
    decor('rock', 740, 180); decor('flower-yellow', 70, 480); decor('signpost', 700, 820); decor('flower-white', 100, 1120); decor('tree', 730, 1350);
    return { pieces: p, laneTop, laneY };
}

// 좌우 반전: 모든 x → TRACK_W − x. 선분(wall·belt·dam)은 끝점을 통째로 바꿔 x1 < x2 를 유지(belt·dam 물리가 가정), 방향 필드는 부호·각도 반전.
// 꼬리(구멍밭 주기 기울기 "골에서 먼 쪽=자주", 통로 골 방향)와 머리는 반전 대상이 아니다.
const MX = x => TRACK_W - x;
function mirrorPiece(q) {
    const m = { ...q };
    if ('x' in m) m.x = MX(q.x);
    if ('x1' in m) { m.x1 = MX(q.x2); m.y1 = q.y2; m.x2 = MX(q.x1); m.y2 = q.y1; }
    if (m.zone) m.zone = { ...q.zone, x: MX(q.zone.x + q.zone.w) };
    if (m.spots) m.spots = q.spots.map(s => ({ ...s, x: MX(s.x) }));
    if (m.gap) m.gap = { x1: MX(q.gap.x2), x2: MX(q.gap.x1) };
    if ('beaverX' in m) m.beaverX = MX(q.beaverX);
    if ('dir' in m) m.dir = -q.dir;
    if ('speed' in m) m.speed = -q.speed;
    if ('angle' in m) m.angle = Math.atan2(Math.sin(q.angle), -Math.cos(q.angle));   // π − angle (범위 정규화)
    if (m.dirs) m.dirs = q.dirs.map(d => -d);   // 돌풍 방향 수열
    return m;
}
const mirrorBound = b => ({ y1: b.y1, y2: b.y2, x1: MX(b.x2), x2: MX(b.x1) });

const MIDDLE_SECTIONS = [['stakes', stakesSection], ['beehive', beehiveSection], ['sun', sunSection], ['dam', damSection], ['windmill', windmillSection], ['device', deviceSection], ['variety', varietySection],   // 앞 TRACK_A_COUNT 개 = 트랙 A 순서(rng 없을 때 그대로)
    ['slalom', slalomSection], ['windhall', windhallSection], ['molefield', molefieldSection], ['springfield', springfieldSection], ['warproulette', warprouletteSection], ['shutter', shutterSection], ['climb', climbSection],
    ['pendulums', pendulumsSection], ['pistons', pistonsSection], ['trampolines', trampolinesSection], ['gust', gustSection], ['quake', quakeSection]];

// opts.fixed = 방장이 랜덤 맵을 끔 — 가운데는 트랙 A 순서·무반전, 모듈 안 랜덤(댐 틈 등)·독수리 수만 rng 로
function buildTrack(ballCount, rng, crowd, opts) {
    const canonical = !rng;
    const fixed = canonical || !!(opts && opts.fixed);
    rng = rng || (() => 0.75);   // rng 없으면(테스트·덤프): 원래 순서·무반전, 모듈 rng 도 0.75 고정(댐 틈 왼쪽·젖힘판 +1)
    // 마스터 rng 소비 순서 고정: 독수리 수 → 순서 → 반전 → 모듈별 서브시드. 모듈 안 랜덤(댐 틈·젖힘판 방향·틈 위치)과 독수리 수가 순서와 무관하다
    const eagles = drawEagles(rng, crowd);
    let order;
    if (fixed) order = MIDDLE_SECTIONS.slice(0, TRACK_A_COUNT).map((_, i) => i);
    else {   // 풀 전체 셔플 → 높이 예산 안에서 그리디로 담는다(합이 MIN 될 때까지, MAX 넘는 놈은 건너뜀)
        const pool = MIDDLE_SECTIONS.map((_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }   // Fisher–Yates
        const gim = pool.filter(i => GIMMICK_NAMES.includes(MIDDLE_SECTIONS[i][0])).slice(0, GIMMICK_MIN);   // 기믹 최소 개수 — 셔플 순서의 앞 둘을 맨 앞으로(예산엔 그대로 포함)
        order = []; let sum = 0;
        for (const si of gim.concat(pool.filter(i => !gim.includes(i)))) { const h = SECTION_H[MIDDLE_SECTIONS[si][0]]; if (sum >= MIDDLE_H_MIN) break; if (sum + h > MIDDLE_H_MAX) continue; order.push(si); sum += h; }
    }
    const mirror = order.map(() => !fixed && rng() < 0.5);
    const subRng = order.map(() => canonical ? (() => 0.75) : mulberry32(Math.floor(rng() * 0x7fffffff)));

    return assembleTrack(ballCount, order, mirror, subRng, eagles);
}
// 독수리 수 — 마릿수 단계별 가중치로 한 번 뽑는다(마스터 rng 의 첫 소비)
function drawEagles(rng, crowd) {
    const ew = EAGLE_COUNT_WEIGHTS[crowd] || EAGLE_COUNT_WEIGHTS[CROWD_DEFAULT];
    let er = rng(), eagles = ew.length;
    for (let i = 0; i < ew.length; i++) { er -= ew[i]; if (er < 0) { eagles = i + 1; break; } }
    return eagles;
}
// 머리 + 가운데(order = MIDDLE_SECTIONS 인덱스, mirror·subRng 는 같은 길이) + 꼬리를 쌓는다. buildTrack(예산 선택)과 buildTrackFrom(지정 배치)이 같이 쓴다
function assembleTrack(ballCount, order, mirror, subRng, eagles) {
    const head = headSection(ballCount);
    const pieces = head.pieces, bounds = [], ctx = { ballCount, warpUid: 0 };
    let y = head.height;
    order.forEach((si, k) => {
        const s = MIDDLE_SECTIONS[si][1](y, subRng[k], ctx);
        (mirror[k] ? s.pieces.map(mirrorPiece) : s.pieces).forEach(q => pieces.push(q));
        (s.bounds || []).forEach(b => bounds.push(mirror[k] ? mirrorBound(b) : b));
        y += s.height;
    });
    const tail = tailSection(y, ballCount);
    tail.pieces.forEach(q => pieces.push(q));
    // 공-공 밀어내기 뒤 하드 클램프 구역 — 빽빽한 무리(댐 대기 100마리+)에서 한 스텝의 누적 밀림이 반지름을 넘으면 벽 반대편으로 나가 버리고,
    // collideSegment 는 가까운 쪽으로 밀어내니 그대로 밖으로 샌다. 바깥벽(첫 모듈부터 통로까지 전부 150/650)과 모듈이 낸 채널(댐 320/480)만
    bounds.unshift({ y1: head.height, y2: tail.laneTop, x1: 150, x2: 650 });

    return {
        width: TRACK_W, startY: head.startY, goalY: tail.laneY, goalX: GOAL_X, endY: tail.laneTop + LANE_H + 260,
        ballR: BALL_R, napR: NAP_R, eagles,
        pieces, bounds,
        layout: { order: order.map(i => MIDDLE_SECTIONS[i][0]), mirror }   // 덤프·sweep 표시용(클라는 안 읽음)
    };
}
// 지정 배치로 조립 — 테스트·프리뷰 덤프용(AutoTest/marble-sim-dump.js layout 인자). spec = 모듈 이름 배열, 끝에 '!' 면 좌우반전. 예산·셔플 없이 그대로 쌓는다
function buildTrackFrom(ballCount, spec, rng, crowd) {
    rng = rng || (() => 0.75);
    const eagles = drawEagles(rng, crowd);
    const order = spec.map(name => {
        const i = MIDDLE_SECTIONS.findIndex(m => m[0] === name.replace(/!$/, ''));
        if (i < 0) throw new Error('모르는 모듈: ' + name + ' (가능: ' + MIDDLE_SECTIONS.map(m => m[0]).join(', ') + ')');
        return i;
    });
    const mirror = spec.map(name => /!$/.test(name));
    const subRng = order.map(() => mulberry32(Math.floor(rng() * 0x7fffffff)));
    return assembleTrack(ballCount, order, mirror, subRng, eagles);
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
// 뚜껑이 닫힌 채로 남은 시간(ms). 열려 있거나 여닫히는 중이면 -1
function lidClosedLeft(h, t) {
    const c = ((t + h.phase) % h.period + h.period) % h.period;
    return c >= h.open ? h.period - c : -1;
}
function windmillAngle(w, t) { return 2 * Math.PI * t / w.period; }
// 주기 장치(두더지·선풍기) 켜짐 판정: 주기 안 [0, on) 이 켜진 창. 클라(js/marble-render.js)와 같은 식
function deviceOn(d, t) { const c = ((t + d.phase) % d.period + d.period) % d.period; return c < (d.on != null ? d.on : d.up); }

/**
 * 시뮬레이션. balls = layoutBalls() 결과. 반환:
 * { track, sampleMs, frames, events, finishOrder, simEndMs, durationMs }
 *  frames[k] = [x0,y0,x1,y1,…] (정수, 도착/정지 무관 항상 기록. 도착한 공은 -1,-1)
 *  events    = [{ t, type, ball?, x?, y? }] — gateOpen|bees|nap|wake|damHit|damCrack|damBurst|pitFall|pitErupt|mole|flip|mud|mudEnd|bump|spring|warp|warpOut|eagleGrab|eagleMiss|eagleDrop|scuffle|scuffleEnd|land|trip|doze|finish|tramp|quake
 *              scuffle/scuffleEnd 는 ball 대신 { a, b, hole } (a = 왼쪽 공). scuffleEnd.startled = 뚜껑이 열려 떨어진 것(→ land.dizzy)
 */
async function simulate(balls, seed, track, opts) {
    const capMs = (opts && opts.capMs) || SIM_CAP_MS;   // 도구 전용(AutoTest/marble-sim-dump.js 전부-배치 프리셋): 서버는 안 넘긴다 — 실제 경주 캡은 SIM_CAP_MS
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
        pitDone: false, damHold: 0, walkSpeed: 0, walkRow: 0, stallUntil: 0, stallAt: 0, stallKind: '',
        stuckSince: 0, lidAt: -1e9, lidHole: -1, lidSince: 0, scuffle: -1, scuffled: false, moleAt: -1e9, springAt: -1e9, springOnSince: -1, ffDone: false,
        warpDone: {}, warpUntil: 0, warpOut: null,
        carry: null, eagled: false, eagledBy: {}    // 독수리에 잡힘 { x0, y0, x1, y1, t0, t1 } / 채인 적 있음 / 노린 적 있는 독수리 index → true
    }));

    // 조각 분류
    const walls = [], stakes = [], muds = [], moles = [], belts = [], fans = [], warps = [], springs = [], shutters = [], pendulums = [], pistons = [], trampolines = [], gusts = [], quakes = [];
    let beehive = null, sun = null, dam = null, pit = null, seesaw = null, lane = null, windmill = null, holefield = null, flipflop = null;
    const scufflePairs = [];   // 구멍 index → 지금 밀기 중인 { a: 왼쪽 공, b: 오른쪽 공, lostAt } | null
    for (const pc of track.pieces) {
        switch (pc.kind) {
            case 'wall': walls.push(pc); break;
            case 'stake': case 'log': stakes.push(pc); break;
            case 'mud': muds.push(pc); break;
            case 'mole': moles.push(pc); break;
            case 'belt': belts.push(pc); break;
            case 'fan': fans.push(pc); break;
            case 'warp': warps.push(pc); break;
            case 'shutter': shutters.push(pc); break;
            case 'pendulum': pendulums.push(pc); break;
            case 'piston': pistons.push(pc); break;
            case 'trampoline': trampolines.push(pc); break;
            case 'gust': gusts.push(pc); break;
            case 'quake': quakes.push(pc); break;
            case 'spring': springs.push({ pc, readyAt: 0, onSince: -1 }); break;
            case 'flipflop': flipflop = pc; break;
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
    const bounds = track.bounds || [];
    const damThreshold = Math.max(DAM_MIN_COUNT, Math.ceil(n * DAM_FRACTION));
    const eagles = Array.from({ length: track.eagles || 1 }, () => ({ nextAt: -1 }));
    let eagleFinal = false, eagleCount = 0;   // 결승전(남은 ≤ EAGLE_FINAL_ALIVE) 진입 여부 — 진입 순간 전체 카운터 리셋
    let damActive = !!dam, damFirstContact = -1, damCracked = false;
    let pitLastErupt = -1;   // 마지막 분출 시각(-1 = 아직 아무도 안 빠짐)
    let beesAt = -1;
    let ffDir = flipflop ? flipflop.dir : 1;   // 플립플롭 젖힘판 방향(-1 왼쪽으로 낮음 → 공은 왼쪽 지름길)
    // 젖힘은 판 구역에 공이 하나도 없는 스텝에 적용(그동안 홀수 마리가 지났으면 반대로). 타고 내려가던 공 밑에서 판이 뒤집히면 그 공은 새 방향으로 실려 가는데,
    // 공이 목 오른쪽 벽을 타고 들어와 왼쪽 판에선 위쪽 끝에 얹혀 오래 미끄러지므로 실려 가는 쪽이 오른쪽으로 쏠린다(40시드 보통 61:39·우르르 62:38).
    // 구역 윗선은 판 꼭대기 + 공 반지름(FF_ZONE_TOP_PAD) — 목 바닥까지 내리면 보통 59%, 판 꼭대기까지 올리면 목 안 대기 공까지 붙들어 왼쪽으로 쏠린다(우르르 36%)
    let ffPending = 0, ffTouched = false, ffLastBall = null;
    const quakeFired = quakes.map(() => -1);   // 지진마다 마지막으로 흔든 주기 번호
    const cyc = (d, t) => ((t + d.phase) % d.period + d.period) % d.period;   // 주기 장치 위상 시각

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
        if (d2 >= b.r * b.r) return false;
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
        return true;
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

    // 공 vs 움직이는 원(진자 통나무): 원의 속도(cvx, cvy)를 뺀 상대 속도로 반사
    const collideMovingCircle = (t, b, cx, cy, cr, e, cvx, cvy) => {
        let nx = b.x - cx, ny = b.y - cy;
        const minD = b.r + cr, d2 = nx * nx + ny * ny;
        if (d2 >= minD * minD) return false;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { nx = 0; ny = -1; d = 0; } else { nx /= d; ny /= d; }
        b.x += nx * (minD - d); b.y += ny * (minD - d);
        const vn = (b.vx - cvx) * nx + (b.vy - cvy) * ny;
        if (vn < 0) { bump(t, b, -vn); b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
        return true;
    };
    // 공 vs 직선으로 움직이는 선분(밀대 머리·옆면): 선분 속도(pvx, pvy)를 뺀 상대 속도로 반사 — 나오는 머리에 맞으면 머리 속도만큼 밀린다
    const collideSegmentVel = (t, b, x1, y1, x2, y2, e, pvx, pvy) => {
        const c = closestOnSegment(b.x, b.y, x1, y1, x2, y2);
        let nx = b.x - c.x, ny = b.y - c.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= b.r * b.r) return false;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { nx = 0; ny = -1; d = 0; } else { nx /= d; ny /= d; }
        b.x += nx * (b.r - d); b.y += ny * (b.r - d);
        const vn = (b.vx - pvx) * nx + (b.vy - pvy) * ny;
        if (vn < 0) { bump(t, b, -vn); b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
        return true;
    };
    const pendulumAt = (pd, t) => {   // 진자 통나무 위치·속도(px/s)
        const w = 2 * Math.PI / pd.period, ph = w * (t + pd.phase), A = pd.amp * Math.PI / 180;
        const th = A * Math.sin(ph), dth = A * Math.cos(ph) * w * 1000;
        return { x: pd.x + pd.len * Math.sin(th), y: pd.y + pd.len * Math.cos(th), vx: pd.len * Math.cos(th) * dth, vy: -pd.len * Math.sin(th) * dth };
    };
    const pistonAt = (ps, t) => {   // 밀대 돌출 길이·속도(px/s): out 동안 sin 반파로 나갔다 들어오고 나머진 0
        const c = cyc(ps, t);
        if (c >= ps.out) return { e: 0, v: 0 };
        const k = Math.PI * c / ps.out;
        return { e: ps.ext * Math.sin(k), v: ps.ext * Math.cos(k) * (Math.PI / ps.out) * 1000 };
    };

    const totalSteps = Math.ceil(capMs / SIM_DT_MS);
    const sampleEvery = sampleMs / SIM_DT_MS;
    let simEndMs = capMs;

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

        // 지진: 주기 창 안에서 구역에 굴러가는 공이 있으면(창마다 한 번) 전원 킥(시드) + 이벤트. 공이 없으면 안 난다 —
        // 창마다 무조건 이벤트를 보냈더니 카메라가 어디를 보든 경주 내내 3.5초마다 흔들렸다(사용자 2026-09-25 "자꾸 카메라 흔들리는 거 왜 그럼")
        for (let qi = 0; qi < quakes.length; qi++) {
            const q = quakes[qi], k = Math.floor((t + q.phase) / q.period);
            if (cyc(q, t) >= q.dur || quakeFired[qi] === k) continue;
            const hit = B.filter(b => b.state === 'roll' && inZone(b, q.zone));
            if (!hit.length) continue;
            quakeFired[qi] = k;
            for (const b of hit) { b.vx += (rng() - 0.5) * QUAKE_VX; b.vy -= rng() * QUAKE_VY; b.stuckSince = t; }
            pushEvent(t, 'quake', null, { x: q.zone.x + q.zone.w / 2, y: q.zone.y + q.zone.h / 2, dur: q.dur });
        }
        // 댐: 구역 안 공 수
        if (dam && damActive) {
            let cnt = 0;
            for (const b of B) if (b.state !== 'done' && inZone(b, dam.zone)) cnt++;
            if (cnt > 0 && damFirstContact < 0) { damFirstContact = t; pushEvent(t, 'damHit'); }   // 클라는 damHit→damBurst 사이를 프레임 진행에 쓴다
            if (!damCracked && cnt >= Math.ceil(damThreshold / 2)) { damCracked = true; pushEvent(t, 'damCrack'); }
            if (cnt >= damThreshold || (damFirstContact >= 0 && t - damFirstContact >= DAM_MAX_HOLD_MS)) {
                damActive = false;
                pushEvent(t, 'damBurst');
                // 한꺼번에 툭 떨어지지 않고 물처럼 흘러나간다: 마리별로 0~DAM_DRAIN_MS 뒤에 댐이 풀리며 아래로 밀린다
                for (const b of B) {
                    if (b.state === 'roll' && inZone(b, dam.zone)) b.damHold = t + rng() * DAM_DRAIN_MS;
                }
            }
        }
        if (dam && !damActive) {
            for (const b of B) {
                if (b.damHold > 0 && t >= b.damHold) { b.damHold = 0; b.vy += DAM_BURST_VY * (0.6 + rng() * 0.4); b.vx += (rng() - 0.5) * DAM_BURST_VX; }
            }
        }
        // 간헐천 분출: 빠진 놈이 있고 주기가 찼으면 전원 위로 뿜어낸다
        if (pit && pitLastErupt >= 0 && t - pitLastErupt >= PIT_ERUPT_PERIOD_MS) {
            const trapped = B.filter(b => b.state === 'pit').sort((a, c) => a.id - c.id);
            if (trapped.length) {
                pushEvent(t, 'pitErupt', null, { x: pit.zone.x + pit.zone.w / 2, y: pit.zone.y + pit.zone.h / 2, count: trapped.length });
                // 같은 자리에 겹쳐 있던 공을 그대로 풀면 공끼리 밀어내기가 한 스텝에 수십 px 라 채널 벽을 뚫고 밖으로 샌다 →
                // 격자(가로 5칸 × 위로 쌓기)로 펼쳐 놓고 띄운다. 채널 폭 160 안에서 32px 간격이면 겹침 없음
                const cols = Math.max(1, Math.floor((pit.zone.w - 2 * BALL_R) / (2 * BALL_R + 4)));
                trapped.forEach((b, i) => {
                    const col = i % cols, row = Math.floor(i / cols);
                    b.x = pit.zone.x + BALL_R + 2 + col * (2 * BALL_R + 4);
                    b.y = pit.zone.y - row * (2 * BALL_R + 2);   // 구덩이 위쪽 가장자리에서 솟는다(많으면 위로 쌓아 순차적으로)
                    wakeBall(t, b, (rng() - 0.5) * 2 * PIT_ERUPT_VX, -(PIT_ERUPT_VY_MIN + rng() * (PIT_ERUPT_VY_MAX - PIT_ERUPT_VY_MIN)));
                });
            }
            pitLastErupt = t;
        }

        // ── 집결 통로 걷기: 제 속도로(겹침·추월 허용), 골 x 통과 시 도착 ──
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
                w.x += w.walkSpeed * dt; w.vx = w.walkSpeed;   // 줄 서기 없음 — 빠른 놈이 느린 놈·자는 놈을 지나친다(통로에서도 순위가 바뀌어야 한다)
                if (w.x >= lane.goalX) finishBall(t, w);
            }
            }
        }

        // ── 독수리(마릿수 단계별 1~3마리): 구멍밭 뚜껑 위에서 기다리는 공 + 통로 걷는 동물 중 한 마리씩 채 간다 ──
        if (holefield && !eagleFinal && finishedCount >= n - EAGLE_FINAL_ALIVE) { eagleFinal = true; eagleCount = 0; }
        if (holefield) for (let ei = 0; ei < eagles.length; ei++) {
            const eg = eagles[ei]; if (eagleCount >= (eagleFinal ? Math.min(EAGLE_MAX_FINAL, eagles.length) : Math.max(EAGLE_MAX_EARLY_MIN, Math.floor(n * EAGLE_MAX_EARLY_RATIO)))) break;   // 결승전 예산은 독수리 수를 넘지 않는다(소인원 1마리 → 1회)
            const cands = [], wWalk = eagleFinal ? EAGLE_WALK_WEIGHT : 1, wWait = eagleFinal ? 1 : EAGLE_WAIT_WEIGHT_EARLY;
            for (const b of B) {
                if (b.eagled || b.eagledBy[ei]) continue;   // 한 번 채인 놈은 어느 독수리도 다시 안 잡는다 / 헛발톱 친 놈은 그 독수리만 다시 안 노린다
                if (b.state === 'walk') { for (let w = 0; w < wWalk; w++) cands.push(b); }   // 막판엔 달리는 놈 우선
                else if (b.state === 'roll' && t - b.lidAt < 50 && inZone(b, holefield.zone)) { for (let w = 0; w < wWait; w++) cands.push(b); }   // 초반엔 몰린 놈 덜어 내기
            }
            if (cands.length && eg.nextAt < 0) eg.nextAt = t + EAGLE_WAIT_MS + ei * EAGLE_STAGGER_MS;
            if (cands.length && eg.nextAt >= 0 && t >= eg.nextAt) {
                const v = cands[Math.floor(rng() * cands.length)];
                const side = rng() < 0.5 ? -1 : 1, miss = rng() < EAGLE_MISS_P;
                const dropTop = (seesaw ? seesaw.y : holefield.zone.y - 300) - EAGLE_DROP_ABOVE_SEESAW, dropLow = holefield.zone.y - EAGLE_DROP_MIN_ABOVE_HF;
                const tx = TRACK_W / 2 + side * EAGLE_DROP_DX, ty = Math.round(dropTop + (Math.min(1, finishedCount / Math.max(1, n - 1)) * EAGLE_DROP_LATE_W + rng() * (1 - EAGLE_DROP_LATE_W)) * Math.max(0, dropLow - dropTop));
                v.eagledBy[ei] = true;
                if (!miss) {
                    v.carry = { x0: v.x, y0: v.y, x1: tx, y1: ty, t0: t, t1: t + EAGLE_FLY_MS };
                    v.eagled = true; v.state = 'carried'; v.vx = 0; v.vy = 0; v.stallUntil = 0; v.stallKind = ''; v.scuffled = false;
                }
                const alive = B.filter(b => b.state !== 'done').length;
                eagleCount++; eg.nextAt = t + EAGLE_FLY_MS + (alive <= EAGLE_FINAL_ALIVE ? EAGLE_REST_FINAL_MS : EAGLE_REST_MS);
                pushEvent(t, miss ? 'eagleMiss' : 'eagleGrab', v, { eagle: ei, x: Math.round(v.x), y: Math.round(v.y), tx, ty, dur: EAGLE_FLY_MS });
            }
        }

        // ── 공 적분 ──
        ffTouched = false;
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk') continue;
            if (b.state === 'carried') {   // 독수리 발톱에: 곡선(위로 EAGLE_ARC)으로 떨어뜨릴 자리까지, 도착하면 놓는다
                const c = b.carry, k = Math.min(1, (t - c.t0) / (c.t1 - c.t0)), e = k * k * (3 - 2 * k);
                b.x = c.x0 + (c.x1 - c.x0) * e; b.y = c.y0 + (c.y1 - c.y0) * e - Math.sin(k * Math.PI) * EAGLE_ARC;
                if (t >= c.t1) { b.state = 'roll'; b.carry = null; b.vx = 0; b.vy = 40; b.stuckSince = t; b.lidAt = -1e9; pushEvent(t, 'eagleDrop', b, { x: Math.round(b.x), y: Math.round(b.y) }); }
                continue;
            }
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
            if (b.state === 'warp') {   // 짝 파이프 안에 숨어 있다가 위로 뿅
                if (t < b.warpUntil) continue;
                const o = b.warpOut; b.state = 'roll'; b.x = o.x; b.y = o.y; b.vx = o.vx; b.vy = o.vy; b.stuckSince = t; b.warpOut = null;
                pushEvent(t, 'warpOut', b, { x: Math.round(o.x), y: Math.round(o.y) });
                continue;
            }

            let ax = 0, ay = GRAVITY;
            let drag = DRAG;
            if (beesOn && beehive && inZone(b, beehive.zone)) {
                ax += (rng() * 2 - 1) * BEE_ACCEL;
                ay += (rng() * 2 - 1) * BEE_ACCEL * 0.5;
            }
            for (const f of fans) if (Math.abs(b.y - f.y) <= f.band / 2 && deviceOn(f, t)) ax += f.dir * f.accel;   // 선풍기: 켜진 동안 띠 안 공을 옆으로
            for (const g of gusts) if (cyc(g, t) < g.on && inZone(b, g.zone)) ax += g.dirs[Math.floor((t + g.phase) / g.period) % g.dirs.length] * g.accel;   // 돌풍: 주기마다 방향 바뀜
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
            if (dam && (damActive || b.damHold > t) && Math.abs(b.y - dam.y1) < BALL_R + 4) {   // 틈(gap)은 비워 둔다. 위에서 떨어져 맞으면 크게 튕겨 올린다 — 먼저 온 놈이 오히려 손해. 터진 뒤에도 제 차례(damHold)까지는 벽
                const vy0 = b.vy;
                let hit = false;
                if (dam.gap.x1 > dam.x1) hit = collideSegment(t, b, dam.x1, dam.y1, dam.gap.x1, dam.y1, WALL_RESTITUTION) || hit;
                if (dam.gap.x2 < dam.x2) hit = collideSegment(t, b, dam.gap.x2, dam.y1, dam.x2, dam.y2, WALL_RESTITUTION) || hit;
                if (hit && vy0 > 0 && b.y < dam.y1) b.vy = -Math.max(DAM_BOUNCE_MIN, Math.min(DAM_BOUNCE_MAX, vy0));
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
            for (const ss of springs) {   // 스프링 널빤지: 경사로 끝 판(정지 선분). 장전 상태에서 판 위에 SPRING_ARM_DELAY_MS 머문 공을 뒤·위로 쏘고 쿨타임
                const sp = ss.pc;
                if (Math.abs(b.x - sp.x) > sp.len + BALL_R + 4 || Math.abs(b.y - sp.y) > sp.len + BALL_R + 4) continue;
                const a = sp.angle, ex = sp.x + Math.cos(a) * sp.len, ey = sp.y + Math.sin(a) * sp.len;
                collideSegment(t, b, sp.x, sp.y, ex, ey, WALL_RESTITUTION);
                if (t < ss.readyAt || t - b.springAt < SPRING_COOLDOWN_MS) continue;
                const su = Math.cos(a) >= 0 ? 1 : -1;   // 경사로 방향(오른쪽↘ 1 / 왼쪽↙ -1) — '위' 법선과 발사 방향(뒤 = 경사로 시작 쪽)이 뒤집힌다
                const dx = b.x - sp.x, dy = b.y - sp.y, along = dx * Math.cos(a) + dy * Math.sin(a), above = (dx * Math.sin(a) - dy * Math.cos(a)) * su;   // 판 축 좌표(above>0 = 판 위)
                const onPlank = along >= -4 && along <= sp.len + 4 && above >= 0 && above <= BALL_R + 6;
                if (!onPlank) { if (b.springOnSince < 0 || t - b.springOnSince > 60) b.springOnSince = -1; continue; }
                if (b.springOnSince < 0) { b.springOnSince = t; continue; }
                if (t - b.springOnSince < SPRING_ARM_DELAY_MS) continue;
                b.vx = -su * SPRING_VX + (rng() - 0.5) * 60; b.vy = -SPRING_VY; b.springAt = t; b.springOnSince = -1; b.stuckSince = t;
                ss.readyAt = t + sp.cooldown;
                pushEvent(t, 'spring', b, { x: Math.round(ex), y: Math.round(ey), readyAt: ss.readyAt });
            }
            for (const m of moles) {   // 두더지: 올라와 있는 순간 머리 위에 있는 공만 튕긴다
                if (Math.abs(b.y - m.y) > 40 || Math.abs(b.x - m.x) > 40) continue;
                if (!deviceOn(m, t) || t - b.moleAt < MOLE_COOLDOWN_MS) continue;
                const dx = b.x - m.x, dy = b.y - m.y;
                if (dx * dx + dy * dy > (m.r + BALL_R * 0.5) * (m.r + BALL_R * 0.5)) continue;
                b.vx = b.vx * 0.3 + m.dir * MOLE_VX; b.vy = -MOLE_VY; b.moleAt = t; b.stuckSince = t;
                pushEvent(t, 'mole', b, { x: Math.round(m.x), y: Math.round(m.y) });
            }
            for (const bt of belts) {   // 컨베이어: 위에 얹힌 공을 표면 접선 속도로 끌고 간다. 기울어진 벨트(등반)도 같은 식, period 가 있으면 멈춘 동안은 그냥 경사면(미끄러진다)
                if (b.y < Math.min(bt.y1, bt.y2) - BALL_R - 4 || b.y > Math.max(bt.y1, bt.y2) + BALL_R + 4 || b.x < bt.x1 - BALL_R || b.x > bt.x2 + BALL_R) continue;
                const dx = bt.x2 - bt.x1, dy = bt.y2 - bt.y1;
                if (collideSegment(t, b, bt.x1, bt.y1, bt.x2, bt.y2, WALL_RESTITUTION) && dx * (b.y - bt.y1) - dy * (b.x - bt.x1) < 0 && (!bt.period || deviceOn(bt, t))) {   // 얹힌 쪽(위)만
                    const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, vt = b.vx * ux + b.vy * uy, k = Math.min(1, BELT_GRIP * dt);
                    b.vx += (bt.speed - vt) * k * ux; b.vy += (bt.speed - vt) * k * uy;
                }
            }
            if (flipflop && Math.abs(b.y - flipflop.y) < flipflop.len + BALL_R + 4) {   // 플립플롭 젖힘판(축을 지나는 정지 선분, 방향만 바뀜): 반대쪽 위 ~ 보내는 쪽 아래
                const a = flipflop.angleDeg * Math.PI / 180, dx = ffDir * Math.sin(a) * flipflop.len, dy = Math.cos(a) * flipflop.len;
                const hit = collideSegment(t, b, flipflop.x - dx, flipflop.y - dy, flipflop.x + dx, flipflop.y + dy, WALL_RESTITUTION);
                if (hit || (Math.abs(b.x - flipflop.x) < Math.abs(dx) + BALL_R && b.y > flipflop.y - dy + FF_ZONE_TOP_PAD)) ffTouched = true;   // 판에 닿았거나 판 구역 안(타고 내려가는 중·튕겨 떠 있는 중) → 젖힘 보류
            }
            if (flipflop && !b.ffDone && b.y > flipflop.triggerY && b.y < flipflop.triggerY + 80 && Math.abs(b.x - flipflop.x) < 200) {   // 지나가면 판이 반대로(판이 비는 스텝에 적용)
                b.ffDone = true; ffPending++; ffLastBall = b;
            }
            if (holefield && Math.abs(b.y - holefield.floorY) < BALL_R + 4) {   // 구멍 뚜껑(닫힌 만큼만 벽)
                for (let hi = 0; hi < holefield.holes.length; hi++) {
                    const h = holefield.holes[hi];
                    const cover = lidCover(h, t); if (cover <= 0) continue;
                    const lx = h.x - h.w / 2, rx = lx + h.w * cover;
                    if (b.x < lx - BALL_R || b.x > rx + BALL_R) continue;
                    collideSegment(t, b, lx, h.y, rx, h.y, WALL_RESTITUTION);
                    if (Math.abs(b.y - h.y) <= BALL_R + 0.5 && b.x >= lx && b.x <= rx) {   // 뚜껑 위에서 기다리는 중 — 갇힘 킥 제외. 몸싸움 후보용으로 어느 구멍에 언제부터 머무는지도 기록
                        if (b.lidHole !== hi || t - b.lidAt >= 50) { b.lidSince = t; b.scuffled = false; }   // 다시 뚜껑에 올라앉으면 화들짝 기억은 지운다
                        b.lidAt = t; b.lidHole = hi;
                    }
                }
            }
            for (const pd of pendulums) {   // 진자 통나무: 움직이는 원
                if (Math.abs(b.y - pd.y) > pd.len + pd.r + BALL_R || Math.abs(b.x - pd.x) > pd.len + pd.r + BALL_R) continue;
                const o = pendulumAt(pd, t);
                collideMovingCircle(t, b, o.x, o.y, pd.r, WALL_RESTITUTION, o.vx, o.vy);
            }
            for (const ps of pistons) {   // 밀대: 머리 앞면(세로) + 위아래 옆면(가로) — 나와 있는 만큼, 머리 속도로
                const o = pistonAt(ps, t); if (o.e <= 0) continue;
                const fx = ps.x + ps.dir * o.e, top = ps.y - ps.h / 2, bot = ps.y + ps.h / 2;
                if (Math.abs(b.y - ps.y) > ps.h / 2 + BALL_R + 4 || (ps.dir > 0 ? b.x > fx + BALL_R + 4 : b.x < fx - BALL_R - 4)) continue;
                collideSegmentVel(t, b, fx, top, fx, bot, WALL_RESTITUTION, ps.dir * o.v, 0);
                collideSegmentVel(t, b, ps.x, top, fx, top, WALL_RESTITUTION, ps.dir * o.v, 0);
                collideSegmentVel(t, b, ps.x, bot, fx, bot, WALL_RESTITUTION, ps.dir * o.v, 0);
            }
            for (const tr of trampolines) {   // 트램펄린: 반발 1 넘는 선분. 내려오다 튀어 오른 순간 좌우 시드 킥 + 이벤트(천 연출)
                if (b.y < Math.min(tr.y1, tr.y2) - BALL_R - 4 || b.y > Math.max(tr.y1, tr.y2) + BALL_R + 4 || b.x < tr.x1 - BALL_R || b.x > tr.x2 + BALL_R) continue;
                const vy0 = b.vy;
                if (collideSegment(t, b, tr.x1, tr.y1, tr.x2, tr.y2, tr.e) && vy0 > 150 && b.vy < 0) { b.vx += (rng() - 0.5) * 2 * TRAMP_KICK; pushEvent(t, 'tramp', b, { x: Math.round(b.x), y: Math.round(b.y) }); }
            }
            for (const sh of shutters) {   // 셔터 문: 닫혀 있는 동안(여닫는 중 포함) 문 선이 벽. 열리면 그냥 떨어진다
                if (Math.abs(b.y - sh.y1) > BALL_R + 4 || b.x < sh.x1 - BALL_R || b.x > sh.x2 + BALL_R || lidCover(sh, t) <= 0) continue;
                collideSegment(t, b, sh.x1, sh.y1, sh.x2, sh.y2, WALL_RESTITUTION);
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
            // 워프 파이프: 입구 띠에 중심이 들어오면 짝 파이프로. 들어간 것·나오는 것 둘 다 이 공에겐 소진(핑퐁 방지)
            let warped = false;
            for (const q of warps) {
                if (b.warpDone[q.uid] || Math.abs(b.x - q.x) > q.w / 2 || b.y < q.y - 4 || b.y > q.y + 20) continue;
                const o = warps.find(z => z.uid === q.pairUid);   // 짝은 트랙 전역 uid 로(방이 둘이어도 안 섞임). 이벤트의 from/to 는 방 안 번호(클라 라벨)
                b.warpDone[q.uid] = true; b.warpDone[o.uid] = true;
                b.state = 'warp'; b.warpUntil = t + WARP_MS; b.vx = 0; b.vy = 0;
                b.x = o.x; b.y = o.y - BALL_R;   // 숨어 있는 동안 프레임은 출구에 찍힌다(클라는 안 그림) — 보간 미끄러짐 방지
                b.warpOut = { x: o.x, y: o.y - BALL_R - 2, vx: (o.x < TRACK_W / 2 ? 1 : -1) * WARP_POP_VX + (rng() - 0.5) * 60, vy: -WARP_POP_VY };
                pushEvent(t, 'warp', b, { x: q.x, y: q.y, from: q.idx, to: o.idx });
                warped = true; break;
            }
            if (warped) continue;
            if (pit && !b.pitDone && inZone(b, pit.zone)) {
                // 처음 온 놈은 무조건 빠진다(정원 없음). 다음 분출 때 튀어 오르고 그 뒤론 위를 굴러 지나간다
                b.pitDone = true;
                b.state = 'pit'; b.vx = 0; b.vy = 0;
                b.y = pit.zone.y + pit.zone.h / 2;
                if (pitLastErupt < 0) pitLastErupt = t;
                pushEvent(t, 'pitFall', b);
                continue;
            }
            for (let mi = 0; mi < muds.length; mi++) {
                if (!b.mudDone[mi] && inEllipse(b, muds[mi])) {
                    b.mudDone[mi] = true; b.state = 'mud'; b.mudAt = t; b.vx = 0; b.vy = 0;
                    pushEvent(t, 'mud', b);
                    break;
                }
            }
            if (b.state !== 'roll') continue;

            // 통로 착지 → 걷기 시작. 도착(finishBall)은 걷기 루프에서 골 x 를 지날 때
            if (lane && b.y >= lane.y) {
                b.state = 'walk'; b.x = Math.max(lane.x0 + BALL_R, b.x); b.y = lane.y; b.vx = 0; b.vy = 0;
                b.walkSpeed = Math.round(WALK_SPEED_MIN + rng() * (WALK_SPEED_MAX - WALK_SPEED_MIN));
                b.walkRow = Math.floor(rng() * lane.rows);
                const dizzy = b.scuffled;   // 몸싸움하다 화들짝 떨어진 놈은 숨 고르기 위에 SCUFFLE_DIZZY_MS 기절을 더 얹는다 — 걷기 시작이 늦어질 뿐(순위는 통로 경주에서)
                if (dizzy) b.scuffled = false;
                b.stallKind = dizzy ? 'dizzy' : 'rest'; b.stallAt = t; b.stallUntil = t + LAND_REST_MS + (dizzy ? SCUFFLE_DIZZY_MS : 0);
                pushEvent(t, 'land', b, dizzy ? { speed: b.walkSpeed, row: b.walkRow, dizzy: true } : { speed: b.walkSpeed, row: b.walkRow });
                continue;
            }

            // 갇힘 방지
            const spd = Math.hypot(b.vx, b.vy);
            const waitingDam = dam && (damActive || b.damHold > t) && inZone(b, dam.zone);
            const waitingShutter = shutters.some(sh => lidCover(sh, t) > 0 && inZone(b, sh.zone));   // 닫힌 문 위 무더기 — 열릴 때까지 갇힘 킥 없음
            const inQuake = quakes.some(q => cyc(q, t) < q.dur && inZone(b, q.zone));   // 흔들리는 동안은 지진이 알아서 튕긴다
            if (spd > STUCK_SPEED || waitingDam || waitingShutter || inQuake || t - b.lidAt < 50) b.stuckSince = t;
            else if (t - b.stuckSince >= STUCK_MS) {
                b.vx = (b.x < TRACK_W / 2 ? 1 : -1) * (STUCK_KICK_X_MIN + rng() * STUCK_KICK_X_RND); b.vy = STUCK_KICK_Y; b.stuckSince = t;
            }
        }

        if (ffPending && !ffTouched) { if (ffPending % 2) { ffDir = -ffDir; pushEvent(t, 'flip', ffLastBall, { dir: ffDir }); } ffPending = 0; }

        // ── 공-공 충돌(해시) ──
        const grid = new Map();
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk' || b.state === 'pit' || b.state === 'warp' || b.state === 'carried') continue;   // pit = 땅속(간헐천), warp = 파이프 속, carried = 독수리 발톱 — 장애물 아님
            const k = (Math.floor(b.x / CELL) + 4096) * 65536 + Math.floor((b.y + 8192) / CELL);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(b);
        }
        for (const b of B) {
            if (b.state === 'done' || b.state === 'walk' || b.state === 'pit' || b.state === 'warp' || b.state === 'carried') continue;
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

        for (const b of B) {   // 벽 밖으로 밀려난 공 되돌리기 (track.bounds 참고)
            if (b.state !== 'roll') continue;
            for (const bd of bounds) {
                if (b.y < bd.y1 || b.y > bd.y2) continue;
                if (b.x < bd.x1 + b.r) { b.x = bd.x1 + b.r; if (b.vx < 0) b.vx = 0; }
                else if (b.x > bd.x2 - b.r) { b.x = bd.x2 - b.r; if (b.vx > 0) b.vx = 0; }
            }
        }

        // ── 구멍 앞 몸싸움(연출): 구멍마다 닫힌 뚜껑 위에서 멈춰 기다리는 둘을 짝짓는다. 물리는 건드리지 않는다 ──
        if (holefield) for (let hi = 0; hi < holefield.holes.length; hi++) {
            const h = holefield.holes[hi];
            const waiting = b => b.state === 'roll' && b.lidHole === hi && t - b.lidAt < 50 && t - b.lidSince >= SCUFFLE_WAIT_MS && Math.hypot(b.vx, b.vy) < SCUFFLE_SPEED;
            const pair = scufflePairs[hi];
            if (pair) {
                const startled = lidCover(h, t) < 1;   // 뚜껑이 움직이기 시작 → 둘 다 화들짝(떨어진다). 아니면 밀려나거나 독수리에 채인 것 — 유예 뒤 조용히 끝
                if (!startled && waiting(pair.a) && waiting(pair.b)) pair.lostAt = -1;
                else if (!startled && pair.lostAt < 0) pair.lostAt = t;
                if (startled || (pair.lostAt >= 0 && t - pair.lostAt >= SCUFFLE_GRACE_MS)) {
                    for (const b of [pair.a, pair.b]) { b.scuffle = -1; if (startled && b.state === 'roll') b.scuffled = true; }
                    pushEvent(t, 'scuffleEnd', null, { a: pair.a.id, b: pair.b.id, hole: hi, startled });
                    scufflePairs[hi] = null;
                }
            }
            if (!scufflePairs[hi] && lidClosedLeft(h, t) >= SCUFFLE_MIN_LEFT_MS) {
                const cands = B.filter(b => b.scuffle < 0 && waiting(b)).sort((p, q) => (Math.abs(p.x - h.x) - Math.abs(q.x - h.x)) || (p.id - q.id));
                if (cands.length >= 2) {
                    const two = cands.slice(0, 2).sort((p, q) => p.x - q.x || p.id - q.id);   // a = 왼쪽(오른쪽을 보며 밀기), b = 오른쪽(클라가 반전)
                    two[0].scuffle = two[1].id; two[1].scuffle = two[0].id;
                    scufflePairs[hi] = { a: two[0], b: two[1], lostAt: -1 };
                    pushEvent(t, 'scuffle', null, { a: two[0].id, b: two[1].id, hole: hi });
                }
            }
        }

        if (step % sampleEvery === 0) record();

        if (finishedCount === n) { simEndMs = t; if (step % sampleEvery !== 0) record(); break; }
    }

    // 캡 도달: 미도착 공을 진행도(y, 통로 안이면 x) 내림차순으로 정산 (덜 간 공이 더 늦게 도착)
    if (finishedCount < n) {
        const rest = B.filter(b => b.state !== 'done').sort((a, b) => (b.y - a.y) || (b.x - a.x) || (a.id - b.id));
        for (const b of rest) finishBall(capMs, b);
        simEndMs = capMs;
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
    // 조기 확정(cutMs): 꼴찌가 통로에 내려오는(land) 순간 나머지 전원이 이미 골인해 있으면 그 순간 꼴찌 확정 → 재생을 거기서 끊고 비석
    // (혼자 5~9s 걷는 걸 안 본다). 둘 이상이 아직 내려오는 중이면 골 진입 순서가 결과이므로 끊지 않는다(사용자 2026-09-21). 순위·finishOrder 는 영향 없음
    const lastLand = finishOrder.length >= 2 ? events.filter(e => e.type === 'land' && e.ball === lastId && e.t > secondLastT)[0] : null;
    const cutMs = lastLand ? lastLand.t : null;
    let slow = { startMs: slowStartMs, rate: SLOW_RATE, endMs: simEndMs }, slowExtra = (simEndMs - slowStartMs) * (1 / SLOW_RATE - 1), endMs = simEndMs;
    if (cutMs != null) { slow = null; slowExtra = 0; endMs = cutMs; }   // 컷 뒤(골 앞 슬로모)는 재생하지 않는다
    // 2배속 구간: 마지막 한 마리만 남은 순간(뒤에서 두 번째 골인)부터 슬로모 시작(또는 컷)까지. 클라 simTime() 이 같은 식으로 재생 → 2탭 동기
    const fastEnd = cutMs != null ? cutMs : slowStartMs;
    const fast = (finishOrder.length >= 2 && fastEnd - secondLastT > 500) ? { startMs: secondLastT, rate: FAST_RATE, endMs: fastEnd } : null;
    const fastSaved = fast ? (fast.endMs - fast.startMs) * (1 - 1 / FAST_RATE) : 0;
    return { track, sampleMs, frames, events, finishOrder, simEndMs, slow, fast, cutMs, durationMs: Math.round(endMs - fastSaved + slowExtra + FINALE_HOLD_MS) };
}

// 참가자 순위 — 당첨 순위(target, 당첨 순위 투표 룰렛 결과, socket/marble.js)에 따라 기준 동물이 다르다.
// 'last'(기본): 각자 "가장 늦은 공"의 도착 순서 → 꼴찌 = 전체 마지막 공의 주인 = selected(당첨).
// 'first': 각자 "가장 먼저 들어온 공"의 도착 순서 → 1등 = 전체 첫 공의 주인 = selected. 나머지 공은 순위에 영향 없음 (사용자 2026-09-23).
// successionList = 당첨 쪽에서 반대쪽으로 (이탈자 대체용, spin-arena 패턴).

function rankPlayers(balls, finishOrder, participants, target) {
    const key = {};
    finishOrder.forEach((ballId, idx) => {
        const owner = balls[ballId].owner;
        if (target !== 'first' || key[owner] == null) key[owner] = idx;
    });
    const order = participants.slice().sort((a, b) => (key[a] ?? -1) - (key[b] ?? -1));
    const rankings = order.map((name, i) => ({ name, rank: i + 1 }));
    const successionList = target === 'first' ? order.slice() : order.slice().reverse();
    return { rankings, successionList, selected: successionList[0] || null };
}

// 4단계 프리셋 → 인당 마릿수 (MAX_BALLS 캡 포함). 모르는 프리셋은 기본값.
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
    buildTrack, buildTrackFrom, layoutBalls, simulate, rankPlayers, effectiveBallsPerPlayer, crowdBallsPerPlayer, mulberry32,
    SECTION_NAMES: MIDDLE_SECTIONS.map(m => m[0]), TRACK_A_COUNT,
    constants: {
        SIM_DT_MS, SIM_CAP_MS, MAX_BALLS, BALLS_PER_PLAYER_MIN, BALLS_PER_PLAYER_MAX, BALLS_PER_PLAYER_DEFAULT, CROWD_PRESETS, CROWD_DEFAULT,
        BALL_R, NAP_R, FINALE_HOLD_MS, MUD_DIZZY_MS, BEE_MS, HOLE_COUNT, SLOW_ZONE_PX, SLOW_RATE
    }
};
