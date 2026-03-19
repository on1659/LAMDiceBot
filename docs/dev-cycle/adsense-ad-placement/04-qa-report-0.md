# QA Report: adsense-ad-placement (Cycle #0)

## Test Summary
| Tier | Tests | Pass | Fail | Rate |
|------|-------|------|------|------|
| Tier 0: Server Load | 1 | 1 | 0 | 100% |
| Tier 1: Happy Path | 6 | 6 | 0 | 100% |
| Tier 2: Edge Cases | 7 | 5 | 2 | 71% |
| **Total** | **14** | **12** | **2** | **86%** |

## Tier 0: Server Load
- Server starts without errors, PostgreSQL connects, all tables initialize. PASS.

## Tier 1: Happy Path (All PASS)
| Test | Result |
|------|--------|
| T1-1 CSS Correctness | PASS |
| T1-2 ads.js Correctness | PASS |
| T1-3 Ad Slot Consistency (A:4 B:3 C:17 D:18 E:1 = 43) | PASS |
| T1-4 Script Loading (22 pages) | PASS |
| T1-5 Auto-Ads Disable (4 game pages) | PASS |
| T1-6 Ad Container Structure | PASS |

## Tier 2: Edge Cases
| Test | Result | Severity |
|------|--------|----------|
| T2-1 z-index Conflicts | PASS | — |
| T2-2 game-active Class Lifecycle | **FAIL** | **MAJOR** |
| T2-3 AdSense Policy Compliance | PASS | — |
| T2-4 Mobile Viewport min-height | WARNING | MINOR |
| T2-5 Double Push Risk | PASS | COSMETIC |
| T2-6 Ad in Hidden Section | **FAIL** | **MAJOR** |
| T2-7 Static File Serving | PASS | — |

---

## Bug Report

### CRITICAL — 0건

### MAJOR — 2건

**BUG-1: horse-race — game-active class never removed**
- **File**: `horse-race-multiplayer.html` / `js/horse-race.js`
- **Symptom**: `document.body.classList.add('game-active')` is called on room join, but `remove('game-active')` is never called on room leave.
- **Impact**: `.game-active .ad-container.ad-lobby { visibility: hidden }` remains active permanently after first room join. Lobby ad is invisible for the rest of the session even when user returns to lobby.
- **Fix**: Add `document.body.classList.remove('game-active')` in the room leave handler.

**BUG-2: dice-game — lobby ad fails on direct room URL**
- **File**: `dice-game-multiplayer.html`
- **Symptom**: If user navigates directly via `?room=xxx` URL, `#lobbySection` is `display:none` at DOMContentLoaded. `ads.js` calls `push()` on the invisible container — AdSense does not render into `display:none` subtrees.
- **Impact**: Lobby ad fails to load entirely for that session.
- **Fix**: Move lobby ad outside `#lobbySection`, OR re-call `initAds()` when lobbySection becomes visible.

### MINOR — 1건

**BUG-3: Mobile ad container too tall**
- **File**: `css/theme.css`
- **Symptom**: `.ad-container { min-height: 90px }` takes ~23% of 390px mobile viewport.
- **Fix**: Add `@media (max-width: 480px) { .ad-container { min-height: 50px; } }`

### COSMETIC — 1건

**BUG-4: Inline push config comment missing**
- **File**: 4 game pages `<head>`
- **Symptom**: `(adsbygoogle).push({ enable_page_level_ads: false })` looks like a slot push but is a config call. No comment explaining this.
- **Fix**: Add comment `/* auto-ads config — not a slot push */`

---

## QA Verdict: CONDITIONAL_PASS
- CRITICAL: 0건
- MAJOR: 2건 → 수정 후 재QA 필요
