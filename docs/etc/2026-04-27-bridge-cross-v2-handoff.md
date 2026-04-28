# Bridge-Cross v2 작업 핸드오프 (2026-04-27)

**현재 브랜치**: `feat/bridge-cross-v2` (main에서 분기, working tree 깨끗)
**v1 보존**: `feat/bridge-cross-integration` 브랜치 commit `03d3fcd` (PR #12, push 완료, 사용 안 함)
**시작 멘트 (새 세션)**: "bridge-cross v2 이어가자" 또는 "이 문서 읽고 Phase A 시작해줘"

---

## 1. v1 실패 원인 (반드시 학습)

PR #12 1차 통합(`fb10f2a`, mockup base) → 본 재작성(horse-race base) → Reviewer 3 라운드 + Coder 3 루프 + 14건 결함 처리 → 라이브 스모크 8/9 PASS. **그러나 mockup의 IIFE/CSS/레이아웃 잔재로 공통 시스템(Ready/Order/Chat/ControlBar/AdSense/passwordModal/historySection/resultOverlay/SoundManager) 통합이 구조적으로 어려움**.

### 사용자 핵심 지적
- **"목업은 게임플레이만 가져오란거였지 그 외의 모든건 참고하면안됐어"**
- "준비시스템/주문/채팅 등 모든 시스템을 붙일수가없는 구조"
- mockup의 캔버스 게임 코드 외에는 **일체 참고 금지**

### v1에서 처리한 14건 (참고 — git show feat/bridge-cross-integration:* 으로 추출 가능)
URL 파라미터 처리, recordServerGame/recordGameSession 호출, submitPassword 실제 emit, resultOverlay/historySection CSS+JS, closeResultOverlay inline 강제 제거, endScenario 0명 가드, bridge-cross:gameAborted broadcast, endTimeout 정리, leaveRoom timeout cleanup 회귀 제거, history-section 모바일 position:static, roomJoined 시 loadingScreen 닫기.

---

## 2. v2 핵심 원칙 (절대 깨지 마)

### 가져올 것 (mockup에서)
- **캔버스 게임 루프 코드** (`output/bridge-cross/bridge-cross-game-mockup.html` 또는 v1 브랜치 `js/bridge-cross.js`의 캔버스 IIFE 부분, line ~314부터 ~끝)
- **베팅 UI 마크업** (현재 mockup의 `bettingSection` 마크업 한 덩어리)
- **에셋 경로** `/assets/bridge-cross/sprites/*` `/assets/bridge-cross/stage/*` (v1 fb10f2a에 들어있음 — 가져올 때 같이)
- **공정성 핵심**: 클라이언트 `Math.random()` 0회 (camera shake jitter 외관 효과만 허용)

### 가져오지 말 것 (mockup에서)
- mockup의 외곽 레이아웃 / shell 그리드 / statusbar / 디버그 패널 위치
- mockup의 inline `<style>` 변수 (`--cyan` 등) — theme.css 변수만 사용
- mockup의 IIFE 캡슐화 패턴 (전역 socket/currentUser와 분리되어 있음)
- mockup의 자체 모달 / 알림 시스템

### 공통 시스템 (horse-race 그대로)
ChatModule, ReadyModule, OrderModule, ControlBar, AdSense lobby+game, showCustomAlert, showCustomConfirm, leaveRoom, passwordModal, historySection, resultOverlay, SoundManager, FOUC 방지, canonical/og 메타.

---

## 3. v2 작업 단계 (Phase A → E)

### Phase A — horse-race base 단순 복사
1. `horse-race-multiplayer.html` 통째 복사 → `bridge-cross-multiplayer.html` 신규
2. 변경 최소:
   - `<title>` `LAM Bridge Cross 🌉` (적절한 한국어)
   - canonical/og:url을 `/bridge-cross`로
   - `<link rel="stylesheet" href="/css/horse-race.css">` 제거 → `/css/bridge-cross.css` (빈 파일로 시작 가능)
   - `<script src="/js/horse-race.js">` 등 horse-race 고유 스크립트 4개 제거 → `<script src="/js/bridge-cross.js">` (빈 파일)
   - HORSE_RACE_TUTORIAL_STEPS 통째 삭제 (튜토리얼 보류)
   - 트랙 영역 (raceTrackWrapper) 제거 → `<!-- bridge-cross 게임 영역 자리 -->` 빈 div
   - horse-race 고유 마크업(horseSelectionSection 등) 제거 → bettingSection 자리 빈 div
3. **검증**: dice 진입점 등록 없이도 직접 `/bridge-cross` 접근 시 페이지 로드 + horse-race 공통 시스템(채팅/준비/주문/컨트롤바/광고) 모두 표시 (게임 영역만 비어있음)

### Phase B — 진입점 14곳 등록 (v1 학습 그대로)

| 파일 | 변경 |
|------|------|
| `dice-game-multiplayer.html` line ~143 | `.room-item.game-bridge { border-left-color: var(--bridge-500); }` |
| line ~1638-1646 | 🌉 다리 건너기 라디오 (`value="bridge"`) — horse-race label 패턴 |
| line ~1659 colorMap | `'bridge': 'var(--game-type-bridge)'` |
| line ~2786-2790 방카드 분기 | `else if (room.gameType === 'bridge') {...}` |
| line ~2910 joinRoomDirectly redirect | `/bridge-cross?joinRoom=true` 분기 |
| line ~3806 finalizeRoomCreation | `/bridge-cross?createRoom=true` 분기 |
| line ~3886 joinSelectedRoom | `/bridge-cross?joinRoom=true&room=<id>` |
| line ~2897, 3774, 3859 | `localStorage.setItem('bridgeUserName', ...)` 3곳 |
| `css/theme.css` light/dark 양쪽 | `--bridge-500: #42edff` (cyan, mockup 톤), `-rgb`, `-600`, `--bridge-accent`, `--game-type-bridge` |
| `js/shared/tutorial-shared.js:10-16` | `FLAG_BITS.bridge = 32` (TUTORIAL_STEPS는 보류) |
| `js/shared/server-select-shared.js:822` | `localStorage.setItem('bridgeUserName', name)` |

**검증**: dice 로비 → 🌉 라디오 → 방 생성 → `/bridge-cross?createRoom=true` redirect → 페이지 로드 OK (게임 영역만 비어있음)

### Phase C — 서버 + Socket

1. **`socket/bridge-cross.js`** 신규 — v1 `feat/bridge-cross-integration`의 `socket/bridge-cross.js`를 **거의 그대로 cherry-pick** (서버 결정 책임 = 1차 impl 검증 끝남):
   ```bash
   git checkout feat/bridge-cross-integration -- socket/bridge-cross.js
   ```
   가져온 후 검증할 것:
   - line 5 `recordServerGame, recordGameSession, generateSessionId` require 포함
   - line 187-209 endScenario에서 server_game_records + game_sessions 기록
   - line 139-144 0명 가드 + `bridge-cross:gameAborted` broadcast
   - line 322-324 endTimeout 정리
   - 전역 gameType 비교가 `'bridge'` 짧은 이름

2. **`socket/index.js`** — `registerBridgeCrossHandlers` import + 호출 등록 (v1과 동일)

3. **`socket/rooms.js:215`** — gameType allowlist에 `'bridge'` 추가
   ⚠️ 1차 통합에서 추가했던 leaveRoom timeout cleanup은 **절대 추가하지 마** (v1 회귀 원인)
   `gameState.bridgeCross.userColorBets` 삭제 부분만 추가 (v1 line 1038-1042 그대로)

4. **`utils/room-helpers.js`** — `gameState.bridgeCross` 초기화 (v1과 동일하게 cherry-pick)

5. **에셋 가져오기**:
   ```bash
   git checkout feat/bridge-cross-integration -- assets/bridge-cross/
   ```

**검증**: `node -c server.js`, `node -c socket/bridge-cross.js`. 서버 띄운 후 dice 로비 → bridge 방 생성 → bridge 페이지에서 socket 연결 + roomJoined 수신 (게임 영역은 비어있어도)

### Phase D — DB + 사운드 + 가이드

| 파일 | 변경 |
|------|------|
| `db/stats.js:43` DEFAULT_GAME_STATS | `bridge: { count: 0, totalParticipants: 0 }` |
| `routes/api.js:176` defaultGameStats | 동일 키 |
| `db/ranking.js:186` getMyRank result | `bridge: {}` 추가 + bridgeWinsRow 블록 (horse 패턴) |
| `db/ranking.js:328-334` getTop3Badges | `'bridge'` 4곳 |
| `db/ranking.js:370-382` getFullRanking | `getGameRanking(serverId, 'bridge')` 호출 + result에 포함 |
| `assets/sounds/sound-config.json` | `bridge-cross_*` 9개 placeholder 키 (v1과 동일) |
| `.claude/rules/new-game.md` | v1 갱신본을 cherry-pick (이번 학습 반영본): `git checkout feat/bridge-cross-integration -- .claude/rules/new-game.md` |

**검증**: 스모크 테스트 가져오기 (`git checkout feat/bridge-cross-integration -- AutoTest/bridge-cross-smoke-test.js`) → 새 서버에서 실행. createRoom → joinRoom → select → start → bettingOpen → gameAborted 흐름 PASS 확인.

### Phase E — 게임 영역 (캔버스 + 베팅 UI)

마지막 단계. 가장 중요. **mockup의 캔버스 코드만 추출**해서 `js/bridge-cross.js`에 IIFE로 캡슐화:

1. **베팅 UI 마크업** — bridge-cross-multiplayer.html의 빈 div 자리에 `bettingSection` 추가 (6색 카드 + 카운트다운 + 카운터). mockup의 마크업 형태만 참고, CSS는 horse-race 패턴 따라 새로 작성 (단순)

2. **캔버스 마크업** — 빈 `<div>` 자리에 `<canvas id="game">` + zoom-ui (호스트 control) + 디버그 패널 (`isLocalhost`만)

3. **`js/bridge-cross.js`** — IIFE 패턴:
   ```javascript
   (function() {
       const socket = window.socket || io();  // horse-race 패턴 — 글로벌 socket 사용
       // 베팅 UI 함수
       // bridge-cross:* socket 핸들러 (8개)
       // 캔버스 게임 루프 — mockup에서 추출 (sprite 로드 + 카메라 + 렌더 + 캐릭터 도전 시뮬레이션)
   })();
   ```

4. **`css/bridge-cross.css`** — bettingSection + canvas 스타일만. 결과 오버레이/히스토리 등 공통은 horse-race CSS가 처리하므로 손댈 필요 없음. theme.css 변수만 참조.

**검증**: 
- 풀 게임 시나리오: dice 로비 → bridge 방 생성 → 2탭 입장 → 베팅 → 게임 진행 → 결과 오버레이 → 히스토리 누적
- 모바일 + 데스크톱 양쪽
- 클라이언트 `Math.random` 0회 grep 확인 (camera shake 외)

---

## 4. 핵심 파일 위치 (v2 진입 시 cherry-pick할 후보)

| 가져올 것 (v1 브랜치에서) | 명령 |
|---------------------------|------|
| 서버 핸들러 (검증 끝난 게임 룰) | `git checkout feat/bridge-cross-integration -- socket/bridge-cross.js` |
| 에셋 (sprites + stage) | `git checkout feat/bridge-cross-integration -- assets/bridge-cross/` |
| utils 초기화 | `git diff main feat/bridge-cross-integration -- utils/room-helpers.js` 후 수동 |
| 가이드 갱신본 | `git checkout feat/bridge-cross-integration -- .claude/rules/new-game.md` |
| 스모크 테스트 | `git checkout feat/bridge-cross-integration -- AutoTest/bridge-cross-smoke-test.js` |
| 1차 impl (게임 룰 디자인) | 참고: `git show feat/bridge-cross-integration:docs/meeting/impl/2026-04-27-bridge-cross-integration-impl.md` |

`bridge-cross-multiplayer.html`, `js/bridge-cross.js`, `css/bridge-cross.css`는 **cherry-pick하지 마** (mockup 잔재 원인). horse-race base에서 처음부터 작성.

`dice-game-multiplayer.html`, `css/theme.css`, `js/shared/*-shared.js`, `db/*`, `routes/api.js`는 v1 변경분을 **참고**(line 위치)만 하고 main 기준으로 새로 적용.

---

## 5. 결정 사항 (v1에서 확정, v2 그대로 적용)

- gameType 식별자: 짧은 이름 `'bridge'`
- 라우트/이벤트/에셋/state 필드: 긴 이름 `bridge-cross` 유지
- 메인 색: cyan `#42edff` (mockup 톤)
- 랭킹 노출 (db/ranking.js 매핑 추가)
- 게임 로직 분리 (`js/bridge-cross.js`)
- 튜토리얼 보류 (FLAG_BITS=32 비트만 예약)
- 사운드 placeholder (mp3 미포함)

---

## 6. 트리아지

**COMPLEX** — 파일 14+개 수정/신규, DB 통합, 멀티플레이어 동기화. Phase 단위로 진행하면서 매 단계 검증.

추천 모델:
- Phase A: Sonnet (line 매핑 명확)
- Phase B: Sonnet (등록 작업)
- Phase C: Sonnet (cherry-pick + 검증)
- Phase D: Sonnet (DB + 가이드)
- Phase E: **Opus** (캔버스 게임 루프 이식, 설계 판단 필요)

---

## 7. main 머지 전 마지막 체크

- 클라이언트 `Math.random()` 0회 (camera shake jitter 외)
- 다른 게임 (dice/roulette/horse/horse-race/crane-game) 영향 없음
- 5173 서버 재시작 후 라이브 스모크 PASS
- 수동 QA: dice → bridge 방 생성, 2탭 베팅, 게임 종료, 결과 오버레이, 히스토리 누적, DB 기록(`SELECT * FROM server_game_records WHERE game_type = 'bridge'`)
- PR scope 외 변경 (horse-race / roulette / vehicle-themes) 별도 PR로 분리

---

## 8. PR 처리

- v1 PR #12 (`feat/bridge-cross-integration`) — close 안 함, 보존만
- v2 작업 완료 후 새 PR (`feat/bridge-cross-v2 → main`) 생성
- 머지 후 v1 브랜치는 archive 또는 삭제 사용자 판단
