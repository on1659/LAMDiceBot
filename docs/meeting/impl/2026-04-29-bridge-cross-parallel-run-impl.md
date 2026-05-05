# Bridge Cross — Parallel Run (병렬 진행 + 다인 발판) 구현 명세

작성일: 2026-04-29
브랜치: `feat/bridge-cross-parallel-run` (구현 시 신규 생성)
구현 추천 모델: **Opus** — 핵심 애니메이션 엔진(per-runner 상태 모델, cascade fall) 리팩터에 다파일 연계 설계 판단이 필요.

---

## 1. 배경

현재 다리건너기는 도전자 1명이 6열을 모두 통과(또는 추락)할 때까지 다른 도전자는 시작 plat에서 대기. M명일 때 worst case ~M×16초로 호흡이 길고 정적인 느낌. 사용자는 "여러 명이 동시에 알아서 가는" 느낌과 "유리 한 발판에 여러 명이 함께 서고, 깨지면 같이 떨어지는" 물리를 요청.

## 2. 결정사항 (확정)

1. **시차 출발** — 동시 출발 X. 각 runner가 0.2~0.5초 간격으로 startPlatform에서 자연스럽게 출발 (jitter)
2. **칸 크기 ↑** — `tileSize` 가로/세로 ×1.30 (300×143 → 390×186 근사. rowStep도 비례 확장)
3. **캐릭터 크기 ↓** — 활성 runner 시각 scale 0.78 → 0.58, 대기/도착 0.66 → 0.50
4. **한 칸 다인 허용** — 동일 (col, row)에 여러 runner 시각 공존 가능. 미세 오프셋(±8~12px jitter)로 겹침 표현
5. **물리 cascade fall** — 어떤 (col, row) 발판이 깨지는 순간, 그 발판 위에 시각적으로 서있는 모든 active runner는 fall 상태로 강제 전이 (단일 fall 애니메이션 동시 트리거)
6. **서버 path 룰 유지** — `socket/bridge-cross.js`의 `buildOutboundScenarios`/`buildRandomFailPath`/`buildPassPath`/`brokenRows` 학습 로직은 그대로. path는 미리 결정, 클라이언트는 시각화만 변경

### 추가 결정 (작성 중 확정)

7. **종료 조건** — 모든 active runner가 `finished` 또는 `fallen`이 되면 즉시 게임 종료 broadcast 트리거 (서버 `endTimeout`은 안전장치로만 동작)
8. **시차 출발 = 클라이언트 전용** — 서버는 path만 결정, 출발 jitter는 클라이언트가 부여 (서버는 시간 모름)
9. **결과 데이터 구조** — 서버 `bridge-cross:gameStart`/`gameEnd` payload 변경 없음. 클라이언트 내부 state만 재설계

---

## 3. 변경 범위 (파일)

| 파일 | 변경 규모 | 핵심 변경 |
|------|----------|----------|
| [js/bridge-cross.js](../../../js/bridge-cross.js) | **대** | `state.current` 단일 모델 → `state.actives[]` 병렬 모델. phase 머신 per-runner. update/render 루프 개편. cascade fall 추가 |
| [css/bridge-cross.css](../../../css/bridge-cross.css) | 소 | (대부분 캔버스 내부라 영향 적음) — 필요 시 stage-wrap aspect-ratio 미세 조정 |
| [socket/bridge-cross.js](../../../socket/bridge-cross.js) | 소 | `endDelay` 산식 단축 (M×8000+8000 → 고정 30000ms 캡). 그 외 변경 없음 |
| [bridge-cross-multiplayer.html](../../../bridge-cross-multiplayer.html) | 없음 또는 거의 없음 | canvas 마크업 변경 불필요 (tileSize는 layout 코드 상수) |

**불변조건 (must-preserve):**
- 서버↔클라 socket event 명/payload 형식 (`bridge-cross:gameStart`, `bridge-cross:gameEnd`, `bridge-cross:bettingReady` 등) 유지
- `bridge-cross:select` / `bridge-cross:start` 핸들러 동작 변경 없음
- `bridgeCrossHistory`, DB 기록(`recordGamePlay`/`recordServerGame`/`recordGameSession`), 결과 ranking 형식 유지
- 베팅 phase, ready/order/chat 모듈 연동 변경 없음
- 공정성: 클라이언트 `Math.random()`은 출발 jitter / 시각적 노이즈에만 사용 (게임 결과 결정에는 0회 — server path 그대로 시각화)
- horse-race.css 공통 layout(`--horse-*` alias) 변경 없음

---

## 4. 핵심 메카닉

### 4-1. 클라이언트 상태 모델 변경

**Before (단일 runner):**
```
state.current               // 활성 PlayerActor 1개
state.currentIndex          // state.players 인덱스
state.currentScenarioIndex  // outbound paths 인덱스
state.currentPathIndex      // 현재 path step 인덱스 (col)
state.avatar                // 화면상 단일 avatar (좌표/jump 보간)
state.phase                 // 'next-player'/'enter-bridge'/'pre-choice'/...
state.pendingChoice         // 다음 choice 정보
state.preChoiceTogglesLeft, state.preChoiceWarningRow
state.lastStep
```

**After (병렬 runner):**
```
state.actives = [           // 현재 다리 위에서 진행 중인 runner들 (실시간 변동)
  {
    player,                  // PlayerActor 참조
    scenarioIndex,           // outbound paths 인덱스 (player.colorIndex 매핑)
    pathIndex,               // 현재 path step 인덱스
    avatar,                  // PlayerActor 자기 avatar (각자 보간 상태)
    phase,                   // per-runner phase
    pendingChoice,
    preChoiceTogglesLeft, preChoiceWarningRow,
    lastStep,
    timer,                   // per-runner phase timer
    startDelay               // 출발까지 남은 시간 (시차 jitter)
  }, ...
]
state.startQueue = [...]    // 아직 출발 안 한 runner들 (timer/jitter 기반 활성화)
state.arrivedCount          // 골 plat 도착 카운터 (slot 배정용 — 그대로)
state.revealed              // (col, row) 깨짐 정보 — 그대로 (cascade fall 판정에 사용)
state.elapsed               // 그대로
```

**핵심:** `PlayerActor` 클래스에 `avatar` 인스턴스를 통합해서 per-runner 보간을 자연스럽게 만든다. 또는 active 객체에 avatar를 들고 있게 한다.

추천: `PlayerActor`에 `avatar` 필드 추가. 기존 `state.avatar`는 유지하되 (debug 패널 호환) 메인 보간은 player.avatar로 이전.

### 4-2. 페이즈 머신 (per-runner)

각 active runner는 자기 phase를 가짐:

```
'pending'         → 출발 대기 (startDelay 카운트다운)
'enter-bridge'    → startPlatform → bridge entrance 점프 중
'pre-choice'      → top↔bottom 망설임 토글 (5단계)
'choice-wait'     → 다음 col 점프 진행 중
'result-hold'     → 점프 도착 후 결과 판정 직전
'safe-flash'      → 안전 발판 도착, 다음 col 준비
'falling'         → 추락 애니메이션 (자체 추락)
'cascade-falling' → 다른 runner의 추락에 휩쓸려 동시 fall (물리)
'finished'        → 골 도착, finishSlot으로 이동 후 idle
'finish-wait'     → 골 plat 점프 진행 중
```

각 runner의 update tick은 기존 단일 머신과 동일하게 `state.timer -= dt`/phase switch를 돌리되, **각 runner 객체에 timer를 보유**.

### 4-3. update / render 루프 개편

**update(dt):**
```
1. state.elapsed += dt
2. allPlayers animator update (idle bob 포함, 그대로)
3. state.startQueue 처리:
   - 각 항목의 startDelay -= dt
   - <= 0이면 active로 이동 (phase='enter-bridge')
4. state.actives 각 runner update:
   - runner.avatar.update(dt)
   - runner.player.animator phase 동기화 (자체 phase 기반)
   - runner.timer -= dt
   - timer <= 0이면 phase 머신 진행 (advanceRunner(runner))
5. 종료 검사: 출발큐 비고 + actives 비면 finishGame
```

**advanceRunner(runner):** 기존 단일 머신 switch를 함수화. `state.current` 대신 `runner` 인자 사용. `state.revealed`/`state.activeColors` 등 공유 state는 그대로 참조.

**render:**
```
1. 배경/start plat/finish plat — 그대로
2. 다리 타일 + 깨짐 표시 — 그대로 (state.revealed 기반)
3. waiting 캐릭터 그리기 — startQueue + 미출발 actives
4. fallen 캐릭터 그리기 — 그대로
5. finished 캐릭터 그리기 — finishSlot에 idle (그대로)
6. active runner 그리기 — state.actives.forEach(r => drawPlayer(r.player, r.avatar.x, r.avatar.y, ...))
7. pre-choice warning row glow — runner마다 자기 pendingChoice 위치
8. 깨짐 glass FX — state.revealed broken 정보 기반 (그대로)
```

### 4-4. 시차 출발 (jitter)

게임 시작 시 (`startScenarioFromOutbound` 진입점):
```js
state.startQueue = activeColors.map((colorIdx, i) => {
  const player = state.allPlayers[colorIdx];
  // 0.2 ~ 0.5초 사이 랜덤 jitter, i와 약간 상관 (앞 runner가 보통 먼저 출발)
  const delay = 0.15 + Math.random() * 0.35 + i * 0.05;
  return { player, scenarioIndex: i, startDelay: delay };
});
state.actives = [];
```

`startDelay`가 0 이하가 되면 `startQueue`에서 `state.actives`로 옮기고 `phase='enter-bridge'` + 첫 점프 트리거 (기존 `beginPlayer` 로직).

**Math.random 사용처 검증:** 출발 jitter는 시각적 효과 only — 게임 결과(누가 통과/추락)는 서버 path가 결정. 공정성에 영향 없음. 기존 deviceId/tabId, camera shake, drawCharacter pulse jitter 등과 같은 카테고리.

### 4-5. Cascade fall (물리)

**트리거 시점:** `revealChoice(player, step)` 호출 직후, `step.success === false`인 경우.

**로직:**
```js
function applyCascadeFall(brokenCol, brokenRow) {
  // 활성 runner 중 시각적으로 같은 (col, row) 위에 있는 모두 fall로 강제 전이
  state.actives.forEach(other => {
    if (other.player.status !== 'climbing' && other.player.status !== undefined) return; // 이미 finished/fallen은 skip
    if (other.phase === 'falling' || other.phase === 'cascade-falling') return;
    // visual position 판정: pendingChoice의 (col, row) 또는 lastStep의 (col, row)
    const pos = visualTilePosition(other);
    if (pos && pos.col === brokenCol && pos.row === brokenRow) {
      other.phase = 'cascade-falling';
      other.timer = 0.92; // 동일 fall duration
      other.player.status = 'fallen';
      other.player.fallsAt = brokenCol + 1;
      // animator는 update loop에서 fall로 전이됨
    }
  });
}

function visualTilePosition(runner) {
  // 'safe-flash' / 'choice-wait' / 'result-hold' / 'pre-choice' 단계: pendingChoice가 있으면 그 (col, row)
  // 'enter-bridge'는 다리 진입 중 — 어떤 발판도 아직 안 밟음
  if (runner.pendingChoice) return { col: runner.pendingChoice.col, row: runner.pendingChoice.row };
  if (runner.lastStep && runner.phase === 'safe-flash') return { col: runner.lastStep.col, row: runner.lastStep.row };
  return null;
}
```

**주의:** 서버 path 설계상 동일 (col, row) 깨짐 발판 위에 두 runner가 있는 경우는 매우 드뭄 (`brokenRows` 학습 때문). 그러나 정의상 처리 누락 시 시각적 모순이 생길 수 있어 방어적으로 구현. 동시에 같은 row에 winner runner가 있는 경우 — winner는 정의상 safe row에만 있으므로, 깨진 row에 있을 수 없음 (아래 4-6 참조).

### 4-6. 한 칸 다인 — 좌표 jitter

같은 (col, row)에 여러 runner가 시각 공존하는 경우, 모두 정확히 `tileCenter(col, row)` 좌표로 그리면 완전 겹침 → 시각적으로 한 명만 보임. 미세 오프셋:

```js
// active runner draw 시
function tileVisualPos(runner, tilePos) {
  // (col, row) 기준 다인 시 ±10px 오프셋. 인덱스로 deterministic 분배 (시각 jitter 안정성)
  const sameTileRunners = state.actives.filter(r =>
    visualTilePosition(r) && visualTilePosition(r).col === tilePos.col &&
    visualTilePosition(r).row === tilePos.row
  );
  const myIdx = sameTileRunners.indexOf(runner);
  const total = sameTileRunners.length;
  if (total <= 1) return tilePos;
  const angle = (myIdx / total) * Math.PI * 2;
  return {
    x: tilePos.x + Math.cos(angle) * 10,
    y: tilePos.y + Math.sin(angle) * 6
  };
}
```

이 오프셋은 `moveAvatar` 도착점에 적용 (점프 도착 시 약간 어긋난 위치). 시각적으로 "둘이 같은 발판 위에 모여서 있는" 느낌.

**대안 (더 단순):** 점프 도착 시 작은 random jitter (±8px) 부여 — 동일 결과, 코드 단순. **추천: 단순 jitter 채택.**

### 4-7. 캐릭터 / 칸 크기

**StageLayout.tileSize 변경:**
```
이전: { w: 300, h: 143 }
변경: { w: 390, h: 186 }   (×1.30)
```

**rowStep 비례 변경:**
```
이전: { x: 146, y: 76 }
변경: { x: 190, y:  99 }   (×1.30)
```

**charFootOffset (캐릭터 발 보정):** 30 → 25 (캐릭터 작아짐 비례)

**drawPlayer scale 변경:**
```
이전 (active runner): 0.78  → 0.58
이전 (waiting/finish): 0.66 → 0.50
```

**검증:** stage-wrap aspect-ratio (1024:683) 유지 가능 여부 — entrance/exit 좌표가 startWorld/finishWorld 기반이라 tileSize 늘어도 다리 길이는 그대로. 다만 다리 폭이 넓어져 시각적으로 풍성해지는 효과. canvas 크기는 그대로 1024×683.

만약 시각 비율 깨지면 stage-wrap aspect-ratio 미세 조정 (1024:720 등) 또는 tileSize 배율 ×1.20 으로 축소.

### 4-8. 서버 endDelay 단축

**Before (`socket/bridge-cross.js:212`):**
```js
const endDelay = Math.min(120000, M * 8000 + 8000);
```

**After:**
```js
// 병렬 진행: M에 무관, 한 runner 풀 path = ~16초 + jitter 마진
const endDelay = 30000;
```

서버는 endTimeout을 안전장치로만 사용. 클라이언트는 모든 runner가 finished/fallen이 되면 자체적으로 endScenario 트리거할 방법은 없음 (현재 구조). 그러나 서버 endDelay가 충분히 짧으면 사용자 체감 OK.

**대안:** 클라이언트 → 서버에 `bridge-cross:clientFinished` 이벤트 추가 → 서버가 받으면 endScenario 즉시 호출. 다만 신뢰 이슈 (악성 클라가 일찍 보낼 수도) — 결과는 이미 결정돼있으니 cheating 가능성 없음. **이건 후속 최적화로 분리** (이번 impl 범위 밖).

---

## 5. 단계별 구현 순서

1. **stage-1: 데이터 모델 도입** — `state.actives[]`/`state.startQueue` 추가, 기존 `state.current` 등은 그대로 두고 호환 (단일 active일 때 기존 동작)
2. **stage-2: per-runner phase 머신** — `advanceRunner(runner)` 함수화, update 루프 개편
3. **stage-3: render 루프** — active 다중 그리기
4. **stage-4: 시차 출발** — startQueue → actives 전환 로직
5. **stage-5: Cascade fall** — `applyCascadeFall` + `revealChoice` 후크
6. **stage-6: 좌표 jitter** — 같은 발판 다인 표현
7. **stage-7: tileSize / character scale 조정** — 시각 검증
8. **stage-8: 서버 endDelay 변경**
9. **stage-9: 최종 통합 테스트** — 2탭 게임플레이, 깨짐/통과 시각 일치 확인

---

## 6. 검증 (수동 QA 체크리스트)

### 6-1. 정적 검증
- [ ] `node -c socket/bridge-cross.js js/bridge-cross.js` 문법 OK
- [ ] `Math.random` grep — 출발 jitter / 좌표 jitter / 기존(deviceId/tabId/camera shake/pulse) 외 사용 없음
- [ ] Socket 이벤트명/payload 변경 없음 (Grep으로 `bridge-cross:gameStart`/`gameEnd`/`bettingReady` 비교)

### 6-2. 게임플레이 (로컬 5173, 2탭 호스트+게스트)

- [ ] 베팅 페이즈 정상 (기존)
- [ ] 게임 시작 → 도전자들이 순차적으로 startPlatform에서 출발 (시차 0.2~0.5초 자연스러움)
- [ ] 여러 runner가 다리 위에서 동시에 진행 — 다른 col에 분산되어 진행
- [ ] 같은 (col, row) 발판에 2명 이상 있을 때 시각적 jitter로 겹침 표현
- [ ] 누군가 추락 시:
  - [ ] 그 발판이 깨짐 표시 (glass FX) 정상
  - [ ] 같은 발판 위 다른 runner가 있다면 동시 fall (cascade)
  - [ ] 다른 row 또는 다른 col의 runner는 영향 없음
- [ ] winner들 모두 골 plat 도착 → 등록 ranking 정상
- [ ] gameEnd broadcast 후 result overlay 정상
- [ ] 다음 라운드 진입 → 통과자만 자동 ready 정상 (기존 룰)
- [ ] 호스트 새로고침 → 진행 중 게임 시각 재생 OK (서버 endDelay 30s 내 종료)

### 6-3. 엣지 케이스
- [ ] M=2 (최소 베팅 인원) 정상 동작
- [ ] M=6 (최대) 동시 다인 다리 위 시각 OK (모바일 화면 cluttering 점검)
- [ ] 모든 runner fail (winner 0명 시나리오) — `passingColors=[winnerColor]`이므로 베팅된 색 중 하나는 winner. 0명 winner 자체가 발생 안 함 (서버 보장)
- [ ] 모든 runner winner (M=2, 둘 다 같은 색 베팅) — 둘 다 통과 + 같은 발판 위 시각적 공존 OK
- [ ] 모바일 (375px 폭) — 다리 캔버스 축소 시 다인 jitter 시각적 식별 가능 여부
- [ ] 호스트 disconnect 중 게임 진행 — 기존 grace 로직 그대로 적용

---

## 7. 롤백 / 호환성

- 변경 100% 클라이언트 시각화 + 서버 timing 1줄. 결과 데이터/DB 영향 없음
- 문제 시 단일 runner 모드로 fallback: `state.startQueue` 비활성 + 기존 `nextActivePlayer` 경로 유지하면 됨 (stage-1을 보존하는 패치 형태로 구현하면 자연스러움)
- 서버 endDelay만 별도 PR로 분리 가능 (그 자체가 안전한 변경)

---

## 8. Scout / Codex 정찰 결과 — 추가 가드 (반드시 적용)

Scout/CodexScout 정찰에서 발견된 critical 이슈와 완화책. 구현 시 이 가드를 모두 적용해야 한다.

### G1. `drawPlayer` fallT 글로벌 state.timer 의존 → per-runner fallElapsed
- 위치: [js/bridge-cross.js:2380](../../../js/bridge-cross.js)
- 현 코드: `var fallT = 1 - Math.max(0, state.timer) / 0.92;`
- 문제: 병렬 모드에서 cascade fall 시 글로벌 timer가 다른 runner의 phase에 의해 출렁여 fallT 시각 글리치
- 가드: `drawPlayer` 시그니처에 `fallElapsed` 인자 추가 (또는 runner 객체 참조). runner마다 자체 `fallElapsed` 누적 (`runner.fallElapsed += dt` while phase ∈ {falling, cascade-falling})

### G2. `prepareChoicePause`의 `isCertain` 단축 분기 — 병렬 모드에서 시각 모순
- 위치: [js/bridge-cross.js:2034-2040](../../../js/bridge-cross.js)
- 현 코드: `var isCertain = !!(revealedCol && revealedCol.broken);` → broken col은 pre-choice 생략
- 문제: runner A가 col 3을 막 깨자마자 runner B가 같은 col에 도착 시 망설임 없이 안전 row로 직행 → "어떻게 알았지?" 시각 모순
- 가드: **병렬 모델에서 isCertain 단축 분기 제거.** 모든 col에 항상 pre-choice 5단계 표시. 일관된 시각 흐름 보장

### G3. `state.revealed[col].broken` 단일 row 가정 → 양쪽 row 깨짐 정보 손실
- 위치: [js/bridge-cross.js:2056](../../../js/bridge-cross.js)
- 현 코드: `state.revealed[col] = { broken: success ? revealed.broken : choice };`
- 문제: 병렬에서 같은 col의 top과 bottom 양쪽이 깨지는 시나리오 가능. 후자가 전자를 덮어써 한쪽 깨짐 자국 누락
- 가드: `state.revealed[col]` 구조 확장 → `{ brokenTop: boolean, brokenBottom: boolean }`. revealChoice는 해당 row 플래그만 set. fallen 캐릭터 render([js/bridge-cross.js:2713-2719](../../../js/bridge-cross.js))에서 `player.fallsAtRow` 직접 사용 (revealed 의존 제거)

### G4. `state.arrivedCount` race condition
- 위치: [js/bridge-cross.js:2020-2023, 2220-2223](../../../js/bridge-cross.js)
- 문제: 동시에 두 runner가 finish 도착 시 arrivedCount 증가 race → 같은 finishSlot 중복 배정
- 가드: `update(dt)`에서 actives.forEach 순서가 deterministic(색 인덱스 오름차순). advanceRunner의 finish 분기에서 `var arrivedIdx = state.arrivedCount++` 즉시 atomic. 다른 runner의 다음 advanceRunner는 갱신된 arrivedCount를 읽음

### G5. `CameraDirector` shake가 `state.currentIndex` 식별 → per-runner shake 미동작
- 위치: [js/bridge-cross.js:1455-1459](../../../js/bridge-cross.js)
- 문제: 글로벌 `state.phase === 'falling'` 단일 가정, currentIndex로 trigger 1회 보장
- 가드: `actives` 중 falling/cascade-falling phase가 1명이라도 있으면 shake 트리거. trigger 식별자는 "가장 최근 fall한 runner.player.id" 사용. cascade fall 다중 발동 시 1회만 shake (첫 fall 기준)

### G6. `pollFinished` 종료 폴링이 `state.mode === 'finished'` 의존 → finishGame 호출 명시 필요
- 위치: [js/bridge-cross.js:733-747](../../../js/bridge-cross.js)
- 가드: `update(dt)` 끝에 명시적 종료 검사:
  ```js
  if (state.actives.length === 0 && state.startQueue.length === 0 && state.mode === 'playing') {
    finishGame(null);
  }
  ```

### G7. `renderGameToText` 단일 active 직렬화 → actives[] 추가
- 위치: [js/bridge-cross.js:2807-2826](../../../js/bridge-cross.js)
- 가드: 직렬화 객체에 `actives: state.actives.map(r => ({ name, color, phase, pathIndex, ... }))` 추가. `activePlayer/activeColor/avatar` 단일 필드는 deprecated(but kept) — 첫 active 정보 fallback로 유지

### G8. 디버그 패널 input 기본값 HTML 하드코딩 → tileSize 변경 시 sync
- 위치: [bridge-cross-multiplayer.html:280-291](../../../bridge-cross-multiplayer.html)
- 현 코드: `<input id="dbgTileW" value="300">`, `<input id="dbgTileH" value="143">`, `<input id="dbgRowDx" value="146">`, `<input id="dbgRowDy" value="76">`, `<input id="dbgFootY" value="30">`
- 가드: HTML 기본값을 새 값(390/186/190/99/25)으로 갱신. 또는 JS init 시 `layout.tileSize`/`layout.rowStep`/`layout.charFootOffset` 값으로 input.value 일괄 주입 헬퍼 (더 안전). **추천: JS 일괄 주입 헬퍼 (코드↔HTML 단일 truth source)**

### G9. 출발 jitter deterministic seed (호스트/게스트 동기)
- 문제: `Math.random()` jitter는 클라마다 다른 값 → 호스트와 게스트의 출발 순서가 다르게 보일 수 있음
- 가드: `mulberry32(seed)` 사용. seed = `outbound.paths.length * 1000 + activeColors.reduce((a,c)=>a+c, 0)` 같이 broadcast 데이터로 결정. 클라이언트 모두 동일 jitter 출력
- 추가: jitter 식 변경 — `0.10 + i * 0.20 + rng() * 0.15` (i 효과 0.20, random 폭 0.15 → i 순서 거의 단조 보장. 색 인덱스 오름차순 = server iter 순서와 시각 순서 거의 일치)

### G10. cascade fall `visualTilePosition` 정확도
- impl §4-5의 lastStep/pendingChoice 추론 방식 → runner.avatar의 toX/toY 좌표로 실시간 col/row 역산이 더 정확
- 가드: `visualTilePosition(runner)` 우선순위:
  1. `runner.pendingChoice` 존재 → 해당 (col, row)
  2. `runner.phase === 'safe-flash'` + `runner.lastStep` 존재 → 해당 (col, row)
  3. 그 외 (점프 중간 등) → null (cascade 대상 아님)
- 추가 winner 가드: `if (state.expectedWinnerColors.indexOf(runner.player.colorIndex) !== -1) return null` — winner는 cascade에 휩쓸리지 않게 명시 보호 (서버 path 보장이지만 방어)

### G11. SoundManager 다중 동시 재생 throttle
- 문제: cascade fall 시 break/fall 사운드가 동시에 N회 재생 → 청각적으로 거슬림
- 가드: cascade fall 묶음당 break/fall 1회만 재생. `applyCascadeFall` 진입 시 사운드 재생 후 100ms throttle 플래그 set, 같은 tick의 후속 fall은 사운드 skip. 아니면 SoundManager 자체에 100ms dedup 권장 (별도 작업)

### G12. render 시 startQueue 캐릭터 중복 그리기 방지
- 문제: state.allPlayers.forEach에서 startSlot에 그린 후, state.actives에서 또 그릴 위험
- 가드: render에서 active runner는 `allPlayers` 순회 시 skip:
  ```js
  state.allPlayers.forEach(player => {
    if (state.actives.some(r => r.player === player)) return; // active는 actives 루프에서 그림
    if (player.status === 'waiting' || player.status === 'fallen' || player.status === 'finished') {
      drawPlayer(player, player.slot.x, player.slot.y, ...);
    }
  });
  ```

---

## 9. 단계별 구현 순서 (Codex 검토 반영 최종)

1. **stage-0**: 회귀 0 보장 wrapper — `state.actives = [현재 단일 runner를 감싼 1원소]` 호환층 도입. 동작 변화 없음
2. **stage-1**: `advanceRunner(runner)` 함수 추출. update의 switch case를 함수 인자 기반으로
3. **stage-2**: 시차 출발 + `state.startQueue` (G9 deterministic seed)
4. **stage-3**: 진정한 병렬 — actives 다수, per-runner timer
5. **stage-4**: render 다중화 (G1 drawPlayer fallElapsed, G12 startQueue 중복 가드, CameraDirector leader 선정)
6. **stage-5**: cascade fall (G10 visualTilePosition + winner 가드, G11 sound throttle)
7. **stage-6**: 좌표 jitter (±8px, deterministic seed)
8. **stage-7**: G2 isCertain 단축 제거, G3 revealed 구조 확장 + render 갱신, G4 arrivedCount atomic, G5 shake 식별, G6 종료 검사 명시, G7 renderGameToText 확장
9. **stage-8**: tileSize/rowStep/scale 조정 + G8 디버그 패널 sync
10. **stage-9**: 서버 endDelay 30000ms (`socket/bridge-cross.js:212`)
11. **stage-10**: 통합 검증 (M=2/M=6, cascade 시나리오, 새로고침 재진입, Math.random grep)

---

## 10. 산출물

- impl 문서: 이 파일
- 코드 변경: `js/bridge-cross.js` (대규모 리팩터), `socket/bridge-cross.js` (1줄), `bridge-cross-multiplayer.html` (디버그 패널 default 또는 JS 헬퍼), `css/bridge-cross.css` (필요 시 미세 조정)
- 완료 후: 이 impl을 `docs/meeting/applied/2026-04/bridge-cross-parallel-run/` 로 이동 (project rule 준수)
