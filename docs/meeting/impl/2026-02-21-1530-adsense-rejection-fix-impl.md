# Implementation: AdSense "Low-Value Content" Rejection Fix

**Source**: [Meeting Notes](../plan/multi/2026-02-21-1530-adsense-rejection-fix.md)
**Recommended Model**: Sonnet (all changes are concrete file/location-specific, code-writing only)
**Estimated Time**: ~1.5 hours

---

## Overview

Google AdSense rejected lamdice.com for "low-value content". Root cause: Google crawler sees near-empty pages because main content is JS-rendered. Fix: add static crawlable content, SEO metadata, and sitemap.

## Adopted Items (7 total)

### 1. Fix about-us.html duplicate content

**Files**: `about-us.html`
**Change**: Delete lines 210-323 (everything after `</html>` at line 209)
**Verification**: File ends with `</html>\n` and nothing after

### 2. Add static content to index.html

**Files**: `index.html`
**Change**:
- Add `<meta name="description">` in `<head>` after `<title>`
- Add `<main>` section between `</header>` (line 70) and `<script src="/socket.io/socket.io.js">` (line 72)
- Content: platform intro, game list (dice/roulette/horse-race), links to guide pages
- Add `<noscript>` fallback message
- The server select modal (JS-rendered) will overlay on top of this content — no UX change for JS users

**Static content structure**:
```html
<main style="max-width:900px; margin:40px auto; padding:0 20px; color:#fff;">
  <section>
    <h2>무료 온라인 멀티플레이어 보드게임</h2>
    <p>LAMDice는 친구들과 함께 즐기는 무료 온라인 보드게임 플랫폼입니다. ...</p>
  </section>
  <section>
    <h3>제공 게임</h3>
    <ul>
      <li><strong>주사위 게임</strong> - High, Low, Near, Custom 등 다양한 규칙</li>
      <li><strong>룰렛</strong> - 실시간 멀티플레이어 룰렛</li>
      <li><strong>경마</strong> - 말에 베팅하고 레이스를 관전</li>
    </ul>
  </section>
  <section>
    <h3>게임 가이드</h3>
    <ul>
      <li><a href="dice-rules-guide.html">주사위 규칙 가이드</a></li>
      <li><a href="probability-analysis.html">확률 분석 및 팁</a></li>
    </ul>
  </section>
</main>
<noscript>
  <p style="text-align:center; padding:20px;">
    이 사이트는 JavaScript가 필요합니다. 브라우저 설정에서 JavaScript를 활성화해주세요.
  </p>
</noscript>
```

**Verification**: Disable JS in Chrome DevTools → load page → service description + game list visible

### 3. Add meta description + OG tags to all pages

**Files**: All 10 public HTML files
**Change**: Add in each `<head>`, after `<title>`:

```html
<meta name="description" content="[page-specific description]">
<meta property="og:title" content="[title]">
<meta property="og:description" content="[description]">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lamdice.com/[path]">
<meta property="og:locale" content="ko_KR">
<link rel="canonical" href="https://lamdice.com/[canonical-path]">
```

**Page-specific descriptions**:

| File | meta description |
|------|-----------------|
| `index.html` | "LAMDice - 친구와 함께하는 무료 온라인 멀티플레이어 보드게임. 주사위, 룰렛, 경마를 실시간으로 즐기세요." |
| `dice-game-multiplayer.html` | "친구와 함께하는 온라인 주사위 게임. High, Low, Near 등 다양한 규칙으로 실시간 대결." |
| `roulette-game-multiplayer.html` | "무료 온라인 멀티플레이어 룰렛 게임. 친구와 실시간으로 룰렛을 즐기세요." |
| `horse-race-multiplayer.html` | "온라인 경마 게임. 말에 베팅하고 친구들과 실시간 레이스를 관전하세요." |
| `dice-rules-guide.html` | "주사위 게임 규칙 가이드 - High, Low, Near, Custom 등 다양한 규칙과 전략 설명." |
| `probability-analysis.html` | "주사위 게임 확률 분석과 전략 팁. 각 규칙별 승률 계산과 최적 전략 가이드." |
| `about-us.html` | "LAMDice 소개 - 공정하고 투명한 멀티플레이어 보드게임 플랫폼." |
| `contact.html` | "LAMDice 문의하기 - FAQ, 건의사항 게시판, 기술 지원 안내." |
| `statistics.html` | "LAMDice 서비스 통계 - 게임 플레이 수, 방문자 현황, 최근 활동." |
| `privacy-policy.html` | "LAMDice 개인정보 처리방침 - 수집 정보, 이용 목적, 사용자 권리 안내." |
| `terms-of-service.html` | "LAMDice 이용 약관 - 서비스 이용 규칙과 사용자 의무." |

**canonical URLs**:
- `/game` → `https://lamdice.com/game` (not dice-game-multiplayer.html)
- `/roulette` → `https://lamdice.com/roulette`
- `/horse-race` → `https://lamdice.com/horse-race`
- Static pages → their `.html` URL

**Verification**: `grep -l "meta name=\"description\"" *.html` returns all 10+ files

### 4. Create sitemap.xml + update robots.txt

**Files**: `sitemap.xml` (new), `robots.txt` (edit)

**sitemap.xml**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://lamdice.com/</loc><priority>1.0</priority></url>
  <url><loc>https://lamdice.com/game</loc><priority>0.9</priority></url>
  <url><loc>https://lamdice.com/roulette</loc><priority>0.9</priority></url>
  <url><loc>https://lamdice.com/horse-race</loc><priority>0.9</priority></url>
  <url><loc>https://lamdice.com/dice-rules-guide.html</loc><priority>0.8</priority></url>
  <url><loc>https://lamdice.com/probability-analysis.html</loc><priority>0.8</priority></url>
  <url><loc>https://lamdice.com/about-us.html</loc><priority>0.7</priority></url>
  <url><loc>https://lamdice.com/statistics.html</loc><priority>0.5</priority></url>
  <url><loc>https://lamdice.com/contact.html</loc><priority>0.5</priority></url>
  <url><loc>https://lamdice.com/privacy-policy.html</loc><priority>0.3</priority></url>
  <url><loc>https://lamdice.com/terms-of-service.html</loc><priority>0.3</priority></url>
</urlset>
```

**robots.txt** (replace entire file):
```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /prototype/

Sitemap: https://lamdice.com/sitemap.xml
```

Note: sitemap.xml placed in project root is auto-served by Express static middleware (routes/api.js line 18). No server code change needed.

**Verification**: `curl https://lamdice.com/sitemap.xml` returns valid XML; `curl https://lamdice.com/robots.txt` shows Sitemap line

### 5. Game pages: noscript fallback + JSON-LD

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`

**Change A — JSON-LD in `<head>`** (per game):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "LAMDice [게임명]",
  "description": "[게임 설명]",
  "url": "https://lamdice.com/[path]",
  "applicationCategory": "GameApplication",
  "operatingSystem": "Web Browser",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "KRW" }
}
</script>
```

**Change B — noscript in `<body>` start**:
```html
<noscript>
  <div style="padding:40px; text-align:center; font-family:sans-serif;">
    <h1>LAMDice [게임명]</h1>
    <p>이 게임은 JavaScript가 필요합니다.</p>
    <p>[게임 간략 설명]. <a href="/">메인으로 돌아가기</a></p>
  </div>
</noscript>
```

**Verification**: Google Rich Results Test → structured data detected; Disable JS → noscript content visible

### 6. Footer disclaimer (all pages)

**Files**: All HTML files with `<footer>`
**Change**: Add one line in footer area:

```html
<p style="font-size:0.8em; margin-top:8px; opacity:0.7;">
  LAMDice는 실제 화폐가 사용되지 않는 무료 소셜 보드게임 서비스입니다.
</p>
```

**Verification**: Visible in page footer across all pages

### 7. Update Copyright year

**Files**: `index.html` (and any other file with "2025")
**Change**: `Copyright © 2025` → `Copyright © 2026`
**Verification**: `grep "2025" *.html` returns no copyright-related matches

---

## Implementation Order

```
1. about-us.html 중복 제거          → 검증: 파일 끝 확인
2. sitemap.xml 생성 + robots.txt    → 검증: curl 테스트
3. 전 페이지 meta/OG/canonical      → 검증: grep 확인
4. index.html 정적 콘텐츠           → 검증: JS 비활성 테스트
5. 게임 페이지 noscript + JSON-LD   → 검증: Rich Results Test
6. footer 면책 + Copyright          → 검증: 시각적 확인
7. Lighthouse SEO 전체 점수 확인     → 목표: 90점 이상
```

## Pre-Resubmission QA Checklist

| # | Check | Tool | Pass Criteria |
|---|-------|------|---------------|
| 1 | index.html shows content with JS disabled | Chrome > Disable JS | Service description + game list visible |
| 2 | about-us.html no duplicate | W3C Validator | 0 errors, no content after `</html>` |
| 3 | All pages have meta description | grep | All 10+ HTML files matched |
| 4 | sitemap.xml valid | XML Sitemap Validator | All URLs accessible |
| 5 | robots.txt has Sitemap | curl | `Sitemap:` line present |
| 6 | Lighthouse SEO score | Chrome Lighthouse | >= 90 |
| 7 | Game pages noscript works | Chrome > Disable JS | Fallback content visible |
| 8 | OG tags work | Facebook Debugger | Preview generates correctly |
| 9 | Footer disclaimer visible | Visual check | Present on all pages |
| 10 | Copyright 2026 | grep | No "2025" in copyright lines |

## Held Items (for future consideration)

- **Content hub page (/guide)**: If re-review still fails after this fix
- **Full "social strategy game" positioning**: Requires maintenance strategy for multi-file banners
- **Detailed non-gambling ToS clause**: Requires legal review first

> **On completion**: move this file to `docs/meeting/applied/`
