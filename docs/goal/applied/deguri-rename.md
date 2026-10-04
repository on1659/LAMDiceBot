# Goal: Rename every `marble` name to `deguri`

## Summary

The game shipped to users as 데구리 (`/deguri`), but the code, files, assets, socket events and stored game-type values still use the old working name `marble`. User decision (2026-10-04): "우리 marble라는 단어 다 제거해, deguri임" — scope **everything** (file and folder names, identifiers, socket events, asset paths, DB values), spelling **`deguri`** (same as the public slug). This goal replaces the old name in one mechanical, scripted pass so that the word no longer appears in the repository outside a short, explicit allowlist. No behaviour changes.

Measured on 2026-10-04 (`feature/marble-run`, 893c200c + working tree): 364 paths with `marble` in the name (301 tracked, 63 untracked; 229 under `assets/marble/`), 117 tracked files containing the word (2,535 lines), 23 `marble:*` socket events, 33 lines with the Korean word `마블`.

## Scope

### In scope
- **Paths** (tracked and untracked): `marble-multiplayer.html`, `js/marble*.js`, `css/marble*.css`, `socket/marble*.js`, `config/marble/`, `assets/marble/` (including `marble-run.manifest.json`), `game-lab/marble-preview.html` and the ignored `game-lab/marble-timeline*.json`, `AutoTest/*marble*`, `docs/**/*marble*`, `.claude/skills/marble-skin/`, `.agents/skills/marble-skin/`.
- **Identifiers and strings**, case-preserving: `marble`→`deguri`, `Marble`→`Deguri`, `MARBLE`→`DEGURI`; `marble-run` / `marble_run` / `Marble Run` collapse to `deguri` / `Deguri` (e.g. `assets/deguri/deguri.manifest.json`).
  - game type `'marble'` (`socket/rooms.js` valid list, `socket/scheduled-start.js`, `socket/shared.js`, `routes/api.js`, `js/free.js`, `js/shared/ranking-shared.js`), `gameState.marble` (`utils/room-helpers.js`, `socket/chat.js`, `socket/rooms.js`), `devFlags.marbleEnabled`
  - socket events `marble:*` → `deguri:*` (server and client in the same commit, no aliases)
  - catalog slots and ids `marble_skin*` / `marble_balloon*` (`config/…/cosmetics.json`, `db/cosmetics.js` `EQUIP_SLOTS`, `socket/shop.js`, tests)
  - `localStorage` keys `marbleUserName`, `pendingMarbleJoin`, `pendingMarbleRoom`, `marbleActiveRoom`, `marbleDeviceId`, `marbleSoundEnabled`, `marbleSoundVolume`
  - tutorial `FLAG_BITS.marble` (key only — the bit value 512 must not change), `assets/sounds/sound-config.json` keys `marble_*`, `css/theme.css` tokens `--marble-*` / `--game-type-marble` / `--dark-ground-marble`, CSS classes and DOM ids containing `marble`
  - comments and docs, including `docs/goal/applied/**` and `docs/spritemake-request/**` (paths inside them must keep pointing at real files)
- **Korean** `마블런` / `마블` when it names our game → `데구리`. Third-party product names (e.g. 마블룰렛 in `DESIGN.md`) stay.
- **Stored values**: every DB table with a `game_type` column (`game_records`, `ad_impression`, `server_game_records`, `season_archives`, `game_sessions`, `order_history` — enumerate through `information_schema` at run time) `'marble'` → `'deguri'`; session ids generated as `marble_<server>_<ts>` (`game_sessions.session_id`, `server_game_records.game_session_id`) get the new prefix in the same transaction; any legacy `user_cosmetics` / prefs rows holding `marble_*` ids.
- Skill rename: `/marble-skin` → `/deguri-skin` (folder and frontmatter `name`), and the references in `CLAUDE.md`.
- Removing slug↔gameType translation that becomes an identity after the rename (`'marble': '/deguri'` style maps stay as maps; only code whose sole purpose was translating `deguri`↔`marble` goes).

### Out of scope
- Behaviour, balance, art, copy. Short prefixes that do not contain the word (`mgacha`, `mshop`, `mb`, `mi`) stay.
- `docs/meeting/plan/**` (immutable history; no hits today).
- Other repositories and folders: `/Users/radar/Work/deguri` (separate project), SpriteMake batch folders (see Open questions), Claude memory files (updated by hand after the rename).
- The unused games (bridge-cross, pirate): touched only where the mechanical replacement lands in a shared line.

## Acceptance criteria

- [ ] `git ls-files | grep -i marble` prints nothing; no untracked path contains the word either.
- [ ] `git grep -i marble` prints only the allowlisted lines listed under Implementation notes; `git grep 마블` prints only third-party names.
- [ ] `node -c server.js` passes and the server boots; `/deguri` loads with zero 404s and zero console errors; a full race (create room → pick → start → result) works with two clients.
- [ ] `/marble`, `/marble/ABCD`, `/free/marble/ABCD`, `/marble-multiplayer.html` still answer 301 to the `/deguri` equivalents.
- [ ] Simulation untouched: the timeline produced for the canonical fixture and for 5 fixed seeds is byte-identical before and after (hash compared by a script, not by eye).
- [ ] Renamed tests pass on a freshly started server: determinism, track sweep, skin shop, gacha, start position.
- [ ] Cross-game check: dice, roulette and horse-race create/join/play one round with no console or server errors (shared modules `socket/rooms.js`, `socket/chat.js`, `socket/shared.js`, `js/shared/*`, `db/*` are edited).
- [ ] DB after migration: zero rows with `game_type = 'marble'` in every table; per-table row counts for 데구리 equal the counts recorded before; the ranking popup shows the 데구리 tab with the same records.
- [ ] Line endings preserved: `git diff --stat` shows no whole-file rewrites of the CRLF files (`css/theme.css`, `socket/*`, `db/*`, `js/shared/*`).
- [ ] `/deguri-skin` is listed as a skill and `/marble-skin` is not.

## Implementation notes

**Precondition — quiet tree.** Several sessions share this working folder (marble files were edited by another session on 2026-10-04 at 15:26 and 16:26; 21 modified + 66 untracked files were uncommitted at 16:40). Do not start until every session's work is committed and no other session is running here. The rename touches every line those sessions would touch.

**Do it with one deterministic script, not by hand.** Write a one-off codemod (kept outside the repo or deleted in the same commit) that:
1. walks tracked + untracked files (skip `.git/`, `node_modules/`, `output/`, binaries, `docs/meeting/plan/`),
2. applies the ordered, case-sensitive replacement list on **bytes** (CRLF hazard — see memory `project_crlf_files_edit_hazard`): `marble-run`/`marble_run`/`Marble Run` first, then `MARBLE`, `Marble`, `marble`,
3. renames paths (`git mv` for tracked, plain move for untracked and ignored local files),
4. skips the allowlisted lines,
5. prints every Korean `마블` hit for a manual per-line decision,
6. is idempotent, so late-arriving work on another branch is converted by running it again rather than by resolving merge conflicts.

Apply it per branch (`feature/marble-run`, then `main`) by running the script on that branch — do not cherry-pick a 364-file rename across diverged branches.

**Allowlist (the only places the old word may remain):**
- legacy redirects in `routes/api.js` (`/marble`, `/marble/:shortcode`, `/free/marble/:shortcode`, `/marble-multiplayer.html`),
- the DB migration block,
- this document.

**DB migration.** Add an idempotent block to the startup migrations in `db/init.js` (same place as the existing column back-fills), so it runs before the server accepts connections: `UPDATE … SET game_type = 'deguri' WHERE game_type = 'marble'` per table plus the two session-id prefix rewrites, in one transaction. Record per-table counts before and after. It can be deleted in a follow-up once it has run in production, which brings the allowlist down to the redirects.

**No client shims.** Hand-off keys (`pending*`, `*UserName`, `*ActiveRoom`) are written by the lobby and read by the game page, both renamed together. `marbleDeviceId` and the two sound preferences are simply re-created under the new names: one new device id and a one-time reset of the 데구리 sound toggle and volume. Rooms are in memory and die on every deploy, so open tabs running old JS need a reload either way.

**Order of work.** (1) record baseline: timeline hashes, DB counts, test results; (2) run codemod; (3) review the `마블` list and the identity-translation leftovers; (4) restart the dev server (no auto-reload) and run the acceptance checks; (5) one commit; (6) push to the test branch, verify on lamtest, then run the codemod on `main`.

Architecture reference: `docs/GameGuide/README.md` (this project has no `docs/ARCHITECTURE.md`). After the rename update memory `project_marble_public_slug_deguri` — its "gameType is marble" note becomes wrong.

## Fairness & Integration

- Determinism: no RNG, seed or simulation logic changes. No seed is derived from a string containing the old name (checked `socket/marble.js`, `socket/marble-sim.js`). Proven by the before/after timeline hash criterion.
- Server authority: unchanged; results stay server-only, the `marble`→`deguri` state masking in `socket/rooms.js` keeps the same fields.
- Existing contracts preserved: event payload shapes, catalog item shape, `gameState` shape (key name only), tutorial bit 512, public URLs, `ctx.checkRateLimit()` first line in every handler (security-guard hook).
- Tests: `node AutoTest/deguri-determinism-test.js`, `node AutoTest/qa-deguri-skin-shop-test.js <port>`, `node AutoTest/qa-deguri-gacha-test.js <port>`, `node AutoTest/qa-deguri-start-position-test.js <port>` (renamed files) must pass.

## Files likely involved

| File | Change type |
|------|-------------|
| `marble-multiplayer.html` → `deguri-multiplayer.html` | rename + modify |
| `js/marble.js`, `js/marble-render.js`, `js/marble-shop.js`, `js/marble-gacha.js` → `js/deguri*.js` | rename + modify |
| `css/marble.css`, `css/marble-gacha.css` → `css/deguri*.css` | rename + modify |
| `socket/marble.js`, `socket/marble-sim.js` → `socket/deguri*.js` | rename + modify |
| `config/marble/` → `config/deguri/` | rename + modify |
| `assets/marble/**` → `assets/deguri/**` (229 tracked + 55 untracked) | rename |
| `socket/index.js`, `socket/rooms.js`, `socket/chat.js`, `socket/shared.js`, `socket/scheduled-start.js`, `socket/shop.js` | modify |
| `utils/room-helpers.js`, `routes/api.js`, `db/cosmetics.js`, `db/ranking.js`, `db/stats.js` | modify |
| `db/init.js` | modify (migration block) |
| `js/free.js`, `js/shared/ranking-shared.js`, `js/shared/server-select-shared.js`, `js/shared/shop-shared.js`, `js/shared/tutorial-shared.js`, `dice-game-multiplayer.html` | modify |
| `css/theme.css`, `assets/sounds/sound-config.json`, `assets/ui/icons.manifest.json`, `.gitignore` | modify |
| `AutoTest/*marble*`, `AutoTest/spritemake/*.py`, `AutoTest/devtools.html`, `game-lab/marble-preview.html` | rename / modify |
| `mockups/*.html`, `DESIGN.md`, `CLAUDE.md`, `update-log.md`, `summit-log.txt` | modify |
| `docs/**` (60 files), `.claude/skills/marble-skin/`, `.agents/skills/marble-skin/` | rename + modify |

## Decisions (2026-10-04, user: "너가 다 확인해서 올려" — resolved by checking)

- **Legacy redirects stay.** `/marble`, `/marble/:code`, `/free/marble/:code`, `/marble-multiplayer.html` keep answering 301 — the only runtime lines that still carry the old word.
- **SpriteMake batch folders are not renamed.** 51 folders under `/Users/radar/Work/SpriteMake/output/marble-run-*` are another workspace; text that names an existing dated batch (`marble-run-…-YYYY-MM-DD`) is left as is. New batches are created as `deguri-skin-…` / `deguri-walk-…`.
- **Branch `feature/marble-run` stays** until the Railway test service's deploy branch is changed by the owner; the literal is allowlisted.
- **Databases are separate.** lamtest is its own Railway project with its own Postgres (memory `project_railway_deploy_layout`), so the test deploy's migration does not touch production.
- **Korean `마블런` is left alone.** All 33 lines are history (logs of the 2026-09-21 rename to 데구리) or a third-party product name; rewriting them would make the logs false. Supersedes the Korean item under In scope. `Marble Roulette` (third-party) also stays.
- **Stored cosmetic ids are migrated too.** The local DB holds 37 `user_cosmetics` rows and 1 `users.prefs` row with `marble_*` ids from the first shop implementation, so the migration also rewrites those prefixes (same length, no overflow).

## Rehearsal (2026-10-04, worktree `.claude/worktrees/deguri-rehearsal` from snapshot `refs/backup/pre-deguri-rename`)

Codemod: `output/deguri-rename/rename_deguri.py` (ignored folder, not committed), baseline hashes next to it.

- 128 files rewritten, 80 paths renamed (directories move their contents), 0 tracked paths left with the old word.
- 143 lines keep the old word, all allowlisted: SpriteMake batch names (most, incl. 43 in the asset manifest), the branch literal, `Marble Roulette`, the legacy routes.
- `node --check` passes on all 172 JS files; the five JSON configs parse.
- Simulation timeline hashes identical for 6 seed/size cases; `AutoTest/deguri-determinism-test.js` ALL PASS.
- CRLF files show line-level diffs only (e.g. `css/theme.css` 87 lines).

Not done yet: the DB migration block and every check that needs a running server (socket tests, browser, redirects, ranking counts).

## Open questions

- **Applying under a running session.** "테마 변경 버튼 위치" is still running in this folder and "모든 페이지 다크모드" left uncommitted edits in the same CSS files. Applying in place renames files under them and commits their in-progress edits; their dev servers must be restarted afterwards.
- **Production.** `main` needs the uncommitted feature work (walk sheets, start position, shop tiers …) before the codemod can run there; that is a separate release decision.
