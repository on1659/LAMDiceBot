# Bridge Cross — Bonus Race (보너스 점프 경주) 구현 명세

작성일: 2026-05-05
브랜치: `feat/bridge-cross-bonus-race` (이미 생성됨, 사용자 작업)
이전 단계: `feat/bridge-cross-user-driven` (커밋 `8adf80c`까지 push 완료)
구현 추천 모델: **Opus** — 게임 룰 재설계 + 다파일 연계 + 시각 검증 필요

---

## 1. 배경

기존 user-driven 룰의 결정적 문제: **꼴등 1명 결정이 어렵다.**
- 추락자 0명 (모두 통과) → 꼴등 없음
- 추락자 2명+ → 누가 진짜 꼴등인지 모호
- 추락자 1명만 자연스러운 케이스 (확률적 운빨)

또한 사용자 피드백:
- "마지막까지 순위가 안 나와야 재미있다, 처음부터 나오면 김 새버린다"
- 떨어지는 즉시 시각으로 꼴등이 드러나는 현재 룰은 긴장감 부족

따라서 게임 정체성을 **"떨어지는 다리"**에서 **"빨리 도착하는 경주"**로 전환:
- 추락 X — 모두 끝까지 도달
- 좌/우 선택 → server가 결정한 보너스 row를 맞추면 점프 보너스 (+2칸)
- 못 맞추면 정상 (+1칸)
- 가장 늦게 6칸 도달한 user = **꼴등 (주문 받기)**

---

## 2. 결정사항 (확정)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 다리 길이 | **6 col** (8 col 검토 후 사용자 피드백으로 6 col 확정 — 2026-05-05) |
| 2 | 추락 룰 | **폐지** — 누구도 떨어지지 않음 |
| 3 | 좌/우 선택 의미 | server가 매 col 비밀 보너스 row 결정 (50/50). 맞추면 보너스, 틀리면 정상 |
| 4 | 보너스 점프 칸수 | **+2** (사용자 피드백으로 +3 폐지 — 2026-05-05) |
| 5 | 정상 점프 칸수 | **+1** |
| 6 | 종료 조건 | 모든 user가 6칸 도달 또는 max 8 turn 도달 |
| 7 | 꼴등 결정 | **가장 늦게 8칸 도달한 user** (1명 보장) |
| 8 | 동률 꼴등 처리 | **sudden death loop** — 동률 꼴등들끼리만 추가 turn 반복. 1명만 남을 때까지 (경마 N등 찾기 패턴). bonusRows 매 sudden death turn마다 새로 추첨 |
| 9 | 보너스 row 정보 | **server 비밀** — gameStart/waveResult 모두 보너스 row 노출 X |
| 10 | 다른 user의 advance 정보 | waveResult에 포함 (decision 같은 보안 트레이드오프 — 게임성 우선). **같은 turn에서 user 간 다른 row 선택 + advance 차이로 그 turn 보너스 row 노출 가능 (impl §10-4 인정 트레이드오프)** |
| 11 | 시각: 보너스 row 강조 | **양쪽 동일 유리 발판** — 보너스 row 시각 강조 X (정보 누출 방지) |
| 12 | 도착 후 캐릭터 | finish slot에 도착 순으로 idle 표시. 도달 안 한 user만 다음 turn 진행 |
| 13 | 캐릭터 수 제한 | 무제한 (기존 user-driven 그대로) |
| 14 | 본인 외곽선 / 캐릭터 식별 | 그대로 (players-my-outline-v1.png 재사용) |
| 15 | turn 카운트다운 | 3초 (그대로) |
| 16 | **용어 — wave → 턴 (Turn)** | 한 번의 점프 사이클 = 1 turn. UI/코드 모두 "턴" 통일. 영문 변수명은 일관성 위해 **`wave` 유지** (코드는 internal, UI 라벨은 "턴 K/8") |
| 17 | **카메라 / world 확장** | 다리 길이 늘리되 tileSize 유지. world 폭 확장 (entrance/exit world 좌표 늘림) → 기존 `Camera`/`CameraDirector` 인프라가 자동으로 follow + zoom 처리. 캔버스 viewport 1024×683 유지 |
| 18 | **finishSlots layout** | **2열 4×2 grid** (가로 4 × 세로 2). center+side 구조 폐기. M=8까지 안전 수용. 시각 보고 사용자 피드백 후 1열/3×3 등 조정 가능 |
| 19 | **turn 도중 도달자 처리** | turn 점프 시각 끝난 후 `random 0~800ms delay` 시차로 finish slot 점프. server가 turn-end 즉시 finishOrder 추가 + 클라가 시차 시각만 처리 |
| 20 | **DB 매핑 (꼴등=당첨자)** | `winnerName = loser` (꼴등 이름), `is_winner=true`는 꼴등에게만, `game_rank`: 1=1등 ... M=꼴등. **통계 페이지 (`pages/server-members.html` 등)에서 `game_type='bridge'`면 "승리" → "당첨" 표시 분기**. ranking 집계는 bridge 제외 (db/ranking.js 변경 X) |
| 21 | **첫 turn 보너스** | turn 1은 모든 user 무조건 +1 (보너스 disable). turn 2부터 보너스 적용 — 게임 도입을 자연스럽게 (사용자 피드백 2026-05-05). sudden death는 별도 매 turn 보너스 추첨 (영향 X) |
| 22 | **bonus-pad sync to character jump** | bonus-pad 시퀀스를 `applyWaveResult` 등록 시점이 아닌 캐릭터 `wave-launch` 트리거 시점에 동기화. effect에 `triggered=false`/`triggeredAt=0` 보존 → `prepareChoicePause`에서 `triggered=true; triggeredAt=state.elapsed` 세팅. render는 triggered 여부로 그릴지 결정. 위치는 출발 발판(fromCol, row). +2 advance 발동 + prevProgress >= 1일 때만 등록 (사용자 피드백 2026-05-05) |
| 23 | **1명 남으면 다리 collapse** | 도달 안 한 user 1명 남는 순간 server `phase='collapsing'` 전이 + `bridge-cross:bridgeCollapse` broadcast → 1500ms collapse 시각 후 `endGame`. 추가 turn 진행 X. 클라는 loser의 col부터 col 0까지 staggered shake/fall + alpha fade. loser 캐릭터도 같은 col offset 적용해 함께 떨어지는 시각 (사용자 피드백 2026-05-05) |
| 24 | **finishSlots dx/dy 축소** | `dx = tileSize.w * 0.45` (이전 0.7), `dy = tileSize.h * 0.5` (이전 0.6) — 8명 모두 finishPlatform 안쪽 수용. arrivalOrder는 그대로 (사용자 피드백 2026-05-05) |

### 2-1. 자체 결정 항목 (사용자 위임)

- **finishSlots 시각 layout**: 2열 4×2 grid를 1차 구현. Stage 4 끝나고 사용자 시각 확인 후 조정.
- **turn 도중 도달자 시차 delay**: random 0~800ms로 1차 구현.

---

## 3. 게임 룰 정의 (신규)

### 3-1. 참가

- ready phase에서 색 선택만 하면 캐릭터 spawn (기존 동일)
- 호스트 시작 클릭 → 게임 진행

### 3-2. 용어 정의

- **턴 (Turn / wave)**: 한 번의 점프 사이클 = "좌/우 선택 → 모두 점프 → 결과" 1회. UI 라벨은 "턴", 코드 변수명은 `wave` 유지.
- **라운드 (Round)**: 게임 한 판. 1라운드 = 꼴등 1명 결정될 때까지의 모든 turn 묶음. (sudden death loop는 같은 라운드 안의 추가 turn)
- **꼴등 = 당첨자**: 마지막까지 못 건넌 1명. 결과 화면에서 "🎯 주문 받을 사람"으로 호명.

### 3-3. 진행 (turn 단위)

1. **server가 라운드 시작 시 6 col 보너스 row 결정** — 비밀, 매 라운드마다 새로 추첨
2. **turn k 시작** (k = 1...max 8):
   - 도달 안 한 user에게 좌/우 선택 UI (3초 카운트다운)
   - 자동 미선택 → server가 random pick
3. **server 판정**:
   - **단, wave === 1 (첫 turn, normal)은 보너스 disable — 모두 +1 강제** (게임 도입 자연스러움 위함, 사용자 피드백 2026-05-05). sudden death는 별도 매 turn 추첨이라 영향 X.
   - 그 외 turn:
     - user choice == 보너스 row(server 비밀) → +2 칸
     - user choice != 보너스 row → +1 칸
   - 각 user의 progress 갱신: `progress = min(6, progress + advance)`
   - **turn-end 시점**에 progress=6 도달자를 finishOrder에 push (도달 순). 같은 turn에 여러 명 도달 시 advance 큰 user 우선, 동률이면 pendingChoices 처리 순서로 tie-break (서버 deterministic)
4. **시각화**:
   - 각 user 시차 점프 (deterministic seed, turn 내 0.18s 간격)
   - 점프 호/거리 = advance 칸 수 비례 (+1=jumpHeight 46, +2=70)
   - 점프 거리(col 단위) = advance만큼 전진 (+1=1col, +2=2col)
   - 6칸 도달자: turn 점프 끝난 후 `random 0~800ms delay` 시차로 finish slot 점프 (turn-end 후 0.5~1.3s 사이 finish 도착)
5. **다음 turn**: 도달 안 한 user만 진행. server 대기 시간 `BRIDGE_INTER_TURN_MS = 1800ms` (turn 시각 시간 + finish 시차 delay 충분 보장)
6. **종료 조건 검사 (1라운드 안)**:
   - 도달 안 한 user 0명 → 라운드 종료, 결과 표시 (1800ms inter-turn delay 후 endGame)
   - 도달 안 한 user 1명 → 그가 당첨자 → server `phase='collapsing'` + `bridge-cross:bridgeCollapse` broadcast → **1500ms 다리 collapse 시각 후 endGame** (추가 turn 진행 X, 사용자 피드백 2026-05-05)
   - 도달 안 한 user 2명+ + currentTurn < 8 → 다음 turn
   - 도달 안 한 user 2명+ + currentTurn >= 8 → **sudden death turn** (도달 안 한 user들끼리만 추가 turn 반복, bonusRows 매번 새로 추첨, 1명 남을 때까지 무한 loop). max sudden death = 6 안전장치 (6번 sudden death 후에도 동률이면 random tie-break)

### 3-4. 게임 종료 / 꼴등 결정

- `finishOrder = [user1, user2, ...]` 도달 순 배열 (서버 기록)
- **꼴등 = 라운드 종료 시 finishOrder에 push되지 않은 마지막 1명** (sudden death loop가 이를 보장)
- sudden death max 6번 후에도 동률이면 server `Math.random()`으로 random tie-break (안전장치)
- gameEnd 결과 overlay: "🎯 주문 받을 사람: **{꼴등이름}**" + 도착 순서 (1등~꼴등) + 각 user의 progress (0~6)

### 3-5. user-driven 보존

- 좌/우 선택 직접 (모드 토글 폐기 그대로)
- 시각: 캔버스 내 turn 선택 패널 overlay (현재 그대로, 라벨만 "턴"으로)
- 본인 캐릭터 외곽선 (atlas 재사용)
- 색 선택 (ready phase, 색 picker)

---

## 4. 변경 범위 (파일)

| 파일 | 변경 규모 | 핵심 |
|------|----------|------|
| [socket/bridge-cross.js](../../../socket/bridge-cross.js) | **대** | safeRows → bonusRows. 추락 로직 제거 (`fallenUsers` 폐지). userProgress 추적. waveResult `advance` 정보. finishOrder 관리. max wave + sudden death 로직 |
| [js/bridge-cross.js](../../../js/bridge-cross.js) | **대** | layout columnCount 6 유지 (8 검토 후 사용자 피드백으로 6 확정). 추락 시각 제거 (cascade fall, falling phase). 점프 거리/호 advance 비례. progress 추적/render. finishOrder UI |
| [bridge-cross-multiplayer.html](../../../bridge-cross-multiplayer.html) | 소 | 결과 overlay 형식 (꼴등 강조). 카운트다운 max wave 표시 |
| [css/bridge-cross.css](../../../css/bridge-cross.css) | 소 | 결과 overlay 디자인 보강 (꼴등 reveal 효과) |
| [utils/room-helpers.js](../../../utils/room-helpers.js) | 소 | bridgeCross 필드 — bonusRows, userProgress, finishOrder, maxWaveReached |
| [socket/rooms.js](../../../socket/rooms.js) | 소 | leaveRoom cleanup — userProgress, finishOrder 정리 (이전 fallenUsers 정리 그대로) |

**불변조건 (must-preserve):**
- gameType `'bridge'` (DB / admin 패널 의존)
- localStorage 키 (`bridgeUserName` 등)
- 색 picker / 외곽선 / wander / wave UI 인프라 (현 user-driven 인프라 재활용)
- DB 호출 시그니처 (recordGamePlay/recordServerGame/recordGameSession)
- 다른 게임 영향 없음

---

## 5. 데이터 모델

### 5-1. 서버 (`socket/bridge-cross.js`)

```js
gameState.bridgeCross = {
  phase: 'idle' | 'ready-wait' | 'playing' | 'sudden-death' | 'finished',
  // 6 col 보너스 row (server-only, 절대 노출 X)
  bonusRows: [],            // length 6 (라운드 시작 시 추첨), 'top'|'bottom'
  bonusAmounts: [],         // length 6, 2 (각 col 보너스 점프 칸수, +2 단일)
  // 게임 진행 추적
  participants: [],         // [{userName, colorIndex}]
  userColors: {},           // {[userName]: colorIndex}
  userProgress: {},         // {[userName]: 0~6}
  finishOrder: [],          // 도달 순서 [userName1, userName2, ...]
  currentWave: 0,           // 1~8 (BRIDGE_MAX_WAVES). sudden death 시 9+
  // sudden death loop
  suddenDeathCount: 0,      // 0~6 (max 6, 안전장치)
  // turn 진행
  pendingChoices: {},       // {[userName]: 'top'|'bottom'}
  waveTimer: null,          // setTimeout handle (turn 진행용)
  waveProcessing: false,    // race 가드
  interTurnTimer: null,     // turn 사이 대기 timer
  // 기존 호환 필드 (의미 명시)
  isBridgeCrossActive: false,    // 게임 중인지 (다른 모듈이 참조)
  bridgeCrossHistory: [],        // 라운드 결과 기록 (꼴등 이름 + 도달 순서)
  raceRound: 0,                  // 누적 라운드 번호 (UI 표시용, 새로고침 시 보존)
  endTimeout: null               // gameEnd 후 ready 자동 복귀 timer
};
```

**기존 호환 필드 의미** (Codex 발견 §5-1 모호 해소):

- `isBridgeCrossActive`: `socket/index.js`/`socket/rooms.js` 등에서 게임 진행 여부 체크에 사용. 그대로 유지
- `bridgeCrossHistory`: 라운드 단위 결과 누적 (`{loser, finishOrder, completedAt}` push). 다음 라운드에서 UI history 표시용
- `raceRound`: 라운드 누적 카운터. 새 라운드 시작마다 +1
- `endTimeout`: 게임 종료 → ready 자동 전환 setTimeout. cleanup 시 clear 필수

### 5-2. 클라이언트 (`js/bridge-cross.js`)

```js
state.bridgeProgress = {};      // {[userName]: 0~6}
state.bridgeFinishOrder = [];   // 도달 순서 (시각용)
state.currentWave = 0;
state.maxWaves = 8;             // 서버 maxWaves 캐시 (sudden death 시 표시 분기용)
state.isSuddenDeath = false;    // sudden death turn 여부 (UI 라벨 분기)

// 기존 state 필드 그대로 (actives, allPlayers, ...)
// 추락 관련 제거: fallenUsers, fallsAt, fallsAtRow, cascade-falling
```

### 5-3. 상수

- `BRIDGE_COLUMNS = 6` (8 col 검토 후 사용자 피드백으로 6 col 확정 — 2026-05-05)
- `BRIDGE_MAX_WAVES = 8` (max turn 수, 6칸 정상 도달 + 2 마진. sudden death는 별도 카운터)
- `BRIDGE_MAX_SUDDEN_DEATH = 6` (sudden death loop 안전장치)
- `BRIDGE_BONUS_AMOUNTS = [2]` (보너스 점프 칸수 후보 — +2 단일, +3 폐지)
- `BRIDGE_NORMAL_ADVANCE = 1`
- `BRIDGE_WAVE_SEC = 3` (turn 카운트다운, 그대로)
- `BRIDGE_INTER_TURN_MS = 1800` (turn 사이 대기 — turn 시각 + finish 시차 delay 0~800ms 충분 보장. 기존 1500ms 대비 +300ms)
- `BRIDGE_FINISH_DELAY_MIN = 0`, `BRIDGE_FINISH_DELAY_MAX = 800` (turn 도중 도달자 시차 delay 범위, ms)

---

## 6. Socket 이벤트 명세

### 6-1. 클라 → 서버

| 이벤트 | 데이터 | 변경 |
|--------|--------|------|
| `bridge-cross:pickColor` | `{colorIndex}` | 그대로 |
| `bridge-cross:choice` | `{wave, choice}` | **`col` → `wave` 변경** (1-based, sudden death 시 13+) |
| `bridge-cross:start` | (호스트만) | 그대로 |

### 6-2. 서버 → 클라

| 이벤트 | 데이터 | 변경 |
|--------|--------|------|
| `bridge-cross:gameStart` | `{participants, totalCols: 6, maxWaves: 8}` | totalCols 6, maxWaves 8 |
| `bridge-cross:waveStart` | `{wave, deadline: 3000, eligible: [...userName], isSuddenDeath: bool}` | turn 카운터 + 도달 안 한 user 목록 + sudden death 플래그 |
| `bridge-cross:waveResult` | `{wave, results: [{userName, choice, advance: 1\|2, newProgress}], finishedThisWave: [...userName], isSuddenDeath: bool}` | **success bool 폐기**, advance/newProgress 신규. 클라가 모든 user를 추락 인지하지 않도록 success 필드 자체 삭제 (Codex 함정 §F-5) |
| `bridge-cross:bridgeCollapse` | `{loser: userName, finalProgress: 0~6, totalCols: 6}` | **신규 — 1명 남았을 때 emit. 1500ms collapse 시각 후 gameEnd 따라옴** (사용자 피드백 2026-05-05) |
| `bridge-cross:gameEnd` | `{loser: userName, finishOrder: [...], userProgress: {...}, participants}` | winners 폐기, **loser** (꼴등) 명시 |
| `bridge-cross:choiceProgress` | `{wave, decidedCount, totalEligible}` | **카운트만** (top/bottom 분리 절대 X — 보너스 row 추정 방지) |
| `bridge-cross:colorUpdated` | `{userName, colorIndex, allColors}` | 그대로 |
| `bridge-cross:roundReady` | `{participants, raceRound}` | raceRound 추가 (UI 표시용) |
| `bridge-cross:gameAborted` | `{reason}` | 그대로 |

### 6-3. 제거되는 필드 (Stage 6 dead code 정리 대상)

서버 emit:

- `waveResult.success` (bool) — 추락 판정 → 폐기
- `waveResult.brokenRows` — 깨진 row 정보 → 폐기
- `gameEnd.fallenUsers`, `gameEnd.winners` — 추락자/승자 목록 → 폐기
- `gameEnd.passingColors`, `gameEnd.winnerColors` — 색 강조 → 폐기

클라 핸들러 함께 제거:

- `js/bridge-cross.js`의 `r.success` 분기 (line 786-797 영역) — Codex 함정 §F-6
- `data.fallenUsers` 누적 코드 (line 599-650, 789-817, 3453-3459)
- `window._bridgeFallenUsers` 글로벌 (line 727, 757, 792-795, 817)

---

## 7. 페이즈 머신 / 게임 흐름

### 7-1. 서버 phase

```
idle → ready-wait (user들 색 선택 + ready)
  → playing (turn 1...8)
  → sudden-death (도달 안 한 user 2명+ 시 1명 남을 때까지 추가 turn loop)
  → collapsing (1명 남으면 다리 collapse 시각 1500ms — 사용자 피드백 2026-05-05)
  → finished
  → ready-wait (다음 라운드, raceRound++)
```

### 7-2. turn 진행 (서버)

```
1. eligible = participants 중 progress < 6인 user
2. broadcast waveStart {wave, deadline, eligible, isSuddenDeath}
3. waveTimer = setTimeout(processWave, BRIDGE_WAVE_SEC * 1000 = 3000ms)
4. processWave:
   - pendingChoices 누락 user → server Math.random 자동 강제
   - bonusRow / bonusAmount 결정:
     * normal turn (1~8): bonusRows[wave-1], bonusAmounts[wave-1] 사용
     * sudden death turn (9+): 매번 새로 추첨 (`Math.random() < 0.5 ? 'top' : 'bottom'`,
       bonusAmount는 항상 +6 강제 — sudden death는 1명만 못 건너기 위해 보너스 받은 user 즉시 도달)
   - 각 choice를 결정된 bonusRow와 비교
   - advance = (match ? bonusAmount : 1)
   - userProgress[name] += advance, clamp 6
   - newProgress >= 6인 user를 finishOrder에 push:
     * 같은 turn 다중 도달 시 advance 큰 순으로 정렬, 동률은 pendingChoices 처리 순서
   - broadcast waveResult
5. 종료 검사 (sudden death loop 핵심):
   - 도달 안 한 user 0명 → endGame (꼴등 = finishOrder.last)
   - 도달 안 한 user 1명 → endGame (그가 꼴등)
   - 도달 안 한 user 2명+ + currentWave < BRIDGE_MAX_WAVES → 다음 normal turn
   - 도달 안 한 user 2명+ + currentWave >= BRIDGE_MAX_WAVES → sudden death turn
     * suddenDeathCount++, phase = 'sudden-death'
     * suddenDeathCount > BRIDGE_MAX_SUDDEN_DEATH 안전장치 → random 1명 선택해서 endGame
6. 다음 turn: setTimeout(BRIDGE_INTER_TURN_MS = 1800ms) 후 wave++ + startWave 재호출
```

### 7-3. 클라 phase 흐름 (요약)

```
idle/ready-wait → playing
  enter-bridge (모두 다리 진입 점프)
    ↓
  turn-wait (좌/우 선택 UI 활성, 도달 안 한 user만, 라벨 "턴 K/8" 또는 "🔥 sudden death")
    ↓ waveResult
  turn-jump (각 user가 advance 칸수만큼 시차 점프, advance 따라 호/거리)
    ↓
  finished-this-turn 도달자 → random 0~800ms delay 후 finish slot 점프
    ↓
  turn-wait 다음 turn (도달 안 한 user만)
    ↓ ... (sudden death 시 같은 loop, isSuddenDeath=true 라벨만 전환)
  finished → result overlay (꼴등 reveal)
  → ready-wait (다음 라운드)
```

### 7-4. cleanup 책임 (Stage 1)

`socket/rooms.js` `leaveRoom` 시 다음 필드 모두 정리:

- `bridgeCross.userColors[name]` 삭제 (기존)
- `bridgeCross.userProgress[name]` 삭제 (신규)
- `bridgeCross.pendingChoices[name]` 삭제 (기존)
- `bridgeCross.finishOrder` 에서 name filter (신규)
- `bridgeCross.participants` 에서 name filter (기존)
- `bridgeCross.bridgeCrossHistory` 는 라운드 기록이라 그대로 유지
- 호스트 grace 만료 시 `bridgeCross.bonusRows` / `bonusAmounts` / `currentWave` / `suddenDeathCount` 모두 reset (다음 라운드 안전 시작)
- 옛 필드 제거: `safeRows`, `brokenRows`, `fallenUsers`, `finishedUsers` (rooms.js line 1057-1074 영역)

---

## 8. UI 스펙

### 8-1. turn 패널 (캔버스 내 overlay, 라벨만 변경)

- 라벨: `"🌉 턴 {k}/{8} — 좌/우 선택"` (한국어 통일)
- sudden death 시: `"🔥 SUDDEN DEATH — 좌/우 선택"` (turn 카운터 숨김)
- 카운트다운 3초 (그대로)
- 좌/우 버튼 (현재 그대로). hover 시 발판 warning_glow 동기 (그대로)
- 카운트만 표시 (`{decided}/{eligible}명 결정`)
- 추락 X → "관전 모드" 표시 X
- 도달한 user는 turn-wait 진입 X (서버에서 eligible에 안 포함)

### 8-2. 캔버스 / world 확장 (Codex 함정 §F-1 해소)

- 다리 6 col. **world / tileSize 모두 원래대로 유지** (8 col 검토 후 사용자 피드백으로 6 col 확정 — 2026-05-05):
  - entrance/exit 거리 = `(6-1) * columnStep`, world ≈ 2400×1280 (원래대로)
  - 캔버스 viewport 1024×683 그대로. `Camera`/`CameraDirector`는 그대로 동작
  - `Bridge` 생성자: bridgeColumnCount=6, bridgeStretch=1.0 (원래)
- 양쪽 row (top/bottom) 모두 동일 유리 발판 시각 (보너스 row 강조 X)
- 각 user 점프 시 advance 칸 수 비례 호/거리:
  - +1: jumpHeight 46, distance 1col (현재 normal)
  - +2: jumpHeight 70, distance 2col
  - (+3=95는 dead code — advance=3 발생 안 함, 호출 X)

### 8-3. finishSlots 재설계 (Codex 함정 §F-2 해소)

- 기존: `[finishCenter] + layoutSlots(6, sideOffset)` = **7개** → modulo로 1번/8번 도착자 충돌
- 신규: **2열 4×2 grid** (4 columns × 2 rows = 8개), `js/bridge-cross.js:1416-1420`의 `finishSlots` 재설계
- 가로 spacing ≈ `tileSize.w * 0.7`, 세로 spacing ≈ `tileSize.h * 0.6`
- `finishSlot(index) = finishSlots[index % 8]` (M=8 안전 수용)
- M > 8이면 modulo로 겹침 허용 (현재 단계 무제한 user 정책)
- Stage 4 끝나고 사용자 시각 검토 후 1열 8개 / 3×3 등으로 조정 가능

### 8-4. bonus-pad 시각 시퀀스 (impl §9-3 보강)

waveResult 도착 후 advance >= 2인 user에게:

1. `state.bridgePadEffects[userName] = {wave, advance, startedAt: now()}` 등록
2. render loop 매 프레임:
   - elapsed < 150ms → frame 0 (spawn) 그리기 at user의 시작 발판
   - elapsed 150~270ms → frame 1 (ready)
   - elapsed 270~370ms → frame 2 (compress) — 캐릭터 도착 직전
   - elapsed 370~620ms → frame 3 (launch) — 캐릭터 점프 정점
   - elapsed >= 620ms → 효과 해제 (delete state.bridgePadEffects[userName])
3. z-order: render 순서 `tile → bonusPad → player` (Scout 보고 §3, line 3137~3185 사이 삽입)
4. anchor `{x:0.5, y:1.0}` (발판 위 base) 적용

### 8-5. 결과 overlay

- "🎯 **주문 받을 사람: {꼴등이름}**" (큰 글씨, 강조 + reveal 애니)
- "도착 순서:" 1등~꼴등 list (각 user의 색 + progress)
- sudden death 발동 시 별도 표시: "⚡ {N}회 sudden death 진행"

---

## 9. 리소스 (스프라이트, atlas, 이미지)

### 9-1. 기존 재사용 — 신규 리소스 0건
| 파일 | 용도 |
|------|------|
| `assets/bridge-cross/sprites/players-{red,orange,yellow,green,blue,indigo}.png` | 4×7 player atlas (idle/walk/run/jump/land/fall/result). fall row는 미사용(추락 폐지)이지만 atlas 재배치 X — 다른 row 그대로 |
| `assets/bridge-cross/sprites/players-my-outline-v1.png` | 본인 외곽선 4×7 atlas. 그대로 |
| `assets/bridge-cross/sprites/glass-fx-v2.png` | safe_sparkle, break_shards, warning_glow, fall_trail, landing_pulse, restore_glass. break_shards/fall_trail은 미사용(추락 폐지)이지만 atlas 그대로 |
| `assets/bridge-cross/stage/background-void-v2.png` | 배경 |
| `assets/bridge-cross/stage/start-stage-v3.png` | startPlatform |
| `assets/bridge-cross/stage/finish-stage-v2.png` | finishPlatform |

### 9-2. 신규 리소스 검토 결과
| 후보 | 결정 | 이유 |
|------|------|------|
| 보너스 row **선택 전** 강조 atlas | **불필요** | 양쪽 동일 시각 (정보 누출 방지) |
| 보너스 row **선택 후** 점프대 sprite | **신규 필요 — bonus-pad-v1.png** | 결과로 보너스 받았을 때 발판 위에 점프대 등장. 게임 임팩트 핵심. 정보 누출 X (이미 advance broadcast됨) |
| 6칸 다리 sprite | **불필요** | 다리 6 col (8 검토 후 사용자 피드백으로 6 확정). sprite 재사용 |
| 점프 +2 호/거리 | **불필요 (코드만)** | jumpHeight 인자 +1=46/+2=70 + 거리만 변경. 기존 jump row 재사용 (+3=95는 dead code) |
| landing_pulse advance 비례 | **불필요 (코드만)** | 기존 glassFx landing_pulse 크기/색상 코드로 조절 |
| 꼴등 reveal 효과 (드럼롤/스폿라이트) | **선택** | CSS 애니 + 사운드 mp3로 처리 가능 |
| finish slot 8개 배치 | **불필요** | layoutSlots(8, ...) 호출만 변경 |

### 9-3. 신규 자산 — bonus-pad-v1.png

**SpriteMake prompt**: `D:\Work\vibe\SpriteMake\output\bridge-cross\prompts\bonus-pad-v1.md` (작성 완료)

| 항목 | 값 |
|------|---|
| 파일명 | `bonus-pad-v1.png` |
| 캔버스 | 1024×256 |
| 그리드 | 4 col × 1 row, cell 256×256 |
| anchor | `{ x: 0.5, y: 1.0 }` (발판 위 base) |
| frames | 0=spawn, 1=ready, 2=compress, 3=launch |
| 컨셉 | 네온 사이버펑크 트램폴린/스프링. 시안+마젠타+옐로우 |
| 출력 경로 (SpriteMake) | `D:\Work\vibe\SpriteMake\output\bridge-cross\final\bonus-pad-v1.png` |
| 게임 복사 경로 | `D:\Work\LAMDiceBot\assets\bridge-cross\sprites\bonus-pad-v1.png` |

**manifest 추가 (`bridge-cross-sprites.manifest.json`)**:
```json
"bonusPad": {
  "src": "bonus-pad-v1.png",
  "atlas": { "columns": 4, "rows": 1, "cellW": 256, "cellH": 256 },
  "anchor": { "x": 0.5, "y": 1.0 },
  "animations": {
    "full": { "row": 0, "frames": [0,1,2,3], "fps": 14, "loop": false }
  }
}
```

**imageDefs 추가 (`js/bridge-cross.js`)**:
```js
bonusPad: spriteRoot + 'bonus-pad-v1.png'
```

**시퀀스** (보너스 받은 user의 한 wave):
```
0ms     waveResult 도착 → user advance = +2 인지 확인
0ms     bonus 받은 user의 도착 발판에 spawn frame(0) 그리기 (잠깐)
~150ms  ready frame(1)
~270ms  캐릭터가 발판 도착 → compress frame(2) (압축 효과)
~370ms  launch frame(3) — 캐릭터 위로 큰 점프 + 스프링 펴짐
~620ms  pad 사라짐 (fade out)
```

**z-order**: `tile < bonusPad < player` (bonusPad는 발판 위, 캐릭터 아래)

### 9-4. SpriteMake 후속 작업 (선택, Phase 2)
- `players-{color}.png` row 7+ 에 "cheer/celebrate" 추가 (도착 후 손 흔들기) — atlas 4×8로 변경
- `glass-fx` "bonus_glow" 추가 (보너스 row 도착 시 별도 강조) — 현재는 점프대로 충분

---

## 10. 보안 / 공정성

1. **bonusRows / bonusAmounts는 절대 클라 broadcast 금지** — gameStart/waveResult/gameEnd payload, currentRoomInfo, console.log 모두 검증
2. **자동 미선택 random은 server Math.random** — 그대로
3. **다른 user의 advance 정보**는 waveResult에 포함됨 — 본질적 게임성 위해 인정 (기존 user-driven decision A 동일)
4. **bonus row 추정 트레이드오프 (Codex §2-1 보강)**:
   - user A가 turn 3에 +2 받음 → 다른 user가 turn 3에 user A의 choice(좌/우)를 알면 그 turn의 보너스 row 추정 가능
   - **같은 turn 안에서도 user 간 다른 row 선택 + advance 차이로 그 turn의 보너스 row가 100% 즉시 노출됨** (예: A=top→advance=3, B=bottom→advance=1 → bonusRow=top 노출)
   - 단, **다음 turn의 보너스 row는 추정 불가** (turn별 독립 추첨)
   - 게임성 위해 인정 — 보안 강화 필요 시 Phase 2에서 advance도 숨김 검토
5. **클라 Math.random**: 시각 effect만 (jitter, camera shake, finish 시차 delay). 게임 결과 결정 0회
6. **dev 도구 검증**: `AutoTest/bridge-cross-devtools.html` (있다면)이 server-side state를 endpoint로 노출하는지 검증. bonusRows dump 가능성 차단 (env gate 또는 prod 라우트 차단)
7. **sound 키 정리 (Codex 함정 §F-5)**:
   - 추락 폐지 시 `bridge-cross_break`, `bridge-cross_fall` 호출 코드 함께 제거
   - 신규 사운드 키 후보: `bridge-cross_bonus_jump`, `bridge-cross_arrive`, `bridge-cross_loser_reveal` — `assets/sounds/sound-config.json`에 placeholder 추가 (파일 없어도 silent fail OK)

---

## 11. 단계별 구현 순서

### Stage 0 — impl 검토 / 승인

- [x] 이 문서 작성 (2026-05-05)
- [x] 사용자 결정사항 받음 (wave→턴, sudden death loop, DB 매핑, world 확장, finishSlots 2열 4×2)
- [x] Codex 함정 5개 반영 (§F-1 ~ §F-5)
- [ ] 사용자 최종 승인 후 Coder 진입

### Stage 1 — 서버 데이터 모델 / cleanup

- `utils/room-helpers.js` `bridgeCross` 필드 재정의:
  - 추가: `bonusRows[]`, `bonusAmounts[]`, `userProgress{}`, `finishOrder[]`, `currentWave`, `suddenDeathCount`, `interTurnTimer`
  - 제거: `safeRows`, `brokenRows`, `fallenUsers`, `finishedUsers` (옛 필드)
  - 보존: `isBridgeCrossActive`, `bridgeCrossHistory`, `raceRound`, `endTimeout` (의미 §5-1 명시)
- `socket/rooms.js` `leaveRoom` cleanup 갱신 (impl §7-4)
- 검증: `node -c utils/room-helpers.js socket/rooms.js`

### Stage 2 — 서버 로직 재작성

- 상수 신설: `BRIDGE_COLUMNS=6`, `BRIDGE_MAX_WAVES=8`, `BRIDGE_MAX_SUDDEN_DEATH=6`, `BRIDGE_BONUS_AMOUNTS=[2]`, `BRIDGE_INTER_TURN_MS=1800` (사용자 피드백 2026-05-05: 8 col 검토 후 6 col 확정 + +3 폐지)
- `safeRows` → `bonusRows` + `bonusAmounts` 생성 (라운드 시작 시)
- choice 핸들러 시그니처 변경: `{col, choice}` → `{wave, choice}`
- `processWave`: advance 계산 (match → `bonusAmounts[wave-1]`, else 1), `userProgress` 갱신, `finishOrder` push (advance 큰 순 tie-break)
- sudden death loop 로직 (§7-2 단계 5)
- `gameEnd` payload 변경 (`loser`, `finishOrder`, `userProgress`)
- DB 기록 변경 (impl §13)
- 추락 관련 코드 제거 (fallenUsers, brokenRows, cascade-falling)
- 검증: `node -c socket/bridge-cross.js`, bonusRows 누출 grep (Stage 7 사전 검증)

### Stage 3 — 클라 layout (6 col 유지)

- `Bridge` 생성자 `entrance/exit` 좌표 그대로 (stretch 1.0, `js/bridge-cross.js:1488-1500`)
- `Bridge` `columnCount: 6` 유지
- `tileSize` 그대로 (450×214)
- `Camera` worldW/worldH 그대로 동작
- 다리 col 6개 그리기 (`drawTile` 루프 자동 — `layout.columnCount` 사용)
- `state.revealed` 길이 6 (`layout.columnCount` 사용)
- (8 col 검토 후 사용자 피드백으로 6 col 확정 — 2026-05-05)

### Stage 4 — 클라 turn 핸들러 / 시각화 + bonus-pad

- `waveStart`/`waveResult` 핸들러 갱신 — wave 카운터, eligible, advance, isSuddenDeath 정보 사용
- `imageDefs.bonusPad` 추가 (`js/bridge-cross.js:1228-1236`)
- `applySpriteManifest` 갱신 — bonusPad 동적 적용 코드 추가
- `state.bridgePadEffects` 신설 + render (impl §8-4)
- z-order: tile → bonusPad → player (line 3137~3185)
- 점프 거리 (col 단위) + 호 (jumpHeight) advance 비례 (`AvatarController.moveTo`, `js/bridge-cross.js:1664-1675`)
- progress 추적 + finish slot 도착 순 배치
- `pendingChoice/lastStep`도 wave 모델로 변경 (col → wave / from-progress / to-progress)
- turn 도중 도달자 시차 delay 0~800ms (Math.random)

### Stage 5 — 클라 finishSlots 재설계

- `finishSlots` 2열 4×2 grid로 재계산 (impl §8-3)
- `finishSlot(index) = finishSlots[index % 8]`
- M=8 안전 수용 검증
- **사용자 시각 검토 후 layout 조정 가능**

### Stage 6 — UI 갱신

- turn 패널 라벨 한국어화 (`"턴 K/8"`, sudden death `"🔥 SUDDEN DEATH"`)
- 결과 overlay (impl §8-5): `"🎯 주문 받을 사람: {loser}"` + 도착 순서 + sudden death 표시
- 카운트다운 표시 (그대로)
- `choiceProgress`: top/bottom 분리 X (총 카운트만 — 보너스 추정 방지)
- `bridge-cross-multiplayer.html`에서 `submitWaveChoice` 호출부 점검 (col→wave 인자 변경)

### Stage 7 — 추락 인프라 정리

- 클라 `state.actives`의 `falling`/`cascade-falling` phase 제거
- `cascade-fall` 트리거 함수 (`js/bridge-cross.js:2300-2358`) 통째 제거
- `avatar.freeze`, `drawSelfOverlay` fallen 분기, `drawPlayer` falling 분기 제거
- `state.revealed`의 brokenTop/brokenBottom 의미 폐기 (단순 col 카운터로 사용)
- `data.fallenUsers` 누적 코드 + `window._bridgeFallenUsers` 글로벌 제거
- `r.success` 분기 제거 (line 786-797)
- 추락 사운드 호출 제거 (`bridge-cross_break/fall`)
- glassFx atlas의 break_shards/fall_trail row는 atlas 그대로 유지 (다른 row 영향 X)

### Stage 8 — 보안 검증 + DB 매핑

- bonusRows 클라 누출 grep (gameStart/waveResult/gameEnd/currentRoomInfo): 0건 확인
- console.log 평문 출력 dev gate 검증 (`BRIDGE_DEBUG_*` env)
- DB 기록: `winnerName=loser`, `is_winner=true`는 꼴등에게만, `game_rank` 1=1등 ... M=꼴등
- `pages/server-members.html`: `game_type='bridge'` 분기로 "승리" → "당첨" 표시
- payload 자동 테스트 (`AutoTest/bridge-cross-bonus-payload.js` 신규 — payload assertion, 선택)

### Stage 9 — 통합 / 엣지케이스 / QA

- M=1 시나리오 (단독 user — 본인이 꼴등)
- M=2 시나리오 (가장 흔한 케이스)
- M=8 시나리오 (finishSlots 2열 4×2 검증)
- 모두 한 번에 도달 (turn 1~3에 +2 연속 받은 user, 3 turn 안에 progress=6 가능)
- max turn 8 도달 + 도달 못한 user 1명: 그가 꼴등 (sudden death 발동 X)
- max turn 8 도달 + 도달 못한 user 2명+: sudden death loop → 1명 남을 때까지 추가 turn
- sudden death 6회 안전장치 발동 (random tie-break)
- 호스트 disconnect 중 turn 진행 (grace 처리, leaveRoom 후 자동 advance)
- 새로고침 재진입 (Phase 1: 관전만, currentRoomInfo bridgeCross sanitize 그대로)

---

## 12. 검증 (수동 QA 체크리스트)

### 12-1. 정적
- [ ] `node -c socket/bridge-cross.js socket/rooms.js js/bridge-cross.js socket/index.js utils/room-helpers.js server.js routes/api.js` 통과
- [ ] bonusRows/bonusAmounts 클라 누출 0건 (Grep)
- [ ] 추락 잔재 dead code (fallenUsers/brokenRows/cascade-falling 등) 정리
- [ ] socket 이벤트명 양방향 일치

### 12-2. 게임플레이 (2탭+)
- [ ] 색 선택 + ready + 시작 → 캐릭터 모두 다리 진입
- [ ] wave 1: 좌/우 선택 → 시차 점프 → 일부 +2, 일부 +1
- [ ] 도달자(progress=6)가 finish slot으로 이동
- [ ] 도달자는 다음 wave 안 함 (eligible 제외)
- [ ] 모두 도달 → 결과 overlay에 꼴등 1명 명시
- [ ] M=1: 단독 진행, 도달 시 본인이 꼴등 (단독 user → 꼴등 = 본인)
- [ ] M=8: 8명 동시 진행, finish slot 8개 정상 배치

### 12-3. 보안
- [ ] DevTools Network: gameStart/waveResult payload에 bonusRows/bonusAmounts 없음
- [ ] currentRoomInfo: bridgeCross 필드 sanitize 유지 (이전 fix 그대로)

### 12-4. 엣지
- [ ] max wave 8 도달 + 도달 못한 user 1명: 그 user가 꼴등 (sudden death 정상)
- [ ] max wave 8 도달 + 도달 못한 user 2명+: sudden death 결과로 1명 꼴등
- [ ] wave 1~3 모두 +2 받음 (운 좋음): progress=6 도달, 3 wave에 게임 종료 가능
- [ ] 호스트 새로고침 (wave 진행 중): 좀비 차단 (이전 leaveRoom fix)

---

## 13. 호환성 / 회귀

### 13-1. DB 매핑 (확정 — 사용자 결정)

| 필드 | 값 | 의미 |
|------|-----|------|
| `game_type` | `'bridge'` | 그대로 (DB schema 변경 X) |
| `winnerName` (recordGameSession) | `loser` (꼴등 이름) | 사용자 의도: "꼴등 = 당첨자" |
| `is_winner` (recordServerGame) | 꼴등에게만 `true`, 나머지 `false` | 당첨자 1명만 마킹 |
| `game_rank` | `1=1등 ... M=꼴등` | finishOrder 순서 그대로 |

**호출 변경** (`socket/bridge-cross.js`의 DB 기록 부분):

```js
const loser = finishOrder.length === participants.length
  ? finishOrder[finishOrder.length - 1]   // 모두 도달 시 마지막 도달자
  : participants.find(p => !finishOrder.includes(p.userName))?.userName;  // 미도달자 = sudden death 패자

const sessionId = generateSessionId('bridge', room.serverId);
Promise.all(participants.map((p, idx) => {
  const finishIdx = finishOrder.indexOf(p.userName);
  const rank = finishIdx >= 0 ? finishIdx + 1 : participants.length;  // 미도달자는 마지막 rank
  const isWinner = (p.userName === loser);  // 꼴등에게만 true
  return recordServerGame(room.serverId, p.userName, rank, 'bridge', isWinner, sessionId, rank);
}))
.then(() => recordGameSession({
  serverId: room.serverId,
  sessionId,
  gameType: 'bridge',
  gameRules: 'bonus-race',  // 룰 식별자 (Phase 2 통계 분기용)
  winnerName: loser,
  participantCount: participants.length
}));
```

### 13-2. 통계 화면 분기 (Stage 8 작업)

`pages/server-members.html:216` 영역:

```js
// 기존: r.is_winner ? '<span class="winner">승리</span>' : '-'
// 신규:
const isBridgeBonus = r.game_type === 'bridge' && r.game_rules === 'bonus-race';
const winnerLabel = isBridgeBonus ? '당첨' : '승리';
const html = r.is_winner ? `<span class="winner">${winnerLabel}</span>` : '-';
```

### 13-3. ranking 영향 (Codex 함정 §F-3 회피)

- `db/ranking.js:333` `gameTypes = ['dice', 'horse', 'roulette']` — bridge 제외 그대로 유지
- bridge 랭킹 추가 시점에 별도 분기 필요 (Phase 2)
- 현재는 통계 화면 표시만 분기, ranking 집계는 영향 없음

### 13-4. 다른 게임 / 모듈 영향

- 주사위/룰렛/경마/팀배정/crane-game: **변경 0** (bridge prefix만 건드림)
- horse-app (React): 영향 0 (다른 도메인)
- localStorage 키 (`bridgeUserName`, `pendingBridgeRoom`, `bridgeActiveRoom`): 그대로
- route (`/bridge-cross`, `/bridge-cross-multiplayer.html` 301): 그대로
- socket 이벤트 prefix (`bridge-cross:*`): 그대로

### 13-5. user-driven 인프라 보존

- 색 picker / 외곽선 / walk 애니 / wave UI overlay / wander / hover: 모두 재활용 (Scout 보고 §5)

---

## 14. 산출물

- impl 문서: 이 파일
- 코드 변경: §4 변경 범위 표 (6 파일)
- 신규 atlas: **0건** (§9 — 기존 자산 재사용)
- 자동 테스트: `AutoTest/bridge-cross-bonus-payload.js` 신규 (선택)
- 완료 후: 이 impl을 `docs/meeting/applied/2026-05/bridge-cross-bonus-race/` 로 이동

---

## 15. 결정 보류 / 후속 작업 (Phase 2 후보)

- 보너스 row 시각 강조 atlas (현재 비밀이라 미적용)
- 도착 시 cheer/celebrate 애니 row (player atlas row 7+ 추가)
- 결과 reveal에 드럼롤 사운드 / 스폿라이트 효과
- 다중 라운드 누적 점수 (1라운드 꼴등 → 다음 라운드 자동 시작 등)

---

## 16. 다음 세션 진행 가이드

새 세션에서 이 impl을 source of truth로 삼고 다음 순서로 진행:
1. impl 정독 (§1~§14)
2. SCOUT + SCOUT_CODEX 병렬 정찰 (현재 코드 영향 범위)
3. SCOUT 결과 반영 → impl 보강 또는 결정 추가
4. Coder agent로 stage 1~8 순차 구현
5. Reviewer + ReviewerCodex 병렬 리뷰
6. Coder loop 2 (critical/major fix)
7. QA 검증
8. 사용자 수동 QA + 커밋 + push
