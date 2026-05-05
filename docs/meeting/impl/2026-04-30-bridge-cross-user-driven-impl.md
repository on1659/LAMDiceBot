# Bridge Cross — User-Driven (사용자 직접 조종) 구현 명세

작성일: 2026-04-30
브랜치: `feat/bridge-cross-user-driven`
구현 추천 모델: **Opus** — 게임 정체성 변경 + 서버/클라/UI 다파일 동시 재설계 + 보안(서버 권위) 판단 필요.

---

## 1. 배경

기존 다리건너기는 "색 베팅" 게임 — user는 6색 중 하나에 베팅하고, 서버가 사전 결정한 path를 시각화로 본다. user는 결과에 직접 영향을 주지 못한다.

사용자 요청 (2026-04-30): 게임 룰을 "주사위처럼" user 직접 조종으로 변경. 베팅 phase를 없애고, 각 user가 col마다 위/아래를 직접 선택하거나 자동에 맡긴다.

## 2. 결정사항 (확정)

### 핵심 룰 (1차 결정)
| # | 항목 | 결정 |
|---|------|------|
| 1 | 참가 방식 | **A. 베팅 phase 제거. ready만 누르면 캐릭터 spawn** |
| 2 | 3초 타이머 종료 | **A. 자동 모드 강제 적용 (서버 50/50 random pick)** |
| 3 | wave 동기화 | **A. 모든 user 선택 완료 후 동시 점프 (wave gating 유지)** |
| 4 | 자동 모드 안전 정책 | **A. 50/50 random pick (긴장감)** |
| 5 | 자동/수동 토글 시점 | **B. 라운드 진행 중 변경 불가, 다음 라운드부터** |
| 6 | 버튼 라벨 | **B. 위/아래 (top/bottom)** |
| 7 | 서버 권위 | **A. safeRows 서버 비밀, choice 받으면 서버 판정** |

### Scout/Codex 정찰 후속 결정 (2차)
| # | 항목 | 결정 |
|---|------|------|
| A | `waveResult`에 다른 user success/choice 포함 | **1. 포함** — "다른 사람 추락 봤으니 다음 col은 반대 row" 게임성 우선. safeRows 부분 누출은 룰의 본질로 인정 |
| B | wave 중 user disconnect 처리 | **1. 자동 50/50 강제 진행** — 일관성 |
| C | M=1 (1명) 시 3초 카운트다운 | **1. 유지** — 긴장감이 게임 정체성 |
| D | wave 중 호스트 위임 (transferHost) | **1. 허용** — 일반 동작 그대로 |
| E | `bridge-cross:bettingReady` 이벤트명 | **2. `bridge-cross:roundReady`로 변경** — 의미 명확 |
| F | 자동 user "결정 완료" 인디케이터 | **1. 캐릭터 머리 위 체크마크 표시** — 모두 결정 가시화 |
| G | 7명+ 시 처리 | **1. 6명 cap (게임 시작 차단)** — Phase 1 범위 |
| H | endTimeout 산정 | **2. 동적 `6 * (3000 + 1500) + 8000 ≈ 35000ms`** — wave 시간 +시각화 마진 +안전장치 |

### Codex 정찰 비결정 보강 (자동 반영)
- 서버 `gameStart`/`waveResult` payload에서 `safeRows` 평문 broadcast 절대 금지 (현 line 193, 202 누출 중)
- 서버 `console.log`의 `outbound.safeRows=...` 평문 출력 제거 또는 NODE_ENV 조건부
- pre-choice 5단계 와리가리 phase 자체 폐기 (user-driven에선 의미 없음)
- 데드 상수 정리: `BRIDGE_BETTING_SEC` / `BRIDGE_MIN_BETTORS` 제거 → `BRIDGE_WAVE_SEC = 3` / `BRIDGE_MIN_PLAYERS = 1` (M=1 허용) / `BRIDGE_MAX_PLAYERS = 6` 신규
- `state.scenarios` / `state.outboundData` 데이터 모델 완전 폐기 → incremental wave update 구조
- `mulberry32` jitter seed 재정의: `participants.length * 1000 + waveIndex * 7 + colorSum`
- cascade 가드: winner 가드 → success 가드 (자기 row가 success였으면 cascade row와 다른 row이므로 자동 면역. 코드 단순화)
- phase enum 일관: `'idle' | 'ready-wait' | 'playing' | 'finished'` (`'betting'` 제거)
- `state.allPlayers` 6명 고정 → 동적 user 수에 따라 생성. `allPlayerDefs` 사용 폐기
- 베팅 잔재 헬퍼 정리: `getPlayerBettors` / `bettorTagText` / `allBets` 사용처 모두 제거 또는 user 단위로 재정의

---

## 3. 게임 룰 정의 (신규)

### 3-1. 참가
- 방 입장 → ready 토글 (기존 ReadyModule 재활용)
- 호스트 게임 시작 클릭 → ready된 user 모두 자동 참가, 캐릭터 spawn
- 베팅 phase / 색 선택 UI 완전 제거
- 색은 user 자동 배정 (예: 입장 순서대로 빨/주/노/초/파/남, 7명 이상이면 색 재사용 또는 추가 색 정의 필요 — 추가 결정 §4-3)

### 3-2. 진행 (col-by-col)
1. **다리 진입**: 모든 캐릭터 startPlatform → bridge entrance (시차 출발 jitter 유지)
2. **모두 다리 위 도착** → wave-wait
3. **col k 도전 wave 시작**:
   - 서버 broadcast: `bridge-cross:waveStart {col: k, deadline: 3000ms}`
   - 클라이언트: 위/아래 버튼 UI 표시 + 3초 카운트다운 시작
   - **수동** user: 직접 위 또는 아래 클릭 → 클라가 `bridge-cross:choice` emit
   - **자동** user: 클라가 자동 모드인 경우 즉시 (또는 0.1~0.5초 jitter 후) 서버에 "auto" 선택 emit. 서버가 받으면 즉시 50/50 결정
   - **타임아웃**: 3초 안에 choice 안 온 user는 서버가 자동 모드 강제 적용 (50/50)
4. **모든 user choice 결정** → 서버 col k 판정:
   - 각 user.choice를 safeRows[k]와 비교 → success boolean
   - 처음 fail한 user의 row를 brokenRows[k]에 기록 (cascade 시각용)
   - **단**: parallel run impl에서는 brokenRows 학습 path였지만, user-driven에서는 학습 의미 없음 (user 자유 선택). brokenRows는 시각 자국용으로만.
5. **서버 broadcast**: `bridge-cross:waveResult {col, results: [{userName, choice, success}], brokenRows: {top: bool, bottom: bool}}`
6. **클라이언트 시각화**:
   - 각 user 시차 점프 (deterministic mulberry32)
   - success → safe-flash
   - fail → falling
   - cascade: 같은 (col, row) fail 위 다른 user가 있으면 같이 fall (winner 가드 — winner 개념 변경, §3-4 참조)
7. **wave-wait** → col k+1 (col 5까지 반복)

### 3-3. 게임 종료
- col 5 (마지막) wave 완료 후:
  - 통과한 user (status='finished') = **winner**
  - 추락한 user (status='fallen') = **loser**
  - 다수 winner 가능 (또는 0명 — 모두 추락 가능. 0명 winner 케이스도 허용)

### 3-4. Winner 개념 변화
- 기존: server가 사전 결정한 winner 색 → 그 색 베팅한 user
- 신규: 마지막 col까지 통과한 user 모두 winner
- "winner 가드" (cascade fall 면역) → user-driven에선 winner 개념이 사전엔 알 수 없음. 그러므로 cascade 가드는:
  - **success한 user는 cascade fall에 휩쓸리지 않음** (자기 row가 안전 row이므로)
  - 단순 (col, row) 일치 검사로 충분 (success 정보만 있으면 됨)

### 3-5. 자동/수동 모드
- user별로 모드 보유 (default: **manual**)
- 라운드 시작 전 phase에서 user가 토글 가능 → 클라가 `bridge-cross:setMode` emit
- 게임 진행 중 (`phase === 'playing'`)엔 모드 변경 차단 (5B)
- 다음 라운드 진입 (`bettingReady` 또는 새 ready phase) 시 변경 가능
- 모드 표시 UI: 대기 phase에서 토글, 게임 중에는 readonly 표시

### 3-6. 색상 (캐릭터 식별)
- 7명+ 베팅이 가능했던 기존: 색은 6개 + N명 같은 색
- 신규: user당 1캐릭터, 색은 식별용
  - 정원: 최대 6명 (6색 보장)
  - 7명+ 시: 추가 색 정의 (또는 입장 순서로 6색 cyclic 재사용 — 시각 충돌 발생). **결정 보류 — Phase 1에선 최대 6명 제한 권장**.

### 3-7. 호스트 권한
- 호스트만 게임 시작/중단 가능 (기존 유지)
- 호스트도 자동/수동 토글 가능 (자기 캐릭터에 한해)

---

## 4. 변경 범위 (파일)

| 파일 | 변경 규모 | 핵심 변경 |
|------|----------|----------|
| [socket/bridge-cross.js](../../../socket/bridge-cross.js) | **대** | 베팅 핸들러 (`select`) 제거. 신규: `choice` / `setMode` / wave 진행 로직. safeRows 비밀 보관. user 단위 spawn. cleanup 로직 갱신 |
| [js/bridge-cross.js](../../../js/bridge-cross.js) | **대** | 베팅 UI 로직 제거. 위/아래 선택 UI + 3초 타이머 + 자동/수동 토글. waveStart/waveResult 핸들러. user당 PlayerActor spawn. parallel run의 wave gating 인프라 재활용 |
| [bridge-cross-multiplayer.html](../../../bridge-cross-multiplayer.html) | **중** | bettingSection 제거 또는 재구성 → 자동/수동 토글 패널. 게임 중 위/아래 버튼 + 타이머 패널 신규 마크업 |
| [css/bridge-cross.css](../../../css/bridge-cross.css) | **소** | 베팅 그리드 스타일 제거 또는 retire. 위/아래 버튼 + 타이머 + 자동/수동 토글 신규 스타일 |
| [socket/rooms.js](../../../socket/rooms.js) | 소 | leaveRoom 시 새 cleanup 필드 (userChoices, userModes 등) |
| [utils/room-helpers.js](../../../utils/room-helpers.js) | 소 | createRoomGameState bridgeCross 필드 재정의 |

**불변조건 (must-preserve):**
- 새로고침 재진입 + sessionStorage `bridgeActiveRoom` 동작
- 호스트 disconnect grace 처리 (기존 phase 분기에 wave 진행 중 분기 추가)
- 베팅/ready/order/chat 모듈 UI 레이아웃 (베팅만 빠짐)
- DB 기록 형식: gameType='bridge' / winners list / participantCount
- 공정성: 클라 Math.random은 시각 효과 only (jitter, camera shake). 결과 결정 0회
- 다른 게임 영향 없음 (다리건너기 단독)

---

## 5. 데이터 모델

### 5-1. 서버 (`socket/bridge-cross.js`)
```js
gameState.bridgeCross = {
  phase: 'idle' | 'ready-wait' | 'playing' | 'finished',
  // 라운드 데이터 (ready-wait 시 collect, playing 시 사용)
  participants: [],          // [{userName, colorIndex, mode: 'auto'|'manual'}]
  safeRows: [],              // server-only, length=6, 'top'|'bottom'. 클라엔 절대 노출 안 함
  brokenRows: [],            // length=6, {top: bool, bottom: bool} — wave 결과로 누적
  currentCol: 0,             // 0~5
  waveDeadline: 0,           // Date.now() + 3000 — 타임아웃 검사용
  pendingChoices: {},        // {[userName]: 'top'|'bottom'} — 현재 wave에서 받은 choice
  waveTimer: null,           // setTimeout handle for wave timeout
  userModes: {},             // {[userName]: 'auto'|'manual'} — 라운드 사이 persist
  finishedUsers: [],         // 마지막 col 통과한 user들 — winner
  fallenUsers: [],           // 도중 추락한 user들
  // 호환 / 기존 필드
  bridgeCrossHistory: [],
  endTimeout: null,
  isBridgeCrossActive: false
};
```

### 5-2. 클라이언트 (`js/bridge-cross.js`)
```js
state.players = [];          // PlayerActor[] — user 단위 (was: 색 단위)
state.allPlayers = [];       // 같음 (참가자 외 idle 캐릭터 없음)
state.actives = [];          // 다리 위 진행 중 runner record[]
                             // runner = { player, userName, mode, currentCol, choice, avatar, phase, timer, ... }
state.startQueue = [];       // 출발 대기
state.waveIndex = 0;
state.brokenRows = [];       // {top: bool, bottom: bool} per col
state.currentCol = 0;
state.waveDeadline = 0;      // 클라 카운트다운 표시용 (서버 broadcast 받음)
state.myChoice = null;       // 'top'|'bottom'|null — 내가 이번 wave 보낸 choice
state.myMode = 'manual';     // 'auto' | 'manual' — 내 모드 (다음 라운드 적용)
state.activeMyMode = 'manual'; // 현재 게임 진행 중인 내 모드 (잠긴 상태)
// 옛 단일 호환 필드 (camera framing 등) 그대로 유지
```

---

## 6. Socket 이벤트 명세

### 6-1. 클라 → 서버

| 이벤트 | 데이터 | 동작 |
|--------|--------|------|
| `bridge-cross:setMode` | `{mode: 'auto'|'manual'}` | user의 모드 갱신 (phase==='playing'일 땐 거부) |
| `bridge-cross:choice` | `{col: number, choice: 'top'|'bottom'}` | 현재 wave에 user의 선택 등록. col이 currentCol 아니면 무시 |
| `bridge-cross:start` | (호스트만) | 라운드 시작. ready된 user 모두 참가 |

### 6-2. 서버 → 클라

| 이벤트 | 데이터 | 동작 |
|--------|--------|------|
| `bridge-cross:gameStart` | `{participants: [{userName, colorIndex, mode}], totalCols: 6}` | 게임 시작. 클라가 캐릭터 spawn 시작 |
| `bridge-cross:waveStart` | `{col, deadline: 3000}` | col 도전 wave 시작. 클라는 위/아래 UI + 카운트다운 표시 |
| `bridge-cross:waveResult` | `{col, results: [{userName, choice, success}], brokenRows: {top, bottom}}` | wave 판정 결과. 클라는 시차 점프 시각화 |
| `bridge-cross:gameEnd` | `{winners: [...userNames], finishedUsers, fallenUsers, participants}` | 게임 종료. 결과 overlay 표시 |
| `bridge-cross:bettingReady` | (재사용) | 다음 라운드 시작 가능 알림. 통과자 자동 ready (기존 룰) |
| `bridge-cross:gameAborted` | `{reason}` | 호스트 이탈 등 중단 시 |
| `bridge-cross:modeUpdated` | `{userName, mode}` | 다른 user의 모드 변경 broadcast (UI 동기화) |

**제거되는 이벤트 (기존):**
- `bridge-cross:select` (베팅) — 폐기
- `bridge-cross:selectionConfirm` / `selectionCount` — 폐기

---

## 7. 페이즈 머신 / 게임 흐름

### 7-1. 서버 phase 전이
```
idle (방 생성) → ready-wait (user들 ready) → playing (게임 진행) → finished (결과 표시) → ready-wait (다음 라운드)
```

`playing` 내부 sub-phase (서버가 직접 관리):
```
spawn → wave[0] → wave[1] → ... → wave[5] → end
```

각 wave:
1. `currentCol = k` 설정, `pendingChoices = {}`, `waveDeadline = Date.now() + 3000`
2. broadcast `waveStart`
3. 자동 user들 즉시 50/50 결정 (또는 짧은 jitter 후)
4. `waveTimer = setTimeout(processWave, 3000)`
5. `processChoice` (클라 emit 받음): pendingChoices에 등록. 모두 들어오면 즉시 `processWave()` 호출 + clearTimeout
6. `processWave()`:
   - 누락된 user → 자동 강제 50/50
   - 각 user choice를 safeRows[k]와 비교 → results 생성
   - brokenRows 갱신
   - broadcast `waveResult`
   - 살아있는 user 중 col=5까지 통과한 자가 있으면 finished
   - 모두 fallen 또는 모두 finished면 endGame
   - 아니면 다음 wave (currentCol++) — **단**: 시차로 wave 시작 (시각 자연스러움 위해 ~0.5초 후)

### 7-2. 클라 phase 전이
parallel-run impl의 phase 머신 재활용:
```
idle → ready (대기) → playing (
  enter-bridge → wave-wait (선택 UI 활성) → wave-launch (시차 점프) → choice-wait → result-hold → safe-flash | falling → wave-wait (다음 col) ... → finish-wait → finished
) → result → idle
```

핵심 변경: `wave-wait` phase에서 user 선택 UI 활성화. 서버 `waveResult` 받으면 wave-launch 트리거.

---

## 8. UI 스펙

### 8-1. 라운드 시작 전 (ready-wait phase)
- 베팅 그리드 → **자동/수동 토글 패널** (단일)
  - 큰 토글 스위치: "자동 ⇄ 수동"
  - 설명: "자동: 서버가 무작위 선택 / 수동: 직접 위/아래 선택"
  - 다른 user의 모드 표시 (선택)
- 기존 ready 버튼 그대로
- 호스트 시작 버튼 그대로

### 8-2. 게임 진행 중 (wave-wait phase, 내가 살아있을 때)
- 캔버스 아래 또는 옆에 **선택 패널** 표시
  - 큰 카운트다운 숫자 (3 → 2 → 1)
  - 큰 버튼 2개: **▲ 위 (Top)** / **▼ 아래 (Bottom)**
  - 자동 모드면: 버튼 disabled + "자동 모드: 서버가 결정 중..." 표시
  - 수동 모드: 버튼 클릭 시 emit + UI lock
- 추락한 user (관전 모드): 패널 hidden, "탈락" 표시

### 8-3. 게임 진행 중 (wave-launch / choice-wait / result-hold / safe-flash / falling 동안)
- 선택 패널 hidden
- 캔버스에 점프 시각화

### 8-4. 결과 (finished phase)
- 기존 result overlay 재활용
- "winners" / "fallen" 분리 표시

---

## 9. 공정성 / 보안 (7A)

1. **safeRows는 절대 클라 broadcast 금지** — gameStart payload에서 제외. waveResult에서 success bool과 brokenRows만 보냄
2. **choice는 항상 서버 검증** — 서버가 currentCol 외 col 무시, 이미 결정된 wave 무시
3. **자동 mode random은 서버 Math.random** — 클라이언트가 영향 못 줌
4. **타임아웃은 서버 기준** — 클라이언트 시계 신뢰 X. 서버 setTimeout(3000)로 강제 종료
5. **클라 Math.random**: 시각 effect (jitter, camera shake, mulberry32 deterministic seed) only. 게임 결과 결정 0회

---

## 10. 단계별 구현 순서 (Codex 정찰 후 최종)

### 서버 측 (먼저)

1. **stage-1: 서버 데이터 모델 + cleanup**
   - `utils/room-helpers.js` `bridgeCross` 필드 재정의 (impl §5-1)
   - `socket/rooms.js:1038-1043` leaveRoom cleanup → `pendingChoices`/`userModes`/`participants`/`finishedUsers`/`fallenUsers` 모두 user 단위 정리
   - `socket/bridge-cross.js`: 옛 `select`/`selectionConfirm`/`selectionCount` 핸들러 즉시 제거 (no-op 단계 X — race 위험)
   - 데드 상수 정리: `BRIDGE_BETTING_SEC` 제거, `BRIDGE_WAVE_SEC=3`/`BRIDGE_MAX_PLAYERS=6` 신규
   - `BRIDGE_MIN_PLAYERS=2` → 1 (M=1 허용, decision C)

2. **stage-2: 서버 신규 핸들러 골격**
   - `setMode` 핸들러 (phase==='playing' reject)
   - `choice` 핸들러 (currentCol 검증 + pendingChoices 저장)
   - `start` 핸들러 — ready 기반으로 갱신 + 7명+ cap 차단 (decision G)
   - participants 생성 + safeRows 서버 비밀 생성 (`Array.from({length:6}, ()=> Math.random()<0.5?'top':'bottom')`)

3. **stage-3: 서버 wave 진행 로직**
   - `startWave(col)` / `processWave(col)` / `endWaveTimeout` 함수
   - waveTimer setTimeout(3000) — 모든 choice 모이거나 timeout 시 processWave
   - `bridge-cross:waveStart` / `waveResult` broadcast (results는 모든 user choice/success 포함, decision A)
   - waveProcessing 플래그로 race 차단
   - **safeRows를 broadcast 객체에 절대 포함 X — 검증: payload assertion**

4. **stage-4: 호스트 disconnect grace 확장**
   - 기존 (`socket/bridge-cross.js:497-543`) `phase==='playing'` 분기에 wave 진행 중 처리 추가
   - waveTimer + endTimeout 모두 cleanup
   - host 위임은 일반 플로우 (decision D — 별도 처리 X)

5. **stage-5: gameEnd + DB 기록 + 이벤트명 변경**
   - `gameEnd` payload: `{winners:[userNames], finishedUsers, fallenUsers, participants}` (옛 winnerColor 호환 폐기)
   - `recordServerGame`/`recordGameSession` winner=user 단위
   - `bridgeCrossHistory` 항목 형식 user-driven으로 (round, winners[], fallenUsers[], participants, brokenRows, timestamp)
   - **`bettingReady` → `roundReady`로 이벤트명 변경** (decision E). 클라/서버 양쪽 grep + 갱신
   - endTimeout 동적 산정 `6 * 4500 + 8000 ≈ 35000ms` (decision H)

6. **stage-6: 서버 console.log 보안 정리**
   - `socket/bridge-cross.js:202` `outbound.safeRows=...` 평문 출력 제거 (또는 NODE_ENV !== 'production'에서만)
   - 신규 코드의 모든 console.log에 safeRows 포함 금지 (Grep 검증)

### 클라 측 (다음)

7. **stage-7: 클라 베팅 UI 완전 제거**
   - `bridge-cross-multiplayer.html` bettingSection 마크업 폐기
   - `css/bridge-cross.css` `.bridge-betting-section` / `.bridge-color-grid` / `.bridge-color-card` 스타일 폐기
   - `js/bridge-cross.js`에서 `BRIDGE_COLORS`/`bridge-color-card` 핸들러 / `state.activeColors` / `state.allBets` / `state.expectedWinnerColors` / `state.scenarios` / `state.outboundData` 모두 제거
   - `getPlayerBettors`/`bettorTagText`/`allBets` 헬퍼 정리

8. **stage-8: 클라 신규 UI 마크업/스타일**
   - 자동/수동 토글 패널 (`#modeTogglePanel` 신규 in HTML)
   - 위/아래 선택 패널 (`#waveChoicePanel` 신규) — 큰 버튼 2개 + 카운트다운
   - "결정 완료" 체크마크 인디케이터 (decision F) — 캐릭터 머리 위 또는 패널 옆
   - 관전자 모드 표시 (추락한 user)

9. **stage-9: 클라 핸들러 + 데이터 모델**
   - `bridge-cross:waveStart` 핸들러 → 카운트다운 시작 + UI 활성
   - `bridge-cross:waveResult` 핸들러 → 시차 점프 시각화 트리거 (parallel-run wave gating 인프라 재활용)
   - `bridge-cross:modeUpdated` 핸들러 → 다른 user UI 동기화
   - `state.players`/`state.allPlayers`를 user 단위로 재정의 (incremental, allPlayerDefs 폐기)
   - 색 자동 배정: `colorIndex = i % 6` cyclic (participants 인덱스 기반, deterministic)

10. **stage-10: pre-choice 폐기 + cascade 가드 갱신**
    - `prepareChoicePause`의 pre-choice 5단계 토글 phase 자체 제거 (decision: 와리가리 무의미)
    - `state.preChoiceTogglesLeft` / `state.preChoiceWarningRow` / 'pre-choice' phase case dead code 정리
    - cascade 가드: `expectedWinnerColors` 검사 → "이 user의 wave choice가 success였는가" 검사로 대체
    - mulberry32 seed 재정의: `participants.length * 1000 + state.waveIndex * 7 + colorSum`

11. **stage-11: 자동/수동 모드 + persistence**
    - 클라 myMode 토글 UI + sessionStorage save/restore
    - 라운드 진행 중 토글 UI 비활성 (서버도 reject)
    - 자동 모드 user는 waveStart 받으면 0.1~0.5초 jitter 후 클라가 직접 random 선택 emit
    - 또는 서버가 자동 user를 즉시 random 결정 (선택 — 보안상 후자 권장)

12. **stage-12: phase enum 일관**
    - 클라/서버 모든 `phase === 'betting'` 비교 grep → 'ready-wait'로 갱신
    - admin 패널 (`routes/server.js:161`) 보존 검증
    - `isBridgeCrossActive` 보존

13. **stage-13: 새로고침 재진입 (단순화)**
    - Phase 1: 진행 중 reconnect user는 관전 모드만 (시각 동기 X). gameAborted 또는 endGame까지 대기
    - Phase 2 (후속 작업): `currentRoomInfo` (`socket/rooms.js:147`)에 wave 진행 정보 포함 → 재진입 동기화

14. **stage-14: 통합 + 보안 검증**
    - M=1 / M=2 / M=6 / 모든 자동 / 모든 수동 / 혼합 시나리오 추론 통과
    - safeRows 누출 grep: 클라 코드 / payload / console.log 모두 0건
    - DevTools Network 탭 확인 (수동 QA): gameStart/waveResult payload에 safeRows 없음
    - DB 기록 검증: gameType='bridge', winners=user list

각 stage 종료 시 `node -c socket/bridge-cross.js js/bridge-cross.js socket/rooms.js utils/room-helpers.js server.js routes/api.js` 통과 필수.

---

## 11. 검증 (수동 QA 체크리스트)

### 11-1. 정적
- [ ] `node -c socket/bridge-cross.js js/bridge-cross.js socket/rooms.js utils/room-helpers.js server.js routes/api.js` 통과
- [ ] `Math.random` 검증: js/bridge-cross.js 시각 only, socket/bridge-cross.js만 게임 결정 (서버)
- [ ] Socket 이벤트명 새 list와 클라/서버 양방향 일치
- [ ] safeRows가 클라 emit / log / debug serialization 어디에도 노출되지 않음 (Grep으로 검증)

### 11-2. 게임플레이 (2탭 호스트+게스트)
- [ ] 방 생성 → ready 토글만으로 게임 시작 가능 (베팅 UI 없음)
- [ ] 자동/수동 토글 가능 (라운드 전)
- [ ] 게임 시작 후 col 0 wave: 위/아래 버튼 활성, 3초 카운트다운
- [ ] 위 클릭 → choice emit → wave 결과 broadcast → 캐릭터 점프
- [ ] 아래 클릭도 마찬가지
- [ ] 3초 안에 안 누르면 → 자동 강제 → 50/50 결과
- [ ] 자동 모드 user는 버튼 disabled, 즉시 결정
- [ ] 모든 user가 선택 완료 시 즉시 wave 진행 (3초 안 기다림)
- [ ] cascade fall: 두 user가 같은 (col, row) fail → 같이 추락
- [ ] 마지막 col (5) 통과 user = winner, 추락 user = loser
- [ ] 다수 winner 정상 표시
- [ ] 0 winner (모두 추락) 정상 처리

### 11-3. 모드 변경 / persistence
- [ ] 라운드 진행 중 모드 토글 차단 (UI disabled or 서버 reject)
- [ ] 다음 라운드 시작 전 모드 변경 가능
- [ ] 모드는 새로고침 후에도 sessionStorage로 복원 (선택)

### 11-4. 보안
- [ ] DevTools Network 탭에서 `bridge-cross:gameStart` payload에 safeRows 없음
- [ ] DevTools Network 탭에서 `bridge-cross:waveResult`만 success bool / brokenRows 포함
- [ ] 클라가 잘못된 choice (이미 끝난 col) emit 시 서버 무시 + 무영향

### 11-5. 엣지 케이스
- [ ] M=1 (참가자 1명): 정상 진행, 통과 시 winner
- [ ] M=6: 6명 동시 도전, 모드 혼합 (3명 자동 + 3명 수동)
- [ ] 호스트 새로고침 (게임 중): grace 후 endTimeout 정상
- [ ] 게스트 새로고침 (게임 중): sessionStorage로 재진입, 진행 중 wave 시각 동기
- [ ] 추락 user 새로고침: 관전 모드로 복귀, 선택 UI 비활성

---

## 12. 호환성 / 회귀

- 기존 다리건너기 데이터/세션과는 룰이 완전히 다르므로 데이터 호환 의미 없음
- DB schema는 그대로 (gameType='bridge', winners, participants 형식 유지)
- 다른 게임(주사위/룰렛/경마)에 영향 없음
- parallel-run impl(2026-04-29)의 wave gating / per-runner phase 머신 / cascade fall / 시차 출발 / jitter 인프라는 그대로 활용

## 13. 산출물

- impl 문서: 이 파일
- 코드 변경: §4 변경 범위 표 참조 (5~6 파일)
- 완료 후: 이 impl을 `docs/meeting/applied/2026-04/bridge-cross-user-driven/` 로 이동
