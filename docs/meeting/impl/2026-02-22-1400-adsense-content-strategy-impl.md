# Implementation: AdSense Content Strategy

> **Meeting**: [`2026-02-22-1400-adsense-content-strategy.md`](../plan/multi/2026-02-22-1400-adsense-content-strategy.md)
> **Recommended Model**: Sonnet (mostly HTML content creation, repetitive patterns)

---

## Item 1: Add Content Links to Overlay Footer

**File**: `server-select-shared.js`

In the `show()` function, the overlay footer currently has: privacy-policy, terms-of-service, contact, statistics.

**Add before** the existing links:
```html
<a href="game-guides.html" style="color:rgba(255,255,255,0.6);text-decoration:none;margin:0 6px;">게임 가이드</a> |
<a href="about-us.html" style="color:rgba(255,255,255,0.6);text-decoration:none;margin:0 6px;">사이트 소개</a> |
```

Insert these two links before the existing `개인정보 처리방침` link in the overlay footer div.

---

## Item 2: Common Navigation Bar for Info Pages

**Files**: `about-us.html`, `dice-rules-guide.html`, `probability-analysis.html`, `contact.html`, `statistics.html`, `privacy-policy.html`, `terms-of-service.html`, `changelog.html` (new)

**Add** a common nav bar at the top of `<body>` (after any FOUC scripts), replacing the existing "← 메인으로 돌아가기" link:

```html
<nav style="background:#667eea;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
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

**Also** replace footer on info pages to include all content links (matching index.html overlay footer style).

---

## Item 3: Game Guides Hub + Roulette/Horse Race Guides

### 3a: Game Guides Hub (`game-guides.html`) — NEW FILE

Create a hub page linking to all game guides:
- 주사위 규칙 가이드 → dice-rules-guide.html
- 주사위 확률 분석 → probability-analysis.html
- 룰렛 규칙 가이드 → roulette-guide.html (new)
- 경마 규칙 가이드 → horse-race-guide.html (new)
- Brief description of each game with internal links

Include: AdSense snippet, OG tags, canonical URL, common nav bar, JSON-LD (ItemList schema).

### 3b: Roulette Guide (`roulette-guide.html`) — NEW FILE

Content sections:
- 룰렛 게임 소개 (LAMDice 룰렛이란?)
- 기본 규칙 (숫자 범위, 당첨 조건)
- 플레이 방법 (단계별 가이드)
- 전략 팁
- 공정성 안내
- CTA: "지금 플레이하기" → /roulette

### 3c: Horse Race Guide (`horse-race-guide.html`) — NEW FILE

Content sections:
- 경마 게임 소개
- 기본 규칙 (탈것 선택, 베팅 방식)
- 경주 진행 방식
- 전략 팁
- 공정성 안내
- CTA: "지금 플레이하기" → /horse-race

All guide pages: same style as `dice-rules-guide.html`, include common nav bar, AdSense snippet, OG tags, canonical URL.

---

## Item 4: Game Page noscript SEO Layer

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `crane-game-multiplayer.html`

Add a `<noscript>` block inside `<body>` with:
- Game description (2-3 paragraphs)
- Basic rules summary
- Link to the full guide page
- Link back to home

Example for dice:
```html
<noscript>
    <div style="max-width:600px;margin:40px auto;padding:20px;font-family:sans-serif;">
        <h1>LAMDice - 주사위 게임</h1>
        <p>LAMDice 주사위 게임은 실시간 멀티플레이어 주사위 대결 게임입니다. 서버에서 생성하는 공정한 난수로 결과가 결정됩니다.</p>
        <p>High, Low, Near, Custom 등 다양한 규칙으로 플레이할 수 있습니다.</p>
        <p><a href="dice-rules-guide.html">주사위 규칙 가이드 보기</a> | <a href="/">메인으로</a></p>
    </div>
</noscript>
```

Also ensure each game page has proper `<meta name="description">` and `<title>`.

---

## Item 5: JSON-LD Structured Data for Info Pages

**Files**: `about-us.html`, `dice-rules-guide.html`, `probability-analysis.html`, `contact.html`, `privacy-policy.html`, `terms-of-service.html`, `index.html`, `game-guides.html` (new), `roulette-guide.html` (new), `horse-race-guide.html` (new), `changelog.html` (new)

Add `<script type="application/ld+json">` in `<head>`:

- `index.html`: WebSite + SoftwareApplication
- `about-us.html`: Organization + WebPage
- `dice-rules-guide.html`: Article (datePublished, author)
- `probability-analysis.html`: Article
- `contact.html`: FAQPage (convert existing FAQ section to FAQ schema)
- `game-guides.html`: ItemList
- `roulette-guide.html`: Article
- `horse-race-guide.html`: Article
- `changelog.html`: Article (dateModified)
- `privacy-policy.html`, `terms-of-service.html`: WebPage

Follow existing pattern from `dice-game-multiplayer.html` line ~1318.

---

## Item 6: sitemap.xml Improvements

**File**: `sitemap.xml`

Add `<lastmod>` and `<changefreq>` to all existing URLs. Add new pages:

```xml
<url>
    <loc>https://lamdice.com/game-guides.html</loc>
    <lastmod>2026-02-22</lastmod>
    <changefreq>monthly</changefreq>
</url>
<url>
    <loc>https://lamdice.com/roulette-guide.html</loc>
    <lastmod>2026-02-22</lastmod>
    <changefreq>monthly</changefreq>
</url>
<url>
    <loc>https://lamdice.com/horse-race-guide.html</loc>
    <lastmod>2026-02-22</lastmod>
    <changefreq>monthly</changefreq>
</url>
<url>
    <loc>https://lamdice.com/changelog.html</loc>
    <lastmod>2026-02-22</lastmod>
    <changefreq>weekly</changefreq>
</url>
```

Existing URLs: add `<lastmod>2026-02-22</lastmod>` and appropriate `<changefreq>`.

---

## Item 7: changelog.html (Update Log Page)

**File**: `changelog.html` — NEW FILE

Convert `update-log.md` content to styled HTML page. Include:
- Common nav bar (Item 2)
- AdSense snippet
- OG tags, canonical URL
- JSON-LD Article schema with dateModified
- All update entries from update-log.md formatted as HTML
- Link in overlay footer and info page nav

---

## Item 8: statistics.html Static Content

**File**: `statistics.html`

Add static description text before the dynamic content area:

```html
<section style="margin-bottom:20px;">
    <h2>LAMDice 서비스 통계</h2>
    <p>LAMDice에서 진행된 게임 통계를 실시간으로 확인할 수 있습니다.
       주사위, 룰렛, 경마 등 다양한 게임의 참여자 수, 진행 횟수, 방문자 통계를 제공합니다.</p>
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

## Implementation Order

1. Item 6: sitemap.xml (5분)
2. Item 1: Overlay footer links (10분)
3. Item 2: Common nav bar (30분, 7-8 파일)
4. Item 7: changelog.html (20분)
5. Item 3a: game-guides.html hub (20분)
6. Item 3b: roulette-guide.html (30분)
7. Item 3c: horse-race-guide.html (30분)
8. Item 4: Game page noscript (20분, 4 파일)
9. Item 5: JSON-LD schemas (30분, 10+ 파일)
10. Item 8: statistics.html static text (10분)

Total estimated: ~3.5 hours

## QA Checklist

- [ ] Google Rich Results Test: all JSON-LD validates
- [ ] sitemap.xml: all URLs accessible, lastmod present
- [ ] Every info page: nav bar visible, all links work
- [ ] Game pages: noscript content visible with JS disabled
- [ ] changelog.html: accessible from overlay + nav
- [ ] game-guides.html: links to all 4 game guides work
- [ ] Mobile: nav bar responsive, no overflow
- [ ] Overlay: footer links include game-guides + about-us

> **On completion**: move this file to `docs/meeting/applied/`
