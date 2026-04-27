# Bridge-Cross Rewrite 구현 명세 (impl)

작성일: 2026-04-27 (PR #12 1차 통합 후 재작성)
대상: bridge-cross-multiplayer.html을 horse-race-multiplayer.html base로 통째 재작성하여 공통 UX 시스템(자동준비/메뉴/방폭파/컨트롤바/비밀번호/AdSense/결과오버레이/historySection/CSS변수/DB기록)에 통합
구현 추천 모델: **Sonnet** (line 단위 매핑 명확, 게임 디자인 판단은 1차 impl에서 종결)
선행 작업: PR #12 1차 통합 commit `fb10f2a` (게임 룰/서버 책임은 `2026-04-27-bridge-cross-integration-impl.md` 기준 — 변경 없음)
PR: https://github.com/on1659/LAMDiceBot/pull/12 (누적 commit)

> **On completion**: 1차 impl + 본 impl 모두 `docs/meeting/applied/`로 이동

---

## 0. 배경 — 왜 재작성인가

PR #12 1차 통합은 mockup base를 그대로 옮긴 결과 공통 UX와 단절:

- `+ 방 만들기` 라디오에 bridge 미등록 → **사용자가 방 생성 자체 불가**
- 자동 준비/메뉴/historySection/결과 오버레이/AdSense lobby/password 등 공통 시스템 누락
- DB 기록(`recordGamePlay`) 호출 0회 → 통계/랭킹 invisible
- CSS 변수(`--bridge-500` 등) 미정의 → theme 통합 안 됨
- localStorage / FLAG_BITS / colorMap 누락 → 다른 게임에서 돌아올 때 컨텍스트 끊김

**해결 방향**: horse-race-multiplayer.html을 base로 통째 복사 → 게임 영역(canvas + 베팅 UI)만 mockup에서 이식. 공통 시스템은 horse-race가 검증된 패턴이므로 그대로 차용.

---

## 1. 결정 사항 (사용자 확정)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 진입 흐름 | dice-game-multiplayer.html 7곳 등록 (horse-race 패턴 복제) |
| 2 | 입장 패턴 | localStorage `bridgeUserName` + `?createRoom=true` / `?joinRoom=true` (다른 게임 통일) |
| 3 | 랭킹 노출 | A: 노출 (`db/ranking.js`에 `'bridge'` 매핑 추가) |
| 4 | 게임 로직 분리 | A: `js/bridge-cross.js`로 추출 (캔버스 루프 ~1500줄, horse-race 패턴) + `css/bridge-cross.css` |
| 5 | 튜토리얼 | B: 보류 — `FLAG_BITS.bridge = 32` 비트 예약만, `TUTORIAL_STEPS`는 다음 작업 |
| 6 | 사운드 mp3 | B: `sound-config.json` 키만 placeholder (mp3 미포함) |
| 7 | PR | A: PR #12에 누적 commit |
| 8 | 이름 규칙 | **8-A 통일 짧은 이름 `'bridge'`** — gameType 식별자만 `'bridge'`. 라우트(`/bridge-cross`), 파일명(`bridge-cross-multiplayer.html`, `bridge-cross.js`), 에셋 경로(`/assets/bridge-cross/`), 소켓 이벤트(`bridge-cross:*`), 내부 state 필드(`gameState.bridgeCross`)는 긴 이름 유지 |

### 8번 결정 상세 — `'bridge-cross'` (긴) → `'bridge'` (짧) 전환 대상

| 위치 | 현재 | 변경 후 |
|------|------|---------|
| `socket/rooms.js:215` allowlist | `'bridge-cross'` | `'bridge'` |
| `socket/bridge-cross.js:215, 264` gameType 비교 | `'bridge-cross'` | `'bridge'` |
| `bridge-cross-multiplayer.html:993, 1100` joinRoom emit `gameType` | `'bridge-cross'` | `'bridge'` |
| `recordGamePlay(...)` 1번째 인자 (신규 호출) | — | `'bridge'` |
| `db/stats.js` DEFAULT_GAME_STATS 키 | (없음) | `'bridge'` |
| `routes/api.js` defaultGameStats 키 | (없음) | `'bridge'` |
| `db/ranking.js` 게임타입 매핑 | (없음) | `'bridge'` |
| `dice-game-multiplayer.html` 라디오 value / colorMap key / 방카드 분기 / redirect 분기 / localStorage key | (없음) | `'bridge'` 식별자 / `bridgeUserName` localStorage |
| `css/theme.css` CSS 변수 | (없음) | `--bridge-500`, `--bridge-500-rgb`, `--bridge-600`, `--game-type-bridge`, `--bridge-accent` (light/dark 양쪽) |
| `js/shared/tutorial-shared.js:10-16` FLAG_BITS | (없음) | `bridge: 32` |
| `js/shared/server-select-shared.js:822-825` localStorage 동기화 | (없음) | `bridgeUserName` 추가 |

**유지(긴 이름)**: 라우트, 파일명, 에셋 경로, 소켓 이벤트명, 내부 state 필드 `gameState.bridgeCross`, manifest 파일명, 폴더명.

---

## 2. 작업 범위 (4 Phase)

### Phase 1 — bridge-cross-multiplayer.html 재작성 + JS/CSS 분리

#### 1-1. horse-race-multiplayer.html을 base로 복사

| 라인 범위 (horse-race) | 복사 여부 | 비고 |
|------------------------|-----------|------|
| 1~253 | 복사 | head + 로딩 + controlBar + roomExpiry + users + ready + AdSense ad-lobby |
| 186~252 | 복사 | orders 자주쓰는메뉴 + gameStatus |
| 254~296 | **삭제 후 교체** | raceTrackWrapper → bridge-cross 게임 영역 |
| 298~349 | 복사 | chat + AdSense ad-game + history + result + password |
| 360~363 | **삭제** | horse-race 스크립트 4개 (horse-race.js, horse-race-charts.js 등) |
| 365~697 | 복사 | showCustomAlert + showCustomConfirm + 호스트 위임 + leaveRoom |
| 565, 685 | **수정** | horse-race.js 참조 주석 제거 |
| 710~745 | 복사 | SEO + footer (canonical/og:url은 `/bridge-cross`로 교체) |
| 749~933 | **삭제** | HORSE_RACE_TUTORIAL_STEPS (튜토리얼 보류 — Phase 5 작업) |
| 155~169 | **삭제 후 교체** | horseSelectionSection 탈것 선택 → bettingSection 마크업 |

#### 1-2. mockup base에서 이식 (현재 bridge-cross-multiplayer.html)

| 현재 라인 | 이식 대상 | 새 위치 |
|-----------|-----------|---------|
| 30~322 | CSS | **`css/bridge-cross.css`로 분리** (theme.css 변수 사용) |
| 649~663 | bettingSection 마크업 | horseSelectionSection 자리 (1-1의 155~169) |
| 693~776 | canvas + zoom-ui + debug-panel + ticker + ranking | raceTrackWrapper 자리 (1-1의 254~296) |
| 794~871 | 베팅 UI 함수 | inline `<script>` 또는 `js/bridge-cross.js` 상단 |
| 1024~1102 | Socket 이벤트 핸들러 | `js/bridge-cross.js` |
| 1104~2581 | 캔버스 게임 루프 (~1500줄) | **`js/bridge-cross.js`로 분리** |

#### 1-3. 새 파일 생성

| 파일 | 내용 |
|------|------|
| `js/bridge-cross.js` | 캔버스 게임 루프 + Socket 핸들러 + 베팅 함수 (현재 inline → 분리) |
| `css/bridge-cross.css` | bridge-cross 전용 CSS (현재 inline `<style>` → 분리). theme.css 변수 사용 |

#### 1-4. HTML 필수 구성 (new-game.md 가이드)

- Script 태그 4개 + `js/bridge-cross.js` 추가:
  ```html
  <script src="/js/shared/chat-shared.js"></script>
  <script src="/js/shared/ready-shared.js"></script>
  <script src="/js/shared/order-shared.js"></script>
  <script src="/assets/sounds/sound-manager.js"></script>
  <script src="/js/bridge-cross.js"></script>
  ```
- 필수 ID: `readySection`, `readyUsersList`, `readyCount`, `readyButton`, `chatMessages`, `chatInput`, `gameStatus` (horse-race base에서 자동 포함)
- `.user-tag` CSS는 bridge 테마색 — `css/bridge-cross.css`에 정의
- `roomJoined` 모듈 init 순서: ChatModule → ReadyModule → OrderModule → SoundManager (horse-race 동일)
- AdSense `ad-lobby` (1547-1556 dice 패턴) + `ad-game` (chat 위) 그대로 유지
- canonical/og:url을 `/bridge-cross`로 교체 (horse-race는 `/horse-race`)
- 페이지 진입 시 `?createRoom=true` / `?joinRoom=true` / `?room=<id>` 파라미터 처리 — horse-race-multiplayer.html의 `joinRoomOnLoad` 패턴 따라

### Phase 2 — dice-game 진입점 7곳 등록

| # | 위치 | 작업 |
|---|------|------|
| 1 | [dice-game-multiplayer.html:143-144](dice-game-multiplayer.html#L143-L144) | `.room-item.game-bridge { border-left-color: var(--bridge-500); }` 추가 |
| 2 | [dice-game-multiplayer.html:1638-1646](dice-game-multiplayer.html#L1638-L1646) | bridge 라디오 label 추가 — `<label id="bridgeLabel" ...><input type="radio" name="gameType" value="bridge" id="bridgeRadio" .../><span>🌉</span><span>다리 건너기</span></label>` (horse-race label 다음에 삽입) |
| 3 | [dice-game-multiplayer.html:1659](dice-game-multiplayer.html#L1659) | colorMap에 `'bridge': 'var(--game-type-bridge)'` 추가 |
| 4 | [dice-game-multiplayer.html:2786-2790](dice-game-multiplayer.html#L2786-L2790) | 방 카드 분기 — `else if (room.gameType === 'bridge') { gameTypeIcon='🌉'; gameTypeLabel='다리건너기'; gameTypeColor='var(--bridge-500)'; }` |
| 5 | [dice-game-multiplayer.html:2910-2933](dice-game-multiplayer.html#L2910-L2933) | `joinRoomDirectly` redirect 분기 — horse-race 패턴 그대로 (`location.href = '/bridge-cross?room=' + roomId` 등) |
| 6 | [dice-game-multiplayer.html:3806-3821](dice-game-multiplayer.html#L3806-L3821) | `finalizeRoomCreation` redirect 분기 — `gameType === 'bridge'` → `/bridge-cross?createRoom=true` |
| 7 | [dice-game-multiplayer.html:3886-3897](dice-game-multiplayer.html#L3886-L3897) | `joinSelectedRoom` redirect 분기 — `gameType === 'bridge'` → `/bridge-cross?joinRoom=true&room=<id>` |
| + | [dice-game-multiplayer.html:2897, 3774, 3859](dice-game-multiplayer.html#L2897) | `localStorage.setItem('bridgeUserName', userName)` 저장 (horse-race 패턴 동일 위치) |

#### 2-1. CSS 변수 — `css/theme.css` (light + dark 양쪽)

```css
/* light */
--bridge-500: #5B8DEF;            /* 메인 브랜드 색 (예시 — 시안 검토 필요) */
--bridge-500-rgb: 91, 141, 239;
--bridge-600: #3D6FC7;
--game-type-bridge: var(--bridge-500);
--bridge-accent: rgba(91, 141, 239, 0.15);

/* dark — 명도 보정 */
--bridge-500: #7BAEFF;
--bridge-500-rgb: 123, 174, 255;
--bridge-600: #5A8EE0;
--game-type-bridge: var(--bridge-500);
--bridge-accent: rgba(123, 174, 255, 0.2);
```

**메인 색 결정**: bridge-cross-multiplayer.html 1차 통합본의 `--bridge-cross-accent` / mockup의 메인 톤을 검토하여 일관 — Coder가 현재 mockup CSS에서 추출 후 적용. 결정 안 되면 `#5B8DEF` (블루 톤) 디폴트.

#### 2-2. tutorial-shared.js FLAG_BITS — `js/shared/tutorial-shared.js:10-16`

```javascript
const FLAG_BITS = {
    dice: 1,
    roulette: 2,
    'horse-race': 4,
    horse: 8,
    'crane-game': 16,
    bridge: 32        // 추가
};
```

(TUTORIAL_STEPS는 추가하지 않음 — Phase 5 작업)

#### 2-3. server-select-shared.js localStorage — `js/shared/server-select-shared.js:822-825`

```javascript
localStorage.setItem('userName', userName);
localStorage.setItem('horseRaceUserName', userName);
localStorage.setItem('craneGameUserName', userName);
localStorage.setItem('bridgeUserName', userName);  // 추가
```

### Phase 3 — DB 레이어

#### 3-1. `socket/bridge-cross.js` — recordGamePlay 호출 추가

`endGame` 함수 (line 129~) 끝 무렵에 horse.js:368 패턴 차용:

```javascript
const { recordGamePlay } = require('../db/stats');  // 상단 require 추가

// endGame 내부, gameEnd emit 후
const players = Object.keys(bc.userColorBets);
recordGamePlay('bridge', players.length, room.serverId || null);
```

추가로 line 215 / 264의 `room.gameType !== 'bridge-cross'` → `'bridge'`로 교체.

#### 3-2. `db/stats.js:43` DEFAULT_GAME_STATS — `'bridge'` 추가

```javascript
const DEFAULT_GAME_STATS = {
    dice: 0,
    roulette: 0,
    'horse-race': 0,
    'crane-game': 0,
    bridge: 0           // 추가
};
```

(crane-game은 이미 추가되어 있는지 확인 — 없으면 함께 추가)

#### 3-3. `routes/api.js:176` defaultGameStats — `'bridge'` 추가

`db/stats.js`와 동일한 키 셋. 통계 API 응답에서 0건이라도 키 존재하도록.

#### 3-4. `db/ranking.js` — bridge 매핑 추가

horse-race 매핑 패턴 (line 95, 285, 333) 따라 3곳 추가:
- 게임타입 → 한국어 라벨: `'bridge'` → `'다리 건너기'`
- 게임타입 → 아이콘: `'bridge'` → `'🌉'`
- 게임타입 → 색상: `'bridge'` → `'var(--bridge-500)'`

#### 3-5. `socket/rooms.js:215` gameType allowlist — `'bridge'`로 교체

```javascript
const validGameType = ['dice', 'roulette', 'horse-race', 'crane-game', 'bridge'].includes(gameType) ? gameType : 'dice';
```

#### 3-6. `socket/index.js` — 변경 없음

`registerBridgeCrossHandlers` import는 그대로. 핸들러 등록도 그대로. 단 socket/bridge-cross.js 내부에서 gameType 비교만 `'bridge'`로 변경했으니 별도 작업 없음.

### Phase 4 — 가이드 + 사운드 + impl 정리

#### 4-1. `assets/sounds/sound-config.json` — placeholder 키만

```json
"bridge-cross_betting_open": null,
"bridge-cross_countdown": null,
"bridge-cross_step": null,
"bridge-cross_safe": null,
"bridge-cross_crack": null,
"bridge-cross_break": null,
"bridge-cross_fall": null,
"bridge-cross_bgm": null,
"bridge-cross_result": null
```

(이미 1차 통합에서 추가되었으면 그대로. mp3는 다음 작업)

#### 4-2. `.claude/rules/new-game.md` 갱신

§3에 "horse-race-multiplayer.html을 base로 복제 후 게임 영역만 교체" 패턴 명시. 추가로 §2 등록 표에 누락 항목 보강:

| 추가 행 | 파일 | 할 일 |
|---------|------|-------|
| | `dice-game-multiplayer.html` | **로비 진입점 7곳** (라디오 / colorMap / 방카드 분기 / room-item CSS / joinRoomDirectly / finalizeRoomCreation / joinSelectedRoom) |
| | `db/stats.js DEFAULT_GAME_STATS` | 게임타입 키 추가 |
| | `routes/api.js defaultGameStats` | 게임타입 키 추가 |
| | `db/ranking.js` | 게임타입 매핑 (라벨/아이콘/색상) |
| | `socket/[game].js` | `recordGamePlay()` 호출 의무 |
| | `css/theme.css` | 게임 색상 변수 (light/dark) |
| | `js/shared/tutorial-shared.js` | FLAG_BITS 비트 할당 |
| | `js/shared/server-select-shared.js` | localStorage 키 동기화 |
| | `socket/rooms.js:215` | gameType allowlist 등록 |

명명 규칙 섹션 추가:
- **gameType 식별자**: 짧고 일관된 이름 (`'bridge'`, `'horse'` 등). DB game_type VARCHAR(20) 한도 내.
- **라우트/파일명/에셋**: 긴 형태 (`bridge-cross`, `horse-race`) 허용 — SEO/검색 노출 고려.
- **소켓 이벤트 namespace**: 라우트와 동일한 긴 이름 (`bridge-cross:*`).

#### 4-3. impl 문서 정리

본 작업 commit과 함께:
- `docs/meeting/impl/2026-04-27-bridge-cross-integration-impl.md` (1차)
- `docs/meeting/impl/2026-04-27-bridge-cross-rewrite-impl.md` (본 문서, 2차)

둘 다 `docs/meeting/applied/2026-04/bridge-cross/`로 이동 (PR #12 머지 시점에).

---

## 3. 불변조건 (must-preserve)

### Socket 이벤트명 (서버 emit 형태)
- `bridge-cross:bettingOpen` (deadline 단순 number 형태)
- `bridge-cross:select` (client → server)
- `bridge-cross:selectionConfirm` ({ colorIndex })
- `bridge-cross:selectionCount` ({ count })
- `bridge-cross:gameStart` (data 객체 — 1차 impl §0.5 deterministic 데이터)
- `bridge-cross:gameEnd` ({ winnerColor, winners, winnerColorName, ranking })
- `bridge-cross:gameAborted` ({ reason })
- `bridge-cross:error` (단순 문자열 메시지)
- `bridge-cross:start` (client → server)

### 서버 결정 규칙 (1차 impl §0.5 그대로)
- 통과자 K, safeRows, scenarios 모두 서버가 결정 — 클라이언트는 재생만
- 클라이언트 `Math.random()` 호출 0회 (시각 jitter는 외관 효과로 허용)

### 에셋 경로 (긴 이름 유지)
- `/assets/bridge-cross/sprites/*` (manifest 포함)
- `/assets/bridge-cross/stage/*`
- `/bridge-cross-sprites.manifest.json`

### 내부 state 필드 (긴 이름 유지)
- `gameState.bridgeCross.{userColorBets, phase, scenarios, K, safeRows, activeColors, isBridgeCrossActive, bridgeCrossHistory, bettingTimeout}`
- `utils/room-helpers.js:63-74`의 초기화 그대로

### main 브랜치 안전성
- main = 실서버 — PR #12 머지 전까지 main에 직접 push 금지
- 모든 변경은 `feat/bridge-cross-integration` 브랜치 누적 commit

---

## 4. Phase 별 검증

| Phase | 검증 |
|-------|------|
| 1 | `node -c bridge-cross-multiplayer.html` 불가 → Grep으로 horse-race 패턴 누락 확인 (showCustomAlert / readySection / chatMessages / gameStatus / leaveRoom). `js/bridge-cross.js` 분리 후 콘솔 에러 0 확인 (브라우저 진입). canonical/og:url `/bridge-cross` 확인. |
| 2 | `node -c dice-game-multiplayer.html` 불가 → Grep `'bridge'` 7곳 + localStorage `bridgeUserName` 3곳 + theme.css 변수 5종 + tutorial-shared FLAG_BITS + server-select-shared localStorage. 브라우저: dice 로비 → "+ 방 만들기" → 🌉 라디오 확인 → 방 생성 시 `/bridge-cross?createRoom=true`로 redirect 확인. |
| 3 | `node -c socket/bridge-cross.js` + `node -c socket/rooms.js` + `node -c db/stats.js` + `node -c routes/api.js` + `node -c db/ranking.js`. Grep `'bridge-cross'` (긴 이름) — gameType 식별자로 쓰이는 잔존 없는지 확인 (라우트/이벤트/에셋/state 필드 외). |
| 4 | new-game.md를 처음 보는 시각으로 읽고 누락 단계 없는지 확인. sound-config.json JSON 유효성 확인. |

### 통합 검증 (Phase 1~4 완료 후)

1. `node -c server.js` — 서버 문법
2. 브라우저 2탭 시나리오:
   - Tab A: dice 페이지 → 서버 선택 → 로비 → "+ 방 만들기" → 🌉 다리 건너기 선택 → 방 생성 → `/bridge-cross` redirect 확인 → ReadyModule + ChatModule + OrderModule 동작 확인
   - Tab B: 같은 서버 → 로비에서 방카드 클릭 (🌉 아이콘 + `다리건너기` 라벨 확인) → joinRoom redirect → bridge 페이지 진입 → 양쪽 채팅/준비 동기화
   - 양쪽 준비 → 호스트 게임 시작 → 베팅 → 게임 → 결과 → DB 통계 +1 확인 (`/api/stats`)
3. 다른 게임에서 돌아오기 동작 확인 (sessionStorage `returnToLobby` + localStorage `bridgeUserName`)
4. 모바일 1탭 화면 비율 확인 (canvas zoom + 베팅 UI 가독성)

---

## 5. 참조

- 1차 impl (게임 룰/서버 책임): `docs/meeting/impl/2026-04-27-bridge-cross-integration-impl.md`
- 핸드오프 정찰: `docs/etc/2026-04-27-bridge-cross-rewrite-handoff.md`
- horse-race base: `horse-race-multiplayer.html`
- 게임 영역 source: 현재 `bridge-cross-multiplayer.html`
- 가이드 (갱신 대상): `.claude/rules/new-game.md`
- PR: https://github.com/on1659/LAMDiceBot/pull/12
