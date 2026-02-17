# Control Bar Unification v3 — Implementation Document

**Recommended model**: Sonnet (all changes are specific file/line/code replacements)
**Scope**: 3 games (dice OK, roulette fix, horse fix). Crane excluded (pending removal).

---

## 1. Fix nickname display (roulette, horse)

**Root cause**: `updateControlBarUI()` references `window.myUserName` which is never set anywhere.

### File: `roulette-game-multiplayer.html` (line ~1126)

```js
// BEFORE:
if (usernameDisplay && window.myUserName) {
    usernameDisplay.textContent = window.myUserName;
    usernameDisplay.style.display = 'inline-block';
}

// AFTER:
if (usernameDisplay && currentUser) {
    usernameDisplay.textContent = currentUser;
    usernameDisplay.style.display = 'inline-block';
}
```

### File: `horse-race-multiplayer.html` (line ~568)

Same change: `window.myUserName` → `currentUser`

(`currentUser` is a global var in `js/horse-race.js`, set in roomJoined handler)

---

## 2. Add ready button (roulette, horse)

**Root cause**: `readySection` HTML has no `<button id="readyButton">`. `ready-shared.js` looks for it but silently skips.

### File: `roulette-game-multiplayer.html` (line ~864-868)

Replace the readySection title line:

```html
<!-- BEFORE: -->
<div class="ready-section" id="readySection">
    <div class="users-title" style="margin-bottom: 15px;">✅ 준비한 사람 (<span id="readyCount">0</span>명)</div>
    <div class="users-list" id="readyUsersList">

<!-- AFTER: -->
<div class="ready-section" id="readySection">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div class="users-title" style="margin: 0;">✅ 준비한 사람 (<span id="readyCount">0</span>명)</div>
        <button id="readyButton" onclick="toggleReady()" style="width: auto; padding: 10px 20px; background: linear-gradient(135deg, var(--btn-ready) 0%, var(--btn-ready-hover) 100%);">준비</button>
    </div>
    <div class="users-list" id="readyUsersList">
```

### File: `horse-race-multiplayer.html` (line ~94-98)

Same pattern applied to horse readySection.

---

## 3. Connect horse volume to ControlBar

**Root cause**: `js/horse-race.js` has independent `horseMasterVolume` system (lines 100-177) not connected to ControlBar slider.

### File: `horse-race-multiplayer.html` — ControlBar.init (line ~69)

Add `soundKey` and `volumeKey`:
```js
// BEFORE:
ControlBar.init({
    gameKey: 'horse',
    onLeave: function() { leaveRoom(); }
});

// AFTER:
ControlBar.init({
    gameKey: 'horse',
    soundKey: 'horseSoundEnabled',
    volumeKey: 'horseSoundVolume',
    onLeave: function() { leaveRoom(); }
});
```
(Uses existing localStorage key names `HORSE_SOUND_KEY`/`HORSE_VOLUME_KEY` from horse-race.js)

### File: `js/horse-race.js`

**Remove** (lines ~100-177): `HORSE_SOUND_KEY`, `HORSE_VOLUME_KEY`, `horseMasterVolume`, `horseStoredVolume` variables, plus functions: `initVolumeFromStorage()`, `updateVolumeUI()`, `toggleMute()`, `setMasterVolume()`, `applyMasterVolumeToAll()`, `setHorseSoundCheckboxes()`, `onHorseSoundChange()`.

**Replace** getter functions (keep function names — called in 40+ places):
```js
function getHorseSoundEnabled() {
    return ControlBar.getSoundEnabled();
}

function getHorseMasterVolume() {
    return ControlBar.getMasterVolume();
}
```

**Remove** (line ~4892-4893): `initVolumeFromStorage()` / `updateVolumeUI()` calls — ControlBar.init handles this.

**Remove** (line ~4917-4919): `SoundManager.setMasterVolumeGetter(getHorseMasterVolume)` — ControlBar.init handles this.

**Remove** (lines ~4940-4950): Volume button/slider event listeners (ControlBar already binds these to `#volumeBtn`/`#volumeSlider`).

**Redirect** GIF recording mute calls (lines ~3429, 3454):
```js
// line 3429: toggleMute() → ControlBar.toggleMute()
// line 3454: toggleMute() → ControlBar.toggleMute()
```

---

## 4. Fix leave button width

### File: `css/theme.css` — `#leaveBtn` rule

Add `width: auto`:
```css
#leaveBtn {
  background: var(--gray-200);
  color: var(--text-secondary);
  padding: 2px 10px;
  font-size: 10px;
  align-self: center;
  width: auto;
}
```

---

## 5. Remove dead code

### File: `roulette-game-multiplayer.html` (line ~1118, 1123)

Remove `readyBtn` references from `updateControlBarUI()`:
```js
// REMOVE these 2 lines:
const readyBtn = document.getElementById('readyBtn');
if (readyBtn) readyBtn.style.display = 'inline-block';
```

### File: `horse-race-multiplayer.html` (line ~560, 565)

Same removal.

---

## 6. Unify room name editing (dice → click-on-title pattern)

**Issue**: Dice uses ✏️ icon + separate `roomNameEditSection`, while roulette/horse use click-on-title inline input. Unify dice to match roulette/horse pattern.

### File: `dice-game-multiplayer.html`

**ControlBar.init** (line ~1530): Remove `onEditRoomName` callback.

**Add** room title click handler (same pattern as roulette/horse):
```js
let isEditingRoomName = false;
document.addEventListener('DOMContentLoaded', function() {
    const roomTitleElem = document.getElementById('roomTitle');
    if (!roomTitleElem) return;
    roomTitleElem.addEventListener('click', function() {
        if (!isHost || isEditingRoomName) return;
        isEditingRoomName = true;
        const displaySpan = document.getElementById('roomNameDisplay');
        const currentName = displaySpan.querySelector('#roomNameText').textContent;
        const editIcon = this.querySelector('.edit-icon');
        if (editIcon) editIcon.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.maxLength = 30;
        input.style.cssText = 'font-size: inherit; font-weight: inherit; border: 2px solid var(--dice-500); border-radius: 4px; padding: 4px 8px; width: 200px; background: var(--bg-white); color: var(--text-primary);';
        displaySpan.replaceWith(input);
        input.focus();
        input.select();
        function finishEdit() {
            const newName = input.value.trim();
            const newDisplay = document.createElement('span');
            newDisplay.id = 'roomNameDisplay';
            newDisplay.innerHTML = '<span id="roomNameText">' + (newName || currentName) + '</span>';
            input.replaceWith(newDisplay);
            if (editIcon) editIcon.style.display = '';
            isEditingRoomName = false;
            if (newName && newName !== currentName && socket) {
                socket.emit('updateRoomName', { roomName: newName });
            }
        }
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') finishEdit(); });
    });
});
```

**Remove**: `editRoomName()`, `saveRoomName()`, `cancelRoomNameEdit()` functions (lines ~4300-4321).

**Remove**: `roomNameEditSection` HTML (line ~1541-1547).

**Update** `roomNameUpdated` handler (line ~4294): Change `cancelRoomNameEdit()` to just update text.

**Note**: Dice uses `roomNameText` inside `roomNameDisplay` (control-bar-shared.js renders `<span id="roomNameDisplay"><span id="roomNameText">`), so `finishEdit` must recreate both spans. Roulette/horse only have `roomNameDisplay`.

---

## 7. Implementation order

1. `css/theme.css` — leave button width fix (1 line)
2. `roulette-game-multiplayer.html` — nickname + ready button + dead code (3 edits)
3. `horse-race-multiplayer.html` — nickname + ready button + dead code + ControlBar.init keys (4 edits)
4. `js/horse-race.js` — volume delegation (~70 lines removed, 2 lines replaced)
5. `dice-game-multiplayer.html` — room name editing unification (remove editSection, add click handler)

## 8. Verification

Open each game in browser, join a room, and check:

- [ ] Nickname visible in control bar (all 3 games)
- [ ] Ready button visible + toggles (roulette, horse — dice already works)
- [ ] Volume slider controls sound (all 3 games, especially horse)
- [ ] Leave button is small (not full width)
- [ ] Host badge shows for host only
- [ ] Room title editing works (all 3 games: click title → inline input)
- [ ] Control bar layout identical across 3 games

> **On completion**: move this file to `docs/meeting/applied/`
