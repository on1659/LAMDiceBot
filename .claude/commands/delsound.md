---
description: "Delete sound. Example: /delsound horse race hoofbeat"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /delsound — Delete Sound

Deletion target from user: $ARGUMENTS

## Procedure

1. **Identify target**: Based on user description, identify the sound key to delete
   - Read `assets/sounds/sound-config.json` to check key list
   - Read `assets/sounds/SOUND-NOTES.md` to match descriptions
   - If ambiguous, use AskUserQuestion to present candidate list for confirmation

2. **User confirmation**: Use AskUserQuestion to confirm deletion target
   - Key: `{key}`
   - File: `{path}`
   - Related code location: `{file:line}`

3. **Remove playback calls from source code**
   - Use Grep to find all `SoundManager.playSound()`, `SoundManager.playLoop()`, `SoundManager.stopLoop()` calls using the key, then remove them
   - Clean up empty blocks after removal

4. **Remove key from sound-config.json**
   - Delete the key-value pair from `assets/sounds/sound-config.json`

5. **Delete mp3 file**
   - Delete the mp3 file at the path
   ```bash
   rm {file_path}
   ```

6. **Update SOUND-NOTES.md**
   - Remove the row from the corresponding table in `assets/sounds/SOUND-NOTES.md`

7. **Completion report**
   ```
   ## /delsound Complete
   - Deleted key: {key}
   - Deleted file: {path}
   - Modified files: {list}
   - Removed code: {file:line} (summary)
   ```
