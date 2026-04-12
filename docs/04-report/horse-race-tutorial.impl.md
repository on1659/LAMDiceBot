# Horse Race Tutorial — Implementation Document

> **Summary**: 경마 게임 페이지에 튜토리얼 시스템 통합
>
> **Date**: 2026-03-06
> **Status**: Implemented
> **Design Doc**: [horse-race-tutorial.md](../tutorial/horse-race-tutorial.md)
> **Diff Analysis**: [horse-race-implementation-diff.md](../tutorial/diff/horse-race-implementation-diff.md)

---

## 1. Overview

### 1.1 목적

경마 게임(`horse-race-multiplayer.html`)에 첫 방문 사용자를 위한 인터랙티브 튜토리얼을 추가한다. 공통 모듈 `tutorial-shared.js`를 활용하여 4단계 가이드를 제공하고, cross-device DB flag 동기화를 지원한다.

### 1.2 설계 원칙

- **js/horse-race.js 수정 금지** — HTML 내 별도 스크립트 블록으로 분리
- **공통 모듈 재사용** — tutorial-shared.js의 기존 API만 사용
- **설계 문서 vs 실제 구현 차이 반영** — lobby 구현에서 확인된 패턴 적용

---

## 2. Architecture

### 2.1 Component Diagram

```
horse-race-multiplayer.html
├── js/horse-race.js          (기존, 수정 안 함)
│   └── socket, currentUser, isHost 전역 변수 제공
├── tutorial-shared.js         (기존, 수정 안 함)
│   └── TutorialModule { start, reset, shouldShow, setUser, FLAG_BITS }
└── <script> inline            (신규 추가)
    ├── HORSE_RACE_TUTORIAL_STEPS[]   (4단계 정의)
    ├── Help button (?)               (DOM 동적 생성)
    └── roomJoined → setUser → start  (자동 시작 로직)
```

### 2.2 Data Flow

```
페이지 로드
  └→ window.load 이벤트
       ├→ Help (?) 버튼 DOM 생성 → body에 추가
       └→ socket.on('roomJoined') 등록
            └→ 1000ms 대기
                 └→ TutorialModule.setUser(socket, currentUser)
                      └→ socket.emit('getUserFlags') → DB flags 로드
                           └→ TutorialModule.start('horse', STEPS)
                                ├→ _hasSeen('horse') 체크
                                │   ├→ DB flag (bit 8) OR localStorage
                                │   └→ 이미 봤으면 → 종료
                                └→ 처음이면 → spotlight + tooltip 표시
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| Tutorial init script | `socket` (horse-race.js) | Socket.IO 이벤트 리스닝 |
| Tutorial init script | `currentUser` (horse-race.js) | 사용자명 전달 |
| Tutorial init script | `TutorialModule` (tutorial-shared.js) | 튜토리얼 엔진 |
| TutorialModule.setUser | Socket server `getUserFlags` | DB flag 로드 |
| TutorialModule._complete | Socket server `setGuideComplete` | DB flag 저장 |

---

## 3. 구현 상세

### 3.1 수정 파일 목록

| File | Action | Lines |
|------|--------|-------|
| `horse-race-multiplayer.html` | Modified | +62 lines (677-739) |
| `docs/tutorial/horse-race-tutorial.md` | Updated | 설계 문서 갱신 |
| `docs/tutorial/diff/horse-race-implementation-diff.md` | Created | diff 분석 |

### 3.2 Tutorial Steps 정의

```javascript
var HORSE_RACE_TUTORIAL_STEPS = [
    { target: '#usersSection',           title: '1단계: 참여자 목록',  position: 'bottom' },
    { target: '#horseSelectionSection',  title: '2단계: 탈것 선택',    position: 'bottom', fallbackTarget: '#usersSection' },
    { target: '#readySection',           title: '3단계: 준비하기',     position: 'bottom' },
    { target: '#startHorseRaceButton',   title: '4단계: 경마 시작',    position: 'top',    fallbackTarget: '#readySection' }
];
```

### 3.3 Element Visibility (Auto-skip 동작)

| Step | Target | Host | Non-host |
|------|--------|------|----------|
| 1 | `#usersSection` | visible → 표시 | visible → 표시 |
| 2 | `#horseSelectionSection` | visible → 표시 | visible → 표시 |
| 3 | `#readySection` | visible → 표시 | visible → 표시 |
| 4 | `#startHorseRaceButton` | visible → 표시 | **hidden** (parent `#hostControls` display:none) → **auto-skip** |

### 3.4 Storage

| 저장소 | Key | Value | 용도 |
|--------|-----|-------|------|
| localStorage | `tutorialSeen_horse` | `'v1'` | 로컬 완료 플래그 |
| DB (PostgreSQL) | `guide_flags` bit 8 | `flags \| 8` | cross-device 동기화 |

### 3.5 Help (?) Button

```
위치: position:fixed; top:12px; right:12px
크기: 32x32px, border-radius:50%
색상: linear-gradient(135deg, #8b5cf6, #a78bfa)
z-index: 10008 (tutorial blocker 10009보다 아래)
동작: click → reset('horse') + start('horse', STEPS, { force: true })
```

---

## 4. 설계 문서와의 차이점 (Key Decisions)

### 4.1 gameType 변경

| 항목 | 설계 문서 (원본) | 구현 |
|------|-----------------|------|
| gameType | `'horse-race'` | `'horse'` |
| 이유 | — | `FLAG_BITS.horse = 8` 키와 일치시켜 DB 동기화 보장 |

### 4.2 HTML Overlay 제거

설계 문서에 포함되어 있던 HTML div 블록을 제거했다:
```html
<!-- 제거됨: tutorial-shared.js가 자동 생성 -->
<div id="tutorialOverlay" class="tutorial-overlay" style="display:none"></div>
<div id="tutorialTooltip" class="tutorial-tooltip" style="display:none">...</div>
```

### 4.3 hostOnly 플래그 제거

설계 문서의 `hostOnly: true` 플래그를 제거하고 `_isVisible()` 자동 스킵에 의존한다.
`#startHorseRaceButton`이 `#hostControls` (display:none) 안에 있으므로 비호스트는 자동 스킵된다.

### 4.4 setUser() 패턴 추가

설계 문서에 없던 `TutorialModule.setUser()` 호출을 추가했다:
```javascript
TutorialModule.setUser(socket, currentUser || '', () => {
    TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS);
});
```
이유: cross-device DB flag 동기화 (로그인 유저의 완료 상태를 다른 기기에서도 인식)

### 4.5 함수 스타일 통일

리뷰 과정에서 발견: 기존 코드는 화살표 함수(`() => {}`)를 사용하나, 초기 구현은 일반 함수(`function() {}`)를 사용했다.
CLAUDE.md 규칙("기존 스타일에 맞춘다")에 따라 화살표 함수로 통일했다.

### 4.6 Help (?) 버튼 추가

설계 문서에 없던 기능. lobby 튜토리얼의 패턴을 따라 추가했다.
사용자가 튜토리얼을 완료한 후에도 수동으로 재시작할 수 있도록 한다.

---

## 5. Timing Diagram

```
[Page Load]
    |
    v
[window.load fires]
    |
    ├─ socket defined? ─── No ──> return (exit)
    |                     Yes
    v
[Create ? button, append to body]
    |
[Register socket.on('roomJoined')]
    |
    ... (user joins room) ...
    |
[roomJoined event fires]
    |
    v
[setTimeout 1000ms]
    |
    v
[TutorialModule.setUser(socket, currentUser)]
    |
    ├─ userName exists? ─── No ──> _flagsLoaded=false, onReady()
    |                      Yes
    v
[socket.emit('getUserFlags')]
    |
    v
[Server returns flags]
    |
    v
[_serverFlags = flags, _flagsLoaded = true]
    |
    v
[onReady callback → TutorialModule.start('horse', STEPS)]
    |
    ├─ _hasSeen('horse')? ─── Yes ──> return (already seen)
    |                         No
    v
[Show spotlight + tooltip (step 1)]
    |
    ... (user clicks Next/Prev/Close) ...
    |
[_complete()]
    |
    ├─ localStorage.setItem('tutorialSeen_horse', 'v1')
    └─ socket.emit('setGuideComplete', { flagBit: 8 })
```

---

## 6. Review Results

3회 반복 리뷰 수행, 10개 관점 검토 완료:

| Round | 관점 | 결과 | 비고 |
|-------|------|------|------|
| 1 | Correctness | PASS | gameType, 로직 올바름 |
| 1 | Scope | PASS | 콜백 중첩 정상 |
| 1 | Missing Pattern | PASS | 다른 게임도 올바른 패턴 |
| 1 | Stale References | PASS | 삭제 항목 참조 없음 |
| 1 | Side Effects | PASS | 이벤트 독립적 |
| 2 | Performance | PASS | DOM 효율적 |
| 2 | Security | PASS | XSS 없음 |
| 2 | Maintainability | PASS | 명확한 코드 |
| 2 | Compatibility | PASS | ES6 (기존 스타일과 일치) |
| 2 | Consistency | **FIXED** | function() → () => 수정 |

**수정 건수**: 1건 (함수 스타일 통일)

---

## 7. Verification

### 7.1 Manual Test

| # | 시나리오 | 기대 결과 |
|---|----------|----------|
| 1 | 첫 접속 후 방 입장 | 1초 후 튜토리얼 자동 시작 |
| 2 | 다음 버튼 클릭 | step 1 → 2 → 3 → 4 (host) or 완료 (non-host) |
| 3 | 이전 버튼 클릭 | step 2 → 1 |
| 4 | 닫기 (X) 버튼 | 튜토리얼 종료, flag 저장 |
| 5 | ? 버튼 클릭 | 튜토리얼 강제 재시작 |
| 6 | 재접속 | 튜토리얼 미표시 (이미 완료) |
| 7 | 다른 기기에서 접속 (로그인) | 튜토리얼 미표시 (DB flag) |

### 7.2 Console Verification

```javascript
// 강제 표시
TutorialModule.reset('horse');
TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS, { force: true });

// 상태 확인
localStorage.getItem('tutorialSeen_horse');  // 'v1'
TutorialModule.shouldShow('horse');          // false
```

---

## 8. Next Steps (Future)

다음 게임 튜토리얼 구현 시 이 문서와 [diff/horse-race-implementation-diff.md](../tutorial/diff/horse-race-implementation-diff.md) Section 10의 템플릿을 참조한다.

| Game | gameType | FLAG_BITS | Status |
|------|----------|-----------|--------|
| Lobby | `'lobby'` | 1 | Implemented |
| Dice | `'dice'` | 2 | Not yet |
| Roulette | `'roulette'` | 4 | Not yet |
| **Horse Race** | **`'horse'`** | **8** | **Implemented** |
| Crane Game | `'crane'` | 16 | Not yet |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-06 | Initial implementation | Claude |
