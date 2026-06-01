# 디폴트 주문 UX 개편 + 랜덤 주문 — 구현 명세

> 작성 2026-05-28 · 상태: 구현 대기 · 트리아지 **COMPLEX**
> 선행: `applied/2026-05-15-default-order-impl.md` (디폴트 주문 1차 구현) 개편

## 1. 목표

3가지를 한 번에:
1. **디폴트 주문 UX 개편** — 입력칸 옆 `⭐ 디폴트` 토글 버튼 제거 → 주문 섹션 헤더 우측 **별(★) 아이콘**(크롬 북마크: 노랑=설정/회색=미설정) + 클릭 시 **모달 팝업**으로 관리.
2. **랜덤 주문 추가** — 모달에 `🎯 고정 메뉴 / 🎲 매번 랜덤` 모드 + `🎲 지금 한 번만 랜덤 채우기` 단발 버튼.
3. **자동 주문 가드 버그 수정** — 게임 시작 시 `orderAutoTriggered` reset 누락으로 두 번째 게임부터 자동 주문 안 됨.

mockup: `docs/meeting/mockup/2026-05-28-default-order-ux-mockup.html` (UX 기준).

## 2. 확정 설계

| 항목 | 결정 |
|------|------|
| 별 아이콘 위치 | 각 게임 주문 섹션 헤더(`🍔 주문받기`) 우측. 4 HTML 직접 마크업 |
| 별 아이콘 상태 | 노랑(`#ffc107`)=디폴트 설정됨 / 회색(`#cbd5e0`)=미설정. 색으로만 (라벨·점 없음) |
| 별 아이콘 노출 | **비공개 서버(serverId)에서만 표시**. 공개 방은 숨김 |
| 모달 | order-shared.js **동적 생성** 1곳 (showOrderListModal 패턴). 4게임 자동 커버 |
| 모드 | `fixed`(고정 메뉴) / `random`(매번 랜덤) |
| 랜덤 풀 | `gameState.frequentMenus` (자주 쓰는 메뉴 전체) |
| 랜덤 픽 시점 | 주문받기 시작(`startOrder` / `triggerAutoOrder`)에 서버가 풀에서 1개 |
| 단발 랜덤 | 클라가 `_frequentMenus`에서 픽 → input에 채움. 서버 왕복 없음 |
| DB | `default_orders.mode VARCHAR(10) DEFAULT 'fixed'` 컬럼 추가 |
| 이모지 | 기존 `🍔 주문받기` 유지 (mockup의 🍽 아님) |

## 3. 변경 파일

### 3-1. `db/init.js` — mode 컬럼 추가

`default_orders` 인덱스 생성(현재 L278) 직후, 기존 ALTER 멱등 패턴으로:

```javascript
await pool.query(`DO $$ BEGIN ALTER TABLE default_orders ADD COLUMN mode VARCHAR(10) DEFAULT 'fixed'; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
```

### 3-2. `db/default-orders.js` — mode 파라미터

```javascript
// 조회: {menu_text, mode} 반환 (없으면 null)
async function getDefaultOrder(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId || !userName) return null;
    try {
        const res = await pool.query(
            'SELECT menu_text, mode FROM default_orders WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return res.rows[0] ? { menuText: res.rows[0].menu_text, mode: res.rows[0].mode || 'fixed' } : null;
    } catch (e) { console.warn('default_orders 조회:', e.message); return null; }
}

// 저장: mode 추가. random이면 menuText='' (NOT NULL 유지)
async function setDefaultOrder(serverId, userName, menuText, mode) {
    const pool = getPool();
    if (!pool || !serverId) return false;
    const safeMode = mode === 'random' ? 'random' : 'fixed';
    const safeMenu = safeMode === 'random' ? '' : (menuText || '');
    try {
        await pool.query(
            `INSERT INTO default_orders (server_id, user_name, menu_text, mode, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (server_id, user_name)
             DO UPDATE SET menu_text = $3, mode = $4, updated_at = CURRENT_TIMESTAMP`,
            [serverId, userName, safeMenu, safeMode]
        );
        return true;
    } catch (e) { console.warn('default_orders 저장:', e.message); return false; }
}

// removeDefaultOrder: 변경 없음
```

### 3-3. `utils/room-helpers.js` — 캐시 구조 확장

`userDefaultOrders` 캐시가 mode를 담도록. 값을 `{ menuText, mode }` 객체로:

```javascript
userDefaultOrders: {},   // { [userName]: { menuText, mode } } — joinRoom 시 DB 로드 (비공개 서버 전용)
```

### 3-4. `socket/rooms.js` — 캐시 로드에 mode 반영

joinRoom 신규/재연결 양쪽 분기의 캐시 로드:

```javascript
if (room.serverId) {
    try {
        const def = await getDefaultOrder(room.serverId, finalUserName);  // {menuText, mode} | null
        if (def) gameState.userDefaultOrders[finalUserName] = def;
        else delete gameState.userDefaultOrders[finalUserName];
    } catch (e) { console.warn('디폴트 주문 캐시 로드 실패:', e.message); }
}
```

leaveRoom cleanup(`delete gameState.userDefaultOrders[...]`)은 그대로 유지.

### 3-5. `socket/shared.js` — 랜덤 픽 + mode 핸들러

**랜덤 픽 헬퍼** (모듈 상단):
```javascript
function pickRandomMenu(gameState) {
    const pool = Array.isArray(gameState.frequentMenus) ? gameState.frequentMenus : [];
    if (pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
}
```
> 공정성 무관: 메뉴 선택은 게임 결과가 아님. 서버 `Math.random` 허용.

**디폴트 적용 헬퍼** (startOrder/triggerAutoOrder 공용):
```javascript
function resolveDefaultOrder(gameState, userName) {
    const def = gameState.userDefaultOrders[userName];
    if (!def) return '';
    if (def.mode === 'random') return pickRandomMenu(gameState);
    return def.menuText || '';
}
```

`startOrder` / `triggerAutoOrder` 의 채우기 루프를 교체 (sync 유지):
```javascript
gameState.users.forEach(u => {
    gameState.userOrders[u.name] = resolveDefaultOrder(gameState, u.name);
});
```
`recordOrder` 호출은 그대로 (random이면 매번 다른 메뉴 기록 — 의도됨).

**핸들러 mode 확장**:
```javascript
// getDefaultOrder — 캐시에서 {menu, mode, enabled} 반환
socket.on('getDefaultOrder', () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user) return;
    const def = gameState.userDefaultOrders[user.name] || null;
    socket.emit('defaultOrderUpdated', {
        menu: def && def.mode === 'fixed' ? def.menuText : null,
        mode: def ? def.mode : null,
        enabled: !!room.serverId   // 비공개 서버 여부 → 클라 별 아이콘 표시 제어
    });
});

// setDefaultOrder — { menu, mode }
socket.on('setDefaultOrder', async (data) => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user) return;
    if (!room.serverId) { socket.emit('orderError', '비공개 서버에서만 디폴트 주문을 사용할 수 있습니다!'); return; }
    const mode = (data && data.mode === 'random') ? 'random' : 'fixed';
    let menu = '';
    if (mode === 'fixed') {
        menu = (data && typeof data.menu === 'string') ? data.menu.trim() : '';
        if (!menu) { socket.emit('orderError', '디폴트로 저장할 메뉴를 입력해주세요!'); return; }
        if (menu.length > 100) { socket.emit('orderError', '주문은 100자 이하로 입력해주세요!'); return; }
    }
    if (await setDefaultOrder(room.serverId, user.name, menu, mode)) {
        gameState.userDefaultOrders[user.name] = { menuText: menu, mode };
        socket.emit('defaultOrderUpdated', { menu: mode === 'fixed' ? menu : null, mode, enabled: true });
    } else {
        socket.emit('orderError', '디폴트 주문 저장에 실패했습니다!');
    }
});

// removeDefaultOrder — 캐시/DB 삭제 후 enabled 유지
socket.on('removeDefaultOrder', async () => {
    if (!checkRateLimit()) return;
    const room = getCurrentRoom();
    const gameState = getCurrentRoomGameState();
    if (!room || !gameState) return;
    const user = gameState.users.find(u => u.id === socket.id);
    if (!user || !room.serverId) return;
    if (await removeDefaultOrder(room.serverId, user.name)) {
        delete gameState.userDefaultOrders[user.name];
        socket.emit('defaultOrderUpdated', { menu: null, mode: null, enabled: true });
    } else {
        socket.emit('orderError', '디폴트 주문 해제에 실패했습니다!');
    }
});
```

### 3-6. `socket/dice.js` / `socket/horse.js` / `socket/roulette.js` — 자동주문 가드 버그

각 게임 시작 핸들러의 `gameState.isGameActive = true` 직후에 추가:
```javascript
gameState.orderAutoTriggered = false;
gameState.isOrderActive = false;
```
- dice.js L45, horse.js L179, roulette.js L219 직후.
- crane-game / bridge-cross 제외 (triggerAutoOrder 미사용).

> 게임 시작 시 이전 주문 cycle 가드를 풀어, 두 번째 게임 종료에서도 `triggerAutoOrder`가 정상 발동.

### 3-7. `js/shared/order-shared.js` — 별 아이콘 + 모달 (핵심)

**제거**:
- `toggleDefaultOrder()` (L686~702), `updateDefaultButtonState()` (L676~684)
- `injectStyles()`의 `#defaultOrderButton.active` 스타일
- `orderStarted`(L89) / `orderEnded`(L133) / `applySuggestion`(L649) / `setupAutocomplete`(L715)의 `updateDefaultButtonState()` 호출
- Public API의 `toggleDefaultOrder`

**상태 변경**:
```javascript
let _myDefaultOrder = null;   // 고정 모드 메뉴 (없으면 null)
let _myDefaultMode = null;    // 'fixed' | 'random' | null(미설정)
let _defaultEnabled = false;  // 비공개 서버 여부 (별 아이콘 표시 제어)
```

**`defaultOrderUpdated` 핸들러 — 객체 페이로드**:
```javascript
_socket.on('defaultOrderUpdated', (data) => {
    if (data && typeof data === 'object') {
        _myDefaultMode = data.mode || null;
        _myDefaultOrder = data.menu || null;
        _defaultEnabled = !!data.enabled;
    } else {
        _myDefaultMode = data ? 'fixed' : null;
        _myDefaultOrder = data || null;
        _defaultEnabled = true;
    }
    updateStarIcon();
});
```

**별 아이콘 갱신** (게임 HTML의 `#defaultStarBtn` 대상):
```javascript
function updateStarIcon() {
    const star = document.getElementById('defaultStarBtn');
    if (!star) return;
    star.style.display = _defaultEnabled ? 'inline-flex' : 'none';
    const isSet = _myDefaultMode === 'fixed' ? !!_myDefaultOrder : _myDefaultMode === 'random';
    star.classList.toggle('has-default', isSet);
}
```

**`orderStarted` 핸들러**: `orderInput.value = _myDefaultOrder || ''` 유지하되, 랜덤 모드는 서버가 채운 값이 `updateOrders`로 오므로 input은 그 값으로 동기화 → `updateOrders` 핸들러에서 본인 주문을 input에 반영:
```javascript
_socket.on('updateOrders', (orders) => {
    _ordersData = orders;
    // 주문받기 활성 + 본인 주문이 서버에서 채워졌으면 input 동기화 (랜덤/고정 자동주문 표시)
    if (_isOrderActive && _currentUser && orders[_currentUser]) {
        const input = document.getElementById('myOrderInput');
        if (input && document.activeElement !== input && !input.value) {
            input.value = orders[_currentUser];
        }
    }
    renderOrders();
    renderNotOrderedUsers();
    if (_options.onOrdersUpdated) _options.onOrdersUpdated(_ordersData);
});
```
> 포커스 중이거나 이미 입력값 있으면 덮어쓰지 않음 (사용자 입력 보호).

**모달 동적 생성** (showOrderListModal 패턴):
```javascript
function openDefaultModal() { /* 오버레이+모달 동적 생성, ESC/배경 닫기 */ }
function switchDefaultMode(mode) { /* 탭 전환 */ }
function pickDefaultFromPool(menu) { _socket.emit('setDefaultOrder', { menu, mode: 'fixed' }); ... }
function saveCustomDefault() { /* input 값으로 setDefaultOrder fixed */ }
function saveRandomMode() { _socket.emit('setDefaultOrder', { mode: 'random' }); ... }
function clearDefaultFromModal() { _socket.emit('removeDefaultOrder'); ... }
function rollRandomOnce() {
    const pool = _frequentMenus || [];
    if (pool.length === 0) { showAlert('자주 쓰는 메뉴가 없습니다!', 'warning'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const input = document.getElementById('myOrderInput');
    if (input) input.value = pick;
}
```
> 모달 내부 메뉴 풀은 `_frequentMenus`로 렌더. `setupAutocomplete`처럼 `_frequentMenus` 의존.
> 단발 랜덤 `rollRandomOnce`만 클라 `Math.random` (메뉴 선택, 공정성 무관).

**`init()`**: `_socket.emit('getDefaultOrder')` 유지. 별 아이콘 클릭 바인딩은 게임 HTML onclick.

**Public API**: `openDefaultModal`, `rollRandomOnce` 등 onclick용 노출.

### 3-8. 게임 HTML 4개 — 별 아이콘 + grid 복원

**(a) 입력칸 옆 `defaultOrderButton` 제거** (dice L1915, horse L249, roulette L1102, bridge L245).

**(b) `.order-input-group` grid 복원** `1fr auto auto` → `1fr auto`:
- `css/horse-race.css` L901 (horse/bridge 공유)
- `dice-game-multiplayer.html` 인라인 L883
- `roulette-game-multiplayer.html` 인라인 L751

**(c) 주문 섹션 헤더 우측에 별 아이콘 추가** (각 게임 헤더 구조에 맞춰):
```html
<button id="defaultStarBtn" onclick="OrderModule.openDefaultModal()" title="디폴트 주문 설정"
        style="display:none; background:transparent; border:none; font-size:22px; line-height:1; cursor:pointer; color:#cbd5e0; padding:2px 6px;">★</button>
```
- 헤더 우측 영역: dice `.history-title-wrapper`, 나머지 inline flex 래퍼 — 각 파일의 헤더 우측 컨테이너에 삽입.
- `has-default` 클래스 시 노랑: `injectStyles()`에 `#defaultStarBtn.has-default { color:#ffc107; }` 추가.

### 3-9. `docs/GameGuide/02-shared-systems/ORDER-MODULE.md` — 문서 갱신

- 디폴트 주문 섹션 갱신: 별 아이콘 + 모달, 고정/랜덤 모드, 단발 랜덤
- 소켓 이벤트: `setDefaultOrder { menu, mode }`, `defaultOrderUpdated { menu, mode, enabled }`
- 필수 HTML 요소: `defaultStarBtn` (입력칸 `defaultOrderButton` 제거)
- Public API: `openDefaultModal`, `rollRandomOnce`

## 4. 불변조건 (must-preserve)

- Socket 이벤트명 유지 (`getDefaultOrder`/`setDefaultOrder`/`removeDefaultOrder`/`defaultOrderUpdated` 등). 페이로드 객체화는 order-shared.js 동시 수정으로 호환.
- `startOrder` / `triggerAutoOrder` **sync 유지** — 랜덤 픽도 sync (캐시·메모리 풀에서 즉시).
- `updateOrder` 핸들러 변경 금지.
- 공정성: 게임 결과 난수는 서버 결정. **메뉴 랜덤은 게임 결과 아님 — 유일한 Math.random 예외**, 그 외 게임 로직 Math.random 신규 0.
- 디폴트 기능 비공개 서버 전용 — `room.serverId` 가드 유지. 공개 방 별 아이콘 숨김.
- 기존 `default_orders` row 호환 — mode DEFAULT 'fixed'.
- 캐시 DB 동기 — set/remove DB 성공 시에만 캐시 갱신.
- crane-game / bridge-cross 자동주문 가드 reset 대상 아님.

## 5. 검증 체크리스트

### 정적
- [ ] `node -c db/init.js db/default-orders.js socket/shared.js socket/rooms.js socket/dice.js socket/horse.js socket/roulette.js utils/room-helpers.js js/shared/order-shared.js server.js`
- [ ] `js/shared/order-shared.js`의 `Math.random` 은 `rollRandomOnce` 1곳만
- [ ] `socket/shared.js`의 `Math.random` 은 `pickRandomMenu` 1곳만 (게임 결과 무관)
- [ ] `updateDefaultButtonState` / `toggleDefaultOrder` 잔존 참조 0 (ReferenceError 방지)
- [ ] `triggerAutoOrder` 호출부 9곳 sync 유지
- [ ] `.order-input-group` grid `1fr auto` 복원 (3 정의 지점)
- [ ] 4 HTML에 `defaultStarBtn` 1개씩, `defaultOrderButton` 0개

### 브라우저 (비공개 서버 + 2탭 + 4게임)
- [ ] 별 아이콘 — 비공개 서버 표시(미설정=회색), 공개 방 숨김
- [ ] 별 클릭 → 모달: 고정/랜덤 탭, 현재 디폴트, 메뉴풀 선택, 직접 입력, 해제, 단발 랜덤
- [ ] 고정 디폴트 설정 → 별 노랑 → 주문받기 시작 → input + 주문목록 자동 채움
- [ ] 랜덤 모드 설정 → 별 노랑 → 주문받기 시작 → 매번 다른 메뉴 자동 주문 (2회 시작해 다른 메뉴 확인)
- [ ] 단발 랜덤 → input에 풀에서 랜덤 1개 (서버 영향 없음)
- [ ] **자동주문 버그**: 게임1 종료(자동주문) → endOrder 안 누르고 게임2 시작 → 게임2 종료 → 자동주문 정상 발동
- [ ] dice/roulette/horse-race 자동주문 + 디폴트/랜덤 적용 / bridge-cross는 수동만
- [ ] 자유/공개 방 기존 주문 흐름 100% 동일

## 6. 미결 / 결정 포인트

- **랜덤 모드 통계 source 구분** — `recordOrder`/`recordOrderHistory`에서 random을 `auto_random`으로 구분할지. 본 명세는 기존 source 유지(미구분). 분석 필요 시 후속.
- **모달 스타일 토큰화** — `#ffc107` 등 하드코딩. 기존 `.not-rolled-tag` 패턴과 동일, theme.css 토큰화는 후속.
