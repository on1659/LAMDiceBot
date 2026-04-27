# 새 게임 추가 절차

새 게임 추가 작업 시 읽을 것. 순서대로 진행.

> ⚠️ 2026-04-27 bridge-cross 재작성에서 빠뜨려 PR을 다시 작성한 항목들을 본 가이드에 반영했다. **§3, §6, §7을 절대 건너뛰지 말 것.**

## 1. 명명 규칙

| 사용처 | 형태 | 예시 |
|--------|------|------|
| **gameType 식별자** (DB game_type 컬럼, recordGamePlay 인자, allowlist, FLAG_BITS) | **짧은 이름** | `'dice'`, `'horse'`, `'bridge'` |
| **라우트 / 파일명 / 에셋 경로** | 긴 이름 (가독성) | `/bridge-cross`, `bridge-cross-multiplayer.html`, `/assets/bridge-cross/` |
| **Socket 이벤트 namespace** | 라우트와 동일한 긴 이름 | `bridge-cross:gameStart` |
| **내부 state 필드** (gameState 객체) | camelCase | `gameState.bridgeCross` |

DB `game_type` 컬럼은 VARCHAR(20) — 짧은 이름 권장.

## 2. 서버 파일 생성

```
socket/[game].js                ← 소켓 핸들러 (기존 dice.js / horse.js 패턴 참조)
[game]-multiplayer.html         ← 클라이언트 UI (긴 이름 가능)
js/[game].js                    ← 게임 로직 분리 (캔버스/복잡 로직 시)
css/[game].css                  ← 게임 전용 CSS
```

## 3. HTML 작성 — horse-race base 복제 패턴 (필수)

**❌ mockup을 base로 시작하지 말 것.** 공통 UX 시스템(자동준비/메뉴/방폭파/컨트롤바/비밀번호/AdSense lobby+game/결과오버레이/historySection/showCustomAlert/showCustomConfirm/leaveRoom/passwordModal/로딩화면)을 누락한다.

**✅ horse-race-multiplayer.html을 통째 복사 → 게임 영역만 교체:**
- horse-race 고유 부분(트랙/탈것선택/replay/horse-race.js 스크립트 4개)만 삭제
- 게임 영역(canvas / 베팅 UI / 게임별 마크업)만 mockup에서 이식
- canonical / og:url / title / description을 새 게임용으로 교체
- inline `<style>`은 `css/[game].css`로 분리
- 게임 로직 inline `<script>`는 `js/[game].js`로 분리

### Script 태그 (순서 중요)
```html
<script src="/js/shared/chat-shared.js"></script>
<script src="/js/shared/ready-shared.js"></script>
<script src="/js/shared/order-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
<script src="/js/[game].js"></script>
```

### 필수 HTML 요소 ID (horse-race base에서 자동 포함)
- ReadyModule: `readySection`, `readyUsersList`, `readyCount`, `readyButton`
- ChatModule: `chatMessages`, `chatInput`
- OrderModule: → `docs/GameGuide/02-shared-systems/ORDER-MODULE.md` 참조
- 공통: `gameStatus`
- ControlBar / passwordModal / historySection / resultOverlay / AdSense `ad-lobby`+`ad-game`

### CSS (.user-tag를 게임 테마 색상으로 정의)
```css
.user-tag { border: 2px solid var(--[game]-500); color: var(--[game]-500); }
.user-tag.host { background: var(--[game]-500); color: white; }
.user-tag.ready { background: #4CAF50; border-color: #4CAF50; color: white; }
```

### 모듈 초기화 순서 (roomJoined 내)
```javascript
socket.on('roomJoined', (data) => {
    currentUser = data.userName;
    isHost = data.isHost;
    ChatModule.init(socket, currentUser, { /* ... */ });   // 1. 채팅
    ReadyModule.init(socket, currentUser, { /* ... */ });  // 2. 준비
    OrderModule.init(socket, currentUser, { /* ... */ });  // 3. 주문
    SoundManager.loadConfig();                             // 4. 사운드
});
```

### URL 파라미터 처리 (다른 게임 통일 패턴)
```javascript
// horse-race-multiplayer.html joinRoomOnLoad 패턴 그대로
// ?createRoom=true   → 방 생성 후 자동 입장
// ?joinRoom=true&room=<id>  → 기존 방 입장
// ?room=<id>         → 직접 입장 (deep link)
```

### localStorage 키
`[game]UserName` 형식 (예: `bridgeUserName`, `horseRaceUserName`).

## 4. 등록 (서버 + 라우트)

| 파일 | 할 일 |
|------|-------|
| `socket/index.js` | `register[Game]Handlers` import + 호출 |
| `socket/rooms.js:215` | gameType allowlist에 짧은 이름 추가 |
| `routes/api.js` | 게임 페이지 라우트 추가 (`/[game]` → `[game]-multiplayer.html`) |
| `index.html` | 게임 링크 추가 |
| `assets/sounds/sound-config.json` | 사운드 키 추가 (`[game]_*` 형식, mp3 없으면 `""` placeholder) |

### Socket 핸들러 패턴
```javascript
socket.on('eventName', (data) => {
    if (!ctx.checkRateLimit()) return;
    const room = ctx.getCurrentRoom();
    if (!room) return;
    if (room.gameType !== '[short-name]') return;  // ← 짧은 이름 비교
    // 비즈니스 로직
    ctx.updateRoomsList(); // 방 상태 변경 시 필수
});
```

## 5. DB 기록 (필수 — 빠뜨리면 통계/랭킹 invisible)

### 5-1. `socket/[game].js` — recordGamePlay 호출
```javascript
const { recordGamePlay } = require('../db/stats');
// endGame 함수 끝 (gameEnd emit 후):
const players = Object.keys(gameState.[game].userColorBets); // 또는 게임별 참여자 키
recordGamePlay('[short-name]', players.length, room.serverId || null);
```

### 5-2. `db/stats.js:43` DEFAULT_GAME_STATS
```javascript
const DEFAULT_GAME_STATS = () => ({
    dice: { count: 0, totalParticipants: 0 },
    // ...
    [shortName]: { count: 0, totalParticipants: 0 }
});
```

### 5-3. `routes/api.js:176` defaultGameStats
같은 키 셋. 통계 API 응답에서 0건이라도 키 존재.

### 5-4. `db/ranking.js` 매핑 (랭킹 노출 시)
- `getMyRank` (line ~186) result 객체에 `[shortName]: {}` 추가 + horse 패턴 모방한 winsRow 블록 추가
- `getTop3Badges` (line ~328-334) 4곳에 추가 (return / gameTypes 배열 / result 객체 / 빈 객체 fallback)
- `getFullRanking` (line ~370) `getGameRanking(serverId, '[shortName]')` 호출 추가 + result 객체에 포함

## 6. dice-game-multiplayer.html 진입점 7곳 + localStorage 3곳 (필수)

dice-game이 모든 게임의 메인 로비 — bridge-cross 1차 통합에서 이 7곳을 빠뜨려 사용자가 방을 생성할 수 없었다. **반드시 모두 추가**:

| # | 위치 | 작업 |
|---|------|------|
| 1 | line ~143-144 | `.room-item.game-[short] { border-left-color: var(--[game]-500); }` 추가 |
| 2 | line ~1638-1646 | 게임 종류 라디오 라벨 (이모지 + 이름 + value="[short-name]") |
| 3 | line ~1659 colorMap | `'[short-name]': 'var(--game-type-[short])'` 추가 |
| 4 | line ~2786-2790 방카드 분기 | `else if (room.gameType === '[short]') { gameTypeIcon='X'; gameTypeLabel='X'; gameTypeColor='var(--[game]-500)'; }` |
| 5 | line ~2910-2933 joinRoomDirectly redirect | horse-race 패턴 따라 `/[game]?joinRoom=true&room=<id>` redirect |
| 6 | line ~3806-3821 finalizeRoomCreation redirect | `/[game]?createRoom=true` redirect |
| 7 | line ~3886-3897 joinSelectedRoom redirect | `/[game]?joinRoom=true&room=<id>` redirect |
| + | line ~2897, 3774, 3859 | redirect 직전에 `localStorage.setItem('[game]UserName', userName)` 3곳 |

## 7. 공유 모듈 등록 (필수 — 빠뜨리면 다른 게임에서 컨텍스트 끊김)

| 파일 | 할 일 |
|------|-------|
| `js/shared/tutorial-shared.js:10-16` | `FLAG_BITS`에 비트 할당 (다음 가용 비트, 32→64→128 순) |
| `js/shared/server-select-shared.js:822-826` | `_saveName` 함수에 `localStorage.setItem('[game]UserName', name)` 추가 |
| `css/theme.css` | 게임 색상 변수 light/dark 양쪽:<br>`--[game]-500`, `--[game]-500-rgb`, `--[game]-600`, `--[game]-accent`, `--game-type-[short]` |

## 8. 완료 체크리스트

### 서버 + 라우트
- [ ] `socket/[game].js` 생성, `socket/index.js` 등록
- [ ] `socket/rooms.js:215` allowlist 추가 (짧은 이름)
- [ ] `routes/api.js` 라우트 추가
- [ ] `index.html` 링크 추가
- [ ] `sound-config.json` 사운드 키 추가

### HTML (horse-race base 복제)
- [ ] `[game]-multiplayer.html` 생성 (horse-race 패턴 그대로)
- [ ] `js/[game].js` 생성 (게임 로직 분리)
- [ ] `css/[game].css` 생성 (테마 변수 사용)
- [ ] Script 태그 5개 (chat / ready / order / sound-manager / `[game].js`)
- [ ] 필수 HTML 요소 ID 배치
- [ ] `.user-tag` CSS 테마 색상
- [ ] `roomJoined`에서 모듈 init (Chat → Ready → Order → Sound 순)
- [ ] URL 파라미터 처리 (`?createRoom`, `?joinRoom`, `?room`)
- [ ] canonical / og:url 새 게임용으로 교체

### DB
- [ ] `socket/[game].js`에서 `recordGamePlay('[short]', ...)` 호출
- [ ] `db/stats.js DEFAULT_GAME_STATS`에 키 추가
- [ ] `routes/api.js defaultGameStats`에 키 추가
- [ ] `db/ranking.js` 3곳 (`getMyRank` / `getTop3Badges` / `getFullRanking`) 매핑 (랭킹 노출 시)

### dice-game 진입점 (필수 — 누락 시 사용자가 방 생성 불가)
- [ ] room-item CSS 1곳 (line ~143)
- [ ] 라디오 라벨 1곳 (line ~1638)
- [ ] colorMap 1곳 (line ~1659)
- [ ] 방카드 분기 1곳 (line ~2786)
- [ ] joinRoomDirectly redirect 1곳 (line ~2910)
- [ ] finalizeRoomCreation redirect 1곳 (line ~3806)
- [ ] joinSelectedRoom redirect 1곳 (line ~3886)
- [ ] localStorage `[game]UserName` 저장 3곳

### 공유 모듈
- [ ] `tutorial-shared.js FLAG_BITS` 비트 할당 (TUTORIAL_STEPS는 별도 작업)
- [ ] `server-select-shared.js _saveName` localStorage 추가
- [ ] `css/theme.css` light + dark 양쪽 변수 5종

### 검증
- [ ] `node -c server.js` + 모든 변경된 .js 파일
- [ ] dice 로비 → 라디오 노출 → 방 생성 → redirect → 게임 플레이 → DB 통계 +1 (브라우저 2탭 시나리오)
- [ ] 모바일 + 데스크톱 양쪽 화면 비율 확인

## 참고 문서

- 공유 모듈 시그니처: `docs/GameGuide/02-shared-systems/shared-modules.md`
- 주문 모듈 상세: `docs/GameGuide/02-shared-systems/ORDER-MODULE.md`
- 사운드 추가: `docs/GameGuide/02-shared-systems/SOUND-SYSTEM.md`
- 랭킹/통계 구조: `docs/GameGuide/02-shared-systems/ranking-and-stats.md`
- 사례: bridge-cross 통합 — `docs/meeting/applied/2026-04/bridge-cross/2026-04-27-bridge-cross-rewrite-impl.md`
