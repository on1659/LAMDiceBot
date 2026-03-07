# Horse Race Game Tutorial Steps

> **File to modify**: `horse-race-multiplayer.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Superseded by [horse-race-tutorial-v2.md](horse-race-tutorial-v2.md) (2026-03-07)

---

## Special Notes

### horse-race.js Separation

`horse-race-multiplayer.html` delegates all socket handling to `js/horse-race.js`.
To avoid modifying that file, add a **separate `socket.on('roomJoined', ...)` listener** directly in the HTML.

> `window.addEventListener('load', ...)` ensures `socket` variable is defined by `horse-race.js` first.
> **IMPORTANT**: Use gameType `'horse'` (not `'horse-race'`) to match `FLAG_BITS` for DB flag synchronization.

### Key Implementation Patterns

**Based on actual implementation** (see [diff/lobby-implementation-diff.md](diff/lobby-implementation-diff.md)):
- HTML overlay divs **NOT needed** — `tutorial-shared.js` auto-creates them
- Buttons: **✕ Close + ← Prev + Next** (not "skip + next")
- `hostOnly` flag is **ignored** — use `_isVisible()` auto-skip instead (hidden elements auto-skip)
- **`setUser()`** MUST be called to load DB flags (cross-device support)
- gameType: **`'horse'`** matches `FLAG_BITS.horse = 8`

---

## Tutorial Steps

| # | target | title | position | visibility | notes |
|---|--------|-------|----------|-----------|-------|
| 1 | `#usersSection` | 1단계: 참여자 목록 | `bottom` | Always visible | 방 참여자 목록 |
| 2 | `#horseSelectionSection` | 2단계: 탈것 선택 | `bottom` | Always visible | 말/탈것 선택 영역 |
| 3 | `#readySection` | 3단계: 준비하기 | `bottom` | Always visible | 준비 버튼 섹션 |
| 4 | `#startHorseRaceButton` | 4단계: 경마 시작 | `top` | **Host only** (inside `#hostControls`, display:none for non-host) | Auto-skip via `_isVisible()` |

---

## STEPS Array

```javascript
var HORSE_RACE_TUTORIAL_STEPS = [
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
        fallbackTarget: '#readySection'
        // Note: hostOnly flag is ignored by tutorial-shared.js
        // Non-host auto-skip: #startHorseRaceButton is inside #hostControls (display:none) → _isVisible() returns false
    }
];
```

> **IMPORTANT**: Do NOT use `hostOnly: true` — `_isVisible()` automatically skips hidden elements.
> Since `#startHorseRaceButton` is inside `#hostControls` (display:none for non-hosts), it auto-skips.

---

## Integration Code (add before `</body>`, AFTER `<script src="/js/horse-race.js">`)

**DO NOT add HTML overlay divs** — `tutorial-shared.js` auto-creates them.

```html
<script src="/tutorial-shared.js"></script>
<script>
var HORSE_RACE_TUTORIAL_STEPS = [
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
        content: '탈것을 선택하고 "준비" 버튼을 클릭하세요. 모든 참가자가 준비되면 경마가 시작됩니다.',
        position: 'bottom'
    },
    {
        target: '#startHorseRaceButton',
        title: '4단계: 경마 시작',
        content: 'Host가 이 버튼을 누르면 말들이 출발합니다! 서버가 공정하게 순위를 결정합니다.',
        position: 'top',
        fallbackTarget: '#readySection'
    }
];

window.addEventListener('load', () => {
    if (typeof socket === 'undefined') return;

    // Help button: ? (top-right, floating)
    const helpBtn = document.createElement('button');
    helpBtn.textContent = '?';
    helpBtn.title = '게임 튜토리얼 보기';
    helpBtn.style.cssText = [
        'position:fixed; top:12px; right:12px; z-index:10008;',
        'width:32px; height:32px; border-radius:50%;',
        'background:linear-gradient(135deg,#8b5cf6,#a78bfa);',
        'color:white; border:2px solid white; cursor:pointer;',
        'font-weight:bold; font-size:14px; line-height:1;',
        'box-shadow:0 2px 8px rgba(139,92,246,0.5);'
    ].join('');
    helpBtn.addEventListener('click', () => {
        TutorialModule.reset('horse');
        TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS, { force: true });
    });
    document.body.appendChild(helpBtn);

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

**Key differences from old design**:
- gameType: `'horse'` (not `'horse-race'`) — matches `FLAG_BITS.horse = 8` for DB sync
- No HTML overlay divs — auto-created by `tutorial-shared.js`
- Button labels auto-managed: ✕ Close + ← Prev + Next (not "skip + next")
- `setUser()` call — loads flags from server for cross-device support
- Help button (?) added for manual tutorial re-trigger

---

## Key Element IDs (from horse-race-multiplayer.html)

| ID | Description | Visible for |
|----|-------------|-------------|
| `#usersSection` | 참여자 목록 컨테이너 | All |
| `#horseSelectionSection` | 탈것 선택 영역 | All (after room join) |
| `#readySection` | 준비 버튼 포함 섹션 | All |
| `#readyButton` | 준비/준비취소 버튼 | All |
| `#startHorseRaceButton` | 경마 시작 버튼 | **Host only** (inside `#hostControls`) |

> Note: `#horseSelectionSection`은 항상 렌더링되어 있음 (display:none 아님). 다만 내부 콘텐츠(탈것 목록)는 동적으로 채워짐. `fallbackTarget`은 예외 처리용 안전장치.

---

## Element Visibility & Auto-skip

**Auto-skip logic** (from `_isVisible()` in `tutorial-shared.js`):
- Element is hidden (display:none, visibility:hidden, or 0 width/height) → `_isVisible()` returns false → step skipped
- Element is visible → proceed to this step

**For horse-race game**:
- `#startHorseRaceButton` is inside `#hostControls` which is `display: none` for non-hosts
  - Non-host: `_isVisible()` returns false → auto-skip to completion
  - Host: visible → shows step 4
- `#horseSelectionSection` is always rendered (not display:none)
  - `fallbackTarget: '#usersSection'` is a safety net if section content is empty

**Key takeaway**: No `hostOnly` flag needed — visibility check handles role-based filtering automatically.

---

## Verification

### 1. First-time auto-start
1. Fresh room join on horse-race page
2. Tutorial should auto-start after 1000ms (after room join)
3. User sees: spotlight on `#usersSection` → step 1 (title + content)
4. Click "다음 →" (next) button → step 2, etc.
5. On completion → tooltip/highlight hidden, `tutorialSeen_horse` localStorage set

### 2. Force-show for testing (paste in browser console)

```javascript
// Reset and force-show (overrides localStorage/DB flags)
TutorialModule.reset('horse');
TutorialModule.start('horse', HORSE_RACE_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. Dark spotlight overlay appears (z-index 10009)
2. `#usersSection` highlighted with spotlight → step 1/4
3. Click prev/next — step counter updates
4. Non-host: step 4 (`#startHorseRaceButton`) auto-skips (hidden element)
5. Host: step 4 displays normally
6. Click close (✕) button → all hidden, tutorial marked complete
7. Click ? button (top-right) → restart tutorial

### 3. Cross-device flag sync
```javascript
// Check localStorage
localStorage.getItem('tutorialSeen_horse'); // → 'v1' after completion

// Check server flags (if logged in)
socket.emit('getUserFlags', { name: 'userName' }, function(res) {
    console.log(res.flags); // & 8 should be set if 'horse' tutorial completed
});
```

> **gameType**: `'horse'` (matches `FLAG_BITS.horse = 8`)
> **Storage key**: `tutorialSeen_horse`
