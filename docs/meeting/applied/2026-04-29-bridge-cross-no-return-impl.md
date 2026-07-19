# 다리건너기 — 왕복 제거 + 다수 winner

작성일: 2026-04-29
대상 브랜치: feat/bridge-cross-history-v1
구현 추천 모델: Sonnet (수정 위치/함수/라인 모두 명시됨)

## 작업 목표

1. **왕복(return) 라운드 제거** → outbound 1회만 진행
2. **outbound 통과 색에 베팅한 사람 모두 winner** (다수 winner)
3. **0명 통과 절대 없음** — 기존 forced-pass 폴백 유지
4. **return 관련 부산물 전부 제거** — 다리 reset 연출, 카메라 이동, 좌우반전, 사운드 호출 일체

## 수정 파일

| 파일 | 변경 강도 |
|------|-----------|
| `socket/bridge-cross.js` | 핵심 (룰 + payload schema + endTimeout) |
| `js/bridge-cross.js` | 다수 (return 제거 + 다수 winner UI + history) |
| `AutoTest/bridge-cross-devtools.html` | 경미 (passerIndex 표기 정리) |
| `utils/room-helpers.js` | 경미 (passerIndex 필드 제거) |

## A. 서버 — `socket/bridge-cross.js`

### A-1. 함수 삭제 (dead code)

| 함수 | 라인 | 비고 |
|------|------|------|
| `shuffleArray` | 160-167 | return 외 사용 없음 |
| `buildReturnRandomFailPath` | 182-210 | |
| `buildReturnPassPath` | 212-219 | |
| `buildReturnScenarios` | 221-276 | |

### A-2. `beginScenario` 변경 (284-381)

- 311-326: returnRound 호출 / `winnerColor` 단일 결정 로직 **제거**
- 새 로직:
  ```js
  const passingColors = outbound.survivorPositions.map(i => activeColors[i]);
  // 0명 통과는 buildOutboundScenarios의 forced-pass 폴백이 보장 — 추가 가드 불필요
  ```
- broadcast payload (337-353):
  - `returnRound` 키 **제거**
  - `winnerColor` (단일 number, 옛 클라 호환용) = `passingColors[0]`
  - `winnerColors` (number[]) = `passingColors` **신규**
  - `outbound.survivorPositions` 그대로 유지 (클라 시각화 근거)
- endTimeout (370-380):
  - 변경 전: `M*4500 + 3000 + N*4500 + 5000`
  - 변경 후: `M * 5500 + 8000`, max **90000**
  - 이유: outbound 도전자 1명 평균 시간이 oscillation/fall 포함 4.5s를 초과할 수 있어 buffer 강화 (Scout-Codex R2)

### A-3. `endScenario` 변경 (386-518)

- 405-411: winners 결정
  ```js
  const passingColors = bc.passingColors; // beginScenario에서 set
  const winners = Object.entries(userColorBets)
      .filter(([, c]) => passingColors.includes(c))
      .map(([u]) => u);
  ```
- 420-431: history 기록
  - `winnerColor` (단일) 유지 = `passingColors[0]` (옛 history 호환)
  - `passingColors` 배열 **신규 추가**
  - `outboundSurvivorColors`는 이미 있으니 그대로
- broadcast payload (446-455):
  - `winnerColor` (단일) = `passingColors[0]`
  - `winnerColors` (배열) = `passingColors` **신규**
  - `winnerColorName` (단일) = `passingColors[0]`의 이름 (옛 클라 호환)
  - `winnerColorNames` (배열) **신규**
- 466 `recordGameSession` 호출의 `winnerName: winners[0]` 그대로 유지 (game_sessions 테이블 단일 컬럼)
- 469-482 `recordServerGame` 호출 그대로 (이미 다수 winner 친화적)
- 489-511 `passersForNextRound = [...winners]` 그대로 (자연 다수 ready)

## B. 클라이언트 — `js/bridge-cross.js`

### B-1. 함수 삭제

| 함수 | 라인 |
|------|------|
| `beginResetFx` | 2006-2015 |
| `beginReturnIntro` | 2017-2026 |
| `beginReturnStage` | 2028-2068 |

### B-2. `startScenarioReplay` (1844-1925)

- `returnData` 처리 (1849-1885) **제거**
- `state.fastReturn`, `state.outboundData`, `state.returnData` 변수 정리
- `state.expectedWinnerColor` (단일 number) → `state.expectedWinnerColors` (number[])
  ```js
  state.expectedWinnerColors = Array.isArray(data.winnerColors)
      ? data.winnerColors.slice()
      : (typeof data.winnerColor === 'number' ? [data.winnerColor] : []);
  ```

### B-3. `update()` phase 분기 (2182-2316)

- `'reset-fx'`, `'return-intro'`, `'return'` case 모두 **삭제**
- `'falling'` case에서 outbound 끝 시점(2272 부근) `beginResetFx()` 호출 → `finishGame(null)` 직접 호출
- `'finish-wait'` case의 `beginResetFx()` 호출(2303 부근) → `finishGame()` 호출

### B-4. `beginPlayer` / `prepareChoicePause` (1948-2104)

- `state.fastReturn` 분기 제거 (1954-1971, 2090)
- `state.stage === 'return'` 분기 제거

### B-5. `drawPlayer` (2429-2451)

- `flip = state.stage === 'return'` 제거 (always false → 단순 false 또는 분기 자체 제거)

### B-6. reset-fx 렌더 삭제 (2759-2770)

- `state.stage === 'reset-fx'` 블록 통째 제거

### B-7. `finishGame` 다수 winner (2125-2160)

- 단일 `state.winner` → `state.winners` 배열로 결정
  ```js
  const winnerColors = state.expectedWinnerColors || [];
  const candidateWinners = state.players.filter(p => winnerColors.includes(p.color));
  if (candidateWinners.length > 0) {
      state.winners = candidateWinners;
  } else if (winner) {
      state.winners = [winner];
  } else {
      // fallback: progress 가장 큰 사람 1명
      state.winners = [state.players.reduce((a, b) => a.progress >= b.progress ? a : b)];
  }
  ```
- 모든 winner의 `animator.set('result', true)` 호출
- 모든 winner의 `status = 'winner'` set

### B-8. `state.winnerSpeech` 다수 (2538 부근 `drawWinnerSpeechBubble`)

- 단일 객체 → `Set` 또는 배열로 변경:
  ```js
  state.winnerSpeeches = state.winners.map(p => ({ playerId: p.id, ... }));
  ```
- `drawWinnerSpeechBubble`에서 `state.winnerSpeeches.some(s => s.playerId === player.id)` 로 체크

### B-9. `bridge-cross:gameStart` 핸들러 (675-690)

- `data.passerIndex` 표기(681) **제거**
- detail 텍스트(682):
  - 기존: "참가 색상 ${M}개 · ${K}번째 도전자가 통과합니다"
  - 변경: "참가 색상 ${M}개 — 통과한 색에 베팅한 모두가 winner!"
  - 또는 더 짧게: `"참가 색상 ${M}개"`

### B-10. `showBridgeResult` (450-490)

- `winnerColorBlock` (455-458): 다수 색 표시
  ```js
  const winnerColors = Array.isArray(data.winnerColors)
      ? data.winnerColors
      : (typeof data.winnerColor === 'number' ? [data.winnerColor] : []);
  const winnerColorBlock = winnerColors.map(idx => {
      const c = BRIDGE_COLORS[idx];
      return `<span class="result-color">${c.emoji} ${c.name}</span>`;
  }).join(' / ');
  ```
- 헤더 텍스트도 다수 표현 ("XX 통과!" → "XX, YY 통과!")

### B-11. `renderBridgeHistory` (492-549)

- 517 `isPasser = colorIdx === h.winnerColor` 단일 비교 → 다수 비교:
  ```js
  const passing = Array.isArray(h.passingColors)
      ? h.passingColors
      : (typeof h.winnerColor === 'number' ? [h.winnerColor] : []);
  const isPasser = passing.includes(colorIdx);
  ```

### B-12. `gameEnd` 핸들러 history 보존 (480-488)

- `data.passingColors` (또는 fallback `data.outboundSurvivorColors`)를 history record에 보존:
  ```js
  bridgeCrossHistory.push({
      ...,
      winnerColor: data.winnerColor,         // 호환 유지
      passingColors: data.passingColors || data.outboundSurvivorColors || [data.winnerColor],
      winners: data.winners,
      ...
  });
  ```

### B-13. finishSlot 분산 (Scout-Codex R4)

- `safe-flash` / `finish-wait` 단계에서 `moveAvatar(layout.finishSlot(0), ...)` 호출 시 → 매 통과자마다 다른 인덱스
- `state.arrivedCount` 카운터 추가 (라운드 시작 시 0, 매 통과 시 +1)
- 호출부:
  ```js
  moveAvatar(layout.finishSlot(state.arrivedCount), 0.36, ...);
  state.arrivedCount += 1;
  ```

## C. AutoTest — `AutoTest/bridge-cross-devtools.html`

- 241 `K = d.passerIndex ? d.passerIndex : 0` → 제거 또는 주석 정리
- 244-250 `gameEnd` 핸들러 `winnerColorName` 단일 → 다수 표시 보강 (`winnerColorNames` 사용)

## D. utils/room-helpers.js

- `gameState.bridgeCross.passerIndex` 필드 제거 (사용처 0건)

## 불변조건 (must-preserve)

1. 베팅 시스템 (`select` 핸들러, ready 검증, colorIndex 0~5 검증, 토글/변경/신규 분기) — 깨면 안 됨
2. phase 전이: `idle ↔ betting → playing → finished → idle`
3. `bridge-cross:select`, `bridge-cross:start`, `bridge-cross:gameAborted`, `bridge-cross:bettingReady`, `bridge-cross:error` 이벤트 그대로
4. DB schema (`recordServerGame`, `recordGameSession`, `recordGamePlay`) 인자 호환
5. rate limit, 호스트 검증, 최소 인원 검증
6. **0명 통과 절대 금지** — `buildOutboundScenarios:142-157`의 forced-pass 폴백 그대로 유지
7. 다른 게임 (주사위/룰렛/경마/팀배정) 무영향 — `socket/bridge-cross.js` + `js/bridge-cross.js` + `gameState.bridgeCross`만 수정
8. 공유 시스템 (chat/ready/order/ranking/control-bar/sound) 무영향
9. Math.random은 서버에서만 (공정성). 클라는 deviceId/tabId/idle bob/카메라 jitter 등 외관 효과만
10. `winnerColor` (단일) 필드는 옛 클라 호환을 위해 broadcast payload + history record에 모두 유지 (=`winnerColors[0]`)

## 검증

### 정적
```bash
node -c socket/bridge-cross.js
node -c js/bridge-cross.js
```

### Grep — dead code 잔존 검출 (모두 0건이어야 함)
```
buildReturnRandomFailPath
buildReturnPassPath
buildReturnScenarios
beginResetFx
beginReturnIntro
beginReturnStage
fastReturn
returnData
state.stage === 'return'
state.stage === 'reset-fx'
state.stage === 'return-intro'
restore_glass     # fxSheet 정의는 남겨도 OK, 호출은 0건
```

### 수동 QA (브라우저 2탭)
1. 호스트 + 게스트 입장, 두 색에 각각 베팅
2. start → outbound 1회만 시각화 (return 라운드 안 일어남)
3. 다리 reset 연출이 안 뜨는지
4. 통과 색 모두 winner 표시 (다수 winner 시 결과 오버레이에 색 다중 표시)
5. 통과한 캐릭터들이 finishSlot에 겹치지 않고 분산되는지
6. 다수 winner의 말풍선이 모두 보이는지
7. 다음 라운드 자동 ready: 통과자에 베팅한 모두가 ready 상태로 진입
8. 0명 통과 시도 (M=2, 운 나쁜 경우 forced-pass 폴백 작동) — 항상 1명 이상 winner 보장
9. 히스토리 패널: 통과 색이 모두 ✅ 표시되는지
10. leaveRoom / disconnect / abort 시나리오 (베팅 후 한 명 나감, 다수 winner 후 한 명 나감)
11. 다른 게임 (주사위/룰렛/경마) 영향 없는지 빠른 회귀 확인

## 작업 순서 (안전한 의존 순서)

1. 서버 함수 삭제 (`shuffleArray`, `buildReturn*`)
2. 서버 `beginScenario` payload + endTimeout 변경
3. 서버 `endScenario` winners 결정 + history + payload 변경
4. 서버 `node -c` 검증
5. 클라 `bridge-cross:gameStart` / `bridge-cross:gameEnd` 핸들러 schema 변경
6. 클라 `startScenarioReplay` returnData 제거 + expectedWinnerColors 적용
7. 클라 `update()` phase 분기 정리 (return/reset-fx/return-intro 삭제)
8. 클라 `beginResetFx` / `beginReturnIntro` / `beginReturnStage` 함수 삭제
9. 클라 `beginPlayer` / `prepareChoicePause` / `drawPlayer` / 렌더 dead code 정리
10. 클라 `finishGame` 다수 winner 처리 + finishSlot 분산
11. 클라 `showBridgeResult` / `renderBridgeHistory` / `winnerSpeech` 다수 표현
12. 클라 `node -c` 검증
13. AutoTest devtools / utils/room-helpers.js 정리
14. Grep 잔존 검출
15. 수동 QA
