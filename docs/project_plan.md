# Project Plan - Host-Initiated Player Removal Rule

## Goal
Implement a rule where the host can remove a player who hasn't rolled the dice by double-clicking on them in the multiplayer dice game.

## Tasks
- [x] Analyze frontend player list and event handling in `dice-game-multiplayer.html`
- [x] Analyze backend player management and host logic in `server.js`
- [x] Implement double-click event on player list for host in frontend
- [x] Implement player removal logic (kick) in backend `server.js`
- [x] Implement automatic game end check when a player is removed or leaves
- [x] Verify that only the host can kick and only players who haven't rolled (as per requirement)
- [x] Update "Update History" and "Commit History" files

## Progress
- [x] Backend `kickPlayer` socket event implemented.
- [x] Frontend `dblclick` listener and `kicked` event handler implemented.
- [x] Added check to prevent kicking players who have already rolled during a game.
- [x] Refactored game end logic into `checkAndEndGame` and integrated it with kick and leave events.
- [x] Updated `dice-game-multiplayer.html`, `CHANGELOG.md`, `COMMIT_MESSAGE.md`, `COMMIT_MESSAGE.txt`, and `README.md`.



