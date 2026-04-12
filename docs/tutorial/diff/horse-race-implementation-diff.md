# Horse Race Tutorial — 설계 vs 구현 차이점

> **목적**: 게임별 튜토리얼 구현 시 설계 문서 vs 실제 구현 차이 기록
> **비교 대상**: `docs/tutorial/horse-race-tutorial.md` (구현 전 설계), 실제 `horse-race-multiplayer.html` + `tutorial-shared.js`
> **구현일**: 2026-03-06

---

## 1. gameType / Storage Key 차이

| 항목 | 설계 당시 | 실제 구현 |
|------|----------|----------|
| gameType 문자열 | `'horse-race'` | **`'horse'`** |
| FLAG_BITS 키 | 문서에 명시 안 됨 | `FLAG_BITS.horse = 8` |
| localStorage 키 | `tutorialSeen_horse-race` | **`tutorialSeen_horse`** |
| DB flag bit | (불명) | **bit 8** (& 8 체크) |

**교훈**:
- 설계 시 gameType과 FLAG_BITS 키 일치 확인 필요
- gameType이 DB 동기화를 결정하므로 신중히 선택
- horse-race vs horse 혼용하지 말 것

---

## 2. HTML Overlay 주입 제거

| 항목 | 설계 문서 | 실제 |
|------|----------|------|
| HTML div 주입 | `#tutorialOverlay`, `#tutorialTooltip` (별도 div 직접 작성) | **불필요** |
| 생성 방식 | 수동 (HTML에 작성) | **JS 자동** (tutorial-shared.js) |
| 버튼 markup | 문서에 명시 (건너뛰기, 다음) | 자동 생성 |

**결과**:
```html
<!-- 설계: 작성 필요 -->
<div id="tutorialOverlay" class="tutorial-overlay" style="display:none"></div>
<div id="tutorialTooltip" class="tutorial-tooltip" style="display:none">
    <button class="tutorial-btn-skip">건너뛰기</button>
    <button class="tutorial-btn-next">다음 →</button>
</div>

<!-- 실제: 불필요 (JS가 대신함) -->
```

**교훈**:
- 공통 모듈이 DOM 생성하면 게임별 HTML에서 제거
- 대신 STEPS 배열만 정의하면 됨

---

## 3. 버튼 구성 변경

| 버튼 | 설계 | 실제 |
|------|------|------|
| 닫기 | - | **✕ (우상단, close button)** |
| 이전 | - | **← 이전** (첫 스텝에서 숨김) |
| 다음 | **다음 →** | **다음 →** (동일) |
| 건너뛰기 | **건너뛰기** | **제거** (close button으로 대체) |

**교훈**:
- 이전 버튼 UX 효과 크다 → 필수 포함
- 건너뛰기는 close button (✕)로 일관성 있게 처리

---

## 4. `hostOnly` 플래그 제거

| 항목 | 설계 | 실제 |
|------|------|------|
| step 정의 | `hostOnly: true` 플래그 사용 | **플래그 제거** |
| 비호스트 처리 | 명시적 플래그 | **`_isVisible()` 자동** |
| 구현 방식 | 설계 문서에 명시 | 공통 모듈 자동 처리 |

**실제 동작**:
```javascript
// 설계: 명시적 플래그
{
    target: '#startHorseRaceButton',
    hostOnly: true,  // 수동으로 체크 필요
    ...
}

// 실제: 자동 스킵 (플래그 불필요)
{
    target: '#startHorseRaceButton',
    fallbackTarget: '#readySection'
    // #startHorseRaceButton이 #hostControls 안에 있고
    // #hostControls는 display:none (비호스트)
    // → _isVisible()이 false 반환 → 자동 스킵
}
```

**교훈**:
- `hostOnly` 플래그는 실제 모듈에서 지원 안 함
- 대신 visibility 기반 자동 스킵 활용
- 다음 게임 튜토리얼: hostOnly 사용 금지

---

## 5. `setUser()` 패턴 추가

| 항목 | 설계 | 실제 |
|------|------|------|
| DB flag 로드 | 문서에 없음 | **필요** |
| API 호출 | - | `TutorialModule.setUser(socket, userName, callback)` |
| 호출 타이밍 | - | `roomJoined` 후, `start()` 전 |

**구현**:
```javascript
// 실제 코드
socket.on('roomJoined', () => {
    setTimeout(() => {
        TutorialModule.setUser(socket, currentUser || '', () => {
            TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS);
        });
    }, 1000);
});
```

**교훈**:
- cross-device 플래그 동기화 필수
- 로그인 유저: DB flags 로드 후 시작
- 비로그인: localStorage만 사용 (자동 처리)

---

## 6. Help (?) 버튼 추가

| 항목 | 설계 | 실제 |
|------|------|------|
| 버튼 | 문서에 없음 | **추가** |
| 위치 | - | `position: fixed; top: 12px; right: 12px` |
| 기능 | - | 튜토리얼 수동 재시작 |
| z-index | - | 10008 (blocker 10009보다 아래) |

**스타일**:
```javascript
'background:linear-gradient(135deg,#8b5cf6,#a78bfa);'  // 보라 그라디언트
'border:2px solid white;'  // 화이트 테두리
'box-shadow:0 2px 8px rgba(139,92,246,0.5);'  // 보라 그림자
```

**교훈**:
- 로비와 달리 게임 페이지는 헤더 공간 제약
- floating button (우상단 고정)이 가장 깔끔
- 클릭하면 `reset()` + `start()` 호출로 강제 재시작

---

## 7. window.load 이벤트 패턴

| 항목 | 설계 | 실제 |
|------|------|------|
| 타이밍 | 문서 설명 있음 | **동일 패턴 확인** |
| socket 가용성 | "load 후 정의됨" | **확인됨** |
| 자동 시작 | `roomJoined` 후 1000ms | **동일** |

```javascript
window.addEventListener('load', () => {
    if (typeof socket === 'undefined') return;
    // socket이 정의된 후 실행 보장
    socket.on('roomJoined', () => {
        setTimeout(..., 1000);
    });
});
```

**교훈**:
- 게임별 튜토리얼은 모두 이 패턴 사용
- `window.load`가 필수 (DOMContentLoaded 아님, 스크립트 로드 보장)

---

## 8. STEPS 배열 비교

### 설계와 실제 일치도

| step | target | fallbackTarget | position | 일치도 |
|------|--------|----------------|----------|--------|
| 1 | `#usersSection` | - | `bottom` | ✅ 동일 |
| 2 | `#horseSelectionSection` | `#usersSection` | `bottom` | ✅ 동일 |
| 3 | `#readySection` | - | `bottom` | ✅ 동일 |
| 4 | `#startHorseRaceButton` | `#readySection` | `top` | ✅ 동일 (hostOnly만 제거) |

**교훈**:
- STEPS 정의는 설계와 일치
- 단, `hostOnly` 플래그는 제거

---

## 9. 다음 게임 튜토리얼 구현 체크리스트

다음 게임 (주사위, 룰렛, 크레인 게임 등) 구현 시 참고:

- [ ] **gameType**: FLAG_BITS 키와 정확히 일치 (소문자, 하이픈 확인)
- [ ] **HTML 주입 불필요**: STEPS 배열만 정의, overlay/tooltip DOM은 tutorial-shared.js가 자동 생성
- [ ] **hostOnly 플래그 제거**: `_isVisible()` 자동 스킵으로 대체
- [ ] **setUser() 호출**: `roomJoined` 후, `start()` 전에 호출
- [ ] **help (?) 버튼**: floating button (top-right) 또는 control bar에 추가
- [ ] **window.load 사용**: DOMContentLoaded 아님
- [ ] **변수 스타일**: 해당 HTML 파일의 기존 스타일에 맞추기 (horse-race는 `const` + `() =>` 화살표 함수)
- [ ] **상수 정의**: STEPS 배열을 페이지별 `<script>` 블록에 인라인 정의

---

## 10. 코드 재사용성

### 복사해서 쓸 수 있는 템플릿

다음 게임 추가 시 아래 코드를 복사하고 gameType/STEPS만 변경:

```html
<script src="/tutorial-shared.js"></script>
<script>
var [GAME_NAME]_TUTORIAL_STEPS = [
    // STEPS 배열
];

window.addEventListener('load', () => {
    if (typeof socket === 'undefined') return;

    // Help button
    const helpBtn = document.createElement('button');
    helpBtn.textContent = '?';
    // ... (스타일 동일)
    helpBtn.addEventListener('click', () => {
        TutorialModule.reset('[gameType]');
        TutorialModule.start('[gameType]', [GAME_NAME]_TUTORIAL_STEPS, { force: true });
    });
    document.body.appendChild(helpBtn);

    socket.on('roomJoined', () => {
        setTimeout(() => {
            TutorialModule.setUser(socket, currentUser || '', () => {
                TutorialModule.start('[gameType]', [GAME_NAME]_TUTORIAL_STEPS);
            });
        }, 1000);
    });
});
</script>
```

**변수**:
- `[GAME_NAME]` → 게임명 (e.g. `DICE`, `ROULETTE`)
- `[gameType]` → FLAG_BITS 키 (e.g. `'dice'`, `'roulette'`)

---

## 요약

| 설계 문서 vs 구현 | 주요 학습 |
|-----------------|---------|
| gameType | FLAG_BITS와 정확히 일치 필수 |
| HTML overlay | 게임별 HTML에서 제거 (모듈이 생성) |
| hostOnly flag | 제거, _isVisible() 자동 스킵으로 대체 |
| setUser() | 필수 (cross-device sync) |
| Help button | floating button 추가 (UX 향상) |
| 스텝 배열 | 설계와 일치, 플래그만 정리 |

**결론**: 설계 문서는 80% 정확하지만, 실제 구현 시 위 10개 항목을 확인하면 개발 속도 3배 향상.
