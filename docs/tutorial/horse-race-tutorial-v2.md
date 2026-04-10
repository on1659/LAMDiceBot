# Horse Race Tutorial v2 — Fix & Enhancement

> **File to modify**: `horse-race-multiplayer.html`, `tutorial-shared.js`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Implemented (2026-03-07)
> **Previous version**: [horse-race-tutorial.md](horse-race-tutorial.md)

---

## v1 Issues (from live testing)

| # | Issue | Category |
|---|-------|----------|
| 1 | ? 버튼이 화면 우상단 고정이라 잘 안보임 | UX |
| 2 | 최초 입장 시 자동 준비 안내 없음 | Content |
| 3 | Step 1: "각 플레이어가 말 한 마리를 담당" — 실제로는 말을 골라 참가하는 구조 | Content |
| 4 | Step 2/3 순서가 실제 플로우와 다름 (준비 → 탈것 선택인데 반대로 되어있음) | Order |
| 5 | Step 2: "각 탈것마다 고유한 특성" — 실제로 특성 차이 없음 | Content |
| 6 | Step 2(탈것 선택): 화면 아래에 있어 스포트라이트/툴팁 안보임 | Scroll |
| 7 | Step 4(경마 시작): 화면 아래라 아예 안보임 | Scroll |
| 8 | 4단계 이후 추가 안내 스텝 없음 (주문, 채팅, 기록 등) | Content |
| 9 | 닫기(X) 버튼이 가운데로 보임 (우측이어야 함) | UX |

---

## Fix 1: ? 버튼 위치 변경

**Before**: `position:fixed; top:12px; right:12px` (화면 우상단 고정, 다른 UI와 겹침)

**After**: `#usersSection .users-title` 라인 맨 오른쪽에 인라인 배치

```javascript
// helpBtn append 대상 변경
const titleEl = document.querySelector('#usersSection .users-title');
if (titleEl) {
    titleEl.style.display = 'flex';
    titleEl.style.alignItems = 'center';
    helpBtn.style.cssText = [
        'margin-left:auto; width:24px; height:24px; border-radius:50%;',
        'background:linear-gradient(135deg,#8b5cf6,#a78bfa);',
        'color:white; border:1px solid white; cursor:pointer;',
        'font-weight:bold; font-size:12px; line-height:1;',
        'box-shadow:0 2px 6px rgba(139,92,246,0.4); flex-shrink:0;'
    ].join('');
    titleEl.appendChild(helpBtn);
}
```

**Result**: "접속자 (N명)" 라인 우측에 ? 버튼 표시

---

## Fix 2-5: STEPS Array 수정 (내용 + 순서)

### v1 → v2 변경 요약

| Step | v1 | v2 |
|------|----|----|
| 1 | 참여자 목록: "각 플레이어가 말 한 마리를 담당" | 참여자 목록: "준비 후 원하는 탈것을 골라 레이스에 참가하세요" |
| 2 | 탈것 선택: "각 탈것마다 고유한 특성" | **준비하기**: "최초 입장 시 자동으로 준비됩니다" |
| 3 | 준비하기 | **탈것 선택**: "선택한 탈것이 레이스에서 나를 대신해 달립니다" |
| 4 | 경마 시작 (유지) | 경마 시작 (유지) |
| 5 | (없음) | **주문받기**: 주문 기능 안내 |
| 6 | (없음) | **채팅 & 랭킹**: 채팅/랭킹 안내 |

### Updated STEPS Array

```javascript
var HORSE_RACE_TUTORIAL_STEPS = [
    {
        target: '#usersSection',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 표시됩니다. 준비 후 원하는 탈것을 골라 레이스에 참가하세요.',
        position: 'bottom'
    },
    {
        target: '#readySection',
        title: '2단계: 준비하기',
        content: '"준비" 버튼을 눌러주세요. 최초 입장 시에는 자동으로 준비됩니다. 모든 참가자가 준비되면 게임을 시작할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#horseSelectionSection',
        title: '3단계: 탈것 선택',
        content: '원하는 탈것을 선택하세요. 선택한 탈것이 레이스에서 나를 대신해 달립니다.',
        position: 'bottom',
        fallbackTarget: '#readySection'
    },
    {
        target: '#startHorseRaceButton',
        title: '4단계: 경마 시작',
        content: function() {
            return window.isHost
                ? '이 버튼을 누르면 레이스가 시작됩니다! 서버가 공정하게 순위를 결정합니다.'
                : '이 버튼은 방장(Host)만 사용할 수 있습니다. 방장이 시작하면 레이스가 진행됩니다.';
        },
        position: 'top',
        fallbackTarget: '#readySection'
    },
    {
        target: '#ordersSection',
        title: '5단계: 주문받기',
        content: '레이스 전에 음식 주문을 받을 수 있습니다. 내 주문을 입력하고 저장하세요.',
        position: 'bottom'
    },
    {
        target: '.chat-section',
        title: '6단계: 채팅 & 랭킹',
        content: '채팅으로 다른 참가자와 대화하세요. 랭킹 버튼으로 전체 순위를 확인할 수 있습니다.',
        position: 'top'
    }
];
```

---

## Fix 6-7: scrollIntoView (tutorial-shared.js)

**Problem**: 타겟 요소가 뷰포트 밖일 때 스포트라이트/툴팁이 보이지 않음

**Solution**: `_showStep()`에서 뷰포트 밖이면 scrollIntoView 호출 후 위치 재계산

**Status**: Implemented (2026-03-07)

```javascript
// _showStep() 내부
var rect = el.getBoundingClientRect();
var vh = window.innerHeight;
if (rect.top < 0 || rect.bottom > vh) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function() { _positionStep(idx, el); }, 400);
    return;
}
_positionStep(idx, el);
```

기존 `_showStep()`의 하이라이트/툴팁 배치 로직을 `_positionStep()` 함수로 분리.

---

## Fix 9: X 버튼 좌측 정렬

**Before**: `.tutorial-btn-close { position:absolute; top:8px; right:10px; }` — 우측 배치였으나 가운데로 보이는 문제

**Fix**: `right:10px` → `left:10px`으로 변경, `.tutorial-tooltip-title`에 `padding-left: 24px` 추가

```css
.tutorial-btn-close { position:absolute; top:8px; left:10px; }
.tutorial-tooltip-title { padding-left: 24px; }
```

## Fix 10: Step 4 non-host 안내 메시지

**Problem**: non-host는 경마 시작 버튼이 보이지 않아 fallback으로 readySection을 가리키지만, 내용이 "Host가 이 버튼을 누르면..." 으로 혼동 유발

**Fix**: `content`를 함수로 변경, `window.isHost` 기반 분기
- Host: "이 버튼을 누르면 레이스가 시작됩니다!"
- Non-host: "이 버튼은 방장(Host)만 사용할 수 있습니다. 방장이 시작하면 레이스가 진행됩니다."

---

## Element IDs (Updated)

| ID / Selector | Description | Tutorial Step |
|--------------|-------------|---------------|
| `#usersSection` | 참여자 목록 | Step 1 |
| `#readySection` | 준비 섹션 | Step 2 |
| `#horseSelectionSection` | 탈것 선택 | Step 3 |
| `#startHorseRaceButton` | 경마 시작 (Host only) | Step 4 (auto-skip for non-host) |
| `#ordersSection` | 주문받기 | Step 5 |
| `.chat-section` | 채팅 & 랭킹 | Step 6 |

---

## Integration Code (v2)

```html
<script src="/tutorial-shared.js"></script>
<script>
var HORSE_RACE_TUTORIAL_STEPS = [
    {
        target: '#usersSection',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 표시됩니다. 준비 후 원하는 탈것을 골라 레이스에 참가하세요.',
        position: 'bottom'
    },
    {
        target: '#readySection',
        title: '2단계: 준비하기',
        content: '"준비" 버튼을 눌러주세요. 최초 입장 시에는 자동으로 준비됩니다. 모든 참가자가 준비되면 게임을 시작할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#horseSelectionSection',
        title: '3단계: 탈것 선택',
        content: '원하는 탈것을 선택하세요. 선택한 탈것이 레이스에서 나를 대신해 달립니다.',
        position: 'bottom',
        fallbackTarget: '#readySection'
    },
    {
        target: '#startHorseRaceButton',
        title: '4단계: 경마 시작',
        content: function() {
            return window.isHost
                ? '이 버튼을 누르면 레이스가 시작됩니다! 서버가 공정하게 순위를 결정합니다.'
                : '이 버튼은 방장(Host)만 사용할 수 있습니다. 방장이 시작하면 레이스가 진행됩니다.';
        },
        position: 'top',
        fallbackTarget: '#readySection'
    },
    {
        target: '#ordersSection',
        title: '5단계: 주문받기',
        content: '레이스 전에 음식 주문을 받을 수 있습니다. 내 주문을 입력하고 저장하세요.',
        position: 'bottom'
    },
    {
        target: '.chat-section',
        title: '6단계: 채팅 & 랭킹',
        content: '채팅으로 다른 참가자와 대화하세요. 랭킹 버튼으로 전체 순위를 확인할 수 있습니다.',
        position: 'top'
    }
];

window.addEventListener('load', () => {
    if (typeof socket === 'undefined') return;

    // Help button: ? (inline, users-title right side)
    const helpBtn = document.createElement('button');
    helpBtn.textContent = '?';
    helpBtn.title = '게임 튜토리얼 보기';
    helpBtn.style.cssText = [
        'margin-left:auto; width:24px; height:24px; border-radius:50%;',
        'background:linear-gradient(135deg,#8b5cf6,#a78bfa);',
        'color:white; border:1px solid white; cursor:pointer;',
        'font-weight:bold; font-size:12px; line-height:1;',
        'box-shadow:0 2px 6px rgba(139,92,246,0.4); flex-shrink:0;'
    ].join('');
    helpBtn.addEventListener('click', () => {
        TutorialModule.reset('horse');
        TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS, { force: true });
    });
    const titleEl = document.querySelector('#usersSection .users-title');
    if (titleEl) {
        titleEl.style.display = 'flex';
        titleEl.style.alignItems = 'center';
        titleEl.appendChild(helpBtn);
    }

    // Auto-start on room join
    socket.on('roomJoined', () => {
        setTimeout(() => {
            TutorialModule.setUser(socket, currentUser || '', () => {
                TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS);
            });
        }, 1000);
    });
});
</script>
```

---

## Verification

### 1. Step flow check
1. 방 입장 → 1초 후 튜토리얼 자동 시작
2. Step 1: 참여자 목록 하이라이트 + 스크롤 불필요 (상단)
3. Step 2: 준비 섹션 하이라이트
4. Step 3: 탈것 선택 → **scrollIntoView 동작 확인**
5. Step 4: 경마 시작 → Host만 표시, Non-host auto-skip
6. Step 5: 주문받기 → scrollIntoView 동작 확인
7. Step 6: 채팅 & 랭킹 → scrollIntoView 동작 확인

### 2. ? button position
- 접속자 (N명) 라인 맨 오른쪽에 인라인 표시
- 클릭 시 튜토리얼 재시작

### 3. X button position
- 툴팁 우상단에 위치, title과 겹치지 않음

### 4. Cross-device sync
```javascript
localStorage.getItem('tutorialSeen_horse'); // → 'v1' after completion
// gameType: 'horse' → FLAG_BITS.horse = 8
```
