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
- 좌/우 선택 → server가 결정한 보너스 row를 맞추면 점프 보너스 (+2~3칸)
- 못 맞추면 정상 (+1칸)
- 가장 늦게 8칸 도달한 user = **꼴등 (주문 받기)**

---

## 2. 결정사항 (확정)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 다리 길이 | **8 col** (기존 6 → 8) |
| 2 | 추락 룰 | **폐지** — 누구도 떨어지지 않음 |
| 3 | 좌/우 선택 의미 | server가 매 col 비밀 보너스 row 결정 (50/50). 맞추면 보너스, 틀리면 정상 |
| 4 | 보너스 점프 칸수 | **+2 또는 +3 random** (server 결정, 매번 다름) |
| 5 | 정상 점프 칸수 | **+1** |
| 6 | 종료 조건 | 모든 user가 8칸 도달 또는 max 12 wave 도달 |
| 7 | 꼴등 결정 | **가장 늦게 8칸 도달한 user** (1명 보장) |
| 8 | 동점 처리 (max wave 도달 못 한 user 여러 명) | progress 가장 낮은 user. 동률이면 sudden death wave (보너스 확정 100% — 한 명만 도달 못 함) |
| 9 | 보너스 row 정보 | **server 비밀** — gameStart/waveResult 모두 보너스 row 노출 X |
| 10 | 다른 user의 advance 정보 | waveResult에 포함 (decision 같은 보안 트레이드오프 — 게임성 우선) |
| 11 | 시각: 보너스 row 강조 | **양쪽 동일 유리 발판** — 보너스 row 시각 강조 X (정보 누출 방지) |
| 12 | 도착 후 캐릭터 | finish slot에 도착 순으로 idle 표시. 도달 안 한 user만 다음 wave 진행 |
| 13 | 캐릭터 수 제한 | 무제한 (기존 user-driven 그대로) |
| 14 | 본인 외곽선 / 캐릭터 식별 | 그대로 (players-my-outline-v1.png 재사용) |
| 15 | wave 카운트다운 | 3초 (그대로) |

---

## 3. 게임 룰 정의 (신규)

### 3-1. 참가
- ready phase에서 색 선택만 하면 캐릭터 spawn (기존 동일)
- 호스트 시작 클릭 → 게임 진행

### 3-2. 진행 (wave 단위)
1. **server가 게임 시작 시 8 col 보너스 row 결정** — 비밀
2. **wave k 시작** (k = 1...max 12):
   - 도달 안 한 user에게 좌/우 선택 UI (3초 카운트다운)
   - 자동 미선택 → server가 random pick
3. **server 판정**:
   - user choice == 보너스 row(server 비밀) → +2 또는 +3 (random) 칸
   - user choice != 보너스 row → +1 칸
   - 각 user의 progress 갱신: `progress = min(8, progress + advance)`
4. **시각화**:
   - 각 user 시차 점프 (deterministic seed)
   - 점프 호/거리 = advance 칸 수 비례 (+1=정상 호, +2=중간, +3=큰 점프)
   - 8칸 도달 시 → 골 plat 도착 + finish slot 배치
5. **다음 wave**: 도달 안 한 user만 진행
6. **종료 조건 검사**:
   - 모든 user 도달 → endGame
   - 12 wave 도달 + 도달 안 한 user 있음 → sudden death wave (보너스 확정 100%) → 그 후 endGame

### 3-3. 게임 종료 / 꼴등 결정
- finishOrder = 도달한 순서 [user1, user2, ...] (서버 기록)
- **꼴등 = finishOrder 마지막 user**
- max wave + sudden death 후에도 도달 못한 user → progress 가장 낮은 user = 꼴등 (동률 random)
- gameEnd 결과 overlay: "🎯 주문: {꼴등이름}" + 도착 순서 (1등~꼴등)

### 3-4. user-driven 보존
- 좌/우 선택 직접 (모드 토글 폐기 그대로)
- 시각: 캔버스 내 wave 패널 overlay (현재 그대로)
- 본인 캐릭터 외곽선 (atlas 재사용)
- 색 선택 (ready phase, 색 picker)

---

## 4. 변경 범위 (파일)

| 파일 | 변경 규모 | 핵심 |
|------|----------|------|
| [socket/bridge-cross.js](../../../socket/bridge-cross.js) | **대** | safeRows → bonusRows. 추락 로직 제거 (`fallenUsers` 폐지). userProgress 추적. waveResult `advance` 정보. finishOrder 관리. max wave + sudden death 로직 |
| [js/bridge-cross.js](../../../js/bridge-cross.js) | **대** | layout columnCount 6→8 (StageLayout 좌표 재계산). 추락 시각 제거 (cascade fall, falling phase). 점프 거리/호 advance 비례. progress 추적/render. finishOrder UI |
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
  phase: 'idle' | 'ready-wait' | 'playing' | 'finished',
  // 8 col 보너스 row (server-only, 절대 노출 X)
  bonusRows: [],            // length 8, 'top'|'bottom'
  bonusAmounts: [],         // length 8, 2|3 (각 col 보너스 점프 칸수)
  // 게임 진행 추적
  participants: [],         // [{userName, colorIndex}]
  userColors: {},           // {[userName]: colorIndex}
  userProgress: {},         // {[userName]: 0~8}
  finishOrder: [],          // 도달 순서 [userName1, userName2, ...]
  currentWave: 0,           // 1~12 (BRIDGE_MAX_WAVES)
  // wave 진행
  pendingChoices: {},       // {[userName]: 'top'|'bottom'}
  waveTimer: null,          // setTimeout handle
  waveProcessing: false,    // race 가드
  // 호환 / 기존 필드
  isBridgeCrossActive: false,
  bridgeCrossHistory: [],
  raceRound: 0,
  endTimeout: null
};
```

### 5-2. 클라이언트 (`js/bridge-cross.js`)
```js
state.bridgeProgress = {};   // {[userName]: 0~8}
state.bridgeFinishOrder = []; // 도달 순서 (시각용)
state.currentWave = 0;
// 기존 state 필드 그대로 (actives, allPlayers, ...)
// 추락 관련 제거: fallenUsers, fallsAt, fallsAtRow, cascade-falling
```

### 5-3. 상수
- `BRIDGE_COLUMNS = 8` (기존 6)
- `BRIDGE_MAX_WAVES = 12` (max wave 수, sudden death 포함)
- `BRIDGE_BONUS_AMOUNTS = [2, 3]` (보너스 점프 칸수 후보)
- `BRIDGE_NORMAL_ADVANCE = 1`
- `BRIDGE_WAVE_SEC = 3` (그대로)

---

## 6. Socket 이벤트 명세

### 6-1. 클라 → 서버 (변경 없음)
| 이벤트 | 데이터 |
|--------|--------|
| `bridge-cross:pickColor` | `{colorIndex}` |
| `bridge-cross:choice` | `{wave, choice}` (col → wave 변경, wave는 1-based) |
| `bridge-cross:start` | (호스트만) |

### 6-2. 서버 → 클라

| 이벤트 | 데이터 | 변경 |
|--------|--------|------|
| `bridge-cross:gameStart` | `{participants, totalCols: 8, maxWaves: 12}` | totalCols 8, maxWaves 추가 |
| `bridge-cross:waveStart` | `{wave, deadline: 3000, eligible: [userName, ...]}` | wave 카운터 + 도달 안 한 user 목록 |
| `bridge-cross:waveResult` | `{wave, results: [{userName, choice, advance: 1|2|3, newProgress}], finishedThisWave: [...userNames]}` | success bool 폐기, advance/newProgress 신규 |
| `bridge-cross:gameEnd` | `{loser: userName, finishOrder: [...], userProgress: {...}, participants}` | winners 폐기, **loser** (꼴등) 명시 |
| `bridge-cross:choiceProgress` | `{wave, decidedCount, totalEligible}` | 카운트만 (top/bottom 분리 X — 보너스 row 추정 방지) |
| `bridge-cross:colorUpdated` | `{userName, colorIndex, allColors}` | 그대로 |
| `bridge-cross:roundReady` | (그대로) |
| `bridge-cross:gameAborted` | `{reason}` |

**제거되는 이벤트/필드:**
- `success`, `brokenRows`, `fallenUsers`, `winners`, `passingColors`, `winnerColors` 모두 폐기

---

## 7. 페이즈 머신 / 게임 흐름

### 7-1. 서버 phase
```
idle → ready-wait (user들 색 선택 + ready) → playing (wave 1...12) → finished → ready-wait (다음 라운드)
```

### 7-2. wave 진행 (서버)
```
1. eligible = participants 중 progress < 8인 user
2. broadcast waveStart
3. waveTimer = setTimeout(processWave, 3000)
4. processWave:
   - pendingChoices 누락 user → random 자동 강제
   - 각 choice를 bonusRows[wave-1]과 비교
   - advance = (match ? bonusAmounts[wave-1] : 1)
   - userProgress[name] += advance, clamp 8
   - newProgress >= 8인 user를 finishOrder에 추가 (도달 순으로)
   - broadcast waveResult
5. 종료 검사:
   - eligible 0명 → endGame
   - currentWave >= BRIDGE_MAX_WAVES → sudden death 또는 endGame
6. 다음 wave: ~1500ms 후 wave++ + startWave 재호출
```

### 7-3. 클라 phase 흐름 (요약)
```
idle/ready-wait → playing
  enter-bridge (모두 다리 진입 점프)
    ↓
  wave-wait (좌/우 선택 UI 활성, 도달 안 한 user만)
    ↓ waveResult
  jump (advance 칸 수만큼 점프, advance에 따라 호/거리 다름)
    ↓
  도달자 → finish-wait (골 plat 점프)
    ↓
  wave-wait 다음 wave (도달 안 한 user만)
    ↓ ...
  finished → result overlay (꼴등 reveal)
  → ready-wait
```

---

## 8. UI 스펙

### 8-1. wave 패널 (캔버스 내 overlay, 그대로)
- "🌉 Wave {k}/{12} — 좌/우 선택"
- 카운트다운 3초
- 좌/우 버튼 (현재 그대로). hover 시 발판 warning_glow 동기 (그대로)
- 카운트만 표시 (`{decided}/{eligible}명 결정`)
- 추락 X → "관전 모드" 표시 X
- 도달한 user는 wave-wait 진입 X (서버에서 eligible에 안 포함)

### 8-2. 캔버스
- 다리 8 col (기존 6 → 8). col 간격 좁아짐 (캔버스 1024 width 그대로)
- 양쪽 row (top/bottom) 모두 동일 유리 발판 시각 (보너스 row 강조 X)
- 각 user 점프 시 advance 칸 수 비례 호/거리:
  - +1: jumpHeight 46 (현재 normal)
  - +2: jumpHeight 70
  - +3: jumpHeight 95
- finish slot 8개 (도달 순)

### 8-3. 결과 overlay
- "🎯 주문 받을 사람: **{꼴등이름}**" (큰 글씨, 강조)
- "도착 순서:" 1등~꼴등 list
- 각 user의 progress (8칸 도달 / 못한 경우 progress 표시)

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
| 8칸 다리 sprite | **불필요** | 다리는 코드 layout 좌표만 변경 (col 6→8). sprite 재사용 |
| 점프 +2/+3 호/거리 | **불필요 (코드만)** | jumpHeight 인자 +1=46/+2=78/+3=110 + 거리만 변경. 기존 jump row 재사용 |
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
0ms     waveResult 도착 → user advance = +2 또는 +3 인지 확인
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
4. **bonus row 추정**: user A가 wave 3에 +3 받음 → 다른 user가 wave 3에 user A의 choice(좌/우)를 알면 그 col의 보너스 row 추정 가능. **단**, 다음 col(wave 4) 보너스 row는 추정 불가. col별 독립.
5. **클라 Math.random**: 시각 effect만 (jitter, camera shake). 게임 결과 결정 0회

---

## 11. 단계별 구현 순서

### Stage 0 — impl 검토
- [x] 이 문서 작성
- [ ] 사용자 승인 후 진행

### Stage 1 — 서버 데이터 모델 / cleanup
- `utils/room-helpers.js` bridgeCross 필드 재정의 (bonusRows, userProgress, finishOrder, currentWave 등)
- `socket/rooms.js` leaveRoom cleanup 갱신 (userProgress/finishOrder 정리)
- 옛 필드 제거 (safeRows 외 fallenUsers, brokenRows 등)

### Stage 2 — 서버 로직 재작성
- BRIDGE_COLUMNS 6→8, BRIDGE_MAX_WAVES=12, BRIDGE_BONUS_AMOUNTS=[2,3] 신설
- safeRows → bonusRows + bonusAmounts 생성
- choice 핸들러: col → wave 변경, advance 계산 (match → bonusAmounts[wave-1], else +1)
- processWave: progress 갱신, finishOrder 추적, eligible 재계산
- max wave 도달 + sudden death 로직
- gameEnd payload 변경 (loser, finishOrder, userProgress)
- 추락 관련 코드 모두 제거 (fallenUsers, brokenRows, cascade)

### Stage 3 — 클라 layout (8 col)
- StageLayout columnCount 6→8 + columnStep 자동 재계산 확인
- 다리 col 8개 그리기 (drawTile 루프 8회)
- finish slot 갯수 8로

### Stage 4 — 클라 wave 핸들러 / 시각화
- waveStart/waveResult 핸들러 갱신 — wave 카운터, eligible, advance 정보 사용
- 점프 거리 (col 단위) + 호 (jumpHeight) advance 비례
- progress 추적 + finish slot 도착 순 배치
- 추락 시각 코드 모두 제거 (state.actives의 falling/cascade-falling phase 폐기)
- pendingChoice/lastStep도 wave 모델로 변경 (col → wave/from-progress/to-progress)

### Stage 5 — UI 갱신
- wave 패널 라벨 "Wave {k}/{12}"
- 결과 overlay: "🎯 주문: {loser}" + 도착 순서
- 카운트다운 표시 (그대로)
- choiceProgress: top/bottom 분리 X (총 카운트만 — 보너스 추정 방지)

### Stage 6 — 추락 인프라 정리
- cascade fall, avatar.freeze, drawSelfOverlay의 fallen 처리, drawPlayer falling 분기 등 제거 또는 dead code화
- state.revealed (brokenTop/brokenBottom) 폐기 또는 미사용
- impl §G3 brokenRows render 제거

### Stage 7 — 보안 검증
- bonusRows 클라 누출 grep (gameStart/waveResult/gameEnd/currentRoomInfo)
- console.log 평문 출력 dev gate
- payload 자동 테스트 (`AutoTest/bridge-cross-bonus-payload.js` 신규 — payload assertion)

### Stage 8 — 통합 / 엣지케이스
- M=1 / M=2 / M=8 시나리오
- 모두 한 번에 도달 (wave 1에 +3 받은 N명)
- max wave 도달 (12회 후에도 도달 못한 user)
- 호스트 disconnect 중 wave 진행
- 새로고침 재진입 (Phase 1: 관전만)

---

## 12. 검증 (수동 QA 체크리스트)

### 12-1. 정적
- [ ] `node -c socket/bridge-cross.js socket/rooms.js js/bridge-cross.js socket/index.js utils/room-helpers.js server.js routes/api.js` 통과
- [ ] bonusRows/bonusAmounts 클라 누출 0건 (Grep)
- [ ] 추락 잔재 dead code (fallenUsers/brokenRows/cascade-falling 등) 정리
- [ ] socket 이벤트명 양방향 일치

### 12-2. 게임플레이 (2탭+)
- [ ] 색 선택 + ready + 시작 → 캐릭터 모두 다리 진입
- [ ] wave 1: 좌/우 선택 → 시차 점프 → 일부 +2/+3, 일부 +1
- [ ] 도달자(progress=8)가 finish slot으로 이동
- [ ] 도달자는 다음 wave 안 함 (eligible 제외)
- [ ] 모두 도달 → 결과 overlay에 꼴등 1명 명시
- [ ] M=1: 단독 진행, 도달 시 본인이 꼴등 (단독 user → 꼴등 = 본인)
- [ ] M=8: 8명 동시 진행, finish slot 8개 정상 배치

### 12-3. 보안
- [ ] DevTools Network: gameStart/waveResult payload에 bonusRows/bonusAmounts 없음
- [ ] currentRoomInfo: bridgeCross 필드 sanitize 유지 (이전 fix 그대로)

### 12-4. 엣지
- [ ] max wave 12 도달 + 도달 못한 user 1명: 그 user가 꼴등 (sudden death 정상)
- [ ] max wave 12 도달 + 도달 못한 user 2명+: sudden death 결과로 1명 꼴등
- [ ] wave 1에 모두 +3 받음 (운 좋음): 1 wave에 게임 종료 (모두 progress=3에서 다시 +3 = 6 → +3 = 9 = clamp 8). 실제론 2~3 wave에 종료
- [ ] 호스트 새로고침 (wave 진행 중): 좀비 차단 (이전 leaveRoom fix)

---

## 13. 호환성 / 회귀

- DB schema 그대로 (gameType='bridge', winners → "loser" 단일로 변환 — recordServerGame은 winnerName 필드. loser=winnerName 이걸로 매핑하거나 별도 필드)
- ⚠ DB winners 필드 호환: gameEnd에서 loser만 보낼지, winnerName=loser로 매핑할지 결정 필요 (Stage 2에서)
- 다른 게임 영향 없음 (다리건너기 단독)
- user-driven 인프라 (색 picker, 외곽선, walk 애니, wave UI overlay) 모두 재활용

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
