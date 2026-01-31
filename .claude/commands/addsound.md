---
description: "Add sound. Example: /addsound stage-specific BGM"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /addsound — Add Sound

Sound description from user: $ARGUMENTS

## Procedure

1. **Analyze sound**: Based on user description, determine:
   - `key`: Key to register in sound-config.json (`{gameType}_{effectName}` format)
   - `file path`: `assets/sounds/{gameType}/{filename}.mp3`
   - `trigger point`: Which socket event or function triggers playback
   - `playback mode`: One-shot (`playSound`) or loop (`playLoop`)

2. **User confirmation**: Use AskUserQuestion to confirm:
   - Key name and file path are correct
   - Which game and at what point it should play
   - One-shot or loop

3. **Update sound-config.json**
   - Add key-path entry to `assets/sounds/sound-config.json`

4. **Generate placeholder mp3**
   - Create placeholder mp3 file at the path (using Node.js script)
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

5. **Insert playback call in source code**
   - Add `SoundManager.playSound()` or `SoundManager.playLoop()` call at the trigger point in the game HTML file
   - Use the game's sound enabled function (getDiceSoundEnabled, getRouletteSoundEnabled, getHorseSoundEnabled, etc.)

6. **Update SOUND-NOTES.md**
   - Add row to the corresponding game table in `assets/sounds/SOUND-NOTES.md`
   - Mark status as `❌ No asset`

7. **Completion report**
   ```
   ## /addsound Complete
   - Key: {key}
   - File: {path}
   - Trigger: {trigger point}
   - Mode: One-shot/Loop
   - Modified files: {list}
   - Status: Placeholder created, actual mp3 replacement needed
   ```
