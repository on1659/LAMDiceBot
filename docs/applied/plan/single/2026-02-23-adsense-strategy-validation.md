# LAMDiceBot 팀 회의록 (Single)

**일시**: 2026-02-23
**주제**: AdSense 콘텐츠 전략 2차 검증 및 보완
**참석자 (관점)**: 개발자, SEO 분석가
**회의 방식**: 1인 순차 분석 (경량 버전)
**선행 문서**: [`2026-02-22-1400-adsense-content-strategy.md`](../multi/2026-02-22-1400-adsense-content-strategy.md)

---

## 1. 배경

2026-02-22 회의에서 수립한 8항목 전략이 구현 전 상태. 최신 AdSense 승인 기준(2026)과 대조하여 전략의 충분성을 검증하고, 누락 항목을 보완한다.

---

## 2. 현재 콘텐츠 실측

### 2-1. 페이지별 단어 수 측정

| 페이지 | 단어 수 (추정) | 판정 |
|--------|---------------|------|
| about-us.html | ~2,610 | 충분 |
| dice-rules-guide.html | ~2,890 | 충분 |
| probability-analysis.html | ~2,725 | 충분 |
| contact.html | ~1,050 | 기준선 |
| privacy-policy.html | ~945 | 기준선 |
| terms-of-service.html | ~810 | 기준선 |
| statistics.html | ~600 | 부족 (JS 동적) |
| index.html | ~400 | 부족 (랜딩) |

**총 콘텐츠 페이지: 7개** (index 제외 시 6개 실질 콘텐츠)

### 2-2. sitemap.xml 현황

- 11개 URL 등록
- `<lastmod>`, `<changefreq>` 없음
- 신규 콘텐츠 페이지 미포함

---

## 3. 최신 AdSense 승인 기준 (2026) 대조

### 3-1. 참조 소스

- [AdSense Approval Requirements 2025-2026](https://allareseotools.com/google-adsense-approval/)
- [Low Value Content Fix - Monetiscope](https://monetiscope.com/how-to-fix-low-value-and-minimum-content-violation/)
- [8 Tips Fix Low Value Content - Khizer Ishtiaq](https://khizerishtiaq.com/fix-adsense-low-value-content-error/)
- [AdSense for Gaming Sites - Startups.com](https://www.startups.com/questions/7376/can-i-get-adsense-approved-for-an-html5-gaming-site)
- [Google AdSense Updates 2026](https://news.tempemailnow.com/google-adsense-updates-2026/)

### 3-2. 기준 vs 현재 상태

| 기준 | 권장 | 현재 | 8항목 후 | 판정 |
|------|------|------|---------|------|
| 콘텐츠 페이지 수 | 15-25개 | 7개 | ~11개 | GAP |
| 글당 단어 수 | 800-1500+ | 핵심 3개 OK, 법적 페이지 경계 | 개선 | PARTIAL |
| 필수 페이지 (About, Contact, Privacy, Terms) | 4개 | 4개 | 4개 | PASS |
| Disclaimer 페이지 | 필수 | 없음 | 없음 | GAP |
| 네비게이션/메뉴 구조 | 명확 | 단절 | 공통 네비바 | PASS |
| 크롤러 콘텐츠 인식 | 빈 페이지 없어야 | ~~게임 3개 빈 페이지~~ 이미 noscript 존재 | 추가 불필요 | PASS (이미 완료) |
| 구조화 데이터 | 권장 | 게임 페이지만 | 정보 페이지 확대 | PASS |
| 오가닉 트래픽 | 50-100명/일 | 불명 | 전략 없음 | GAP |
| E-E-A-T | 전문성/신뢰 | 공정성 설명 있음 | changelog 보강 | PARTIAL |
| 내부 링크 구조 | 상호 연결 | 고립된 페이지 | 네비바+푸터 | PASS |
| 이미지/비주얼 | 텍스트만은 부적합 | 게임은 비주얼, 가이드는 텍스트만 | 미개선 | RISK |

### 3-3. 게임 사이트 특수 요건

- 게임 사이트는 "광고 배치 부적합" 판정 받기 쉬움
- **교육/정보 콘텐츠 비중이 게임보다 높아야** 콘텐츠 중심 사이트로 인식
- 현재: 게임 페이지 3개 vs 정보 페이지 7개 → 비율 OK
- 단, 게임 페이지가 사이트의 "주 기능"이므로, 정보 콘텐츠가 더 풍부해야 균형

---

## 4. 기존 8항목 전략 검증 결과

### 4-1. 유효한 항목 (유지)

| # | 항목 | 판정 |
|---|------|------|
| 1 | 오버레이 푸터 콘텐츠 링크 | 유지 — 크롤러 발견 경로 필수 |
| 2 | 공통 네비게이션 바 | 유지 — 3자 전원 동의, 핵심 |
| 3 | 게임 가이드 허브 + 룰렛/경마 가이드 | 유지 — 콘텐츠 확충 핵심 |
| 4 | noscript SEO 레이어 | ~~유지~~ **이미 구현됨** — 주사위/룰렛/경마에 noscript+meta desc 존재. 인형뽑기만 확인 필요 |
| 5 | JSON-LD 구조화 데이터 | 유지 — 리치 결과 |
| 6 | sitemap.xml 개선 | 유지 — 크롤링 최적화 |
| 7 | changelog.html | 유지 — 살아있는 사이트 신호 |
| 8 | statistics.html 정적 보강 | 유지 — 크롤러 폴백 |

### 4-2. 누락 항목 (추가 필요)

| # | 항목 | 근거 | 우선순위 |
|---|------|------|---------|
| 9 | **disclaimer.html** (면책 조항) | AdSense 필수 법적 페이지 누락 | 상 |
| 10 | **crane-game-guide.html** | 게임 존재(비공개), 가이드 없음 → 콘텐츠 수 증가. 단, `/crane-game` 라우트 주석 처리 상태이므로 CTA 링크는 생략하거나 라우트 활성화 필요 | 중 |
| 11 | **faq.html** (FAQ 독립 페이지) | contact.html에서 분리, FAQPage 스키마 독립 적용 | 중 |
| 12 | **교육 콘텐츠 2-3개** | 콘텐츠 수 15개+ 도달, E-E-A-T 강화 | 중 |
| 13 | **Google Search Console 인덱싱 확인** | 인덱싱 안 되면 모든 개선 무의미 | 상 |

### 4-3. 교육 콘텐츠 후보

| 주제 | 자연스러움 | 단어 목표 | E-E-A-T |
|------|----------|----------|---------|
| 주사위 게임의 역사와 문화 | 높음 — 게임 플랫폼과 직결 | 2,000+ | 전문성 |
| 온라인 보드게임 공정성: 난수 생성의 원리 | 높음 — about-us 심화 | 2,000+ | 신뢰성 |
| 보드게임으로 배우는 확률과 수학 | 높음 — probability 확장 | 2,000+ | 교육적 |

---

## 5. 보완된 실행 계획

> 구현 상세: [`2026-02-23-adsense-strategy-validation-impl.md`](../../meeting/impl/2026-02-23-adsense-strategy-validation-impl.md)

### Phase 1: 기술적 크롤러빌리티 수정

기존 전략 Item 1, 2, 4, 5, 6 + 신규 Item 13

- [x] ~~게임 페이지 4개에 noscript SEO 레이어 (Item 4)~~ — 주사위/룰렛/경마 이미 완료, 인형뽑기만 확인
- [ ] 오버레이 푸터에 콘텐츠 링크 추가 (Item 1)
- [ ] 정보 페이지 공통 네비게이션 바 (Item 2)
- [ ] JSON-LD 구조화 데이터 (Item 5)
- [ ] sitemap.xml lastmod/changefreq + 신규 URL (Item 6)
- [ ] Google Search Console 인덱싱 확인 (Item 13)

### Phase 2: 필수 콘텐츠 확충

기존 전략 Item 3, 7, 8 + 신규 Item 9, 10, 11

- [ ] disclaimer.html 면책 조항 (Item 9, 신규)
- [ ] game-guides.html 허브 (Item 3a)
- [ ] roulette-guide.html (Item 3b)
- [ ] horse-race-guide.html (Item 3c)
- [ ] crane-game-guide.html (Item 10, 신규 — `/crane-game` 라우트 비활성 상태 주의)
- [ ] faq.html FAQ 독립 페이지 (Item 11, 신규)
- [ ] changelog.html 업데이트 로그 (Item 7)
- [ ] statistics.html 정적 보강 (Item 8)

Phase 1+2 완료 시: **콘텐츠 페이지 14개**

### Phase 3: E-E-A-T 교육 콘텐츠 (재거절 시)

신규 Item 12

- [ ] 주사위 게임의 역사와 문화
- [ ] 온라인 보드게임 공정성: 난수 생성의 원리
- [ ] 보드게임으로 배우는 확률과 수학

Phase 1+2+3 완료 시: **콘텐츠 페이지 17개**

### 재신청 전 체크리스트

- [ ] `site:lamdice.com` 검색으로 전 페이지 인덱싱 확인
- [ ] Google Rich Results Test로 JSON-LD 검증
- [ ] PageSpeed Insights 모바일 점수 확인
- [ ] 신청 후 최소 15-20일 대기 (재심사 간격)

---

## 6. 최종 판단

**기존 8항목 전략은 방향이 맞으나 양이 부족하다.**

핵심 보완점:
1. Disclaimer 페이지 누락 → 필수 추가
2. 크레인 게임 가이드 누락 → 게임 있으니 가이드도 필요
3. FAQ 독립 페이지 → FAQPage 스키마 효과 극대화
4. 콘텐츠 수 11개 → 14개로 확충 (Phase 2), 재거절 시 17개 (Phase 3)
5. Google Search Console 인덱싱 확인 절차 누락

**추천 모델**: Sonnet (대부분 HTML 콘텐츠 생성, 반복 패턴)
