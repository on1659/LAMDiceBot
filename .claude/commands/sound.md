---
description: "Sound management hub. Usage: /sound [list|add|del|status|help]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# /sound — Sound Management Hub

Arguments: $ARGUMENTS

## Subcommand Routing

Parse `$ARGUMENTS` and route to the appropriate action:

| Argument | Action |
|----------|--------|
| (empty) or `help` | Show help message |
| `list` | List all registered sounds |
| `status` | Show sound status summary |
| `add {description}` | Redirect to /addsound procedure |
| `del {description}` | Redirect to /delsound procedure |

---

## 1. help (Default)

Display the following help message:

```
## 🔊 Sound Command Help

### Available Commands:
- /sound list     — List all registered sounds with status
- /sound status   — Show summary (total, active, missing assets)
- /sound add {desc} — Add new sound (same as /addsound)
- /sound del {desc} — Delete sound (same as /delsound)
- /sound help     — Show this help

### Direct Commands:
- /addsound {description} — Add sound with guided procedure
- /delsound {description} — Delete sound with confirmation

### Configuration Files:
- Sound config: assets/sounds/sound-config.json
- Sound notes:  assets/sounds/SOUND-NOTES.md
- Sound manager: assets/sounds/sound-manager.js
```

---

## 2. list

1. Read `assets/sounds/sound-config.json`
2. Read `assets/sounds/SOUND-NOTES.md` to get status info
3. Display formatted table grouped by game type:

```
## 🔊 Registered Sounds

### 🎲 Dice (dice)
| Key | File | Status |
|-----|------|--------|
| dice_roll | dice/roll.mp3 | ✅ Active |
| dice_result | dice/result.mp3 | ❌ No asset |
...

### 🎰 Roulette (roulette)
...

### 🏇 Horse Race (horse-race)
...

### 👥 Team (team)
...

### 🔧 Common (common)
...
```

---

## 3. status

1. Read `assets/sounds/sound-config.json`
2. Count total keys
3. Check actual file existence using Bash: `ls -la assets/sounds/`
4. Display summary:

```
## 📊 Sound System Status

| Category | Count |
|----------|-------|
| Total registered | {n} |
| ✅ With assets | {n} |
| ❌ Missing assets | {n} |

### By Game Type:
| Game | Total | Active | Missing |
|------|-------|--------|---------|
| dice | 4 | 1 | 3 |
| roulette | 4 | 3 | 1 |
| horse-race | 6 | 0 | 6 |
| team | 1 | 0 | 1 |
| common | 3 | 1 | 2 |
```

---

## 4. add {description}

Execute the full `/addsound` procedure with the provided description:

1. Analyze sound requirements
2. User confirmation via AskUserQuestion
3. Update sound-config.json
4. Generate placeholder mp3
5. Insert playback call in source code
6. Update SOUND-NOTES.md
7. Report completion

---

## 5. del {description}

Execute the full `/delsound` procedure with the provided description:

1. Identify target sound
2. User confirmation via AskUserQuestion
3. Remove playback calls from source code
4. Remove key from sound-config.json
5. Delete mp3 file
6. Update SOUND-NOTES.md
7. Report completion

---

## Notes

- Sound Manager uses `SoundManager.playSound(key)` for one-shot and `SoundManager.playLoop(key)` for loops
- Each game has its own sound enable function (e.g., `getHorseSoundEnabled()`)
- Placeholder files are ~8KB silent MP3s; replace with actual assets as needed
