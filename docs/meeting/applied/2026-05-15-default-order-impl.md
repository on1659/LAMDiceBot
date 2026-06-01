# 디폴트 주문 시스템 — 구현 명세

> 작성 2026-05-15 · 갱신 2026-05-28 (Scout 보정 반영) · 상태: 구현 대기 · 트리아지 **COMPLEX**

## 1. 목표

주문받기 시스템에 **사람별 디폴트 메뉴**를 추가한다. 단골 메뉴를 미리 저장해두면,
주문받기가 시작될 때 본인 디폴트가 **자동으로 주문 완료**까지 처리된다.

> 아이디어 1(랜덤 주문)은 이번 범위 제외 — 디폴트만 먼저 구현.

## 2. 확정 설계

| 항목 | 결정 |
|------|------|
| 단위 | 사람별 (`server_id` + `user_name`) |
| 저장 | PostgreSQL DB 테이블 `default_orders` |
| 키 | `room.serverId` (INTEGER, nullable) + `user_name` — `order_stats` 동일 패턴 |
| 동작 범위 | **비공개 서버 전용** (`room.serverId` 존재 시에만) |
| 설정 UI | 주문 입력칸 옆 `⭐ 디폴트` 버튼 — 현재 입력값을 저장, 같은 값 재클릭 시 해제 |
| 적용 시점 | 주문받기 시작 시(`startOrder` + `triggerAutoOrder`) 본인 디폴트가 있으면 자동 주문 완료 |
| **구현 패턴** | **방 진입 시 본인 디폴트를 `gameState.userDefaultOrders` 캐시로 로드**. `startOrder` / `triggerAutoOrder`는 sync 유지하며 캐시만 읽어 사용 — async 전염 회피 |

## 3. 변경 파일 (7곳)

### 3-1. `db/init.js` — 테이블 추가

`order_stats` 정의 블록(252~264번 라인) **264번 라인 직후**에 추가.
들여쓰기 8 spaces. 기존 패턴대로 **CREATE TABLE과 CREATE INDEX를 각각 별도 `await pool.query()`로 분리**.

```javascript
await pool.query(`
    CREATE TABLE IF NOT EXISTS default_orders (
        id SERIAL PRIMARY KEY,
        server_id INTEGER NOT NULL,
        user_name VARCHAR(50) NOT NULL,
        menu_text VARCHAR(100) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(server_id, user_name)
    )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_default_orders_server ON default_orders(server_id)`);
```

### 3-2. `db/default-orders.js` — 신규 모듈

```javascript
const { getPool } = require('./pool');

// 단일 유저 디폴트 조회 (joinRoom 캐시 로드용)
async function getDefaultOrder(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId || !userName) return null;
    try {
        const res = await pool.query(
            'SELECT menu_text FROM default_orders WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return res.rows[0] ? res.rows[0].menu_text : null;
    } catch (e) {
        console.warn('default_orders 조회:', e.message);
        return null;
    }
}

async function setDefaultOrder(serverId, userName, menuText) {
    const pool = getPool();
    if (!pool || !serverId) return false;
    try {
        await pool.query(
            `INSERT INTO default_orders (server_id, user_name, menu_text, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (server_id, user_name)
             DO UPDATE SET menu_text = $3, updated_at = CURRENT_TIMESTAMP`,
            [serverId, userName, menuText]
        );
        return true;
    } catch (e) {
        console.warn('default_orders 저장:', e.message);
        return false;
    }
}

async function removeDefaultOrder(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId) return false;
    try {
        await pool.query(
            'DELETE FROM default_orders WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return true;
    } catch (e) {
        console.warn('default_orders 삭제:', e.message);
        return false;
    }
}

module.exports = { getDefaultOrder, setDefaultOrder, removeDefaultOrder };
```

### 3-3. `utils/room-helpers.js` — gameState에 캐시 필드 추가

`createRoomGameState()` 반환 객체에 1줄 추가 (`userOrders: {}` 근처):

```javascript
userDefaultOrders: {},   // { [userName]: menuText } — joinRoom 시 DB에서 로드된 디폴트 캐시 (비공개 서버 전용)
```

### 3-4. `socket/rooms.js` — joinRoom 시 디폴트 캐시 로드

joinRoom 핸들러에서 user를 `gameState.users` 배열에 push한 직후, `room.serverId`가 있으면 본인 디폴트를 1건 로드해서 캐시에 저장:

```javascript
// (user를 gameState.users에 push한 직후)
if (room.serverId) {
    try {
        const def = await getDefaultOrder(room.serverId, finalUserName);
        if (def) gameState.userDefaultOrders[finalUserName] = def;
    } catch (e) {
        console.warn('디폴트 주문 캐시 로드 실패:', e.message);
    }
}
```

상단 import 추가:
```javascript
const { getDefaultOrder } = require('../db/default-orders');
```

> joinRoom 핸들러가 이미 async라면 그대로 await. sync면 호출 함수만 async로 마킹 (joinRoom은 일반적으로 async; Coder가 확인).

### 3-5. `socket/shared.js` — 핸들러 + sync 적용 로직

**import 추가** (상단):
```javascript
const { setDefaultOrder, removeDefaultOrder } = require('../db/default-orders');
```

**(a) `startOrder` 핸들러 — sync 유지, 캐시만 사용**

현재 `gameState.userOrders[u.name] = ''` 부분을 캐시 기반으로 교체:

```javascript
gameState.isOrderActive = true;
gameState.userOrders = {};
gameState.users.forEach(u => {
    gameState.userOrders[u.name] = gameState.userDefaultOrders[u.name] || '';
});
if (room.serverId) {
    Object.entries(gameState.userOrders).forEach(([name, menu]) => {
        if (menu) recordOrder(room.serverId, name, menu);
    });
}
io.to(room.roomId).emit('orderStarted');
io.to(room.roomId).emit('updateOrders', gameState.userOrders);
```

**(b) `triggerAutoOrder` — sync 유지, 동일 로직**

```javascript
function triggerAutoOrder(gameState, room) {
    if (gameState.orderAutoTriggered || gameState.isOrderActive) return;
    gameState.orderAutoTriggered = true;
    gameState.isOrderActive = true;
    gameState.userOrders = {};
    gameState.users.forEach(u => {
        gameState.userOrders[u.name] = gameState.userDefaultOrders[u.name] || '';
    });
    if (room.serverId) {
        Object.entries(gameState.userOrders).forEach(([name, menu]) => {
            if (menu) recordOrder(room.serverId, name, menu);
        });
    }
    io.to(room.roomId).emit('orderStarted');
    io.to(room.roomId).emit('updateOrders', gameState.userOrders);
}
```

> **호출부 변경 없음**. 기존 9곳(`socket/dice.js:156,565` / `socket/horse.js:568,1098,1300` / `socket/rooms.js:1565` / `socket/roulette.js:121,445,486`) 그대로 sync 호출 유지.

**(c) 신규 핸들러 3개 — DB 저장 + 캐시 동기 갱신**

```javascript
// 본인 디폴트 조회 (캐시에서)
socket.on('getDefaultOrder', () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user) return;
    socket.emit('defaultOrderUpdated', gameState.userDefaultOrders[user.name] || null);
});

// 디폴트 설정 — DB 저장 + 캐시 갱신
socket.on('setDefaultOrder', async (data) => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user) return;
    if (!room.serverId) {
        socket.emit('orderError', '비공개 서버에서만 디폴트 주문을 사용할 수 있습니다!');
        return;
    }
    const menu = (data && typeof data.menu === 'string') ? data.menu.trim() : '';
    if (!menu) { socket.emit('orderError', '디폴트로 저장할 메뉴를 입력해주세요!'); return; }
    if (menu.length > 100) { socket.emit('orderError', '주문은 100자 이하로 입력해주세요!'); return; }
    if (await setDefaultOrder(room.serverId, user.name, menu)) {
        gameState.userDefaultOrders[user.name] = menu;
        socket.emit('defaultOrderUpdated', menu);
    } else {
        socket.emit('orderError', '디폴트 주문 저장에 실패했습니다!');
    }
});

// 디폴트 해제 — DB 삭제 + 캐시 제거
socket.on('removeDefaultOrder', async () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user || !room.serverId) return;
    if (await removeDefaultOrder(room.serverId, user.name)) {
        delete gameState.userDefaultOrders[user.name];
        socket.emit('defaultOrderUpdated', null);
    } else {
        socket.emit('orderError', '디폴트 주문 해제에 실패했습니다!');
    }
});
```

### 3-6. `js/shared/order-shared.js` — 클라이언트 모듈

**상태 추가** (모듈 상단 `_selectedSuggestionIndex` 근처):
```javascript
let _myDefaultOrder = null;
```

**소켓 이벤트 바인딩** (`bindSocketEvents` 내, 다른 핸들러 옆):
```javascript
_socket.on('defaultOrderUpdated', (menu) => {
    _myDefaultOrder = menu || null;
    updateDefaultButtonState();
});
```

`orderStarted` 핸들러 끝에 `updateDefaultButtonState();` 호출 1줄 추가 (입력 활성화 직후).
`orderEnded` 핸들러에도 동일하게 1줄 추가 (버튼 비활성화 반영).

**신규 함수:**
```javascript
function updateDefaultButtonState() {
    const btn = document.getElementById('defaultOrderButton');
    const input = document.getElementById('myOrderInput');
    if (!btn || !input) return;
    btn.disabled = !_isOrderActive;
    const cur = input.value.trim();
    const isActive = _myDefaultOrder !== null && cur !== '' && cur === _myDefaultOrder;
    btn.classList.toggle('active', isActive);
}

function toggleDefaultOrder() {
    const input = document.getElementById('myOrderInput');
    if (!input) return;
    const cur = input.value.trim();
    if (cur !== '' && cur === _myDefaultOrder) {
        _socket.emit('removeDefaultOrder');
    } else if (cur !== '') {
        _socket.emit('setDefaultOrder', { menu: cur });
    } else if (_myDefaultOrder !== null) {
        _socket.emit('removeDefaultOrder');
    } else {
        showAlert('디폴트로 저장할 메뉴를 입력해주세요!', 'warning');
    }
}
```

**기존 `setupAutocomplete()` 내 input 리스너에 1줄 추가** (별도 addEventListener 금지 — `_orderAutocompleteBound` 가드 보존):
```javascript
orderInput.addEventListener('input', () => {
    updateAutocompleteSuggestion();
    updateDefaultButtonState();   // ← 추가
});
```

**`init()` 끝**에 추가:
```javascript
_socket.emit('getDefaultOrder');
```

**`injectStyles()` 내 `<style>` 텍스트에 추가**:
```css
#defaultOrderButton.active { background: #ffc107; color: #856404; }
```

**Public API 노출**: `return { ... toggleDefaultOrder: toggleDefaultOrder, ... }`

### 3-7. 게임 HTML 4개 — `⭐ 디폴트` 버튼 + CSS Grid 수정

대상 (Scout 확인): `dice-game-multiplayer.html`, `horse-race-multiplayer.html`,
`roulette-game-multiplayer.html`, **`bridge-cross-multiplayer.html`**.

**(a) 버튼 추가** — 각 파일의 `orderSaveButton` `</button>` 바로 뒤에:

```html
<button onclick="OrderModule.toggleDefaultOrder()" id="defaultOrderButton"
        style="width: auto; padding: 12px 16px; height: fit-content; color: var(--text-primary); font-weight: 600;" disabled>⭐ 디폴트</button>
```

> horse-race / bridge-cross 의 `orderSaveButton`은 이미 `color: var(--text-primary); font-weight: 600;` 가 붙어있음. dice / roulette도 동일 톤으로 통일.

**(b) `.order-input-group` grid 컬럼 수정** — 각 파일의 inline `<style>` 안 `.order-input-group` 정의:

```css
/* 기존 */
.order-input-group {
    display: grid;
    grid-template-columns: 1fr auto;
}
/* 변경 */
.order-input-group {
    display: grid;
    grid-template-columns: 1fr auto auto;
}
```

> 정확한 라인: dice `:884`, roulette `:753`. horse-race / bridge-cross도 같은 정의 위치를 Coder가 직접 확인 (`.order-input-group` Grep).

### 3-8. `docs/GameGuide/02-shared-systems/ORDER-MODULE.md` — 문서 갱신

- "적용 현황" 표에 bridge-cross 추가
- 소켓 이벤트 표:
  - emit: `getDefaultOrder`, `setDefaultOrder` (`{menu}`), `removeDefaultOrder`
  - on: `defaultOrderUpdated` (menu | null)
- 필수 HTML 요소 표에 `defaultOrderButton` 추가
- Public API 표에 `toggleDefaultOrder` 추가
- "디폴트 주문" 동작 설명 섹션 신설 — 비공개 서버 전용, joinRoom 시 캐시 로드, 주문 시작 시 자동 적용

## 4. 불변조건 (must-preserve)

- 공정성 무관 — `Math.random` 신규 사용 0
- `startOrder` / `triggerAutoOrder` sync 유지 — async 전염 방지, emit 순서 보장
- `updateOrder` 핸들러는 변경 금지 — 디폴트 자동 주문 후에도 수동 수정 가능
- `userOrders` 표준 키 유지 — 게임별 HTML 주문 렌더링 영향 없음
- 비공개 서버 아닌 방(`room.serverId` null) 에서 기존 주문 동작 100% 동일
- `gameState.userDefaultOrders` 캐시는 **DB와 항상 동기** — set/remove 핸들러에서 DB 성공 시에만 캐시 갱신 (실패 시 캐시 미변경)
- `_orderAutocompleteBound` 가드 보존 — input 리스너는 1회 바인딩만

## 5. 검증 체크리스트

### 정적
- [ ] `node -c db/init.js db/default-orders.js socket/shared.js socket/rooms.js utils/room-helpers.js js/shared/order-shared.js`
- [ ] `triggerAutoOrder` 호출부 9곳 무변경 확인 (Grep)
- [ ] `Math.random` 신규 사용 0 (Grep `js/shared/order-shared.js`)
- [ ] `db/init.js` 스키마와 `db/default-orders.js` 쿼리 컬럼명 일치

### 브라우저 (로컬 5173, **비공개 서버 + 2탭 + 4게임 각각**)
- [ ] 주문받기 시작 → 입력 활성, `⭐ 디폴트` 버튼 활성
- [ ] 메뉴 입력 후 `⭐ 디폴트` 클릭 → 버튼 active(노랑), 새로고침 후에도 유지
- [ ] 같은 메뉴 입력 상태에서 `⭐ 디폴트` 다시 클릭 → 해제, 버튼 비활성
- [ ] 방 떠나기 → 다시 입장(joinRoom) → `getDefaultOrder` 응답이 캐시에서 즉시 반환
- [ ] 호스트가 주문받기 다시 시작 → 디폴트 설정한 유저들 주문칸 자동 채움 + 주문 목록 즉시 표시
- [ ] 게임 종료 자동 주문(`triggerAutoOrder`) 경로 — dice/roulette/horse-race 각각에서 디폴트 자동 적용 확인
- [ ] 자동 주문 후 유저가 수동으로 덮어쓰기 → 정상
- [ ] `.order-input-group` 레이아웃 — 디폴트 버튼이 저장 버튼 옆에 자연스럽게 정렬 (모바일 + PC)
- [ ] **자유/공개 방**(serverId null) → `⭐ 디폴트` 클릭 → "비공개 서버에서만…" 안내, 기존 주문 흐름 정상
- [ ] 4게임(dice / roulette / horse-race / bridge-cross) 모두 버튼 동작

## 6. 미결 / 결정 포인트

- **디폴트 자동 주문도 `recordOrder` 통계 기록 여부** — 본 명세는 "기록함". 자동 주문도 실제 주문이라 일관성 우선. 통계 왜곡(같은 메뉴 자동 트리거 후 호스트가 startOrder 또 누름 → 중복 카운트) 우려 시 제외 가능.
- **`.active` 버튼 스타일 색상** — `#ffc107`(노랑) 기본. 게임별 톤과 충돌 시 게임 CSS로 분리 가능.
