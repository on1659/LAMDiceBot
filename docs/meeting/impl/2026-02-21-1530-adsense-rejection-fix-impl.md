# Implementation: AdSense "Low-Value Content" Rejection Fix

**Source**: [Meeting Notes](../plan/multi/2026-02-21-1530-adsense-rejection-fix.md)
**Recommended Model**: Sonnet (all changes are concrete file/location-specific, code-writing only)
**Estimated Time**: ~2 hours

---

## Overview

Google AdSense rejected lamdice.com for "low-value content". Root cause: Google crawler sees near-empty pages because main content is JS-rendered. Fix: add static crawlable content, SEO metadata, sitemap, and improve first-visit UX.

## File Reference Table

| File | `<title>` line | `<body>` line | `<footer>` lines | `</body>` line | Copyright line |
|------|---------------|---------------|-------------------|----------------|----------------|
| `index.html` | 9 | 60 | 92-100 | 101 | 93 |
| `about-us.html` | 9 | - | none | 208 | none |
| `dice-game-multiplayer.html` | 9 | 1312 | 7206-7213 | 7214 | 7207 |
| `roulette-game-multiplayer.html` | 12 | 560 | none | 3511 | none |
| `horse-race-multiplayer.html` | 12 | 46 | none | - | none |
| `dice-rules-guide.html` | 9 | - | none | 172 | none |
| `probability-analysis.html` | 9 | - | none | 228 | none |
| `contact.html` | 9 | - | none | 507 | none |
| `statistics.html` | 9 | - | 164-168 | - | none |
| `privacy-policy.html` | 9 | - | none | 112 | none |
| `terms-of-service.html` | 9 | - | none | 116 | none |
| `server-select-shared.js` | - | - | 402-408 | - | 403 |

## Adopted Items (9 total)

### 1. Fix about-us.html duplicate content

**Files**: `about-us.html`
**Change**: Delete lines 210-323 (everything after `</html>` at line 209)
**Verification**: File ends with `</html>\n` and nothing after

---

### 2. Add static content to index.html

**Files**: `index.html`
**Insert location**: Between `</header>` (line 70) and `<script src="/socket.io/socket.io.js">` (line 72)

**Insert the following at line 71**:
```html

<main style="max-width:900px; margin:40px auto; padding:0 20px; color:#fff;">
  <section>
    <h2>무료 온라인 멀티플레이어 보드게임</h2>
    <p>LAMDice는 친구들과 함께 즐기는 무료 온라인 보드게임 플랫폼입니다.
       주사위, 룰렛, 경마 등 다양한 게임을 실시간 멀티플레이어로 즐겨보세요.
       회원가입 없이 바로 플레이할 수 있으며, 모든 게임은 서버 기반 난수로 공정성이 보장됩니다.</p>
  </section>
  <section>
    <h3>제공 게임</h3>
    <ul>
      <li><strong>주사위 게임</strong> - High, Low, Near, Custom 등 다양한 규칙으로 실시간 대결</li>
      <li><strong>룰렛</strong> - 실시간 멀티플레이어 룰렛</li>
      <li><strong>경마</strong> - 말에 베팅하고 친구들과 레이스를 관전</li>
    </ul>
  </section>
  <section>
    <h3>게임 가이드</h3>
    <ul>
      <li><a href="dice-rules-guide.html" style="color:#fff;">주사위 규칙 가이드</a></li>
      <li><a href="probability-analysis.html" style="color:#fff;">확률 분석 및 팁</a></li>
    </ul>
  </section>
</main>
<noscript>
  <p style="text-align:center; padding:20px; color:#fff;">
    이 사이트는 JavaScript가 필요합니다. 브라우저 설정에서 JavaScript를 활성화해주세요.
  </p>
</noscript>

```

Note: The server select modal (JS-rendered, z-index:10000) will overlay on top of this content — no UX change for JS users. Crawlers will see this content.

**Verification**: Disable JS in Chrome DevTools → load page → service description + game list visible

---

### 3. Add meta description + OG tags to all pages

**Files**: All 11 public HTML files (10 pages + crane-game excluded if not public)

**Change**: Add in each `<head>`, immediately after the `<title>` line:

```html
<meta name="description" content="[page-specific description]">
<meta property="og:title" content="[title]">
<meta property="og:description" content="[description]">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lamdice.com/[path]">
<meta property="og:locale" content="ko_KR">
<link rel="canonical" href="https://lamdice.com/[canonical-path]">
```

**Per-file insertion details**:

| File | Insert after line | `<title>` content | meta description | canonical URL |
|------|------------------|-------------------|------------------|---------------|
| `index.html` | 9 | `LAM Dice :)` | LAMDice - 친구와 함께하는 무료 온라인 멀티플레이어 보드게임. 주사위, 룰렛, 경마를 실시간으로 즐기세요. | `https://lamdice.com/` |
| `dice-game-multiplayer.html` | 9 | `LAM Dice :)` | 친구와 함께하는 온라인 주사위 게임. High, Low, Near 등 다양한 규칙으로 실시간 대결. | `https://lamdice.com/game` |
| `roulette-game-multiplayer.html` | 12 | `LAM Roulette 🎰` | 무료 온라인 멀티플레이어 룰렛 게임. 친구와 실시간으로 룰렛을 즐기세요. | `https://lamdice.com/roulette` |
| `horse-race-multiplayer.html` | 12 | `LAM Horse Race 🐎` | 온라인 경마 게임. 말에 베팅하고 친구들과 실시간 레이스를 관전하세요. | `https://lamdice.com/horse-race` |
| `dice-rules-guide.html` | 9 | `다양한 주사위 규칙 가이드 - LAMDice` | 주사위 게임 규칙 가이드 - High, Low, Near, Custom 등 다양한 규칙과 전략 설명. | `https://lamdice.com/dice-rules-guide.html` |
| `probability-analysis.html` | 9 | `확률 분석 및 팁 - LAMDice` | 주사위 게임 확률 분석과 전략 팁. 각 규칙별 승률 계산과 최적 전략 가이드. | `https://lamdice.com/probability-analysis.html` |
| `about-us.html` | 9 | `사이트 소개 - LAMDice` | LAMDice 소개 - 공정하고 투명한 멀티플레이어 보드게임 플랫폼. | `https://lamdice.com/about-us.html` |
| `contact.html` | 9 | `문의하기 - LAMDice` | LAMDice 문의하기 - FAQ, 건의사항 게시판, 기술 지원 안내. | `https://lamdice.com/contact.html` |
| `statistics.html` | 9 | `서비스 통계 - LAMDice` | LAMDice 서비스 통계 - 게임 플레이 수, 방문자 현황, 최근 활동. | `https://lamdice.com/statistics.html` |
| `privacy-policy.html` | 9 | `개인정보 처리방침 - LAMDice` | LAMDice 개인정보 처리방침 - 수집 정보, 이용 목적, 사용자 권리 안내. | `https://lamdice.com/privacy-policy.html` |
| `terms-of-service.html` | 9 | `이용 약관 - LAMDice` | LAMDice 이용 약관 - 서비스 이용 규칙과 사용자 의무. | `https://lamdice.com/terms-of-service.html` |

**OG tag values**: `og:title` = same as `<title>` content, `og:description` = same as meta description

**Verification**: `grep -l "meta name=\"description\"" *.html` returns all 11 files

---

### 4. Create sitemap.xml + update robots.txt

**Files**: `sitemap.xml` (new file in project root), `robots.txt` (replace)

**Create `sitemap.xml`** in project root:
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

**Replace `robots.txt`** (current content: `User-agent: *\nAllow: /`):
```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /prototype/

Sitemap: https://lamdice.com/sitemap.xml
```

Note: sitemap.xml in project root is auto-served by Express static middleware (`routes/api.js` line 18: `app.use(express.static(...))`). No server code change needed.

**Verification**: `curl https://lamdice.com/sitemap.xml` returns valid XML; `curl https://lamdice.com/robots.txt` shows Sitemap line

---

### 5. Game pages: noscript fallback + JSON-LD

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`

**Change A — JSON-LD**: Insert in `<head>`, before `</head>` tag

| File | Insert before line | `</head>` line |
|------|-------------------|----------------|
| `dice-game-multiplayer.html` | 1311 | 1311 (`</head>`) |
| `roulette-game-multiplayer.html` | 559 | 559 (`</head>`) |
| `horse-race-multiplayer.html` | 45 | 45 (`</head>`) |

**dice-game-multiplayer.html JSON-LD**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "LAMDice 주사위 게임",
  "description": "친구와 함께하는 온라인 주사위 게임. High, Low, Near 등 다양한 규칙으로 실시간 대결.",
  "url": "https://lamdice.com/game",
  "applicationCategory": "GameApplication",
  "operatingSystem": "Web Browser",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "KRW" }
}
</script>
```

**roulette-game-multiplayer.html JSON-LD**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "LAMDice 룰렛",
  "description": "무료 온라인 멀티플레이어 룰렛 게임. 친구와 실시간으로 룰렛을 즐기세요.",
  "url": "https://lamdice.com/roulette",
  "applicationCategory": "GameApplication",
  "operatingSystem": "Web Browser",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "KRW" }
}
</script>
```

**horse-race-multiplayer.html JSON-LD**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "LAMDice 경마",
  "description": "온라인 경마 게임. 말에 베팅하고 친구들과 실시간 레이스를 관전하세요.",
  "url": "https://lamdice.com/horse-race",
  "applicationCategory": "GameApplication",
  "operatingSystem": "Web Browser",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "KRW" }
}
</script>
```

**Change B — noscript**: Insert immediately after `<body>` tag, before first child element

| File | `<body>` line | Insert after line |
|------|---------------|-------------------|
| `dice-game-multiplayer.html` | 1312 | 1312 (before `<header>` at 1313) |
| `roulette-game-multiplayer.html` | 560 | 560 (before `<!-- 로딩 화면 -->` at 561) |
| `horse-race-multiplayer.html` | 46 | 46 (before `<!-- 로딩 화면 -->` at 47) |

**dice-game-multiplayer.html noscript**:
```html
<noscript>
  <div style="padding:40px; text-align:center; font-family:sans-serif;">
    <h1>LAMDice 주사위 게임</h1>
    <p>이 게임은 JavaScript가 필요합니다.</p>
    <p>친구와 함께하는 온라인 주사위 게임. High, Low, Near 등 다양한 규칙으로 실시간 대결. <a href="/">메인으로 돌아가기</a></p>
  </div>
</noscript>
```

**roulette-game-multiplayer.html noscript**:
```html
<noscript>
  <div style="padding:40px; text-align:center; font-family:sans-serif;">
    <h1>LAMDice 룰렛</h1>
    <p>이 게임은 JavaScript가 필요합니다.</p>
    <p>무료 온라인 멀티플레이어 룰렛 게임. <a href="/">메인으로 돌아가기</a></p>
  </div>
</noscript>
```

**horse-race-multiplayer.html noscript**:
```html
<noscript>
  <div style="padding:40px; text-align:center; font-family:sans-serif;">
    <h1>LAMDice 경마</h1>
    <p>이 게임은 JavaScript가 필요합니다.</p>
    <p>온라인 경마 게임. 말에 베팅하고 친구들과 실시간 레이스를 관전. <a href="/">메인으로 돌아가기</a></p>
  </div>
</noscript>
```

**Verification**: Google Rich Results Test → structured data detected; Disable JS → noscript content visible

---

### 6. Footer disclaimer (all pages)

Add a disclaimer line to every page's footer area. For pages without `<footer>`, insert before `</body>`.

**Disclaimer HTML**:
```html
<p style="text-align:center; font-size:0.8em; padding:8px 0; opacity:0.7; color:var(--text-secondary, #666);">
  LAMDice는 실제 화폐가 사용되지 않는 무료 소셜 보드게임 서비스입니다.
</p>
```

**Per-file insertion**:

| File | Has footer? | Insert location |
|------|-------------|-----------------|
| `index.html` | Yes (line 92-100) | Inside `<footer>`, after line 99 (before `</footer>` at 100) |
| `dice-game-multiplayer.html` | Yes (line 7206-7213) | Inside `<footer>`, after line 7212 (before `</footer>` at 7213) |
| `statistics.html` | Yes (line 164-168) | Inside `<footer>`, after line 167 (before `</footer>` at 168) |
| `roulette-game-multiplayer.html` | No | Before `</body>` at line 3511 |
| `horse-race-multiplayer.html` | No | Before `</body>` |
| `about-us.html` | No | Before `</body>` at line 208 |
| `dice-rules-guide.html` | No | Before `</body>` at line 172 |
| `probability-analysis.html` | No | Before `</body>` at line 228 |
| `contact.html` | No | Before `</body>` at line 507 |
| `privacy-policy.html` | No | Before `</body>` at line 112 |
| `terms-of-service.html` | No | Before `</body>` at line 116 |

For pages without `<footer>`, wrap in a simple footer:
```html
<footer style="text-align:center; padding:16px 0; font-size:0.9em; color:var(--text-secondary, #666);">
  <p style="font-size:0.85em; opacity:0.7;">
    LAMDice는 실제 화폐가 사용되지 않는 무료 소셜 보드게임 서비스입니다.
  </p>
</footer>
```

Also add disclaimer to **server-select-shared.js** overlay footer (line 402-408):
- Insert after line 407 (after the last `<a>` link), before `</div>`:
```html
<p style="margin:8px 0 0;font-size:0.75em;opacity:0.5;">LAMDice는 실제 화폐가 사용되지 않는 무료 소셜 보드게임 서비스입니다.</p>
```

**Verification**: Visible in page footer across all pages

---

### 7. Update Copyright year

**Files with `Copyright © 2025`**:

| File | Line | Current text |
|------|------|-------------|
| `index.html` | 93 | `Copyright &copy; 2025 LAMDice.` |
| `dice-game-multiplayer.html` | 7207 | `Copyright © 2025 LAMDice.` |
| `server-select-shared.js` | 403 | `Copyright &copy; 2025 LAMDice.` |

**Change**: Replace `2025` with `2026` in all three locations.

Also check `terms-of-service.html` line 61: `최종 수정일: 2025년 1월 1일` → `최종 수정일: 2026년 1월 1일`

**Verification**: `grep -r "2025" *.html *.js | grep -i copyright` returns no matches

---

### 8. Add site branding to server select overlay

**Files**: `server-select-shared.js`

**Change** (line 386-389):

Before:
```html
<div class="ss-header">
    <h1>🎮 서버 선택</h1>
    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
</div>
```

After:
```html
<div class="ss-header">
    <h1>🎮 LAMDice</h1>
    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
</div>
```

**Rationale**: The server select overlay (full-screen, z-index:10000) is the first thing users see. Currently shows no site branding — just "서버 선택". Adding "LAMDice" gives immediate brand recognition.

**Verification**: Load page → overlay shows "LAMDice" as heading

---

### 9. Show all servers for new users (no joined servers)

**Files**: `server-select-shared.js`

**Change** (lines 685-689):

Before:
```js
} else {
    // 기본: 가입한 서버 + 신청 대기중 + 내가 호스트인 서버 표시
    const myName = _getUserName();
    filtered = filtered.filter(s => s.is_member || s.is_pending || s.host_name === myName);
}
```

After:
```js
} else {
    // 기본: 가입한 서버 표시, 없으면 전체 서버 표시
    const myName = _getUserName();
    const myServers = filtered.filter(s => s.is_member || s.is_pending || s.host_name === myName);
    if (myServers.length > 0) {
        filtered = myServers;
    }
    // myServers가 비어있으면 filtered 유지 (전체 서버 표시)
}
```

**Rationale**: New users see empty list with "참여 중인 서버가 없어요" — platform looks empty/inactive. Showing all servers helps discovery.

**Verification**: Clear localStorage → load page → all servers visible; After joining → only joined servers shown

---

## Implementation Order

```
1. about-us.html 중복 제거              → 검증: 파일 끝 확인
2. sitemap.xml 생성 + robots.txt        → 검증: 파일 존재 확인
3. 전 페이지 meta/OG/canonical (11파일)  → 검증: grep 확인
4. index.html 정적 콘텐츠               → 검증: JS 비활성 테스트
5. 게임 페이지 noscript + JSON-LD (3파일)→ 검증: Rich Results Test
6. footer 면책 문구 (11파일 + JS 1개)    → 검증: 시각적 확인
7. Copyright 2025→2026 (3파일 + ToS)    → 검증: grep 확인
8. 서버 선택 오버레이 브랜딩             → 검증: 시각적 확인
9. 신규 사용자 서버 목록 표시            → 검증: localStorage 초기화 후 테스트
```

## Pre-Resubmission QA Checklist

| # | Check | Tool | Pass Criteria |
|---|-------|------|---------------|
| 1 | index.html shows content with JS disabled | Chrome > Disable JS | Service description + game list visible |
| 2 | about-us.html no duplicate | View source | No content after `</html>` |
| 3 | All pages have meta description | grep | All 11 HTML files matched |
| 4 | sitemap.xml valid | XML Sitemap Validator | All URLs accessible |
| 5 | robots.txt has Sitemap | curl | `Sitemap:` line present |
| 6 | Lighthouse SEO score | Chrome Lighthouse | >= 90 |
| 7 | Game pages noscript works | Chrome > Disable JS | Fallback content visible |
| 8 | OG tags work | Facebook Debugger | Preview generates correctly |
| 9 | Footer disclaimer visible | Visual check | Present on all pages |
| 10 | Copyright 2026 | grep | No "2025" in copyright lines |
| 11 | Overlay shows "LAMDice" branding | Visual check | "LAMDice" visible in overlay header |
| 12 | New user sees all servers | Clear localStorage + reload | Server list shows all available servers |

## Held Items (for future consideration)

- **Content hub page (/guide)**: If re-review still fails after this fix
- **Full "social strategy game" positioning**: Requires maintenance strategy for multi-file banners
- **Detailed non-gambling ToS clause**: Requires legal review first

> **On completion**: move this file to `docs/meeting/applied/`
