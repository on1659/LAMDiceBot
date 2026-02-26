# Implementation: Horse Race New Gimmicks

> **Source meeting**: `docs/meeting/plan/single/2026-02-26-1500-horse-new-gimmick.md`
> **Recommended model**: Sonnet (concrete files/functions specified, code-writing focused)
> **On completion**: move this file to `docs/meeting/applied/`

---

## Absolute Constraints

- **Synchronization**: All clients must receive identical state. No client-side randomness for game outcomes.
- **Fairness**: Server generates all random values. Player actions must be equal-opportunity.

---

## Features to Implement (Priority Order)

### 1. Weather Vote ("하늘의 심판")

**Concept**: Before race start, all players vote on weather (sunny/rain/wind/fog). Majority wins.

**Current state**: Weather system fully implemented in `socket/horse.js` (`generateWeatherSchedule()`). Only `forcedWeather` option exists for overriding. No vote UI/logic.

**Files to modify**:
- `socket/horse.js`
- `horse-race-multiplayer.html`

**Server implementation** (`socket/horse.js`):

Add to room state (where `races` / `bets` etc. are stored):
```js
// In room initialization or reset
room.weatherVotes = {};  // { socketId: 'sunny' | 'rain' | 'wind' | 'fog' }
```

New socket event `weather_vote`:
```js
socket.on('weather_vote', ({ weather }) => {
  if (!ctx.checkRateLimit()) return;
  const room = ctx.getCurrentRoom();
  if (!room || room.gameStarted) return;  // voting only before start
  const VALID = ['sunny', 'rain', 'wind', 'fog'];
  if (!VALID.includes(weather)) return;
  room.weatherVotes[socket.id] = weather;
  // Broadcast current vote counts to all in room
  const counts = { sunny: 0, rain: 0, wind: 0, fog: 0 };
  Object.values(room.weatherVotes).forEach(v => counts[v]++);
  io.to(room.id).emit('weather_vote_update', { counts, total: Object.keys(room.weatherVotes).length });
});
```

When race starts (`startHorseRace` handler), before calling `generateWeatherSchedule()`:
```js
// Determine winning weather from votes
const votes = room.weatherVotes || {};
const counts = { sunny: 0, rain: 0, wind: 0, fog: 0 };
Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
const winnerWeather = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
// If no votes, keep existing logic (all sunny)
const forcedWeather = Object.keys(votes).length > 0 ? winnerWeather : null;
// Pass forcedWeather to generateWeatherSchedule if function accepts it
// (Check current signature: generateWeatherSchedule(trackLength, forcedWeather))
room.weatherVotes = {};  // reset after race starts
```

In `horseRaceCountdown` event payload, include the voted weather so clients can show it:
```js
io.to(room.id).emit('horseRaceCountdown', {
  // ...existing fields...
  votedWeather: forcedWeather   // string or null
});
```

**Client implementation** (`horse-race-multiplayer.html`):

Add weather vote panel (show during lobby / before race starts):
```html
<div id="weatherVotePanel" style="display:none">
  <p>이번 경기 날씨를 선택하세요!</p>
  <button onclick="voteWeather('sunny')">☀️ 맑음</button>
  <button onclick="voteWeather('rain')">🌧️ 비</button>
  <button onclick="voteWeather('wind')">💨 바람</button>
  <button onclick="voteWeather('fog')">🌫️ 안개</button>
  <div id="weatherVoteCounts"></div>
</div>
```

Client JS:
```js
function voteWeather(weather) {
  socket.emit('weather_vote', { weather });
}
socket.on('weather_vote_update', ({ counts, total }) => {
  // Update vote count display
  document.getElementById('weatherVoteCounts').innerHTML =
    `☀️${counts.sunny} 🌧️${counts.rain} 💨${counts.wind} 🌫️${counts.fog} (총 ${total}표)`;
});
socket.on('horseRaceCountdown', (data) => {
  // ...existing logic...
  if (data.votedWeather) {
    // Show "날씨 확정: ☀️ 맑음" announcement
  }
});
```

**Show/hide logic**: Show `weatherVotePanel` when game is in lobby state (all ready, waiting for host start). Hide when race starts.

---

### 2. Horse Condition Flavor Text ("말 컨디션")

**Concept**: Before race, each horse gets a random condition label (최상/좋음/보통/저조). **Pure flavor — no effect on race result.** Displayed during countdown.

**Files to modify**:
- `socket/horse.js`

**Server implementation**:

In `generateRaceData()` (or wherever horse data is assembled), add condition generation:
```js
const CONDITIONS = ['최상', '좋음', '보통', '저조'];
const condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];
// Attach to each horse in the horses array:
// horse.condition = condition;
```

In `horseRaceCountdown` event, include conditions:
```js
horses: room.horses.map(h => ({
  id: h.id,
  name: h.name,
  vehicleType: h.vehicleType,
  condition: h.condition,  // ADD THIS
  // ...existing fields
}))
```

**Client display**: In the countdown screen where horse names/vehicles are shown, add a small badge:
```html
<span class="condition-badge condition-${horse.condition}">${horse.condition}</span>
```

CSS (in `horse-race-multiplayer.html` `<style>` or `css/horse-race.css`):
```css
.condition-badge { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; }
.condition-badge.condition-최상 { background: #4caf50; color: white; }
.condition-badge.condition-좋음 { background: #2196f3; color: white; }
.condition-badge.condition-보통 { background: #9e9e9e; color: white; }
.condition-badge.condition-저조 { background: #f44336; color: white; }
```

---

### 3. Gimmick Activation Visual Feedback

**Concept**: When a gimmick activates for a horse, show a floating icon + text popup above that horse on the track.

**Files to modify**:
- `horse-race-multiplayer.html` (client only, no server changes)

**Implementation**:

Gimmick data is already received in `horseRaceStarted`. The client already knows each gimmick's `progressTrigger`. When a horse reaches a gimmick's trigger progress, show the popup.

Add popup element per horse in the race track HTML, or create dynamically:
```js
function showGimmickPopup(horseEl, gimmickType) {
  const LABELS = {
    sprint: '⚡ 스프린트!',
    stop: '🛑 정지!',
    slow: '🐢 감속!',
    obstacle: '⛔ 장애물!',
    slip: '💫 미끄럼!',
    wobble: '😵 휘청!',
    item_boost: '🚀 부스터!',
    item_trap: '🪤 함정!',
    reverse: '↩️ 역주행!',
    slipstream: '🌀 슬립스트림!',
  };
  const label = LABELS[gimmickType] || gimmickType;
  const popup = document.createElement('div');
  popup.className = 'gimmick-popup';
  popup.textContent = label;
  horseEl.appendChild(popup);
  setTimeout(() => popup.remove(), 1500);
}
```

CSS:
```css
.gimmick-popup {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.75);
  color: white;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  white-space: nowrap;
  animation: popupFloat 1.5s ease-out forwards;
  pointer-events: none;
  z-index: 100;
}
@keyframes popupFloat {
  0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
}
```

**Where to call `showGimmickPopup`**: Find the existing gimmick application loop in the client animation code. At the point where a gimmick becomes active for a horse (based on progress comparison), call `showGimmickPopup(horseEl, gimmick.type)`.

---

### 4. Slipstream Gimmick ("슬립스트림")

**Concept**: A trailing horse gains a small speed boost when it's close behind a leading horse. Implemented as a server-generated gimmick — no new synchronization needed.

**Files to modify**:
- `config/horse/race.json`
- `socket/horse.js`

**config/horse/race.json** — add to `gimmicks.types`:
```json
"slipstream": {
  "category": "boost",
  "probability": 0,
  "durationRange": [800, 1500],
  "speedMultiplierRange": [1.15, 1.25],
  "notes": "Server-injected based on relative position. probability=0 means not randomly generated."
}
```

**Server implementation** (`socket/horse.js`):

The slipstream gimmick is NOT randomly assigned in the initial gimmick generation (probability: 0). Instead, it is **injected during race simulation** when two horses are within a defined proximity threshold.

In `generateRaceData()`, after the normal gimmick list is built for each horse, add a slipstream check pass:
```js
const SLIPSTREAM_GAP_THRESHOLD = 0.05;  // 5% of track, in progress units
const SLIPSTREAM_COOLDOWN = 0.15;       // don't re-trigger within 15% progress

// After calculating base progress positions for all horses,
// for each pair (leadHorse, trailHorse) where lead is ahead:
//   if (lead.progress - trail.progress < SLIPSTREAM_GAP_THRESHOLD):
//     inject a slipstream gimmick for trailHorse at trail.progress
//     (if no slipstream within last SLIPSTREAM_COOLDOWN progress)
```

**Important**: Slipstream is determined by the deterministic simulation pass (already server-calculated), so synchronization is guaranteed.

**Practical note**: The current architecture pre-calculates all gimmick triggers before the race. To implement slipstream, the server needs to simulate horse positions at each progress step and check proximity. This adds computation but stays fully server-side.

**Alternative simpler approach** (if position simulation is too complex):
- Assign slipstream as a random gimmick for trailing horses (rank 3-last at progressTrigger 0.4-0.7) with 30% probability per horse. This loses the "proximity" mechanic but is much simpler.
- Mark as `category: "boost"` so it doesn't conflict with consecutive-boost prevention unless we want it to.

**Recommendation**: Start with the simpler alternative, add proximity detection in a follow-up.

---

## Implementation Order

1. **Horse Condition Flavor** — smallest change, pure server + broadcast. 30 min.
2. **Gimmick Visual Feedback** — client only, no server touch. 45 min.
3. **Weather Vote** — new socket event + UI. 1.5 hr.
4. **Slipstream Gimmick (simple version)** — add to config + random injection for trailing horses. 1 hr.

---

## Verification

### For each feature:

| Feature | Test Method | Pass Criteria |
|---------|-------------|---------------|
| Horse Condition | Open 3 tabs same room → start race | All tabs show identical conditions during countdown |
| Gimmick Visual | Watch single race | Popup appears at correct timing when gimmick activates |
| Weather Vote | 3 tabs vote different weather → start race | All tabs receive same final weather in countdown |
| Slipstream | Watch race with close horses | Trailing horse shows slipstream popup, slight speed boost visible |

### Sync check (all features):
1. Open 3 browser tabs, join same room
2. Start race
3. Verify: identical countdown info, identical gimmick events, identical final ranking

> **On completion**: move this file to `docs/meeting/applied/`
