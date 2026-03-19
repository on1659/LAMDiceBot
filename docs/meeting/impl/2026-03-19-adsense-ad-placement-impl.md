# AdSense Ad Placement — Implementation Document

**Recommended Model**: Sonnet (repetitive HTML insertion across multiple files)
**Mockup Reference**: `prototype/adsense-placement-mockup.html`
**Meeting Reference**: 2026-03-19 meeting-team (8인 전원 참여)
**AdSense Publisher ID**: `ca-pub-1608259764663412`

---

## Overview

AdSense 승인 완료. 게임/정보/인덱스 페이지에 광고 슬롯 배치.
핵심 원칙: **게임 진행 중(playing)에는 광고 없음**.

### Page Classification

| Type | Pages | Ad Strategy |
|------|-------|------------|
| Info pages | faq, about-us, game-guides, privacy-policy, terms-of-service, disclaimer, fairness-rng, probability-analysis, probability-education, dice-rules-guide, dice-history, statistics, contact, changelog, roulette-guide, horse-race-guide, crane-game-guide | In-article + bottom banner (aggressive) |
| Index | index.html | After game cards + pre-footer |
| Game pages | dice-game, roulette-game, horse-race, crane-game (-multiplayer.html) | Lobby banner + pre-SEO banner (crane은 SEO 섹션 없어 lobby만) |

### Ad Slot Summary

| Slot | Location | Priority | Pages |
|------|----------|----------|-------|
| A | Lobby — room list 하단 | 1st | Game 4종 |
| B | SEO section 직전 | 2nd | Game 3종 (crane 제외 — SEO 섹션 없음) |
| C | In-article (content 중간) | 1st | Info pages |
| D | Bottom banner (footer 직전) | 1st | Info + Index |
| E | After game cards | 1st | Index only |

---

## Phase 1: Common CSS (theme.css)

**Location**: `css/theme.css` — 파일 끝에 추가

```css
/* ── Ad Container ── */
.ad-container {
  margin: 20px auto;
  padding: 12px;
  text-align: center;
  max-width: 728px;
  min-height: 90px;
  background: var(--bg-primary);
  border-radius: 10px;
}
.ad-container .ad-label {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}
/* Hide container when ad fails to load */
.ad-container.ad-hidden {
  display: none;
  min-height: 0;
  margin: 0;
  padding: 0;
}
/* Game playing state: keep height but hide visually (prevent CLS) */
.game-active .ad-container.ad-lobby {
  visibility: hidden;
}
/* Future: premium users see no ads */
body.premium .ad-container {
  display: none !important;
}
```

**Verification**: `.ad-container` class renders with rounded bg matching existing panels.

---

## Phase 2: Info Pages (17 files) — 1순위

Info pages have no game logic risk. Deploy first for immediate monetization.

### 2-1. In-Article Ad (Slot C)

Insert between content sections. Exact position varies per page.

**HTML snippet**:
```html
<!-- Ad: In-Article -->
<div class="ad-container">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block; text-align:center"
       data-ad-layout="in-article"
       data-ad-format="fluid"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="SLOT_C_ID"></ins>
  <!-- ads.js handles push() -->
</div>
```

**Placement per page** (content midpoint):

| Page | Insert after |
|------|-------------|
| faq.html | 3rd .faq-item |
| about-us.html | 2nd section |
| game-guides.html | After first game guide row |
| privacy-policy.html | After "수집하는 정보" section |
| terms-of-service.html | After "서비스 이용" section |
| disclaimer.html | After first section |
| fairness-rng.html | After RNG explanation |
| probability-analysis.html | After first analysis block |
| probability-education.html | After intro section |
| dice-rules-guide.html | After basic rules section |
| dice-history.html | After origin section |
| statistics.html | After first chart/table |
| contact.html | After contact info |
| roulette-guide.html | After basic rules |
| horse-race-guide.html | After basic rules |
| crane-game-guide.html | After basic rules |
| changelog.html | After 5th changelog entry |

### 2-2. Bottom Banner (Slot D)

Insert before `</body>` or before footer on every info page.

**HTML snippet**:
```html
<!-- Ad: Bottom Banner -->
<div class="ad-container" style="max-width:800px;">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="SLOT_D_ID"
       data-ad-format="horizontal"
       data-full-width-responsive="true"></ins>
  <!-- ads.js handles push() -->
</div>
```

**Verification**: Open each info page → 2 ads visible (mid + bottom). No layout overlap.

---

## Phase 3: Index Page

### 3-1. After Game Cards (Slot E)

**File**: `index.html`
**Location**: After the game cards grid section, before content links section.

```html
<!-- Ad: After Game Cards -->
<div class="ad-container" style="max-width:900px;">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="SLOT_E_ID"
       data-ad-format="auto"
       data-full-width-responsive="true"></ins>
  <!-- ads.js handles push() -->
</div>
```

### 3-2. Pre-Footer (Slot D reuse)

Same bottom banner as info pages.

---

## Phase 4: Game Pages (4 files)

### 4-0. Auto-Ads Disabled on Game Pages

게임 페이지에서는 Google 자동 광고(앵커, 전면 광고 등)를 비활성화한다.
자동 광고는 게임 중 갑자기 튀어나와 플레이를 방해할 수 있기 때문.

**All 4 game pages — `<head>` 내 AdSense 스크립트 앞에 추가:**
```html
<script>
  (adsbygoogle = window.adsbygoogle || []).push({ google_ad_client: "ca-pub-1608259764663412", enable_page_level_ads: false });
</script>
```

> Info pages / Index는 자동 광고를 유지한다 (추가 수익).
> 게임 페이지만 수동 배치(Slot A, B)로 제어.

### 4-1. Lobby Banner (Slot A)

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `crane-game-multiplayer.html`

**Location**: Inside `#lobbySection`, after room list, before chat area.

> Note: dice의 기존 placeholder(`YOUR_SLOT_ID`)는 `SLOT_A_ID`로 교체 완료. 다른 3종은 신규 삽입.

**HTML snippet**:
```html
<!-- Ad: Lobby Banner -->
<div class="ad-container ad-lobby">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="SLOT_A_ID"
       data-ad-format="auto"
       data-full-width-responsive="true"></ins>
  <!-- ads.js handles push() -->
</div>
```

**CLS prevention**: `.ad-lobby` has `min-height: 90px`. During game-active state, CSS rule `.game-active .ad-container.ad-lobby` sets `visibility: hidden` (keeps space, no layout shift).

### 4-2. Pre-SEO Banner (Slot B)

**Location**: Before `<!-- SEO Content Section -->`, after main container closing div.

```html
<!-- Ad: Pre-SEO Banner -->
<div class="ad-container" style="max-width:800px;">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="SLOT_B_ID"
       data-ad-format="horizontal"
       data-full-width-responsive="true"></ins>
  <!-- ads.js handles push() -->
</div>
```

**Verification**: Enter lobby → Slot A visible below room list. Start game → Slot A hidden (no jump). Scroll down → Slot B always visible above SEO section.

---

## Constraints

### AdSense Policy
- No ads inside result-overlay (popup ad violation)
- No ads adjacent to betting buttons (misclick risk → policy violation)
- Max 3 ad units per page
- Ad must be visually distinguishable from game UI

### Technical
- Ad scripts load `async` — no blocking of Socket.IO init
- `(adsbygoogle).push({})` runs on main thread — avoid calling during game animations
- Ad container uses `min-height` to prevent CLS (Cumulative Layout Shift)
- Ad blocker fallback: `ads.js`의 try-catch가 `.ad-hidden` class를 추가하여 빈 컨테이너 숨김

---

## Future: Premium Ad-Free (v2)

> 결제 시 광고 비노출 기능. 현재 Phase에서는 구현하지 않지만,
> 아래 설계를 고려하여 광고 코드를 작성한다.

### Architecture

```
[Client]                        [Server]
  │                                │
  ├─ page load ──────────────────► │
  │                                ├─ check user premium status
  │ ◄──── premiumStatus: true ─────┤   (DB: users.is_premium)
  │                                │
  ├─ if premium:                   │
  │   hide all .ad-container       │
  │   skip adsbygoogle.push()      │
  │                                │
  ├─ if free:                      │
  │   show .ad-container           │
  │   adsbygoogle.push() as normal │
```

### DB Schema (future)

```sql
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN premium_expires_at TIMESTAMP;
```

### Client-Side Preparation (now)

All ad insertion code should be wrapped in a check function:

```js
// js/ads.js — shared ad initialization (actual file)
function initAds() {
  // Future: if (window.__USER_PREMIUM__) return;

  document.querySelectorAll('.ad-container').forEach(function(container) {
    var ins = container.querySelector('.adsbygoogle');
    if (ins && !ins.dataset.adsbygoogleStatus) {
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        // Ad blocker or load failure — hide empty container
        container.classList.add('ad-hidden');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();
});
```

### Premium Flow (future implementation)

1. User pays → server sets `is_premium = true`, `premium_expires_at`
2. On page load, client calls `GET /api/user/premium`
3. If premium: `body.classList.add('premium')` → CSS hides all `.ad-container`
4. If expired: revert to free, show ads again

```css
/* Future: premium users see no ads */
body.premium .ad-container {
  display: none !important;
}
```

### Why Prepare Now

- `.ad-container` class를 모든 광고에 통일하면, 나중에 `.premium .ad-container { display: none }` 한 줄로 전체 제거 가능
- `initAds()` 함수로 광고 초기화를 중앙 관리하면, premium 체크 로직 삽입이 한 곳에서 끝남
- 각 HTML에 광고를 직접 `push()`하지 않고 함수 호출로 통일하면 제어가 쉬움

---

## Implementation Order

```
1. [CSS]  theme.css에 .ad-container 스타일 추가 (+ body.premium 규칙)
   → Verify: class 존재 확인

2. [JS]   js/ads.js 공통 모듈 생성 (initAds 함수 — 중앙 push 관리)
   → Verify: console에서 initAds() 호출 가능
   → Note: 각 HTML에 인라인 push() 넣지 않음. ads.js가 전부 처리.

3. [HTML] Info pages 17개에 Slot C + D 삽입 + <script src="/js/ads.js">
   → Verify: 각 페이지에서 광고 2개 렌더링 확인

4. [HTML] index.html에 Slot E + D 삽입 + <script src="/js/ads.js">
   → Verify: 게임 카드 아래 + 푸터 위 광고 확인

5. [HTML] Game pages 4종에 auto-ads 비활성화 (enable_page_level_ads: false)
   → Verify: 앵커/전면 자동 광고가 게임 페이지에서 안 뜨는지 확인

6. [HTML] Game pages 4종에 Slot A 삽입, 3종에 Slot B 삽입 (crane 제외)
   → Verify: 로비에서 광고 보임, 게임 중 Slot A 숨김 확인

7. [TEST] AdSense slot ID를 실제 값으로 교체
   → Verify: Google AdSense 대시보드에서 노출 확인
```

---

## Slot ID Checklist

| Slot | ID | Status |
|------|----|--------|
| A (Lobby) | `SLOT_A_ID` | ❌ Need real ID |
| B (Pre-SEO) | `SLOT_B_ID` | ❌ Need real ID |
| C (In-Article) | `SLOT_C_ID` | ❌ Need real ID |
| D (Bottom) | `SLOT_D_ID` | ❌ Need real ID |
| E (After Cards) | `SLOT_E_ID` | ❌ Need real ID |
