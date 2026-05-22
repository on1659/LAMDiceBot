# 다리건너기 — 깨지는 유리다리(Glass Bridge) 재설계 구현 명세

작성일: 2026-05-21
브랜치: `feat/free-page`
구현 추천 모델: **Opus** — 게임 룰 전면 재설계 + 다파일 연계 + 공정성
원본 설계 문서: `C:\Users\user\.gstack\projects\on1659-LAMDiceBot\user-feat-free-page-design-20260521-001826.md` (v2, APPROVED)
정찰: Scout + ScoutCodex (2026-05-21) 보고 반영

> 이 문서가 구현의 source of truth. 구현 세션은 이것만 읽는다.

---

## 1. 배경

현재 bridge-cross는 "Bonus Race" 룰(+1/+2 보너스, 추락 없음, 좌/우 선택). 재미가 없고("다리건너기인데 안 떨어진다"), 좌/우 선택은 어차피 순수 운이라 의미가 없었다.

**전환 방향**: 무선택 관전형 "깨지는 유리다리". 좌/우 선택·카운트다운 전부 제거. 서버가 게임 전체를 한 번에 계산 → 클라이언트는 애니메이션으로 관전. 추락 = "위험 풀" 입장, 위험 풀 sudden death(상대 탈락 방식)가 꼴등 1명을 수학적으로 보장.

## 2. 핵심 설계 결정 — One-shot 계산 모델

**무선택이므로 게임 결과에 플레이어 입력이 0이다. 따라서 서버는 `bridge-cross:start` 시점에 게임 전체(건너기 + 모든 sudden death 라운드 + 최종 꼴등)를 동기 함수 하나로 계산한다.** 그 결과 "스크립트"를 클라에 1회 broadcast하고, 클라는 스크립트를 애니메이션으로 재생한다.

이 결정의 파급 (ScoutCodex 지적 해소):
- wave 타이머·`processWave` 루프·incremental broadcast **전부 제거**.
- disconnect 좀비 가드 불필요 — 게임은 이미 resolved & DB 기록 완료. 애니메이션 도중 누가 나가도 결과 불변.
- "위험 풀 1명 → 즉시 종료" 같은 라이브 엣지케이스 불필요 — 전부 사전 계산.
- 룰렛/경마와 동일 패턴("서버가 결정 → 클라 애니"). **트레이드오프**: 스크립트에 최종 꼴등이 포함되므로 devtools로 미리 볼 수 있다. 이는 룰렛·경마와 동일한 기존 트레이드오프이며 v1에서 수용. (Phase 2 하드닝: progressive emission.)

## 3. 상수 (`socket/bridge-cross.js` 상단)

```js
const BRIDGE_STEPS = 6;            // 유리다리 칸 수 (사용자 확정 2026-05-21)
const CRACK_PROB = 0.5;            // 칸당 깨질 확률 (사용자 확정 — 거의 전원 추락, 위험 풀이 본 무대)
const BRIDGE_MAX_SUDDEN_DEATH = 6; // sudden death 안전장치 (재시행 라운드 포함 카운트)
const BRIDGE_MIN_PLAYERS = 2;      // 파티게임 최소 인원 (기존 1 → 2)
const BRIDGE_ROUND_RESET_MS = 4000;// 결과 후 다음 라운드 ready 전환 delay
// 애니메이션 총 길이는 스크립트에서 산출(아래 §5-4). roundReady 타이머에 사용.
```

폐기 상수: `BRIDGE_COLUMNS`, `BRIDGE_MAX_WAVES`, `BRIDGE_BONUS_AMOUNTS`, `BRIDGE_NORMAL_ADVANCE`, `BRIDGE_WAVE_SEC/MS`, `BRIDGE_INTER_TURN_MS`, `BRIDGE_COLLAPSE_MS`, `BRIDGE_END_TIMEOUT_MS`(타이밍 모델 변경으로 재산정 → roundReady 타이머로 대체).

## 4. 데이터 모델

### 4-1. 서버 `gameState.bridgeCross` (`utils/room-helpers.js`)

```js
bridgeCross: {
  phase: 'idle',          // 'idle' | 'crossing' | 'finished'  (※ §12 phase 계약 준수)
  participants: [],        // [{ userName, colorIndex }]
  userColors: {},          // { [userName]: colorIndex }  — ready phase 색 선택
  script: null,            // resolveGame() 결과 (애니 재생 후 폐기). server-only? 아래 §6 참조
  loser: null,             // 확정된 꼴등 이름
  raceRound: 0,            // 누적 라운드 번호 (UI 표시, 새로고침 보존)
  bridgeCrossHistory: [],  // 라운드 결과 누적 [{round, loser, completedAt}]
  isBridgeCrossActive: false,
  roundResetTimer: null    // 결과→ready 전환 setTimeout 핸들
}
```

폐기 필드: `bonusRows`, `bonusAmounts`, `userProgress`, `finishOrder`, `currentWave`, `suddenDeathCount`, `pendingChoices`, `waveTimer`, `waveDeadline`, `waveProcessing`, `interTurnTimer`, `endTimeout`.

### 4-2. 스크립트 구조 (`resolveGame()` 반환)

```js
{
  crossing: { [userName]: fallStep },   // fallStep: 1..BRIDGE_STEPS 에서 추락 / null = 무사 통과
  dangerPool: [userName, ...],          // 추락자 (0명이면 전원으로 대체 — §5-2)
  sdRounds: [                           // sudden death 라운드 순서 배열
    {
      type: 'elim' | 'rerun' | 'random',
      poolBefore: [userName, ...],
      outcomes: { [userName]: 'safe' | 'fall' },  // type='random'이면 생략 가능
      poolAfter: [userName, ...]
    }
  ],
  loser: userName,                      // 최종 꼴등
  durationMs: <number>                  // 클라 애니 총 길이 추정 (roundReady 타이머용)
}
```

## 5. `resolveGame(participants)` 알고리즘 — 게임의 핵심

순수 동기 함수. `socket/bridge-cross.js`에 신설. `Math.random()`만 사용(서버 권위).

### 5-1. 건너기 phase

각 플레이어마다 1..`BRIDGE_STEPS` 칸을 순서대로 판정: 각 칸에서 `Math.random() < CRACK_PROB`이면 그 칸에서 추락(`fallStep`), 루프 종료. 끝까지 안 깨지면 `fallStep = null`(무사 통과).

### 5-2. 위험 풀 구성

`dangerPool = 추락자 전원(fallStep != null)`. **만약 dangerPool이 0명(전원 무사 통과)이면 dangerPool = 참가자 전원**(설계 문서 "위험 풀 0명" 규칙).

### 5-3. sudden death — 상대 탈락 (load-bearing invariant)

```
sdRounds = []
sdCount = 0
while dangerPool.length > 1:
    sdCount += 1
    if sdCount > BRIDGE_MAX_SUDDEN_DEATH:
        # 안전장치: 서버 random 1명을 꼴등으로
        picked = dangerPool[floor(random()*length)]
        sdRounds.push({ type:'random', poolBefore: [...dangerPool], poolAfter:[picked] })
        dangerPool = [picked]
        break
    # 각자 safe/fall 추첨
    outcomes = {}
    for p in dangerPool: outcomes[p] = (random() < CRACK_PROB) ? 'fall' : 'safe'
    safeCount = (outcomes 중 'safe' 수)
    if safeCount == 0 or safeCount == dangerPool.length:
        # 전원 safe 또는 전원 fall → 아무도 안 바뀜, 재시행
        sdRounds.push({ type:'rerun', poolBefore:[...dangerPool], outcomes, poolAfter:[...dangerPool] })
        continue            # ※ sdCount는 이미 +1 됨 — 재시행도 카운트 (무한루프 방지 핵심)
    else:
        # safe = 위험 풀 탈출(구제), fall = 잔류
        stayers = dangerPool 중 outcomes==='fall'
        sdRounds.push({ type:'elim', poolBefore:[...dangerPool], outcomes, poolAfter:[...stayers] })
        dangerPool = stayers
loser = dangerPool[0]
```

**불변조건** (반드시 성립): 위험 풀 크기는 절대 0이 되지 않고(전원 safe는 재시행으로 차단), 단조 비증가하며, `sdCount`가 재시행 포함으로 증가하므로 6라운드 안전장치가 유한 종료를 보장한다. 풀이 1이 되면 그 1명이 꼴등.

### 5-4. durationMs 산출

크로싱 시퀀스(고정 ~10초) + `sdRounds.length × 라운드당 ~3.5초` + 결과 reveal(~3초)의 합. 클라 애니 상수와 동일 공식으로 계산 — roundReady 타이머에 사용.

## 6. Socket 이벤트

### 클라 → 서버
| 이벤트 | 데이터 | 비고 |
|--------|--------|------|
| `bridge-cross:pickColor` | `{colorIndex}` | 유지 (ready phase 색 선택) |
| `bridge-cross:start` | (호스트만) | 유지 — 핸들러가 resolveGame 호출 |

### 서버 → 클라
| 이벤트 | 데이터 | 비고 |
|--------|--------|------|
| `bridge-cross:gameStart` | `{ participants, script }` | **script 전체 1회 broadcast.** 클라가 애니 재생 |
| `bridge-cross:colorUpdated` | `{userName, colorIndex, allColors}` | 유지 |
| `bridge-cross:roundReady` | `{raceRound}` | 유지 — 애니 종료 후 다음 라운드 |
| `bridge-cross:error` | `{message}` 문자열 | 유지 |
| `bridge-cross:gameAborted` | `{reason}` | 유지 |

**폐기 이벤트** (서버 emit + 클라 on 양쪽 제거): `bridge-cross:choice`, `bridge-cross:waveStart`, `bridge-cross:waveResult`, `bridge-cross:choiceProgress`, `bridge-cross:bridgeCollapse`, `bridge-cross:gameEnd`(결과는 클라가 script에서 직접 표시).

`script`는 `gameStart` payload에 포함되어 클라가 받는다(애니에 필요). 설계 문서의 "lanes = 서버 비밀"은 **전체 칸별 깨짐 매트릭스를 보내지 말라**는 의미였으나, one-shot 모델에선 클라가 fallStep/outcomes를 알아야 애니가 가능하다 → 룰렛·경마 선례대로 결과를 payload에 담는다(§2 트레이드오프). `routes/api.js`의 재진입 마스킹(`bridgeCross: undefined`)은 그대로 유지하여 새로고침 재진입자에게 script가 평문 노출되지 않게 한다.

## 7. 서버 구현 (`socket/bridge-cross.js`)

전면 재작성. 골격:

- **`resolveGame(participants)`** — §5. 순수 함수.
- **`bridge-cross:pickColor` 핸들러** — 기존 유지 (게임 중 변경 차단은 `phase !== 'idle'`로).
- **`bridge-cross:start` 핸들러**:
  1. `checkRateLimit`, 호스트 검증, `room.gameType==='bridge'` 검증.
  2. `phase !== 'idle'`이면 거부.
  3. ready 인원 + 색 선택 검증. `readyUserList.length < BRIDGE_MIN_PLAYERS`(=2)면 에러.
  4. `participants` 구성 (`{userName, colorIndex}`). `mode` 필드 폐기.
  5. `script = resolveGame(participants)`. `bc.script = script`, `bc.loser = script.loser`, `bc.phase = 'crossing'`, `bc.isBridgeCrossActive = true`, `bc.raceRound += 1`.
  6. **DB 기록** (§11) — 즉시.
  7. `bridgeCrossHistory.push({round, loser, completedAt})`.
  8. `io.to(room).emit('bridge-cross:gameStart', {participants, script})`.
  9. `roundResetTimer = setTimeout(→ resetToReady, script.durationMs + BRIDGE_ROUND_RESET_MS)`.
  10. `updateRoomsList()`.
- **`resetToReady(room)`** — `phase='idle'`, `isBridgeCrossActive=false`, `script=null`. 꼴등 제외 전원 자동 ready(아래), `io.emit('bridge-cross:roundReady', {raceRound})`, `io.emit('readyUsersUpdated', ...)`.
  - **자동 ready 규칙** (ScoutCodex 암묵계약): `participants 중 loser 제외 전원`을 자동 ready. (기존 "도달자만"은 finishOrder 의존이라 폐기 → "꼴등 제외 전원".)
- **`disconnect` 핸들러**: `phase==='idle'`(ready 대기)일 때만 일반 cleanup. `phase==='crossing'`이면 아무것도 안 함(게임 resolved). 호스트 grace/위임은 기존 horse-race 패턴 유지.
- **`gameAborted`**: 참가자 0명 등 비정상 시.

폐기 함수: `processWave`, `scheduleEndGame`, `scheduleCollapseAndEnd`, `startWave`, `beginGame`(→ start 핸들러로 흡수), `endGame`(→ DB는 start로, 결과는 클라로), `getEligible`, `randomRow`/`randomBonusAmount`/`makeRandomBonus*`, `clearBridgeTimers`(→ roundResetTimer만 clear).

## 8. 클라이언트 구현 (`js/bridge-cross.js`)

### 8-1. 폐기
- wave 상태 변수 (`waveActiveCol/waveDeadlineTs/waveCountdownTimer/waveMyChoice/waveDecidedUsers`, `window._bridgeWaveActiveCol/_bridgeHoverRow/_bridgeFinishedUsers`).
- `showWaveChoicePanel`/`hideWaveChoicePanel`/`startWaveCountdown`/`submitWaveChoice`/`updateWaveCounts`/`refreshWaveDecisionList`/`setBridgeTileHover`.
- `waveStart`/`choiceProgress`/`waveResult`/`bridgeCollapse`/`gameEnd` 핸들러.
- 캔버스 IIFE의 보너스 phase (`wave-launch/choice-wait/result-hold/safe-flash/finish-delay`), `applyWaveResult`, bonusPad 관련 (`imageDefs.bonusPad`, `bonusPadSheet`, manifest `bonusPad`).

### 8-2. 신규 — 스크립트 애니메이션
`bridge-cross:gameStart` 핸들러가 `script`를 받아 캔버스 IIFE에 전달. 애니메이션 시퀀스:
1. **건너기**: 모든 플레이어가 6칸 유리길을 동시에 걷는 끊김 없는 1회 시퀀스(~10초). 각 플레이어는 `crossing[name]` 값대로 진행 — `fallStep`에서 유리 깨짐 + 추락 애니(부활한 `fall` row + `glass-fx` `break_shards`/`fall_trail`) + 화면 흔들림 + SFX. `null`이면 끝까지 통과. 약간의 시차(누가 먼저 떨어지나)는 **결정론적 시드**로(클라 `Math.random` 금지 — 아래 §13). 추락자는 "위험 풀" 영역으로 이동 시각화.
2. **sudden death**: `sdRounds`를 순서대로 재생. 각 라운드: 위험 풀 인원이 짧은 유리길을 다시 걷고, `outcomes`대로 safe=탈출 / fall=잔류. `type:'rerun'`이면 "재시행" 연출(아무도 안 바뀜). `type:'random'`이면 안전장치 연출. 스포트라이트/페이싱으로 클라이맥스.
3. **결과**: `script.loser`를 꼴등 reveal 오버레이로 표시 ("🎯 주문 받을 사람: {loser}"). 기존 `resultOverlay` 재사용.

### 8-3. 진행 신호
`render_game_to_text()`가 애니 완료를 `phase==='finished'` / `mode==='finished'`로 보고하도록 캔버스 상태를 갱신(ScoutCodex 지적 — 안 하면 결과 오버레이 polling이 멈춤). 단 one-shot 모델에선 결과를 클라가 script에서 직접 띄우므로, 이 polling 의존을 끊고 애니 종료 시 직접 `showBridgeResult(script.loser, ...)` 호출하는 방식을 우선한다.

### 8-4. 유지
색 선택 picker, ready/roomCreated/roomJoined 모듈 init, `renderUsersList`, `updateUsers`(C-3), `gameSection.classList.add('active')`(C-2), 새로고침 재입장.

## 9. HTML / CSS

- `bridge-cross-multiplayer.html`: `waveChoicePanel` div(264-274) **삭제**. 결과 overlay는 기존 `resultOverlay` 유지. AdSense 3블록·공통 모듈 마운트 ID 전부 보존.
- `css/bridge-cross.css`: `.bridge-wave-*` 클래스 전체(116-331) **삭제**. 위험 풀 / sudden death / 꼴등 reveal 스타일 신규. `.container { max-width:800px !important }`(C-1) 유지.

## 10. `utils/room-helpers.js` / `socket/rooms.js`

- `utils/room-helpers.js`: `createRoomGameState()`의 `bridgeCross` 필드를 §4-1대로 재정의.
- `socket/rooms.js` `leaveRoom`: bridge cleanup을 신규 필드 기준으로 — `participants`에서 떠난 유저 제거, `userColors[name]` 삭제. `phase==='crossing'` 중 이탈은 결과 불변이므로 추가 종료 트리거 불필요(one-shot). 옛 필드(`pendingChoices/userProgress/finishOrder`) 참조 제거.

## 11. DB 매핑

`bridge-cross:start` 핸들러에서 resolveGame 직후:

```js
recordGamePlay('bridge', participants.length, room.serverId || null);
if (room.serverId) {
  const sessionId = generateSessionId('bridge', room.serverId);
  Promise.all(participants.map(p => {
    const isLoser = (p.userName === script.loser);
    const rank = isLoser ? participants.length : 1;  // 꼴등=N, 나머지=1 (무등수 2단계)
    return recordServerGame(room.serverId, p.userName, rank, 'bridge', isLoser, sessionId, rank);
  }))
  .then(() => recordGameSession({
    serverId: room.serverId, sessionId, gameType: 'bridge',
    gameRules: 'glass-bridge',          // 'bonus-race' → 'glass-bridge'
    winnerName: script.loser,           // 꼴등 = 당첨자 (기존 계약 유지)
    participantCount: participants.length
  }))
  .catch(e => console.warn('[다리건너기] DB 기록 실패:', e.message));
}
```

`recordServerGame` 시그니처 불변. `result`(3번째)·`gameRank`(7번째) 둘 다 `rank`(꼴등=N / 나머지=1). `isWinner`는 꼴등에게만 true(기존 bridge 계약 — 꼴등=당첨자).

## 12. 불변조건 (must-preserve)

- gameType `'bridge'` 고정 (`routes/api.js:244` allowlist, DB).
- **phase 문자열 계약**: `routes/api.js:156`이 `phase !== 'idle' && phase !== 'finished'`로 "진행중" 판정. → phase는 `'idle'`/`'finished'`(비진행) + `'crossing'`(진행중)만. 다른 이름 쓰면 라우트가 깨진다.
- 라우트: `/bridge-cross`, `/bridge-cross-multiplayer.html` 301 리다이렉트, `FREE_GAME_SLUGS`의 `'bridge'` — 전부 무변경.
- localStorage/sessionStorage: `bridgeActiveRoom`, `pendingBridgeRoom/Join`, `bridgeUserName`, `bridgeSoundEnabled/Volume` — 무변경.
- socket prefix `bridge-cross:*` 유지. 보존 이벤트명: `pickColor/start/gameStart/colorUpdated/roundReady/error/gameAborted`.
- DB 호출 시그니처(`recordGamePlay/recordServerGame/recordGameSession/generateSessionId`) 무변경.
- 공통 모듈(ControlBar/Chat/Ready/Order/Ranking/Sound/Tutorial), `resultOverlay`, `historySection`, AdSense 3블록, `FreeInvite` — 무변경.
- `routes/api.js`의 재진입 마스킹 `bridgeCross: undefined` 유지 (script 평문 누출 차단).
- 크로스게임 영향 0 — bridge 전용 파일만 수정. 공통 모듈 init 호출부 건드리지 말 것.
- `socket/index.js` register 무변경.

## 13. 함정 (Scout / ScoutCodex)

- **C-1~C-5** (`_common.md`): `.container !important`, `.game-section.active`, `updateUsers` 배열, `horse-race.css` 의존, URL 진입 — 기존 동작 보존(이번 작업은 기존 페이지 수정이라 대부분 이미 충족).
- **F-1 phase 계약**: §12 참조. phase 이름 `'idle'/'crossing'/'finished'` 고정.
- **F-2 script 누출**: 재진입 마스킹 유지. `gameStart` 외의 경로(currentRoomInfo, console.log)로 script 흘리지 말 것.
- **F-3 disconnect**: one-shot이라 `phase==='crossing'` 중 이탈은 무처리. 좀비 가드 불필요.
- **공정성**: 클라 `Math.random()`는 게임 결과에 0회. 추락 시차 연출도 **결정론 시드**(`mulberry32` 등 기존 시드 인프라)로 — 클라 random 금지. 서버 `Math.random`은 `resolveGame` 내부에만.
- **DB rank**: 무등수 모델 — 꼴등=참가자수, 나머지=1 (§11).
- **manifest fallback**: `applySpriteManifest` 실패 시 inline `fxSheet`/`playerSheet`로 동작. 추락 FX 부활 시 manifest와 inline 일관성 유지.
- **render_game_to_text polling**: §8-3 — 결과 표시를 polling 의존에서 떼어낸다.

## 14. 재사용 자산 (신규 스프라이트 0건)

- 죽은 추락 코드 부활: `js/bridge-cross.js`의 `falling`/`cascade-falling` phase 분기, `drawPlayer`의 `falling` 파라미터(`anim='fall'`), `update`의 fall 분기, `state.revealed` 모델. (`applyCascadeFall`/`revealChoice`는 좌/우 cascade 전제라 무선택 모델엔 부적합 — 추락 애니 패턴만 참고하고 로직은 신규.)
- `glass-fx-v2.png`: `break_shards`(row3), `fall_trail`(row4), `crack`(row2).
- `players-{color}.png`: `fall` row.
- 매니페스트: `assets/bridge-cross/sprites/bridge-cross-sprites.manifest.json` — `bonusPad` 시트 정의 제거, 나머지 유지.
- 폐기 에셋: `bonus-pad-v1.png` 및 관련 코드.

## 15. Stage별 구현 순서

- **Stage 1 — 서버 데이터/상수**: `utils/room-helpers.js` 필드 재정의, `socket/bridge-cross.js` 상수 교체. 검증: `node -c`.
- **Stage 2 — `resolveGame()`**: §5 알고리즘 구현. 단위 검증: 4/6/8명으로 수십 회 호출해 항상 loser 1명, 위험 풀 0 안 됨, sudden death 6라운드 내 종료 확인(임시 스크립트).
- **Stage 3 — 서버 핸들러**: `start`/`pickColor`/`disconnect`/`resetToReady` 재작성. 폐기 함수 제거. DB 기록. 검증: `node -c socket/bridge-cross.js`.
- **Stage 4 — `socket/rooms.js` cleanup**: leaveRoom 신규 필드.
- **Stage 5 — 클라 이벤트/폐기**: wave 코드 전부 제거, `gameStart` 핸들러 신규.
- **Stage 6 — 클라 애니메이션**: 건너기 시퀀스 + 추락 FX 부활 + sudden death 라운드 재생 + 꼴등 reveal.
- **Stage 7 — HTML/CSS**: `waveChoicePanel` 삭제, `.bridge-wave-*` 삭제, 위험 풀/sudden death 스타일.
- **Stage 8 — 검증**: §16.

## 16. 검증 체크리스트

### 정적
- [ ] `node -c socket/bridge-cross.js js/bridge-cross.js socket/rooms.js utils/room-helpers.js server.js routes/api.js`
- [ ] 클라 `Math.random` grep — 게임 결과 결정 0회 (시각/ID/시드만)
- [ ] script 누출 grep — `gameStart` 외 경로 0건
- [ ] 폐기 이벤트(`choice/waveStart/waveResult/choiceProgress/bridgeCollapse/gameEnd`) 서버·클라 양쪽 잔재 0
- [ ] phase 문자열 `'idle'/'crossing'/'finished'`만 사용

### 게임플레이 (2탭+)
- [ ] 색 선택 + ready(2명↑) + 시작 → 건너기 애니 재생
- [ ] 일부/전원 추락 → 위험 풀 시각화
- [ ] sudden death 라운드 재생 (elim/rerun 연출 구분)
- [ ] **꼴등 정확히 1명** 결과 오버레이
- [ ] 다음 라운드: 꼴등 제외 전원 자동 ready
- [ ] M=1: 게임 시작 차단 (`BRIDGE_MIN_PLAYERS=2`)
- [ ] `getComputedStyle('.container').width` = 800px
- [ ] 다른 게임(주사위/룰렛/경마) 회귀 0

### 엣지
- [ ] 전원 무사 통과(위험 풀 0) → 전원 sudden death → 꼴등 1명
- [ ] 위험 풀 2명 동시 safe/동시 fall 반복 → 재시행 → 결국 종료
- [ ] sudden death 6라운드 안전장치 발동 시 random 1명
- [ ] 건너기 애니 도중 호스트 새로고침 → 결과 불변

## 17. 산출물

- 코드 변경: §7~§10 (6 파일)
- 신규 스프라이트: 0건
- 완료 후: 이 impl을 `docs/meeting/applied/2026-05/`로 이동
- lesson 후보: phase 문자열이 라우트 진행중 판정에 결합(F-1) → 구현 후 `bridge-cross.md` 또는 `_common.md`에 추가 검토
