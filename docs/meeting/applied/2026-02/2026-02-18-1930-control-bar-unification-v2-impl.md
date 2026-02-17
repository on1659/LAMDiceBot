# Control Bar Unification v2 - Implementation Plan

**Meeting Reference**: `docs/meeting/plan/single/2026-02-18-1930-control-bar-unification-v2.md`
**Recommended Model**: Sonnet (concrete file/function locations specified, code-writing focused)
**Status**: Ready for Implementation

---

## Overview

Unify the room control bar across all 4 games with:
1. Two-row layout: row 1 = room title only (centered), row 2 = badges + volume + leave button
2. Volume slider restored (checkbox → slider with mute toggle)
3. Remove "사운드" text label (icon only)
4. Identical HTML structure across all 4 game files

---

## 1. CSS Changes (`css/theme.css`)

### 1.1 Two-Row Control Bar Layout

Replace current `.room-control-bar` styles (lines 290-315) with:

```css
.room-control-bar {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 10px 15px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Row 1: Room title only */
.control-bar-title {
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-bar-title .edit-icon {
  font-size: 14px;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.2s;
}

.control-bar-title:hover .edit-icon {
  opacity: 1;
}

/* Row 2: Meta info + actions */
.control-bar-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
}

/* Volume control */
.volume-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.volume-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.volume-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}

.volume-slider {
  width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--gray-300);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: var(--purple-500);
  border-radius: 50%;
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--purple-500);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.volume-slider.muted {
  opacity: 0.4;
}
```

### 1.2 Remove old styles

Remove the old `.control-bar-left`, `.control-bar-right` definitions. Keep `.control-bar-btn`, `.host-badge`, `.username-display` as-is.

### 1.3 Mobile responsive

```css
@media (max-width: 768px) {
  .room-control-bar {
    padding: 8px 10px;
    gap: 6px;
  }

  .volume-slider {
    width: 50px;
  }
}
```

---

## 2. Unified HTML Structure (all 4 games)

Replace the entire `.room-control-bar` div in each game with:

```html
<div class="room-control-bar">
    <!-- Row 1: Room Title -->
    <div class="control-bar-title" id="roomTitle">
        <span id="roomNameDisplay">방 제목</span>
        <span class="edit-icon" id="editRoomNameButton" style="display: none;" onclick="editRoomName()">✏️</span>
    </div>

    <!-- Row 2: Meta + Actions -->
    <div class="control-bar-meta">
        <span class="host-badge" id="hostBadge" style="display: none;">👑 호스트</span>
        <span id="roomStatusIcons" style="display: none;"></span>
        <span class="username-display" id="usernameDisplay"></span>
        <div class="volume-control">
            <button class="volume-btn" id="volumeBtn" type="button">🔊</button>
            <input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="100">
        </div>
        <button onclick="leaveRoom()" id="leaveBtn" class="control-bar-btn">🚪 나가기</button>
    </div>
</div>
```

### Game-specific variations

- **Dice**: `id="roomNameText"` inside `roomNameDisplay` (for existing JS), `onclick="logout()"` on leave button
- **Roulette**: Add `turboBadge` span after `hostBadge`
- **Horse/Crane**: Standard template (no extra badges)

---

## 3. Files to Modify

| File | Changes |
|------|---------|
| `css/theme.css` | Replace control bar CSS (lines 290-459) |
| `dice-game-multiplayer.html` | Replace control bar HTML (lines 1581-1602), add volume slider JS |
| `roulette-game-multiplayer.html` | Replace control bar HTML (lines 895-916), reconnect volumeSlider to existing JS |
| `horse-race-multiplayer.html` | Replace control bar HTML (lines 66-86), add volume slider JS (new) |
| `crane-game-multiplayer.html` | Replace control bar HTML (lines 1044-1064), reconnect volumeSlider to existing JS |

### Volume JS needed per game

| Game | Volume JS status | Action |
|------|-----------------|--------|
| Dice | Checkbox toggle only | Add slider-based volume (copy pattern from roulette) |
| Roulette | Full slider JS exists | Just restore HTML slider, connect to existing `volumeSlider` |
| Horse | No volume JS at all | Add full volume system (init, get, set, toggle, UI update) |
| Crane | Full slider JS exists | Just restore HTML slider, connect to existing `volumeSlider` |

---

## 4. Implementation Order

1. **CSS**: Update `theme.css` with new 2-row layout + volume styles
2. **Roulette**: Easiest — just replace HTML, existing JS already handles volumeSlider
3. **Crane**: Same as roulette — replace HTML, existing JS handles volumeSlider
4. **Dice**: Replace HTML + add volume slider JS (adapt from roulette pattern)
5. **Horse**: Replace HTML + add full volume system from scratch

---

## 5. Verification

- [ ] All 4 games show identical 2-row control bar
- [ ] Room title is centered on row 1 (alone, no badges)
- [ ] Badges (HOST, turbo) appear on row 2
- [ ] Volume slider works: drag 0→50→100, hear volume change
- [ ] Mute toggle: click 🔊 → 🔇, click again → restore
- [ ] Volume persists across page refresh (localStorage)
- [ ] No "사운드" text visible
- [ ] Mobile: slider is touchable

---

> **On completion**: move this file to `docs/meeting/applied/2026-02/`
