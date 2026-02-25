# Dice Game Tutorial Steps

> **File to modify**: `dice-game-multiplayer.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Partially implemented — tutorial code block exists in HTML, verify steps match below

---

## Tutorial Steps

| # | target | title | position | hostOnly | notes |
|---|--------|-------|----------|----------|-------|
| 1 | `#usersSection` | 1단계: 참여자 목록 | `bottom` | false | 방에 있는 참가자들 |
| 2 | `#gameRulesInput` | 2단계: 게임 룰 확인 | `bottom` | false | Host가 설정한 게임 룰 표시됨 |
| 3 | `#readySection` | 3단계: 준비하기 | `bottom` | false | 준비 버튼 포함 섹션 |
| 4 | `#startButton` | 4단계: 게임 시작 (Host만) | `top` | **true** | 비호스트는 자동 스킵 |

---

## STEPS Array

```javascript
const DICE_TUTORIAL_STEPS = [
    {
        target: '#usersSection',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 여기에 표시됩니다. Host로 입장하면 게임을 제어할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#gameRulesInput',
        title: '2단계: 게임 룰',
        content: 'Host가 입력한 게임 룰이 표시됩니다. 주사위 최대값은 개인별로 설정할 수 있습니다. (2~100,000)',
        position: 'bottom'
    },
    {
        target: '#readySection',
        title: '3단계: 준비하기',
        content: '\"준비\" 버튼을 클릭하면 준비 완료! 모든 참가자가 준비되면 게임을 시작할 수 있습니다.',
        position: 'bottom'
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
        setTimeout(function() {
            TutorialModule.start('dice', DICE_TUTORIAL_STEPS);
        }, 1000);
    });
})();
</script>
```

---

## Key Element IDs (confirmed in dice-game-multiplayer.html)

| ID | Description | Visible for |
|----|-------------|-------------|
| `#usersSection` | 참여자 목록 컨테이너 | All |
| `#gameRulesInput` | 게임 룰 텍스트 입력/표시 | All |
| `#readySection` | 준비 버튼 포함 섹션 | All |
| `#readyButton` | 준비/준비취소 버튼 | All |
| `#startButton` | 게임 시작 버튼 | **Host only** (inside `#hostControls`) |
| `#diceIdleEmoji` | 주사위 대기 이모지 | All (after game start) |
| `#gameStatus` | 게임 상태 텍스트 | All |

---

## display:none Handling

- `#startButton` is inside `#hostControls` which is `display:none` for non-hosts
- `isVisible()` check returns `false` → step auto-skipped
- `fallbackTarget: '#gameStatus'` is used if host check needed (optional)

---

## Verification

```javascript
// Force-show dice tutorial (paste in browser console on dice page)
TutorialModule.reset('dice');
TutorialModule.start('dice', DICE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Dark overlay appears
2. `#usersSection` highlighted with purple pulse border
3. Tooltip appears below with title/content/buttons
4. "다음 →" advances to step 2, 3, 4 (step 4 skipped if non-host)
5. "건너뛰기" closes tutorial immediately
6. `localStorage.getItem('tutorialSeen_dice')` → `'v1'` after completion
