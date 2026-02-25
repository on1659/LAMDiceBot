# Roulette Game Tutorial Steps

> **File to modify**: `roulette-game-multiplayer.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Not yet implemented

---

## Tutorial Steps

| # | target | title | position | hostOnly | notes |
|---|--------|-------|----------|----------|-------|
| 1 | `#usersSection` | 1단계: 참여자 목록 | `bottom` | false | 방 참여자 표시 |
| 2 | `#readySection` | 2단계: 준비하기 | `bottom` | false | 준비 버튼 포함 섹션 |
| 3 | `#rouletteContainer` | 3단계: 룰렛 휠 | `bottom` | false | 참가자 이름이 파이 차트로 표시 |
| 4 | `#startRouletteButton` | 4단계: 룰렛 시작 (Host만) | `top` | **true** | 비호스트 자동 스킵 |

---

## STEPS Array

```javascript
const ROULETTE_TUTORIAL_STEPS = [
    {
        target: '#usersSection',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 표시됩니다. 최소 2명 이상 준비되어야 룰렛을 시작할 수 있습니다.',
        position: 'bottom'
    },
    {
        target: '#readySection',
        title: '2단계: 준비하기',
        content: '\"준비\" 버튼을 클릭해 참여 의사를 밝히세요. 준비한 참가자만 룰렛에 포함됩니다.',
        position: 'bottom'
    },
    {
        target: '#rouletteContainer',
        title: '3단계: 룰렛 휠',
        content: '준비한 참가자들의 이름이 파이 차트 형태로 표시됩니다. 인원이 많을수록 각도가 좁아집니다.',
        position: 'bottom'
    },
    {
        target: '#startRouletteButton',
        title: '4단계: 룰렛 시작',
        content: 'Host가 이 버튼을 누르면 룰렛이 회전하여 당첨자를 결정합니다!',
        position: 'top',
        hostOnly: true,
        fallbackTarget: '#rouletteContainer'
    }
];
```

---

## Integration Code (add before `</body>`)

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
    const ROULETTE_TUTORIAL_STEPS = [/* see above */];

    socket.on('roomJoined', function() {
        setTimeout(function() {
            TutorialModule.start('roulette', ROULETTE_TUTORIAL_STEPS);
        }, 1000);
    });
})();
</script>
```

---

## Key Element IDs (from roulette-game-multiplayer.html)

| ID | Description | Visible for |
|----|-------------|-------------|
| `#usersSection` | 참여자 목록 컨테이너 | All |
| `#readySection` | 준비 버튼 포함 섹션 | All |
| `#readyButton` | 준비/준비취소 버튼 | All |
| `#rouletteContainer` | 룰렛 캔버스 컨테이너 | All |
| `#startRouletteButton` | 룰렛 시작 버튼 | **Host only** (inside `#hostControls`) |

---

## display:none Handling

- `#startRouletteButton` is inside `#hostControls` → hidden for non-hosts
- `isVisible()` → `false` → auto-skip to completion
- `fallbackTarget: '#rouletteContainer'` ensures non-hosts see a valid final step

---

## Verification

```javascript
// Force-show roulette tutorial (paste in browser console on roulette page)
TutorialModule.reset('roulette');
TutorialModule.start('roulette', ROULETTE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Dark overlay appears
2. `#usersSection` highlighted → step 1
3. `#readySection` → step 2
4. `#rouletteContainer` → step 3
5. `#startRouletteButton`: host sees step 4, non-host skips to completion
6. `localStorage.getItem('tutorialSeen_roulette')` → `'v1'` after completion
