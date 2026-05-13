# /free 즉석 방 만들기 페이지 — Implementation Spec

> **추천 구현 모델**: Opus (다파일 연계, 신규 시스템 설계 판단 필요)
> **트리아지 등급**: COMPLEX (파일 10개+, Socket/REST 신규 핸들러, DB 스키마 추가)
> **참조 mockup**: [`prototype/free-mockup/index.html`](../../../prototype/free-mockup/index.html)

---

## 0. 컨셉 정의 (가장 중요)

**/free는 "방 만들기 페이지"다. "매칭" 페이지가 아니다.**

- `/free/{game}` 클릭 = 무조건 **새 방 생성** + shortcode 발급
- 다른 사람들은 **다이렉트 링크로만** 들어옴 (모르는 사람 자동 합류 X)
- 매칭 풀 / 매칭 로직 / `isJoinable()` 헬퍼 없음
- 기존 `dice-game-multiplayer.html` 로비는 변경 없이 공존

이 컨셉을 잘못 이해하면 매칭 풀 구현 / 동시성 가드 / 인원 카운터 등 불필요한 작업을 만든다. **방 만들기 + 링크 공유**가 본질.

---

## 1. 라우트

| URL | 동작 |
|-----|------|
| `GET /free` | 게임 선택 메뉴 페이지 (정적 HTML) |
| `GET /free/{game}` | 진입 시 즉시 `socket.emit('free:createRoom')` 호출 → ack에서 shortcode 받아 `/free/{game}/{shortcode}`로 클라이언트 redirect (history.replaceState로 URL 교체 후 게임 페이지로 redirect) |
| `GET /free/{game}/{shortcode}` | shortcode resolve → 유효하면 게임 페이지로 redirect, 만료면 `/free/{game}?expired=true` |
| `GET /api/free/resolve/:code` | shortcode → roomId 검증 REST endpoint (404 또는 200) |
| `POST /api/ad-impression` | 광고 노출 기록 |

`{game}` 허용 값: `dice` / `roulette` / `horse` / `bridge`

기존 게임 페이지 (`dice-game-multiplayer.html`, `horse-race-multiplayer.html` 등)는 그대로. /free → 게임 페이지 redirect 시 기존 `pending{Game}Join` localStorage 키를 재사용 → **게임 페이지 IIFE는 0줄 수정**.

---

## 2. 사용자 흐름

### 2-1. 방 만드는 사람 (A)

```
A: lamdice.kr/free 접속
   ↓ "주사위" 카드 클릭
   ↓
   localStorage('freeUserName') 있음?
      → 있음: 3초 카운트다운 토스트
         "이더(으)로 입장합니다  [3] [다른 이름]"
         키/마우스 입력 시 즉시 진행
      → 없음: 강한 모달
         "이름을 알려주세요"
         [____________] [매칭 시작 →]
   ↓
   Socket `free:createRoom` emit { gameType: 'dice', userName: '이더' }
   ↓
   서버 ack { roomId, shortcode: 'K7AB', isHost: true }
   ↓
   localStorage.setItem('pendingDiceJoin', JSON.stringify({ roomId, userName, isHost: true }))
   window.location.href = '/dice-game?joinRoom=true&from=free&shortcode=K7AB'
   ↓
   게임 페이지 IIFE가 평소대로 동작 → roomJoined
   ↓
   roomJoined 핸들러에서:
      if (urlParams.get('from') === 'free' && urlParams.get('shortcode')) {
        history.replaceState(null, '', `/free/dice/${shortcode}`);
      }
      // 자동 초대 토스트 4초 표시
      // 우상단 [🔗 초대] 버튼 노출
```

### 2-2. 초대받은 사람 (B)

```
B: A에게서 카톡으로 lamdice.kr/free/dice/K7AB 받음
   ↓ 클릭
   ↓
   서버: shortcode K7AB resolve
      → 유효: roomId 찾음 → 클라이언트가 같은 흐름으로 처리
      → 만료: /free/dice?expired=true 로 302
   ↓
   유효 시:
      이름 처리 (A와 동일 흐름)
      ↓
      Socket emit `joinRoom` { roomId, userName, isHost: false, ... }
      ↓
      게임 페이지로 redirect
      ↓
      방 합류, URL replaceState 동일 적용
```

### 2-3. 만료된 링크 (B의 다른 케이스)

```
B 클릭: lamdice.kr/free/dice/K7AB
   ↓
   서버: shortcode 없음 (방 사라짐)
   ↓
   302 → /free/dice?expired=true
   ↓
   /free 메인 페이지가 expired=true 쿼리 감지 → 모달 표시
      ┌────────────────────────┐
      │       ⏰              │
      │  이 방은 끝났어요      │
      │  친구가 새 방을        │
      │  만들었거나 방이       │
      │  비어서 사라졌어요     │
      │                       │
      │  [메인으로] [새 방]    │
      └────────────────────────┘
   ↓ "새 방" 클릭
   /free/dice 진행 (이름 처리 → 방 생성)
```

---

## 3. 백엔드 구현

### 3-1. shortcode 시스템

**utils/shortcode.js (신규)**

```javascript
// 혼동 문자 OI01 제외
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32자
const DEFAULT_LENGTH = 4;
const MAX_RETRY = 10;
const FALLBACK_LENGTH = 5;

const shortcodeIndex = {};  // 'K7AB' → roomId

function generateShortcode(length = DEFAULT_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

function issueShortcode(roomId) {
  for (let i = 0; i < MAX_RETRY; i++) {
    const code = generateShortcode(DEFAULT_LENGTH);
    if (!shortcodeIndex[code]) {
      shortcodeIndex[code] = roomId;
      return code;
    }
  }
  // 4자 실패 시 5자로 fallback
  for (let i = 0; i < MAX_RETRY; i++) {
    const code = generateShortcode(FALLBACK_LENGTH);
    if (!shortcodeIndex[code]) {
      shortcodeIndex[code] = roomId;
      return code;
    }
  }
  throw new Error('shortcode generation exhausted');
}

function resolveShortcode(code) {
  return shortcodeIndex[code] || null;
}

function releaseShortcode(code) {
  if (code) delete shortcodeIndex[code];
}

module.exports = { issueShortcode, resolveShortcode, releaseShortcode };
```

**불변조건**: `shortcodeIndex`는 모든 방 삭제 지점에서 cleanup 필수. `socket/rooms.js`에서 방 삭제 (host disconnect grace 종료 / 빈 방 expiry / leaveRoom 마지막 멤버)되는 모든 지점을 Scout가 정찰해서 `releaseShortcode(room.shortcode)` 호출 추가해야 함.

### 3-2. socket/free.js (신규)

```javascript
const { issueShortcode, releaseShortcode } = require('../utils/shortcode');
const { createRoomGameState } = require('../utils/room-helpers');
const { recordVisitor } = require('../utils/visitor');

const ALLOWED_GAME_TYPES = ['dice', 'roulette', 'horse-race', 'bridge-cross'];

// URL slug → gameType 매핑 (URL은 짧고 친화적으로)
const GAME_SLUG_MAP = {
  'dice': 'dice',
  'roulette': 'roulette',
  'horse': 'horse-race',
  'bridge': 'bridge-cross'
};

module.exports = (socket, io, ctx) => {
  const { rooms, updateRoomsList, checkRateLimit, generateRoomId } = ctx;

  socket.on('free:createRoom', (data, ack) => {
    if (!checkRateLimit()) return ack?.({ error: 'rate_limit' });

    const { gameType: gameSlug, userName } = data || {};
    const gameType = GAME_SLUG_MAP[gameSlug];
    if (!gameType || !ALLOWED_GAME_TYPES.includes(gameType)) {
      return ack?.({ error: 'invalid_game' });
    }
    if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
      return ack?.({ error: 'invalid_name' });
    }

    // ⚠️ 이 핸들러는 동기 함수로 유지. await 절대 금지 (race condition 차단).

    const roomId = generateRoomId();
    const shortcode = issueShortcode(roomId);
    const trimmedName = userName.trim().slice(0, 8);

    rooms[roomId] = {
      roomId,
      roomName: `${trimmedName}의 방`,
      gameType,
      hostName: trimmedName,
      hostId: null,  // joinRoom에서 채워짐
      isPrivate: false,
      password: '',
      serverId: null,
      shortcode,                    // ← 신규 필드
      origin: 'free',               // ← 신규 필드 (광고/통계 구분용)
      createdAt: new Date().toISOString(),
      expiryHours: 1,
      gameState: createRoomGameState(gameType)
    };

    recordVisitor(socket.clientIP, 'free:createRoom', socket.id);
    updateRoomsList();
    ack?.({ roomId, shortcode, gameType });
  });

  socket.on('disconnect', () => {
    // 방 cleanup은 socket/rooms.js의 기존 disconnect 로직이 처리.
    // 여기서는 추가 작업 없음.
  });
};
```

### 3-3. socket/rooms.js 수정 — shortcode cleanup 훅

방이 삭제되는 모든 지점에서 `releaseShortcode(room.shortcode)` 호출. **Scout 작업**: grep으로 `delete rooms[` 찾아 전부 추가.

알려진 지점 (참고용, Scout가 재확인 필수):
- host disconnect grace timeout 만료
- 빈 방 expiry (1시간)
- 마지막 멤버 leaveRoom

```javascript
// 예시 패턴
const { releaseShortcode } = require('../utils/shortcode');

function deleteRoom(roomId) {
  const room = rooms[roomId];
  if (room?.shortcode) releaseShortcode(room.shortcode);
  delete rooms[roomId];
}
```

### 3-4. routes/api.js 수정

```javascript
// 신규: /free 정적 페이지
router.get('/free', (req, res) => res.sendFile(path.join(__dirname, '../free.html')));

// 신규: /free/{game} — 클라이언트가 socket 거쳐 방 생성하므로 그냥 /free.html 서빙 (쿼리로 진입 게임 구분)
router.get('/free/:game', (req, res) => {
  const { game } = req.params;
  if (!['dice', 'roulette', 'horse', 'bridge'].includes(game)) {
    return res.redirect('/free');
  }
  res.sendFile(path.join(__dirname, '../free.html'));
});

// 신규: /free/{game}/{shortcode} — shortcode resolve 후 게임 페이지로 redirect
router.get('/free/:game/:shortcode', async (req, res) => {
  const { game, shortcode } = req.params;
  if (!shortcode || !/^[A-Z0-9]{4,5}$/.test(shortcode)) {
    return res.redirect(`/free/${game}?expired=true`);
  }
  const { resolveShortcode } = require('../utils/shortcode');
  const roomId = resolveShortcode(shortcode);
  if (!roomId) {
    return res.redirect(`/free/${game}?expired=true`);
  }
  // free.html이 진입 후 shortcode resolve API 호출하도록 그냥 /free.html 서빙
  // (페이지 로드 → 이름 처리 → socket emit joinRoom 흐름 일관성)
  res.sendFile(path.join(__dirname, '../free.html'));
});

// 신규: shortcode resolve REST (free.html이 호출)
router.get('/api/free/resolve/:code', (req, res) => {
  const { resolveShortcode } = require('../utils/shortcode');
  const { code } = req.params;
  if (!code || !/^[A-Z0-9]{4,5}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });

  const rooms = req.app.get('rooms') || {};
  const roomId = resolveShortcode(code);
  if (!roomId || !rooms[roomId]) return res.status(404).json({ error: 'expired' });

  const room = rooms[roomId];
  res.json({
    roomId,
    gameType: room.gameType,
    hostName: room.hostName,
    isGameActive: !!(room.gameState?.isGameActive || room.gameState?.isHorseRaceActive ||
                     (room.gameState?.bridgeCross?.phase && room.gameState.bridgeCross.phase !== 'waiting'))
  });
});

// 신규: 광고 노출 기록
router.post('/api/ad-impression', async (req, res) => {
  const { recordAdImpression } = require('../db/ad-impression');
  const { gameType, page, origin } = req.body || {};
  if (!gameType || !page) return res.status(400).json({ error: 'invalid' });
  await recordAdImpression({ gameType, page, origin, ip: req.ip });
  res.json({ ok: true });
});
```

⚠️ **rate limit**: `/free/:game/:shortcode` 진입에 **IP당 분당 30회** rate limit 적용 (shortcode 무차별 대입 방지). `express-rate-limit`로 별도 limiter 인스턴스 추가.

### 3-5. db/ad-impression.js (신규)

```javascript
const { getPool } = require('./pool');

async function recordAdImpression({ gameType, page, origin, ip }) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO ad_impression (game_type, page, origin, ip, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [gameType, page, origin || null, ip || null]
  ).catch(e => console.warn('ad_impression insert:', e.message));
}

module.exports = { recordAdImpression };
```

### 3-6. db/init.js 추가

```sql
CREATE TABLE IF NOT EXISTS ad_impression (
  id BIGSERIAL PRIMARY KEY,
  game_type VARCHAR(32),
  page VARCHAR(64),
  origin VARCHAR(16),   -- 'free' / 'lobby' / 'server'
  ip VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_impression_created ON ad_impression(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_impression_origin_game ON ad_impression(origin, game_type);
```

### 3-7. socket/index.js 등록

```javascript
require('./free')(socket, io, ctx);
```

`ctx`에 `generateRoomId` 헬퍼가 이미 있는지 확인. 없으면 `socket/rooms.js`의 기존 방 생성 로직에서 ID 생성 부분을 함수로 분리해 ctx에 넣기.

---

## 4. 프론트엔드 구현

### 4-1. 파일 구조

**신규**
- `free.html` (단일 페이지, 정적)
- `js/free.js` (진입 IIFE + 카드 클릭 + 이름 처리 + Socket emit)
- `css/free.css` (그리드, 카드, 모달, 토스트)

**수정**
- 게임 페이지 4개 (`dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `bridge-cross-multiplayer.html`): 각각 **약 3줄 추가** — `roomJoined` 핸들러 안에서 `from=free` 쿼리 감지 시 `history.replaceState`로 URL 교체 + 자동 초대 토스트 표시 + 우상단 [🔗 초대] 버튼 노출
- 또는 공유 모듈 `js/shared/free-invite.js` 신규 → 게임 페이지 4개가 동일하게 init 호출 (이 방향 권장 — DRY)

### 4-2. /free.html 구조

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>친구랑 같이 놀기 - LAMDice</title>
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/free.css">
  <link rel="stylesheet" href="/css/ranking.css">  <!-- RankingModule 의존 -->
  <!-- AdSense, FOUC 방지 스크립트는 기존 페이지와 동일 -->
</head>
<body>
  <main class="free-main">
    <h1>친구랑 같이 놀기</h1>
    <p class="subtitle">게임을 고르면 방이 생겨요. 링크로 친구를 초대하세요</p>

    <div class="game-grid">
      <button class="game-card" data-game="dice">...</button>
      <button class="game-card" data-game="roulette">...</button>
      <button class="game-card" data-game="horse">...</button>
      <button class="game-card" data-game="bridge">...</button>
    </div>

    <button class="ranking-cta" onclick="RankingModule.show()">🏆 자유 랭킹 보기</button>
  </main>

  <!-- 이름 모달 (강한) -->
  <div id="nameModal" class="modal-backdrop hidden">...</div>

  <!-- 이름 토스트 (재방문 카운트다운) -->
  <div id="nameToast" class="name-toast hidden">...</div>

  <!-- 만료 모달 -->
  <div id="expiredModal" class="modal-backdrop hidden">...</div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/js/shared/ranking-shared.js"></script>
  <script src="/js/free.js"></script>
</body>
</html>
```

### 4-3. /js/free.js 구조

```javascript
(function() {
  const socket = io({ autoConnect: false });
  const urlParams = new URLSearchParams(window.location.search);
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // /free → ['free']
  // /free/dice → ['free', 'dice']
  // /free/dice/K7AB → ['free', 'dice', 'K7AB']

  const gameFromPath = pathParts[1] || null;
  const shortcodeFromPath = pathParts[2] || null;
  const isExpired = urlParams.get('expired') === 'true';

  // 1. expired 쿼리 처리 (만료 모달)
  if (isExpired) {
    showExpiredModal(gameFromPath);
  }

  // 2. shortcode 있으면 resolve → 합류 모드
  if (shortcodeFromPath) {
    handleDirectLinkEntry(gameFromPath, shortcodeFromPath);
    return;
  }

  // 3. /free/{game} 진입 → 자동으로 방 만들기 흐름
  if (gameFromPath) {
    handleAutoCreateRoom(gameFromPath);
    return;
  }

  // 4. /free 메인 — 카드 클릭 대기
  initMainPage();

  // ─── 자유 랭킹 모달 ───
  if (typeof RankingModule !== 'undefined') {
    RankingModule.init(null, getStoredUserName() || null);  // serverId=null로 자유 랭킹
  }

  // ─── 광고 노출 ping (페이지 진입 시 1회) ───
  fetch('/api/ad-impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameType: gameFromPath || 'menu', page: '/free', origin: 'free' })
  }).catch(() => {});
})();

function initMainPage() {
  document.querySelector('.game-grid').addEventListener('click', e => {
    const card = e.target.closest('.game-card[data-game]');
    if (!card) return;
    const game = card.dataset.game;
    handleAutoCreateRoom(game);
  });
}

function handleAutoCreateRoom(game) {
  ensureUserName().then(userName => {
    socket.connect();
    socket.emit('free:createRoom', { gameType: game, userName }, ack => {
      if (ack.error) return showErrorToast(ack.error);
      const { roomId, shortcode, gameType } = ack;
      // 게임 페이지 진입 흐름과 동일하게 pending key 세팅
      const pendingKey = getPendingKeyFor(gameType);  // 'pendingDiceJoin' 등
      localStorage.setItem(pendingKey, JSON.stringify({ roomId, userName, isHost: true }));
      const gamePath = getGamePathFor(gameType);     // '/dice-game' 등
      window.location.href = `${gamePath}?joinRoom=true&from=free&shortcode=${shortcode}`;
    });
  });
}

function handleDirectLinkEntry(game, shortcode) {
  fetch(`/api/free/resolve/${shortcode}`)
    .then(r => r.json().then(j => ({ ok: r.ok, ...j })))
    .then(result => {
      if (!result.ok) {
        // 만료
        window.location.replace(`/free/${game}?expired=true`);
        return;
      }
      ensureUserName().then(userName => {
        const pendingKey = getPendingKeyFor(result.gameType);
        localStorage.setItem(pendingKey, JSON.stringify({
          roomId: result.roomId,
          userName,
          isHost: false
        }));
        const gamePath = getGamePathFor(result.gameType);
        window.location.href = `${gamePath}?joinRoom=true&from=free&shortcode=${shortcode}`;
      });
    });
}

// ensureUserName: localStorage 있으면 카운트다운 토스트, 없으면 강한 모달
// 입력값 검증 (1~8자, escapeHtml 필수)
function ensureUserName() { /* ... */ }
```

### 4-4. 게임 페이지 진입 IIFE — 공유 모듈로 분리 권장

**js/shared/free-invite.js (신규)**

```javascript
(function () {
  function initFreeInvite() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('from') !== 'free') return;

    const shortcode = urlParams.get('shortcode');
    if (!shortcode || !/^[A-Z0-9]{4,5}$/.test(shortcode)) return;

    // 게임 페이지 종류별로 다르므로 path 기반으로 game 추론
    const pathToGame = {
      '/dice-game': 'dice',
      '/roulette-game': 'roulette',
      '/horse-race': 'horse',
      '/bridge-cross': 'bridge'
    };
    const gameSlug = Object.entries(pathToGame).find(([p]) => window.location.pathname.startsWith(p))?.[1];
    if (!gameSlug) return;

    // 1. URL 자동 교체
    history.replaceState(null, '', `/free/${gameSlug}/${shortcode}`);

    // 2. 자동 초대 토스트 (4초 후 자동 닫힘)
    showInviteToast(shortcode, gameSlug);

    // 3. 우상단 [🔗 초대] 버튼 노출
    mountInviteButton(shortcode, gameSlug);
  }

  function showInviteToast(shortcode, gameSlug) { /* ... */ }
  function mountInviteButton(shortcode, gameSlug) { /* ... */ }
  function openShareSheet(shortcode, gameSlug) {
    const url = `https://lamdice.kr/free/${gameSlug}/${shortcode}`;
    if (navigator.share) {
      navigator.share({ title: 'LAMDice 같이 놀기', url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => showToast('URL이 복사되었어요'));
    }
  }

  // roomJoined가 발생한 후에 실행되어야 하므로 socket 인스턴스를 외부에서 받거나
  // window load 이후 충분히 지연 후 실행
  window.initFreeInvite = initFreeInvite;
})();
```

게임 페이지 4개에 `<script src="/js/shared/free-invite.js"></script>` 추가 + `roomJoined` 핸들러 마지막에 `if (window.initFreeInvite) window.initFreeInvite();` 1줄 추가.

**기존 진입 IIFE는 변경 없음.**

### 4-5. CSS — css/free.css

mockup [`prototype/free-mockup/index.html`](../../../prototype/free-mockup/index.html)의 CSS를 거의 그대로 옮김. 단:

- `:root` 색상 토큰 정의 제거 (theme.css 재사용)
- 게임별 그라데이션 `--horse-gradient` 등이 theme.css에 없으면 추가 필요. 현재 `--dice-gradient` `--bridge-gradient` 정도만 있음 → `--roulette-gradient`, `--horse-gradient` 추가 → 라이트/다크 양쪽
- 다크모드: `[data-theme="dark"]`는 LAMDice 프로젝트의 다크모드 토글 메커니즘과 일치시킴 (현재 프로젝트 컨벤션 Scout 정찰 필수)
- horse-race.css 의존성: /free는 .container .users-section 같은 공통 레이아웃 안 씀 → **horse-race.css link 불필요** (페이지 별도 라우트라 OK)

---

## 5. 보안 / 안정성

| 항목 | 처리 |
|------|------|
| shortcode 무차별 대입 | `/free/:game/:shortcode` 진입 IP당 분당 30회 rate limit (express-rate-limit) |
| shortcode 충돌 | retry 10회 → 5자 확장 fallback |
| shortcode 메모리 누수 | 방 삭제 모든 지점에 `releaseShortcode` 호출 (Scout 정찰 필수) |
| 이름 입력 XSS | 서버에서 trim + 8자 슬라이스. 클라이언트는 textContent / escapeHtml |
| socket 핸들러 race | `free:createRoom` 핸들러 동기 함수 유지, await 절대 금지 |
| 다이렉트 링크 만료 안내 | 클라이언트 모달 ("이 방은 끝났어요. 새 방?") |
| 광고 노출 측정 boundary | `origin: 'free'` 필드로 lobby/server와 구분 |

---

## 6. 자유 랭킹

**변경 없음.** 기존 `recordServerGame(room.serverId || null, ...)` 호출이 자유 플레이를 `server_id IS NULL`로 저장 → /free에서 만든 방도 동일 동작.

`/free` 메인의 🏆 버튼은 `RankingModule.show()` 호출 — `ranking-shared.js` 의존만 추가하면 끝.

---

## 7. QA P0 시나리오

| ID | 시나리오 | 합격 기준 |
|----|----------|----------|
| P0-1 | 4종 게임 모두 `/free/{game}` 진입 → 방 생성 → 게임 페이지 redirect 정상 | 4종 모두 방 입장 성공, URL이 `/free/{game}/{shortcode}`로 교체됨 |
| P0-2 | 다이렉트 링크 → 다른 사용자가 합류 | 같은 roomId 합류, 양쪽 유저 목록에 둘 다 보임 |
| P0-3 | 다이렉트 링크 만료 (방이 사라진 후 클릭) | `?expired=true` redirect + 모달 표시 + [새 방] 동작 |
| P0-4 | shortcode rate limit | 동일 IP에서 31회 진입 시 31번째부터 429 |
| P0-5 | 기존 dice 로비 → 4게임 진입 회귀 | 변경 없이 동일 동작 |
| P0-6 | 방 삭제 시 shortcode 해제 | host disconnect grace 종료 후 같은 shortcode로 진입 시 expired |
| P0-7 | 자유 랭킹 통계 | /free 100회 + 기존 자유플레이 100회 → server_game_records에 server_id IS NULL로 200건 |
| P0-8 | 이름 모달 — 신규 vs 재방문 | localStorage 비우면 강한 모달, 채워두면 3초 카운트다운 토스트 |
| P0-9 | URL 자동 교체 | `from=free&shortcode=K7AB`로 진입 시 history.replaceState로 `/free/dice/K7AB` 교체. 새로고침 시 같은 방 재입장 |
| P0-10 | 광고 노출 측정 | `/free` 진입 시 `ad_impression` 1행 insert, origin='free' |

**P1 (출시 후 24h 내)**
- 게임 진행 중 다이렉트 링크 진입 — 토스트 안내 + 다음 판 대기
- 모바일 매칭 카드 펄스 모션
- 다크모드 contrast (WCAG AA)
- 호스트 disconnect grace 중 다이렉트 링크 클릭 — 정상 합류 (방이 grace 중이라 살아있음)

---

## 8. 회귀 리스크 매트릭스

| 기존 기능 | 영향 | 등급 |
|-----------|------|------|
| dice 로비 → 4게임 진입 | `pending{Game}Join` 키 재사용, 변경 없음 | LOW |
| 게임 페이지 4개 진입 IIFE | 변경 없음 (free-invite는 roomJoined 이후 별도 init) | LOW |
| 자유 랭킹 (recordServerGame) | 변경 없음, serverId=null 그대로 처리 | LOW |
| 호스트 disconnect grace | shortcode 해제 타이밍 추가 | MEDIUM |
| 비번방 / 진행중 방 노출 | /free 방은 항상 isPrivate=false, password='' | LOW |
| 새로고침 재입장 sessionStorage | URL이 `/free/...`로 바뀐 후 새로고침 시 동작 검증 필요 | MEDIUM |
| 광고 게재 | 신규 ad_impression POST 추가 — 기존 AdSense 동작 영향 0 | LOW |

---

## 9. 영향 파일 목록

### 신규 (8개)
- `free.html`
- `js/free.js`
- `js/shared/free-invite.js`
- `css/free.css`
- `socket/free.js`
- `utils/shortcode.js`
- `db/ad-impression.js`
- `prototype/free-mockup/index.html` (이미 생성됨, 디자인 참조용)

### 수정 (10개)
- `routes/api.js` — `/free` `/free/:game` `/free/:game/:shortcode` `/api/free/resolve/:code` `/api/ad-impression` 라우트 + shortcode rate limiter
- `socket/index.js` — `require('./free')(socket, io, ctx)` 등록
- `socket/rooms.js` — 방 삭제 모든 지점에 `releaseShortcode` 호출
- `utils/room-helpers.js` — `generateRoomId` 분리 (필요 시), `createRoomGameState` 변경 없음
- `db/init.js` — `ad_impression` 테이블 + 인덱스 추가
- `css/theme.css` — `--roulette-gradient`, `--horse-gradient` 라이트/다크 추가
- `dice-game-multiplayer.html` — `<script src="/js/shared/free-invite.js"></script>` + `roomJoined` 끝에 `initFreeInvite()` 호출
- `roulette-game-multiplayer.html` — 동일
- `horse-race-multiplayer.html` — 동일
- `bridge-cross-multiplayer.html` — 동일

---

## 10. 예상 공수

| 영역 | 공수 |
|------|------|
| `utils/shortcode.js` + 단위 테스트 | 0.5d |
| `socket/free.js` + `socket/index.js` 등록 | 0.5d |
| `socket/rooms.js` shortcode cleanup 훅 (모든 삭제 지점 정찰 후 추가) | 1d |
| `routes/api.js` 라우트 5종 + rate limiter | 0.5d |
| `db/ad-impression.js` + `db/init.js` 스키마 | 0.5d |
| `free.html` + `js/free.js` + `css/free.css` (mockup 참조) | 1.5d |
| `js/shared/free-invite.js` (URL 교체 + 토스트 + 시트) | 1d |
| 게임 페이지 4개 free-invite 통합 | 0.5d |
| `css/theme.css` 그라데이션 추가 | 0.3d |
| QA P0 시나리오 (Playwright 멀티탭 포함) | 1.5d |
| 모바일/다크모드 회귀 | 0.5d |
| 합계 | **약 8~10일** |

---

## 11. 롤백 플랜

환경변수 `FREE_ROUTE_ENABLED=false`로 `routes/api.js`의 라우트들을 비활성화하여 즉시 차단. shortcode 발급 차단 → 새 방 생성 불가, 기존 활성 방은 자연 소멸 (1시간 후 expiry).

```javascript
// routes/api.js 시작 부분
const FREE_ENABLED = process.env.FREE_ROUTE_ENABLED !== 'false';

router.get('/free', (req, res) => {
  if (!FREE_ENABLED) return res.redirect('/');
  res.sendFile(...);
});
// 다른 /free/* 라우트도 동일
```

---

## 12. 출시 후 KPI

소연(비즈니스) 제안 KPI를 4주 측정:

- `/free` 진입 → 방 생성 → 게임 1판 완료 전환율 (목표 60%+)
- /free 방의 평균 참여 인원 수 (목표 2.5명+ — 친구 초대 효과)
- 다이렉트 링크 클릭률 (생성된 shortcode 중 실제 클릭된 비율)
- /free 진입 후 7일 리텐션 vs 기존 자유 플레이 비교
- `ad_impression` origin='free' 비율 — 광고 노출 카니발리제이션 확인

---

## 13. Scout 정찰 우선순위

이 impl을 Scout에 넘길 때 우선 정찰할 사항:

1. **`socket/rooms.js`의 방 삭제 지점 전수 조사** — `delete rooms[`, `rooms[id] = null`, grace timeout 만료, 빈 방 expiry 모든 지점. shortcode cleanup 훅 추가 위치 매핑
2. **`utils/room-helpers.js`의 방 생성 헬퍼** — `createRoomGameState`, room id 생성 로직 확인. ctx에 노출돼 있는지
3. **기존 다크모드 토글 메커니즘** — `data-theme` 속성인지 클래스인지 / 어디 저장하는지
4. **`pending{Game}Join` 키 정확한 이름** — 4종 게임 페이지에서 사용하는 정확한 key 이름과 데이터 구조 (dice / horse / roulette / bridge-cross 각각)
5. **`/dice-game` 등 게임 페이지의 정확한 URL** — `routes/api.js`에 정의된 path
6. **AdSense 스니펫 / FOUC 방지 스크립트** — 기존 페이지에서 어떻게 들어가는지, free.html에도 동일 패턴 적용
7. **rate limiter 패턴** — 현재 `routes/server.js` style 따라가기

---

## 14. 디자인 mockup 참조

[`prototype/free-mockup/index.html`](../../../prototype/free-mockup/index.html) — 단일 HTML에 8개 상태 (메인 / 이름 모달 / 이름 토스트 / 방 만드는 중 / 방 입장 직후 / 초대 시트 / 만료 fallback / 자유 랭킹) + PC/모바일 토글 + 라이트/다크 토글이 모두 포함됨. 좌측 컨트롤 패널은 mockup 전용이고 실제 `free.html`에는 없음.

mockup의 CSS 그대로 `css/free.css`로 옮기되 `:root` 색상 토큰 부분은 `theme.css` 의존으로 교체.
