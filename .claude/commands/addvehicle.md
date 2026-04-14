---
description: "Add new horse race vehicle. Example: /addvehicle crab 게 🦀 beach 54"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# /addvehicle — Add Horse Race Vehicle

User input: $ARGUMENTS

## Input Parsing

Parse arguments as: `{id} {name} {emoji} {background} {visualWidth}`
- `id`: English ID (e.g., crab, dragon)
- `name`: Korean name (e.g., 게, 용)
- `emoji`: Emoji character (e.g., 🦀)
- `background`: One of: expressway, space, sky, ocean, road, forest, beach
- `visualWidth`: Number 40-60 (SVG visual width for finish line judgment)

If arguments are incomplete, use AskUserQuestion to fill in missing fields.

## Procedure

### Step 1: Validate & Confirm

Check that `id` doesn't already exist in `assets/vehicle-themes.json`.
Use AskUserQuestion to confirm:
- Vehicle ID, name, emoji
- Background theme
- Visual width
- Which motion states to create (default: all 6 — idle, run, rest, finish, victory, dead)

### Step 2: vehicle-themes.json

Add entry to `assets/vehicle-themes.json`:
```json
"{id}": {
  "id": "{id}",
  "name": "{name}",
  "emoji": "{emoji}",
  "theme": "{background}",
  "backgroundImage": "assets/backgrounds/{background}.png",
  "visualWidth": {visualWidth}
}
```

### Step 3: SVG Sprites

Add to `js/horse-race-sprites.js` inside `svgMap`, before the closing `};`.

Create SVG sprites for each state (viewBox="0 0 60 45" width="60" height="45"):
- **idle**: Standing still, small idle animation between frame1/frame2
- **run**: Running/moving animation, frame1/frame2 alternate legs/pose
- **rest**: Sleeping/resting pose with "z z z" text elements
- **finish**: Slow walk, reduced movement
- **victory**: Celebratory pose + crown (FFD700) + sparkle text elements (✦)
- **dead**: Tombstone (R.I.P) + ghost (opacity 0.4→0.3 between frames, rising)

Each state needs `frame1` and `frame2` template literal SVG strings.
End with: `get frame1() { return this.run.frame1; }, get frame2() { return this.run.frame2; }`

Reference existing vehicles for style:
- Simple rect-based characters: knight, dinosaur, ninja, crab
- Complex path-based characters: horse

### Step 4: Fallback Arrays (horse-race.js)

Add to BOTH fallback `ALL_VEHICLES` arrays in `js/horse-race.js`:
1. First fallback (~line 139): `{ id: '{id}', name: '{name}', emoji: '{emoji}', bgType: '{background}', visualWidth: {visualWidth} }`
2. Second fallback (~line 605): `{ id: '{id}', name: '{name}', emoji: '{emoji}', bgType: '{background}' }`

Search for existing entries to find exact locations.

### Step 5: Server — socket/horse.js

Add to three places in `socket/horse.js`:
1. `ALL_VEHICLE_IDS` array: append `'{id}'`
2. `VEHICLE_NAMES` object: add `'{id}': '{name}'`
3. `VISUAL_WIDTHS` object: add `'{id}': {visualWidth}`

### Step 6: Chat Commands — socket/chat.js

Add to `socket/chat.js` local vehicle lists:
1. `ALL_VEHICLE_IDS` array: append `'{id}'`
2. `VEHICLE_NAMES` object: add forward `'{id}': '{name}'` AND reverse `'{name}': '{id}'`

### Step 7: Syntax Check

Run syntax checks on all modified files:
```bash
node -c js/horse-race-sprites.js
node -c js/horse-race.js
node -c socket/horse.js
node -c socket/chat.js
```

### Step 8: Functional Verification

Create and run a temp test script to verify:
- `getVehicleSVG('{id}')` returns valid object
- All requested states have frame1 and frame2
- frame1/frame2 getters work
- Delete test file after

### Step 9: Completion Report

```
## /addvehicle Complete

- ID: {id}
- Name: {name} {emoji}
- Background: {background}
- Visual Width: {visualWidth}
- States: {list of states created}

### Modified Files
| File | Change |
|------|--------|
| assets/vehicle-themes.json | Added {id} entry |
| js/horse-race-sprites.js | Added {N} SVG states |
| js/horse-race.js | Added to fallback arrays (2 places) |
| socket/horse.js | Added to IDS, NAMES, WIDTHS |
| socket/chat.js | Added to IDS, NAMES (forward + reverse) |

### Verification
- Syntax: ✅ All files pass
- States: ✅ {N}/6 states with frame1+frame2
- Getters: ✅ frame1/frame2 OK
```
