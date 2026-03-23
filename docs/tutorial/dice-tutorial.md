# Dice Game Tutorial Steps

> **File to modify**: `dice-game-multiplayer.html`
> **Common module**: `tutorial-shared.js` (DOM auto-generated, no manual HTML needed)
> **Reference**: `horse-race-multiplayer.html` (line 738~924)
> **Status**: Not implemented

---

## Tutorial Steps

| # | target | title | position | Visible to | Notes |
|---|--------|-------|----------|-----------|-------|
| 1 | `.users-section` | 1단계: 참여자 목록 | `bottom` | All | class 선택자 (id 없음) |
| 2 | `#gameRulesSection` | 2단계: 게임 룰 | `bottom` | All | 전체 룰 섹션. 호스트: 라디오+textarea, 비호스트: textarea만 |
| 3 | `#readySection` | 3단계: 준비하기 | `bottom` | All | 초기 display:none → roomJoined 후 표시. 1500ms 딜레이 |
| 4 | `#startButton` | 4단계: 게임 시작 | `top` | Host only | `#hostControls` 안, 비호스트는 `_isVisible()` false → 자동 스킵 |
| 5 | `#diceIdleEmoji` | 5단계: 주사위 굴리기 | `top` | All | 채팅 입력 옆 🎲 아이콘. 항상 보임 |
| 6 | `#ordersSection` | 6단계: 주문받기 | `top` | All | 항상 보임 |
| 7 | `.chat-section` | 7단계: 채팅 | `top` | All | class 선택자 (id 없음) |
| 8 | `#rankingBtn` | 8단계: 랭킹 | `top` | All | ChatModule.init()이 자동 삽입 |

> **비호스트 경험**: Step 4(게임 시작)만 자동 스킵 → 7스텝 표시

---

## STEPS Array

```javascript
var DICE_TUTORIAL_STEPS = [
    {
        target: '.users-section',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 여기에 표시됩니다.',
        position: 'bottom'
    },
    {
        target: '#gameRulesSection',
        title: '2단계: 게임 룰',
        content: '게임 룰이 표시됩니다. 방장은 하이/로우/니어/기타 중 룰을 선택할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#readySection',
        title: '3단계: 준비하기',
        content: '"준비" 버튼을 클릭하면 준비 완료! 모든 참가자가 준비되면 방장이 게임을 시작할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#startButton',
        title: '4단계: 게임 시작',
        content: '이 버튼을 누르면 모든 참가자가 주사위를 굴릴 수 있습니다!',
        position: 'top'
    },
    {
        target: '#diceIdleEmoji',
        title: '5단계: 주사위 굴리기',
        content: '이 주사위 아이콘을 클릭하면 주사위를 굴릴 수 있습니다. 게임이 시작된 후에 클릭하세요!',
        position: 'top'
    },
    {
        target: '#ordersSection',
        title: '6단계: 주문받기',
        content: '방장이 주문받기를 시작하면 음식 주문을 입력할 수 있습니다. 메뉴 관리로 자주 쓰는 메뉴를 등록해보세요.',
        position: 'top'
    },
    {
        target: '.chat-section',
        title: '7단계: 채팅',
        content: '채팅으로 다른 참가자와 대화할 수 있습니다.',
        position: 'top'
    },
    {
        target: '#rankingBtn',
        title: '8단계: 랭킹',
        content: '이 버튼을 누르면 전체 순위를 확인할 수 있습니다.',
        position: 'top'
    }
];
```

---

## Integration Code (add before `</body>`)

> **No manual HTML overlay needed** — `tutorial-shared.js`의 `_inject()`가 highlight, blocker, Shadow DOM tooltip을 자동 생성합니다.

```html
<script src="/tutorial-shared.js?v=3"></script>
<script>
var DICE_TUTORIAL_STEPS = [/* see above */];

window.addEventListener('load', function() {
    if (typeof socket === 'undefined') return;

    // Help button: ? (inline, users-title right side)
    var helpBtn = document.createElement('button');
    helpBtn.textContent = '?';
    helpBtn.title = '게임 튜토리얼 보기';
    helpBtn.style.cssText = [
        'margin-left:auto; width:24px; height:24px; border-radius:50%;',
        'background:linear-gradient(135deg,#8b5cf6,#a78bfa);',
        'color:white; border:1px solid white; cursor:pointer;',
        'font-weight:bold; font-size:12px; line-height:1;',
        'box-shadow:0 2px 6px rgba(139,92,246,0.4); flex-shrink:0;'
    ].join('');
    helpBtn.addEventListener('click', function() {
        TutorialModule.reset('dice');
        TutorialModule.start('dice', DICE_TUTORIAL_STEPS, { force: true });
    });
    var titleEl = document.querySelector('.users-section .users-title');
    if (titleEl) {
        titleEl.style.display = 'flex';
        titleEl.style.alignItems = 'center';
        titleEl.appendChild(helpBtn);
    }

    // Auto-start on room join
    socket.on('roomJoined', function() {
        setTimeout(function() {
            TutorialModule.setUser(socket, currentUser || '', function() {
                TutorialModule.start('dice', DICE_TUTORIAL_STEPS);
            });
        }, 1500);
    });
});
</script>
```

---

## Key Element Selectors (dice-game-multiplayer.html)

| Selector | Description | Visible for | Note |
|----------|-------------|-------------|------|
| `.users-section` | 참여자 목록 컨테이너 | All | id 없음 — class 선택자 |
| `#gameRulesSection` | 게임 룰 전체 섹션 | All | 호스트: 라디오+textarea, 비호스트: textarea만 |
| `#gameRulesRadioSection` | 룰 선택 라디오 버튼 | Host only | `display:none` → 호스트+대기 시만 `block` |
| `#gameRulesInput` | 룰 텍스트 영역 (textarea) | All | 항상 보임, 호스트+대기 시만 편집 가능 |
| `#readySection` | 준비 버튼 포함 섹션 | All | 초기 `display:none`, roomJoined 후 표시 |
| `#readyButton` | 준비/준비취소 버튼 | All | — |
| `#hostControls` | 호스트 컨트롤 영역 | Host only | `display:none` → 호스트만 `grid` |
| `#startButton` | 게임 시작 버튼 | Host only | `#hostControls` 안 |
| `#diceIdleEmoji` | 주사위 🎲 아이콘 | All | 채팅 입력 옆, 클릭하면 주사위 굴림 |
| `#ordersSection` | 주문받기 섹션 | All | 항상 보임 |
| `.chat-section` | 채팅 섹션 | All | id 없음 — class 선택자 |
| `#rankingBtn` | 랭킹 버튼 | All | ChatModule.init()이 자동 삽입 |

---

## DOM Structure (게임 룰 섹션)

```
#gameRulesSection  (.game-rules-section)          — 항상 보임
├── .dice-settings-title                           — "📋 게임 룰"
├── #gameRulesRadioSection                         — display:none → 호스트+대기 시 block
│   ├── radio[value=high]   하이 - 낮은 사람이 걸림
│   ├── radio[value=low]    로우 - 높은 사람이 걸림
│   ├── radio[value=near]   니어 - N에 가까운 사람 걸리기
│   └── radio[value=custom] 기타 - 직접 룰 적기
├── .input-group
│   └── textarea#gameRulesInput                    — 항상 보임, 호스트+대기 시만 편집 가능
├── button#gameRulesSaveButton                     — display:none → 호스트만 inline-block
└── div (안내 텍스트)                               — "게임 시작 전에만 수정 가능합니다"
```

---

## display:none Handling

- `.users-section` — 항상 표시
- `#gameRulesSection` — 항상 표시 (자식 `#gameRulesRadioSection`만 호스트+대기 시 표시)
- `#gameRulesInput` — 항상 표시 (`#gameRulesRadioSection` **밖**에 위치, 모든 사용자에게 보임)
- `#readySection` — 초기 `display:none`. `roomJoined` → `initializeGameScreen()`에서 동기적으로 `display:block` → 1500ms 딜레이로 대응
- `#startButton` — `#hostControls` 안. 비호스트는 `hostControls`가 `display:none` → `_isVisible()` false → 자동 스킵
- `#diceIdleEmoji` — 항상 표시 (채팅 입력 옆)
- `#ordersSection` — 항상 표시
- `.chat-section` — 항상 표시
- `#rankingBtn` — ChatModule.init() 후 표시. 1500ms 딜레이 내에 생성됨

---

## Verification

```javascript
// Force-show dice tutorial (paste in browser console on dice page)
TutorialModule.reset('dice');
TutorialModule.start('dice', DICE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Highlight + tooltip on `.users-section` → step 1
2. `#gameRulesSection` → step 2 (호스트/비호스트 모두에게 표시)
3. `#readySection` → step 3
4. `#startButton` → step 4 (host only, 비호스트는 `_isVisible()` false → 자동 스킵)
5. `#diceIdleEmoji` → step 5
6. `#ordersSection` → step 6
7. `.chat-section` → step 7
8. `#rankingBtn` → step 8
9. "✕" (close button) closes tutorial immediately
10. `localStorage.getItem('tutorialSeen_dice')` → `'v1'` after completion
