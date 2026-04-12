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

`init()` 호출 시 `.not-rolled-tag` 스타일이 `<head>`에 자동 주입됩니다. 게임 HTML에서 별도 정의 불필요.

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
```

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
```
