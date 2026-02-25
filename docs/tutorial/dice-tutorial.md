# Dice Game Tutorial Steps

> **File to modify**: `dice-game-multiplayer.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Partially implemented — tutorial code block exists in HTML, verify steps match below

---

## Tutorial Steps

| # | target | title | position | hostOnly | notes |
|---|--------|-------|----------|----------|-------|
| 1 | `.users-section` | 1단계: 참여자 목록 | `bottom` | false | id 없음 — class 선택자 사용 |
| 2 | `#gameRulesInput` | 2단계: 게임 룰 확인 | `bottom` | **true** | Host 전용 섹션 안에 있음, 비호스트 자동 스킵 |
| 3 | `#readySection` | 3단계: 준비하기 | `bottom` | false | 초기 display:none → 1500ms 딜레이 필요 |
| 4 | `#startButton` | 4단계: 게임 시작 (Host만) | `top` | **true** | 비호스트는 자동 스킵 |

---

## STEPS Array

```javascript
const DICE_TUTORIAL_STEPS = [
    {
        target: '.users-section',  // dice-game-multiplayer.html에 id="usersSection" 없음 → class 사용
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 여기에 표시됩니다. Host로 입장하면 게임을 제어할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#gameRulesInput',
        title: '2단계: 게임 룰',
        content: 'Host가 입력한 게임 룰이 표시됩니다. 주사위 최대값은 개인별로 설정할 수 있습니다. (2~100,000)',
        position: 'bottom',
        hostOnly: true  // #gameRulesInput은 host 전용 섹션(#gameRulesRadioSection) 안에 있음
    },
    {
        target: '#readySection',
        title: '3단계: 준비하기',
        content: '\"준비\" 버튼을 클릭하면 준비 완료! 모든 참가자가 준비되면 게임을 시작할 수 있습니다.',
        position: 'bottom'
        // ⚠️ 주사위 게임에서 #readySection은 display:none으로 시작 (line 1641)
        // roomJoined 후 initializeGameScreen()이 실행되면서 표시됨
        // 튜토리얼 딜레이를 1500ms 이상으로 설정 권장
    },
    {
        target: '#startButton',
        title: '4단계: 게임 시작',
        content: 'Host가 이 버튼을 누르면 모든 참가자가 주사위를 굴릴 수 있습니다!',
        position: 'top',
        hostOnly: true,
        fallbackTarget: '#gameStatus'
    }
];
```

---

## Integration Code (add before `</body>`)

> If the tutorial block already exists in `dice-game-multiplayer.html`, verify the STEPS match above. If different, update in place.

```html
<!-- Tutorial Overlay Elements -->
<div id="tutorialOverlay" class="tutorial-overlay" style="display:none"></div>
<div id="tutorialTooltip" class="tutorial-tooltip" style="display:none">
    <div class="tutorial-tooltip-arrow"></div>
    <div class="tutorial-tooltip-content">
        <div class="tutorial-tooltip-title"></div>
        <div class="tutorial-tooltip-body"></div>
        <div class="tutorial-tooltip-buttons">
            <button class="tutorial-btn-skip">건너뛰기</button>
            <button class="tutorial-btn-next">다음 →</button>
        </div>
        <div class="tutorial-tooltip-counter"></div>
    </div>
</div>

<script src="/tutorial-shared.js"></script>
<script>
(function() {
    const DICE_TUTORIAL_STEPS = [/* see above */];

    socket.on('roomJoined', function() {
        // 1500ms: #readySection이 display:none → initializeGameScreen() 완료 후 표시됨
        setTimeout(function() {
            TutorialModule.start('dice', DICE_TUTORIAL_STEPS);
        }, 1500);
    });
})();
</script>
```

---

## Key Element Selectors (dice-game-multiplayer.html)

| Selector | Description | Visible for | Note |
|----------|-------------|-------------|------|
| `.users-section` | 참여자 목록 컨테이너 | All | id 없음 — class 선택자 사용 |
| `#gameRulesInput` | 게임 룰 텍스트 입력 | Host only | `#gameRulesRadioSection` 안에 있음 (line 1573) |
| `#readySection` | 준비 버튼 포함 섹션 | All | 초기 display:none (line 1641), roomJoined 후 표시 |
| `#readyButton` | 준비/준비취소 버튼 | All | — |
| `#startButton` | 게임 시작 버튼 | Host only | `#hostControls` 안, display:none for non-hosts |
| `#diceIdleEmoji` | 주사위 대기 이모지 | All | game start 후 표시 |
| `#gameStatus` | 게임 상태 텍스트 | All | fallbackTarget 용도 |

---

## display:none Handling

- `.users-section` — 항상 표시 (id 없어서 class 선택자 사용)
- `#gameRulesInput` — `#gameRulesRadioSection` 안에 있어 비호스트는 숨겨짐 → `hostOnly: true` 로 자동 스킵
- `#readySection` — 주사위 게임에서 초기 `display:none` (line 1641). `roomJoined` 후 `initializeGameScreen()` 완료 시 표시됨 → 딜레이 1500ms 필요
- `#startButton` — `#hostControls` 안, 비호스트는 `display:none` → `isVisible()` false → 자동 스킵

---

## Verification

```javascript
// Force-show dice tutorial (paste in browser console on dice page)
TutorialModule.reset('dice');
TutorialModule.start('dice', DICE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Dark overlay appears
2. `.users-section` highlighted with purple pulse border → step 1
3. `#gameRulesInput` → step 2 (host only, non-host auto-skips)
4. `#readySection` → step 3
5. `#startButton` → step 4 (host only, non-host auto-skips)
6. "건너뛰기" closes tutorial immediately
7. `localStorage.getItem('tutorialSeen_dice')` → `'v1'` after completion
