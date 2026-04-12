# Implementation: AdSense Crawler Accessibility & Internal Link Fix

**Source**: [Meeting Notes](../plan/multi/2026-03-15-adsense-crawler-accessibility-fix.md)
**Recommended Model**: Sonnet (all changes are concrete file/location-specific edits)
**Status**: Implemented (2026-03-15)

---

## Overview

Google AdSense rejected lamdice.com for "low-value content". Root cause: triple `visibility:hidden` / `opacity:0` mechanism made `index.html` invisible to crawlers, and ServerSelectModule overlay immediately blocked all content. Game pages had zero links to content pages.

Fix: Remove hiding mechanisms, restructure landing page as content hub, add SEO sections to game pages, strengthen internal links across all content pages, update sitemap and Schema.org metadata.

## File Change Summary

| Phase | Files Changed | Change Type |
|-------|--------------|-------------|
| 1 | `index.html` | Complete rewrite — landing page as content hub |
| 2 | `dice-game-multiplayer.html` | SEO section + footer + noscript enhancement |
| 2 | `roulette-game-multiplayer.html` | SEO section + footer + noscript enhancement |
| 2 | `horse-race-multiplayer.html` | SEO section + footer + noscript enhancement |
| 3 | `about-us.html` | CTA banner + navigation footer |
| 3 | `faq.html` | CTA banner + navigation footer |
| 3 | `game-guides.html` | CTA banner + navigation footer |
| 3 | `dice-rules-guide.html` | CTA banner + navigation footer |
| 3 | `probability-analysis.html` | CTA banner + navigation footer |
| 3 | `fairness-rng.html` | CTA banner + navigation footer |
| 3 | `probability-education.html` | CTA banner + navigation footer |
| 3 | `dice-history.html` | CTA banner + navigation footer |
| 3 | `changelog.html` | CTA banner + navigation footer |
| 3 | `roulette-guide.html` | Navigation footer only (CTA already existed) |
| 3 | `horse-race-guide.html` | Navigation footer only (CTA already existed) |
| 3 | `crane-game-guide.html` | Navigation footer only (CTA already existed) |
| 3 | `contact.html` | Navigation footer |
| 3 | `disclaimer.html` | Navigation footer |
| 3 | `privacy-policy.html` | Navigation footer |
| 3 | `terms-of-service.html` | Navigation footer |
| 3 | `statistics.html` | Navigation footer (replaced old format) |
| 4 | `sitemap.xml` | All 20 URLs: lastmod 2026-02-24 → 2026-03-15 |
| 4 | `crane-game-multiplayer.html` | Added WebApplication Schema.org JSON-LD |
| 4 | 9 content pages | dateModified 2026-02-24 → 2026-03-15 in Schema.org |

**Total**: ~25 files modified

---

## Phase 1: index.html Landing Page Restructure (Critical)

### Problem
```html
<!-- 3-layer hiding mechanism — crawler sees blank page -->
<script>document.documentElement.style.opacity='0';</script>    <!-- FOUC script -->
<body style="visibility:hidden">                                <!-- body hidden -->
  <main style="visibility:hidden">                              <!-- main hidden -->
```
Plus `ServerSelectModule.show()` auto-called on page load → full-screen overlay.

### Solution
1. **Removed** all `visibility:hidden` and `opacity:0` mechanisms
2. **Kept** `data-theme='light'` for FOUC prevention (sufficient)
3. **Restructured** page as visible content hub:
   - Header nav: game-guides, FAQ, about-us, statistics links
   - Hero section: service intro + "게임 시작하기" CTA button
   - 3 game cards: dice, roulette, horse-race with descriptions + guide links
   - Content section: 6 links to guide/analysis pages
   - About section: brief service description
   - Footer: 8 navigation links
4. **ServerSelectModule.show()**: triggered by CTA button click only
5. **Backward compatibility**: `?direct` or `?server` query params → auto-show overlay
6. **Added** WebApplication Schema.org JSON-LD

### Verification
- JS disabled: 300+ characters of visible text
- Existing users: `?direct`/`?server` links still work
- No server-side changes required

---

## Phase 2: Game Page SEO Content

### Added to each game page (dice, roulette, horse-race)

**SEO Content Section** (before footer, below game UI):
```html
<section style="max-width:800px; margin:40px auto; padding:20px 24px;
  background:var(--bg-primary); border-radius:12px;">
  <h2>[Game] 게임 안내</h2>
  <p>[3-5 sentences describing the game]</p>
  <div>[Links to related guides + other games]</div>
</section>
```

**Enhanced Footer**: 8 navigation links (홈, 게임 가이드, FAQ, 소개, 통계, 개인정보, 이용 약관, 문의)

**Enhanced noscript**: Descriptive text + links to guides for JS-disabled crawlers

### Links added per page

| Page | Internal links added |
|------|---------------------|
| `dice-game-multiplayer.html` | dice-rules-guide, probability-analysis, fairness-rng, home, roulette, horse-race |
| `roulette-game-multiplayer.html` | roulette-guide, probability-analysis, fairness-rng, home, dice, horse-race |
| `horse-race-multiplayer.html` | horse-race-guide, probability-analysis, fairness-rng, home, dice, roulette |

---

## Phase 3: Content Page Internal Links

### CTA Banner (added to 9 pages)
```html
<div style="max-width:700px; margin:40px auto 0; padding:24px; text-align:center;
  background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius:14px;">
  <p style="color:#fff;">친구들과 함께 무료 보드게임을 즐겨보세요!</p>
  <a href="/" style="background:#fff; color:#7c3aed;">🎲 지금 플레이하기</a>
</div>
```

Pages with CTA: about-us, faq, game-guides, dice-rules-guide, probability-analysis, fairness-rng, probability-education, dice-history, changelog

Pages without CTA (already had similar): roulette-guide, horse-race-guide, crane-game-guide

### Navigation Footer (added/replaced on all 15+ content pages)
```html
<footer>
  <div>홈 | 게임 가이드 | FAQ | 소개 | 개인정보 처리방침 | 이용 약관 | 문의하기</div>
  <p>LAMDice는 실제 화폐가 사용되지 않는 무료 소셜 보드게임 서비스입니다.</p>
</footer>
```

---

## Phase 4: Technical SEO

### sitemap.xml
- All 20 URLs: `lastmod` updated from `2026-02-24` to `2026-03-15`

### Schema.org
- `crane-game-multiplayer.html`: Added `WebApplication` JSON-LD (was missing)
- 9 content pages: `dateModified` updated to `2026-03-15`

### robots.txt
- Already correct (`Disallow: /admin`, `/prototype/`, `/api/`) — no changes needed

---

## Phase 5: Pre-Resubmission Verification Checklist

| # | Check | Method |
|---|-------|--------|
| 1 | index.html shows 300+ chars with JS disabled | Chrome DevTools → Settings → Disable JS |
| 2 | All internal links return 200 | `curl` or broken link checker |
| 3 | Lighthouse SEO ≥ 90 on all pages | Chrome DevTools → Lighthouse |
| 4 | Google Search Console URL render | URL Inspection → Request Indexing |
| 5 | Mobile viewport content accessible | Chrome DevTools → Device toolbar |

---

## What Was NOT Changed

- No server-side code modified (Express, Socket.IO, DB)
- No game logic changed
- No new pages created
- No SSR/framework introduced
- No template engine added
