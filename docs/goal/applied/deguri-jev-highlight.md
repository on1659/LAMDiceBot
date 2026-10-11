# Goal: Deguri Jev highlight — auto-picked 6-second GIF of every race, shown in the result card

## Summary

Port the standalone Deguri (deguri.ai.kr) "Jev 하이라이트" to LAMDice Deguri: after every race the result card gets a ready-made 6-second GIF of the most watchable moment. Code scans the finished timeline for candidate windows and describes each with plain facts (last/first place changes, the turning point and its cause, eagle grabs, scuffles, trips, the closing gap). TypeSafe **Jev** picks one (or code score when Jev is unavailable). Each viewer's browser re-renders that window on an off-screen canvas with a camera that follows the scene animals and encodes a GIF while the race is still playing, so the result card button opens a finished GIF. The card swaps the ranking list for the GIF, shows a one-line reason, 👍/👎 and [GIF 저장]. **Auto-play (standalone, user 2026-10-12, uncommitted there):** 3 s after the result card opens, the GIF is shown once from the start (6 s) and the card returns to the ranking by itself, once per race, cancelled by any tap.

The LAMDice difference is structural: the server already owns the timeline and the room, so **candidate extraction, the Jev call and the code fallback run on the server once per race** and the pick is broadcast to the room. Clients only render. Feedback (👍/👎/save) is stored per viewer in Postgres and turns into code-score weight multipliers on the server; no weights are sent to clients.

Standalone source: `/Users/radar/Work/deguri` — `js/jev-highlight.js` (pure half: `segments`/`simTime`/`playTime`/`standings`/`changes`/`turningPoint`/`candidates`/`codePick`/`payload`/`reasons`; browser half: `create()` with `render`/`fill`/`show`/`sync`/auto-play), `server/jev.js` (`cleanFacts`/`clean`/`describe`/`request`/`highlight`), `server/jev-feedback.js` (`featuresOf`/`computeWeights`), `js/marble-render.js` (`create(canvas, { dpr })`, `R.frameBalls` + `clipIds` camera ~836-850), `index.html` ~169-175 (markup incl. inline-SVG thumbs), `css/standalone.css` ~223-234, `js/i18n/ko/home.js` ~82-93 and ~284-327 (strings), `docs/goal/deguri-jev-highlight.md` (their decisions). The auto-play is in the standalone **working tree** (`git -C /Users/radar/Work/deguri diff -- js/jev-highlight.js`), not yet committed — read it from the working tree.

> Baseline: LAMDice `feature/marble-run` HEAD `872ed7e5` + the uncommitted round-3 backport (`docs/goal/deguri-backport-3.md`: `js/deguri.js`, `js/deguri-render.js`, `js/deguri-gacha.js`, `css/deguri.css`, `css/deguri-gacha.css`, `update-log.md`). Build on that tree; do not touch its hunks. Line numbers below are approximate (`~`) for that tree.

## Scope

### In scope
- Server: pure highlight module (candidates, code pick, facts, reason keys) ported to Node; Jev HTTP client with timeout and no-key fallback; one pick per race broadcast as `deguri:highlight`, also carried on `deguri:gameEnd`; per-room single in-flight call and a global per-minute cap.
- Server: feedback event `deguri:highlight:feedback` with rate limit and `rid` check; Postgres table; weight multipliers computed on the server and applied to the code score of later races.
- Client: off-screen render of the chosen window into a 360-px-wide GIF (10 fps, ≈6 s + 1 s pre-roll) during the race; result-card swap ranking ↔ GIF with locked card height; reason line with a "Jev" badge only when Jev chose; 👍/👎 (inline SVG thumbs) and [GIF 저장] reusing the replay-GIF save/share path; auto-play once per race as specified below.
- Renderer: `DeguriRender.create(canvas, opts)` with `opts.dpr`, and `R.frameBalls(ids)` scene camera (additions only).
- Config: `TYPESAFE_API_KEY` / `JEV_API_URL` in `config/index.js`; Railway variables on both the production service and `LAMDice_test`.
- Tests: pure-module determinism/privacy test, socket test for the broadcast + feedback, Playwright test for the card swap and auto-play.
- `update-log.md` entry.

### Out of scope
- Predicting or influencing results; anything in `socket/deguri-sim.js`, seeds, `Math.random` in the simulation.
- Jev writing the reason (reason comes from the chosen candidate's facts).
- Video export; sending the GIF to the server or to other players; chat sharing.
- Google Analytics events (LAMDice has no GA4); the standalone's `arm` A/B *reporting* UI (`scripts/jev-feedback.js`) — the arm field is stored, the report script is not ported.
- Late joiners who never received `deguri:reveal` (they cannot render; the button stays hidden for them).
- The standalone's Toss/Discord/i18n branches, GA, `DEGURI_API_BASE`.
- Changing the manual replay-GIF recorder's behaviour (it must keep working as today).
- Horse and other games.

## Acceptance criteria

- [ ] After a real race, every client that received `deguri:reveal` (players and spectators) shows a button row above [확인] in the result card: `[하이라이트 보기]` (with a "Jev" badge in the note only when `source === 'jev'`) and, while the GIF is shown, `[순위 보기]` + `[GIF 저장]`. Pressing it swaps the ranking list for the GIF without the card changing height; a narrow card folds the winner sprite (`.is-compact`) when the GIF would not fit.
- [ ] The GIF covers exactly the chosen window (`clip.start`…`clip.end` playback ms, ±1 frame at 10 fps), is 360 px wide, plays at normal speed, loops, and its blob exists before `deguri:gameEnd` arrives on a normal connection (rendering starts when `deguri:highlight` arrives, during the race).
- [ ] Auto-play: with the GIF ready, 3 s after the result card opens it switches to the GIF from frame 0, stays `CLIP_MS + 300` ms, then returns to the ranking. If the GIF is not ready at 3 s it plays as soon as it is, but not later than 10 s after opening; after that it does not auto-play. Once per race (reopening after a replay does not repeat it). Any press on the highlight button, [GIF 저장], 👍/👎 or closing the card cancels it. The auto-played view counts as "seen" for nothing else (no analytics in LAMDice).
- [ ] With `TYPESAFE_API_KEY` set on the server, exactly one Jev request per race (verified by a counter in the socket test with a stubbed `fetch`); the broadcast carries `source: 'jev'`. Without the key, on error or after the timeout (3.5 s) the code pick is broadcast with `source: 'code'` and no "Jev" label anywhere. One race in five (`CODE_SHARE = 0.2`, server RNG) skips Jev on purpose (`arm: 'code'`).
- [ ] The Jev request body contains participant slot numbers and creature ids only; never names, skin names, room names or socket ids (test serialises the request built from a roster with names and asserts none appear).
- [ ] `deguri:highlight` payload = `{ rid, source, arm, clip: { start, end, ids }, facts, reason: { key, params, ball? } }` where `start/end` are playback ms inside `[0, durationMs]`, `ids` are ball ids of that race, and `reason.key` is one of the keys listed under "Reason strings". The same object is included as `highlight` in `deguri:gameEnd`.
- [ ] `deguri:highlight:feedback { rid, vote: 1 | -1 | null, saved: boolean }` is accepted only for the room's current or last race `rid`, from a socket in that room, rate-limited (`ctx.checkRateLimit()`), ack `{ ok: true }`; a wrong `rid` or shape acks `{ ok: false, reason: 'bad_request' }`. One row per `(rid, viewer name)`, vote overwrites, `saved` is sticky. The row's `facts`/`arm`/`mode` come from the server's own record, not from the client.
- [ ] Weight multipliers (0.5–2×, shrunk toward 1 while votes are few — standalone `PRIOR = 10`, `TRUST = 30`) are recomputed from the table at most every 5 minutes and multiply the base `WEIGHTS` of later races' code score. With no DB (local dev without `DATABASE_URL`) feedback is kept in memory only and nothing crashes.
- [ ] Determinism: same timeline + same multipliers → identical candidates and code pick (test on 5 simulated seeds, twice).
- [ ] `AutoTest/deguri-determinism-test.js`, `qa-deguri-gacha-test.js`, `qa-deguri-skin-shop-test.js`, `qa-deguri-account-wallet-test.js`, `qa-deguri-first-rule-test.js` still pass; manual replay-GIF recording unchanged; `node --check` on every touched file; `node AutoTest/check-hardcoded-colors.js` clean; console errors 0 (ad route aborts excluded).
- [ ] Phone (375×812) and desktop (1280×800): card stays inside the viewport, the GIF fits the card width (`.result-card.deguri-result-card` is 300 px / `100vw − 20px`), the ranking max-height rule on phones (38vh) still applies when swapped back.
- [ ] Light and dark skins: note, badge, thumbs and buttons use existing Deguri tokens (`--deguri-ink`, `--deguri-wood-line`, `--deguri-gold`, `--deguri-paper`…); no new literal colors.
- [ ] `update-log.md` entry in `docs/update-log-format.md` format. `docs/GameGuide/lessons/deguri.md` gets a lesson only if a new trap shows up.
- [ ] On completion append `docs/goal/deguri-jev-highlight.md` to `.claude/.goal-applied-queue`.

## Implementation notes

### Flow (LAMDice)

1. `socket/deguri.js` `startDeguri` (~401-500): right after `sim.simulate` + `attachCosmetics`, build `mb.highlight = pickHighlight(payloadLikeTimeline)` **asynchronously** so it overlaps the roulette/reason hold (`holdMs` ≥ 3 s) — do not delay `deguri:reveal`. `pickHighlight` = `highlight.candidates(tl, weights.current())` → if none, `null`; else arm by server RNG (`Math.random() < CODE_SHARE` → `'code'`), else `jev.ask(payload)` with `AbortSignal.timeout(3500)` → `'jev'` or `'fallback'`. Result stored as `{ rid, source, arm, pick, clip, facts, reason }` on `mb` (server-only; `rooms.js` ~175 re-entry whitelist does not expose it — leave the whitelist alone).
2. When both the reveal has been emitted and the pick is ready, `io.to(room).emit('deguri:highlight', pub(mb.highlight))`. Order: if the pick resolves before the reveal timer fires, emit it right after `deguri:reveal` inside the same timer callback; otherwise emit when it resolves (still during countdown/race). Guard with `ctx.rooms[room.roomId]` and `mb.seed === seedAtStart` (a reset in between drops it).
3. `endGame` (~510-526): add `highlight: pub(mb.highlight)` to the `deguri:gameEnd` payload (null when none). Keep `mb.highlight` until the next `startDeguri`/reset so feedback can still be matched; `clearDeguriRound`/reset sets it to `null`.
4. Client `js/deguri-highlight.js` (new, `window.DeguriHighlight`): `connect(socket)` listens to `deguri:highlight`; `onReveal(data)` cancels the previous race's state; `start(highlight)` requires `deguriState.reveal` (same `rid` not needed — one race at a time) and renders; `onGameEnd(data)` starts rendering from `data.highlight` if nothing started (missed broadcast); `onResultOpen()` / `onResultClose()` are called from `showResultOverlay` (~1260) / `closeResultOverlay` (~399) for the auto-play timers; `sync()` is called at the end of `showResultOverlay` to show/hide the button row.
5. Rendering (port of standalone `render`): `var R = DeguriRender.create(canvas, { dpr: 1 }); R.setTimeline(deguriState.reveal, null); R.setHighlight(false); R.frameBalls(clip.ids); R.setPhase('play');` then a `setTimeout` loop from `clip.start − PREROLL_MS (1000)` to `clip.end` stepping `FRAME_MS (100)`: `R.render(t, 0.1)`, and when `t ≥ clip.start` draw the canvas scaled to 360 px wide into a `willReadFrequently` 2D context and push `getImageData().data.buffer` to the encoder with delay 10 (1/100 s). Gap between frames = `max(RENDER_GAP_MS 40, 2 × draw time)` so the live race keeps its frame rate. A detached canvas has `clientWidth 0`, so `R.resize` falls back to `TRACK_W` × `DESKTOP_ASPECT` (800 × 576) — that is the intended desktop framing; the off-screen renderer never creates the camera button/zoom pill because `canvas.parentElement` is null.
6. Encoder: `js/deguri-replay-gif.js` (~233) exports only `create`. Add `encoder(w, h)` (wraps `new Worker(WORKER_URL)`: `start` → `frame(buf, delay)` → `finish()` → Promise<Blob>, `cancel()`) and `saveGif(blob, url, name)` (the existing desktop download / phone share-sheet logic in `saveButton` ~202-220, factored out), and have the manual recorder use them. Export `{ create, encoder, saveGif }`. The worker protocol is already `{type:'start',w,h}` / `{type:'frame',buf,delay}` / `{type:'finish'}` ⇒ `{type:'done',blob}`.
7. Result card (`deguri-multiplayer.html` ~443-450 + `css/deguri.css` ~1092-1235): inside `.deguri-result-body` add `<div class="deguri-highlight" id="deguriHighlightView" hidden>` with the frame (`<img id="deguriHighlightGif">` + "GIF 만드는 중…" span), the foot (note `<p>` + two vote buttons with the standalone inline-SVG thumb, the down one rotated — no emoji), and above the [확인] row a `<div class="deguri-highlight-buttons" id="deguriHighlightButtons" hidden>` with `[하이라이트 보기]` (atlas icon `mi-play` or `mi-replay`, not 🎬 — emoji are replaced by the UI icon atlas in LAMDice) and `[GIF 저장]`. `show(on)`: on first swap set `.deguri-result-card` inline height to its current height; hide `.deguri-result-ranks` and show the view; if the frame is shorter than `0.9 ×` the GIF's scaled height add `.is-compact` to the card (hides the winner sprite canvas, keeps the name line). `closeResultOverlay` clears the inline height and `.is-compact`.
8. Reason line: `reasons(tl, pick)[0]` → Korean template (table below), `{name}` = owner name shortened like `resultShortName` (6 chars + …) when `owner: true`, else the creature's Korean name (`CREATURE_NAMES` in `js/deguri.js` / `socket/deguri.js` `CREATURES`). Templates live in `js/deguri-highlight.js` as a `REASON` const block (no i18n layer in LAMDice).
9. Auto-play (standalone working-tree logic): `onResultOpen()` → if `cur && !cur.autoPlayed && !auto` set `auto = { openedAt, timer: setTimeout(tryAuto, 3000) }`; `tryAuto()` → bail if card closed, already showing, or `Date.now() − openedAt > 10000`; if GIF not ready yet, do nothing (the render-finished callback calls `tryAuto()` again); else `autoPlayed = true`, `show(true)`, reset the `<img src>` to `url + '#auto'` so the GIF starts from frame 0, `back = setTimeout(() => show(false), CLIP_MS + 300)`. `stopAuto()` in the button/save/vote handlers and in `onResultClose()`.
10. Feedback: 👍/👎 toggle (`vote` 1/−1/null) and [GIF 저장] (`saved: true`, sent once) → `socket.emit('deguri:highlight:feedback', { rid, vote, saved }, ack)`; failures are ignored (the UI keeps its state).
11. `js/deguri.js` hooks: `deguri:reveal` (~1886) → `DeguriHighlight.onReveal(data)`; `deguri:gameEnd` (~1921) → `DeguriHighlight.onGameEnd(data)` before `showResultOverlay`; `roundReset`/`gameAborted` → `DeguriHighlight.cancel()`; `replayRace` leaves the highlight alone (the GIF stays valid for the same race).

### Server modules

- `socket/deguri-highlight.js` (new): the standalone pure half verbatim where possible (`CLIP_MS 6000, STEP_MS 500, TAIL_MS 1500, HOLD_MS 400, SETTLE_MS 5000, MIN_GAP_MS 3000, MAX_CANDIDATES 8, MAX_IDS 4, MAX_ANIMALS 3, CLOSE_MS 1000, NECK_PX 40, LATE_MS 6000, GAP_CLOSE_MS 3000, CAUSE_BEFORE_MS 3000, WEIGHTS {...}, CAUSES {...}`). Differences: `modeOf(tl)` reads `tl.target === 'first'` (LAMDice) instead of `tl.result.selectionMode`; the timeline object is the server `payload` built in `startDeguri` (`frames`, `events`, `finishOrder`, `balls`, `track.goalY`, `sampleMs`, `durationMs`, `slow`, `fast`, `cutMs`). Event names (`finish`, `land`, `eagleGrab`, `eagleMiss`, `eagleDrop`, `scuffle`, `trip`, `pitFall`, `bump`, `nap`/`doze`, `mud`) — verify each exists in `socket/deguri-sim.js` with the same field names (`ball`, `a`/`b`, `t`) before relying on it; `standings()` must use the same progress definition as the renderer (`progress()` in `js/deguri-render.js`: y while rolling, `goalY + x` while walking the lane after `land` until `eagleGrab`). Export `{ candidates, codePick, payload, reasons, simTime, playTime, WEIGHTS, CLIP_MS }`.
- `socket/jev.js` (new): `describe/request` from standalone `server/jev.js` (English sentence builder, `MODEL 'jev-latest'`, `API_URL` from config, `TIMEOUT_MS 3500`), `ask(payload) → Promise<pickId | null>`; `AbortSignal.timeout`; logs failures with `[데구리] Jev` prefix; no per-IP limiter (server-initiated) but a module-level token bucket `JEV_MAX_PER_MINUTE = 60` and one in-flight per room (`mb.highlightPending`).
- `db/deguri-highlight-feedback.js` (new) + `db/init.js` table:
  ```sql
  CREATE TABLE IF NOT EXISTS deguri_highlight_feedback (
    rid TEXT NOT NULL, viewer TEXT NOT NULL, arm TEXT NOT NULL, mode TEXT NOT NULL,
    facts JSONB NOT NULL, vote SMALLINT, saved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rid, viewer)
  );
  ```
  `upsert(row)`, `recentRows(limit 5000)`, and `weights()` (cached 5 min) = standalone `computeWeights` (`featuresOf`, `labelOf`, `PRIOR 10`, `TRUST 30`, `MULT_MIN 0.5`, `MULT_MAX 2`). `getPool()` null → in-memory array (`MAX_ROWS 5000`). Follow `db/coins.js` style (pool.query with params, no string interpolation).
- `socket/deguri.js`: `rid` = 22-char URL-safe base64 from `crypto.randomBytes(16)`; `pub(h)` strips `pick` internals and keeps `{ rid, source, arm, clip, facts, reason }`; handler `socket.on('deguri:highlight:feedback', (data, cb) => { if (!ctx.checkRateLimit()) return; ... })` (the `security-guard` hook requires `ctx.checkRateLimit(` in every `socket.on`); viewer name = the room user's name for this socket.
- `config/index.js`: `TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || ''`, `JEV_API_URL = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone'`. Document both in the Railway memo (`project_railway_deploy_layout`): add to DiceBot (prod) and LAMDice_test. Never log or emit the key.

### Renderer additions (`js/deguri-render.js`)

- `create(canvas, opts)` (~387): `opts.dpr` overrides `Math.min(2, devicePixelRatio)` in `R.resize` (~435). Nothing else changes for the live renderer.
- `R.frameBalls(ids)` + `clipIds` camera: port standalone ~572-573 and ~839-850 — after the auto branches (and after the round-3 `userZoom` block) and before the manual branches: when `clipIds && t >= 0`, compute the bounding box of the scene balls (skip `warp` and stand-seated `done` balls; stop adding a ball when the box would exceed the view with `CLIP_PAD 80`), set `targetX/targetY` to its centre, `targetZoom = clamp(min(view.w / (w + 2·pad), view.h / (h + 2·pad)), 1, ZOOM_MAX)`; the horizontal wall clamp below still applies. The live renderer never sets `clipIds`, so no behaviour change there.

### Reason strings (port of standalone `jev.reason.*`, Korean, plain)

| key | text |
|---|---|
| turnLast / turnLastBy.{eagleGrab,pitFall,mud,trip,nap,scuffle} | `{name} 여기서 꼴찌로` / `{name} 독수리에 잡혀 꼴찌로`, `구덩이에 빠져`, `진흙에 빠져`, `넘어져`, `졸다가`, `몸싸움 끝에` |
| turnFirst / turnFirstBy.{…} | `{name} 여기서 1등으로` / `선두가 독수리에 잡혀 {name} 1등으로`, `선두가 구덩이에 빠져`, `선두가 진흙에 빠져`, `선두가 넘어져`, `선두가 졸아서`, `몸싸움 틈에 {name} 1등으로` |
| lastLate / lastSwaps / lastSwap | `막판 {sec}초 꼴찌 {n}번 바뀜` / `꼴찌 {n}번 바뀜` / `꼴찌 바뀜` |
| leadLate / leadSwaps / leadSwap | `막판 {sec}초 1등 {n}번 바뀜` / `1등 {n}번 바뀜` / `1등 바뀜` |
| lastClose / firstClose | `꼴찌 다툼 {sec}초 차` / `1등 다툼 {sec}초 차` |
| lastNeck / firstNeck | `꼴찌 다툼 {sec}초 접전` / `1등 다툼 {sec}초 접전` |
| eagleGrab / eagleDrop / eagleMiss / scuffle | `독수리 납치` / `독수리가 떨어뜨림` / `독수리 헛발질` / `구멍 앞 몸싸움` |
| trip / pit | `{name} 넘어짐` / `{name} 구덩이 빠짐` |
| lastDecided / firstDecided | `꼴찌 결정 순간` / `1등 결정 순간` |

Button texts: `하이라이트 보기` ↔ `순위 보기`, `GIF 저장`, vote `aria-label` `좋아요` / `별로예요`, badge `Jev`, making `GIF 만드는 중…`. Only the strongest reason is shown (standalone decision 2026-10-11: two facts were too long).

### Rules to keep (from `AGENTS.md` and the round-1 "common rules")

- Viewer-only state on the client; the only new socket traffic is the server→room pick, the gameEnd field and the feedback ack. No shared UI module (`js/shared/*`), `theme.css` or other game file is touched; new CSS only under `.deguri-highlight*` and `.deguri-result-card.is-compact`.
- Numeric constants at the top of each file; plain Korean for user-facing text; emoji replaced by atlas icons or SVG.
- Hooks: `security-guard` (rate limit in the new `socket.on`), `fairness-guard` (no client `Math.random` for results — `rid` is server-made, the client only draws), `ui-check` (tokens), `mobile-guard`.
- Cost: one Jev call per race, ≈1원 (input ≈1–2 k tokens, output free per the standalone note). The `CODE_SHARE` 20 % and the token bucket keep it bounded.
- Order of work: 1) renderer additions + encoder export (no behaviour change, verify replay GIF still records) → 2) server pure module + tests on simulated seeds → 3) Jev client + startDeguri wiring + socket test with stubbed fetch → 4) client render + result card UI → 5) feedback + weights → 6) auto-play → Playwright test. Commit per stage.

Refer to `docs/GameGuide/README.md` (socket contract — add `deguri:highlight`, `deguri:highlight:feedback` and the `gameEnd.highlight` field there) and `docs/GameGuide/lessons/_common.md` C-20 (server-only masking: `mb.highlight` must not leak through `getCurrentRoom`; it is not in the whitelist, keep it that way) before editing.

## Fairness & Integration

- Determinism: the simulation, seed, timeline and winner are untouched; the highlight is computed from the finished timeline after `simulate`. Server RNG is used only for the `arm` split (allowed: server-side RNG). Same timeline + same multipliers ⇒ same candidates/code pick.
- Server authority: the server decides the pick; clients cannot choose a window or send facts. The Jev request never contains names. Feedback rows use the server's stored facts.
- Pre-reveal masking: `mb.highlight` is server-only until `deguri:highlight`; it reveals nothing beyond what the timeline (already broadcast at reveal) contains. It is not added to the `rooms.js` re-entry whitelist.
- Existing contracts preserved: `deguri:reveal` payload unchanged; `deguri:gameEnd` gains one optional field `highlight`; renderer API additions only (`opts.dpr`, `frameBalls`); `DeguriReplayGif.create` unchanged, two exports added; result overlay still closes with [확인]; replay bar + manual GIF recording unchanged; the round-3 backport (zoom pill, wake lock, gacha) unchanged.
- Tests: new `AutoTest/deguri-highlight-test.js` (pure: candidates on `sim.simulate` seeds, determinism, payload privacy, reason keys), `AutoTest/qa-deguri-highlight-test.js` (socket: room + bots, `deguri:highlight` within reveal + 5 s with valid clip, `source 'code'` without key, exactly one stubbed Jev call with a fake key, feedback ack and rejection, `gameEnd.highlight`), Playwright section in the same file for the card swap, height lock, auto-play timing and GIF blob size > 0.

## Files likely involved

| File | Change type |
|------|-------------|
| `socket/deguri-highlight.js` | new (pure: candidates, code pick, payload, reasons) |
| `socket/jev.js` | new (TypeSafe Jev HTTP client, sentences, timeout, token bucket) |
| `socket/deguri.js` | modify (`startDeguri` pick + broadcast, `endGame` field, `deguri:highlight:feedback`, reset) |
| `db/deguri-highlight-feedback.js` | new (upsert, recent rows, weight multipliers, memory fallback) |
| `db/init.js` | modify (table) |
| `config/index.js` | modify (`TYPESAFE_API_KEY`, `JEV_API_URL`) |
| `js/deguri-highlight.js` | new (listen, off-screen render, result-card swap, auto-play, feedback) |
| `js/deguri.js` | modify (hooks in reveal/gameEnd/reset/abort, `showResultOverlay`/`closeResultOverlay` calls) |
| `js/deguri-render.js` | modify (`opts.dpr`, `R.frameBalls` + `clipIds` camera) |
| `js/deguri-replay-gif.js` | modify (export `encoder`, `saveGif`) |
| `deguri-multiplayer.html` | modify (highlight view + button row, script tag with `?v=`) |
| `css/deguri.css` | modify (`.deguri-highlight*`, `.is-compact`, button row) |
| `AutoTest/deguri-highlight-test.js` | new |
| `AutoTest/qa-deguri-highlight-test.js` | new |
| `docs/GameGuide/README.md` | modify (socket contract) |
| `update-log.md` | modify |

## Open questions

- None blocking. Defaults chosen: GIF 360 px / 10 fps / 6 s (standalone values); auto-play 3 s / 10 s window; `CODE_SHARE` 0.2 kept; feedback keyed per viewer name; weights server-side only. If `TYPESAFE_API_KEY` cannot be added to the production Railway service, the feature still ships with code picks only (no "Jev" label) — say so in the report.
