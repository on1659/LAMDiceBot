# 디폴트 주문 시스템 — 구현 명세

> 작성 2026-05-15 · 상태: 구현 대기 · 트리아지 **COMPLEX** (DB + Socket + 공유모듈 + 게임 HTML 3개)

## 1. 목표

주문받기 시스템에 **사람별 디폴트 메뉴**를 추가한다. 단골 메뉴를 미리 저장해두면,
주문받기가 시작될 때 본인 디폴트가 **자동으로 주문 완료**까지 처리된다.

> 아이디어 1(랜덤 주문)은 이번 범위 제외 — 디폴트만 먼저 구현.

## 2. 확정 설계

| 항목 | 결정 |
|------|------|
| 단위 | 사람별 (`server_id` + `user_name`) |
| 저장 | PostgreSQL DB 테이블 `default_orders` |
| 키 | `room.serverId` (INTEGER) + `user_name` — `order_stats` 테이블과 동일 패턴 |
| 동작 범위 | **비공개 서버 전용** (`room.serverId` 존재 시에만). 자유/공개 방은 기능 비활성 |
| 설정 UI | 주문 입력칸 옆 `⭐ 디폴트` 버튼 — 현재 입력값을 디폴트로 저장, 같은 값이면 다시 눌러 해제 |
| 적용 시점 | 주문받기 시작 시(`startOrder` + `triggerAutoOrder`) 본인 디폴트가 있으면 자동 주문 완료 |

> DB 없는 환경: `frequent_menus`는 파일 fallback이 있지만, 사람별 디폴트는 파일 fallback **없음**.
> DB가 없으면 기능 전체가 no-op (버튼 비활성). 비공개 서버는 어차피 DB 전제.

## 3. 변경 파일 (6곳)

### 3-1. `db/init.js` — 테이블 추가

`order_stats` 블록 바로 뒤에 추가:

```sql
CREATE TABLE IF NOT EXISTS default_orders (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL,
    user_name VARCHAR(50) NOT NULL,
    menu_text VARCHAR(100) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_name)
);
CREATE INDEX IF NOT EXISTS idx_default_orders_server ON default_orders(server_id);
```

- `UNIQUE(server_id, user_name)` — 1인 1디폴트. upsert로 갱신.

### 3-2. `db/default-orders.js` — 신규 모듈

`db/ranking.js`의 `recordOrder` 패턴을 따른다.

```javascript
const { getPool } = require('./pool');

// 방 전체 디폴트 일괄 조회 → { [userName]: menuText }
async function getServerDefaultOrders(serverId) {
    const pool = getPool();
    if (!pool || !serverId) return {};
    try {
        const res = await pool.query(
            'SELECT user_name, menu_text FROM default_orders WHERE server_id = $1',
            [serverId]
        );
        const map = {};
        (res.rows || []).forEach(r => { map[r.user_name] = r.menu_text; });
        return map;
    } catch (e) {
        console.warn('default_orders 조회:', e.message);
        return {};
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

module.exports = { getServerDefaultOrders, setDefaultOrder, removeDefaultOrder };
```

### 3-3. `socket/shared.js` — 핸들러 + 적용 로직

**import 추가** (상단):
```javascript
const { getServerDefaultOrders, setDefaultOrder, removeDefaultOrder } = require('../db/default-orders');
```

**(a) `startOrder` 핸들러 — async화 + 디폴트 적용**

현재 `gameState.userOrders[u.name] = ''` 로 전부 비우는 부분을 디폴트 적용으로 교체:

```javascript
socket.on('startOrder', async () => {
    // ... 기존 rate limit / room / host 권한 검증 그대로 ...

    gameState.isOrderActive = true;
    gameState.userOrders = {};

    const defaults = room.serverId
        ? await getServerDefaultOrders(room.serverId)
        : {};
    gameState.users.forEach(u => {
        gameState.userOrders[u.name] = defaults[u.name] || '';
    });

    // 디폴트로 자동 주문된 건도 통계 기록
    if (room.serverId) {
        Object.entries(gameState.userOrders).forEach(([name, menu]) => {
            if (menu) recordOrder(room.serverId, name, menu);
        });
    }

    io.to(room.roomId).emit('orderStarted');
    io.to(room.roomId).emit('updateOrders', gameState.userOrders);
});
```

**(b) `triggerAutoOrder` — 동일하게 디폴트 적용**

`triggerAutoOrder`도 `gameState.userOrders[u.name] = ''` 패턴이라 동일 로직 필요.
**async 함수로 전환**해야 함 — `ctx.triggerAutoOrder` 호출부를 Grep으로 찾아 `await` 처리 확인 (게임 종료 핸들러들).

```javascript
async function triggerAutoOrder(gameState, room) {
    if (gameState.orderAutoTriggered || gameState.isOrderActive) return;
    gameState.orderAutoTriggered = true;
    gameState.isOrderActive = true;
    gameState.userOrders = {};

    const defaults = room.serverId
        ? await getServerDefaultOrders(room.serverId)
        : {};
    gameState.users.forEach(u => {
        gameState.userOrders[u.name] = defaults[u.name] || '';
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

> ⚠️ `triggerAutoOrder` async 전환 시 모든 호출부 영향. Grep `triggerAutoOrder` 로 게임 종료
> 핸들러(`socket/dice.js`, `socket/horse.js`, `socket/roulette.js` 등) 전부 확인 후 `await` 추가.
> fire-and-forget으로 둬도 동작은 하지만, 호출부에서 후속 emit 순서가 꼬일 수 있으니 await 권장.

**(c) 신규 핸들러 — 디폴트 설정 / 해제 / 조회**

```javascript
// 본인 디폴트 조회
socket.on('getDefaultOrder', async () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user) return;
    if (!room.serverId) { socket.emit('defaultOrderUpdated', null); return; }
    const defaults = await getServerDefaultOrders(room.serverId);
    socket.emit('defaultOrderUpdated', defaults[user.name] || null);
});

// 디폴트 설정
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
        socket.emit('defaultOrderUpdated', menu);
    } else {
        socket.emit('orderError', '디폴트 주문 저장에 실패했습니다!');
    }
});

// 디폴트 해제
socket.on('removeDefaultOrder', async () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user || !room.serverId) return;
    if (await removeDefaultOrder(room.serverId, user.name)) {
        socket.emit('defaultOrderUpdated', null);
    } else {
        socket.emit('orderError', '디폴트 주문 해제에 실패했습니다!');
    }
});
```

### 3-4. `js/shared/order-shared.js` — 클라이언트 모듈

**상태 추가** (모듈 상단):
```javascript
let _myDefaultOrder = null;   // 현재 본인 디폴트 메뉴 (없으면 null)
```

**소켓 이벤트 바인딩** (`bindSocketEvents` 내):
```javascript
_socket.on('defaultOrderUpdated', (menu) => {
    _myDefaultOrder = menu || null;
    updateDefaultButtonState();
});
```

`orderStarted` 핸들러 끝에 `updateDefaultButtonState()` 호출 추가 (입력칸 활성화 직후).

**신규 함수:**
```javascript
// 입력값 == 저장된 디폴트면 active(노랑), 아니면 비활성. 주문 비활성 시 disabled.
function updateDefaultButtonState() {
    const btn = document.getElementById('defaultOrderButton');
    const input = document.getElementById('myOrderInput');
    if (!btn || !input) return;
    btn.disabled = !_isOrderActive;
    const cur = input.value.trim();
    const isActive = _myDefaultOrder !== null && cur !== '' && cur === _myDefaultOrder;
    btn.classList.toggle('active', isActive);
}

// ⭐ 버튼 클릭: 현재 입력값 기준 toggle
function toggleDefaultOrder() {
    const input = document.getElementById('myOrderInput');
    if (!input) return;
    const cur = input.value.trim();
    if (cur !== '' && cur === _myDefaultOrder) {
        _socket.emit('removeDefaultOrder');                 // 같은 값 → 해제
    } else if (cur !== '') {
        _socket.emit('setDefaultOrder', { menu: cur });     // 새 값 → 저장
    } else if (_myDefaultOrder !== null) {
        _socket.emit('removeDefaultOrder');                 // 빈 입력 → 기존 디폴트 해제
    } else {
        showAlert('디폴트로 저장할 메뉴를 입력해주세요!', 'warning');
    }
}
```

`myOrderInput` 의 `input` 이벤트 리스너(`setupAutocomplete` 내)에 `updateDefaultButtonState()` 호출 1줄 추가 — 타이핑 중 버튼 상태 실시간 갱신.

`init()` 끝에 `_socket.emit('getDefaultOrder')` 추가 — 진입 시 본인 디폴트 로드.

**Public API 노출**: `toggleDefaultOrder` 추가.

### 3-5. 게임 HTML 3개 — `⭐ 디폴트` 버튼 추가

`dice-game-multiplayer.html`, `horse-race-multiplayer.html`, `roulette-game-multiplayer.html`
— 모두 `order-input-group` 안에 `orderSaveButton` 뒤로 버튼 1개 추가:

```html
<button onclick="OrderModule.toggleDefaultOrder()" id="defaultOrderButton"
        style="width: auto; padding: 12px 16px; height: fit-content;" disabled>⭐ 디폴트</button>
```

> 각 게임 HTML의 `order-input-group` 마크업이 미세하게 다를 수 있음 — Scout가 3파일 모두 확인.
> `.active` 상태 스타일(노란 배경 등)은 `order-shared.js`의 `injectStyles()`에 추가하거나
> 각 게임 CSS에 정의. 공유 모듈 일관성 위해 **`injectStyles()`에 추가** 권장:
> ```css
> #defaultOrderButton.active { background: #ffc107; color: #856404; }
> ```

### 3-6. `docs/GameGuide/02-shared-systems/ORDER-MODULE.md` — 문서 갱신

- 소켓 이벤트 표에 `getDefaultOrder` / `setDefaultOrder` / `removeDefaultOrder` (emit),
  `defaultOrderUpdated` (on) 추가
- Public API 표에 `toggleDefaultOrder` 추가
- 필수 HTML 요소에 `defaultOrderButton` 추가
- "디폴트 주문" 동작 설명 섹션 신설 (비공개 서버 전용, 주문 시작 시 자동 적용)

## 4. 불변조건 (must-preserve)

- 공정성 무관 (메뉴 주문은 게임 결과 아님) — `Math.random` 변경 없음
- `startOrder` / `triggerAutoOrder`의 기존 검증 로직(rate limit, host 권한, room 체크) 유지
- `updateOrder` 핸들러는 **건드리지 않음** — 디폴트 자동 적용 후에도 유저가 수동 수정 가능해야 함
- `userOrders` 표준 키 유지 — `order-shared.js` 외 게임별 HTML의 주문 렌더링에 영향 없음
- 비공개 서버 아닌 방(`room.serverId` 없음)에서 기존 주문 동작 100% 동일하게 유지

## 5. 검증 체크리스트

### 정적
- [ ] `node -c db/init.js db/default-orders.js socket/shared.js js/shared/order-shared.js`
- [ ] `triggerAutoOrder` 호출부 전부 Grep → `await` 처리 확인
- [ ] `db/init.js` 스키마와 `db/default-orders.js` 쿼리 컬럼명 일치 확인

### 브라우저 (로컬 5173, 비공개 서버 + 2탭)
- [ ] 주문받기 시작 → 입력칸 활성, `⭐ 디폴트` 버튼 활성
- [ ] 메뉴 입력 후 `⭐ 디폴트` 클릭 → 버튼 active(노랑), 새로고침해도 유지
- [ ] 같은 메뉴 입력 상태에서 `⭐ 디폴트` 다시 클릭 → 해제, 버튼 비활성
- [ ] 디폴트 설정한 유저가 있는 방에서 주문받기 재시작 → 해당 유저 주문칸 자동 채움 + 주문 목록에 즉시 표시
- [ ] 게임 종료 자동 주문(`triggerAutoOrder`) 경로에서도 디폴트 자동 적용 확인
- [ ] 디폴트 자동 주문 후 유저가 수동으로 다른 메뉴 저장 → 정상 덮어쓰기
- [ ] **자유/공개 방**(serverId 없음)에서 `⭐ 디폴트` 버튼 → 비활성 또는 안내, 기존 주문 동작 정상
- [ ] 크로스게임: dice / roulette / horse-race 3곳 모두 버튼 동작 확인

## 6. 미결 / 결정 포인트

- **디폴트 자동 주문도 `recordOrder` 통계 기록할지** — 본 명세는 "기록함"으로 작성 (자동도 실제 주문이므로 일관). 통계 왜곡 우려 시 제외 가능.
- **`.active` 버튼 스타일 위치** — `injectStyles()` 권장했으나 게임별 CSS 톤과 안 맞으면 게임 CSS로 이동.
