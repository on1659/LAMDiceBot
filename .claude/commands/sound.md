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

1. **Analyze sound**: Based on user description, determine:
   - `key`: Key to register in sound-config.json (`{gameType}_{effectName}` format)
   - `file path`: `assets/sounds/{gameType}/{filename}.mp3`
   - `trigger point`: Which socket event or function triggers playback
   - `playback mode`: One-shot (`playSound`) or loop (`playLoop`)

2. **User confirmation**: Use AskUserQuestion to confirm key name, file path, trigger point, playback mode

3. **Update sound-config.json**: Add key-path entry

4. **Generate placeholder mp3**:
   ```bash
   node -e "
   const fs = require('fs');
   const path = require('path');
   const header = Buffer.from([0xFF, 0xFB, 0x90, 0x00]);
   const frame = Buffer.alloc(417, 0);
   header.copy(frame);
   const frames = Buffer.concat(Array(20).fill(frame));
   const fullPath = '{file_path}';
   fs.mkdirSync(path.dirname(fullPath), { recursive: true });
   fs.writeFileSync(fullPath, frames);
   "
   ```

5. **Insert playback call** in game HTML: `SoundManager.playSound(key)` or `SoundManager.playLoop(key)`

6. **Update SOUND-NOTES.md**: Add row, mark `❌ No asset`

7. **Report**: Key, file, trigger, mode, modified files

---

## 5. del {description}

1. **Identify target**: Read `sound-config.json` + `SOUND-NOTES.md`, use AskUserQuestion if ambiguous

2. **User confirmation**: Show key, file path, related code location

3. **Remove playback calls**: Grep `SoundManager.playSound/playLoop/stopLoop` with the key, remove all

4. **Remove from sound-config.json**: Delete key-value pair

5. **Delete mp3 file**: `rm {file_path}`

6. **Update SOUND-NOTES.md**: Remove row

7. **Report**: Deleted key, file, modified files, removed code summary

---

## Notes

- Sound Manager uses `SoundManager.playSound(key)` for one-shot and `SoundManager.playLoop(key)` for loops
- Each game has its own sound enable function (e.g., `getHorseSoundEnabled()`)
- Placeholder files are ~8KB silent MP3s; replace with actual assets as needed
