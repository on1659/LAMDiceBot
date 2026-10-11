# Goal: Deguri standalone → LAMDice backport, round 3 (6 items)

## Summary

Bring six viewer-side improvements from the standalone Deguri web app (`/Users/radar/Work/deguri`, deguri.ai.kr) into LAMDice Deguri on `feature/marble-run`. Three of them are the unfinished remainder of the round-2 goal (`docs/goal/deguri-backport-2.md`): the animal yard under "동작 줄이기" (reduced motion), the `inset` CSS fallback for old iOS Safari, and the desktop zoom pill `− 100% +`. Three are new since then: a screen Wake Lock while a race is playing, splitting the gacha dialog's first-open asset load so the machine draws before any capsule art arrives, and the gacha dialog's duplicate-refund presentation (a `중복!` stamp plus a rising `+30` instead of a text line). Everything is per-viewer screen state; no socket event, room field, simulation, or shared UI module changes. Account/login features of the standalone app are explicitly excluded (user decision 2026-10-11, "회원제 빼고").

**This document replaces `docs/goal/deguri-backport-2.md`.** Round-2 item 4 (minimap press/drag moves the camera) is already in LAMDice (`minimapHitAt` in `js/deguri-render.js`) and is not redone. Round-2 items 1–3 are carried over here as items 1–3 with refreshed anchors. When this goal completes, both documents go to `applied/`.

> Baseline: LAMDice `feature/marble-run` HEAD `872ed7e5` (clean tree on 2026-10-11). Standalone Deguri `main` `8001f60`. Line numbers below are approximations (`~`) for that HEAD; find code by function name.

## Scope

### In scope
1. Yard calm mode under `prefers-reduced-motion: reduce` (replaces hiding the yard).
2. `inset: 0` → `top/right/bottom/left: 0` in Deguri-only CSS (3 places).
3. Desktop zoom pill `− 100% +` above the camera button.
4. Screen Wake Lock while a live race or a replay is playing.
5. Gacha dialog: load the machine first (`loadBase`), capsule/ray art per tier on demand (`loadTier`).
6. Gacha dialog: duplicate refund shown as a `중복!` stamp on the stage and a `+30` that rises into the coin label; dialog size identical before and after a pull.

### Out of scope
- Anything from the standalone app's account system: Google/Kakao/Discord login, server wallet, "내 기록", nickname, hash sealing, sessions.
- Standalone-only input structure: remembering the last roster, participant cards, name search, numbering, the 10 base-look cards in the character dialog.
- Standalone site operations: Toss/Discord builds, `/care`, `/race`, board, admin, notice ticker, SEO, GA4, i18n.
- Standalone gacha decisions LAMDice does not adopt: legend odds 4% (LAMDice keeps 7%), local unlimited coins, participant name chips, the "입히면 ○○로 바뀌어요" line, the odds `?` tooltip (LAMDice already has `.mgacha-help`).
- Round-2 item 4 (minimap) — already present.
- The zoom pill on the waiting screen (LAMDice takes no camera input there, round-1 rule 9) and the standalone's centered pill placement/tokens.
- Toss `setAwakeMode`, haptics, back-button handling.
- Jev highlight, result-image share, the 30 standalone-only skins — separate goals.
- Updating the standalone repo's ledger (`deguri/docs/lamdice-backport.md`) — other repository; the user records the LAMDice commit there afterwards.

## How to read the standalone code

- Repo: `/Users/radar/Work/deguri` (branch `main`). The old path in the round-2 document (`/Users/radar/Documents/Codex/...`) is stale.
- Per-commit diff: `git -C /Users/radar/Work/deguri show <commit> -- <file>`. Final state: the working tree (clean on 2026-10-11).
- Item → standalone commits and files:
  - 1: `a3bac86`, `86a853c` — `js/main.js` `startIntroCritters` (`calmMode`, `WEIGHTS`, `start`, `meet`, `poke`), `css/standalone.css` `.intro-critter*`.
  - 2: `a3bac86` — `css/standalone.css` `.intro-critter__body`.
  - 3: `7d929c5`, `9ae84db`, `ed54523` — `js/marble-render.js` (`userZoom`, `zoomStep`, `zoomReset`, `zoomRatio`, `updateZoomLabel`, `updateCamera` two `cam.autoZoom` sites), `css/standalone.css` `.camera-zoom*`. Record: `docs/lamdice-deguri-localization.md` "2026-09-24 카메라 확대·축소 버튼".
  - 4: `776d20a` — `js/main.js` `keepAwake`, `requestWakeLock`, the `visibilitychange`/`pagehide` listeners (~901-932).
  - 5: `74d979d` — `js/deguri-gacha.js` `loadFiles`, `loadBase`, `loadTier`, `startPull` (`tierReady`), `loop` (~686 hold at `TL.pick`), `mount` (`Promise.all([loadBase(), loadTier(...)])`).
  - 6: `f5dc19f` — `js/deguri-gacha.js` `showRefund`, `showResult` (`anim.refunded`, `renderBalance`), `css/standalone.css` `.wardrobe-gacha__dupe`, `.wardrobe-gacha__gain`, `@keyframes gacha-stamp`, `gacha-gain`, `gacha-coin-gain`, the `prefers-reduced-motion` line (~141-147).
- Standalone localisations are **not** brought over (same as rounds 1–2): `mine = false`, emoji labels, `isFirstRule()`, `WIN_RING`, relative asset paths, fullscreen removal, `tr()`/i18n keys, `DEGURI_TOSS` branches, `Math.random` in the yard (LAMDice yard uses the seeded `rand01`).

## Common rules (same as rounds 1–2)

- **Viewer-only state.** Yard motion, user zoom, wake lock, gacha loading and refund animation are not sent over the socket and do not affect other clients. No new socket events, no new room-state fields. Results, simulation and timeline are untouched.
- **Automatic camera stays deterministic.** The pill (3) multiplies the auto camera's chosen zoom by the viewer's `userZoom`; it does not change position/follow/finish-frame decisions.
- **Camera priority unchanged:** manual (dragged) = ranking-row follow > existing auto camera.
- **Shared UI parts and shared CSS are not touched.** Changes live in `js/deguri.js`, `js/deguri-render.js`, `js/deguri-gacha.js`, `css/deguri.css`, `css/deguri-gacha.css` only, under `deguri-`/`mgacha-` prefixed classes. `js/shared/*`, `css/theme.css`, `css/ui-icons.css`, `socket/*` stay as they are. Renderer API: additions only.
- **Colors** follow the existing Deguri tokens (`--deguri-gold`, `--deguri-gold-deep`, `--mgacha-*`); no new hard-coded colors except where the round-2 spec already fixed one (item 3's `#fff8e6` label, same as `.deguri-cam-btn.is-manual`). The `ui-check` hook will flag new literal colors — justify or tokenise.

## Items

### 1. Yard calm mode under reduced motion

**What**
- Today `js/deguri.js` `DeguriYard.init` (~752-759) reads `prefers-reduced-motion: reduce` into `off` and returns early; `setLooks` (~762) also returns when `off`; `css/deguri.css` (~1356-1358) hides `.deguri-yard` under the media query. Replace this with a **calm mode** (`calmMode`): the yard is shown and animals move slowly with calm actions only.
- Why (standalone decision, user 2026-09-24): many phones have this setting on (the user's did); hiding removed the yard entirely, a static yard looked broken.
- Calm mode, as in the standalone:
  - `WEIGHTS` (~500) drop `roll` and `jump`; only `walk`, `idle`, `wave`, `nap`, `leave` remain.
  - Walk speed 24–40 (normal 38–70, `start` ~528-531); no trip while walking (`tripAt = -1`).
  - `meet()` (~607) does nothing: no scuffles, no hops, no startle from a rolling ball.
  - `poke` (~725) picks only `wave` or `nap` (normal: `POKE_ACTS` ~501).
  - Read the setting once at `init`; a change takes effect after reload.

**LAMDice fit**
- Replace `off` with `calmMode`. The existing `calm(c)` helper (~527, "is this animal in a calm action") keeps its name; the mode flag is `calmMode`. `init` still registers `resize`, `visibilitychange` and the `IntersectionObserver` in calm mode; the "stop when off-screen or tab hidden" rule is unchanged.
- **`leave` also walks at 24–40** in calm mode (the standalone left it at 55–80; one animal walking off fast stands out). Report this difference.
- **Obstacles exist only in the LAMDice yard** (~513-700). Apply "no bouncy motion":
  - Kinds: do not spawn the spring board (`launch`) or mud (`slip`); rock, small bush, big bush, log only.
  - Appearing: no fall from above (`OBS_FALL_FROM`, gravity), no landing squash (`.is-landed`), no dust (`.deguri-yard-dust`, `landObstacle` ~645-650), no startled animals. Appear on the ground (`y = 0`, `state: 'stay'`), opacity fade at most.
  - Placement: never under a standing animal — pick an x at least `w/2 + margin` from every animal, or skip this spawn. Otherwise `groundAt` (~674) lifts the feet up to 24 px in one frame.
  - Disappearing: if an animal stands on it, wait until it steps off (today the platform vanishes as the fade starts and the animal drops). Opacity only, no sinking translate.
  - Walking over obstacles (`OBS_RAMP` slope) is calm and stays. `hazards` (~683) does nothing in calm mode (defensive, even with the kinds removed).
- The canvas tap reaction (`reactTo`, round-1 item 12) is a canvas effect and is not changed here; only the yard's `poke` is.
- Keep the nap `z` (`.is-napping::after`) and the walk foot lift (`lift` ≤ 3 px), as the standalone does.
- You may add a read-only `DeguriYard.debug()` (additions only): `calmMode`, per-animal `act`/`speed`/`lift`/`rot`, obstacle kinds/states.

### 2. `inset: 0` → four sides (iOS ≤ 14.4 Safari)

**What**
- `inset` is supported from Safari 14.1 (iOS 14.5). Below that an absolutely positioned box that gets its size only from `inset: 0` collapses to 0×0, so yard animals do not show.
- Replace with `top: 0; right: 0; bottom: 0; left: 0;`.

**Where** (2026-10-11 survey; criteria: Deguri-only file, positional `inset`, `position: absolute|fixed` with no explicit width/height):
- `css/deguri.css` ~1293 `.deguri-yard-critter__body`.
- `css/deguri-gacha.css` ~6 `.mgacha-overlay` (`position: fixed; inset: 0`) and ~91 `.mgacha-wait` (`position: absolute; inset: 0`). Without the change the overlay shrinks to its content on old iOS and the dim backdrop/centering break.
- Other `inset` hits in `css/deguri.css` (~647 `.deguri-gif-range`, ~705 `.deguri-gif-area`, ~153/~164 shop buttons) belong to the replay-GIF overlay and the shop card overlays. They meet the same criteria — convert them too and list them in the report. Not targets: `box-shadow: inset …`, `env(safe-area-inset-*)`, `clip-path: inset(…)`.
- Shared CSS (`theme.css`, `ui-icons.css`, `horse-*.css`) is not touched even if the Deguri page loads it.

### 3. Desktop zoom pill `− 100% +`

**What**
- One pill directly above the camera button: `−` · current zoom % · `+`. Each press multiplies/divides the zoom by `ZOOM_STEP = 1.25`.
- **Auto camera:** keep position/follow/finish-frame decisions; multiply the auto camera's zoom (`cam.autoZoom`) by the viewer's `userZoom`. The followed animal never leaves the screen:
  - when the product is > 1 during the race (`t ≥ 0`), also center the followed animal horizontally;
  - in the finish frame, when `fitZoom × userZoom` no longer fits the frame, follow the focus animal (leader / rear in the last third under the last-place rule) vertically inside the frame; when zoomed out further than fit, keep the frame center;
  - when the clamp (`manualZoomMin()`…`ZOOM_MAX`) blocks a change, leave `userZoom` unchanged so the opposite button reacts immediately.
- **Manual / following:** behave like a pinch about the screen center (`zoomBy`).
- **Center %:** auto → `userZoom` (100% = auto default). Manual → `manual.zoom / manual.base` where `manual.base` is the auto zoom at the moment manual mode began. Pinch, ctrl+wheel and ranking-row follow update the label at once. Pressing the number resets to 100% (auto: `userZoom = 1`; manual: `zoomBy(base / zoom)` about the center).
- **Reset:** `setManual(false)` (camera button, double-click, last-place lock-in, new timeline, waiting screen) and `R.play` (race/replay start) set `userZoom = 1`.
- **Desktop only.** Phones have pinch and the pill only covers the track (user 2026-09-24). On a size change `R.resize` updates visibility.

**LAMDice anchors** (`js/deguri-render.js`)
- Constants ~64-115: add `ZOOM_STEP = 1.25` next to `ZOOM_MAX` (~74) / `ZOOM_MIN` (~77); `HUD_RANK_BOTTOM_GAP` ~100; `MOBILE_ZOOM_MIN` ~112; `MANUAL_ZOOM_MIN_NARROW` ~114.
- `manual` state ~398: add `base`; new `userZoom`.
- `R.debug` ~419: expose `userZoom` (additions only).
- `R.resize` ~422-443: call `updateCamButton()` at the end.
- `R.play` ~486: `userZoom = 1`.
- `setManual` ~524: on → `manual.base = cam.autoZoom || cam.zoom || 1`; off → `userZoom = 1`.
- `updateCamButton` ~538-550: also toggle the pill's `hidden` and refresh the %. Create the pill where the camera button is created (~551-563), same parent (`#deguriCanvasBox`).
- `zoomBy` ~583: refresh the % at the end. `followBall` ~592 already calls `updateCamButton`.
- `updateCamera` ~827-915: inside the finish-frame branch (~875-890, `fitZoom`) and in every other auto branch (after the phone zoom floor ~912) record `cam.autoZoom` and multiply by `userZoom`.
- Ranking panel: `drawHud` `panelMaxH` ~2748 uses `HUD_RANK_BOTTOM_GAP`.
- `css/deguri.css`: pill styles after `.deguri-cam-btn` (~839-865); phone block ~1022; reduced-motion block ~1037 (disable transitions).

**LAMDice fit**
- **Visible when:** same condition as the camera button (`data` present and `phase !== 'idle'`) **and** not a phone. Phone test = `view.narrow` **or** `matchMedia('(hover: none) and (pointer: coarse)')`. A landscape phone (especially fullscreen) is ≥ 600 px wide and would otherwise show the pill.
- **Hide → 100%:** when the pill becomes hidden (window shrinks to phone width) set `userZoom = 1` so no invisible zoom lingers (LAMDice addition).
- **Placement:** the camera button is bottom-right (`right: 10px; bottom: 10px`, ≈38 px tall); the pill is right-aligned directly above it (`right: 10px; bottom: ≈54px`), inside the canvas box so it shows in fullscreen. It must not overlap the replay badge (bottom center), replay chat (bottom-left, 260 px), beta badge/fullscreen button (top-right). The scheduled-start badge exists only on the waiting screen where the pill is hidden.
  - **Ranking panel overlap:** `HUD_RANK_BOTTOM_GAP = 60` (HUD units) was computed for the camera button alone (≈46 CSS px). While the pill is visible, enlarge the gap to at least the HUD-unit equivalent of camera button + pill (≈100 CSS px), using the same conversion as `hudTop` (`px * hw / view.cssW`). Otherwise desktop races with 20+ animals get ranking rows under the pill, and the pill steals their clicks.
- **"내 동물 따라가기" (`highlightMine`) auto camera** works with the same multiply, with three adjustments:
  - horizontal follow target `carried || myFocus || focus` (not just `carried || focus`), or a zoomed-in own animal at the edge leaves the screen;
  - vertical lead: leader/rear/`mine` branches use `view.h * CAM_LEAD` unscaled; with `userZoom` > 1 recompute as `view.h * CAM_LEAD / targetZoom` (as the leader's zoomed segment does), or the followed animal sticks to the top eighth of the screen;
  - decide "in the finish frame" by **which branch actually ran**, not by `frameMode`: LAMDice takes the `mine` branch while the leader is already in the frame zone, with `frameMode` true. A verbatim `!frameMode` port would drop the user zoom there. Use a local flag set inside the frame branch.
  - When the own animal enters the frame zone and `mine` releases, the frame branch continues with `fitZoom × userZoom` (zoom smoothing unchanged). The camera button title "내 동물 따라가는 중" is unchanged.
- Eagle carry (`eagle`), winner celebration (`celebrate`), gravestone scene: same multiply. The celebration's horizontal clamp skip stays. At last-place lock-in, if already auto, `setManual(false)` returns early and `userZoom` persists (same as the standalone).
- **Style:** dark pill like the camera button: background `rgba(43, 36, 22, 0.88)`, border `--deguri-gold-deep`, `−`/`+` glyphs `--deguri-gold`, focus-visible outline `--deguri-gold`. The % label uses the fixed `#fff8e6` (as `.deguri-cam-btn.is-manual`), **not** `--deguri-cream`, which flips to `#33291b` in dark theme (`css/deguri.css` ~83-110) and vanishes on the dark pill. If `display: inline-flex` is used, add `[hidden] { display: none; }`. Classes: `.deguri-zoom-pill`, `__btn`, `__value`.
- Glyphs are text: `−` (U+2212), `+`, `%`. No new assets. `aria-label`/`title` per button: `카메라 축소` / `카메라 배율 100%로 되돌리기` / `카메라 확대`.

### 4. Screen Wake Lock while a race plays (new)

**What**
- While a live race or a replay is playing, request `navigator.wakeLock.request('screen')` so a phone does not dim/lock mid-race. Release when the result overlay opens, the replay stops, the race is aborted, the round is reset, or the page is hidden (`pagehide`). If the browser released it (tab hidden) and the race is still on, re-request on `visibilitychange` → `visible`.
- Spectators are viewers too; the same rule applies to every client.
- Browsers without `navigator.wakeLock` (older iOS) do nothing; failures (`request` rejects, e.g. battery saver) are ignored silently.

**Standalone reference:** `776d20a`, `js/main.js` `keepAwake(on)` / `requestWakeLock()` (~901-932); the Toss `setAwakeMode` path is not brought.

**LAMDice placement** (`js/deguri.js`, page level — not in the renderer, which has no page lifecycle)
- Add `keepAwake(on)` + `requestWakeLock()` near the replay helpers (~1086-1130), guarded by an `awakeOn` flag so repeated calls are no-ops.
- On: `socket.on('deguri:reveal')` (~1843) at the start of the handler (so the 4-second countdown is covered), and `replayRace` (~1142) right after `replaying = true`.
- Off: `socket.on('deguri:gameEnd')` (~1877, before `showResultOverlay`), `stopReplay` (~1164, every exit), `deguri:gameAborted` (~1894), `deguri:roundReset` (~1909), `window` `pagehide` (an existing listener at ~1431 handles `clearScheduledStart`; add a separate listener, do not merge).
- "Still on" for re-request = `isDeguriActive || replaying` (`isDeguriActive` ~59, `replaying` ~1089). The live race also has `document.body.classList.contains('race-running')` (~1855/1898/1917) but use the JS flags, not the CSS class.
- Verify with `grep -n "renderer.play(" js/deguri.js` that both play sites (~1150 replay, ~1870 reveal) are covered; if a late-join path starts playback elsewhere, hook it the same way.
- A paused replay keeps the lock (the viewer is still watching); it releases on `stopReplay`.

### 5. Gacha: machine first, tier art on demand (new)

**What**
- Today `js/deguri-gacha.js` `loadAll` (~97-116) loads the machine (7), `sparkle`, `coin`, the UI icon atlas, `gacha-anchors.json`, `cosmetics.json`, **and** for all four tiers `cap`/`open`/`rays`/`cup`/`lid`/`lidflip` (24 images) before `open()` draws frame 0. On a slow line the dialog shows the "뽑기를 누르면…" hint over an empty stage for seconds. The standalone measured 590 KB for the all-at-once load vs 150 KB for the base set (`74d979d`); measure LAMDice's own numbers in the report.
- Split into:
  - `loadBase()` — machine 7 + `sparkle` + `coin` + `chuteFront` + atlas + anchors + catalog. Cached in `_loading`; on failure reset `_loading = null` so the next `open()` retries (standalone `loadBase`).
  - `loadTier(t)` — the six images of one tier. Cache per tier (`_tierLoading[t]`).
- `open()` → `Promise.all([loadBase(), _anim ? loadTier(_anim.res.tier) : null])` (a previous result reopens with its tier art), then the existing `drawAt(0)` / result-loop logic.
- `pullOnce()` → when the server ack arrives (`deguri:gacha:pull` cb with `tier`), call `loadTier(res.tier)` and set `_anim.tierReady = true` when it resolves, before/at `_anim` creation. The animation starts immediately (the coin → crank phase needs no tier art).
- `loop()` (~ "function loop") → hold: `if (!_anim.tierReady && t > TL.pick && t < TL.end) { _anim.t0 = now - TL.pick; t = TL.pick; }` — the animation parks at the instant the ball is about to turn into a capsule (`timeline().pick`, first `cap-` use at ~339) until the art is there, then continues. Normally `loadTier` (~100 KB) finishes during the ≥ 3.4 s coin+crank phase and the hold never triggers.
- **Skip is not held:** `skip()` jumps `t0` to the end as today. The final frame's `drawAt` already guards each image with `ready()` (~378/383/392/565/634), so a still-missing capsule/rays simply appears when it loads; the loop keeps running on the result screen. Do not add a wait to skip.
- `ASSET_VER` stays one string. Image keys (`_img['cap-' + tier]` etc.) are unchanged so `drawAt` does not change.

**Standalone reference:** `74d979d` — `loadFiles`, `loadBase`, `loadTier`, `startPull` `tierReady`, `loop` hold (~686), `mount`.

### 6. Gacha: duplicate stamp + rising `+30`, fixed dialog size (new)

**What**
- Today a duplicate pull writes `이미 가진 거라 30코인을 돌려받았어요` into `.mgacha-note` (~711 build, ~827 `showResult`; CSS ~105-106 folds it when empty). Replace with:
  - a `중복!` stamp (`.mgacha-dupe`) on the stage, top-right, below the coin label (`.mgacha-coin` is `top: 8px; right: 8px`); rotated −8°, pops in over 260 ms (standalone `@keyframes gacha-stamp`: scale 1.8 → 1). Appears when the result shows (`showResult`), hidden on a non-duplicate result and on the next pull.
  - a `+30` (`.mgacha-gain`, text = `'+' + res.refund`) that starts at the stamp and rises ≈34 px into the coin label over 900 ms (`GAIN_MS`, standalone `gacha-gain`: opacity 0→1→0, translateY 6 → −34). When it lands, the displayed balance increases by the refund and the coin label flashes with the existing `.is-gain` (`mgachaGain`, CSS ~53/~74).
- **Balance timing.** The server ack's `balance` (`socket/deguri.js` ~742) already includes the refund. Today `payShown()` shows it at `TL.crank0`. For a duplicate: show `balance - refund` at `crank0` (the coin went in), and the full `balance` when the `+30` lands (`_anim.refunded = true` → `renderBalance()` shows `_balance - (dupe && !refunded ? refund : 0)`). Reopening a finished duplicate result (`open()` with `_anim.done`) shows the stamp only, no `+30` animation, full balance (already refunded). If `wallet:updated` or the 30 s poll delivers a new balance mid-animation, accept it — no blocking.
- Remove `.mgacha-note` (JS and CSS) since nothing else uses it ("내 변경이 만든 미사용 제거").
- **Fixed size.** `.mgacha-result` is already a fixed 90 px box with `overflow: hidden`, and the stamp/`+30` are absolutely positioned over the stage, so the modal's height must be identical before and after a pull (duplicate or not). Verify by measuring `.mgacha-modal.getBoundingClientRect().height` at: dialog opened (hint), during the animation, result (non-dup), result (dup). All four equal.
- `prefers-reduced-motion`: stamp appears without the pop, `+30` is skipped (balance updates immediately), `.is-gain` flash off — add these to a `@media (prefers-reduced-motion: reduce)` block in `css/deguri-gacha.css` (there is none today; create it at the end of the file).
- Colors: stamp = the existing pull-button red (`--mgacha-pull`) with white border/text (`--text-on-accent`), shadow `--mgacha-pull-shadow`; `+30` text = `--mgacha-legend` (gold) as the existing `mgachaGain` uses. No new literals.

**Standalone reference:** `f5dc19f` — `showRefund`, `showResult` (`refunded`), `renderBalance`; CSS `.wardrobe-gacha__dupe`, `.wardrobe-gacha__gain`, keyframes, reduced-motion line.

## Acceptance criteria

- [ ] 1: Phone emulation (375×812, touch) with `reducedMotion: 'reduce'` set **before** page load: `#deguriYard` is visible (not `is-empty`, height 60) once participants have picked animals; over 20–30 s positions change, walk/leave speed ≤ 40 px/s, only `walk/idle/wave/nap/leave` occur, `rot` stays 0, no `.deguri-yard-dust`, obstacles are rock/bush/log only and never fall, every tap yields only wave or nap. Without reduce: roll, jump, scuffle, spring board, mud behave as before.
- [ ] 2: `grep -nE '(^|[{;[:space:]])inset[[:space:]]*:' css/deguri.css css/deguri-gacha.css deguri-multiplayer.html js/deguri*.js` returns 0 lines and `grep -n 'style\.inset' js/deguri*.js` returns 0 lines. Visual check at desktop + phone widths that the gacha overlay, the GIF range/area overlays and shop card overlays still cover their boxes.
- [ ] 3: Desktop 1280×800 during a race: the pill sits directly above the camera button; its rect overlaps none of camera button, replay badge, beta badge, fullscreen button; in a 20+ animal race the last ranking row ends above the pill. Auto: `+` twice → 156%, `debug().cam.zoom` ≈ 1.56 × auto (within clamp), `cam.mode` unchanged, followed animal on screen; `−` → 125%; number → 100%; at the clamp the opposite button reacts at once. Manual: % right after a drag = screen zoom ÷ auto zoom; `+` multiplies by 1.25; ctrl+wheel and ranking follow update %; number → 100%. Resets to 100% on camera button, double-click, last-place lock-in, next race, replay. "내 동물 따라가기" + `+` twice: own animal stays inside both axes (not pinned to the top eighth) including while the leader is already in the frame zone. Visible and clickable in desktop fullscreen. Phone 375×812, 390×844, landscape 844×390 (touch): pill `hidden`; resizing 1280 → 375 → 1280 toggles it and resets to 100% when hiding. Not shown on the waiting screen. % label readable in dark theme.
- [ ] 4: On a phone/Chrome desktop with `navigator.wakeLock`: `await navigator.wakeLock` sentinel exists (`debug` hook or `performance`/`chrome://` check) from `deguri:reveal` until `deguri:gameEnd`, and during a replay until it stops; released on gameAborted, roundReset, pagehide. Hide the tab mid-race, show it again → re-acquired. A browser without `wakeLock` logs no error. Spectator client behaves the same.
- [ ] 5: Network tab on first open of the gacha dialog shows only base assets (machine 7, sparkle, coin, chuteFront, atlas, anchors, catalog) — no `capsule-*`/`gacha-rays-*`; the machine draws before any capsule request. A pull requests exactly the six images of the returned tier. On a throttled line (DevTools "Slow 3G") the animation parks at the ball-pick moment until they arrive, then continues; skip still jumps to the end immediately. Reopening a finished result loads that tier's art only. Report the measured before/after byte counts.
- [ ] 6: Duplicate pull: `중복!` stamp pops in at the stage's top-right under the coin label; `+30` rises into the coin label over ≈0.9 s; the coin label then shows the refunded balance and flashes. Non-duplicate: no stamp, no `+30`. Reopen after a duplicate: stamp only, full balance. `.mgacha-modal` height identical in all four states (opened / animating / result / duplicate result). `reduce` motion: stamp without pop, balance updates immediately. `.mgacha-note` no longer exists in JS or CSS.
- [ ] `node --check js/deguri.js js/deguri-render.js js/deguri-gacha.js` passes; `AutoTest/deguri-determinism-test.js` (results/timeline unchanged), `AutoTest/qa-deguri-skin-shop-test.js`, `AutoTest/qa-deguri-gacha-test.js`, `AutoTest/qa-deguri-account-wallet-test.js` pass; console errors 0.
- [ ] Two or more browsers (host + participant + spectator): one client using the pill, wake lock or gacha does not change another client's `debug().manual.on`/`cam` or anything else.
- [ ] Other game pages (horse etc.) unchanged: `git diff --stat` touches only the five Deguri files listed below (+ `update-log.md`, docs).
- [ ] `update-log.md` entry in `docs/update-log-format.md` format. No new assets.
- [ ] On completion append both `docs/goal/deguri-backport-3.md` and `docs/goal/deguri-backport-2.md` to `.claude/.goal-applied-queue`, one line each.
- [ ] Final report: per-item summary, files, test commands and results, self-assessment, open issues, and every point where LAMDice deliberately differs from the standalone (leave speed, calm obstacles, landscape-phone hide, 100% on hide, vertical lead fix, frame-branch flag, wake lock during paused replay, skip not held, balance-minus-refund timing).

## Implementation notes

- **Order:** 2 → 1 (yard/CSS) → 3 (pill) → 4 (wake lock) → 5 (gacha load) → 6 (gacha stamp). One stage at a time, verified, committed per stage per repo rules. 3 touches `bindCameraInput`/`updateCamera`; 5 and 6 both touch `loop`/`showResult` — finish and verify one before the next.
- Read the standalone diff first, compare with the LAMDice function, then port. Do not paste wholesale (see "not brought over").
- Plan for phone (375×812, 390×844, landscape 844×390), desktop (≥ 600 px) and fullscreen (desktop, Android Chrome) from the start; the `mobile-guard` hook will warn about `@media`/viewport.
- Hooks: `security-guard` is irrelevant (no `socket.on`); `fairness-guard` may flag the gacha `Math.random`-free rule — keep it that way (`drawAt` is a pure function of `t`); `ui-check` flags new literal colors — item 3's `#fff8e6` and `rgba(43,36,22,.88)` are the round-2 decisions, state that in the commit.
- Numeric constants (`ZOOM_STEP`, `GAIN_MS`, calm speed range) go in the file-top `const`/`var` blocks per project rule.
- Testing the yard needs participants with picks: host via browser (`localStorage.pendingDeguriRoom` + `/deguri?createRoom=true`), guests via socket.io-client (`joinRoom` → `toggleReady` → `deguri:pick`); see memory `project_deguri_backport_done` for the quirks (re-joining the same name after a reset is a reconnect, votes toggle).
- Refer to `docs/GameGuide/README.md` for the socket contract and `docs/GameGuide/lessons/_common.md` + `lessons/deguri.md` before editing.

## Fairness & Integration

- Determinism: no change to `socket/deguri-sim.js`, seeds, timelines or the winner decision. The yard keeps the seeded `rand01`; the gacha animation stays a pure function of `t`; no client `Math.random` is introduced.
- Server authority: results are still decided only on the server. No browser-only API (`wakeLock`, `matchMedia`) enters simulation modules; they live in `js/deguri.js` / `js/deguri-render.js` / `js/deguri-gacha.js`.
- Existing contracts preserved: `deguri:reveal`/`deguri:gameEnd`/`deguri:gacha:pull` payloads unchanged; renderer API additions only; round-1/round-2 behaviors (manual camera, camera button, ranking follow, tap reactions, minimap jump, result card, HUD, yard normal mode, replay bar + GIF, shop, gacha) keep working; "내 동물 따라가기" switch, fullscreen button (iOS hidden) and fullscreen sizing unchanged; reconnect restore unchanged.
- Pre-reveal masking unchanged: items 3/4 only change how/when the viewer looks at an already received timeline.
- Tests: the four `AutoTest/*deguri*` scripts above must pass with unchanged determinism output.

## Files likely involved

| File | Change type |
|------|-------------|
| `js/deguri.js` | modify (1: `DeguriYard` calm mode; 4: `keepAwake`, hooks in reveal/gameEnd/abort/reset/replay) |
| `js/deguri-render.js` | modify (3: `ZOOM_STEP`, `userZoom`, `manual.base`, pill DOM, `updateCamera`, `HUD_RANK_BOTTOM_GAP` handling) |
| `js/deguri-gacha.js` | modify (5: `loadBase`/`loadTier`, `tierReady` hold; 6: stamp/`+30`, `refunded`, remove `note`) |
| `css/deguri.css` | modify (1: remove yard `display:none` under reduce; 2: `inset` → four sides; 3: `.deguri-zoom-pill*`) |
| `css/deguri-gacha.css` | modify (2: `inset` → four sides; 6: `.mgacha-dupe`, `.mgacha-gain`, keyframes, reduce block; remove `.mgacha-note`) |
| `update-log.md` | modify |
| `docs/goal/deguri-backport-2.md` | archived together with this document on completion (no edit) |

## Open questions

- None blocking. If the measured LAMDice first-open gacha payload turns out to be small (e.g. < 250 KB because the LAMDice capsule art is lighter), item 5 is still implemented for parity but the report should say so.
