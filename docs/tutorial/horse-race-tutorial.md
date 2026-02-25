# Horse Race Game Tutorial Steps

> **File to modify**: `horse-race-multiplayer.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Not yet implemented

---

## Special Notes

### horse-race.js Separation

`horse-race-multiplayer.html` delegates all socket handling to `js/horse-race.js`.
To avoid modifying that file, add a **separate `socket.on('roomJoined', ...)` listener** directly in the HTML.

```html
<script src="/tutorial-shared.js"></script>
<script>
// Add AFTER horse-race.js is loaded
// Do NOT modify js/horse-race.js
window.addEventListener('load', function() {
    if (typeof socket !== 'undefined') {
        socket.on('roomJoined', function() {
            setTimeout(function() {
                TutorialModule.start('horse-race', HORSE_RACE_TUTORIAL_STEPS);
            }, 1000);
        });
    }
});
</script>
```

> `window.addEventListener('load', ...)` ensures `socket` variable is defined by `horse-race.js` first.

---

## Tutorial Steps

| # | target | title | position | hostOnly | notes |
|---|--------|-------|----------|----------|-------|
| 1 | `#usersSection` | 1단계: 참여자 목록 | `bottom` | false | 방 참여자 표시 |
| 2 | `#horseSelectionSection` | 2단계: 탈것 선택 | `bottom` | false | 말/탈것 캐릭터 선택 영역 |
| 3 | `#readySection` | 3단계: 준비하기 | `bottom` | false | 준비 버튼 포함 섹션 |
| 4 | `#startHorseRaceButton` | 4단계: 경마 시작 (Host만) | `top` | **true** | 비호스트 자동 스킵 |

---

## STEPS Array

```javascript
const HORSE_RACE_TUTORIAL_STEPS = [
    {
        target: '#usersSection',
        title: '1단계: 참여자 목록',
        content: '방에 참여한 플레이어들이 표시됩니다. 각 플레이어가 말 한 마리를 담당합니다.',
        position: 'bottom'
    },
    {
        target: '#horseSelectionSection',
        title: '2단계: 탈것 선택',
        content: '원하는 말(탈것)을 선택하세요. 각 탈것마다 고유한 특성이 있습니다.',
        position: 'bottom',
        fallbackTarget: '#usersSection'
    },
    {
        target: '#readySection',
        title: '3단계: 준비하기',
        content: '탈것을 선택하고 \"준비\" 버튼을 클릭하세요. 모든 참가자가 준비되면 경마가 시작됩니다.',
        position: 'bottom'
    },
    {
        target: '#startHorseRaceButton',
        title: '4단계: 경마 시작',
        content: 'Host가 이 버튼을 누르면 말들이 출발합니다! 서버가 공정하게 순위를 결정합니다.',
        position: 'top',
        hostOnly: true,
        fallbackTarget: '#readySection'
    }
];
```

---

## Integration Code (add before `</body>`, AFTER `<script src="js/horse-race.js">`)

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
    const HORSE_RACE_TUTORIAL_STEPS = [/* see above */];

    // Use 'load' event to ensure horse-race.js socket is initialized first
    window.addEventListener('load', function() {
        if (typeof socket !== 'undefined') {
            socket.on('roomJoined', function() {
                setTimeout(function() {
                    TutorialModule.start('horse-race', HORSE_RACE_TUTORIAL_STEPS);
                }, 1000);
            });
        }
    });
})();
</script>
```

---

## Key Element IDs (from horse-race-multiplayer.html)

| ID | Description | Visible for |
|----|-------------|-------------|
| `#usersSection` | 참여자 목록 컨테이너 | All |
| `#horseSelectionSection` | 탈것 선택 영역 | All (after room join) |
| `#readySection` | 준비 버튼 포함 섹션 | All |
| `#readyButton` | 준비/준비취소 버튼 | All |
| `#startHorseRaceButton` | 경마 시작 버튼 | **Host only** (inside `#hostControls`) |

> Note: `#horseSelectionSection` may have `display:none` before a vehicle is available. Use `fallbackTarget: '#usersSection'` as safety.

---

## display:none Handling

- `#startHorseRaceButton` inside `#hostControls` → hidden for non-hosts → auto-skip
- `#horseSelectionSection` may be hidden initially → `fallbackTarget: '#usersSection'` fallback

---

## Verification

```javascript
// Force-show horse-race tutorial (paste in browser console on horse-race page)
TutorialModule.reset('horse-race');
TutorialModule.start('horse-race', HORSE_RACE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Dark overlay appears
2. `#usersSection` highlighted → step 1
3. `#horseSelectionSection` → step 2 (or fallback to `#usersSection` if hidden)
4. `#readySection` → step 3
5. `#startHorseRaceButton`: host sees step 4, non-host skips to completion
6. `localStorage.getItem('tutorialSeen_horse-race')` → `'v1'` after completion
