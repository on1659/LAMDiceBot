# LAMDiceBot 팀 회의록

**일시**: 2026-03-15
**주제**: AdSense 재승인을 위한 크롤러 접근성 및 내부 링크 구조 개선
**참석자**: 전원 (지민, 현우, 소연, 태준, 미래, 윤서, 다은, 승호)
**회의 방식**: 8인 멀티에이전트 독립 분석 → 합의 도출

---

## 1. 현황 요약

- **문제**: Google AdSense에서 "가치가 별로 없는 콘텐츠"로 거절
- **사이트 현황**: 콘텐츠 페이지 24개 존재하지만 거절됨
- **핵심 발견**: 콘텐츠 부족이 아닌 **크롤러 접근성 문제**가 근본 원인

### 근본 원인 분석

| # | 문제 | 영향 |
|---|------|------|
| 1 | `index.html`의 `<body style="visibility:hidden">` + `<main style="visibility:hidden">` | 크롤러에게 빈 페이지로 보임 |
| 2 | FOUC 방지 스크립트가 `html opacity:0` 설정 | 3중 숨김으로 콘텐츠 완전 차단 |
| 3 | ServerSelectModule 오버레이가 즉시 모든 콘텐츠 덮음 | 내부 링크 접근 불가 |
| 4 | 게임 페이지(roulette, horse-race)에서 콘텐츠 페이지 링크 0개 | 콘텐츠 발견 경로 없음 |
| 5 | 콘텐츠 페이지 footer가 빈약 (링크 2~3개) | 페이지 간 연결 고리 부족 |

---

## 2. 팀원별 핵심 의견

### 지민 (PD/PM)
- "콘텐츠 추가가 아니라 기존 콘텐츠를 노출시키는 게 핵심이다"
- 랜딩 페이지를 콘텐츠 허브로 전환, 기존 사용자 동선은 쿼리 파라미터로 보존

### 현우 (백엔드)
- "서버 사이드 변경 없이 프론트만으로 해결 가능"
- sitemap.xml lastmod 날짜가 전부 고정되어 있어 갱신 필요

### 소연 (프론트엔드)
- "`visibility:hidden` 3중 숨김이 결정적 문제. FOUC 방지는 CSS `data-theme`으로 충분"
- ServerSelectModule.show() 자동 호출 제거, 버튼 클릭으로 전환

### 태준 (게임로직)
- "게임 페이지 하단에 SEO 텍스트 섹션 추가하면 게임 플레이에 영향 없음"
- noscript 태그 강화로 JS 비활성화 크롤러 대응

### 미래 (기획)
- "콘텐츠 페이지에 CTA 배너 추가로 사용자 순환 동선 생성"
- 게임 → 가이드 → 게임 순환 구조 설계

### 윤서 (QA)
- "배포 전 JS 비활성화 테스트 + Lighthouse SEO 90점+ 검증 필수"
- Google Search Console URL 검사로 렌더링 확인

### 다은 (디자인)
- "CTA 배너는 기존 보라색 그라디언트 톤 유지"
- footer 내비게이션 8개 링크로 통일

### 승호 (인프라)
- "robots.txt는 이미 정상. Schema.org 마크업 보강 필요"
- crane-game-multiplayer.html에 WebApplication 마크업 누락 발견

---

## 3. 주요 합의점

1. **콘텐츠 추가 불필요** — 기존 24개 페이지 활용, 새 페이지 작성 안 함
2. **index.html visibility:hidden 완전 제거** — FOUC 방지는 `data-theme` CSS로 대체
3. **랜딩 페이지 = 콘텐츠 허브** — Hero + 게임 카드 + 콘텐츠 링크 + 풍부한 footer
4. **?direct/?server 하위호환** — Discord 봇 등 기존 링크 동작 유지
5. **게임 페이지에 SEO 섹션 추가** — 게임 UI 아래 스크롤 위치, 게임 영향 없음
6. **모든 콘텐츠 페이지 footer 통일** — 8개 내비 링크 + 서비스 설명
7. **SSR/프레임워크 도입 불필요** — 정적 HTML 수정만으로 충분

---

## 4. 충돌 지점

- 없음. 근본 원인이 명확하여 전원 동일 방향 합의.

---

## 5. 구현 문서

→ [impl: 2026-03-15-adsense-crawler-accessibility-fix-impl.md](../../impl/2026-03-15-adsense-crawler-accessibility-fix-impl.md)

---

## 6. 다음 액션

| # | 액션 | 담당 |
|---|------|------|
| 1 | Phase 1~4 구현 (이 세션에서 완료) | 소연 (프론트) |
| 2 | Phase 5 검증 (배포 후) | 윤서 (QA) |
| 3 | AdSense 재신청 | 지민 (PD) |
