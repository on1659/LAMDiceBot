# Lobby Tutorial — 설계 vs 구현 차이점

> **목적**: 다음 게임별 튜토리얼(dice, roulette, horse-race) 구현 시 참고
> **비교 대상**: `docs/tutorial/impl.md`, `docs/tutorial/lobby-tutorial.md`, `docs/meeting/impl/2026-02-26-lobby-tutorial-impl.md`
> **실제 코드**: `tutorial-shared.js`, `server-select-shared.js`

---

## 1. 공통 모듈 (tutorial-shared.js) 차이

### 1-1. 오버레이 방식

| | 설계 문서 | 실제 구현 |
|---|----------|-----------|
| 기법 | `.tutorial-overlay` (별도 div) + `.tutorial-highlight` (pulse border) | Spotlight: `.tutorial-highlight`의 `box-shadow: 0 0 0 9999px rgba(0,0,0,0.65)` |
| 클릭 차단 | overlay div가 pointer-events 담당 | `.tutorial-click-blocker` (별도 투명 div, z-index 10009) |
| DOM 구조 | overlay + highlight + tooltip (3개) | **blocker** + highlight + tooltip (3개, overlay 제거) |

**교훈**: Spotlight 방식이 DOM 1개 적고, highlight 자체가 오버레이 역할을 겸함. 별도 overlay div 불필요.

### 1-2. Z-Index

| | 설계 | 실제 |
|---|------|------|
| overlay/blocker | 9998 | **10009** |
| highlight | 9999 | **10010** |
| tooltip | 10000 | **10012** |

**교훈**: 서버선택 오버레이(`z-index: 10000`)보다 위에 있어야 해서 전체적으로 올림. 게임별 튜토리얼에서도 기존 UI z-index 확인 후 설정할 것.

### 1-3. CSS Pulse 애니메이션

| | 설계 | 실제 |
|---|------|------|
| highlight 효과 | `@keyframes tutorialPulse` (box-shadow 변화) | 없음 (정적 border + spotlight shadow) |

**교훈**: spotlight box-shadow가 이미 시각적으로 충분. pulse 없어도 대상이 명확히 구분됨.

### 1-4. 버튼 구성

| | 설계 | 실제 |
|---|------|------|
| 버튼 | 건너뛰기 + 다음 | **✕ 닫기(우상단) + ← 이전 + 다음** |
| 첫 스텝 | 건너뛰기 표시 | 이전 버튼 숨김 |

**교훈**: 이전 버튼은 사용자 경험에 큰 차이. 다음 튜토리얼에서도 반드시 포함. `prev()` 함수가 현재 스텝의 `cleanup()` 호출 후 되돌아감.

### 1-5. 화살표(Arrow)

| | 설계 | 실제 |
|---|------|------|
| 방향 | 고정 (`left: 50%`) | **동적 계산** (`--ax`, `--ay` CSS 변수로 하이라이트 중심 추적) |
| 네이밍 | `arrow-bottom` (화살표가 아래 방향) | `arr-bottom` (툴팁이 아래에 위치) |

**교훈**: 동적 화살표가 시각적으로 훨씬 자연스러움. 특히 화면 끝에서 clamp된 경우 화살표가 대상을 정확히 가리킴.

### 1-6. 가시성 판정

| | 설계 | 실제 |
|---|------|------|
| `_isVisible()` | `el.offsetParent !== null` | `getComputedStyle` → `display !== 'none' && visibility !== 'hidden'` |

**교훈**: `offsetParent`는 `position: fixed` 요소에서 null 반환하여 오판 가능. `getComputedStyle` 방식이 더 정확.

### 1-7. Tooltip 배치 Flip 로직

| | 설계 | 실제 |
|---|------|------|
| 범위 초과 시 | clamp만 (같은 방향 유지) | **flip** (반대 방향으로 전환) + clamp |

**교훈**: flip이 없으면 tooltip이 대상과 겹침. 실제 구현의 flip → clamp 2단계가 올바른 패턴.

### 1-8. 모바일 대응

| | 설계 | 실제 |
|---|------|------|
| 언급 | "모바일 320px — clamp" 한 줄 | `@media (max-width: 480px)` CSS + `_isMobile()` JS 분기 |
| CSS | 없음 | 폰트/패딩 축소, 오버레이 투명도 감소, width auto |
| 배치 | 동일 로직 | 하이라이트 반대편 배치 (상/하 자동 전환, 화살표 제거) |

**교훈**: 모바일은 반드시 별도 처리. 480px 이하에서 tooltip이 화면의 절반 이상을 차지하면 대상이 안 보임. 다음 튜토리얼에서도 `_isMobile()` 분기 자동 적용됨 (공통 모듈에 포함).

---

## 2. 로비 튜토리얼 스텝 차이

### 2-1. 스텝 수와 구성

| # | 설계 (4단계) | 실제 (8단계) |
|---|-------------|-------------|
| 1 | `.ss-free-btn` 바로플레이 | ✅ 동일 |
| 2 | `.ss-login-btn` 서버참여 | ✅ 동일 |
| 3 | `.ss-create-btn` 서버만들기 | `#ss-search-input` 서버검색 (**변경**) |
| 4 | `.ss-server-card` 서버입장 | `#ss-demo-card` 서버가입 (**변경**) |
| 5 | — | `#ss-demo-pw-box` 참여코드 입력 (**신규**) |
| 6 | — | `#ss-demo-pending-card` 승인 대기 (**신규**) |
| 7 | — | `#ss-demo-approved-card` 승인 완료 (**신규**) |
| 8 | — | `.ss-create-btn` 새 서버 만들기 (**신규**, 원래 step 3) |

**교훈**: 설계 시 "최소 스텝"으로 시작하되, 사용자 여정(가입 → 코드입력 → 대기 → 승인)을 빠뜨리면 나중에 대폭 추가됨. 처음부터 사용자 플로우 전체를 스텝으로 잡는 게 좋음.

### 2-2. beforeShow / cleanup 콜백

설계에 전혀 없던 기능. 실제 구현에서 가장 큰 추가.

```javascript
// 실제 패턴: 스텝이 보여지기 전에 DOM 주입
{
    target: '#ss-demo-card',
    beforeShow: function() { _insertDemoServerCard(); },
    cleanup: function() { _removeDemoServerCard(); },
    title: '서버 가입하기',
    content: '...',
    position: 'right'
}
```

**설계에서의 가정**: 타겟 요소가 이미 DOM에 존재
**실제**: 비로그인 사용자에게 데모 요소를 주입해야 함

**교훈**: 게임별 튜토리얼에서도 동일 이슈 발생 가능:
- roomJoined 전에 튜토리얼 시작하면 게임 UI가 없음
- `beforeShow`로 더미 UI를 주입하거나, roomJoined 후 시작하도록 타이밍 조정 필요

### 2-3. 비로그인 처리

| | 설계 | 실제 |
|---|------|------|
| 방식 | DOM 없으면 자동 스킵 (step 3, 4 생략) | **fake server section 주입** → 8단계 모두 체험 |
| 자동 시작 | 500ms setTimeout | **버튼 애니메이션으로 유도** (자동 시작 안 함) |

**교훈**: "자동 스킵"은 쉽지만, 비로그인 사용자가 핵심 기능을 못 봄. fake UI 주입이 UX적으로 훨씬 나음. 단, `_injectFakeServerSection()` / `_restoreFakeServerSection()` 같은 헬퍼 함수 필요.

### 2-4. 함수형 title/content

설계: 문자열만 지원
실제: `typeof step.content === 'function' ? step.content() : step.content`

```javascript
// 실제 사용 예: 로그인 상태에 따라 다른 메시지
content: function() {
    var input = document.querySelector('#ss-search-input');
    if (input && input.disabled) {
        return '로그인하면 서버를 검색할 수 있어요! 관심 있는 서버를 찾아보세요.';
    }
    return '서버 이름으로 검색해서 원하는 서버를 찾을 수 있습니다.';
}
```

**교훈**: 게임별 튜토리얼에서도 host/non-host에 따라 다른 메시지가 필요할 수 있음. 함수형 content를 활용하면 `hostOnly` 플래그 없이도 조건부 메시지 가능.

---

## 3. 저장 / 추적 차이

### 3-1. 튜토리얼 완료 추적

| | 설계 | 실제 |
|---|------|------|
| 저장소 | localStorage만 | **localStorage + DB bit flags** (이중) |
| 크로스 디바이스 | 미지원 | **지원** (로그인 유저) |
| API | `shouldShow()`, `reset()` | + `setUser(socket, userName, onReady)`, `FLAG_BITS` |

```javascript
// 실제 패턴: 로그인 시 서버 flags 로드 → 콜백에서 튜토리얼 시작
TutorialModule.setUser(socket, userName, function() {
    TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS);
});
```

**교훈**: 게임별 튜토리얼에서도 동일 패턴 사용 가능. `setUser()`는 이미 lobby에서 호출되므로, 게임 페이지에서는 flags가 이미 로드된 상태. 단, 게임 페이지에서 `setUser()`를 다시 호출할 필요가 있는지 확인 필요 (페이지 이동 시 모듈 상태 초기화됨).

### 3-2. `_hasSeen()` 이중 체크

```javascript
function _hasSeen(gameType) {
    var bit = FLAG_BITS[gameType];
    if (bit && _flagsLoaded && (_serverFlags & bit)) return true;  // DB 우선
    return localStorage.getItem(STORAGE_PREFIX + gameType) === VERSION;  // 폴백
}
```

**교훈**: 비로그인 → localStorage만 체크. 로그인 → DB 우선, localStorage 폴백. 게임별 튜토리얼에서 추가 작업 불필요 (공통 모듈에 포함).

---

## 4. `?` 도움말 버튼 차이

| | 설계 | 실제 |
|---|------|------|
| 위치 | container 하단 우측 (JS inline style, absolute) | **header 우측** (CSS class `.ss-tutorial-help-btn`) |
| 스타일 | 단색 보라 (#8B5CF6), opacity hover | **그라디언트 + 흰 테두리 + 보라 그림자** |
| 비로그인 | 동일 | **pulse 애니메이션** (`ssHelpPulse` keyframes) |

**교훈**: 버튼은 항상 보이는 위치(header)에 배치. container 하단은 스크롤 시 안 보일 수 있음. 게임별 튜토리얼에서도 고정 위치(header 등)에 `?` 버튼 배치 권장.

---

## 5. 설계에 없던 신규 기능 (게임별 적용 시 참고)

| 기능 | 설명 | 게임별 적용 |
|------|------|------------|
| `beforeShow` / `cleanup` | 스텝 전/후 DOM 조작 콜백 | host 전용 UI 임시 표시 등에 활용 가능 |
| 함수형 title/content | 상태에 따른 동적 메시지 | host/non-host 분기 메시지 |
| `_isMobile()` + 모바일 배치 | 480px 이하 자동 대응 | **자동 적용** (공통 모듈) |
| `prev()` + cleanup | 이전 스텝 이동 시 현재 스텝 cleanup | **자동 적용** (공통 모듈) |
| `_findNext`의 beforeShow 우선 | beforeShow 있는 스텝은 가시성 검사 스킵 | DOM 미존재 타겟도 beforeShow로 주입 가능 |
| `next()`는 cleanup 안 함 | 스텝이 레이어링될 수 있음 (lobby step 3-7) | `_complete()`에서 전체 cleanup 일괄 실행 |
| click-blocker | 튜토리얼 중 배경 클릭 차단 | **자동 적용** (공통 모듈) |

---

## 6. 다음 튜토리얼 구현 시 체크리스트

기존 설계 문서(`dice-tutorial.md` 등)를 따르되, 아래 항목을 반영:

- [ ] **HTML 주입 불필요**: `tutorial-shared.js`가 overlay/highlight/tooltip DOM을 자동 생성. 설계 문서의 "HTML 추가" 섹션은 무시
- [ ] **버튼 구성**: 건너뛰기 → **✕ 닫기 + ← 이전 + 다음** (공통 모듈에 이미 포함)
- [ ] **`hostOnly` 플래그 폐기**: 함수형 content로 대체하거나, `_isVisible()`이 자동 스킵
- [ ] **`setUser()` 호출**: 게임 페이지 로드 시 socket + userName으로 호출 (flags 로드)
- [ ] **모바일**: 별도 작업 불필요 (공통 모듈의 `_isMobile()` 자동 대응)
- [ ] **타이밍**: `roomJoined` 후 `setTimeout` 대신, `setUser` onReady 콜백 사용 권장
- [ ] **사운드**: 설계에 있었으나 미구현 — 필요 시 별도 결정
- [ ] **`config/client-config.js`**: 미생성 — 상수는 각 파일 내 정의로 충분

---

## 7. 설계 문서 중 여전히 유효한 부분

- Step Schema 기본 구조 (`target`, `title`, `content`, `position`, `fallbackTarget`)
- `shouldShow()` / `reset()` API
- localStorage 키 형식 (`tutorialSeen_` + gameType)
- 비호스트 자동 스킵 (DOM 미존재 → `_isVisible()` false → 자동 스킵)
- 게임별 스텝 정의는 각 HTML 파일 내 인라인
- `tutorial-shared.js`를 해당 HTML보다 먼저 로드
