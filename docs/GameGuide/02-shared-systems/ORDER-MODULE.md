# OrderModule - 주문받기 공용 모듈

> `order-shared.js` — 모든 게임에서 공유하는 주문받기 시스템

---

## 개요

| 항목 | 내용 |
|------|------|
| 파일 | `order-shared.js` |
| 전역 객체 | `OrderModule` |
| 패턴 | Revealing Module Pattern (IIFE) |
| CSS 자동 주입 | `.not-rolled-tag` 스타일 |

### 적용 현황

| 게임 | 적용 여부 | isGameActive 매핑 |
|------|----------|-------------------|
| dice-game | O | `isGameActive` |
| horse-race | O | `isRaceActive` |
| roulette | O | `isSpinning` |
| bridge-cross | O | `isBridgeCrossActive` |
| team-game | X (미적용) | - |

---

## 게임별 주문 UI 동작 (통일됨)

모든 게임에서 동일한 패턴을 따릅니다:

- **ordersSection**: 항상 표시 (`display: block`)
- **주문 미활성 시**: 입력 필드 `disabled`, 섹션은 보임
- **주문 시작 버튼**: 호스트 + 게임 미진행 + 주문 미진행일 때 표시
- **게임 진행 중**: 주문받기 버튼 숨김
- **주문 종료 후**: 주문 목록/미주문자 목록 계속 렌더링
- **서버 데이터 키**: `isOrderActive`, `userOrders` (표준 키만 사용)
- **Init**: `initOrderModule()` 함수로 `OrderModule.init()` 호출

---

## 주문 라이프사이클

```
호스트: [주문받기 시작] ──→ 유저들: [주문 입력/수정] ──→ 호스트: [주문받기 종료]
         │                        │                          │
         ▼                        ▼                          ▼
   기존 주문 초기화          주문 저장/수정              입력 비활성화
   UI 활성화               자동완성 동작              주문 데이터 유지
   자동완성 바인딩          미주문자 목록 갱신          시작 버튼 복귀
```

### 주문 시작

| 항목 | 내용 |
|------|------|
| 트리거 | 호스트가 "주문받기 시작" 버튼 클릭 |
| 권한 | **호스트만 가능** (서버에서 `user.isHost` 확인) |
| 서버 동작 | `gameState.isOrderActive = true`, 기존 주문 초기화 (`userOrders = {}`), 모든 유저에게 빈 주문 생성 |
| 클라이언트 동작 | `ordersSection` 표시, 입력 필드 활성화, 자동완성 바인딩, `gameStatus` → "주문받기 진행 중!" |

### 주문 입력

| 항목 | 내용 |
|------|------|
| 조건 | `isOrderActive === true`일 때만 가능 |
| 제한 | 본인 주문만 수정 가능 (서버에서 `socket.id`로 사용자 검증), **100자 이하** |
| 저장 | "저장" 버튼 또는 Enter 키 (자동완성 미표시 시) |
| 피드백 | 저장 성공 시 입력 필드 배경 초록색 0.5초 |

### 주문 종료

| 항목 | 내용 |
|------|------|
| 트리거 | 호스트가 "주문마감" 버튼 클릭 |
| 권한 | **호스트만 가능** |
| 서버 동작 | `gameState.isOrderActive = false` (주문 데이터는 초기화하지 않고 유지) |
| 클라이언트 동작 | 입력 필드/저장 버튼 비활성화, 게임 미진행 시 시작 버튼 다시 표시, `gameStatus` → "게임 대기 중..." |

### 서버 검증 (모든 주문 요청 공통)

1. Rate limit 확인
2. 방 입장 여부 확인
3. 호스트 권한 확인 (시작/종료만)
4. `isOrderActive` 상태 확인 (주문 저장 시)
5. `socket.id` 기반 사용자 이름 일치 확인 (주문 저장 시)

---

## Init 시그니처

```javascript
OrderModule.init(socket, currentUser, {
    isHost: () => isHost,                      // Function → boolean
    isGameActive: () => isGameActive,          // Function → boolean (게임별 변수명 다름)
    getEverPlayedUsers: () => everPlayedUsers, // Function → array
    getUsersList: () => currentUsers,          // Function → array
    showCustomAlert: (msg, type) => showCustomAlert(msg, type),
    onOrderStarted: () => { isOrderActive = true; },
    onOrderEnded: () => { isOrderActive = false; },
    onOrdersUpdated: (data) => { ordersData = data; }
});
```

### 옵션 상세

| 옵션 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `isHost` | `() => boolean` | Y | 현재 유저가 호스트인지 |
| `isGameActive` | `() => boolean` | Y | 게임 진행 중인지 (주문 종료 시 버튼 제어) |
| `getEverPlayedUsers` | `() => array` | Y | 게임 참여자 목록 (관전자 분리용) |
| `getUsersList` | `() => array` | Y | 현재 접속자 목록 (미주문자 표시용) |
| `showCustomAlert` | `(msg, type) => void` | N | 알림 표시 (없으면 `alert()` 사용) |
| `onOrderStarted` | `() => void` | N | 주문 시작 콜백 |
| `onOrderEnded` | `() => void` | N | 주문 종료 콜백 |
| `onOrdersUpdated` | `(data) => void` | N | 주문 데이터 갱신 콜백 |

---

## 초기화 패턴 (게임 HTML 내)

```javascript
let orderModuleInitialized = false;
function initOrderModule() {
    if (orderModuleInitialized) return;
    orderModuleInitialized = true;

    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isGameActive,  // 게임별로 다른 변수
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert(msg, type),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; }
    });
}
```

---

## 필수 HTML 요소

```html
<!-- 주문 섹션 -->
<div id="ordersSection">
    <button id="startOrderButton">주문받기</button>
    <button id="endOrderButton" style="display:none;">주문마감</button>
    <button id="showOrderListButton">주문 리스트</button>
    <button class="sort-button active" id="sortOrderAscBtn">가나다순</button>
    <button class="sort-button" id="sortOrderDescBtn">가나다 역순</button>
    <button class="sort-button" id="sortOrderCountBtn">개수순</button>
    <div id="orderList"></div>
    <div id="spectatorOrdersSection" style="display:none;">
        <div id="spectatorOrderList"></div>
    </div>
    <div id="notOrderedSection" style="display:none;">
        <div id="notOrderedList"></div>
    </div>
    <input id="myOrderInput" placeholder="주문할 내용을 입력하세요" />
    <div id="autocompleteSuggestion"></div>
    <div id="autocompleteDropdown"></div>
    <button id="orderSaveButton">저장</button>
    <div id="menuManager" style="display:none;">
        <input id="menuInput" />
        <div id="menuList"></div>
    </div>
</div>
<div id="gameStatus" class="waiting"></div>
```

### 요소 ID 목록

| ID | 용도 |
|----|------|
| `ordersSection` | 주문 섹션 컨테이너 |
| `startOrderButton` | 주문받기 시작 버튼 (호스트용) |
| `endOrderButton` | 주문받기 종료 버튼 (호스트용) |
| `showOrderListButton` | 주문리스트 모달 보기 버튼 |
| `sortOrderAscBtn` | 가나다순 정렬 |
| `sortOrderDescBtn` | 가나다 역순 정렬 |
| `sortOrderCountBtn` | 주문 많은 순 정렬 |
| `orderList` | 게임 참여자 주문 목록 |
| `spectatorOrdersSection` | 관전자 주문 섹션 |
| `spectatorOrderList` | 관전자 주문 목록 |
| `notOrderedSection` | 미주문자 섹션 |
| `notOrderedList` | 미주문자 목록 |
| `myOrderInput` | 주문 입력 필드 |
| `autocompleteSuggestion` | 자동완성 힌트 표시 |
| `autocompleteDropdown` | 자동완성 드롭다운 |
| `orderSaveButton` | 주문 저장 버튼 |
| `defaultStarBtn` | 디폴트 주문 모달 여는 별(★) 아이콘 — 주문 섹션 헤더 우측 (비공개 서버 전용) |
| `menuManager` | 메뉴 관리 패널 |
| `menuInput` | 메뉴 추가 입력 필드 |
| `menuList` | 등록된 메뉴 목록 |
| `gameStatus` | 게임 상태 표시 |

---

## 소켓 이벤트

### Emit (클라이언트 → 서버)

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `startOrder` | - | 주문받기 시작 |
| `endOrder` | - | 주문받기 종료 |
| `updateOrder` | `{userName, order}` | 주문 저장/수정 |
| `getFrequentMenus` | - | 자주 쓰는 메뉴 목록 요청 |
| `addFrequentMenu` | `{menu}` | 메뉴 추가 |
| `deleteFrequentMenu` | `{menu}` | 메뉴 삭제 |
| `getDefaultOrder` | - | 본인 디폴트 주문 조회 (서버 캐시) |
| `setDefaultOrder` | `{menu, mode}` | 본인 디폴트 주문 저장. `mode='fixed'`면 `menu` 필수, `mode='random'`이면 `menu` 무시 (비공개 서버 전용) |
| `removeDefaultOrder` | - | 본인 디폴트 주문 해제 |

### On (서버 → 클라이언트)

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `orderStarted` | - | 주문받기 시작됨 |
| `orderEnded` | - | 주문받기 종료됨 |
| `orderUpdated` | `{order}` | 내 주문 업데이트 확인 |
| `updateOrders` | orders object | 전체 주문 데이터 갱신 |
| `orderError` | error message | 주문 오류 |
| `frequentMenusUpdated` | menus array | 메뉴 목록 갱신 |
| `menuError` | error message | 메뉴 관리 오류 |
| `defaultOrderUpdated` | `{menu, mode, enabled}` | 본인 디폴트 주문 현재값. `menu`=고정 메뉴(랜덤/미설정이면 null), `mode`=`'fixed'`\|`'random'`\|null, `enabled`=비공개 서버 여부(별 아이콘 표시 제어) |

---

## Public API

### 주문 관리

| 함수 | 설명 |
|------|------|
| `init(socket, currentUser, options)` | 모듈 초기화 |
| `startOrder()` | 주문받기 시작 (호스트) |
| `endOrder()` | 주문받기 종료 (호스트) |
| `updateMyOrder()` | 내 주문 저장 |

### 렌더링

| 함수 | 설명 |
|------|------|
| `renderOrders()` | 주문 목록 렌더링 (참여자/관전자 분리) |
| `renderNotOrderedUsers()` | 미주문자 목록 렌더링 |
| `groupOrdersByMenu(data, mode)` | 메뉴별 그룹핑 |
| `sortOrders(mode)` | 정렬 변경 (`'asc'`, `'desc'`, `'count'`) |
| `showOrderList()` | 주문리스트 모달 표시 |
| `showOrderListModal(content)` | 텍스트 모달 표시 |

### 자동완성

| 함수 | 설명 |
|------|------|
| `setupAutocomplete()` | 자동완성 이벤트 바인딩 |

### 메뉴 관리

| 함수 | 설명 |
|------|------|
| `loadFrequentMenus()` | 서버에서 메뉴 목록 로드 |
| `addMenu()` | 메뉴 추가 |
| `deleteMenu(menu)` | 메뉴 삭제 |
| `renderMenuList()` | 메뉴 태그 렌더링 |
| `toggleMenuManager()` | 메뉴 관리 패널 토글 |

### 디폴트 주문 (비공개 서버 전용)

| 함수 | 설명 |
|------|------|
| `openDefaultModal()` | 디폴트 주문 모달 열기 (고정/랜덤 탭, 메뉴풀 선택, 직접 입력, 해제) |
| `rollRandomOnce()` | 자주 쓰는 메뉴 풀에서 1개를 랜덤으로 골라 입력칸에 채움 (단발, 서버 왕복 없음) |

### 상태 접근

| 함수 | 설명 |
|------|------|
| `getOrdersData()` | 현재 주문 데이터 반환 |
| `isOrderActive()` | 주문 진행 중 여부 |
| `setOrdersData(data)` | 주문 데이터 직접 설정 |
| `setIsOrderActive(active)` | 주문 상태 직접 설정 |
| `getFrequentMenus()` | 자주 쓰는 메뉴 배열 반환 |

---

## 주요 기능 상세

### 관전자/참여자 분리

`getEverPlayedUsers()` 콜백으로 게임 참여 이력이 있는 유저를 구분하여 주문 목록을 분리 렌더링합니다. 관전자 주문은 opacity 0.7로 표시됩니다.

### 자동완성

- `myOrderInput` 입력 시 자주 쓰는 메뉴에서 매칭
- **Tab/Enter**: 첫 번째(또는 선택된) 제안 적용
- **ArrowUp/Down**: 드롭다운에서 제안 선택
- **Escape**: 자동완성 닫기
- 중복 바인딩 방지: `orderInput._orderAutocompleteBound` 플래그 사용

### 정렬 모드

| 모드 | 설명 |
|------|------|
| `asc` | 메뉴명 가나다순 (기본) |
| `desc` | 메뉴명 가나다 역순 |
| `count` | 주문 많은 순 |

### CSS 자동 주입

`init()` 호출 시 `.not-rolled-tag` 스타일과 `#defaultStarBtn` 별 아이콘 스타일이 `<head>`에 자동 주입됩니다. 게임 HTML에서 별도 정의 불필요.

```css
.not-rolled-tag {
    background: #fff3cd;
    border: 2px solid #ffc107;
    color: #856404;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
}
#defaultStarBtn.has-default { color: #ffc107; }  /* 설정됨: 노랑 (기본은 회색 #cbd5e0) */
#defaultStarBtn:hover { transform: scale(1.15); }
```

### 디폴트 주문 (비공개 서버 단골 메뉴)

비공개 서버(`room.serverId` 존재)에서만 동작하는 사람별 단골 메뉴 기능. 주문 섹션 헤더 우측의 **별(★) 아이콘**으로 진입하는 모달에서 관리한다.

**저장 위치**: PostgreSQL `default_orders` 테이블 — 키 `(server_id, user_name)`, `mode` 컬럼(`'fixed'` 기본 / `'random'`).

**모드**:

| 모드 | 동작 |
|------|------|
| `fixed` | 저장된 메뉴 1개를 주문받기마다 자동 채움 |
| `random` | 주문받기마다 `gameState.frequentMenus` 풀에서 서버가 랜덤 1개를 골라 채움 (매번 다른 메뉴) |

**별 아이콘**: 비공개 서버에서만 표시. 디폴트 설정됨=노랑(`#ffc107`, `.has-default`), 미설정=회색(`#cbd5e0`). 공개/자유 방에서는 `display:none`.

**동작 흐름**:

1. **방 진입 (`joinRoom`)**: 서버가 본인 디폴트 1건을 DB에서 로드 → `gameState.userDefaultOrders[userName] = { menuText, mode }` 캐시.
2. **모듈 init**: 클라이언트가 `getDefaultOrder` emit → 서버 캐시에서 즉시 응답 (`defaultOrderUpdated { menu, mode, enabled }`). `enabled`로 별 아이콘 표시 결정.
3. **별 아이콘 클릭 → 모달**:
   - **고정 메뉴 탭**: 현재 디폴트 표시/해제, 자주 쓰는 메뉴풀에서 선택, 직접 입력 후 저장 → `setDefaultOrder { menu, mode:'fixed' }`
   - **매번 랜덤 탭**: 체크박스 on → `setDefaultOrder { mode:'random' }`, off → `removeDefaultOrder`
   - **🎲 지금 한 번만 랜덤 채우기**: 클라가 `_frequentMenus`에서 1개 픽 → 입력칸에 채움(서버 왕복 없음). 디폴트 저장과 무관한 단발.
4. **`startOrder` / `triggerAutoOrder` 시 (서버)**:
   - 각 유저별 `userOrders[u.name] = resolveDefaultOrder(gameState, u.name)` — `fixed`면 `menuText`, `random`이면 `pickRandomMenu()`.
   - 비공개 서버면 자동 채워진 주문을 `recordOrder` + `recordOrderHistory`(source `auto_default`)로 통계 기록.
   - `updateOrders` emit으로 클라이언트에 즉시 반영. 클라는 input이 비어 있고 포커스가 없을 때만 본인 값으로 동기화(사용자 입력 보호).

**불변조건**:

- `room.serverId` null(자유플레이/공개)에서는 `setDefaultOrder`가 `orderError` 응답("비공개 서버에서만 …"). 별 아이콘은 숨김(`enabled:false`).
- 캐시(`userDefaultOrders`)는 DB와 항상 동기 — set/remove 핸들러는 DB 성공 시에만 캐시 갱신.
- `startOrder` / `triggerAutoOrder`는 sync 유지(emit 순서 보장). DB 조회는 joinRoom 시점에만 1회. 랜덤 픽도 메모리 풀에서 즉시(sync).
- **메뉴 랜덤(`pickRandomMenu`/`rollRandomOnce`)은 게임 결과가 아니므로 `Math.random` 허용** — 게임 로직 난수는 여전히 서버 결정.

**UI**:

- `defaultStarBtn`이 주문 섹션 헤더(`🍔 주문받기`) 우측에 위치. 입력칸 영역은 `grid-template-columns: 1fr auto`(input + 저장)로 단순.
- 모달은 `order-shared.js`가 동적 생성(`showOrderListModal` 패턴) — 4게임 공용 1곳.

---

## HTML onclick 바인딩 예시

```html
<button onclick="OrderModule.startOrder()">주문받기 시작</button>
<button onclick="OrderModule.endOrder()">주문받기 종료</button>
<button onclick="OrderModule.updateMyOrder()">저장</button>
<button onclick="OrderModule.showOrderList()">주문리스트 보기</button>
<button onclick="OrderModule.sortOrders('asc')">가나다순</button>
<button onclick="OrderModule.sortOrders('desc')">가나다 역순</button>
<button onclick="OrderModule.sortOrders('count')">주문 많은 순</button>
<button onclick="OrderModule.toggleMenuManager()">메뉴 관리</button>
<button onclick="OrderModule.addMenu()">추가</button>
<!-- 주문 섹션 헤더 우측: 디폴트 주문 모달 진입 별 아이콘 (비공개 서버에서만 표시) -->
<button id="defaultStarBtn" onclick="OrderModule.openDefaultModal()" title="디폴트 주문 설정"
        style="display:none; background:transparent; border:none; font-size:22px; line-height:1; cursor:pointer; color:#cbd5e0; padding:2px 6px;">★</button>
```
