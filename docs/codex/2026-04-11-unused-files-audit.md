# Unused Files Audit

Date: 2026-04-11
Branch: `feature/design-unification`

## Scope

This note summarizes a codebase-wide pass to identify files and folders that appear unnecessary, stale, or only partially maintained.

The audit focused on:

- runtime entrypoints and Express routes
- static asset references from HTML and shared JS
- test and automation folders
- prototype, mockup, and local-tool output folders

## Current Runtime Reality

The production server is driven by `server.js` and `routes/api.js`.

Confirmed active runtime entrypoints:

- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `admin.html`
- `pages/*.html` SEO/support pages

Important finding:

- `/horse-race` still serves the legacy HTML file `horse-race-multiplayer.html`
- `horse-app` exists, but it is not currently the live route target

## Safe Delete Candidates

These look safe to remove with low runtime risk:

- `.bkit/`
  - local tool output
  - currently untracked by git
- `AutoTest/node_modules/`
  - generated dependency folder
  - already ignored in `.gitignore`
- `horse-app/README.md`
  - default Vite template README
- `AutoTest/roulette/test-results.log`
  - generated log output

## Likely Removable But Should Be a Product Decision

These are not part of the active runtime path, but may still be intentionally kept as references:

- `prototype/`
  - contains mockups, experiments, and prototype HTML files
  - referenced from docs as design or implementation references
- `horse-app/`
  - inactive as a served route today
  - still referenced by tests and project docs
- `horse-app/dist/`
  - built output exists, but current Express routing does not use it
- `pages/server-members.html`
  - still present in redirect/SEO route lists
  - appears lightly linked and may be effectively orphaned
- `js/gif-recorder.js`
- `js/gif.worker.js`
  - replay/GIF functionality appears disabled in current horse-race HTML
  - not obviously active, but code references still remain

## Broken Or Inconsistent Areas

These are not just "unused"; they are structurally inconsistent and should be cleaned up:

- `package.json`
  - script `test-bot` points to `dice-test-bot.js`
  - that file does not exist in the repo root
- `AutoTest/`
  - docs and changelog refer to files that are currently missing:
  - `AutoTest/dice/dice-test-bot.js`
  - `AutoTest/roulette/test-bot.js`
  - `AutoTest/console-error-check.js`
  - `AutoTest/horse.bat`
- current `AutoTest` folder mostly contains:
  - `horse-race/test-loser-slowmo.js`
  - `roulette/test-results.log`
  - `node_modules/`

## Keep

These should not be treated as unused:

- `frequentMenus.json`
  - file fallback used by `db/menus.js`
- `suggestions.json`
  - file fallback used by `db/suggestions.js`
- `robots.txt`
- `sitemap.xml`
- `ads.txt`
- `js/ads.js`
- `js/tagline-roller.js`
  - both are actively referenced

## Recommended Cleanup Order

1. Remove generated/local-only artifacts.
2. Repair stale test references in `package.json` and docs.
3. Decide whether `horse-app` is a future migration target or dead code.
4. Decide whether `prototype/` should stay as design archive or move elsewhere.
5. Review lightly linked pages such as `pages/server-members.html`.

## Summary

The repo's active runtime path is still mostly legacy HTML + shared JS, not the React horse app.

The clearest cleanup opportunities are:

- local tool output
- generated test artifacts
- broken test references
- archived prototype material

The riskiest deletions would be:

- `horse-app`
- prototype references used by docs
- dormant but not fully disconnected GIF/replay files
