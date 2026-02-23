# Implementation: AdSense Strategy Validation & Enhancement

> **Meeting**: [`2026-02-23-adsense-strategy-validation.md`](../plan/single/2026-02-23-adsense-strategy-validation.md)
> **Supersedes**: [`2026-02-22-1400-adsense-content-strategy-impl.md`](./2026-02-22-1400-adsense-content-strategy-impl.md) (Items 1-8 carried over, Items 9-13 added)
> **Recommended Model**: Sonnet (mostly HTML content creation, repetitive patterns)

---

## Phase 1: Technical Crawlability Fixes

### Item 1: Add Content Links to Overlay Footer

**File**: `server-select-shared.js`

In the `show()` function, overlay footer currently has: privacy-policy, terms-of-service, contact, statistics.

**Add before** the existing `개인정보 처리방침` link:
```html
<a href="game-guides.html" style="color:rgba(255,255,255,0.6);text-decoration:none;margin:0 6px;">게임 가이드</a> |
<a href="about-us.html" style="color:rgba(255,255,255,0.6);text-decoration:none;margin:0 6px;">사이트 소개</a> |
```

**Add after** the existing `이용 약관` link:
```html
| <a href="disclaimer.html" style="color:rgba(255,255,255,0.6);text-decoration:none;margin:0 6px;">면책 조항</a>
```

> This places disclaimer alongside the other legal pages (privacy-policy, terms-of-service) in the footer.

---

### Item 2: Common Navigation Bar for Info Pages

**Files**: All info pages (about-us, dice-rules-guide, probability-analysis, contact, statistics, privacy-policy, terms-of-service, disclaimer (new), changelog (new), faq (new), game-guides (new), roulette-guide (new), horse-race-guide (new), crane-game-guide (new))

**Add** a common nav bar at the top of `<body>` (after FOUC scripts), replacing "← 메인으로 돌아가기":

```html
<nav style="background:var(--purple-500, #667eea);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <a href="/" style="color:#fff;text-decoration:none;font-weight:700;font-size:1.1em;">LAMDice</a>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="game-guides.html" style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:0.85em;">게임 가이드</a>
        <a href="about-us.html" style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:0.85em;">소개</a>
        <a href="statistics.html" style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:0.85em;">통계</a>
        <a href="contact.html" style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:0.85em;">문의</a>
        <a href="changelog.html" style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:0.85em;">업데이트</a>
    </div>
</nav>
```

> **Note**: Uses `var(--purple-500, #667eea)` with fallback. CSS variable defined in `css/theme.css` line 20.

---

### ~~Item 4: Game Page noscript SEO Layer~~ — ALREADY IMPLEMENTED

**Status**: Dice, Roulette, Horse Race already have `<noscript>` blocks and `<meta name="description">`.

**Existing locations**:
- `dice-game-multiplayer.html`: noscript at lines 1332-1338, meta desc at line 10
- `roulette-game-multiplayer.html`: noscript at lines 580-586, meta desc at line 13
- `horse-race-multiplayer.html`: noscript at lines 66-72, meta desc at line 13

**Remaining**: Verify `crane-game-multiplayer.html` has noscript block. If not, add:
```html
<noscript>
    <div style="max-width:600px;margin:40px auto;padding:20px;font-family:sans-serif;">
        <h1>LAMDice - 인형뽑기 게임</h1>
        <p>LAMDice 인형뽑기는 실시간 멀티플레이어 크레인 게임입니다. 타이밍과 전략으로 인형을 뽑아보세요.</p>
        <p><a href="crane-game-guide.html">인형뽑기 가이드 보기</a> | <a href="/">메인으로</a></p>
    </div>
</noscript>
```

**No other action needed for this item.**

---

### Item 5: JSON-LD Structured Data for Info Pages

**Files**: All info and new pages

Schema mapping:
- `index.html`: WebSite + SoftwareApplication
- `about-us.html`: Organization + WebPage
- `dice-rules-guide.html`: Article (datePublished, author)
- `probability-analysis.html`: Article
- `contact.html`: WebPage (FAQ moved to faq.html)
- `faq.html`: FAQPage
- `game-guides.html`: ItemList
- `roulette-guide.html`: Article
- `horse-race-guide.html`: Article
- `crane-game-guide.html`: Article
- `changelog.html`: Article (dateModified)
- `disclaimer.html`: WebPage
- `privacy-policy.html`, `terms-of-service.html`: WebPage
- `statistics.html`: WebPage

Follow existing JSON-LD pattern from `dice-game-multiplayer.html`.

---

### Item 6: sitemap.xml Improvements

**File**: `sitemap.xml`

Add `<lastmod>` and `<changefreq>` to all existing URLs. Add new pages:

```xml
<url>
    <loc>https://lamdice.com/game-guides.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
</url>
<url>
    <loc>https://lamdice.com/roulette-guide.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
</url>
<url>
    <loc>https://lamdice.com/horse-race-guide.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
</url>
<url>
    <loc>https://lamdice.com/crane-game-guide.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
</url>
<!-- NOTE: Do NOT add /crane-game to sitemap — route is disabled in routes/api.js -->
<url>
    <loc>https://lamdice.com/changelog.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>
<url>
    <loc>https://lamdice.com/faq.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
</url>
<url>
    <loc>https://lamdice.com/disclaimer.html</loc>
    <lastmod>2026-02-23</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
</url>
```

Existing URLs: add `<lastmod>2026-02-23</lastmod>` and appropriate `<changefreq>`.

---

### Item 13: Google Search Console Indexing Verification

**Manual step** (not code):
1. Submit updated sitemap.xml in Google Search Console
2. Request indexing for all new pages via URL Inspection
3. Verify with `site:lamdice.com` search after 3-5 days
4. Check Coverage report for any crawl errors

---

## Phase 2: Content Expansion

### Item 9: disclaimer.html (NEW)

**File**: `disclaimer.html` — NEW FILE

Content sections (target: 800+ words):
- 서비스 면책 조항
- 게임 결과 관련 면책
- 무료 서비스 고지 (실제 화폐 미사용)
- 외부 링크 면책
- 서비스 변경/중단 가능성
- 콘텐츠 정확성 면책
- 광고 관련 면책 (Google AdSense)
- 사용자 책임

Include: AdSense snippet, OG tags, canonical URL, common nav bar, JSON-LD (WebPage).

---

### Item 3a: game-guides.html Hub (from original strategy)

**File**: `game-guides.html` — NEW FILE

Hub page linking to all game guides (target: 600+ words):
- 주사위 규칙 가이드 → dice-rules-guide.html
- 주사위 확률 분석 → probability-analysis.html
- 룰렛 규칙 가이드 → roulette-guide.html
- 경마 규칙 가이드 → horse-race-guide.html
- 인형뽑기 가이드 → crane-game-guide.html
- Brief description (2-3 sentences) of each game

Include: AdSense snippet, OG tags, canonical URL, common nav bar, JSON-LD (ItemList).

---

### Item 3b: roulette-guide.html (from original strategy)

**File**: `roulette-guide.html` — NEW FILE

Content sections (target: 2,000+ words):
- 룰렛 게임 소개 (LAMDice 룰렛이란?)
- 기본 규칙 (숫자 범위, 당첨 조건)
- 플레이 방법 (단계별 가이드)
- 베팅 전략
- 확률 분석
- 공정성 안내
- CTA: "지금 플레이하기" → /roulette

Style: match `dice-rules-guide.html` layout and CSS.

---

### Item 3c: horse-race-guide.html (from original strategy)

**File**: `horse-race-guide.html` — NEW FILE

Content sections (target: 2,000+ words):
- 경마 게임 소개
- 기본 규칙 (탈것 선택, 베팅 방식)
- 경주 진행 방식
- 탈것별 특성
- 전략 팁
- 공정성 안내
- CTA: "지금 플레이하기" → /horse-race

Style: match `dice-rules-guide.html` layout and CSS.

---

### Item 10: crane-game-guide.html (NEW)

**File**: `crane-game-guide.html` — NEW FILE

> **CAUTION**: `/crane-game` route is currently **commented out** in `routes/api.js` (lines 49-55).
> The guide page is still valuable as SEO content, but the CTA link should point to the main page
> or the route must be uncommented before linking directly.

Content sections (target: 1,500+ words):
- 인형뽑기 게임 소개
- 기본 규칙 (크레인 조작, 타이밍)
- 플레이 방법 (단계별 가이드)
- 전략 팁 (타이밍, 위치 선정)
- 공정성 안내
- CTA: "메인으로 돌아가기" → / (route disabled, do NOT link to /crane-game)

Style: match `dice-rules-guide.html` layout and CSS.

---

### Item 11: faq.html (NEW)

**File**: `faq.html` — NEW FILE

Migrate FAQ section from `contact.html` and expand (target: 1,500+ words):

FAQ categories:
- **서비스 일반**: LAMDice란?, 무료인가요?, 가입 필요한가요?
- **게임 규칙**: 어떤 게임이 있나요?, 규칙은 어디서 확인?, 커스텀 규칙이란?
- **공정성**: 주사위 조작 가능한가요?, 난수는 어떻게 생성?, 결과 검증 가능?
- **기술 지원**: 접속이 안 돼요, 게임이 끊겨요, 모바일에서 가능?
- **개인정보**: 어떤 정보 수집?, 데이터 삭제 방법?
- **건의/신고**: 버그 신고 방법?, 건의사항 제출?

Include: AdSense snippet, OG tags, canonical URL, common nav bar, JSON-LD (FAQPage).

**Also**: Remove FAQ section from `contact.html`, replace with link to `faq.html`.

---

### Item 7: changelog.html (from original strategy)

**File**: `changelog.html` — NEW FILE

Convert `update-log.md` content to styled HTML page (target: 1,000+ words).

Include: common nav bar, AdSense snippet, OG tags, canonical URL, JSON-LD (Article, dateModified).

---

### Item 8: statistics.html Static Content (from original strategy)

**File**: `statistics.html`

Add static description before dynamic content:

```html
<section style="margin-bottom:20px;">
    <h2>LAMDice 서비스 통계</h2>
    <p>LAMDice에서 진행된 게임 통계를 실시간으로 확인할 수 있습니다.
       주사위, 룰렛, 경마 등 다양한 게임의 참여자 수, 진행 횟수, 방문자 통계를 제공합니다.</p>
    <p>모든 통계는 실제 게임 데이터를 기반으로 자동 집계되며, 서비스의 투명성을 위해 공개합니다.</p>
</section>
```

Add `<noscript>` fallback:
```html
<noscript>
    <p>통계 데이터를 보려면 JavaScript를 활성화해주세요.
       <a href="game-guides.html">게임 가이드</a>에서 게임 규칙을 확인할 수 있습니다.</p>
</noscript>
```

---

## Phase 3: E-E-A-T Educational Content (if re-rejected)

### Item 12a: dice-history.html

**File**: `dice-history.html` — NEW FILE

Content (target: 2,000+ words):
- 주사위의 기원 (고대 문명)
- 주사위 게임의 발전 (중세 → 현대)
- 전 세계 주사위 게임 종류
- 디지털 시대의 주사위 게임
- LAMDice와 현대 주사위 문화

Include: common nav bar, AdSense snippet, OG tags, canonical, JSON-LD (Article).

---

### Item 12b: fairness-rng.html

**File**: `fairness-rng.html` — NEW FILE

Content (target: 2,000+ words):
- 온라인 게임 공정성이란
- 난수 생성기(RNG)의 원리
- 의사 난수 vs 진정한 난수
- LAMDice의 난수 생성 방식
- 공정성 검증 방법
- 온라인 게임 산업의 공정성 기준

Include: common nav bar, AdSense snippet, OG tags, canonical URL, JSON-LD (Article).

---

### Item 12c: probability-education.html

**File**: `probability-education.html` — NEW FILE

Content (target: 2,000+ words):
- 확률의 기본 개념
- 주사위로 이해하는 확률
- 큰 수의 법칙 (실제 LAMDice 데이터 활용)
- 기대값과 전략
- 일상생활 속 확률

Include: common nav bar, AdSense snippet, OG tags, canonical URL, JSON-LD (Article).

---

## Implementation Order

### Phase 1 (technical, ~1.5 hours)
1. Item 6: sitemap.xml improvements (10min)
2. Item 1: Overlay footer links (10min)
3. ~~Item 4: Game page noscript~~ — already done (verify crane-game only, 5min)
4. Item 2: Common nav bar (40min, existing 7 + new pages as created)
5. Item 5: JSON-LD schemas (30min, all pages)
6. Item 13: Search Console submission (manual, 10min)

### Phase 2 (content, ~3 hours)
7. Item 9: disclaimer.html (20min)
8. Item 3a: game-guides.html hub (20min)
9. Item 3b: roulette-guide.html (30min)
10. Item 3c: horse-race-guide.html (30min)
11. Item 10: crane-game-guide.html (25min)
12. Item 11: faq.html + contact.html update (30min)
13. Item 7: changelog.html (20min)
14. Item 8: statistics.html static text (10min)

### Phase 3 (educational, ~2 hours, if needed)
15. Item 12a: dice-history.html (40min)
16. Item 12b: fairness-rng.html (40min)
17. Item 12c: probability-education.html (40min)

Total: Phase 1+2 ~4.5 hours, Phase 3 ~2 hours additional

---

## QA Checklist

### Phase 1 QA
- [x] ~~All game pages: noscript content visible with JS disabled~~ — already present (dice/roulette/horse), verify crane-game only
- [ ] Overlay footer: game-guides + about-us links visible
- [ ] All info pages: common nav bar present, all links work
- [ ] JSON-LD: Google Rich Results Test validates all schemas
- [ ] sitemap.xml: all URLs accessible, lastmod present
- [ ] Mobile: nav bar responsive, no overflow

### Phase 2 QA
- [ ] disclaimer.html: accessible, legal content complete
- [ ] game-guides.html: all 5 game guides linked correctly
- [ ] roulette-guide.html: 2000+ words, CTA link works
- [ ] horse-race-guide.html: 2000+ words, CTA link works
- [ ] crane-game-guide.html: 1500+ words, CTA link works
- [ ] faq.html: FAQPage schema validates, all Q&A present
- [ ] changelog.html: all updates from update-log.md present
- [ ] statistics.html: static text visible before JS loads
- [ ] contact.html: FAQ section replaced with link to faq.html

### Pre-submission QA
- [ ] `site:lamdice.com` shows all pages indexed
- [ ] No broken links (check all internal links)
- [ ] Mobile-friendly test passes
- [ ] PageSpeed score > 80 on mobile
- [ ] All pages have AdSense snippet (except admin.html)

> **On completion**: move this file to `docs/meeting/applied/`
