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

**Root cause**: `js/horse-race.js` has independent `horseMasterVolume` system (lines 102-174) not connected to ControlBar slider.

### File: `horse-race-multiplayer.html` — ControlBar.init

Add `soundKey` and `volumeKey` to ControlBar.init call. (Horse has no existing localStorage keys, so new format is fine.)

### File: `js/horse-race.js`

**Remove** (lines ~102-174): `horseMasterVolume`, `horseStoredVolume` variables, `initHorseSoundFromStorage()`, `updateHorseSoundUI()`, `toggleHorseSound()`, `setHorseMasterVolume()`, `horseGameSoundCheckboxChanged()`.

**Replace** getter functions:
```js
function getHorseSoundEnabled() {
    return ControlBar.getSoundEnabled();
}

function getHorseMasterVolume() {
    return ControlBar.getMasterVolume();
}
```

**Remove** (line ~4918): `SoundManager.setMasterVolumeGetter(getHorseMasterVolume)` — ControlBar.init handles this.

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

## 6. Implementation order

1. `css/theme.css` — leave button width fix (1 line)
2. `roulette-game-multiplayer.html` — nickname + ready button + dead code (3 edits)
3. `horse-race-multiplayer.html` — nickname + ready button + dead code + ControlBar.init keys (4 edits)
4. `js/horse-race.js` — volume delegation (~70 lines removed, 2 lines replaced)

## 7. Verification

Open each game in browser, join a room, and check:

- [ ] Nickname visible in control bar (all 3 games)
- [ ] Ready button visible + toggles (roulette, horse — dice already works)
- [ ] Volume slider controls sound (all 3 games, especially horse)
- [ ] Leave button is small (not full width)
- [ ] Host badge shows for host only
- [ ] Room title editing works (dice: pencil icon, roulette/horse: click title)
- [ ] Control bar layout identical across 3 games

> **On completion**: move this file to `docs/meeting/applied/`
